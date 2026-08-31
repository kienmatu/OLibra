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
 * OPS §4.5's shelf lifecycle, third command: `active → archived`. Port of
 * the reference's `archiveBookshelf`
 * (old_next/src/domain/admin/commands/bookshelves.ts:411).
 *
 * `status`, NEVER `deleted_at`. The reference records the difference at
 * length and this port inherits it: archiving hides the shelf from
 * circulation and retains everything, while a soft delete would also take
 * the row out of every admin listing — including this screen, which is
 * where the un-archive control lives. A shelf that could not be found could
 * not be restored.
 *
 * THE STATE RULE IS THE POLICY'S, NOT THIS CLASS'S. `BookshelfPolicy::
 * archive()` refuses an already-archived shelf, as a 404 rather than a 403
 * (spec D9), and it is pinned in `tests/Feature/Admin/BookshelfPolicyTest.php`
 * through `Gate::inspect()`. The reference throws `RuleViolated
 * ("already_archived")` from inside its command instead; here that check
 * would be a second copy of a rule already held one layer up, and the two
 * could drift. So this command authorizes and then acts — no status check
 * of its own, and no new refusal code for
 * `RuleViolatedCodesHaveSentencesTest` to carry.
 *
 * THE AUDIT ROW NAMES THE SHELF rather than being global, and this diverges
 * from the reference for a reason spec D4 settles. Its entry sets
 * `global: true` because over there an archived shelf's slug stops
 * resolving the moment this command commits, so a shelf-scoped row would be
 * written into a log nobody could open. In this port the resolver filter is
 * 3b-ii's, and `bookshelf.created` and `bookshelf.updated` already name
 * their shelf — a lifecycle that ended in a row filed somewhere else would
 * break the one log that tells a shelf's whole story. The un-archive row
 * below is filed the same way, which is what makes the pair readable in
 * sequence.
 *
 * NO WIDENING IS NEEDED and none is taken: `Bookshelf` carries no
 * `BelongsToBookshelf`, so nothing narrows this read. The recorder is the
 * only fail-closed guard in the path and the configurator is the sanctioned
 * way past it (spec D0). The transaction is here so the change and its
 * audit row commit together (OPS §1), and it retries because every write
 * transaction in this codebase does.
 */
final class ArchiveBookshelf
{
    public function __construct(
        private AuditRecorder $audit,
    ) {}

    public function execute(User $actor, Bookshelf $shelf): void
    {
        Gate::forUser($actor)->authorize('archive', $shelf);

        DB::transaction(function () use ($shelf): void {
            // The name travels in `before` because that is where the
            // sentence reads it from — the reference's own arm for this
            // action takes the name out of `before` rather than `after`,
            // since `after` carries only the new status.
            $before = ['name' => $shelf->name, 'status' => $shelf->status->value];

            $shelf->update(['status' => BookshelfStatus::Archived]);

            $this->audit->forShelf($shelf->id)->record(
                'bookshelf.archived',
                'bookshelf',
                $shelf->id,
                $before,
                ['status' => BookshelfStatus::Archived->value],
            );
        }, ConcurrencyRetry::ATTEMPTS);
    }
}
