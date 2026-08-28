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
        // bail + encoding:UTF-8 — Task 12 sweep: reason writes straight to
        // book_copies.retired_reason (a utf8mb4 column); the same guard as
        // CopyNoteRequest.
        return [
            'reason' => ['bail', 'required', 'string', 'max:1000', 'encoding:UTF-8'],
        ];
    }
}
