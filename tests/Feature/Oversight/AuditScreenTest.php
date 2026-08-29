<?php

use App\Models\AuditLog;
use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Inertia\Testing\AssertableInertia as Assert;

/** Grep first: `grep -rn "^function ascrFix" tests/`. */
function ascrFix(): array
{
    app(TenantContext::class)->actSystemWide();

    $shelf = Bookshelf::factory()->create(['slug' => 'dong-thap-ascr', 'settings' => []]);
    $manager = User::factory()->create(['full_name' => 'Maria Xem Nhật Ký']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);
    $reader = User::factory()->create(['full_name' => 'Anna Chỉ Đọc']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $reader->id, 'role' => 'reader', 'status' => 'active',
    ]);

    AuditLog::query()->create([
        'bookshelf_id' => $shelf->id, 'actor_id' => $manager->id,
        'action' => 'copy.lost_reported', 'entity_type' => 'copy', 'entity_id' => null,
        'before' => ['state' => 'on_loan'], 'after' => ['state' => 'lost', 'note' => null],
        'context' => [], 'occurred_at' => '2026-08-20 03:15:00',
    ]);

    return compact('shelf', 'manager', 'reader');
}

it('renders the log for a manager, sentence and expansion in the props', function () {
    $f = ascrFix();

    $this->actingAs($f['manager'])
        ->get("/shelves/{$f['shelf']->slug}/manage/audit")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('manage/audit')
            ->where('log.total', 1)
            ->where('log.rows.0.sentence', 'Maria Xem Nhật Ký đã báo mất một bản sách')
            ->where('log.rows.0.group', 'books')
            ->where('log.rows.0.action', 'copy.lost_reported')
            ->where('log.rows.0.expansion.0.field', 'note')
            ->where('log.rows.0.expansion.0.before', '—')
            ->where('log.rows.0.expansion.0.after', 'null')
            ->where('actors.0.name', 'Maria Xem Nhật Ký')
            ->where('filters.actor', null));
});

it('404s a reader — the interface hiding a page is never the security control', function () {
    $f = ascrFix();

    $this->actingAs($f['reader'])
        ->get("/shelves/{$f['shelf']->slug}/manage/audit")
        ->assertNotFound();
});

it('redirects a guest to login', function () {
    $f = ascrFix();

    $this->get("/shelves/{$f['shelf']->slug}/manage/audit")->assertRedirect();
});

it('404s a manager from another shelf', function () {
    $f = ascrFix();

    app(TenantContext::class)->actSystemWide();
    $otherShelf = Bookshelf::factory()->create(['slug' => 'can-tho-ascr', 'settings' => []]);
    $otherManager = User::factory()->create(['full_name' => 'Manager Tủ Khác']);
    Membership::factory()->for($otherShelf)->create([
        'user_id' => $otherManager->id, 'role' => 'manager', 'status' => 'active',
    ]);
    app(TenantContext::class)->clear();

    $this->actingAs($otherManager)
        ->get("/shelves/{$f['shelf']->slug}/manage/audit")
        ->assertNotFound();
});

it('404s a suspended manager', function () {
    $f = ascrFix();

    app(TenantContext::class)->actSystemWide();
    $suspended = User::factory()->create(['full_name' => 'Manager Bị Đình Chỉ']);
    Membership::factory()->for($f['shelf'])->create([
        'user_id' => $suspended->id, 'role' => 'manager', 'status' => 'suspended',
    ]);
    app(TenantContext::class)->clear();

    $this->actingAs($suspended)
        ->get("/shelves/{$f['shelf']->slug}/manage/audit")
        ->assertNotFound();
});

it('lets a super-admin through with no membership at all', function () {
    $f = ascrFix();

    app(TenantContext::class)->actSystemWide();
    $superAdmin = User::factory()->superAdmin()->create(['full_name' => 'Super Admin']);
    app(TenantContext::class)->clear();

    $this->actingAs($superAdmin)
        ->get("/shelves/{$f['shelf']->slug}/manage/audit")
        ->assertOk();
});

it('survives hostile filter values with 200 and an ignored filter, never a 500', function () {
    $f = ascrFix();

    // ?actor= carrying Vietnamese text or an emoji is the exact shape that
    // has produced a live 1267-collation 500 six times in this repo; the
    // controller must refuse it BEFORE any ascii_bin bind. Arrays too —
    // QueryParam's repeated-key lesson.
    foreach (['actor=Giáo họ Đức Mẹ', 'actor=📚', 'actor[]=a&actor[]=b',
        'group=constructor', 'from=2026-02-31', 'to=không-phải-ngày', 'page=-3'] as $qs) {
        $this->actingAs($f['manager'])
            ->get("/shelves/{$f['shelf']->slug}/manage/audit?{$qs}")
            ->assertOk();
    }
});

it('accepts a well-formed actor filter only when that person has entries here', function () {
    $f = ascrFix();
    $stranger = User::factory()->create(['full_name' => 'Người Lạ Hoàn Toàn']);

    $this->actingAs($f['manager'])
        ->get("/shelves/{$f['shelf']->slug}/manage/audit?actor={$stranger->id}")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->where('filters.actor', null)->where('log.total', 1));
});

it('accepts a well-formed actor filter when that person does have entries here', function () {
    $f = ascrFix();

    $this->actingAs($f['manager'])
        ->get("/shelves/{$f['shelf']->slug}/manage/audit?actor={$f['manager']->id}")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->where('filters.actor', $f['manager']->id)
            ->where('log.total', 1));
});

it('accepts a well-formed group filter and narrows to that group', function () {
    $f = ascrFix();

    $this->actingAs($f['manager'])
        ->get("/shelves/{$f['shelf']->slug}/manage/audit?group=books")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->where('filters.group', 'books')
            ->where('log.total', 1));

    $this->actingAs($f['manager'])
        ->get("/shelves/{$f['shelf']->slug}/manage/audit?group=loans")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->where('filters.group', 'loans')
            ->where('log.total', 0));
});

it('rejects an unrecognised group, mapping filters.group to null rather than echoing it back', function () {
    $f = ascrFix();

    $this->actingAs($f['manager'])
        ->get("/shelves/{$f['shelf']->slug}/manage/audit?group=constructor")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->where('filters.group', null)
            ->where('log.total', 1));
});

it('rejects a calendar-invalid date like 2026-02-31, mapping filters.from to null rather than rolling it over', function () {
    $f = ascrFix();

    $this->actingAs($f['manager'])
        ->get("/shelves/{$f['shelf']->slug}/manage/audit?from=2026-02-31")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->where('filters.from', null));
});

it('accepts well-formed from/to dates and narrows the range', function () {
    $f = ascrFix();

    $this->actingAs($f['manager'])
        ->get("/shelves/{$f['shelf']->slug}/manage/audit?from=2026-08-20&to=2026-08-20")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->where('filters.from', '2026-08-20')
            ->where('filters.to', '2026-08-20')
            ->where('log.total', 1));

    $this->actingAs($f['manager'])
        ->get("/shelves/{$f['shelf']->slug}/manage/audit?from=2026-08-21")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->where('filters.from', '2026-08-21')
            ->where('log.total', 0));
});

/**
 * The hostile-input matrix (Task 13's bar: array, nested array, empty
 * array, NUL byte, invalid UTF-8, oversized) over every query-string
 * parameter this screen reads: actor, group, from, to, page. None may
 * 500 — the controller's validation gate must refuse every shape before
 * it reaches AuditLogQuery::run().
 */
function ascrPayloads(): array
{
    return [
        'array' => ['x', 'y'],
        'nested array' => [['a' => ['b' => 'c']]],
        'empty array' => [],
        'NUL byte' => "de men\x00phieu luu",
        'invalid UTF-8' => "\xC3\x28",
        'oversized' => str_repeat('a', 100000),
    ];
}

foreach (['actor', 'group', 'from', 'to', 'page'] as $param) {
    foreach (ascrPayloads() as $label => $payload) {
        it("GET /audit ?{$param}= survives a {$label} payload", function () use ($param, $payload) {
            $f = ascrFix();

            $query = is_array($payload)
                ? http_build_query([$param => $payload])
                : $param.'='.rawurlencode((string) $payload);

            $response = $this->actingAs($f['manager'])
                ->get("/shelves/{$f['shelf']->slug}/manage/audit?{$query}");

            expect($response->status())->not->toBe(500);
        });
    }
}
