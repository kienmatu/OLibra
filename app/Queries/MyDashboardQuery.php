<?php

namespace App\Queries;

use App\Enums\LoanStatus;
use App\Enums\RequestStatus;
use App\Exceptions\RuleViolated;
use App\Models\BorrowRequest;
use App\Models\Loan;
use App\Models\User;
use App\Support\Circulation\LendingSettings;
use App\Support\Circulation\LoanRules;
use App\Support\Circulation\LoanTerms;
use App\Support\Clock;
use App\Support\TenantContext;

/**
 * The loans half of OPS §3.2's GetMyDashboard — BR §16.2's "My page".
 * renewBlockedBy is LoanRules::loanRenewable's answer, the ONE predicate
 * RenewLoan applies, so the disabled button and the command can never
 * disagree (my-dashboard.test.ts: "the renew refusal is the code renewLoan
 * throws — not a literal"). The requests half is Phase 2's; the page
 * renders an explicit empty state meanwhile (plan open question 5).
 *
 * This is the screen where a second subtraction is most tempting — the
 * due date is right there. Both derived numbers come from LoanTerms.
 */
final class MyDashboardQuery
{
    public function __construct(
        private Clock $clock,
        private TenantContext $tenant,
    ) {}

    /** @return array{loans: list<array<string, mixed>>, recentlyReturned: list<array<string, mixed>>} */
    public function run(User $reader): array
    {
        $today = $this->clock->today();
        $shelf = $this->tenant->bookshelf();
        if ($shelf === null) {
            // `use App\Exceptions\RuleViolated;` at the top and the SHORT
            // form here (review fix): RuleViolatedCodesHaveSentencesTest's
            // regex is /new RuleViolated\(\s*['"]…['"]\s*\)/ and does not
            // match a fully-qualified `new \App\Exceptions\RuleViolated(…)`,
            // so the fully-qualified spelling would silently sit outside
            // the census the whole phase depends on. Task 14 forbids
            // widening that regex; write the code so it does not need to.
            throw new RuleViolated('shelf_not_found');
        }
        $settings = LendingSettings::fromShelf($shelf);

        $active = Loan::query()
            ->where('borrower_id', $reader->id)
            ->where('status', LoanStatus::Active)
            ->join('books', 'books.id', '=', 'loans.book_id')
            ->join('book_copies', 'book_copies.id', '=', 'loans.copy_id')
            ->orderBy('loans.due_on')->orderBy('loans.id')
            ->select('loans.*', 'books.title', 'books.slug', 'books.cover_url', 'book_copies.code as copy_code')
            ->get();

        $queuedBookIds = BorrowRequest::query()
            ->whereIn('book_id', $active->pluck('book_id'))
            ->where('status', RequestStatus::Pending)
            ->pluck('book_id')->unique()->flip();

        $loans = array_values($active->map(function (Loan $loan) use ($today, $settings, $queuedBookIds): array {
            $dueOn = $loan->due_on->toDateString();

            return [
                'loanId' => $loan->id,
                'bookId' => $loan->book_id,
                'slug' => (string) $loan->getAttribute('slug'),
                'title' => (string) $loan->getAttribute('title'),
                'coverUrl' => $loan->getAttribute('cover_url'),
                'copyCode' => (string) $loan->getAttribute('copy_code'),
                'dueOn' => $dueOn,
                'isOverdue' => LoanTerms::isOverdue($dueOn, $today),
                'daysRemaining' => LoanTerms::daysRemaining($dueOn, $today),
                'renewalsUsed' => $loan->renewals_used,
                'renewBlockedBy' => LoanRules::loanRenewable(
                    $loan->renewals_used, $settings->maxRenewals,
                    $queuedBookIds->has($loan->book_id),
                ),
            ];
        })->values()->all());

        $recentlyReturned = array_values(Loan::query()
            ->where('borrower_id', $reader->id)
            ->where('status', LoanStatus::Returned)
            ->join('books', 'books.id', '=', 'loans.book_id')
            ->orderByDesc('loans.returned_at')->orderByDesc('loans.id')
            ->limit(5)
            ->select('loans.*', 'books.title', 'books.slug')
            ->get()
            ->map(function (Loan $loan): array {
                $returnCondition = $loan->return_condition;

                return [
                    'loanId' => $loan->id,
                    'title' => (string) $loan->getAttribute('title'),
                    'slug' => (string) $loan->getAttribute('slug'),
                    'returnedOn' => $loan->returned_at?->timezone('Asia/Ho_Chi_Minh')->toDateString() ?? '',
                    'returnCondition' => $returnCondition !== null ? $returnCondition->value : '',
                ];
            })->values()->all());

        return ['loans' => $loans, 'recentlyReturned' => $recentlyReturned];
    }
}
