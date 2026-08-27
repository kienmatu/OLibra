<?php

namespace App\Actions\Catalogue;

use App\Exceptions\RuleViolated;
use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Category;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\Catalogue\Donor;
use App\Support\Catalogue\Slugs;
use App\Support\Clock;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\ValidationException;

/**
 * Catalogues a title together with its first copies, in one transaction —
 * OPS §1: one business fact, one audit entry (book.created, codes in
 * `after`), because "a book with zero copies is not yet meaningfully
 * catalogued". Port of old_next/src/domain/catalogue/commands/create-book.ts.
 *
 * ORDERING IS LOAD-BEARING, and stricter here than in the reference
 * (plan divergence 1): the allocator's SELECT ... FOR UPDATE must be the
 * FIRST statement inside this transaction — nothing may read before it.
 * Postgres's READ COMMITTED gave the reference a fresh snapshot per
 * statement, so "checks after the lock" sufficed there; InnoDB's
 * REPEATABLE READ pins the transaction's read view at its first consistent
 * read, and a lock acquired afterwards cannot un-pin it. Reproduced live on
 * MariaDB 10.11 (review of this plan): with the category lookup first, T2
 * took the shelf lock AFTER T1 committed and still read stale — duplicate
 * copy code (raw errno 1062), missed ISBN clash (SILENT duplicate — no
 * unique index backs isbn), missed slug (raw 1062). With the lock as the
 * first statement, all three windows closed. So: lock, then category, ISBN,
 * slug — every read below the lock, none above it.
 */
final class CreateBook
{
    public function __construct(
        private AllocateCopyCodes $codes,
        private Clock $clock,
        private AuditRecorder $audit,
    ) {}

    /**
     * @param  array{title: string, author: string, category_slug: string, publisher?: ?string, published_year?: ?int, page_count?: ?int, isbn?: ?string, description?: ?string, language?: ?string, is_published?: ?bool, copy_count: int, donor_membership_id?: ?string, donor_name?: ?string, acquired_on?: ?string}  $input
     */
    public function execute(User $actor, array $input): Book
    {
        Gate::forUser($actor)->authorize('create', Book::class);
        Donor::assertSingle($input['donor_membership_id'] ?? null, $input['donor_name'] ?? null);

        // The domain does not trust a transport (OPS §2) — the Form
        // Request guards the HTTP path, these guard every path. Without
        // the count check, execute(..., 0) would reach range(1, 0), which
        // is [1, 0] in PHP — two codes allocated for a zero-copy request.
        if ($input['copy_count'] < 1) {
            throw new RuleViolated('copy_count_invalid');
        }

        foreach (['title', 'author'] as $required) {
            if (trim((string) $input[$required]) === '') {
                throw ValidationException::withMessages([
                    $required => __('validation.required', [
                        'attribute' => __('validation.attributes.'.$required),
                    ]),
                ]);
            }
        }

        return DB::transaction(function () use ($actor, $input): Book {
            // FIRST statement, before ANY read — the allocator's
            // FOR UPDATE both serialises this command per shelf and, under
            // REPEATABLE READ, keeps the transaction's read view from
            // being pinned by an earlier stale snapshot (see the class
            // docblock; reproduced live). Every read below happens under
            // the lock and therefore sees every committed writer.
            $codes = $this->codes->execute($input['copy_count']);

            $category = Category::query()->where('slug', $input['category_slug'])->first();

            if ($category === null) {
                throw ValidationException::withMessages([
                    'category_slug' => __('validation.exists', ['attribute' => __('validation.attributes.category_slug')]),
                ]);
            }

            $isbn = isset($input['isbn']) && trim((string) $input['isbn']) !== '' ? trim((string) $input['isbn']) : null;

            if ($isbn !== null && Book::query()->where('isbn', $isbn)->exists()) {
                // No unique index backs this — safe as check-then-write
                // only because the row lock above was this transaction's
                // FIRST statement. A read anywhere above the lock would
                // reintroduce the silent-duplicate window (class docblock).
                throw new RuleViolated('duplicate_isbn');
            }

            // Live slugs only (soft-deleted rows free theirs); base plus its
            // numbered variants. Slugs::fromTitle emits [a-z0-9-] only, so
            // the interpolation into REGEXP is literal-safe by construction.
            $base = Slugs::fromTitle($input['title']);
            $existing = array_values(array_map(
                strval(...),
                Book::query()
                    ->where(fn ($q) => $q->where('slug', $base)
                        ->orWhere('slug', 'regexp', '^'.$base.'-[0-9]+$'))
                    ->pluck('slug')
                    ->all(),
            ));
            $slug = Slugs::nextAvailable($base, $existing);

            $book = Book::query()->create([
                'category_id' => $category->id,
                'title' => trim($input['title']),
                'slug' => $slug,
                'author' => trim($input['author']),
                'publisher' => $input['publisher'] ?? null,
                'published_year' => $input['published_year'] ?? null,
                'page_count' => $input['page_count'] ?? null,
                'isbn' => $isbn,
                'description' => $input['description'] ?? null,
                'language' => $input['language'] ?? 'vi',
                'is_published' => $input['is_published'] ?? true,
                'added_by' => $actor->id,
            ]);

            $acquiredOn = $input['acquired_on'] ?? $this->clock->today();
            $donorName = isset($input['donor_name']) && trim((string) $input['donor_name']) !== ''
                ? trim((string) $input['donor_name']) : null;

            foreach ($codes as $code) {
                BookCopy::query()->create([
                    'book_id' => $book->id,
                    'code' => $code,
                    'state' => 'available',
                    'condition' => 'perfect',
                    'acquired_on' => $acquiredOn,
                    'acquired_from' => $donorName,
                    'acquired_from_membership_id' => $input['donor_membership_id'] ?? null,
                ]);
            }

            $this->audit->record('book.created', 'book', $book->id, null, [
                'title' => trim($input['title']),
                'slug' => $slug,
                'author' => trim($input['author']),
                'category' => $input['category_slug'],
                'isbn' => $isbn,
                'isPublished' => $input['is_published'] ?? true,
                'copyCodes' => $codes,
            ]);

            return $book->load('copies');
        });
    }
}
