<?php

use App\Enums\StatsPeriod;
use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\Category;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\User;
use App\Queries\StatisticsQuery;
use App\Support\TenantContext;
use Carbon\CarbonImmutable;

/**
 * One shelf, one manager bound as the tenant, one reader.
 *
 * The reader is returned as a USER, not a membership: loans.borrower_id is a
 * users(id) (`loans_borrower_id_foreign`, read off the live table), and both
 * columns hold 36-char uuids, so passing the wrong one fails on the foreign
 * key rather than on anything readable.
 *
 * Grep first: `grep -rn "^function statFix" tests/` — top-level helpers are
 * process-global (AGENTS.md).
 *
 * @return array{Bookshelf, User, User}
 */
function statFix(string $slug = 'dong-thap-stat'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);

    $manager = User::factory()->create(['full_name' => 'Maria Nguyễn Lan']);
    $managerMembership = Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);

    $anh = User::factory()->create(['full_name' => 'Têrêsa Lê Ngọc Ánh']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $anh->id, 'role' => 'reader', 'status' => 'active',
    ]);

    app(TenantContext::class)->set($shelf, $managerMembership);
    test()->actingAs($manager);

    return [$shelf, $manager, $anh];
}

/**
 * One ACTIVE loan on its own copy.
 *
 * Its own copy, always: `loans_one_active_per_copy` is a UNIQUE over
 * `active_copy_id`, a generated column equal to `copy_id` while the status is
 * 'active'. Two active loans on one copy is errno 1062, not a fixture.
 *
 * Grep first: `grep -rn "^function statLoan" tests/`.
 */
function statLoan(Bookshelf $shelf, Book $book, User $borrower, User $lender, string $lentAt, string $code): Loan
{
    $copy = BookCopy::factory()->for($shelf)->for($book)->create(['code' => $code]);

    return Loan::query()->create([
        'bookshelf_id' => $shelf->id,
        'copy_id' => $copy->id,
        'book_id' => $book->id,
        'borrower_id' => $borrower->id,
        'lent_by' => $lender->id,
        'due_on' => CarbonImmutable::parse($lentAt)->addDays(14)->toDateString(),
        'lent_at' => CarbonImmutable::parse($lentAt),
        'status' => 'active',
    ]);
}

it('counts a loan inside the period and ignores one before it', function () {
    [$shelf, $manager, $anh] = statFix();
    CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-09-02 02:00:00', 'UTC'));

    $book = Book::factory()->for($shelf)->create();

    // Inside: Tuesday of the current civil week.
    statLoan($shelf, $book, $anh, $manager, '2026-09-01 03:00:00', 'DT-0001');
    // Outside: the Friday before, well clear of Monday 00:00 +07:00.
    statLoan($shelf, $book, $anh, $manager, '2026-08-28 03:00:00', 'DT-0002');

    expect(app(StatisticsQuery::class)->run(StatsPeriod::Week)['loans'])->toBe(1);
});

it('a voided loan is not a loan', function () {
    [$shelf, $manager, $anh] = statFix();
    CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-09-02 02:00:00', 'UTC'));

    $book = Book::factory()->for($shelf)->create();
    $loan = statLoan($shelf, $book, $anh, $manager, '2026-09-01 03:00:00', 'DT-0001');
    $loan->update(['status' => 'voided', 'voided_at' => now(), 'voided_by' => $manager->id, 'void_reason' => 'nhập nhầm']);

    expect(app(StatisticsQuery::class)->run(StatsPeriod::Week)['loans'])->toBe(0);
});

it('distinct borrowers counts people, not loans', function () {
    // TITLED ASSERTION FIRST. `expect()->and()` short-circuits and a failed
    // expect() aborts the whole METHOD, so putting `loans` first would make a
    // wrong `borrowers` invisible behind a wrong `loans`.
    [$shelf, $manager, $anh] = statFix();
    CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-09-02 02:00:00', 'UTC'));

    $book = Book::factory()->for($shelf)->create();
    // Three loans, three copies, all inside the week and all BEFORE "now" —
    // the predicate has no upper bound, so a future-dated fixture would make
    // the count a coincidence rather than a measurement.
    statLoan($shelf, $book, $anh, $manager, '2026-08-31 03:00:00', 'DT-0001');
    statLoan($shelf, $book, $anh, $manager, '2026-09-01 03:00:00', 'DT-0002');
    statLoan($shelf, $book, $anh, $manager, '2026-09-01 09:00:00', 'DT-0003');

    $stats = app(StatisticsQuery::class)->run(StatsPeriod::Week);

    expect($stats['borrowers'])->toBe(1);
    expect($stats['loans'])->toBe(3);
});

it('counts lost copies by lost_reported_at, not by updated_at — divergence D2', function () {
    [$shelf] = statFix();
    CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-09-02 02:00:00', 'UTC'));

    $book = Book::factory()->for($shelf)->create();

    // Reported lost LONG before the period, and touched inside it. Under the
    // reference's `updated_at >= since` this copy counts; under
    // lost_reported_at it does not. That difference IS this block.
    $old = BookCopy::factory()->for($shelf)->for($book)->create([
        'code' => 'DT-0001',
        'state' => 'lost',
        'lost_reported_at' => CarbonImmutable::parse('2025-01-05 03:00:00', 'UTC'),
    ]);
    $old->update(['condition_note' => 'tìm lại lần nữa']);

    BookCopy::factory()->for($shelf)->for($book)->create([
        'code' => 'DT-0002',
        'state' => 'lost',
        'lost_reported_at' => CarbonImmutable::parse('2026-09-01 03:00:00', 'UTC'),
    ]);

    expect(app(StatisticsQuery::class)->run(StatsPeriod::Week)['copiesLost'])->toBe(1);
});

it('groups the daily chart by the PARISH day, not the UTC day', function () {
    [$shelf, $manager, $anh] = statFix();
    CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-09-03 02:00:00', 'UTC'));

    $book = Book::factory()->for($shelf)->create();

    // 18:30 UTC on 31 Aug is 01:30 on 1 Sep in Hồ Chí Minh. Grouped by the UTC
    // day this lands on 2026-08-31; grouped correctly it lands on 2026-09-01.
    // Measured on MariaDB 10.11.19:
    //   DATE(CONVERT_TZ('2026-08-31 18:30:00','+00:00','+07:00')) → 2026-09-01
    statLoan($shelf, $book, $anh, $manager, '2026-08-31 18:30:00', 'DT-0001');

    $days = collect(app(StatisticsQuery::class)->run(StatsPeriod::Week)['daily'])->pluck('day')->all();

    expect($days)->toContain('2026-09-01');
    expect($days)->not->toContain('2026-08-31');
});

it('counts books added in the period', function () {
    [$shelf] = statFix();
    CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-09-02 02:00:00', 'UTC'));

    Book::factory()->for($shelf)->create(['created_at' => CarbonImmutable::parse('2026-09-01 03:00:00', 'UTC')]);
    Book::factory()->for($shelf)->create(['created_at' => CarbonImmutable::parse('2026-08-01 03:00:00', 'UTC')]);

    expect(app(StatisticsQuery::class)->run(StatsPeriod::Week)['booksAdded'])->toBe(1);
});

it('groups loans by the book\'s category, and names the uncategorised', function () {
    [$shelf, $manager, $anh] = statFix();
    CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-09-02 02:00:00', 'UTC'));

    // NO ->for($shelf). App\Models\Category is "Global, deliberately NOT
    // shelf-scoped — one taxonomy for every shelf" (its own docblock); it has
    // no bookshelf() relation and `categories` has no bookshelf_id. Every
    // existing call site in tests/ is a bare Category::factory()->create().
    $category = Category::factory()->create(['name' => 'Thiếu nhi']);
    $withCat = Book::factory()->for($shelf)->create(['category_id' => $category->id]);
    $without = Book::factory()->for($shelf)->create(['category_id' => null]);

    statLoan($shelf, $withCat, $anh, $manager, '2026-09-01 03:00:00', 'DT-0001');
    statLoan($shelf, $without, $anh, $manager, '2026-09-01 04:00:00', 'DT-0002');

    $labels = collect(app(StatisticsQuery::class)->run(StatsPeriod::Week)['byCategory'])->pluck('label')->all();

    // A book with no category must appear under a NAMED bucket rather than
    // vanish from the chart or appear as an empty label.
    expect($labels)->toContain('Thiếu nhi');
    expect($labels)->toContain('Chưa phân loại');
});

it('ranks top books by loan count within the period', function () {
    [$shelf, $manager, $anh] = statFix();
    CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-09-02 02:00:00', 'UTC'));

    $popular = Book::factory()->for($shelf)->create(['title' => 'Dế Mèn Phiêu Lưu Ký']);
    $quiet = Book::factory()->for($shelf)->create(['title' => 'Aó Dài']);

    statLoan($shelf, $popular, $anh, $manager, '2026-09-01 03:00:00', 'DT-0001');
    statLoan($shelf, $popular, $anh, $manager, '2026-09-01 04:00:00', 'DT-0002');
    statLoan($shelf, $quiet, $anh, $manager, '2026-09-01 05:00:00', 'DT-0003');

    $top = app(StatisticsQuery::class)->run(StatsPeriod::Week)['topBooks'];

    expect($top[0]['title'])->toBe('Dế Mèn Phiêu Lưu Ký');
    expect($top[0]['count'])->toBe(2);
});

it('ranks top readers by loan count, naming the borrower', function () {
    [$shelf, $manager, $anh] = statFix();
    CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-09-02 02:00:00', 'UTC'));

    $book = Book::factory()->for($shelf)->create();
    statLoan($shelf, $book, $anh, $manager, '2026-09-01 03:00:00', 'DT-0001');
    statLoan($shelf, $book, $anh, $manager, '2026-09-01 04:00:00', 'DT-0002');

    $top = app(StatisticsQuery::class)->run(StatsPeriod::Week)['topReaders'];

    expect($top[0]['name'])->toBe('Têrêsa Lê Ngọc Ánh');
    expect($top[0]['count'])->toBe(2);
});

it('excludes a borrower with a soft-deleted membership or a soft-deleted user from topReaders, though the loan still counts — Finding 1', function () {
    // TITLED ASSERTION FIRST: the exclusion from topReaders is what this
    // block exists to prove; the loans total is the control showing the
    // loan itself was never dropped, just the name on the leaderboard.
    [$shelf, $manager, $anh] = statFix();
    CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-09-02 02:00:00', 'UTC'));

    $book = Book::factory()->for($shelf)->create();

    // Borrower whose membership on this shelf is soft-deleted after the loan.
    $noMembership = User::factory()->create(['full_name' => 'Gioan Baotixita Trần']);
    $noMembershipMembership = Membership::factory()->for($shelf)->create([
        'user_id' => $noMembership->id, 'role' => 'reader', 'status' => 'active',
    ]);
    statLoan($shelf, $book, $noMembership, $manager, '2026-09-01 03:00:00', 'DT-0003');
    $noMembershipMembership->delete();

    // Borrower whose user row itself is soft-deleted after the loan.
    $trashedUser = User::factory()->create(['full_name' => 'Phêrô Nguyễn Văn']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $trashedUser->id, 'role' => 'reader', 'status' => 'active',
    ]);
    statLoan($shelf, $book, $trashedUser, $manager, '2026-09-01 04:00:00', 'DT-0004');
    $trashedUser->delete();

    $stats = app(StatisticsQuery::class)->run(StatsPeriod::Week);
    $names = collect($stats['topReaders'])->pluck('name')->all();

    expect($names)->not->toContain('Gioan Baotixita Trần');
    expect($names)->not->toContain('Phêrô Nguyễn Văn');
    expect($stats['loans'])->toBe(2);
});

it('another shelf\'s loans are invisible — tenancy, not a hand-written predicate', function () {
    [$shelf, $manager, $anh] = statFix();
    CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-09-02 02:00:00', 'UTC'));

    $book = Book::factory()->for($shelf)->create();
    statLoan($shelf, $book, $anh, $manager, '2026-09-01 03:00:00', 'DT-0001');

    app(TenantContext::class)->actSystemWide();
    $other = Bookshelf::factory()->create(['slug' => 'other-stat', 'settings' => []]);
    $otherUser = User::factory()->create();
    Membership::factory()->for($other)->create([
        'user_id' => $otherUser->id, 'role' => 'reader', 'status' => 'active',
    ]);
    $otherBook = Book::factory()->for($other)->create();
    statLoan($other, $otherBook, $otherUser, $otherUser, '2026-09-01 03:00:00', 'ZZ-0001');

    app(TenantContext::class)->set($shelf, Membership::query()
        ->where('bookshelf_id', $shelf->id)->where('role', 'manager')->firstOrFail());

    expect(app(StatisticsQuery::class)->run(StatsPeriod::Week)['loans'])->toBe(1);
});
