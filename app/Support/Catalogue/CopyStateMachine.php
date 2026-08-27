<?php

namespace App\Support\Catalogue;

use App\Enums\CopyState;
use App\Exceptions\RuleViolated;

/**
 * BR §7.1's transition table, arrow for arrow — the PHP form of
 * old_next/src/domain/catalogue/policy.ts's ALLOWED set and refusalFor().
 * Data, not a chain of ifs, so the table in the requirements and the table
 * here can be compared by eye.
 *
 * Q3 — `available → lost` is deliberately absent. BR §7.1 draws only
 * `on_loan → lost`, and OPS §4.1 flags the broader screen affordance as an
 * open question rather than a decision. Widening later is one line here
 * plus one test; retracting a transition that has written rows is not.
 */
final class CopyStateMachine
{
    private const ALLOWED = [
        'available->held',
        'available->on_loan',
        'available->retired',
        'held->available',
        'held->on_loan',
        'on_loan->available',
        'on_loan->lost',
        'lost->available',
        'lost->retired',
    ];

    /** `null` when allowed; otherwise the refusal code (a lang/vi/rules.php key). */
    public static function check(CopyState $from, CopyState $to): ?string
    {
        if (in_array($from->value.'->'.$to->value, self::ALLOWED, true)) {
            return null;
        }

        return self::refusalFor($from, $to);
    }

    public static function assert(CopyState $from, CopyState $to): void
    {
        $reason = self::check($from, $to);

        if ($reason !== null) {
            throw new RuleViolated($reason);
        }
    }

    /**
     * Why a particular refusal, in the words the volunteer will read —
     * ordered most-specific first: the state the copy is IN usually
     * explains the refusal better than the transition attempted does.
     */
    private static function refusalFor(CopyState $from, CopyState $to): string
    {
        if ($from === CopyState::Retired) {
            return 'already_retired';
        }
        if ($from === CopyState::Lost && $to !== CopyState::Available && $to !== CopyState::Retired) {
            return 'already_lost';
        }
        if ($to === CopyState::Lost) {
            // Q3: reached from available and from held — both mean "this
            // copy is not out with anybody".
            return 'copy_not_on_loan';
        }
        if ($to === CopyState::Retired) {
            return $from === CopyState::OnLoan ? 'copy_on_loan' : 'copy_not_available';
        }
        if ($to === CopyState::Available) {
            // MarkCopyFound's failure mode (OPS §4.1): the copy is not lost.
            return 'not_lost';
        }

        return 'copy_not_available';
    }
}
