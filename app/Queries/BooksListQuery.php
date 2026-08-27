<?php

namespace App\Queries;

use App\Models\Book;
use App\Queries\Concerns\CountsCopies;
use App\Support\Fold;
use Illuminate\Database\Eloquent\Builder;

/**
 * GetBooksList (OPS §3.3) — getCatalogue with a manager's eyes: NO
 * is_published filter (a draft is exactly what this list exists to find),
 * and each row carries the shelf-mark range a volunteer reads off the
 * spines. Port of get-books-list.ts.
 *
 * Sort ends on slug, ALWAYS: created_at is one instant for every book of
 * a bulk load, LIMIT/OFFSET over a non-total order pages rows in and out
 * of existence (IMPORTANT 5 — measured 231 unique of 300 in the
 * reference), and a manager paging for the draft they just created can
 * page past it without it ever appearing.
 */
final class BooksListQuery
{
    use CountsCopies;

    /**
     * @param  array{q?: ?string, category?: ?string, sort?: ?string, page?: int, per_page?: int}  $input
     * @return array{rows: list<array<string, mixed>>, page: int, pageCount: int, total: int}
     */
    public function run(array $input): array
    {
        $q = trim((string) ($input['q'] ?? ''));
        $folded = Fold::fold($q);

        if ($q !== '' && $folded === '') {
            // M7: a punctuation-only query folds to '' — the LIKE pattern
            // would degenerate to '%%' and match the whole shelf. A
            // garbage query behaves like a blank one that matched nothing.
            return ['rows' => [], 'page' => 1, 'pageCount' => 1, 'total' => 0];
        }

        $query = $this->withCopyCounts(Book::query())
            ->with('category:id,name,slug')
            ->when($input['category'] ?? null, fn (Builder $b, string $slug) => $b
                ->whereHas('category', fn (Builder $c) => $c->where('slug', $slug)))
            ->when($q !== '', fn (Builder $b) => $b->where(fn (Builder $w) => $w
                ->where('title_folded', 'like', '%'.$folded.'%')
                ->orWhere('author_folded', 'like', '%'.$folded.'%')));

        // The reference's three-key order, kept whole under BOTH sorts:
        // fold(title) leads only under sort=title, created_at desc and
        // slug always follow — slug is what makes the order total
        // (IMPORTANT 5); never remove it.
        if (($input['sort'] ?? 'recent') === 'title') {
            $query->orderBy('title_folded');
        }
        $query->orderByDesc('created_at')->orderBy('slug');

        $paginator = $query->paginate(
            perPage: min(100, max(1, (int) ($input['per_page'] ?? 24))),
            page: max(1, (int) ($input['page'] ?? 1)),
        );

        return [
            'rows' => array_values(collect($paginator->items())->map(fn (Book $book) => [
                'bookId' => $book->id,
                'slug' => $book->slug,
                'title' => $book->title,
                'author' => $book->author,
                'coverUrl' => $book->cover_url,
                'category' => $book->category?->name,
                'copiesTotal' => (int) $book->getAttribute('copies_total'),
                'copiesAvailable' => (int) $book->getAttribute('available_count'),
                'availability' => $this->availabilityFor($book),
                'isPublished' => $book->is_published,
                'codes' => $this->codesFor($book),
            ])->all()),
            'page' => $paginator->currentPage(),
            'pageCount' => max(1, $paginator->lastPage()),
            'total' => $paginator->total(),
        ];
    }
}
