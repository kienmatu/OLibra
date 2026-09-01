<?php

declare(strict_types=1);

namespace App\Actions\Admin\Concerns;

use App\Enums\MembershipRole;
use App\Enums\ProfileChangeStatus;
use App\Exceptions\RuleViolated;
use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\ProfileChangeRequest;
use App\Models\User;
use App\Support\TenantContext;
use Illuminate\Support\Facades\Gate;

/**
 * The one copy of spec D2's decision rule and spec D3's lock discipline,
 * shared by ApproveProfileChange and RejectProfileChange — and, for the
 * subject-role half alone, by CancelProfileChange's non-self path (spec
 * D4). Port of the shared half of
 * old_next/src/domain/members/commands/approve-profile-change.ts:117-175
 * and reject-profile-change.ts:72-97.
 *
 * WRITTEN ONCE RATHER THAN TWICE ON PURPOSE. The rule has three
 * independent ways to be subtly wrong, and two hand-copied versions of it
 * are two places for any of the three to be got wrong separately — which
 * is the failure the reference itself recorded when the cancel verb was
 * left out of the routing rule.
 *
 * IT LIVES UNDER app/Actions/Admin/ BECAUSE OF THE FENCE, not because it
 * is administrative. `systemWide()` below is confined to app/Queries/Admin/
 * and app/Actions/Admin/ by WideningArchitectureTest, and a subdirectory of
 * the latter is still inside it.
 *
 * ── Why anything widens at all ───────────────────────────────────────────
 *
 * ProfileChangeRequest, Membership and ParishUnit all carry
 * BelongsToBookshelf, so BookshelfScope THROWS for the `/admin`
 * cross-shelf caller, which binds no tenant. The reads below are widened
 * and then re-narrowed BY THE ROW: the request's own id, and the request's
 * own shelf reached through its `bookshelf` relation. Never by a shelf a
 * caller sent — spec D10's hazard is precisely that a shelf taken from the
 * request body would let a mismatched post file a decision against the
 * wrong parish, and a widened Action that trusts one disables isolation
 * for the manager's tenant-bound path too.
 */
trait DecidesProfileChanges
{
    /**
     * The subject's `users` row, locked, and it is the FIRST statement of
     * every decide transaction — spec D3's ordering rule.
     *
     * The order is not taste. Reversed — profile_change_requests first,
     * then users — approve racing cancel deadlocked 3/3 in BOTH directions
     * and the loser's driver error shipped as a 500
     * (cancel-profile-change.ts:70-74). ProposeProfileChange takes the same
     * two rows in the same order from the other end.
     *
     * `users` is global, not shelf-scoped, so this one read needs no
     * widening.
     */
    private function lockSubject(ProfileChangeRequest $request): User
    {
        $person = User::query()->lockForUpdate()->find($request->user_id);

        if ($person === null) {
            throw new RuleViolated('membership_not_found');
        }

        return $person;
    }

    /**
     * The request, re-read UNDER the lock taken above.
     *
     * A STALE MODEL IS NOT A DECISION. The row the caller resolved was read
     * before the lock existed, so between that read and this one a peer
     * manager may have approved it or the reader may have withdrawn it. Its
     * refusal is `profile_change_not_pending` and NOT a not-found: the row
     * exists and the volunteer looking at it needs to be told it has
     * already been dealt with, not that it never was.
     */
    private function lockPendingRequest(ProfileChangeRequest $request): ProfileChangeRequest
    {
        $fresh = $this->tenantContext()->systemWide(
            fn (): ?ProfileChangeRequest => ProfileChangeRequest::query()
                ->whereKey($request->id)
                ->lockForUpdate()
                ->first(),
        );

        if ($fresh === null || $fresh->status !== ProfileChangeStatus::Pending) {
            throw new RuleViolated('profile_change_not_pending');
        }

        return $fresh;
    }

    /**
     * The subject's membership ON THE REQUEST'S OWN SHELF, read now.
     *
     * `m.bookshelf_id = r.bookshelf_id` is the reference's own hard-won
     * fix, restated here as a relation off the request's shelf: a subject
     * holding manager memberships at two parishes let an unqualified query
     * pick an arbitrary one, so the role the routing rule read could come
     * from the wrong shelf entirely.
     */
    private function subjectMembership(ProfileChangeRequest $request): Membership
    {
        $shelf = $this->requestShelf($request);

        $membership = $this->tenantContext()->systemWide(
            fn (): ?Membership => $shelf->memberships()
                ->where('user_id', $request->user_id)
                ->first(),
        );

        if ($membership === null) {
            throw new RuleViolated('membership_not_found');
        }

        return $membership;
    }

    /**
     * Spec D2, all three parts. Called inside the transaction, after the
     * subject's row is locked, so "at decision time" is literal.
     *
     * 1. THE SUBJECT'S ROLE IS READ NOW, not stored at proposal time. A
     *    reader promoted while their proposal sat pending becomes a
     *    subject only a super administrator may decide, and a manager
     *    demoted to reader stops being one — without anybody rewriting a
     *    column.
     *
     * 2. SELF-DECISION IS REFUSED AT EVERY RANK, super administrator
     *    included. The reference's reasoning, kept verbatim because rank is
     *    the wrong axis to argue it on: "Rank is not the question; being
     *    both parties to the decision is." Note the order below — the self
     *    check runs FIRST, because the subject-role check lets a super
     *    administrator through and would otherwise wave their own proposal
     *    past.
     *
     * 3. THE COMPARISON IS ON user_id, NOT MEMBERSHIP ID. A person with
     *    memberships at two shelves is one person, and comparing
     *    memberships would let them stand at their other parish and decide
     *    their own proposal — two different rows, the same human being on
     *    both halves of the decision. (CancelProfileChange's SELF-check is
     *    deliberately the other way round, comparing membership ids,
     *    because withdrawing your own request has no second party to it.
     *    The asymmetry is real; do not unify them.)
     *
     * The port's `atLeast` is narrower than the reference's — MembershipRole
     * has Reader/Manager/Admin and nothing else, because a super
     * administrator is the global `users.is_super_admin` flag rather than a
     * membership role — so "manager or above, unless the actor is a super
     * admin" is spelled exactly as UpdateReaderProfile.php:65 already
     * spells it.
     */
    private function assertMayDecide(User $actor, Membership $membership, ProfileChangeRequest $request): void
    {
        Gate::forUser($actor)->authorize('decide', $membership);

        if ($actor->id === $request->user_id) {
            throw new RuleViolated('not_permitted');
        }

        $this->assertSubjectRolePermits($actor, $membership);
    }

    /**
     * §9's routing rule on its own: a manager-or-admin SUBJECT's change is
     * a super administrator's to rule on, a reader subject's is any
     * manager's.
     *
     * SEPARATE FROM assertMayDecide ABOVE BECAUSE CANCEL NEEDS THIS HALF
     * AND NOT THE OTHER (spec D4). CancelProfileChange applies exactly this
     * table to its non-self path — cancelling is a second verb reaching the
     * same row, and routing it differently would cut the rule off at the
     * knees, which is the defect the reference recorded. But its self case
     * is exempt at every rank and compares MEMBERSHIP ids, where the
     * decision pair refuses self at every rank and compares USER ids. So
     * the shared half is factored out and the self checks stay where they
     * differ; a `$verb` flag through one function would be the same two
     * rules with the difference hidden inside it.
     *
     * The port's `atLeast` is narrower than the reference's — see
     * assertMayDecide's note — so this is spelled exactly as
     * UpdateReaderProfile.php:65 spells it.
     */
    private function assertSubjectRolePermits(User $actor, Membership $membership): void
    {
        if ($membership->role->atLeast(MembershipRole::Manager) && ! $actor->is_super_admin) {
            throw new RuleViolated('not_permitted');
        }
    }

    /**
     * The shelf the request itself names — the ONE source of the shelf on
     * both paths (spec D10). Never a shelf id off the request body: the
     * reference measured a hidden shelf field letting a mismatched post
     * file an approval against the wrong parish.
     *
     * The column is NOT NULL behind a foreign key, so the null branch is
     * unreachable in practice; it is spelled as a named refusal rather
     * than an assertion because a shelf deleted out from under a live
     * request is still a thing a volunteer would have to be told about in
     * Vietnamese.
     */
    private function requestShelf(ProfileChangeRequest $request): Bookshelf
    {
        $shelf = $request->bookshelf;

        if ($shelf === null) {
            throw new RuleViolated('shelf_not_found');
        }

        return $shelf;
    }

    abstract private function tenantContext(): TenantContext;
}
