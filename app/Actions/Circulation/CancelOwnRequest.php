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
use App\Support\Clock;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * A reader withdraws their own request — BR §7.2's cancelled. Reachable
 * from pending AND approved: OPS §4.2 names the row "their own pending or
 * held request" (BR §7.2's diagram draws the arrow off pending alone).
 * Port of cancel-own-request.ts.
 *
 * Cancelling a held request releases the copy IN THIS TRANSACTION (OPS
 * §4.2 lists INV-2 under this command as "releases the hold if one
 * exists"): a request left approved goes on naming the copy and the copy's
 * state goes on saying held, with nobody left to hand it to.
 * CountsCopies::borrowable() wants state = available AND no live approved
 * hold, so the copy fails its FIRST clause: it stays out of the
 * catalogue's "còn sách" filter (CatalogueQuery:32's whereHas) and out of
 * the available_count aggregate, which CountsCopies::withCopyCounts()
 * computes for six query classes — CatalogueQuery, BooksListQuery,
 * BookDetailQuery, ManagerBookDetailQuery, SearchQuery and
 * SearchBooksForLendingQuery — until something else puts it back.
 * (borrowable() has exactly two call sites, CatalogueQuery:32 and
 * CountsCopies:59; grepped. An earlier draft of this line said
 * CatalogueQuery was the only one, which was false.)
 *
 * held → available is guarded ON THE STATE, in the WHERE itself: a copy
 * that has since moved on (lent, lost, retired) is left alone — zero
 * affected rows is a legitimate outcome, not an error. The affected-row
 * count IS the answer: releasedCopyId is null unless the guarded UPDATE
 * matched.
 *
 * hold_expires_at and copy_id are LEFT WHERE THEY STAND — the record of
 * what the reader gave up. Blanking them would erase it, and they are not
 * stale: today's two readers of a hold — borrowable()'s NOT EXISTS clause
 * and ApproveBorrowRequest's live-hold probe — both filter on
 * status = approved (grepped, not assumed), so a cancelled row's hold is
 * inert.
 *
 * OWNERSHIP is the whole of the permission and both sides are users.id:
 * borrow_requests.member_id against $actor->id. member_id's name says
 * membership and its foreign key says otherwise, so comparing it against a
 * membership id would never be equal and EVERY cancellation would be
 * refused as somebody else's, with no pure predicate to notice — the
 * reference's named trap. A manager therefore cannot cancel a reader's
 * request through this command (Từ chối is their command for the row), and
 * neither can a super admin, whose Gate::before door (AppServiceProvider)
 * opens act-as-reader for them without making them the requester: that is
 * a live path to not_own_request, not defence in depth.
 *
 * Lock order (plan divergence 1): copy first WHEN the route-bound snapshot
 * names one (copy_id is an in-memory attribute — reading it issues no
 * query), then the request. A snapshot bound pre-approval names none; if
 * an approval commits in between, the guarded release runs after the
 * request lock and takes the copy's row lock second — the one place this
 * phase's order inverts. That is the ONLY way the lock and the release can
 * name different rows: the lock names the snapshot's copy_id, the release
 * names the locked row's, and borrow_requests.copy_id has exactly one
 * writer under app/ — ApproveBorrowRequest:158's pending → approved update
 * (grepped; every other 'copy_id' write in app/Actions targets loans,
 * condition_assessments or an audit payload). So the two can differ only
 * by null → a copy id, never copy A → copy B.
 *
 * That residual window is recorded in the plan's divergence 1 with its
 * interleaving, and no deadlock-freedom claim is made here either way;
 * Task 19's wrap-up is the task that copies the record into
 * docs/known-gaps.md, which does not carry it yet. The
 * alternative — request first, always — would invert the order against
 * ApproveBorrowRequest and LendCopy on every contested schedule rather
 * than on this vanishing one.
 *
 * No notification: BR §15's reader list carries no event for a reader's
 * own withdrawal (the reference's "the one of the five that may genuinely
 * need none"), so this command writes none.
 */
final class CancelOwnRequest
{
    public function __construct(
        private Clock $clock,
        private AuditRecorder $audit,
    ) {}

    /** @return array{requestId: string, releasedCopyId: ?string} */
    public function execute(User $actor, BorrowRequest $request): array
    {
        Gate::forUser($actor)->authorize('cancel', $request);

        $snapshotCopyId = $request->copy_id;   // in-memory attribute; no query

        return DB::transaction(function () use ($actor, $request, $snapshotCopyId): array {
            // FIRST statement when a copy is named — see the class docblock.
            if ($snapshotCopyId !== null) {
                BookCopy::query()->lockForUpdate()->find($snapshotCopyId);
            }
            $request = BorrowRequest::query()->lockForUpdate()->findOrFail($request->id);

            // Ownership before status. findOrFail has already folded "no
            // such request" and "another shelf's request" (BookshelfScope,
            // SoftDeletes) into ONE ModelNotFoundException, indistinguishable
            // from each other — that is the anti-enumeration guarantee (spec
            // §5.4). not_own_request is a DIFFERENT answer, not that 404:
            // bootstrap/app.php renders RuleViolated as a redirect back
            // carrying the Vietnamese sentence. Reaching it already means the
            // row is on the caller's own bound shelf, and OPS §4.2 asks for
            // the check regardless — "should be structurally unreachable via
            // UI, but the command must still check".
            if ($request->member_id !== $actor->id) {
                throw new RuleViolated('not_own_request');
            }
            // Before the general case, because OPS §4.2 gives it its own
            // sentence: a child who has the book has not had a request
            // processed in the abstract — they have the book.
            if ($request->status === RequestStatus::Fulfilled) {
                throw new RuleViolated('request_already_fulfilled');
            }
            if ($request->status !== RequestStatus::Pending && $request->status !== RequestStatus::Approved) {
                throw new RuleViolated('request_not_pending');
            }

            $before = ['status' => $request->status->value, 'copy_id' => $request->copy_id];
            $title = (string) Book::query()->whereKey($request->book_id)->value('title');

            $request->update([
                'status' => RequestStatus::Cancelled,
                'cancelled_at' => $this->clock->now(),
            ]);

            // Guarded release: the WHERE repeats the decision, so a copy
            // that changed state between the bind and the lock is left
            // alone rather than dragged back onto the shelf. One variable
            // for the audit row and the return value both — a released id
            // the caller sees and the log does not is not a distinction
            // worth being able to make.
            $releasedCopyId = null;
            if ($request->copy_id !== null) {
                $affected = BookCopy::query()
                    ->whereKey($request->copy_id)
                    ->where('state', CopyState::Held)
                    ->update(['state' => CopyState::Available]);
                $releasedCopyId = $affected === 1 ? $request->copy_id : null;
            }

            $this->audit->record('request.cancelled', 'request', $request->id,
                $before,
                [
                    'status' => 'cancelled',
                    'title' => $title,
                    // Which copy went back on the shelf, and null when
                    // none did — a withdrawal from a queue and a
                    // withdrawal that freed a book, tellable apart without
                    // joining anything.
                    'released_copy_id' => $releasedCopyId,
                ]);

            return [
                'requestId' => $request->id,
                'releasedCopyId' => $releasedCopyId,
            ];
        });
    }
}
