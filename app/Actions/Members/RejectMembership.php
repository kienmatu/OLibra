<?php

namespace App\Actions\Members;

use App\Enums\MembershipStatus;
use App\Exceptions\RuleViolated;
use App\Models\Membership;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\Members\MembershipTransitions;
use App\Support\Notifications\NotificationKind;
use App\Support\Notifications\Notifier;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * pending → rejected, retained with a reason so the person may re-apply
 * (BR §2). Nothing is deleted. The reason is required by the database too
 * (memberships_rejected_has_reason) — checking it here first is what turns
 * a constraint error into OPS §4.3's named refusal.
 */
final class RejectMembership
{
    public function __construct(
        private AuditRecorder $audit,
        private Notifier $notifier,
    ) {}

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

            // OPS §7's second row. The reason is the whole point of this
            // sentence, and it is unconditional: execute()'s signature is
            // non-nullable and the guard above has already refused a blank
            // one, so by here $reason is a non-empty string — the same
            // trim($reason) rejection_reason and the audit payload store.
            $this->notifier->notify(
                $membership->user_id,
                NotificationKind::MembershipRejected,
                ['reason' => trim($reason)],
            );
        });
    }
}
