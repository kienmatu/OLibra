<?php

namespace App\Actions\Community;

use App\Models\Announcement;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\ConcurrencyRetry;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * Sticks an announcement to the top of the shelf's news — OPS §4.4's
 * PinAnnouncement. Port of
 * old_next/src/domain/community/commands/announcements.ts's
 * pinAnnouncement.
 *
 * WRITTEN OUT RATHER THAN GENERATED, and the reason is a guard rather
 * than taste. This command and its three siblings are one read and one
 * column apart, so a factory taking the flag and the action name is the
 * obvious compression — and it would make the action name a variable,
 * which the census refuses. AuditActionCensusTest's second block counts
 * `->record(` calls in each file against `->record('x.y'` literal ones
 * and fails the build when they disagree, so an assembled name is a red
 * test rather than a row that renders the undescribed-action fallback to
 * a volunteer. MEASURED, on this file, rather than cited from the
 * reference's own version of the argument: with the literal below
 * replaced by `$action = 'announcement.'.'pinned';` and passed as a
 * variable, that block fails with "PinAnnouncement.php calls ->record()
 * 1 time(s) but only 0 use a literal 'x.y' action string".
 *
 * The run is 2 failed, and the second failure is worth writing down
 * because it contradicts what I expected before running it. I predicted
 * that block would be the only one to redden, on the census file's own
 * argument that a computed name "fails OPEN" — dropped from $written, so
 * absent from both sides of the set-equality and balancing with the
 * ghost write on neither. That argument holds only while the action is
 * missing from AuditSentences::ACTIONS too. announcement.pinned is IN
 * that map, put there by this same commit, so the mutation leaves a
 * sentence with no writer and the first block fails as well. The
 * fail-open hole the second block exists to close is therefore narrower
 * than it looks: it is open for an action nobody mapped, and shut for
 * one that was.
 *
 * NO CAP ON PINS, which is OPS §4.4's own reading of an open question
 * carried across (plan divergence 8): BR §16.1 orders pinned
 * announcements among themselves ("most recent next"), which implies
 * more than one may be pinned, and no cap is stated. This command
 * therefore refuses nothing. If the product owner later wants exactly
 * one pin, that is a partial unique index and a refusal, not a change to
 * this command's shape — and AnnouncementStateTest's "more than one
 * announcement may be pinned at once" is what would have to be rewritten
 * with it.
 *
 * PINNING AN ALREADY-PINNED ROW is a no-op write that still records the
 * act, the reference's behaviour: `before` and `after` come out with the
 * same is_pinned, which is an honest description of what a manager
 * pressing a pinned button did. MEASURED on this method, both halves:
 * AnnouncementStateTest's "pinning an already-pinned row records the act
 * with the same flag on both sides" pins the two bags, and its sibling
 * "…issues no UPDATE while the audit row is still written" reads the
 * query log of exactly this call — two statements, the locked select and
 * the audit insert, with an update on the announcements table absent
 * from the log. So "no-op" is literal: the row is not written.
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
final class PinAnnouncement
{
    public function __construct(
        private AuditRecorder $audit,
    ) {}

    /** @return array{announcementId: string} */
    public function execute(User $actor, Announcement $announcement): array
    {
        Gate::forUser($actor)->authorize('pin', $announcement);

        return DB::transaction(function () use ($announcement): array {
            // FIRST statement — the only lock this command takes.
            $locked = Announcement::query()->lockForUpdate()->findOrFail($announcement->id);

            // Taken off the locked read, not off the caller's instance.
            $before = ['is_pinned' => $locked->is_pinned];

            $locked->update(['is_pinned' => true]);

            // The reference's bag exactly. The literal action name is
            // load-bearing; see the class docblock.
            $this->audit->record('announcement.pinned', 'announcement', $locked->id, $before, [
                'title' => $locked->title,
                'is_pinned' => true,
            ]);

            return ['announcementId' => $locked->id];
        }, ConcurrencyRetry::ATTEMPTS);
    }
}
