<?php

namespace App\Http\Requests\Circulation;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

class LendCopyRequest extends FormRequest
{
    public function authorize(): bool
    {
        // 404, never 403 — BR §5.4's anti-enumeration rule, the backstop
        // behind the role:manager middleware (PR #61 Task 4's shape).
        abort_unless(Gate::allows('act-as-manager'), 404);

        return true;
    }

    /** @return array<string, list<string>> */
    public function rules(): array
    {
        return [
            'copy_id' => ['bail', 'required', 'string', 'uuid'],
            'membership_id' => ['bail', 'required', 'string', 'uuid'],
        ];
    }
}
