<?php

namespace App\Actions\Catalogue;

use App\Exceptions\RuleViolated;
use App\Models\Book;
use App\Models\Category;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\ValidationException;
use RuntimeException;

/**
 * Edits a title's metadata. Port of update-book.ts, with its IMPORTANT 3
 * satisfied by construction: $changes carries only the keys the caller
 * supplied (a FormRequest's validated() already has that shape), fill()
 * touches only those attributes, and Eloquent's UPDATE writes only dirty
 * columns — so a concurrent edit to a field this call never named is never
 * part of this statement at all. Omitted ≠ null: an omitted key leaves the
 * column alone; a present null clears it. The `case when/coalesce`
 * machinery the reference built for the same guarantee does not port
 * because the defect it fixed — a full-row write reverting a concurrent
 * edit — cannot occur here: there is no full-row write to revert anything
 * with.
 *
 * `slug` is not an accepted key, deliberately: it is what
 * /shelves/{shelf}/books/{book} resolves, and rewriting it when a manager
 * fixes a typo turns every link anyone has shared into a 404. A deliberate
 * re-slug would be its own command with its own audit action.
 *
 * REVISED (review finding): this DOES take AllocateCopyCodes' shelf-row
 * lock, as its FIRST statement, and for the identical reason CreateBook
 * does — not for the copy-code sequence (this command never reads it) but
 * for the ISBN clash check below. `books.isbn` carries no unique index; the
 * check is check-then-write (`exists()` now, `save()` later), which is
 * exactly the shape AllocateCopyCodes' own docblock names as one of the
 * three races reproduced live on MariaDB 10.11: under REPEATABLE READ, a
 * transaction's read view pins at its first consistent read, so an ISBN
 * check that runs before any lock can commit alongside a concurrent writer
 * that pinned its own snapshot just as early — two live books, same ISBN,
 * same shelf, both transactions honestly reporting "no clash" at the
 * instant each checked. The original version of this file reasoned that no
 * lock was needed because "nothing here reads the copy sequence" — true,
 * but irrelevant: the lock's job is pinning out a stale snapshot before
 * ANY unindexed check-then-write, not specifically the copy sequence. That
 * reasoning was wrong and is corrected here.
 *
 * Locking first also gives $book a cheap fresh read (`refresh()`,
 * immediately after the lock) before the audit's `before` snapshot is
 * taken, so a caller holding a $book loaded earlier in the request cannot
 * audit a stale `before` against a row another process changed meanwhile.
 */
final class UpdateBook
{
    private const FIELDS = [
        'title', 'author', 'publisher', 'published_year', 'page_count',
        'isbn', 'description', 'language', 'is_published',
    ];

    public function __construct(
        private AuditRecorder $audit,
        private TenantContext $context,
    ) {}

    /** @param array<string, mixed> $changes — only the keys the caller supplied */
    public function execute(User $actor, Book $book, array $changes): Book
    {
        Gate::forUser($actor)->authorize('update', $book);

        return DB::transaction(function () use ($book, $changes): Book {
            // FIRST statement, before ANY read — see the class docblock.
            // Same per-shelf FOR UPDATE as AllocateCopyCodes; DB::table
            // (not the Bookshelf model) so no global scope machinery runs
            // mid-transaction.
            $bookshelfId = $this->context->bookshelfId()
                ?? throw new RuntimeException('UpdateBook needs a bound tenant.');

            $shelf = DB::table('bookshelves')
                ->where('id', $bookshelfId)
                ->lockForUpdate()
                ->first(['id']);

            if ($shelf === null) {
                throw new RuntimeException('Bound shelf vanished mid-transaction.');
            }

            // Fresh under the lock — never the possibly-stale instance the
            // caller passed in (see class docblock).
            $book->refresh();

            $before = [
                'title' => $book->title,
                'author' => $book->author,
                'isbn' => $book->isbn,
                'isPublished' => $book->is_published,
            ];

            if (array_key_exists('category_slug', $changes)) {
                $category = Category::query()->where('slug', $changes['category_slug'])->first();

                if ($category === null) {
                    throw ValidationException::withMessages([
                        'category_slug' => __('validation.exists', ['attribute' => __('validation.attributes.category_slug')]),
                    ]);
                }

                $book->category_id = $category->id;
            }

            if (array_key_exists('isbn', $changes) && $changes['isbn'] !== null && $changes['isbn'] !== $book->isbn) {
                $clash = Book::query()
                    ->where('isbn', $changes['isbn'])
                    ->whereKeyNot($book->id)
                    ->exists();

                if ($clash) {
                    throw new RuleViolated('duplicate_isbn');
                }
            }

            // A book always has a title and an author — an explicit blank
            // is a refusal, not a clear (the reference's own guard; the
            // Form Request covers HTTP, this covers every caller — the
            // domain does not trust a transport).
            foreach (['title', 'author'] as $required) {
                if (array_key_exists($required, $changes)
                    && (! is_string($changes[$required]) || trim($changes[$required]) === '')) {
                    throw ValidationException::withMessages([
                        $required => __('validation.required', [
                            'attribute' => __('validation.attributes.'.$required),
                        ]),
                    ]);
                }
            }

            foreach (self::FIELDS as $field) {
                if (array_key_exists($field, $changes)) {
                    $value = $changes[$field];
                    $book->{$field} = in_array($field, ['title', 'author'], true) && is_string($value)
                        ? trim($value)
                        : $value;
                }
            }

            $book->save();

            $this->audit->record('book.updated', 'book', $book->id, $before, [
                'title' => $book->title,
                'author' => $book->author,
                'isbn' => $book->isbn,
                'isPublished' => $book->is_published,
            ]);

            return $book;
        });
    }
}
