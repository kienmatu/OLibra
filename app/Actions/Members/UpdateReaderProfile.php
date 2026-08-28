<?php

namespace App\Actions\Members;

use App\Enums\MembershipRole;
use App\Exceptions\RuleViolated;
use App\Models\Membership;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\Members\ProfileFields;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * A manager corrects a reader's personal details directly, with no
 * approval step — OPS §4.3's UpdateReaderProfile, the product owner's
 * answer to "most readers are children who never sign in, and the phone
 * number is how books come back" (BR §2). Not a weakening of INV-13:
 * whoever can set a reader's password can already act as that reader, and
 * a direct edit naming the manager is the more truthful record. What
 * INV-13 protects is that details never change SILENTLY — hence the
 * before/after audit carrying exactly the changed fields.
 *
 * The reference's rules, kept:
 *  - the reader is reached through the shelf-scoped membership, never a
 *    caller-supplied user id (users is global);
 *  - §9 routing: a manager/admin SUBJECT may only be corrected by a super
 *    admin, derived fresh from the subject's current role under the lock —
 *    which also refuses a manager editing their own record, since their
 *    own role is exactly `manager`;
 *  - an edit that changes nothing writes nothing (empty_proposal, and the
 *    transaction rolls back the no-op);
 *  - the resulting record must not go silent on the phone: blank phone
 *    with no reason (typed now or already on file) is thieu-so-dien-thoai,
 *    and a supplied phone clears a stale reason;
 *  - profile.corrected, not membership.updated — the name a super admin
 *    filters for is exactly "a manager changed someone's details without
 *    an approval step" (BR §13.2, the same oversight as credentials.set).
 */
final class UpdateReaderProfile
{
    public function __construct(private AuditRecorder $audit) {}

    /** @param  array<string, mixed>  $fields */
    public function execute(User $actor, Membership $membership, array $fields): void
    {
        Gate::forUser($actor)->authorize('correct', $membership);

        // Before any database round trip: shape refusals cost nothing.
        $patch = ProfileFields::normalisePatch($fields);

        if ($patch === []) {
            throw new RuleViolated('empty_proposal');
        }

        DB::transaction(function () use ($actor, $membership, $patch): void {
            // FIRST statement — divergence 1; also re-reads role fresh for
            // the §9 routing check below. Its position in the query log is
            // pinned by UpdateReaderProfileTest's own lock-position
            // assertion.
            $membership = Membership::query()->lockForUpdate()->findOrFail($membership->id);

            // §9: a manager/admin subject is a super admin's to write. A
            // manager's own record fails here too — their role IS manager.
            if ($membership->role->atLeast(MembershipRole::Manager) && ! $actor->is_super_admin) {
                throw new RuleViolated('not_permitted');
            }

            $person = User::query()->lockForUpdate()->find($membership->user_id);
            if ($person === null) {
                throw new RuleViolated('membership_not_found');
            }

            $before = [];
            foreach (ProfileFields::FIELDS as $field) {
                $raw = $person->getAttributes()[$field] ?? null;
                // date_of_birth is stored DATETIME-ish by the cast; compare
                // and audit the plain Y-m-d string everywhere.
                $before[$field] = $field === 'date_of_birth'
                    ? $person->date_of_birth?->toDateString()
                    : $raw;
            }

            $after = array_merge($before, $patch);

            // A present number makes a stale reason wrong; a cleared one
            // must not leave the record silent (typed now or already on
            // file both answer).
            if (($after['phone'] ?? null) !== null) {
                $after['phone_missing_reason'] = $patch['phone_missing_reason'] ?? null;
            }
            if (($after['phone'] ?? null) === null && ($after['phone_missing_reason'] ?? null) === null) {
                throw new RuleViolated('thieu-so-dien-thoai');
            }

            $diff = ProfileFields::diff($before, $after);
            if ($diff['changed'] === []) {
                // Rolls the transaction back, no-op UPDATE included; no
                // audit entry claims a change that did not happen.
                throw new RuleViolated('empty_proposal');
            }

            foreach ($diff['changed'] as $field) {
                $person->{$field} = $after[$field];
            }
            $person->save();

            $this->audit->record('profile.corrected', 'user', $person->id,
                $diff['before'], $diff['after']);
        });
    }
}
