<?php

namespace App\Http\Controllers\Manage;

use App\Actions\Community\ApproveComment;
use App\Actions\Community\HideComment;
use App\Actions\Community\RejectComment;
use App\Enums\CommentStatus;
use App\Http\Controllers\Controller;
use App\Http\Requests\Community\HideCommentRequest;
use App\Http\Requests\Community\RejectCommentRequest;
use App\Models\Bookshelf;
use App\Models\Comment;
use App\Models\User;
use App\Queries\CommentModerationQuery;
use App\Support\QueryParam;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * BR §16.3's moderation screen — INV-9's gate with a manager behind it,
 * and the port of old_next/src/app/tu-sach/[shelf]/quan-ly/binh-luan.
 *
 * INV-9 IS NOT ENFORCED HERE AND MUST NOT BE. "A comment is publicly
 * visible only when approved" lives in the read path's status predicate
 * (BookCommentsQuery); this screen is where a manager CHANGES a status,
 * which is a different thing from where the rule is kept. A moderation
 * screen that also filtered would be a second definition of visibility
 * that a book page could disagree with — the reference's own argument,
 * which ApproveComment's docblock states for the command side.
 *
 * ONE LIST PER RENDER, NEVER FOUR. index() fetches the queue or one
 * archive, and the four chip numbers come from counts() — a single
 * grouped statement — so a click on a chip costs the one query its own
 * list needs. Counting the chips off the rendered list instead would
 * understate every archive, because decided() is capped;
 * ManagerModerationScreenTest seeds twelve approved rows against that cap
 * and asserts the chip still says twelve.
 *
 * THE PENDING BRANCH IS NOT A STYLE CHOICE. CommentModerationQuery::
 * decided() throws InvalidArgumentException on CommentStatus::Pending,
 * and its docblock says why: unguarded it would answer a capped,
 * newest-first pending list where queue() is uncapped and oldest-first —
 * a different cardinality and the opposite order under the same chip. So
 * pending goes to queue() and the other three to decided(), and
 * decided($status) is never called on a variable that can hold Pending.
 *
 * NO "TẤT CẢ" CHIP, unlike the readers list's status chips. The four
 * statuses partition the comments table and this screen has no query that
 * reads them combined, so a merged chip would either be one status's list
 * wearing an "every comment" label or cost exactly what the cap exists to
 * avoid. That is why an absent OR unrecognised ?status= resolves to
 * `pending` — this screen's own default view — rather than to "no
 * filter": see index() for the two halves of that narrowing.
 *
 * WHAT PRODUCES THE 404 for a non-manager: the route group's
 * role:manager, and on this class's routes only that. RE-MEASURED here
 * rather than argued from BorrowRequestController's numbers, which are
 * about different routes. With role:manager dropped from the manage
 * group and a shelf READER acting, the four routes answered:
 *
 * - GET /comments              -> 200. This read has no gate of its own;
 *                                 neither the controller nor
 *                                 CommentModerationQuery checks one.
 * - POST .../approve           -> 403.
 * - POST .../reject            -> 404, RejectCommentRequest::authorize.
 * - POST .../hide              -> 404, HideCommentRequest::authorize.
 *
 * The 403 was traced to its producer rather than attributed by reading:
 * with the middleware still off AND ApproveComment's
 * Gate::forUser()->authorize('approve', …) line commented out, that same
 * POST answered 302 — the success redirect — so that line is what raises
 * the AuthorizationException Laravel renders as 403. A 403 is the
 * existence oracle spec §5.4 forbids, so on this page the middleware is
 * the load-bearing guard for the GET and for that one POST, and a
 * backstop for the two that carry a Form Request.
 *
 * The other direction was measured too: with role:manager back ON,
 * deleting the abort_unless(…, 404) from BOTH Form Requests left all four
 * of ManagerModerationScreenTest's reader blocks green. So today
 * EnsureShelfRole answers before either Form Request does, and both
 * abort_unless lines are restored, unpinned by this file's own tests and
 * kept for the day the middleware moves.
 *
 * NOTHING IS CAUGHT HERE. bootstrap/app.php — opened, not recalled —
 * registers one render callback for RuleViolated and it returns
 * back()->withErrors(['rule' => __('rules.'.$e->code)]). Measured on this
 * screen rather than assumed to reach it: a second hide against an
 * already-hidden row, posted with a Referer of .../manage/comments
 * ?status=approved, answered 302 to that same URL with errors.rule =
 * "Chỉ có thể ẩn bình luận đang hiển thị." — a redirect back onto the
 * archive being read, carrying the sentence, never a 404 or a 500. No
 * list of codes is written down here; the Actions' own docblocks carry
 * them, and each is free to grow a refusal without touching this file.
 */
class CommentModerationController extends Controller
{
    public function index(Request $request, Bookshelf $shelf, CommentModerationQuery $comments): Response
    {
        // TWO HALVES, because one of them cannot do the other's job.
        // QueryParam::first's $default fires only when the resolved value
        // is null, which covers an absent key and an array that bottoms
        // out empty — it does not cover `?status=banana`, which resolves
        // to a perfectly non-null string. tryFrom plus the coalesce is
        // what turns that string into this screen's default view instead
        // of a ValueError.
        $status = CommentStatus::tryFrom(
            (string) QueryParam::first($request, 'status', CommentStatus::Pending->value)
        ) ?? CommentStatus::Pending;

        return Inertia::render('manage/comments', [
            'status' => $status->value,
            'counts' => $comments->counts(),
            'comments' => $status === CommentStatus::Pending
                ? $comments->queue()
                : $comments->decided($status),
        ]);
    }

    /**
     * BODILESS, AND THEREFORE CARRYING NO FORM REQUEST — the ruling this
     * project already made for handover and release: a POST does not
     * acquire a Form Request solely to hold an abort_unless(…, 404).
     * Nothing is chosen here; the row and the transition are both fixed
     * by the route.
     *
     * That is why this method is the one on this class whose refusal
     * would be a 403 rather than a 404 with the middleware off — see the
     * class docblock for the measurement, and note that it is unreachable
     * while role:manager stands.
     */
    public function approve(Request $request, Bookshelf $shelf, Comment $comment, ApproveComment $approve): RedirectResponse
    {
        /** @var User $user */
        $user = $request->user();

        $approve->execute($user, $comment);

        // back(), not a named redirect, and the same choice in reject()
        // and hide() below: this screen's list is chosen by ?status=, and
        // a redirect to the bare route would drop the manager out of the
        // archive they were reading and back onto the queue after every
        // tap. Measured with a Referer of .../manage/comments
        // ?status=approved on the hide POST — the 302 landed on that same
        // URL, filter intact.
        return back()->with('success', __('rules.comment_approved_flash'));
    }

    public function reject(RejectCommentRequest $request, Bookshelf $shelf, Comment $comment, RejectComment $reject): RedirectResponse
    {
        /** @var User $user */
        $user = $request->user();
        /** @var string $reason */
        $reason = $request->validated()['reason'];

        $reject->execute($user, $comment, $reason);

        return back()->with('success', __('rules.comment_rejected_flash'));
    }

    public function hide(HideCommentRequest $request, Bookshelf $shelf, Comment $comment, HideComment $hide): RedirectResponse
    {
        /** @var User $user */
        $user = $request->user();
        /** @var array{reason?: string|null} $validated */
        $validated = $request->validated();

        // ?? null and no branch: `nullable` lets the field arrive absent,
        // and HideComment already trims an all-whitespace reason down to
        // null, so an empty box and an absent field are one case here.
        $hide->execute($user, $comment, $validated['reason'] ?? null);

        return back()->with('success', __('rules.comment_hidden_flash'));
    }
}
