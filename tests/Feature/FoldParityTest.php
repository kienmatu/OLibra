<?php

use App\Support\Fold;
use App\Support\FoldExpression;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

// dbFold() lives in tests/Pest.php — see the comment there for why.

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
    // only join an exclusion list with the reason it diverges, verified on
    // this host — not carried forward on the strength of a comment alone.
    // U+0130 (İ) was checked here and does NOT diverge on this build
    // (MariaDB 10.11.19): both dbFold("aİb") and Fold::fold("aİb") give
    // "aib", so it stays in the sweep rather than being excluded.
    for ($codepoint = 0xC0; $codepoint <= 0x24F; $codepoint++) {
        $char = mb_chr($codepoint, 'UTF-8');

        expect(dbFold("a{$char}b"))->toBe(Fold::fold("a{$char}b"), sprintf('U+%04X', $codepoint));
    }
});

it('agrees with php across U+1E00–U+1EFF, the Latin Extended Additional block', function () {
    // Latin Extended Additional is the Vietnamese-heavy block (à Vietnamese
    // tone/quality marks live at U+1EA0 and up) — but it is also where a
    // real store≠search bug was found and missed by the U+00C0–U+024F
    // sweep above: U+1E9E (ẞ, capital sharp S). mb_strtolower('ẞ') is 'ß'
    // (reaching Fold::MAP's 'ß' entry after PHP's lowering), but MariaDB's
    // LOWER('ẞ') is 'ẞ' UNCHANGED on this build (confirmed on 10.11.19),
    // so the SQL side never reached the same MAP entry and instead fell
    // through to a space. This sweep is what should have caught it, and a
    // mutation run (reverting the 'ẞ' => 'ss' entry from Fold::MAP) proves
    // it does — see the fix's commit history / task report for that run.
    //
    // Also present in this range and NOT excluded: U+1EFA/1EFC/1EFE
    // (Ỻ ỽ Ỿ — obsolete Middle Welsh letters), where MariaDB's LOWER() also
    // disagrees with PHP but neither side's result is a Fold::MAP key, so
    // both halves fall through to the same unmapped-to-space bucket and
    // the sweep passes for them without needing an exclusion.
    for ($codepoint = 0x1E00; $codepoint <= 0x1EFF; $codepoint++) {
        $char = mb_chr($codepoint, 'UTF-8');

        expect(dbFold("a{$char}b"))->toBe(Fold::fold("a{$char}b"), sprintf('U+%04X', $codepoint));
    }
});

it('agrees with php when a synthesised i+combining-dot-above sequence is present', function () {
    // Regression for the bug the property tests above cannot see: Fold::MAP
    // has one multi-code-point key, "i"+U+0307, and twelve single-character
    // entries targeting plain ASCII "i" (ì í ỉ ĩ ị î ï ī ĭ į ı). Fold::fold()
    // uses strtr() — a single simultaneous pass that never re-scans its own
    // output — so it only ever matches "i"+U+0307 where the input already
    // has literal "i" followed by that combining mark; it will never treat
    // ị (U+1ECB) + U+0307 as "i"+U+0307, because ị is not "i". A naively
    // ordered REPLACE chain gets this wrong: if ị→i fires before the
    // "i"+U+0307 entry, it manufactures the exact sequence that later
    // REPLACE then also matches, collapsing "xị̇x" to "xix" instead of
    // "xi x" and breaking store==search for any title containing this
    // (rare but real — decomposed-Unicode input) sequence.
    //
    // Neither sweep above can catch this: the map-entry test only ever
    // embeds ONE map key per string, and the code-point sweep only ever
    // embeds ONE plain code point — this needs two adjacent code points,
    // one of which is itself a MAP target, to exhibit the bug.
    $withPrecomposedI = "x\u{1ECB}\u{0307}x"; // x + ị + combining dot above + x
    $withDottedlessI = "x\u{0131}\u{0307}x"; // x + ı + combining dot above + x

    expect(dbFold($withPrecomposedI))->toBe(Fold::fold($withPrecomposedI), 'ị + U+0307');
    expect(dbFold($withDottedlessI))->toBe(Fold::fold($withDottedlessI), 'ı + U+0307');
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

it('is legal inside stored generated columns — the fold chain (twice) AND the hash-key shape', function () {
    // If MariaDB refuses either expression family in a generated column, we
    // must find out here — in a throwaway table — not in Task 6-10's
    // migrations. Failure here is the named trigger for the spec §4.2
    // option-2 escape hatch. The probe deliberately mirrors the real
    // shapes: a VARCHAR(36) ascii_bin operand (a CHAR(36) one is errno 1901
    // on 10.11 — the reason Global Constraints mandates VARCHAR), the
    // IF-predicate, CHAR_LENGTH, CONCAT_WS, SHA2, UNHEX, and TWO fold
    // chains — Task 7's books table generates both title_folded and
    // author_folded, roughly 6 KB of expression combined, not the ~3 KB a
    // single-column probe would rehearse.
    //
    // CREATE TABLE / DROP TABLE implicitly commit in MariaDB, so this test
    // runs outside the RefreshDatabase transaction the rest of the Feature
    // suite relies on for isolation — the try/finally below is what keeps a
    // mid-test failure from leaving fold_probe behind for the next run.
    DB::statement('DROP TABLE IF EXISTS fold_probe');

    try {
        DB::statement(sprintf(
            'CREATE TABLE fold_probe (
                id INT PRIMARY KEY,
                bookshelf_id VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
                title TEXT NOT NULL,
                author TEXT NOT NULL,
                deleted_at DATETIME(6) NULL,
                title_folded TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin
                    GENERATED ALWAYS AS (%s) STORED,
                author_folded TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin
                    GENERATED ALWAYS AS (%s) STORED,
                title_key BINARY(32) GENERATED ALWAYS AS (
                    IF(deleted_at IS NULL,
                       UNHEX(SHA2(CONCAT_WS(0x1f, bookshelf_id, CHAR_LENGTH(title), title), 256)),
                       NULL)
                ) STORED,
                UNIQUE (title_key)
            )',
            FoldExpression::sql('`title`'),
            FoldExpression::sql('`author`'),
        ));

        DB::table('fold_probe')->insert([
            'id' => 1, 'bookshelf_id' => str_repeat('a', 36),
            'title' => 'Đất Rừng Phương Nam', 'author' => 'Erich Kästner',
        ]);
        $row = DB::selectOne('SELECT title_folded, author_folded FROM fold_probe WHERE id = 1');

        expect($row->title_folded)->toBe('dat rung phuong nam')
            ->and($row->author_folded)->toBe('erich kastner');

        // And the hash key actually enforces: a duplicate is a clean 1062.
        try {
            DB::table('fold_probe')->insert([
                'id' => 2, 'bookshelf_id' => str_repeat('a', 36),
                'title' => 'Đất Rừng Phương Nam', 'author' => 'Erich Kästner',
            ]);
            test()->fail('expected the duplicate title_key to be refused');
        } catch (QueryException $e) {
            expect($e->getCode())->toBe('23000')
                ->and($e->errorInfo[1])->toBe(1062);
        }
    } finally {
        DB::statement('DROP TABLE IF EXISTS fold_probe');
    }
});
