<?php

namespace App\Actions\Circulation;

use App\Enums\RequestStatus;
use App\Exceptions\RuleViolated;
use App\Models\Book;
use App\Models\BorrowRequest;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\Clock;
use App\Support\Notifications\NotificationKind;
use App\Support\Notifications\Notifier;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * A manager declines a queued request — BR §7.2's pending → rejected,
 * terminal. Port of reject-borrow-request.ts. Nothing is deleted (BR
 * §11): the row stays with its reason, so "why did this not happen" has
 * an answer six months later.
 *
 * The reason is OPTIONAL (product-owner ruling 2, the reference's
 * shipped reading with its named test): OPS §4.2 lists no
 * reason_required here, unlike the registration and profile-change
 * rejections. It lands in decision_note — decided_by/decided_at/
 * decision_note are shared by approval and rejection alike. An empty
 * box is NO reason, not a reason that says nothing.
 *
 * One lock, the request row (this command touches no copy — a pending
 * request names none), taken as the transaction's first statement.
 * "No such request" and "another shelf's" (scope) never reach
 * request_not_pending at all — lockForUpdate()->findOrFail() throws
 * ModelNotFoundException for both, before either input is told apart
 * from the other. "Already decided" is the one case that IS
 * request_not_pending. All three are one answer to the caller — a
 * 404 — so telling them apart would confirm the other shelf's request
 * exists either way.
 */
final class RejectBorrowRequest
{
    public function __construct(
        private Clock $clock,
        private AuditRecorder $audit,
        private Notifier $notifier,
    ) {}

    /** @return array{requestId: string} */
    public function execute(User $actor, BorrowRequest $request, ?string $reason = null): array
    {
        Gate::forUser($actor)->authorize('reject', $request);

        return DB::transaction(function () use ($actor, $request, $reason): array {
            // FIRST statement — the only lock this command takes.
            $request = BorrowRequest::query()->lockForUpdate()->findOrFail($request->id);

            if ($request->status !== RequestStatus::Pending) {
                throw new RuleViolated('request_not_pending');
            }

            $trimmed = ($reason === null || trim($reason) === '') ? null : trim($reason);
            $title = (string) Book::query()->whereKey($request->book_id)->value('title');

            $request->update([
                'status' => RequestStatus::Rejected,
                'decided_by' => $actor->id,
                'decided_at' => $this->clock->now(),
                'decision_note' => $trimmed,
            ]);

            $this->audit->record('request.rejected', 'request', $request->id,
                ['status' => 'pending'],
                [
                    'status' => 'rejected',
                    'title' => $title,
                    // The one sentence in the request family whose actor
                    // and subject are different people — a manager
                    // refusing a child. userId is the subject join's key.
                    'userId' => $request->member_id,
                    // 'reason', matching copy.retired and
                    // membership.rejected, so because() finds it without a
                    // third spelling.
                    'reason' => $trimmed,
                ]);

            $this->notifier->notify(
                $request->member_id,
                NotificationKind::RequestRejected,
                $trimmed === null ? ['title' => $title] : ['title' => $title, 'reason' => $trimmed],
            );

            return ['requestId' => $request->id];
        });
    }
}
