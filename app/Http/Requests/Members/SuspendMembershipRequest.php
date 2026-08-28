<?php

namespace App\Http\Requests\Members;

use App\Models\Membership;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

/**
 * The SCREEN requires a reason (the reference's NO_SUSPENSION_REASON);
 * the command's stays optional per OPS §4.3. Divergence 6's split.
 */
class SuspendMembershipRequest extends FormRequest
{
    public function authorize(): bool
    {
        $membership = $this->route('reader');

        return $membership instanceof Membership && Gate::allows('suspend', $membership);
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return ['reason' => ['required', 'string', 'max:1000']];
    }

    /** @return array<string, string> */
    public function messages(): array
    {
        return ['reason.required' => __('rules.suspension_reason_required')];
    }
}
