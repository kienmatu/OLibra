<?php

declare(strict_types=1);

namespace App\Actions\Admin;

use App\Exceptions\RuleViolated;
use App\Models\Membership;
use App\Models\User;
use App\Support\AuditRecorder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Hash;

/**
 * A person changes their OWN password — OPS §4.3's ChangeOwnPassword, spec
 * D12. Port of old_next/src/domain/members/commands/change-own-password.ts.
 *
 * NOT A ProfileChangeRequest, unlike every other field on the reader's own
 * page. BR §16.2 draws the line: "changing the password takes effect
 * immediately — it is not a fact about the person that a manager verified",
 * so there is nothing for a manager to approve and no proposal to merge.
 *
 * ── It REVOKES, and that is one transaction with the write ───────────────
 *
 * Every session the subject holds is deleted in the same transaction as the
 * new hash. A password changed while an old cookie kept working is not a
 * revocation, and the reference makes exactly this argument for
 * App\Actions\Members\SetReaderCredentials (rule 3 in that class's
 * docblock, BR §2). The sessions table's `user_id` column is plain — the
 * hashed database driver hashes the session KEY, not the owner — so one
 * scoped delete is exactly enough.
 *
 * ── The membership is the input, never a user id ─────────────────────────
 *
 * OPS §4.3 lists `userId` and taking one would be a real hazard: `users` is
 * a global table with no shelf column to scope by, so a caller-supplied id
 * is guarded only by whatever comparison this command remembers to make. A
 * Membership is resolved by the caller's own tenant (ResolveTenant, off the
 * session and the bound shelf), and the `users` row is reached by joining
 * out of it.
 *
 * ── requireSelfOrManager, so this is NOT strictly the reader's own path ──
 *
 * MembershipPolicy::changePassword delegates to viewSelf(), the same
 * requireSelfOrManager propose() and cancel() take. Which means the manager
 * half admits a volunteer — who then has to supply the subject's CURRENT
 * password to get anywhere, which is the whole difference between this
 * command and SetReaderCredentials.
 *
 * ── Why SetReaderCredentials is untouched, and keeps its own action name ─
 *
 * BR:79 says a volunteer setting a password is inherent to the trust model
 * and the mitigation is to make every use VISIBLE, not to restrict it. The
 * reader supplies their current password here; the volunteer supplies none
 * there. That asymmetry is exactly what an oversight screen needs to be
 * able to tell apart, so the two keep separate audit actions —
 * `user.password_changed` and `credentials.set` — rather than sharing one
 * that would answer "did somebody else do this?" with "cannot tell".
 *
 * ── The audit row carries NO before and NO after, deliberately ───────────
 *
 * Not a redacted one, not `{ hasPassword: true }`. OPS §4.3 lists "password
 * value never captured in the audit record (§14)" among this command's own
 * invariants, and BR §2/§14 state it twice because this is where the
 * temptation is strongest. There is nothing about a password change worth
 * a payload: WHO did it and WHEN is the whole of what oversight needs, and
 * both are columns on the audit row itself.
 */
final class ChangeOwnPassword
{
    public function __construct(private AuditRecorder $audit) {}

    public function execute(User $actor, Membership $membership, string $currentPassword, string $newPassword): void
    {
        Gate::forUser($actor)->authorize('changePassword', $membership);

        // ITS OWN CODE, not SetReaderCredentials' `password_too_short`. Two
        // literal throws rather than one parameterised code because a
        // screen showing both a current-password box and a new-password box
        // must be able to say WHICH one is wrong, and the reference names
        // this one `new_password_too_short` for that reason.
        if (mb_strlen($newPassword) < 8) {
            throw new RuleViolated('new_password_too_short');
        }

        DB::transaction(function () use ($membership, $currentPassword, $newPassword): void {
            // FIRST statement, the shape SetReaderCredentials pins: scoped
            // and soft-delete-aware, so the row the rest of this closure
            // reasons about cannot move under it.
            $membership = Membership::query()->lockForUpdate()->findOrFail($membership->id);

            $person = User::query()->lockForUpdate()->find($membership->user_id);
            if ($person === null) {
                // A soft-deleted identity is "no such reader" (IMPORTANT 4),
                // the same sentence every other members screen gives.
                throw new RuleViolated('membership_not_found');
            }

            // A WRONG PASSWORD AND AN ACCOUNT WITH NO PASSWORD FAIL
            // IDENTICALLY. INV-14 makes credential-less a valid state, and
            // distinguishing it here would tell a caller which accounts
            // have never been given credentials — the same reasoning
            // `sign_in_failed` already carries in LoginRequest.
            //
            // The null arm is not merely tidy, MEASURED in this task's
            // falsification: with the refusal below skipped, the
            // credential-less case does not silently succeed either — it
            // reaches `users_credentials_paired` (INV-14's own CHECK) and
            // comes back as SQLSTATE 23000, i.e. a 500. A password set
            // with no username is not a state this schema has.
            $ok = $person->password_hash !== null
                && Hash::check($currentPassword, $person->password_hash);

            if (! $ok) {
                throw new RuleViolated('current_password_incorrect');
            }

            $person->password_hash = Hash::make($newPassword);
            $person->save();

            // The revocation, inside the transaction with the write above.
            DB::table('sessions')->where('user_id', $person->id)->delete();

            // No before, no after. This is the requirement, not an omission
            // somebody can helpfully fill in later.
            $this->audit->record('user.password_changed', 'user', $person->id, null, null);
        });
    }
}
