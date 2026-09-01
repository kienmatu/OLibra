<?php

use App\Models\AuditLog;
use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Inertia\Testing\AssertableInertia;

/**
 * Phase 3c-ii Task 6, spec D4 — BR:608's per-manager activity, in full.
 *
 * THERE IS NO SCREEN AND NO QUERY TO TEST, and that is the finding rather
 * than a shortcut. "Everything one manager has done, grouped by type" is
 * `/admin/audit` narrowed to one actor: the browser already filters by
 * actor across every parish and the installation's own rows, and its group
 * chips are the "grouped by type" half. The reference reaches it the same
 * way — its managers list links to its own log with the actor in the query
 * string — and declined to map BR's five example phrases onto audit
 * actions, which would not have partitioned a manager's log anyway.
 *
 * So the whole of the task is a link, and the whole of this file is the two
 * halves a link can break in: the managers screen no longer builds it, or
 * the browser stops honouring the parameter it carries. Both are asserted,
 * because either alone passes while the feature is dead.
 *
 * THE SOURCE READ GOES THROUGH screenSource(), WHICH STRIPS COMMENTS FIRST.
 * The link is explained in a docblock on the component that names the route
 * and the parameter, so a grep over the raw file is satisfied by the prose
 * with the component deleted — the same blindness
 * AdminScreensRenderFeedbackTest's docblock records from three earlier
 * phases.
 *
 * The link exactly as the screen must build it — route name, parameter name
 * and the row's OWN user id, because the log records who ACTED and a
 * membership id here would filter to nobody at all.
 *
 * Both tests below read it, deliberately: "the list links there" and
 * "following it narrows the log" are one claim, and a follow-through that
 * hard-coded `?actor=` would stay green with the link deleted — the half of
 * the falsification that has to fail with the other.
 *
 * Grep first: `grep -rn "^function managerActivityLink" tests/`.
 */
function managerActivityLink(): string
{
    return 'route("admin.audit", { actor: manager.userId })';
}

/**
 * The ActivityLink COMPONENT's own source, comment-stripped and cut out of
 * the file around it.
 *
 * NARROWED TO THE COMPONENT BECAUSE THE WHOLE FILE IS TOO WIDE, measured
 * rather than assumed: the third test below first asserted
 * `manager.lastActiveAt === null` over the whole screen and stayed GREEN
 * with the gate deleted, because ManagerCard formats the same field with
 * the same comparison a few lines down. That is the comment-blindness
 * AdminScreensRenderFeedbackTest documents, in its other form — a guard
 * satisfied by an unrelated line is no more a guard than one satisfied by
 * prose.
 *
 * WHITESPACE IS COLLAPSED before the needles below are looked for, and that
 * is what lets the third test pin a STATEMENT rather than an expression —
 * see managerActivityGuard(). A needle spanning three source lines would
 * otherwise be at the mercy of the formatter's line breaks and indentation.
 *
 * Grep first: `grep -rn "^function managerActivitySource" tests/`.
 */
function managerActivitySource(): string
{
    $source = screenSource('admin/managers/index.tsx');
    $after = preg_split('/function ActivityLink/', $source, 2);

    expect($after)->toHaveCount(2);

    $component = explode('function ManagerCard', (string) $after[1])[0];

    return (string) preg_replace('/\s+/', ' ', $component);
}

/**
 * The GATE, not the comparison — and the difference is the whole of the
 * third test.
 *
 * The needle used to be `manager.lastActiveAt === null` alone, which pins
 * that a comparison EXISTS and not that it stops anything. Deleting the
 * `return null;` underneath it left the test green while shipping exactly
 * the harm the component's docblock describes: an activity link for a
 * manager the log has never named, whose `?actor=` `/admin/audit` reads as
 * "no filter", opening the entire installation's log under one person's
 * name. Falsified by deleting that one line — green before this widening,
 * red after it.
 *
 * Grep first: `grep -rn "^function managerActivityGuard" tests/`.
 */
function managerActivityGuard(): string
{
    return 'if (manager.lastActiveAt === null) { return null; }';
}

it('builds the audit link on the managers screen, in code and not in prose', function () {
    expect(managerActivitySource())->toContain(managerActivityLink());
});

it('shows only that manager\'s rows when the link is followed', function () {
    // The screen still builds the link this test then follows by hand. Read
    // first, so deleting the link reddens the follow-through too rather
    // than leaving it green over a feature nothing can reach.
    expect(managerActivitySource())->toContain(managerActivityLink());

    app(TenantContext::class)->actSystemWide();

    $shelf = Bookshelf::factory()->create([
        'slug' => 'hoat-dong-quan-ly', 'name' => 'Tủ sách Hoạt Động', 'settings' => [],
    ]);
    $admin = User::factory()->create(['is_super_admin' => true, 'full_name' => 'Maria Quản Trị']);

    $manager = User::factory()->create(['full_name' => 'Anna Quản Lý']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);
    $other = User::factory()->create(['full_name' => 'Giuse Quản Lý Khác']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $other->id, 'role' => 'manager', 'status' => 'active',
    ]);

    $log = fn (array $overrides) => AuditLog::query()->create(array_merge([
        'bookshelf_id' => $shelf->id, 'entity_id' => null,
        'before' => null, 'after' => null, 'context' => [],
    ], $overrides));

    // Two of this manager's, in two different GROUPS — the "grouped by
    // type" half of BR:608, answered by the browser's own chips over
    // exactly these rows.
    $log(['actor_id' => $manager->id, 'action' => 'book.created', 'entity_type' => 'book',
        'after' => ['title' => 'Dế Mèn Phiêu Lưu Ký'], 'occurred_at' => '2026-08-10 03:00:00']);
    $log(['actor_id' => $manager->id, 'action' => 'copy.lost_reported', 'entity_type' => 'copy',
        'occurred_at' => '2026-08-10 04:00:00']);
    // The near miss the filter exists for: same shelf, same day, somebody
    // else. Without it the assertion below passes on an unfiltered log.
    $log(['actor_id' => $other->id, 'action' => 'book.created', 'entity_type' => 'book',
        'after' => ['title' => 'Sách Của Người Khác'], 'occurred_at' => '2026-08-10 05:00:00']);

    // The managers list is what hands out the id, so the follow-through
    // starts from the row rather than from a variable this test chose.
    $listed = $this->actingAs($admin)->get('/admin/managers')
        ->assertInertia(fn (AssertableInertia $page) => $page->component('admin/managers/index'))
        ->viewData('page')['props']['managers'];

    $listedRow = collect($listed)->firstWhere('fullName', 'Anna Quản Lý');

    expect($listedRow['userId'])->toBe($manager->id)
        // Never null for somebody the log records — the screen hides the
        // link on a manager who has done nothing, because an unrecognised
        // actor on the browser means "no filter" and would open everybody's
        // log under this person's name.
        ->and($listedRow['lastActiveAt'])->not->toBeNull();

    $this->actingAs($admin)->get('/admin/audit?actor='.$listedRow['userId'])
        ->assertInertia(function (AssertableInertia $page) use ($manager) {
            $props = $page->toArray()['props'];

            /** @var list<array<string, mixed>> $rows */
            $rows = $props['log']['rows'];

            // The parameter survived the browser's closed-list guard: had
            // it been narrowed to null, all three rows would be here.
            expect($props['filters']['actor'])->toBe($manager->id)
                ->and($rows)->toHaveCount(2)
                ->and(array_column($rows, 'action'))
                ->toBe(['copy.lost_reported', 'book.created']);

            foreach ($rows as $entry) {
                expect($entry['sentence'])->not->toContain('Sách Của Người Khác');
            }
        });
});

it('offers no link at all to a manager the log has never named', function () {
    app(TenantContext::class)->actSystemWide();

    $shelf = Bookshelf::factory()->create([
        'slug' => 'chua-hoat-dong', 'name' => 'Tủ sách Mới', 'settings' => [],
    ]);
    $admin = User::factory()->create(['is_super_admin' => true, 'full_name' => 'Maria Quản Trị']);
    $idle = User::factory()->create(['full_name' => 'Phêrô Chưa Làm Gì']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $idle->id, 'role' => 'manager', 'status' => 'active',
    ]);

    $listed = $this->actingAs($admin)->get('/admin/managers')
        ->viewData('page')['props']['managers'];

    // The screen gates the link on exactly this, and it is the same
    // predicate the browser's actor options are built from — so the link is
    // present when the filter would resolve and absent when it would not.
    $listedRow = collect($listed)->firstWhere('fullName', 'Phêrô Chưa Làm Gì');

    expect($listedRow['userId'])->toBe($idle->id)
        ->and($listedRow['lastActiveAt'])->toBeNull();

    // THE EARLY RETURN, not merely the comparison. See
    // managerActivityGuard(): the needle without `return null;` was
    // satisfied by an `if` with an empty body, so this assertion held while
    // the link shipped for a manager with no rows.
    expect(managerActivitySource())->toContain(managerActivityGuard());
});
