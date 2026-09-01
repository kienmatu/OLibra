<?php

namespace App\Http\Requests\Members;

use App\Models\ParishUnit;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

/**
 * The "Thêm đơn vị" form (`POST shelves/{shelf}/manage/units`), Phase
 * 3b-ii Task 5, spec D5.
 *
 * `abort_unless(…, 404)` and never a bare `false`, which Laravel renders as
 * 403: every Form Request under `manage/` answers a denial this way (see
 * `FormRequestAuthorize404Test`, and `EnsureShelfRole`'s docblock for the
 * rule), because BR §5.4 forbids a refusal that confirms what a URL space
 * holds. `ParishUnitPolicy` answers `denyAsNotFound()` so the two agree.
 *
 * **THIS IS THE ONLY GUARD A MANAGER MEETS ON THIS ROUTE**, and it is the
 * one that matters: `role:manager` above lets a manager onto the screen,
 * `Gate::before` lets a super admin through that same gate, and the write
 * itself is super-admin-only. The screen renders no add control to a
 * manager at all — but that is a courtesy, and this is the rule.
 *
 * **NO UNIQUENESS RULE, BECAUSE NO Form Request RULE COULD SEE IT.** The
 * unique is over a GENERATED `name_scope_key` covering `(bookshelf_id,
 * level, parent_id, name)` and NULL when soft-deleted, so `Rule::unique`
 * would have to reproduce the shelf predicate, the parent predicate and the
 * soft-delete partition, and would still race the insert.
 * `CreateParishUnit` catches the 1062 by constraint name instead, and the
 * refusal arrives as `validation_failed` on the shared `errors.rule`
 * banner — this codebase's shape for a business rule, `duplicate_category`'s
 * own arrangement on `/admin/categories`.
 *
 * `level` is `integer` + `in:1,2` here AND checked again in the command:
 * the table's own `parish_units_level_check` is a third copy, and the
 * command's is the one that runs when a console caller skips this class.
 *
 * `parent_id` is `bail`-guarded ahead of `uuid`, which
 * `FreeTextEncodingGuardTest` requires by name: an unguarded uuid rule
 * sitting in front of anything that touches the database is the shape of
 * that sweep's fifth recorded occurrence. Whether the id names a LIVE
 * LEVEL-1 unit of this shelf is deliberately not asked here — that is
 * `parish_unit_l1_not_found`, a refusal with its own Vietnamese sentence,
 * and asking it in a validator would answer it as a field error about a
 * hidden input nobody typed.
 *
 * `max:255` matches the `name` column (varchar(255) on a utf8mb4 table);
 * Laravel's `max` counts characters and so does the column, so the two
 * agree on Vietnamese input rather than only on ASCII. `encoding:UTF-8`
 * per `FreeTextEncodingGuardTest`: a unit name is free text a person types
 * in Vietnamese, and `string`/`max` check length and PHP type only, never
 * byte validity — an unmapped errno 1366 turning a legitimate POST into a
 * 500 is the class of bug that sweep exists for.
 */
class StoreParishUnitRequest extends FormRequest
{
    public function authorize(): bool
    {
        abort_unless(Gate::allows('create', ParishUnit::class), 404);

        return true;
    }

    /** @return array<string, list<mixed>> */
    public function rules(): array
    {
        return [
            'level' => ['bail', 'required', 'integer', 'in:1,2'],
            'parent_id' => ['bail', 'nullable', 'uuid'],
            'name' => ['bail', 'required', 'string', 'max:255', 'encoding:UTF-8'],
        ];
    }
}
