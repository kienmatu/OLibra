<?php

use App\Enums\CopyState;
use App\Enums\MembershipStatus;
use App\Support\Circulation\LoanRules;

it('INV-3: an available copy is lendable to anyone', function () {
    expect(LoanRules::copyLendable(CopyState::Available, null, 'user-a'))->toBeNull();
});

it('INV-3: a held copy is lendable only to its holder', function () {
    expect(LoanRules::copyLendable(CopyState::Held, 'user-a', 'user-a'))->toBeNull()
        ->and(LoanRules::copyLendable(CopyState::Held, 'user-a', 'user-b'))->toBe('copy_not_available');
});

it('INV-3: a held copy with an expired hold is nobody\'s to collect', function () {
    // Expiry presents as absence: the caller reads the holder through a
    // hold_expires_at > now filter (Phase 2), so a lapsed hold arrives as
    // null — and null must not match any reader, its own ex-holder included.
    expect(LoanRules::copyLendable(CopyState::Held, null, 'user-a'))->toBe('copy_not_available');
});

it('INV-3: a copy already on loan is not lendable, even to a hold-holder', function () {
    // The reference's measured guard: an on_loan copy with a live hold naming
    // this reader still refuses — the book is in another child's hands, and a
    // predicate rescued by INV-1's index after the fact is still wrong.
    expect(LoanRules::copyLendable(CopyState::OnLoan, null, 'user-a'))->toBe('copy_not_available')
        ->and(LoanRules::copyLendable(CopyState::OnLoan, 'user-a', 'user-a'))->toBe('copy_not_available');
});

it('INV-7: a lost or retired copy is never lendable', function () {
    expect(LoanRules::copyLendable(CopyState::Lost, null, 'user-a'))->toBe('copy_lost_or_retired')
        ->and(LoanRules::copyLendable(CopyState::Retired, null, 'user-a'))->toBe('copy_lost_or_retired');
});

it('INV-7 over INV-3: a lost copy someone holds still reads as lost', function () {
    expect(LoanRules::copyLendable(CopyState::Lost, 'user-a', 'user-a'))->toBe('copy_lost_or_retired');
});

it('INV-4: no status other than active may start a new loan', function () {
    foreach ([MembershipStatus::Pending, MembershipStatus::Suspended, MembershipStatus::Left, MembershipStatus::Rejected] as $status) {
        expect(LoanRules::memberMayBorrow($status, 0, 3))
            ->toBe('membership_not_active', "status {$status->value} should refuse");
    }
    expect(LoanRules::memberMayBorrow(MembershipStatus::Active, 0, 3))->toBeNull();
});

it('INV-4 before INV-5: a suspended reader at the limit hears about the suspension', function () {
    expect(LoanRules::memberMayBorrow(MembershipStatus::Suspended, 5, 3))->toBe('membership_not_active');
});

it('INV-5: the boundary is at the limit, not one past it', function () {
    expect(LoanRules::memberMayBorrow(MembershipStatus::Active, 2, 3))->toBeNull()
        ->and(LoanRules::memberMayBorrow(MembershipStatus::Active, 3, 3))->toBe('loan_limit_reached')
        ->and(LoanRules::memberMayBorrow(MembershipStatus::Active, 4, 3))->toBe('loan_limit_reached');
});

it('INV-5: the limit is the shelf\'s, not a constant', function () {
    expect(LoanRules::memberMayBorrow(MembershipStatus::Active, 3, 5))->toBeNull()
        ->and(LoanRules::memberMayBorrow(MembershipStatus::Active, 1, 1))->toBe('loan_limit_reached');
});

it('INV-6: renewals first, then the queue — the order decides which sentence a reader gets', function () {
    expect(LoanRules::loanRenewable(0, 1, false))->toBeNull()
        ->and(LoanRules::loanRenewable(1, 1, false))->toBe('no_renewals_remaining')
        ->and(LoanRules::loanRenewable(0, 1, true))->toBe('title_has_queue')
        // Both true: the renewals sentence wins — it is the one that stays
        // true tomorrow (the reference's stated ordering argument).
        ->and(LoanRules::loanRenewable(1, 1, true))->toBe('no_renewals_remaining');
});

it('every code the predicates can return has a Vietnamese sentence', function () {
    // The CopyStateMachineTest precedent: these codes are thrown as
    // `new RuleViolated($code)` with a VARIABLE, so the app/-wide literal
    // census (RuleViolatedCodesHaveSentencesTest) cannot see them. This is
    // their census. Delete `title_has_queue` from lang/vi/rules.php and
    // this test, alone, goes red.
    expect(LoanRules::CODES)->toEqualCanonicalizing([
        'copy_lost_or_retired', 'copy_not_available',
        'membership_not_active', 'loan_limit_reached',
        'no_renewals_remaining', 'title_has_queue',
    ]);

    $rules = require __DIR__.'/../../../lang/vi/rules.php';
    foreach (LoanRules::CODES as $code) {
        expect(array_key_exists($code, $rules))->toBeTrue("missing rules.{$code}")
            ->and($rules[$code])->toBeString()->not->toBe('');
    }
});
