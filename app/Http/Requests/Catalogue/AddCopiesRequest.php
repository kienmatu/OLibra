<?php

namespace App\Http\Requests\Catalogue;

use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Membership;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

/**
 * The add-copies form's gate and shape — same donor-trio shape as
 * StoreBookRequest, and the same reason for it (see that class's
 * docblock): `prohibits:` (not the misnamed, BadMethodCallException-raising
 * `prohibited_with`) mirrors Donor::assertSingle for an inline field error,
 * and donor_membership_id's existence check goes through Membership::query()
 * (BookshelfScope-scoped) rather than a bare `exists:memberships,id`, so a
 * membership on another shelf reads as "not found" here instead of later
 * surfacing as the composite FK's raw errno 1452. AddCopies re-asserts the
 * same check for a caller that bypasses this Request.
 */
class AddCopiesRequest extends FormRequest
{
    public function authorize(): bool
    {
        $book = $this->route('book');

        return $book instanceof Book && Gate::allows('addCopies', [BookCopy::class, $book]);
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'count' => ['required', 'integer', 'min:1', 'max:200'],
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
            'donor_name' => ['nullable', 'string', 'max:255'],
            'acquired_on' => ['nullable', 'date_format:Y-m-d'],
        ];
    }
}
