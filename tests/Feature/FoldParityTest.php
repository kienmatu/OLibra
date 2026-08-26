<?php

use App\Support\Fold;
use App\Support\FoldExpression;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

function dbFold(string $input): string
{
    $row = DB::selectOne('SELECT '.FoldExpression::sql('?').' AS folded', [$input]);

    return (string) $row->folded;
}

it('agrees with php on every map entry, lowercase and uppercase', function () {
    foreach (Fold::MAP as $from => $to) {
        $upper = mb_strtoupper($from, 'UTF-8');

        // Embedded in context so the space-collapse and trim paths run too.
        expect(dbFold("x{$from}x"))->toBe(Fold::fold("x{$from}x"), "lowercase {$from}");
        expect(dbFold("x{$upper}x"))->toBe(Fold::fold("x{$upper}x"), "uppercase of {$from}");
    }
});

it('agrees with php across U+00C0–U+024F', function () {
    // Not asserting what the fold IS for every letter — asserting the two
    // halves AGREE, which is BR §12's actual requirement. A code point may
    // only join this exclusion list with the reason it diverges; the fix
    // for a new disagreement is a Fold::MAP entry giving both halves the
    // same target, and exclusion only when the engines' case mappings
    // genuinely differ:
    $excluded = [
        "\u{0130}",  // İ: PHP full case mapping yields i+U+0307; MariaDB's
        // simple mapping yields i. Fold::MAP repairs the PHP
        // side; the raw LOWER outputs still differ mid-pipeline
        // on some builds, so the letter is pinned here instead.
    ];

    for ($codepoint = 0xC0; $codepoint <= 0x24F; $codepoint++) {
        $char = mb_chr($codepoint, 'UTF-8');

        if (in_array($char, $excluded, true)) {
            continue;
        }

        expect(dbFold("a{$char}b"))->toBe(Fold::fold("a{$char}b"), sprintf('U+%04X', $codepoint));
    }
});

it('folds the real corpus identically', function (string $input) {
    expect(dbFold($input))->toBe(Fold::fold($input));
})->with([
    'Dế Mèn Phiêu Lưu Ký',
    'Đất Rừng Phương Nam',
    'Totto-chan Bên Cửa Sổ',
    'Kính Vạn Hoa tập 4',
    'Cô gái đến từ hôm qua',
    'TỦ SÁCH ĐỒNG THÁP',
    'Têrêsa Lê Ngọc Ánh',
    'Erich Kästner',
    'Señor',
]);

it('folds đ to d in the database', function () {
    expect(dbFold('Đất Rừng'))->toBe('dat rung');
});

it('is legal inside stored generated columns — the fold chain AND the hash-key shape', function () {
    // If MariaDB refuses either expression family in a generated column, we
    // must find out here — in a throwaway table — not in Task 6-10's
    // migrations. Failure here is the named trigger for the spec §4.2
    // option-2 escape hatch. The probe deliberately mirrors the real
    // shapes: a VARCHAR(36) ascii_bin operand (a CHAR(36) one is errno 1901
    // on 10.11 — the reason Global Constraints mandates VARCHAR), the
    // IF-predicate, CHAR_LENGTH, CONCAT_WS, SHA2, UNHEX, and the fold chain.
    DB::statement('DROP TABLE IF EXISTS fold_probe');
    DB::statement(sprintf(
        'CREATE TABLE fold_probe (
            id INT PRIMARY KEY,
            bookshelf_id VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
            title TEXT NOT NULL,
            deleted_at DATETIME(6) NULL,
            title_folded TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin
                GENERATED ALWAYS AS (%s) STORED,
            title_key BINARY(32) GENERATED ALWAYS AS (
                IF(deleted_at IS NULL,
                   UNHEX(SHA2(CONCAT_WS(0x1f, bookshelf_id, CHAR_LENGTH(title), title), 256)),
                   NULL)
            ) STORED,
            UNIQUE (title_key)
        )',
        FoldExpression::sql('`title`'),
    ));

    DB::table('fold_probe')->insert([
        'id' => 1, 'bookshelf_id' => str_repeat('a', 36), 'title' => 'Đất Rừng Phương Nam',
    ]);
    $row = DB::selectOne('SELECT title_folded FROM fold_probe WHERE id = 1');

    expect($row->title_folded)->toBe('dat rung phuong nam');

    // And the hash key actually enforces: a duplicate is a clean 1062.
    try {
        DB::table('fold_probe')->insert([
            'id' => 2, 'bookshelf_id' => str_repeat('a', 36), 'title' => 'Đất Rừng Phương Nam',
        ]);
        test()->fail('expected the duplicate title_key to be refused');
    } catch (QueryException $e) {
        expect($e->getCode())->toBe('23000')
            ->and($e->errorInfo[1])->toBe(1062);
    }

    DB::statement('DROP TABLE fold_probe');
});
