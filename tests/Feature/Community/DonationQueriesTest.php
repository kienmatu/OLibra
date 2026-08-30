<?php

use App\Models\BookDonation;
use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\User;
use App\Queries\DonationQueueQuery;
use App\Queries\MyDonationsQuery;
use App\Support\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * One shelf, two readers, bound as the tenant with the first reader
 * signed in.
 *
 * BOTH READERS' IDS COME BACK IN BOTH FLAVOURS — user and membership —
 * because that is what this file's first two blocks compare. book_donations
 * .donor_membership_id is a memberships(id) (App\Models\BookDonation's
 * donor() docblock quotes the live constraint), and both columns hold
 * 36-char uuid strings, so an assertion that a returned row carries the
 * right SHAPE of id says nothing about which table it came from.
 * Membership::factory() mints its own uuid, so a reader's user id and
 * their membership id are unrelated and can never coincide.
 *
 * Grep first: `grep -rn "^function dnqFix" tests/` — top-level helpers are
 * process-global (AGENTS.md).
 *
 * @return array{Bookshelf, User, Membership, User, Membership}
 */
function dnqFix(string $slug = 'dong-thap-dnq'): array
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
    test()->actingAs($anh);

    return [$shelf, $anh, $anhMembership, $minh, $minhMembership];
}

/**
 * One offer, written straight through the model rather than through
 * OfferDonation, so this file can seed a decided row and an out-of-order
 * created_at — neither of which that command will produce.
 *
 * A `declined` row is seeded WITH a note because the table refuses one
 * without: `CONSTRAINT book_donations_declined_has_reason CHECK (status
 * <> 'declined' or decision_note is not null)`, read off the live table.
 *
 * bookshelf_id is left unnamed: BelongsToBookshelf's creating hook stamps
 * it from the bound tenant, which is the shape this project's tenancy
 * guard asks for.
 *
 * Grep first: `grep -rn "^function dnqOffer" tests/`.
 */
function dnqOffer(
    Membership $donor,
    string $description,
    string $status = 'pending',
    ?string $note = null,
    ?string $at = null,
): BookDonation {
    return BookDonation::query()->create(array_filter([
        'donor_membership_id' => $donor->id,
        'description' => $description,
        'estimated_count' => 5,
        'status' => $status,
        'decision_note' => $note,
        'created_at' => $at === null ? null : CarbonImmutable::parse($at),
    ], fn ($v) => $v !== null));
}

it('a reader sees their own donations, scoped by membership and not by user', function () {
    [, , $anhMembership, , $minhMembership] = dnqFix();

    $mine = dnqOffer($anhMembership, 'Em có 5 cuốn truyện tranh', at: '2026-08-01 09:00:00');
    $alsoMine = dnqOffer($anhMembership, 'Thêm 2 cuốn Dế Mèn', at: '2026-08-03 09:00:00');
    $theirs = dnqOffer($minhMembership, 'Một chồng sách giáo khoa', at: '2026-08-02 09:00:00');

    $rows = app(MyDonationsQuery::class)->run($anhMembership);

    // BY ID, and first, because a failed expect() aborts the whole Pest
    // method: the named probe has to be the statement that fires.
    //
    // AN EMPTY LIST IS THE FAILURE THIS BLOCK IS BUILT TO SEE. Comparing
    // donor_membership_id against a user id matches no row at all, so a
    // reader who has offered twice is told they have never offered
    // anything — a wrong answer that looks like a legitimate empty state,
    // not an error. get-my-donations.ts's docblock names that exact shape:
    // "Comparing a user id here matches nothing, which would read as
    // 'this reader has never offered anything' rather than as an error."
    expect(array_column($rows, 'donationId'))
        ->toBe([$alsoMine->id, $mine->id], 'newest first, and the other reader\'s offer is not one of them');

    expect(array_column($rows, 'donationId'))->not->toContain($theirs->id);
});

it('every row this query returns was matched on a memberships(id)', function () {
    [, $anh, $anhMembership] = dnqFix();

    dnqOffer($anhMembership, 'Em có 5 cuốn truyện tranh');

    $rows = app(MyDonationsQuery::class)->run($anhMembership);

    // THE BLOCK THE BRIEF ASKED FOR CANNOT BE WRITTEN THROUGH THE TYPED
    // API, and that is the point of the signature. run() takes a
    // Membership, so "call it with a user id" cannot be spelled here:
    // App\Queries\MyDonationsQuery::run's parameter would have to be
    // widened to `string` before the mistake could even be typed. The
    // type is the guard, so what is left to pin is the PREDICATE — that
    // the rows which came back are the ones whose donor column holds this
    // membership's id.
    $donorIds = BookDonation::query()
        ->whereIn('id', array_column($rows, 'donationId'))
        ->pluck('donor_membership_id')
        ->all();

    expect($donorIds)->toBe([$anhMembership->id], 'the predicate matched a memberships(id)');

    // Teeth for the line above: with the two ids equal it would pass
    // against either column. Membership::factory() mints its own uuid,
    // so they are not.
    expect($anhMembership->id)->not->toBe($anh->id);
});

it('a declined offer carries its reason back to the reader', function () {
    [, , $anhMembership] = dnqFix();

    dnqOffer($anhMembership, 'Một chồng sách ướt', status: 'declined', note: 'Sách đã quá cũ');

    $rows = app(MyDonationsQuery::class)->run($anhMembership);

    // The note is the whole reason a decline requires a reason: BR §7.7's
    // BookDonation line (opened) says "decision note (reason required on
    // decline, matching every other rejection flow in this document)", and
    // OPS §3.2's GetMyDonations row (opened) lists its Returns as
    // "Donation rows: description, estimated count, status, decision note
    // if declined". The reader is who reads it.
    expect($rows[0]['decisionNote'])->toBe('Sách đã quá cũ');

    expect($rows[0]['status'])->toBe('declined');
});

it('the queue is pending only', function () {
    [, , $anhMembership] = dnqFix();

    $pending = dnqOffer($anhMembership, 'Em có 5 cuốn truyện tranh');
    $received = dnqOffer($anhMembership, 'Đã nhận rồi', status: 'received');
    $declined = dnqOffer($anhMembership, 'Sách ướt', status: 'declined', note: 'Sách đã quá cũ');

    $rows = app(DonationQueueQuery::class)->run();

    expect(array_column($rows, 'donationId'))
        ->toBe([$pending->id], 'a decided offer has left the queue');

    // Named separately so a failure says WHICH decided status leaked.
    expect(array_column($rows, 'donationId'))->not->toContain($received->id);
    expect(array_column($rows, 'donationId'))->not->toContain($declined->id);
});

it('the queue is oldest first', function () {
    [, , $anhMembership] = dnqFix();

    // Seeded out of order on purpose: a read that dropped the ordering
    // and returned rows in whatever order the engine handed them back
    // would pass against a fixture inserted oldest-first.
    $middle = dnqOffer($anhMembership, 'Sách thứ hai', at: '2026-08-02 09:00:00');
    $newest = dnqOffer($anhMembership, 'Sách thứ ba', at: '2026-08-03 09:00:00');
    $oldest = dnqOffer($anhMembership, 'Sách thứ nhất', at: '2026-08-01 09:00:00');

    $rows = app(DonationQueueQuery::class)->run();

    // A queue drains: the offer that has waited longest is worked first.
    expect(array_column($rows, 'donationId'))
        ->toBe([$oldest->id, $middle->id, $newest->id], 'oldest first — a queue, not a pile');
});

it('the queue carries the donor\'s name and membership id', function () {
    [, , , , $minhMembership] = dnqFix();

    dnqOffer($minhMembership, 'Một chồng sách giáo khoa');

    $rows = app(DonationQueueQuery::class)->run();

    // BR §16.3's Donation queue paragraph (opened) is what these two
    // fields are for: "Duyệt opens the add-book form with Người tặng
    // pre-filled with that member and moves the donation to received
    // (§7.7)". The screen needs the name to show and the membership id to
    // hand on to that form.
    expect($rows[0]['donorName'])->toBe('Giuse Trần Minh');

    // A memberships(id), not the donor's users(id) — the two are
    // different uuids on the same row, and the add-book form's
    // donorMembershipId takes the first.
    expect($rows[0]['donorMembershipId'])->toBe($minhMembership->id);
    expect($rows[0]['donorMembershipId'])->not->toBe($minhMembership->user_id);
});

it('another shelf\'s offers appear in neither', function () {
    [$shelf, , $anhMembership] = dnqFix();
    $mine = dnqOffer($anhMembership, 'Em có 5 cuốn truyện tranh');

    app(TenantContext::class)->actSystemWide();
    $other = Bookshelf::factory()->create(['slug' => 'ha-noi-dnq', 'settings' => []]);
    $binh = User::factory()->create(['full_name' => 'Phêrô Nguyễn Văn Bình']);
    $binhMembership = Membership::factory()->for($other)->create([
        'user_id' => $binh->id, 'role' => 'reader', 'status' => 'active',
    ]);
    app(TenantContext::class)->set($other, $binhMembership);
    $foreign = dnqOffer($binhMembership, 'Sách của kệ khác');

    // Back on the first shelf, then read with the FOREIGN membership: the
    // donor predicate matches that row exactly, so an empty answer is the
    // shelf scope refusing it and not the predicate missing. That is what
    // makes this block a tenancy test rather than a second copy of the
    // first one.
    app(TenantContext::class)->set($shelf, $anhMembership);

    expect(app(MyDonationsQuery::class)->run($binhMembership))
        ->toBe([], 'the donor id matched, and the shelf scope refused the row anyway');

    $queue = array_column(app(DonationQueueQuery::class)->run(), 'donationId');
    expect($queue)->toBe([$mine->id], 'the queue is this shelf\'s pending offers');
    expect($queue)->not->toContain($foreign->id);
});

it('my-donations\' id tiebreak is in the ORDER BY text, not merely in the row order', function () {
    // MEASURED IN THIS COMMIT, and this block exists because of what was
    // measured: deleting `->orderByDesc('id')` from
    // App\Queries\MyDonationsQuery::run leaves all seven row-order blocks
    // above GREEN. Proof the deletion landed rather than silently failing
    // to apply: the container's own `grep -c "orderByDesc('id')"` on the
    // file returned 0, and host and container md5 agreed on the mutated
    // bytes.
    //
    // THE MECHANISM IS NOT MEASURED HERE, only the gap. The fixtures
    // above all use distinct created_at values, so nothing in them ties
    // and no tie-breaking behaviour of this engine is exercised either
    // way; whether a same-instant pair could reach the line by row order
    // on MariaDB was NOT tested, and the sibling pins in
    // CommentModerationQueryTest and BorrowRequestQueueQueryTest are
    // about their own tables and their own indexes. So the line is
    // pinned where row order provably does not reach it — in the
    // compiled SQL.
    //
    // The pattern is CommentModerationQueryTest's "the queue's id
    // tiebreak is in the ORDER BY text" (opened). Its reason for picking
    // the logged statement that HAS an `order by` rather than the first
    // one applies here too: BookshelfScope and, in the sibling block
    // below, the eager loads all issue statements of their own.
    [, , $anhMembership] = dnqFix('dong-thap-dnq-my-sql-pin');
    dnqOffer($anhMembership, 'Một lời tặng để câu lệnh có dòng sắp xếp');

    DB::flushQueryLog();
    DB::enableQueryLog();
    app(MyDonationsQuery::class)->run($anhMembership);
    $log = DB::getQueryLog();
    DB::disableQueryLog();

    $main = collect($log)->first(fn (array $q): bool => str_contains($q['query'], 'order by'));

    expect($main)->not->toBeNull()
        ->and(str_contains((string) $main['query'], 'order by `created_at` desc, `id` desc'))
        ->toBeTrue('no created_at/id tiebreak in the my-donations ORDER BY: '.($main['query'] ?? ''));
});

it('the queue\'s id tiebreak is in the ORDER BY text, not merely in the row order', function () {
    // The same pin in the other direction, and the same measurement:
    // deleting `->orderBy('id')` from App\Queries\DonationQueueQuery::run
    // left all seven blocks above GREEN, with the container's own grep
    // returning 0 matches and the md5s agreeing.
    [, , $anhMembership] = dnqFix('dong-thap-dnq-queue-sql-pin');
    dnqOffer($anhMembership, 'Một lời tặng để câu lệnh có dòng sắp xếp');

    DB::flushQueryLog();
    DB::enableQueryLog();
    app(DonationQueueQuery::class)->run();
    $log = DB::getQueryLog();
    DB::disableQueryLog();

    $main = collect($log)->first(fn (array $q): bool => str_contains($q['query'], 'order by'));

    expect($main)->not->toBeNull()
        ->and(str_contains((string) $main['query'], 'order by `created_at` asc, `id` asc'))
        ->toBeTrue('no created_at/id tiebreak in the queue ORDER BY: '.($main['query'] ?? ''));
});
