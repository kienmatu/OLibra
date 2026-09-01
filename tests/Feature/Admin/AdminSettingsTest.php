<?php

use App\Models\AuditLog;
use App\Models\SystemSetting;
use App\Models\User;
use App\Support\Audit\AuditSentences;
use App\Support\Clock;
use App\Support\TenantContext;
use Inertia\Testing\AssertableInertia;

/**
 * Phase 3b-ii Task 1: `/admin/settings` — the installation's own row, and
 * the first caller `SystemSetting` has ever had.
 *
 * THE TWO FORMS ARE INDEPENDENT, and that is what most of this file is
 * about. A page with two submits is only two forms if a refusal on one
 * leaves the other's stored values alone; a single all-fields save would
 * pass every "it saved" assertion below and still be the defect spec D1
 * forbids, because a typo in a loan default would block correcting the phone
 * number the public reads on /contact.
 *
 * WATCHED FAILING BEFORE IT WAS ACCEPTED. `max_renewals`' minimum raised
 * from 0 to 1 in UpdateSystemDefaultsRequest reddens "accepts max_renewals:
 * 0 — no renewals allowed is a real policy" with a session error on that
 * field and the stored column still 1; restored, green.
 *
 * THE /admin GROUP BINDS NO TENANT, so the fixture widens before touching a
 * model — defensive here rather than load-bearing, since neither
 * `SystemSetting` nor `User` carries `BelongsToBookshelf`. The shelf
 * editor's fixture does the same.
 *
 * Grep first: `grep -rn "^function adminSettingsFix" tests/`.
 */
function adminSettingsFix(): User
{
    app(TenantContext::class)->actSystemWide();

    return User::factory()->create(['is_super_admin' => true]);
}

/** The six the defaults form always posts, as a valid baseline each test varies. */
function adminSettingsDefaults(array $overrides = []): array
{
    return array_merge([
        'loan_days' => 21,
        'max_concurrent_loans' => 5,
        'max_renewals' => 2,
        'renewal_days' => 10,
        'hold_days' => 4,
        'due_soon_days' => 2,
    ], $overrides);
}

it('renders the screen with the seeded row, and the timezone from the clock', function () {
    $admin = adminSettingsFix();

    $this->actingAs($admin)
        ->get('/admin/settings')
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('admin/settings/index')
            // The migration's own defaults, never touched until now.
            ->where('defaults.loan_days', 14)
            ->where('defaults.max_renewals', 1)
            ->where('contact.contact_name', null)
            // Clock::ZONE, not a literal typed on the page or in the
            // controller — LabelsArchitectureTest censuses the literal, and
            // a screen that disagreed with the application's clock would be
            // wrong in a way nobody could see.
            ->where('timezone', Clock::ZONE)
            // Seeded, not written: nobody has saved yet. GATED ON
            // `changed_by`, because `changed_at` is ->useCurrent() and NOT
            // nullable — the seeded row already carries the instant of the
            // migration, and rendering that would date a change nobody made.
            ->where('changedAt', null)
        );

    $this->actingAs($admin)->post('/admin/settings/contact', [
        'contact_name' => 'Thầy Nam',
    ]);

    // And once somebody has saved, it is shown — so the null above is the
    // absence of an editor rather than a prop the screen never fills.
    $this->actingAs($admin)
        ->get('/admin/settings')
        ->assertInertia(fn (AssertableInertia $page) => $page->whereNot('changedAt', null));
});

it('saves the contact block and stamps who changed it and when', function () {
    $admin = adminSettingsFix();

    $this->actingAs($admin)
        ->post('/admin/settings/contact', [
            'contact_name' => 'Thầy Phêrô Nam',
            'contact_phone' => '0912345678',
            'contact_hours' => 'Thứ hai đến thứ sáu, 8h–17h',
        ])
        ->assertRedirect('/admin/settings');

    $settings = SystemSetting::query()->sole();

    expect($settings->contact_name)->toBe('Thầy Phêrô Nam')
        ->and($settings->contact_phone)->toBe('0912345678')
        ->and($settings->contact_hours)->toBe('Thứ hai đến thứ sáu, 8h–17h')
        // THE PROVENANCE COLUMNS ARE THE POINT OF THIS ASSERTION. The model
        // sets $timestamps = false, so nothing fills these by convention:
        // a command that forgot would report success and leave both null
        // forever. Only changed_by can be null — changed_at is
        // ->useCurrent() and NOT nullable, so it is never a proof of a
        // write on its own, and the actor is what is asserted here.
        ->and($settings->changed_by)->toBe($admin->id);
});

it('clears the contact block when the fields are emptied, rather than refusing', function () {
    $admin = adminSettingsFix();

    SystemSetting::query()->sole()->update([
        'contact_name' => 'Người cũ',
        'contact_phone' => '0912345678',
        'contact_hours' => 'Sáng thứ bảy',
    ]);

    // An installation between administrators is a real state, and the blank
    // check runs BEFORE Phone::assert() — a cleared phone is a decision
    // somebody made, not an invalid number.
    $this->actingAs($admin)
        ->post('/admin/settings/contact', [
            'contact_name' => '',
            'contact_phone' => '',
            'contact_hours' => '',
        ])
        ->assertRedirect('/admin/settings')
        ->assertSessionHasNoErrors();

    $settings = SystemSetting::query()->sole();

    expect($settings->contact_name)->toBeNull()
        ->and($settings->contact_phone)->toBeNull()
        ->and($settings->contact_hours)->toBeNull();
});

it('refuses a contact phone Phone rejects, and writes nothing', function () {
    $admin = adminSettingsFix();

    // The reference's own example of what this guard is for: a number
    // shaped like words. This is /contact's published number, so a bad
    // value is a PUBLIC dead link.
    $this->actingAs($admin)
        ->post('/admin/settings/contact', [
            'contact_name' => 'Thầy Nam',
            'contact_phone' => 'khong-phai-so',
            'contact_hours' => '',
        ])
        // Under `rule`, not as a field error: the shared RuleViolated hook,
        // so the sentence is the one every other phone in the application
        // produces rather than a second wording for the same rule.
        ->assertSessionHasErrors(['rule' => __('rules.phone_invalid')]);

    $settings = SystemSetting::query()->sole();

    // Refused BEFORE the write — the name did not sneak in beside the bad
    // phone number.
    expect($settings->contact_name)->toBeNull()
        ->and($settings->contact_phone)->toBeNull()
        ->and($settings->changed_by)->toBeNull();
});

it('saves the six defaults and stamps the actor', function () {
    $admin = adminSettingsFix();

    $this->actingAs($admin)
        ->post('/admin/settings/defaults', adminSettingsDefaults())
        ->assertRedirect('/admin/settings');

    $settings = SystemSetting::query()->sole();

    expect($settings->default_loan_days)->toBe(21)
        ->and($settings->default_max_concurrent_loans)->toBe(5)
        ->and($settings->default_max_renewals)->toBe(2)
        ->and($settings->default_renewal_days)->toBe(10)
        ->and($settings->default_hold_days)->toBe(4)
        ->and($settings->default_due_soon_days)->toBe(2)
        ->and($settings->changed_by)->toBe($admin->id);
});

it('accepts max_renewals: 0 — "no renewals allowed" is a real policy', function () {
    // BR §5.5 lets a shelf forbid renewals outright, and this row decides
    // what a shelf opened tomorrow starts with. A minimum of 1 here would
    // make that policy unreachable for every future shelf, silently, from a
    // screen whose whole job is to choose it. The falsification for this
    // file mutates exactly this bound.
    $admin = adminSettingsFix();

    $this->actingAs($admin)
        ->post('/admin/settings/defaults', adminSettingsDefaults([
            'max_renewals' => 0,
            // The other zero-floor of spec D7's table, in the same post:
            // "warn on the due date itself".
            'due_soon_days' => 0,
        ]))
        ->assertRedirect('/admin/settings')
        ->assertSessionHasNoErrors();

    $settings = SystemSetting::query()->sole();

    expect($settings->default_max_renewals)->toBe(0)
        ->and($settings->default_due_soon_days)->toBe(0);
});

it('refuses a default below its minimum and saves nothing', function () {
    $admin = adminSettingsFix();

    // 0 loan days would seed every future shelf with a policy under which
    // every loan falls due the day it is made.
    $this->actingAs($admin)
        ->post('/admin/settings/defaults', adminSettingsDefaults(['loan_days' => 0]))
        ->assertSessionHasErrors('loan_days');

    $settings = SystemSetting::query()->sole();

    // The whole post was refused, not just the offending field.
    expect($settings->default_loan_days)->toBe(14)
        ->and($settings->default_max_concurrent_loans)->toBe(3)
        ->and($settings->changed_by)->toBeNull();
});

it('refuses a non-integer default before any range check', function () {
    // Spec D7: each bound is validated as a safe integer FIRST, so "3.5"
    // and an overflowing exponent are refused as not-an-integer rather
    // than compared against a bound they might numerically satisfy.
    $admin = adminSettingsFix();

    $this->actingAs($admin)
        ->post('/admin/settings/defaults', adminSettingsDefaults(['hold_days' => '3.5']))
        ->assertSessionHasErrors('hold_days');

    $this->actingAs($admin)
        ->post('/admin/settings/defaults', adminSettingsDefaults(['loan_days' => '1e400']))
        ->assertSessionHasErrors('loan_days');

    expect(SystemSetting::query()->sole()->default_hold_days)->toBe(3);
});

it('refuses each form without touching what the other one stores', function () {
    // SPEC D1'S ACTUAL REQUIREMENT, and the one assertion here that a
    // single all-fields form would fail. Everything else in this file
    // passes just as well against a page that saved both blocks together.
    $admin = adminSettingsFix();

    $this->actingAs($admin)->post('/admin/settings/contact', [
        'contact_name' => 'Thầy Nam',
        'contact_phone' => '0912345678',
        'contact_hours' => 'Sáng thứ bảy',
    ]);
    $this->actingAs($admin)->post('/admin/settings/defaults', adminSettingsDefaults());

    // A bad phone must not undo the defaults somebody saved.
    $this->actingAs($admin)
        ->post('/admin/settings/contact', [
            'contact_name' => 'Thầy Nam',
            'contact_phone' => 'khong-phai-so',
            'contact_hours' => 'Sáng thứ bảy',
        ])
        ->assertSessionHasErrors('rule');

    // And a default out of range must not undo the contact block — the
    // direction BR §16.4 cares about, since that block is the public one.
    $this->actingAs($admin)
        ->post('/admin/settings/defaults', adminSettingsDefaults(['renewal_days' => 999]))
        ->assertSessionHasErrors('renewal_days');

    $settings = SystemSetting::query()->sole();

    expect($settings->contact_phone)->toBe('0912345678')
        ->and($settings->contact_name)->toBe('Thầy Nam')
        ->and($settings->default_loan_days)->toBe(21)
        ->and($settings->default_renewal_days)->toBe(10);
});

it('writes a global site_contact.updated row that names no phone', function () {
    $admin = adminSettingsFix();

    $this->actingAs($admin)->post('/admin/settings/contact', [
        'contact_name' => 'Thầy Nam',
        'contact_phone' => '0912345678',
        'contact_hours' => '',
    ]);

    $row = AuditLog::query()->where('action', 'site_contact.updated')->sole();

    // GLOBAL: null shelf. The installation belongs to no parish, which is
    // why this row is written through AuditRecorder's cross-shelf arm and
    // why it appears on no shelf's own audit screen.
    expect($row->bookshelf_id)->toBeNull()
        ->and($row->actor_id)->toBe($admin->id)
        ->and($row->entity_type)->toBe('system_settings')
        ->and($row->entity_id)->toBeNull()
        ->and($row->before)->toBe(['has_contact' => false])
        ->and($row->after)->toBe(['has_contact' => true]);

    // BR §14: the log records WHAT CHANGED rather than duplicating it, and
    // the phone is the one field here a person could be identified by.
    // Asserted over the encoded payload, not key by key, so a phone smuggled
    // in under any spelling is caught.
    expect(json_encode([$row->before, $row->after]))->not->toContain('0912345678');
});

it('writes a global system_settings.updated row carrying the numbers that moved', function () {
    $admin = adminSettingsFix();

    $this->actingAs($admin)->post('/admin/settings/defaults', adminSettingsDefaults());

    $row = AuditLog::query()->where('action', 'system_settings.updated')->sole();

    expect($row->bookshelf_id)->toBeNull()
        ->and($row->actor_id)->toBe($admin->id)
        // The migration's seeded values on the before side — a real prior
        // state, not a null standing in for "we did not look".
        ->and($row->before['loan_days'])->toBe(14)
        ->and($row->after['loan_days'])->toBe(21)
        ->and($row->before['max_renewals'])->toBe(1)
        ->and($row->after['max_renewals'])->toBe(2);
});

it('gives both actions a sentence that names the installation, not a shelf', function () {
    // Neither arm reads its payload, so this is what pins that neither one
    // renders AuditSentences' "undescribed system action" fallback to the
    // volunteer who opens the log.
    foreach (['site_contact.updated', 'system_settings.updated'] as $action) {
        $sentence = AuditSentences::sentence($action, [
            'actor' => 'Thầy Nam',
            'subject' => null,
            'before' => null,
            'after' => null,
        ]);

        expect($sentence)->toContain('Thầy Nam')
            ->and($sentence)->not->toContain('không rõ')
            ->and(AuditSentences::groupOf($action))->toBe('administration');
    }

    expect(AuditSentences::sentence('site_contact.updated', [
        'actor' => null, 'subject' => null, 'before' => null, 'after' => null,
    ]))->toContain('ban quản trị');
});

it('keeps the whole screen behind the super-admin door', function () {
    app(TenantContext::class)->actSystemWide();
    $stranger = User::factory()->create(['is_super_admin' => false]);

    // 404 and never 403, on BR §5.4's anti-enumeration rule — the same
    // answer EnsureSuperAdmin gives for the rest of the area, so the two
    // writes cannot be found by status code either.
    $this->actingAs($stranger)->get('/admin/settings')->assertNotFound();
    $this->actingAs($stranger)->post('/admin/settings/contact', [
        'contact_name' => 'Kẻ lạ',
    ])->assertNotFound();
    $this->actingAs($stranger)
        ->post('/admin/settings/defaults', adminSettingsDefaults())
        ->assertNotFound();

    expect(SystemSetting::query()->sole()->contact_name)->toBeNull();
});
