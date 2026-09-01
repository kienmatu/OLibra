<?php

namespace App\Http\Requests\Members;

use App\Support\TenantContext;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

/**
 * The photograph half of BR:83's request-not-an-edit — Phase 3c-i Task 8,
 * feeding App\Actions\Admin\ProposeAvatarChange.
 *
 * ONE FIELD, AND IT IS A FILE. `avatar_object` — the storage key — is not
 * among the rules and never will be: a reader may never NAME a key, only
 * hand over bytes that App\Support\Members\AvatarStorage mints a key for.
 * ProposeProfileChangeRequest keeps the same rule for the text form, and
 * RegistrationController.php:94 keeps it for guests.
 *
 * NEITHER THE SIZE NOR THE TYPE IS VALIDATED HERE, and that is deliberate
 * rather than an omission. OPS §4.3's three failure modes — `file_too_large`,
 * `heic_not_supported`, `invalid_image` — are named refusals with Vietnamese
 * sentences of their own, and a `max:5120` or a `mimetypes:` rule here would
 * catch them first and answer with Laravel's generic validation message
 * instead. `max` also cannot tell a HEIC from a text file, and `mimetypes`
 * cannot tell a real JPEG from a renamed one; the decode in
 * App\Support\Members\AvatarImage can. What is left here is the shape a
 * validator can see and nothing downstream can: that a file arrived at all.
 *
 * PHP's own `upload_max_filesize` sits ABOVE the 5 MiB cap
 * (docker/php/Dockerfile), so the band between the two is refused by the
 * application in Vietnamese rather than by PHP with an empty `$_FILES`.
 */
class ProposeAvatarRequest extends FormRequest
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
            'avatar' => ['required', 'file'],
        ];
    }
}
