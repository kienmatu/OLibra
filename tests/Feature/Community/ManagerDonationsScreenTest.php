<?php

use App\Models\BookDonation;
use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Carbon\CarbonImmutable;
use Inertia\Testing\AssertableInertia;

/**
 * THE MANAGER'S DONATION QUEUE, over HTTP: the list at
 * `shelves.manage.donations` and the two decisions a volunteer makes on a
 * row. Task 17's DonationQueriesTest owns what DonationQueueQuery answers
 * and Task 16's DonationDecisionsTest owns what the two commands do; this
 * file owns what a request to those three addresses does with them —
 * which props reach Inertia, which column each POST moves, what the
 * volunteer is told afterwards, and which statuses a reader meets.
 *
 * WHAT THE FLASH IS DOING HERE AT ALL, because it is not decoration. BR
 * §16.3's Donation queue paragraph (opened) describes *Duyệt* as opening
 * "the add-book form with **Người tặng** pre-filled with that member",
 * and that pre-fill needs a member picker docs/known-gaps.md (opened)
 * defers for want of `GetReadersList`. So this phase ships the fallback
 * deliberately: the redirect lands back on the queue and the success
 * flash carries the donor's NAME, which is exactly what the add-book form
 * can already take — resources/js/pages/manage/books/create.tsx (opened)
 * carries a `donor_name` field in its form type, its useForm seed, its
 * transform and its markup. 'Duyệt hands the donor's name to the
 * volunteer in the success flash' is the block that pins it, and it is
 * the whole of the hand-off this phase ships.
 *
 * Grep first: `grep -rn "^function dmqFix" tests/` — top-level helpers
 * are process-global (AGENTS.md).
 *
 * THE READER BLOCKS AND WHAT THEY ARE WORTH. 404 is also what a route
 * that does not exist answers, so a reader-404 block on its own can stay
 * green against a deleted route. Task 18's donate pair escaped that
 * because a sibling route already claimed its URI, which turns a deleted
 * method into a 405; MEASURED for these three URIs instead of assumed —
 * with all three route lines commented out and the reader blocks run, all
 * three answered 404, so none of them discriminates on its own. Each
 * therefore leans on the positive sibling above it: 'the queue lists this
 * shelf's pending offers oldest first, with the donor's name' demands 200
 * and a component name from the index, and the two Duyệt/Từ chối blocks
 * demand a 302 and a moved column from the two POSTs. The run and its
 * numbers are in this task's report.
 *
 * KNOWN BLIND SPOT, re-measured in this worktree at this commit rather
 * than inherited: `find resources/js \( -name '*.test.*' -o -name
 * '*.spec.*' \)` printed nothing, `ls vitest.config.*` at the repository
 * root matched nothing, and package.json's `test` script reads `cd
 * old_next && vitest run` — the read-only reference app. So no runner
 * reads the markup of resources/js/pages/manage/donations.tsx, and
 * assertInertia reads SERVER-SIDE props only. That the decline reason
 * renders inside the row whose form produced it, that *Bắt buộc* sits
 * beside it, and that the nav item points at this screen are pinned by
 * nothing here and were checked by READING that file and
 * resources/js/layouts/manage-layout.tsx.
 *
 * The fixture does NOT actingAs: SessionGuard caches the acting user for
 * a whole test method, and the blocks below choose between a manager and
 * a reader.
 *
 * @return array{Bookshelf, User, User, Membership} shelf, manager, reader, the reader's membership
 */
function dmqFix(string $slug = 'dong-thap-dmq'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);

    $manager = User::factory()->create(['full_name' => 'Maria Nguyễn Thị Lan']);
    $managerMembership = Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);

    $reader = User::factory()->create(['full_name' => 'Têrêsa Lê Ngọc Ánh']);
    $readerMembership = Membership::factory()->for($shelf)->create([
        'user_id' => $reader->id, 'role' => 'reader', 'status' => 'active',
    ]);

    // Bound to the MANAGER's membership so the model writes dmqOffer makes
    // are stamped for this shelf; every HTTP request below re-resolves the
    // tenant through the `tenant` middleware for whoever is signed in.
    app(TenantContext::class)->set($shelf, $managerMembership);

    return [$shelf, $manager, $reader, $readerMembership];
}

/**
 * One pending offer, written straight through the model rather than
 * through OfferDonation, so this file can choose a created_at — which
 * that command will not let it do, and which is the whole of what the
 * oldest-first block is about.
 *
 * No `status` key: the column defaults to 'pending', which is the state
 * every block here starts from.
 *
 * bookshelf_id is left unnamed — BelongsToBookshelf's creating hook
 * stamps it from the bound tenant.
 *
 * Grep first: `grep -rn "^function dmqOffer" tests/`.
 */
function dmqOffer(
    Membership $donor,
    string $description,
    ?string $at = null,
    ?int $count = 5,
): BookDonation {
    return BookDonation::query()->create(array_filter([
        'donor_membership_id' => $donor->id,
        'description' => $description,
        'estimated_count' => $count,
        'created_at' => $at === null ? null : CarbonImmutable::parse($at),
    ], fn ($v) => $v !== null));
}

it('the queue lists this shelf\'s pending offers oldest first, with the donor\'s name', function () {
    [$shelf, $manager, , $readerMembership] = dmqFix('dong-thap-dmq-index');

    // SEEDED OUT OF ORDER, deliberately: three rows inserted newest-first
    // is what makes the ordering assertion below a question rather than a
    // restatement of the insertion order. Reversing the query's ORDER BY
    // reddens this block, which is the check that the fixture is not the
    // defect.
    $newest = dmqOffer($readerMembership, 'Hai cuốn Dế Mèn', at: '2026-08-03 09:00:00');
    $oldest = dmqOffer($readerMembership, 'Năm cuốn truyện tranh', at: '2026-08-01 09:00:00');
    $middle = dmqOffer($readerMembership, 'Một chồng sách giáo khoa', at: '2026-08-02 09:00:00');

    $response = test()->actingAs($manager)->get("/shelves/{$shelf->slug}/manage/donations");

    // BY ID, AND FIRST. A failed expect() aborts the whole Pest method, so
    // the named probe has to be the statement that fires; and ids rather
    // than descriptions or a count, because the order is the fact and
    // three rows in the wrong order still count three.
    expect(array_column($response->viewData('page')['props']['queue'], 'donationId'))
        ->toBe([$oldest->id, $middle->id, $newest->id], 'oldest first, by id — a queue, not a pile');

    // The donor, keyed to their own row rather than read off row 0 of a
    // list this block has not yet fixed the order of — the order line
    // above is what makes index 0 mean the oldest offer.
    expect($response->viewData('page')['props']['queue'][0]['donorName'])
        ->toBe('Têrêsa Lê Ngọc Ánh');

    // AFTER the titled lines: this pins which page the props land on,
    // which is a different fact from what is in them. Through
    // assertInertia rather than the prop bag alone, because
    // AssertableInertia does a json_decode(json_encode($page)) round trip
    // and fails with "Not a valid Inertia response." if it cannot encode —
    // the guard against handing a bare Eloquent model to Inertia.
    $response->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page->component('manage/donations'));
});

it('Duyệt receives the offer and lands back on the queue', function () {
    [$shelf, $manager, , $readerMembership] = dmqFix('dong-thap-dmq-receive');
    $offer = dmqOffer($readerMembership, 'Một túi sách thiếu nhi còn khá mới');

    $response = test()->actingAs($manager)
        ->post("/shelves/{$shelf->slug}/manage/donations/{$offer->id}/receive");

    expect(BookDonation::query()->findOrFail($offer->id)->status->value)
        ->toBe('received', 'Duyệt moves the offer out of the pending queue');

    // The queue by name, not back(): this screen carries no ?status= or
    // any other view the volunteer would be dropped out of, so the
    // redirect can say where it goes.
    $response->assertRedirect("/shelves/{$shelf->slug}/manage/donations");
});

it('Duyệt hands the donor\'s name to the volunteer in the success flash', function () {
    // ITS OWN BLOCK, apart from the receive above, and the split is the
    // Pest trap rather than a style: a failed expect() aborts the whole
    // METHOD, so pinning the flash in the same block as the status means a
    // broken flash hides whether the offer moved at all.
    //
    // THIS IS THE HAND-OFF. No pre-fill ships in this phase (see the file
    // docblock), so the donor's name in this sentence is the whole of what
    // tells a volunteer whose bag of books they are holding when they walk
    // to the add-book form.
    [$shelf, $manager, , $readerMembership] = dmqFix('dong-thap-dmq-flash');
    $offer = dmqOffer($readerMembership, 'Một túi sách thiếu nhi còn khá mới');

    test()->actingAs($manager)
        ->post("/shelves/{$shelf->slug}/manage/donations/{$offer->id}/receive");

    $flash = (string) session('success');

    // The NAME as a literal, not __('rules.donation_received_flash', …)
    // rebuilt here: a test that renders the same template the controller
    // did would stay green with the :name placeholder deleted from the
    // lang line, because both sides would lose it together.
    expect(str_contains($flash, 'Têrêsa Lê Ngọc Ánh'))
        ->toBeTrue("the success flash names the donor; it read: {$flash}");
});

it('Từ chối declines the offer with the reason the reader will read', function () {
    [$shelf, $manager, , $readerMembership] = dmqFix('dong-thap-dmq-decline');
    $offer = dmqOffer($readerMembership, 'Một chồng sách ướt');

    $response = test()->actingAs($manager)->post(
        "/shelves/{$shelf->slug}/manage/donations/{$offer->id}/decline",
        ['reason' => 'Sách đã quá cũ và ướt, tủ sách chưa nhận được.'],
    );

    $row = BookDonation::query()->findOrFail($offer->id);

    // THE REASON FIRST, because it is the half that can silently go
    // missing: a decline that moved the status and dropped the note would
    // be a refusal the child reads with no sentence under it. (The column
    // refuses that particular pair outright —
    // book_donations_declined_has_reason — but a note carrying the wrong
    // string, or the field name mis-spelled between the Form Request and
    // the command, is not something the constraint can see.)
    expect($row->decision_note)
        ->toBe('Sách đã quá cũ và ướt, tủ sách chưa nhận được.', 'the reason is stored on the offer');

    expect($row->status->value)->toBe('declined');

    $response->assertRedirect("/shelves/{$shelf->slug}/manage/donations");
});

it('Từ chối with no reason is a field error, not a banner', function () {
    // Two different responses, not two spellings of one: ValidationException
    // renders per-field and RuleViolated renders as a 302 carrying `rule`
    // for the page banner. The reason box lives INSIDE the row's own
    // <details> — a dozen offers means a dozen of them — so a page-head
    // banner would land rows away from the one the volunteer has open. The
    // 2a whole-branch review moved field errors out of a page head for
    // exactly this reason.
    [$shelf, $manager, , $readerMembership] = dmqFix('dong-thap-dmq-blank');
    $offer = dmqOffer($readerMembership, 'Một chồng sách ướt');

    test()->actingAs($manager)->post(
        "/shelves/{$shelf->slug}/manage/donations/{$offer->id}/decline",
        ['reason' => ''],
    )
        ->assertSessionHasErrors(['reason'])
        ->assertSessionDoesntHaveErrors('rule');
});

it("another shelf's offer id 404s under this shelf's manage URL", function (string $suffix, array $body) {
    // THE BINDING HALF of plan divergence 3, which had nothing to bind
    // when Task 16 shipped: App\Actions\Community\ReceiveDonation's
    // docblock recorded that routes/web.php named no address reaching
    // either decision command, so route-model binding could not be
    // exercised. These two routes are that address, and this block is the
    // measurement that docblock asked for.
    [$shelfA, $manager] = dmqFix('dong-thap-dmq-here');

    app(TenantContext::class)->actSystemWide();
    $shelfB = Bookshelf::factory()->create(['slug' => 'dong-thap-dmq-elsewhere', 'settings' => []]);
    $donorB = User::factory()->create(['full_name' => 'Giuse Trần Minh']);
    $membershipB = Membership::factory()->for($shelfB)->create([
        'user_id' => $donorB->id, 'role' => 'reader', 'status' => 'active',
    ]);
    app(TenantContext::class)->set($shelfB, $membershipB);
    $elsewhere = dmqOffer($membershipB, 'Sách gửi tủ sách bên kia');

    test()->actingAs($manager)->post(
        "/shelves/{$shelfA->slug}/manage/donations/{$elsewhere->id}{$suffix}",
        $body,
    )->assertNotFound();

    // 404 IS NOT ENOUGH ON ITS OWN — it is also what a bad id answers.
    // The row must still be pending, or a leak that refused the response
    // after writing would pass.
    app(TenantContext::class)->set($shelfB, $membershipB);
    expect(BookDonation::query()->findOrFail($elsewhere->id)->status->value)
        ->toBe('pending', 'the other shelf\'s offer is untouched');
})->with([
    'POST receive' => ['/receive', []],
    'POST decline' => ['/decline', ['reason' => 'Không nhận.']],
]);

/*
 * THREE BLOCKS FOR THE READER, NOT ONE. A failed expect() aborts the whole
 * test METHOD, so a regression that reopened the list would also hide
 * whether the two writes beneath it still refused.
 *
 * 404, never 403 — spec §5.4's anti-enumeration rule: a reader of this
 * shelf must not learn from a status code that the donation queue, or any
 * particular offer id, is there.
 *
 * What each answers when the route group's `role:manager` is removed
 * differs per route and is recorded in this task's report, measured rather
 * than predicted.
 */
it('a reader of the shelf 404s on the donation queue', function () {
    [$shelf, , $reader] = dmqFix('dong-thap-dmq-r-index');

    test()->actingAs($reader)->get("/shelves/{$shelf->slug}/manage/donations")
        ->assertNotFound();
});

it('a reader of the shelf 404s on the Duyệt POST', function () {
    [$shelf, , $reader, $readerMembership] = dmqFix('dong-thap-dmq-r-receive');
    $offer = dmqOffer($readerMembership, 'Sách của chính bạn đọc này');

    // THEIR OWN offer, which is the sharper case: the refusal is about the
    // ROLE the decision needs, not about whose row it is.
    test()->actingAs($reader)
        ->post("/shelves/{$shelf->slug}/manage/donations/{$offer->id}/receive")
        ->assertNotFound();
});

it('a reader of the shelf 404s on the Từ chối POST', function () {
    [$shelf, , $reader, $readerMembership] = dmqFix('dong-thap-dmq-r-decline');
    $offer = dmqOffer($readerMembership, 'Sách của chính bạn đọc này');

    test()->actingAs($reader)->post(
        "/shelves/{$shelf->slug}/manage/donations/{$offer->id}/decline",
        ['reason' => 'Tự từ chối chính mình.'],
    )->assertNotFound();
});

/*
 * BR §16.3's COUNT BADGE, which Task 19 deferred on a false premise and
 * this fix round ships. The requirement is that paragraph's first
 * sentence — "Reachable from the sidebar nav with a count badge" — and
 * the badge is a SHARED prop, `pendingDonations`, because the nav that
 * renders it is on every manage screen rather than on the queue's own
 * page (App\Http\Middleware\HandleInertiaRequests::share, opened).
 *
 * TWO BLOCKS, NOT ONE, and the split is the Pest trap rather than tidiness:
 * a failed expect() aborts the whole METHOD, so a badge that leaked to
 * readers must be able to fail without the number's own block hiding it.
 * The gate is half the requirement — a number is a fact about a screen,
 * and a reader who cannot open that screen should not be told how many
 * rows are on it.
 *
 * Neither block reads the markup — the file docblock above records what
 * this repo's frontend runner situation was measured to be at this commit
 * — so what is pinned here is the PROP the badge renders from.
 * resources/js/layouts/manage-layout.tsx was opened: its *Tặng sách* item
 * takes its name from `pendingDonations`, falling to the bare word when
 * that is null or 0.
 */
it('the manage nav badge prop carries the pending count for a manager', function () {
    [$shelf, $manager, , $readerMembership] = dmqFix('dong-thap-dmq-badge');

    // A decided row beside the pending pair: a badge counting every offer
    // ever made would answer 3 here, and a fixture of pending rows alone
    // could not tell that apart from the right answer.
    dmqOffer($readerMembership, 'Hai cuốn Dế Mèn');
    dmqOffer($readerMembership, 'Năm cuốn truyện tranh');
    $received = dmqOffer($readerMembership, 'Đã nhận rồi');
    $received->update(['status' => 'received']);

    $response = test()->actingAs($manager)->get("/shelves/{$shelf->slug}/manage/donations");

    // THE NUMBER FIRST, through assertInertia so the assertion reads the
    // shared bag Inertia actually built rather than the props array the
    // controller returned — the badge rides share(), not the controller.
    $response->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page->where('pendingDonations', 2));

    // AND THE LIST IT BADGES, in the same response: the badge and the rows
    // beneath it are two reads of one predicate (App\Queries\
    // DonationQueueQuery shares a private pending() between them), and this
    // is the HTTP-level statement of that. DonationQueriesTest owns the
    // structural half.
    expect($response->viewData('page')['props']['pendingDonations'])
        ->toBe(count($response->viewData('page')['props']['queue']), 'the badge counts the rows on the screen it opens');
});

it('a reader of the shelf gets no badge at all — null, not a number', function () {
    // The gate half. This asserts on a page a READER may open (their own
    // Tặng sách screen, role:reader), because the manage screen 404s them
    // and a 404 carries no props to check. A pending offer is seeded
    // FIRST, so `null` here is the gate refusing rather than an empty
    // table answering zero — which is the whole difference between this
    // block and one that would stay green with the gate deleted.
    [$shelf, , $reader, $readerMembership] = dmqFix('dong-thap-dmq-badge-reader');
    dmqOffer($readerMembership, 'Năm cuốn truyện tranh');

    test()->actingAs($reader)->get("/shelves/{$shelf->slug}/profile/donations")
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page->where('pendingDonations', null));
});

it('Duyệt on an offer whose donor has gone says so instead of naming nobody', function () {
    // Fix round 1, item 2. The soft-deleted donor is the case
    // App\Queries\DonationQueueQuery's docblock reasons about from the
    // trait without measuring; this block measures it, on the flash rather
    // than on the query. Before the fix this printed `Đã nhận lời tặng của
    // . Khi thêm sách vào kho, hãy điền "" vào ô Người tặng.`
    //
    // Its own it(), apart from the named-donor flash above: a failed
    // expect() aborts the METHOD, so these two sentences have to be able
    // to fail independently.
    [$shelf, $manager, $reader, $readerMembership] = dmqFix('dong-thap-dmq-flash-nodonor');
    $offer = dmqOffer($readerMembership, 'Một túi sách thiếu nhi còn khá mới');

    // The USER, which is what the name is read through
    // (donor?->user?->full_name). Soft delete, not a hard one: the
    // donations row's foreign key still points at a live memberships row.
    $reader->delete();

    test()->actingAs($manager)
        ->post("/shelves/{$shelf->slug}/manage/donations/{$offer->id}/receive");

    $flash = (string) session('success');

    // No empty quotes and no dangling "của", asserted as the absence of
    // the broken shape AND the presence of the replacement — either alone
    // would stay green against a flash that had simply gone missing.
    expect($flash)->toBe(
        'Đã nhận lời tặng. Lời tặng này không còn tên người tặng, nên hãy để trống ô Người tặng khi thêm sách vào kho.',
        'a donor-less offer gets its own sentence',
    );
});
