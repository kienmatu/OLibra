<?php

namespace App\Http\Requests\Members;

use App\Support\TenantContext;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

/**
 * The shape of what a reader may put forward about themselves — Phase 3c-i
 * Task 2, feeding App\Actions\Admin\ProposeProfileChange.
 *
 * `avatar_object` IS DELIBERATELY ABSENT FROM rules(), AND THAT ABSENCE IS
 * THE GUARD. It is one of App\Support\Members\ProfileFields' nine, and
 * ProfileFields::normalisePatch folds it like any other field: a plain
 * trimmed string, no validation. So a request body piped through the
 * normaliser with that key in it would let a reader point their own avatar
 * at ANY storage key in the bucket. `validated()` returns only keys that
 * carry a rule, which is what stops the key ever reaching the Action; the
 * Action narrows again through ProfileProposals::onlyProposable, so the
 * guard holds for a caller that does not come through this class.
 * RegistrationController records the same rule for guests: a person may
 * never NAME a storage key. The avatar task writes that column through its
 * own path and never revisits this class, so the guard has to be here.
 *
 * THE FOUR NOT-NULL COLUMNS ARE `nullable` HERE, WHICH LOOKS WRONG AND IS
 * NOT. Saint name is mandatory (BR:87 — "a parish register with no saint
 * name is not a parish register") and so are the other three, but
 * ProfileFields::normalisePatch is where that rule lives, for every write
 * path at once, and it raises `required_fields_missing`. Restating it as
 * `required` here would make the SURFACE the place a blank saint name is
 * caught on this one route and leave the domain rule untested by anything
 * a reader can actually reach. What this class enforces is the shape a
 * validator can see and the domain cannot: lengths, encoding, an email
 * that is an email, a date that is a date.
 *
 * ABSENT MEANS "LEAVE ALONE", present-and-blank means "clear this". That
 * distinction survives from here to the stored bag — `validated()` omits
 * keys the request never sent, normalisePatch skips keys it is not given,
 * and the reader's own page renders a proposal to blank a field
 * differently from one that never mentioned it.
 */
class ProposeProfileChangeRequest extends FormRequest
{
    /**
     * The route names no membership — the caller's own row comes off the
     * bound tenant — so this is a backstop rather than the day's refusal,
     * and it 404s for EnsureShelfRole's anti-enumeration reason rather than
     * rendering Laravel's 403.
     */
    public function authorize(): bool
    {
        $membership = app(TenantContext::class)->membership();

        abort_unless($membership !== null && Gate::allows('propose', $membership), 404);

        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            // encoding:UTF-8 on every free-text field, the rule the
            // registration requests already carry: without it invalid UTF-8
            // reaches the driver as errno 1366 and the framework logs the
            // failing statement with the reader's own details inlined.
            'saint_name' => ['nullable', 'string', 'max:255', 'encoding:UTF-8'],
            'full_name' => ['nullable', 'string', 'max:255', 'encoding:UTF-8'],
            'date_of_birth' => ['nullable', 'date_format:Y-m-d'],
            'father_name' => ['nullable', 'string', 'max:255', 'encoding:UTF-8'],
            'mother_name' => ['nullable', 'string', 'max:255', 'encoding:UTF-8'],
            // phone is shape-checked downstream by App\Support\Members\Phone,
            // which is where QA T18's rule lives; phone_missing_reason is
            // gated by nothing downstream, so it gets the guard here.
            'phone' => ['nullable', 'string', 'max:32'],
            'phone_missing_reason' => ['bail', 'nullable', 'string', 'max:1000', 'encoding:UTF-8'],
            'email' => ['bail', 'nullable', 'email', 'max:255'],
        ];
    }
}
