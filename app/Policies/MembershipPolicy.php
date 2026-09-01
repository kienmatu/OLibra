<?php

namespace App\Policies;

use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
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
 * DO NOT wire `view()` below to a reader's own profile page — the standing
 * instruction this docblock has carried since Task 16, and Phase 3c-i
 * Task 1 obeyed it rather than repealing it. `view()` is act-as-manager
 * only and grants a reader nothing, so reaching for it from the reader's
 * own profile page would hand every reader a permanent 403. What that
 * page needs is the THIRD capability this docblock named as deferred
 * besides the two profile-change verbs: reader self-view of their own
 * membership — BR §16.2 grants readers "View personal details and propose
 * changes to them" (docs/BUSINESS-REQUIREMENTS.md:544), OPS §3.3 names the
 * query `GetMyProfile` (docs/OPERATIONS.md:67 — this docblock cited :69
 * from Task 16 until 3c-i Task 1 corrected it; :69 is `GetMyNotifications`,
 * and :68 is the `GetMyProfileChangeRequest` the same page reads), and the
 * reference gated it with `requireSelfOrManager`
 * (old_next/src/domain/members/policy.ts:204-223), a function structurally
 * distinct from every OTHER method here: it compares the actor's OWN
 * membership id to the target row, admitting a manager on top, instead of
 * checking act-as-manager alone.
 *
 * `viewSelf()` at the bottom of this class IS that ability, and it is the
 * one method whose refusal a reader can legitimately meet, so it is also
 * the one method that reads TenantContext directly rather than only
 * through a gate. `routes/web.php`'s `profile.show` — the reader's own
 * membership record, the page `GetMyProfile` feeds — stopped being
 * `under-construction` in the same commit. (Narrowed from "the `profile.*`
 * group" at Task 16, which made `profile.notifications` real: 1c gave the
 * group `history` and `overview`, 2a gave it the request withdrawal and
 * the bell, 2b gave it `donations`, and none of those reads a membership
 * row — which is what left `show` as the last placeholder in the group.)
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
    /**
     * The ONE constructor dependency in this class, and only `viewSelf()`
     * reads it. Laravel resolves a policy through the container, so the
     * scoped TenantContext ResolveTenant populated for this request is what
     * arrives here — the same instance the act-as gates read.
     */
    public function __construct(private TenantContext $tenant) {}

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

    /**
     * Phase 3c-i Task 1, spec D7/D11: the reader's own membership record —
     * `requireSelfOrManager` (old_next/src/domain/members/policy.ts:204-223)
     * in Laravel's spelling, and the only ability in this class a reader
     * ever passes.
     *
     * THE SELF HALF COMPARES MEMBERSHIP IDS, not user ids, and the
     * comparand comes from TenantContext — populated by ResolveTenant from
     * the session and the bound shelf, never from anything a caller sent.
     * The reference's own note on that line is the reason: "the self check
     * compares `ctx.actor.membershipId`… never a value the caller
     * supplied." A user-id comparison would say yes about the SAME person's
     * membership on a different shelf, which is a different row with a
     * different role and a different parish unit.
     *
     * A member with no membership on the bound shelf — a memberless super
     * admin browsing a parish (TenantContext::membership() is null for
     * them, ResolveTenant resolving only active rows) — is admitted by the
     * manager half above instead, exactly as the reference's `guest`/
     * `super_admin` note describes. The null check is what keeps that from
     * being an accident: without it a null own-membership and a null target
     * would compare equal.
     *
     * Status code: this one refuses with 403 rather than the `role:*`
     * middleware's 404, per this class's status-code note. That is not a
     * leak on the route it gates today — `shelves.profile.show` names no
     * membership in its URL and hands this method the caller's own row, so
     * the refusal is unreachable there and exists for the next caller that
     * passes a row from somewhere else.
     */
    public function viewSelf(User $user, Membership $membership): bool
    {
        if (Gate::forUser($user)->allows('act-as-manager')) {
            return true;
        }

        $own = $this->tenant->membership();

        return $own !== null && $own->id === $membership->id;
    }

    /**
     * Phase 3c-i Task 2, spec D5: the SECOND of the two reader-side member
     * verbs this class's own docblock has named as deferred — proposing a
     * change to a person's verified details. (The third, deciding one, is
     * Task 3's.)
     *
     * THE SAME requireSelfOrManager AS viewSelf, and it delegates rather
     * than restating it, because the reference gates both with that one
     * function and two copies of a self-check are two places for the
     * membership-id-versus-user-id distinction to be got wrong.
     *
     * PROPOSING IS NOT READER-ONLY. The manager half of the delegate is
     * load-bearing here rather than incidental: any manager or above may
     * propose on another person's behalf, which is the capability the
     * reference ships. A "reader proposes about themselves" gate would have
     * shipped something narrower and called it a port.
     *
     * WHAT THIS ABILITY DOES NOT DECIDE is whether the proposal may be
     * APPROVED. §9's subject-role rule — a manager/admin subject is a super
     * admin's to decide — needs the subject's role read under the deciding
     * command's own lock, so it stays out of this class exactly as it does
     * for correct().
     */
    public function propose(User $user, Membership $membership): bool
    {
        return $this->viewSelf($user, $membership);
    }

    /**
     * Phase 3c-i Task 3, spec D2: the THIRD and last of the reader-side
     * member verbs this class's docblock named as deferred — deciding a
     * proposed change, approve and reject alike.
     *
     * AND IT IS A FLOOR, NOT THE RULE. OPS §4.3 says so of its own Caller
     * line: "`manager` — a floor, not the whole rule". What actually
     * decides is derived from the SUBJECT's current role and from whether
     * the actor is one of the two parties, both of which need the subject's
     * row read inside the deciding command's own transaction. So the whole
     * of spec D2 lives in
     * App\Actions\Admin\Concerns\DecidesProfileChanges, exactly where the
     * §9 subject-role refinement lives for correct(), and this method is
     * only the "may this person decide anything at all" gate.
     *
     * NOT requireSelfOrManager, unlike propose() and viewSelf() above. The
     * self half would be precisely wrong here: nobody decides their own
     * proposal at any rank, so admitting a reader to their own row would
     * hand the Action the one caller it exists to refuse.
     *
     * A super administrator passes without a membership on the shelf at
     * all — Gate::before short-circuits every `act-as-*` ability for the
     * global flag — which is what lets the unbound `/admin` cross-shelf
     * queue reach this at all.
     */
    public function decide(User $user, Membership $membership): bool
    {
        return Gate::forUser($user)->allows('act-as-manager');
    }
}
