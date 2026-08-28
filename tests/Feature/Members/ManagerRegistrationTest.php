<?php

use App\Actions\Members\ManagerRegisterReader;
use App\Actions\Members\RegisterMemberOnBehalf;
use App\Enums\MembershipStatus;
use App\Models\AuditLog;
use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Illuminate\Auth\Access\AuthorizationException;

/** @return array{Bookshelf, User} shelf and its acting manager */
function obhFixture(string $role = 'manager'): array
{
    $shelf = Bookshelf::factory()->create(['slug' => 'dong-thap', 'settings' => []]);
    $actor = User::factory()->create();
    $membership = Membership::factory()->for($shelf)->create([
        'user_id' => $actor->id, 'role' => $role, 'status' => 'active',
    ]);
    app(TenantContext::class)->set($shelf, $membership);
    test()->actingAs($actor);

    return [$shelf, $actor];
}

/** @return array<string, ?string> */
function obhInput(array $over = []): array
{
    return array_merge([
        'saint_name' => 'Giuse', 'full_name' => 'Trần Minh',
        'date_of_birth' => '2014-09-01', 'father_name' => 'Trần Văn Ba',
        'mother_name' => 'Lê Thị Tư', 'phone' => '0987654321',
    ], $over);
}

it('the quick-lend escape hatch produces a member who can be lent to at once', function () {
    // THE OPEN-QUESTION DECISION, IMPLEMENTED BY NAME (plan header, Q1):
    // active, not pending — OPS §4.3's inference from BR §1.3, the
    // reference's shipped behaviour. If the product owner reverses this,
    // flip MembershipStatus::Active in ManagerRegisterReader::execute and
    // this assertion.
    [, $actor] = obhFixture();

    $result = app(ManagerRegisterReader::class)->execute($actor, obhInput());

    $membership = Membership::query()->findOrFail($result['membershipId']);
    expect($membership->status)->toBe(MembershipStatus::Active)
        // approved_by/approved_at name the manager, so an active membership
        // never looks as though it approved itself — the consent record
        // BR §4 assumption 3 wants, kept even on the one-step path.
        ->and($membership->approved_by)->toBe($actor->id)
        ->and($membership->approved_at)->not->toBeNull();
});

it('filling in the form on a child\'s behalf still needs approving', function () {
    // BR §16.1, explicit: "still creates a pending application … so the
    // approval step and its audit record are never skipped."
    [, $actor] = obhFixture();

    $result = app(RegisterMemberOnBehalf::class)->execute($actor, obhInput());

    $membership = Membership::query()->findOrFail($result['membershipId']);
    expect($membership->status)->toBe(MembershipStatus::Pending)
        ->and($membership->approved_by)->toBeNull()
        ->and($membership->approved_at)->toBeNull();
});

it('both record the manager as actor, unlike a self-registration', function () {
    [, $actor] = obhFixture();

    app(RegisterMemberOnBehalf::class)->execute($actor, obhInput());
    app(ManagerRegisterReader::class)->execute($actor, obhInput([
        'full_name' => 'Lê Ngọc Ánh', 'phone' => '0912000111',
    ]));

    $entries = AuditLog::query()->where('action', 'membership.registered')->get();
    expect($entries)->toHaveCount(2)
        ->and($entries->pluck('actor_id')->unique()->all())->toBe([$actor->id]);
});

it('both hold the five-key audit line — no phone, no DOB, no parent names', function () {
    // Registration::auditAfter() is shared with RegisterMembership (Task
    // 6), which already pins this on the serialized payload rather than
    // toHaveKeys — negated toHaveKeys means "has ALL", so it would pass
    // even with just one of the three banned fields missing. Same
    // assertion shape here, against both commands that pass through it.
    [, $actor] = obhFixture();

    app(RegisterMemberOnBehalf::class)->execute($actor, obhInput());
    app(ManagerRegisterReader::class)->execute($actor, obhInput([
        'full_name' => 'Phạm Thu Hà', 'phone' => '0933000222',
    ]));

    $entries = AuditLog::query()->where('action', 'membership.registered')->get();
    expect($entries)->toHaveCount(2);

    foreach ($entries as $entry) {
        expect(array_keys($entry->after))->toEqualCanonicalizing([
            'userId', 'fullName', 'status', 'parishUnitL1Id', 'parishUnitL2Id',
        ]);

        $serialized = json_encode([$entry->before, $entry->after]);
        expect($serialized)->not->toContain('0987654321')
            ->and($serialized)->not->toContain('0933000222')
            ->and($serialized)->not->toContain('2014-09-01')
            ->and($serialized)->not->toContain('Trần Văn Ba')
            ->and($serialized)->not->toContain('Lê Thị Tư');
    }
});

it('a left manager walked back by managerRegisterReader lands active and demoted to reader', function () {
    [$shelf, $actor] = obhFixture();
    $person = User::factory()->create(['full_name' => 'Trần Minh', 'date_of_birth' => '2014-09-01', 'phone' => '0987654321', 'phone_missing_reason' => null]);
    $old = Membership::factory()->for($shelf)->manager()->create(['user_id' => $person->id, 'status' => 'left']);

    $result = app(ManagerRegisterReader::class)->execute($actor, obhInput());

    $fresh = Membership::query()->findOrFail($result['membershipId']);
    expect($result['membershipId'])->toBe($old->id)
        ->and($fresh->status)->toBe(MembershipStatus::Active)
        ->and($fresh->role->value)->toBe('reader');
});

it('the same person, registered actively at a second shelf, keeps one identity', function () {
    [, $actor] = obhFixture();
    $first = app(ManagerRegisterReader::class)->execute($actor, obhInput());

    // BelongsToBookshelf's creating hook (Task 11) refuses to stamp a
    // Membership row for any shelf but the one currently bound (still the
    // first fixture's shelf here), so the second shelf's manager fixture is
    // built system-wide — RegisterMembershipTest's established pattern —
    // before rebinding the tenant to it.
    app(TenantContext::class)->actSystemWide();
    $second = Bookshelf::factory()->create(['slug' => 'can-tho', 'settings' => []]);
    $manager2 = User::factory()->create();
    $m2 = Membership::factory()->for($second)->manager()->create(['user_id' => $manager2->id, 'status' => 'active']);
    app(TenantContext::class)->set($second, $m2);
    test()->actingAs($manager2);

    $result = app(ManagerRegisterReader::class)->execute($manager2, obhInput());

    expect($result['userId'])->toBe($first['userId'])
        ->and($result['membershipId'])->not->toBe($first['membershipId']);
});

// Guest/reader refusals in their OWN it() blocks — the SessionGuard cache
// trap: never appended after an actingAs.

it('a reader cannot register anybody', function () {
    [, $actor] = obhFixture('reader');

    expect(fn () => app(RegisterMemberOnBehalf::class)->execute($actor, obhInput()))
        ->toThrow(AuthorizationException::class)
        ->and(fn () => app(ManagerRegisterReader::class)->execute($actor, obhInput()))
        ->toThrow(AuthorizationException::class);
});
