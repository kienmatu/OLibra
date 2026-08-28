<?php

namespace App\Actions\Members;

use App\Enums\MembershipStatus;
use App\Exceptions\RuleViolated;
use App\Models\Membership;
use App\Models\User;
use App\Queries\ParishContextQuery;
use App\Support\Clock;
use App\Support\Members\MembershipTransitions;
use App\Support\Members\ParishUnits;
use App\Support\Members\Phone;
use App\Support\UniqueViolation;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\Hash;

/**
 * The shared body of the three registration commands (OPS §4.3:
 * RegisterMembership, ManagerRegisterReader, RegisterMemberOnBehalf) —
 * the port of old_next/src/domain/members/registration.ts. Only the target
 * status and who the actor is differ between the three; each caller owns
 * its DB::transaction and its audit entry.
 *
 * The anti-probe rules, kept in full (registration.ts's docstring holds
 * the argument):
 *  - a supplied username is matched only against its own password; a
 *    wrong password, or an account with no password, gets `username_taken`
 *    — exactly what an unrelated collision gives, so a stranger guessing
 *    usernames learns only "taken";
 *  - with no username, the match is the EXACT triple full_name
 *    (case-insensitively) + date_of_birth + phone. No fuzzy matching:
 *    near-matches belong on GetPendingRegistrations' similar-name warning,
 *    surfaced to a manager who knows the family.
 *
 * `users` is a global table (identity is reused across shelves, BR §5.3),
 * so the person lookup deliberately reads across every shelf; the
 * MEMBERSHIP read is scoped by BookshelfScope, which is the walk-back's
 * whole tenancy story.
 *
 * DIVERGENCE 2 (plan header): no lock. The username check and the
 * walk-back read are check-then-write, and both are backed structurally —
 * users_username_key and memberships_one_per_shelf, errno 1062, translated
 * below. The no-username triple has no structural backstop and a
 * concurrent duplicate person is accepted (the approval queue's
 * similar-name warning is the product's answer); known-gaps records it.
 */
final class Registration
{
    public function __construct(
        private Clock $clock,
        private ParishContextQuery $parish,
    ) {}

    /**
     * @param  array<string, ?string>  $input
     * @return array{userId: string, membershipId: string}
     */
    public function register(array $input, MembershipStatus $status, ?User $approver): array
    {
        foreach (['saint_name', 'full_name', 'date_of_birth', 'father_name', 'mother_name'] as $field) {
            if (self::blank($input[$field] ?? null)) {
                throw new RuleViolated('required_fields_missing');
            }
        }

        // PO round 1, Task 8: a blank phone is allowed exactly once the
        // reason says why — and it is its own code, not
        // required_fields_missing: this is not a malformed submission, it
        // is the two-question rule the interface asks. A non-blank phone
        // must have a real shape (QA T18).
        $phoneBlank = self::blank($input['phone'] ?? null);
        if ($phoneBlank && self::blank($input['phone_missing_reason'] ?? null)) {
            throw new RuleViolated('thieu-so-dien-thoai');
        }
        if (! $phoneBlank) {
            Phone::assert(trim((string) $input['phone']));
        }

        // Before the person lookup, not merely before the insert: the
        // no-username match compares date_of_birth, so a mis-shaped date
        // does not just store the wrong birthday — it asks the wrong
        // question about WHO THIS IS (registration.ts's measured cases:
        // 02/04/2015 → 2015-02-03 silently; 2015-02-30 → March).
        self::assertStorableDate(trim((string) $input['date_of_birth']));

        $credentials = $this->credentialsFrom($input);

        // OPS §4.3's named invariant: the parish rule is checked here, in
        // the same transaction as the write, not by a constraint — the
        // composite FK proves the unit is on this shelf and nothing more
        // (a level-2 id inserts cleanly into parish_unit_l1_id).
        $l1 = self::trimmed($input['parish_unit_l1_id'] ?? null);
        $l2 = self::trimmed($input['parish_unit_l2_id'] ?? null);
        if ($l1 !== null || $l2 !== null) {
            $context = $this->parish->run();
            $refusal = ParishUnits::validateSelection($context['taxonomy'], $context['units'], $l1, $l2);
            if ($refusal !== null) {
                throw new RuleViolated($refusal);
            }
        }

        $existing = $this->findExistingPerson($input, $credentials);

        try {
            $userId = $existing !== null ? $existing->id : $this->createPerson($input, $credentials)->id;

            return ['userId' => $userId, 'membershipId' => $this->upsertMembership($userId, $l1, $l2, $status, $approver)];
        } catch (QueryException $e) {
            UniqueViolation::translate($e, [
                'users_username_key' => 'username_taken',
                'memberships_one_per_shelf' => 'already_registered_here',
            ]);
        }
    }

    /**
     * The deliberately narrow audit payload: no phone, no DOB, no parents'
     * names — BR §5.3 makes those manager-only fields, and audit_log is
     * readable by every manager of the shelf AND the super administrator.
     *
     * @param  array<string, ?string>  $input
     * @param  array{userId: string, membershipId: string}  $result
     * @return array<string, mixed>
     */
    public function auditAfter(array $input, array $result, MembershipStatus $status): array
    {
        return [
            'userId' => $result['userId'],
            'fullName' => trim((string) $input['full_name']),
            'status' => $status->value,
            'parishUnitL1Id' => self::trimmed($input['parish_unit_l1_id'] ?? null),
            'parishUnitL2Id' => self::trimmed($input['parish_unit_l2_id'] ?? null),
        ];
    }

    /**
     * INV-14 before anything is written: both credentials or neither. The
     * users_credentials_paired CHECK would catch it too, but as a driver
     * error rather than a sentence a child can read.
     *
     * @param  array<string, ?string>  $input
     * @return array{username: ?string, password_hash: ?string}
     */
    private function credentialsFrom(array $input): array
    {
        $username = self::trimmed($input['username'] ?? null);
        // Not trimmed: a password is bytes a person chose.
        $password = self::blank($input['password'] ?? null) ? null : (string) $input['password'];

        if ($username === null && $password === null) {
            return ['username' => null, 'password_hash' => null];
        }
        if ($username === null || $password === null) {
            throw new RuleViolated('required_fields_missing');
        }
        // Code points, not bytes: "ký tự" is characters (policy.ts).
        if (mb_strlen($password) < 8) {
            throw new RuleViolated('password_too_short');
        }
        if (array_key_exists('password_confirmation', $input) && $input['password_confirmation'] !== $password) {
            throw new RuleViolated('passwords_dont_match');
        }

        return ['username' => $username, 'password_hash' => Hash::make($password)];
    }

    /**
     * @param  array<string, ?string>  $input
     * @param  array{username: ?string, password_hash: ?string}  $credentials
     */
    private function findExistingPerson(array $input, array $credentials): ?User
    {
        if ($credentials['username'] !== null) {
            $row = User::query()
                ->whereRaw('LOWER(username) = LOWER(?)', [$credentials['username']])
                ->first();
            if ($row === null) {
                return null;
            }
            $ok = $row->password_hash !== null
                && ! self::blank($input['password'] ?? null)
                && Hash::check((string) $input['password'], $row->password_hash);
            if (! $ok) {
                throw new RuleViolated('username_taken');
            }

            return $row;
        }

        // The exact triple — and a blank phone can never be one third of
        // it (the stored value is NULL, which equals nothing), so a
        // reason-instead-of-phone registration is always a new person.
        if (self::blank($input['phone'] ?? null)) {
            return null;
        }

        return User::query()
            ->whereRaw('LOWER(full_name) = LOWER(?)', [trim((string) $input['full_name'])])
            ->whereDate('date_of_birth', trim((string) $input['date_of_birth']))
            ->where('phone', trim((string) $input['phone']))
            ->first();
    }

    /**
     * @param  array<string, ?string>  $input
     * @param  array{username: ?string, password_hash: ?string}  $credentials
     */
    private function createPerson(array $input, array $credentials): User
    {
        $phone = self::trimmed($input['phone'] ?? null);

        $user = new User([
            'saint_name' => trim((string) $input['saint_name']),
            'full_name' => trim((string) $input['full_name']),
            'date_of_birth' => trim((string) $input['date_of_birth']),
            'father_name' => trim((string) $input['father_name']),
            'mother_name' => trim((string) $input['mother_name']),
            'phone' => $phone,
            // The reason travels only when the phone does not: a present
            // number makes the reason stale from the start.
            'phone_missing_reason' => $phone === null ? self::trimmed($input['phone_missing_reason'] ?? null) : null,
            'email' => self::trimmed($input['email'] ?? null),
            'avatar_object' => self::trimmed($input['avatar_object'] ?? null),
        ]);
        // Not $fillable, on purpose (the model's own docblock): assigned
        // directly, by name, only here and in SetReaderCredentials.
        $user->username = $credentials['username'];
        $user->password_hash = $credentials['password_hash'];
        $user->save();

        return $user;
    }

    /**
     * BR §2: a rejected applicant may re-apply and a member who left may
     * come back — on the SAME row, because memberships_one_per_shelf
     * ignores status. Eligibility is the graph's decision, never a second
     * hand-maintained status list (CRITICAL 1): every walk-back is a
     * `→ pending` re-application; a manager immediately activating the
     * same reader (ManagerRegisterReader) is a further explicit promotion
     * on top of a re-application the graph already approved. `suspended`
     * has no `→ pending` edge, so it refuses like pending/active do.
     *
     * role is forced back to 'reader' on a walk-back — the reference's
     * reversed decision, in full: a non-active row's role confers nothing
     * (the membership resolution filters status = active), and refusing
     * instead left a returning ex-manager unable to re-enrol by ANY path.
     */
    private function upsertMembership(string $userId, ?string $l1, ?string $l2, MembershipStatus $status, ?User $approver): string
    {
        $existing = Membership::query()->where('user_id', $userId)->first();

        if ($existing !== null) {
            if (MembershipTransitions::check($existing->status, MembershipStatus::Pending) !== null) {
                throw new RuleViolated('already_registered_here');
            }

            $existing->update([
                'status' => $status,
                'role' => 'reader',
                'parish_unit_l1_id' => $l1,
                'parish_unit_l2_id' => $l2,
                'rejection_reason' => null,
                'suspension_reason' => null,
                'approved_by' => $status === MembershipStatus::Active ? $approver?->id : null,
                'approved_at' => $status === MembershipStatus::Active ? $this->clock->now() : null,
            ]);

            return $existing->id;
        }

        $membership = Membership::query()->create([
            'user_id' => $userId,
            'role' => 'reader',
            'status' => $status,
            'parish_unit_l1_id' => $l1,
            'parish_unit_l2_id' => $l2,
            'approved_by' => $status === MembershipStatus::Active ? $approver?->id : null,
            'approved_at' => $status === MembershipStatus::Active ? $this->clock->now() : null,
        ]);

        return $membership->id;
    }

    /** Whitespace is absence: a form posts "   " far more often than null. */
    private static function blank(?string $v): bool
    {
        return $v === null || trim($v) === '';
    }

    private static function trimmed(?string $v): ?string
    {
        return self::blank($v) ? null : trim((string) $v);
    }

    /**
     * Y-m-d and a real calendar day, nothing else — checkdate() is what
     * refuses 2015-02-30 after the regex has passed its shape.
     */
    private static function assertStorableDate(string $date): void
    {
        if (preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $date, $m) !== 1
            || ! checkdate((int) $m[2], (int) $m[3], (int) $m[1])) {
            throw new RuleViolated('validation_failed');
        }
    }
}
