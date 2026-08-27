<?php

namespace App\Actions\Catalogue;

use App\Enums\CopyState;
use App\Models\BookCopy;
use App\Models\Loan;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\Catalogue\CopyStateMachine;
use App\Support\Clock;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * Marks a copy lost and closes the loan it was out on — port of
 * report-copy-lost.ts. Q3, decided in the reference and kept: only an
 * on_loan copy (BR §7.1 draws exactly one arrow into lost); the refusal
 * comes from the transition table, so widening it later is a line there
 * plus a test, nothing here. OPS §4.1: the active loan is closed as lost,
 * "not left dangling as active" — a second state transition, so INV-8
 * earns it a second audit entry. The note has no column (BR §5.4 gives
 * BookCopy a time reported lost and no lost note); it lives in the audit
 * entry, where a manager reading the history will look anyway.
 *
 * In 1c this command gains a second UI entry point — "Bạn đọc báo làm
 * mất" inside receive-return — with this contract unchanged.
 */
final class ReportCopyLost
{
    public function __construct(
        private Clock $clock,
        private AuditRecorder $audit,
    ) {}

    public function execute(User $actor, BookCopy $copy, ?string $note = null): void
    {
        Gate::forUser($actor)->authorize('reportLost', $copy);

        DB::transaction(function () use ($actor, $copy, $note): void {
            CopyStateMachine::assert($copy->state, CopyState::Lost);

            $before = ['state' => $copy->state->value];
            $now = $this->clock->now();

            $copy->update(['state' => CopyState::Lost, 'lost_reported_at' => $now]);

            $this->audit->record('copy.lost_reported', 'copy', $copy->id, $before, [
                'state' => 'lost',
                'note' => $note,
            ]);

            $loan = $copy->loans()->where('status', 'active')->first();

            if ($loan instanceof Loan) {
                $loan->update([
                    'status' => 'lost',
                    'lost_reported_at' => $now,
                    'lost_reported_by' => $actor->id,
                ]);

                $this->audit->record('loan.lost', 'loan', $loan->id,
                    ['status' => 'active'], ['status' => 'lost']);
            }
        });
    }
}
