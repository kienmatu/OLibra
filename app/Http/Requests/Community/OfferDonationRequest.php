<?php

namespace App\Http\Requests\Community;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

/**
 * The reader's Tặng sách submit, for OPS §4.4's OfferDonation.
 *
 * THE ROUTE IS `shelves.donate.store`. routes/web.php binds that POST to
 * App\Http\Controllers\Reader\DonationController::store, whose signature
 * type-hints this class, so this is the shape that method's $validated
 * array is made of. The offer FORM is Task 18's — this task ships the
 * POST alone, because the plan gives Task 15 the over-HTTP pin for the
 * memberless super admin and that pin needs an address to post to.
 *
 * What pins it, in tests/Feature/Community/OfferDonationTest.php: "a
 * reader offers over HTTP and the offer lands on their membership" for
 * the happy path, "a blank description over HTTP is a field error, not
 * the rule banner" for these rules rendering per-field, and "a signed-in
 * non-member gets 404 on the donate POST, never 403" for the abort
 * below.
 *
 * It is subject to the two sweeps that read every class under
 * app/Http/Requests: FreeTextEncodingGuardTest, which is why the
 * free-text field leads with `bail` and carries `encoding:UTF-8`, and
 * this directory's FormRequestAuthorize404Test, which is why the denial
 * below is an abort() rather than `return false`.
 */
class OfferDonationRequest extends FormRequest
{
    public function authorize(): bool
    {
        // 404, never 403: a refusal must not tell a stranger which shelf
        // URLs are real (spec §5.4 — the MIGRATION DESIGN spec's
        // anti-enumeration rule). Laravel's default for a `false` return
        // is 403, so the abort is what sets the code.
        abort_unless(Gate::allows('act-as-reader'), 404);

        return true;
    }

    /** @return array<string, list<mixed>> */
    public function rules(): array
    {
        return [
            // Free text, so it leads with bail and carries the encoding
            // rule — FreeTextEncodingGuardTest sweeps every Form Request
            // for exactly that, and the class of bug it exists for is an
            // unmapped MariaDB errno 1366 turning a legitimate POST into
            // a 500.
            //
            // `required` refuses a whitespace-only string as well as an
            // empty one — Illuminate\Validation\Concerns\
            // ValidatesAttributes::validateRequired, opened and read in
            // this container at this commit, returns false when
            // `is_string($value) && trim($value) === ''`. So a reader who
            // submits three spaces gets
            // errors.description beside the field rather than the
            // errors.rule banner. OfferDonation::execute's own trim is
            // not made redundant by that: it guards the direct execute()
            // call OfferDonationTest makes, where no Form Request runs.
            //
            // max:2000 is the ceiling an offer is held to. The column is
            // `description text NOT NULL` on a utf8mb4 table, which stops
            // at 65,535 BYTES, so this ceiling is well inside it at
            // utf8mb4's four-bytes-a-character worst case (2,000 × 4 =
            // 8,000).
            'description' => ['bail', 'required', 'string', 'max:2000', 'encoding:UTF-8'],
            // A ROUGH count, and nullable because a reader who does not
            // know leaves it blank — OPS §4.4 calls the whole command
            // deliberately thin for that reason. min:1 because an offer
            // of zero books is not an offer; max:1000 is an upper bound
            // on a plausible bag rather than a column limit (the column
            // is `int(11)`).
            'estimated_count' => ['nullable', 'integer', 'min:1', 'max:1000'],
        ];
    }
}
