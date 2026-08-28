<?php

namespace App\Actions\Members;

use App\Enums\LoanStatus;
use App\Enums\MembershipStatus;
use App\Exceptions\RuleViolated;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\Members\MembershipTransitions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * Any status → left (OPS §4.3), including left → left — the graph's own
 * idempotent self-loop (M6: a re-clicked "Đánh dấu đã rời" is not an
 * error). BLOCKED while the reader still holds a book: OPS lists
 * has_active_loans and flags it as inferred, the plan header's open
 * question 2 records the alternative reading, and this implements OPS's —
 * a `left` membership is a person the shelf stopped tracking, and their
 * phone number is the mechanism by which books come back (BR §16.3).
 *
 * The loan read happens AFTER the lock, inside the transaction, through
 * the scoped Loan model — the count is this shelf's active loans for this
 * person, the same set the reference read through loans_current + RLS.
 */
final class MarkMembershipLeft
{
    public function __construct(private AuditRecorder $audit) {}

    public function execute(User $actor, Membership $membership): void
    {
        Gate::forUser($actor)->authorize('markLeft', $membership);

        DB::transaction(function () use ($membership): void {
            $membership = Membership::query()->lockForUpdate()->findOrFail($membership->id);

            MembershipTransitions::assert($membership->status, MembershipStatus::Left);

            $holding = Loan::query()
                ->where('borrower_id', $membership->user_id)
                ->where('status', LoanStatus::Active)
                ->exists();
            if ($holding) {
                throw new RuleViolated('member_has_active_loans');
            }

            $before = ['status' => $membership->status->value];

            $membership->update(['status' => MembershipStatus::Left]);

            $this->audit->record('membership.left', 'membership', $membership->id,
                $before, ['status' => 'left']);
        });
    }
}
