<?php

namespace App\Http\Requests\Members;

use App\Models\Membership;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

/**
 * The on-behalf form's shape. No username/password fields AT ALL — the
 * reference's own decision: credentials are SetReaderCredentials' job on
 * the reader detail, and a manager typing a child's registration is not
 * the moment to invent a password nobody will type.
 */
class RegisterReaderOnBehalfRequest extends FormRequest
{
    /**
     * Fix round, Minor #4: returning the bare bool from `Gate::allows()`
     * lets Laravel's default handling render a FAILED authorize() as
     * 403 — `abort_unless` renders 404 instead, matching
     * `EnsureShelfRole`'s own anti-enumeration rule (that middleware's
     * docblock spells out the exact 403-vs-404 hazard this fixes).
     * Unreachable today only because `role:manager` already 404s a
     * non-manager before this ever runs; this is the backstop for the
     * day routing changes and it does not.
     */
    public function authorize(): bool
    {
        abort_unless(Gate::allows('create', Membership::class), 404);

        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            // Fix round, Task 2 (applied here too): these feed the same
            // Registration::createPerson() INSERT as the public form's
            // request, so the same errno-1366-then-PII-in-the-log path is
            // reachable from this manager route as well. See
            // RegisterMembershipRequest for the full reasoning.
            'saint_name' => ['required', 'string', 'max:255', 'encoding:UTF-8'],
            'full_name' => ['required', 'string', 'max:255', 'encoding:UTF-8'],
            'date_of_birth' => ['required', 'date_format:Y-m-d'],
            'father_name' => ['required', 'string', 'max:255', 'encoding:UTF-8'],
            'mother_name' => ['required', 'string', 'max:255', 'encoding:UTF-8'],
            // phone is exempt (Phone::assert() gates it before storage,
            // see RegisterMembershipRequest); phone_missing_reason is not
            // gated downstream, so it gets the same guard (Task 12 sweep).
            'phone' => ['nullable', 'string', 'max:32'],
            'phone_missing_reason' => ['bail', 'nullable', 'string', 'max:1000', 'encoding:UTF-8'],
            'email' => ['bail', 'nullable', 'email', 'max:255'],
            'parish_unit_l1_id' => ['nullable', 'string', 'max:36'],
            'parish_unit_l2_id' => ['nullable', 'string', 'max:36'],
        ];
    }
}
