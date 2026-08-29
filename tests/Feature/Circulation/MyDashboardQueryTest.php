<?php

use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\BorrowRequest;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\User;
use App\Queries\MyDashboardQuery;
use App\Queries\MyLoanHistoryQuery;
use App\Support\TenantContext;
use Carbon\Carbon;

afterEach(fn () => Carbon::setTestNow());

/**
 * A reader (acting) with one active loan due 2026-09-04 (0 renewals used)
 * and one returned loan, plus ANOTHER reader's active loan that must never
 * appear.
 *
 * @return array{Bookshelf, User, Loan, Book}
 */
function mydFix(array $shelfSettings = [], string $slug = 'dong-thap-myd'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => $shelfSettings]);
    $manager = User::factory()->create(['full_name' => 'Maria Trực Tủ Sách']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);
    $reader = User::factory()->create(['full_name' => 'Têrêsa Xem Trang Mình']);
    $readerMembership = Membership::factory()->for($shelf)->create([
        'user_id' => $reader->id, 'role' => 'reader', 'status' => 'active',
    ]);
    $other = User::factory()->create(['full_name' => 'Gioan Người Bên Cạnh']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $other->id, 'role' => 'reader', 'status' => 'active',
    ]);
    $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Dế Mèn Phiêu Lưu Ký', 'slug' => 'de-men-myd']);
    $c1 = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0401', 'state' => 'on_loan']);
    $c2 = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0402', 'state' => 'available']);
    $c3 = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0403', 'state' => 'on_loan']);
    // ORDER MATTERS (review fix): the RETURNED loan is created FIRST and the
    // ACTIVE one SECOND, so creation order — and the monotonic UUIDv7 id
    // order with it — is the OPPOSITE of the reverse-chronological order the
    // history test asserts. Seeded the other way round (as drafted) that
    // test passed with no ORDER BY at all.
    Loan::query()->create([
        'bookshelf_id' => $shelf->id, 'copy_id' => $c2->id, 'book_id' => $book->id,
        'borrower_id' => $reader->id, 'lent_by' => $manager->id,
        'lent_at' => '2026-08-01 03:00:00', 'due_on' => '2026-08-15', 'status' => 'returned',
        'returned_at' => '2026-08-14 08:00:00', 'received_by' => $manager->id, 'return_condition' => 'slightly_worn',
    ]);
    $loan = Loan::query()->create([
        'bookshelf_id' => $shelf->id, 'copy_id' => $c1->id, 'book_id' => $book->id,
        'borrower_id' => $reader->id, 'lent_by' => $manager->id,
        'lent_at' => '2026-08-21 03:00:00', 'due_on' => '2026-09-04', 'status' => 'active',
    ]);
    Loan::query()->create([
        'bookshelf_id' => $shelf->id, 'copy_id' => $c3->id, 'book_id' => $book->id,
        'borrower_id' => $other->id, 'lent_by' => $manager->id,
        'due_on' => '2026-09-04', 'status' => 'active',
    ]);
    app(TenantContext::class)->set($shelf, $readerMembership);
    test()->actingAs($reader);

    return [$shelf, $reader, $loan, $book];
}

it('a reader sees their own loan with days remaining, and only their own', function () {
    Carbon::setTestNow(Carbon::parse('2026-09-01 03:00:00', 'UTC'));
    [, $reader] = mydFix();

    $dash = app(MyDashboardQuery::class)->run($reader);

    expect($dash['loans'])->toHaveCount(1)
        ->and($dash['loans'][0]['copyCode'])->toBe('DT-0401')
        ->and($dash['loans'][0]['daysRemaining'])->toBe(3)
        ->and($dash['loans'][0]['isOverdue'])->toBeFalse()
        ->and($dash['loans'][0]['renewBlockedBy'])->toBeNull()
        ->and($dash['recentlyReturned'])->toHaveCount(1)
        ->and($dash['recentlyReturned'][0]['returnCondition'])->toBe('slightly_worn');
});

it('overdue and days remaining follow the clock, with no write', function () {
    [, $reader] = mydFix(slug: 'dong-thap-myd-clock');

    Carbon::setTestNow(Carbon::parse('2026-09-08 03:00:00', 'UTC'));
    $dash = app(MyDashboardQuery::class)->run($reader);

    expect($dash['loans'][0]['isOverdue'])->toBeTrue()
        ->and($dash['loans'][0]['daysRemaining'])->toBe(-4);
});

it('the renew refusal is the code RenewLoan throws — not a literal', function () {
    // max_renewals 0: even the first renewal is refused.
    [, $reader] = mydFix(['max_renewals' => 0], slug: 'dong-thap-myd-cap');

    $dash = app(MyDashboardQuery::class)->run($reader);
    expect($dash['loans'][0]['renewBlockedBy'])->toBe('no_renewals_remaining');
});

it('somebody queued for the title blocks renewal, and the screen says which reason', function () {
    [$shelf, $reader, , $book] = mydFix(slug: 'dong-thap-myd-q');
    app(TenantContext::class)->actSystemWide();
    $waiting = User::factory()->create(['full_name' => 'Anna Chờ Dế Mèn']);
    BorrowRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $book->id,
        'member_id' => $waiting->id, 'status' => 'pending',
    ]);
    app(TenantContext::class)->set($shelf->fresh(), Membership::query()->where('user_id', $reader->id)->firstOrFail());

    $dash = app(MyDashboardQuery::class)->run($reader);
    expect($dash['loans'][0]['renewBlockedBy'])->toBe('title_has_queue');
});

it('history keeps a returned loan and says how it came back, newest first', function () {
    [, $reader] = mydFix(slug: 'dong-thap-myd-hist');

    $history = app(MyLoanHistoryQuery::class)->run($reader);

    expect($history['total'])->toBe(2)
        // REVIEW FIX — the comment this replaces claimed creation order was
        // "the OPPOSITE of the asserted order". It was not: as drafted,
        // mydFix() created the 08-21 (active) loan FIRST and the 08-01
        // (returned) loan SECOND, so creation order — and therefore the
        // monotonic UUIDv7 id order — was active-then-returned, EXACTLY the
        // asserted order. Strip both orderings and an unordered scan still
        // passed. **mydFix must be edited to create the RETURNED (08-01)
        // loan first and the ACTIVE (08-21) loan second** (see the fixture
        // above), which makes creation order genuinely opposite and this
        // assertion falsifiable. lentOn is asserted too, pinning the column
        // the ordering is actually on.
        ->and(collect($history['rows'])->pluck('lentOn')->all())->toBe(['2026-08-21', '2026-08-01'])
        ->and($history['rows'][0]['status'])->toBe('active')
        ->and($history['rows'][1]['status'])->toBe('returned')
        ->and($history['rows'][1]['returnCondition'])->toBe('slightly_worn')
        ->and($history['rows'][1]['returnedOn'])->toBe('2026-08-14');
});
