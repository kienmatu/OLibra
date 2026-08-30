<?php

namespace App\Http\Requests\Community;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

/**
 * HideComment's own gate, ahead of the rules — RejectCommentRequest's
 * twin. The one difference from that class is `nullable` in place of
 * `required` on `reason`, and that difference is the whole product
 * decision OPS §4.4 draws between the two commands: a rejection is a
 * message an author is waiting for, hiding is not. A shared base class
 * with a conditional rule would hide that difference behind a flag
 * instead of stating it as two classes.
 */
class HideCommentRequest extends FormRequest
{
    public function authorize(): bool
    {
        // 404, never 403 — spec §5.4's anti-enumeration rule.
        abort_unless(Gate::allows('act-as-manager'), 404);

        return true;
    }

    /** @return array<string, list<mixed>> */
    public function rules(): array
    {
        return [
            'reason' => ['bail', 'nullable', 'string', 'max:500', 'encoding:UTF-8'],
        ];
    }
}
