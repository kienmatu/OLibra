<?php

namespace App\Http\Requests\Members;

use App\Models\ParishUnit;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

/**
 * The "Đổi tên" form (`PATCH shelves/{shelf}/manage/units/{parishUnit}`),
 * Phase 3b-ii Task 5, spec D5.
 *
 * **ONE FIELD, AND THAT IS THE COMMAND'S WHOLE PROMISE.** A rename moves
 * the display name and nothing else — not `sort_order`, not `parent_id`.
 * BR §5.6's argument for units-as-rows is that renaming stays cheap because
 * every membership references the unit by id; a second field here would be
 * a field with nothing behind it, since `RenameParishUnit` never writes
 * another column.
 *
 * There is no uniqueness rule, for `StoreParishUnitRequest`'s reason: the
 * unique is over a generated, soft-delete-aware `name_scope_key` no
 * validator can reproduce, and the command translates the 1062 by
 * constraint name into `validation_failed` on the shared banner.
 *
 * `abort_unless(…, 404)`, matching every Form Request under `manage/` and
 * `ParishUnitPolicy`'s `denyAsNotFound()`. The unit is read off the route
 * so the policy is asked about the row actually being renamed — which
 * `ParishUnitPolicy` deliberately does not read, for the reason its
 * docblock gives.
 *
 * `max:255` matches the column; `encoding:UTF-8` per
 * `FreeTextEncodingGuardTest`, a unit name being free text typed in
 * Vietnamese.
 */
class RenameParishUnitRequest extends FormRequest
{
    public function authorize(): bool
    {
        /** @var ?ParishUnit $unit */
        $unit = $this->route('parishUnit');

        abort_unless($unit instanceof ParishUnit && Gate::allows('update', $unit), 404);

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
