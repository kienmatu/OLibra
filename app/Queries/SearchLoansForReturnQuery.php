<?php

namespace App\Queries;

use App\Enums\LoanStatus;
use App\Models\Loan;
use App\Support\Catalogue\CopyCodes;
use App\Support\Circulation\LoanTerms;
use App\Support\Clock;
use App\Support\Fold;
use Illuminate\Database\Eloquent\Builder;

/**
 * Return step 1 — port of search-loans-for-return.ts. Three search keys:
 * title, borrower name, and the code printed on the copy in the
 * volunteer's hand — the key the shelf actually uses (a title matches as
 * many rows as copies out; the code matches exactly one).
 *
 * Active rows only: the explicit filter is what makes this "out right
 * now", and what keeps an already-returned loan off the screen so a
 * double submit cannot be aimed at it (the command refuses one anyway —
 * this is the screen not offering what the command would refuse).
 *
 * The borrower's name joins users directly, never memberships: a reader
 * who has since left still holds the book, and that is exactly the loan a
 * manager most needs to find. isOverdue/daysRemaining come from LoanTerms
 * (BR §8's one home), so a fixed clock moves both with no write.
 *
 * Folded match on `books.title_folded`/`users.full_name_folded` (the
 * accent- and case-insensitive columns), never `full_name_ci` — this is a
 * search box, not an identity comparison. The copy code has no folded
 * column: it is plain ASCII assigned by CopyCodes, and `UPPER(...) LIKE
 * UPPER(...)` (never a plain LIKE) is what matching it needs —
 * `book_copies.code` is declared `utf8mb4_bin` (2026_08_26_000006, so the
 * shelf's own generated key column can hash it byte-for-byte), which
 * makes a bare LIKE case-sensitive. The reference's `olibra_fold(c.code)`
 * (Postgres, case-insensitive collation) has no exact MariaDB analogue
 * for a bin column; UPPER-on-both-sides gets the same "dt-0142",
 * "DT-0142", "Dt-0142" all matching without folding away the hyphen the
 * printed label carries.
 *
 * No hand-written `bookshelf_id` predicate: Loan's BookshelfScope filters
 * the base table, and books/book_copies/users are reached only through
 * this shelf's loans' FKs (the composite tenant FKs make a cross-shelf
 * reference unstorable) — the same reach 1b's holding-count query makes.
 */
final class SearchLoansForReturnQuery
{
    public function __construct(private Clock $clock) {}

    /** @return list<array<string, mixed>> */
    public function run(string $q): array
    {
        $folded = Fold::fold($q);
        if ($folded === '') {
            return [];
        }
        $code = mb_strtoupper(CopyCodes::escapeLike(trim($q)));
        $today = $this->clock->today();

        $loans = Loan::query()
            ->where('status', LoanStatus::Active)
            ->join('books', 'books.id', '=', 'loans.book_id')
            ->join('book_copies', 'book_copies.id', '=', 'loans.copy_id')
            ->join('users', 'users.id', '=', 'loans.borrower_id')
            ->where(fn (Builder $w) => $w
                ->where('books.title_folded', 'like', '%'.$folded.'%')
                ->orWhere('users.full_name_folded', 'like', '%'.$folded.'%')
                ->orWhereRaw('UPPER(book_copies.code) like ?', ['%'.$code.'%']))
            ->orderBy('loans.due_on')->orderBy('loans.id')
            ->select('loans.*', 'books.title', 'books.cover_url', 'book_copies.code as copy_code', 'users.full_name as borrower_name')
            ->get();

        return array_values($loans->map(function (Loan $loan) use ($today): array {
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
                'dueOn' => $dueOn,
                'isOverdue' => LoanTerms::isOverdue($dueOn, $today),
                'daysRemaining' => LoanTerms::daysRemaining($dueOn, $today),
            ];
        })->values()->all());
    }
}
