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
