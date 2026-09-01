<?php

namespace App\Actions\Admin;

use App\Exceptions\RuleViolated;
use App\Models\Category;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\ConcurrencyRetry;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * Phase 3b-ii Task 3, spec D3 — a genre's display name changes and nothing
 * else moves. Port of the reference's `renameCategory`
 * (old_next/src/domain/catalogue/commands/rename-category.ts).
 *
 * **THE SLUG NEVER CHANGES, AND THAT IS THE WHOLE COMMAND.** `CreateCategory`
 * derives it once from the name; this command takes no slug input and never
 * writes the column. Moving it would silently repoint every book already
 * catalogued under the old handle — the same hazard 3b-i records for a tủ
 * sách's slug, which a parish has printed on notices and saved in its own
 * bookmarks. So a genre renamed from "Truyện tranh" to "Truyện thiếu nhi"
 * keeps `/truyen-tranh`, and the screen says so rather than leaving a
 * volunteer to discover it.
 *
 * There is deliberately no command anywhere that moves one. If a genre's
 * handle is genuinely wrong, the way out is the same as for an archived one:
 * a new genre, and the books moved onto it deliberately.
 *
 * **THE AUDIT ROW BELONGS TO NO SHELF** and carries both names, which is
 * what makes the log sentence able to say what it was called before — the
 * reference's own payload. The recorder's cross-shelf arm is why this
 * command lives in this directory (`WideningArchitectureTest`).
 *
 * **NO WIDENING IS NEEDED**, for `CreateCategory`'s reason: `Category`
 * carries no `BelongsToBookshelf`. Nothing here reads a book.
 */
final class RenameCategory
{
    public function __construct(
        private AuditRecorder $audit,
    ) {}

    public function execute(User $actor, Category $category, string $name): void
    {
        Gate::forUser($actor)->authorize('update', $category);

        $name = trim($name);

        if ($name === '') {
            throw new RuleViolated('validation_failed');
        }

        DB::transaction(function () use ($category, $name): void {
            $before = $category->name;

            // The one column. Spelled out rather than handed a bag, so the
            // day a caller passes more than a name it does not silently
            // reach the row this command promises not to move.
            $category->update(['name' => $name]);

            $this->audit->global()->record(
                'category.renamed',
                'category',
                $category->id,
                ['name' => $before],
                // The slug rides along unchanged in `after` and is
                // deliberately absent from `before`: what a reader of the
                // log needs is the handle the books are still filed under,
                // and putting it on both sides would suggest it was
                // something this act could have moved.
                ['name' => $name, 'slug' => $category->slug],
            );
        }, ConcurrencyRetry::ATTEMPTS);
    }
}
