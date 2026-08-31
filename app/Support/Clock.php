<?php

namespace App\Support;

use App\Enums\StatsPeriod;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;

/**
 * The application clock — the Laravel form of src/domain/kernel/clock.ts's
 * injected clock, replacing the olibra_now() DB function the spec dropped
 * (§4). Immutable Carbon so a caller cannot mutate a shared instant, and
 * always through CarbonImmutable::now(), which honours Carbon::setTestNow().
 *
 * today() is deliberately in Asia/Ho_Chi_Minh: "today" for acquired_on
 * (this phase) and due_on (1c) is the parish's day, not the server's UTC
 * day — at 01:30 Hồ Chí Minh time the server's UTC date is still yesterday.
 */
final class Clock
{
    /**
     * The parish's civil timezone, named ONCE for the whole application.
     *
     * Storage is UTC (`config('app.timezone')` resolves to 'UTC'; `.env`
     * line 177 sets APP_TIMEZONE=UTC, confirmed with artisan tinker), and
     * this is the timezone every civil-day boundary is taken in. It is a
     * constant rather than a config key because it is not deployment
     * configuration: a parish does not move.
     *
     * KNOWN, AND DELIBERATELY NOT FIXED HERE: MyLoanHistoryQuery lines 39
     * and 42 still hardcode this string. That is shipped Phase 1c code and
     * changing it is scope creep into a merged phase; it is recorded in
     * docs/known-gaps.md instead. Nothing in Phase 2c adds a new literal.
     *
     * PER-SHELF TIMEZONE IS PHASE 3's. bookshelves.timezone exists as a
     * column and is deliberately not read: there is one parish today, and
     * a network of shelves is what makes the column mean anything.
     */
    public const string ZONE = 'Asia/Ho_Chi_Minh';

    public function now(): CarbonImmutable
    {
        return CarbonImmutable::now('UTC');
    }

    /** `Y-m-d` in the application's civil timezone. */
    public function today(): string
    {
        return CarbonImmutable::now(self::ZONE)->toDateString();
    }

    /**
     * The instant a statistics period begins, as UTC.
     *
     * Computed here rather than in SQL. The reference does it with Postgres
     * `date_trunc(... at time zone 'Asia/Ho_Chi_Minh')`, which MariaDB has
     * no equivalent for; doing it in PHP removes the problem instead of
     * porting it, and makes the boundary testable with setTestNow() and no
     * database at all.
     *
     * startOfWeek is passed MONDAY explicitly. Carbon's default start of
     * week follows the locale, so an unqualified startOfWeek() would make
     * the week boundary a configuration accident — the same reason the
     * spec's SQL alternative chose WEEKDAY() over WEEK().
     */
    public function periodStart(StatsPeriod $period): CarbonImmutable
    {
        $civil = $this->now()->setTimezone(self::ZONE);

        $start = match ($period) {
            StatsPeriod::Week => $civil->startOfWeek(CarbonInterface::MONDAY),
            StatsPeriod::Month => $civil->startOfMonth(),
            StatsPeriod::Year => $civil->startOfYear(),
            // An epoch floor, not a real date. Every instant this system can
            // store is after it, which is all "since the shelf began" means.
            StatsPeriod::All => CarbonImmutable::parse('1970-01-01 00:00:00', 'UTC'),
        };

        return $start->setTimezone('UTC');
    }
}
