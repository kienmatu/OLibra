<?php

namespace App\Http\Requests\Admin;

use App\Models\Bookshelf;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;

/**
 * The super administrator's create-a-shelf form (`POST /admin/shelves`).
 *
 * THE SLUG IS VALIDATED AGAINST `bookshelves.slug_active`, NOT `slug`, and
 * the difference is the whole point of that column. `slug_active` is a
 * stored generated column, `IF(deleted_at IS NULL, slug, NULL)`, carrying
 * the unique index — so uniqueness holds among *living* shelves only, and a
 * soft-deleted shelf does not sit on its address forever. Validating against
 * the raw `slug` column would reintroduce exactly the landmine the migration
 * removed (create-bookshelves-table:41-49 spells out the reasoning), because
 * a soft-deleted row would be a name collision the administrator cannot see
 * or clear. The reference validated the raw column and has a comment
 * conceding the same hazard; this port has the index to do better.
 *
 * `max:60` ON THE SLUG comes from the reference, which slices its derived
 * slug to 60 characters, and not from the column, which is `varchar(255)`.
 * The shorter bound is the intent: this string is printed on a notice board
 * and glued inside book covers.
 *
 * THE SHAPE IS `^[a-z0-9][a-z0-9-]*$` — the reference's regex verbatim. No
 * accents, no spaces, no leading hyphen. There is deliberately no
 * slug-from-name derivation here: the reference derives one when the caller
 * supplies none, and this port makes the field required on the form instead,
 * so the address a parish will be printing is always something a person
 * chose and read back rather than a transliteration they never saw.
 *
 * THE FREE-TEXT SWEEP. Every text field leads with `bail` and carries
 * `encoding:UTF-8` — FreeTextEncodingGuardTest's rule, and the class of bug
 * it exists for is an unmapped MariaDB errno 1366 turning a legitimate POST
 * into a 500, because `string`/`max` check length and PHP type only, never
 * byte validity. `established_on` is a `date`, which that sweep reads as
 * provably non-text.
 *
 * `max:255` on name, location and address matches those columns
 * (`varchar(255)` on a utf8mb4 table); Laravel's `max` counts characters and
 * so does a utf8mb4 varchar, so the two agree on Vietnamese input rather
 * than only on ASCII. `description` is `text`, whose ceiling is 65,535
 * BYTES against a character-counting rule — the same unit mismatch
 * StoreAnnouncementRequest's `body` documents at length, and the same
 * derived bound: 16,000 characters cannot exceed 64,000 bytes even at
 * utf8mb4's four-byte worst case.
 */
class StoreBookshelfRequest extends FormRequest
{
    public function authorize(): bool
    {
        // 404, never 403: EnsureSuperAdmin refuses the whole /admin group
        // with 404 on BR §5.4's anti-enumeration rule, and BookshelfPolicy
        // answers denyAsNotFound() for the same reason. Laravel's default
        // for a `false` return is 403, so the abort is what sets the code —
        // a backstop for the day the middleware comes off, matching the
        // Members, Circulation and Community directories.
        abort_unless(Gate::allows('create', Bookshelf::class), 404);

        return true;
    }

    /** @return array<string, list<mixed>> */
    public function rules(): array
    {
        return [
            'name' => ['bail', 'required', 'string', 'max:255', 'encoding:UTF-8'],
            'slug' => [
                'bail',
                'required',
                'string',
                'max:60',
                'encoding:UTF-8',
                'regex:/^[a-z0-9][a-z0-9-]*$/',
                Rule::unique('bookshelves', 'slug_active'),
            ],
            'location' => ['bail', 'nullable', 'string', 'max:255', 'encoding:UTF-8'],
            'address' => ['bail', 'nullable', 'string', 'max:255', 'encoding:UTF-8'],
            'description' => ['bail', 'nullable', 'string', 'max:16000', 'encoding:UTF-8'],
            'established_on' => ['nullable', 'date'],
        ];
    }
}
