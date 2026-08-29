<?php

use App\Enums\CopyState;
use App\Enums\MembershipStatus;
use App\Support\Circulation\RequestRules;

it('INV-3/7: only an available copy under no live hold may be put aside', function () {
    expect(RequestRules::copyHoldable(CopyState::Available, null))->toBeNull();
});

it('a copy under a live hold is already promised — never promised twice', function () {
    // No forUserId parameter exists to compare against, deliberately: the
    // reader a hold could be "for" is not standing at the shelf. The
    // signature is the rule (the reference's copyHoldable docblock).
    expect(RequestRules::copyHoldable(CopyState::Available, 'user-a'))->toBe('no_copy_available');
});

it('an on_loan copy and a held copy both refuse with no_copy_available', function () {
    expect(RequestRules::copyHoldable(CopyState::OnLoan, null))->toBe('no_copy_available')
        ->and(RequestRules::copyHoldable(CopyState::Held, null))->toBe('no_copy_available')
        ->and(RequestRules::copyHoldable(CopyState::Held, 'user-a'))->toBe('no_copy_available');
});

it('a held copy whose hold lapsed is refused by the STATE branch, not freed in passing', function () {
    // BR §8's "if the tidy-up never runs, availability is still right" from
    // the other side: expiry presents as absence (heldForUserId null), and
    // the copy still refuses because state is held — held → available is a
    // transition somebody records, never one an approval performs en route.
    expect(RequestRules::copyHoldable(CopyState::Held, null))->toBe('no_copy_available');
});

it('INV-7: a lost or retired copy has its own sentence, and it beats the hold branch', function () {
    expect(RequestRules::copyHoldable(CopyState::Lost, null))->toBe('chosen_copy_lost_or_retired')
        ->and(RequestRules::copyHoldable(CopyState::Retired, null))->toBe('chosen_copy_lost_or_retired')
        ->and(RequestRules::copyHoldable(CopyState::Lost, 'user-a'))->toBe('chosen_copy_lost_or_retired');
});

it('INV-4: no status other than active may join a queue, in the queue\'s own words', function () {
    foreach ([MembershipStatus::Pending, MembershipStatus::Suspended, MembershipStatus::Left, MembershipStatus::Rejected] as $status) {
        expect(RequestRules::memberMayRequest($status))
            ->toBe('membership_not_active_cannot_request', "status {$status->value} should refuse");
    }
    expect(RequestRules::memberMayRequest(MembershipStatus::Active))->toBeNull();
});

it('every code the predicates can return has a Vietnamese sentence', function () {
    // The LoanRulesTest precedent: these codes are thrown as
    // `new RuleViolated($code)` with a VARIABLE, so the app/-wide literal
    // census cannot see them. This is their census. Delete
    // `no_copy_available` from lang/vi/rules.php and this test, alone,
    // goes red.
    expect(RequestRules::CODES)->toEqualCanonicalizing([
        'no_copy_available', 'chosen_copy_lost_or_retired',
        'membership_not_active_cannot_request',
    ]);

    $rules = require __DIR__.'/../../../lang/vi/rules.php';
    foreach (RequestRules::CODES as $code) {
        expect(array_key_exists($code, $rules))->toBeTrue("missing rules.{$code}")
            ->and($rules[$code])->toBeString()->not->toBe('');
    }
});
