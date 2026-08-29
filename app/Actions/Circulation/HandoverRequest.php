<?php

namespace App\Actions\Circulation;

use App\Enums\RequestStatus;
use App\Exceptions\RuleViolated;
use App\Models\BookCopy;
use App\Models\BorrowRequest;
use App\Models\Membership;
use App\Models\User;
use App\Support\Clock;
use Illuminate\Support\Facades\Gate;

/**
 * The manager hands a child the copy their approved request put aside —
 * BR §7.1's held → on_loan and §7.2's approved → fulfilled, at the
 * moment the book actually changes hands. Port of handover-request.ts.
 *
 * DELEGATES to LendCopy instead of restating it (the reference's whole
 * argument): OPS §5 defines this command as LendCopy with one
 * substitution — the copy must be held FOR THIS READER (INV-3's second
 * clause) — plus the hold-not-expired check. LendCopy's locked hold read
 * and copyLendable already perform the substituted step, and it already
 * closes the collected hold (request.fulfilled beside loan.created).
 * There is no second definition of who may take a held copy to drift.
 *
 * The pre-flight reads below run OUTSIDE any transaction (plan
 * divergence 11): they choose the KIND sentence — hold_expired names the
 * remedy where copy_not_available would be a false statement about a
 * book on the shelf; request_not_held covers a stale queue page's
 * pending/rejected/cancelled/fulfilled row. Every fact that decides
 * whether the book may MOVE is re-established on LOCKED rows one call
 * later, inside LendCopy's transaction, whose first statement is the
 * copy lock: the copy's state, whose live hold it carries (the same
 * ordered read through the same expiry filter) and this reader's status
 * and active-loan count. What a race between the two costs is therefore
 * a sentence, not a row. A hold cancelled in the microseconds between is
 * refused down there as copy_not_available while the copy is still held,
 * or — CancelOwnRequest having released it to available in the same
 * breath — lent to the reader standing at the table as an ordinary
 * walk-up lend that closes nobody's request; a holder whose membership is
 * soft-deleted in that window meets LendCopy's findOrFail and becomes a
 * 404 rather than request_not_held. The reference's own reads were
 * equally unlocked, and none of these outcomes writes against another
 * reader's row. Read from the two files' shapes, not measured: a
 * two-connection race cannot run under RefreshDatabase (1a divergence 2).
 *
 * Taking a borrow_requests lock here first, to close that window, would
 * invert divergence 1's copy-then-request order and manufacture an AB-BA
 * cycle against LendCopy itself. CirculationArchitectureTest's lock
 * grep-pin records this file's absence from its list for that reason.
 *
 * The first-hold check: LendCopy collects the EARLIEST live approved
 * hold on the copy; here the request is the input, so this command
 * checks the hold LendCopy will find is the one it was asked about and
 * refuses with request_not_held when it is not. Two live approved holds
 * on one copy is a state ApproveBorrowRequest's lock prevents and no
 * constraint enforces, so the test constructs it directly.
 *
 * What that check buys HERE is the sentence, not the safety, and the
 * reference's argument for it does not port. It said that without the
 * check "this command would silently hand the book to the right person
 * and close somebody else's row"; in this build it cannot, because Task
 * 8's LendCopy only collects a hold whose member_id is the borrowing
 * reader's own — an earlier hold belonging to someone else makes
 * copyLendable answer copy_not_available and nothing is written at all.
 * Measured by deleting these lines and running the file: exactly one
 * test reddens ("the handover fulfils the request it was asked about"),
 * and it reddens on the CODE — copy_not_available where request_not_held
 * was expected — never on a closed row. The check stays for that code:
 * "Bản sách này đang được mượn hoặc đang giữ chỗ" tells a volunteer
 * holding a live approved request nothing they can act on.
 *
 * No notification: "your book is ready" was the APPROVAL's (OPS §7), and
 * no audit row of its own either — the pair this command produces is
 * LendCopy's, written under LendCopy's transaction.
 */
final class HandoverRequest
{
    public function __construct(
        private Clock $clock,
        private LendCopy $lendCopy,
    ) {}

    /** @return array{loanId: string, dueOn: string} */
    public function execute(User $actor, BorrowRequest $request): array
    {
        Gate::forUser($actor)->authorize('handover', $request);

        // Fresh read, not the route-bound snapshot — these are courtesy
        // checks and should at least start from the latest committed row.
        // BookshelfScope and SoftDeletes are on this query, so another
        // shelf's request and an undone one are both a 404 here, before
        // any sentence below can describe them.
        $request = BorrowRequest::query()->findOrFail($request->id);

        // One code for "no such request", "another shelf's" (scope) and
        // "nothing held" — a manager's screen never offers this button on
        // any of those rows, and telling them apart would confirm the
        // other shelf's request exists.
        if ($request->copy_id === null) {
            throw new RuleViolated('request_not_held');
        }
        if ($request->status === RequestStatus::Expired) {
            // REACHABLE, not defensive. ReleaseExpiredHold (product-owner
            // ruling 1) is the one writer of `expired`, and a manager who
            // releases a lapsed hold while a volunteer's queue page still
            // shows its handover button produces exactly this row. It
            // takes its own branch rather than falling through to the
            // status check below because request_not_held would be a false
            // statement about a row that plainly names a copy —
            // hold_expired names the remedy instead. HandoverRequestTest
            // pins it by name.
            throw new RuleViolated('hold_expired');
        }
        if ($request->status !== RequestStatus::Approved) {
            throw new RuleViolated('request_not_held');
        }
        // The instant comes from the injected Clock, never a bare
        // wall-clock read (CirculationArchitectureTest greps this file's
        // RAW source, comments included, so the banned spelling is not
        // written out here). <=, so that the boundary instant is lapsed,
        // matching LendCopy's strict `>` filter exactly: a hold either
        // command would call dead cannot be alive for the other. A null
        // expiry on an approved row should not exist and is refused
        // rather than treated as live.
        if ($request->hold_expires_at === null || $request->hold_expires_at <= $this->clock->now()) {
            throw new RuleViolated('hold_expired');
        }

        // This shelf's membership for the holder — member_id is a
        // users(id); LendCopy's input is a Membership, which is what this
        // lookup exists to produce. The scope comes from the query, never
        // from an id anybody sent. Soft-deleted rows are excluded by the
        // model's own trait: a holder who left has no membership to lend
        // to, and refusing here keeps LendCopy's input honest instead of
        // passing null onward.
        $membership = Membership::query()->where('user_id', $request->member_id)->first();
        if ($membership === null) {
            throw new RuleViolated('request_not_held');
        }

        // The hold LendCopy is about to collect, resolved by the same
        // ordered read — see the class docblock.
        $firstHold = BorrowRequest::query()
            ->where('copy_id', $request->copy_id)
            ->where('status', RequestStatus::Approved)
            ->where('hold_expires_at', '>', $this->clock->now())
            ->orderBy('requested_at')->orderBy('id')
            ->value('id');
        if ($firstHold !== $request->id) {
            throw new RuleViolated('request_not_held');
        }

        $copy = BookCopy::query()->findOrFail($request->copy_id);

        // INV-1..5, 7, both audit rows, the fulfilled close — the one
        // implementation, under its own locks.
        return $this->lendCopy->execute($actor, $copy, $membership);
    }
}
