<?php

use App\Enums\RequestStatus;
use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\BorrowRequest;
use App\Models\Membership;
use App\Models\User;
use App\Queries\BorrowRequestQueueQuery;
use App\Support\TenantContext;
use Carbon\Carbon;

afterEach(fn () => Carbon::setTestNow());

/**
 * Shelf bound to an acting manager; caller seeds its own books/requests.
 *
 * @return array{Bookshelf, User}
 */
function quqFix(string $slug = 'dong-thap-quq'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => ['hold_days' => 4]]);
    $manager = User::factory()->create(['full_name' => 'Maria Quản Lý Kho']);
    $mm = Membership::factory()->for($shelf)->create(['user_id' => $manager->id, 'role' => 'manager', 'status' => 'active']);
    app(TenantContext::class)->set($shelf, $mm);
    test()->actingAs($manager);

    return [$shelf, $manager];
}

/** One reader + one PENDING request for $book at $requestedAt. */
function quqRequest(Bookshelf $shelf, Book $book, string $name, string $requestedAt): BorrowRequest
{
    app(TenantContext::class)->actSystemWide();
    $u = User::factory()->create(['full_name' => $name]);
    Membership::factory()->for($shelf)->create(['user_id' => $u->id, 'role' => 'reader', 'status' => 'active']);
    $r = BorrowRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'member_id' => $u->id,
        'status' => RequestStatus::Pending, 'requested_at' => $requestedAt,
    ]);
    // Rebind after systemWide — the caller's manager context.
    $shelf = $shelf->fresh();
    app(TenantContext::class)->set($shelf, Membership::query()->whereHas('user', fn ($q) => $q->where('full_name', 'Maria Quản Lý Kho'))->firstOrFail());

    return $r;
}

it('groups by book and numbers each reader\'s place, seeded out of order', function () {
    [$shelf] = quqFix();
    app(TenantContext::class)->actSystemWide();
    $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Dế Mèn Phiêu Lưu Ký', 'slug' => 'de-men']);
    app(TenantContext::class)->set($shelf->fresh(), Membership::query()->whereHas('user', fn ($q) => $q->where('full_name', 'Maria Quản Lý Kho'))->firstOrFail());
    // Seeded LATER-first: creation order and v7 ids disagree with
    // requested_at order, so the ordering is falsifiable.
    $second = quqRequest($shelf, $book, 'Anna Đăng Ký Sau', '2026-08-28 09:00:00');
    $first = quqRequest($shelf, $book, 'Têrêsa Đăng Ký Trước', '2026-08-28 08:00:00');

    $queues = app(BorrowRequestQueueQuery::class)->run();

    expect($queues)->toHaveCount(1)
        ->and($queues[0]['waiting'])->toBe(2)
        ->and($queues[0]['holdDays'])->toBe(4)
        ->and($queues[0]['requests'][0]['requestId'])->toBe($first->id)
        ->and($queues[0]['requests'][0]['position'])->toBe(1)
        ->and($queues[0]['requests'][0]['readerName'])->toBe('Têrêsa Đăng Ký Trước')
        ->and($queues[0]['requests'][1]['requestId'])->toBe($second->id)
        ->and($queues[0]['requests'][1]['position'])->toBe(2);
});

it('cancelling ahead of somebody moves them up, because position is derived', function () {
    [$shelf] = quqFix('dong-thap-quq-derive');
    app(TenantContext::class)->actSystemWide();
    $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Hoàng Tử Bé', 'slug' => 'hoang-tu-be']);
    app(TenantContext::class)->set($shelf->fresh(), Membership::query()->whereHas('user', fn ($q) => $q->where('full_name', 'Maria Quản Lý Kho'))->firstOrFail());
    $first = quqRequest($shelf, $book, 'Têrêsa Đăng Ký Trước', '2026-08-28 08:00:00');
    $second = quqRequest($shelf, $book, 'Anna Đăng Ký Sau', '2026-08-28 09:00:00');
    BorrowRequest::query()->whereKey($first->id)->update(['status' => RequestStatus::Cancelled, 'cancelled_at' => now()]);

    $queues = app(BorrowRequestQueueQuery::class)->run();

    expect($queues[0]['requests'])->toHaveCount(1)
        ->and($queues[0]['requests'][0]['requestId'])->toBe($second->id)
        ->and($queues[0]['requests'][0]['position'])->toBe(1);
});

it('only pending and approved rows are waiting on anybody', function () {
    [$shelf] = quqFix('dong-thap-quq-status');
    app(TenantContext::class)->actSystemWide();
    $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Totto-chan Bên Cửa Sổ', 'slug' => 'totto-chan']);
    app(TenantContext::class)->set($shelf->fresh(), Membership::query()->whereHas('user', fn ($q) => $q->where('full_name', 'Maria Quản Lý Kho'))->firstOrFail());
    $pending = quqRequest($shelf, $book, 'Bạn Còn Chờ', '2026-08-28 08:00:00');
    foreach ([RequestStatus::Rejected, RequestStatus::Cancelled, RequestStatus::Fulfilled] as $i => $status) {
        $gone = quqRequest($shelf, $book, "Bạn Đã Xong {$i}", '2026-08-28 07:0'.$i.':00');
        BorrowRequest::query()->whereKey($gone->id)->update(['status' => $status]);
    }

    $queues = app(BorrowRequestQueueQuery::class)->run();

    expect($queues[0]['requests'])->toHaveCount(1)
        ->and($queues[0]['requests'][0]['requestId'])->toBe($pending->id);
});

it('a hold expires because the clock moved, and the row stays on the screen, flagged', function () {
    [$shelf, $manager] = quqFix('dong-thap-quq-expired');
    app(TenantContext::class)->actSystemWide();
    $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Đất Rừng Phương Nam', 'slug' => 'dat-rung']);
    $copy = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0142', 'state' => 'held']);
    app(TenantContext::class)->set($shelf->fresh(), Membership::query()->whereHas('user', fn ($q) => $q->where('full_name', 'Maria Quản Lý Kho'))->firstOrFail());
    $held = quqRequest($shelf, $book, 'Têrêsa Người Giữ Chỗ', '2026-08-24 08:00:00');
    BorrowRequest::query()->whereKey($held->id)->update([
        'status' => RequestStatus::Approved, 'copy_id' => $copy->id,
        'hold_expires_at' => now()->addDay(), 'decided_by' => $manager->id, 'decided_at' => now(),
    ]);

    $before = app(BorrowRequestQueueQuery::class)->run();
    expect($before[0]['requests'][0]['holdExpired'])->toBeFalse()
        ->and($before[0]['requests'][0]['copyCode'])->toBe('DT-0142');

    Carbon::setTestNow(Carbon::now()->addDays(2));   // no job, no write — the clock alone
    $after = app(BorrowRequestQueueQuery::class)->run();
    expect($after[0]['requests'])->toHaveCount(1)
        ->and($after[0]['requests'][0]['holdExpired'])->toBeTrue()
        ->and($after[0]['requests'][0]['status'])->toBe('approved');
});

it('a reader who left the shelf is still in the queue, with nothing to link to', function () {
    [$shelf] = quqFix('dong-thap-quq-left');
    app(TenantContext::class)->actSystemWide();
    $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Dế Mèn Phiêu Lưu Ký', 'slug' => 'de-men-left']);
    app(TenantContext::class)->set($shelf->fresh(), Membership::query()->whereHas('user', fn ($q) => $q->where('full_name', 'Maria Quản Lý Kho'))->firstOrFail());
    $r = quqRequest($shelf, $book, 'Bạn Đã Rời Tủ', '2026-08-28 08:00:00');
    Membership::query()->where('user_id', $r->member_id)->delete();   // soft delete

    $queues = app(BorrowRequestQueueQuery::class)->run();

    expect($queues[0]['requests'])->toHaveCount(1)
        ->and($queues[0]['requests'][0]['membershipId'])->toBeNull()
        ->and($queues[0]['requests'][0]['readerName'])->toBe('Bạn Đã Rời Tủ');
});

it('the order is total across titles — folded title, then book id, and Đ does not sort above Alice', function () {
    [$shelf] = quqFix('dong-thap-quq-fold');
    app(TenantContext::class)->actSystemWide();
    // Seeded Đ-first: byte order would put Đất above Alice; folded order
    // must not.
    $dat = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Đất Rừng Phương Nam', 'slug' => 'dat-rung-f']);
    $alice = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Alice Ở Xứ Sở Diệu Kỳ', 'slug' => 'alice']);
    app(TenantContext::class)->set($shelf->fresh(), Membership::query()->whereHas('user', fn ($q) => $q->where('full_name', 'Maria Quản Lý Kho'))->firstOrFail());
    quqRequest($shelf, $dat, 'Bạn Chờ Một', '2026-08-28 08:00:00');
    quqRequest($shelf, $alice, 'Bạn Chờ Hai', '2026-08-28 08:00:00');

    $titles = array_column(app(BorrowRequestQueueQuery::class)->run(), 'title');

    expect($titles)->toBe(['Alice Ở Xứ Sở Diệu Kỳ', 'Đất Rừng Phương Nam']);
});

it('bookId narrows the answer to one title, and free copies are listed by code', function () {
    [$shelf] = quqFix('dong-thap-quq-narrow');
    app(TenantContext::class)->actSystemWide();
    $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Hoàng Tử Bé', 'slug' => 'hoang-tu-be-n']);
    $other = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Totto-chan Bên Cửa Sổ', 'slug' => 'totto-n']);
    // Free copies seeded out of code order; an on_loan one must not appear.
    BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0022', 'state' => 'available']);
    BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0011', 'state' => 'available']);
    BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0001', 'state' => 'on_loan']);
    app(TenantContext::class)->set($shelf->fresh(), Membership::query()->whereHas('user', fn ($q) => $q->where('full_name', 'Maria Quản Lý Kho'))->firstOrFail());
    quqRequest($shelf, $book, 'Bạn Chờ Ba', '2026-08-28 08:00:00');
    quqRequest($shelf, $other, 'Bạn Chờ Bốn', '2026-08-28 08:00:00');

    $queues = app(BorrowRequestQueueQuery::class)->run($book->id);

    expect($queues)->toHaveCount(1)
        ->and($queues[0]['bookId'])->toBe($book->id)
        ->and(array_column($queues[0]['freeCopies'], 'code'))->toBe(['DT-0011', 'DT-0022']);
});

it('the badge counts what the list shows', function () {
    [$shelf, $manager] = quqFix('dong-thap-quq-badge');
    app(TenantContext::class)->actSystemWide();
    $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Dế Mèn Phiêu Lưu Ký', 'slug' => 'de-men-b']);
    $copy = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0300', 'state' => 'held']);
    app(TenantContext::class)->set($shelf->fresh(), Membership::query()->whereHas('user', fn ($q) => $q->where('full_name', 'Maria Quản Lý Kho'))->firstOrFail());
    quqRequest($shelf, $book, 'Bạn Chờ Năm', '2026-08-28 08:00:00');
    $approved = quqRequest($shelf, $book, 'Bạn Chờ Sáu', '2026-08-28 07:00:00');
    BorrowRequest::query()->whereKey($approved->id)->update([
        'status' => RequestStatus::Approved, 'copy_id' => $copy->id,
        'hold_expires_at' => now()->addDay(), 'decided_by' => $manager->id, 'decided_at' => now(),
    ]);
    $gone = quqRequest($shelf, $book, 'Bạn Đã Huỷ', '2026-08-28 06:00:00');
    BorrowRequest::query()->whereKey($gone->id)->update(['status' => RequestStatus::Cancelled, 'cancelled_at' => now()]);

    $q = app(BorrowRequestQueueQuery::class);
    expect($q->countWaiting())->toBe(2)
        ->and($q->countWaiting())->toBe(array_sum(array_column($q->run(), 'waiting')));
});

it('another shelf\'s queue is invisible — BookshelfScope, not a where clause', function () {
    [$shelf] = quqFix('dong-thap-quq-tenant');
    app(TenantContext::class)->actSystemWide();
    $other = Bookshelf::factory()->create(['slug' => 'can-tho-quq', 'settings' => []]);
    $foreignBook = Book::query()->create(['bookshelf_id' => $other->id, 'title' => 'Sách Tủ Khác', 'slug' => 'sach-khac']);
    $foreignUser = User::factory()->create(['full_name' => 'Bạn Tủ Khác']);
    Membership::factory()->for($other)->create(['user_id' => $foreignUser->id, 'role' => 'reader', 'status' => 'active']);
    BorrowRequest::query()->create([
        'bookshelf_id' => $other->id, 'book_id' => $foreignBook->id, 'member_id' => $foreignUser->id,
        'status' => RequestStatus::Pending, 'requested_at' => now(),
    ]);
    app(TenantContext::class)->set($shelf->fresh(), Membership::query()->whereHas('user', fn ($q) => $q->where('full_name', 'Maria Quản Lý Kho'))->firstOrFail());

    expect(app(BorrowRequestQueueQuery::class)->run())->toBe([])
        ->and(app(BorrowRequestQueueQuery::class)->countWaiting())->toBe(0);
});
