<?php

namespace App\Actions\Admin;

use App\Enums\BookshelfStatus;
use App\Models\Bookshelf;
use App\Models\SystemSetting;
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
 * `settings` IS SEEDED FROM THE INSTALLATION DEFAULTS (spec D9, 3b-ii Task
 * 7), the way the reference copies `system_settings`. THIS REVERSES 3b-i's
 * REASONING HERE, and the old argument is written out rather than deleted
 * because it was sound when it was made and it is worth knowing what killed
 * it. It ran: the `system_settings` table exists but nothing in the
 * application reads it (`SystemSetting` had no callers), and its six column
 * defaults — 14 / 3 / 3 / 1 / 7 / 3 — are character for character what
 * App\Support\Circulation\LendingSettings::fromShelf coalesces to for an
 * absent key, so copying would write six values that behave identically to
 * their absence, while turning "this shelf has never had a policy of its
 * own" into "this shelf chose these numbers".
 *
 * WHAT KILLED IT: 3b-ii Task 1 shipped `/admin/settings`, so the six are
 * now editable (App\Actions\Admin\UpdateSystemDefaults). The moment an
 * administrator sets `default_loan_days` to 21, the values stop matching
 * `fromShelf`'s fallbacks, and a shelf opened afterwards that silently lends
 * for 14 days is not "policy-free" — it is wrong, and wrong in a way nobody
 * is told about. The distinction the old argument protected is real but
 * cheaper than that: after this change, a shelf created here HAS chosen
 * numbers, and the ones it chose are the administration's.
 *
 * THE KEYS ARE THE SHELF-SIDE NAMES (`loan_days`, not `default_loan_days`),
 * taken from `UpdateSystemDefaults::COLUMNS` rather than spelled again here
 * — that constant IS the map between the two vocabularies, and a second copy
 * of it is how one side later stops matching `LendingSettings::fromShelf`.
 *
 * DEFAULTS APPLY TO NEW SHELVES ONLY. Nothing here or in
 * `UpdateSystemDefaults` touches an existing shelf's bag; a parish that has
 * set its own policy keeps it, and `/admin/settings` says so on screen. That
 * is the reference's rule too ("Chỉ áp dụng cho tủ sách mở mới").
 *
 * Task 5's policy form still writes real values into this bag afterwards;
 * this only decides what the bag starts as. Note the seeders and the shelf
 * factory still ship `[]`, which is the deliberate "never had a policy"
 * fixture — this command is the one place a shelf is born with one.
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
            // Read inside the transaction, so the numbers the new shelf gets
            // are the ones committed at the moment it was opened rather than
            // a snapshot taken before an administrator's concurrent save.
            $defaults = SystemSetting::query()->sole();

            $settings = [];

            foreach (UpdateSystemDefaults::COLUMNS as $key => $column) {
                $settings[$key] = (int) $defaults->{$column};
            }

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
                'settings' => $settings,
            ]);

            $this->audit->forShelf($shelf->id)->record('bookshelf.created', 'bookshelf', $shelf->id, null, [
                'name' => $shelf->name,
                'slug' => $shelf->slug,
            ]);

            return $shelf;
        }, ConcurrencyRetry::ATTEMPTS);
    }
}
