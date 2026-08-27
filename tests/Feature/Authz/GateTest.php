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
    // $status is exercised by the defence-in-depth test below: this shape
    // (a non-active membership bound straight into TenantContext) is
    // unreachable via ResolveTenant in real traffic — ResolveTenant only
    // ever resolves an active row — but the gate closure checks status on
    // its own terms too (AppServiceProvider::boot()), precisely so it does
    // not depend forever on being the only caller of TenantContext::set().
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

// Gate::before is scoped to act-as-* by name so it never becomes a blanket
// bypass: BR §2 requires "nobody decides their own proposal, including a
// super administrator", so a future ability outside the role hierarchy
// (e.g. decide-proposal) must fall through to its OWN definition instead of
// being silently pre-approved for a super admin. Registering an undefined
// ability and proving it denies (Laravel denies any ability with no
// definition and no unconditional Gate::before) is the tightest proof
// available without inventing a real decide-proposal gate here.
it('does not auto-grant an ability outside the act-as-* role hierarchy to a super admin', function () {
    $user = authzUser(superAdmin: true);

    expect(Gate::forUser($user)->allows('decide-proposal'))->toBeFalse();
});

it('denies every gate for a non-active membership bound directly into TenantContext, independent of ResolveTenant', function (string $status) {
    // ResolveTenant never hands the gate a non-active membership in real
    // traffic (see EnsureShelfRoleTest for that end-to-end proof) — but
    // this test proves the gate closure ALSO checks status itself, rather
    // than trusting TenantContext::set()'s only current caller forever.
    // Uses 'admin', the highest role, so a pass could only be coming from
    // status being ignored, never from role being too low.
    $user = authzUser();
    authzBind($user, 'admin', $status);

    expect(Gate::forUser($user)->allows('act-as-reader'))->toBeFalse()
        ->and(Gate::forUser($user)->allows('act-as-manager'))->toBeFalse()
        ->and(Gate::forUser($user)->allows('act-as-admin'))->toBeFalse();
})->with(['pending', 'suspended', 'left']);
