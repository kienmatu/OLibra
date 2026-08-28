<?php

use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\User;
use App\Queries\OverdueLoansQuery;
use App\Support\TenantContext;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

afterEach(fn () => Carbon::setTestNow());

/**
 * Manager (acting) + three overdue loans seeded in NEITHER most-late nor
 * name order (UUIDv7 trap: creation order must differ from every asserted
 * order), plus one on-time, one returned-late and one lost loan.
 * Borrower names force the folded sort to differ from byte order (Đặng).
 */
function odFix(string $slug = 'dong-thap-od'): Bookshelf
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);
    $manager = User::factory()->create(['full_name' => 'Maria Gọi Điện Nhắc']);
    $managerMembership = Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);
    $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Hoàng Tử Bé', 'slug' => 'htb-od']);

    $seed = [
        // [code, name, phone, due_on, status] — seeded mid-late first, so
        // neither most-late (0403 first) nor name order equals creation order.
        ['DT-0301', 'Vũ Văn Sáu Muộn', '0912000001', '2026-08-10', 'active'],
        ['DT-0302', 'Đặng Thị Bảy Muộn', null, '2026-08-20', 'active'],
        ['DT-0303', 'An Văn Tám Muộn', '0912000003', '2026-08-01', 'active'],
        ['DT-0304', 'Gioan Đúng Hạn', '0912000004', '2026-09-20', 'active'],
        ['DT-0305', 'Phaolô Trả Muộn Rồi', '0912000005', '2026-08-01', 'returned'],
        ['DT-0306', 'Đaminh Làm Mất Sách', '0912000006', '2026-08-01', 'lost'],
    ];
    foreach ($seed as [$code, $name, $phone, $due, $status]) {
        $u = User::factory()->create(['full_name' => $name, 'phone' => $phone]);
        $c = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => $code, 'state' => $status === 'active' ? 'on_loan' : 'available']);
        Loan::query()->create(array_merge([
            'bookshelf_id' => $shelf->id, 'copy_id' => $c->id, 'book_id' => $book->id,
            'borrower_id' => $u->id, 'lent_by' => $manager->id,
            'due_on' => $due, 'status' => $status,
        ], $status === 'returned' ? ['returned_at' => now(), 'return_condition' => 'perfect'] : [],
            $status === 'lost' ? ['lost_reported_at' => now()] : []));
    }
    app(TenantContext::class)->set($shelf, $managerMembership);
    test()->actingAs($manager);

    return $shelf;
}

it('a loan becomes overdue when the clock moves, with no write and no job', function () {
    odFix();

    Carbon::setTestNow(Carbon::parse('2026-08-05 03:00:00', 'UTC'));
    $early = app(OverdueLoansQuery::class)->run();
    Carbon::setTestNow(Carbon::parse('2026-08-25 03:00:00', 'UTC'));
    $later = app(OverdueLoansQuery::class)->run();

    expect(collect($early)->pluck('copyCode')->all())->toBe(['DT-0303'])
        ->and(collect($later)->pluck('copyCode')->all())->toBe(['DT-0303', 'DT-0301', 'DT-0302']);
});

it('days late keeps counting up as the clock moves further', function () {
    odFix(slug: 'dong-thap-od-days');
    Carbon::setTestNow(Carbon::parse('2026-08-25 03:00:00', 'UTC'));
    $rows = app(OverdueLoansQuery::class)->run();
    $mostLate = $rows[0];
    expect($mostLate['dueOn'])->toBe('2026-08-01')->and($mostLate['daysLate'])->toBe(24);

    Carbon::setTestNow(Carbon::parse('2026-08-30 03:00:00', 'UTC'));
    expect(app(OverdueLoansQuery::class)->run()[0]['daysLate'])->toBe(29);
});

it('a returned loan is never overdue however late it was, and a lost loan has its own screen', function () {
    odFix(slug: 'dong-thap-od-closed');
    Carbon::setTestNow(Carbon::parse('2026-09-01 03:00:00', 'UTC'));
    $codes = collect(app(OverdueLoansQuery::class)->run())->pluck('copyCode');

    // The three not->toContain assertions below all pass vacuously on an
    // EMPTY collection — the exact shape known-gaps warns about — so the
    // positive assertion comes first and is what makes them mean anything
    // (review fix).
    expect($codes->all())->toBe(['DT-0303', 'DT-0301', 'DT-0302'])
        ->and($codes)->not->toContain('DT-0305')
        ->and($codes)->not->toContain('DT-0306')
        ->and($codes)->not->toContain('DT-0304');
});

it('the phone is on the row — it is the point of the screen — and its absence is null, not omission', function () {
    odFix(slug: 'dong-thap-od-phone');
    Carbon::setTestNow(Carbon::parse('2026-08-25 03:00:00', 'UTC'));
    $rows = collect(app(OverdueLoansQuery::class)->run())->keyBy('copyCode');

    expect($rows['DT-0301']['borrowerPhone'])->toBe('0912000001')
        ->and(array_key_exists('borrowerPhone', $rows['DT-0302']))->toBeTrue()
        ->and($rows['DT-0302']['borrowerPhone'])->toBeNull();
});

it('most-late is the default, least-late reverses, borrower folds the name so Đặng is not last', function () {
    odFix(slug: 'dong-thap-od-sort');
    Carbon::setTestNow(Carbon::parse('2026-08-25 03:00:00', 'UTC'));
    $q = app(OverdueLoansQuery::class);

    expect(collect($q->run())->pluck('copyCode')->all())->toBe(['DT-0303', 'DT-0301', 'DT-0302'])
        ->and(collect($q->run('least-late'))->pluck('copyCode')->all())->toBe(['DT-0302', 'DT-0301', 'DT-0303'])
        // Folded: An, Đặng(→dang), Vũ(→vu). Byte order would put Đặng LAST.
        ->and(collect($q->run('borrower'))->pluck('borrowerName')->all())
        ->toBe(['An Văn Tám Muộn', 'Đặng Thị Bảy Muộn', 'Vũ Văn Sáu Muộn']);
});

/**
 * The brief's ported test file dropped the exact boundary the reference
 * covers via its ON_TIME fixture (old_next/tests/domain/circulation/
 * overdue-loans.test.ts:20-21,88-96: "the last instant that is not late"
 * asserts an empty result on the due date itself). BR §8 states it as "Due
 * today is NOT overdue", and LoanTerms::isOverdue's own docblock repeats it
 * verbatim (app/Support/Circulation/LoanTerms.php:33). Added back explicitly
 * rather than trusted to the existing tests, none of which seeds a loan due
 * on exactly the clock's "today" — see task-8-report.md's Deviations section.
 */
it('due yesterday is overdue, due today and due tomorrow are not', function () {
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => 'dong-thap-od-boundary', 'settings' => []]);
    $manager = User::factory()->create(['full_name' => 'Maria Ranh Giới']);
    $managerMembership = Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);
    $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Hoàng Tử Bé', 'slug' => 'htb-od-boundary']);

    // "today" below is 2026-08-25 (Asia/Ho_Chi_Minh) — Clock::today() reads
    // a 03:00 UTC instant as 10:00 ICT, the same civil day.
    $seed = [
        ['DT-0401', 'Người Hôm Qua', '2026-08-24'],
        ['DT-0402', 'Người Hôm Nay', '2026-08-25'],
        ['DT-0403', 'Người Ngày Mai', '2026-08-26'],
    ];
    foreach ($seed as [$code, $name, $due]) {
        $u = User::factory()->create(['full_name' => $name]);
        $c = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => $code, 'state' => 'on_loan']);
        Loan::query()->create([
            'bookshelf_id' => $shelf->id, 'copy_id' => $c->id, 'book_id' => $book->id,
            'borrower_id' => $u->id, 'lent_by' => $manager->id,
            'due_on' => $due, 'status' => 'active',
        ]);
    }
    app(TenantContext::class)->set($shelf, $managerMembership);
    test()->actingAs($manager);

    Carbon::setTestNow(Carbon::parse('2026-08-25 03:00:00', 'UTC'));
    $codes = collect(app(OverdueLoansQuery::class)->run())->pluck('copyCode')->all();

    expect($codes)->toBe(['DT-0401']);
});

it('equally late loans are ordered by a key that cannot tie — the ORDER BY is pinned', function () {
    // The tiebreak is loans.id, a UUIDv7 that always equals creation order —
    // a data assertion cannot falsify it (known-gaps, fired four times).
    // Pin the mechanism instead.
    odFix(slug: 'dong-thap-od-tie');
    DB::flushQueryLog();
    DB::enableQueryLog();
    app(OverdueLoansQuery::class)->run();
    $log = DB::getQueryLog();
    DB::disableQueryLog();

    $main = collect($log)->first(fn ($q) => str_contains($q['query'], 'order by'));
    expect($main)->not->toBeNull()
        ->and(str_contains($main['query'], '`loans`.`id`'))->toBeTrue('no id tiebreak: '.$main['query']);
});
