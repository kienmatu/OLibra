<?php

namespace App\Http\Controllers\Manage;

use App\Actions\Community\DeclineDonation;
use App\Actions\Community\ReceiveDonation;
use App\Http\Controllers\Controller;
use App\Http\Requests\Community\DeclineDonationRequest;
use App\Models\BookDonation;
use App\Models\Bookshelf;
use App\Models\User;
use App\Queries\DonationQueueQuery;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * BR §16.3's Donation queue — the manager's side of *Tặng sách*, and the
 * port of old_next/src/app/tu-sach/[shelf]/quan-ly/tang-sach/page.tsx
 * (opened) together with the two server actions it posts to
 * (receiveDonationAction and declineDonationAction in that directory's
 * actions.ts, both opened).
 *
 * THE HAND-OFF THIS PHASE SHIPS IS A NAME IN A FLASH, NOT A PRE-FILL, and
 * that divergence is stated up front rather than discovered. BR §16.3's
 * Donation queue paragraph (opened) reads: "**Duyệt** opens the add-book
 * form with **Người tặng** pre-filled with that member and moves the
 * donation to `received` (§7.7)". The reference does exactly that — its
 * receiveDonationAction ends `redirect(donor ? `${base}/sach/moi?nguoi-tang=${donor}` : …)`,
 * carrying the donor's MEMBERSHIP id into the form. Reproducing it needs a
 * member picker on that form, which docs/known-gaps.md (opened) defers
 * under "The donor member picker is deferred to 1b" for want of
 * `GetReadersList`.
 *
 * So receive() below redirects to the QUEUE and puts the donor's NAME in
 * the success flash. That fits the form as it stands rather than as it
 * will be: resources/js/pages/manage/books/create.tsx (opened at this
 * commit) carries `donor_name` in its form type, in its useForm seed, in
 * its transform (`donor_name: data.donor_name || null`) and as a Label +
 * Input + InputError — so a volunteer handed a name has somewhere to type
 * it. What is missing is the membership-LINKED pre-fill, not donor
 * capture.
 *
 * A NOTE FOR WHOEVER BUILDS THAT PRE-FILL. App\Http\Requests\Catalogue\
 * StoreBookRequest (opened) validates `donor_membership_id` as
 * `['bail', 'nullable', 'uuid', 'prohibits:donor_name']` — the two donor
 * fields are MUTUALLY EXCLUSIVE. So seeding `donor_membership_id` from a
 * queue hand-off must CLEAR the name box, not sit beside it, or the form
 * refuses on the pair.
 *
 * RECEIVING WRITES NO BOOK, and this controller does not add one. The
 * rule is App\Actions\Community\ReceiveDonation's own headline — "IT
 * WRITES NO `books` ROW AND NO `book_copies` ROW" — and OPS §4.4 (opened)
 * gives the reason in its own words: the manager "separately runs
 * `CreateBook` or `AddCopies` (§4.1, above) with `donorMembershipId` set
 * to this donor". Cataloguing is a separate command a manager runs with
 * the books in their hands, because a bag of ten books can turn out to be
 * three copies, duplicates, or nothing at all.
 *
 * THE DONOR'S NAME IS READ THROUGH THE SAME NULLSAFE CHAIN THE QUERY
 * USES. App\Queries\DonationQueueQuery's docblock records why it can be
 * null: App\Models\Membership and App\Models\User both use SoftDeletes,
 * so a trashed donor comes back as a null relation rather than dropping
 * the row. `?->` plus a cast is what turns that into an empty name in the
 * flash instead of a 500 on a row a manager was trying to clear.
 *
 * A NAMED REDIRECT, NOT back(), and the reason is the opposite of
 * CommentModerationController's. That screen's list is chosen by
 * `?status=`, so a bare route redirect would drop a manager out of the
 * archive they were reading; this queue has one view and no query string
 * to preserve, so the redirect can name where it goes — and after a
 * decision the row leaves the list either way.
 *
 * WHAT PRODUCES THE 404 for a non-manager, RE-MEASURED on these three
 * routes rather than argued from CommentModerationController's numbers,
 * which are about different routes. With `role:manager` dropped from the
 * manage group and a shelf READER acting, the three answered:
 *
 * - GET  /manage/donations           -> 200. index() below runs no Gate
 *                                      check, so with the middleware off
 *                                      there is nothing left to refuse.
 * - POST .../{donation}/receive      -> 403.
 * - POST .../{donation}/decline      -> 404, DeclineDonationRequest::
 *                                      authorize.
 *
 * The 403 was traced to its producer rather than attributed by reading:
 * with the middleware still off AND ReceiveDonation's
 * Gate::forUser()->authorize('receive', …) line commented out too, that
 * same POST answered 302 — the success redirect — so that line is what
 * raises the AuthorizationException Laravel renders as 403. A 403 is the
 * existence oracle spec §5.4 forbids, so on this screen the middleware is
 * the load-bearing guard for the GET and for the receive POST, and a
 * backstop for the one POST that carries a Form Request.
 *
 * NOTHING IS CAUGHT HERE. bootstrap/app.php registers one render callback
 * for RuleViolated and it returns back()->withErrors(['rule' => …]), so a
 * second decision on an already-decided offer lands back on the queue
 * carrying `donation_not_pending` as a Vietnamese sentence over a 302 —
 * never a 404 and never a 500. The Actions' own docblocks carry their
 * codes; a list of them here would be a second copy to go stale.
 */
class DonationController extends Controller
{
    public function index(Bookshelf $shelf, DonationQueueQuery $queue): Response
    {
        // ONE LIST, NO CHIPS. BR §16.3's paragraph describes pending
        // offers and the two decisions on them; a decided offer's
        // afterlife is the DONOR's screen (shelves.profile.donations),
        // where the decision note is the point. DonationQueueQuery::run
        // filters on DonationStatus::Pending for the same reason (read off
        // that file), so there is one list here and no chip to pick it.
        return Inertia::render('manage/donations', [
            'queue' => $queue->run(),
        ]);
    }

    /**
     * *Duyệt* — bodiless, and therefore carrying no Form Request: the
     * ruling this project already made for the handover, release and
     * comment-approve POSTs. Nothing is chosen here; the row and the
     * transition are both fixed by the route.
     */
    public function receive(Request $request, Bookshelf $shelf, BookDonation $donation, ReceiveDonation $receive): RedirectResponse
    {
        /** @var User $user */
        $user = $request->user();

        // READ BEFORE THE COMMAND, so the flash cannot report a name off a
        // row the command has since written. It makes no difference today
        // — ReceiveDonation::execute writes status, decided_by and
        // decided_at and touches neither donor column — but the reading
        // order is free and the ordering is what makes that irrelevant.
        $donorName = (string) $donation->donor?->user?->full_name;

        $receive->execute($user, $donation);

        return redirect()
            ->route('shelves.manage.donations', ['shelf' => $shelf->slug])
            ->with('success', __('rules.donation_received_flash', ['name' => $donorName]));
    }

    public function decline(DeclineDonationRequest $request, Bookshelf $shelf, BookDonation $donation, DeclineDonation $decline): RedirectResponse
    {
        /** @var User $user */
        $user = $request->user();
        /** @var string $reason */
        $reason = $request->validated()['reason'];

        $decline->execute($user, $donation, $reason);

        return redirect()
            ->route('shelves.manage.donations', ['shelf' => $shelf->slug])
            ->with('success', __('rules.donation_declined_flash'));
    }
}
