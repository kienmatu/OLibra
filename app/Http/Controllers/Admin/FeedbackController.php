<?php

namespace App\Http\Controllers\Admin;

use App\Actions\Admin\MarkFeedbackRead;
use App\Actions\Admin\ResolveFeedback;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Queries\Admin\FeedbackInboxQuery;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * BR §16.1's Góp ý inbox — the read half of a command that has been writable
 * since Phase 2b's schema and unreadable ever since.
 *
 * ONE SCREEN, TWO PANES, ONE READ. The list, the open message and the unread
 * count all come out of a single FeedbackInboxQuery::run() call inside one
 * transaction (spec D3), so the badge, the "n tin mới" line and the list
 * cannot disagree about what is unread. Two reads would be two instants.
 *
 * OPENING A MESSAGE DOES NOT MARK IT READ. index() is read-only; the two POSTs
 * below are the only writers, each behind its own button. An earlier draft of
 * the spec had the open and the mark in one transaction, which would have
 * written an audit row every time anybody looked at anything.
 *
 * THE TWO QUERY PARAMETERS, and why neither can produce an empty screen by
 * accident:
 *
 * - `?status=` is narrowed by FeedbackInboxQuery::filterFrom before it reaches
 *   the query, so anything outside the enum means NO FILTER rather than a
 *   filter matching nothing. The reference names the cost of the other
 *   reading: "an empty inbox that reads as 'no messages' is the shape of a bug
 *   this project has already shipped twice."
 * - `?message=` is a feedback id, and an id naming no row falls back to the
 *   top of the list rather than 404ing. It is safe in a URL: it names a row
 *   this administrator may already read in full, and the id itself discloses
 *   nothing. What is deliberately NOT in the URL is anything from the message.
 *
 * A STRING PARAMETER ON THE TWO WRITES, not a bound model — but for a
 * different reason from ProfileChangeController's. There, implicit binding was
 * impossible: ProfileChangeRequest carries BelongsToBookshelf and would resolve
 * through a BookshelfScope that fails closed with no tenant. Feedback carries
 * no scope, so binding WOULD work here; the id goes through the query object
 * anyway so that one class owns how an `/admin` caller resolves a message, and
 * a missing row is the same 404 either way.
 *
 * NOTHING IS CAUGHT HERE. bootstrap/app.php renders a RuleViolated as a
 * redirect carrying a Vietnamese sentence, the shape every other admin
 * controller relies on.
 */
class FeedbackController extends Controller
{
    public function __construct(private FeedbackInboxQuery $inbox) {}

    public function index(Request $request): Response
    {
        // No Gate call: the `/admin` group's `super-admin` middleware is the
        // whole of this screen's refusal, the shape every other
        // administration index in this directory has.
        $rawStatus = $request->query('status');
        $rawMessage = $request->query('message');

        $filter = FeedbackInboxQuery::filterFrom(is_string($rawStatus) ? $rawStatus : null);

        $page = $this->inbox->run($filter, is_string($rawMessage) ? $rawMessage : null);

        return Inertia::render('admin/feedback', [
            'messages' => $page['messages'],
            'open' => $page['open'],
            'unread' => $page['unread'],
            // THE NARROWED VALUE, NOT THE RAW ONE — so the chip the screen
            // shows as active is the filter actually applied. Echoing the raw
            // parameter back would let ?status=NEW light the *Mới* chip over
            // a list showing everything.
            'filter' => $filter?->value,
        ]);
    }

    public function markRead(Request $request, string $feedback, MarkFeedbackRead $mark): RedirectResponse
    {
        /** @var User $user */
        $user = $request->user();

        $mark->execute($user, $this->inbox->find($feedback));

        return $this->backToMessage($feedback, __('rules.feedback_read_flash'));
    }

    public function resolve(Request $request, string $feedback, ResolveFeedback $resolve): RedirectResponse
    {
        /** @var User $user */
        $user = $request->user();

        $resolve->execute($user, $this->inbox->find($feedback));

        return $this->backToMessage($feedback, __('rules.feedback_resolved_flash'));
    }

    /**
     * Back to the same message, open — never to the bare inbox.
     *
     * The list reorders under a status move (unread first), so a redirect to
     * `/admin/feedback` would leave the administrator looking at whatever
     * happens to be at the top now, with the message they just handled
     * somewhere further down. Carrying `?message=` keeps the pane they were
     * reading in front of them, which is where the flash sentence renders.
     */
    private function backToMessage(string $feedbackId, string $flash): RedirectResponse
    {
        return redirect()
            ->route('admin.feedback', ['message' => $feedbackId])
            ->with('success', $flash);
    }
}
