<?php

namespace App\Http\Requests\Labels;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

/**
 * The QR label sheet's own gate and shape. This POST carries a body
 * (`bookIds`, `copyIds`), so it gets a Form Request — the same trade
 * DeclineDonationRequest's docblock states: Phase 2a ruled a BODILESS
 * POST does not acquire one solely to hold an `abort_unless`, and this
 * one has fields, so that ruling does not reach it.
 *
 * NEITHER FIELD IS `required`. `bookIds` and `copyIds` are a UNION —
 * CopiesForLabelsQuery's docblock — so a manager may submit either
 * alone, both, or (deliberately) neither. An entirely empty selection is
 * not a field error: it is `MarkCopiesPrinted`'s own refusal
 * (`copy_selection_empty`, a `RuleViolated` rendered once by
 * bootstrap/app.php), not a 422 from this class.
 */
class ExportLabelSheetRequest extends FormRequest
{
    public function authorize(): bool
    {
        // 404, never 403 — the same anti-enumeration shape every other
        // body-carrying manager POST in this codebase uses (see
        // DeclineDonationRequest, RejectMembershipRequest, and siblings).
        abort_unless(Gate::allows('act-as-manager'), 404);

        return true;
    }

    /** @return array<string, list<mixed>> */
    public function rules(): array
    {
        return [
            // bail ahead of uuid — FreeTextEncodingGuardTest's rule: an
            // unguarded uuid check is a value guard, not an ordering
            // guard, and CopiesForLabelsQuery binds these straight into
            // whereIn() (bookIds/copyIds are ascii uuid columns; a
            // malformed value reaching that bind risks the same
            // collation-mix errno 1267 AddCopiesRequest's docblock
            // records for donor_membership_id). There is nothing after
            // uuid in either list today, but bail keeps that true if a
            // later rule is ever added.
            'bookIds' => ['sometimes', 'array'],
            'bookIds.*' => ['bail', 'uuid'],
            'copyIds' => ['sometimes', 'array'],
            'copyIds.*' => ['bail', 'uuid'],
        ];
    }
}
