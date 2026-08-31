<?php

namespace App\Http\Controllers\Manage;

use App\Enums\StatsPeriod;
use App\Http\Controllers\Controller;
use App\Models\Bookshelf;
use App\Queries\StatisticsQuery;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * BR §16.3's Statistics screen. One GET, no writes, nothing to refuse.
 *
 * The period is read from the query string rather than posted, so a
 * manager can bookmark "this year" and a link can carry a period. An
 * unknown value falls back to the default instead of 422-ing: a
 * hand-edited or stale URL should render the page, and there is no
 * destructive action here for a wrong period to trigger.
 *
 * MANAGER-FACING, AND THAT IS LOAD-BEARING. BR §16.2 records that the
 * leaderboard opt-in was withdrawn and *Bạn đọc chăm nhất* now counts
 * every borrower with no acknowledgement step; the stated mitigation is
 * precisely that this list stays manager-facing, since a manager can
 * already see every loan through the lending screens and the audit log.
 * BR §16.2 says that if this list ever becomes reader-facing the decision
 * has to be taken again. It is not taken here.
 */
class StatisticsController extends Controller
{
    public function index(Request $request, Bookshelf $shelf, StatisticsQuery $stats): Response
    {
        $period = StatsPeriod::tryFrom((string) $request->query('period')) ?? StatsPeriod::Month;

        return Inertia::render('manage/statistics', [
            'stats' => $stats->run($period),
        ]);
    }
}
