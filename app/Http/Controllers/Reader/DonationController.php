<?php

namespace App\Http\Controllers\Reader;

use App\Actions\Community\OfferDonation;
use App\Http\Controllers\Controller;
use App\Http\Requests\Community\OfferDonationRequest;
use App\Models\Bookshelf;
use App\Models\User;
use Illuminate\Http\RedirectResponse;

/**
 * BR §16.2's Tặng sách, POST half only. The offer FORM and the reader's
 * own list of offers are Task 18's, which keeps the `shelves.donate`
 * route name and turns that placeholder GET into a real page; this class
 * exists now because the plan gives Task 15 the over-HTTP pin for a
 * memberless super admin (its divergence 4), and a pin over HTTP needs
 * an address to post to.
 *
 * No RuleViolated is caught here — whichever of OfferDonation's codes a
 * reader meets, bootstrap/app.php renders it once, for the whole app, as
 * back()->withErrors(['rule' => ...]). The Action's own docblock is
 * where the codes and their reasons live; repeating a list of them here
 * would be a second copy to go stale.
 */
class DonationController extends Controller
{
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
}
