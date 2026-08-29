<?php

namespace App\Queries;

use App\Enums\LoanStatus;
use App\Models\Loan;
use App\Support\Circulation\LoanTerms;
use App\Support\Clock;

/**
 * OPS §3.3's GetOverdueLoans — port of get-overdue-loans.ts. The phone
 * number is the actual mechanism by which books come back (BR §16.3), so
 * it rides every row, null when absent rather than omitted.
 *
 * Overdue is LoanTerms::isOverdue against Clock::today() — derived on
 * read, never stored (BR §8): the where clause below compares due_on to
 * today's DATE, so the set moves at midnight Asia/Ho_Chi_Minh with no job
 * running. Only active loans: a returned loan was late once, not overdue;
 * a lost loan has its own screen (the 1a lost-copies view).
 *
 * Unpaged, deliberately — the set is bounded by its own state (the
 * reference's argument, kept), and the order is total so paging later is
 * two lines, not a re-derivation.
 */
final class OverdueLoansQuery
{
    public function __construct(private Clock $clock) {}

    /** @return list<array<string, mixed>> */
    public function run(string $sort = 'most-late'): array
    {
        $today = $this->clock->today();

        $query = Loan::query()
            ->where('status', LoanStatus::Active)
            // Plain `where`, not `whereDate`: due_on IS a DATE column, so
            // whereDate would wrap it in DATE(due_on) and make the
            // loans_active_by_shelf index (leading shelf FK, then due_on)
            // unusable for nothing (review fix). Bare `<` against a Y-m-d
            // string is also literally LoanTerms::isOverdue's comparison,
            // which is the "one definition of overdue" this class claims.
            ->where('loans.due_on', '<', $today)
            ->join('books', 'books.id', '=', 'loans.book_id')
            ->join('book_copies', 'book_copies.id', '=', 'loans.copy_id')
            ->join('users', 'users.id', '=', 'loans.borrower_id')
            ->select('loans.*', 'books.title', 'books.cover_url',
                'book_copies.code as copy_code',
                'users.full_name as borrower_name', 'users.phone as borrower_phone',
                'users.full_name_folded as borrower_name_folded');

        match ($sort) {
            'least-late' => $query->orderByDesc('loans.due_on'),
            'borrower' => $query->orderBy('borrower_name_folded'),
            default => $query->orderBy('loans.due_on'),
        };
        $query->orderBy('loans.id');

        return array_values($query->get()->map(function (Loan $loan) use ($today): array {
            $dueOn = $loan->due_on->toDateString();

            return [
                'loanId' => $loan->id,
                'copyId' => $loan->copy_id,
                'copyCode' => (string) $loan->getAttribute('copy_code'),
                'bookId' => $loan->book_id,
                'title' => (string) $loan->getAttribute('title'),
                'coverUrl' => $loan->getAttribute('cover_url'),
                'borrowerUserId' => $loan->borrower_id,
                'borrowerName' => (string) $loan->getAttribute('borrower_name'),
                'borrowerPhone' => $loan->getAttribute('borrower_phone'),
                'dueOn' => $dueOn,
                'daysLate' => -LoanTerms::daysRemaining($dueOn, $today),
            ];
        })->values()->all());
    }
}
