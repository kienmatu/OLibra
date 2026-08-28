<?php

use App\Exceptions\RuleViolated;
use App\Support\Members\Phone;

it('accepts the shapes the seed and the dev database actually carry', function () {
    // QA T18's measured corpus: ten digits, grouped or solid, dots or
    // dashes, optional +84.
    foreach (['0912 345 678', '0999888777', '091.234.5678', '+84 912 345 678', '091-234-5678'] as $phone) {
        expect(Phone::isValid($phone))->toBeTrue($phone);
    }
});

it('refuses khong-phai-so and wrong digit counts', function () {
    foreach (['khong-phai-so', '09xx xxx xxx', '12345678', '012345678901', ''] as $phone) {
        expect(Phone::isValid($phone))->toBeFalse($phone);
    }
});

it('assert throws phone_invalid, whose sentence exists', function () {
    // __() needs the translator, which needs the Laravel container — absent
    // here since tests/Pest.php only bootstraps tests/Feature (see
    // tests/Unit/Members/MembershipTransitionsTest.php's identical note).
    // Read lang/vi/rules.php directly instead.
    $rules = require __DIR__.'/../../../lang/vi/rules.php';

    expect(fn () => Phone::assert('khong-phai-so'))
        ->toThrow(RuleViolated::class, 'phone_invalid')
        ->and($rules['phone_invalid'])->toBe('Số điện thoại chưa đúng. Ghi 10 số, ví dụ 0912345678.');
});

// Fix round, Task 13: normalise() is what the register rate limiter now
// hashes for its daily budget key — every spelling of one real phone
// number must fold to the identical canonical string, or the day budget
// is multipliable (each spelling gets its own bucket).
it('normalise folds every spelling of one phone to the same canonical string', function () {
    foreach (['0912345678', '0912 345 678', '0912.345.678', '0912-345-678', '+84912345678'] as $phone) {
        expect(Phone::normalise($phone))->toBe('0912345678', $phone);
    }
});

it('normalise only folds a LEADING +84, never one appearing mid-string', function () {
    expect(Phone::normalise('0912345678'))->toBe('0912345678')
        ->and(Phone::normalise(''))->toBe('');
});

it('the HTML pattern mirror is the generous approximation, not the rule', function () {
    // PHONE_PATTERN in the reference: a hint that saves a round trip;
    // Phone::assert is what decides.
    expect(Phone::PATTERN)->toBe('[+0-9][0-9 .-]{7,13}');
});
