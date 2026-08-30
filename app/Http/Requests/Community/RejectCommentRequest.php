<?php

namespace App\Http\Requests\Community;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

/**
 * RejectComment's own gate, ahead of the rules — the ApproveComment
 * precedent (Task 3) has no Form Request of its own since it takes no
 * input, but StoreCommentRequest's docblock states the ordering rule this
 * one follows: authorize() and rules() both run during argument
 * resolution, BEFORE the controller body, so a 404 here never lets a
 * malformed reason answer first.
 */
class RejectCommentRequest extends FormRequest
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
            // Required — RejectComment::execute throws reject_reason_required
            // on a blank string, but the route should not reach the
            // command at all on a request with no reason field submitted.
            'reason' => ['bail', 'required', 'string', 'max:500', 'encoding:UTF-8'],
        ];
    }
}
