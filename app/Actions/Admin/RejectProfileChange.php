<?php

declare(strict_types=1);

namespace App\Actions\Admin;

use App\Actions\Admin\Concerns\DecidesProfileChanges;
use App\Enums\ProfileChangeStatus;
use App\Exceptions\RuleViolated;
use App\Models\ProfileChangeRequest;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\Clock;
use App\Support\ConcurrencyRetry;
use App\Support\Notifications\NotificationKind;
use App\Support\Notifications\Notifier;
use App\Support\TenantContext;
use Illuminate\Support\Facades\DB;

/**
 * A manager refuses a pending change, with a reason the reader then reads
 * on their own profile page — OPS §4.3's RejectProfileChange, the same
 * required-reason pattern as RejectMembership and RejectComment (BR §16.3).
 * Port of old_next/src/domain/members/commands/reject-profile-change.ts.
 *
 * NOTHING ON THE PERSON MOVES, and there is nothing to undo: the proposal
 * never touched the record. This command writes one row, in
 * profile_change_requests, and one audit row.
 *
 * Who may decide is App\Actions\Admin\Concerns\DecidesProfileChanges' —
 * spec D2's rule, identical to Approve's and deliberately not restated a
 * second time here. OPS §4.3 says the same thing about its own two
 * entries: "governed by the identical routing rule … and is not restated".
 *
 * ── The reason exists at four layers, and each layer is load-bearing ─────
 *
 * 1. A BLANK REASON IS `reject_reason_required`, refused before any
 *    database round trip. Whitespace counts as blank — a space bar is not
 *    a reason a reader can act on.
 *
 * 2. IT IS WRITTEN IN ONE STATEMENT WITH THE STATUS. The table carries
 *    CHECK (status <> 'rejected' OR rejection_reason IS NOT NULL)
 *    (`profile_change_requests_rejected_has_reason`), so setting the status
 *    first and the reason after is not a tidier spelling of the same thing
 *    — it is a write the database refuses outright, in a driver error, on
 *    the first statement.
 *
 * 3. IT IS REPEATED INTO THE AUDIT `after`. The column is overwritable —
 *    a later decision on a later request, a correction, a migration — and
 *    the audit row is not. BR §13.2's oversight question is "what reason
 *    did this manager give at the time", and only the permanent row can
 *    answer it.
 *
 * 4. IT IS CARRIED TO THE READER, in the notification (BR:490, which
 *    names this pair as "profile change rejected (carrying the manager's
 *    reason)"). Layer 2 puts the reason where the reader's page reads it;
 *    this is what stops them having to go and look. It is a COPY of the
 *    same trimmed string rather than a reference to the column for the
 *    same reason layer 3 is: the column is overwritable and the
 *    notification row, like the audit row, is the record of what was said
 *    at the time.
 *
 * ITS AUDIT ROW IS AGAINST THE `profile_change_request`, not the user —
 * spec D3's entity-type rule, and the asymmetry with Approve is the point:
 * nothing about the person changed, so a row filed against the person would
 * claim something happened to them that did not.
 */
final class RejectProfileChange
{
    use DecidesProfileChanges;

    public function __construct(
        private AuditRecorder $audit,
        private Clock $clock,
        private TenantContext $context,
        private Notifier $notifier,
    ) {}

    public function execute(User $actor, ProfileChangeRequest $request, string $reason): void
    {
        $reason = trim($reason);

        if ($reason === '') {
            throw new RuleViolated('reject_reason_required');
        }

        DB::transaction(function () use ($actor, $request, $reason): void {
            $this->lockSubject($request);
            $membership = $this->subjectMembership($request);

            $this->assertMayDecide($actor, $membership, $request);

            $pending = $this->lockPendingRequest($request);

            // ONE statement — see layer 2 above.
            $pending->update([
                'status' => ProfileChangeStatus::Rejected->value,
                'rejection_reason' => $reason,
                'decided_by' => $actor->id,
                'decided_at' => $this->clock->now(),
            ]);

            $this->audit->forShelf($pending->bookshelf_id)->record(
                'profile_change.rejected',
                'profile_change_request',
                $pending->id,
                ['status' => ProfileChangeStatus::Pending->value],
                ['status' => ProfileChangeStatus::Rejected->value, 'reason' => $reason],
            );

            // Layer 4, INSIDE the transaction — a reader told their change
            // was refused by a transaction that then rolled back would be
            // told about a refusal that never happened.
            //
            // The reason is unconditional: the guard at the top of
            // execute() has already refused a blank one, so by here
            // $reason is the same non-empty trimmed string the column and
            // the audit row hold. RejectMembership's own notify says the
            // same thing about the same shape.
            $this->notifier->forShelf($pending->bookshelf_id)->notify(
                $pending->user_id,
                NotificationKind::ProfileChangeRejected,
                ['reason' => $reason],
            );
        }, ConcurrencyRetry::ATTEMPTS);
    }

    private function tenantContext(): TenantContext
    {
        return $this->context;
    }
}
