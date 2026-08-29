<?php

namespace App\Support\Circulation;

use App\Enums\CopyState;
use App\Enums\MembershipStatus;

/**
 * The circulation domain's pure rules — the port of
 * old_next/src/domain/circulation/policy.ts. No SQL, no clock, no I/O.
 *
 * BR §16.3: blocking conditions surface BEFORE the confirm step, never as an
 * error afterwards — so the same predicates answer the screen's "can I?" and
 * the command's "may I?". Two implementations would drift, and a volunteer
 * would be told yes and then no, which is worse than no: the book is already
 * in the child's hands.
 *
 * Returns ?string (null = allowed, else the RuleViolated code), the
 * MembershipTransitions::check idiom. Every returnable code is in CODES,
 * censused against lang/vi/rules.php by LoanRulesTest.
 */
final class LoanRules
{
    /** @var list<string> every code the predicates below can return */
    public const CODES = [
        'copy_lost_or_retired', 'copy_not_available',
        'membership_not_active', 'loan_limit_reached',
        'no_renewals_remaining', 'title_has_queue',
    ];

    /**
     * INV-3 and INV-7 as one predicate.
     *
     * $heldForUserId and $forUserId are users.id, NOT memberships.id, and
     * the names are load-bearing (the reference's own docblock): a caller
     * that passed a membership id would turn "a held copy is lendable to
     * its holder" into "a held copy is never lendable", with every test
     * here still green. In 1c no hold can exist ($heldForUserId is always
     * null — Phase 2 owns borrow requests), but the clause ports whole so
     * Phase 2 wires a caller, not a new rule.
     *
     * This is not a second CopyStateMachine: the transition table already
     * refuses lost|retired → on_loan; what it structurally cannot answer is
     * WHOSE hold a held copy is under.
     */
    public static function copyLendable(CopyState $state, ?string $heldForUserId, string $forUserId): ?string
    {
        if ($state === CopyState::Lost || $state === CopyState::Retired) {
            return 'copy_lost_or_retired';
        }
        if ($state === CopyState::Available) {
            return null;
        }
        if ($state === CopyState::Held && $heldForUserId === $forUserId) {
            return null;
        }

        // on_loan, and held under somebody else's hold or no live hold at
        // all. A lapsed hold arrives as null (expiry presents as absence)
        // and must not match a reader.
        return 'copy_not_available';
    }

    /**
     * INV-4 then INV-5, in the order that decides which single sentence a
     * volunteer reads: a suspended reader who is also at the limit hears
     * about the suspension — something actionable — not the limit.
     *
     * INV-4 is deliberately narrow: a non-active membership blocks a NEW
     * loan and leaves existing ones alone (BR §6). The status list is one
     * comparison here because MembershipStatus is the single enum — there
     * is no second hand-maintained list to drift (the B2a defect the
     * reference documents).
     */
    public static function memberMayBorrow(MembershipStatus $status, int $activeLoans, int $maxConcurrentLoans): ?string
    {
        if ($status !== MembershipStatus::Active) {
            return 'membership_not_active';
        }
        if ($activeLoans >= $maxConcurrentLoans) {
            return 'loan_limit_reached';
        }

        return null;
    }

    /**
     * INV-6's two refusals. Renewals first, matching the command and the
     * reference: with both true, the reader reads the sentence about their
     * own turn — the one that stays true tomorrow.
     */
    public static function loanRenewable(int $renewalsUsed, int $maxRenewals, bool $titleHasQueue): ?string
    {
        if ($renewalsUsed >= $maxRenewals) {
            return 'no_renewals_remaining';
        }
        if ($titleHasQueue) {
            return 'title_has_queue';
        }

        return null;
    }
}
