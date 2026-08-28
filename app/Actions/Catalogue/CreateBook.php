<?php

namespace App\Actions\Catalogue;

use App\Exceptions\RuleViolated;
use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Category;
use App\Models\Membership;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\Catalogue\Donor;
use App\Support\Catalogue\Slugs;
use App\Support\Clock;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\ValidationException;
use Throwable;

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

        // Same "the domain does not trust a transport" argument as
        // copy_count and title above, applied to acquired_on: the Form
        // Request's date_format:Y-m-d only guards the HTTP path. Unparsed,
        // a bad string reaches Carbon's own parser inside the transaction
        // and surfaces as an InvalidFormatException rather than a field
        // error. '!Y-m-d' (leading '!') rejects a partial/lenient match —
        // plain 'Y-m-d' would silently accept '2026-2-3' — and the
        // round-trip format comparison below rejects a calendar overflow
        // like '2026-02-30' that createFromFormat would otherwise roll
        // forward into March.
        if (isset($input['acquired_on']) && trim((string) $input['acquired_on']) !== '') {
            $raw = trim((string) $input['acquired_on']);

            try {
                $parsed = CarbonImmutable::createFromFormat('!Y-m-d', $raw);
            } catch (Throwable) {
                $parsed = null;
            }

            if ($parsed === null || $parsed->format('Y-m-d') !== $raw) {
                throw ValidationException::withMessages([
                    'acquired_on' => __('validation.date_format', [
                        'attribute' => __('validation.attributes.acquired_on'),
                        'format' => 'Y-m-d',
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

            $donorMembershipId = isset($input['donor_membership_id']) && trim((string) $input['donor_membership_id']) !== ''
                ? trim((string) $input['donor_membership_id']) : null;

            if ($donorMembershipId !== null) {
                // Bypass-path twin of StoreBookRequest's own scoped
                // existence check. Membership::query() carries
                // BookshelfScope, so a membership belonging to another
                // shelf is invisible here exactly as a nonexistent one is
                // — the composite FK (bookshelf_id,
                // acquired_from_membership_id) would otherwise surface
                // either case as a raw errno 1452 from inside the
                // transaction, which BR §2 forbids.
                if (! Membership::query()->whereKey($donorMembershipId)->exists()) {
                    throw new RuleViolated('donor_membership_invalid');
                }
            }

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
                    'acquired_from_membership_id' => $donorMembershipId,
                ]);
            }

            // AuditRecorder stamps the actor from Auth::id(), not from the
            // $actor parameter above — deliberate (INV-8's audit rows name
            // "the authenticated user", never a value a caller could pass
            // in on someone else's behalf), but it means this call can
            // never itself catch $actor and the authenticated user having
            // diverged; every test in this suite calls execute($user, ...)
            // with the same $user it actingAs(), so that divergence has no
            // coverage here either.
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
