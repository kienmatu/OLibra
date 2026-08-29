<?php

namespace App\Http\Controllers\Manage;

use App\Actions\Circulation\ApproveBorrowRequest;
use App\Actions\Circulation\HandoverRequest;
use App\Actions\Circulation\RejectBorrowRequest;
use App\Http\Controllers\Controller;
use App\Http\Requests\Circulation\ApproveBorrowRequestRequest;
use App\Http\Requests\Circulation\RejectBorrowRequestRequest;
use App\Models\Bookshelf;
use App\Models\BorrowRequest;
use App\Models\User;
use App\Queries\BorrowRequestQueueQuery;
use Carbon\Carbon;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * BR §16.3's borrow-request queue. Every row here was queued by
 * somebody; nothing on this page happens by itself ("the manager
 * decides, because the next reader may not be standing there").
 * Bỏ qua is deliberately absent — the product owner removed SkipRequest
 * from the reference (2026-08-09); Từ chối is the only decision a
 * manager makes about a pending row.
 *
 * WHAT PRODUCES THE 404 for a non-manager: the route group's
 * `role:manager`, and on this class's routes today only that.
 * EnsureShelfRole::handle abort(404)s before Laravel resolves a
 * controller or a Form Request at all, so the abort_unless in the two
 * Form Requests below is a backstop, not the door — measured by deleting
 * both abort_unless lines and re-running ManagerQueueScreenTest's reader
 * block, which stayed green, then restoring them.
 *
 * handover() takes a plain Request and has no backstop of its own, and
 * that difference is not cosmetic. Measured the other way — dropping
 * `role:manager` from the manage group — approve and reject still
 * answered 404 (their Form Requests), while handover answered 403:
 * HandoverRequest's Gate::forUser()->authorize() raising an
 * AuthorizationException, which Laravel renders 403. That status is the
 * existence oracle spec §5.4 forbids, so the middleware is the load-
 * bearing guard for this one POST rather than a second belt.
 *
 * NOTHING IS CAUGHT HERE. bootstrap/app.php renders EVERY RuleViolated
 * from ANY Action as back()->withErrors(['rule' => __('rules.'.$code)]),
 * and back() follows the Referer — so the page's errors.rule banner
 * displays whatever code the Actions behind its forms threw. No list of
 * those codes is written down here: this phase has had five wrong
 * enumerations, and each of the three Actions can grow a refusal without
 * touching this file.
 */
class BorrowRequestController extends Controller
{
    public function index(Bookshelf $shelf, BorrowRequestQueueQuery $queue): Response
    {
        return Inertia::render('manage/borrow-requests', [
            'queues' => $queue->run(),
        ]);
    }

    public function approve(ApproveBorrowRequestRequest $request, Bookshelf $shelf, BorrowRequest $borrowRequest, ApproveBorrowRequest $approve): RedirectResponse
    {
        /** @var User $user */
        $user = $request->user();
        /** @var string $copyId */
        $copyId = $request->validated()['copy_id'];

        $result = $approve->execute($user, $borrowRequest, $copyId);

        return redirect()
            ->route('shelves.manage.borrow-requests', ['shelf' => $shelf->slug])
            ->with('success', __('rules.approve_success_flash', [
                // d/m/Y, the flash-date house rule (1c's renew precedent).
                'until' => $result['holdExpiresAt']->timezone('Asia/Ho_Chi_Minh')->format('d/m/Y'),
            ]));
    }

    public function reject(RejectBorrowRequestRequest $request, Bookshelf $shelf, BorrowRequest $borrowRequest, RejectBorrowRequest $reject): RedirectResponse
    {
        /** @var User $user */
        $user = $request->user();
        /** @var array{reason?: string|null} $validated */
        $validated = $request->validated();

        // ?? null and no branch: ruling 2 makes the box optional, and
        // RejectBorrowRequest already trims an all-whitespace reason down
        // to NULL, so an empty box and an absent field are one case here.
        $reject->execute($user, $borrowRequest, $validated['reason'] ?? null);

        return redirect()
            ->route('shelves.manage.borrow-requests', ['shelf' => $shelf->slug])
            ->with('success', __('rules.reject_request_flash'));
    }

    public function handover(Request $request, Bookshelf $shelf, BorrowRequest $borrowRequest, HandoverRequest $handover): RedirectResponse
    {
        /** @var User $user */
        $user = $request->user();

        $result = $handover->execute($user, $borrowRequest);

        return redirect()
            ->route('shelves.manage.borrow-requests', ['shelf' => $shelf->slug])
            ->with('success', __('rules.lend_success_flash_short', ['due' => Carbon::parse($result['dueOn'])->format('d/m/Y')]));
    }
}
