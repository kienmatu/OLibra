<?php

namespace App\Http\Controllers\Manage;

use App\Actions\Admin\ApproveProfileChange;
use App\Actions\Admin\RejectProfileChange;
use App\Http\Controllers\Controller;
use App\Http\Requests\Members\ApproveProfileChangeRequest;
use App\Http\Requests\Members\RejectProfileChangeRequest;
use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\ProfileChangeRequest;
use App\Models\User;
use App\Queries\ParishContextQuery;
use App\Queries\ProfileChangeQueueQuery;
use App\Support\Members\ParishUnits;
use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Facades\Gate;
use Inertia\Inertia;
use Inertia\Response;

/**
 * BR §16.3's *Đổi thông tin* — the shelf's own change queue, and the last
 * of this group's placeholders that the profile-change lifecycle needed.
 *
 * ONE CARD PER READER-SUBJECT PROPOSAL, and the predicate is
 * App\Queries\ProfileChangeQueueQuery's, shared with the nav badge. BR:580
 * says why a manager's own proposal is deliberately absent — "nobody
 * present may decide it" — and where it goes instead: the super
 * administrator's own queue at /admin/profile-changes.
 *
 * A TENANT-BOUND CONTROLLER REACHING app/Actions/Admin/. That directory is
 * fenced for what it may CALL (TenantContext::systemWide and the audit
 * configurator), never for who may call it — spec D10 puts the decide
 * Actions there because ProfileChangeRequest carries BelongsToBookshelf and
 * BookshelfScope therefore throws for the unbound `/admin` caller, and says
 * in the same breath that "nothing fences callers of that directory, so the
 * manager's tenant-bound controller reaches it cleanly". This file is that
 * caller.
 *
 * THE SHELF NEVER COMES FROM THE BODY, on this path or the other one. The
 * row is resolved through Bookshelf::profileChanges() under the outer
 * group's scopeBindings() — plus BookshelfScope on the model itself, the
 * house's usual two independent layers — and the Action then reads the
 * shelf off the ROW it is handed
 * (DecidesProfileChanges::requestShelf). Spec D10's hazard is the reverse
 * of the obvious one: a shared Action that trusted a shelf id in a post
 * would disable tenant isolation for THIS path too, not merely for the
 * admin one. The reference measured it — a hidden shelf field once let a
 * mismatched post file an approval against the wrong parish.
 *
 * APPROVE CARRIES THE PARISH UNITS, which is why index() below sends the
 * taxonomy and the unit lists as well as the cards. Spec D3 gave
 * ApproveProfileChange optional parish-unit ids and this screen is where
 * they are for: BR §5.6's placement is a manager's to set, a reader can
 * only ask, and the card in front of a manager deciding a change is exactly
 * the moment they know which đơn vị the family is now in. The Action
 * validates the RESULTING pair, not the supplied half, so a shelf that
 * nests level 2 under level 1 cannot be left half-moved.
 *
 * THE LABELS ARE THE SHELF'S OWN (BR:247, BR:578) — level1_label and
 * level2_label off ParishTaxonomy, never the words "Tổ" or "Giáo họ" written
 * into a screen. ParishContextQuery is the same read the reader's own page
 * and the registration form make.
 *
 * NOTHING IS CAUGHT HERE. bootstrap/app.php renders RuleViolated as
 * back()->withErrors(['rule' => …]), so deciding a card another manager has
 * already decided lands back on the queue carrying
 * `profile_change_not_pending` as a Vietnamese sentence over a 302 — never
 * a 404 and never a 500. The Actions' own docblocks carry their codes; a
 * list of them here would be a second copy to go stale.
 */
class ProfileChangeController extends Controller
{
    public function index(Bookshelf $shelf, ProfileChangeQueueQuery $queue, ParishContextQuery $parish): Response
    {
        // The screen's own floor. `role:manager` on the group is what
        // actually refuses a reader (and 404s them, per spec §5.4), and
        // this is the same gate asked of the Policy — the shape
        // RegistrationQueueController::index uses on the queue beside this
        // one.
        Gate::authorize('viewAny', Membership::class);

        $context = $parish->run();
        $taxonomy = $context['taxonomy'];

        // LIVE UNITS ONLY, through ParishUnits::options — OFFERING is the
        // picker's rule, where a deleted unit stays valid history. The same
        // filter RegistrationController and ReaderController apply for the
        // same reason: ParishContextQuery deliberately returns deletedAt
        // for every unit, so an unfiltered pass-through would offer a
        // retired đơn vị as somewhere to move a family to.
        //
        // THE FOUR KEYS ParishUnitFields DECLARES, parentId included: on a
        // nested shelf the level-2 options follow the chosen parent, and a
        // payload without parentId silently offers every level-2 unit under
        // every level-1 one.
        $units = collect([
            ...ParishUnits::options($context['units'], 1),
            ...ParishUnits::options($context['units'], 2),
        ])->map(fn (array $unit): array => [
            'id' => $unit['id'], 'level' => $unit['level'],
            'parentId' => $unit['parentId'], 'name' => $unit['name'],
        ])->values()->all();

        return Inertia::render('manage/profile-changes', [
            'queue' => $queue->run(),
            'taxonomy' => [
                'levels' => $taxonomy->levels,
                'nested' => $taxonomy->nested,
                'level1Label' => $taxonomy->level1Label,
                'level2Label' => $taxonomy->level2Label,
            ],
            'units' => $units,
        ]);
    }

    /**
     * *Duyệt*, with the optional re-placement.
     *
     * THE ACTION TAKES A RESOLVED ROW, not an id (spec D3): the manager's
     * path resolves it under BookshelfScope, the `/admin` path widens for
     * it deliberately, and the command itself is identical either way. The
     * body reaches it as `$request->validated()` untouched — absent keys
     * stay absent, which is how "leave the placement alone" is spelled.
     */
    public function approve(
        ApproveProfileChangeRequest $request,
        Bookshelf $shelf,
        ProfileChangeRequest $profileChange,
        ApproveProfileChange $approve,
    ): RedirectResponse {
        /** @var User $user */
        $user = $request->user();

        $approve->execute($user, $profileChange, $request->validated());

        return redirect()
            ->route('shelves.manage.profile-changes', ['shelf' => $shelf->slug])
            ->with('success', __('rules.profile_change_approved_flash'));
    }

    public function reject(
        RejectProfileChangeRequest $request,
        Bookshelf $shelf,
        ProfileChangeRequest $profileChange,
        RejectProfileChange $reject,
    ): RedirectResponse {
        /** @var User $user */
        $user = $request->user();
        /** @var array{reason: string} $validated */
        $validated = $request->validated();

        $reject->execute($user, $profileChange, $validated['reason']);

        return redirect()
            ->route('shelves.manage.profile-changes', ['shelf' => $shelf->slug])
            ->with('success', __('rules.profile_change_rejected_flash'));
    }
}
