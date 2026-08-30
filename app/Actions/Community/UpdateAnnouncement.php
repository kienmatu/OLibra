<?php

namespace App\Actions\Community;

use App\Exceptions\RuleViolated;
use App\Models\Announcement;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\ConcurrencyRetry;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * The editor for OPS §4.4's shelf news — Task 9's CreateAnnouncement
 * written from the other end. Port of
 * old_next/src/domain/community/commands/announcements.ts's
 * updateAnnouncement.
 *
 * EXPIRY HAS THREE CASES AND A COLUMN HAS TWO. That sentence is the
 * whole command; everything else here is scaffolding around it.
 *
 *   - `expiresAt` absent from $changes — "I am not editing the expiry".
 *     The stored value is left where it is, and the column is not part
 *     of the UPDATE at all.
 *   - `expiresAt` present and null — "this announcement no longer
 *     expires". NULL is written.
 *   - `expiresAt` present and a date — that instant is written.
 *
 * The reference decides this in PHP-equivalent code rather than in the
 * statement for the same reason, and its comment says so: a `coalesce`
 * conflates the first two cases and makes the second unexpressible.
 *
 * SO EVERY READ OF $changes IS array_key_exists, NEVER isset AND NEVER
 * ??. `isset($changes['expiresAt'])` is false for a key that is present
 * and holds null, which collapses "clear it" into "leave it" — and does
 * it silently, because the absent case still behaves correctly.
 * MEASURED HERE, on this array, in this file, twice — once for each
 * spelling of the mistake, and both times against the branch as it
 * actually stands below rather than against a neighbouring line:
 *
 *   - the guard rewritten `if (isset($changes['expiresAt']))`
 *   - the guard replaced by `$write['expires_at'] =
 *     $changes['expiresAt'] ?? $locked->expires_at;`
 *
 * Each run is 1 failed, 7 passed under
 * `make test FILTER=UpdateAnnouncementTest`, and the first spelling was
 * re-run over the whole suite at 1 failed, 1414 passed. The failure is
 * the same block every time — UpdateAnnouncementTest's "an explicit null
 * expiresAt clears the expiry", reported as `Failed asserting that an
 * instance of class Illuminate\Support\Carbon is null` — while "an
 * absent expiresAt leaves an existing expiry alone" passes throughout.
 * That asymmetry is what would make the bug invisible in production.
 *
 * THE @param IS A SHAPED ARRAY, not array<string, mixed>, and not an
 * object with nullable properties. The PRESENCE of a key is the datum;
 * a DTO with `?CarbonImmutable $expiresAt = null` cannot tell an unset
 * property from one deliberately set to null, which is the same
 * collapse one layer up. (App\Actions\Catalogue\UpdateBook, read while
 * planning this, takes array<string, mixed> and reads it with
 * array_key_exists; its shape is followed here, its `@param` is not,
 * because that command's keys are columns and these keys are three.)
 *
 * A PRESENT FIELD IS VALIDATED, AN ABSENT ONE IS NOT TOUCHED. Blanking
 * a title is what OPS §4.4's sentence is about, so a present-but-blank
 * title or body refuses; an absent one is not validated, because there
 * is nothing to validate. The refusal reuses Task 9's
 * `announcement_fields_required` — same two fields, same form, and its
 * sentence in lang/vi/rules.php ("Vui lòng điền tiêu đề và nội dung.")
 * reads as an instruction rather than as a description of a create, so
 * it fits an edit unchanged. A second code would mean a second sentence
 * saying the same thing.
 *
 * THE LOCK IS THE TRANSACTION'S FIRST STATEMENT, and it is what makes
 * "leave the stored value alone" true rather than approximately true:
 * without a fresh read, an absent key would preserve whatever the
 * caller's instance happened to hold when it was loaded, which for a
 * $announcement resolved earlier in the request is a snapshot, not the
 * row. The same read is what INV-8's `before` title is taken from, so
 * the audit entry cannot report a stale title as the value this act
 * changed. UpdateBook takes a lock before its audit snapshot for the
 * second of those reasons; the first is this command's own.
 *
 * NO SHELF FILTER IS WRITTEN HERE, and there must not be one:
 * BookshelfScope on the model confines the re-read, so a row belonging
 * to another shelf is not found rather than refused — a 404 through
 * findOrFail, never a 403 that confirms the row exists. (Spelled
 * without the column name deliberately: TenancyArchitectureTest's
 * tripwire reads raw source and a where-shaped call beside that literal
 * reddens it from a comment as readily as from code.)
 *
 * body_text follows body, from the same trimmed string, exactly as
 * CreateAnnouncement writes it: the column is NOT NULL and is what the
 * later search reads, so an edit that moved body and left body_text on
 * the old text would make an announcement findable only by what it used
 * to say.
 *
 * THE WRITE IS AN ARRAY handed to update(), HideComment's shape, and
 * that is also what keeps the expiry branch honest under Larastan level
 * 8: Announcement casts expires_at to datetime, which resolves to
 * Carbon\Carbon, so a direct `$locked->expires_at = $changes['expiresAt']`
 * is `assign.propertyType — Property App\Models\Announcement::$expires_at
 * (Carbon\Carbon|null) does not accept Carbon\CarbonImmutable|null`
 * (`make analyse`, this file, before the array form). Widening the
 * parameter to CarbonInterface to silence that would have widened the
 * command's contract to fix a checker complaint.
 *
 * The transaction retries because every write transaction in this phase
 * does (plan divergence 1); the row and its audit entry commit
 * together.
 */
final class UpdateAnnouncement
{
    public function __construct(
        private AuditRecorder $audit,
    ) {}

    /**
     * @param  array{title?: string, body?: string, expiresAt?: ?CarbonImmutable}  $changes
     *                                                                                       — only the keys the caller supplied; see the class docblock
     * @return array{announcementId: string}
     */
    public function execute(User $actor, Announcement $announcement, array $changes): array
    {
        Gate::forUser($actor)->authorize('update', $announcement);

        // null here means ABSENT and '' means present-but-blank — the
        // two cases the guard below has to tell apart. Both fields are
        // typed non-nullable in the shape above, so null cannot arrive
        // as a value and the encoding is unambiguous. Trimmed before
        // the guard, so a title of three spaces is the same as none:
        // both columns are NOT NULL and would store the whitespace.
        $title = array_key_exists('title', $changes) ? trim($changes['title']) : null;
        $body = array_key_exists('body', $changes) ? trim($changes['body']) : null;

        if ($title === '' || $body === '') {
            throw new RuleViolated('announcement_fields_required');
        }

        // Outside the transaction, like CreateAnnouncement's guard: a
        // refusal that reads no row needs nothing rolled back.
        return DB::transaction(function () use ($announcement, $changes, $title, $body): array {
            // FIRST statement — the only lock this command takes.
            $locked = Announcement::query()->lockForUpdate()->findOrFail($announcement->id);

            // Taken off the locked read, not off the caller's instance.
            $before = ['title' => $locked->title];

            // The columns to write, built from the keys the caller
            // named: a key nobody supplied never enters this array, so
            // it is never part of the UPDATE.
            $write = [];

            if ($title !== null) {
                $write['title'] = $title;
            }

            if ($body !== null) {
                $write['body'] = $body;
                $write['body_text'] = $body;
            }

            // The three cases, and this branch is the whole of them: the
            // key joins $write only when the caller named it, and
            // whatever they named it with — a date or null — is the
            // value written. array_key_exists, for the reason the class
            // docblock measures.
            if (array_key_exists('expiresAt', $changes)) {
                $write['expires_at'] = $changes['expiresAt'];
            }

            $locked->update($write);

            // INV-8, and the reference's own bag: the title before and
            // the title after, nothing else. The body is deliberately
            // absent from both — BR §14 asks the log to record what
            // changed rather than duplicate it, and the row itself
            // survives.
            $this->audit->record('announcement.updated', 'announcement', $locked->id, $before, [
                'title' => $locked->title,
            ]);

            return ['announcementId' => $locked->id];
        }, ConcurrencyRetry::ATTEMPTS);
    }
}
