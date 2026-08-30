<?php

use App\Models\User;
use Tests\Support\TenantHarness;

it('serves the landing page', function () {
    $this->get('/')->assertOk();
});

it('serves the shelf directory and a shelf home by slug', function () {
    ['a' => $a] = TenantHarness::twoCollidingShelves();
    $reader = TenantHarness::readerFor($a);

    $this->get('/shelves')->assertOk();

    // Asserted before actingAs() below, on purpose: actingAs() sets the
    // authenticated user for the rest of the test's HTTP client, not just
    // the one request it decorates, so this has to run first to actually
    // exercise the guest path. The shelf home now carries explicit 'auth'
    // (PR #57 review follow-up 2), and bootstrap/app.php's priority list
    // runs Authenticate ahead of ResolveTenant, so a guest is redirected to
    // login even on an unknown slug — the same "auth ahead of tenant"
    // shape 'redirects a guest from the reader area to login, on both a
    // known and an unknown slug' above already proves for catalogue, and
    // the same shape the /manage group's own guest-redirect test proves.
    $this->get('/shelves/khong-ton-tai')->assertRedirect('/login');

    // PR #57 review follow-up 2: the shelf home is now behind
    // ['auth', 'role:reader'], so it takes an approved member to see it.
    $this->actingAs($reader)->get("/shelves/{$a->slug}")->assertOk();
});

it('redirects a guest from the reader area to login, on both a known and an unknown slug', function () {
    // PR #57 review follow-up 2's own regression to guard, mirroring the
    // /manage group's identical guest-redirect test in RouteIsolationTest:
    // without 'auth' explicit on the route, a guest on an UNKNOWN slug
    // would 404 straight out of ResolveTenant while a guest on a KNOWN
    // slug still redirects via EnsureShelfRole's own guest branch — an
    // unauthenticated existence oracle over the shelf URL space.
    ['a' => $a] = TenantHarness::twoCollidingShelves();

    $this->get("/shelves/{$a->slug}/catalogue")->assertRedirect('/login');
    $this->get('/shelves/khong-ton-tai/catalogue')->assertRedirect('/login');
});

it('gives a signed-in non-member a 404 on the reader area', function () {
    ['a' => $a] = TenantHarness::twoCollidingShelves();
    $user = new User([
        'saint_name' => 'Anna', 'full_name' => 'Phạm Thu Hà',
        'father_name' => 'Cha', 'mother_name' => 'Mẹ',
    ]);
    $user->save();

    $this->actingAs($user)->get("/shelves/{$a->slug}/catalogue")->assertNotFound();
});

it('serves every membership-gated reader-area route to an approved reader', function () {
    ['a' => $a] = TenantHarness::twoCollidingShelves();
    $reader = TenantHarness::readerFor($a);

    foreach (['catalogue', 'search', 'announcements', 'donate', 'scan'] as $path) {
        $this->actingAs($reader)->get("/shelves/{$a->slug}/{$path}")->assertOk();
    }
});

// `feedback` is the one deliberate exemption from the reader gate above —
// routes/web.php's own comment explains why (guest-reachable in the
// original, matching `submitFeedback`'s docstring) — so it is pinned on
// its own, as guest-reachable, rather than folded into the loop above.
it('serves feedback to a guest — the one reader-area route with no membership gate', function () {
    ['a' => $a] = TenantHarness::twoCollidingShelves();

    $this->get("/shelves/{$a->slug}/feedback")->assertOk();
});

// Coordinator correction to follow-up 2: routes/web.php's `profile` group
// now carries `role:reader`, not plain `auth` — every profile page in the
// original gates on `requireReader` per-page (`ho-so/page.tsx` via
// `getMyProfile` -> `requireSelfOrManager`; `ho-so/lich-su`,
// `ho-so/tong-quan`, `ho-so/thong-bao`, `ho-so/tang-sach` via
// `requireReader`), each refusal turned into `notFound()` by `loadPage`
// (`src/lib/reader-area.ts:29-40`). A signed-in non-member gets 404 there,
// same as every other reader-area route, not the 200 the old plain-`auth`
// gate produced.
it('redirects a guest from the profile area, 404s a signed-in non-member', function () {
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
        $this->actingAs($user)->get("/shelves/{$a->slug}/{$path}")->assertNotFound();
    }
});

// The name says "reader area" rather than "skeleton": four of these
// five paths are real screens now (history and overview from 1c,
// notifications from 2a's Task 16, and donations from 2b's Task 18),
// and 'profile' still renders under-construction. What this block
// has always asserted is the ACCESS half — that role:reader admits an
// approved reader to every path in the group — which is as true of a
// finished screen as of a placeholder, and is the half its sibling
// above (the non-member's 404) is the mirror of.
it('serves the whole reader profile area to an approved reader', function () {
    ['a' => $a] = TenantHarness::twoCollidingShelves();
    $reader = TenantHarness::readerFor($a);

    foreach ([
        'profile', 'profile/history', 'profile/notifications',
        'profile/donations', 'profile/overview',
    ] as $path) {
        $this->actingAs($reader)->get("/shelves/{$a->slug}/{$path}")->assertOk();
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
    $reader = TenantHarness::readerFor($a);

    $response = $this->actingAs($reader)->get("/shelves/{$a->slug}");

    // Inertia's page object rides the root view's data in a full-page visit.
    $page = $response->viewData('page');

    expect($page['props']['shelf']['id'])->toBe($a->id)
        ->and(json_encode($page['props']))->not->toContain($b->id);
});
