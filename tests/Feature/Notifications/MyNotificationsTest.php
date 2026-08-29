<?php

use App\Actions\Notifications\MarkNotificationRead;
use App\Models\AuditLog;
use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\Notification;
use App\Models\User;
use App\Queries\MyNotificationsQuery;
use App\Support\TenantContext;
use Illuminate\Support\Facades\DB;
use Inertia\Testing\AssertableInertia;

/**
 * Shelf + reader with $count notifications (alternating kinds), written
 * OLDEST-FIRST so created_at desc must invert creation order.
 *
 * DELIBERATE DEVIATION from task-16-brief.md's snippet, which ended this
 * helper with `test()->actingAs($reader)`: every HTTP block below calls
 * actingAs itself, so the helper's call would make two actor switches in
 * one test method — the SessionGuard cache the plan is zero-tolerant
 * about (docs/known-gaps.md, Phase 1a). They name the SAME user here, so
 * nothing was broken; the helper simply has no need of it, because every
 * query-level block passes $reader to the query directly.
 *
 * @return array{Bookshelf, User, list<Notification>}
 */
function mynFix(int $count = 3, string $slug = 'dong-thap-myn'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);
    $reader = User::factory()->create(['full_name' => 'Têrêsa Bạn Đọc Nhỏ']);
    $membership = Membership::factory()->for($shelf)->create(['user_id' => $reader->id, 'role' => 'reader', 'status' => 'active']);
    $rows = [];
    for ($i = 0; $i < $count; $i++) {
        $rows[] = Notification::query()->create([
            'bookshelf_id' => $shelf->id, 'user_id' => $reader->id,
            'kind' => 'request_approved',
            'payload' => ['title' => "Cuốn Thứ {$i}", 'hold_until' => '2026-09-0'.($i + 1)],
            'created_at' => now()->subMinutes($count - $i),
        ]);
    }
    app(TenantContext::class)->set($shelf, $membership);

    return [$shelf, $reader, $rows];
}

it('a reader reads their own bell: sentences rendered, newest first, unread counted', function () {
    [, $reader, $rows] = mynFix(3);

    $mine = app(MyNotificationsQuery::class)->run($reader);

    expect($mine['unread'])->toBe(3)
        ->and($mine['rows'][0]['id'])->toBe($rows[2]->id)              // newest first
        ->and($mine['rows'][0]['sentence'])->toBe('Cuốn Thứ 2 đã sẵn sàng, bạn đến nhận trước ngày 03/09/2026 nhé.')
        ->and($mine['rows'][0]['kind'])->toBe('request_approved');
});

it('one reader\'s bell never shows another\'s', function () {
    [$shelf, $reader] = mynFix(1, 'dong-thap-myn-other');
    app(TenantContext::class)->actSystemWide();
    $other = User::factory()->create(['full_name' => 'Anna Người Khác']);
    Notification::query()->create([
        'bookshelf_id' => $shelf->id, 'user_id' => $other->id,
        'kind' => 'membership_approved', 'payload' => [], 'created_at' => now(),
    ]);
    app(TenantContext::class)->set($shelf->fresh(), Membership::query()->where('user_id', $reader->id)->firstOrFail());

    $mine = app(MyNotificationsQuery::class)->run($reader);

    expect($mine['rows'])->toHaveCount(1)
        ->and($mine['unread'])->toBe(1);
});

it('an unknown stored kind renders the neutral sentence, never the token', function () {
    [$shelf, $reader] = mynFix(0, 'dong-thap-myn-unknown');
    app(TenantContext::class)->actSystemWide();
    Notification::query()->create([
        'bookshelf_id' => $shelf->id, 'user_id' => $reader->id,
        'kind' => 'request_teleported', 'payload' => [], 'created_at' => now(),
    ]);
    app(TenantContext::class)->set($shelf->fresh(), Membership::query()->where('user_id', $reader->id)->firstOrFail());

    expect(app(MyNotificationsQuery::class)->run($reader)['rows'][0]['sentence'])
        ->toBe('Bạn có một thông báo mới.');
});

it('marking one read leaves the rest, and marking all clears the bell', function () {
    [, $reader, $rows] = mynFix(3, 'dong-thap-myn-read');

    app(MarkNotificationRead::class)->one($reader, $rows[0]->id);
    expect(app(MyNotificationsQuery::class)->run($reader)['unread'])->toBe(2)
        ->and($rows[0]->fresh()->read_at)->not->toBeNull();

    $marked = app(MarkNotificationRead::class)->all($reader);
    expect($marked)->toBe(2)
        ->and(app(MyNotificationsQuery::class)->run($reader)['unread'])->toBe(0);
});

it('read, never deleted — a cleared bell still lists every row', function () {
    // The reference's own assertion in the same test (notifications.test.ts:
    // "Read, not deleted — the row is still the record that they were
    // told"), split into its own block because a failed expect() aborts the
    // whole METHOD: chained onto the block above, an off-by-one in `all()`'s
    // return would hide this one entirely.
    [, $reader] = mynFix(3, 'dong-thap-myn-kept');

    app(MarkNotificationRead::class)->all($reader);

    expect(app(MyNotificationsQuery::class)->run($reader)['rows'])->toHaveCount(3);
});

it('a reader cannot mark somebody else\'s notification read — a silent no-op', function () {
    [$shelf, $reader] = mynFix(0, 'dong-thap-myn-foreign');
    app(TenantContext::class)->actSystemWide();
    $other = User::factory()->create(['full_name' => 'Anna Người Khác']);
    $foreign = Notification::query()->create([
        'bookshelf_id' => $shelf->id, 'user_id' => $other->id,
        'kind' => 'membership_approved', 'payload' => [], 'created_at' => now(),
    ]);
    app(TenantContext::class)->set($shelf->fresh(), Membership::query()->where('user_id', $reader->id)->firstOrFail());

    app(MarkNotificationRead::class)->one($reader, $foreign->id);   // no exception

    expect($foreign->fresh()->read_at)->toBeNull();
});

it('two notifications written in the same instant come back newest-first by id', function () {
    // The sweep writes many rows in ONE instant, so created_at ties BY
    // CONSTRUCTION; the reference measured the cost of leaving them
    // unordered twice (rows repeating and vanishing across pages). UUIDv7
    // ids are chronologically monotonic, so the row created SECOND has the
    // higher id and must come first — seeding "out of intended order" is
    // impossible for a same-instant pair.
    //
    // WHAT THIS BLOCK DOES AND DOES NOT PIN, measured rather than assumed.
    // It is NOT falsifiable by deleting orderByDesc('id'): removing it
    // leaves every block in this file green — measured directly, by making
    // that deletion and running the file. The query's own docblock carries
    // the re-measured EXPLAIN and the reason (no `Using filesort`, plus
    // InnoDB appending the primary key to notifications_unread, so a
    // descending scan already emits descending id inside a created_at
    // tie). It is NOT restated here, because this comment previously
    // carried a plan captured from a differently-shaped probe and a
    // maintainer reading two copies of a plan trusts neither.
    // It IS falsifiable in the direction that matters: mutating the
    // tiebreak to ->orderBy('id') (ascending) reddens exactly this block
    // and nothing else — measured. So this pins the ORDER READERS SEE,
    // including against a wrong-way tiebreak, and the query's own docblock
    // carries the argument for writing the tiebreak down.
    [, $reader] = mynFix(0, 'dong-thap-myn-tie');
    $instant = now();
    $first = Notification::query()->create([
        'user_id' => $reader->id, 'kind' => 'membership_approved',
        'payload' => [], 'created_at' => $instant,
    ]);
    $second = Notification::query()->create([
        'user_id' => $reader->id, 'kind' => 'membership_rejected',
        'payload' => [], 'created_at' => $instant,
    ]);
    expect($first->id < $second->id)->toBeTrue();

    $rows = app(MyNotificationsQuery::class)->run($reader)['rows'];

    expect(array_column($rows, 'id'))->toBe([$second->id, $first->id]);
});

it('marking read writes no audit entry, deliberately', function () {
    [, $reader, $rows] = mynFix(1, 'dong-thap-myn-noaudit');

    app(MarkNotificationRead::class)->one($reader, $rows[0]->id);
    app(MarkNotificationRead::class)->all($reader);

    expect(AuditLog::query()->count())->toBe(0);
});

it('the page renders with the unread subtitle and the bell prop carries the count', function () {
    [$shelf, $reader] = mynFix(2, 'dong-thap-myn-page');

    test()->actingAs($reader)->get("/shelves/{$shelf->slug}/profile/notifications")
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('shelves/profile/notifications')
            ->where('mine.unread', 2)
            ->where('unreadNotifications', 2));
});

it('the mark-read POSTs work over HTTP and land back on the page', function () {
    // ONE actingAs for the whole method, reused. The two calls this block
    // used to make named the same user, so SessionGuard's cache could not
    // bite — but it was the exact shape mynFix's docblock says it dropped
    // actingAs to avoid, and a rule kept everywhere except where it looks
    // harmless is a rule nobody downstream believes.
    [$shelf, $reader, $rows] = mynFix(2, 'dong-thap-myn-post');
    $asReader = test()->actingAs($reader);

    $asReader->post("/shelves/{$shelf->slug}/profile/notifications/{$rows[0]->id}/read")
        ->assertRedirect();
    expect($rows[0]->fresh()->read_at)->not->toBeNull();

    $asReader->post("/shelves/{$shelf->slug}/profile/notifications/read-all")
        ->assertRedirect();
    expect(Notification::query()->whereNull('read_at')->count())->toBe(0);
});

/**
 * The unread count in the query log of one request — the shared prop's own
 * statement, which is `select count(*) … from notifications`. The mark-read
 * Action issues an UPDATE and MyNotificationsQuery::run is only reached by
 * the notifications page itself, so on any OTHER page this count is the
 * closure's and nothing else's.
 *
 * @return list<string>
 */
function mynCountStatements(): array
{
    return array_values(array_filter(
        array_column(DB::getQueryLog(), 'query'),
        fn (string $sql): bool => str_contains($sql, 'count(*)') && str_contains($sql, 'notifications'),
    ));
}

it('the bell count is NOT queried on a request that renders no page', function () {
    // Half one of "lazy in practice, not merely declared so". A closure in
    // share() is only resolved by Inertia\PropsResolver, which runs when an
    // Inertia\Response is built — a RedirectResponse builds none. So the
    // mark-all POST, whose own work is an UPDATE, must issue no count at all.
    // Written as its own it() because a failed expect aborts the METHOD: the
    // "is queried" half below has to be able to fail independently.
    [$shelf, $reader] = mynFix(2, 'dong-thap-myn-lazy-post');

    DB::flushQueryLog();
    DB::enableQueryLog();
    test()->actingAs($reader)->post("/shelves/{$shelf->slug}/profile/notifications/read-all");
    $counts = mynCountStatements();
    DB::disableQueryLog();

    expect($counts)->toBe([]);
});

it('the bell count IS queried once on a page that never asks for it', function () {
    // Half two. The overview page's controller does not read notifications
    // at all, so the single count on that render is the shared closure's —
    // which is what makes the empty log above evidence of laziness rather
    // than of a route that simply never counts.
    [$shelf, $reader] = mynFix(2, 'dong-thap-myn-lazy-get');

    DB::flushQueryLog();
    DB::enableQueryLog();
    test()->actingAs($reader)->get("/shelves/{$shelf->slug}/profile/overview")
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page->where('unreadNotifications', 2));
    $counts = mynCountStatements();
    DB::disableQueryLog();

    expect($counts)->toHaveCount(1);
});

it('a signed-in NON-member gets no bell at all, on the one shelf page they can reach', function () {
    // DEVIATION from the brief's two-clause prop ("a user AND a shelf"),
    // found by reading the layout and then measured. `feedback` is
    // deliberately outside the role:reader group (routes/web.php says why:
    // a guest may leave feedback for a shelf they have not joined), so a
    // signed-in stranger DOES reach a shelf page with both a user and a
    // shelf bound. Under the two-clause version this asserted 0, and the
    // header rendered a link to a page the next block shows 404s them.
    //
    // Its own it(): the 404 below is a guest-shaped assertion about a
    // DIFFERENT actor's reach and must be able to fail on its own.
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => 'dong-thap-myn-stranger', 'settings' => []]);
    $stranger = User::factory()->create(['full_name' => 'Anna Không Là Thành Viên']);
    app(TenantContext::class)->clear();

    test()->actingAs($stranger)->get("/shelves/{$shelf->slug}/feedback")
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->where('shelf.slug', 'dong-thap-myn-stranger')
            ->where('unreadNotifications', null));
});

it('and the page that bell would have linked to 404s that same non-member', function () {
    // The other half of the pair: without this, "no bell" could be read as
    // an over-cautious hide rather than as matching who the route admits.
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => 'dong-thap-myn-stranger-2', 'settings' => []]);
    $stranger = User::factory()->create(['full_name' => 'Anna Không Là Thành Viên']);
    app(TenantContext::class)->clear();

    test()->actingAs($stranger)->get("/shelves/{$shelf->slug}/profile/notifications")
        ->assertNotFound();
});

it('a guest on a public page carries a null bell rather than a zero', function () {
    // The third null: no user at all. Asserted on the shelf index, which a
    // guest may read — `role` and `shelf` are already null there, and the
    // bell must join them rather than reporting an empty inbox nobody owns.
    // No actingAs anywhere in this block, deliberately: SessionGuard caches
    // its user for the whole test METHOD, so a guest assertion appended to
    // a block that authenticated would silently re-run authenticated
    // (docs/known-gaps.md, Phase 1a).
    test()->get('/shelves')
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page->where('unreadNotifications', null));
});

it('over HTTP, another reader of the SAME shelf binds and is refused silently, not 404d', function () {
    // The routes/web.php comment on this binding, made falsifiable. Neither
    // scopeBindings() nor BookshelfScope scopes by PERSON, so this id binds:
    // what refuses it is MarkNotificationRead's user_id key, one layer down,
    // and the refusal is an ordinary redirect with nothing marked — a reader
    // learns nothing about somebody else's inbox from the status code.
    [$shelf, $reader] = mynFix(0, 'dong-thap-myn-http-other');
    app(TenantContext::class)->actSystemWide();
    $other = User::factory()->create(['full_name' => 'Anna Người Khác']);
    Membership::factory()->for($shelf)->create(['user_id' => $other->id, 'role' => 'reader', 'status' => 'active']);
    $theirs = Notification::query()->create([
        'bookshelf_id' => $shelf->id, 'user_id' => $other->id,
        'kind' => 'membership_approved', 'payload' => [], 'created_at' => now(),
    ]);
    app(TenantContext::class)->clear();

    test()->actingAs($reader)
        ->post("/shelves/{$shelf->slug}/profile/notifications/{$theirs->id}/read")
        ->assertRedirect();

    app(TenantContext::class)->actSystemWide();
    expect(Notification::query()->findOrFail($theirs->id)->read_at)->toBeNull();
});

it('over HTTP, a notification from ANOTHER shelf does not bind at all', function () {
    // The other half: the shelf boundary IS the binding's job, and it 404s
    // rather than redirecting — a different outcome from the block above,
    // which is the point of measuring both.
    [$shelfA, $readerA] = mynFix(0, 'dong-thap-myn-http-shelf-a');
    app(TenantContext::class)->actSystemWide();
    $shelfB = Bookshelf::factory()->create(['slug' => 'dong-thap-myn-http-shelf-b', 'settings' => []]);
    $elsewhere = Notification::query()->create([
        'bookshelf_id' => $shelfB->id, 'user_id' => $readerA->id,
        'kind' => 'membership_approved', 'payload' => [], 'created_at' => now(),
    ]);
    app(TenantContext::class)->clear();

    test()->actingAs($readerA)
        ->post("/shelves/{$shelfA->slug}/profile/notifications/{$elsewhere->id}/read")
        ->assertNotFound();
});
