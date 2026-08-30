<?php

use App\Support\Circulation\LoanTerms;
use Carbon\CarbonImmutable;

it('the due date is loan_days from today', function () {
    expect(LoanTerms::dueDateFor('2026-08-28', 14))->toBe('2026-09-11');
});

it('the due date crosses a month and a year boundary correctly', function () {
    expect(LoanTerms::dueDateFor('2026-08-25', 14))->toBe('2026-09-08')
        ->and(LoanTerms::dueDateFor('2026-12-27', 14))->toBe('2027-01-10')
        // 2028 is a leap year; Feb 29 exists.
        ->and(LoanTerms::dueDateFor('2028-02-20', 14))->toBe('2028-03-05');
});

it('INV-6: a renewal extends the CURRENT due date, never today', function () {
    // The signature admits no "today" at all — this test pins the arithmetic,
    // Task 5 pins the caller by renewing an already-overdue loan.
    expect(LoanTerms::renewedDueDate('2026-08-20', 7))->toBe('2026-08-27');
});

it('overdue is strictly after the due date — due today is not overdue', function () {
    // BR §5.4: a book is due at the END of a day.
    expect(LoanTerms::isOverdue('2026-08-28', '2026-08-28'))->toBeFalse()
        ->and(LoanTerms::isOverdue('2026-08-28', '2026-08-29'))->toBeTrue()
        ->and(LoanTerms::isOverdue('2026-08-28', '2026-08-27'))->toBeFalse();
});

it('days remaining counts down to zero on the due day and goes negative after', function () {
    expect(LoanTerms::daysRemaining('2026-08-30', '2026-08-28'))->toBe(2)
        ->and(LoanTerms::daysRemaining('2026-08-28', '2026-08-28'))->toBe(0)
        ->and(LoanTerms::daysRemaining('2026-08-28', '2026-08-31'))->toBe(-3);
});

it('a hold placed now lapses hold_days later, as an instant, wall-time exact', function () {
    $now = CarbonImmutable::parse('2026-08-28 07:30:00', 'UTC');

    expect(LoanTerms::holdExpiry($now, 3)->toIso8601ZuluString())
        ->toBe('2026-08-31T07:30:00Z')
        // Fixed WALL time: the hold ends at the time of day it started, no
        // end-of-day rounding, unlike due dates (the reference's
        // holdExpiryFrom, kept). On this UTC clock that is also exactly 72
        // hours; on a clock with a DST transition it would not be, because
        // addDays() is calendar-aware — see holdExpiry's docblock, and note
        // that neither UTC nor Asia/Ho_Chi_Minh has such a transition.
        // Pinned as a second instant rather than a diff — Carbon's diff
        // sign conventions are exactly the kind of trap plan code has
        // failed gates on before.
        ->and(LoanTerms::holdExpiry($now, 1)->toIso8601ZuluString())
        ->toBe('2026-08-29T07:30:00Z');
});
