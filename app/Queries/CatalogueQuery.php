<?php

namespace App\Queries;

use App\Models\Book;
use App\Queries\Concerns\CountsCopies;
use Illuminate\Database\Eloquent\Builder;

/**
 * GetCatalogue (OPS §3.2) — the reader's browse. Port of get-catalogue.ts:
 * published, live titles; scope=available keeps only titles with a
 * borrowable copy (the same predicate the counts use, so the toggle and
 * the badge can never disagree); sort by folded title or recency, slug
 * closing the order into a total one (IMPORTANT 5 — see BooksListQuery).
 */
final class CatalogueQuery
{
    use CountsCopies;

    /**
     * @param  array{scope?: string, category?: ?string, sort?: ?string, page?: int, per_page?: int}  $input
     * @return array{rows: list<array<string, mixed>>, page: int, pageCount: int, total: int}
     */
    public function run(array $input): array
    {
        $query = $this->withCopyCounts(Book::query())
            ->where('is_published', true)
            ->with('category:id,name,slug')
            ->when($input['category'] ?? null, fn (Builder $b, string $slug) => $b
                ->whereHas('category', fn (Builder $c) => $c->where('slug', $slug)))
            ->when(($input['scope'] ?? 'available') === 'available', fn (Builder $b) => $b
                ->whereHas('copies', $this->borrowable()));

        // The reference's three-key order under both sorts — see
        // BooksListQuery's twin comment; slug makes it total.
        if (($input['sort'] ?? 'recent') === 'title') {
            $query->orderBy('title_folded');
        }
        $query->orderByDesc('created_at')->orderBy('slug');

        $paginator = $query->paginate(
            perPage: min(100, max(1, (int) ($input['per_page'] ?? 24))),
            page: max(1, (int) ($input['page'] ?? 1)),
        );

        return [
            'rows' => array_values(collect($paginator->items())->map(fn (Book $book) => $this->row($book))->all()),
            'page' => $paginator->currentPage(),
            'pageCount' => max(1, $paginator->lastPage()),
            'total' => $paginator->total(),
        ];
    }

    /**
     * The CatalogueRow shape SearchQuery shares.
     *
     * @return array<string, mixed>
     */
    public function row(Book $book): array
    {
        return [
            'bookId' => $book->id,
            'slug' => $book->slug,
            'title' => $book->title,
            'author' => $book->author,
            'coverUrl' => $book->cover_url,
            'category' => $book->category?->name,
            'copiesTotal' => (int) $book->getAttribute('copies_total'),
            'copiesAvailable' => (int) $book->getAttribute('available_count'),
            'availability' => $this->availabilityFor($book),
        ];
    }
}
