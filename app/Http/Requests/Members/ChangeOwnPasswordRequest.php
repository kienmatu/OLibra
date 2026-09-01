<?php

namespace App\Http\Requests\Members;

use App\Support\TenantContext;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

/**
 * The password form on the reader's own page — Phase 3c-i Task 7, feeding
 * App\Actions\Admin\ChangeOwnPassword.
 *
 * NEITHER FIELD CARRIES encoding:UTF-8, and both are named in
 * FreeTextEncodingGuardTest's exemption list for the reason that test asks
 * for: a password is never written to a utf8mb4 column as itself. The new
 * one goes through Hash::make(), the current one through Hash::check()
 * against a stored hash — the same two exemptions LoginRequest::password
 * and SetReaderCredentialsRequest::password already carry.
 *
 * `min:8` IS RESTATED IN THE ACTION, on purpose. Laravel measures strings
 * with mb_strlen, so this rule and ChangeOwnPassword's own check count the
 * same code points — but the Action is reachable without this class and the
 * length rule is a domain rule, so the surface refusal is the pleasant one
 * and the domain refusal (`new_password_too_short`) is the real one.
 */
class ChangeOwnPasswordRequest extends FormRequest
{
    /**
     * The route names no membership — the caller's own row comes off the
     * bound tenant — so this is a backstop rather than the day's refusal,
     * and it 404s for EnsureShelfRole's anti-enumeration reason rather than
     * rendering Laravel's 403. ProposeProfileChangeRequest's shape.
     */
    public function authorize(): bool
    {
        $membership = app(TenantContext::class)->membership();

        abort_unless($membership !== null && Gate::allows('changePassword', $membership), 404);

        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'current_password' => ['required', 'string'],
            'new_password' => ['required', 'string', 'min:8'],
        ];
    }
}
