<?php

namespace App\Actions\Circulation;

use App\Enums\LoanStatus;
use App\Enums\RequestStatus;
use App\Exceptions\RuleViolated;
use App\Models\BorrowRequest;
use App\Models\Loan;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\Circulation\LendingSettings;
use App\Support\Circulation\LoanRules;
use App\Support\Circulation\LoanTerms;
use App\Support\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * A reader extends their own loan — port of renew-loan.ts, reached from BR
 * §16.2's "Xin gia hạn".
 *
 * INV-6 has two halves and an arithmetic. The halves are LoanRules::
 * loanRenewable's (one predicate, shared with the dashboard so screen and
 * command cannot disagree). The arithmetic is LoanTerms::renewedDueDate on
 * the LOCKED row's due_on — from the current due date, never today
 * (divergence 5: PHP on a locked row replaces the reference's SQL, same
 * race-freedom, and the overdue-renewal test pins the property).
 *
 * The queue is checked on the TITLE (book_id), not the copy — a waiting
 * reader does not care which copy they get — and on status pending only:
 * an approved request already holds a specific copy and is not waiting on
 * this loan. Soft-deleted requests are excluded by the model's own scope
 * (BorrowRequest uses SoftDeletes; no ->withTrashed() here).
 *
 * The renewals-remaining check runs BEFORE the queue's exists() query, not
 * after — 2026-08-29 fix round: the exists() query used to always run,
 * even when LoanRules::loanRenewable would refuse on renewals_used alone,
 * which is one wasted query held inside the row lock for every
 * already-exhausted renewal attempt. Refusal precedence (renewals before
 * queue — see LoanRules::loanRenewable's own docblock) is unchanged; only
 * the query is now skipped on that path.
 *
 * Q4 (open question 1) is CLOSED, not open: membership status DOES gate
 * renewal, same as every other reader ability — 2026-08-29 product-owner
 * ruling. See LoanPolicy::renew()'s docblock for why the reference's
 * requireReader looking status-blind is not evidence for the other
 * reading, and docs/known-gaps.md for the accepted limitation.
 *
 * Ownership folds into loan_not_active — OPS §4.2 lists no loan_not_found
 * and no not_your_loan; distinguishing them would confirm the loan exists.
 * borrower_id is a users(id): the comparison is against $actor->id, never
 * a membership id.
 *
 * @return array{dueOn: string, renewalsUsed: int}
 */
final class RenewLoan
{
    public function __construct(
        private AuditRecorder $audit,
        private TenantContext $tenant,
    ) {}

    /** @return array{dueOn: string, renewalsUsed: int} */
    public function execute(User $actor, Loan $loan): array
    {
        Gate::forUser($actor)->authorize('renew', $loan);

        return DB::transaction(function () use ($actor, $loan): array {
            // FIRST statement — the only lock this command takes.
            $loan = Loan::query()->lockForUpdate()->findOrFail($loan->id);

            if ($loan->status !== LoanStatus::Active || $loan->borrower_id !== $actor->id) {
                throw new RuleViolated('loan_not_active');
            }

            $shelf = $this->tenant->bookshelf();
            if ($shelf === null) {
                throw new RuleViolated('shelf_not_found');
            }
            $settings = LendingSettings::fromShelf($shelf);

            // Renewals-remaining first, and on its own — short-circuits
            // before the queue query below when it is already the refusal,
            // so an exhausted renewal never pays for a wasted exists().
            if ($loan->renewals_used >= $settings->maxRenewals) {
                throw new RuleViolated('no_renewals_remaining');
            }

            $titleHasQueue = BorrowRequest::query()
                ->where('book_id', $loan->book_id)
                ->where('status', RequestStatus::Pending)
                ->exists();

            if (($code = LoanRules::loanRenewable($loan->renewals_used, $settings->maxRenewals, $titleHasQueue)) !== null) {
                throw new RuleViolated($code);
            }

            $before = ['due_on' => $loan->due_on->toDateString(), 'renewals_used' => $loan->renewals_used];
            $dueOn = LoanTerms::renewedDueDate($before['due_on'], $settings->renewalDays);

            $loan->update(['due_on' => $dueOn, 'renewals_used' => $loan->renewals_used + 1]);

            $this->audit->record('loan.renewed', 'loan', $loan->id,
                $before,
                ['due_on' => $dueOn, 'renewals_used' => $loan->renewals_used]);

            return ['dueOn' => $dueOn, 'renewalsUsed' => $loan->renewals_used];
        });
    }
}
