<?php

namespace App\Http\Controllers\Manage;

use App\Actions\Circulation\ReceiveReturn;
use App\Enums\CopyCondition;
use App\Http\Controllers\Controller;
use App\Http\Requests\Circulation\ReceiveReturnRequest;
use App\Models\Bookshelf;
use App\Models\Loan;
use App\Models\User;
use App\Queries\SearchLoansForReturnQuery;
use App\Support\QueryParam;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * BR §16.3's receive return: find the loan, pick a condition (Nguyên vẹn
 * preselected — the common case is two taps), confirm. The lost screen is
 * the same search with a different exit: it posts to the 1a report-lost
 * route, because "Bạn đọc báo làm mất" is ReportCopyLost's second entry
 * point, not a ReceiveReturn variant (OPS §4.2).
 *
 * The queued-reader offer (OPS §5 steps 3-4) is ABSENT until Phase 2 —
 * plan divergence 4; there is no queue to check yet.
 */
class ReturnController extends Controller
{
    public function index(Request $request, Bookshelf $shelf, SearchLoansForReturnQuery $loans): Response
    {
        $q = QueryParam::first($request, 'q') ?? '';
        $chosen = QueryParam::first($request, 'loan');
        $rows = $loans->run($q);

        return Inertia::render('manage/returns/index', [
            'filters' => ['q' => $q],
            'loans' => $rows,
            // Only a loan the CURRENT search returned can be "chosen" — a
            // stale ?loan= from a bookmark degrades to nothing selected.
            'chosenLoanId' => collect($rows)->firstWhere('loanId', $chosen)['loanId'] ?? null,
        ]);
    }

    public function store(ReceiveReturnRequest $request, Bookshelf $shelf, Loan $loan, ReceiveReturn $receiveReturn): RedirectResponse
    {
        /** @var User $user */
        $user = $request->user();
        $validated = $request->validated();

        $receiveReturn->execute(
            $user,
            $loan,
            CopyCondition::from($validated['condition']),
            $validated['note'] ?? null,
        );

        // Larastan disagrees with itself across `?->` and plain `->` on
        // this relation the same way LendController::store's does — a
        // local variable plus an explicit null check reads the same
        // either way and satisfies level 8.
        $copy = $loan->copy;

        return redirect()
            ->route('shelves.manage.returns', ['shelf' => $shelf->slug])
            ->with('success', __('rules.return_success_flash', [
                'code' => $copy === null ? '' : $copy->code,
            ]));
    }

    public function lost(Request $request, Bookshelf $shelf, SearchLoansForReturnQuery $loans): Response
    {
        $q = QueryParam::first($request, 'q') ?? '';
        $chosenId = QueryParam::first($request, 'loan');
        $rows = $loans->run($q);
        $chosen = collect($rows)->firstWhere('loanId', $chosenId);

        return Inertia::render('manage/returns/lost', [
            'filters' => ['q' => $q],
            'loans' => $rows,
            'chosen' => $chosen === null ? null : [
                'loanId' => $chosen['loanId'],
                'copyId' => $chosen['copyId'],
                'copyCode' => $chosen['copyCode'],
                'title' => $chosen['title'],
                'borrowerName' => $chosen['borrowerName'],
                'dueOn' => $chosen['dueOn'],
            ],
        ]);
    }
}
