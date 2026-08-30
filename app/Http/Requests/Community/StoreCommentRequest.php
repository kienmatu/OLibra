<?php

namespace App\Http\Requests\Community;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

class StoreCommentRequest extends FormRequest
{
    public function authorize(): bool
    {
        // 404, never 403: a refusal here must not tell a stranger which
        // shelf URLs are real (spec §5.4). What actually produces the
        // 404 for a non-member is the route's own role:reader middleware,
        // which runs first — EnsureShelfRole abort(404)s on the same
        // ability. This line is the second door, and it is what answers
        // if this POST is ever moved out of that group.
        abort_unless(Gate::allows('act-as-reader'), 404);

        return true;
    }

    /** @return array<string, list<mixed>> */
    public function rules(): array
    {
        return [
            // Free text, so it leads with bail and carries the encoding
            // rule — FreeTextEncodingGuardTest sweeps every Form Request
            // for exactly that, and the class of bug it exists for is an
            // unmapped MariaDB errno 1366 turning a legitimate POST into
            // a 500. max:2000 is the length ceiling on a TEXT column
            // nothing else bounds; the empty case is CreateComment's own
            // empty_body, because a body of three spaces passes required.
            'body' => ['bail', 'required', 'string', 'max:2000', 'encoding:UTF-8'],
        ];
    }
}
