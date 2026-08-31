<?php

namespace App\Queries\Labels;

use App\Models\BookCopy;

/**
 * Expands a manager's QR label selection into the flat list of copies to
 * print. bookIds and copyIds are a UNION, not alternatives — OPS §3.3,
 * opened: "so a manager may tick a whole title and individual copies of
 * another; expansion happens here, not in the browser, where the answer
 * would be whatever the page was rendered with." A copy reachable through
 * both a ticked title and its own id appears once, never twice.
 *
 * TENANCY IS BookshelfScope's, on BookCopy. No bookshelf_id is written
 * here. ids arrive from a FORM, so a hand-made POST naming another
 * shelf's book or copy id must expand to nothing rather than to that
 * shelf's copies.
 *
 * THE BOOK IS EAGER-LOADED THROUGH with('book'), NOT JOINED — the same
 * trade TitlesForLabelsQuery's docblock records, staying out of the
 * blind spot tests/Feature/Architecture/TenancyArchitectureTest's filter
 * grep documents (lines 145 and 182) for a join() condition naming
 * bookshelf_id.
 *
 * whereHas('book') excludes a copy orphaned by a soft-deleted book — a
 * copy is not itself deleted when its book is, so without this a copy
 * with a null book would survive the read.
 *
 * THE GROUPING MATTERS: the union predicate is wrapped in its own
 * where(fn ($q) => ...) so that ->when($onlyUnprinted, ...) ANDs against
 * the whole union rather than only its second half. An ungrouped
 * ->whereIn(...)->orWhereIn(...) sitting next to the onlyUnprinted
 * condition changes boolean precedence and quietly returns printed
 * copies reachable through copyIds.
 *
 * An empty selection returns [] before any query runs — a query built
 * from a false predicate is not the same guarantee as never asking.
 */
final class CopiesForLabelsQuery
{
    /**
     * @param  list<string>  $bookIds
     * @param  list<string>  $copyIds
     * @return list<array{copyId: string, code: string, title: string, printCount: int}>
     */
    public function run(array $bookIds, array $copyIds, bool $onlyUnprinted = false): array
    {
        if ($bookIds === [] && $copyIds === []) {
            return [];
        }

        $copies = BookCopy::query()
            ->whereHas('book')
            ->with('book')
            ->where(fn ($q) => $q->whereIn('book_id', $bookIds)->orWhereIn('id', $copyIds))
            ->when($onlyUnprinted, fn ($q) => $q->where('qr_print_count', 0))
            ->orderBy('code')
            ->get();

        $rows = $copies->map(fn (BookCopy $copy): array => [
            'copyId' => $copy->id,
            'code' => $copy->code,
            'title' => (string) $copy->book?->title,
            'printCount' => (int) $copy->qr_print_count,
        ]);

        // array_values is a level-8 requirement rather than belt and
        // braces: ->values()->all() gives PHPStan array<int, ...>, not
        // list<...>.
        return array_values($rows->all());
    }
}
