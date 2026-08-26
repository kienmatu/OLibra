<?php

use App\Support\Fold;
use App\Support\FoldExpression;

it('wraps the target expression in lower, the replace chain, regexp and trim', function () {
    $sql = FoldExpression::sql('`title`');

    expect($sql)->toStartWith('TRIM(REGEXP_REPLACE(')
        ->and($sql)->toContain('LOWER(`title`)')
        ->and($sql)->toContain("'đ', 'd'")
        ->and($sql)->toContain("'ä', 'a'")
        ->and($sql)->toEndWith("'[^a-z0-9]+', ' '))");
});

it('nests exactly one replace per Fold::MAP entry — one table, two renderings', function () {
    // A plain substr_count('REPLACE(') would also match the REPLACE( that
    // is a substring of REGEXP_REPLACE(, over-counting by one; the negative
    // lookbehind on the preceding underscore excludes that occurrence.
    expect(preg_match_all('/(?<!_)REPLACE\(/', FoldExpression::sql('`title`')))
        ->toBe(count(Fold::MAP));
});
