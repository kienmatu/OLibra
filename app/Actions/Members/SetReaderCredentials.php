<?php

namespace App\Actions\Members;

use App\Exceptions\RuleViolated;
use App\Models\Membership;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\UniqueViolation;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Hash;

/**
 * Sets or changes a reader's sign-in details — one command for both cases
 * because they are the same act from the volunteer's side (OPS §4.3), and
 * there is no self-service reset to compete with (BR §4 assumption 2).
 *
 * The reference's four rules, kept:
 *  1. The audit records the act, never the secret: no before, no after —
 *     not a redacted one, not { hasPassword: true }. BR §2/§14 state it
 *     twice because this is where the temptation is strongest.
 *  2. It must not be quiet: credentials.set is a stable action name the
 *     administration surface filters on by name (BR §13.2 Oversight).
 *  3. It ends that reader's existing sessions IN THIS TRANSACTION —
 *     credentials that changed while an old session kept working are not
 *     revoked. The sessions table's user_id column is plain (the hashed
 *     driver hashes the KEY); one scoped delete is exactly enough.
 *  4. The reader is reached through the shelf-scoped membership, never a
 *     caller-supplied user id — users is a global table, and the scoped
 *     lockForUpdate re-read below is the entire protection between a
 *     manager of one parish and every account in the system.
 * Plus IMPORTANT 4: a soft-deleted identity is "no such reader" too.
 */
final class SetReaderCredentials
{
    public function __construct(private AuditRecorder $audit) {}

    public function execute(User $actor, Membership $membership, string $username, string $password): void
    {
        Gate::forUser($actor)->authorize('setCredentials', $membership);

        if (trim($username) === '') {
            throw new RuleViolated('required_fields_missing');
        }
        if (mb_strlen($password) < 8) {
            throw new RuleViolated('password_too_short');
        }

        DB::transaction(function () use ($membership, $username, $password): void {
            // FIRST statement — divergence 1. Scoped + soft-delete-aware.
            $membership = Membership::query()->lockForUpdate()->findOrFail($membership->id);

            // The identity itself must not be soft-deleted (IMPORTANT 4):
            // User's SoftDeletes scope excludes trashed rows, so a deleted
            // person reads as the same "Không tìm thấy bạn đọc này." every
            // other screen already gives.
            $person = User::query()->lockForUpdate()->find($membership->user_id);
            if ($person === null) {
                throw new RuleViolated('membership_not_found');
            }

            $trimmed = trim($username);

            // Checked so a sequential caller gets the sentence rather than
            // a 1062; scoped id <> so re-setting a password under the same
            // username is not a collision with oneself. A CONCURRENT caller
            // can still lose the race to users_username_key — translated
            // below, same code.
            $clash = User::query()
                ->whereRaw('LOWER(username) = LOWER(?)', [$trimmed])
                ->where('id', '<>', $person->id)
                ->exists();
            if ($clash) {
                throw new RuleViolated('username_in_use');
            }

            try {
                // INV-14: both columns in one statement, so the pairing
                // cannot break even momentarily. Not $fillable, on purpose.
                $person->username = $trimmed;
                $person->password_hash = Hash::make($password);
                $person->save();
            } catch (QueryException $e) {
                // Only users_username_key is translated below; every other
                // QueryException rethrows untouched and reaches Laravel's
                // default exception logging with its bound parameters
                // inlined (QueryException::formatMessage()'s maskBindings
                // defaults to false) — including, on this statement, the
                // freshly generated password hash. Known, unfixed gap;
                // see docs/known-gaps.md, "Task 9 (members plan), fix
                // round" — the sibling of Registration.php's own
                // unmapped-QueryException gap ("Task 6, fix round").
                UniqueViolation::translate($e, ['users_username_key' => 'username_in_use']);
            }

            // Rule 3: same transaction as the credential change.
            DB::table('sessions')->where('user_id', $person->id)->delete();

            // Rule 1: no before, no after. This is the requirement, not an
            // omission somebody can helpfully fill in later.
            $this->audit->record('credentials.set', 'user', $person->id, null, null);
        });
    }
}
