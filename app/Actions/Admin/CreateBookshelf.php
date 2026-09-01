<?php

namespace App\Actions\Admin;

use App\Enums\BookshelfStatus;
use App\Models\Bookshelf;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\ConcurrencyRetry;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * OPS §4.5's shelf lifecycle, first command: a super administrator opens a
 * new bookshelf. Port of old_next's `createBookshelf`
 * (src/domain/admin/commands/bookshelves.ts:62).
 *
 * WHY THIS IS AN ACTION IN app/Actions/Admin/ AND NOT A CONTROLLER BODY.
 * The `/admin` route group binds no tenant, which is deliberate — the area
 * is cross-shelf by nature. Spec D0 says the sanctioned answer: cross-shelf
 * writes live here, and only here may the audit configurator be called.
 *
 * NOTHING HERE NEEDS A WIDENING, and saying so is worth a line because the
 * directory exists for code that does. `Bookshelf` carries no
 * `BelongsToBookshelf`, so no global scope narrows the insert and no
 * creating hook wants a bound tenant; `AuditLog` carries none either. The
 * one thing that *does* fail closed without a tenant is the recorder, and
 * the configurator below is the sanctioned way past it. Later tasks in this
 * directory touch `Membership` and `BookshelfContact`, which are scoped, and
 * they reach those rows through relations from the shelf.
 *
 * THE AUDIT ROW NAMES THE SHELF rather than being global, which diverges
 * from the reference — its entry sets `global: true`, on the ground that
 * "the shelf did not exist when the decision was made". Spec §5.8 rules the
 * other way for this port ("`bookshelf.created` writes one naming the new
 * shelf"), and the practical argument is the audit screen: a shelf's own log
 * that begins at its second act reads as though the shelf sprang into being
 * unauthored. The row is written inside the same transaction as the insert,
 * so the id it names is committed with it or with neither.
 *
 * THE SLUG IS DECIDED HERE AND NEVER AGAIN (spec D1). A trigger raises
 * SQLSTATE 45000 on any UPDATE that changes it, so the edit path drops the
 * field entirely; see UpdateBookshelfProfile.
 *
 * `settings` IS LEFT EMPTY, and the lending policy is not copied in from an
 * installation default the way the reference copies `system_settings`. The
 * TABLE exists — `2026_08_26_000017_create_system_settings_table` creates it
 * with six `default_*` columns and seeds the single row id=1 — but nothing
 * in the application reads it yet: `App\Models\SystemSetting` exists but has
 * no callers anywhere, and there is no query or command over the table, and `/admin/settings`, the screen that makes those six
 * numbers editable, is 3b-ii. So a copy today would read defaults nobody can
 * change.
 *
 * AND IT WOULD CHANGE NO BEHAVIOUR IF IT DID. The six column defaults are
 * 14 / 3 / 3 / 1 / 7 / 3, which is character for character what
 * App\Support\Circulation\LendingSettings::fromShelf coalesces to for an
 * absent key, and comments fall back the same way
 * (App\Support\Community\CommentSettings::fromShelf's `?? true`). Copying
 * would only write six values that behave identically to their absence —
 * while turning "this shelf has never had a policy of its own" into "this
 * shelf chose these numbers", which is the distinction
 * UpdateBookshelfPolicy's `before` bag deliberately preserves. A shelf
 * created here therefore behaves exactly like every shelf the seeders make,
 * which also ship `[]`. Task 5's policy form is what writes real values into
 * it, and 3b-ii is where copying an installation default becomes a question
 * worth reopening.
 */
final class CreateBookshelf
{
    public function __construct(
        private AuditRecorder $audit,
    ) {}

    /**
     * @param  array{name: string, slug: string, location: ?string, address: ?string, description: ?string, established_on: ?string}  $profile
     */
    public function execute(User $actor, array $profile): Bookshelf
    {
        Gate::forUser($actor)->authorize('create', Bookshelf::class);

        return DB::transaction(function () use ($actor, $profile): Bookshelf {
            // Every column spelled out. `Bookshelf::$guarded` names only the
            // four generated columns, so a bag handed straight to create()
            // could set `status`, `created_by` or `timezone` from the wire;
            // the request never carries them, and this literal list is what
            // keeps that true if it ever does.
            $shelf = Bookshelf::query()->create([
                'name' => $profile['name'],
                'slug' => $profile['slug'],
                'location' => $profile['location'],
                'address' => $profile['address'],
                'description' => $profile['description'],
                'established_on' => $profile['established_on'],
                'status' => BookshelfStatus::Active,
                'created_by' => $actor->id,
                'settings' => [],
            ]);

            $this->audit->forShelf($shelf->id)->record('bookshelf.created', 'bookshelf', $shelf->id, null, [
                'name' => $shelf->name,
                'slug' => $shelf->slug,
            ]);

            return $shelf;
        }, ConcurrencyRetry::ATTEMPTS);
    }
}
