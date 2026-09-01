<?php

namespace App\Http\Requests\Admin;

use App\Enums\MembershipRole;
use App\Models\Bookshelf;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;

/**
 * The appoint form on `/admin/managers`
 * (`POST /admin/managers/{bookshelf}`). Spec D7.
 *
 * TWO FIELDS, and the role is one of them. The reference's `assignManager`
 * takes `role: "manager" | "admin"` and validates it, and `MembershipRole`
 * has both cases with `admin` at rank 3, so the form offers a choice rather
 * than assuming the lower grant.
 *
 * `reader` IS NOT AN ACCEPTED VALUE, even though it is a valid case of the
 * enum. Accepting it would make the appoint path a demotion path — a grant
 * form that silently takes a grant away, writing an audit row saying one was
 * given. Demotion has its own route, its own confirmation and its own audit
 * action. `AssignManager` refuses the value a second time for a caller that
 * never passed through here.
 *
 * NO `exists:` RULE ON THE PERSON. The command reads the row under its own
 * lock and refuses a missing one as `membership_not_found`, so a rule here
 * would be a second query answering the same question a moment earlier —
 * and answering it about a row that may be deleted between the two.
 */
class AssignManagerRequest extends FormRequest
{
    public function authorize(): bool
    {
        // {bookshelf}, not {shelf} — routes/web.php explains why the /admin
        // group cannot use the tenant-bound parameter name.
        /** @var Bookshelf $bookshelf */
        $bookshelf = $this->route('bookshelf');

        // 404, never 403 — BookshelfPolicy's shape. The ability also
        // refuses an archived shelf, which is the state rule this form
        // shares with the picker that feeds it.
        abort_unless(Gate::allows('assignManager', $bookshelf), 404);

        return true;
    }

    /** @return array<string, list<mixed>> */
    public function rules(): array
    {
        return [
            // `uuid`, which is also what keeps FreeTextEncodingGuardTest
            // quiet without an exemption: every id in this schema is one,
            // so a value that is not a uuid cannot name a person and there
            // is nothing here for an encoding guard to protect.
            'user_id' => ['bail', 'required', 'uuid'],
            'role' => ['bail', 'required', Rule::in([
                MembershipRole::Manager->value,
                MembershipRole::Admin->value,
            ])],
        ];
    }
}
