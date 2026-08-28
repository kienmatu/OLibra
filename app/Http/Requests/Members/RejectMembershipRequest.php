<?php

namespace App\Http\Requests\Members;

use App\Models\Membership;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

class RejectMembershipRequest extends FormRequest
{
    public function authorize(): bool
    {
        $membership = $this->route('reader');

        return $membership instanceof Membership && Gate::allows('reject', $membership);
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return ['reason' => ['required', 'string', 'max:1000']];
    }

    /** @return array<string, string> OPS §4.3's own sentence, not validation.php's generic one */
    public function messages(): array
    {
        return ['reason.required' => __('rules.reject_reason_required')];
    }
}
