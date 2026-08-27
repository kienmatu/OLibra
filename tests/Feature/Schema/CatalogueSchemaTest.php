<?php

use App\Support\Fold;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

function makeCatalogueShelf(): string
{
    $id = (string) Str::uuid7();
    DB::table('bookshelves')->insert([
        'id' => $id, 'slug' => 'dong-thap-'.substr($id, -8), 'name' => 'Tủ sách Đồng Tháp',
        'settings' => '{}',
    ]);

    return $id;
}

it('creates the catalogue tables', function () {
    foreach (['categories', 'books', 'book_copies'] as $table) {
        expect(Schema::hasTable($table))->toBeTrue("missing table {$table}");
    }
});

it('gives book_copies the qr columns 20260813_01 added', function () {
    expect(Schema::hasColumns('book_copies', ['qr_printed_at', 'qr_print_count']))->toBeTrue();
});

it('folds title and author in the database, agreeing with php', function () {
    $shelf = makeCatalogueShelf();
    DB::table('books')->insert([
        'id' => (string) Str::uuid7(), 'bookshelf_id' => $shelf,
        'title' => 'Đất Rừng Phương Nam', 'slug' => 'dat-rung-phuong-nam',
        'author' => 'Đoàn Giỏi',
    ]);

    $row = DB::selectOne('select title_folded, author_folded from books limit 1');

    expect($row->title_folded)->toBe(Fold::fold('Đất Rừng Phương Nam'))
        ->and($row->title_folded)->toBe('dat rung phuong nam')
        ->and($row->author_folded)->toBe('doan gioi');
});

it('folds a null author to the empty string, as coalesce demands', function () {
    $shelf = makeCatalogueShelf();
    DB::table('books')->insert([
        'id' => (string) Str::uuid7(), 'bookshelf_id' => $shelf,
        'title' => 'Hoàng Tử Bé', 'slug' => 'hoang-tu-be', 'author' => null,
    ]);

    $row = DB::selectOne('select author_folded from books limit 1');

    expect($row->author_folded)->toBe('');
});

it('folds a title mixing a Vietnamese diacritic and a non-Vietnamese accent, agreeing with php', function () {
    // BR §12's store==search invariant, proven on the real table rather
    // than on FoldExpression's probe: a title carrying both a Vietnamese
    // tone mark (ấ) and a German umlaut (ä) must fold identically in SQL
    // and in PHP.
    $shelf = makeCatalogueShelf();
    $title = 'Kästner và Chuyện Ở Đấy';
    DB::table('books')->insert([
        'id' => (string) Str::uuid7(), 'bookshelf_id' => $shelf,
        'title' => $title, 'slug' => 'kastner-va-chuyen-o-day',
    ]);

    $row = DB::selectOne('select title_folded from books limit 1');

    expect($row->title_folded)->toBe(Fold::fold($title));
});

it('rejects a book_copies state outside the enum', function () {
    $shelf = makeCatalogueShelf();
    $bookId = (string) Str::uuid7();
    DB::table('books')->insert([
        'id' => $bookId, 'bookshelf_id' => $shelf,
        'title' => 'Sách', 'slug' => 'sach',
    ]);

    expect(fn () => DB::table('book_copies')->insert([
        'id' => (string) Str::uuid7(), 'bookshelf_id' => $shelf, 'book_id' => $bookId,
        'code' => 'DT-0001', 'state' => 'not_a_real_state',
    ]))->toThrow(QueryException::class);
});

it('rejects a book_copies condition outside the enum', function () {
    $shelf = makeCatalogueShelf();
    $bookId = (string) Str::uuid7();
    DB::table('books')->insert([
        'id' => $bookId, 'bookshelf_id' => $shelf,
        'title' => 'Sách', 'slug' => 'sach',
    ]);

    expect(fn () => DB::table('book_copies')->insert([
        'id' => (string) Str::uuid7(), 'bookshelf_id' => $shelf, 'book_id' => $bookId,
        'code' => 'DT-0002', 'condition' => 'not_a_real_condition',
    ]))->toThrow(QueryException::class);
});

it('requires a retired_reason when a copy is retired', function () {
    $shelf = makeCatalogueShelf();
    $bookId = (string) Str::uuid7();
    DB::table('books')->insert([
        'id' => $bookId, 'bookshelf_id' => $shelf,
        'title' => 'Sách', 'slug' => 'sach-2',
    ]);

    expect(fn () => DB::table('book_copies')->insert([
        'id' => (string) Str::uuid7(), 'bookshelf_id' => $shelf, 'book_id' => $bookId,
        'code' => 'DT-0003', 'state' => 'retired', 'retired_reason' => null,
    ]))->toThrow(QueryException::class);

    // But with a reason, it succeeds.
    DB::table('book_copies')->insert([
        'id' => (string) Str::uuid7(), 'bookshelf_id' => $shelf, 'book_id' => $bookId,
        'code' => 'DT-0004', 'state' => 'retired', 'retired_reason' => 'water damage',
    ]);

    expect(DB::table('book_copies')->where('code', 'DT-0004')->exists())->toBeTrue();
});

it('scopes copy codes per shelf, alive rows only', function () {
    $a = makeCatalogueShelf();
    $b = makeCatalogueShelf();
    $bookIdA = (string) Str::uuid7();
    $bookIdB = (string) Str::uuid7();
    DB::table('books')->insert([
        'id' => $bookIdA, 'bookshelf_id' => $a, 'title' => 'Sách A', 'slug' => 'sach-a',
    ]);
    DB::table('books')->insert([
        'id' => $bookIdB, 'bookshelf_id' => $b, 'title' => 'Sách B', 'slug' => 'sach-b',
    ]);

    $copy = function (string $shelf, string $bookId, ?string $deletedAt = null): void {
        DB::table('book_copies')->insert([
            'id' => (string) Str::uuid7(), 'bookshelf_id' => $shelf, 'book_id' => $bookId,
            'code' => 'DT-0142', 'deleted_at' => $deletedAt,
        ]);
    };

    $copy($a, $bookIdA, now());   // soft-deleted: frees the code
    $copy($a, $bookIdA);          // live
    $copy($b, $bookIdB);          // same code, other shelf: fine

    expect(fn () => $copy($a, $bookIdA))->toThrow(QueryException::class);
});

it('scopes book slugs and copy codes per shelf, alive rows only', function () {
    $a = makeCatalogueShelf();
    $b = makeCatalogueShelf();
    $book = function (string $shelf, ?string $deletedAt = null): void {
        DB::table('books')->insert([
            'id' => (string) Str::uuid7(), 'bookshelf_id' => $shelf,
            'title' => 'Dế Mèn Phiêu Lưu Ký', 'slug' => 'de-men', 'deleted_at' => $deletedAt,
        ]);
    };

    $book($a, now());                 // soft-deleted: frees the slug
    $book($a);                        // live
    $book($b);                        // same slug, other shelf: fine

    expect(fn () => $book($a))->toThrow(QueryException::class);
});
