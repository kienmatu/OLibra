<?php

namespace App\Actions\Admin;

use App\Enums\BookshelfStatus;
use App\Models\Bookshelf;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\ConcurrencyRetry;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * The mirror of ArchiveBookshelf: `archived → active`.
 *
 * THIS COMMAND HAS NO COUNTERPART IN THE REFERENCE, and it is the reason
 * `bookshelf.unarchived` is this port's own audit action rather than one of
 * BR §458's six. The reference's signed comment in `src/auth/guards.ts:27-37`
 * refuses to carve an exception into the resolver for an archived shelf's
 * own manager, and routes the two genuine needs it names — reactivating the
 * shelf, exporting its records — to "its own explicit admin path". This is
 * that path's first half (spec D4). An un-archive with no audit row would be
 * the one administration act in the area that left no record, which is why
 * the action is registered rather than the restore riding on
 * `bookshelf.updated`.
 *
 * THE STATE RULE IS THE POLICY'S. `BookshelfPolicy::unarchive()` allows only
 * an archived shelf, refusing anything else as a 404 — the archive command's
 * reasoning, in the other direction, and pinned the same way.
 *
 * `ResolveTenant` IS NOT TOUCHED BY THIS PHASE, deliberately. Until 3b-ii
 * adds the resolver filter, an archived shelf still serves its tenant-bound
 * routes exactly as it did before this task, so restoring one changes what
 * the admin listing says and what the audit log records rather than
 * reopening a door. Spec D4 explains why the blast radius and its remedy do
 * not ship in the same breath.
 */
final class UnarchiveBookshelf
{
    public function __construct(
        private AuditRecorder $audit,
    ) {}

    public function execute(User $actor, Bookshelf $shelf): void
    {
        Gate::forUser($actor)->authorize('unarchive', $shelf);

        DB::transaction(function () use ($shelf): void {
            $before = ['name' => $shelf->name, 'status' => $shelf->status->value];

            $shelf->update(['status' => BookshelfStatus::Active]);

            $this->audit->forShelf($shelf->id)->record(
                'bookshelf.unarchived',
                'bookshelf',
                $shelf->id,
                $before,
                ['status' => BookshelfStatus::Active->value],
            );
        }, ConcurrencyRetry::ATTEMPTS);
    }
}
