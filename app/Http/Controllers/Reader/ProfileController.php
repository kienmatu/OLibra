<?php

namespace App\Http\Controllers\Reader;

use App\Http\Controllers\Controller;
use App\Models\Bookshelf;
use App\Queries\MyProfileQuery;
use App\Support\TenantContext;
use Illuminate\Support\Facades\Gate;
use Inertia\Inertia;
use Inertia\Response;

/**
 * BR §16.2's "View personal details" — the reader's own membership record,
 * at `shelves.profile.show`. Phase 3c-i Task 1; the route rendered
 * ShellController::underConstruction until this commit.
 *
 * READ-ONLY, AND THAT IS THIS TASK'S SCOPE RATHER THAN THE SCREEN'S FINAL
 * SHAPE. BR:83 — "changing your own details is a request, not an edit" —
 * needs ProposeProfileChange, which is Task 2's; the password form is
 * Task 7's and the avatar Task 8's. What ships here is the half a reader
 * needs before any of them exists: their verified details, their parish
 * unit under this shelf's own name for the level, and what happened to the
 * proposal they already sent.
 *
 * THE MEMBERSHIP COMES FROM TenantContext, NEVER FROM THE URL. This route
 * names no membership — a reader cannot ask for somebody else's profile by
 * editing an address — and ResolveTenant is the only thing that puts a
 * membership there, from the session and the bound shelf.
 * MembershipPolicy::viewSelf is authorized anyway, and deliberately: it is
 * the ability BR §16.2 grants, the gate is where a reader's own row is
 * distinguished from anyone else's, and leaving it out would make the next
 * caller's mistake silent instead of a refusal.
 *
 * NULL MEMBERSHIP IS A LIVE STATE, not a defensive branch — the same one
 * DonationController documents at length. AppServiceProvider's
 * Gate::before grants every act-as-* ability to a super admin, so
 * `role:reader` admits one to a shelf they hold no membership of, and
 * ResolveTenant resolves only ACTIVE memberships. There is no profile to
 * render for such a caller: MyProfileQuery reads a Membership, and a
 * caller with none has no record on this shelf. The page says so rather
 * than 404ing, matching the reference's NotAReaderNotice on the same
 * branch.
 */
class ProfileController extends Controller
{
    public function __construct(private TenantContext $tenant) {}

    public function show(Bookshelf $shelf, MyProfileQuery $profile): Response
    {
        $membership = $this->tenant->membership();

        if ($membership === null) {
            return Inertia::render('shelves/profile/index', [
                'isMember' => false,
                'profile' => null,
            ]);
        }

        Gate::authorize('viewSelf', $membership);

        return Inertia::render('shelves/profile/index', [
            'isMember' => true,
            'profile' => $profile->run($membership),
        ]);
    }
}
