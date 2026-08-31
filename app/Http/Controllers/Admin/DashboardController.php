<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Queries\Admin\AdminOverviewQuery;
use Inertia\Inertia;
use Inertia\Response;

class DashboardController extends Controller
{
    /**
     * BR §16.4's admin dashboard: one row per bookshelf, archived shelves
     * included and marked (D9), pending items flagged. Read-only — no
     * writes, nothing to refuse.
     */
    public function index(AdminOverviewQuery $overview): Response
    {
        return Inertia::render('admin/dashboard', [
            'shelves' => $overview->run(),
        ]);
    }
}
