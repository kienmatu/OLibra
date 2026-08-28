<?php

namespace App\Http\Requests\Catalogue;

use App\Models\Book;
use App\Models\Membership;
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
 *
 * donor_membership_id's existence check goes through Membership::query(),
 * not `exists:memberships,id` — memberships.id is globally unique, so the
 * bare Laravel rule would accept a real membership on ANOTHER shelf, and
 * the composite FK (bookshelf_id, acquired_from_membership_id) would then
 * surface that as a raw errno 1452 from inside CreateBook's transaction,
 * exactly the "plain message" BR §2 forbids skipping. Membership::query()
 * carries BookshelfScope, so it scopes to the bound shelf for free — no
 * hand-written shelf filter here for TenancyArchitectureTest to catch.
 * CreateBook re-asserts the same check (Membership::query() again) for a
 * caller that bypasses this Request.
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
        // bail + encoding:UTF-8 on every free-text field (Task 12 sweep):
        // title/author/publisher/isbn/description/language/donor_name all
        // write straight to `books`/`book_copies` (utf8mb4 columns) inside
        // CreateBook::execute()'s transaction — the identical class of bug
        // CopyNoteRequest carried (invalid UTF-8 -> unmapped QueryException
        // -> 500). category_slug is exempt: CreateBook only ever uses it
        // in a WHERE lookup (Category::query()->where('slug', ...)), which
        // proved safe against invalid UTF-8 live (a non-matching WHERE,
        // not a write) — an unmatched slug 400s as category_not_found
        // before any write happens.
        return [
            'title' => ['bail', 'required', 'string', 'max:500', 'encoding:UTF-8'],
            'author' => ['bail', 'required', 'string', 'max:255', 'encoding:UTF-8'],
            'category_slug' => ['required', 'string', 'max:255'],
            'publisher' => ['bail', 'nullable', 'string', 'max:255', 'encoding:UTF-8'],
            'published_year' => ['nullable', 'integer', 'min:1000', 'max:2100'],
            'page_count' => ['nullable', 'integer', 'min:1'],
            'isbn' => ['bail', 'nullable', 'string', 'max:32', 'encoding:UTF-8'],
            'description' => ['bail', 'nullable', 'string', 'max:5000', 'encoding:UTF-8'],
            'language' => ['bail', 'nullable', 'string', 'max:8', 'encoding:UTF-8'],
            'is_published' => ['nullable', 'boolean'],
            'copy_count' => ['required', 'integer', 'min:1', 'max:200'],
            'donor_membership_id' => [
                'nullable', 'uuid', 'prohibits:donor_name',
                function (string $attribute, mixed $value, \Closure $fail): void {
                    if (! Membership::query()->whereKey($value)->exists()) {
                        $fail(__('validation.exists', [
                            'attribute' => __('validation.attributes.donor_membership_id'),
                        ]));
                    }
                },
            ],
            'donor_name' => ['bail', 'nullable', 'string', 'max:255', 'encoding:UTF-8'],
            'acquired_on' => ['nullable', 'date_format:Y-m-d'],
        ];
    }
}
