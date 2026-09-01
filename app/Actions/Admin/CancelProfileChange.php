<?php

declare(strict_types=1);

namespace App\Actions\Admin;

use App\Actions\Admin\Concerns\DecidesProfileChanges;
use App\Enums\ProfileChangeStatus;
use App\Exceptions\RuleViolated;
use App\Models\Membership;
use App\Models\ProfileChangeRequest;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\Clock;
use App\Support\ConcurrencyRetry;
use App\Support\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * A pending proposal is withdrawn before anybody rules on it — OPS §4.3's
 * CancelProfileChange, BR §7.4's `pending ──► cancelled (reader withdrew
 * before a decision)`. Port of
 * old_next/src/domain/members/commands/cancel-profile-change.ts.
 *
 * NOTHING ON THE PERSON MOVES. Like Reject, this writes one row in
 * profile_change_requests and one audit row; the proposal never touched
 * the record, so there is nothing to undo.
 *
 * ── Cancelling IS governed by the decision rule (spec D4) ────────────────
 *
 * THE OBVIOUS READING IS THE WRONG ONE, and the reference records shipping
 * it as a defect it had to fix: `requireSelfOrManager` alone — the gate
 * below — lets any manager through regardless of whose request it is, and
 * that is precisely the gap, because it means
 *
 *   "a manager could cancel a peer manager's own pending change, cutting
 *    §9's routing rule off at the knees"
 *
 * before a super administrator ever saw it. Cancelling is a second verb
 * reaching the same row, so routing it differently from approve and reject
 * routes it away from the rule entirely.
 *
 * So: any manager or above may cancel any request, and the SUBJECT-ROLE
 * rule then applies exactly as it does for the decision pair — a
 * manager-or-admin subject's request is a super administrator's to cancel.
 * That half is
 * App\Actions\Admin\Concerns\DecidesProfileChanges::assertSubjectRolePermits(),
 * the one copy of it, shared with Approve and Reject rather than
 * hand-written a third time.
 *
 * ── The self case is the ONE exemption, and its check is the other one ───
 *
 * A person may always withdraw their own request, AT EVERY RANK — a
 * manager who mistyped their own phone number is not stranded waiting for
 * a super administrator. That is not an inconsistency with Approve and
 * Reject, which refuse self-decision at every rank: approving your own
 * change is signing both halves of a decision nobody else reviewed, while
 * withdrawing your own request has no second party to it at all.
 *
 * AND THE SELF-CHECK HERE COMPARES MEMBERSHIP IDS, not user ids — the
 * mirror image of spec D2 point 3, which compares user ids precisely so
 * that a person standing at their other parish cannot decide their own
 * proposal. The asymmetry is real and deliberate: "the same human being on
 * both halves" is what disqualifies a DECIDER, whereas the thing being
 * identified here is the caller's own session — `requireSelfOrManager`'s
 * comparand, the membership TenantContext resolved from the session and
 * the bound shelf, never a value a caller sent. DO NOT UNIFY THEM.
 *
 * ── `membershipId` as well as the request id ─────────────────────────────
 *
 * OPS §4.3 lists both inputs, and the pairing is a check: `not_own_request`
 * is what a membership naming a different person than the request's subject
 * earns. OPS calls it "structurally unreachable via UI, but the command
 * must still check", and the code is a REUSE — lang/vi/rules.php's "Bạn
 * không thể huỷ yêu cầu của người khác." is CancelOwnRequest's sentence and
 * says exactly this, so a second code would be a second spelling of one
 * meaning.
 *
 * THE ROLE, THOUGH, IS READ OFF THE REQUEST'S OWN SHELF, not off the
 * membership the caller named. The reference reads it off the named
 * membership and its own docstring records the exposure that leaves: the
 * query "carries no `bookshelf_id` predicate of its own", safe only while
 * RLS narrows it, and the guarantee "evaporates the day cancel is reached"
 * from an admin path — which is exactly where the cross-shelf queue reaches
 * it here. `subjectMembership()` resolves `m.bookshelf_id = r.bookshelf_id`
 * instead, so the role that routes the cancellation is the role the subject
 * holds on the parish the request belongs to.
 *
 * ── `decided_by` stays null while `decided_at` is set ────────────────────
 *
 * Which looks inconsistent and is not. `decided_by` is the manager who
 * RULED on the request; a withdrawal has no such manager, and writing the
 * canceller's id there would make "who decided this" answer with the person
 * who asked. The time is a real fact worth keeping, and who did it is in
 * the audit row, where it is permanent.
 *
 * ITS AUDIT ROW IS AGAINST THE `profile_change_request`, not the user —
 * spec D3's entity-type rule. Approve's `user` is the exception, not the
 * rule: it is the only one of the four at which anything about the person
 * actually changed.
 */
final class CancelProfileChange
{
    use DecidesProfileChanges;

    public function __construct(
        private AuditRecorder $audit,
        private Clock $clock,
        private TenantContext $context,
    ) {}

    /**
     * @param  Membership  $membership  the SUBJECT's membership — OPS §4.3's
     *                                  `membershipId`, and half of the pairing check below.
     */
    public function execute(User $actor, Membership $membership, ProfileChangeRequest $request): void
    {
        // requireSelfOrManager, and it is only the FLOOR — see this class's
        // docblock. The rule that actually routes a cancellation is the
        // subject-role half inside the transaction.
        Gate::forUser($actor)->authorize('cancel', $membership);

        // Costs no round trip, so it is asked before the transaction opens
        // rather than inside it, where it would sit in front of the lock
        // that has to be the first statement.
        if ($membership->user_id !== $request->user_id) {
            throw new RuleViolated('not_own_request');
        }

        // Resolved from the SESSION, never from the caller's payload, and
        // read outside the transaction because it is not a fact about the
        // request. Null for a memberless super administrator on the unbound
        // cross-shelf path — which is not self, and is admitted by the
        // subject-role rule's own super-administrator clause instead.
        $own = $this->context->membership();
        $isSelf = $own !== null && $own->id === $membership->id;

        DB::transaction(function () use ($actor, $request, $isSelf): void {
            // Spec D3's ordering rule: the subject's `users` row FIRST,
            // before anything in profile_change_requests. Reversed, this
            // command deadlocked against approve — a manager clicking
            // *Duyệt* as the reader clicked *Huỷ* — 3/3 in both directions,
            // and the loser's driver error shipped as a 500.
            $this->lockSubject($request);
            $subject = $this->subjectMembership($request);

            if (! $isSelf) {
                $this->assertSubjectRolePermits($actor, $subject);
            }

            $pending = $this->lockPendingRequest($request);

            $pending->update([
                'status' => ProfileChangeStatus::Cancelled->value,
                'decided_at' => $this->clock->now(),
            ]);

            $this->audit->forShelf($pending->bookshelf_id)->record(
                'profile_change.cancelled',
                'profile_change_request',
                $pending->id,
                ['status' => ProfileChangeStatus::Pending->value],
                ['status' => ProfileChangeStatus::Cancelled->value],
            );
        }, ConcurrencyRetry::ATTEMPTS);
    }

    private function tenantContext(): TenantContext
    {
        return $this->context;
    }
}
