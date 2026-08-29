<?php

namespace App\Http\Requests\Catalogue;

use App\Models\Book;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

/**
 * StoreBookRequest's field rules, everything `sometimes` — validated()
 * then carries exactly the keys the form submitted, which is the contract
 * UpdateBook::execute's $changes parameter is built on: omitted means
 * untouched, present-null means cleared.
 */
class UpdateBookRequest extends FormRequest
{
    public function authorize(): bool
    {
        $book = $this->route('book');

        return $book instanceof Book && Gate::allows('update', $book);
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        // bail + encoding:UTF-8 — Task 12 sweep, StoreBookRequest's
        // reasoning verbatim (same fields, same UpdateBook write path).
        return [
            'title' => ['sometimes', 'bail', 'required', 'string', 'max:500', 'encoding:UTF-8'],
            'author' => ['sometimes', 'bail', 'required', 'string', 'max:255', 'encoding:UTF-8'],
            'category_slug' => ['sometimes', 'required', 'string', 'max:255'],
            'publisher' => ['sometimes', 'bail', 'nullable', 'string', 'max:255', 'encoding:UTF-8'],
            'published_year' => ['sometimes', 'nullable', 'integer', 'min:1000', 'max:2100'],
            'page_count' => ['sometimes', 'nullable', 'integer', 'min:1'],
            'isbn' => ['sometimes', 'bail', 'nullable', 'string', 'max:32', 'encoding:UTF-8'],
            'description' => ['sometimes', 'bail', 'nullable', 'string', 'max:5000', 'encoding:UTF-8'],
            'language' => ['sometimes', 'bail', 'nullable', 'string', 'max:8', 'encoding:UTF-8'],
            'is_published' => ['sometimes', 'boolean'],
        ];
    }
}
