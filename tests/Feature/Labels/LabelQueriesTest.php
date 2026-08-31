<?php

use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\User;
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
    [$shelf] = lblFix();

    $de = Book::factory()->for($shelf)->create(['title' => 'Dế Mèn Phiêu Lưu Ký']);
    $an = Book::factory()->for($shelf)->create(['title' => 'Aó Dài']);
    BookCopy::factory()->for($shelf)->for($de)->create(['code' => 'DT-0002']);
    BookCopy::factory()->for($shelf)->for($de)->create(['code' => 'DT-0001']);
    BookCopy::factory()->for($shelf)->for($an)->create(['code' => 'DT-0003']);

    $rows = app(TitlesForLabelsQuery::class)->run();

    expect(collect($rows)->pluck('title')->all())->toBe(['Aó Dài', 'Dế Mèn Phiêu Lưu Ký'])
        ->and(collect($rows)->firstWhere('title', 'Dế Mèn Phiêu Lưu Ký')['copies'])
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
