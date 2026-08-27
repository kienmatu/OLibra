<?php

use App\Models\User;
use Tests\Support\TenantHarness;

it('serves the landing page', function () {
    $this->get('/')->assertOk();
});

it('serves the shelf directory and a shelf home by slug', function () {
    ['a' => $a] = TenantHarness::twoCollidingShelves();

    $this->get('/shelves')->assertOk();
    $this->get("/shelves/{$a->slug}")->assertOk();
    $this->get('/shelves/khong-ton-tai')->assertNotFound();
});

it('serves every guest-visible skeleton route', function () {
    ['a' => $a] = TenantHarness::twoCollidingShelves();

    foreach (['catalogue', 'search', 'announcements', 'feedback', 'donate', 'scan'] as $path) {
        $this->get("/shelves/{$a->slug}/{$path}")->assertOk();
    }
});

it('serves the profile skeleton to a signed-in user, redirects a guest', function () {
    ['a' => $a] = TenantHarness::twoCollidingShelves();
    $user = new User([
        'saint_name' => 'Anna', 'full_name' => 'Phạm Thu Hà',
        'father_name' => 'Cha', 'mother_name' => 'Mẹ',
    ]);
    $user->save();

    $this->get("/shelves/{$a->slug}/profile")->assertRedirect('/login');

    foreach ([
        'profile', 'profile/history', 'profile/notifications',
        'profile/donations', 'profile/overview',
    ] as $path) {
        $this->actingAs($user)->get("/shelves/{$a->slug}/{$path}")->assertOk();
    }
});

// BR §13.3: every screen must hide what the user cannot do. A super admin
// passes role:* gates on a shelf they hold no membership of at all (the
// Gate::before flag outranks every shelf role), so 'role' in shared props
// is null for them there too — is_super_admin is the only prop that can
// still tell the client "this user can see manage/admin nav" in that case.
it('shares is_super_admin on the bound user, true even with no membership on the shelf', function () {
    ['a' => $a] = TenantHarness::twoCollidingShelves();
    $user = new User([
        'saint_name' => 'Anna', 'full_name' => 'Phạm Thu Hà',
        'father_name' => 'Cha', 'mother_name' => 'Mẹ',
    ]);
    $user->is_super_admin = true; // not fillable — set only by direct assignment
    $user->save();

    $response = $this->actingAs($user)->get("/shelves/{$a->slug}");
    $page = $response->viewData('page');

    expect($page['props']['auth']['user']['is_super_admin'])->toBeTrue()
        ->and($page['props']['role'])->toBeNull();
});

it('shares the bound shelf and never a foreign one', function () {
    ['a' => $a, 'b' => $b] = TenantHarness::twoCollidingShelves();

    $response = $this->get("/shelves/{$a->slug}");

    // Inertia's page object rides the root view's data in a full-page visit.
    $page = $response->viewData('page');

    expect($page['props']['shelf']['id'])->toBe($a->id)
        ->and(json_encode($page['props']))->not->toContain($b->id);
});
