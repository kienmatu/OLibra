<?php

use App\Enums\CopyState;
use App\Exceptions\RuleViolated;
use App\Support\Catalogue\CopyStateMachine;

it('is BR §7.1\'s table, arrow for arrow', function () {
    $allowed = [
        [CopyState::Available, CopyState::Held],
        [CopyState::Available, CopyState::OnLoan],
        [CopyState::Available, CopyState::Retired],
        [CopyState::Held, CopyState::Available],
        [CopyState::Held, CopyState::OnLoan],
        [CopyState::OnLoan, CopyState::Available],
        [CopyState::OnLoan, CopyState::Lost],
        [CopyState::Lost, CopyState::Available],
        [CopyState::Lost, CopyState::Retired],
    ];

    $states = CopyState::cases();
    foreach ($states as $from) {
        foreach ($states as $to) {
            $isDrawn = collect($allowed)->contains(fn ($arrow) => $arrow === [$from, $to]);
            $verdict = CopyStateMachine::check($from, $to);
            expect($verdict === null)->toBe($isDrawn, "{$from->value} -> {$to->value}");
        }
    }
});

it('Q3: an available copy cannot be reported lost, and says why', function () {
    expect(CopyStateMachine::check(CopyState::Available, CopyState::Lost))->toBe('copy_not_on_loan')
        ->and(CopyStateMachine::check(CopyState::Held, CopyState::Lost))->toBe('copy_not_on_loan');
});

it('a copy on loan cannot be retired, and names the way out', function () {
    expect(CopyStateMachine::check(CopyState::OnLoan, CopyState::Retired))->toBe('copy_on_loan');
});

it('a held copy cannot be retired either, with the generic refusal', function () {
    expect(CopyStateMachine::check(CopyState::Held, CopyState::Retired))->toBe('copy_not_available');
});

it('the terminal and repeated states each get their own reason', function () {
    expect(CopyStateMachine::check(CopyState::Retired, CopyState::Available))->toBe('already_retired')
        ->and(CopyStateMachine::check(CopyState::Retired, CopyState::Lost))->toBe('already_retired')
        ->and(CopyStateMachine::check(CopyState::Lost, CopyState::OnLoan))->toBe('already_lost')
        ->and(CopyStateMachine::check(CopyState::Lost, CopyState::Held))->toBe('already_lost');
});

it('INV-7: a lost or retired copy cannot be lent or held', function () {
    foreach ([CopyState::Lost, CopyState::Retired] as $from) {
        foreach ([CopyState::OnLoan, CopyState::Held] as $to) {
            expect(CopyStateMachine::check($from, $to))->not->toBeNull("{$from->value} -> {$to->value}");
        }
    }
});

it('marking found when the copy is not lost refuses with not_lost', function () {
    expect(CopyStateMachine::check(CopyState::OnLoan, CopyState::Available))->toBeNull() // return path — allowed
        ->and(CopyStateMachine::check(CopyState::Available, CopyState::Available))->toBe('not_lost');
});

it('assert throws RuleViolated carrying the refusal code', function () {
    expect(fn () => CopyStateMachine::assert(CopyState::OnLoan, CopyState::Retired))
        ->toThrow(RuleViolated::class, 'copy_on_loan');
});

it('every refusal code the machine can produce has a Vietnamese sentence', function () {
    // A code with no rules.php entry renders as the literal "rules.<code>".
    $codes = ['already_retired', 'already_lost', 'copy_not_on_loan', 'copy_on_loan', 'copy_not_available', 'not_lost'];
    $rules = require __DIR__.'/../../../lang/vi/rules.php';
    foreach ($codes as $code) {
        expect(array_key_exists($code, $rules))->toBeTrue("missing rules.{$code}");
    }
});
