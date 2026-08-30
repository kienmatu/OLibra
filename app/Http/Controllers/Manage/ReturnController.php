<?php

namespace App\Http\Controllers\Manage;

use App\Actions\Circulation\ReceiveReturn;
use App\Enums\CopyCondition;
use App\Http\Controllers\Controller;
use App\Http\Requests\Circulation\ReceiveReturnRequest;
use App\Models\Bookshelf;
use App\Models\Loan;
use App\Models\User;
use App\Queries\BorrowRequestQueueQuery;
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
 * OPS §5 steps 3-4: once a loan is chosen, `index` also answers "who is
 * waiting for THIS title, right now" — read from the same
 * BorrowRequestQueueQuery the manager's queue screen (Task 14) reads, so
 * the two screens cannot show two answers about the same title. `store`
 * passes the manager's radio choice straight through to
 * ReceiveReturn::execute's $holdForRequestId, which is where the rule
 * (pending-only, same title, one transaction with the return) actually
 * lives — this controller does no rule-checking of its own.
 */
class ReturnController extends Controller
{
    public function index(Request $request, Bookshelf $shelf, SearchLoansForReturnQuery $loans, BorrowRequestQueueQuery $queue): Response
    {
        $q = QueryParam::first($request, 'q') ?? '';
        $chosen = QueryParam::first($request, 'loan');
        $rows = $loans->run($q);
        // Only a loan the CURRENT search returned can be "chosen" — a
        // stale ?loan= from a bookmark degrades to nothing selected.
        $chosenRow = collect($rows)->firstWhere('loanId', $chosen);

        $waiting = null;
        if ($chosenRow !== null) {
            // The SAME query the queue screen reads (OPS §5 step 3),
            // narrowed to this title, so the return screen and the queue
            // screen cannot disagree about who is waiting. Pending only:
            // an approved row already has its own copy held aside — this
            // returned copy is not on offer for it (ReturnHoldOfferTest's
            // fixture seeds one such row to prove the exclusion, not just
            // assert an absence with nothing to exclude).
            $queues = $queue->run($chosenRow['bookId']);
            $waiting = array_values(array_map(
                fn (array $r): array => [
                    'requestId' => $r['requestId'],
                    'readerName' => $r['readerName'],
                    'requestedAt' => $r['requestedAt'],
                ],
                array_filter($queues[0]['requests'] ?? [], fn (array $r): bool => $r['status'] === 'pending'),
            ));
        }

        return Inertia::render('manage/returns/index', [
            'filters' => ['q' => $q],
            'loans' => $rows,
            'chosenLoanId' => $chosenRow['loanId'] ?? null,
            'waiting' => $waiting,
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
            null,
            $validated['hold_for_request_id'] ?? null,
        );

        // Larastan disagrees with itself across `?->` and plain `->` on
        // this relation the same way LendController::store's does — a
        // local variable plus an explicit null check reads the same
        // either way and satisfies level 8.
        $copy = $loan->copy;
        $held = ($validated['hold_for_request_id'] ?? null) !== null;

        return redirect()
            ->route('shelves.manage.returns', ['shelf' => $shelf->slug])
            ->with('success', __($held ? 'rules.return_hold_success_flash' : 'rules.return_success_flash', [
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
