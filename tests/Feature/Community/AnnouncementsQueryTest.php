<?php

use App\Actions\Community\CreateAnnouncement;
use App\Models\Announcement;
use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\User;
use App\Queries\AnnouncementsQuery;
use App\Support\TenantContext;
use Carbon\Carbon;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * The read side of Slice B: one bound instant, three shapes, and a lapse
 * that happens with nothing having run.
 *
 * Grep first: `grep -rn "^function anqFix" tests/` — top-level helpers
 * are process-global (AGENTS.md).
 *
 * anqFix binds a fresh shelf with a manager acting on it and hands the
 * manager back; anqPost puts one announcement on whatever shelf is bound
 * at the moment it is called. They are two functions rather than one
 * because every block here needs several announcements on ONE shelf,
 * which is the opposite of AnnouncementStateTest's anpFix (one shelf, one
 * announcement, four starting states).
 *
 * The seed goes through CreateAnnouncement rather than a factory: I
 * looked in database/factories and there is no AnnouncementFactory
 * there, and the command is the door Task 9 built onto this table.
 */
function anqFix(string $slug): User
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);
    $manager = User::factory()->create(['full_name' => 'Maria Quản Lý Kho']);
    $mm = Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);
    app(TenantContext::class)->set($shelf, $mm);
    test()->actingAs($manager);

    return $manager;
}

/**
 * $publishedAt, $expiresAt and $pinned are parameters for the same reason
 * anpFix takes them: which of four starting states a row is in — draft,
 * live, lapsed, pinned — is the whole subject of this file.
 */
function anqPost(
    User $manager,
    string $title,
    ?CarbonImmutable $publishedAt = null,
    ?CarbonImmutable $expiresAt = null,
    bool $pinned = false,
    string $body = 'Tủ sách mở cửa lại từ thứ Hai.',
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

/**
 * The slugs of a shape, in the order the shape returned them. Written as
 * a helper so an ordering assertion compares a LIST against a list, which
 * is what makes a permutation visible.
 *
 * @param  list<array{slug: string}>  $rows
 * @return list<string>
 */
function anqSlugs(array $rows): array
{
    return array_column($rows, 'slug');
}

afterEach(fn () => Carbon::setTestNow());

it('a draft is invisible to published()', function () {
    $manager = anqFix('dong-thap-anq-draft');
    anqPost($manager, 'Tin Nháp Chưa Đăng');

    expect(anqSlugs(app(AnnouncementsQuery::class)->published()))->toBe([]);
});

it('a draft is present in managed() labelled draft', function () {
    // The other half of the pair, written apart: a draft that vanished
    // from BOTH shapes would leave the block above green, and managing a
    // draft is exactly the job the reader-facing filter gets in the way
    // of.
    $manager = anqFix('dong-thap-anq-draft-managed');
    $draft = anqPost($manager, 'Tin Nháp Chưa Đăng');

    $rows = app(AnnouncementsQuery::class)->managed();

    expect(anqSlugs($rows))->toBe([$draft->slug]);
    expect($rows[0]['state'])->toBe('draft');
});

it('a live announcement is labelled showing', function () {
    // The third label. Without it, a state helper that answered 'draft'
    // or 'expired' to everything would pass both blocks above.
    $manager = anqFix('dong-thap-anq-showing');
    Carbon::setTestNow(CarbonImmutable::parse('2026-08-30 04:00:00', 'UTC'));
    anqPost(
        $manager,
        'Tin Đang Hiện',
        publishedAt: CarbonImmutable::parse('2026-08-01 03:00:00', 'UTC'),
    );

    expect(app(AnnouncementsQuery::class)->managed()[0]['state'])->toBe('showing');
});

it('managed() labels an announcement scheduled for next week draft', function () {
    // THE FOURTH ROUTE INTO 'draft': published_at SET, but set ahead of
    // the bound instant. MEASURED, with `|| $publishedAt->greaterThan($at)`
    // deleted from state(): this block is the run's single failure, so the
    // reader's shapes are unmoved by that branch — showing() keeps a future
    // published_at out of the result set before state() is ever consulted.
    // What the branch changes is the CHIP: a notice queued for next Sunday
    // would render "Đang hiện" on the manager's screen while no reader
    // could open it — the reader/manager disagreement the boundary pair
    // rules out, in the direction that pair does not reach.
    $manager = anqFix('dong-thap-anq-scheduled');
    Carbon::setTestNow(CarbonImmutable::parse('2026-08-30 04:00:00', 'UTC'));

    anqPost(
        $manager,
        'Tin Hẹn Chủ Nhật Tuần Sau',
        publishedAt: CarbonImmutable::parse('2026-09-06 04:00:00', 'UTC'),
    );

    expect(app(AnnouncementsQuery::class)->managed()[0]['state'])->toBe('draft');
});

it('an announcement lapses on the clock alone, with no write and no job', function () {
    // G5, and the reason this query exists in the shape it does: expiry
    // is evaluated at READ time, so an announcement drops out of the
    // reader's list the instant its expires_at passes and nothing has to
    // have run for that to be true.
    //
    // "Nothing wrote" is asserted as a FACT rather than left as a hope:
    // updated_at carries ON UPDATE current_timestamp(6) on this table
    // (read off `show create table announcements`), so any UPDATE the
    // read had issued against the row would move it, and the comparison
    // at the end would fail.
    $manager = anqFix('dong-thap-anq-lapse');
    Carbon::setTestNow(CarbonImmutable::parse('2026-08-30 04:00:00', 'UTC'));

    $row = anqPost(
        $manager,
        'Tin Có Hạn',
        publishedAt: CarbonImmutable::parse('2026-08-01 03:00:00', 'UTC'),
        expiresAt: CarbonImmutable::parse('2026-09-01 03:00:00', 'UTC'),
    );

    expect(anqSlugs(app(AnnouncementsQuery::class)->published()))->toBe([$row->slug]);

    $stamped = Announcement::query()->sole()->updated_at;

    // The clock moves past the expiry. No command runs, no job runs, and
    // nothing between the two reads touches the table.
    Carbon::setTestNow(CarbonImmutable::parse('2026-09-02 04:00:00', 'UTC'));

    expect(anqSlugs(app(AnnouncementsQuery::class)->published()))->toBe([]);
    expect(Announcement::query()->sole()->updated_at?->equalTo($stamped))->toBeTrue();
});

it('at expires_at exactly equal to the bound instant the row is absent from published()', function () {
    // The boundary, read from the reader's side. `expires_at > at` is
    // the comparison, so equality lapses.
    $manager = anqFix('dong-thap-anq-boundary-read');
    $at = CarbonImmutable::parse('2026-09-01 03:00:00', 'UTC');
    Carbon::setTestNow($at);

    anqPost(
        $manager,
        'Tin Hết Hạn Đúng Lúc',
        publishedAt: CarbonImmutable::parse('2026-08-01 03:00:00', 'UTC'),
        expiresAt: $at,
    );

    expect(anqSlugs(app(AnnouncementsQuery::class)->published()))->toBe([]);
});

it('at expires_at exactly equal to the bound instant managed() labels the row expired', function () {
    // The same boundary read from the manager's side, and its own block
    // because a failed expect aborts the whole METHOD — the two halves
    // must be able to fail alone. Together they are what makes the
    // shared state helper load-bearing: one screen dropping the row
    // while the other still calls it "Đang hiện" is the disagreement
    // this pair rules out.
    $manager = anqFix('dong-thap-anq-boundary-manage');
    $at = CarbonImmutable::parse('2026-09-01 03:00:00', 'UTC');
    Carbon::setTestNow($at);

    anqPost(
        $manager,
        'Tin Hết Hạn Đúng Lúc',
        publishedAt: CarbonImmutable::parse('2026-08-01 03:00:00', 'UTC'),
        expiresAt: $at,
    );

    expect(app(AnnouncementsQuery::class)->managed()[0]['state'])->toBe('expired');
});

it('published() binds one instant even against a clock that advances mid-call', function () {
    // THE CONVENTION IN AnnouncementsQuery's CLASS DOCBLOCK, with a guard
    // behind it. published() reads Clock::now() once into a local and
    // binds that local into both the WHERE and the per-row comparison. A
    // second read inside the method would be two instants that differ in
    // production by however long the statement took, and agree to the
    // microsecond under any clock that does not move — which is what
    // makes this fixture's clock move.
    //
    // THE TOOL, and it is the one place in this suite this shape is used:
    // Carbon::setTestNow() also accepts a Closure and re-evaluates it on
    // EVERY read, so the closure below hands out 04:00:00, then 04:00:01,
    // then 04:00:02 … to successive reads in this process. It has to be a
    // `use (&$ticks)` closure and not an arrow function: an arrow function
    // captures $ticks by value, so `$ticks++` would increment a fresh copy
    // each call and the clock would stand still (measured both ways).
    //
    // THE FIXTURE: expires_at is ONE SECOND past the first instant. As
    // shipped, both layers bind 04:00:00 and the row is live. With the
    // per-row comparison rewritten to read the clock again, the WHERE
    // binds 04:00:00 and fetches the row while state() binds 04:00:01,
    // where `expires_at <= at` holds — so the row is dropped and this
    // block reddens.
    //
    // The frozen instant is put back BEFORE the expectation, so an
    // advancing clock cannot outlive this block whichever way it goes.
    $manager = anqFix('dong-thap-anq-one-instant');
    $t0 = CarbonImmutable::parse('2026-08-30 04:00:00', 'UTC');
    Carbon::setTestNow($t0);

    $row = anqPost(
        $manager,
        'Tin Hết Hạn Sau Một Giây',
        publishedAt: CarbonImmutable::parse('2026-08-01 03:00:00', 'UTC'),
        expiresAt: $t0->addSecond(),
    );

    $ticks = 0;
    Carbon::setTestNow(function () use ($t0, &$ticks): CarbonImmutable {
        return $t0->addSeconds($ticks++);
    });

    $slugs = anqSlugs(app(AnnouncementsQuery::class)->published());

    Carbon::setTestNow($t0);

    expect($slugs)->toBe([$row->slug]);
});

it('published() puts pinned first, then most recent, and orders several pins among themselves', function () {
    // BR §16.1's ordering, and the reason more than one pin has to be in
    // the fixture: an ordering AMONG pins only means something if two
    // can exist at once, which AnnouncementStateTest's "more than one
    // announcement may be pinned at once" already pins on the write side.
    //
    // SEEDED OUT OF THE INTENDED ORDER on purpose — insertion order here
    // is A, B, C, D and the expected answer is C, B, D, A, so a query
    // that returned rows in whatever order the table handed them over
    // cannot pass.
    $manager = anqFix('dong-thap-anq-order');
    Carbon::setTestNow(CarbonImmutable::parse('2026-08-30 04:00:00', 'UTC'));

    $a = anqPost($manager, 'Tin A Thường Cũ',
        publishedAt: CarbonImmutable::parse('2026-08-01 03:00:00', 'UTC'));
    $b = anqPost($manager, 'Tin B Ghim Cũ',
        publishedAt: CarbonImmutable::parse('2026-07-01 03:00:00', 'UTC'), pinned: true);
    $c = anqPost($manager, 'Tin C Ghim Mới',
        publishedAt: CarbonImmutable::parse('2026-08-10 03:00:00', 'UTC'), pinned: true);
    $d = anqPost($manager, 'Tin D Thường Mới',
        publishedAt: CarbonImmutable::parse('2026-08-20 03:00:00', 'UTC'));

    expect(anqSlugs(app(AnnouncementsQuery::class)->published()))
        ->toBe([$c->slug, $b->slug, $d->slug, $a->slug]);
});

it('two announcements published at the same instant are separated by id desc', function () {
    // published_at carries no unique constraint, and two notices posted
    // for the same Sunday tie on it BY CONSTRUCTION here. Without a
    // tiebreak the order between them is whatever the sort happened to
    // emit, which is what renumbers rows between two reads of one list.
    //
    // The expectation is DERIVED from the two ids rather than written
    // out, so it pins "descending by id" without also asserting which
    // way v7 ids happen to run under a frozen clock — a fact this block
    // does not need to decide.
    $manager = anqFix('dong-thap-anq-tie');
    Carbon::setTestNow(CarbonImmutable::parse('2026-08-30 04:00:00', 'UTC'));
    $at = CarbonImmutable::parse('2026-08-01 03:00:00', 'UTC');

    $first = anqPost($manager, 'Tin Cùng Giờ Một', publishedAt: $at);
    $second = anqPost($manager, 'Tin Cùng Giờ Hai', publishedAt: $at);

    $expected = collect([$first, $second])
        ->sortByDesc(fn (Announcement $a): string => $a->id)
        ->map(fn (Announcement $a): string => $a->slug)
        ->values()
        ->all();

    expect(anqSlugs(app(AnnouncementsQuery::class)->published()))->toBe($expected);
});

it('managed() sorts a draft by its creation time, in front of an older published announcement', function () {
    // The deliberate difference between the two orderings. A draft has
    // no publication time and would sort last forever under the reader's
    // keys, where a manager wants their newest draft in front of them —
    // so the manager's list falls back to created_at.
    //
    // Seeded out of order again: the published row is written first and
    // comes back second.
    $manager = anqFix('dong-thap-anq-order-managed');

    Carbon::setTestNow(CarbonImmutable::parse('2026-08-01 03:00:00', 'UTC'));
    $live = anqPost($manager, 'Tin Đã Đăng Từ Lâu',
        publishedAt: CarbonImmutable::parse('2026-08-01 03:00:00', 'UTC'));

    Carbon::setTestNow(CarbonImmutable::parse('2026-08-30 04:00:00', 'UTC'));
    $draft = anqPost($manager, 'Tin Nháp Viết Hôm Nay');

    expect(anqSlugs(app(AnnouncementsQuery::class)->managed()))
        ->toBe([$draft->slug, $live->slug]);
});

it('two drafts created in the same instant are separated by id desc in managed()', function () {
    // The manager's list gets the same treatment as the reader's, on
    // its own middle key: with the clock frozen both drafts take the
    // same created_at, so the coalesce ties by construction. Measured
    // against this fixture: with managed()'s id tiebreak deleted, this
    // is the run's single failure.
    $manager = anqFix('dong-thap-anq-tie-managed');
    Carbon::setTestNow(CarbonImmutable::parse('2026-08-30 04:00:00', 'UTC'));

    $first = anqPost($manager, 'Tin Nháp Một');
    $second = anqPost($manager, 'Tin Nháp Hai');

    $expected = collect([$first, $second])
        ->sortByDesc(fn (Announcement $a): string => $a->id)
        ->map(fn (Announcement $a): string => $a->slug)
        ->values()
        ->all();

    expect(anqSlugs(app(AnnouncementsQuery::class)->managed()))->toBe($expected);
});

it("the reader's statement narrows in SQL as well — the wire, pinned in the text", function () {
    // WHY THIS IS ASSERTED ON THE SQL AND NOT ON THE ROWS. published()
    // applies the time rule twice: showing() puts it in the WHERE and
    // state() decides after the fetch. MEASURED three ways with this
    // block absent, on the 19 CASES that were here before it (17 it()
    // blocks, the tenancy dataset counting three) — deleting the PHP
    // filter alone, deleting showing() from published() alone, and
    // deleting showing()'s expiry clause for both its callers each left
    // the file wholly green. So no row-order or row-membership
    // assertion here can see the SQL half, and a later edit could
    // delete it and be told nothing.
    //
    // WITH THE BLOCK PRESENT, re-measured: the second and third of
    // those three are now this block's single failure, and the first
    // still is not. The PHP filter therefore remains unpinned on its
    // own, deliberately — state() is pinned by the boundary pair, and
    // pinning its second call site here would assert the shape of an
    // implementation rather than a behaviour.
    //
    // WHAT IT IS FOR, since it changes no answer today: a shelf accrues
    // lapsed announcements forever while its live set stays small, and
    // the narrowing is what keeps that archive off the wire on every
    // reader page load. That is a property about the STATEMENT, so it is
    // read off the statement.
    //
    // WHAT THIS DOES NOT PROVE: that the narrowing is correct — state()
    // is what decides, and the boundary pair above is what pins the
    // decision. This block only refuses a silent deletion.
    //
    // getQueryLog() only ever sees a statement that returned, which is
    // sound here because published() did not throw.
    $manager = anqFix('dong-thap-anq-sql-pin');
    Carbon::setTestNow(CarbonImmutable::parse('2026-08-30 04:00:00', 'UTC'));
    anqPost(
        $manager,
        'Tin Ghim SQL',
        publishedAt: CarbonImmutable::parse('2026-08-01 03:00:00', 'UTC'),
    );

    DB::flushQueryLog();
    DB::enableQueryLog();
    app(AnnouncementsQuery::class)->published();
    $queries = collect(DB::getQueryLog())->pluck('query');
    DB::disableQueryLog();

    $statement = $queries->first(fn (string $sql) => str_contains($sql, 'from `announcements`'));

    expect($statement)->toContain(
        'where `published_at` is not null and `published_at` <= ? '
        .'and (`expires_at` is null or `expires_at` > ?)',
    );
});

it('detail() returns null for a draft', function () {
    $manager = anqFix('dong-thap-anq-detail-draft');
    $draft = anqPost($manager, 'Tin Nháp Chưa Đăng');

    expect(app(AnnouncementsQuery::class)->detail($draft->slug))->toBeNull();
});

it('detail() returns null for a lapsed announcement — the pasted URL', function () {
    // The difference between a filter and a rule. If the list's expiry
    // were only a presentation choice, a lapsed announcement would still
    // be readable by pasting its address.
    $manager = anqFix('dong-thap-anq-detail-lapsed');
    Carbon::setTestNow(CarbonImmutable::parse('2026-09-02 04:00:00', 'UTC'));

    $lapsed = anqPost(
        $manager,
        'Tin Đã Hết Hạn',
        publishedAt: CarbonImmutable::parse('2026-08-01 03:00:00', 'UTC'),
        expiresAt: CarbonImmutable::parse('2026-09-01 03:00:00', 'UTC'),
    );

    expect(app(AnnouncementsQuery::class)->detail($lapsed->slug))->toBeNull();
});

it('detail() returns null for a slug naming nothing', function () {
    anqFix('dong-thap-anq-detail-missing');

    expect(app(AnnouncementsQuery::class)->detail('khong-co-tin-nao'))->toBeNull();
});

it('detail() returns a live announcement — the three nulls above are not vacuous', function () {
    // Without this block a detail() that answered null to everything
    // would pass the three above, and the 404 the controller builds on
    // it would be every announcement's answer.
    $manager = anqFix('dong-thap-anq-detail-live');
    Carbon::setTestNow(CarbonImmutable::parse('2026-08-30 04:00:00', 'UTC'));

    $live = anqPost(
        $manager,
        'Tin Đang Hiện',
        publishedAt: CarbonImmutable::parse('2026-08-01 03:00:00', 'UTC'),
    );

    expect(app(AnnouncementsQuery::class)->detail($live->slug)['slug'] ?? null)->toBe($live->slug);
});

it('the excerpt is the plain body truncated to 200 characters, counted in characters', function () {
    // A rich body truncated mid-tag is how a list renders half an
    // element, which is what an excerpt derived from the plain column is
    // FOR. True today only in principle — CreateAnnouncement writes
    // body_text from the same trimmed plain body as body (its own
    // divergence 5) — and the plain column is read anyway, so this row
    // shape stays put when a rich editor lands.
    //
    // The body is Vietnamese on purpose: 250 × 'ế' is 750 bytes, so a
    // byte-counting truncation would cut mid-sequence and produce
    // something this equality cannot match.
    $manager = anqFix('dong-thap-anq-excerpt');
    Carbon::setTestNow(CarbonImmutable::parse('2026-08-30 04:00:00', 'UTC'));

    anqPost(
        $manager,
        'Tin Dài',
        publishedAt: CarbonImmutable::parse('2026-08-01 03:00:00', 'UTC'),
        body: str_repeat('ế', 250),
    );

    expect(app(AnnouncementsQuery::class)->published()[0]['excerpt'])->toBe(str_repeat('ế', 200));
});

it('the full body is carried beside the excerpt, untruncated', function () {
    $manager = anqFix('dong-thap-anq-body');
    Carbon::setTestNow(CarbonImmutable::parse('2026-08-30 04:00:00', 'UTC'));

    anqPost(
        $manager,
        'Tin Dài',
        publishedAt: CarbonImmutable::parse('2026-08-01 03:00:00', 'UTC'),
        body: str_repeat('ế', 250),
    );

    expect(app(AnnouncementsQuery::class)->published()[0]['body'])->toBe(str_repeat('ế', 250));
});

it('another shelf\'s announcement is absent from each of the three shapes', function (string $shape) {
    // What confines all three reads is BookshelfScope on the model.
    // PARAMETERISED over the three so a failure names WHICH shape leaked
    // and so one leaking shape cannot hide behind another failing first
    // — a single block with three expects would stop at the first.
    //
    // Task 11's review found four commands shipping a cross-shelf
    // docblock claim with nothing pinning it, and its fix round had to
    // add the block afterwards; this one is written with the code.
    //
    // The OTHER shelf is seeded first so that anqFix's second call
    // leaves this shelf bound and its manager acting — no rebinding, and
    // one actingAs per fixture.
    //
    // Their row is seeded PUBLISHED, LIVE and PINNED so that it would
    // come back FIRST from published() and managed() alike if it could
    // be seen at all.
    Carbon::setTestNow(CarbonImmutable::parse('2026-08-30 04:00:00', 'UTC'));

    $their = anqFix('can-tho-anq-tenancy-b');
    $theirs = anqPost(
        $their,
        'Tin Của Kệ Khác',
        publishedAt: CarbonImmutable::parse('2026-08-01 03:00:00', 'UTC'),
        pinned: true,
    );

    $mine = anqFix('dong-thap-anq-tenancy-a');
    anqPost(
        $mine,
        'Tin Của Kệ Này',
        publishedAt: CarbonImmutable::parse('2026-08-02 03:00:00', 'UTC'),
    );

    $query = app(AnnouncementsQuery::class);

    match ($shape) {
        'published' => expect(anqSlugs($query->published()))->not->toContain($theirs->slug),
        'managed' => expect(anqSlugs($query->managed()))->not->toContain($theirs->slug),
        'detail' => expect($query->detail($theirs->slug))->toBeNull(),
    };
})->with(['published', 'managed', 'detail']);
