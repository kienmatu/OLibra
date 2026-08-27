<?php

namespace App\Http\Requests\Catalogue;

use App\Models\Book;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

/**
 * The create-book form's gate and shape. The donor prohibits pair
 * (`prohibits:` — Laravel has no `prohibited_with` rule; the misnamed
 * variant raises BadMethodCallException at runtime) mirrors
 * Donor::assertSingle so the ordinary submit path gets a FIELD
 * error the form can render inline; the Action still asserts the same rule
 * itself, because the domain does not trust a transport (OPS §2). The
 * category existence check stays in the Action for the same reason — and
 * because `exists:` with a deleted_at IS NULL clause would duplicate a
 * predicate the Category model already owns.
 */
class StoreBookRequest extends FormRequest
{
    public function authorize(): bool
    {
        return Gate::allows('create', Book::class);
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'title' => ['required', 'string', 'max:500'],
            'author' => ['required', 'string', 'max:255'],
            'category_slug' => ['required', 'string', 'max:255'],
            'publisher' => ['nullable', 'string', 'max:255'],
            'published_year' => ['nullable', 'integer', 'min:1000', 'max:2100'],
            'page_count' => ['nullable', 'integer', 'min:1'],
            'isbn' => ['nullable', 'string', 'max:32'],
            'description' => ['nullable', 'string', 'max:5000'],
            'language' => ['nullable', 'string', 'max:8'],
            'is_published' => ['nullable', 'boolean'],
            'copy_count' => ['required', 'integer', 'min:1', 'max:200'],
            'donor_membership_id' => ['nullable', 'uuid', 'prohibits:donor_name'],
            'donor_name' => ['nullable', 'string', 'max:255'],
            'acquired_on' => ['nullable', 'date_format:Y-m-d'],
        ];
    }
}
