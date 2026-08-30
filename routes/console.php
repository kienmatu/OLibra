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

// The second Schedule:: line Phase 0 reserved, now live: BR §15's nhắc trả
// sách — before a loan falls due (each shelf's own due_soon_days, default
// 3) and again once it has lapsed. 07:00 Asia/Ho_Chi_Minh, the hour the
// reference's compose sweep service ran (OPS §7). Housekeeping, bounded:
// if it misses a day nothing a user sees is wrong — overdue is computed
// on read — only late to be told, and the command is idempotent, so
// tomorrow's run catches up rather than double-telling.
Schedule::command('reminders:sweep')->dailyAt('07:00')->timezone('Asia/Ho_Chi_Minh');
