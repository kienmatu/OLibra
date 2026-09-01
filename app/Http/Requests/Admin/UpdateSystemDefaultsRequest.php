<?php

namespace App\Http\Requests\Admin;

use App\Models\SystemSetting;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

/**
 * The defaults half of `/admin/settings`
 * (`POST /admin/settings/defaults`) — the six lending numbers a **newly
 * created** shelf starts with. Its own route, its own submit and its own
 * refusal (spec D1).
 *
 * **THE BOUNDS ARE THE REFERENCE'S** (old_next/src/domain/admin/policy.ts:
 * 61-72), the same table `UpdateBookshelfPolicyRequest` applies to a single
 * shelf — deliberately identical, because these six values become that
 * shelf's own the day it is created (Task 7). A wider bound here would let
 * an administrator seed every future shelf with a policy the per-shelf
 * editor would then refuse to save.
 *
 * **THE TWO FLOORS OF 0 ARE POLICIES, NOT OVERSIGHTS.** `max_renewals: 0`
 * means "no renewals allowed", which BR §5.5 lets a shelf configure, and
 * `due_soon_days: 0` means "warn on the due date itself". A floor of 1 on
 * either forbids a real decision. Every other number floors at 1, and the
 * defect that closes is a shelf whose loan period was seeded as 0, making
 * every loan fall due the day it was made.
 *
 * **`bail` PUTS `integer` BEFORE THE RANGE**, which is what spec D7 means by
 * validating a safe integer first: `"3.5"` and `1e400` are refused as
 * not-an-integer rather than compared against a bound, and no rule after the
 * first failure runs. Laravel's `integer` is `FILTER_VALIDATE_INT`, so
 * neither a decimal string nor an overflowing exponent survives it.
 *
 * `required`, never `nullable`: this form posts all six every time, and
 * "the box was left empty" must not arrive as "leave it as it was" on a
 * settings form.
 *
 * No `encoding:UTF-8` anywhere below and none is needed —
 * `FreeTextEncodingGuardTest` recognises an `integer` ruleset as provably
 * non-text.
 */
class UpdateSystemDefaultsRequest extends FormRequest
{
    public function authorize(): bool
    {
        // No model in the URL; the installation's single row is the subject.
        // 404, never 403 — see SystemSettingPolicy.
        abort_unless(Gate::allows('update', SystemSetting::class), 404);

        return true;
    }

    /** @return array<string, list<mixed>> */
    public function rules(): array
    {
        return [
            'loan_days' => ['bail', 'required', 'integer', 'min:1', 'max:365'],
            'max_concurrent_loans' => ['bail', 'required', 'integer', 'min:1', 'max:50'],
            'max_renewals' => ['bail', 'required', 'integer', 'min:0', 'max:10'],
            'renewal_days' => ['bail', 'required', 'integer', 'min:1', 'max:365'],
            'hold_days' => ['bail', 'required', 'integer', 'min:1', 'max:30'],
            'due_soon_days' => ['bail', 'required', 'integer', 'min:0', 'max:30'],
        ];
    }
}
