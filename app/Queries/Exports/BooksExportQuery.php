<?php

declare(strict_types=1);

namespace App\Queries\Exports;

use App\Models\BookCopy;

/**
 * OPS §3.3's ExportBooksCSV — port of exports.ts's exportBooks. One row
 * per COPY, not per title: the file is insurance, and what a volunteer
 * rebuilding this shelf from a spreadsheet needs is every physical book
 * with its code, state and condition — which is also what makes it a
 * stocktaking sheet. Scoping is BookshelfScope's (both models carry the
 * trait); soft-deleted books and copies are excluded by SoftDeletes —
 * this file describes the shelf as it stands.
 *
 * Folded order (title_folded), id tiebreaks throughout: unpaged, so a
 * tie cannot lose a row — but two identical titles swapping places
 * between two exports of the same data is a diff a volunteer cannot
 * explain, and the key costs nothing.
 */
final class BooksExportQuery
{
    /** @return list<array<string, mixed>> */
    public function run(): array
    {
        $rows = BookCopy::query()
            ->join('books', 'books.id', '=', 'book_copies.book_id')
            ->whereNull('books.deleted_at')
            ->leftJoin('categories', function ($join) {
                $join->on('categories.id', '=', 'books.category_id')
                    ->whereNull('categories.deleted_at');
            })
            ->select('book_copies.*', 'books.title', 'books.author', 'books.publisher',
                'books.published_year', 'books.isbn', 'books.page_count', 'books.is_published',
                'categories.name as category_name')
            ->orderBy('books.title_folded')
            ->orderBy('books.id')
            ->orderBy('book_copies.code')
            ->orderBy('book_copies.id')
            ->get();

        return array_values($rows->map(fn (BookCopy $copy): array => [
            'title' => (string) $copy->getAttribute('title'),
            'author' => $copy->getAttribute('author'),
            'category' => $copy->getAttribute('category_name'),
            'publisher' => $copy->getAttribute('publisher'),
            'publishedYear' => $copy->getAttribute('published_year'),
            'isbn' => $copy->getAttribute('isbn'),
            'pageCount' => $copy->getAttribute('page_count'),
            'isPublished' => (bool) $copy->getAttribute('is_published'),
            'copyCode' => $copy->code,
            'state' => $copy->state->value,
            // Not nullable: book_copies.condition defaults to 'perfect'
            // (2026_08_26_..._create_book_copies_table.php:20) — unlike
            // loans.return_condition below, every copy has one.
            'condition' => $copy->condition->value,
            'acquiredOn' => $copy->acquired_on?->toDateString(),
            'acquiredFrom' => $copy->acquired_from,
        ])->all());
    }
}
