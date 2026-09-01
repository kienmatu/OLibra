<?php

namespace App\Http\Requests\Admin;

use App\Models\SystemSetting;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

/**
 * The contact half of `/admin/settings` (`POST /admin/settings/contact`) —
 * the administration's own name, phone and hours. Its own route, its own
 * submit and its own refusal (spec D1), the rule 3b-i established: a typo in
 * a default for new shelves must not block correcting the phone number the
 * public reads.
 *
 * **EVERY FIELD IS NULLABLE, and that is the point rather than laxity.**
 * All three move together and clearing one is an edit somebody means — an
 * administrator who steps down and leaves no replacement yet is a real
 * state, and `/contact` omits the line rather than showing a blank label
 * (Task 2). `required` here would make an installation that has not chosen
 * anybody unable to say so.
 *
 * **THE PHONE'S SHAPE IS NOT CHECKED HERE.** `max:32` matches the column and
 * nothing else: `App\Support\Members\Phone::assert()` in `UpdateSiteContact`
 * is what decides, so the refusal arrives as this codebase's shared
 * `phone_invalid` sentence on the `errors.rule` banner rather than as a
 * second, differently-worded field error for the same rule. Every other
 * phone in the application (registration, the reader profile) is validated
 * that way, and the sentence it produces is the one already written.
 *
 * `encoding:UTF-8` on all three, per `FreeTextEncodingGuardTest`: two of
 * them are free text a person types in Vietnamese, and the phone is a string
 * column written verbatim once `Phone` has accepted it.
 */
class UpdateSiteContactRequest extends FormRequest
{
    public function authorize(): bool
    {
        // No model in the URL — the installation's single row is the
        // subject, and the ability names no shelf. 404, never 403, matching
        // EnsureSuperAdmin above it (see SystemSettingPolicy).
        abort_unless(Gate::allows('update', SystemSetting::class), 404);

        return true;
    }

    /** @return array<string, list<mixed>> */
    public function rules(): array
    {
        return [
            'contact_name' => ['bail', 'nullable', 'string', 'max:255', 'encoding:UTF-8'],
            'contact_phone' => ['bail', 'nullable', 'string', 'max:32', 'encoding:UTF-8'],
            'contact_hours' => ['bail', 'nullable', 'string', 'max:255', 'encoding:UTF-8'],
        ];
    }
}
