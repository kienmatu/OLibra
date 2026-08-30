<?php

namespace App\Actions\Community;

use App\Models\Announcement;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\ConcurrencyRetry;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * Releases an announcement from the top of the shelf's news — OPS §4.4's
 * UnpinAnnouncement. Port of
 * old_next/src/domain/community/commands/announcements.ts's
 * unpinAnnouncement.
 *
 * ITS OWN CLASS AND ITS OWN LITERAL ACTION NAME, not a boolean parameter
 * on PinAnnouncement, for the reason that file's docblock measures: a
 * shared writer taking the flag would have to take the action name too,
 * and AuditActionCensusTest's per-file block fails the build on a
 * `->record(` call whose action is not a literal. Two nearly identical
 * files is the price of a census that can see every action a build can
 * write.
 *
 * UNPINNING AN ALREADY-UNPINNED ROW is a no-op write that still records
 * the act, the reference's behaviour: `before` and `after` come out with
 * the same is_pinned, which is an honest description of what a manager
 * pressing an unpinned button did. MEASURED on this method, both halves,
 * the same pair PinAnnouncement's docblock names for its own direction:
 * AnnouncementStateTest's "unpinning an already-unpinned row records the
 * act with the same flag on both sides" pins the two bags, and
 * "…issues no UPDATE while the audit row is still written" reads the
 * query log of exactly this call — two statements, the locked select and
 * the audit insert, with an update on the announcements table absent
 * from the log.
 *
 * NO SHELF FILTER IS WRITTEN HERE, and there must not be one:
 * BookshelfScope on the model confines the re-read, so a row belonging
 * to another shelf is not found rather than refused — a 404 through
 * findOrFail, never a 403 that confirms the row exists. (Spelled without
 * the column name deliberately: TenancyArchitectureTest's tripwire reads
 * raw source and a where-shaped call beside that literal reddens it from
 * a comment as readily as from code.)
 *
 * THE LOCK IS THE TRANSACTION'S FIRST STATEMENT, and it earns its place
 * on the audit — CommunityArchitectureTest's FOR-UPDATE record states
 * the rule and this command falls on the lock side of it. INV-8's
 * `before` is_pinned is read off the locked row, so the prior flag this
 * command reports is the row's at the moment of the write rather than
 * the caller's instance's.
 *
 * The transaction retries because every write transaction in this phase
 * does (plan divergence 1); the row and its audit entry commit together.
 */
final class UnpinAnnouncement
{
    public function __construct(
        private AuditRecorder $audit,
    ) {}

    /** @return array{announcementId: string} */
    public function execute(User $actor, Announcement $announcement): array
    {
        Gate::forUser($actor)->authorize('unpin', $announcement);

        return DB::transaction(function () use ($announcement): array {
            // FIRST statement — the only lock this command takes.
            $locked = Announcement::query()->lockForUpdate()->findOrFail($announcement->id);

            // Taken off the locked read, not off the caller's instance.
            $before = ['is_pinned' => $locked->is_pinned];

            $locked->update(['is_pinned' => false]);

            // The reference's bag exactly. The literal action name is
            // load-bearing; see PinAnnouncement's class docblock.
            $this->audit->record('announcement.unpinned', 'announcement', $locked->id, $before, [
                'title' => $locked->title,
                'is_pinned' => false,
            ]);

            return ['announcementId' => $locked->id];
        }, ConcurrencyRetry::ATTEMPTS);
    }
}
