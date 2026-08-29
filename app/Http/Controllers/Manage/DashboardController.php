<?php

namespace App\Http\Controllers\Manage;

use App\Http\Controllers\Controller;
use App\Models\Bookshelf;
use App\Queries\ManagerDashboardQuery;
use App\Support\Clock;
use Inertia\Inertia;
use Inertia\Response;

class DashboardController extends Controller
{
    public function index(Bookshelf $shelf, ManagerDashboardQuery $dashboard, Clock $clock): Response
    {
        return Inertia::render('manage/dashboard', [
            'dashboard' => $dashboard->run(),
            // From the injected clock, never new Date() on the page — the
            // reference's fixture dashboard shipped a date three days stale.
            'today' => $clock->today(),
        ]);
    }
}
