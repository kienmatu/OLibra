<?php

namespace App\Queries;

use App\Enums\CopyState;
use App\Enums\LoanStatus;
use App\Enums\MembershipStatus;
use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Loan;
use App\Models\Membership;
use App\Support\Clock;

/**
 * OPS §3.3's GetManagerDashboard — port of get-manager-dashboard.ts,
 * narrowed to the two of BR §16.3's four stat cards whose queues exist
 * (plan divergence 6: Yêu cầu mượn and Bình luận chờ duyệt are Phase
 * 2's, and no substitute card is promoted into their slots).
 *
 * Every figure is a count() at query time over BelongsToBookshelf-scoped
 * models — never a stored counter (BR §8; OPS §3.3's own words: "a
 * counter can drift"), and each is counted THE WAY ITS LIST IS SELECTED:
 *
 * - overdue mirrors OverdueLoansQuery (status active AND due_on <
 *   Clock::today() — LoanTerms::isOverdue's comparison, the one home of
 *   overdue); ManagerDashboardQueryTest pins the agreement.
 * - pendingRegistrations mirrors PendingRegistrationsQuery (status
 *   pending, whereHas('user') — a soft-deleted identity is no applicant).
 * - readers counts every ACTIVE membership, managers included — the same
 *   population GetReadersList shows once a manager filters that list to
 *   status=active. It is NOT the same as GetReadersList's own default
 *   view: ReadersListQuery::run() applies no status filter unless one is
 *   supplied (app/Queries/ReadersListQuery.php:44-46), so the unfiltered
 *   roster also lists pending and suspended members. This total is a
 *   deliberate choice — the count that agrees with the *active* roster,
 *   because a suspended or still-pending person is not who "readers"
 *   names — not a claim that it equals whatever the list shows with no
 *   filter applied.
 * - copies excludes retired and nothing else: a retired copy has left
 *   the shelf; a lost one has not stopped being the shelf's. titles
 *   counts drafts — the manager's own list shows drafts.
 */
final class ManagerDashboardQuery
{
    public function __construct(private Clock $clock) {}

    /** @return array{counts: array{overdue: int, pendingRegistrations: int}, totals: array{titles: int, copies: int, onLoan: int, readers: int}} */
    public function run(): array
    {
        $today = $this->clock->today();

        return [
            'counts' => [
                'overdue' => Loan::query()
                    ->where('status', LoanStatus::Active)
                    ->where('due_on', '<', $today)
                    ->count(),
                'pendingRegistrations' => Membership::query()
                    ->where('status', MembershipStatus::Pending)
                    ->whereHas('user')
                    ->count(),
            ],
            'totals' => [
                'titles' => Book::query()->count(),
                'copies' => BookCopy::query()->where('state', '!=', CopyState::Retired)->count(),
                'onLoan' => Loan::query()->where('status', LoanStatus::Active)->count(),
                'readers' => Membership::query()
                    ->where('status', MembershipStatus::Active)
                    ->whereHas('user')
                    ->count(),
            ],
        ];
    }
}
