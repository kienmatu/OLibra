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
 * OPS §3.3's GetManagerDashboard — port of get-manager-dashboard.ts.
 * Four counts and four totals, and the four counts are the NUMBERS
 * behind BR §16.3's four stat cards: overdue and pendingRegistrations
 * from the foundation, pendingRequests from Phase 2a, and
 * pendingComments from Phase 2b's CommentModerationQuery.
 *
 * A NUMBER IS NOT A CARD, and plan divergence 6 was about cards. That
 * divergence is DISCHARGED as of Task 8, the commit that ships
 * /manage/comments: resources/js/pages/manage/dashboard.tsx — opened
 * while rewriting this paragraph — now declares four counts in its page
 * props and renders four StatCards, the fourth being Bình luận chờ duyệt
 * linked to that screen. The reason the card waited is worth keeping,
 * because it is the reason it could not have shipped earlier: a card over
 * an under-construction link is the "no comments waiting" lie the
 * reference removed. This paragraph used to say the card "is not on the
 * screen yet" and that the divergence "stays open"; both sentences went
 * false in the same commit that made this one true.
 *
 * Every figure is a count() at query time over BelongsToBookshelf-scoped
 * models — never a stored counter (BR §8; OPS §3.3's own words: "a
 * counter can drift"), and each is counted THE WAY ITS LIST IS SELECTED:
 *
 * - overdue mirrors OverdueLoansQuery (status active AND due_on <
 *   Clock::today() — LoanTerms::isOverdue's comparison, the one home of
 *   overdue); ManagerDashboardQueryTest pins the agreement.
 * - pendingRequests DELEGATES to BorrowRequestQueueQuery::countWaiting()
 *   rather than restating its where-clauses — the mirror rule the
 *   overdue card already follows, so the card and the screen it links
 *   to cannot drift apart the way two independent counts could.
 * - pendingComments DELEGATES to CommentModerationQuery::countPending(),
 *   the same rule pendingRequests already follows and for the same
 *   reason: this number and the moderation screen's queue read one
 *   definition of "pending" rather than two that merely agree today.
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
    public function __construct(
        private Clock $clock,
        private BorrowRequestQueueQuery $queue,
        private CommentModerationQuery $comments,
    ) {}

    /** @return array{counts: array{overdue: int, pendingRegistrations: int, pendingRequests: int, pendingComments: int}, totals: array{titles: int, copies: int, onLoan: int, readers: int}} */
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
                // Delegated, not restated — the card and the screen it
                // links to cannot drift; the mirror rule the overdue
                // card already follows.
                'pendingRequests' => $this->queue->countWaiting(),
                // Same delegation, same reason — the moderation
                // screen's queue and this number read one definition of
                // "pending".
                'pendingComments' => $this->comments->countPending(),
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
