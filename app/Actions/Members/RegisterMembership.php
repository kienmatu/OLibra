<?php

namespace App\Actions\Members;

use App\Enums\MembershipStatus;
use App\Support\AuditRecorder;
use Illuminate\Support\Facades\DB;

/**
 * Public self-registration (BR §16.1) — a `pending` membership a manager
 * must approve; BR §4's assumption 3 makes that approval the consent step
 * for holding a minor's data, so it is never skipped here.
 *
 * THE CALLER IS A GUEST AND THERE IS NO GATE HERE ON PURPOSE. Every other
 * command in this slice opens with a policy check; this is the single open
 * door OPS §2 leaves in the catalogue, and adding a gate would close the
 * registration form. Rate limiting is the route's (infrastructure, not
 * domain — OPS §8; Task 13's throttle), and the structural defences are
 * users_username_key, memberships_one_per_shelf, and the anti-probe
 * matching rules in Registration.
 */
final class RegisterMembership
{
    public function __construct(
        private Registration $registration,
        private AuditRecorder $audit,
    ) {}

    /**
     * @param  array<string, ?string>  $input
     * @return array{userId: string, membershipId: string}
     */
    public function execute(array $input): array
    {
        return DB::transaction(function () use ($input): array {
            $result = $this->registration->register($input, MembershipStatus::Pending, null);

            // Actor is null — Auth::id() has nobody. The row still lands on
            // the bound shelf, which is what distinguishes it from a
            // manager-typed registration when the queue renders it.
            $this->audit->record(
                'membership.registered', 'membership', $result['membershipId'],
                null, $this->registration->auditAfter($input, $result, MembershipStatus::Pending),
            );

            return $result;
        });
    }
}
