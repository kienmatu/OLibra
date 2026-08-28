<?php

namespace App\Actions\Members;

use App\Enums\MembershipStatus;
use App\Models\Membership;
use App\Models\User;
use App\Support\AuditRecorder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * A manager registers a reader in person — BR §16.3's quick-lend escape
 * hatch ("Đăng ký người đọc mới"). Creates an ACTIVE membership: OPS §4.3
 * infers it from BR §1.3 (a pending member cannot be lent to, INV-4, so a
 * pending result would defeat the affordance), flags the inference, and
 * the reference ships it. THE PLAN HEADER'S OPEN QUESTION 1 records the
 * product owner still owes the final word; reversing it is the ::Active
 * below plus one assertion.
 *
 * NO ROUTE THIS PHASE — 1c's quick-lend is the screen; the architecture
 * suite pins the absence (Task 16), the DeleteBook precedent.
 */
final class ManagerRegisterReader
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

        return DB::transaction(function () use ($actor, $input): array {
            $result = $this->registration->register($input, MembershipStatus::Active, $actor);

            $this->audit->record(
                'membership.registered', 'membership', $result['membershipId'],
                null, $this->registration->auditAfter($input, $result, MembershipStatus::Active),
            );

            return $result;
        });
    }
}
