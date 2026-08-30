<?php

namespace App\Http\Controllers\Reader;

use App\Actions\Community\OfferDonation;
use App\Http\Controllers\Controller;
use App\Http\Requests\Community\OfferDonationRequest;
use App\Models\Bookshelf;
use App\Models\User;
use App\Queries\MyDonationsQuery;
use App\Support\TenantContext;
use Illuminate\Http\RedirectResponse;
use Inertia\Inertia;
use Inertia\Response;

/**
 * BR §16.2's Tặng sách, all three ends of it: the offer form
 * (`shelves.donate`), the POST that stores an offer, and the reader's own
 * list of what they offered and what was decided
 * (`shelves.profile.donations`).
 *
 * TWO ROUTE GROUPS, ONE CONTROLLER, AND THAT SPLIT IS THIS PORT'S, NOT THE
 * REFERENCE'S — said plainly because the neighbouring paragraph cites the
 * reference and the two must not be read as one claim. The reference has
 * ONE screen: old_next/src/app/tu-sach/[shelf]/(doc-gia)/ho-so/
 * tang-sach/page.tsx (opened) renders the offer form and the list of past
 * offers together, and old_next/src/app/tu-sach/[shelf]/(doc-gia)/
 * tang-sach/page.tsx (opened) is a `redirect()` pointing the second address
 * at the first. What IS the reference's, in its own words, is why the
 * surviving screen lives under `ho-so/`: "OPS §3.2's `GetMyDonations` is
 * scoped to `ctx.actor.membershipId` — the list of *my* offers and what
 * happened to each — which puts it under `ho-so/` with the reader's other
 * pages".
 *
 * Here the two halves are two pages because the plan keeps both
 * placeholders' route NAMES, and the placeholders already sat in the two
 * groups: `shelves.donate` in the reader group, `shelves.profile.donations`
 * in the profile group.
 *
 * WHY THE FORM IS A PAGE HERE AND NOT A REDIRECT. Redirecting `donate` at
 * `profile/donations` would send a reader who came to offer books to a page
 * listing what they already offered, because this port's list page does not
 * carry the form the reference's did. docs/known-gaps.md still advises
 * modelling `donate` as a redirect and is stale in that half — Task 20
 * amends it, and this task's report carries what else that entry got wrong.
 *
 * NULL MEMBERSHIP IS A LIVE STATE ON BOTH GETs, not a defensive branch.
 * AppServiceProvider's Gate::before grants every act-as-* ability to a
 * super admin, so `role:reader` admits one to a shelf they hold no
 * membership of, and ResolveTenant resolves only ACTIVE memberships. What
 * the two methods do with it differs by what the screen is for:
 * `create` still renders, with `isMember` false so the page can say who may
 * offer instead of showing a box that OfferDonation would refuse
 * (`not_permitted`, which Task 15's OfferDonationTest posts); `mine`
 * returns no rows, because MyDonationsQuery::run takes a Membership and a
 * caller with none has offered nothing through this application.
 *
 * No RuleViolated is caught here — whichever of OfferDonation's codes a
 * reader meets, bootstrap/app.php renders it once, for the whole app, as
 * back()->withErrors(['rule' => ...]). The Action's own docblock is where
 * the codes and their reasons live; repeating a list of them here would be
 * a second copy to go stale.
 */
class DonationController extends Controller
{
    public function __construct(private TenantContext $tenant) {}

    public function create(Bookshelf $shelf): Response
    {
        return Inertia::render('shelves/donate', [
            'isMember' => $this->tenant->membership() !== null,
        ]);
    }

    public function store(OfferDonationRequest $request, Bookshelf $shelf, OfferDonation $offer): RedirectResponse
    {
        /** @var User $user */
        $user = $request->user();

        $count = $request->validated('estimated_count');

        $offer->execute(
            $user,
            (string) $request->validated('description'),
            $count === null ? null : (int) $count,
        );

        return back()->with('success', __('rules.donation_offered_flash'));
    }

    public function mine(Bookshelf $shelf, MyDonationsQuery $query): Response
    {
        $membership = $this->tenant->membership();

        return Inertia::render('shelves/profile/donations', [
            'isMember' => $membership !== null,
            'mine' => $membership === null ? [] : $query->run($membership),
        ]);
    }
}
