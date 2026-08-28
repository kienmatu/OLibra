<?php

namespace App\Http\Requests\Circulation;

use App\Models\Membership;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

/**
 * BR §16.3's escape hatch, mid-lend (plan settled decision 3). The field
 * list is RegisterReaderOnBehalfRequest's, verbatim and for its reasons —
 * no username/password at all: credentials are SetReaderCredentials' job
 * on the reader detail, and a volunteer with a child at the shelf is not
 * inventing a password nobody will type. Copied rather than subclassed:
 * the two requests feed DIFFERENT commands (ManagerRegisterReader →
 * active, RegisterMemberOnBehalf → pending), and a shared parent would
 * make it look as though one change could safely serve both.
 *
 * `book` is this request's only addition — the slug the lend flow came
 * from, so the redirect can go straight on to the confirm step. It is
 * `sometimes`/nullable because a bookmarked hatch with no book still
 * registers a reader; the controller then sends them to step 1.
 */
class QuickLendRegisterReaderRequest extends FormRequest
{
    public function authorize(): bool
    {
        // 404, never 403 — BR §5.4, PR #61's five-request fix.
        abort_unless(Gate::allows('create', Membership::class), 404);

        return true;
    }

    /** @return array<string, list<string>> */
    public function rules(): array
    {
        return [
            'saint_name' => ['bail', 'required', 'string', 'max:255', 'encoding:UTF-8'],
            'full_name' => ['bail', 'required', 'string', 'max:255', 'encoding:UTF-8'],
            'date_of_birth' => ['bail', 'required', 'date_format:Y-m-d'],
            'father_name' => ['bail', 'required', 'string', 'max:255', 'encoding:UTF-8'],
            'mother_name' => ['bail', 'required', 'string', 'max:255', 'encoding:UTF-8'],
            'phone' => ['bail', 'nullable', 'string', 'max:32', 'encoding:UTF-8'],
            'phone_missing_reason' => ['bail', 'nullable', 'string', 'max:1000', 'encoding:UTF-8'],
            'email' => ['bail', 'nullable', 'email', 'max:255'],
            'parish_unit_l1_id' => ['bail', 'nullable', 'string', 'max:36'],
            'parish_unit_l2_id' => ['bail', 'nullable', 'string', 'max:36'],
            'book' => ['bail', 'nullable', 'string', 'max:255'],
        ];
    }
}
