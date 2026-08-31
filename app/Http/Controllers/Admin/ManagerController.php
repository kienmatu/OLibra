<?php

namespace App\Http\Controllers\Admin;

use App\Actions\Admin\AssignManager;
use App\Actions\Admin\PromoteSuperAdmin;
use App\Actions\Admin\RevokeManager;
use App\Enums\MembershipRole;
use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\AssignManagerRequest;
use App\Models\Bookshelf;
use App\Models\User;
use App\Queries\Admin\ManagerCandidatesQuery;
use App\Queries\Admin\ManagersListQuery;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Inertia\Inertia;
use Inertia\Response;

/**
 * OPS §3.4's `GetManagersList` screen and OPS §4.5's three grants — the last
 * `underConstruction` placeholder in the `/admin` area. Spec D5, D7.
 *
 * **The cross-shelf reads are Queries', the writes are Actions', and this
 * class does neither.** The `/admin` group binds no tenant, so a scoped
 * model touched from here would throw in `BookshelfScope`; widening and the
 * audit configurator are both fenced to `app/Queries/Admin/` and
 * `app/Actions/Admin/` by `WideningArchitectureTest`. What is left here is
 * the three things a controller is for — which component renders, which
 * route a redirect lands on, and which sentence flashes.
 *
 * **The revoke confirmation is a prop, not a `lang` key the screen happens
 * to reach for.** BR §16.4 requires a confirmation that names the person and
 * the shelf and states plainly that history is retained, so the sentence is
 * assembled server-side with both names substituted in and sent down per
 * row. A key alone would let the screen render an unsubstituted `:name`, or
 * nothing at all, with the requirement's own test still green.
 */
class ManagerController extends Controller
{
    public function index(ManagersListQuery $managers, ManagerCandidatesQuery $candidates): Response
    {
        // Redundant with EnsureSuperAdmin today, and kept for the reason
        // ShelfController::index states: the mutating routes below all
        // authorize, and a list that authorized nothing would be the one
        // screen in the group whose permission was implicit.
        Gate::authorize('viewAny', Bookshelf::class);

        $rows = $managers->run();

        return Inertia::render('admin/managers/index', [
            // Each row carries its own confirmation sentence, already
            // naming the person and the shelf — see this class's docblock.
            // A super administrator's row carries none, because there is no
            // demotion command to confirm (spec D5).
            'managers' => array_map(fn (array $row): array => [
                ...$row,
                'revokeConfirmation' => $row['membershipId'] === null
                    ? null
                    : __('rules.membership_role_revoke_confirm', [
                        'name' => $row['fullName'],
                        'shelf' => (string) $row['shelfName'],
                    ]),
            ], $rows),
            'appointable' => $candidates->run(),
        ]);
    }

    /**
     * The appoint form's submit. `{bookshelf}` binds by slug — Bookshelf is
     * not a scoped model, so implicit binding works here where it could not
     * for a membership.
     */
    public function store(
        AssignManagerRequest $request,
        Bookshelf $bookshelf,
        AssignManager $assign,
    ): RedirectResponse {
        /** @var User $user */
        $user = $request->user();
        $validated = $request->validated();

        $assign->execute(
            $user,
            $bookshelf,
            $validated['user_id'],
            MembershipRole::from($validated['role']),
        );

        return redirect()
            ->route('admin.managers')
            ->with('success', __('rules.membership_role_assigned_flash'));
    }

    /**
     * `{membership}` IS A STRING HERE, NOT A BOUND MODEL, AND THAT IS
     * LOAD-BEARING. `Membership` carries `BelongsToBookshelf`, so implicit
     * route-model binding would resolve it through `BookshelfScope`, which
     * throws when nothing is bound — and the `/admin` group binds nothing by
     * design (spec D0). Type-hinting the model here would 500 every request
     * to this route before the controller body ran. The command reads the
     * row through the shelf's own relation instead, which is also what
     * confines a hand-posted id to the shelf named in the URL.
     */
    public function revoke(
        Request $request,
        Bookshelf $bookshelf,
        string $membership,
        RevokeManager $revoke,
    ): RedirectResponse {
        /** @var User $user */
        $user = $request->user();

        $revoke->execute($user, $bookshelf, $membership);

        return redirect()
            ->route('admin.managers')
            ->with('success', __('rules.membership_role_revoked_flash'));
    }

    /**
     * The global grant. `{user}` binds implicitly — `User` is not a scoped
     * model and its soft-delete keeps a deleted person from resolving at
     * all, so a promotion cannot name somebody who is gone.
     */
    public function promote(
        Request $request,
        User $user,
        PromoteSuperAdmin $promote,
    ): RedirectResponse {
        /** @var User $actor */
        $actor = $request->user();

        $promote->execute($actor, $user);

        return redirect()
            ->route('admin.managers')
            ->with('success', __('rules.user_promoted_super_admin_flash'));
    }
}
