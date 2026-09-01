<?php

namespace App\Http\Requests\Admin;

use App\Models\Bookshelf;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

/**
 * The parish-taxonomy section of the shelf editor
 * (`PATCH /admin/shelves/{bookshelf}/taxonomy`) — BR §5.6's *Phân chia
 * giáo xứ*, the SHAPE of a parish's subdivision and never its units. Its
 * own route, its own submit and its own refusal (spec D2, D5): a mistyped
 * loan period must not block renaming a shelf's tổ, and the converse.
 *
 * FOUR FIELDS, UNDER THEIR STORAGE KEYS. `levels`, `nested`,
 * `level1_label` and `level2_label` are the names
 * App\Support\Members\ParishTaxonomy reads out of
 * `bookshelves.settings->parish_taxonomy`, so the field names here are the
 * stored keys and a rename on this side is a rename of the column's
 * contents. They are taken from that class rather than from the
 * requirements, which is the direct lesson of the `allow_comments` near-
 * miss the policy form's docblock records.
 *
 * `levels` IS `in:1,2` AND NOT A RANGE. There are two arrangements a
 * parish uses and no third, and `ParishTaxonomy::fromSettings()` coerces
 * anything that is not exactly 2 down to 1 — so a `min:1|max:3` here would
 * accept a save that silently stored something the reader collapses.
 *
 * BOTH LABELS ARE REQUIRED, INCLUDING THE LEVEL-2 ONE ON A ONE-LEVEL
 * SHELF. `fromSettings()` falls back per field for a blank label, so a
 * cleared box would appear to save and come back reading "Tổ"; and OPS
 * §4.5's invariant is that a shelf which drops to one level and later
 * returns to two finds its previous choice intact, which is only true if
 * the level-2 fields keep carrying a value while `levels` is 1.
 *
 * `nested` IS `boolean` AND REQUIRED. An HTML checkbox posts nothing when
 * it is clear, so the form sends explicit true/false; `nullable` would
 * turn "the volunteer unticked it" into "leave it as it was", which is the
 * one thing a settings form must not do.
 *
 * THE LABELS ARE FREE TEXT AND CARRY `encoding:UTF-8`. They are Vietnamese
 * words a parish chooses for itself — BR §5.6 names `Tổ` and `Giáo họ` as
 * the two it has seen, and refuses to ship a list — so they land in a
 * jsonb bag unedited, which is exactly the write path
 * `FreeTextEncodingGuardTest` exists to cover.
 */
class UpdateParishTaxonomyRequest extends FormRequest
{
    public function authorize(): bool
    {
        // {bookshelf}, not {shelf} — routes/web.php explains why the /admin
        // group cannot use the tenant-bound parameter name.
        /** @var Bookshelf $bookshelf */
        $bookshelf = $this->route('bookshelf');

        // 404, never 403 — BookshelfPolicy's shape, and the shape the other
        // three forms on this screen answer in.
        abort_unless(Gate::allows('update', $bookshelf), 404);

        return true;
    }

    /** @return array<string, list<mixed>> */
    public function rules(): array
    {
        return [
            'levels' => ['bail', 'required', 'integer', 'in:1,2'],
            'nested' => ['required', 'boolean'],
            'level1_label' => ['bail', 'required', 'string', 'max:50', 'encoding:UTF-8'],
            'level2_label' => ['bail', 'required', 'string', 'max:50', 'encoding:UTF-8'],
        ];
    }
}
