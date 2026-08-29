<?php

namespace App\Actions\Circulation;

use App\Enums\CopyState;
use App\Enums\RequestStatus;
use App\Exceptions\RuleViolated;
use App\Models\Book;
use App\Models\BookCopy;
use App\Models\BorrowRequest;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\Circulation\LendingSettings;
use App\Support\Circulation\LoanTerms;
use App\Support\Circulation\RequestRules;
use App\Support\Clock;
use App\Support\Notifications\NotificationKind;
use App\Support\Notifications\Notifier;
use App\Support\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * A manager puts a specific copy aside for the reader whose turn it is —
 * BR §7.2's pending → approved, BR §16.3's "Approve (creating a hold with
 * a visible expiry)". Port of approve-borrow-request.ts.
 *
 * The same effect ReceiveReturn performs when it holds a returned copy,
 * reached from the queue screen instead of the return form — which is
 * why holdDays and holdExpiry live in shared homes (LendingSettings,
 * LoanTerms) rather than being restated here.
 *
 * Lock order (divergence 1): copy FIRST — two managers approving two
 * readers onto one copy would otherwise each read it available and each
 * write a hold, INV-3's premise broken with no index to catch it
 * (borrow_requests has no uniqueness on copy_id; the row lock IS the
 * guarantee, the reference's own argument) — then the REQUEST row, which
 * the reference read unlocked; locking it serialises a racing reject or
 * cancel of the same request.
 *
 * The copy moves available → held in the same transaction, so state and
 * hold never disagree. A lapsed rival hold arrives as null through the
 * hold_expires_at > now filter and the copy is then refused by the STATE
 * branch — freeing it is a recorded transition, never a side effect.
 *
 * $copyId is a raw string (a form field, not a route binding), and
 * find() on a non-row is copy_not_found — one answer for "no such copy",
 * "another shelf's copy" (BookshelfScope), "a withdrawn copy"
 * (SoftDeletes) and "a copy of a different title", deliberately (spec
 * §5.4).
 *
 * That covers every id that is a well-formed ASCII string. It does NOT
 * cover a malformed one: book_copies.id is ascii_bin, so comparing it
 * against a utf8mb4 parameter is errno 1267, "Illegal mix of collations",
 * a QueryException rather than a refusal — measured here against the live
 * MariaDB by handing find() a single emoji, not inferred from the column
 * type. Nothing routes to this Action yet (pinned by
 * CirculationArchitectureTest), and Task 14's Form Request is where the
 * uuid rule goes, so a stray emoji becomes a validation message on the way
 * in rather than a 500 here.
 *
 * The bound shelf, not the membership, is what this command reads off
 * TenantContext — hold_days is the SHELF's setting, and a super admin who
 * is a member of nothing still has a shelf bound (AppServiceProvider's
 * Gate::before opens act-as-manager for them while ResolveTenant leaves
 * membership() null, so a membership read here would have to decide what
 * that null means). A null SHELF means system-wide or unbound, and there
 * is no shelf whose hold_days to apply: shelf_not_found, before any write.
 */
final class ApproveBorrowRequest
{
    public function __construct(
        private Clock $clock,
        private AuditRecorder $audit,
        private Notifier $notifier,
        private TenantContext $tenant,
    ) {}

    /** @return array{requestId: string, copyId: string, holdExpiresAt: CarbonImmutable} */
    public function execute(User $actor, BorrowRequest $request, string $copyId): array
    {
        Gate::forUser($actor)->authorize('approve', $request);

        return DB::transaction(function () use ($actor, $request, $copyId): array {
            // FIRST statement — see the class docblock.
            $copy = BookCopy::query()->lockForUpdate()->find($copyId);
            if ($copy === null) {
                throw new RuleViolated('copy_not_found');
            }
            // SECOND — the request, latest committed row.
            $request = BorrowRequest::query()->lockForUpdate()->findOrFail($request->id);

            if ($request->status !== RequestStatus::Pending) {
                throw new RuleViolated('request_not_pending');
            }
            // "An available copy OF THE REQUESTED TITLE" — OPS §4.2's own
            // wording; a copy of another title is simply not found.
            if ($copy->book_id !== $request->book_id) {
                throw new RuleViolated('copy_not_found');
            }

            // The live hold on this copy, if any — read AFTER the copy
            // lock, through the expiry filter, so a lapsed hold arrives
            // as absence (the convention copyHoldable is written against).
            // A row that IS live yields a non-null holder whatever its
            // member_id holds, so the refusal cannot be dodged by a
            // surprising column value: member_id is NOT NULL in the
            // schema, and the cast keeps that true for the predicate.
            $hold = BorrowRequest::query()
                ->where('copy_id', $copy->id)
                ->where('status', RequestStatus::Approved)
                ->where('hold_expires_at', '>', $this->clock->now())
                ->orderBy('requested_at')->orderBy('id')
                ->first(['member_id']);
            $heldForUserId = $hold === null ? null : (string) $hold->member_id;

            if (($code = RequestRules::copyHoldable($copy->state, $heldForUserId)) !== null) {
                throw new RuleViolated($code);
            }

            $shelf = $this->tenant->bookshelf();
            if ($shelf === null) {
                throw new RuleViolated('shelf_not_found');
            }
            $now = $this->clock->now();
            $holdExpiresAt = LoanTerms::holdExpiry($now, LendingSettings::fromShelf($shelf)->holdDays);

            // The title, read inside the transaction so the audit entry
            // and the notification STORE it (P1 §3.2a).
            $title = (string) Book::query()->whereKey($request->book_id)->value('title');

            $request->update([
                'status' => RequestStatus::Approved,
                'copy_id' => $copy->id,
                'hold_expires_at' => $holdExpiresAt,
                'decided_by' => $actor->id,
                'decided_at' => $now,
            ]);
            $copy->update(['state' => CopyState::Held]);

            $this->audit->record('request.approved', 'request', $request->id,
                ['status' => 'pending', 'copy_id' => null],
                [
                    'status' => 'approved',
                    'copy_id' => $copy->id,
                    'hold_expires_at' => $holdExpiresAt->toISOString(),
                    // A users(id) — member_id's name says membership, its
                    // FK says otherwise; stored under userId, the subject
                    // join's key (Task 1's AuditLogQuery arm).
                    'userId' => $request->member_id,
                ]);

            // OPS §7: approval and "sách đã sẵn sàng" are ONE event a
            // child experiences once — one kind, one row. The deadline is
            // in the payload because a hold whose end a child does not
            // know is a hold they will miss; the date is the PARISH's day
            // (plan divergence 5).
            $this->notifier->notify($request->member_id, NotificationKind::RequestApproved, [
                'title' => $title,
                'hold_until' => $holdExpiresAt->timezone('Asia/Ho_Chi_Minh')->toDateString(),
            ]);

            return ['requestId' => $request->id, 'copyId' => $copy->id, 'holdExpiresAt' => $holdExpiresAt];
        });
    }
}
