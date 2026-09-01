<?php

declare(strict_types=1);

namespace App\Actions\Admin;

use App\Actions\Admin\Concerns\DecidesProfileChanges;
use App\Enums\ProfileChangeStatus;
use App\Exceptions\RuleViolated;
use App\Models\Membership;
use App\Models\ParishUnit;
use App\Models\ProfileChangeRequest;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\Clock;
use App\Support\ConcurrencyRetry;
use App\Support\Members\AvatarStorage;
use App\Support\Members\ParishTaxonomy;
use App\Support\Members\ParishUnits;
use App\Support\Members\ProfileFields;
use App\Support\Notifications\NotificationKind;
use App\Support\Notifications\Notifier;
use App\Support\TenantContext;
use Illuminate\Support\Facades\DB;

/**
 * A manager approves a pending change and the proposed values MOVE onto the
 * person, in the same transaction as the audit row — OPS §4.3's
 * ApproveProfileChange, §7.4's `pending ──► approved (values written to the
 * person)`. Port of
 * old_next/src/domain/members/commands/approve-profile-change.ts.
 *
 * THIS IS THE SECOND OF INV-13's TWO SANCTIONED PROFILE WRITERS — the other
 * being UpdateReaderProfile, the direct correction. That is why
 * tests/Feature/Architecture/MembersArchitectureTest.php's exact list of
 * files permitted to write a profile column on `users` gained this file in
 * the same commit: the list is a census, not a convenience, and joining it
 * is meant to be a deliberate act.
 *
 * Who may decide is App\Actions\Admin\Concerns\DecidesProfileChanges' —
 * spec D2's three-part rule, held in one place for this command, Reject and
 * (from Task 4) Cancel.
 *
 * ── The four things this command does BESIDES deciding ───────────────────
 *
 * IT RE-VALIDATES THE STORED JSON. `proposed_values` is a json column with
 * no check constraint behind it, so a row written by an older schema, by
 * hand, or by a future caller that bypasses ProposeProfileChange can hold a
 * blanked saint name or a malformed date. Running it back through
 * ProfileFields::normalisePatch means such a row fails
 * `required_fields_missing` AT APPROVAL — on the manager's screen, which
 * therefore has to be able to show it. Approving a bag straight into the
 * person record would instead write the invalid values and let the NOT NULL
 * columns decide, in a driver error.
 *
 * IT ASKS THE PHONE QUESTION AGAIN, and clears a stale reason. OPS §4.3
 * names this command as the backstop "for a request written before
 * ProposeProfileChange carried its own copy of this check". The auto-clear
 * — a supplied phone wipes a `phone_missing_reason` nobody withdrew — is
 * UpdateReaderProfile.php:89-91's, and it belongs on the WRITE paths only:
 * ProposeProfileChange deliberately does not do it, because clearing a
 * field the proposer never named would be that command editing a proposal
 * on somebody's behalf.
 *
 * IT CARRIES THE TWO PARISH-UNIT IDS, and validates the RESULTING PAIR.
 * They are not part of what was proposed — placement is a membership fact,
 * not one of the nine person-level columns a reader may put forward — they
 * let the approving manager fix the placement in the same act, which is
 * what the reader's own profile page points them at. Both stay optional
 * (BR §5.6): naming neither leaves the placement untouched. And the pair
 * validated is the pair the membership WOULD HOLD — a caller naming only
 * level 2 is checked against the level 1 already on file, because a
 * half-checked pair is how a level-2 unit ends up under the wrong parent.
 *
 * ITS AUDIT ROW IS AGAINST THE `user`, not the request. Approve is the
 * moment the details actually move, so the row a volunteer finds when they
 * ask "what happened to this person" is this one; propose, reject and
 * cancel audit the `profile_change_request` instead, because nothing about
 * the person changed.
 *
 * ── One lock, deliberately, and it is not the membership's ───────────────
 *
 * The subject's `users` row is locked first (the trait), and the request
 * row is re-read under it. The MEMBERSHIP is read but NOT locked, even
 * though this command may write its two unit ids. UpdateReaderProfile locks
 * memberships and then users; locking it here would give this command the
 * opposite order and hand the pair a lock cycle of exactly the kind spec D3
 * exists to prevent. What the membership is read for — the subject's role,
 * and the placement half a caller did not name — is read inside the same
 * transaction, after the subject is pinned, which is what "at decision
 * time" means.
 */
final class ApproveProfileChange
{
    use DecidesProfileChanges;

    public function __construct(
        private AuditRecorder $audit,
        private AvatarStorage $avatars,
        private Clock $clock,
        private TenantContext $context,
        private Notifier $notifier,
    ) {}

    /**
     * @param  array<string, mixed>  $units  `parish_unit_l1_id` / `parish_unit_l2_id`.
     *                                       KEY PRESENCE is what "named" means, exactly as
     *                                       ProfileFields::normalisePatch reads a patch: an absent key
     *                                       leaves the placement alone, a key present with null clears
     *                                       it.
     * @return string|null the SUPERSEDED photograph's storage key, already
     *                     discarded — returned so a caller can assert on it
     */
    public function execute(User $actor, ProfileChangeRequest $request, array $units = []): ?string
    {
        $superseded = DB::transaction(function () use ($actor, $request, $units): ?string {
            $person = $this->lockSubject($request);
            $membership = $this->subjectMembership($request);

            $this->assertMayDecide($actor, $membership, $request);

            $pending = $this->lockPendingRequest($request);

            // The stored bag, back through the same allowlist and the same
            // shape rules a live proposal passes. pick() narrows to the
            // nine columns; normalisePatch folds blanks and refuses a
            // blanked required field.
            $patch = ProfileFields::normalisePatch(ProfileFields::pick($pending->proposed_values));

            $before = $this->currentFields($person);
            $after = array_merge($before, $patch);

            // A present number makes a stale reason wrong; a cleared one
            // must not leave the record silent (typed now or already on
            // file both answer). UpdateReaderProfile.php:88-94's pair.
            if (($after['phone'] ?? null) !== null) {
                $after['phone_missing_reason'] = $patch['phone_missing_reason'] ?? null;
            }
            if (($after['phone'] ?? null) === null && ($after['phone_missing_reason'] ?? null) === null) {
                throw new RuleViolated('thieu-so-dien-thoai');
            }

            $diff = ProfileFields::diff($before, $after);

            // Spec D6: APPROVING DISCARDS THE PHOTOGRAPH THE NEW ONE
            // REPLACES — the opposite of reject and cancel, which discard
            // the proposed one. Captured here, inside the transaction,
            // where the old value is still readable; DELETED after it, in
            // execute(), where a rollback can no longer restore a reference
            // to an image that is already gone.
            //
            // Null unless the approval actually moved the column, so an
            // approval that proposed no photograph deletes nothing, and one
            // for a person who had none has nothing to delete.
            $orphan = in_array('avatar_object', $diff['changed'], true)
                ? ($before['avatar_object'] ?? null)
                : null;

            foreach ($diff['changed'] as $field) {
                $person->{$field} = $after[$field];
            }
            $person->save();

            $placement = $this->applyPlacement($request, $membership, $units);

            $pending->update([
                'status' => ProfileChangeStatus::Approved->value,
                'decided_by' => $actor->id,
                'decided_at' => $this->clock->now(),
            ]);

            // `user`, and the subject's user id — spec D3's entity-type
            // rule. The shelf is named on the recorder rather than taken
            // from the bound context, because the cross-shelf queue reaches
            // this command with no tenant bound at all.
            $this->audit->forShelf($pending->bookshelf_id)->record(
                'profile_change.approved',
                'user',
                $person->id,
                array_merge($diff['before'], $placement['before']),
                array_merge($diff['after'], $placement['after']),
            );

            // BR:490's first half, INSIDE the transaction — the phase's
            // headline guarantee, and NotificationsAreReaderFacingTest's
            // token walk is what holds it here.
            //
            // No payload: the sentence is fixed and the reader's own page
            // carries the values (NotificationKind's note). And the shelf
            // is named for the same reason the audit row above names it —
            // the `/admin` queue reaches this command with no tenant
            // bound, so the create-hook has none to stamp.
            //
            // Unconditional, even when $diff['changed'] is empty: what the
            // reader is being told is that their request was decided, and
            // "approved but nothing moved" is still the answer to the
            // question BR:492 says they would otherwise revisit the page
            // to ask.
            $this->notifier->forShelf($pending->bookshelf_id)->notify(
                $person->id,
                NotificationKind::ProfileChangeApproved,
            );

            return $orphan;
        }, ConcurrencyRetry::ATTEMPTS);

        // AFTER the commit, never inside it — spec D6. DB::transaction()
        // returns only once the commit has happened, so this line IS the
        // ordering, expressed as control flow rather than as a comment.
        // Deleting inside would destroy an image a rollback then restores
        // the reference to.
        $this->avatars->discard($superseded);

        return $superseded;
    }

    /**
     * The nine verified columns as they stand, read as raw attributes with
     * date_of_birth as the plain Y-m-d the column holds rather than the
     * instant its cast produces — UpdateReaderProfile and
     * ProposeProfileChange read theirs the same way and for the same
     * reason: a Carbon compared against a stored string is never equal,
     * which would make every unchanged birthday look like a change.
     *
     * @return array<string, ?string>
     */
    private function currentFields(User $person): array
    {
        $current = [];

        foreach (ProfileFields::FIELDS as $field) {
            $raw = $person->getAttributes()[$field] ?? null;

            $current[$field] = $field === 'date_of_birth'
                ? $person->date_of_birth?->toDateString()
                : ($raw === null ? null : (string) $raw);
        }

        return $current;
    }

    /**
     * BR §5.6's selection rule against the pair the membership would hold,
     * then the write — and nothing at all when the caller named neither id.
     *
     * @param  array<string, mixed>  $units
     * @return array{before: array<string, mixed>, after: array<string, mixed>}
     */
    private function applyPlacement(ProfileChangeRequest $request, Membership $membership, array $units): array
    {
        $named = array_intersect_key($units, array_flip(['parish_unit_l1_id', 'parish_unit_l2_id']));

        if ($named === []) {
            return ['before' => [], 'after' => []];
        }

        $resulting = [];
        foreach (['parish_unit_l1_id', 'parish_unit_l2_id'] as $field) {
            $value = array_key_exists($field, $named)
                ? $named[$field]
                : $membership->{$field};

            $value = is_string($value) && trim($value) !== '' ? trim($value) : null;
            $resulting[$field] = $value;
        }

        // The RESULTING pair, never the supplied half.
        $context = $this->parishContext($request);
        $refusal = ParishUnits::validateSelection(
            $context['taxonomy'],
            $context['units'],
            $resulting['parish_unit_l1_id'],
            $resulting['parish_unit_l2_id'],
        );

        if ($refusal !== null) {
            // A variable, not a literal — the three codes are
            // ParishUnits::validateSelection's own return values and are
            // censused by MembersArchitectureTest's hand-written list,
            // exactly as Registration.php raises them.
            throw new RuleViolated($refusal);
        }

        $before = [];
        $after = [];
        foreach ($resulting as $field => $value) {
            if ($membership->{$field} === $value) {
                continue;
            }
            $before[$field] = $membership->{$field};
            $after[$field] = $value;
            $membership->{$field} = $value;
        }

        if ($after !== []) {
            $membership->save();
        }

        return ['before' => $before, 'after' => $after];
    }

    /**
     * The taxonomy and every unit of the REQUEST'S OWN SHELF — soft-deleted
     * ones included, because validateSelection counts a retired unit as
     * existing (a membership pointing at one is history, not an error).
     *
     * ParishContextQuery is deliberately not reused: it reads the BOUND
     * shelf, and the cross-shelf caller has none. The shelf here comes off
     * the request row, through its own relation.
     *
     * @return array{taxonomy: ParishTaxonomy, units: list<array{id: string, level: int, parentId: ?string, name: string, sortOrder: int, deletedAt: ?string}>}
     */
    private function parishContext(ProfileChangeRequest $request): array
    {
        $shelf = $this->requestShelf($request);

        $units = $this->context->systemWide(fn (): array => array_values(
            $shelf->parishUnits()->withTrashed()
                ->orderBy('level')->orderBy('sort_order')->orderBy('name')
                ->get()
                ->map(fn (ParishUnit $u): array => [
                    'id' => $u->id,
                    'level' => (int) $u->level,
                    'parentId' => $u->parent_id,
                    'name' => $u->name,
                    'sortOrder' => (int) $u->sort_order,
                    'deletedAt' => $u->deleted_at?->toIso8601String(),
                ])
                ->all(),
        ));

        return [
            'taxonomy' => ParishTaxonomy::fromSettings($shelf->settings['parish_taxonomy'] ?? null),
            'units' => $units,
        ];
    }

    private function tenantContext(): TenantContext
    {
        return $this->context;
    }
}
