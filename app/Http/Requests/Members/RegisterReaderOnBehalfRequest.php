<?php

namespace App\Http\Requests\Members;

use App\Models\Membership;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

/**
 * The on-behalf form's shape. No username/password fields AT ALL — the
 * reference's own decision: credentials are SetReaderCredentials' job on
 * the reader detail, and a manager typing a child's registration is not
 * the moment to invent a password nobody will type.
 */
class RegisterReaderOnBehalfRequest extends FormRequest
{
    public function authorize(): bool
    {
        return Gate::allows('create', Membership::class);
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
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
