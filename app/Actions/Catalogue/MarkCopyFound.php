<?php

namespace App\Actions\Catalogue;

use App\Enums\CopyState;
use App\Exceptions\RuleViolated;
use App\Models\BookCopy;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\Catalogue\CopyStateMachine;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * A lost copy turns up again (BR §7.1: lost → available; BR §3's "a book
 * reported lost is found months later") — port of mark-copy-found.ts.
 * The machine also allows on_loan → available (the return path), so this
 * command additionally requires the copy actually BE lost — a return is
 * 1c's ReceiveReturn, not this. THE LOAN IS NOT REOPENED: BR §7.3 draws
 * no arrow out of lost for a loan, and INV-11 forbids deleting one. The
 * copy comes back; what happened to it stays on the record.
 */
final class MarkCopyFound
{
    public function __construct(private AuditRecorder $audit) {}

    public function execute(User $actor, BookCopy $copy, ?string $note = null): void
    {
        Gate::forUser($actor)->authorize('markFound', $copy);

        DB::transaction(function () use ($copy, $note): void {
            if ($copy->state !== CopyState::Lost) {
                throw new RuleViolated('not_lost');
            }

            CopyStateMachine::assert($copy->state, CopyState::Available);

            $copy->update(['state' => CopyState::Available, 'lost_reported_at' => null]);

            $this->audit->record('copy.found', 'copy', $copy->id,
                ['state' => 'lost'],
                ['state' => 'available', 'note' => $note],
            );
        });
    }
}
