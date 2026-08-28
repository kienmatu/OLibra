<?php

namespace App\Actions\Members;

use App\Enums\MembershipStatus;
use App\Models\Membership;
use App\Models\User;
use App\Support\AuditRecorder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * A manager fills in the registration form for a child standing in front
 * of them (BR §16.1) — and it creates a PENDING application, unlike
 * ManagerRegisterReader, because §16.1 is explicit: "registering on behalf
 * still creates a pending application rather than an active member, so the
 * approval step and its audit record are never skipped." Filling in a form
 * is not the same act as approving it; collapsing the two would hold a
 * minor's data without the separate consent step BR §4's assumption 3
 * describes. The two commands disagree about `pending` on purpose.
 */
final class RegisterMemberOnBehalf
{
    public function __construct(
        private Registration $registration,
        private AuditRecorder $audit,
    ) {}

    /**
     * @param  array<string, ?string>  $input
     * @return array{userId: string, membershipId: string}
     */
    public function execute(User $actor, array $input): array
    {
        Gate::forUser($actor)->authorize('create', Membership::class);

        return DB::transaction(function () use ($input): array {
            $result = $this->registration->register($input, MembershipStatus::Pending, null);

            $this->audit->record(
                'membership.registered', 'membership', $result['membershipId'],
                null, $this->registration->auditAfter($input, $result, MembershipStatus::Pending),
            );

            return $result;
        });
    }
}
