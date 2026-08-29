<?php

namespace App\Http\Requests\Circulation;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

class RejectBorrowRequestRequest extends FormRequest
{
    public function authorize(): bool
    {
        // See ApproveBorrowRequestRequest::authorize() for what actually
        // produces the 404 on these routes, and what this line is for.
        abort_unless(Gate::allows('act-as-manager'), 404);

        return true;
    }

    /** @return array<string, list<mixed>> */
    public function rules(): array
    {
        return [
            // Optional, per product-owner ruling 2 (settled 2026-08-29):
            // OPS §4.2 lists no reason_required for this command, unlike
            // the registration and profile-change rejections, and the
            // reference ships optional with a named test. bail first and
            // encoding:UTF-8 because this is free text
            // (FreeTextEncodingGuardTest sweeps for exactly that).
            'reason' => ['bail', 'nullable', 'string', 'max:500', 'encoding:UTF-8'],
        ];
    }
}
