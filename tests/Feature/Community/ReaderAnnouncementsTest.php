<?php

use App\Actions\Community\CreateAnnouncement;
use App\Models\Announcement;
use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Carbon\Carbon;
use Carbon\CarbonImmutable;
use Inertia\Testing\AssertableInertia;

/**
 * THE READER'S TWO SCREENS, over HTTP: the shelf's Bản tin and one notice
 * on its own page. Task 12's AnnouncementsQueryTest owns what
 * AnnouncementsQuery answers; this file owns what a request to
 * /shelves/{shelf}/announcements and /shelves/{shelf}/announcements/{slug}
 * does with those answers — which props reach Inertia, and which statuses
 * a stranger, a draft, a lapsed notice and another shelf's slug meet.
 *
 * Grep first: `grep -rn "^function arsFix" tests/` — top-level helpers are
 * process-global (AGENTS.md).
 *
 * KNOWN BLIND SPOT, and it is stated rather than implied. Measured, in
 * this worktree, before this file was written: `find resources/js \(
 * -name '*.test.*' -o -name '*.spec.*' \)` printed nothing, `ls
 * vitest.config.*` at the repo root matched nothing, and package.json's
 * `test` script reads `cd old_next && vitest run`. So the rendered markup
 * of these two pages goes unread by any runner. assertInertia reads
 * SERVER-SIDE props only,
 * and Phase 1d measured what that costs — swapping two stat cards' values
 * left the whole suite and all five gates green. So every block below pins
 * a prop, a component name or a status. That the list renders under the
 * "Bản tin tủ sách" heading, that the pinned notice is visually first and
 * carries the "Ghim" badge, and that the detail page shows the body are
 * unpinned by anything here and are checked by READING
 * resources/js/pages/shelves/announcements/index.tsx and show.tsx.
 *
 * WHAT THE FOUR 404 BLOCKS DO AND DO NOT PROVE, stated because it changed
 * what this file contains. A 404 is what a route that does not exist also
 * answers, so blocks asserting only 404 would stay green against a deleted
 * detail route. 'a published notice opens on its own page' is the positive
 * control that makes the three detail refusals mean something, and it is
 * an addition of mine rather than the brief's — see the report.
 *
 * The fixture does NOT actingAs: SessionGuard caches the acting user for a
 * whole test method, and the blocks below need to choose between a reader,
 * a stranger and nobody.
 *
 * @return array{Bookshelf, User, User} the shelf, its reader, its manager
 */
function arsFix(string $slug = 'dong-thap-ars'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);

    $manager = User::factory()->create(['full_name' => 'Maria Quản Lý Kho']);
    $managerMembership = Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);

    $reader = User::factory()->create(['full_name' => 'Têrêsa Bạn Đọc Nhỏ']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $reader->id, 'role' => 'reader', 'status' => 'active',
    ]);

    // Bound to the manager's membership so arsPost's Gate check passes;
    // every HTTP request below re-resolves the tenant through the `tenant`
    // middleware for whoever is signed in at that moment.
    app(TenantContext::class)->set($shelf, $managerMembership);

    return [$shelf, $reader, $manager];
}

/**
 * One announcement on whatever shelf is bound, through the command Task 9
 * built onto this table. This helper writes its rows through the shipped
 * command rather than a factory, which is what keeps the fixture honest
 * about slug derivation and audit; whether a factory exists is beside the
 * point and an earlier draft of this sentence made a claim about
 * database/factories/ that the standing ruling does not allow. What
 * follows is scoped to this helper:
 * database/factories (looked, at this commit), and the command is the door
 * AnnouncementsQueryTest's own seed goes through.
 *
 * $publishedAt, $expiresAt and $pinned are parameters because which of
 * those starting states a row is in is the whole subject of this file.
 */
function arsPost(
    User $manager,
    string $title,
    ?CarbonImmutable $publishedAt = null,
    ?CarbonImmutable $expiresAt = null,
    bool $pinned = false,
    string $body = 'Tủ sách mở cửa lại từ thứ Hai, mời cả nhà tới đọc.',
): Announcement {
    $created = app(CreateAnnouncement::class)->execute(
        $manager,
        $title,
        $body,
        pinned: $pinned,
        publishedAt: $publishedAt,
        expiresAt: $expiresAt,
    );

    return Announcement::query()->findOrFail($created['announcementId']);
}

afterEach(fn () => Carbon::setTestNow());

it('the list carries the published unlapsed notices, pinned first', function () {
    // FOUR ROWS, TWO SURVIVORS, IN A NAMED ORDER — one assertion that a
    // count could not make. The pinned notice is the OLDER of the two
    // survivors, so `is_pinned desc` and `published_at desc` disagree here
    // and the list says which one the page obeys.
    [$shelf, $reader, $manager] = arsFix();
    Carbon::setTestNow(CarbonImmutable::parse('2026-08-30 04:00:00', 'UTC'));

    $pinned = arsPost(
        $manager,
        'Giờ Mở Cửa Mùa Hè',
        publishedAt: CarbonImmutable::parse('2026-08-01 03:00:00', 'UTC'),
        pinned: true,
    );
    $recent = arsPost(
        $manager,
        'Sách Mới Về Tuần Này',
        publishedAt: CarbonImmutable::parse('2026-08-29 03:00:00', 'UTC'),
    );
    arsPost($manager, 'Tin Nháp Chưa Đăng');
    arsPost(
        $manager,
        'Tin Đã Hết Hạn',
        publishedAt: CarbonImmutable::parse('2026-08-02 03:00:00', 'UTC'),
        expiresAt: CarbonImmutable::parse('2026-08-20 03:00:00', 'UTC'),
    );

    $response = test()->actingAs($reader)->get("/shelves/{$shelf->slug}/announcements");

    // Through assertInertia, not viewData alone. AssertableInertia does a
    // json_decode(json_encode($page)) round-trip and fails with "Not a
    // valid Inertia response." if it cannot encode — which is the guard
    // that caught the slug_key trap on the detail side. Reading the prop
    // bag directly skips it, and skips pinning the component name too, so
    // a typo'd component would leave this block green.
    $response->assertInertia(fn ($page) => $page->component('shelves/announcements/index'));

    $rows = $response->viewData('page')['props']['announcements'];
    expect(array_column($rows, 'slug'))->toBe([$pinned->slug, $recent->slug]);
});

it('a published notice opens on its own page', function () {
    // THE POSITIVE CONTROL for the three refusals below. Without it a
    // detail route that had been deleted outright would leave every one of
    // them green, because 404 is exactly what a missing route answers.
    [$shelf, $reader, $manager] = arsFix('dong-thap-ars-open');
    Carbon::setTestNow(CarbonImmutable::parse('2026-08-30 04:00:00', 'UTC'));

    $live = arsPost(
        $manager,
        'Giờ Mở Cửa Mùa Hè',
        publishedAt: CarbonImmutable::parse('2026-08-01 03:00:00', 'UTC'),
    );

    test()->actingAs($reader)->get("/shelves/{$shelf->slug}/announcements/{$live->slug}")
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('shelves/announcements/show')
            ->where('announcement.slug', $live->slug)
            ->where('announcement.body', 'Tủ sách mở cửa lại từ thứ Hai, mời cả nhà tới đọc.'));
});

it('a draft notice 404s at its own slug', function () {
    // Its own block, apart from the lapsed one below: a failed expect()
    // aborts the whole METHOD, and these are two different rules that
    // happen to meet at the same status.
    [$shelf, $reader, $manager] = arsFix('dong-thap-ars-draft');
    Carbon::setTestNow(CarbonImmutable::parse('2026-08-30 04:00:00', 'UTC'));

    $draft = arsPost($manager, 'Tin Nháp Chưa Đăng');

    test()->actingAs($reader)
        ->get("/shelves/{$shelf->slug}/announcements/{$draft->slug}")
        ->assertNotFound();
});

it('a lapsed notice 404s at its own slug', function () {
    // The half that makes the list's expiry a RULE rather than a
    // presentation choice: if pasting the address still rendered it,
    // expiry would only be true of the index page.
    [$shelf, $reader, $manager] = arsFix('dong-thap-ars-lapsed');
    Carbon::setTestNow(CarbonImmutable::parse('2026-08-30 04:00:00', 'UTC'));

    $lapsed = arsPost(
        $manager,
        'Tin Đã Hết Hạn',
        publishedAt: CarbonImmutable::parse('2026-08-02 03:00:00', 'UTC'),
        expiresAt: CarbonImmutable::parse('2026-08-20 03:00:00', 'UTC'),
    );

    test()->actingAs($reader)
        ->get("/shelves/{$shelf->slug}/announcements/{$lapsed->slug}")
        ->assertNotFound();
});

it('a signed-in non-member meets 404 on the list, not 403', function () {
    // Spec §5.4: a refusal must not tell a stranger which shelf URLs are
    // real. The status is asserted as 404 AND as not-403 in one call —
    // assertNotFound() fails on 403 as loudly as on 200 — and what answers
    // it is the route group's role:reader (EnsureShelfRole), measured by
    // mutation 2 in the report rather than argued here.
    [$shelf, $reader, $manager] = arsFix('dong-thap-ars-stranger');
    Carbon::setTestNow(CarbonImmutable::parse('2026-08-30 04:00:00', 'UTC'));
    arsPost(
        $manager,
        'Giờ Mở Cửa Mùa Hè',
        publishedAt: CarbonImmutable::parse('2026-08-01 03:00:00', 'UTC'),
    );

    app(TenantContext::class)->actSystemWide();
    $stranger = User::factory()->create(['full_name' => 'Người Lạ Đi Ngang']);

    test()->actingAs($stranger)
        ->get("/shelves/{$shelf->slug}/announcements")
        ->assertNotFound();
});

it("another shelf's slug 404s under this shelf's address", function () {
    // Task 11's review found four commands shipping a cross-shelf claim
    // with nothing pinning it. The claim here is that BookshelfScope is
    // what keeps a neighbouring parish's notice out of this shelf's
    // detail page; this block is the pin, so the claim is a measurement.
    [$shelfA, $readerA, $managerA] = arsFix('dong-thap-ars-here');

    // Shelf B, its own manager, its own live notice — seeded with the
    // tenant re-bound to B, then handed back to A so the request under
    // test is an ordinary reader-of-A request.
    [$shelfB, $readerB, $managerB] = arsFix('dong-thap-ars-elsewhere');
    Carbon::setTestNow(CarbonImmutable::parse('2026-08-30 04:00:00', 'UTC'));
    $theirs = arsPost(
        $managerB,
        'Chầu Thánh Thể Tối Thứ Sáu',
        publishedAt: CarbonImmutable::parse('2026-08-01 03:00:00', 'UTC'),
    );

    test()->actingAs($readerA)
        ->get("/shelves/{$shelfA->slug}/announcements/{$theirs->slug}")
        ->assertNotFound();
});
