<?php

namespace App\Queries;

use App\Enums\CopyState;
use App\Models\Book;
use App\Models\ConditionAssessment;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\User;
use App\Queries\Concerns\CountsCopies;
use App\Support\Circulation\LoanTerms;
use App\Support\Clock;

/**
 * GetBookDetail, manager flavour (OPS §3.3) — port of
 * get-book-detail-manager.ts: the list row for one book, EVERY copy
 * (retired included, with reason — a reader's page hides those, a
 * manager's shows them), the condition-assessment history (BR §11: never
 * deleted) and the loan history — keyed by loans.book_id rather than
 * through the copy, precisely so it survives the copy being retired.
 *
 * The donor resolves through membership → user (a membership carries no
 * name of its own), straight to users rather than requiring a live
 * membership: a donor who has since left the shelf still gave the book.
 */
final class ManagerBookDetailQuery
{
    use CountsCopies;

    public function __construct(private Clock $clock) {}

    /** @return array{book: array<string, mixed>, onLoan: int, copies: list<array<string, mixed>>, conditionHistory: list<array<string, mixed>>, loanHistory: list<array<string, mixed>>} */
    public function run(Book $book): array
    {
        $withCounts = $this->withCopyCounts(Book::query())
            ->with('category:id,name,slug')
            ->findOrFail($book->id);

        $copies = $book->copies()->orderBy('code')->get();

        // The active loan per copy — at most one, by loans_one_active_per_copy.
        $activeLoans = Loan::query()
            ->whereIn('copy_id', $copies->pluck('id'))
            ->where('status', 'active')
            ->get()
            ->keyBy('copy_id');

        $borrowers = User::query()
            ->whereIn('id', $activeLoans->pluck('borrower_id'))
            ->get(['id', 'full_name'])
            ->keyBy('id');

        // Donor memberships → users, one query each. withTrashed on the
        // membership: BR §11 lets a membership be soft-deleted, and a
        // donor who left is still the donor.
        $donorMemberships = Membership::query()
            ->withTrashed()
            ->whereIn('id', $copies->pluck('acquired_from_membership_id')->filter())
            ->get()
            ->keyBy('id');
        $donorUsers = User::query()
            ->whereIn('id', $donorMemberships->pluck('user_id'))
            ->get(['id', 'full_name'])
            ->keyBy('id');

        $today = $this->clock->today();

        $copyRows = $copies->map(function ($copy) use ($activeLoans, $borrowers, $donorMemberships, $donorUsers, $today) {
            $loan = $activeLoans->get($copy->id);
            $donorMembership = $copy->acquired_from_membership_id !== null
                ? $donorMemberships->get($copy->acquired_from_membership_id)
                : null;

            return [
                'copyId' => $copy->id,
                'code' => $copy->code,
                'state' => $copy->state->value,
                'condition' => $copy->condition->value,
                'conditionNote' => $copy->condition_note,
                'acquiredOn' => $copy->acquired_on?->toDateString(),
                'acquiredFrom' => $copy->acquired_from,
                'acquiredFromMembershipId' => $copy->acquired_from_membership_id,
                'acquiredFromMembershipName' => $donorMembership !== null
                    ? $donorUsers->get($donorMembership->user_id)?->full_name
                    : null,
                'activeLoanId' => $loan?->id,
                'holderName' => $loan !== null ? $borrowers->get($loan->borrower_id)?->full_name : null,
                // due_on is NOT NULL — a nullsafe on it is itself a level-8
                // error; only the loan may be absent.
                'dueOn' => $loan !== null ? $loan->due_on->toDateString() : null,
                'isOverdue' => $loan !== null && LoanTerms::isOverdue($loan->due_on->toDateString(), $today),
                'lostReportedAt' => $copy->lost_reported_at?->toIso8601String(),
                'retiredAt' => $copy->retired_at?->toIso8601String(),
                'retiredReason' => $copy->retired_reason,
            ];
        });

        // withTrashed: BR §11 lists assessments under NEVER deleted, and a
        // soft-deleted copy's assessments are still this title's history —
        // the same reach $historyCodes below already makes for loan rows.
        $conditionHistory = ConditionAssessment::query()
            ->whereIn('copy_id', $book->copies()->withTrashed()->pluck('id'))
            ->orderByDesc('assessed_at')
            ->get();
        $assessors = User::query()
            ->whereIn('id', $conditionHistory->pluck('assessed_by'))
            ->get(['id', 'full_name'])
            ->keyBy('id');
        $codesById = $book->copies()->withTrashed()->pluck('code', 'id');

        $loanHistory = Loan::query()
            ->where('book_id', $book->id)
            ->orderByDesc('lent_at')
            ->get();
        $historyBorrowers = User::query()
            ->whereIn('id', $loanHistory->pluck('borrower_id'))
            ->get(['id', 'full_name'])
            ->keyBy('id');
        // History may reference a soft-deleted copy — read codes withTrashed.
        $historyCodes = $book->copies()->withTrashed()->pluck('code', 'id');

        return [
            'book' => [
                'bookId' => $withCounts->id,
                'slug' => $withCounts->slug,
                'title' => $withCounts->title,
                'author' => $withCounts->author,
                'coverUrl' => $withCounts->cover_url,
                'category' => $withCounts->category?->name,
                'copiesTotal' => (int) $withCounts->getAttribute('copies_total'),
                'copiesAvailable' => (int) $withCounts->getAttribute('available_count'),
                'availability' => $this->availabilityFor($withCounts),
                'isPublished' => $withCounts->is_published,
                'codes' => $this->codesFor($withCounts),
            ],
            'onLoan' => $copies->filter(fn ($c) => $c->state === CopyState::OnLoan)->count(),
            'copies' => array_values($copyRows->all()),
            'conditionHistory' => array_values($conditionHistory->map(fn (ConditionAssessment $row) => [
                'assessedAt' => $row->assessed_at->toIso8601String(),
                'copyCode' => $codesById->get($row->copy_id),
                'assessorName' => $assessors->get($row->assessed_by)?->full_name,
                'condition' => $row->condition->value,
                'note' => $row->note,
            ])->all()),
            'loanHistory' => array_values($loanHistory->map(fn (Loan $row) => [
                'loanId' => $row->id,
                'copyCode' => $historyCodes->get($row->copy_id),
                'borrowerName' => $historyBorrowers->get($row->borrower_id)?->full_name,
                'lentAt' => $row->lent_at->toIso8601String(),
                'returnedAt' => $row->returned_at?->toIso8601String(),
                'status' => $row->status->value,
                'returnCondition' => $row->return_condition?->value,
            ])->all()),
        ];
    }
}
