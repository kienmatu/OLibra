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
 *
 * REVISED (review finding): re-reads $copy with `lockForUpdate` as the
 * FIRST statement in the transaction, before `assert()`, for the identical
 * reason and the identical choice given in RetireCopy's docblock — the
 * route-bound $copy is a different, possibly stale, snapshot, and a plain
 * `refresh()` would still leave a gap between the read and this
 * transaction's own writes for a concurrent transaction to land in. See
 * RetireCopy for the full REPEATABLE READ argument; it applies here
 * unchanged because the shape of the bug is the same single-row
 * read-modify-write, just against a different arrow in the transition
 * table.
 *
 * REVISED (1c, divergence 2): a LOCKING read, issued after this
 * transaction's copy lock — the global circulation order (copy
 * before loan). The plain read it replaces saw 'active' from
 * its own snapshot and then updated blindly: racing
 * ReceiveReturn, that update waited on the return's row lock
 * and then flipped a committed 'returned' loan to 'lost'. The
 * locking read sees the latest committed row instead, so a
 * return that won cleanly leaves nothing here to close.
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
            // FIRST statement, before assert() reads any state — see the
            // class docblock.
            $copy = BookCopy::query()->lockForUpdate()->findOrFail($copy->id);

            CopyStateMachine::assert($copy->state, CopyState::Lost);

            $before = ['state' => $copy->state->value];
            $now = $this->clock->now();

            $copy->update(['state' => CopyState::Lost, 'lost_reported_at' => $now]);

            $this->audit->record('copy.lost_reported', 'copy', $copy->id, $before, [
                'state' => 'lost',
                'note' => $note,
            ]);

            $loan = $copy->loans()->where('status', 'active')->lockForUpdate()->first();

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
