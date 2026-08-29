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
