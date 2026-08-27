<?php

use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Illuminate\Support\Facades\Gate;
use Tests\Support\TenantHarness;

function authzUser(bool $superAdmin = false): User
{
    $user = new User([
        'saint_name' => 'Têrêsa', 'full_name' => 'Lê Ngọc Ánh',
        'father_name' => 'Cha', 'mother_name' => 'Mẹ',
    ]);
    $user->is_super_admin = $superAdmin;
    $user->save();

    return $user;
}

function authzBind(User $user, string $role, string $status = 'active'): Membership
{
    ['a' => $shelf] = TenantHarness::twoCollidingShelves();
    $membership = Membership::query()->withoutGlobalScopes()->create([
        'bookshelf_id' => $shelf->id, 'user_id' => $user->id,
        'role' => $role, 'status' => $status,
    ]);
    app(TenantContext::class)->set($shelf, $membership);

    return $membership;
}

it('grants a reader reader, and nothing above', function () {
    $user = authzUser();
    authzBind($user, 'reader');

    expect(Gate::forUser($user)->allows('act-as-reader'))->toBeTrue()
        ->and(Gate::forUser($user)->allows('act-as-manager'))->toBeFalse()
        ->and(Gate::forUser($user)->allows('act-as-admin'))->toBeFalse();
});

it('grants a manager reader and manager, not admin', function () {
    $user = authzUser();
    authzBind($user, 'manager');

    expect(Gate::forUser($user)->allows('act-as-reader'))->toBeTrue()
        ->and(Gate::forUser($user)->allows('act-as-manager'))->toBeTrue()
        ->and(Gate::forUser($user)->allows('act-as-admin'))->toBeFalse();
});

it('grants a shelf admin all three', function () {
    $user = authzUser();
    authzBind($user, 'admin');

    expect(Gate::forUser($user)->allows('act-as-reader'))->toBeTrue()
        ->and(Gate::forUser($user)->allows('act-as-manager'))->toBeTrue()
        ->and(Gate::forUser($user)->allows('act-as-admin'))->toBeTrue();
});

it('grants nothing to a user with no membership of the bound shelf', function () {
    $user = authzUser();
    ['a' => $shelf] = TenantHarness::twoCollidingShelves();
    app(TenantContext::class)->set($shelf, null);

    expect(Gate::forUser($user)->allows('act-as-reader'))->toBeFalse()
        ->and(Gate::forUser($user)->allows('act-as-manager'))->toBeFalse()
        ->and(Gate::forUser($user)->allows('act-as-admin'))->toBeFalse();
});

it('grants nothing when the tenant context is entirely unset', function () {
    // TenantContext::membership() returns null when unset rather than
    // throwing (only a *scoped model query* throws under
    // BookshelfScope) — a gate check must not depend on a route having
    // bound anything.
    $user = authzUser();

    expect(Gate::forUser($user)->allows('act-as-reader'))->toBeFalse();
});

it('grants a super admin everything, membership or none', function () {
    $user = authzUser(superAdmin: true);
    ['a' => $shelf] = TenantHarness::twoCollidingShelves();
    app(TenantContext::class)->set($shelf, null);

    expect(Gate::forUser($user)->allows('act-as-reader'))->toBeTrue()
        ->and(Gate::forUser($user)->allows('act-as-manager'))->toBeTrue()
        ->and(Gate::forUser($user)->allows('act-as-admin'))->toBeTrue();
});

it('grants a super admin every gate even with a mere reader membership bound', function () {
    // Gate::before short-circuits before the per-gate closure runs at all —
    // proves the super admin flag outranks whatever role the bound
    // membership itself carries, not just the "no membership" case above.
    $user = authzUser(superAdmin: true);
    authzBind($user, 'reader');

    expect(Gate::forUser($user)->allows('act-as-admin'))->toBeTrue();
});

it('denies a membership belonging to a different user than the one being checked', function () {
    // Belt-and-braces guard in the gate closure: TenantContext holds
    // someone else's membership row relative to the user actually being
    // authorised.
    $owner = authzUser();
    $membership = authzBind($owner, 'admin');
    $stranger = authzUser();
    app(TenantContext::class)->set($membership->bookshelf, $membership);

    expect(Gate::forUser($stranger)->allows('act-as-reader'))->toBeFalse();
});
