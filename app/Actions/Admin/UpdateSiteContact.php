<?php

namespace App\Actions\Admin;

use App\Models\SystemSetting;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\Clock;
use App\Support\ConcurrencyRetry;
use App\Support\Members\Phone;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * Phase 3b-ii Task 1, spec D1. The administration's own contact block — the
 * name, phone and hours a stranger reads on `/contact`, which Task 2 builds.
 * Port of the reference's `updateSiteContact`
 * (old_next/src/domain/admin/commands/system-settings.ts:35-80).
 *
 * **THE FIRST CALLER `SystemSetting` HAS EVER HAD.** The model, the table
 * and its single row have existed since Phase 0's migration
 * (2026_08_26_000017), seeded there so every read is a SELECT rather than an
 * upsert. This command and its sibling are what finally read it.
 *
 * **ALL THREE FIELDS MOVE TOGETHER, and each may be null.** Clearing the
 * phone is a real edit a person means — the reference says so on
 * `SiteContactInput` — so the write is wholesale rather than a diff: what
 * the form said is the complete truth about how to reach the
 * administration.
 *
 * **THE PHONE IS VALIDATED BECAUSE IT IS PUBLISHED.** `/contact` is the only
 * route to a human a parish with no bookshelf has, so a mistyped number here
 * is a *public* dead link rather than a private inconvenience — the reason
 * the reference gives on the line above its own `assertPhone`. Blank first,
 * then `Phone::assert()`: null means "no phone on file", which is not the
 * same fact as an invalid one, and every existing caller of that class
 * (App\Support\Members\ProfileFields, App\Support\Members\Registration)
 * orders the two checks exactly this way. The refusal is `phone_invalid`,
 * which already has its Vietnamese sentence, and it reaches the screen
 * through the shared `errors.rule` banner rather than as a field error.
 *
 * **`changed_by` AND `changed_at` ARE WRITTEN EXPLICITLY.** `SystemSetting`
 * sets `$timestamps = false` — the column names are `changed_*` rather than
 * `updated_*` precisely because this is a domain fact ("when did an
 * administrator last change these") and not a framework convention. Nothing
 * fills them for us; a command that forgot would leave the provenance
 * columns null forever while every save reported success.
 *
 * **THE AUDIT ROW IS GLOBAL, and the phone is deliberately not in it.** The
 * installation belongs to no parish, so `->global()` is the only shape that
 * can write this row from the tenant-less `/admin` group — the configurator
 * `WideningArchitectureTest` fences to this directory, which is why this
 * command lives here rather than beside the controller. The payload records
 * `has_contact` and nothing else: the phone is the one field here somebody
 * could be identified by, BR §14 asks the log to record what changed rather
 * than duplicate it, and the current value is one screen away.
 */
final class UpdateSiteContact
{
    public function __construct(
        private AuditRecorder $audit,
        private Clock $clock,
    ) {}

    /**
     * @param  array{contact_name: ?string, contact_phone: ?string, contact_hours: ?string}  $contact
     */
    public function execute(User $actor, array $contact): void
    {
        Gate::forUser($actor)->authorize('update', SystemSetting::class);

        $name = $this->blankToNull($contact['contact_name'] ?? null);
        $phone = $this->blankToNull($contact['contact_phone'] ?? null);
        $hours = $this->blankToNull($contact['contact_hours'] ?? null);

        // Blank check first, then assert — see this class's docblock. A
        // cleared phone is a decision; an invalid one is a refusal.
        if ($phone !== null) {
            Phone::assert($phone);
        }

        DB::transaction(function () use ($actor, $name, $phone, $hours): void {
            $settings = SystemSetting::query()->lockForUpdate()->sole();

            $before = ['has_contact' => $settings->contact_name !== null];

            $settings->update([
                'contact_name' => $name,
                'contact_phone' => $phone,
                'contact_hours' => $hours,
                'changed_by' => $actor->id,
                'changed_at' => $this->clock->now(),
            ]);

            $this->audit->global()->record(
                'site_contact.updated',
                'system_settings',
                // A single row whose primary key is the literal 1: there is
                // no uuid to name, and the entity type alone says which row.
                null,
                $before,
                ['has_contact' => $name !== null],
            );
        }, ConcurrencyRetry::ATTEMPTS);
    }

    private function blankToNull(?string $value): ?string
    {
        $trimmed = trim((string) $value);

        return $trimmed === '' ? null : $trimmed;
    }
}
