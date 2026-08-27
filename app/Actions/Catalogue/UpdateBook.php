<?php

namespace App\Actions\Catalogue;

use App\Exceptions\RuleViolated;
use App\Models\Book;
use App\Models\Category;
use App\Models\User;
use App\Support\AuditRecorder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\ValidationException;

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
 * No shelf lock is taken here (unlike CreateBook's allocator-first-statement
 * rule): this command allocates no copy codes and performs no multi-row scan
 * whose correctness depends on a stable read view. Its writes are scoped to
 * one already-resolved Book row (BookshelfScope having done its job at
 * resolution time), and the ISBN clash check below is a plain
 * check-then-write against no unique index — exactly CreateBook's own
 * shape — but a `SELECT ... FOR UPDATE` on the shelf's copy sequence would
 * serialise this against unrelated commands (like CreateBook itself) for no
 * benefit: nothing here reads the copy sequence at all.
 */
final class UpdateBook
{
    private const FIELDS = [
        'title', 'author', 'publisher', 'published_year', 'page_count',
        'isbn', 'description', 'language', 'is_published',
    ];

    public function __construct(private AuditRecorder $audit) {}

    /** @param array<string, mixed> $changes — only the keys the caller supplied */
    public function execute(User $actor, Book $book, array $changes): Book
    {
        Gate::forUser($actor)->authorize('update', $book);

        return DB::transaction(function () use ($book, $changes): Book {
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
