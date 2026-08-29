<?php

namespace App\Actions\Circulation;

use App\Enums\CopyState;
use App\Enums\LoanStatus;
use App\Enums\RequestStatus;
use App\Exceptions\RuleViolated;
use App\Models\BookCopy;
use App\Models\BorrowRequest;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\Circulation\LendingSettings;
use App\Support\Circulation\LoanRules;
use App\Support\Circulation\LoanTerms;
use App\Support\Clock;
use App\Support\TenantContext;
use App\Support\UniqueViolation;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * Hands a copy to a reader — the quick-lend terminal step (BR §16.3, OPS
 * §5) and the most important command in the application. Port of
 * lend-copy.ts; read that file's docblock before changing the order here.
 *
 * The two-part shape is deliberate and neither part is redundant:
 *
 *   1. Locked re-reads + pure predicates, for the COMMON case — the kind,
 *      named sentence BR §16.3 requires ("Bạn đọc đã mượn tối đa…").
 *   2. The INSERT, judged by loans_one_active_per_copy, for the case BR §2
 *      describes: two managers, two phones, the same second. Only the
 *      index closes that window (INV-1); the losing 1062 is translated,
 *      never prevented.
 *
 * Lock order (plan divergence 1): copy FIRST — the transaction's first
 * statement, before anything reads — then membership. Under REPEATABLE
 * READ the read view pins at the first consistent read, so the plain
 * loan-count below is taken only after both locks: any rival lend for the
 * same copy waits on the copy lock, any rival lend for the same READER
 * waits on the membership lock — which is what makes the INV-5 count
 * accurate while we hold it (divergence 3; the reference had no such
 * serialisation and its count could race past the limit).
 *
 * borrower_id / lent_by are users(id), never membership ids — the input is
 * a Membership because that is what the screen has (OPS §4.2), and
 * $membership->user_id is resolved exactly once, below.
 *
 * The held-for-me clause (INV-3's second half) went live here in Phase 2a,
 * which wired the real holder through the same LoanRules predicate that 1c
 * could only ever hand a null: the live hold on the copy is read after both
 * locks, through the expiry filter, so a lapsed hold arrives as absence.
 * The same task re-added the reference's collected-hold close — when the
 * hold is this reader's own, loans.request_id names it, the request moves
 * approved → fulfilled with fulfilled_loan_id set, and request.fulfilled is
 * audited: all in the SAME transaction as the loan, so the lend and the
 * close commit together or neither does.
 *
 * @return array{loanId: string, dueOn: string}
 */
final class LendCopy
{
    public function __construct(
        private Clock $clock,
        private AuditRecorder $audit,
        private TenantContext $tenant,
    ) {}

    /** @return array{loanId: string, dueOn: string} */
    public function execute(User $actor, BookCopy $copy, Membership $membership): array
    {
        Gate::forUser($actor)->authorize('lend', $copy->loans()->make());

        return DB::transaction(function () use ($actor, $copy, $membership): array {
            // FIRST statement — see the class docblock.
            $copy = BookCopy::query()->lockForUpdate()->findOrFail($copy->id);
            // SECOND — serialises this reader's lends for the INV-5 count.
            $membership = Membership::query()->lockForUpdate()->findOrFail($membership->id);

            // The live hold on this copy, if any — a query issued AFTER
            // both locks, never before them, and through the expiry filter
            // so a lapsed hold arrives as absence (the convention
            // copyLendable is written against: expiry presents as a null
            // holder, and no reader matches null).
            //
            // requested_at asc, id asc, and NOT the inert ordering Task 5
            // dropped from ApproveBorrowRequest's probe: that one asks
            // only whether a live hold exists, so which row answers cannot
            // change it. This one's row decides two things — whether the
            // predicate below lets the lend through, and what
            // loans.request_id ends up naming — so limit 1 over an
            // unordered set would be whatever the plan happened to produce
            // (the reference's own note on its lateral join). Two live
            // holds on one copy cannot arise through shipped commands
            // (ApproveBorrowRequest refuses a copy that already carries
            // one — its "an AVAILABLE copy under a live hold is refused"
            // test), so this is determinism, not a queue rule.
            //
            // The instant comes from the injected Clock, never a bare
            // wall-clock read — CirculationArchitectureTest greps this
            // file's RAW source for one, comments included, so the
            // sanctioned door is named without its parentheses in prose
            // (measured: the first spelling of this very comment reddened
            // that test).
            $hold = BorrowRequest::query()
                ->where('copy_id', $copy->id)
                ->where('status', RequestStatus::Approved)
                ->where('hold_expires_at', '>', $this->clock->now())
                ->orderBy('requested_at')->orderBy('id')
                ->first();

            // OPS §5's order: copy-side refusals first — "a manager who
            // searched for a book that's already gone needs to know that
            // immediately, not after they've also picked a reader."
            if (($code = LoanRules::copyLendable($copy->state, $hold?->member_id, $membership->user_id)) !== null) {
                throw new RuleViolated($code);
            }

            // The hold this lend collects, or null when the copy was
            // simply available. BOTH halves are required: a live hold
            // names this copy, AND it is this reader's — closing somebody
            // else's would take a child's turn away, the one thing worse
            // than leaving the row open. An available copy under another
            // reader's live hold is still lendable (the predicate's
            // available branch does not look at holds, ported whole), and
            // this is the line that keeps such a lend from closing their
            // request.
            $collectedHoldId = ($hold !== null && $hold->member_id === $membership->user_id)
                ? $hold->id
                : null;

            $shelf = $this->tenant->bookshelf();
            if ($shelf === null) {
                throw new RuleViolated('shelf_not_found');
            }
            $settings = LendingSettings::fromShelf($shelf);

            // Counted at write time, after both locks — never a value read
            // earlier in the flow (OPS §5 step 5). BookshelfScope makes
            // this the PER-SHELF count BR §5.5 specifies.
            $activeLoans = Loan::query()
                ->where('borrower_id', $membership->user_id)
                ->where('status', LoanStatus::Active)
                ->count();

            if (($code = LoanRules::memberMayBorrow($membership->status, $activeLoans, $settings->maxConcurrentLoans)) !== null) {
                throw new RuleViolated($code);
            }

            $dueOn = LoanTerms::dueDateFor($this->clock->today(), $settings->loanDays);

            try {
                $loan = Loan::query()->create([
                    'copy_id' => $copy->id,
                    'book_id' => $copy->book_id,
                    'borrower_id' => $membership->user_id,
                    'lent_by' => $actor->id,
                    'lent_at' => $this->clock->now(),
                    'due_on' => $dueOn,
                    'status' => LoanStatus::Active,
                    'request_id' => $collectedHoldId,
                ]);
            } catch (QueryException $e) {
                // INV-1's loser. Matched by constraint name so an unrelated
                // 1062 is never dressed up as the wrong refusal; anything
                // else rethrows untouched.
                UniqueViolation::translate($e, ['loans_one_active_per_copy' => 'copy_not_available']);
            }

            $stateBefore = $copy->state->value;
            $copy->update(['state' => CopyState::OnLoan]);

            if ($collectedHoldId !== null) {
                // fulfilled, from BR §7.2's pending → approved → fulfilled
                // — the only one of request_status's six that means the
                // reader got the book (expired says the hold lapsed,
                // cancelled that they withdrew; both describe a child who
                // went home empty-handed).
                //
                // hold_expires_at is left where it stands: the record of a
                // deadline this reader MET. hold_expires_at has exactly
                // three readers under app/ and every one of them filters
                // on status = approved first — the probe above,
                // ApproveBorrowRequest:133 and CountsCopies::borrowable
                // (grepped, not assumed) — so a fulfilled row's expiry is
                // inert rather than stale, and blanking it would erase how
                // long they had.
                //
                // Guarded on the status, in the WHERE itself
                // (CancelOwnRequest's idiom): a request that is no longer
                // approved when this statement runs is left alone rather
                // than overwritten, and zero affected rows is a legitimate
                // outcome, not an error. Unlike that command's release,
                // nothing here derives an answer from the affected-row
                // count — $collectedHoldId already came from a row read
                // inside this transaction, under its copy lock.
                //
                // CancelOwnRequest is the only shipped command that can
                // move an approved row anywhere else (RejectBorrowRequest
                // refuses anything but pending; nothing writes 'expired'
                // at all — grepped), and its own docblock records the
                // residual window where it takes the request lock before
                // the copy's. No claim about which of the two wins is made
                // here either way; the guard is what makes losing safe.
                BorrowRequest::query()
                    ->whereKey($collectedHoldId)
                    ->where('status', RequestStatus::Approved)
                    ->update(['status' => RequestStatus::Fulfilled, 'fulfilled_loan_id' => $loan->id]);
            }

            $this->audit->record('loan.created', 'loan', $loan->id,
                // The state this copy was ACTUALLY in, read before the
                // update above. Not the literal 'available' 1c could write
                // safely: since the held-for-me clause went live, a
                // collected hold reaches here from held.
                ['copy_state' => $stateBefore],
                [
                    'copy_state' => 'on_loan',
                    // Both ids — they answer different questions six months
                    // later: borrower_id is what the row holds and every
                    // join keys on; membership_id is what the manager
                    // picked and the only shelf-specific one of the two.
                    'borrower_id' => $membership->user_id,
                    'membership_id' => $membership->id,
                    'due_on' => $dueOn,
                    // The title AS IT IS NOW, stored: an audit sentence
                    // that re-read books.title would restate history the
                    // moment UpdateBook corrects a title.
                    'title' => $copy->book?->title,
                    // Null = a walk-up lend; the collected hold's id when
                    // this lend came out of a queue. An auditor can tell
                    // the two apart without joining anything.
                    'request_id' => $collectedHoldId,
                ]);

            if ($collectedHoldId !== null) {
                $this->audit->record('request.fulfilled', 'request', $collectedHoldId,
                    ['status' => 'approved', 'copy_id' => $copy->id, 'fulfilled_loan_id' => null],
                    ['status' => 'fulfilled', 'copy_id' => $copy->id, 'fulfilled_loan_id' => $loan->id]);
            }

            return ['loanId' => $loan->id, 'dueOn' => $dueOn];
        });
    }
}
