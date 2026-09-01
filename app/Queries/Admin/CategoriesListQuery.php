<?php

namespace App\Queries\Admin;

use App\Models\Book;
use App\Models\Category;
use App\Support\TenantContext;

/**
 * `/admin/categories`' own read, spec D3 — every live genre with the number
 * of books still on it. Port of the reference's `getCategoriesAdmin`
 * (old_next/src/domain/catalogue/queries/get-categories-admin.ts).
 *
 * **THE COUNT IS THE POINT, not decoration.** `ArchiveCategory` refuses a
 * genre that still has books, so without the number beside each row the
 * screen can only teach that rule by producing the refusal: a volunteer
 * would press Lưu trữ, be told no, and still not know how many books to move
 * or whether the next genre down has the same problem. With it, the refusal
 * is explained before it can happen — the reference's own reason for
 * carrying `bookCount` on this row and nowhere else.
 *
 * **WHY THIS IS A QUERY AND NOT A CONTROLLER METHOD, and the answer is the
 * books rather than the genres.** `Category` carries no
 * `BelongsToBookshelf` — one taxonomy for the whole installation — so
 * reading the genres from the tenant-less `/admin` group needs nothing
 * special. `Book` does carry it, and the `/admin` group binds no tenant by
 * design (spec D0), so counting books across every shelf is a cross-shelf
 * read: `BookshelfScope` would throw. Widening is the sanctioned way past
 * that, and `WideningArchitectureTest` confines it to `app/Queries/Admin/`
 * and `app/Actions/Admin/`. Only the count is inside the callback, because
 * only the count needs to be.
 *
 * **LIVE BOOKS ONLY** — `Book` soft-deletes, and the default scope already
 * drops the deleted ones, which is the same predicate
 * `ArchiveCategory`'s guard uses (`books.deleted_at is null` in the
 * reference). A genre whose only book is in the bin is not in use by
 * anything a reader or a manager can still see, and the two halves must
 * agree or the screen promises an archive the command then refuses.
 *
 * **ARCHIVED GENRES ARE NOT LISTED.** `Category` soft-deletes too, so its
 * default scope drops them: the screen offers no un-archive, because there
 * is no command behind one — the reference gives this slice none, and the
 * way back is a new name (spec D3, and `CreateCategory` on why the old slug
 * is held forever).
 *
 * Ordered by `sort_order` then `name`, the reference's own ordering, so the
 * screen and the book form's picker list the genres in one order.
 */
final class CategoriesListQuery
{
    public function __construct(
        private TenantContext $context,
    ) {}

    /**
     * @return list<array{id: string, name: string, slug: string, bookCount: int}>
     */
    public function run(): array
    {
        $categories = Category::query()
            ->orderBy('sort_order')
            ->orderBy('name')
            ->orderBy('id')
            ->get();

        $counts = $this->bookCountsByCategory();

        /** @var list<array{id: string, name: string, slug: string, bookCount: int}> $rows */
        $rows = [];

        foreach ($categories as $category) {
            $rows[] = [
                'id' => $category->id,
                'name' => $category->name,
                'slug' => $category->slug,
                'bookCount' => $counts[$category->id] ?? 0,
            ];
        }

        return $rows;
    }

    /**
     * One grouped count across every shelf, not a count per row: the number
     * of genres is small and unbounded queries in a loop is how a screen
     * that reads fine on a developer's machine crawls on a real one.
     *
     * @return array<string, int>
     */
    private function bookCountsByCategory(): array
    {
        return $this->context->systemWide(function (): array {
            /** @var array<string, int> $counts */
            $counts = Book::query()
                ->whereNotNull('category_id')
                ->selectRaw('category_id, count(*) as aggregate')
                ->groupBy('category_id')
                ->pluck('aggregate', 'category_id')
                ->map(fn ($count): int => (int) $count)
                ->all();

            return $counts;
        });
    }
}
