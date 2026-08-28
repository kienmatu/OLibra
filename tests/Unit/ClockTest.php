<?php

use App\Support\Clock;
use Carbon\Carbon;
use Carbon\CarbonImmutable;

afterEach(fn () => Carbon::setTestNow());

it('reads now in utc and honours setTestNow', function () {
    Carbon::setTestNow(Carbon::parse('2026-08-27 10:00:00', 'UTC'));

    $now = (new Clock)->now();

    expect($now)->toBeInstanceOf(CarbonImmutable::class)
        ->and($now->timezoneName)->toBe('UTC')
        ->and($now->toDateTimeString())->toBe('2026-08-27 10:00:00');
});

it('computes today in Asia/Ho_Chi_Minh, not the server timezone', function () {
    // 18:30 UTC on the 27th is already 01:30 on the 28th in Hồ Chí Minh —
    // the exact off-by-one a naive now()->toDateString() would produce for
    // acquired_on and, in 1c, for due dates.
    Carbon::setTestNow(Carbon::parse('2026-08-27 18:30:00', 'UTC'));

    expect((new Clock)->today())->toBe('2026-08-28');
});
