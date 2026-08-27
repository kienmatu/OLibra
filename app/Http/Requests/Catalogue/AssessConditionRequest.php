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
            'note' => ['nullable', 'string', 'max:1000'],
        ];
    }
}
