<?php

use App\Support\Members\NameSimilarity;

it('reproduces pg_trgm\'s measured value for the reference\'s own example', function () {
    // get-pending-registrations.ts's comment: similarity('tran minh',
    // 'tran minh duc') -> 0.714, verified live against pg_trgm 1.6.
    // The trigram sets: 10 shared, 14 in the union -> 10/14.
    expect(NameSimilarity::similarity('Trần Minh', 'Trần Minh Đức'))
        ->toEqualWithDelta(10 / 14, 0.0001);
});

it('folds before comparing, so diacritics never separate two spellings', function () {
    expect(NameSimilarity::similarity('Trần Minh', 'Tran Minh'))->toBe(1.0);
});

it('is symmetric, 1.0 for identical, low for unrelated', function () {
    $a = NameSimilarity::similarity('Nguyễn Thị Lan', 'Nguyen Thi Lan Anh');

    expect($a)->toBe(NameSimilarity::similarity('Nguyen Thi Lan Anh', 'Nguyễn Thị Lan'))
        ->and(NameSimilarity::similarity('Nguyễn Thị Lan', 'Nguyễn Thị Lan'))->toBe(1.0)
        ->and(NameSimilarity::similarity('Nguyễn Thị Lan', 'Phêrô Hoàng Bách'))->toBeLessThan(NameSimilarity::THRESHOLD);
});

it('empty or symbol-only input scores zero rather than dividing by nothing', function () {
    expect(NameSimilarity::similarity('', 'Trần Minh'))->toBe(0.0)
        ->and(NameSimilarity::similarity('***', '///'))->toBe(0.0);
});

it('pins the 0.6 threshold literally, with a pair on each side close enough that a shift flips them', function () {
    // Mutation-testing anchor. Comparing against `NameSimilarity::THRESHOLD`
    // itself would be circular — changing the constant would move both the
    // assertion and the code under test together, and this test would stay
    // green. So the boundary (0.6) is hard-coded here, and both example
    // pairs are measured (via this class itself, values checked by hand)
    // to sit close enough to it — 0.5625 and 0.625 — that nudging THRESHOLD
    // to 0.5 or 0.7 flips one of the two `>=` comparisons below.
    expect(NameSimilarity::THRESHOLD)->toBe(0.6);

    // "Bùi Văn Sơn" vs "Bùi Văn Sang": 0.5625, just under the line — no
    // warning should fire for this pair.
    expect(NameSimilarity::similarity('Bùi Văn Sơn', 'Bùi Văn Sang'))
        ->toEqualWithDelta(0.5625, 0.0001)
        ->toBeLessThan(0.6);

    // "Cao Thị Ngọc" vs "Cao Thị Ngân": 0.625, just over the line — a
    // warning should fire for this pair.
    expect(NameSimilarity::similarity('Cao Thị Ngọc', 'Cao Thị Ngân'))
        ->toEqualWithDelta(0.625, 0.0001)
        ->toBeGreaterThanOrEqual(0.6);
});
