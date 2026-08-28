<?php

use App\Exceptions\RuleViolated;
use App\Support\Members\ProfileFields;

it('keeps only the nine known fields and folds blank to null', function () {
    $patch = ProfileFields::normalisePatch([
        'phone' => '  0912345678 ', 'email' => '   ',
        'is_super_admin' => '1', 'username' => 'hacker', 'role' => 'admin',
    ]);

    expect($patch)->toBe(['phone' => '0912345678', 'email' => null]);
});

it('refuses blanking a required field by name, not by constraint', function () {
    foreach (ProfileFields::REQUIRED as $field) {
        expect(fn () => ProfileFields::normalisePatch([$field => '  ']))
            ->toThrow(RuleViolated::class, 'required_fields_missing');
    }
    expect(ProfileFields::REQUIRED)->toBe(['saint_name', 'full_name', 'father_name', 'mother_name']);
});

it('refuses a malformed or impossible date, allows clearing it', function () {
    expect(fn () => ProfileFields::normalisePatch(['date_of_birth' => '02/04/2015']))
        ->toThrow(RuleViolated::class, 'validation_failed')
        ->and(fn () => ProfileFields::normalisePatch(['date_of_birth' => '2015-02-30']))
        ->toThrow(RuleViolated::class, 'validation_failed')
        ->and(ProfileFields::normalisePatch(['date_of_birth' => '  ']))->toBe(['date_of_birth' => null])
        ->and(ProfileFields::normalisePatch(['date_of_birth' => '2016-02-29']))->toBe(['date_of_birth' => '2016-02-29']);
});

it('refuses a malformed phone, allows clearing it', function () {
    expect(fn () => ProfileFields::normalisePatch(['phone' => 'khong-phai-so']))
        ->toThrow(RuleViolated::class, 'phone_invalid')
        ->and(ProfileFields::normalisePatch(['phone' => ' ']))->toBe(['phone' => null]);
});

it('diff reports only what changed, absent keys untouched', function () {
    $result = ProfileFields::diff(
        ['phone' => '0911111111', 'email' => null, 'full_name' => 'Nguyễn Thị Lan'],
        ['phone' => '0922222222', 'email' => null, 'full_name' => 'Nguyễn Thị Lan'],
    );

    expect($result['changed'])->toBe(['phone'])
        ->and($result['before'])->toBe(['phone' => '0911111111'])
        ->and($result['after'])->toBe(['phone' => '0922222222']);
});
