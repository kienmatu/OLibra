<?php

use App\Support\Fold;

// The corpus tests/db/folding.test.ts pins today, verbatim, plus the shared
// fixture names from AGENTS.md — real titles, real reader names.
it('folds the corpus exactly as src/domain/kernel/fold.ts does', function (string $input, string $expected) {
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

it('matches needle-in-haystack after folding, the way search will use it', function () {
    expect(Fold::matches('Đất Rừng Phương Nam', 'dat rung'))->toBeTrue()
        ->and(Fold::matches('Dế Mèn Phiêu Lưu Ký', 'de men'))->toBeTrue()
        ->and(Fold::matches('Emil và các thám tử — Erich Kästner', 'kastner'))->toBeTrue()
        ->and(Fold::matches('Hoàng Tử Bé', 'kho bau'))->toBeFalse();
});
