<?php

namespace App\Http\Controllers\Reader;

use App\Actions\Circulation\CancelOwnRequest;
use App\Actions\Circulation\CreateBorrowRequest;
use App\Http\Controllers\Controller;
use App\Models\Book;
use App\Models\Bookshelf;
use App\Models\BorrowRequest;
use App\Models\User;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;

/**
 * BR §16.1's "Xin mượn" and its withdrawal. No Form Request: neither
 * POST carries a field — the book and the request are route-bound, the
 * membership is the session's (plan divergence 4) — and authorization is
 * the role middleware plus the Action's own Gate (the renew-POST shape).
 *
 * WHAT PRODUCES THE 404, since there is no Form Request here to carry the
 * abort_unless(Gate::allows(...), 404) the rest of this phase uses: the
 * route middleware, and only the route middleware. Both routes sit in
 * `role:reader` groups, and EnsureShelfRole abort(404)s when
 * Gate::allows('act-as-reader') is false — spec §5.4's rule that the URL
 * space must not confirm what exists. The Actions below then ask the SAME
 * ability through BorrowRequestPolicy::create/cancel, so a caller who
 * reached this class has already been allowed it and the
 * AuthorizationException branch (which Laravel renders 403, not 404) is
 * not what any HTTP caller meets. That is a property of the routes, not
 * of this file, so it is pinned as one: ReaderRequestSurfaceTest's two
 * non-member blocks assert 404 on both POSTs, and
 * CirculationArchitectureTest asserts role:reader is on both routes.
 *
 * Ownership of a request is NOT checked here and must not be. It is
 * CancelOwnRequest's not_own_request — a Vietnamese sentence over a 302,
 * the same shape every other refusal takes — because a controller- or
 * policy-level 403 would confirm to a stranger that the id exists.
 *
 * Both Actions can also throw RuleViolated (duplicate_request,
 * not_permitted, request_already_fulfilled, …). Nothing is caught here:
 * bootstrap/app.php renders it once, for the whole app, as
 * back()->withErrors(['rule' => __('rules.'.$code)]), which the book page
 * reads off the shared `errors` prop. not_permitted in particular is a
 * live path rather than defence in depth — a super admin who is not a
 * member of this shelf passes Gate::before and arrives with a null
 * membership — so that redirect is a real reader's real answer, and
 * ReaderRequestSurfaceTest follows it onto the rendered page.
 */
class BorrowRequestController extends Controller
{
    public function store(Request $request, Bookshelf $shelf, Book $book, CreateBorrowRequest $create): RedirectResponse
    {
        // The SAME guard the sibling GET carries (Reader\BookController:25,
        // "hidden means absent"), and it has to be repeated because the
        // binding resolves drafts — the manager route shares the model —
        // and neither CreateBorrowRequest nor BookPolicy reads
        // is_published. Without it, {book} being a slug makes this URL
        // guessable and a draft would answer 302 + success where a
        // nonexistent slug answers 404: an existence oracle over
        // unpublished titles (spec §5.4), and a queue row on the manager's
        // screen for a book no reader can see. The reference leaves the
        // check out on the premise that a draft is one a reader has no URL
        // for; this controller is what created the URL, so the premise no
        // longer holds. Measured before the fix: the draft POST returned
        // 302, not 404.
        abort_unless($book->is_published, 404);

        /** @var User $user */
        $user = $request->user();
        $create->execute($user, $book);

        return back()->with('success', __('rules.request_success_flash'));
    }

    public function cancel(Request $request, Bookshelf $shelf, BorrowRequest $borrowRequest, CancelOwnRequest $cancel): RedirectResponse
    {
        /** @var User $user */
        $user = $request->user();
        $cancel->execute($user, $borrowRequest);

        return back()->with('success', __('rules.request_cancel_flash'));
    }
}
