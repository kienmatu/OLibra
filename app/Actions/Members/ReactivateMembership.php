<?php

namespace App\Actions\Members;

use App\Enums\MembershipStatus;
use App\Exceptions\RuleViolated;
use App\Models\Membership;
use App\Models\User;
use App\Support\AuditRecorder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * suspended → active (BR §7.5's bidirectional arrow), clearing the
 * suspension reason on the way out — a stale reason would render on the
 * reader detail as though the account were still suspended for it.
 *
 * DELIBERATELY NOT MembershipTransitions::assert — the mirror image of
 * ApproveMembership's note: pending → active is a real edge too, so
 * delegating would let this command silently approve a pending
 * application. Only a SUSPENDED membership may be reactivated; checked
 * directly against status, with OPS §4.3's own sentence.
 */
final class ReactivateMembership
{
    public function __construct(private AuditRecorder $audit) {}

    public function execute(User $actor, Membership $membership): void
    {
        Gate::forUser($actor)->authorize('reactivate', $membership);

        DB::transaction(function () use ($membership): void {
            $membership = Membership::query()->lockForUpdate()->findOrFail($membership->id);

            if ($membership->status !== MembershipStatus::Suspended) {
                throw new RuleViolated('not_suspended_cannot_reactivate');
            }

            $before = ['status' => $membership->status->value];

            $membership->update([
                'status' => MembershipStatus::Active,
                'suspension_reason' => null,
            ]);

            $this->audit->record('membership.reactivated', 'membership', $membership->id,
                $before, ['status' => 'active']);
        });
    }
}
