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
 *
 * The select names every loans column this query needs rather than
 * `loans.*`, the same hygiene ReadersExportQuery applies to
 * manager_notes: `loans.*` would hydrate `notes` — a free-text column
 * this codebase creates in migration but no command writes and no
 * screen renders, `manager_notes`'s exact pre-leak status — plus
 * `return_photo_url` and the internal actor/request ids the map below
 * never reads. Naming columns closes that at the query rather than
 * trusting the map alone.
 *
 * FIX ROUND (whole-branch review, finding 3): `return_note` used to be
 * one of the named columns and rode into the `note` cell ahead of
 * `void_reason`. That contradicted BooksExportQuery's own
 * `condition_note` exclusion — ReceiveReturn writes the SAME trimmed
 * string into both `loans.return_note` and `book_copies.condition_note`
 * in one call (its own docblock: "condition_note moves with condition —
 * one judgement"), so exporting one and excluding the other for the
 * identical value made the exclusion arbitrary rather than principled.
 * Resolved by ReadersExportQuery's own stated bound — "a downloadable
 * file is a different distribution surface than a page rendered one
 * record at a time" — applied to its harder case: `condition_note` at
 * least reaches a per-record screen's TypeScript interface (even if
 * unread today; see BooksExportQuery's docblock) and a manager-gated
 * audit expansion (AssessCondition's `conditionNote` in the `after`
 * payload). `return_note` reaches NEITHER — no screen anywhere renders
 * it — so if the harder case is excluded, the easier one cannot be
 * included. `return_note` is dropped from both this select and the
 * `note` map; only `void_reason` remains, which is not a comparable
 * free-text aside but the specific, required-by-BR-§11 explanation for
 * why a loan record exists with no lending in it — "why is there no
 * loan here" needing an answer six months later is precisely the
 * disclosure the export's own reason to exist demands, unlike an
 * optional remark about how damp the book was.
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
            ->select('loans.id', 'loans.status', 'loans.lent_at', 'loans.due_on',
                'loans.returned_at', 'loans.return_condition',
                'loans.void_reason',
                'books.title', 'book_copies.code as copy_code',
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
            // void_reason only — NOT return_note (fix round, finding 3
            // above): a voided loan's reason is BR §11's required "why is
            // there no loan here" answer, not a private free-text remark
            // like return_note/condition_note, which never reach any
            // screen and are excluded here for the same reason
            // BooksExportQuery excludes condition_note.
            'note' => $loan->void_reason,
        ])->all());
    }

    private static function instant(mixed $utc): ?string
    {
        // ->copy() first: Illuminate\Support\Carbon is MUTABLE and
        // ->timezone() shifts and returns $this, so without the copy
        // this permanently rewrites the timezone of the caller's cached
        // `lent_at`/`returned_at` attribute — harmless today only
        // because nothing reads it again in this request, not because
        // the call is side-effect-free.
        return $utc === null ? null
            : $utc->copy()->timezone('Asia/Ho_Chi_Minh')->format('Y-m-d H:i:s');
    }
}
