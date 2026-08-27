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
Schedule::command('queue:work --stop-when-empty --max-time=50')
    ->everyMinute()
    ->withoutOverlapping();

// The 07:00 Asia/Ho_Chi_Minh reminder sweep is Phase 2's — it slots in here as
// a second Schedule:: line once the sweep command exists. Scheduling a
// command that does not exist yet would fail every tick, so it is not added
// now:
//
// Schedule::command('reminders:sweep')->dailyAt('07:00')->timezone('Asia/Ho_Chi_Minh');
