<?php

namespace App\Actions\Members;

use App\Enums\MembershipStatus;
use App\Exceptions\RuleViolated;
use App\Models\Membership;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\Members\MembershipTransitions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * pending → rejected, retained with a reason so the person may re-apply
 * (BR §2). Nothing is deleted. The reason is required by the database too
 * (memberships_rejected_has_reason) — checking it here first is what turns
 * a constraint error into OPS §4.3's named refusal.
 *
 * Phase 2 must add the membership_rejected notification write (with the
 * reason in its payload) here, in this transaction — known-gaps, Task 16.
 */
final class RejectMembership
{
    public function __construct(private AuditRecorder $audit) {}

    public function execute(User $actor, Membership $membership, string $reason): void
    {
        Gate::forUser($actor)->authorize('reject', $membership);

        if (trim($reason) === '') {
            throw new RuleViolated('reject_reason_required');
        }

        DB::transaction(function () use ($membership, $reason): void {
            $membership = Membership::query()->lockForUpdate()->findOrFail($membership->id);

            MembershipTransitions::assert($membership->status, MembershipStatus::Rejected);

            $before = ['status' => $membership->status->value];

            $membership->update([
                'status' => MembershipStatus::Rejected,
                'rejection_reason' => trim($reason),
            ]);

            $this->audit->record('membership.rejected', 'membership', $membership->id,
                $before, ['status' => 'rejected', 'reason' => trim($reason)]);
        });
    }
}
