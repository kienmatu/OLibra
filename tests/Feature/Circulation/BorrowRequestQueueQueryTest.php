<?php

use App\Enums\RequestStatus;
use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\BorrowRequest;
use App\Models\Membership;
use App\Models\ParishUnit;
use App\Models\User;
use App\Queries\BorrowRequestQueueQuery;
use App\Support\TenantContext;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

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

it('the queue\'s order is total, across titles and within one — a non-degenerate fixture', function () {
    [$shelf] = quqFix('dong-thap-quq-total-order');
    app(TenantContext::class)->actSystemWide();
    // Ported from the reference's own answer to this exact gap
    // (borrow-request-queue.test.ts:367-452): four titles folding to
    // three distinct values — 'Đất Rừng' twice, so book id is
    // load-bearing between them — seven requests per book across three
    // instants (3, 3, 1 — Math.min(Math.floor(i/3), 2)'s actual split),
    // asserted against the FULL comparator rather than "ascending by
    // id", because "ascending by id" is the shape a BROKEN query
    // produces on its own once nothing else varies. Non-degenerate on
    // purpose — too few rows, or too few genuine ties, and a missing
    // tiebreak can look correct by accident (U3's own trap, and this
    // branch's own mutation check 1 on this file's first draft: with
    // every request's requested_at distinct, dropping the id tiebreak
    // stayed green because nothing tied).
    $titles = ['An Bình', 'Đất Rừng', 'Đất Rừng', 'Vũ Trụ'];
    $ranks = [0, 1, 1, 2];
    $instants = ['2026-08-01 09:00:00', '2026-08-02 09:00:00', '2026-08-03 09:00:00'];

    $books = [];
    foreach ($titles as $i => $title) {
        $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => $title, 'slug' => "total-order-{$i}"]);
        $books[] = ['id' => $book->id, 'rank' => $ranks[$i]];
    }
    app(TenantContext::class)->set($shelf->fresh(), Membership::query()->whereHas('user', fn ($q) => $q->where('full_name', 'Maria Quản Lý Kho'))->firstOrFail());

    foreach ($books as $bi => $book) {
        $bookModel = Book::query()->find($book['id']);
        for ($i = 0; $i < 7; $i++) {
            $instant = $instants[min(intdiv($i, 3), 2)];
            quqRequest($shelf, $bookModel, "Bạn Chờ {$bi}-{$i}", $instant);
        }
    }

    $queues = app(BorrowRequestQueueQuery::class)->run();

    expect($queues)->toHaveCount(4)
        ->and(array_column($queues, 'title'))->toBe(['An Bình', 'Đất Rừng', 'Đất Rừng', 'Vũ Trụ']);

    $bookOf = [];
    $rows = [];
    foreach ($queues as $q) {
        foreach ($q['requests'] as $r) {
            $bookOf[$r['requestId']] = $q['bookId'];
            $rows[] = $r;
        }
    }
    expect($rows)->toHaveCount(28)
        ->and(collect($rows)->pluck('requestId')->unique())->toHaveCount(28);

    // The whole contract, in one comparator: folded title (via rank),
    // then book id, then request time, then request id. Deleting any one
    // of the four keys from the ORDER BY leaves a different sequence.
    $rankOf = collect($books)->pluck('rank', 'id');
    $expected = $rows;
    usort($expected, function ($a, $b) use ($bookOf, $rankOf) {
        $ba = $bookOf[$a['requestId']];
        $bb = $bookOf[$b['requestId']];
        $byRank = $rankOf[$ba] <=> $rankOf[$bb];
        if ($byRank !== 0) {
            return $byRank;
        }
        if ($ba !== $bb) {
            return $ba <=> $bb;
        }
        if ($a['requestedAt'] !== $b['requestedAt']) {
            return $a['requestedAt'] <=> $b['requestedAt'];
        }

        return $a['requestId'] <=> $b['requestId'];
    });

    expect(array_column($rows, 'requestId'))->toBe(array_column($expected, 'requestId'));

    // And the positions follow the same order, so the number beside a
    // child's name cannot disagree with where their card sits.
    foreach ($queues as $q) {
        expect(array_column($q['requests'], 'position'))->toBe(range(1, 7));
    }
});

it('pins the tiebreak in the SQL itself — a same-instant tie can resolve to ascending id with no ORDER BY id at all, so row order cannot prove the mechanism is there', function () {
    // The plan's Global Constraint: "every same-instant tiebreak test
    // pins the mechanism explicitly when the v7 id equals creation order
    // by construction." Measured here, not assumed: on this branch's
    // MariaDB/InnoDB, borrow_requests's id IS the clustered primary key,
    // and a diagnostic against this exact schema (five rows, one
    // shared requested_at, ids assigned in the OPPOSITE order from
    // insertion) showed `orderBy('requested_at')` alone — no id at all —
    // still returns ascending-id order, because an index scan over an
    // InnoDB table (the clustered PK itself, or the requests_queue
    // secondary index, which carries the PK as its own tiebreak
    // internally) is inherently PK-ordered. The 28-row behavioural
    // fixture above is still worth having (it pins the CORRECT output,
    // matching the reference's own test), but it cannot fail this
    // mutation on this engine — verified: dropping `id` from both the
    // window and the outer order left it green. So the mechanism has to
    // be pinned directly, in the SQL text, rather than inferred from
    // row order.
    [$shelf] = quqFix('dong-thap-quq-sql-pin');
    app(TenantContext::class)->actSystemWide();
    $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Ghim SQL', 'slug' => 'sql-pin']);
    app(TenantContext::class)->set($shelf->fresh(), Membership::query()->whereHas('user', fn ($q) => $q->where('full_name', 'Maria Quản Lý Kho'))->firstOrFail());
    quqRequest($shelf, $book, 'Bạn Chờ Ghim', '2026-08-28 08:00:00');

    DB::flushQueryLog();
    DB::enableQueryLog();
    app(BorrowRequestQueueQuery::class)->run();
    $queries = collect(DB::getQueryLog())->pluck('query');
    DB::disableQueryLog();

    // getQueryLog() only ever sees a statement that returned (Trap 1) —
    // sound here, since run() above did not throw.
    $mainQuery = $queries->first(fn ($sql) => str_contains($sql, 'ROW_NUMBER'));

    expect($mainQuery)->not->toBeNull()
        ->and($mainQuery)->toContain('ORDER BY borrow_requests.requested_at ASC, borrow_requests.id ASC) as position')
        ->and($mainQuery)->toContain('order by `books`.`title_folded` asc, `books`.`id` asc, `borrow_requests`.`requested_at` asc, `borrow_requests`.`id` asc');
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
    // A soft-deleted title with its own live request — the ONLY thing
    // keeping it out of both the list and the badge is books.deleted_at
    // in waiting()'s join, and nothing seeded it before this fix round
    // (review fix round 1, item 5: deleting every deleted_at predicate
    // left all nine original tests plus the dashboard test green).
    $goneBook = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Sách Đã Gỡ', 'slug' => 'sach-da-go-b']);
    app(TenantContext::class)->set($shelf->fresh(), Membership::query()->whereHas('user', fn ($q) => $q->where('full_name', 'Maria Quản Lý Kho'))->firstOrFail());
    quqRequest($shelf, $book, 'Bạn Chờ Năm', '2026-08-28 08:00:00');
    $approved = quqRequest($shelf, $book, 'Bạn Chờ Sáu', '2026-08-28 07:00:00');
    BorrowRequest::query()->whereKey($approved->id)->update([
        'status' => RequestStatus::Approved, 'copy_id' => $copy->id,
        'hold_expires_at' => now()->addDay(), 'decided_by' => $manager->id, 'decided_at' => now(),
    ]);
    $gone = quqRequest($shelf, $book, 'Bạn Đã Huỷ', '2026-08-28 06:00:00');
    BorrowRequest::query()->whereKey($gone->id)->update(['status' => RequestStatus::Cancelled, 'cancelled_at' => now()]);
    quqRequest($shelf, $goneBook, 'Bạn Chờ Sách Đã Gỡ', '2026-08-28 05:00:00');
    $goneBook->delete();   // soft delete, after its request is filed

    $q = app(BorrowRequestQueueQuery::class);
    expect($q->countWaiting())->toBe(2)
        ->and($q->countWaiting())->toBe(array_sum(array_column($q->run(), 'waiting')))
        ->and(collect($q->run())->pluck('bookId'))->not->toContain($goneBook->id);
});

it('a soft-deleted identity\'s live request is invisible to the queue and the badge alike', function () {
    // The other half of item 5: users.deleted_at in waiting()'s join.
    // Distinct from "a reader who left the shelf" above, which
    // soft-deletes the MEMBERSHIP and keeps the row visible (nameable,
    // no profile link) — this soft-deletes the underlying USER, which
    // must drop the row entirely, the same way a soft-deleted book does.
    [$shelf] = quqFix('dong-thap-quq-user-gone');
    app(TenantContext::class)->actSystemWide();
    $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Hoàng Tử Bé', 'slug' => 'hoang-tu-be-ug']);
    app(TenantContext::class)->set($shelf->fresh(), Membership::query()->whereHas('user', fn ($q) => $q->where('full_name', 'Maria Quản Lý Kho'))->firstOrFail());
    $r = quqRequest($shelf, $book, 'Bạn Bị Xoá Danh Tính', '2026-08-28 08:00:00');
    User::query()->whereKey($r->member_id)->delete();   // soft delete the identity itself

    $q = app(BorrowRequestQueueQuery::class);
    expect($q->run())->toBe([])
        ->and($q->countWaiting())->toBe(0);
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

it('run() refuses without a bound tenant — actSystemWide() included, not just unset', function () {
    app(TenantContext::class)->actSystemWide();

    expect(fn () => app(BorrowRequestQueueQuery::class)->run())
        ->toThrow(RuntimeException::class, 'BorrowRequestQueueQuery needs a bound tenant.');
});

it('countWaiting() refuses the same way run() does — not reachable through today\'s routes, but a cross-tenant badge beside a list that throws is exactly what the headline requirement forbids (review fix round 1, item 4)', function () {
    app(TenantContext::class)->actSystemWide();

    expect(fn () => app(BorrowRequestQueueQuery::class)->countWaiting())
        ->toThrow(RuntimeException::class, 'BorrowRequestQueueQuery needs a bound tenant.');
});

it('parishLine is the shelf\'s own computed line, not a passthrough — same ParishUnits::describeSelection idiom ReadersListQuery uses', function () {
    [$shelf] = quqFix('dong-thap-quq-parish');
    app(TenantContext::class)->actSystemWide();
    Bookshelf::query()->whereKey($shelf->id)->update([
        'settings' => ['hold_days' => 4, 'parish_taxonomy' => ['levels' => 2, 'nested' => true, 'level1_label' => 'Giáo họ', 'level2_label' => 'Tổ']],
    ]);
    $l1 = ParishUnit::factory()->for($shelf)->create(['level' => 1, 'name' => 'Giáo họ Thánh Tâm']);
    $l2 = ParishUnit::factory()->for($shelf)->create(['level' => 2, 'parent_id' => $l1->id, 'name' => 'Tổ 3']);
    $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Hoàng Tử Bé', 'slug' => 'hoang-tu-be-parish']);
    $reader = User::factory()->create(['full_name' => 'Nguyễn Thị Lan']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $reader->id, 'role' => 'reader', 'status' => 'active',
        'parish_unit_l1_id' => $l1->id, 'parish_unit_l2_id' => $l2->id,
    ]);
    BorrowRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'member_id' => $reader->id,
        'status' => RequestStatus::Pending, 'requested_at' => now(),
    ]);
    app(TenantContext::class)->set($shelf->fresh(), Membership::query()->whereHas('user', fn ($q) => $q->where('full_name', 'Maria Quản Lý Kho'))->firstOrFail());

    $queues = app(BorrowRequestQueueQuery::class)->run();

    expect($queues[0]['requests'][0]['parishLine'])->toBe('Tổ 3 · Giáo họ Thánh Tâm');
});
