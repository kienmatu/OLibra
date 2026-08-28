<?php

use App\Enums\MembershipStatus as S;
use App\Exceptions\RuleViolated;
use App\Support\Members\MembershipTransitions;

it('is BR §7.5\'s diagram, arrow for arrow, plus the three documented extras', function () {
    // The diagram: pending → active | rejected; active ⇄ suspended;
    // active/suspended → left. The extras, each with its source:
    // any → left including left→left (OPS §4.3 "Any status → left"; M6's
    // idempotent re-click), and rejected/left → pending (BR §2 re-apply,
    // walked back on the same row because memberships_one_per_shelf ignores
    // status).
    $allowed = [
        [S::Pending, S::Active], [S::Pending, S::Rejected],
        [S::Active, S::Suspended], [S::Suspended, S::Active],
        [S::Pending, S::Left], [S::Active, S::Left], [S::Suspended, S::Left],
        [S::Rejected, S::Left], [S::Left, S::Left],
        [S::Rejected, S::Pending], [S::Left, S::Pending],
    ];

    foreach ($allowed as [$from, $to]) {
        expect(MembershipTransitions::check($from, $to))
            ->toBeNull("{$from->value}->{$to->value} should be allowed");
    }

    // Everything else refuses. 5×5 minus self-loops the graph never asks
    // about — walk the full grid so a sixth arrow added by accident is red.
    foreach (S::cases() as $from) {
        foreach (S::cases() as $to) {
            $isAllowed = collect($allowed)->contains(
                fn (array $edge) => $edge[0] === $from && $edge[1] === $to,
            );
            if (! $isAllowed) {
                expect(MembershipTransitions::check($from, $to))
                    ->toBeString("{$from->value}->{$to->value} should refuse");
            }
        }
    }
});

it('names the refusal by what the caller was trying to do', function () {
    // policy.test.ts "approving something already decided names the
    // registration, not the request" + the suspend/reactivate sentences.
    expect(MembershipTransitions::check(S::Pending, S::Suspended))->toBe('not_active_cannot_suspend')
        ->and(MembershipTransitions::check(S::Left, S::Suspended))->toBe('not_active_cannot_suspend')
        ->and(MembershipTransitions::check(S::Left, S::Active))->toBe('not_suspended_cannot_reactivate')
        ->and(MembershipTransitions::check(S::Rejected, S::Active))->toBe('not_suspended_cannot_reactivate')
        // A replayed approval: from=active, to=active came from Approve, not
        // Reactivate — ApproveMembership's own sentence.
        ->and(MembershipTransitions::check(S::Active, S::Active))->toBe('registration_not_pending')
        ->and(MembershipTransitions::check(S::Active, S::Rejected))->toBe('registration_not_pending')
        ->and(MembershipTransitions::check(S::Suspended, S::Pending))->toBe('registration_not_pending');
});

it('assert throws RuleViolated carrying the code', function () {
    MembershipTransitions::assert(S::Active, S::Rejected);
})->throws(RuleViolated::class, 'registration_not_pending');

it('every refusal code the graph can produce has a Vietnamese sentence', function () {
    // Unit tests are not bootstrapped against the Laravel container (see
    // tests/Pest.php — only tests/Feature gets ->use(TestCase::class)), so
    // __() has no translator to resolve here. Read lang/vi/rules.php
    // directly, the idiom tests/Unit/Catalogue/RuleViolatedCodesHaveSentencesTest.php
    // already established for the identical situation.
    $rules = require __DIR__.'/../../../lang/vi/rules.php';

    foreach (['not_active_cannot_suspend', 'not_suspended_cannot_reactivate', 'registration_not_pending'] as $code) {
        expect(array_key_exists($code, $rules))->toBeTrue("missing rules.{$code}")
            ->and($rules[$code])->toBeString()->not->toBe('');
    }
});
