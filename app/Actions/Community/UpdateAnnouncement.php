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
 * THE LOCK IS THE TRANSACTION'S FIRST STATEMENT, AND INV-8 IS WHAT IT
 * IS FOR. `$before` is read off the locked row, so the prior title this
 * command reports is the row's at the moment of the write rather than
 * the caller's instance's. MEASURED on this method: with the re-read
 * replaced by `$locked = $announcement;` and a caller instance loaded
 * before a concurrent statement moved the row to title 'Tin B', the
 * entry recorded `before {"title":"Tin A"}` and `after {"title":"Tin
 * A"}` while the row held 'Tin B' — a prior value that was never prior
 * and an after that was never after. App\Actions\Catalogue\UpdateBook
 * (opened for this) reaches the same place a different way: it takes a
 * shelf lock, calls `$book->refresh()` under it — its comment there
 * reads "Fresh under the lock — never the possibly-stale instance the
 * caller passed in" — and builds its `$before` from the refreshed row.
 * That reason alone earns the lock.
 *
 * THE LOCK IS NOT WHAT MAKES AN ABSENT expiresAt SAFE, and an earlier
 * version of this paragraph said it was — that without a fresh read an
 * absent key would preserve a stale snapshot and revert a concurrent
 * edit. That sentence is true of the reference, whose statement assigns
 * `expires_at = ${expiresAt}` on every run (its `updateAnnouncement`,
 * read for this), so a fresh `existing` is what supplies the value to
 * assign THERE. It does not survive the crossing into Eloquent, which
 * decides the statement from the dirty set instead:
 * `Model::performUpdate` (opened in
 * vendor/laravel/framework/src/Illuminate/Database/Eloquent/Model.php)
 * takes `$dirty = $this->getDirtyForUpdate()` and issues the statement
 * under `if (count($dirty) > 0)`, and a key that never enters `$write`
 * is never assigned, so it is never dirty. Measured in the same no-lock
 * run: with the caller's instance holding `expires_at` 2026-05-08
 * 07:30 while the row held 2026-09-09 09:00, a body-only edit emitted
 * `update `announcements` set `body` = ?, `body_text` = ?,
 * `announcements`.`updated_at` = ? where `id` = ?` and the row kept
 * 2026-09-09 09:00. There is no snapshot to revert from here.
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
 *
 * TWO DIVERGENCES FROM THE COMMAND THIS PORTS, both measured here and
 * both recorded rather than reconciled.
 *
 * An empty $changes writes no row and still records an audit entry.
 * `update([])` emits no UPDATE at all — the transaction is the locking
 * SELECT and the audit INSERT — while `announcement.updated` is
 * recorded with `before` and `after` both `{"title":"Tin A"}`. The
 * reference's audit bag comes out the same way for the same call (its
 * `before: { title: existing.title }` and `after: { title }`, and with
 * no input title those are one string); its statement, unlike this
 * one's, still runs. A caller who supplied nothing has still asked for
 * an edit, so the entry stands.
 *
 * A row that is soft-deleted, or on another shelf, raises
 * ModelNotFoundException out of findOrFail where the reference raises
 * `RuleViolated("write_target_not_found")` (its own line, read for
 * this). Measured: a manager of one shelf handed another shelf's
 * announcement gets `Illuminate\Database\Eloquent\
 * ModelNotFoundException: No query results for model
 * [App\Models\Announcement] <id>`, and UpdateAnnouncementTest pins
 * it. Laravel renders that as 404, which is the status §5.4 asks for,
 * so the STATUS matches the reference's intent and the exception class
 * does not.
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
        // two cases the guard below has to tell apart. The @param above
        // shapes both fields non-nullable, but a docblock is not
        // enforcement: PHP checks no array shape at runtime, so
        // ['title' => null] does reach trim() as null. What keeps the
        // encoding unambiguous is where that lands, not the promise.
        // MEASURED, on this method and on this call: trim(null) raises
        // E_DEPRECATED ("Passing null to parameter #1 ($string) of type
        // string is deprecated") and returns '', so a present null takes
        // the present-but-blank arm below and refuses with
        // announcement_fields_required — confirmed by calling execute()
        // with ['title' => null] and catching that code, not by reading
        // trim() alone. Trimmed before the guard, so a title of three
        // spaces is the same as none: both columns are NOT NULL and
        // would store the whitespace.
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
            // absent from both because the reference's payload does not
            // carry it and the row itself survives.
            //
            // RETRACTED: an earlier draft cited BR §14 here. §14 asks for
            // previous/new values on every tracked record and names only
            // passwords and session tokens as never captured — it does not
            // support an exclusion. §14 IS the authority for the audit
            // browser's readable sentence and raw-on-expansion rendering.
            // See the same retraction in PublishAnnouncement.
            $this->audit->record('announcement.updated', 'announcement', $locked->id, $before, [
                'title' => $locked->title,
            ]);

            return ['announcementId' => $locked->id];
        }, ConcurrencyRetry::ATTEMPTS);
    }
}
