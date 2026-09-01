<?php

namespace App\Actions\Admin;

use App\Exceptions\RuleViolated;
use App\Models\Category;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\ConcurrencyRetry;
use App\Support\Fold;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * Phase 3b-ii Task 3, spec D3 — a new book genre. Port of the reference's
 * `createCategory` (old_next/src/domain/catalogue/commands/create-category.ts).
 *
 * **THE SLUG IS DERIVED FROM THE NAME AND NEVER TYPED.** Unlike a tủ sách's
 * slug — which a founding administrator may want to hand-pick because it is
 * printed on a notice board — a genre's slug is an internal handle: the
 * value a book form's picker posts. There is nothing a second input could
 * add and one more thing for two administrators to disagree about. The
 * derivation is this repo's own `Fold` helper with spaces hyphenated and the
 * result capped at 60 characters, which is character for character what the
 * reference does with its `fold()`.
 *
 * **AND IT IS NEVER MOVED AFTERWARDS** — see `RenameCategory`, which has no
 * slug input at all.
 *
 * **A NAME THAT FOLDS TO NOTHING IS REFUSED.** `Fold` maps everything
 * outside `[a-z0-9]` to a space, so a name made only of punctuation or of a
 * script the table does not cover ("???", "。。。") folds to the empty string
 * and would insert a row with an unusable handle. The refusal is the
 * codebase's shared `validation_failed`, which already has its sentence.
 *
 * **THE DUPLICATE CHECK RUNS AGAINST EVERY ROW, ARCHIVED ONES INCLUDED.**
 * `categories.slug` carries a plain unique index with no soft-delete
 * partition — unlike `bookshelves.slug_active`, whose generated column
 * exists precisely so a deleted shelf does not sit on its address forever.
 * The index is what it is, so the check matches it rather than contradicting
 * it: a hidden collision the administrator cannot see would otherwise reach
 * the driver and leave a 1062 where a Vietnamese sentence belongs. The
 * consequence is deliberate and the reference names it too — once a genre is
 * archived its slug is held, and the way back is a new name (there is no
 * un-archive command in this slice).
 *
 * **THE NEW ROW SORTS LAST.** `sort_order` is `max + 1`, the reference's own
 * rule: a genre added today is not more important than the ones already
 * there, and the list has no drag handle to say otherwise.
 *
 * **THE AUDIT ROW BELONGS TO NO SHELF.** Genres are shared by every tủ sách,
 * so there is no shelf whose own log this act belongs on — the reference
 * records all three category commands the same way. That is the recorder's
 * cross-shelf arm, which is the reason this command lives in this directory:
 * the configurator is fenced here by `WideningArchitectureTest`.
 *
 * **NO WIDENING, and saying so is worth a line in a directory that exists
 * for code that needs one.** `Category` carries no `BelongsToBookshelf` and
 * `categories` has no `bookshelf_id`; neither does `AuditLog`. The one thing
 * that fails closed without a tenant here is the recorder.
 */
final class CreateCategory
{
    /** The reference's cap — a handle, not a title. */
    private const int SLUG_MAX = 60;

    public function __construct(
        private AuditRecorder $audit,
    ) {}

    public function execute(User $actor, string $name): Category
    {
        Gate::forUser($actor)->authorize('create', Category::class);

        $name = trim($name);

        if ($name === '') {
            throw new RuleViolated('validation_failed');
        }

        $slug = self::slugFor($name);

        if ($slug === '') {
            throw new RuleViolated('validation_failed');
        }

        return DB::transaction(function () use ($name, $slug): Category {
            // withTrashed, matching the unique index — see the docblock.
            $taken = Category::query()
                ->withTrashed()
                ->where('slug', $slug)
                ->exists();

            if ($taken) {
                throw new RuleViolated('duplicate_category');
            }

            $last = (int) Category::query()->withTrashed()->max('sort_order');

            $category = Category::query()->create([
                'name' => $name,
                'slug' => $slug,
                'sort_order' => $last + 1,
            ]);

            $this->audit->global()->record('category.created', 'category', $category->id, null, [
                'name' => $category->name,
                'slug' => $category->slug,
            ]);

            return $category;
        }, ConcurrencyRetry::ATTEMPTS);
    }

    /**
     * Folded, spaces hyphenated, capped. Public because the screen's own
     * hint has nothing to do with it and a test does: the derivation is the
     * one thing about this command a rename must never repeat.
     */
    public static function slugFor(string $name): string
    {
        $folded = Fold::fold($name);
        $hyphenated = str_replace(' ', '-', $folded);

        return trim(mb_substr($hyphenated, 0, self::SLUG_MAX), '-');
    }
}
