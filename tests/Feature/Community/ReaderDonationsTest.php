<?php

use App\Models\BookDonation;
use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Carbon\CarbonImmutable;
use Inertia\Testing\AssertableInertia;

/**
 * THE READER'S TWO Tặng sách SCREENS, over HTTP: the offer form at
 * `shelves.donate` and their own offers at `shelves.profile.donations`.
 * Task 17's DonationQueriesTest owns what MyDonationsQuery answers; this
 * file owns what a request to those two addresses does with the answer —
 * which props reach Inertia, and which statuses a member and a memberless
 * super admin meet.
 *
 * WHAT IS ALREADY COVERED ELSEWHERE AND IS NOT REPEATED HERE. Task 15's
 * tests/Feature/Community/OfferDonationTest.php (opened) already posts the
 * form over HTTP and pins that the offer lands on the caller's membership,
 * that a blank description comes back as a `description` field error rather
 * than the rule banner, and that a signed-in non-member meets 404 on the
 * POST. Those three are the POST half of this screen and they stay where
 * they are.
 *
 * Grep first: `grep -rn "^function rdsFix" tests/` — top-level helpers are
 * process-global (AGENTS.md).
 *
 * KNOWN BLIND SPOT, stated rather than implied, and re-measured in this
 * worktree at this commit rather than inherited: `find resources/js \( -name
 * '*.test.*' -o -name '*.spec.*' \)` printed nothing, `ls vitest.config.*`
 * at the repository root matched nothing, and package.json's `test` script
 * reads `cd old_next && vitest run` — the read-only reference app. So no
 * runner reads the markup of the two pages below, and assertInertia reads
 * SERVER-SIDE props only. What that costs is not re-measurable here and is
 * therefore attributed rather than asserted: docs/known-gaps.md (opened)
 * records, under "No test in this suite would catch a regression in three
 * places", that "swapping the two dashboard stat cards' values is invisible
 * to every gate" because nothing in this repository renders a page and
 * reads back which number sits under which Vietnamese label. So every block
 * below pins a prop, a component name or a status. That the description control is marked *Bắt buộc*, that the
 * decline reason renders under the offer it belongs to, and that the rough
 * count is optional in the markup are pinned by nothing here and were
 * checked by READING resources/js/pages/shelves/donate.tsx and
 * resources/js/pages/shelves/profile/donations.tsx.
 *
 * The fixture does NOT actingAs. docs/known-gaps.md's own entry (opened)
 * reproduced it live: Illuminate\Auth\SessionGuard "resolves and caches
 * `$this->user` on first use and never re-derives it from the request for
 * the rest of that PHP process", including from inside a fixture helper.
 * This file chooses between a reader and a memberless super admin, so it
 * leaves the choice to each block.
 *
 * Returns the shelf, its reader and their membership, then a second reader
 * of the same shelf and theirs.
 *
 * @return array{Bookshelf, User, Membership, User, Membership}
 */
function rdsFix(string $slug = 'dong-thap-rds'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);

    $anh = User::factory()->create(['full_name' => 'Têrêsa Lê Ngọc Ánh']);
    $anhMembership = Membership::factory()->for($shelf)->create([
        'user_id' => $anh->id, 'role' => 'reader', 'status' => 'active',
    ]);

    $minh = User::factory()->create(['full_name' => 'Giuse Trần Minh']);
    $minhMembership = Membership::factory()->for($shelf)->create([
        'user_id' => $minh->id, 'role' => 'reader', 'status' => 'active',
    ]);

    app(TenantContext::class)->set($shelf, $anhMembership);

    return [$shelf, $anh, $anhMembership, $minh, $minhMembership];
}

/**
 * One offer, written straight through the model rather than through
 * OfferDonation, so this file can seed a decided row and a chosen
 * created_at — neither of which that command will produce.
 *
 * A `declined` row is seeded WITH a note because the table refuses one
 * without: `CONSTRAINT book_donations_declined_has_reason CHECK (status <>
 * 'declined' or decision_note is not null)`, quoted from
 * App\Actions\Community\DeclineDonation's docblock (opened).
 *
 * bookshelf_id is left unnamed: BelongsToBookshelf's creating hook stamps
 * it from the bound tenant, which is the shape this project's tenancy guard
 * asks for.
 *
 * Grep first: `grep -rn "^function rdsOffer" tests/`.
 */
function rdsOffer(
    Membership $donor,
    string $description,
    string $status = 'pending',
    ?string $note = null,
    ?string $at = null,
    ?int $count = 5,
): BookDonation {
    return BookDonation::query()->create(array_filter([
        'donor_membership_id' => $donor->id,
        'description' => $description,
        'estimated_count' => $count,
        'status' => $status,
        'decision_note' => $note,
        'created_at' => $at === null ? null : CarbonImmutable::parse($at),
    ], fn ($v) => $v !== null));
}

it('the reader\'s own page carries their offers, newest first', function () {
    [$shelf, $anh, $anhMembership] = rdsFix();

    $oldest = rdsOffer($anhMembership, 'Năm cuốn truyện tranh', at: '2026-08-01 09:00:00');
    $newest = rdsOffer($anhMembership, 'Hai cuốn Dế Mèn', at: '2026-08-03 09:00:00');
    $middle = rdsOffer($anhMembership, 'Một chồng sách giáo khoa', at: '2026-08-02 09:00:00');

    $response = test()->actingAs($anh)->get("/shelves/{$shelf->slug}/profile/donations");

    // BY ID, AND FIRST. A failed expect() aborts the whole Pest method, so
    // the named probe has to be the statement that fires; and ids rather
    // than descriptions or a count because the order is the fact, and three
    // rows in the wrong order still count three.
    expect(array_column($response->viewData('page')['props']['mine'], 'donationId'))
        ->toBe([$newest->id, $middle->id, $oldest->id], 'newest first, by id');

    // AFTER the titled line, deliberately: this pins the page the props
    // land on, which is a different fact from the order they arrive in.
    // Through assertInertia rather than the prop bag alone, because
    // AssertableInertia does a json_decode(json_encode($page)) round trip
    // and fails with "Not a valid Inertia response." if it cannot encode —
    // the guard against handing a bare Eloquent model to Inertia.
    $response->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page->component('shelves/profile/donations'));
});

it('a declined offer carries the manager\'s reason to the reader', function () {
    // The whole reason a decline requires a reason: the reader reads it.
    [$shelf, $anh, $anhMembership] = rdsFix('dong-thap-rds-declined');

    $declined = rdsOffer(
        $anhMembership,
        'Một chồng sách ướt',
        status: 'declined',
        note: 'Sách đã quá cũ và ướt, tủ sách chưa nhận được.',
    );

    $rows = test()->actingAs($anh)
        ->get("/shelves/{$shelf->slug}/profile/donations")
        ->viewData('page')['props']['mine'];

    $row = collect($rows)->firstWhere('donationId', $declined->id);

    // Keyed by id and probed for the NOTE first. Reading the note off row 0
    // would pass on a page that shipped one row's note under another row's
    // id, which on this screen is a manager's refusal shown beside the
    // wrong bag of books.
    // ?? null so a missing row fails as a value comparison rather than as
    // a null-offset notice — the mutation that drops the key should read as
    // a wrong answer, not as a broken test.
    expect($row['decisionNote'] ?? null)->toBe(
        'Sách đã quá cũ và ướt, tủ sách chưa nhận được.',
        'the reason reaches the donor, keyed to their own offer',
    );

    expect($row['status'])->toBe('declined');
});

it('another reader\'s offers are not on this reader\'s page', function () {
    [$shelf, $anh, $anhMembership, , $minhMembership] = rdsFix('dong-thap-rds-mine');

    $mine = rdsOffer($anhMembership, 'Sách của em Ánh');
    $theirs = rdsOffer($minhMembership, 'Sách của bạn Minh');

    $ids = array_column(
        test()->actingAs($anh)
            ->get("/shelves/{$shelf->slug}/profile/donations")
            ->viewData('page')['props']['mine'],
        'donationId',
    );

    // BY ID, NOT BY COUNT. A count of one is also what a page that showed
    // the wrong reader's single offer would report.
    expect($ids)->toBe([$mine->id], 'only this reader\'s own offer');

    expect($ids)->not->toContain($theirs->id);
});

it('an offer made on another shelf is not on this shelf\'s page', function () {
    // THE SAME PERSON on both shelves, which is what makes this a question
    // at all: two different people would be separated by the donor
    // predicate alone. What this block pins is the whole path — the
    // membership ResolveTenant hands the controller for the shelf in the
    // URL is the one whose offers come back — and NOT, on its own, which
    // of the two guards does the separating. Task 17's DonationQueriesTest
    // has the block that isolates BookshelfScope, by running a foreign
    // membership under this shelf's binding, which no HTTP request can do.
    [$shelfA, $anh, $membershipA] = rdsFix('dong-thap-rds-here');
    $here = rdsOffer($membershipA, 'Sách gửi tủ sách Đồng Tháp');

    app(TenantContext::class)->actSystemWide();
    $shelfB = Bookshelf::factory()->create(['slug' => 'dong-thap-rds-elsewhere', 'settings' => []]);
    $membershipB = Membership::factory()->for($shelfB)->create([
        'user_id' => $anh->id, 'role' => 'reader', 'status' => 'active',
    ]);
    app(TenantContext::class)->set($shelfB, $membershipB);
    $elsewhere = rdsOffer($membershipB, 'Sách gửi tủ sách bên kia');
    app(TenantContext::class)->set($shelfA, $membershipA);

    $ids = array_column(
        test()->actingAs($anh)
            ->get("/shelves/{$shelfA->slug}/profile/donations")
            ->viewData('page')['props']['mine'],
        'donationId',
    );

    expect($ids)->toBe([$here->id], 'this shelf\'s offer only');

    expect($ids)->not->toContain($elsewhere->id);
});

it('the offer form opens for a reader of the shelf', function () {
    // THE POSITIVE CONTROL, and this file says which kind. A block that
    // asserts only a 404 stays green against a route that was deleted
    // outright — measured in this project — but the vacuity is narrower
    // than that: where a sibling route already claims the URI, an unrouted
    // METHOD answers 405 rather than 404. THIS URI is the second case.
    // routes/web.php declares `Route::post('/donate', ...)` beside the GET
    // (opened at this commit), so deleting the GET leaves a GET to
    // /donate answering 405, and Task 15's non-member POST block —
    // asserting 404 — still discriminates too. What this block adds that
    // 405 does not is the COMPONENT: a GET that reached the wrong page, or
    // the under-construction placeholder it replaced, is invisible to a
    // status assertion.
    [$shelf, $anh] = rdsFix('dong-thap-rds-form');

    test()->actingAs($anh)->get("/shelves/{$shelf->slug}/donate")
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('shelves/donate')
            ->where('isMember', true));
});

it('a signed-in non-member is 404 on the offer form, not 403', function () {
    // ADDED AFTER REVIEW. Mutation 3 (dropping role:reader from the group)
    // reddened eighteen blocks across the branch and NONE in this file,
    // because no block here holds GET /donate against a non-member. The
    // gate is real but structural — RouteOrderTest sweeps every
    // shelves/{shelf} route for a role: middleware, by construction rather
    // than by name — and ShellTest pins profile/donations by name. This
    // URI had neither.
    //
    // 404 and not 403 is spec §5.4: a refusal must not tell a stranger
    // which shelf URLs are real.
    [$shelf] = rdsFix('dong-thap-rds-stranger');
    $stranger = User::factory()->create(['full_name' => 'Anna Người Lạ']);

    test()->actingAs($stranger)->get("/shelves/{$shelf->slug}/donate")
        ->assertNotFound();
});

it('a memberless super admin gets the form without the form, and an empty list', function () {
    // NOT defence in depth — a live path, and the reason both pages carry
    // an isMember prop at all. AppServiceProvider's Gate::before grants
    // every act-as-* ability to a super admin, so role:reader admits one to
    // a shelf they hold no membership of, and ResolveTenant resolves only
    // ACTIVE memberships, so they arrive with a null membership.
    // MyDonationsQuery::run takes a Membership and not a nullable one, so
    // without the branch this pins, the reader-facing GET would be a 500.
    //
    // Task 15's OfferDonationTest has the POST end of the same case: a
    // memberless super admin who submits meets `not_permitted` as a
    // Vietnamese sentence over a 302. This is why the app should not have
    // offered them the box to type in — the reference's own words for this
    // branch, in old_next/src/app/tu-sach/[shelf]/(doc-gia)/ho-so/
    // tang-sach/page.tsx (opened): "a form the app should not have
    // offered".
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => 'dong-thap-rds-super', 'settings' => []]);
    $admin = User::factory()->superAdmin()->create(['full_name' => 'Giuse Quản Trị Toàn Hệ Thống']);

    test()->actingAs($admin)->get("/shelves/{$shelf->slug}/donate")
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('shelves/donate')
            ->where('isMember', false));
});

it('a memberless super admin\'s own-offers page is empty rather than a 500', function () {
    // Its own it(), apart from the form above: a failed expect() aborts the
    // whole METHOD and these are two routes, in two different route groups,
    // meeting the same null membership.
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => 'dong-thap-rds-super-list', 'settings' => []]);
    $admin = User::factory()->superAdmin()->create(['full_name' => 'Giuse Quản Trị Toàn Hệ Thống']);

    test()->actingAs($admin)->get("/shelves/{$shelf->slug}/profile/donations")
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('shelves/profile/donations')
            ->where('isMember', false)
            ->where('mine', []));
});
