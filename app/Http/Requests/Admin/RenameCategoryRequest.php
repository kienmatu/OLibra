<?php

namespace App\Http\Requests\Admin;

use App\Models\Category;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

/**
 * The rename form (`PATCH /admin/categories/{category}`), spec D3.
 *
 * **THE SAME ONE FIELD AS THE CREATE FORM, AND FOR A STRICTER REASON.** The
 * slug is not merely derived here, it is immutable: `RenameCategory` takes
 * no slug input and never writes the column, because moving it would
 * silently repoint every book already catalogued under the old handle. A
 * slug field on this request would be a field with nothing behind it.
 *
 * There is no uniqueness rule for the same reason there is none on the
 * create form: what is unique is the slug, and this request cannot move it.
 * Two genres may share a display name — they cannot share a handle.
 *
 * `max:255` matches the column; `encoding:UTF-8` per
 * `FreeTextEncodingGuardTest`, a genre name being free text typed in
 * Vietnamese.
 */
class RenameCategoryRequest extends FormRequest
{
    public function authorize(): bool
    {
        /** @var Category $category */
        $category = $this->route('category');

        // 404, never 403 — StoreCategoryRequest's reasoning, and the shape
        // CategoryPolicy answers in.
        abort_unless(Gate::allows('update', $category), 404);

        return true;
    }

    /** @return array<string, list<mixed>> */
    public function rules(): array
    {
        return [
            'name' => ['bail', 'required', 'string', 'max:255', 'encoding:UTF-8'],
        ];
    }
}
