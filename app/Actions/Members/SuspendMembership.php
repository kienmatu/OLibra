<?php

namespace App\Actions\Members;

use App\Enums\MembershipStatus;
use App\Models\Membership;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\Members\MembershipTransitions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * active → suspended (BR §7.5). Flips status and nothing else: BR §3's
 * "a reader is suspended while still holding a book" is why INV-4's second
 * sentence exists — existing loans are untouched, and must be.
 *
 * The reason is optional HERE (OPS §4.3); the screen requires one
 * (SuspendMembershipRequest, Task 15) — the same screen/command split the
 * reference kept between actions.ts and the command.
 */
final class SuspendMembership
{
    public function __construct(private AuditRecorder $audit) {}

    public function execute(User $actor, Membership $membership, ?string $reason): void
    {
        Gate::forUser($actor)->authorize('suspend', $membership);

        DB::transaction(function () use ($membership, $reason): void {
            $membership = Membership::query()->lockForUpdate()->findOrFail($membership->id);

            MembershipTransitions::assert($membership->status, MembershipStatus::Suspended);

            $before = ['status' => $membership->status->value];
            $trimmed = ($reason === null || trim($reason) === '') ? null : trim($reason);

            $membership->update([
                'status' => MembershipStatus::Suspended,
                'suspension_reason' => $trimmed,
            ]);

            $this->audit->record('membership.suspended', 'membership', $membership->id,
                $before, ['status' => 'suspended']);
        });
    }
}
