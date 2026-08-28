<?php

namespace App\Http\Requests\Catalogue;

use App\Enums\CopyCondition;
use App\Models\BookCopy;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;

class AssessConditionRequest extends FormRequest
{
    public function authorize(): bool
    {
        $copy = $this->route('bookCopy');

        return $copy instanceof BookCopy && Gate::allows('assessCondition', $copy);
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'condition' => ['required', Rule::enum(CopyCondition::class)],
            // bail + encoding:UTF-8 — the same free-text guard as
            // CopyNoteRequest (Task 12 sweep); this note writes to the
            // same utf8mb4 column class via ConditionAssessment.
            'note' => ['bail', 'nullable', 'string', 'max:1000', 'encoding:UTF-8'],
        ];
    }
}
