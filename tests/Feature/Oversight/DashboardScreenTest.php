<?php

use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Carbon\Carbon;
use Inertia\Testing\AssertableInertia as Assert;

afterEach(fn () => Carbon::setTestNow());

/** Grep first: `grep -rn "^function mdsFix" tests/`. */
function mdsFix(): array
{
    app(TenantContext::class)->actSystemWide();

    $shelf = Bookshelf::factory()->create(['slug' => 'dong-thap-mds', 'settings' => []]);
    $manager = User::factory()->create(['full_name' => 'Maria Trang Chính']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);
    $reader = User::factory()->create(['full_name' => 'Anna Không Được Vào']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $reader->id, 'role' => 'reader', 'status' => 'active',
    ]);
    $pending = User::factory()->create(['full_name' => 'Têrêsa Chờ Duyệt MDS']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $pending->id, 'role' => 'reader', 'status' => 'pending',
    ]);

    app(TenantContext::class)->clear();

    return compact('shelf', 'manager', 'reader');
}

// ── behaviour ────────────────────────────────────────────────────────────

it('renders live counts, totals and today from the injected clock', function () {
    $f = mdsFix();
    Carbon::setTestNow(Carbon::parse('2026-08-20 03:00:00', 'UTC'));

    $this->actingAs($f['manager'])
        ->get("/shelves/{$f['shelf']->slug}/manage")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('manage/dashboard')
            ->where('dashboard.counts.overdue', 0)
            ->where('dashboard.counts.pendingRegistrations', 1)
            ->where('dashboard.totals.readers', 2)   // manager + active reader
            ->where('today', '2026-08-20'));
});

it('today is the VN civil day, not the UTC one', function () {
    $f = mdsFix();
    // 18:30 UTC is already tomorrow morning in Hồ Chí Minh City.
    Carbon::setTestNow(Carbon::parse('2026-08-20 18:30:00', 'UTC'));

    $this->actingAs($f['manager'])
        ->get("/shelves/{$f['shelf']->slug}/manage")
        ->assertInertia(fn (Assert $page) => $page->where('today', '2026-08-21'));
});

// ── authorization matrix — BR §5.4: every refusal is a 404, never a 403.
// Each actor gets its own it(): the acting user persists across calls
// within a single test method (a reviewer's own matrix was contaminated by
// exactly that trap — AGENTS.md/the brief both call this out), so mixing
// actors inside one test would silently pass on a cached session rather
// than a fresh unauthenticated/unauthorized request. ─────────────────────

it('redirects a guest to login', function () {
    $f = mdsFix();

    $this->get("/shelves/{$f['shelf']->slug}/manage")->assertRedirect(route('login'));
});

it('404s a reader — the interface hiding a page is never the security control', function () {
    $f = mdsFix();

    $this->actingAs($f['reader'])
        ->get("/shelves/{$f['shelf']->slug}/manage")
        ->assertNotFound();
});

it('404s a manager from another shelf', function () {
    $f = mdsFix();

    app(TenantContext::class)->actSystemWide();
    $otherShelf = Bookshelf::factory()->create(['slug' => 'can-tho-mds', 'settings' => []]);
    $otherManager = User::factory()->create(['full_name' => 'Manager Tủ Khác MDS']);
    Membership::factory()->for($otherShelf)->create([
        'user_id' => $otherManager->id, 'role' => 'manager', 'status' => 'active',
    ]);
    app(TenantContext::class)->clear();

    $this->actingAs($otherManager)
        ->get("/shelves/{$f['shelf']->slug}/manage")
        ->assertNotFound();
});

it('404s a suspended manager of this shelf', function () {
    $f = mdsFix();

    app(TenantContext::class)->actSystemWide();
    $suspended = User::factory()->create(['full_name' => 'Manager Bị Đình Chỉ MDS']);
    Membership::factory()->for($f['shelf'])->create([
        'user_id' => $suspended->id, 'role' => 'manager', 'status' => 'suspended',
    ]);
    app(TenantContext::class)->clear();

    $this->actingAs($suspended)
        ->get("/shelves/{$f['shelf']->slug}/manage")
        ->assertNotFound();
});

it('lets a super-admin through with no membership at all', function () {
    $f = mdsFix();

    app(TenantContext::class)->actSystemWide();
    $superAdmin = User::factory()->superAdmin()->create(['full_name' => 'Super Admin MDS']);
    app(TenantContext::class)->clear();

    $this->actingAs($superAdmin)
        ->get("/shelves/{$f['shelf']->slug}/manage")
        ->assertOk();
});

// ── hostile input — the only attacker-controlled part of this route is the
// {shelf} slug segment: the controller reads no query string and no other
// route parameter. Payload classes match the earlier tasks' bar (187 and
// 249 probes; Task 4's reviewer added 16 more). None may 500 — a wrong
// slug refuses with a 404 from the tenant middleware, never an unhandled
// exception. ────────────────────────────────────────────────────────────

/** @return array<string, string> */
function mdsSegmentPayloads(): array
{
    return [
        'NUL byte' => "dong-thap\x00mds",
        'invalid UTF-8' => "\xC3\x28",
        'oversized' => str_repeat('a', 100000),
        'Vietnamese text, not a slug' => 'Giáo họ Đức Mẹ',
        'emoji' => '📚',
        'path traversal' => '../../etc/passwd',
        'sql-shaped' => "' OR '1'='1",
    ];
}

foreach (mdsSegmentPayloads() as $label => $payload) {
    it("GET /manage survives a {$label} {shelf} route segment", function () use ($payload) {
        $f = mdsFix();

        $response = $this->actingAs($f['manager'])
            ->get('/shelves/'.rawurlencode($payload).'/manage');

        expect($response->status())->not->toBe(500);
    });
}
