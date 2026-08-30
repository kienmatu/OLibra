<?php

namespace App\Http\Requests\Community;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

/**
 * The manager's compose form for OPS §4.4's CreateAnnouncement.
 *
 * NO ROUTE POINTS AT THIS CLASS YET — the compose screen is a later
 * task, and RejectCommentRequest / HideCommentRequest shipped the same
 * way in Task 4. What it is subject to today is the two sweeps that read
 * every class under app/Http/Requests: FreeTextEncodingGuardTest, which
 * is why both free-text fields lead with `bail` and carry
 * `encoding:UTF-8`, and this directory's FormRequestAuthorize404Test,
 * which is why the denial below is an abort() rather than `return false`.
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
            // U+1F600 characters store as 65,532 bytes, and 16,384 raise
            // `ERROR 1406 (22001): Data too long for column 'body'`.
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
            // CarbonImmutable, so whatever binds this route parses these
            // rather than passing the strings through.
            'published_at' => ['nullable', 'date'],
            'expires_at' => ['nullable', 'date'],
        ];
    }
}
