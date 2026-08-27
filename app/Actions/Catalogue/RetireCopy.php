<?php

namespace App\Actions\Catalogue;

use App\Enums\CopyState;
use App\Exceptions\RuleViolated;
use App\Models\BookCopy;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\Catalogue\CopyStateMachine;
use App\Support\Clock;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * Permanently withdraws a copy (BR §7.1: available → retired, lost →
 * retired) — port of retire-copy.ts. RETIREMENT IS NOT DELETION (BR §11):
 * this is a domain state with a required reason, recording something that
 * actually happened; deleted_at undoes mistakes. The blank-reason check
 * runs before the state machine so book_copies_retired_has_reason's errno
 * 4025 becomes a named refusal instead of a driver error (OPS §2). The
 * on_loan refusal comes from the transition table, which names it
 * copy_on_loan specifically — a copy someone is still holding would be a
 * book the system lost track of if this succeeded.
 *
 * REVISED (review finding): $copy is the route-bound instance, read at the
 * top of the request — a different snapshot from whatever runs inside this
 * transaction. Proven live: bind a copy while `available`, flip the row to
 * `on_loan` underneath it with an open loan, call this action — without the
 * re-read below, `CopyStateMachine::assert` sees the stale `available` in
 * memory, the copy commits `retired`, and the loan is left `active` with
 * nobody able to find the book anymore. This re-reads with `lockForUpdate`,
 * not a plain `refresh()`, as the FIRST statement in the transaction —
 * before `assert()` reads any state at all. `refresh()` alone would only
 * fix the read that happened before this transaction opened: InnoDB's
 * REPEATABLE READ pins the read view at the transaction's first consistent
 * read, so a `refresh()` done first would see the current committed row,
 * but nothing then stops a concurrent transaction from committing a change
 * to this exact row in the gap between that read and this transaction's
 * own `UPDATE` — which carries no state check in its `WHERE` clause and
 * would blindly overwrite it. A locking read closes that gap outright: it
 * always reads the latest committed version regardless of the pinned
 * snapshot, and it holds the row lock for the rest of the transaction, so a
 * concurrent writer targeting this same copy blocks until this transaction
 * resolves instead of racing it.
 */
final class RetireCopy
{
    public function __construct(
        private Clock $clock,
        private AuditRecorder $audit,
    ) {}

    public function execute(User $actor, BookCopy $copy, string $reason): void
    {
        Gate::forUser($actor)->authorize('retire', $copy);

        if (trim($reason) === '') {
            throw new RuleViolated('retire_reason_required');
        }

        DB::transaction(function () use ($copy, $reason): void {
            // FIRST statement, before assert() reads any state — see the
            // class docblock.
            $copy = BookCopy::query()->lockForUpdate()->findOrFail($copy->id);

            CopyStateMachine::assert($copy->state, CopyState::Retired);

            $before = ['state' => $copy->state->value];

            $copy->update([
                'state' => CopyState::Retired,
                'retired_at' => $this->clock->now(),
                'retired_reason' => trim($reason),
            ]);

            $this->audit->record('copy.retired', 'copy', $copy->id, $before, [
                'state' => 'retired',
                'reason' => trim($reason),
            ]);
        });
    }
}
