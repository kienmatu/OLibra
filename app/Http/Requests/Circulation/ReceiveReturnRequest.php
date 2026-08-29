<?php

namespace App\Http\Requests\Circulation;

use App\Enums\CopyCondition;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;

class ReceiveReturnRequest extends FormRequest
{
    public function authorize(): bool
    {
        // 404, never 403 — BR §5.4's anti-enumeration rule, the backstop
        // behind the role:manager middleware (PR #61 Task 4's shape). This
        // route already sits inside ['auth', 'role:manager'], so this
        // branch is unreachable over HTTP today — see
        // tests/Feature/Circulation/FormRequestAuthorize404Test.php, which
        // exercises it directly rather than through routing.
        abort_unless(Gate::allows('act-as-manager'), 404);

        return true;
    }

    /** @return array<string, list<mixed>> */
    public function rules(): array
    {
        return [
            'condition' => ['bail', 'required', 'string', Rule::enum(CopyCondition::class)],
            // bail + encoding:UTF-8 — a NUL byte must fail as validation,
            // never crash a later rule (PR #61 Task 1's lesson).
            'note' => ['bail', 'nullable', 'string', 'max:1000', 'encoding:UTF-8'],
        ];
    }
}
