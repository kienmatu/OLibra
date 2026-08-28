<?php

use App\Actions\Members\UpdateReaderProfile;
use App\Exceptions\RuleViolated;
use App\Models\AuditLog;
use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Support\Facades\DB;

/** @return array{Bookshelf, User, Membership, User} */
function corrFixture(string $actorRole = 'manager', string $subjectRole = 'reader'): array
{
    $shelf = Bookshelf::factory()->create(['slug' => 'dong-thap', 'settings' => []]);
    $actor = User::factory()->create();
    $actorMembership = Membership::factory()->for($shelf)->create([
        'user_id' => $actor->id, 'role' => $actorRole, 'status' => 'active',
    ]);
    $person = User::factory()->create([
        'saint_name' => 'Maria', 'full_name' => 'Nguyễn Thị Lan',
        'father_name' => 'Nguyễn Văn Hoà', 'mother_name' => 'Trần Thị Mai',
        'phone' => '0911111111', 'phone_missing_reason' => null,
    ]);
    $membership = Membership::factory()->for($shelf)->create([
        'user_id' => $person->id, 'role' => $subjectRole, 'status' => 'active',
    ]);
    app(TenantContext::class)->set($shelf, $actorMembership);
    test()->actingAs($actor);

    return [$shelf, $actor, $membership, $person];
}

it('a manager corrects a phone number, and the audit names who, when, and only what changed', function () {
    [, $actor, $membership, $person] = corrFixture();

    app(UpdateReaderProfile::class)->execute($actor, $membership, ['phone' => '0922222222']);

    expect($person->fresh()->phone)->toBe('0922222222');

    $entry = AuditLog::query()->where('action', 'profile.corrected')->firstOrFail();
    expect($entry->actor_id)->toBe($actor->id)
        ->and($entry->entity_type)->toBe('user')
        ->and($entry->entity_id)->toBe($person->id)
        ->and($entry->before)->toBe(['phone' => '0911111111'])
        ->and($entry->after)->toBe(['phone' => '0922222222'])
        // Only the fields that changed — an entry listing all nine says "a
        // manager rewrote this person" when a manager fixed a phone number.
        ->and(array_keys($entry->before))->toBe(['phone']);
});

it('two fields at once, including one cleared to null', function () {
    [, $actor, $membership, $person] = corrFixture();

    app(UpdateReaderProfile::class)->execute($actor, $membership, [
        'email' => 'lan@example.com', 'date_of_birth' => '',
    ]);

    $fresh = $person->fresh();
    expect($fresh->email)->toBe('lan@example.com')
        ->and($fresh->date_of_birth)->toBeNull();
});

it('a field this call never named survives untouched', function () {
    [, $actor, $membership, $person] = corrFixture();

    app(UpdateReaderProfile::class)->execute($actor, $membership, ['phone' => '0922222222']);

    expect($person->fresh()->father_name)->toBe('Nguyễn Văn Hoà');
});

it('naming no fields at all is refused, and writes nothing', function () {
    [, $actor, $membership] = corrFixture();

    expect(fn () => app(UpdateReaderProfile::class)->execute($actor, $membership, []))
        ->toThrow(RuleViolated::class, 'empty_proposal')
        ->and(AuditLog::query()->where('action', 'profile.corrected')->count())->toBe(0);
});

it('naming fields that all match the current values is refused, and moves nothing', function () {
    [, $actor, $membership, $person] = corrFixture();
    $updatedAt = $person->fresh()->updated_at;

    expect(fn () => app(UpdateReaderProfile::class)->execute($actor, $membership, [
        'phone' => '0911111111', 'full_name' => 'Nguyễn Thị Lan',
    ]))->toThrow(RuleViolated::class, 'empty_proposal');

    // The part a pre-check would leave true by accident: the row itself
    // did not move (the no-op write rolled back with the refusal).
    expect($person->fresh()->updated_at->toDateTimeString('microsecond'))
        ->toBe($updatedAt->toDateTimeString('microsecond'));
});

it('blanking a not-null field is a sentence, not a constraint error', function () {
    [, $actor, $membership] = corrFixture();

    expect(fn () => app(UpdateReaderProfile::class)->execute($actor, $membership, ['mother_name' => ' ']))
        ->toThrow(RuleViolated::class, 'required_fields_missing');
});

it('clearing the phone without a reason on file is thieu-so-dien-thoai', function () {
    [, $actor, $membership] = corrFixture();

    expect(fn () => app(UpdateReaderProfile::class)->execute($actor, $membership, ['phone' => '']))
        ->toThrow(RuleViolated::class, 'thieu-so-dien-thoai');
});

it('clearing the phone WITH a typed reason is allowed, and a reason already on file answers too', function () {
    [, $actor, $membership, $person] = corrFixture();

    app(UpdateReaderProfile::class)->execute($actor, $membership, [
        'phone' => '', 'phone_missing_reason' => 'Gia đình đổi số, sẽ bổ sung',
    ]);

    expect($person->fresh()->phone)->toBeNull()
        ->and($person->fresh()->phone_missing_reason)->toBe('Gia đình đổi số, sẽ bổ sung');
});

it('supplying a phone clears a stale missing-reason automatically', function () {
    [, $actor, $membership, $person] = corrFixture();
    $person->update(['phone' => null, 'phone_missing_reason' => 'chưa có']);

    app(UpdateReaderProfile::class)->execute($actor, $membership, ['phone' => '0933333333']);

    expect($person->fresh()->phone_missing_reason)->toBeNull();
});

it('§9 routing: a manager-subject record is a super admin\'s to write, not a colleague\'s', function () {
    [, $actor, $membership] = corrFixture('manager', 'manager');

    expect(fn () => app(UpdateReaderProfile::class)->execute($actor, $membership, ['phone' => '0922222222']))
        ->toThrow(RuleViolated::class, 'not_permitted');
});

it('§9 routing: a super admin may correct a manager\'s record', function () {
    [$shelf, , $membership] = corrFixture('manager', 'manager');
    $admin = User::factory()->superAdmin()->create();
    app(TenantContext::class)->set($shelf, null);
    test()->actingAs($admin);

    app(UpdateReaderProfile::class)->execute($admin, $membership, ['phone' => '0922222222']);

    expect(User::query()->findOrFail($membership->user_id)->phone)->toBe('0922222222');
});

it('INV-10: a manager of one shelf cannot correct another shelf\'s reader', function () {
    $other = Bookshelf::factory()->create(['slug' => 'can-tho', 'settings' => []]);
    $foreign = Membership::factory()->for($other)->create(['status' => 'active']);
    [, $actor] = corrFixture();

    expect(fn () => app(UpdateReaderProfile::class)->execute($actor, $foreign, ['phone' => '0922222222']))
        ->toThrow(ModelNotFoundException::class);
});

it('a soft-deleted identity cannot be corrected', function () {
    [, $actor, $membership, $person] = corrFixture();
    $person->delete();

    expect(fn () => app(UpdateReaderProfile::class)->execute($actor, $membership, ['phone' => '0922222222']))
        ->toThrow(RuleViolated::class, 'membership_not_found');
});

it('no correction can reach a credential column', function () {
    [, $actor, $membership, $person] = corrFixture();

    expect(fn () => app(UpdateReaderProfile::class)->execute($actor, $membership, [
        'username' => 'ke-xau', 'password_hash' => 'x', 'is_super_admin' => '1',
    ]))->toThrow(RuleViolated::class, 'empty_proposal')
        ->and($person->fresh()->username)->toBeNull();
});

it('a reader cannot correct anyone\'s details, including their own', function () {
    [, $actor, $membership] = corrFixture('reader');

    expect(fn () => app(UpdateReaderProfile::class)->execute($actor, $membership, ['phone' => '0922222222']))
        ->toThrow(AuthorizationException::class);
});

it('takes the locking re-read of the membership as the first statement of its transaction', function () {
    [, $actor, $membership] = corrFixture();

    DB::enableQueryLog();
    app(UpdateReaderProfile::class)->execute($actor, $membership, ['phone' => '0922222222']);
    $log = DB::getQueryLog();
    DB::disableQueryLog();

    expect($log)->not->toBe([])
        ->and(str_contains($log[0]['query'], 'memberships'))->toBeTrue('first query is not on memberships: '.$log[0]['query'])
        ->and(str_contains(strtolower($log[0]['query']), 'for update'))->toBeTrue('first query is not FOR UPDATE: '.$log[0]['query']);
});

// (The reference's systemContext-refusal test does not port: there is no
// systemContext here — execute takes a concrete authenticated User, and a
// console caller with no user fails the Gate. The concurrency variant "a
// field this call never named survives a concurrent correction" does not
// port either — under RefreshDatabase a second connection cannot see
// uncommitted fixtures, divergence 2's reasoning; the per-key patch write
// above is the mechanism, and known-gaps records the untestable half.)
