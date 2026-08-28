<?php

namespace App\Actions\Circulation;

use App\Enums\CopyCondition;
use App\Enums\CopyState;
use App\Enums\LoanStatus;
use App\Exceptions\RuleViolated;
use App\Models\BookCopy;
use App\Models\ConditionAssessment;
use App\Models\Loan;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\Clock;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * Closes a loan and records the copy's condition — OPS §5's walk, BR
 * §16.3's two-tap common case. Port of receive-return.ts, NARROWED for 1c
 * (plan divergence 4): no holdForRequestId, no queuedRequestId, no
 * request.approved pairing, no notification — the queued-reader decision
 * needs Phase 2's borrow requests to exist. Phase 2 re-widens this
 * signature to the reference's exact shape: both facts in one transaction,
 * two audit rows, the copy never observably available in between.
 *
 * Lock order (divergence 1): copy FIRST — located from the route-bound
 * loan's own copy_id attribute, no query — then the loan. Same order as
 * ReportCopyLost, so a return racing "bạn đọc báo làm mất" on the same
 * copy serialises instead of deadlocking, and whichever commits second
 * sees the closed loan and refuses cleanly (loan_not_active — the
 * double-submit sentence, OPS §4.2's one deliberate code for not-found,
 * not-mine and already-processed alike).
 *
 * T27 (OPS §5): a worse condition never diverts the copy away from
 * available. condition_note moves with condition — one judgement, exactly
 * as AssessCondition writes them.
 *
 * loans_returned_has_condition: status and return_condition are ONE
 * update() — split writes raise the CHECK mid-transaction.
 */
final class ReceiveReturn
{
    public function __construct(
        private Clock $clock,
        private AuditRecorder $audit,
    ) {}

    public function execute(User $actor, Loan $loan, CopyCondition $condition, ?string $note = null, ?string $photoUrl = null): void
    {
        Gate::forUser($actor)->authorize('receiveReturn', $loan);

        DB::transaction(function () use ($actor, $loan, $condition, $note, $photoUrl): void {
            // FIRST statement — copy_id is an in-memory attribute of the
            // route-bound model; reading it issues no query, so the copy
            // lock is genuinely the transaction's first statement.
            $copy = BookCopy::query()->lockForUpdate()->findOrFail($loan->copy_id);
            // SECOND — the loan, latest committed row, not the snapshot.
            $loan = Loan::query()->lockForUpdate()->findOrFail($loan->id);

            if ($loan->status !== LoanStatus::Active) {
                throw new RuleViolated('loan_not_active');
            }

            $now = $this->clock->now();
            $trimmedNote = ($note === null || trim($note) === '') ? null : trim($note);

            ConditionAssessment::query()->create([
                'copy_id' => $copy->id,
                'loan_id' => $loan->id,
                'assessed_by' => $actor->id,
                'condition' => $condition,
                'note' => $trimmedNote,
                'photo_url' => $photoUrl,
                'assessed_at' => $now,
            ]);

            $loan->update([
                'status' => LoanStatus::Returned,
                'returned_at' => $now,
                'received_by' => $actor->id,
                'return_condition' => $condition,
                'return_note' => $trimmedNote,
                'return_photo_url' => $photoUrl,
            ]);

            $copy->update([
                'state' => CopyState::Available,
                'condition' => $condition,
                'condition_note' => $trimmedNote,
            ]);

            $this->audit->record('loan.returned', 'loan', $loan->id,
                ['status' => 'active', 'copy_state' => 'on_loan'],
                [
                    'status' => 'returned',
                    'copy_state' => 'available',
                    'condition' => $condition->value,
                    'title' => $copy->book?->title,
                    'borrower_id' => $loan->borrower_id,
                ]);
        });
    }
}
