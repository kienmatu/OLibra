<?php

namespace App\Actions\Circulation;

use App\Enums\CopyState;
use App\Enums\LoanStatus;
use App\Exceptions\RuleViolated;
use App\Models\BookCopy;
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
 * The held-for-me clause (INV-3's second half) is live in LoanRules but
 * unreachable here until Phase 2: no hold can exist, so $heldForUserId is
 * passed as null. Phase 2's request commands wire the real holder through
 * the same predicate — and re-add the reference's collected-hold close
 * (request.fulfilled in this same transaction).
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

            // OPS §5's order: copy-side refusals first — "a manager who
            // searched for a book that's already gone needs to know that
            // immediately, not after they've also picked a reader."
            if (($code = LoanRules::copyLendable($copy->state, null, $membership->user_id)) !== null) {
                throw new RuleViolated($code);
            }

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
                ]);
            } catch (QueryException $e) {
                // INV-1's loser. Matched by constraint name so an unrelated
                // 1062 is never dressed up as the wrong refusal; anything
                // else rethrows untouched.
                UniqueViolation::translate($e, ['loans_one_active_per_copy' => 'copy_not_available']);
            }

            $copy->update(['state' => CopyState::OnLoan]);

            $this->audit->record('loan.created', 'loan', $loan->id,
                ['copy_state' => 'available'],
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
                    // Null = a walk-up lend, visibly. Phase 2's collected
                    // hold writes the request id here.
                    'request_id' => null,
                ]);

            return ['loanId' => $loan->id, 'dueOn' => $dueOn];
        });
    }
}
