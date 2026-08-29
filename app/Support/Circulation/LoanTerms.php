<?php

namespace App\Support\Circulation;

use Carbon\CarbonImmutable;

/**
 * Due-date arithmetic and the overdue/days-remaining derivations — the ONE
 * home BR §8 demands, replacing the loans_current view's is_overdue and
 * days_remaining columns (spec §4: views encode read shapes, not
 * invariants). Availability's one home is CountsCopies::borrowable();
 * overdue's is here. Every caller passes Clock::today() — the civil date
 * in Asia/Ho_Chi_Minh — so a book lent at 23:30 UTC is not a day short.
 *
 * All parameters and returns are Y-m-d strings. '!Y-m-d' zeroes the time
 * part, and UTC keeps the host's timezone out of date arithmetic entirely:
 * the timezone conversion already happened, in Clock::today(), and doing
 * it twice is how a date shifts by one (the reference's dueDateFor note).
 */
final class LoanTerms
{
    public static function dueDateFor(string $today, int $loanDays): string
    {
        return self::date($today)->addDays($loanDays)->toDateString();
    }

    /** INV-6: from the CURRENT due date. The signature admits no "today". */
    public static function renewedDueDate(string $dueOn, int $renewalDays): string
    {
        return self::date($dueOn)->addDays($renewalDays)->toDateString();
    }

    /** BR §8: active + due date before today. Due today is NOT overdue. */
    public static function isOverdue(string $dueOn, string $today): bool
    {
        return $dueOn < $today; // Y-m-d compares correctly as bytes
    }

    /** 0 on the due day, negative once overdue. */
    public static function daysRemaining(string $dueOn, string $today): int
    {
        return (int) self::date($today)->diffInDays(self::date($dueOn), false);
    }

    /**
     * When a hold placed NOW lapses — hold_days after the instant, in
     * fixed-length wall time. No timezone or DST reasoning applies, unlike
     * dueDateFor: this produces an INSTANT (hold_expires_at is
     * DATETIME(6) UTC), not a civil date. What matters is only which
     * clock the arithmetic starts from — the injected one, because every
     * later read of hold_expires_at compares it against the same injected
     * clock (the reference's holdExpiryFrom argument, kept whole). Moved
     * here rather than written privately in two commands:
     * ApproveBorrowRequest and ReceiveReturn write the same column from
     * the same rule.
     */
    public static function holdExpiry(CarbonImmutable $now, int $holdDays): CarbonImmutable
    {
        return $now->addDays($holdDays);
    }

    private static function date(string $ymd): CarbonImmutable
    {
        return CarbonImmutable::createFromFormat('!Y-m-d', $ymd, 'UTC') ?: throw new \InvalidArgumentException("not a date: {$ymd}");
    }
}
