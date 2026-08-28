<?php

namespace App\Http\Requests\Catalogue;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Shared by report-lost and mark-found, which differ only in the policy
 * ability — the controller authorizes each route by name (Task 12), so
 * this request validates shape only.
 */
class CopyNoteRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;   // the controller's Gate::authorize is the gate
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'note' => ['nullable', 'string', 'max:1000'],
        ];
    }
}
