<?php

namespace App\Http\Requests\Circulation;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

class VoidLoanRequest extends FormRequest
{
    public function authorize(): bool
    {
        abort_unless(Gate::allows('act-as-manager'), 404);

        return true;
    }

    /** @return array<string, list<string>> */
    public function rules(): array
    {
        // Required at the screen; the Action's own trim-check remains the
        // backstop (the suspension-reason screen/command split, 1b).
        return [
            'reason' => ['bail', 'required', 'string', 'max:500', 'encoding:UTF-8'],
        ];
    }
}
