<?php

namespace App\Http\Requests\Members;

use App\Models\ParishUnit;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

/**
 * The "Lên"/"Xuống" submit (`POST shelves/{shelf}/manage/units/reorder`),
 * Phase 3b-ii Task 5, spec D5.
 *
 * **THE WHOLE SIBLING GROUP TRAVELS, IN ITS NEW ORDER**, not the one unit
 * that moved and not a direction. `sort_order` is the 1-based index in this
 * array and the position is the caller's, never something the command
 * derives — see `ReorderParishUnits` for why a partial list is refused
 * rather than repaired.
 *
 * **THE THREE STRUCTURAL RULES HERE ARE NOT THE THREE BUSINESS ONES.**
 * `array` and `min:1` say the request is shaped like a group; that the ids
 * resolve, share one `(level, parent_id)` and cover the ENTIRE group are
 * `ReorderParishUnits`'s own checks, each needing a database read this
 * class has no business doing. A validator that answered them would report
 * a stale screen as a field error on a hidden input.
 *
 * `unit_ids` is `array` and each element `uuid` behind `bail` —
 * `FreeTextEncodingGuardTest` reads both: an array is provably non-text, and
 * an unguarded uuid rule in front of anything that reaches the database is
 * the shape of that sweep's fifth recorded occurrence. Nothing on this
 * request is free text, so nothing here carries `encoding:UTF-8`.
 *
 * `abort_unless(…, 404)`, matching every Form Request under `manage/` and
 * `ParishUnitPolicy`'s `denyAsNotFound()`. Authorized by class name, like
 * the policy's `reorder()`: the subject is a group of rows, and naming one
 * of them would make the permission a statement about whichever unit the
 * caller happened to list first.
 */
class ReorderParishUnitsRequest extends FormRequest
{
    public function authorize(): bool
    {
        abort_unless(Gate::allows('reorder', ParishUnit::class), 404);

        return true;
    }

    /** @return array<string, list<mixed>> */
    public function rules(): array
    {
        return [
            'unit_ids' => ['bail', 'required', 'array', 'min:1'],
            'unit_ids.*' => ['bail', 'required', 'uuid'],
        ];
    }
}
