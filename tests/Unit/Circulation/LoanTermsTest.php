<?php

use App\Support\Circulation\LoanTerms;

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
