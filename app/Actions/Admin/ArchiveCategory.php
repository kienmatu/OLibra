<?php

namespace App\Actions\Admin;

use App\Exceptions\RuleViolated;
use App\Models\Book;
use App\Models\Category;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\Clock;
use App\Support\ConcurrencyRetry;
use App\Support\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * Phase 3b-ii Task 3, spec D3 — a genre stops being offered. Port of the
 * reference's `archiveCategory`
 * (old_next/src/domain/catalogue/commands/archive-category.ts).
 *
 * **A SOFT DELETE**, unlike a tủ sách's archive, which is deliberately a
 * status change. A genre has no history of its own to keep — only books that
 * point at it — so `deleted_at` is exactly the right shape: it is what stops
 * `/admin/categories` and the book form's picker from offering the genre
 * without touching a single book.
 *
 * **AND IT IS REFUSED WHILE ANY LIVE BOOK STILL CARRIES THE GENRE.** This
 * check is the only thing protecting referential sense here.
 * `books.category_id` is `ON DELETE SET NULL`, which fires on a hard delete
 * — something this command never performs — so nothing in the schema stands
 * between an archived genre and a book silently keeping a label no screen
 * will ever offer again. The refusal is `category_in_use`, and its
 * Vietnamese sentence tells the volunteer what to do instead: move those
 * books to another genre first.
 *
 * **A SOFT-DELETED BOOK DOES NOT COUNT.** `Book`'s default scope drops it,
 * which is the reference's `books.deleted_at is null` verbatim: a genre
 * whose only reference is a book in the bin is not in use by anything a
 * reader or a manager can still see, and refusing there would refuse an
 * archive with no live consequence. `CategoriesListQuery`'s per-row count
 * uses the same predicate, so the number on the screen and the guard here
 * cannot disagree about whether the press will be accepted.
 *
 * **THE ONE WIDENING IN THIS FILE, and it is the books.** `Category` is
 * global, but `Book` carries `BelongsToBookshelf` and the `/admin` group
 * binds no tenant (spec D0), so asking "does ANY shelf still use this genre"
 * is a cross-shelf read that `BookshelfScope` would otherwise throw on. A
 * check narrowed to one shelf would be worse than none: it would report a
 * genre unused while another parish's whole collection sat on it.
 * `WideningArchitectureTest` confines the widening to this directory and
 * `app/Queries/Admin/`.
 *
 * **THE AUDIT ROW BELONGS TO NO SHELF**, like its two siblings — the
 * recorder's cross-shelf arm, fenced to this directory.
 *
 * **THERE IS NO UN-ARCHIVE.** The reference gives this slice none and this
 * port ports the omission as an omission. The slug stays taken (see
 * `CreateCategory`), so the way back is a new genre under a new name.
 */
final class ArchiveCategory
{
    public function __construct(
        private AuditRecorder $audit,
        private Clock $clock,
        private TenantContext $context,
    ) {}

    public function execute(User $actor, Category $category): void
    {
        Gate::forUser($actor)->authorize('archive', $category);

        DB::transaction(function () use ($category): void {
            // Across every shelf — see the docblock. Live books only, which
            // is Book's own default scope rather than a predicate spelled
            // out here.
            $inUse = $this->context->systemWide(
                fn (): bool => Book::query()->where('category_id', $category->id)->exists(),
            );

            if ($inUse) {
                throw new RuleViolated('category_in_use');
            }

            $before = ['name' => $category->name, 'slug' => $category->slug];

            $category->delete();

            $this->audit->global()->record(
                'category.archived',
                'category',
                $category->id,
                $before,
                // The instant, matching the reference's payload. In UTC, the
                // way every stored instant in this application is; the
                // screens that render one convert.
                ['archived_at' => $this->clock->now()->toIso8601String()],
            );
        }, ConcurrencyRetry::ATTEMPTS);
    }
}
