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
 * THE MANAGER'S BULLETIN, over HTTP: the list, the compose form, the edit
 * form, and the five buttons a row carries. Tasks 9-12 own what the four
 * commands and AnnouncementsQuery do; this file owns what a request to
 * /shelves/{shelf}/manage/announcements does with them — which props reach
 * Inertia, which column each POST moves, and which statuses a reader meets.
 *
 * Grep first: `grep -rn "^function amsFix" tests/` — top-level helpers are
 * process-global (AGENTS.md).
 *
 * WHY THE EXPIRY IS ASSERTED AS A COLUMN VALUE AND NOT AS A STATUS. The
 * controller is the first surface that renames `expires_at` (what the three
 * Form Requests validate) to `expiresAt` (what the commands read), and two
 * spellings of that rename are wrong in ways a status code cannot see:
 *
 *   - a cast that reaches for CarbonImmutable::parse() on a cleared expiry
 *     stores the frozen instant instead of null, so a republished notice
 *     lapses in the same breath while its redirect, its flash and its moved
 *     published_at all read correct;
 *   - a presence check made with $request->date() or filled() cannot tell an
 *     ABSENT expires_at from a present-empty one, so an edit naming only the
 *     title silently clears an expiry nobody touched.
 *
 * So 'Đăng lại with no date' asserts the expiry column is still null, and
 * 'PATCH naming only the title' asserts the expiry column did not move. Both
 * are pinned by mutation in the task report.
 *
 * WHAT THE NINE READER BLOCKS DO AND DO NOT PROVE, stated because it shaped
 * the file. 404 is what a route that does not exist also answers, so a
 * reader-404 block on its own would stay green against a deleted route.
 * Every route with a reader block below also has a manager block that
 * demands 200 or 302 from the same URL, and that positive sibling is what
 * makes the refusal mean something.
 *
 * KNOWN BLIND SPOT, stated rather than implied, and re-measured in this
 * worktree while this task was in flight rather than carried over from an
 * earlier file's docblock: `find resources/js \( -name '*.test.*' -o -name
 * '*.spec.*' \)` printed nothing, `ls vitest.config.*` at the repo root
 * matched nothing, and package.json's `test` script reads `cd old_next &&
 * vitest run`. assertInertia reads SERVER-SIDE props only, and Phase 1d
 * measured what that costs — swapping two stat cards' values left the whole
 * suite and all five gates green. So which buttons a
 * row carries, which chip is highlighted, and that the word *Bắt buộc*
 * renders beside the required fields are unpinned by anything here and are
 * checked by READING resources/js/pages/manage/announcements/index.tsx and
 * form.tsx.
 *
 * The fixture does NOT actingAs: SessionGuard caches the acting user for a
 * whole test method, and the blocks below choose between a manager and a
 * reader.
 *
 * @return array{Bookshelf, User, User} the shelf, its manager, its reader
 */
function amsFix(string $slug = 'dong-thap-ams'): array
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

    // Bound to the manager's membership so amsSeed's Gate check passes; every
    // HTTP request below re-resolves the tenant through the `tenant`
    // middleware for whoever is signed in at that moment.
    app(TenantContext::class)->set($shelf, $managerMembership);

    return [$shelf, $manager, $reader];
}

/**
 * One announcement on whatever shelf is bound, through Task 9's command
 * rather than a factory — the same door ReaderAnnouncementsTest's own helper
 * goes through, which keeps slug derivation and the audit entry honest.
 *
 * $publishedAt, $expiresAt and $pinned are parameters because which starting
 * state a row is in is what most of the blocks below are about.
 */
function amsSeed(
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

/** The instant every block below freezes to, so a state is a fact not a race. */
function amsNow(): CarbonImmutable
{
    return CarbonImmutable::parse('2026-08-30 04:00:00', 'UTC');
}

afterEach(fn () => Carbon::setTestNow());

it('GET /manage/announcements carries every row with the state its chip renders', function () {
    // THREE ROWS, THREE STATES, IN A NAMED ORDER. The pinned one is the
    // OLDEST, so `is_pinned desc` and the recency key disagree here and the
    // list says which one the page is handed.
    [$shelf, $manager] = amsFix();
    Carbon::setTestNow(amsNow());

    $showing = amsSeed(
        $manager,
        'Giờ Mở Cửa Mùa Hè',
        publishedAt: CarbonImmutable::parse('2026-08-01 03:00:00', 'UTC'),
        pinned: true,
    );
    amsSeed($manager, 'Tin Nháp Chưa Đăng');
    amsSeed(
        $manager,
        'Tin Đã Hết Hạn',
        publishedAt: CarbonImmutable::parse('2026-08-02 03:00:00', 'UTC'),
        expiresAt: CarbonImmutable::parse('2026-08-20 03:00:00', 'UTC'),
    );

    $response = test()->actingAs($manager)->get("/shelves/{$shelf->slug}/manage/announcements");

    // Through assertInertia, not viewData alone: AssertableInertia does a
    // json_decode(json_encode($page)) round-trip and fails with "Not a valid
    // Inertia response." if it cannot encode, which is the guard that catches
    // a bare Announcement (its binary(32) slug_key) being handed to a page.
    $response->assertOk()->assertInertia(fn (AssertableInertia $page) => $page
        ->component('manage/announcements/index')
        ->where('announcements.0.slug', $showing->slug)
        ->where('announcements.0.isPinned', true));

    $rows = $response->viewData('page')['props']['announcements'];
    expect(array_column($rows, 'state'))->toBe(['showing', 'draft', 'expired']);
});

it('POST the compose form writes a draft and lands on the list with the created flash', function () {
    [$shelf, $manager] = amsFix('dong-thap-ams-store');
    Carbon::setTestNow(amsNow());

    $response = test()->actingAs($manager)->post("/shelves/{$shelf->slug}/manage/announcements", [
        'title' => 'Tủ Sách Nghỉ Lễ Quốc Khánh',
        'body' => 'Tủ sách nghỉ ngày 2/9, mở lại sáng thứ Tư.',
        'is_pinned' => false,
        'expires_at' => '',
    ]);

    $response->assertRedirect("/shelves/{$shelf->slug}/manage/announcements")
        ->assertSessionHas('success', __('rules.announcement_created_flash'));

    $written = Announcement::query()->where('title', 'Tủ Sách Nghỉ Lễ Quốc Khánh')->firstOrFail();
    // A DRAFT, deliberately: the compose form sends no published_at, so
    // showing a notice to the parish is always the list's own *Đăng ngay*
    // rather than a side effect of typing it — the reference's own choice
    // (its create form's button reads "Lưu nháp").
    expect($written->published_at)->toBeNull();
});

it('a blank compose submit is a field error, not a banner', function () {
    // The two shapes are different responses, not two spellings of one:
    // ValidationException renders per-field, and RuleViolated renders as a
    // 302 carrying `rule` for the page banner. An empty title has to be the
    // first, or the manager is told a rule was broken and not which box.
    [$shelf, $manager] = amsFix('dong-thap-ams-blank');

    test()->actingAs($manager)
        ->post("/shelves/{$shelf->slug}/manage/announcements", ['title' => '', 'body' => ''])
        ->assertSessionHasErrors(['title', 'body'])
        ->assertSessionDoesntHaveErrors('rule');
});

it('GET one announcement opens the edit form carrying its own row', function () {
    // The positive sibling for the bound GET route, and the pin on the
    // create/{announcement} declaration order: with `create` declared after
    // this URI, /manage/announcements/create binds "create" as an id.
    [$shelf, $manager] = amsFix('dong-thap-ams-edit');
    Carbon::setTestNow(amsNow());

    $draft = amsSeed($manager, 'Tin Nháp Chưa Đăng');

    test()->actingAs($manager)->get("/shelves/{$shelf->slug}/manage/announcements/{$draft->id}")
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('manage/announcements/form')
            ->where('announcement.id', $draft->id)
            ->where('announcement.title', 'Tin Nháp Chưa Đăng')
            ->where('announcement.state', 'draft'));
});

it('GET the compose route opens the same form with no row', function () {
    // The positive sibling for `announcements/create`. Without it the
    // route-order assertion pins a declaration order for a route nothing
    // proves answers.
    [$shelf, $manager] = amsFix('dong-thap-ams-create');

    test()->actingAs($manager)->get("/shelves/{$shelf->slug}/manage/announcements/create")
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('manage/announcements/form')
            ->where('announcement', null));
});

it('PATCH with an empty expiry clears the column and lands with the updated flash', function () {
    // "This notice no longer expires" is the third case
    // UpdateAnnouncementRequest's `sometimes` + `nullable` pair exists for,
    // and it only survives to the command if the controller renames a
    // PRESENT NULL rather than dropping it.
    [$shelf, $manager] = amsFix('dong-thap-ams-clear');
    Carbon::setTestNow(amsNow());

    $live = amsSeed(
        $manager,
        'Giờ Mở Cửa Mùa Hè',
        publishedAt: CarbonImmutable::parse('2026-08-01 03:00:00', 'UTC'),
        expiresAt: CarbonImmutable::parse('2026-09-30 03:00:00', 'UTC'),
    );

    $response = test()->actingAs($manager)->patch(
        "/shelves/{$shelf->slug}/manage/announcements/{$live->id}",
        [
            'title' => 'Giờ Mở Cửa Mùa Thu',
            'body' => 'Từ tháng Chín tủ sách mở cửa chiều thứ Bảy.',
            'expires_at' => '',
        ],
    );

    $response->assertRedirect("/shelves/{$shelf->slug}/manage/announcements")
        ->assertSessionHas('success', __('rules.announcement_updated_flash'));

    // The cleared column first: a failed expect() aborts the whole METHOD,
    // and this is the fact the block is named for.
    expect($live->fresh()->expires_at)->toBeNull();
    expect($live->fresh()->title)->toBe('Giờ Mở Cửa Mùa Thu');
});

it('PATCH naming only the title leaves the expiry where it was', function () {
    // The other half of the presence reading, and the block that tells an
    // array_key_exists() mapping apart from a $request->date() one: date()
    // answers null for an ABSENT key exactly as it does for a present-empty
    // one, so a mapping built on it would clear this column here.
    [$shelf, $manager] = amsFix('dong-thap-ams-keep');
    Carbon::setTestNow(amsNow());

    $live = amsSeed(
        $manager,
        'Giờ Mở Cửa Mùa Hè',
        publishedAt: CarbonImmutable::parse('2026-08-01 03:00:00', 'UTC'),
        expiresAt: CarbonImmutable::parse('2026-09-30 03:00:00', 'UTC'),
    );

    test()->actingAs($manager)->patch(
        "/shelves/{$shelf->slug}/manage/announcements/{$live->id}",
        ['title' => 'Giờ Mở Cửa Mùa Thu'],
    )->assertRedirect("/shelves/{$shelf->slug}/manage/announcements");

    expect($live->fresh()->expires_at?->toIso8601String())->toBe('2026-09-30T03:00:00+00:00');
});

it('POST Đăng ngay posts a draft and lands back with the published flash', function () {
    [$shelf, $manager] = amsFix('dong-thap-ams-publish');
    Carbon::setTestNow(amsNow());

    $draft = amsSeed($manager, 'Tin Nháp Chưa Đăng');

    test()->actingAs($manager)->post(
        "/shelves/{$shelf->slug}/manage/announcements/{$draft->id}/publish",
        ['expires_at' => ''],
    )->assertRedirect()->assertSessionHas('success', __('rules.announcement_published_flash'));

    expect($draft->fresh()->published_at?->toIso8601String())->toBe('2026-08-30T04:00:00+00:00');
});

it('POST Đăng lại with no date republishes a lapsed notice and leaves the expiry null', function () {
    // THREE ASSERTIONS, AND THE THIRD IS THE POINT. A status, a flash and a
    // moved published_at all pass under a CarbonImmutable::parse(null) cast —
    // the notice would be republished with an expiry equal to the publish
    // instant, lapsing in the same breath, and this block and its sibling
    // below would both be green. The column's value is what tells the two
    // apart.
    [$shelf, $manager] = amsFix('dong-thap-ams-again');
    Carbon::setTestNow(amsNow());

    $lapsed = amsSeed(
        $manager,
        'Tin Đã Hết Hạn',
        publishedAt: CarbonImmutable::parse('2026-08-02 03:00:00', 'UTC'),
        expiresAt: CarbonImmutable::parse('2026-08-20 03:00:00', 'UTC'),
    );

    test()->actingAs($manager)->post(
        "/shelves/{$shelf->slug}/manage/announcements/{$lapsed->id}/publish",
        ['expires_at' => ''],
    )->assertRedirect()->assertSessionHas('success', __('rules.announcement_published_flash'));

    // The expiry first, for the reason above: a failed expect() aborts the
    // whole method, and a green run that never reached this line would be
    // exactly the defect.
    expect($lapsed->fresh()->expires_at)->toBeNull();
    expect($lapsed->fresh()->published_at?->toIso8601String())->toBe('2026-08-30T04:00:00+00:00');
});

it('POST Đăng lại with a date puts that date in the column', function () {
    [$shelf, $manager] = amsFix('dong-thap-ams-again-dated');
    Carbon::setTestNow(amsNow());

    $lapsed = amsSeed(
        $manager,
        'Tin Đã Hết Hạn',
        publishedAt: CarbonImmutable::parse('2026-08-02 03:00:00', 'UTC'),
        expiresAt: CarbonImmutable::parse('2026-08-20 03:00:00', 'UTC'),
    );

    test()->actingAs($manager)->post(
        "/shelves/{$shelf->slug}/manage/announcements/{$lapsed->id}/publish",
        ['expires_at' => '2026-09-30'],
    )->assertRedirect()->assertSessionHas('success', __('rules.announcement_published_flash'));

    // Midnight, because that is what a date-only string parses to and the
    // controller parses exactly what the box sent. The reference's own
    // action shifts a chosen day to its END before storing; this port does
    // not, and the divergence is written up in the task report rather than
    // smuggled in here.
    expect($lapsed->fresh()->expires_at?->toIso8601String())->toBe('2026-09-30T00:00:00+00:00');
});

it('POST Ẩn pulls a showing notice and lands back with the hidden flash', function () {
    [$shelf, $manager] = amsFix('dong-thap-ams-hide');
    Carbon::setTestNow(amsNow());

    $live = amsSeed(
        $manager,
        'Giờ Mở Cửa Mùa Hè',
        publishedAt: CarbonImmutable::parse('2026-08-01 03:00:00', 'UTC'),
    );

    test()->actingAs($manager)->post(
        "/shelves/{$shelf->slug}/manage/announcements/{$live->id}/hide",
    )->assertRedirect()->assertSessionHas('success', __('rules.announcement_hidden_flash'));

    expect($live->fresh()->published_at)->toBeNull();
});

it('POST Ghim pins a notice and lands back with the pinned flash', function () {
    [$shelf, $manager] = amsFix('dong-thap-ams-pin');
    Carbon::setTestNow(amsNow());

    $live = amsSeed(
        $manager,
        'Giờ Mở Cửa Mùa Hè',
        publishedAt: CarbonImmutable::parse('2026-08-01 03:00:00', 'UTC'),
    );

    test()->actingAs($manager)->post(
        "/shelves/{$shelf->slug}/manage/announcements/{$live->id}/pin",
    )->assertRedirect()->assertSessionHas('success', __('rules.announcement_pinned_flash'));

    expect($live->fresh()->is_pinned)->toBeTrue();
});

it('POST Bỏ ghim unpins a notice and lands back with the unpinned flash', function () {
    [$shelf, $manager] = amsFix('dong-thap-ams-unpin');
    Carbon::setTestNow(amsNow());

    $live = amsSeed(
        $manager,
        'Giờ Mở Cửa Mùa Hè',
        publishedAt: CarbonImmutable::parse('2026-08-01 03:00:00', 'UTC'),
        pinned: true,
    );

    test()->actingAs($manager)->post(
        "/shelves/{$shelf->slug}/manage/announcements/{$live->id}/unpin",
    )->assertRedirect()->assertSessionHas('success', __('rules.announcement_unpinned_flash'));

    expect($live->fresh()->is_pinned)->toBeFalse();
});

/*
 * NINE BLOCKS FOR THE READER, NOT ONE. A failed expect() aborts the whole
 * test METHOD, so a regression that reopened the list would also hide
 * whether the eight writes beneath it still refused.
 *
 * 404, never 403 — spec §5.4's anti-enumeration rule: a reader of this shelf
 * must not learn from a status code that the bulletin editor, or any
 * particular announcement id, is there.
 *
 * The actor is the same reader in all nine, so splitting costs nothing that
 * SessionGuard's per-method actor cache was guarding. What each of these
 * answers when the route group's `role:manager` is removed differs per route
 * and is recorded in the task report, measured rather than predicted.
 */
it('a reader of the shelf 404s on the bulletin list', function () {
    [$shelf, , $reader] = amsFix('dong-thap-ams-r-index');

    test()->actingAs($reader)->get("/shelves/{$shelf->slug}/manage/announcements")
        ->assertNotFound();
});

it('a reader of the shelf 404s on the compose form', function () {
    [$shelf, , $reader] = amsFix('dong-thap-ams-r-create');

    test()->actingAs($reader)->get("/shelves/{$shelf->slug}/manage/announcements/create")
        ->assertNotFound();
});

it('a reader of the shelf 404s on the edit form', function () {
    [$shelf, $manager, $reader] = amsFix('dong-thap-ams-r-edit');
    $draft = amsSeed($manager, 'Tin Nháp Chưa Đăng');

    test()->actingAs($reader)->get("/shelves/{$shelf->slug}/manage/announcements/{$draft->id}")
        ->assertNotFound();
});

it('a reader of the shelf 404s on the compose POST', function () {
    [$shelf, , $reader] = amsFix('dong-thap-ams-r-store');

    test()->actingAs($reader)->post("/shelves/{$shelf->slug}/manage/announcements", [
        'title' => 'Bạn Đọc Tự Viết Thông Báo',
        'body' => 'Không được phép.',
    ])->assertNotFound();
});

it('a reader of the shelf 404s on the edit PATCH', function () {
    [$shelf, $manager, $reader] = amsFix('dong-thap-ams-r-update');
    $draft = amsSeed($manager, 'Tin Nháp Chưa Đăng');

    test()->actingAs($reader)->patch(
        "/shelves/{$shelf->slug}/manage/announcements/{$draft->id}",
        ['title' => 'Bạn Đọc Sửa Thông Báo'],
    )->assertNotFound();
});

it('a reader of the shelf 404s on the publish POST', function () {
    [$shelf, $manager, $reader] = amsFix('dong-thap-ams-r-publish');
    $draft = amsSeed($manager, 'Tin Nháp Chưa Đăng');

    test()->actingAs($reader)->post(
        "/shelves/{$shelf->slug}/manage/announcements/{$draft->id}/publish",
        ['expires_at' => ''],
    )->assertNotFound();
});

it('a reader of the shelf 404s on the hide POST', function () {
    [$shelf, $manager, $reader] = amsFix('dong-thap-ams-r-hide');
    $live = amsSeed(
        $manager,
        'Giờ Mở Cửa Mùa Hè',
        publishedAt: CarbonImmutable::parse('2026-08-01 03:00:00', 'UTC'),
    );

    test()->actingAs($reader)->post(
        "/shelves/{$shelf->slug}/manage/announcements/{$live->id}/hide",
    )->assertNotFound();
});

it('a reader of the shelf 404s on the pin POST', function () {
    [$shelf, $manager, $reader] = amsFix('dong-thap-ams-r-pin');
    $draft = amsSeed($manager, 'Tin Nháp Chưa Đăng');

    test()->actingAs($reader)->post(
        "/shelves/{$shelf->slug}/manage/announcements/{$draft->id}/pin",
    )->assertNotFound();
});

it('a reader of the shelf 404s on the unpin POST', function () {
    [$shelf, $manager, $reader] = amsFix('dong-thap-ams-r-unpin');
    $draft = amsSeed($manager, 'Tin Nháp Chưa Đăng', pinned: true);

    test()->actingAs($reader)->post(
        "/shelves/{$shelf->slug}/manage/announcements/{$draft->id}/unpin",
    )->assertNotFound();
});
