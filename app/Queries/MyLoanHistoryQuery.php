<?php

namespace App\Queries;

use App\Models\Loan;
use App\Models\User;

/**
 * OPS §3.2's GetMyLoanHistory: every loan the reader ever had on this
 * shelf, reverse-chronological by lent_at with the id tiebreak (a total
 * order, so pages never lose a row between them — the paging lesson U2
 * measured). The return condition rides the row: the history is where a
 * reader sees how their book came back.
 */
final class MyLoanHistoryQuery
{
    private const PER_PAGE = 20;

    /** @return array{rows: list<array<string, mixed>>, page: int, pageCount: int, total: int} */
    public function run(User $reader, int $page = 1): array
    {
        $page = max(1, $page);
        $base = Loan::query()
            ->where('borrower_id', $reader->id)
            ->join('books', 'books.id', '=', 'loans.book_id')
            ->join('book_copies', 'book_copies.id', '=', 'loans.copy_id');

        $total = (clone $base)->count();
        $rows = array_values($base
            ->orderByDesc('loans.lent_at')->orderByDesc('loans.id')
            ->forPage($page, self::PER_PAGE)
            ->select('loans.*', 'books.title', 'books.slug', 'book_copies.code as copy_code')
            ->get()
            ->map(fn (Loan $loan): array => [
                'loanId' => $loan->id,
                'title' => (string) $loan->getAttribute('title'),
                'slug' => (string) $loan->getAttribute('slug'),
                'copyCode' => (string) $loan->getAttribute('copy_code'),
                'lentOn' => $loan->lent_at->timezone('Asia/Ho_Chi_Minh')->toDateString(),
                'dueOn' => $loan->due_on->toDateString(),
                'status' => $loan->status->value,
                'returnedOn' => $loan->returned_at?->timezone('Asia/Ho_Chi_Minh')->toDateString(),
                'returnCondition' => $loan->return_condition?->value,
            ])->values()->all());

        return [
            'rows' => $rows,
            'page' => $page,
            'pageCount' => (int) max(1, ceil($total / self::PER_PAGE)),
            'total' => $total,
        ];
    }
}
