<?php

use App\Models\Membership;
use App\Models\User;
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
    if (! Route::has('authz-test.manager-probe')) {
        Route::middleware(['web', 'tenant', 'role:manager'])
            ->get('/shelves/{shelf}/manager-probe', fn () => response()->json(['ok' => true]))
            ->name('authz-test.manager-probe');
    }

    if (! Route::has('authz-test.admin-probe')) {
        Route::middleware(['web', 'tenant', 'role:admin'])
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
