<?php

declare(strict_types=1);

namespace App\Support\Members;

use App\Enums\MembershipStatus;
use App\Exceptions\RuleViolated;

/**
 * BR §7.5's state machine — the PHP form of old_next/src/domain/members/
 * policy.ts's ALLOWED set and refusalFor(). Written as data so the diagram
 * in the requirements and the table here can be compared by eye.
 *
 * Two families of extra arrows the diagram does not draw, both the
 * reference's own hard-won decisions (its docstring holds the full
 * argument):
 *  - any → left, INCLUDING left → left (OPS §4.3: "Any status → left";
 *    M6: a re-clicked "Đánh dấu đã rời" is idempotent, not a bespoke
 *    refusal).
 *  - rejected → pending and left → pending (BR §2: re-applying walks the
 *    SAME row back, because memberships_one_per_shelf ignores status).
 *    suspended has NO → pending edge: a suspended reader is reactivated by
 *    a manager, never walked back by resubmitting the public form
 *    (CRITICAL 1).
 */
final class MembershipTransitions
{
    private const array ALLOWED = [
        'pending->active', 'pending->rejected',
        'active->suspended', 'suspended->active',
        'pending->left', 'active->left', 'suspended->left',
        'rejected->left', 'left->left',
        'rejected->pending', 'left->pending',
    ];

    /** The refusal code for a forbidden edge, or null when allowed. */
    public static function check(MembershipStatus $from, MembershipStatus $to): ?string
    {
        if (in_array("{$from->value}->{$to->value}", self::ALLOWED, true)) {
            return null;
        }

        return self::refusalFor($from, $to);
    }

    public static function assert(MembershipStatus $from, MembershipStatus $to): void
    {
        $code = self::check($from, $to);

        if ($code !== null) {
            throw new RuleViolated($code);
        }
    }

    /**
     * Ordered by what the caller was TRYING to do (the reference's
     * refusalFor, comment for comment): to=suspended is Suspend's verb;
     * to=active from a terminal state is a reactivation attempt; anything
     * else reaching here is a replayed decision on a pending application.
     */
    private static function refusalFor(MembershipStatus $from, MembershipStatus $to): string
    {
        if ($to === MembershipStatus::Suspended) {
            return 'not_active_cannot_suspend';
        }

        if ($to === MembershipStatus::Active
            && in_array($from, [MembershipStatus::Left, MembershipStatus::Rejected], true)) {
            return 'not_suspended_cannot_reactivate';
        }

        return 'registration_not_pending';
    }
}
