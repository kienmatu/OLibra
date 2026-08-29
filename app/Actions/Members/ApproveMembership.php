<?php

namespace App\Actions\Members;

use App\Enums\MembershipStatus;
use App\Exceptions\RuleViolated;
use App\Models\Membership;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\Clock;
use App\Support\Notifications\NotificationKind;
use App\Support\Notifications\Notifier;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * pending → active (BR §7.5; §16.3's review card). BR §4 assumption 3
 * makes this the consent step for holding a minor's data — which is why
 * RegisterMemberOnBehalf cannot skip it, and why the approving manager is
 * recorded on the row as well as in the audit log.
 *
 * DELIBERATELY NOT MembershipTransitions::assert (IMPORTANT 3, mirrored
 * by ReactivateMembership): suspended → active is a real edge in the
 * graph, so delegating would let this command silently un-suspend a
 * membership, leaving status = active with a live suspension_reason
 * rendered on the reader detail. Approve's own rule is narrow — only a
 * PENDING application — so it is checked directly against status.
 *
 * Clears suspension_reason as well as rejection_reason, defensively: "no
 * active row carries a live suspension reason" is this command's own
 * guarantee, not a reachability accident borrowed from upstream.
 */
final class ApproveMembership
{
    public function __construct(
        private Clock $clock,
        private AuditRecorder $audit,
        private Notifier $notifier,
    ) {}

    public function execute(User $actor, Membership $membership): void
    {
        Gate::forUser($actor)->authorize('approve', $membership);

        DB::transaction(function () use ($actor, $membership): void {
            // FIRST statement — divergence 1: the route-bound instance is a
            // stale snapshot; the locking re-read (scoped, soft-delete
            // aware) is what a concurrent decision serialises against.
            $membership = Membership::query()->lockForUpdate()->findOrFail($membership->id);

            if ($membership->status !== MembershipStatus::Pending) {
                throw new RuleViolated('registration_not_pending');
            }

            $before = ['status' => $membership->status->value];

            $membership->update([
                'status' => MembershipStatus::Active,
                'approved_by' => $actor->id,
                'approved_at' => $this->clock->now(),
                'rejection_reason' => null,
                'suspension_reason' => null,
            ]);

            $this->audit->record('membership.approved', 'membership', $membership->id,
                $before, ['status' => 'active']);

            // OPS §7's first row: "Đăng ký được duyệt — ApproveMembership".
            // member's user_id, resolved from the locked row — never the
            // membership id (the recurring trap).
            $this->notifier->notify($membership->user_id, NotificationKind::MembershipApproved);
        });
    }
}
