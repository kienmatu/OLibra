<?php

// CopyStateMachineTest's own census (tests/Unit/Catalogue/
// CopyStateMachineTest.php:68-75) hardcodes only the six codes the state
// machine itself can produce. It says nothing about the seven other codes
// `new RuleViolated('...')` throws directly from app/Actions — a deleted
// sentence there leaves the whole suite green and a manager reading the
// literal key "rules.copy_count_invalid" instead of a sentence, against BR
// §2's "errors are named, not generic; a plain message, in Vietnamese."
//
// This globs every literal `new RuleViolated('code')` call under app/ —
// not CopyStateMachine's own `throw new RuleViolated($reason)`, which is a
// variable, not a literal, and already fully enumerated by
// CopyStateMachineTest — and checks each code against lang/vi/rules.php.
// A code minted here with no rules.php entry is exactly the regression this
// pins: delete `copy_count_invalid`'s line from lang/vi/rules.php and this
// test, alone, goes red.

it('every literal RuleViolated code thrown from app/ has a Vietnamese sentence', function () {
    $files = (new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator(__DIR__.'/../../../app', FilesystemIterator::SKIP_DOTS)
    ));

    $codes = [];
    foreach ($files as $file) {
        if (! str_ends_with($file->getPathname(), '.php')) {
            continue;
        }

        $contents = file_get_contents($file->getPathname());
        // [a-z0-9_-]+, not [a-z0-9_]+: thieu-so-dien-thoai (Registration.php)
        // is the one hyphenated code in the system, and the un-widened
        // regex could not match it — a census whose entire job is pinning
        // that every code has a sentence was blind to this one. Confirmed
        // by deleting `thieu-so-dien-thoai`'s lang/vi/rules.php line: with
        // the old regex the suite stayed green; with this one it goes red.
        preg_match_all('/new RuleViolated\(\s*[\'"]([a-z0-9_-]+)[\'"]\s*\)/', $contents, $matches);
        foreach ($matches[1] as $code) {
            $codes[$code] = true;
        }
    }

    // A change here (a code renamed, added or removed in app/) is meant to
    // be noticed — this is not a magic-number tautology, it is the list the
    // glob is expected to find today, so a widening or narrowing of that
    // list is a deliberate edit to this test, not a silent pass either way.
    expect(array_keys($codes))->toEqualCanonicalizing([
        'already_registered_here',
        'copy_count_invalid',
        'donor_ambiguous',
        'donor_membership_invalid',
        'duplicate_isbn',
        'empty_proposal',
        'has_active_loans',
        'loan_not_active',
        'loan_not_active_cannot_void',
        'member_has_active_loans',
        'membership_not_found',
        'no_renewals_remaining',
        'not_lost',
        'not_permitted',
        'not_suspended_cannot_reactivate',
        'password_too_short',
        'passwords_dont_match',
        'phone_invalid',
        'reason_required',
        'registration_not_pending',
        'reject_reason_required',
        'required_fields_missing',
        'retire_reason_required',
        'shelf_not_found',
        'thieu-so-dien-thoai',
        'username_in_use',
        'username_taken',
        'validation_failed',
    ]);

    $rules = require __DIR__.'/../../../lang/vi/rules.php';

    foreach (array_keys($codes) as $code) {
        expect(array_key_exists($code, $rules))->toBeTrue("missing rules.{$code}")
            ->and($rules[$code])->toBeString()->not->toBe('');
    }
});
