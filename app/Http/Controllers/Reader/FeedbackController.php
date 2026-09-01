<?php

namespace App\Http\Controllers\Reader;

use App\Actions\Community\SubmitFeedback;
use App\Http\Controllers\Controller;
use App\Http\Requests\Community\SubmitFeedbackRequest;
use App\Models\Bookshelf;
use Illuminate\Http\RedirectResponse;
use Inertia\Inertia;
use Inertia\Response;

/**
 * BR §16.1's Góp ý — a message to the people who keep the shelf, and the
 * last of the reader area's placeholders.
 *
 * IN Reader/ BUT NOT GATED ON A READER, which is the one thing to know
 * before reading anything else here. The directory names the reference's
 * route group (`tu-sach/[shelf]/(doc-gia)/gop-y`), not a role floor: both
 * methods below sit OUTSIDE routes/web.php's `['auth', 'role:reader']`
 * group, deliberately, and both are reachable by a signed-out visitor and
 * by a signed-in non-member. The reference's `gop-y` page is the single
 * page under that route group that reads the shelf with `readShelf`
 * rather than `readShelfIdentity` — no `requireReader` at all — because
 * `submitFeedback` takes neither `requireReader` nor
 * `requireIdentifiedActor`. RouteOrderTest:117 records the same intent
 * from the other side, as an EXEMPTION rather than a pin: `feedback` is
 * removed from the reader-area role-gate sweep, so adding `role:reader`
 * to these two lines would leave the whole suite green and quietly shut
 * the door on the sender the page is for. HandleInertiaRequests:83-86
 * carries it a third time — the notification bell's third clause exists
 * because a signed-in non-member reaches THIS page with both a user and a
 * shelf bound.
 *
 * THE SHELF COMES FROM THE URI. `$shelf` is the route binding, the
 * `tenant` middleware has already bound it as the tenant, and
 * SubmitFeedback reads it off TenantContext — so this controller never
 * names it, and SubmitFeedbackRequest gives the body no field that could.
 * A message filed here can only belong to the shelf whose address the
 * sender was on.
 *
 * NO `$siteWide` ARGUMENT. Its default is false and this surface never
 * passes it; the public contact form is the one caller that does, and
 * that is a different controller with a different route and no tenant at
 * all.
 *
 * NOTHING IS REPOPULATED AFTER A REFUSAL beyond what Inertia already
 * keeps in the client-side form state. The reference states the reason
 * for its own version of this and it survives the port: the fields are a
 * person's name, phone number and message, and a server round-trip that
 * echoed them into a query string would put all three into browser
 * history, proxy logs and the address bar of a shared parish phone.
 *
 * No RuleViolated is caught here. bootstrap/app.php renders every one of
 * them, once, for the whole application, as
 * back()->withErrors(['rule' => …]) — which is how `rate_limited`,
 * `phone_invalid` and `feedback_fields_required` reach the banner on the
 * page below. SubmitFeedback's docblock is where those codes and their
 * reasons live.
 */
class FeedbackController extends Controller
{
    public function create(Bookshelf $shelf): Response
    {
        return Inertia::render('shelves/feedback', [
            // OPS §8's limit, sent as a NUMBER rather than baked into the
            // Vietnamese sentence, so the figure the form promises and the
            // figure the command enforces cannot drift apart. The
            // reference hard-codes "3" in its own copy; here one constant
            // decides both.
            'dailyLimit' => SubmitFeedback::DAILY_LIMIT,
        ]);
    }

    public function store(
        SubmitFeedbackRequest $request,
        Bookshelf $shelf,
        SubmitFeedback $submit,
    ): RedirectResponse {
        $subject = $request->validated('subject');

        $submit->execute(
            // The signed-in ACCOUNT when there is one, which is ADDITIONAL
            // attribution and never a substitute for the typed name beside
            // it (spec D1). Null for a guest, which is an ordinary state
            // on this route rather than an edge case.
            $request->user(),
            (string) $request->validated('guest_name'),
            (string) $request->validated('guest_contact'),
            $subject === null ? null : (string) $subject,
            (string) $request->validated('body'),
        );

        return back()->with('success', __('rules.feedback_submitted_flash'));
    }
}
