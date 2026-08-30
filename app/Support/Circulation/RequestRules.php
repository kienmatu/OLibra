<?php

namespace App\Support\Circulation;

use App\Enums\CopyState;
use App\Enums\MembershipStatus;

/**
 * The borrow-request side of the circulation domain's pure rules — the
 * port of policy.ts's copyHoldable and memberMayRequest. No SQL, no
 * clock, no I/O. Returns ?string (null = allowed, else the RuleViolated
 * code); every returnable code is in CODES, censused against
 * lang/vi/rules.php by RequestRulesTest.
 */
final class RequestRules
{
    /** @var list<string> every code the predicates below can return */
    public const CODES = [
        'no_copy_available', 'chosen_copy_lost_or_retired',
        'membership_not_active_cannot_request',
    ];

    /**
     * Whether a copy may be put aside for a queued reader —
     * ApproveBorrowRequest's question, INV-3 and INV-7 from the other end.
     *
     * NOT LoanRules::copyLendable with a different caller: that predicate
     * answers "may THIS reader take this copy away" and its whole reason
     * for existing is the held-for-me case. This one answers "may this
     * copy be promised to somebody who is not standing here", and the
     * held case is the opposite answer — a copy under a live hold is
     * already promised, and promising it twice is how one child is sent
     * home. So there is no $forUserId parameter: there is nobody to
     * compare against, which is the difference, stated as a signature.
     *
     * $heldForUserId is read through a hold_expires_at > now filter, so a
     * lapsed hold arrives as null — and a copy left `held` by an
     * uncollected hold is then refused by the STATE branch, not freed on
     * the way past (BR §8: held → available is a transition a command
     * performs, never one an approval performs in passing).
     */
    public static function copyHoldable(CopyState $state, ?string $heldForUserId): ?string
    {
        if ($state === CopyState::Lost || $state === CopyState::Retired) {
            return 'chosen_copy_lost_or_retired';
        }
        if ($state === CopyState::Available && $heldForUserId === null) {
            return null;
        }

        return 'no_copy_available';
    }

    /**
     * INV-4 for CreateBorrowRequest — the same single status comparison
     * LoanRules::memberMayBorrow makes (MembershipStatus is the one enum;
     * there is no second hand-maintained list to drift), with the queue's
     * own sentence: OPS §4.2 words LendCopy's refusal "không thể mượn
     * thêm" and this one "không thể gửi yêu cầu mượn", because a child
     * told they cannot borrow MORE would reasonably conclude the queue is
     * still open to them.
     *
     * INV-5 is deliberately not consulted: a reader at the loan limit may
     * queue — nothing goes out on a request, and the limit is re-checked
     * by HandoverRequest at the moment a book actually changes hands.
     */
    public static function memberMayRequest(MembershipStatus $status): ?string
    {
        return $status === MembershipStatus::Active
            ? null
            : 'membership_not_active_cannot_request';
    }
}
