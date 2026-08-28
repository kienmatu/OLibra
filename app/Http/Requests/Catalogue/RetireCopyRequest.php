<?php

namespace App\Http\Requests\Catalogue;

use App\Models\BookCopy;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

class RetireCopyRequest extends FormRequest
{
    public function authorize(): bool
    {
        $copy = $this->route('bookCopy');

        return $copy instanceof BookCopy && Gate::allows('retire', $copy);
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'reason' => ['required', 'string', 'max:1000'],
        ];
    }
}
