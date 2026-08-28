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
            'date_of_birth' => ['required', 'date_format:Y-m-d'],
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
