<?php

namespace App\Http\Requests\Community;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

/**
 * The manager's edit form for OPS §4.4's UpdateAnnouncement.
 *
 * `sometimes` ON EVERY FIELD, and that is the contract, not a
 * convenience: validated() then carries exactly the keys the form
 * submitted, which is what App\Actions\Community\UpdateAnnouncement's
 * $changes parameter is built on. An omitted field never reaches the
 * command; a field the manager cleared arrives as a present null.
 * `sometimes` is what makes the first true and `nullable` on expires_at
 * is what makes the second possible — "no longer expires" is a third
 * case, and dropping either word here collapses it before the command
 * ever gets a chance to honour it.
 *
 * title and body are `sometimes` + `required`: present means it must
 * have a value, absent means untouched. UpdateBookRequest (opened while
 * writing this) pairs the same two words on its own title for the same
 * reason.
 *
 * THE TWO FREE-TEXT CEILINGS ARE StoreAnnouncementRequest's, UNCHANGED
 * — the same two columns of the same table, written by a command that
 * fills body_text from body just as this one's does. That class's
 * docblock carries the derivation and the measurements behind
 * max:255 and max:16000; nothing is re-derived here, because a number
 * re-justified from memory is how this project has shipped false
 * comments before.
 *
 * expires_at is a `date`, so the encoding sweep reads it as
 * provably-non-text and no `encoding:UTF-8` applies. The command takes
 * CarbonImmutable and the key it reads is `expiresAt`, so whatever binds
 * this route parses the string and renames the key rather than passing
 * validated() through untouched — the same gap StoreAnnouncementRequest
 * leaves for its own published_at and expires_at.
 *
 * NO ROUTE POINTS AT THIS CLASS YET — the edit screen is a later task,
 * and StoreAnnouncementRequest shipped the same way in Task 9. What it
 * is subject to today is the two sweeps that read every class under
 * app/Http/Requests: FreeTextEncodingGuardTest, which is why both
 * free-text fields lead with `bail` and carry `encoding:UTF-8`, and this
 * directory's FormRequestAuthorize404Test, which is why the denial below
 * is an abort() rather than `return false`.
 */
class UpdateAnnouncementRequest extends FormRequest
{
    public function authorize(): bool
    {
        // 404, never 403: a refusal must not tell a stranger which shelf
        // URLs are real (spec §5.4). Laravel's default for a `false`
        // return is 403, so the abort is what sets the code.
        //
        // The gate, not the `update` ability, and not the route
        // parameter: the ability delegates to this same gate
        // (App\Policies\AnnouncementPolicy::update), and asking it here
        // would need a bound Announcement, which is a row this class
        // would then be answering questions about. Its sibling
        // StoreAnnouncementRequest asks the same gate the same way.
        abort_unless(Gate::allows('act-as-manager'), 404);

        return true;
    }

    /** @return array<string, list<mixed>> */
    public function rules(): array
    {
        return [
            'title' => ['sometimes', 'bail', 'required', 'string', 'max:255', 'encoding:UTF-8'],
            'body' => ['sometimes', 'bail', 'required', 'string', 'max:16000', 'encoding:UTF-8'],
            // nullable, and it is load-bearing — see the class docblock.
            // An empty submitted value arrives here as null (Laravel's
            // ConvertEmptyStringsToNull), which is exactly the "clear the
            // expiry" case, so `required` would refuse the one edit this
            // whole command was written for.
            'expires_at' => ['sometimes', 'nullable', 'date'],
        ];
    }
}
