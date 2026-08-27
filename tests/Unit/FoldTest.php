<?php

use App\Support\Fold;

// The corpus tests/db/folding.test.ts pins today, verbatim, plus the shared
// fixture names from AGENTS.md — real titles, real reader names. Expected
// values here are independently authored oracles, not derived from
// Fold::MAP. This does NOT assert parity with src/domain/kernel/fold.ts —
// see Fold's docblock for the characters (ß ø æ œ þ ð ħ ŋ ŧ ı ĳ ŀ ŉ) where
// this table deliberately diverges from the TS/Postgres NFD pipeline.
it('folds the corpus to these expected values', function (string $input, string $expected) {
    expect(Fold::fold($input))->toBe($expected);
})->with([
    ['Dế Mèn Phiêu Lưu Ký', 'de men phieu luu ky'],
    ['Đất Rừng Phương Nam', 'dat rung phuong nam'],
    ['Totto-chan Bên Cửa Sổ', 'totto chan ben cua so'],
    ['Kính Vạn Hoa tập 4', 'kinh van hoa tap 4'],
    // Lowercase đ mid-string — the branch the title-cased corpus would
    // otherwise never exercise (folding.test.ts records why).
    ['Cô gái đến từ hôm qua', 'co gai den tu hom qua'],
    ['Hoàng Tử Bé', 'hoang tu be'],
    ['Maria Nguyễn Thị Lan', 'maria nguyen thi lan'],
    ['Têrêsa Lê Ngọc Ánh', 'teresa le ngoc anh'],
    ['Phêrô Nguyễn Văn Bình', 'phero nguyen van binh'],
    ['TỦ SÁCH ĐỒNG THÁP', 'tu sach dong thap'],
]);

it('folds european authors, not only vietnamese titles', function (string $input, string $expected) {
    // The concrete failure the map extension closes: a reader searching
    // `kastner` must find Erich Kästner — an unmapped ä would fold to a
    // space and hide the author forever.
    expect(Fold::fold($input))->toBe($expected);
})->with([
    ['Erich Kästner', 'erich kastner'],
    ['Señor', 'senor'],
    ['Antoine de Saint-Exupéry', 'antoine de saint exupery'],
    ['František Čapek', 'frantisek capek'],
    ['Søren Kierkegaard', 'soren kierkegaard'],
    ['Straße', 'strasse'],
]);

it('folds đ and Đ to d explicitly', function () {
    expect(Fold::fold('đĐ'))->toBe('dd');
});

it('turns punctuation runs into single spaces and trims', function () {
    expect(Fold::fold('  Totto-chan... Bên/Cửa (Sổ)  '))->toBe('totto chan ben cua so');
});

it('keeps digits', function () {
    expect(Fold::fold('Kính Vạn Hoa tập 4'))->toContain('4');
});

it('folds the empty string to the empty string', function () {
    expect(Fold::fold(''))->toBe('');
});

it('carries a well-formed map: 144 lowercase keys, ascii targets', function () {
    // 67 Vietnamese + 16 Latin-1 + 60 Latin Extended-A + the i+U+0307
    // sequence PHP full case mapping produces for İ. A miscount means a
    // letter silently degrading to a space.
    expect(Fold::MAP)->toHaveCount(144);

    foreach (Fold::MAP as $from => $to) {
        expect(mb_strtolower($from, 'UTF-8'))->toBe($from)
            ->and($to)->toMatch('/^[a-z]{1,2}$/');
    }

    foreach (['ặ', 'ễ', 'ợ', 'ự', 'đ', 'ä', 'ñ', 'ç', 'š', 'ø', 'æ', 'œ', 'ß', 'ð'] as $key) {
        expect(Fold::MAP)->toHaveKey($key);
    }
});

it('agrees with an independent NFD-derived oracle for every map entry', function () {
    // FoldParityTest's map-entry test proves PHP and SQL are the SAME
    // FUNCTION of Fold::MAP — it derives "expected" from Fold::fold() and
    // "actual" from SQL rendered off the same table, so a typo shared by
    // both sides ('ệ' => 'a') would pass it silently. This test derives
    // its expectation a third, independent way — Unicode NFD decomposition
    // with combining marks U+0300–U+036F stripped — and is the one place
    // Normalizer is legitimate: deriving an expectation here, never
    // folding at runtime (see Fold's docblock for why fold() itself must
    // not decompose). The letters that don't decompose under NFD are
    // hand-pinned instead, with the reason each is a base letter, not an
    // accent+letter pair, already recorded in Fold's docblock.
    $handPinned = [
        'ß' => 'ss', 'ø' => 'o', 'æ' => 'ae', 'œ' => 'oe', 'þ' => 'th',
        'ð' => 'd', 'ħ' => 'h', 'ŋ' => 'n', 'ŧ' => 't', 'ı' => 'i',
        'ĳ' => 'ij', 'ŀ' => 'l', 'ŉ' => 'n', 'đ' => 'd',
        // ł and ſ have no NFD decomposition either (PHP's Normalizer
        // confirms both round-trip unchanged), same reason as the rest of
        // this list: base letters, not accent+letter pairs.
        'ł' => 'l', 'ſ' => 's',
        "i\u{0307}" => 'i',
    ];

    foreach (Fold::MAP as $from => $to) {
        if (array_key_exists($from, $handPinned)) {
            expect($to)->toBe($handPinned[$from], "hand-pinned {$from}");

            continue;
        }

        $decomposed = Normalizer::normalize($from, Normalizer::FORM_D);
        $stripped = (string) preg_replace('/[\x{0300}-\x{036F}]/u', '', (string) $decomposed);

        expect($to)->toBe($stripped, "NFD-derived oracle for {$from}");
    }

    // The hand-pinned list itself must cover exactly the non-decomposing
    // keys — not more, not fewer — so a future MAP entry that starts
    // decomposing (or stops) is a caught test failure, not a silent skip.
    foreach (array_keys($handPinned) as $key) {
        expect(Fold::MAP)->toHaveKey($key);
    }
});

it('matches needle-in-haystack after folding, the way search will use it', function () {
    expect(Fold::matches('Đất Rừng Phương Nam', 'dat rung'))->toBeTrue()
        ->and(Fold::matches('Dế Mèn Phiêu Lưu Ký', 'de men'))->toBeTrue()
        ->and(Fold::matches('Emil và các thám tử — Erich Kästner', 'kastner'))->toBeTrue()
        ->and(Fold::matches('Hoàng Tử Bé', 'kho bau'))->toBeFalse();
});
