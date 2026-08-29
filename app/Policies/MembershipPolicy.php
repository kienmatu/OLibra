<?php

namespace App\Policies;

use App\Models\Membership;
use App\Models\User;
use Illuminate\Support\Facades\Gate;

/**
 * BR §13.2's Members permission set: "view any, view one, approve, reject,
 * suspend, create, register on behalf, set or change credentials". Every
 * verb is a manager's; the two reader-side member verbs (propose a change,
 * approve/reject one) are Phase 3's and arrive with their own abilities.
 *
 * Like BookPolicy, every method delegates to the act-as gates — the ONE
 * place role, status and shelf-binding combine — and the $membership
 * parameter carries no shelf re-check: under a bound tenant BookshelfScope
 * means a foreign shelf's membership cannot have been resolved at all.
 *
 * DO NOT wire `view()` above to a reader's own profile page. There is a
 * THIRD deferred capability besides the two profile-change verbs this
 * docblock used to name alone: reader self-view of their own membership —
 * BR §16.2 grants readers "View personal details and propose changes to
 * them" (docs/BUSINESS-REQUIREMENTS.md:544), OPS §3.3 names the query
 * `GetMyProfile` (docs/OPERATIONS.md:69), and the reference gated it with
 * `requireSelfOrManager` (old_next/src/domain/members/policy.ts:214-223),
 * a function structurally distinct from every method here: it compares
 * the actor's OWN membership id to the target row, admitting a manager on
 * top, instead of checking act-as-manager alone. `view()` above is
 * act-as-manager only and grants a reader nothing — reaching for it from
 * a future GetMyProfile/reader profile page hands every reader a
 * permanent 403. That self-view ability is Phase 3's, same as the
 * propose/approve verbs, and does not exist yet; routes/web.php's
 * `profile.show` route — the reader's own membership record, the page
 * `GetMyProfile` would feed — is still `under-construction` for exactly
 * this reason. (Narrowed from "the `profile.*` group" at Task 16, which
 * made `profile.notifications` real: 1c gave the group `history` and
 * `overview`, 2a gave it the request withdrawal and now the bell, and none
 * of those reads a membership row, so the group-wide claim had been stale
 * for two phases. `profile.donations` is also still a placeholder, but for
 * its own reason — `GetMyDonations` is a later phase's — not this one.)
 *
 * Status-code note for whoever wires ANY of these into a controller:
 * `EnsureShelfRole` (the `role:*` route middleware) 404s a refusal —
 * BR §5.4's anti-enumeration rule, so a non-member cannot distinguish "no
 * such shelf" from "not your shelf". `Gate::authorize()` — the usual way
 * a policy method gets enforced in a controller — throws
 * AuthorizationException, which Laravel renders as 403. This policy is
 * ability-*compatible* with the middleware (both ultimately read
 * act-as-manager) but not status-code-compatible with it: authorizing
 * through `Gate::authorize()` instead of relying on the route's
 * `role:manager` middleware changes what an unauthorized caller learns.
 *
 * The §9 subject-role refinement (a manager/admin SUBJECT may only be
 * corrected by a super admin) is deliberately NOT here: it needs the
 * subject's current role read under the command's own lock, so it lives in
 * UpdateReaderProfile (Task 10), exactly where the reference kept it.
 */
class MembershipPolicy
{
    public function viewAny(User $user): bool
    {
        return Gate::forUser($user)->allows('act-as-manager');
    }

    public function view(User $user, Membership $membership): bool
    {
        return Gate::forUser($user)->allows('act-as-manager');
    }

    /** Register on behalf / manager-register — both create a membership. */
    public function create(User $user): bool
    {
        return Gate::forUser($user)->allows('act-as-manager');
    }

    public function approve(User $user, Membership $membership): bool
    {
        return Gate::forUser($user)->allows('act-as-manager');
    }

    public function reject(User $user, Membership $membership): bool
    {
        return Gate::forUser($user)->allows('act-as-manager');
    }

    public function suspend(User $user, Membership $membership): bool
    {
        return Gate::forUser($user)->allows('act-as-manager');
    }

    public function reactivate(User $user, Membership $membership): bool
    {
        return Gate::forUser($user)->allows('act-as-manager');
    }

    public function markLeft(User $user, Membership $membership): bool
    {
        return Gate::forUser($user)->allows('act-as-manager');
    }

    public function setCredentials(User $user, Membership $membership): bool
    {
        return Gate::forUser($user)->allows('act-as-manager');
    }

    /** UpdateReaderProfile's floor — the subject-role rule is the Action's. */
    public function correct(User $user, Membership $membership): bool
    {
        return Gate::forUser($user)->allows('act-as-manager');
    }
}
