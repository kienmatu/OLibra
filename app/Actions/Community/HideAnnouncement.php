<?php

namespace App\Actions\Community;

use App\Models\Announcement;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\ConcurrencyRetry;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * Pulls a showing announcement out of public view — OPS §4.4's
 * HideAnnouncement. Port of
 * old_next/src/domain/community/commands/announcements.ts's
 * hideAnnouncement.
 *
 * IT CLEARS published_at, AND THAT IS WHAT "NOT PUBLIC" MEANS FOR THIS
 * TABLE. A null published_at is the draft state, and returning a row to
 * it is the whole of hiding. The visibility columns the table offers are
 * exactly two, read off the live schema for this
 * (`show columns from announcements` in laravel-mariadb-1, olibra_testing):
 * is_pinned tinyint(1) NOT NULL DEFAULT 0, and published_at datetime(6)
 * NULL — beside id, bookshelf_id, title, slug, body, body_text,
 * expires_at, author_id, the three timestamps and the generated
 * slug_key. There is no flag for hidden to set.
 *
 * A future reader who wants a separate `hidden_at`, or a status enum,
 * should know what the second column would cost before adding it:
 * clearing published_at is also what makes "Đăng lại" work afterwards.
 * PublishAnnouncement refuses a row that is published and whose caller
 * named no expiry, so a hide that LEFT published_at standing and set
 * some other column instead would leave the announcement unpostable
 * again without an expiry — hidden, and stuck. MEASURED on this method:
 * with the write below replaced by `$locked->update(['is_pinned' =>
 * false]);`, AnnouncementStateTest's "hiding returns an announcement to
 * draft, and it can then be posted again" fails on the first
 * expectation, `Failed asserting that an instance of class
 * Illuminate\Support\Carbon is null` — 1 failed, 14 passed.
 *
 * NO SHELF FILTER IS WRITTEN HERE, and there must not be one:
 * BookshelfScope on the model confines the re-read, so a row belonging
 * to another shelf is not found rather than refused — a 404 through
 * findOrFail, never a 403 that confirms the row exists. (Spelled without
 * the column name deliberately: TenancyArchitectureTest's tripwire reads
 * raw source and a where-shaped call beside that literal reddens it from
 * a comment as readily as from code.)
 *
 * THIS METHOD REFUSES NOTHING beyond a row it cannot find. Hiding a
 * draft is a no-op write that still records that a manager asked for
 * one, and OPS §4.4 lists no failure mode for this command.
 *
 * "NO-OP" IS LITERAL HERE, AND IT IS MEASURED ON THIS METHOD rather
 * than reasoned from the reference's raw SQL — the assignment below
 * writes null onto a column already holding null, and what reaches the
 * database is answered here with a run rather than an argument.
 * AnnouncementStateTest's "hiding a draft issues no UPDATE on the row
 * while the audit row is still written" reads the query log of exactly
 * this call: two statements, the locked select and the audit insert,
 * with an update on the announcements table absent from the log. Its
 * neighbour "hiding a draft records announcement.hidden with a null on
 * both sides" pins the entry that is still written. So the row is left
 * alone and the act is on the record — measured, both halves.
 *
 * THE LOCK IS THE TRANSACTION'S FIRST STATEMENT, and it earns its place
 * on the audit — CommunityArchitectureTest's FOR-UPDATE record states
 * the rule and this command falls on the lock side of it. INV-8's
 * `before` published_at is read off the locked row, so the instant this
 * command reports having cleared is the row's at the moment of the write
 * rather than the caller's instance's.
 *
 * The transaction retries because every write transaction in this phase
 * does (plan divergence 1); the row and its audit entry commit together.
 */
final class HideAnnouncement
{
    public function __construct(
        private AuditRecorder $audit,
    ) {}

    /** @return array{announcementId: string} */
    public function execute(User $actor, Announcement $announcement): array
    {
        Gate::forUser($actor)->authorize('hide', $announcement);

        return DB::transaction(function () use ($announcement): array {
            // FIRST statement — the only lock this command takes.
            $locked = Announcement::query()->lockForUpdate()->findOrFail($announcement->id);

            // Taken off the locked read, not off the caller's instance.
            $before = ['published_at' => $locked->published_at?->toIso8601String()];

            $locked->update(['published_at' => null]);

            // The reference's bag exactly: the prior instant on one side,
            // the title on the other. There is no `published_at => null`
            // in the after — AuditSentences::payloadRows renders an absent
            // key as an em dash against the before's timestamp, which
            // reads as the removal it was.
            $this->audit->record('announcement.hidden', 'announcement', $locked->id, $before, [
                'title' => $locked->title,
            ]);

            return ['announcementId' => $locked->id];
        }, ConcurrencyRetry::ATTEMPTS);
    }
}
