<?php

namespace App\Actions\Admin;

use App\Actions\Admin\Concerns\WritesProfileProposals;
use App\Exceptions\RuleViolated;
use App\Models\Membership;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\Clock;
use App\Support\Members\ProfileFields;
use App\Support\Members\ProfileProposals;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * A person proposes new values for someone's verified details — OPS §4.3's
 * ProposeProfileChange, BR:83's "changing your own details is a request,
 * not an edit". Port of
 * old_next/src/domain/members/commands/propose-profile-change.ts.
 *
 * THIS COMMAND NEVER WRITES TO `users`. That is the whole of it: the
 * existing values stay in force — including the phone number, so a manager
 * never loses the means of contacting a family mid-change — until
 * ApproveProfileChange moves them. MembersArchitectureTest's enumeration of
 * the sanctioned profile writers is therefore untouched by this task.
 *
 * IT LIVES IN app/Actions/Admin/ AND IT IS NOT AN ADMINISTRATIVE COMMAND
 * (spec D10). ProfileChangeRequest carries BelongsToBookshelf, so the
 * unbound `/admin` callers of the later lifecycle commands need the audit
 * recorder's shelf configurator — which WideningArchitectureTest fences to
 * this directory. The five lifecycle commands live together rather than
 * one of them sitting alone in Members/; nothing fences CALLERS, so the
 * reader's own tenant-bound controller reaches this cleanly.
 *
 * ── Proposing again while one is pending ─────────────────────────────────
 *
 * Normal, not a failure (spec D1). Three steps whose order the schema
 * forces rather than taste:
 *
 * 1. Read the pending row — BookshelfScope scopes that read to this shelf.
 * 2. Merge it field-wise with the incoming patch
 *    (App\Support\Members\ProfileProposals, which holds the product
 *    reading and the one function that reverses it).
 * 3. UPDATE it in place, keyed by its existing id, so the SAME request id
 *    comes back — or INSERT when there was none.
 *
 * THE UNIQUE INDEX IS NOT THE SECOND-PROPOSAL GUARD. Step 3's merge means
 * there is never a second row on this shelf, so `pending_user_id` —
 * generated as IF(status = 'pending', user_id, NULL), UNIQUE — is left
 * guarding the one case the scoped SELECT in step 1 cannot see: a person
 * with memberships at TWO shelves, whose blocking row belongs to the other
 * parish. The generated column is global across shelves; the scope is not.
 * Its refusal is change_already_pending, and without the catch it would
 * surface as a raw driver error, which OPS §2 forbids.
 *
 * ALL THREE STEPS MOVED TO
 * App\Actions\Admin\Concerns\WritesProfileProposals IN TASK 8, when
 * ProposeAvatarChange became the second caller. Spec D6 makes the
 * photograph this command's file-carrying case rather than a second
 * lifecycle — same pending row, same merge, same audit action — so the lock
 * order and the duplicate-key catch are held once. Nothing about the
 * behaviour above changed; read that trait for the reasoning behind each
 * step, which lives there now.
 *
 * PROPOSING IS NOT READER-ONLY (spec D5). MembershipPolicy::propose is
 * requireSelfOrManager — any manager or above may propose on another
 * person's behalf, which is the capability the reference ships and a
 * "reader proposes" gate would have narrowed.
 *
 * ── Three smaller decisions ──────────────────────────────────────────────
 *
 * A FIELD PROPOSED AT ITS CURRENT VALUE IS NOT A PROPOSAL. empty_proposal
 * is "nothing differs from the current values", so the patch is filtered
 * against the person as they stand before anything is stored — otherwise a
 * reader could fill a form, change nothing, and leave a manager a request
 * to decide about that would change nothing.
 *
 * THE PHONE RULE IS ASKED HERE, AGAINST THE RESULTING RECORD. A phone is
 * required by the interface, not the column, and a genuinely absent one
 * needs a typed reason (thieu-so-dien-thoai). This screen has the reason
 * box; the manager's decision screen does not, and a refusal raised only at
 * approval, on a screen with nowhere to answer it, leaves rejection as the
 * only exit. So the record this proposal WOULD produce, if approved
 * unchanged right now, is what the check reads. ApproveProfileChange keeps
 * its own call as the backstop for a row written before this existed.
 *
 * Unlike UpdateReaderProfile, a supplied phone does NOT auto-clear a stale
 * reason here. That command writes the record; this one writes a request,
 * and clearing a field the proposer never named would be this command
 * editing a proposal on their behalf. The clearing belongs on the write
 * path, where UpdateReaderProfile already does it and ApproveProfileChange
 * will.
 *
 * `requested_at` COMES FROM THE APPLICATION CLOCK, never the column
 * default: the default is the database host's clock, and this is a
 * timestamp the domain means — a test with a frozen clock must be able to
 * make a request look a week old without waiting a week. A merge refreshes
 * it, because the reader asked again just now.
 */
final class ProposeProfileChange
{
    use WritesProfileProposals;

    public function __construct(
        private AuditRecorder $audit,
        private Clock $clock,
    ) {}

    /**
     * @param  array<string, mixed>  $fields
     * @return string the request id — the SAME one on a merge
     */
    public function execute(User $actor, Membership $membership, array $fields): string
    {
        Gate::forUser($actor)->authorize('propose', $membership);

        // Narrowed to the proposable eight BEFORE validation, then shaped.
        // Both refusals here cost no database round trip.
        $patch = ProfileFields::normalisePatch(ProfileProposals::onlyProposable($fields));

        if ($patch === []) {
            throw new RuleViolated('empty_proposal');
        }

        return DB::transaction(function () use ($membership, $patch): string {
            // FIRST statement, and the ordering rule the whole lifecycle
            // obeys: the subject's `users` row before anything in
            // profile_change_requests. Reversed, this command races
            // ApproveProfileChange — which reaches the same two rows from
            // the other end — and the reference measured that deadlocking
            // 3/3 in both directions.
            $person = $this->lockSubjectForProposal($membership);

            $current = $this->currentProfileFields($person);

            $incoming = [];
            foreach ($patch as $field => $value) {
                if (($current[$field] ?? null) !== $value) {
                    $incoming[$field] = $value;
                }
            }

            if ($incoming === []) {
                throw new RuleViolated('empty_proposal');
            }

            // Locked as well as read: without it two proposals for one
            // person each merge onto the same stale contents and the later
            // write discards the earlier one wholesale, both reporting
            // success. The reference reproduced that three times.
            $pending = $this->lockPendingProposal($person);

            $next = ProfileProposals::merge($this->existingContents($pending), $incoming, $current);

            $this->assertResultingRecordHasAPhoneOrAReason($next['proposed'], $current);

            $requestId = $this->writeProposal($membership, $person, $pending, $next);

            // The REQUEST, not the person: nothing about the person
            // changed, which is this command's whole point.
            // ApproveProfileChange is the one that audits against the user
            // id, because that is when the details actually move.
            //
            // The shelf is named on the recorder rather than taken from
            // the bound context, so that the later lifecycle commands —
            // reached from the unbound cross-shelf queue — and this one
            // write the row the same way.
            $this->audit->forShelf($membership->bookshelf_id)->record(
                'profile_change.proposed',
                'profile_change_request',
                $requestId,
                $next['previous'],
                $next['proposed'],
            );

            return $requestId;
        });
    }

    /**
     * @param  array<string, ?string>  $proposed
     * @param  array<string, ?string>  $current
     */
    private function assertResultingRecordHasAPhoneOrAReason(array $proposed, array $current): void
    {
        // Key presence decides which side each half comes from: a field the
        // merged proposal names is what the record WOULD hold, and one it
        // does not name keeps the value on file.
        $phone = array_key_exists('phone', $proposed)
            ? $proposed['phone']
            : ($current['phone'] ?? null);

        $reason = array_key_exists('phone_missing_reason', $proposed)
            ? $proposed['phone_missing_reason']
            : ($current['phone_missing_reason'] ?? null);

        if ($phone === null && $reason === null) {
            throw new RuleViolated('thieu-so-dien-thoai');
        }
    }

    private function proposalClock(): Clock
    {
        return $this->clock;
    }
}
