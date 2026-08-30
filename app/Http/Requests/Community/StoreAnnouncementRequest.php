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
            // The column is TEXT, which stops at 65,535 BYTES — about
            // 21,800 Vietnamese characters at three bytes each. 20000 is
            // a character ceiling comfortably inside that on the
            // worst-case encoding, chosen so a long notice is accepted
            // and a paste of a whole book is not.
            'body' => ['bail', 'required', 'string', 'max:20000', 'encoding:UTF-8'],
            'is_pinned' => ['nullable', 'boolean'],
            // Nullable because a draft has neither. The command takes
            // CarbonImmutable, so whatever binds this route parses these
            // rather than passing the strings through.
            'published_at' => ['nullable', 'date'],
            'expires_at' => ['nullable', 'date'],
        ];
    }
}
