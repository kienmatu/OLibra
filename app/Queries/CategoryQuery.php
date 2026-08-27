<?php

namespace App\Queries;

use App\Models\Book;
use App\Models\Category;
use App\Support\Fold;
use Illuminate\Database\Eloquent\Builder;

/**
 * The two category lists, ported from old_next/src/lib/catalogue.ts —
 * kept in one class so the difference between them stays readable:
 *
 * stockedByShelf() answers the FILTER question — which categories does
 * this shelf actually stock — by going through Book (shelf-scoped by the
 * global scope, so the join is what makes the list this shelf's, not a
 * where clause anybody has to remember). Offering a parish eleven filters
 * that return nothing and one that works is the defect it exists to avoid.
 *
 * allOptions() answers the CREATE-FORM question — every category a book
 * may be catalogued INTO. Mixing the two would be a real defect: a create
 * form restricted to stocked categories can never reach the category a
 * shelf's first book of a new kind belongs to.
 */
final class CategoryQuery
{
    /** @return list<array{slug: string, name: string}> */
    public function stockedByShelf(bool $includeDrafts = false): array
    {
        $categoryIds = Book::query()
            ->when(! $includeDrafts, fn (Builder $q) => $q->where('is_published', true))
            ->whereNotNull('category_id')
            ->distinct()
            ->pluck('category_id');

        $categories = Category::query()
            ->whereIn('id', $categoryIds)
            ->get(['slug', 'name', 'sort_order']);

        return $this->sorted($categories->all());
    }

    /** @return list<array{slug: string, name: string}> */
    public function allOptions(): array
    {
        return $this->sorted(Category::query()->get(['slug', 'name', 'sort_order'])->all());
    }

    /**
     * sort_order, then FOLDED name: under any byte-ordered collation a
     * plain name sort puts 'Đời sống đức tin' after every unaccented
     * category (Đ begins 0xC4). Folding in PHP keeps BR §12's one-fold
     * rule — six rows do not need a SQL expression that could drift.
     *
     * @param  array<int, Category>  $categories
     * @return list<array{slug: string, name: string}>
     */
    private function sorted(array $categories): array
    {
        $categories = array_values($categories);

        usort($categories, fn (Category $x, Category $y) => [$x->sort_order, Fold::fold($x->name)]
            <=> [$y->sort_order, Fold::fold($y->name)]);

        return array_map(
            fn (Category $c) => ['slug' => $c->slug, 'name' => $c->name],
            $categories,
        );
    }
}
