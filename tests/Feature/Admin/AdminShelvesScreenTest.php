<?php

use App\Models\Bookshelf;
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
 * `managersMissing`'s VALUE is deliberately not asserted here: it is
 * asserted in Task 7 through the revoke path that produces it, so the
 * assertion proves the flag tracks the act rather than tracking a fixture.
 * Its presence in the prop is asserted, so it cannot silently vanish
 * between now and then.
 *
 * Grep first: `grep -rn "^function adminShelvesFix" tests/`.
 */
function adminShelvesFix(): User
{
    app(TenantContext::class)->actSystemWide();
    Bookshelf::factory()->create(['slug' => 'shelf-a-list', 'name' => 'Aó Dài', 'settings' => []]);

    return User::factory()->create(['is_super_admin' => true]);
}

it('renders the real shelves list, not the placeholder', function () {
    $admin = adminShelvesFix();

    $this->actingAs($admin)
        ->get('/admin/shelves')
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('admin/shelves/index')
            ->has('shelves', 1)
            ->where('shelves.0.name', 'Aó Dài')
            ->where('shelves.0.slug', 'shelf-a-list')
            ->where('shelves.0.status', 'active')
            ->has('shelves.0.contactsMissing')
            ->has('shelves.0.managersMissing'));
});
