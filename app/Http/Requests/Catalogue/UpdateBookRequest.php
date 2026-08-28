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
        return [
            'title' => ['sometimes', 'required', 'string', 'max:500'],
            'author' => ['sometimes', 'required', 'string', 'max:255'],
            'category_slug' => ['sometimes', 'required', 'string', 'max:255'],
            'publisher' => ['sometimes', 'nullable', 'string', 'max:255'],
            'published_year' => ['sometimes', 'nullable', 'integer', 'min:1000', 'max:2100'],
            'page_count' => ['sometimes', 'nullable', 'integer', 'min:1'],
            'isbn' => ['sometimes', 'nullable', 'string', 'max:32'],
            'description' => ['sometimes', 'nullable', 'string', 'max:5000'],
            'language' => ['sometimes', 'nullable', 'string', 'max:8'],
            'is_published' => ['sometimes', 'boolean'],
        ];
    }
}
