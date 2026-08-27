<?php

use App\Support\Catalogue\CopyCodes;

it('derives DT from dong-thap, and every other fixture shelf', function () {
    // The reference's own fixture table (copyCodePrefix's docstring).
    expect(CopyCodes::prefix('dong-thap', null))->toBe('DT')
        ->and(CopyCodes::prefix('can-tho', null))->toBe('CT')
        ->and(CopyCodes::prefix('ben-tre', null))->toBe('BT')
        ->and(CopyCodes::prefix('vinh-long', null))->toBe('VL');
});

it('caps a many-word slug at three initials', function () {
    expect(CopyCodes::prefix('nha-tho-duc-ba-sai-gon', null))->toBe('NTD');
});

it('a one-word slug still yields two characters, and settings can override', function () {
    expect(CopyCodes::prefix('emmaus', null))->toBe('EM')
        ->and(CopyCodes::prefix('dong-thap', ['copy_code_prefix' => 'kho1']))->toBe('KHO1')
        ->and(CopyCodes::prefix('dong-thap', ['copy_code_prefix' => '  ']))->toBe('DT');
});

it('formats to four digits and never truncates', function () {
    expect(CopyCodes::format('DT', 215))->toBe('DT-0215')
        ->and(CopyCodes::format('DT', 1))->toBe('DT-0001')
        // lpad('10000', 4) would truncate to '1000' and collide with the
        // thousandth copy — the reference's own docstring case.
        ->and(CopyCodes::format('DT', 10000))->toBe('DT-10000');
});

it('escapes %, _ and backslash for a LIKE pattern', function () {
    expect(CopyCodes::escapeLike('KHO_1'))->toBe('KHO\_1')
        ->and(CopyCodes::escapeLike('100%'))->toBe('100\%')
        ->and(CopyCodes::escapeLike('a\b'))->toBe('a\\\\b');
});
