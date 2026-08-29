<?php

use App\Enums\RequestStatus;
use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\BorrowRequest;
use App\Models\Membership;
use App\Models\User;
use App\Queries\MyDashboardQuery;
use App\Support\TenantContext;

/** @return array{Bookshelf, User, Book, Book, User} */
function drhFix(string $slug = 'dong-thap-drh'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);
    $reader = User::factory()->create(['full_name' => 'Têrêsa Bạn Đọc Nhỏ']);
    $membership = Membership::factory()->for($shelf)->create(['user_id' => $reader->id, 'role' => 'reader', 'status' => 'active']);
    // A manager exists so that a decided row can name a plausible decider.
    // `decided_by` pointing at the requester is the same class of impossible
    // state as an approved row with no copy_id: no command writes it, and a
    // fixture that encodes one teaches this test's next reader a shape that
    // cannot occur. Nothing in MyDashboardQuery reads the column — which is
    // the reason it went unnoticed, not a reason to leave it wrong.
    $manager = User::factory()->create(['full_name' => 'Maria Quản Lý Kho']);
    Membership::factory()->for($shelf)->create(['user_id' => $manager->id, 'role' => 'manager', 'status' => 'active']);
    $bookA = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Dế Mèn Phiêu Lưu Ký', 'slug' => 'de-men']);
    $bookB = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Hoàng Tử Bé', 'slug' => 'hoang-tu-be']);
    app(TenantContext::class)->set($shelf, $membership);
    test()->actingAs($reader);

    return [$shelf, $reader, $bookA, $bookB, $manager];
}

it('my pending request reports my derived position — others ahead counted, others behind not', function () {
    [$shelf, $reader, $bookA] = drhFix();
    app(TenantContext::class)->actSystemWide();
    foreach ([['Anna Trước Tôi', '-2 hours'], ['Giuse Sau Tôi', '+2 hours']] as [$name, $offset]) {
        $u = User::factory()->create(['full_name' => $name]);
        Membership::factory()->for($shelf)->create(['user_id' => $u->id, 'role' => 'reader', 'status' => 'active']);
        BorrowRequest::query()->create([
            'bookshelf_id' => $shelf->id, 'book_id' => $bookA->id, 'member_id' => $u->id,
            'status' => RequestStatus::Pending, 'requested_at' => now()->modify($offset),
        ]);
    }
    BorrowRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $bookA->id, 'member_id' => $reader->id,
        'status' => RequestStatus::Pending, 'requested_at' => now(),
    ]);
    app(TenantContext::class)->set($shelf->fresh(), Membership::query()->where('user_id', $reader->id)->firstOrFail());

    $dashboard = app(MyDashboardQuery::class)->run($reader);

    expect($dashboard['requests'])->toHaveCount(1)
        ->and($dashboard['requests'][0]['title'])->toBe('Dế Mèn Phiêu Lưu Ký')
        // slug rides the same books join as title but nothing asserted it
        // before this fix round — title alone proves the join runs, not
        // that the RIGHT column came back for slug; a wrong alias there
        // would ship as "" unnoticed. bookA's slug is 'de-men' (drhFix).
        ->and($dashboard['requests'][0]['slug'])->toBe('de-men')
        ->and($dashboard['requests'][0]['queuePosition'])->toBe(2)
        ->and($dashboard['requests'][0]['holdExpiresAt'])->toBeNull();
});

it('an approved request carries the hold expiry and no position; decided rows are absent', function () {
    [$shelf, $reader, $bookA, $bookB, $manager] = drhFix('dong-thap-drh-hold');
    app(TenantContext::class)->actSystemWide();
    // The FULL approval shape — copy_id, hold_expires_at, decided_by,
    // decided_at together, and the copy held (Global Constraints). An
    // approved request with no copy_id is a state no command produces,
    // and a fixture describing one teaches the reader of this test a
    // shape that cannot occur.
    $heldCopy = BookCopy::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $bookA->id, 'code' => 'DT-0007', 'state' => 'held',
    ]);
    BorrowRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $bookA->id, 'member_id' => $reader->id,
        'status' => RequestStatus::Approved, 'requested_at' => now()->subDay(),
        'copy_id' => $heldCopy->id,
        'hold_expires_at' => now()->addDays(2), 'decided_by' => $manager->id, 'decided_at' => now(),
    ]);
    // A decided row exists TO be excluded — the exclusion has substance.
    BorrowRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $bookB->id, 'member_id' => $reader->id,
        'status' => RequestStatus::Rejected, 'requested_at' => now()->subDays(2),
        'decided_by' => $manager->id, 'decided_at' => now(),
    ]);
    app(TenantContext::class)->set($shelf->fresh(), Membership::query()->where('user_id', $reader->id)->firstOrFail());

    $dashboard = app(MyDashboardQuery::class)->run($reader);

    expect($dashboard['requests'])->toHaveCount(1)
        ->and($dashboard['requests'][0]['status'])->toBe('approved')
        ->and($dashboard['requests'][0]['queuePosition'])->toBeNull()
        ->and($dashboard['requests'][0]['holdExpiresAt'])->not->toBeNull();
});

it('the overview page renders the requests section with a cancel per row', function () {
    [$shelf, $reader, $bookA] = drhFix('dong-thap-drh-page');
    app(TenantContext::class)->actSystemWide();
    $request = BorrowRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $bookA->id, 'member_id' => $reader->id,
        'status' => RequestStatus::Pending, 'requested_at' => now(),
    ]);

    test()->actingAs($reader)->get("/shelves/{$shelf->slug}/profile/overview")
        ->assertInertia(fn ($page) => $page
            ->where('dashboard.requests.0.requestId', $request->id)
            ->where('dashboard.requests.0.queuePosition', 1));
});

it('two requests at the same instant are numbered by id, the mechanism named', function () {
    // requested_at ties by construction — two children queueing after the
    // same Sunday mass. UUIDv7 ids are chronologically monotonic, so the
    // row created first has the lower id and MUST be position 1: seeding
    // "out of intended order" is impossible for a same-instant pair, so
    // this block pins the MECHANISM (orderBy('id') as the tiebreak) rather
    // than an ordering the fixture could have shuffled. Global
    // Constraints' UUIDv7 rule allows exactly this, with this comment.
    [$shelf, $reader, $bookA] = drhFix('dong-thap-drh-tie');
    app(TenantContext::class)->actSystemWide();
    $instant = now();
    $ahead = User::factory()->create(['full_name' => 'Anna Cùng Lúc']);
    Membership::factory()->for($shelf)->create(['user_id' => $ahead->id, 'role' => 'reader', 'status' => 'active']);
    $first = BorrowRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $bookA->id, 'member_id' => $ahead->id,
        'status' => RequestStatus::Pending, 'requested_at' => $instant,
    ]);
    $second = BorrowRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $bookA->id, 'member_id' => $reader->id,
        'status' => RequestStatus::Pending, 'requested_at' => $instant,
    ]);
    app(TenantContext::class)->set($shelf->fresh(), Membership::query()->where('user_id', $reader->id)->firstOrFail());

    // The premise the assertion rests on, asserted rather than assumed:
    // v7 monotonicity is what makes "created first" and "lower id" the
    // same statement.
    expect($first->id < $second->id)->toBeTrue();

    $dashboard = app(MyDashboardQuery::class)->run($reader);

    expect($dashboard['requests'][0]['queuePosition'])->toBe(2);
});

it('the list orders by requested_at then id, not by creation, id, or book-join order', function () {
    // The brief's own interface names requested_at asc, id asc as part of
    // the contract, but none of the four tests above pin it: each leaves
    // the reader with exactly one row, so the ->orderBy calls at the top
    // of MyDashboardQuery::run's requests block could be deleted and every
    // one of them would still pass. UUIDv7 ids are chronologically
    // monotonic (Global Constraints), so seeding "in the intended order"
    // proves nothing here either — Task 12 measured exactly that trap on
    // the manager's queue.
    //
    // Two confounds, both deliberately reversed against the asserted
    // order, not just one: an own live request per book at most is
    // enforced by the schema (LiveRequestKeyTest), so the two rows must
    // sit on different books, and a first measurement of this test — kept
    // as the reason for the second reversal, not silently dropped —
    // showed the query's join with `books` returning rows in the BOOKS
    // table's own creation order even with the ->orderBy calls deleted,
    // which by accident matched the requested_at order the first draft of
    // this fixture used and left the mutation green. So EARLIER's book
    // ($bookB) is created SECOND by drhFix and LATER's book ($bookA) is
    // created FIRST: book order and requested_at order now disagree too.
    // And the row with the LATER requested_at is created FIRST (so gets
    // the LOWER id) while the row with the EARLIER requested_at is
    // created SECOND (so gets the HIGHER id): id order disagrees with
    // requested_at order as well. Every plausible accidental ordering —
    // by id, by creation, by the books join — points the SAME wrong way;
    // only requested_at asc points right.
    [$shelf, $reader, $bookA, $bookB] = drhFix('dong-thap-drh-order');
    app(TenantContext::class)->actSystemWide();
    $later = BorrowRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $bookA->id, 'member_id' => $reader->id,
        'status' => RequestStatus::Pending, 'requested_at' => now()->addHour(),
    ]);
    $earlier = BorrowRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $bookB->id, 'member_id' => $reader->id,
        'status' => RequestStatus::Pending, 'requested_at' => now(),
    ]);
    app(TenantContext::class)->set($shelf->fresh(), Membership::query()->where('user_id', $reader->id)->firstOrFail());

    // The premises the assertion rests on, asserted rather than assumed:
    // creation order (later requested_at first) produced the OPPOSITE id
    // order, and $bookA (later's book) was created before $bookB
    // (earlier's book) — both confounds run counter to the asserted
    // output order below.
    expect($later->id < $earlier->id)->toBeTrue()
        ->and($bookA->id < $bookB->id)->toBeTrue();

    $dashboard = app(MyDashboardQuery::class)->run($reader);

    expect($dashboard['requests'])->toHaveCount(2)
        ->and($dashboard['requests'][0]['requestId'])->toBe($earlier->id)
        ->and($dashboard['requests'][1]['requestId'])->toBe($later->id);
});
