<?php

use App\Enums\MembershipRole;
use App\Enums\MembershipStatus;
use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Inertia\Testing\AssertableInertia;

/**
 * `/admin/shelves` stops being `ShellController::underConstruction`.
 *
 * The object-level authorization this screen's policy adds is pinned in
 * `BookshelfPolicyTest`, not here — see that file's docblock for why a
 * "non-super-admin gets 404" assertion cannot falsify the policy. What is
 * left for this file is that the route now reaches the real component with
 * the real row shape.
 *
 * `managersMissing`'s PREDICATE lives in `AdminManagersMissingTest`, which
 * pins its six cases through the acts that move it. What this file owns is
 * that the flag REACHES THE SCREEN — both of them — and reaches it with the
 * value the query computed.
 *
 * BOTH POLARITIES ON ONE READ, and that is the whole shape of the
 * assertion. `->has('shelves.0.managersMissing')` was the original spelling
 * and a hard-coded `false` passed it; so would a hard-coded `true`, and so
 * would a single-shelf fixture asserted at one value. Two shelves — one
 * unmanned, one with an active manager — cannot both be satisfied by any
 * constant, so a prop that stopped tracking the query goes red here.
 *
 * Grep first: `grep -rn "^function adminShelvesFix" tests/`.
 */
function adminShelvesFix(): User
{
    app(TenantContext::class)->actSystemWide();
    Bookshelf::factory()->create(['slug' => 'shelf-a-list', 'name' => 'Aó Dài', 'settings' => []]);

    // The manned twin, so no constant can satisfy both rows. Named to sort
    // after 'Aó Dài' — AdminOverviewQuery orders by name — so the indices
    // below are stable.
    $manned = Bookshelf::factory()->create(['slug' => 'shelf-b-list', 'name' => 'Bến Tre', 'settings' => []]);
    Membership::factory()->create([
        'bookshelf_id' => $manned->id,
        'user_id' => User::factory()->create()->id,
        'role' => MembershipRole::Manager,
        'status' => MembershipStatus::Active,
    ]);

    return User::factory()->create(['is_super_admin' => true]);
}

it('renders the real shelves list, not the placeholder', function () {
    $admin = adminShelvesFix();

    $this->actingAs($admin)
        ->get('/admin/shelves')
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('admin/shelves/index')
            ->has('shelves', 2)
            ->where('shelves.0.name', 'Aó Dài')
            ->where('shelves.0.slug', 'shelf-a-list')
            ->where('shelves.0.status', 'active')
            ->has('shelves.0.contactsMissing')
            // The VALUE, both ways, on one read — see this file's docblock.
            ->where('shelves.0.managersMissing', true)
            ->where('shelves.1.name', 'Bến Tre')
            ->where('shelves.1.managersMissing', false));
});

it('sends managersMissing to the DASHBOARD too, with the same two values', function () {
    // Nothing asserted the flag reached `/admin` at all, and that screen
    // renders its own badge from the same prop — so the two admin screens
    // could have disagreed with the query, or with each other, silently.
    $admin = adminShelvesFix();

    $this->actingAs($admin)
        ->get('/admin')
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('admin/dashboard')
            ->has('shelves', 2)
            ->where('shelves.0.name', 'Aó Dài')
            ->where('shelves.0.managersMissing', true)
            ->where('shelves.1.name', 'Bến Tre')
            ->where('shelves.1.managersMissing', false));
});
