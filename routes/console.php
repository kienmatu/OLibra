<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

// No daemon on shared hosting. The per-minute schedule:run tick (cron, below)
// drains the queue instead: stop when empty, never outlive the next tick's
// slot. Worst-case latency for a queued job is about a minute, which BR §15's
// notification model tolerates (spec §10 risk 4).
// withoutOverlapping(2): the lock's default expiry is 24 hours, and
// CACHE_STORE=database makes it survive process death — exactly what
// happens when CloudLinux's LVE kills queue:work mid-run, the constraint
// this per-minute-tick design exists to accommodate. Left at the default,
// that leaves the mutex held and the queue silently undrained for up to a
// day. The command already caps its own runtime at --max-time=50 seconds,
// so a 2-minute lock is generous headroom, not a race.
Schedule::command('queue:work --stop-when-empty --max-time=50')
    ->everyMinute()
    ->withoutOverlapping(2);

// The 07:00 Asia/Ho_Chi_Minh reminder sweep is Phase 2's — it slots in here as
// a second Schedule:: line once the sweep command exists. Scheduling a
// command that does not exist yet would fail every tick, so it is not added
// now:
//
// Schedule::command('reminders:sweep')->dailyAt('07:00')->timezone('Asia/Ho_Chi_Minh');
