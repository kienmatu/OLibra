<?php

namespace App\Support;

use Carbon\CarbonImmutable;

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
    public function now(): CarbonImmutable
    {
        return CarbonImmutable::now('UTC');
    }

    /** `Y-m-d` in the application's civil timezone. */
    public function today(): string
    {
        return CarbonImmutable::now('Asia/Ho_Chi_Minh')->toDateString();
    }
}
