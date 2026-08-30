<?php

namespace App\Actions\Community;

use App\Exceptions\RuleViolated;
use App\Models\Announcement;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\Catalogue\Slugs;
use App\Support\ConcurrencyRetry;
use App\Support\UniqueViolation;
use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * Shelf news — OPS §4.4's CreateAnnouncement, and the first of Slice B.
 * Port of old_next/src/domain/community/commands/announcements.ts's
 * createAnnouncement.
 *
 * DRAFTED OR PUBLISHED, at the manager's choice. is_pinned, published_at
 * and expires_at are all writable here because OPS §4.4 lists all three
 * as create inputs: a manager may write something for Sunday and leave
 * it unpublished, or type it and send it out in the same act. A null
 * published_at is what "draft" means in this schema, which is why
 * publishing later is its own command rather than an update that
 * happens to set a column.
 *
 * THE REFUSAL IS announcement_fields_required, NOT validation_failed.
 * OPS §4.4's failure-mode list abbreviates; errors.ts pairs one code
 * with one sentence and the reference command throws the specific one
 * ("Vui lòng điền tiêu đề và nội dung."). This is the two-ledger rule
 * Task 1c already applied, and Task 20's OPS walk is where the lag gets
 * recorded — not here, by changing the command to match the doc. Both
 * fields are trimmed and either one blank raises the same code: one
 * sentence about one form.
 *
 * THE SLUG READ IS NOT A UNIQUENESS GUARANTEE. The read below is taken
 * inside the transaction and answers "what is already taken as of this
 * snapshot"; it is what turns a second announcement with the same
 * headline into a readable `-2` instead of a refusal. What actually
 * guarantees uniqueness is the index — announcements has
 * `UNIQUE KEY announcements_bookshelf_id_slug_key (slug_key)` over a
 * STORED generated column, and two transactions that both read before
 * either wrote will both compute the same slug and one of them will
 * lose to errno 1062 on the INSERT.
 *
 * NO RACE HAS BEEN MEASURED HERE and none is claimed to be likely: a
 * two-connection race cannot run under RefreshDatabase (1a divergence
 * 2), and the case is two managers typing the same headline in the same
 * second. What IS measured, in laravel-mariadb-1 against a scratch copy
 * of the live table, is the losing INSERT's shape: a second live row
 * with the same (bookshelf_id, slug) pair raises
 * `ERROR 1062 (23000): Duplicate entry '...' for key
 * 'announcements_bookshelf_id_slug_key'` — errno and constraint name
 * both, which is what UniqueViolation matches on. So the loser is
 * translated into a named Vietnamese refusal rather than a 500, which
 * is the job 1c built UniqueViolation for.
 *
 * RETRY-ON-1062 WAS CONSIDERED AND REJECTED. It would be friendlier —
 * the loser could re-read, take `-3` and succeed. It is not built here
 * because `DB::transaction($cb, ConcurrencyRetry::ATTEMPTS)` retries on
 * the deadlock/lock-wait detector, not on unique violations, and
 * widening that helper is a phase-level decision rather than this
 * command's.
 *
 * body_text is written from the same trimmed plain body as body
 * (divergence 5). The column is NOT NULL and would take '' happily; an
 * empty one would make a published announcement unfindable by the
 * search that reads it, which is the reference's own stated reason for
 * its fallback.
 *
 * No lock: this command re-reads no existing row and guards no rule
 * that a locked re-read could make accurate. The transaction is here so
 * the row and its audit entry commit together, and it retries because
 * every write transaction in this phase does (plan divergence 1).
 */
final class CreateAnnouncement
{
    public function __construct(
        private AuditRecorder $audit,
    ) {}

    /** @return array{announcementId: string, slug: string} */
    public function execute(
        User $actor,
        string $title,
        string $body,
        bool $pinned = false,
        ?CarbonImmutable $publishedAt = null,
        ?CarbonImmutable $expiresAt = null,
    ): array {
        Gate::forUser($actor)->authorize('create', Announcement::class);

        // Trimmed before the guard, so a title of three spaces is the
        // same as none — both columns are NOT NULL and would store the
        // whitespace.
        $title = trim($title);
        $body = trim($body);

        if ($title === '' || $body === '') {
            throw new RuleViolated('announcement_fields_required');
        }

        return DB::transaction(function () use ($actor, $title, $body, $pinned, $publishedAt, $expiresAt): array {
            // CreateBook's shape, and its reasons: live slugs only —
            // SoftDeletes' scope drops trashed rows, which is what makes
            // a deleted announcement's slug available again — and the
            // base plus its numbered variants rather than the whole
            // shelf. Slugs::fromTitle emits [a-z0-9-] only, so the
            // interpolation into REGEXP is literal-safe by construction.
            //
            // NO HAND-WRITTEN SHELF FILTER, and there must not be one:
            // BookshelfScope on the model is what confines this read to
            // the bound shelf, and it is the same scope that makes the
            // per-shelf uniqueness above the right rule to disambiguate
            // against. (Spelled without the column name, deliberately —
            // TenancyArchitectureTest's tripwire reads raw source and a
            // where-shaped call beside that literal reddens it from a
            // comment as readily as from code. Measured: the first
            // spelling of this comment did exactly that.)
            $base = Slugs::fromTitle($title);
            $existing = array_values(array_map(
                strval(...),
                Announcement::query()
                    ->where(fn ($q) => $q->where('slug', $base)
                        ->orWhere('slug', 'regexp', '^'.$base.'-[0-9]+$'))
                    ->pluck('slug')
                    ->all(),
            ));
            $slug = Slugs::nextAvailable($base, $existing);

            try {
                // bookshelf_id is absent on purpose: BelongsToBookshelf's
                // creating hook stamps it from the bound tenant, and
                // naming it here would be the hand-written scope this
                // project bans.
                $announcement = Announcement::query()->create([
                    'title' => $title,
                    'slug' => $slug,
                    'body' => $body,
                    'body_text' => $body,
                    'is_pinned' => $pinned,
                    'published_at' => $publishedAt,
                    'expires_at' => $expiresAt,
                    'author_id' => $actor->id,
                ]);
            } catch (QueryException $e) {
                // Matched by constraint name so an unrelated 1062 is
                // never dressed up as the wrong refusal; anything else
                // rethrows untouched.
                UniqueViolation::translate($e, [
                    'announcements_bookshelf_id_slug_key' => 'announcement_slug_taken',
                ]);
            }

            $this->audit->record('announcement.created', 'announcement', $announcement->id, null, [
                // The reference's bag exactly. The BODY IS NOT IN IT —
                // BR §14 asks the log to record what changed rather than
                // duplicate it, and the row itself survives.
                'title' => $title,
                'slug' => $slug,
                // Derived, not stored: an auditor reading six months
                // later wants to know whether this act put something in
                // front of readers or only into a drafts list, and a
                // timestamp makes them work that out.
                'published' => $publishedAt !== null,
            ]);

            return ['announcementId' => $announcement->id, 'slug' => $slug];
        }, ConcurrencyRetry::ATTEMPTS);
    }
}
