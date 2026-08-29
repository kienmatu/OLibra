<?php

namespace App\Http\Controllers\Manage;

use App\Http\Controllers\Controller;
use App\Models\Bookshelf;
use App\Queries\OverdueLoansQuery;
use App\Support\QueryParam;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class OverdueController extends Controller
{
    public function index(Request $request, Bookshelf $shelf, OverdueLoansQuery $overdue): Response
    {
        $sort = QueryParam::first($request, 'sort');
        $sort = in_array($sort, ['most-late', 'least-late', 'borrower'], true) ? $sort : 'most-late';

        return Inertia::render('manage/overdue', [
            'sort' => $sort,
            'loans' => $overdue->run($sort),
        ]);
    }
}
