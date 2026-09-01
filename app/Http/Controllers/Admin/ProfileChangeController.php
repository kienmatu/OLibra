<?php

namespace App\Http\Controllers\Admin;

use App\Actions\Admin\ApproveProfileChange;
use App\Actions\Admin\RejectProfileChange;
use App\Http\Controllers\Controller;
use App\Http\Requests\Members\ApproveProfileChangeRequest;
use App\Http\Requests\Members\RejectProfileChangeRequest;
use App\Models\User;
use App\Queries\Admin\ManagerProfileChangeQueueQuery;
use Illuminate\Http\RedirectResponse;
use Inertia\Inertia;
use Inertia\Response;

/**
 * BR §16.4's "Change queue for managers and shelf admins" — the cross-shelf
 * half of the partition, and the answer to a question the shelf-level queue
 * cannot answer: who decides a MANAGER's own proposed change, when nobody
 * at their own parish may.
 *
 * BR:602 is the whole specification: "every pending profile-change proposal
 * whose subject is a manager or shelf admin anywhere in the system, the
 * shelf named on each card. Approve and reject-with-reason, the same
 * pattern the shelf-level queue already uses."
 *
 * THE SAME ACTIONS AS THE MANAGER'S SCREEN, and spec D10 says why in the
 * reference's own words: "nothing here is a second implementation of the
 * decision, only of how this surface reaches it." Both queues decide the
 * same way because the rule is the SUBJECT's role, not the viewer's — which
 * is also why sharing them is safe where 3b-ii's D4 was not: that Action
 * authorized internally as super admin, and this one reads the subject.
 *
 * WHAT IS DIFFERENT IS THE RESOLUTION, and only that. `/admin` binds no
 * tenant, so BookshelfScope throws for every read of a shelf-scoped model
 * and route model binding cannot work at all: these routes carry a bare id
 * and ManagerProfileChangeQueueQuery::find() widens for the row. The shelf
 * is then read off the ROW by the Action, never off the body — spec D10's
 * hazard, which cuts both ways: a `systemWide()` inside a shared Action
 * would disable isolation for the manager's tenant-bound path too.
 *
 * NO systemWide() IN THIS FILE. WideningArchitectureTest's own comment is
 * explicit that "a controller still never calls systemWide() itself", so
 * every widening this screen needs is the query object's, injected.
 *
 * NO PARISH UNITS ON THIS SCREEN, which is a deliberate asymmetry with the
 * shelf-level queue rather than an omission. Approve's optional re-placement
 * exists because "the queue card is where a manager re-places a READER"
 * (BR §5.6 placement is set at the parish, in the parish); every subject
 * here is a manager or shelf admin at a parish this administrator is not
 * standing in, and BR:602 asks only for "approve and reject-with-reason".
 * Sending no unit keys is a valid and complete request: ApproveProfileChange
 * touches memberships only when a key is present, so the placement is left
 * exactly as the shelf set it.
 *
 * NOTHING IS CAUGHT HERE — bootstrap/app.php renders RuleViolated as a
 * redirect carrying a Vietnamese sentence, so a card another administrator
 * has already decided answers `profile_change_not_pending` over a 302.
 */
class ProfileChangeController extends Controller
{
    public function __construct(private ManagerProfileChangeQueueQuery $queue) {}

    public function index(): Response
    {
        // No Gate call: the `/admin` group's `super-admin` middleware is
        // the whole of this screen's refusal, the shape every other
        // administration index in this directory has.
        return Inertia::render('admin/profile-changes', [
            'queue' => $this->queue->run(),
        ]);
    }

    /**
     * A STRING PARAMETER, NOT A BOUND MODEL, and it is not a shortcut: an
     * implicit binding would resolve ProfileChangeRequest through
     * BookshelfScope, which fails closed with no tenant bound — every
     * request to this route would throw before the controller ran. find()
     * widens once, deliberately, inside the sanctioned directory, and a
     * missing id becomes the 404 the binding would have produced.
     */
    public function approve(
        ApproveProfileChangeRequest $request,
        string $profileChange,
        ApproveProfileChange $approve,
    ): RedirectResponse {
        /** @var User $user */
        $user = $request->user();

        $approve->execute($user, $this->queue->find($profileChange));

        return redirect()
            ->route('admin.profile-changes')
            ->with('success', __('rules.profile_change_approved_flash'));
    }

    public function reject(
        RejectProfileChangeRequest $request,
        string $profileChange,
        RejectProfileChange $reject,
    ): RedirectResponse {
        /** @var User $user */
        $user = $request->user();
        /** @var array{reason: string} $validated */
        $validated = $request->validated();

        $reject->execute($user, $this->queue->find($profileChange), $validated['reason']);

        return redirect()
            ->route('admin.profile-changes')
            ->with('success', __('rules.profile_change_rejected_flash'));
    }
}
