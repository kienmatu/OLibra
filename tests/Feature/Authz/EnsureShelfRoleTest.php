<?php

use App\Http\Middleware\EnsureShelfRole;
use App\Models\Membership;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Route;
use Tests\Support\TenantHarness;

/**
 * Exercises `role:manager`/`role:admin` through the real HTTP stack —
 * ResolveTenant binding TenantContext, then EnsureShelfRole gating on it —
 * rather than seeding TenantContext directly. That distinction matters for
 * status: ResolveTenant (Task 16) resolves ONLY an active, non-soft-deleted
 * membership (see its docstring and the known-gaps entry on
 * withoutGlobalScopes()), so a suspended/pending/left/rejected membership
 * never reaches TenantContext at all in real traffic. Seeding a suspended
 * membership straight into TenantContext would prove the gate closure
 * happens to ignore status; it would not prove the actual failure mode BR
 * §2 cares about, which is a suspended member walking a real URL — that
 * requires going through ResolveTenant, so these tests do.
 */
beforeEach(function () {
    // Route::has guard: this file's routes must survive being registered
    // once per process, the same reasoning ResolveTenantMiddlewareTest
    // documents for its own probe route.
    //
    // ['web', 'auth', 'tenant', 'role:*'] — not ['web', 'tenant', 'role:*'] —
    // because this file is the canonical usage example Task 18's real
    // routes copy, and `auth` is what makes the unknown-slug-as-guest case
    // below meaningful: on THIS stack, Authenticate runs before
    // ResolveTenant (bootstrap/app.php's prependToPriorityList puts it
    // there) and redirects a guest to login before ResolveTenant ever
    // 404s an unknown slug. Drop `auth` and a guest hitting an unknown
    // slug gets 404 straight from ResolveTenant instead of a redirect — an
    // unauthenticated existence oracle over the shelf URL space, exactly
    // what that priority fix exists to close. Without `auth` here,
    // EnsureShelfRole's own guest branch is also unreachable dead code,
    // since ResolveTenant would already have aborted or Authenticate would
    // already have redirected first depending on slug validity.
    if (! Route::has('authz-test.reader-probe')) {
        Route::middleware(['web', 'auth', 'tenant', 'role:reader'])
            ->get('/shelves/{shelf}/reader-probe', fn () => response()->json(['ok' => true]))
            ->name('authz-test.reader-probe');
    }

    if (! Route::has('authz-test.manager-probe')) {
        Route::middleware(['web', 'auth', 'tenant', 'role:manager'])
            ->get('/shelves/{shelf}/manager-probe', fn () => response()->json(['ok' => true]))
            ->name('authz-test.manager-probe');
    }

    if (! Route::has('authz-test.admin-probe')) {
        Route::middleware(['web', 'auth', 'tenant', 'role:admin'])
            ->get('/shelves/{shelf}/admin-probe', fn () => response()->json(['ok' => true]))
            ->name('authz-test.admin-probe');
    }
});

function authzMiddlewareUser(bool $superAdmin = false): User
{
    $user = new User([
        'saint_name' => 'Anna', 'full_name' => 'Phạm Thu Hà',
        'father_name' => 'Cha', 'mother_name' => 'Mẹ',
    ]);
    $user->username = 'ha-'.uniqid();
    $user->password_hash = Hash::make('mat-khau-123');
    $user->is_super_admin = $superAdmin;
    $user->save();

    return $user;
}

it('redirects a guest to login instead of refusing — they have not failed authorisation, they have not authenticated', function () {
    ['a' => $shelf] = TenantHarness::twoCollidingShelves();

    $this->get("/shelves/{$shelf->slug}/manager-probe")
        ->assertRedirectToRoute('login');
});

it('passes an active reader through the reader gate', function () {
    ['a' => $shelf] = TenantHarness::twoCollidingShelves();
    $user = authzMiddlewareUser();
    Membership::query()->withoutGlobalScopes()->create([
        'bookshelf_id' => $shelf->id, 'user_id' => $user->id, 'role' => 'reader', 'status' => 'active',
    ]);

    $this->actingAs($user)->get("/shelves/{$shelf->slug}/reader-probe")
        ->assertOk()->assertJson(['ok' => true]);
});

it('404s a suspended reader on the reader gate — BR §2: suspended blocks new activity, it does not merely relabel', function () {
    ['a' => $shelf] = TenantHarness::twoCollidingShelves();
    $user = authzMiddlewareUser();
    Membership::query()->withoutGlobalScopes()->create([
        'bookshelf_id' => $shelf->id, 'user_id' => $user->id, 'role' => 'reader', 'status' => 'suspended',
    ]);

    $this->actingAs($user)->get("/shelves/{$shelf->slug}/reader-probe")
        ->assertNotFound();
});

it('404s an active reader on the manager gate', function () {
    ['a' => $shelf] = TenantHarness::twoCollidingShelves();
    $user = authzMiddlewareUser();
    Membership::query()->withoutGlobalScopes()->create([
        'bookshelf_id' => $shelf->id, 'user_id' => $user->id, 'role' => 'reader', 'status' => 'active',
    ]);

    $this->actingAs($user)->get("/shelves/{$shelf->slug}/manager-probe")
        ->assertNotFound();
});

it('passes an active manager through the manager gate', function () {
    ['a' => $shelf] = TenantHarness::twoCollidingShelves();
    $user = authzMiddlewareUser();
    Membership::query()->withoutGlobalScopes()->create([
        'bookshelf_id' => $shelf->id, 'user_id' => $user->id, 'role' => 'manager', 'status' => 'active',
    ]);

    $this->actingAs($user)->get("/shelves/{$shelf->slug}/manager-probe")
        ->assertOk()->assertJson(['ok' => true]);
});

it('passes an active shelf admin through the manager gate too — admin ⊃ manager', function () {
    ['a' => $shelf] = TenantHarness::twoCollidingShelves();
    $user = authzMiddlewareUser();
    Membership::query()->withoutGlobalScopes()->create([
        'bookshelf_id' => $shelf->id, 'user_id' => $user->id, 'role' => 'admin', 'status' => 'active',
    ]);

    $this->actingAs($user)->get("/shelves/{$shelf->slug}/manager-probe")
        ->assertOk();
});

it('404s an active manager on the admin gate — manager does not imply admin', function () {
    ['a' => $shelf] = TenantHarness::twoCollidingShelves();
    $user = authzMiddlewareUser();
    Membership::query()->withoutGlobalScopes()->create([
        'bookshelf_id' => $shelf->id, 'user_id' => $user->id, 'role' => 'manager', 'status' => 'active',
    ]);

    $this->actingAs($user)->get("/shelves/{$shelf->slug}/admin-probe")
        ->assertNotFound();
});

it('passes an active shelf admin through the admin gate', function () {
    ['a' => $shelf] = TenantHarness::twoCollidingShelves();
    $user = authzMiddlewareUser();
    Membership::query()->withoutGlobalScopes()->create([
        'bookshelf_id' => $shelf->id, 'user_id' => $user->id, 'role' => 'admin', 'status' => 'active',
    ]);

    $this->actingAs($user)->get("/shelves/{$shelf->slug}/admin-probe")
        ->assertOk();
});

it('404s a manager or admin membership that is not active — status gates as hard as role', function (string $role, string $status) {
    // BR §2: a suspended member is blocked from acting, not merely
    // relabelled. ResolveTenant excludes this row from TenantContext
    // entirely, so the manager gate sees "no membership" and denies —
    // proven here through the real HTTP/middleware path, not by seeding
    // TenantContext by hand.
    ['a' => $shelf] = TenantHarness::twoCollidingShelves();
    $user = authzMiddlewareUser();
    Membership::query()->withoutGlobalScopes()->create([
        'bookshelf_id' => $shelf->id, 'user_id' => $user->id, 'role' => $role, 'status' => $status,
        'rejection_reason' => $status === 'rejected' ? 'khong phu hop' : null,
    ]);

    $this->actingAs($user)->get("/shelves/{$shelf->slug}/manager-probe")
        ->assertNotFound();
})->with([
    ['manager', 'pending'],
    ['manager', 'suspended'],
    ['manager', 'left'],
    ['manager', 'rejected'],
    ['admin', 'pending'],
    ['admin', 'suspended'],
    ['admin', 'left'],
    ['admin', 'rejected'],
]);

it('404s a soft-deleted admin membership on the admin gate, even though its status column still reads active', function () {
    ['a' => $shelf] = TenantHarness::twoCollidingShelves();
    $user = authzMiddlewareUser();
    $membership = Membership::query()->withoutGlobalScopes()->create([
        'bookshelf_id' => $shelf->id, 'user_id' => $user->id, 'role' => 'admin', 'status' => 'active',
    ]);
    $membership->delete();

    $this->actingAs($user)->get("/shelves/{$shelf->slug}/admin-probe")
        ->assertNotFound();
});

it('404s a member of a foreign shelf, never confirming their standing elsewhere', function () {
    ['a' => $a, 'b' => $b] = TenantHarness::twoCollidingShelves();
    $user = authzMiddlewareUser();
    Membership::query()->withoutGlobalScopes()->create([
        'bookshelf_id' => $a->id, 'user_id' => $user->id, 'role' => 'admin', 'status' => 'active',
    ]);

    $this->actingAs($user)->get("/shelves/{$b->slug}/manager-probe")
        ->assertNotFound();
});

it('passes a super admin through the admin gate on a shelf they have no membership of at all', function () {
    ['a' => $shelf] = TenantHarness::twoCollidingShelves();
    $user = authzMiddlewareUser(superAdmin: true);

    $this->actingAs($user)->get("/shelves/{$shelf->slug}/admin-probe")
        ->assertOk();
});

it('404s an unknown shelf slug before any role is even evaluated', function () {
    $user = authzMiddlewareUser();

    $this->actingAs($user)->get('/shelves/khong-ton-tai/manager-probe')
        ->assertNotFound();
});

it('redirects a guest to login on an unknown shelf slug too, rather than 404ing — no unauthenticated existence oracle over the shelf URL space', function () {
    // With `auth` ahead of `tenant`/ResolveTenant in the route's
    // middleware (bootstrap/app.php's prependToPriorityList orders
    // Authenticate before ResolveTenant regardless of the array order
    // written on the route), a guest is turned away before ResolveTenant
    // ever runs its own 404-on-unknown-slug check. Without `auth` on this
    // route, a guest hitting an unknown slug would 404 from ResolveTenant
    // while a guest hitting a KNOWN slug gets redirected — a way to probe
    // slug existence with no session at all. This is the property that
    // requires the exact stack Task 18's real routes use.
    $this->get('/shelves/khong-ton-tai/manager-probe')
        ->assertRedirectToRoute('login');
});

it('fails loudly on an unknown role name rather than silently granting a super admin an undefined ability', function () {
    // Gate::before runs BEFORE Laravel checks whether an ability is even
    // defined, so `role:managerr` (typo) would build the never-defined
    // ability "act-as-managerr" — which a super admin passes automatically,
    // turning a typo into a silent super-admin-only route. Validating
    // against the enum makes that a loud, immediate failure instead, for
    // every request, super admin included.
    $middleware = new EnsureShelfRole;
    $request = Request::create('/shelves/x/bogus-probe');

    expect(fn () => $middleware->handle($request, fn ($req) => response('unreachable'), 'managerr'))
        ->toThrow(InvalidArgumentException::class, 'Unknown shelf role in route middleware: "managerr".');
});
