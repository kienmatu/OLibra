<?php

declare(strict_types=1);

namespace App\Queries\Exports;

use App\Models\Loan;

/**
 * OPS §3.3's ExportLoansCSV — every loan the shelf has ever recorded,
 * not the open ones. INV-11 is why "history" is load-bearing: loans are
 * never deleted, so this file is the complete circulation record, and a
 * filter to active would quietly make it something else. Voided rows
 * ride with their reason in the note column — BR §11's "why is there no
 * loan here" must have an answer six months later.
 *
 * lent_by/received_by resolve to names (an id is not readable); unlike
 * an audit sentence this is NOT history restated — loans is an ordinary
 * mutable table and the file describes it as it is now. The user joins
 * hang off loans rows the tenant scope already admitted.
 *
 * Instants render in the shelf's timezone with no offset suffix and no
 * fractional seconds: "2026-08-09 19:00:51", the one form every
 * spreadsheet parses identically (the reference shipped the bare ::text
 * first and a browser download caught 19:00 VN filed under 12:00 UTC —
 * and under the PREVIOUS DAY for anything lent after 5pm local).
 * lent_at/returned_at are cast to Carbon on Loan, so this converts the
 * already-hydrated instant the way MyLoanHistoryQuery does, rather than
 * re-parsing a raw string.
 *
 * Order is newest first — a loan's identity is WHEN, and the volunteer
 * opening this file is looking for last week — with id desc closing the
 * tie two books handed over in one visit create.
 */
final class LoansExportQuery
{
    /** @return list<array<string, mixed>> */
    public function run(): array
    {
        $rows = Loan::query()
            ->join('books', 'books.id', '=', 'loans.book_id')
            ->join('book_copies', 'book_copies.id', '=', 'loans.copy_id')
            ->join('users as borrower', 'borrower.id', '=', 'loans.borrower_id')
            ->leftJoin('users as lender', 'lender.id', '=', 'loans.lent_by')
            ->leftJoin('users as receiver', 'receiver.id', '=', 'loans.received_by')
            ->select('loans.*', 'books.title', 'book_copies.code as copy_code',
                'borrower.full_name as borrower_name',
                'lender.full_name as lender_name', 'receiver.full_name as receiver_name')
            ->orderByDesc('loans.lent_at')
            ->orderByDesc('loans.id')
            ->get();

        return array_values($rows->map(fn (Loan $loan): array => [
            'title' => (string) $loan->getAttribute('title'),
            'copyCode' => (string) $loan->getAttribute('copy_code'),
            'borrowerName' => (string) $loan->getAttribute('borrower_name'),
            'lentOn' => self::instant($loan->lent_at),
            'dueOn' => $loan->due_on->toDateString(),
            'returnedOn' => self::instant($loan->returned_at),
            'status' => $loan->status->value,
            'returnCondition' => $loan->return_condition?->value,
            'lentBy' => $loan->getAttribute('lender_name'),
            'receivedBy' => $loan->getAttribute('receiver_name'),
            // One note column rather than three near-empty ones: a loan
            // carries at most one of these.
            'note' => $loan->return_note ?? $loan->void_reason,
        ])->all());
    }

    private static function instant(mixed $utc): ?string
    {
        return $utc === null ? null
            : $utc->timezone('Asia/Ho_Chi_Minh')->format('Y-m-d H:i:s');
    }
}
