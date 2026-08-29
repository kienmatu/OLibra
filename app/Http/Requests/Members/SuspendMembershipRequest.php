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
    /** Fix round, Minor #4: 404, not the bare bool's 403 — see RegisterReaderOnBehalfRequest. */
    public function authorize(): bool
    {
        $membership = $this->route('reader');

        abort_unless($membership instanceof Membership && Gate::allows('suspend', $membership), 404);

        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        // bail + encoding:UTF-8 — Task 12 sweep: this is "the void reason
        // (predicted by Task 6's review)" the carry-over note names —
        // reason writes to memberships.suspension_reason (utf8mb4).
        return ['reason' => ['bail', 'required', 'string', 'max:1000', 'encoding:UTF-8']];
    }

    /** @return array<string, string> */
    public function messages(): array
    {
        return ['reason.required' => __('rules.suspension_reason_required')];
    }
}
