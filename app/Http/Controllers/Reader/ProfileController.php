<?php

namespace App\Http\Controllers\Reader;

use App\Actions\Admin\CancelProfileChange;
use App\Actions\Admin\ChangeOwnPassword;
use App\Actions\Admin\ProposeProfileChange;
use App\Http\Controllers\Controller;
use App\Http\Requests\Members\ChangeOwnPasswordRequest;
use App\Http\Requests\Members\ProposeProfileChangeRequest;
use App\Models\Bookshelf;
use App\Models\ProfileChangeRequest;
use App\Models\User;
use App\Queries\MyProfileQuery;
use App\Support\TenantContext;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
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
 * changes nothing until a manager approves it. Task 7 adds the two controls
 * that do NOT wait for a manager: `changePassword` (spec D12, BR §16.2's
 * immediate-effect control) and `cancel`, the withdrawal that gives spec
 * D4's self-exemption its first and only caller. The photograph is Task
 * 8's, and the page is still not finished.
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

    /**
     * Phase 3c-i Task 7 — withdrawing one's own pending proposal, spec D4's
     * self-exemption.
     *
     * THIS IS THE ACTION'S ONLY CALLER, and giving it one is half of what
     * this task is for. App\Actions\Admin\CancelProfileChange shipped in
     * Task 4 with tests and no HTTP route at all: neither decision queue
     * wires it (BR:580 and BR:602 list *Duyệt* and *Từ chối* on those cards
     * and nothing else, so the queues were right not to), which left the
     * capability D4 exists to grant reachable by nobody. A reader taking
     * back their own request is the whole self-exemption in that decision,
     * and this page is its home.
     *
     * THE MEMBERSHIP IS THE TENANT'S, as everywhere else on this screen —
     * which for a reader is their own row, and is what makes the Action's
     * `$membership->user_id !== $request->user_id` pairing check pass. The
     * REQUEST comes from the URL and is confined the house's usual two
     * independent ways: Bookshelf::profileChanges() under the outer group's
     * scopeBindings(), and BookshelfScope on the model. Neither layer
     * scopes by PERSON — another reader's request on this shelf binds fine
     * — and that is deliberate: `not_own_request` is the Action's answer,
     * not a 404 here, exactly as the notifications route beside this one
     * documents for its own binding.
     *
     * The gate is MembershipPolicy::cancel — requireSelfOrManager, NOT
     * decide(), which is act-as-manager-only and would 403 every reader
     * withdrawing their own.
     */
    public function cancel(
        Request $request,
        Bookshelf $shelf,
        ProfileChangeRequest $profileChange,
        CancelProfileChange $cancel,
    ): RedirectResponse {
        $membership = $this->tenant->membership();

        abort_unless($membership !== null, 404);

        /** @var User $actor */
        $actor = $request->user();

        $cancel->execute($actor, $membership, $profileChange);

        return back()->with('success', __('rules.profile_change_cancelled_flash'));
    }

    /**
     * Phase 3c-i Task 7, spec D12 — BR §16.2's other immediate-effect
     * control. Not a proposal: nothing here waits on a manager.
     *
     * NOTHING IS CAUGHT HERE either. `current_password_incorrect` and
     * `new_password_too_short` reach the reader the way every RuleViolated
     * in this application does — bootstrap/app.php's
     * back()->withErrors(['rule' => …]) — and land in the same banner at
     * the top of this page that a refused proposal does.
     */
    public function changePassword(
        ChangeOwnPasswordRequest $request,
        Bookshelf $shelf,
        ChangeOwnPassword $change,
    ): RedirectResponse {
        $membership = $this->tenant->membership();

        abort_unless($membership !== null, 404);

        /** @var User $actor */
        $actor = $request->user();
        /** @var array{current_password: string, new_password: string} $validated */
        $validated = $request->validated();

        $change->execute($actor, $membership, $validated['current_password'], $validated['new_password']);

        // The caller's OWN session is among the ones the Action just
        // deleted, so on the self path this redirect lands on the sign-in
        // screen rather than back here. That is the point of a revocation
        // and not a bug to route around — the flash is written for the
        // manager path, where the caller's session survives.
        return back()->with('success', __('rules.password_changed_flash'));
    }
}
