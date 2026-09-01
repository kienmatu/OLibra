<?php

use App\Models\AuditLog;
use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Inertia\Testing\AssertableInertia;

/**
 * Phase 3c-ii Task 5: `/admin/audit` — BR:606's cross-shelf audit browser,
 * and the last `underConstruction` route in the application.
 *
 * WHAT THIS SCREEN EXISTS FOR, and therefore what the first test pins: six
 * administration actions record no parish — 3b-ii's `system_settings.updated`,
 * `site_contact.updated` and three `category.*`, plus 3b-i's
 * `user.promoted_super_admin` — and the only reader the table had compares
 * the tenant column for EQUALITY, which never matches an absent value. Not
 * one of those rows has ever been visible on any screen. If the "no shelf
 * named" case here ever narrows, they all disappear again and nothing else
 * in the suite would say so.
 *
 * THE FIXTURE IS TWO SHELVES PLUS TWO GLOBAL ROWS, deliberately, and
 * AuditLogQueryTest's own reason applies unchanged: a one-row-per-shelf
 * fixture cannot tell "scoped to this shelf" from "scoped to everything",
 * and a fixture with no global row cannot tell "everything" from "every
 * shelf".
 *
 * THE PAYLOAD JOIN IS EXERCISED HERE TOO, not only the filters — every
 * other test in this file is about WHICH rows come back, which the joins
 * are invisible to. So one fixture row resolves its subject's name ONLY
 * through a JSON payload (`after.borrower_id`), reached through the two
 * `leftJoin`s that were moved into the shared trait, and a test asserts the
 * rendered sentence names that person. Delete either of them, or the
 * four-way coalesce, and it reddens.
 *
 * **WHAT IT DOES NOT PIN, MEASURED RATHER THAN ASSUMED.** That join carries
 * a `CONVERT(… USING ascii) COLLATE ascii_bin` guard against errno 1267 —
 * this repo's "six-times-paid live 500" — and the guard itself could NOT be
 * falsified here: replacing the expression with a bare
 * `JSON_UNQUOTE(JSON_EXTRACT(…))` left all six tests below green. So the
 * comparison of a utf8mb4 function result against this `ascii_bin` column
 * is resolved rather than refused by the MariaDB this suite runs on, and
 * whatever pairing produced those live 500s is not the pairing here. The
 * guard is KEPT — six live incidents outweigh one environment that does not
 * reproduce them — but nothing in this suite would notice its removal, and
 * that is worth knowing before somebody "simplifies" it on the strength of
 * a green run.
 *
 * THE /admin GROUP BINDS NO TENANT, so the fixture widens before touching a
 * model — load-bearing here because it creates Bookshelf and Membership
 * rows.
 *
 * Grep first: `grep -rn "^function adminAuditFix" tests/`.
 *
 * @return array<string, mixed>
 */
function adminAuditFix(): array
{
    app(TenantContext::class)->actSystemWide();

    // NAMES, NOT SLUGS, decide the shelf filter's order — and these two are
    // chosen so that Vietnamese collation and byte order DISAGREE about it:
    // Đ sorts right after D in Vietnamese and after z in bytes, so a naive
    // sort puts Đồng Tháp last where the assertion below wants it second.
    $shelf = Bookshelf::factory()->create([
        'slug' => 'dong-thap-aab', 'name' => 'Đồng Tháp', 'settings' => [],
    ]);
    $other = Bookshelf::factory()->create([
        'slug' => 'can-tho-aab', 'name' => 'Cần Thơ', 'settings' => [],
    ]);

    $admin = User::factory()->create(['is_super_admin' => true, 'full_name' => 'Maria Quản Trị']);
    $manager = User::factory()->create(['full_name' => 'Anna Quản Lý Đồng Tháp']);
    $managerMembership = Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);
    $foreign = User::factory()->create(['full_name' => 'Giuse Quản Lý Cần Thơ']);
    Membership::factory()->for($other)->create([
        'user_id' => $foreign->id, 'role' => 'manager', 'status' => 'active',
    ]);
    $child = User::factory()->create(['full_name' => 'Têrêsa Bé Đọc Sách']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $child->id, 'role' => 'reader', 'status' => 'active',
    ]);

    $row = fn (array $overrides) => AuditLog::query()->create(array_merge([
        'bookshelf_id' => null, 'actor_id' => null, 'entity_id' => null,
        'before' => null, 'after' => null, 'context' => [],
    ], $overrides));

    // Shelf A. The loan row is the collation-guard fixture: its subject is
    // named NOWHERE except inside the JSON payload, so the sentence can only
    // read "cho Têrêsa Bé Đọc Sách mượn …" through the guarded join.
    $lost = $row(['bookshelf_id' => $shelf->id, 'actor_id' => $manager->id,
        'action' => 'copy.lost_reported', 'entity_type' => 'copy',
        'occurred_at' => '2026-08-10 03:00:00']);
    $loan = $row(['bookshelf_id' => $shelf->id, 'actor_id' => $manager->id,
        'action' => 'loan.created', 'entity_type' => 'loan',
        'after' => ['title' => 'Dế Mèn Phiêu Lưu Ký', 'borrower_id' => $child->id],
        'occurred_at' => '2026-08-10 10:00:00']);

    // Shelf B.
    $foreignRow = $row(['bookshelf_id' => $other->id, 'actor_id' => $foreign->id,
        'action' => 'book.created', 'entity_type' => 'book',
        'after' => ['title' => 'Sách Của Tủ Khác'],
        'occurred_at' => '2026-08-10 12:00:00']);

    // The installation's own — two of the six this screen was built for.
    // The second sits at 18:00 UTC, which is 01:00 the NEXT civil day in
    // Asia/Ho_Chi_Minh: the date range's boundary is asserted on it, so a
    // bare date comparison would file it under the wrong day and redden.
    $settings = $row(['actor_id' => $admin->id,
        'action' => 'system_settings.updated', 'entity_type' => 'system_settings',
        'occurred_at' => '2026-08-10 12:00:00']);
    $promotion = $row(['actor_id' => $admin->id,
        'action' => 'user.promoted_super_admin', 'entity_type' => 'user',
        'entity_id' => $child->id,
        'occurred_at' => '2026-08-18 18:00:00']);

    return compact('shelf', 'other', 'admin', 'manager', 'managerMembership', 'foreign',
        'child', 'lost', 'loan', 'foreignRow', 'settings', 'promotion');
}

/**
 * The actions on the page, in order — every assertion below is about WHICH
 * rows came back, so this is the shape they all read.
 *
 * @return list<string>
 */
function adminAuditActions(AssertableInertia $page): array
{
    /** @var array<int, array<string, mixed>> $rows */
    $rows = $page->toArray()['props']['log']['rows'];

    return array_values(array_map(fn (array $row): string => (string) $row['action'], $rows));
}

it('shows the installation own rows when no shelf is named, and hides them when one is', function () {
    $f = adminAuditFix();

    // THE WHOLE POINT OF THE SCREEN. Both global actions are here beside
    // both shelves' rows — five rows, one query, no shelf named.
    test()->actingAs($f['admin'])
        ->get('/admin/audit')
        ->assertOk()
        ->assertInertia(function (AssertableInertia $page) {
            $page->component('admin/audit')->where('log.total', 5);

            expect(adminAuditActions($page))->toContain('system_settings.updated')
                ->toContain('user.promoted_super_admin')
                ->toContain('copy.lost_reported')
                ->toContain('book.created');
        });

    // Naming a parish excludes them again — which is the other half, and
    // without it the assertion above passes on a screen that never filters.
    test()->actingAs($f['admin'])
        ->get('/admin/audit?shelf='.$f['shelf']->id)
        ->assertInertia(function (AssertableInertia $page) {
            $page->where('log.total', 2);

            expect(adminAuditActions($page))
                ->toBe(['loan.created', 'copy.lost_reported']);
        });

    // And the third answer: the installation's rows ALONE, which no
    // shelf-scoped read can express at all.
    test()->actingAs($f['admin'])
        ->get('/admin/audit?shelf=site')
        ->assertInertia(function (AssertableInertia $page) {
            $page->where('log.total', 2);

            expect(adminAuditActions($page))
                ->toBe(['user.promoted_super_admin', 'system_settings.updated']);
        });
});

it('resolves a subject named only inside a JSON payload, past the collation guard', function () {
    // NOT A SCOPING TEST. The joins this screen shares with the manager's
    // log compare a uuid pulled out of a JSON column against an ascii_bin
    // key column; without CONVERT ... USING ascii COLLATE ascii_bin that
    // comparison is errno 1267 and the page is a 500, not a wrong answer.
    // Têrêsa's name appears in no column of this row — only in
    // after.borrower_id — so the sentence below cannot be produced any
    // other way.
    $f = adminAuditFix();

    test()->actingAs($f['admin'])
        ->get('/admin/audit?shelf='.$f['shelf']->id)
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->where('log.rows.0.action', 'loan.created')
            ->where(
                'log.rows.0.sentence',
                'Anna Quản Lý Đồng Tháp đã cho Têrêsa Bé Đọc Sách mượn Dế Mèn Phiêu Lưu Ký',
            ));
});

it('narrows on each of the four filters and composes them', function () {
    $f = adminAuditFix();

    $actions = function (string $url) use ($f): array {
        $seen = [];
        test()->actingAs($f['admin'])->get($url)->assertOk()
            ->assertInertia(function (AssertableInertia $page) use (&$seen) {
                $seen = adminAuditActions($page);
            });

        return $seen;
    };

    // 1. Group.
    expect($actions('/admin/audit?group=administration'))
        ->toBe(['user.promoted_super_admin', 'system_settings.updated']);

    // 2. Actor — the filter BR:608 reaches this screen through.
    expect($actions('/admin/audit?actor='.$f['manager']->id))
        ->toBe(['loan.created', 'copy.lost_reported']);

    // 3. The date range, ON THE CIVIL-DAY BOUNDARY. The promotion happened
    // at 18:00 UTC on the 18th, which is 01:00 on the 19th in
    // Asia/Ho_Chi_Minh — so it is OUT of a range ending on the 18th and IN
    // one beginning on the 19th. A bare date comparison answers the
    // opposite both times.
    expect($actions('/admin/audit?to=2026-08-18'))->not->toContain('user.promoted_super_admin');
    expect($actions('/admin/audit?from=2026-08-19'))->toBe(['user.promoted_super_admin']);

    // `?to=` IS INCLUSIVE OF ITS OWN DAY, asserted on a day that HAS rows —
    // and measured rather than assumed. The negative line above survives
    // dropping the `->addDay()` from ReadsAuditLog's upper bound: with the
    // range ending at the START of the 18th the promotion is still absent,
    // and so is every row that ought to be there. The four rows of the 10th
    // are what tells the two readings apart, because a bound of "the start
    // of the 10th" excludes all four and answers an empty list.
    //
    // A COUNT, NOT A LIST: two of the four sit at the same instant
    // (`book.created` on the other shelf and `system_settings.updated`),
    // and their order is settled by uuid, which the factory chooses fresh
    // each run.
    expect($actions('/admin/audit?to=2026-08-10'))->toHaveCount(4);

    // 4. Shelf, composed with a group: the same chip that returned both
    // global rows above returns nothing once a parish is named, because
    // neither of them belongs to one.
    expect($actions('/admin/audit?group=administration&shelf='.$f['shelf']->id))->toBe([]);

    // And a composition that is not empty, or the line above is satisfied
    // by any two filters that happen to conflict.
    expect($actions('/admin/audit?group=loans&actor='.$f['manager']->id))
        ->toBe(['loan.created']);
});

it('offers every parish the log names plus the installation, and validates the two lists', function () {
    $f = adminAuditFix();

    test()->actingAs($f['admin'])
        ->get('/admin/audit')
        ->assertInertia(function (AssertableInertia $page) use ($f) {
            $props = $page->toArray()['props'];

            // The installation first, then the two parishes — and the
            // site-wide option carries a NULL name, never a Vietnamese
            // word: the label is copy.ts's.
            /** @var array<int, array<string, mixed>> $shelves */
            $shelves = $props['shelves'];
            expect(array_column($shelves, 'shelfId'))
                ->toBe(['site', $f['other']->id, $f['shelf']->id])
                ->and($shelves[0]['name'])->toBeNull()
                ->and($shelves[0]['entries'])->toBe(2);

            // The actor list is CROSS-SHELF, which is what makes Task 6's
            // link from /admin/managers survive this screen's validation.
            /** @var array<int, array<string, mixed>> $actors */
            $actors = $props['actors'];
            expect(array_column($actors, 'userId'))->toContain((string) $f['foreign']->id);
        });

    // AN UNRECOGNISED VALUE MEANS NO FILTER, NEVER AN EMPTY LIST — a log
    // answering "nothing has ever happened" is worse than an inbox doing
    // it, because it is a sentence somebody might act on. A foreign uuid,
    // a non-uuid, an unknown group and an impossible date all fall back to
    // the unfiltered screen, and the echoed filter says so.
    foreach ([
        'shelf=00000000-0000-0000-0000-000000000000',
        'shelf=constructor',
        'actor=00000000-0000-0000-0000-000000000000',
        'group='.urlencode('Quản trị'),
        'from=2026-02-31',
    ] as $bad) {
        test()->actingAs($f['admin'])
            ->get('/admin/audit?'.$bad)
            ->assertInertia(fn (AssertableInertia $page) => $page
                ->where('log.total', 5)
                ->where('filters.shelf', null)
                ->where('filters.actor', null)
                ->where('filters.group', null)
                ->where('filters.from', null));
    }
});

it('leaves the shelf-scoped log showing only its own rows', function () {
    // THE OTHER SCREEN IS UNCHANGED BY THE EXTRACTION. Both readers now
    // share one join-and-select block, so a mistake in the shared half
    // would show up here as the manager's log growing rows that are not
    // the shelf's — the installation's two, and the other parish's one.
    $f = adminAuditFix();

    test()->actingAs($f['manager'])
        ->get("/shelves/{$f['shelf']->slug}/manage/audit")
        ->assertOk()
        ->assertInertia(function (AssertableInertia $page) {
            $page->component('manage/audit')->where('log.total', 2);

            expect(adminAuditActions($page))
                ->toBe(['loan.created', 'copy.lost_reported']);
        });
});

it('answers 404 to a caller who is not a super administrator', function () {
    $f = adminAuditFix();

    // 404 and never 403 — the `/admin` group's own middleware is the whole
    // of the refusal, and spec §5.4's anti-enumeration rule says a caller
    // who may not use the area must not learn from a status code that it
    // is there. A shelf MANAGER is the interesting case: they read an
    // audit log every day, just not this one.
    test()->actingAs($f['manager'])->get('/admin/audit')->assertNotFound();
    // A GUEST GETS THE SAME 404, not a login redirect: the `/admin` group
    // carries `super-admin` and NOT `auth`, so there is no authentication
    // middleware to bounce them to a form — and being sent to a login page
    // is itself the disclosure the 404 exists to withhold.
    test()->get('/admin/audit')->assertNotFound();
});
