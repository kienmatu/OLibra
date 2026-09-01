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
        'already_published',
        'already_registered_here',
        // 3b-i Task 7: promoting somebody who already holds the global
        // grant (spec D5).
        'already_super_admin',
        'announcement_fields_required',
        'audit_forbidden_field',
        'audit_nesting_too_deep',
        'busy_try_again',
        // 3b-ii Task 3: archiving a thể loại that live books still carry
        // (spec D3). The reference's own code, and the guard is the only
        // thing protecting those books' labels — the soft delete never
        // fires the schema's ON DELETE SET NULL.
        'category_in_use',
        // 3c-i Task 2: NOT the second-proposal guard — a second proposal at
        // this shelf merges into the pending row. This is the cross-shelf
        // case the tenant-scoped SELECT cannot see, caught off the
        // generated pending_user_id column's global unique index.
        'change_already_pending',
        'comment_not_approved',
        'comment_not_pending',
        'comments_disabled',
        // 3b-i Task 5: the shelf editor's contacts form refusing a save that
        // would leave the shelf with no first contact (spec D3).
        'contact_position_1_required',
        'copy_count_invalid',
        'copy_not_found',
        'copy_selection_empty',
        // 3c-i Task 7, spec D12: the current-password check on
        // ChangeOwnPassword. Its own code rather than a shared
        // 'not_permitted' — the caller is permitted, they mistyped.
        'current_password_incorrect',
        'donation_not_pending',
        'donor_ambiguous',
        'donor_membership_invalid',
        // 3b-ii Task 3: a name whose derived slug is already taken —
        // including by an archived thể loại, because categories.slug is
        // unique with no soft-delete partition.
        'duplicate_category',
        'duplicate_isbn',
        'duplicate_request',
        'empty_body',
        'empty_description',
        'empty_proposal',
        // 3c-i Task 8, spec D6: the photograph's byte cap, 5 MiB. Raised by
        // App\Support\Members\AvatarStorage before anything is stored.
        'file_too_large',
        'has_active_loans',
        // 3c-i Task 8, spec D6: a real photograph in a codec this server
        // cannot open. A SEPARATE code from 'invalid_image' on purpose —
        // see lang/vi/rules.php, where the two sentences say different
        // things because the two situations are different.
        'heic_not_supported',
        'hold_expired',
        'hold_not_expired',
        // 3c-i Task 8, spec D6: a DECODE failure, raised from
        // App\Support\Members\AvatarImage's own catch. Not a content-type
        // mismatch — the content-type-only version of this gate was the
        // earlier and weaker design.
        'invalid_image',
        'loan_not_active',
        'loan_not_active_cannot_void',
        'member_has_active_loans',
        'membership_not_found',
        // 3c-i Task 7: the NEW password's length, kept distinct from
        // SetReaderCredentials' 'password_too_short' so a form carrying two
        // password boxes can say which one is wrong.
        'new_password_too_short',
        'no_renewals_remaining',
        // 3b-i Task 7: revoking a grant from somebody who is already a
        // reader. A code of its own rather than the reference's shared
        // 'not_permitted' — see RevokeManager for why that sentence would
        // be a false statement about the actor.
        'not_a_manager',
        'not_lost',
        'not_own_request',
        'not_permitted',
        'not_suspended_cannot_reactivate',
        // 3b-ii Task 5: ReorderParishUnits, for an id in the posted sibling
        // group that resolves to no live unit of this shelf (spec D5). Both
        // sentences already existed in lang/vi/rules.php — ParishUnits::
        // validateSelection() has RETURNED these two codes as data since
        // Phase 1b — but nothing in app/ had ever THROWN either as a
        // literal, so neither appeared in this census until now. The level
        // decides which: every id that resolved shares one level, so that
        // level is the best guess at the missing one's, and level 1's
        // sentence is the fallback when nothing resolved at all.
        'parish_unit_l1_not_found',
        'parish_unit_l2_not_found',
        'password_too_short',
        'passwords_dont_match',
        'phone_invalid',
        // 3c-i Task 3: the re-read under the decide lock (spec D3). Not a
        // not-found — the row is there, it has simply already been decided
        // or withdrawn since the manager opened the card.
        'profile_change_not_pending',
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
