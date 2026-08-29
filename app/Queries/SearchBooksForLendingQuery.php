<?php

namespace App\Queries;

use App\Enums\CopyState;
use App\Models\Book;
use App\Queries\Concerns\CountsCopies;
use App\Support\Catalogue\CopyCodes;
use App\Support\Fold;
use Illuminate\Database\Eloquent\Builder;

/**
 * Quick-lend step 1 — port of search-books-for-lending.ts. Drafts are
 * included (a manager may lend an unannounced title); the blocked flag
 * carries the SAME code LendCopy throws, so the screen refuses before the
 * confirm step for the reason the command would refuse after it (BR §16.3).
 *
 * The reason mapping is the aggregate's honest translation of the per-copy
 * rule, in three branches:
 *   - no copy recorded at all      → title_has_no_copies
 *   - copies recorded, none can come back (available/on_loan/held are the
 *     returnable states)           → copy_lost_or_retired
 *   - otherwise                    → copy_not_available
 * The first branch diverges from the reference, which folded it into
 * copy_not_available and so told a volunteer a copyless title was "đang
 * được mượn hoặc đang giữ chỗ." — false. The product owner ruled that out
 * (plan settled decision 4). The reference's reason for folding was that
 * step 1 and step 3 must not disagree; that still holds, and is honoured
 * by ChooseCopy::lowestLendable carrying THIS SAME three-way branch (Task
 * 10). If you change one, change the other in the same commit, or BR
 * §16.3's "the block is stated before the confirm step" becomes a lie.
 *
 * Blocked rows are returned, never filtered — including the copyless
 * title. A row that says why is an answer; a missing row is a second
 * search.
 *
 * The copy-code branch matches with an EXISTS, never a WHERE on the
 * aggregate join: narrowing the counted rows by the matched code would
 * report copiesTotal 1 for a three-copy book (the reference's T27 fix).
 *
 * The code comparison is `UPPER(...)  LIKE UPPER(...)`, not a plain LIKE:
 * `book_copies.code` is declared `utf8mb4_bin` (2026_08_26_000006, so a
 * shelf's own generated key column can hash it byte-for-byte), which makes
 * a bare LIKE case-SENSITIVE — a volunteer typing "dt-0102" for a label
 * printed "DT-0102" would get nothing. The reference's `ilike` had no such
 * problem (Postgres `ilike` is always case-insensitive); this is the
 * MariaDB-specific fix that keeps the same behaviour.
 */
final class SearchBooksForLendingQuery
{
    use CountsCopies;

    /** @return list<array<string, mixed>> */
    public function run(string $q): array
    {
        $folded = Fold::fold($q);
        if ($folded === '') {
            return [];
        }
        $code = mb_strtoupper(CopyCodes::escapeLike(trim($q)));

        $books = $this->withCopyCounts(Book::query())
            ->withCount([
                'copies as copies_returnable' => fn (Builder $b) => $b->whereIn('state', [CopyState::Available, CopyState::OnLoan, CopyState::Held]),
                'copies as copies_recorded' => fn (Builder $b) => $b,
            ])
            ->where(fn (Builder $w) => $w
                ->where('title_folded', 'like', '%'.$folded.'%')
                ->orWhere('author_folded', 'like', '%'.$folded.'%')
                ->orWhereHas('copies', fn (Builder $c) => $c->whereRaw('UPPER(code) like ?', ['%'.$code.'%'])))
            ->orderBy('title_folded')->orderBy('slug')
            ->get();

        return array_values($books->map(function (Book $book): array {
            $available = (int) $book->getAttribute('available_count');
            $returnable = (int) $book->getAttribute('copies_returnable');
            $recorded = (int) $book->getAttribute('copies_recorded');
            $blocked = $available === 0;

            return [
                'bookId' => $book->id,
                'slug' => $book->slug,
                'title' => $book->title,
                'author' => $book->author,
                'coverUrl' => $book->cover_url,
                'copiesTotal' => (int) $book->getAttribute('copies_total'),
                'copiesAvailable' => $available,
                'blocked' => $blocked,
                'reason' => match (true) {
                    ! $blocked => null,
                    $recorded === 0 => 'title_has_no_copies',
                    $returnable === 0 => 'copy_lost_or_retired',
                    default => 'copy_not_available',
                },
            ];
        })->values()->all());
    }
}
