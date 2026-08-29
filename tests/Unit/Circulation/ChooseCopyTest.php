<?php

use App\Enums\CopyState;
use App\Models\BookCopy;
use App\Support\Circulation\ChooseCopy;

function ccCopy(string $code, CopyState $state): BookCopy
{
    // Deviation from the brief's literal `new BookCopy(['code' => ...])`:
    // tests/Unit has no Laravel container (AGENTS.md's own trap list), and
    // BookCopy::$guarded = ['code_key'] is a partial guard list, so
    // Model::isFillable('code') falls through to isGuardableColumn(),
    // which calls $this->getConnection()->getSchemaBuilder() to introspect
    // the column — `code` has no cast and no set-mutator, so it cannot
    // short-circuit that check the way `state` (CopyState-cast) does.
    // With no container bound, getConnection() is null and this throws
    // "Call to a member function connection() on null" before the test
    // body ever runs. forceFill() takes the same code path as the plain
    // constructor for everything ChooseCopy reads (code, state) but wraps
    // it in Model::unguarded(), which short-circuits isFillable() before
    // it ever reaches the schema lookup — no behaviour differs for this
    // test, only the guard check is skipped.
    return (new BookCopy)->forceFill(['code' => $code, 'state' => $state]);
}

it('picks the lowest-code lendable copy, so step 2 and step 3 name the same physical book', function () {
    $result = ChooseCopy::lowestLendable(collect([
        ccCopy('DT-0003', CopyState::Available),
        ccCopy('DT-0001', CopyState::OnLoan),
        ccCopy('DT-0002', CopyState::Available),
    ]));

    expect($result['copy']?->code)->toBe('DT-0002')
        ->and($result['reason'])->toBeNull();
});

it('every copy out reads copy_not_available; every copy gone reads copy_lost_or_retired', function () {
    $out = ChooseCopy::lowestLendable(collect([
        ccCopy('DT-0001', CopyState::OnLoan), ccCopy('DT-0002', CopyState::Held),
    ]));
    $gone = ChooseCopy::lowestLendable(collect([
        ccCopy('DT-0001', CopyState::Lost), ccCopy('DT-0002', CopyState::Retired),
    ]));

    expect($out['copy'])->toBeNull()->and($out['reason'])->toBe('copy_not_available')
        ->and($gone['copy'])->toBeNull()->and($gone['reason'])->toBe('copy_lost_or_retired');
});

it('a title with no copies reads title_has_no_copies, not the on-loan-or-held sentence', function () {
    // Settled decision 4. The reference folded this case into
    // copy_not_available and so told a volunteer a title the shelf has
    // never held a copy of was "đang được mượn hoặc đang giữ chỗ." The
    // owner ruled that out. Revert this branch and this test alone goes
    // red — the sentence is the whole point, so it is asserted too.
    $result = ChooseCopy::lowestLendable(collect([]));

    expect($result['copy'])->toBeNull()
        ->and($result['reason'])->toBe('title_has_no_copies')
        ->and($result['reason'])->not->toBe('copy_not_available');
});

it('the copyless-title code has a Vietnamese sentence — its census lives here', function () {
    // title_has_no_copies is RETURNED as data, never thrown as
    // `new RuleViolated('title_has_no_copies')`, so the app/-wide literal
    // census (RuleViolatedCodesHaveSentencesTest) cannot see it and must
    // NOT list it — adding it there fails that test, because the glob
    // finds no such literal. This is its census, the LoanRulesTest /
    // CopyStateMachineTest precedent. Delete the rules.php line and this
    // block, alone, goes red.
    $rules = require __DIR__.'/../../../lang/vi/rules.php';

    expect(array_key_exists('title_has_no_copies', $rules))->toBeTrue('missing rules.title_has_no_copies')
        ->and($rules['title_has_no_copies'])->toBe('Cuốn này chưa có bản sách nào trong tủ.');
});

it('a held copy is never auto-chosen — collecting a hold is Phase 2\'s HandoverRequest', function () {
    $result = ChooseCopy::lowestLendable(collect([ccCopy('DT-0001', CopyState::Held)]));
    expect($result['copy'])->toBeNull()->and($result['reason'])->toBe('copy_not_available');
});
