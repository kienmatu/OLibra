<?php

namespace App\Actions\Circulation;

use App\Enums\CopyState;
use App\Enums\LoanStatus;
use App\Exceptions\RuleViolated;
use App\Models\BookCopy;
use App\Models\Loan;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\Clock;
use App\Support\ConcurrencyRetry;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * Undoes a loan recorded in error — BR §3's edge case, port of
 * void-loan.ts. Never a delete (INV-11): the row survives with status,
 * reason and voider, so "why is there no loan here" has an answer six
 * months later; the loans_no_delete trigger refuses DELETE regardless,
 * which is what makes this a rule rather than a convention.
 *
 * The reason check runs BEFORE the transaction: trimmed, so three spaces
 * are no reason (loans_voided_has_reason only catches NULL, and would
 * surface as a raw CHECK violation rather than OPS §4.2's sentence).
 * status + void_reason are ONE update() for the same constraint.
 *
 * loan_not_active_cannot_void, not loan_not_active — the two refusals
 * differ: a double-submitted return is nothing wrong, while voiding a
 * closed loan is an undo that no longer applies, and BR §17.7 asks the
 * message to say what is allowed instead. Not-found and another shelf's
 * loan share the code, the usual anti-enumeration fold.
 *
 * Lock order: copy first (from the bound loan's in-memory copy_id), then
 * loan — divergence 1's global order, shared with ReceiveReturn and
 * ReportCopyLost so the three serialise instead of deadlocking.
 */
final class VoidLoan
{
    public function __construct(
        private Clock $clock,
        private AuditRecorder $audit,
    ) {}

    public function execute(User $actor, Loan $loan, string $reason): void
    {
        Gate::forUser($actor)->authorize('void', $loan);

        $reason = trim($reason);
        if ($reason === '') {
            throw new RuleViolated('reason_required');
        }

        DB::transaction(function () use ($actor, $loan, $reason): void {
            // FIRST statement — copy_id is an in-memory attribute, no query.
            $copy = BookCopy::query()->lockForUpdate()->findOrFail($loan->copy_id);
            $loan = Loan::query()->lockForUpdate()->findOrFail($loan->id);

            if ($loan->status !== LoanStatus::Active) {
                throw new RuleViolated('loan_not_active_cannot_void');
            }

            $loan->update([
                'status' => LoanStatus::Voided,
                'voided_at' => $this->clock->now(),
                'voided_by' => $actor->id,
                'void_reason' => $reason,
            ]);

            // INV-2, and INV-1's other half: the generated column already
            // frees the copy as far as the index is concerned, but state
            // is what every screen and borrowable() read — a copy left
            // on_loan with no active loan is a book nobody can lend and
            // nobody can find the loan for.
            $copy->update(['state' => CopyState::Available]);

            $this->audit->record('loan.voided', 'loan', $loan->id,
                ['status' => 'active', 'copy_state' => 'on_loan'],
                ['status' => 'voided', 'copy_state' => 'available', 'reason' => $reason]);
        }, ConcurrencyRetry::ATTEMPTS);
    }
}
