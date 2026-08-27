<?php

use App\Exceptions\RuleViolated;
use App\Support\Catalogue\Donor;

it('QA remediation Task 19: refuses when both a member and a free-text name are set', function () {
    expect(fn () => Donor::assertSingle('m0000000-0000-7000-8000-000000000001', 'bác Hoà'))
        ->toThrow(RuleViolated::class, 'donor_ambiguous');
});

it('accepts either one alone', function () {
    Donor::assertSingle('m0000000-0000-7000-8000-000000000001', null);
    Donor::assertSingle(null, 'bác Hoà');

    expect(true)->toBeTrue();
});

it('accepts both blank — most books are bought, not donated', function () {
    Donor::assertSingle(null, null);
    Donor::assertSingle('', '   ');

    expect(true)->toBeTrue();
});

it('treats whitespace-only as blank on both sides', function () {
    // A membership id is never whitespace in practice, but the blank()
    // check must not special-case which argument it is applied to.
    Donor::assertSingle('   ', 'bác Hoà');

    expect(fn () => Donor::assertSingle('m0000000-0000-7000-8000-000000000001', '   '))
        ->not->toThrow(RuleViolated::class);
});
