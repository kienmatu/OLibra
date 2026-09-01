<?php

namespace App\Http\Requests\Members;

use Illuminate\Foundation\Http\FormRequest;

/**
 * *Duyệt* on either change queue — the shelf-level one (BR:580) and the
 * cross-shelf one (BR:602).
 *
 * IT CARRIES A BODY BECAUSE APPROVAL DOES. Every other approve POST in this
 * project is bodiless, and this one is not: spec D3 gives
 * App\Actions\Admin\ApproveProfileChange optional parish-unit ids, and the
 * queue card is where a manager re-places a reader — approving the change
 * and moving them to the right đơn vị is one act, and BR §5.6's placement
 * is a manager's to set. Sending nothing is still valid and means "leave
 * the placement alone": the Action only touches memberships when at least
 * one of the two keys is PRESENT, so absent and null are different answers
 * there and this request must not invent the second.
 *
 * WHICH IS WHY NEITHER FIELD IS `nullable` WITH A DEFAULT AND NOTHING ELSE.
 * `sometimes` is the rule doing the work: a key the form never sent stays
 * absent through validated(), where `nullable` alone on a missing key would
 * be equally silent but a later `filled`/`present` habit would not be.
 * Clearing a placement — sending the key with an empty value — is a real
 * instruction and reaches the Action as null.
 *
 * NO uuid RULE ON THE VALUES, deliberately. A unit id that names no unit,
 * or one belonging to another parish, is refused by
 * App\Support\Members\ParishUnits::validateSelection inside the
 * transaction, in Vietnamese, against the RESULTING pair — and that check
 * has to run there anyway, because validating the supplied half alone
 * cannot see the pair a half-change produces. A `uuid` rule here would add
 * a second, earlier, English-shaped refusal for the same input and split
 * one rule across two layers.
 *
 * NO authorize() OVERRIDE, and that is the honest answer rather than a gap.
 * The thing being authorized is the SUBJECT's membership, which is not in
 * this URL — the Action resolves it from the row, under the lock, at
 * decision time (spec D2 reads the role then, not now), and refuses through
 * MembershipPolicy::decide plus §9's routing rule. A copy of that lookup
 * here would be a second implementation of the decision rule, which is
 * exactly what App\Actions\Admin\Concerns\DecidesProfileChanges exists to
 * prevent. What guards the ROUTE is middleware: `role:manager` on the
 * manage group and `super-admin` on `/admin`, both of which 404 rather than
 * 403 (spec §5.4's anti-enumeration rule), and the shelf-level route's
 * scoped binding 404s a request id from another parish before any of this
 * runs.
 */
class ApproveProfileChangeRequest extends FormRequest
{
    /** @return array<string, list<mixed>> */
    public function rules(): array
    {
        return [
            'parish_unit_l1_id' => ['sometimes', 'nullable', 'string', 'max:36'],
            'parish_unit_l2_id' => ['sometimes', 'nullable', 'string', 'max:36'],
        ];
    }
}
