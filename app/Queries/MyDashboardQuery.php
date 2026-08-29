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
 * OPS §3.2's GetMyDashboard — BR §16.2's "My page". renewBlockedBy is
 * LoanRules::loanRenewable's answer, the ONE predicate RenewLoan applies,
 * so the disabled button and the command can never disagree
 * (my-dashboard.test.ts: "the renew refusal is the code renewLoan throws
 * — not a literal"). The requests half landed in 2a — own pending|approved
 * rows, queuePosition the identical derivation BookDetailQuery::run's
 * myRequest uses, so the two surfaces cannot disagree about the same row;
 * both diverge from the manager's own ROW_NUMBER the same documented way
 * (see the comment beside `queuePosition` below).
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

    /** @return array{loans: list<array<string, mixed>>, recentlyReturned: list<array<string, mixed>>, requests: list<array<string, mixed>>} */
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

        $mine = BorrowRequest::query()
            ->where('member_id', $reader->id)
            ->whereIn('status', [RequestStatus::Pending, RequestStatus::Approved])
            ->join('books', 'books.id', '=', 'borrow_requests.book_id')
            ->orderBy('borrow_requests.requested_at')->orderBy('borrow_requests.id')
            ->select('borrow_requests.*', 'books.title', 'books.slug')
            ->get();

        $requests = array_values($mine->map(function (BorrowRequest $r): array {
            $ahead = $r->status === RequestStatus::Pending
                ? BorrowRequest::query()
                    ->where('book_id', $r->book_id)
                    ->where('status', RequestStatus::Pending)
                    ->where(function ($q) use ($r) {
                        $q->where('requested_at', '<', $r->requested_at)
                            ->orWhere(fn ($qq) => $qq->where('requested_at', $r->requested_at)->where('id', '<', $r->id));
                    })
                    ->count()
                : null;

            return [
                'requestId' => $r->id,
                'bookId' => $r->book_id,
                'slug' => (string) $r->getAttribute('slug'),
                'title' => (string) $r->getAttribute('title'),
                'status' => $r->status->value,
                // Derived on read, PENDING rows ahead only — the identical
                // computation to BookDetailQuery::run's myRequest
                // (BookDetailQuery.php:89-113), so this surface and that
                // one agree on the same row. Both diverge from the
                // manager's own ROW_NUMBER, which partitions over pending
                // AND approved (BorrowRequestQueueQuery.php:173-184's twin
                // comment) — recorded there and on BookDetailQuery, not
                // restated a third way here.
                'queuePosition' => $ahead === null ? null : $ahead + 1,
                'holdExpiresAt' => $r->hold_expires_at?->toISOString(),
            ];
        })->all());

        return ['loans' => $loans, 'recentlyReturned' => $recentlyReturned, 'requests' => $requests];
    }
}
