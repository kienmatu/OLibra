<?php

use App\Actions\Members\RegisterMembership;
use App\Enums\MembershipStatus;
use App\Exceptions\RuleViolated;
use App\Models\AuditLog;
use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\ParishUnit;
use App\Models\Scopes\BookshelfScope;
use App\Models\User;
use App\Support\TenantContext;
use Illuminate\Support\Facades\Hash;
use Tests\Support\TenantHarness;

/**
 * Guest fixture: a bound shelf with a nested taxonomy, NO actingAs
 * anywhere — registration is the guest path, and the SessionGuard cache
 * trap means an actingAs here would silently authenticate every "guest"
 * assertion below it.
 *
 * @return array{Bookshelf, ParishUnit, ParishUnit, ParishUnit} shelf, l1a, l1b, l2-of-l1a
 */
function regFixture(): array
{
    $shelf = Bookshelf::factory()->create([
        'slug' => 'dong-thap',
        'settings' => ['parish_taxonomy' => ['levels' => 2, 'nested' => true, 'level1_label' => 'Giáo họ', 'level2_label' => 'Tổ']],
    ]);
    $l1a = ParishUnit::factory()->for($shelf)->create(['level' => 1, 'name' => 'Giáo họ Thánh Tâm']);
    $l1b = ParishUnit::factory()->for($shelf)->create(['level' => 1, 'name' => 'Giáo họ Mân Côi']);
    $l2 = ParishUnit::factory()->for($shelf)->create(['level' => 2, 'parent_id' => $l1a->id, 'name' => 'Tổ 3']);
    TenantHarness::actAs($shelf);

    return [$shelf, $l1a, $l1b, $l2];
}

/** @return array<string, ?string> a complete, valid submission */
function regInput(array $over = []): array
{
    return array_merge([
        'saint_name' => 'Maria',
        'full_name' => 'Nguyễn Thị Lan',
        'date_of_birth' => '2015-04-02',
        'father_name' => 'Nguyễn Văn Hoà',
        'mother_name' => 'Trần Thị Mai',
        'phone' => '0912 345 678',
    ], $over);
}

it('a guest registers and gets a pending membership and a new person', function () {
    regFixture();

    $result = app(RegisterMembership::class)->execute(regInput());

    $user = User::query()->findOrFail($result['userId']);
    $membership = Membership::query()->findOrFail($result['membershipId']);

    expect($user->saint_name)->toBe('Maria')
        ->and($user->full_name)->toBe('Nguyễn Thị Lan')
        ->and($user->date_of_birth->toDateString())->toBe('2015-04-02')
        ->and($user->phone)->toBe('0912 345 678')
        ->and($user->phone_missing_reason)->toBeNull()
        ->and($user->username)->toBeNull()
        ->and($membership->status)->toBe(MembershipStatus::Pending)
        ->and($membership->role->value)->toBe('reader')
        ->and($membership->approved_by)->toBeNull()
        ->and($membership->approved_at)->toBeNull();
});

it('the audit entry has a null actor and carries no phone, no DOB, no parents', function () {
    regFixture();

    $result = app(RegisterMembership::class)->execute(regInput());

    $entry = AuditLog::query()->where('action', 'membership.registered')->firstOrFail();
    $serialized = json_encode([$entry->before, $entry->after]);

    expect($entry->actor_id)->toBeNull()
        ->and($entry->entity_type)->toBe('membership')
        ->and($entry->entity_id)->toBe($result['membershipId'])
        ->and($entry->after['fullName'])->toBe('Nguyễn Thị Lan')
        ->and($entry->after['status'])->toBe('pending')
        ->and($serialized)->not->toContain('0912')
        ->and($serialized)->not->toContain('2015-04-02')
        ->and($serialized)->not->toContain('Nguyễn Văn Hoà');
});

it('credentials are optional, and set together when supplied', function () {
    regFixture();

    $result = app(RegisterMembership::class)->execute(regInput([
        'username' => 'lan.nguyen', 'password' => 'mat-khau-123', 'password_confirmation' => 'mat-khau-123',
    ]));

    $user = User::query()->findOrFail($result['userId']);
    expect($user->username)->toBe('lan.nguyen')
        ->and(Hash::check('mat-khau-123', $user->password_hash))->toBeTrue();
});

it('the required fields are the ones the database and BR §5.3 agree on', function () {
    regFixture();

    foreach (['saint_name', 'full_name', 'date_of_birth', 'father_name', 'mother_name'] as $field) {
        expect(fn () => app(RegisterMembership::class)->execute(regInput([$field => '   '])))
            ->toThrow(RuleViolated::class, 'required_fields_missing');
    }
});

it('a blank phone with no reason is thieu-so-dien-thoai, not required_fields_missing', function () {
    regFixture();

    expect(fn () => app(RegisterMembership::class)->execute(regInput(['phone' => ''])))
        ->toThrow(RuleViolated::class, 'thieu-so-dien-thoai');
});

it('a blank phone with a typed reason registers, and the reason is stored', function () {
    regFixture();

    $result = app(RegisterMembership::class)->execute(regInput([
        'phone' => '', 'phone_missing_reason' => 'Em bé chưa có điện thoại riêng',
    ]));

    $user = User::query()->findOrFail($result['userId']);
    expect($user->phone)->toBeNull()
        ->and($user->phone_missing_reason)->toBe('Em bé chưa có điện thoại riêng');
});

it('a real phone needs no reason, and none is stored even if one was typed', function () {
    regFixture();

    $result = app(RegisterMembership::class)->execute(regInput([
        'phone_missing_reason' => 'thừa — có số rồi',
    ]));

    expect(User::query()->findOrFail($result['userId'])->phone_missing_reason)->toBeNull();
});

it('khong-phai-so in the phone box is a sentence, not a tel: link to nowhere', function () {
    regFixture();

    expect(fn () => app(RegisterMembership::class)->execute(regInput(['phone' => 'khong-phai-so'])))
        ->toThrow(RuleViolated::class, 'phone_invalid');
});

it('a short password and a mistyped confirmation each say so', function () {
    regFixture();

    expect(fn () => app(RegisterMembership::class)->execute(regInput([
        'username' => 'lan', 'password' => 'ngắn123', 'password_confirmation' => 'ngắn123',
    ])))->toThrow(RuleViolated::class, 'password_too_short')
        ->and(fn () => app(RegisterMembership::class)->execute(regInput([
            'username' => 'lan', 'password' => 'mat-khau-123', 'password_confirmation' => 'khac-mat-khau',
        ])))->toThrow(RuleViolated::class, 'passwords_dont_match');
});

it('INV-14: a username with no password, or a password with no username, is refused', function () {
    regFixture();

    expect(fn () => app(RegisterMembership::class)->execute(regInput(['username' => 'lan'])))
        ->toThrow(RuleViolated::class, 'required_fields_missing')
        ->and(fn () => app(RegisterMembership::class)->execute(regInput(['password' => 'mat-khau-123'])))
        ->toThrow(RuleViolated::class, 'required_fields_missing');
});

it('dates are real dates: Vietnamese-written, ISO-shaped-impossible and prose are all refused', function () {
    regFixture();

    // The reference measured what happens without this: 02/04/2015 stored
    // as 2015-02-03, 2015-02-30 rolled into March, 'hôm qua' a RangeError.
    foreach (['02/04/2015', '2015-02-30', 'hôm qua'] as $bad) {
        expect(fn () => app(RegisterMembership::class)->execute(regInput(['date_of_birth' => $bad])))
            ->toThrow(RuleViolated::class, 'validation_failed');
    }
});

it('a leap day is a real date and stores as the day that was typed', function () {
    regFixture();

    $result = app(RegisterMembership::class)->execute(regInput(['date_of_birth' => '2016-02-29']));

    expect(User::query()->findOrFail($result['userId'])->date_of_birth->toDateString())->toBe('2016-02-29');
});

it('the parish selection rule runs in the command, not in the picker', function () {
    [, $l1a, $l1b, $l2] = regFixture();

    // A level-2 unit under the WRONG level-1 parent.
    expect(fn () => app(RegisterMembership::class)->execute(regInput([
        'parish_unit_l1_id' => $l1b->id, 'parish_unit_l2_id' => $l2->id,
    ])))->toThrow(RuleViolated::class, 'parish_unit_l2_not_in_l1');

    // A level-2 id in the level-1 slot is not-found, not borrowed.
    expect(fn () => app(RegisterMembership::class)->execute(regInput([
        'parish_unit_l1_id' => $l2->id,
    ])))->toThrow(RuleViolated::class, 'parish_unit_l1_not_found');

    // The happy pair stores both.
    $result = app(RegisterMembership::class)->execute(regInput([
        'parish_unit_l1_id' => $l1a->id, 'parish_unit_l2_id' => $l2->id,
    ]));
    $membership = Membership::query()->findOrFail($result['membershipId']);
    expect($membership->parish_unit_l1_id)->toBe($l1a->id)
        ->and($membership->parish_unit_l2_id)->toBe($l2->id);
});

it('both parish fields stay optional, permanently', function () {
    regFixture();

    $result = app(RegisterMembership::class)->execute(regInput());

    $membership = Membership::query()->findOrFail($result['membershipId']);
    expect($membership->parish_unit_l1_id)->toBeNull()
        ->and($membership->parish_unit_l2_id)->toBeNull();
});

it('INV-10: a unit belonging to another shelf is not found, not borrowed', function () {
    [$shelf] = regFixture();

    // BelongsToBookshelf's creating hook (Task 11) refuses to stamp a row
    // for any shelf but the one currently bound, so the foreign fixture is
    // built system-wide — naming its own bookshelf_id, as the trait's own
    // docblock says a test harness is trusted to do — and the tenant is
    // rebound to the fixture's shelf before the command under test runs.
    app(TenantContext::class)->actSystemWide();
    $other = Bookshelf::factory()->create(['slug' => 'can-tho', 'settings' => []]);
    $foreign = ParishUnit::factory()->for($other)->create(['level' => 1, 'name' => 'Giáo họ Khác']);
    TenantHarness::actAs($shelf);

    expect(fn () => app(RegisterMembership::class)->execute(regInput([
        'parish_unit_l1_id' => $foreign->id,
    ])))->toThrow(RuleViolated::class, 'parish_unit_l1_not_found');
});

it('a family that moves keeps its identity and re-enters only the parish details', function () {
    [$shelf] = regFixture();
    $first = app(RegisterMembership::class)->execute(regInput([
        'username' => 'lan.nguyen', 'password' => 'mat-khau-123', 'password_confirmation' => 'mat-khau-123',
    ]));

    // The same person registers at a second shelf, by username + password.
    $second = Bookshelf::factory()->create(['slug' => 'can-tho', 'settings' => []]);
    TenantHarness::actAs($second);
    $result = app(RegisterMembership::class)->execute(regInput([
        'username' => 'lan.nguyen', 'password' => 'mat-khau-123', 'password_confirmation' => 'mat-khau-123',
        // A different father's name typed at the second parish must NOT
        // rewrite the verified record (INV-13: a registration form is
        // neither of the two sanctioned write paths).
        'father_name' => 'Ai Đó Khác',
    ]));

    expect($result['userId'])->toBe($first['userId'])
        ->and($result['membershipId'])->not->toBe($first['membershipId'])
        ->and(User::query()->findOrFail($result['userId'])->father_name)->toBe('Nguyễn Văn Hoà')
        ->and(Membership::query()->withoutGlobalScopes([BookshelfScope::class])->where('user_id', $first['userId'])->count())->toBe(2);
});

it('the no-username match is the exact triple, never a name or a phone alone', function () {
    regFixture();
    $first = app(RegisterMembership::class)->execute(regInput());
    Membership::query()->findOrFail($first['membershipId'])->delete(); // free the shelf slot

    // Same name, same phone, different DOB → a new person.
    $differentDob = app(RegisterMembership::class)->execute(regInput(['date_of_birth' => '2014-01-01']));
    expect($differentDob['userId'])->not->toBe($first['userId']);

    Membership::query()->findOrFail($differentDob['membershipId'])->delete();

    // The exact triple → the same person.
    $same = app(RegisterMembership::class)->execute(regInput());
    expect($same['userId'])->toBe($first['userId']);
});

it('a username is matched only against its own password', function () {
    regFixture();
    app(RegisterMembership::class)->execute(regInput([
        'username' => 'lan.nguyen', 'password' => 'mat-khau-123', 'password_confirmation' => 'mat-khau-123',
    ]));
    $other = Bookshelf::factory()->create(['slug' => 'can-tho', 'settings' => []]);
    TenantHarness::actAs($other);

    // The wrong password gets exactly what an unrelated collision gets.
    expect(fn () => app(RegisterMembership::class)->execute(regInput([
        'username' => 'LAN.NGUYEN', 'password' => 'doan-mo-12345', 'password_confirmation' => 'doan-mo-12345',
    ])))->toThrow(RuleViolated::class, 'username_taken');
});

it('an account with no password cannot be claimed by supplying one', function () {
    regFixture();
    // INV-14's valid state is both-or-neither; a user row with credentials
    // can only exist with both. The claimable-looking case is a username
    // that exists with a password the claimant does not know — covered
    // above — and a username column that is NULL matches nobody, so a new
    // person is created rather than an account hijacked.
    $existing = User::factory()->create(['full_name' => 'Nguyễn Thị Lan']);

    $result = app(RegisterMembership::class)->execute(regInput([
        'username' => 'lan.moi', 'password' => 'mat-khau-123', 'password_confirmation' => 'mat-khau-123',
    ]));

    expect($result['userId'])->not->toBe($existing->id);
});

it('IMPORTANT 5: a probe against a suspended membership leaves that row exactly as it was', function () {
    regFixture();
    $person = User::factory()->create(['full_name' => 'Nguyễn Thị Lan', 'date_of_birth' => '2015-04-02', 'phone' => '0912 345 678', 'phone_missing_reason' => null]);
    $membership = Membership::factory()->for(app(TenantContext::class)->bookshelf())->create([
        'user_id' => $person->id, 'status' => 'suspended', 'suspension_reason' => 'Lý do thật',
    ]);

    expect(fn () => app(RegisterMembership::class)->execute(regInput()))
        ->toThrow(RuleViolated::class, 'already_registered_here');

    $fresh = $membership->fresh();
    expect($fresh->status)->toBe(MembershipStatus::Suspended)
        ->and($fresh->suspension_reason)->toBe('Lý do thật');
});

it('a rejected applicant re-applies on the same membership row, reasons cleared', function () {
    regFixture();
    $first = app(RegisterMembership::class)->execute(regInput());
    Membership::query()->findOrFail($first['membershipId'])
        ->update(['status' => 'rejected', 'rejection_reason' => 'Thiếu thông tin']);

    $again = app(RegisterMembership::class)->execute(regInput());

    $membership = Membership::query()->findOrFail($again['membershipId']);
    expect($again['membershipId'])->toBe($first['membershipId'])
        ->and($membership->status)->toBe(MembershipStatus::Pending)
        ->and($membership->rejection_reason)->toBeNull();
});

it('a member who left may come back the same way', function () {
    regFixture();
    $first = app(RegisterMembership::class)->execute(regInput());
    Membership::query()->findOrFail($first['membershipId'])->update(['status' => 'left']);

    $again = app(RegisterMembership::class)->execute(regInput());

    expect($again['membershipId'])->toBe($first['membershipId'])
        ->and(Membership::query()->findOrFail($again['membershipId'])->status)->toBe(MembershipStatus::Pending);
});

it('registering twice while already pending or active is named, not silent', function () {
    regFixture();
    app(RegisterMembership::class)->execute(regInput());

    expect(fn () => app(RegisterMembership::class)->execute(regInput()))
        ->toThrow(RuleViolated::class, 'already_registered_here');
});

it('CRITICAL 1: a suspended membership does not walk back to pending through the public form', function () {
    regFixture();
    $first = app(RegisterMembership::class)->execute(regInput());
    Membership::query()->findOrFail($first['membershipId'])->update(['status' => 'suspended']);

    expect(fn () => app(RegisterMembership::class)->execute(regInput()))
        ->toThrow(RuleViolated::class, 'already_registered_here');
});

it('a manager who left re-registers through the public form, landing pending and demoted to reader', function () {
    regFixture();
    $person = User::factory()->create(['full_name' => 'Nguyễn Thị Lan', 'date_of_birth' => '2015-04-02', 'phone' => '0912 345 678', 'phone_missing_reason' => null]);
    $membership = Membership::factory()->for(app(TenantContext::class)->bookshelf())->manager()->create([
        'user_id' => $person->id, 'status' => 'left',
    ]);

    $result = app(RegisterMembership::class)->execute(regInput());

    $fresh = Membership::query()->findOrFail($result['membershipId']);
    expect($result['membershipId'])->toBe($membership->id)
        ->and($fresh->status)->toBe(MembershipStatus::Pending)
        ->and($fresh->role->value)->toBe('reader');
});
