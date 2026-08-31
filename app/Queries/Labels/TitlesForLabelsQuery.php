<?php

namespace App\Queries\Labels;

use App\Models\Book;
use App\Models\BookCopy;
use Illuminate\Support\Collection;

/**
 * The manager's QR label selection accordion — one row per title, its
 * copies nested underneath. Port of
 * old_next/src/domain/catalogue/queries/list-titles-for-labels.ts (opened),
 * whose only two predicates are `c.deleted_at is null` and
 * `b.deleted_at is null`, ordered `b.title, c.code`.
 *
 * RETIRED COPIES ARE SELECTABLE. The reference filters on deleted_at only
 * — a retired copy is a physical object still on a shelf somewhere and
 * may still want a sticker, so `state = 'retired'` is not excluded here.
 * Soft-deletion is the only exclusion, and in this port both deleted_at
 * predicates come free from the SoftDeletes global scope on BookCopy and
 * Book — neither is hand-written below.
 *
 * TENANCY IS BookshelfScope's, on BookCopy. No bookshelf_id is written
 * here.
 *
 * THE BOOK IS EAGER-LOADED THROUGH with('book'), NOT JOINED. A join()
 * condition naming bookshelf_id is a documented blind spot of
 * tests/Feature/Architecture/TenancyArchitectureTest's filter grep (lines
 * 145 and 182, opened), the same trade App\Queries\DonationQueueQuery's
 * docblock records staying out of. What the relation costs is a second
 * SELECT instead of one statement; what it buys is staying out of that
 * gap.
 *
 * ORDERING BY THE BOOK'S TITLE THEN THE COPY'S CODE, FROM A QUERY BASED
 * ON BookCopy, CANNOT USE ->orderBy() ON THE EAGER-LOADED RELATION —
 * with('book') issues a second SELECT, so books.title is never in scope
 * for book_copies' own ORDER BY. A correlated subquery keeps the sort in
 * the database instead: `Book::query()->select('title')
 * ->whereColumn('books.id', 'book_copies.book_id')`. That matters because
 * MariaDB's utf8mb4_unicode_ci collation orders "Aó" before "Dế", and
 * PHP's strcmp on raw bytes does not — sorting in PHP instead would make
 * LabelQueriesTest's first block's expectation depend on which layer
 * sorted.
 *
 * GROUPING HAPPENS HERE, NOT ON THE PAGE. OPS §3.3, opened: "Grouped in
 * the query, not on the page, so the 'chưa in nhãn' filter can drop a
 * title whose every copy is already printed rather than render a row
 * that opens onto nothing." $onlyUnprinted filters copies first, then
 * drops any title left with none — never a title rendered with an empty
 * copies array.
 */
final class TitlesForLabelsQuery
{
    /**
     * @return list<array{bookId: string, title: string, copies: list<array{copyId: string, code: string, printCount: int}>}>
     */
    public function run(bool $onlyUnprinted = false): array
    {
        $copies = BookCopy::query()
            // whereHas compiles to a WHERE EXISTS subquery, not a join(),
            // so it stays out of the same blind spot the class docblock
            // names for ->orderBy() below. It is also load-bearing, not
            // redundant with with('book'): a copy whose book has been
            // soft-deleted is not itself deleted, so without this an
            // orphaned copy would survive the read with a null book.
            ->whereHas('book')
            ->with('book')
            ->orderBy(Book::query()->select('title')->whereColumn('books.id', 'book_copies.book_id'))
            ->orderBy('code')
            ->get();

        /** @var Collection<string, Collection<int, BookCopy>> $byBook */
        $byBook = $copies->groupBy('book_id');

        $rows = $byBook->map(function (Collection $bookCopies) use ($onlyUnprinted): ?array {
            $copyRows = $bookCopies
                ->when($onlyUnprinted, fn (Collection $cs) => $cs->filter(
                    fn (BookCopy $copy): bool => (int) $copy->qr_print_count === 0
                ))
                ->map(fn (BookCopy $copy): array => [
                    'copyId' => $copy->id,
                    'code' => $copy->code,
                    'printCount' => (int) $copy->qr_print_count,
                ])
                ->values();

            if ($copyRows->isEmpty()) {
                return null;
            }

            $book = $bookCopies->first()?->book;

            return [
                'bookId' => (string) $book?->id,
                'title' => (string) $book?->title,
                'copies' => array_values($copyRows->all()),
            ];
        })->filter()->values();

        // array_values is a level-8 requirement rather than belt and
        // braces: ->values()->all() gives PHPStan array<int, ...>, not
        // list<...>.
        return array_values($rows->all());
    }
}
