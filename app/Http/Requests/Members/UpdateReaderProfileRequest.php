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
    /** Fix round, Minor #4: 404, not the bare bool's 403 — see RegisterReaderOnBehalfRequest. */
    public function authorize(): bool
    {
        $membership = $this->route('reader');

        abort_unless($membership instanceof Membership && Gate::allows('correct', $membership), 404);

        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            // Fix round, Task 2 (applied here too): UpdateReaderProfile's
            // save() has no QueryException handling at all, so invalid
            // UTF-8 here would 500 outright rather than merely being
            // unmapped. See RegisterMembershipRequest for the full
            // reasoning behind `encoding:UTF-8`.
            'saint_name' => ['nullable', 'string', 'max:255', 'encoding:UTF-8'],
            'full_name' => ['nullable', 'string', 'max:255', 'encoding:UTF-8'],
            'date_of_birth' => ['nullable', 'string', 'max:10'],
            'father_name' => ['nullable', 'string', 'max:255', 'encoding:UTF-8'],
            'mother_name' => ['nullable', 'string', 'max:255', 'encoding:UTF-8'],
            // phone is exempt (Phone::assert() gates it before storage,
            // see RegisterMembershipRequest); phone_missing_reason is not
            // gated downstream (ProfileFields::normalisePatch() only
            // trims it), so it gets the same guard (Task 12 sweep).
            'phone' => ['nullable', 'string', 'max:32'],
            'phone_missing_reason' => ['bail', 'nullable', 'string', 'max:1000', 'encoding:UTF-8'],
            'email' => ['bail', 'nullable', 'email', 'max:255'],
        ];
    }
}
