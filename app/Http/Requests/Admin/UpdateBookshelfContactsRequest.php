<?php

namespace App\Http\Requests\Admin;

use App\Models\Bookshelf;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

/**
 * The contacts half of the shelf editor
 * (`PUT /admin/shelves/{bookshelf}/contacts`) — BR §189 and §16.4's up to
 * three volunteers a reader may phone. Its own route, its own submit and its
 * own refusal (spec D2, D8).
 *
 * THE FORM POSTS ALL THREE BLOCKS EVERY TIME and the save is a wholesale
 * replacement, which is the reference's contract too. So the rules below
 * name three fixed positions rather than validating a variable-length list:
 * a shelf may hold a contact at 1 and at 3 with nothing at 2, and a dense
 * array would silently promote the third volunteer into the second slot.
 *
 * POSITION 1 IS REQUIRED HERE AND NOWHERE ELSE (spec D3). The column is
 * nullable-by-absence on purpose — a shelf onboarded before this table
 * existed may hold no contacts and is *flagged incomplete* rather than
 * assigned an invented volunteer, which is what 3a's dashboard already
 * surfaces as `contactsMissing`. The interface is what refuses to *leave*
 * that gap: a save that would clear position 1 is refused, and a shelf that
 * has never been saved here keeps its flag.
 *
 * POSITIONS 2 AND 3 ARE CONDITIONAL ON THEIR NAME. A blank name means no
 * row, not an empty row — so a phone number typed into block 3 without a
 * name is not a validation error, it is a block the volunteer left behind
 * and the command drops. `required_with` on the phone would refuse the save
 * instead, which turns an abandoned half-edit into a wall; the rules here
 * bound what is typed and the command decides what a blank name means.
 *
 * `role_label` IS FREE TEXT (spec D3). A parish names its own volunteers'
 * jobs — *Người giữ chìa khoá*, *Quản lý tủ sách* — and no enum this port
 * invented would survive the second parish.
 *
 * The lengths match the column widths of `bookshelf_contacts`: `name` and
 * `role_label` are `varchar(255)`, `phone` is `varchar(32)`.
 */
class UpdateBookshelfContactsRequest extends FormRequest
{
    public function authorize(): bool
    {
        // {bookshelf}, not {shelf} — routes/web.php explains why the /admin
        // group cannot use the tenant-bound parameter name.
        /** @var Bookshelf $bookshelf */
        $bookshelf = $this->route('bookshelf');

        // 404, never 403 — BookshelfPolicy's shape.
        abort_unless(Gate::allows('update', $bookshelf), 404);

        return true;
    }

    /** @return array<string, list<mixed>> */
    public function rules(): array
    {
        return [
            'contact_1_name' => ['bail', 'required', 'string', 'max:255', 'encoding:UTF-8'],
            'contact_1_phone' => ['bail', 'nullable', 'string', 'max:32', 'encoding:UTF-8'],
            'contact_1_role_label' => ['bail', 'nullable', 'string', 'max:255', 'encoding:UTF-8'],

            'contact_2_name' => ['bail', 'nullable', 'string', 'max:255', 'encoding:UTF-8'],
            'contact_2_phone' => ['bail', 'nullable', 'string', 'max:32', 'encoding:UTF-8'],
            'contact_2_role_label' => ['bail', 'nullable', 'string', 'max:255', 'encoding:UTF-8'],

            'contact_3_name' => ['bail', 'nullable', 'string', 'max:255', 'encoding:UTF-8'],
            'contact_3_phone' => ['bail', 'nullable', 'string', 'max:32', 'encoding:UTF-8'],
            'contact_3_role_label' => ['bail', 'nullable', 'string', 'max:255', 'encoding:UTF-8'],
        ];
    }
}
