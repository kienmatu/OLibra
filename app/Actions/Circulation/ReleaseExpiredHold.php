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
 * BR §7.2's approved → expired, at last written by something — the
 * product owner's ruling 1 (2a plan): the reference left a lapsed hold
 * with no manager exit (the copy in `held` forever unless the READER
 * cancelled), and the queue query's own docblock demanded a command that
 * never existed. This is that command: the manager records the lapse the
 * clock already produced, and the copy goes back on the shelf in the same
 * transaction.
 *
 * Guarded on the hold actually having lapsed (hold_not_expired
 * otherwise): a live hold is a promise to a child who may be on their
 * way, and yanking it is not this command. Freeing early has an ordinary
 * path — the reader cancels, or the hold runs out. The comparison is
 * against the LOCKED row's hold_expires_at and the injected clock, and it
 * is the mirror of the handover's: that command calls a hold dead at
 * `<=` its instant, this one calls it releasable at `<=` its instant, so
 * no hold with an expiry is ever both un-handoverable and un-releasable.
 * The one row both refuse is an approved one whose hold_expires_at is
 * NULL — a shape no command writes (see the guard's own comment below),
 * refused here rather than read as a hold that never ends.
 *
 * THE STATUS IS A RECORD, NOT A DERIVATION. Expiry stays computed on read
 * everywhere it is asked about (BR §8; the queue's holdExpired flag,
 * ApproveBorrowRequest's and LendCopy's `hold_expires_at >` filters), and
 * this write changes none of that: it is the note that a manager acted on
 * a lapse, which is why it is a command and not a job. Nothing schedules
 * it.
 *
 * copy_id AND hold_expires_at ARE LEFT WHERE THEY STAND, the
 * CancelOwnRequest precedent exactly (that command sets status and
 * cancelled_at, releases the copy through a guarded UPDATE, and never
 * touches copy_id). Two reasons, and the second is load-bearing for
 * another file:
 *   - the row is the record of which copy was put aside for whom, and how
 *     long the reader had; blanking either erases it.
 *   - HandoverRequest's `RequestStatus::Expired → hold_expired` branch
 *     sits ONE LINE BELOW its `copy_id === null → request_not_held`
 *     check. A null here would make that earlier check fire first, the
 *     branch would go dead in production, and the volunteer holding a
 *     stale queue page would be told "Yêu cầu này không có bản sách nào
 *     đang được giữ chỗ" about a row that plainly names a copy.
 *     ReleaseExpiredHoldTest runs the two commands in sequence rather
 *     than writing the status by hand, so that stays falsifiable.
 *
 * Lock order: copy first (an approved row always names one; the
 * snapshot's copy_id is an in-memory attribute, so reading it issues no
 * query), request second — Task 5's order exactly. ApproveBorrowRequest
 * (the copy lockForUpdate that opens its transaction, then the request
 * lockForUpdate below it) and LendCopy (its copy lock, then the guarded
 * `->update([...])` that closes the collected hold inside its
 * borrow_requests write) take the same two rows in the same order, so
 * nothing in that trio disagrees about direction, an AB-BA needing two
 * orders. NO LINE NUMBERS: this round's own edits moved the LendCopy
 * statement three citations were pointing at, which is the counts problem
 * one level down — cite the symbol, which grep finds and no edit invalidates.
 *
 * The one shipped counterparty that CAN take them the other way round is
 * CancelOwnRequest's documented residual window — request first, copy
 * second, and only while its route-bound snapshot named no copy, i.e.
 * while the row was still pending. No deadlock-freedom claim is made
 * either way here and none was measured (a two-connection race cannot run
 * under RefreshDatabase, 1a divergence 2); what the two files' shapes do
 * say is that reaching it against THIS command means holding that window
 * open across the shelf's whole hold period rather than the microseconds a
 * request spends between its binding and its transaction, because this
 * command refuses until the approval that wrote copy_id has itself lapsed.
 * Task 8's edge against LendCopy is the one already recorded in
 * divergence 1, and it is not this one.
 *
 * THE HANDOVER RACE, stated as the write it is. HandoverRequest's
 * pre-flight reads run outside any transaction (divergence 11), and its
 * promise that such a race yields "a stale sentence … never a wrong
 * write" was WITHDRAWN at Task 9. If this command commits inside that
 * window, the copy is `available` and the request `expired` by the time
 * LendCopy takes its locks: the live-hold probe finds nothing, and
 * LendCopy writes an ORDINARY WALK-UP LOAN of that copy to the reader
 * standing at the table, closing nobody's request. Right copy, right
 * reader, no other reader's turn taken — not a defect, and nothing here
 * changes because of it — but it is a write, and this docblock says so
 * rather than repeating the withdrawn promise. Read from the two files'
 * shapes: a two-connection race cannot run under RefreshDatabase (1a
 * divergence 2).
 *
 * That variant is STRICTLY NARROWER than the cancel-driven one it
 * otherwise resembles, and saying "identical outcome" without saying so
 * would overstate it: a cancel can commit anywhere in that window, while
 * a release can only commit there if the expiry INSTANT also falls inside
 * it — the handover's own fresh read refuses with hold_expired for any
 * hold already lapsed when it looked, so the hold must lapse between that
 * read and this command's guard.
 *
 * No notification: BR §15 lists no lapsed-hold event, and the child was
 * told the deadline in the approval's own notification (OPS §7).
 */
final class ReleaseExpiredHold
{
    public function __construct(
        private Clock $clock,
        private AuditRecorder $audit,
    ) {}

    /** @return array{requestId: string, copyId: string} */
    public function execute(User $actor, BorrowRequest $request): array
    {
        Gate::forUser($actor)->authorize('release', $request);

        $snapshotCopyId = $request->copy_id;   // in-memory attribute; no query

        return DB::transaction(function () use ($request, $snapshotCopyId): array {
            // FIRST statement — see the class docblock. A snapshot with no
            // copy is not a shape this command can act on at all, so the
            // null case locks nothing and falls into request_not_held
            // below rather than issuing find(null).
            $copy = $snapshotCopyId === null
                ? null
                : BookCopy::query()->lockForUpdate()->find($snapshotCopyId);
            $request = BorrowRequest::query()->lockForUpdate()->findOrFail($request->id);

            // ONE code for every "there is no hold here": a decided row, a
            // row whose copy went away, and a snapshot that named a
            // different copy than the locked row does. The manager's
            // screen offers this button on no such row, and OPS §4.2's
            // sentence is the one a stale page deserves.
            if ($request->status !== RequestStatus::Approved
                || $request->copy_id === null
                || $copy === null
                || $copy->id !== $request->copy_id) {
                throw new RuleViolated('request_not_held');
            }
            // A null expiry on an approved row is a state
            // ApproveBorrowRequest never writes (it sets copy_id and
            // hold_expires_at in one update); refused rather than read as
            // a hold that never ends.
            if ($request->hold_expires_at === null || $request->hold_expires_at > $this->clock->now()) {
                throw new RuleViolated('hold_not_expired');
            }

            $title = (string) Book::query()->whereKey($request->book_id)->value('title');

            // Status alone. copy_id and hold_expires_at stay — the
            // docblock's second reason is another command's live branch.
            $request->update(['status' => RequestStatus::Expired]);

            // Guarded like the cancel's release, in the WHERE itself: a
            // copy that has since been lost, retired or lent is left
            // alone, and zero affected rows is a legitimate outcome. The
            // audit row below is written either way — the hold lapsed
            // whatever became of the copy, and that is what this entry
            // records.
            BookCopy::query()->whereKey($copy->id)
                ->where('state', CopyState::Held)
                ->update(['state' => CopyState::Available]);

            $this->audit->record('request.expired', 'request', $request->id,
                ['status' => 'approved', 'copy_id' => $copy->id],
                [
                    'status' => 'expired',
                    'copy_id' => $copy->id,
                    // The phrase names the reader, not the book (ruling
                    // 1's worked example), so the title is here for the
                    // expansion's payload rows: a manager reading the log
                    // needs to know which book went back on the shelf.
                    'title' => $title,
                    // A users(id) — member_id's name says membership, its
                    // FK says otherwise; stored under userId, the subject
                    // join's key (AuditLogQuery's payload_subject arm).
                    'userId' => $request->member_id,
                ]);

            return ['requestId' => $request->id, 'copyId' => $copy->id];
        });
    }
}
