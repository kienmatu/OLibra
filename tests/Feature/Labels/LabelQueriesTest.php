<?php

use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\User;
use App\Queries\Labels\CopiesForLabelsQuery;
use App\Queries\Labels\TitlesForLabelsQuery;
use App\Support\TenantContext;

/**
 * Grep first: `grep -rn "^function lblFix" tests/`.
 *
 * @return array{Bookshelf, User}
 */
function lblFix(string $slug = 'dong-thap-lbl'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);
    $manager = User::factory()->create(['full_name' => 'Maria Nguyễn Lan']);
    $membership = Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);
    app(TenantContext::class)->set($shelf, $membership);
    test()->actingAs($manager);

    return [$shelf, $manager];
}

it('groups copies under their title, ordered by title then code', function () {
    // RETRACTION: an earlier version of this fixture used "Aó Dài" and
    // "Dế Mèn Phiêu Lưu Ký" and claimed the block proved the ordering
    // happens in the database. That claim was mine (not Task 5's), and it
    // was false — checked against the live database and against PHP's
    // strcmp, "A" (0x41) sorts before "D" (0x44) as raw bytes exactly the
    // same way utf8mb4_unicode_ci sorts them, so a PHP-side usort by title
    // would have passed that fixture too. It proved nothing about which
    // layer sorted.
    //
    // "Êm Đềm" vs "Zang" genuinely discriminates. Verified against the
    // live database and PHP:
    //   SELECT 'Êm Đềm' < 'Zang';          -- 1 (true): DB puts Êm Đềm first
    //   php -r 'var_dump(strcmp("Êm Đềm","Zang"));'  -- int(1): raw bytes put
    //                                                    Zang first (0xC3 > 0x5A)
    // A PHP-side sort by raw title bytes would return ['Zang', 'Êm Đềm'];
    // the implementation's correlated subquery, which orders by MariaDB's
    // utf8mb4_unicode_ci collation, returns the opposite. This block is
    // shown red under a PHP-side sort and green under the real
    // implementation as part of Task 6's mutation step.
    [$shelf] = lblFix();

    $em = Book::factory()->for($shelf)->create(['title' => 'Êm Đềm']);
    $zang = Book::factory()->for($shelf)->create(['title' => 'Zang']);
    BookCopy::factory()->for($shelf)->for($em)->create(['code' => 'DT-0002']);
    BookCopy::factory()->for($shelf)->for($em)->create(['code' => 'DT-0001']);
    BookCopy::factory()->for($shelf)->for($zang)->create(['code' => 'DT-0003']);

    $rows = app(TitlesForLabelsQuery::class)->run();

    expect(collect($rows)->pluck('title')->all())->toBe(['Êm Đềm', 'Zang'])
        ->and(collect($rows)->firstWhere('title', 'Êm Đềm')['copies'])
        ->toHaveCount(2);
});

it('copies within a title are ordered by code', function () {
    [$shelf] = lblFix();

    $book = Book::factory()->for($shelf)->create(['title' => 'Dế Mèn Phiêu Lưu Ký']);
    BookCopy::factory()->for($shelf)->for($book)->create(['code' => 'DT-0002']);
    BookCopy::factory()->for($shelf)->for($book)->create(['code' => 'DT-0001']);

    $codes = collect(app(TitlesForLabelsQuery::class)->run()[0]['copies'])->pluck('code')->all();

    expect($codes)->toBe(['DT-0001', 'DT-0002']);
});

it('onlyUnprinted DROPS a title whose every copy is printed, rather than showing an empty row', function () {
    // This is OPS §3.3's stated reason for grouping in the query. A title
    // that survives with copies: [] is the exact failure it names.
    [$shelf] = lblFix();

    $allPrinted = Book::factory()->for($shelf)->create(['title' => 'Aó Dài']);
    BookCopy::factory()->for($shelf)->for($allPrinted)->create(['code' => 'DT-0001', 'qr_print_count' => 1]);
    BookCopy::factory()->for($shelf)->for($allPrinted)->create(['code' => 'DT-0002', 'qr_print_count' => 3]);

    $partly = Book::factory()->for($shelf)->create(['title' => 'Dế Mèn Phiêu Lưu Ký']);
    BookCopy::factory()->for($shelf)->for($partly)->create(['code' => 'DT-0003', 'qr_print_count' => 2]);
    BookCopy::factory()->for($shelf)->for($partly)->create(['code' => 'DT-0004', 'qr_print_count' => 0]);

    $rows = app(TitlesForLabelsQuery::class)->run(onlyUnprinted: true);

    expect(collect($rows)->pluck('title')->all())->toBe(['Dế Mèn Phiêu Lưu Ký'])
        ->and($rows[0]['copies'])->toHaveCount(1)
        ->and($rows[0]['copies'][0]['code'])->toBe('DT-0004');
});

it('a retired copy is still selectable — a retired book is still a physical object', function () {
    [$shelf] = lblFix();

    $book = Book::factory()->for($shelf)->create(['title' => 'Aó Dài']);
    // retired_reason is REQUIRED: book_copies carries
    //   CHECK (state <> 'retired' or retired_reason is not null)
    // read off the live table. Omitting it is a constraint violation, not a
    // retired copy — tests/Feature/Schema/CatalogueSchemaTest.php exists to
    // assert exactly that refusal.
    BookCopy::factory()->for($shelf)->for($book)->create([
        'code' => 'DT-0001', 'state' => 'retired', 'retired_reason' => 'rách nhiều',
    ]);

    expect(app(TitlesForLabelsQuery::class)->run()[0]['copies'])->toHaveCount(1);
});

it('a soft-deleted copy is not selectable, and a soft-deleted book takes its copies with it', function () {
    [$shelf] = lblFix();

    $book = Book::factory()->for($shelf)->create(['title' => 'Aó Dài']);
    $gone = BookCopy::factory()->for($shelf)->for($book)->create(['code' => 'DT-0001']);
    BookCopy::factory()->for($shelf)->for($book)->create(['code' => 'DT-0002']);
    $gone->delete();

    expect(app(TitlesForLabelsQuery::class)->run()[0]['copies'])->toHaveCount(1);

    $book->delete();

    expect(app(TitlesForLabelsQuery::class)->run())->toBe([]);
});

it('another shelf\'s titles are invisible', function () {
    [$shelf] = lblFix();
    $book = Book::factory()->for($shelf)->create(['title' => 'Aó Dài']);
    BookCopy::factory()->for($shelf)->for($book)->create(['code' => 'DT-0001']);

    app(TenantContext::class)->actSystemWide();
    $other = Bookshelf::factory()->create(['slug' => 'other-lbl', 'settings' => []]);
    $otherBook = Book::factory()->for($other)->create(['title' => 'Zzz']);
    BookCopy::factory()->for($other)->for($otherBook)->create(['code' => 'DT-0001']);

    app(TenantContext::class)->set($shelf, Membership::query()
        ->where('bookshelf_id', $shelf->id)->firstOrFail());

    expect(app(TitlesForLabelsQuery::class)->run())->toHaveCount(1);
});

it('unions bookIds with copyIds and never repeats a copy reachable through both', function () {
    [$shelf] = lblFix();

    $de = Book::factory()->for($shelf)->create(['title' => 'Dế Mèn Phiêu Lưu Ký']);
    $a = BookCopy::factory()->for($shelf)->for($de)->create(['code' => 'DT-0001']);
    BookCopy::factory()->for($shelf)->for($de)->create(['code' => 'DT-0002']);

    $ao = Book::factory()->for($shelf)->create(['title' => 'Aó Dài']);
    $c = BookCopy::factory()->for($shelf)->for($ao)->create(['code' => 'DT-0003']);

    // The whole of Dế Mèn, plus one copy of Aó Dài, plus a copy of Dế Mèn
    // that the bookId already covers — the overlap is the point.
    $rows = app(CopiesForLabelsQuery::class)->run([$de->id], [$c->id, $a->id]);

    expect(collect($rows)->pluck('code')->all())->toBe(['DT-0001', 'DT-0002', 'DT-0003']);
});

it('an empty selection returns nothing and does not read the whole shelf', function () {
    [$shelf] = lblFix();
    $book = Book::factory()->for($shelf)->create(['title' => 'Aó Dài']);
    BookCopy::factory()->for($shelf)->for($book)->create(['code' => 'DT-0001']);

    expect(app(CopiesForLabelsQuery::class)->run([], []))->toBe([]);
});

it('onlyUnprinted narrows the union', function () {
    [$shelf] = lblFix();

    $book = Book::factory()->for($shelf)->create(['title' => 'Aó Dài']);
    BookCopy::factory()->for($shelf)->for($book)->create(['code' => 'DT-0001', 'qr_print_count' => 2]);
    BookCopy::factory()->for($shelf)->for($book)->create(['code' => 'DT-0002', 'qr_print_count' => 0]);

    $rows = app(CopiesForLabelsQuery::class)->run([$book->id], [], onlyUnprinted: true);

    expect(collect($rows)->pluck('code')->all())->toBe(['DT-0002']);
});

it('another shelf\'s ids expand to nothing rather than to its copies', function () {
    // The load-bearing tenancy block for this query: ids arrive from a FORM,
    // so a hand-made POST naming shelf B's book id must not print shelf B's
    // labels onto shelf A's sheet.
    [$shelf] = lblFix();

    app(TenantContext::class)->actSystemWide();
    $other = Bookshelf::factory()->create(['slug' => 'other-union', 'settings' => []]);
    $otherBook = Book::factory()->for($other)->create(['title' => 'Zzz']);
    $otherCopy = BookCopy::factory()->for($other)->for($otherBook)->create(['code' => 'ZZ-0001']);

    app(TenantContext::class)->set($shelf, Membership::query()
        ->where('bookshelf_id', $shelf->id)->firstOrFail());

    expect(app(CopiesForLabelsQuery::class)->run([$otherBook->id], [$otherCopy->id]))->toBe([]);
});
