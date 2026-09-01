<?php

namespace App\Actions\Admin;

use App\Models\SystemSetting;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\Clock;
use App\Support\ConcurrencyRetry;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * Phase 3b-ii Task 1, spec D1 and D7. The lending policy a **newly created**
 * shelf starts with. Port of the reference's `updateSystemDefaults`
 * (old_next/src/domain/admin/commands/system-settings.ts:117-160).
 *
 * **IT CHANGES NO EXISTING SHELF, AND THAT IS THE WHOLE DESIGN.** Every
 * command that reads a lending policy reads the shelf's own `settings` bag
 * (App\Support\Circulation\LendingSettings), never this row. A shelf that
 * pointed here instead would change its policy for every parish at once, the
 * day somebody edited a number, weeks after anyone made a decision about it,
 * and nobody would be told. The screen says so in a sentence, because a page
 * headed "defaults" is otherwise read as "the settings".
 *
 * Task 7 of this phase is what makes these six values reach a shelf at all:
 * `CreateBookshelf` copies them into the new shelf's bag at creation. Until
 * then this row is written and read only by this screen — recorded here
 * rather than left as a surprise, because the two tasks land separately.
 *
 * **THE SIX ARE A SEPARATE FORM FROM THE CONTACT BLOCK** (spec D1, the rule
 * 3b-i's D2 established): a typo in a default must not block correcting the
 * administration's phone number, and one of the two is public.
 *
 * **THE BOUNDS ARE THE REFERENCE'S** (old_next/src/domain/admin/policy.ts:
 * 61-72) and live in the Form Request, which is where every other bounded
 * number in this application is checked. Two of the six floor at 0 rather
 * than 1 and both floors are load-bearing: "no renewals allowed" is a real
 * policy under BR §5.5, and a shelf may legitimately want the due-soon
 * reminder on the due date itself.
 *
 * **`changed_by` AND `changed_at` ARE WRITTEN EXPLICITLY** — `SystemSetting`
 * sets `$timestamps = false`; see `UpdateSiteContact` for the full argument.
 *
 * **THE AUDIT ROW IS GLOBAL.** The installation belongs to no parish, so
 * `->global()` is the only shape that can write it from the tenant-less
 * `/admin` group, and the configurator is fenced to this directory by
 * `WideningArchitectureTest` — which is why this command lives here.
 */
final class UpdateSystemDefaults
{
    /**
     * The six columns, under the names the *shelf's* settings bag uses, and
     * the mapping between the two. Written once: the read side, the write
     * and both audit bags walk this list, so a seventh default cannot arrive
     * in the form and be missed by the log.
     *
     * The keys are the shelf-side names on purpose. Task 7 copies these
     * values into `bookshelves.settings` under exactly those keys, and the
     * audit payload uses them too — the reference's own payload shape — so a
     * reader of the log sees the same words the shelf editor shows.
     *
     * @var array<string, string>
     */
    public const array COLUMNS = [
        'loan_days' => 'default_loan_days',
        'max_concurrent_loans' => 'default_max_concurrent_loans',
        'max_renewals' => 'default_max_renewals',
        'renewal_days' => 'default_renewal_days',
        'hold_days' => 'default_hold_days',
        'due_soon_days' => 'default_due_soon_days',
    ];

    public function __construct(
        private AuditRecorder $audit,
        private Clock $clock,
    ) {}

    /**
     * @param  array{loan_days: int, max_concurrent_loans: int, max_renewals: int, renewal_days: int, hold_days: int, due_soon_days: int}  $defaults
     */
    public function execute(User $actor, array $defaults): void
    {
        Gate::forUser($actor)->authorize('update', SystemSetting::class);

        DB::transaction(function () use ($actor, $defaults): void {
            $settings = SystemSetting::query()->lockForUpdate()->sole();

            $before = [];
            $after = [];
            $write = [];

            foreach (self::COLUMNS as $key => $column) {
                $before[$key] = $settings->{$column};
                $after[$key] = $defaults[$key];
                $write[$column] = $defaults[$key];
            }

            $settings->update($write + [
                'changed_by' => $actor->id,
                'changed_at' => $this->clock->now(),
            ]);

            $this->audit->global()->record(
                'system_settings.updated',
                'system_settings',
                // The single row's key is the literal 1, not a uuid.
                null,
                $before,
                $after,
            );
        }, ConcurrencyRetry::ATTEMPTS);
    }
}
