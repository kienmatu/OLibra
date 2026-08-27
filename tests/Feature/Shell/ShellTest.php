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

it('shares the bound shelf and never a foreign one', function () {
    ['a' => $a, 'b' => $b] = TenantHarness::twoCollidingShelves();

    $response = $this->get("/shelves/{$a->slug}");

    // Inertia's page object rides the root view's data in a full-page visit.
    $page = $response->viewData('page');

    expect($page['props']['shelf']['id'])->toBe($a->id)
        ->and(json_encode($page['props']))->not->toContain($b->id);
});
