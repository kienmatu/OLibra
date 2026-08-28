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
 *
 * REVISED (review finding): re-reads $copy with `lockForUpdate` as the
 * FIRST statement in the transaction, before the explicit lost-check, for
 * the identical reason given in RetireCopy's docblock. This action's own
 * shape makes the stale-read hole sharper than the other three: a copy
 * bound while `lost` that is actually `on_loan` by the time this runs (the
 * loan having been returned through a different path meanwhile) would, on
 * the stale instance, pass the explicit `!== Lost` guard AND
 * `CopyStateMachine::assert` (lost->available is an allowed transition,
 * since it is also the return path's arrow) — silently teleporting an
 * on-loan copy to available with its loan left exactly as it was, no
 * return ever recorded. The re-read closes it the same way: a locking read
 * sees the current committed state regardless of the pinned REPEATABLE
 * READ snapshot, and holds the row lock so nothing else can change this
 * copy underneath the rest of the transaction.
 */
final class MarkCopyFound
{
    public function __construct(private AuditRecorder $audit) {}

    public function execute(User $actor, BookCopy $copy, ?string $note = null): void
    {
        Gate::forUser($actor)->authorize('markFound', $copy);

        DB::transaction(function () use ($copy, $note): void {
            // FIRST statement, before the lost-check reads any state — see
            // the class docblock.
            $copy = BookCopy::query()->lockForUpdate()->findOrFail($copy->id);

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
