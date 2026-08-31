<?php

use App\Enums\BookshelfStatus;
use App\Models\Bookshelf;
use App\Models\User;
use App\Support\TenantContext;
use Illuminate\Support\Facades\Gate;

/**
 * Spec D9's policy, tested where it can actually be falsified.
 *
 * **The obvious test is worthless and is deliberately not here.** "A
 * signed-in non-super-admin gets 404 on /admin/shelves" is already true of
 * every route in the group from `EnsureSuperAdmin.php:20`, which runs
 * before any policy is consulted — delete `BookshelfPolicy.php` entirely
 * and that assertion still passes. A test that cannot go red for the thing
 * it names is not evidence, and `AdminDashboardScreenTest` already owns the
 * middleware's own refusal.
 *
 * What only the policy can answer is the OBJECT-level question: a caller
 * who has cleared the middleware — a real super admin — refused on a
 * specific shelf because of that shelf's own state. `Gate::inspect()` is
 * used rather than an HTTP call because Task 3 builds no per-shelf route
 * yet (Tasks 4-6 do); the Response object it returns carries the status
 * code, which is the whole point of the `denyAsNotFound()` shape.
 *
 * Grep first: `grep -rn "^function shelfPolicyFix" tests/`.
 *
 * @return array{User, Bookshelf}
 */
function shelfPolicyFix(BookshelfStatus $status): array
{
    // Bookshelf is not shelf-scoped, but the admin area binds no tenant and
    // the factory runs outside a request, so widen the way the other admin
    // fixtures do rather than depending on ambient state.
    app(TenantContext::class)->actSystemWide();

    $shelf = Bookshelf::factory()->create([
        'slug' => 'shelf-policy-'.$status->value,
        'settings' => [],
        'status' => $status,
    ]);

    return [User::factory()->create(['is_super_admin' => true]), $shelf];
}

it('refuses a super admin on an already-archived shelf, as a 404', function () {
    [$admin, $archived] = shelfPolicyFix(BookshelfStatus::Archived);

    $decision = Gate::forUser($admin)->inspect('archive', $archived);

    // Both halves matter. denied() alone would pass for an ordinary
    // `return false`, which Gate::authorize renders as 403 — the status
    // code spec §5.4 forbids here, because it tells the caller the row
    // exists. The 404 is what denyAsNotFound() buys.
    expect($decision->denied())->toBeTrue()
        ->and($decision->status())->toBe(404);
});

it('refuses a super admin on un-archiving a shelf that is not archived, as a 404', function () {
    // The mirror, so the state check cannot be satisfied by a method that
    // refuses everything or by one that refuses nothing.
    [$admin, $active] = shelfPolicyFix(BookshelfStatus::Active);

    $decision = Gate::forUser($admin)->inspect('unarchive', $active);

    expect($decision->denied())->toBeTrue()
        ->and($decision->status())->toBe(404);
});

it('allows a super admin the acts a shelf in the right state can take', function () {
    [$admin, $active] = shelfPolicyFix(BookshelfStatus::Active);

    expect(Gate::forUser($admin)->inspect('archive', $active)->allowed())->toBeTrue()
        ->and(Gate::forUser($admin)->inspect('view', $active)->allowed())->toBeTrue()
        ->and(Gate::forUser($admin)->inspect('viewAny', Bookshelf::class)->allowed())->toBeTrue();
});

it('refuses an ordinary user with 404 rather than 403 at the gate itself', function () {
    // Not the middleware's refusal — the gate's. EnsureSuperAdmin never
    // runs here, so this is the policy's own answer, and the status it
    // carries is the reason every method returns Response rather than bool.
    [, $active] = shelfPolicyFix(BookshelfStatus::Active);
    $ordinary = User::factory()->create(['is_super_admin' => false]);

    $decision = Gate::forUser($ordinary)->inspect('view', $active);

    expect($decision->denied())->toBeTrue()
        ->and($decision->status())->toBe(404);
});
