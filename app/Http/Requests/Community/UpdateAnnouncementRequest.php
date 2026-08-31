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
 * CarbonImmutable and the key it reads is `expiresAt`, so the class that
 * binds this route parses the string and renames the key rather than
 * passing validated() through untouched — see below for which class that
 * now is.
 *
 * THE RENAME IS A KNOWN LIMIT, AND THIS IS WHAT SKIPPING IT WOULD COST.
 * validated() carries `expires_at`; App\Actions\Community\
 * UpdateAnnouncement reads `expiresAt`. A controller that hands
 * validated() straight to the command would therefore leave `expiresAt`
 * permanently ABSENT from $changes — and absent is "I am not editing
 * the expiry", so "this announcement no longer expires" becomes
 * unreachable over HTTP while an edit naming title or body keeps
 * working. That is
 * the collapse the command exists to prevent, arriving one layer up:
 * the third case lost to a key that is never present rather than to an
 * isset().
 *
 * THE RENAME EXISTS AND IS PINNED, AS OF TASK 14. It is
 * App\Http\Controllers\Manage\AnnouncementController::changes(), which
 * reads presence with array_key_exists() over validated() and casts with
 * a null-preserving ternary; ManagerAnnouncementsScreenTest's "PATCH with
 * an empty expiry clears the column and lands with the updated flash" and
 * "PATCH naming only the title leaves the expiry where it was" are the
 * two blocks that hold it, and both assert the expires_at COLUMN rather
 * than a status, because a status cannot see either collapse. An earlier
 * draft of this paragraph said "Nothing pins the rename today because
 * nothing binds this class to a route" — true when this file shipped in
 * Task 10, falsified by the commit that wrote that controller.
 *
 * THE ROUTE IS `shelves.manage.announcements.update`. routes/web.php
 * binds that PATCH to that controller's update(), whose signature
 * type-hints this class; "a reader of the shelf 404s on the edit PATCH"
 * is the block behind the abort below. This class also remains subject
 * to the two sweeps that read every class under app/Http/Requests:
 * FreeTextEncodingGuardTest, which is why both free-text fields lead with
 * `bail` and carry `encoding:UTF-8`, and this directory's
 * FormRequestAuthorize404Test, which is why the denial below is an
 * abort() rather than `return false`.
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
