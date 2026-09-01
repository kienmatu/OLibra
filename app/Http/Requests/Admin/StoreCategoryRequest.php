<?php

namespace App\Http\Requests\Admin;

use App\Models\Category;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

/**
 * The add-a-genre form (`POST /admin/categories`), spec D3.
 *
 * **ONE FIELD, AND THAT IS THE DESIGN RATHER THAN AN OMISSION.** The slug is
 * derived from the name by `CreateCategory` and never typed — see that
 * command for why — so there is nothing else on this form to validate. A
 * second input here would be a second thing two administrators can disagree
 * about, for a handle nobody reads.
 *
 * **THE COLLISION IS NOT CHECKED HERE.** `Rule::unique` on this field would
 * be checking the wrong column: what must be unique is the derived slug, not
 * the name, and "Truyện tranh" and "truyện tranh!" collide on the slug while
 * differing as names. The command derives and checks in one place, and the
 * refusal arrives as `duplicate_category` on the shared `errors.rule` banner
 * — this codebase's shape for a business rule, the way `phone_invalid` does
 * on `/admin/settings`.
 *
 * `max:255` matches the `name` column (`varchar(255)` on a utf8mb4 table);
 * Laravel's `max` counts characters and so does that column, so the two
 * agree on Vietnamese input rather than only on ASCII.
 *
 * `encoding:UTF-8`, per `FreeTextEncodingGuardTest`: a genre name is free
 * text a person types in Vietnamese, and `string`/`max` check length and PHP
 * type only, never byte validity — an unmapped MariaDB errno 1366 turning a
 * legitimate POST into a 500 is the class of bug that sweep exists for.
 */
class StoreCategoryRequest extends FormRequest
{
    public function authorize(): bool
    {
        // 404, never 403: EnsureSuperAdmin refuses the whole /admin group
        // that way on BR §5.4's anti-enumeration rule, and CategoryPolicy
        // answers denyAsNotFound() to agree with it. Laravel's default for
        // a `false` return is 403, so the abort is what sets the code.
        abort_unless(Gate::allows('create', Category::class), 404);

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
