<?php

namespace App\Http\Requests\Members;

use Illuminate\Foundation\Http\FormRequest;

/**
 * The public form's shape rules. authorize() is true — this is the one
 * open door (the Action's own docstring), and the throttle is the gate.
 * The business rules (phone-or-reason, INV-14's pairing, the parish
 * selection, identity reuse) stay in Registration, which refuses them by
 * OPS §4.3's own codes — this request only keeps garbage shapes out.
 */
class RegisterMembershipRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'shelf' => ['required', 'string', 'max:255'],
            'username' => ['nullable', 'string', 'max:255'],
            'password' => ['nullable', 'string', 'min:8', 'confirmed'],
            'saint_name' => ['required', 'string', 'max:255'],
            'full_name' => ['required', 'string', 'max:255'],
            // Fix round, Task 13, Minor #1: `date_format:Y-m-d` alone lets
            // through anything checkdate() accepts as a calendar day,
            // including 9999-12-31 — a pending membership got created for
            // a reader "born" in the year 9999. Registration.php's own
            // assertStorableDate() (Task 6, unmodified here) only ever
            // checks the SHAPE of the date, not its plausibility, so
            // nothing downstream of this Form Request catches it either.
            // Two sane, generous bounds, chosen from the domain rather
            // than an arbitrary round number: `before_or_equal:today` — a
            // birth date cannot be in the future, full stop — and
            // `after_or_equal:1900-01-01`, wide enough that no living
            // parishioner is excluded (nobody registering at a parish
            // library today was born before 1900) while still refusing
            // the unbounded date range `date_format` alone permits.
            'date_of_birth' => ['required', 'date_format:Y-m-d', 'before_or_equal:today', 'after_or_equal:1900-01-01'],
            'father_name' => ['required', 'string', 'max:255'],
            'mother_name' => ['required', 'string', 'max:255'],
            'phone' => ['nullable', 'string', 'max:32'],
            'phone_missing_reason' => ['nullable', 'string', 'max:1000'],
            'email' => ['nullable', 'email', 'max:255'],
            'parish_unit_l1_id' => ['nullable', 'string', 'max:36'],
            'parish_unit_l2_id' => ['nullable', 'string', 'max:36'],
        ];
    }
}
