<?php

use App\Models\Bookshelf;
use App\Models\User;
use App\Support\TenantContext;
use Inertia\Testing\AssertableInertia;

/** Grep first: `grep -rn "^function adminScreenFix" tests/`. */
function adminScreenFix(): User
{
    app(TenantContext::class)->actSystemWide();
    Bookshelf::factory()->create(['slug' => 'shelf-a-dash', 'name' => 'Aó Dài', 'settings' => []]);

    return User::factory()->create(['is_super_admin' => true]);
}

it('renders the dashboard with a row per shelf', function () {
    $admin = adminScreenFix();

    $this->actingAs($admin)
        ->get('/admin')
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('admin/dashboard')
            ->has('shelves', 1)
            ->has('shelves.0.books')
            ->has('shelves.0.pending')
            ->has('shelves.0.contactsMissing'));
});

it('a signed-in non-super-admin meets 404, never 403', function () {
    // Spec §5.4: a refusal must not confirm which URLs exist. NOT vacuous —
    // /admin is claimed by this task's own route, so this asserts
    // EnsureSuperAdmin's refusal rather than the router's absence. Re-check
    // it after the route lands.
    adminScreenFix();
    $ordinary = User::factory()->create(['is_super_admin' => false]);

    $this->actingAs($ordinary)->get('/admin')->assertNotFound();
});

it('a guest is redirected to login rather than 404d', function () {
    // Name the target: a bare assertRedirect() passes on ANY 3xx, including
    // a redirect somewhere wrong.
    adminScreenFix();

    $this->get('/admin')->assertRedirect(route('login'));
});
