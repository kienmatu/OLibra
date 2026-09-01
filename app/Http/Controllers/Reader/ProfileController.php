<?php

namespace App\Http\Controllers\Reader;

use App\Actions\Admin\ProposeProfileChange;
use App\Http\Controllers\Controller;
use App\Http\Requests\Members\ProposeProfileChangeRequest;
use App\Models\Bookshelf;
use App\Models\User;
use App\Queries\MyProfileQuery;
use App\Support\TenantContext;
use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Facades\Gate;
use Inertia\Inertia;
use Inertia\Response;

/**
 * BR §16.2's "View personal details" — the reader's own membership record,
 * at `shelves.profile.show`. Phase 3c-i Task 1; the route rendered
 * ShellController::underConstruction until this commit.
 *
 * NOT READ-ONLY ANY MORE. Task 1 shipped the view alone and said so on the
 * page; Task 2 adds `propose`, the POST behind BR:83's "changing your own
 * details is a request, not an edit", so the screen now carries a form that
 * changes nothing until a manager approves it. The password form is Task
 * 7's and the photograph Task 8's, and the page is still not finished.
 *
 * NO RuleViolated IS CAUGHT HERE — whichever of ProposeProfileChange's
 * codes a reader meets, bootstrap/app.php renders it once, for the whole
 * app, as back()->withErrors(['rule' => …]). The Action's own docblock is
 * where the codes and their reasons live; a list of them here would be a
 * second copy to go stale.
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

    /**
     * BR §16.2's other half — "propose changes to them".
     *
     * THE MEMBERSHIP COMES FROM TenantContext HERE TOO, never from the
     * body. The Action takes a Membership rather than a user id precisely
     * so that a caller cannot name a person; this route hands it the row
     * ResolveTenant put there. A memberless caller — the super admin
     * `role:reader` admits to a shelf they hold no membership of — has no
     * record here to propose about, and 404s for the same anti-enumeration
     * reason the request class's own backstop does.
     */
    public function propose(
        ProposeProfileChangeRequest $request,
        Bookshelf $shelf,
        ProposeProfileChange $propose,
    ): RedirectResponse {
        $membership = $this->tenant->membership();

        abort_unless($membership !== null, 404);

        /** @var User $actor */
        $actor = $request->user();

        $propose->execute($actor, $membership, $request->validated());

        return back()->with('success', __('rules.profile_change_proposed_flash'));
    }
}
