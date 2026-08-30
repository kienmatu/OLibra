<?php

// CopyStateMachineTest's own census (tests/Unit/Catalogue/
// CopyStateMachineTest.php:68-75) hardcodes only the six codes the state
// machine itself can produce. It says nothing about the codes
// `new RuleViolated('...')` throws directly from app/Actions — far more
// of them than the state machine's six, and one more with almost every
// task (this line used to say "seven", written when there were; the
// enumeration below is the count, and it is meant to be edited) — a deleted
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
        //
        // WIDENED A SECOND TIME, the same way and with the same kind of
        // measurement. The trailing atom was `\s*\)`, which requires the
        // literal to be the ONLY argument — so the moment RuleViolated
        // gained an optional $previous, `new RuleViolated('busy_try_again',
        // $e)` (App\Support\ConcurrencyRetry, which passes the driver
        // exception through so the log keeps the SQL and the throwing
        // frames) stopped matching, and that code dropped silently out of
        // the census. `\s*[,)]` admits both shapes. Confirmed the same way
        // as the first widening: with `busy_try_again` deleted from
        // lang/vi/rules.php this test goes red under the widened regex and
        // stayed GREEN under the old one — the exact silent pass the
        // widening removes.
        preg_match_all('/new RuleViolated\(\s*[\'"]([a-z0-9_-]+)[\'"]\s*[,)]/', $contents, $matches);
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
        'announcement_fields_required',
        'audit_forbidden_field',
        'audit_nesting_too_deep',
        'busy_try_again',
        'comment_not_approved',
        'comment_not_pending',
        'comments_disabled',
        'copy_count_invalid',
        'copy_not_found',
        'donor_ambiguous',
        'donor_membership_invalid',
        'duplicate_isbn',
        'duplicate_request',
        'empty_body',
        'empty_proposal',
        'has_active_loans',
        'hold_expired',
        'hold_not_expired',
        'loan_not_active',
        'loan_not_active_cannot_void',
        'member_has_active_loans',
        'membership_not_found',
        'no_renewals_remaining',
        'not_lost',
        'not_own_request',
        'not_permitted',
        'not_suspended_cannot_reactivate',
        'password_too_short',
        'passwords_dont_match',
        'phone_invalid',
        'reason_required',
        'registration_not_pending',
        'reject_reason_required',
        'request_already_fulfilled',
        'request_not_held',
        'request_not_pending',
        'request_not_queued',
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
