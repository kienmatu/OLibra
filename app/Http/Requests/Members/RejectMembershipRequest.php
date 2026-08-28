<?php

namespace App\Http\Requests\Members;

use App\Models\Membership;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

class RejectMembershipRequest extends FormRequest
{
    /** Fix round, Minor #4: 404, not the bare bool's 403 — see RegisterReaderOnBehalfRequest. */
    public function authorize(): bool
    {
        $membership = $this->route('reader');

        abort_unless($membership instanceof Membership && Gate::allows('reject', $membership), 404);

        return true;
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
