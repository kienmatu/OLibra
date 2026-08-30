<?php

namespace App\Http\Requests\Community;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

/**
 * The manager's compose form for OPS §4.4's CreateAnnouncement.
 *
 * THE ROUTE IS `shelves.manage.announcements.store`, and this class
 * reached it in Task 14. routes/web.php binds that POST to
 * App\Http\Controllers\Manage\AnnouncementController::store, whose
 * signature type-hints this class, so this is the request shape that
 * method's $validated array is made of. An earlier draft of this
 * paragraph read "NO ROUTE POINTS AT THIS CLASS YET — the compose screen
 * is a later task", which was true when this file shipped in Task 9 and
 * was falsified by the commit that wrote that controller.
 *
 * WHAT PINS IT NOW, in tests/Feature/Community/
 * ManagerAnnouncementsScreenTest.php: "POST the compose form writes a
 * draft and lands on the list with the created flash" for the happy path,
 * "a blank compose submit is a field error, not a banner" for these rules
 * rendering per-field rather than as a page banner, and "a reader of the
 * shelf 404s on the compose POST" for the abort below.
 *
 * It remains subject to the two sweeps that read every class under
 * app/Http/Requests: FreeTextEncodingGuardTest, which is why both
 * free-text fields lead with `bail` and carry `encoding:UTF-8`, and this
 * directory's FormRequestAuthorize404Test, which is why the denial below
 * is an abort() rather than `return false`.
 */
class StoreAnnouncementRequest extends FormRequest
{
    public function authorize(): bool
    {
        // 404, never 403: a refusal must not tell a stranger which shelf
        // URLs are real (spec §5.4). Laravel's default for a `false`
        // return is 403, so the abort is what sets the code.
        abort_unless(Gate::allows('act-as-manager'), 404);

        return true;
    }

    /** @return array<string, list<mixed>> */
    public function rules(): array
    {
        return [
            // bail + encoding:UTF-8 on both free-text fields — the class
            // of bug FreeTextEncodingGuardTest exists for is an unmapped
            // MariaDB errno 1366 turning a legitimate POST into a 500,
            // because `string`/`max` check length and PHP type only,
            // never byte validity.
            //
            // max:255 matches the column (`title varchar(255)`), read off
            // the live table; Laravel's max counts characters for a
            // string and so does a utf8mb4 varchar, so the two agree on
            // Vietnamese input rather than only on ASCII.
            'title' => ['bail', 'required', 'string', 'max:255', 'encoding:UTF-8'],
            // `body` is `text NOT NULL` on a utf8mb4 table, so its
            // ceiling is 65,535 BYTES, and utf8mb4's worst case is FOUR
            // bytes a character. Laravel's max counts CHARACTERS, so the
            // two units do not line up here the way they do on the
            // varchar(255) line above, and this number is derived from
            // the byte ceiling rather than read off a column width.
            //
            // MEASURED against a scratch table carrying this column's
            // exact DDL, over a --default-character-set=utf8mb4
            // connection so the client could not confound it: 16,383
            // U+1F600 characters store as 65,532 bytes, and 16,384 are
            // refused.
            //
            // WHICH errno arrives depends on where the 65,535-byte cut
            // lands, and a first draft of this comment named the wrong
            // one. 65,535 is not a multiple of four, so a body made
            // purely of four-byte characters can never be cut on a
            // character boundary: it splits one, and MariaDB answers
            // `ERROR 1366 (22007): Incorrect string value`. A one-byte
            // overflow does land on a boundary and answers `ERROR 1406
            // (22001): Data too long`. Re-measured here both ways:
            // 16,384 U+1F600 gives 1366, 65,536 'a' gives 1406.
            // Both are a 500 either way: UniqueViolation::translate
            // matches errno 1062 and rethrows anything else, and neither
            // 1366 nor 1406 is 1062. That is the part the ceiling rests
            // on; which of the two arrives does not change it.
            // Break-even is 65,535 / 4 = 16,383. Through Laravel's own
            // validator: 20,000 U+1F600 characters (80,000 bytes) PASS
            // `max:20000` and fail `max:16000`; 16,000 of them (64,000
            // bytes) pass `max:16000`. 16,000 characters cannot exceed
            // 64,000 bytes at four bytes each, which is inside 65,535
            // with room to spare, and a long notice still fits while a
            // pasted book does not.
            //
            // This replaces a `max:20000` justified by "about three bytes
            // a Vietnamese character". Three bytes is the common case,
            // not the worst one, and the byte reasoning had been carried
            // down from the varchar line above — where counting
            // characters is right, because a utf8mb4 varchar(255) counts
            // characters too. The rationale was true one line up and
            // false here: the copied-rationale shape this project keeps
            // hitting.
            //
            // App\Actions\Community\CreateAnnouncement writes body_text
            // from the same trimmed string, so an overflow would land in
            // two columns at once.
            'body' => ['bail', 'required', 'string', 'max:16000', 'encoding:UTF-8'],
            'is_pinned' => ['nullable', 'boolean'],
            // Nullable because a draft has neither. The command takes
            // CarbonImmutable, and AnnouncementController::store is where
            // these two strings become one — through its instant() for
            // published_at and its expiry() for expires_at, the latter
            // reading a date-only value as the END of that day in
            // Asia/Ho_Chi_Minh (AGENTS.md's date rule; the measurement is
            // in that method's docblock).
            'published_at' => ['nullable', 'date'],
            'expires_at' => ['nullable', 'date'],
        ];
    }
}
