<?php

namespace App\Http\Controllers\Reader;

use App\Actions\Circulation\RenewLoan;
use App\Http\Controllers\Controller;
use App\Models\Bookshelf;
use App\Models\Loan;
use App\Models\User;
use App\Queries\MyDashboardQuery;
use App\Queries\MyLoanHistoryQuery;
use App\Support\QueryParam;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Inertia\Inertia;
use Inertia\Response;

/**
 * BR §16.2's "My page": current loans with days remaining and Xin gia
 * hạn, recently returned, the full history, and — since 2a — the reader's
 * own pending/approved requests with a cancel per row
 * (MyDashboardQuery::run's requests half).
 */
class MyLoansController extends Controller
{
    public function overview(Request $request, Bookshelf $shelf, MyDashboardQuery $dashboard): Response
    {
        /** @var User $user */
        $user = $request->user();

        return Inertia::render('shelves/profile/overview', [
            'dashboard' => $dashboard->run($user),
        ]);
    }

    public function history(Request $request, Bookshelf $shelf, MyLoanHistoryQuery $history): Response
    {
        /** @var User $user */
        $user = $request->user();

        return Inertia::render('shelves/profile/history', [
            'history' => $history->run($user, (int) QueryParam::first($request, 'page', '1')),
        ]);
    }

    public function renew(Request $request, Bookshelf $shelf, Loan $loan, RenewLoan $renewLoan): RedirectResponse
    {
        /** @var User $user */
        $user = $request->user();

        $result = $renewLoan->execute($user, $loan);

        // Deviation from the brief (task-13-brief.md's Step 3 controller
        // snippet passed $result['dueOn'] raw): AGENTS.md's "dates read as
        // dates" and LendController::store's identical fix
        // (app/Http/Controllers/Manage/LendController.php:225-228, "a raw
        // Y-m-d here would read 'hạn trả 2026-09-12'") are the established
        // precedent for this exact flash-message shape on this same phase.
        // A raw Y-m-d in :due here would read "hạn trả mới là 2026-09-11"
        // one tap after the overview page shows the same date via
        // formatDate() as 11/09/2026 — fixed to the identical d/m/Y.
        return back()->with('success', __('rules.renew_success_flash', [
            'due' => Carbon::parse($result['dueOn'])->format('d/m/Y'),
        ]));
    }
}
