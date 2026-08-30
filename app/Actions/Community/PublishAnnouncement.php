<?php

namespace App\Actions\Community;

use App\Exceptions\RuleViolated;
use App\Models\Announcement;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\Clock;
use App\Support\ConcurrencyRetry;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * "Đăng ngay" and "Đăng lại" — OPS §4.4's PublishAnnouncement, and the
 * one of Slice B's four state commands whose refusal is not a null
 * check. Port of
 * old_next/src/domain/community/commands/announcements.ts's
 * publishAnnouncement.
 *
 * THE REFUSAL IS ABOUT A LIVE PUBLICATION, NOT A NON-NULL COLUMN. The
 * shipped screen has two buttons onto this command: "Đăng ngay" posts a
 * draft, and "Đăng lại" reposts something that has LAPSED. A lapsed
 * announcement is published (published_at is set) and gone from the
 * reader's page (expires_at is behind the clock, compared in the read
 * path rather than swept by a job), so the second button hands this
 * command a row whose published_at is already non-null. The guard below
 * therefore fires only when the row is published AND the caller said
 * nothing about the expiry:
 *
 *     $locked->published_at !== null && ! array_key_exists('expiresAt', $changes)
 *
 * Narrowing that to `published_at !== null` is the simplification that
 * kills "Đăng lại", and it is the one a later reader will reach for.
 * MEASURED on this method, with the second conjunct deleted:
 * AnnouncementStateTest's "republishing a lapsed announcement with a
 * fresh expiry succeeds — Đăng lại" and "…with expiresAt present and
 * null succeeds and leaves expires_at null" both fail with
 * `App\Exceptions\RuleViolated: already_published`, while "publishing an
 * already-live announcement with no expiry supplied refuses with
 * already_published" stays green — the run is 2 failed, 13 passed under
 * `make test FILTER=AnnouncementStateTest`. The green one is half of the
 * finding: the mutation removes the button and leaves the refusal it was
 * supposed to be about working perfectly.
 *
 * SO "WAS AN EXPIRY SUPPLIED" IS A PRESENCE QUESTION, AND
 * array_key_exists IS HOW THIS METHOD ASKS IT. An explicit null IS a supply — "the
 * shelf is closed until further notice" is the ordinary Đăng lại, and
 * that form sends the field empty. `isset($changes['expiresAt'])` is
 * false for a key that is present and holds null, which turns that
 * ordinary case into "this notice is already published" for a manager
 * looking at something that lapsed a week ago. MEASURED on this method,
 * with the guard's second conjunct rewritten `! isset($changes['expiresAt'])`:
 * the "present and null" block fails, caught as
 * `RuleViolated: already_published`, while the "fresh expiry" block
 * stays green — 1 failed, 14 passed. That asymmetry is what makes the
 * bug silent: the case a developer tries by hand is the one that works.
 *
 * TWO SPELLINGS OF THE SAME COLLAPSE LIVE ONE LAYER UP, and both are
 * measured rather than predicted, in this repository's container, with
 * Carbon::setTestNow pinned to 2026-08-30T04:00:00Z:
 *
 *   - `$request->date('expires_at')` returns NULL for an ABSENT key and
 *     NULL for a PRESENT-but-empty one — the two shapes this command's
 *     guard is built to tell apart, erased with the Form Request and
 *     this Action both correct. `has()` does tell them apart (false vs
 *     true); `filled()` does NOT — it is false for both.
 *   - `CarbonImmutable::parse(null)` returned
 *     `2026-08-30T04:00:00+00:00`, the frozen instant. So a mapping that
 *     reaches for parse() on a cleared expiry publishes an announcement
 *     that expires in the same instant — posted and lapsed at once —
 *     while every assertion about published_at, status and flash still
 *     passes.
 *
 * The null-preserving cast is therefore
 * `$validated['expires_at'] === null ? null : CarbonImmutable::parse(...)`,
 * and whoever binds this command to a route writes it. Nothing pins that
 * mapping today because no route reaches here yet; the parse and the
 * rename from `expires_at` to `expiresAt` belong to the controller,
 * which is a later task. PublishAnnouncementRequest's docblock carries
 * the same warning at the layer that will do it.
 *
 * THE INSTANT COMES FROM THE CLOCK AND FROM NOWHERE ELSE. The reference
 * accepts an optional publishedAt and falls back to its injected clock;
 * this signature takes no such argument — a divergence, recorded rather
 * than reconciled: OPS §4.4's two buttons both mean "post it now", and
 * CreateAnnouncement already takes a publishedAt for the manager who
 * wants to write Sunday's notice on Friday. Adding a second door onto
 * back-dating with no screen asking for it would be an untested input.
 * AnnouncementStateTest's first block freezes the clock and asserts the
 * column equals it, which is an assertion only injected time can satisfy.
 *
 * THE EXPIRY IS WRITTEN ON EVERY PUBLISH, the reference's own
 * `expires_at = ${input.expiresAt ?? null}`. By the time control reaches
 * the write the presence distinction has already done its work in the
 * guard, and what is left is one instruction with two spellings: a
 * caller who supplied nothing can only be publishing a DRAFT, and a
 * draft is posted with no expiry unless one is named. So the ternary
 * below is not a second presence test doing something subtle — it is the
 * absent case and the null case arriving at the same value, written out
 * because `??` is the spelling this file must not teach.
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
 * `before` published_at is read off the locked row, so the prior value
 * this command reports is the row's at the moment of the write rather
 * than the caller's instance's. The guard reads the same locked row,
 * which is the second thing the lock buys: two managers pressing the
 * button at once cannot both find it unpublished.
 *
 * The transaction retries because every write transaction in this phase
 * does (plan divergence 1); the row and its audit entry commit together.
 *
 * A row that is soft-deleted, or on another shelf, raises
 * ModelNotFoundException out of findOrFail where the reference raises
 * `RuleViolated("write_target_not_found")` (its own line, read for
 * this). Laravel renders that as 404, which is the status §5.4 asks for,
 * so the STATUS matches the reference's intent and the exception class
 * does not — the same divergence UpdateAnnouncement records.
 */
final class PublishAnnouncement
{
    public function __construct(
        private Clock $clock,
        private AuditRecorder $audit,
    ) {}

    /**
     * @param  array{expiresAt?: ?CarbonImmutable}  $changes
     *                                                        — the key is PRESENT only if the caller supplied one; a present null clears the expiry
     * @return array{announcementId: string}
     */
    public function execute(User $actor, Announcement $announcement, array $changes): array
    {
        Gate::forUser($actor)->authorize('publish', $announcement);

        return DB::transaction(function () use ($announcement, $changes): array {
            // FIRST statement — the only lock this command takes.
            $locked = Announcement::query()->lockForUpdate()->findOrFail($announcement->id);

            $supplied = array_key_exists('expiresAt', $changes);

            // The whole of the difference between this command and the
            // other three; see the class docblock.
            if ($locked->published_at !== null && ! $supplied) {
                throw new RuleViolated('already_published');
            }

            // Taken off the locked read, not off the caller's instance.
            $before = ['published_at' => $locked->published_at?->toIso8601String()];

            $publishedAt = $this->clock->now();

            $locked->update([
                'published_at' => $publishedAt,
                'expires_at' => $supplied ? $changes['expiresAt'] : null,
            ]);

            $this->audit->record('announcement.published', 'announcement', $locked->id, $before, [
                // The reference's bag exactly: what it is called and when
                // it went up. The body is not in it — BR §14 asks the log
                // to record what changed rather than duplicate it, and the
                // row itself survives.
                'title' => $locked->title,
                'published_at' => $publishedAt->toIso8601String(),
            ]);

            return ['announcementId' => $locked->id];
        }, ConcurrencyRetry::ATTEMPTS);
    }
}
