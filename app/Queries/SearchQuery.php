<?php

namespace App\Queries;

use App\Models\Book;
use App\Queries\Concerns\CountsCopies;
use App\Support\Fold;
use Illuminate\Database\Eloquent\Builder;

/**
 * SearchCatalogue (OPS §3.2) — diacritic- and case-insensitive substring
 * search over title and author (BR §12). Port of search-catalogue.ts.
 *
 * The term is folded by Fold::fold — the SAME table the stored generated
 * columns were frozen from, with FoldParityTest holding the treaty — so
 * both sides of the comparison go through one implementation and BR §12's
 * "the two can never drift" stays structural. LIKE '%…%', not anything
 * cleverer: at a few hundred books per shelf nothing more is warranted
 * (DB §8's own accounting, restated by spec §4's index note).
 *
 * M7: a term that folds to '' (a lone %, underscores…) would degenerate
 * the pattern to '%%' and match every row — a garbage query behaves like
 * a blank one. Ordered folded-title then slug: two titles can fold alike
 * ("Dế Mèn" / "De Men"), and a list that reorders them between renders is
 * a list nobody can scan.
 */
final class SearchQuery
{
    use CountsCopies;

    public function __construct(private CatalogueQuery $catalogue) {}

    /** @return list<array<string, mixed>> */
    public function run(string $q): array
    {
        if (trim($q) === '') {
            return [];
        }

        $folded = Fold::fold($q);

        if ($folded === '') {
            return [];
        }

        return array_values($this->withCopyCounts(Book::query())
            ->where('is_published', true)
            ->with('category:id,name,slug')
            ->where(fn (Builder $w) => $w
                ->where('title_folded', 'like', '%'.$folded.'%')
                ->orWhere('author_folded', 'like', '%'.$folded.'%'))
            ->orderBy('title_folded')
            ->orderBy('slug')
            ->get()
            ->map(fn (Book $book) => $this->catalogue->row($book))
            ->all());
    }
}
