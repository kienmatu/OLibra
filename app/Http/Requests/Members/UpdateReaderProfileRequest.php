<?php

namespace App\Http\Requests\Members;

use App\Models\Membership;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

/**
 * Every field is always sent (the reference's rule): the command decides
 * what counts as a change, so an unedited submission comes back as
 * empty_proposal — the sentence a manager who changed nothing should
 * read. Shape-only here; the named refusals are the Action's.
 *
 * Key-presence semantics ride on Laravel's own validated(): a rule of
 * 'nullable' with no 'sometimes' still only reports keys ACTUALLY PRESENT
 * in the request — verified live against Validator::validated(), which
 * returns exactly the input keys that were supplied, never conjuring
 * missing ones as null. So a key the client omits stays absent from
 * $request->validated() ("leave alone" to ProfileFields::normalisePatch),
 * while a key present as an empty string — folded to null by the global
 * ConvertEmptyStringsToNull middleware — arrives as present-with-null
 * ("clear"). The React form must always submit every key it owns; this
 * class does not fabricate the ones it doesn't.
 */
class UpdateReaderProfileRequest extends FormRequest
{
    public function authorize(): bool
    {
        $membership = $this->route('reader');

        return $membership instanceof Membership && Gate::allows('correct', $membership);
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'saint_name' => ['nullable', 'string', 'max:255'],
            'full_name' => ['nullable', 'string', 'max:255'],
            'date_of_birth' => ['nullable', 'string', 'max:10'],
            'father_name' => ['nullable', 'string', 'max:255'],
            'mother_name' => ['nullable', 'string', 'max:255'],
            'phone' => ['nullable', 'string', 'max:32'],
            'phone_missing_reason' => ['nullable', 'string', 'max:1000'],
            'email' => ['nullable', 'email', 'max:255'],
        ];
    }
}
