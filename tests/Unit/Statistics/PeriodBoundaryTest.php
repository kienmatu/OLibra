<?php

use App\Enums\StatsPeriod;
use App\Support\Clock;
use Carbon\CarbonImmutable;

// RELEASE THE CLOCK. tests/Pest.php binds Laravel's TestCase with ->in('Feature')
// only, so a Unit test gets no framework tearDown and a frozen clock LEAKS into
// every later Unit test in the process. tests/Unit/ClockTest.php:7 opens with
// exactly this line for exactly this reason.
afterEach(fn () => CarbonImmutable::setTestNow());

/**
 * The boundary is a CIVIL day boundary expressed as a UTC instant, which
 * is the whole reason these blocks assert on UTC strings rather than on
 * local ones: a test that asserts "Monday 00:00" in the parish timezone
 * passes just as happily against a Clock that never converted anything.
 */
it('the week boundary is Monday 00:00 in the parish timezone, expressed in UTC', function () {
    // 2026-08-31 is a Monday — measured, not assumed:
    //   SELECT DAYNAME('2026-08-31') → Monday, on MariaDB 10.11.19.
    // "Now" is Wednesday 2026-09-02, 09:00 in Hồ Chí Minh = 02:00 UTC.
    CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-09-02 02:00:00', 'UTC'));

    $start = app(Clock::class)->periodStart(StatsPeriod::Week);

    // Monday 00:00 at +07:00 is the PREVIOUS Sunday at 17:00 UTC. If the
    // implementation forgets to convert, it returns ...T00:00:00Z and this
    // block fails on the seven-hour difference, which is the point.
    expect($start->toIso8601String())->toBe('2026-08-30T17:00:00+00:00');
});

it('the month boundary is the first of the civil month, not of the UTC month', function () {
    // 2026-09-01 00:30 Hồ Chí Minh is 2026-08-31 17:30 UTC — the hours in
    // which the two calendars disagree, which is the only interesting case.
    CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-08-31 17:30:00', 'UTC'));

    $start = app(Clock::class)->periodStart(StatsPeriod::Month);

    // Civil date is 1 September, so the month began at 1 Sep 00:00 +07:00
    // = 31 Aug 17:00 UTC. A UTC-only implementation answers 1 Aug, a month out.
    expect($start->toIso8601String())->toBe('2026-08-31T17:00:00+00:00');
});

it('the year boundary is the first of the civil year', function () {
    CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-06-15 12:00:00', 'UTC'));

    expect(app(Clock::class)->periodStart(StatsPeriod::Year)->toIso8601String())
        ->toBe('2025-12-31T17:00:00+00:00');
});

it('"all" is a floor early enough to precede any row this system can hold', function () {
    CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-06-15 12:00:00', 'UTC'));

    expect(app(Clock::class)->periodStart(StatsPeriod::All)->year)->toBeLessThan(1971);
});

it('the civil timezone is named once, on Clock, and today() reads that name', function () {
    // The guard for this phase's constraint: no new 'Asia/Ho_Chi_Minh'
    // literal. If someone re-inlines the string in today(), this stays green
    // — so the block asserts the CONSTANT exists and carries the value, and
    // the architecture block in Task 13 is what counts the literals.
    expect(Clock::ZONE)->toBe('Asia/Ho_Chi_Minh');
});
