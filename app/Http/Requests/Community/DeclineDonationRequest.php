<?php

namespace App\Http\Requests\Community;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

/**
 * DeclineDonation's own gate, ahead of the rules — RejectCommentRequest's
 * shape, for the sibling decision on the sibling table.
 * StoreCommentRequest's docblock states the ordering rule both follow:
 * authorize() and rules() both run during argument resolution, BEFORE the
 * controller body, so a 404 here never lets a malformed reason answer
 * first.
 *
 * NO ROUTE REACHES THIS CLASS AT THIS COMMIT — grepped in routes/web.php
 * rather than assumed: the file names no address onto either donation
 * decision. The manager's donation queue and its two buttons are Task
 * 19's; this ships now because DeclineDonation's reason has a submitted
 * shape and the shape belongs beside the command that consumes it.
 * tests/Feature/Community/FormRequestAuthorize404Test.php asks the class
 * directly, with nobody signed in, which is the same unit shape that
 * file's PublishAnnouncementRequest block was written under.
 *
 * It is subject to the two sweeps that read every class under
 * app/Http/Requests: FreeTextEncodingGuardTest, which is why the
 * free-text field leads with `bail` and carries `encoding:UTF-8`, and
 * this directory's FormRequestAuthorize404Test, which is why the denial
 * below is an abort() rather than `return false`.
 */
class DeclineDonationRequest extends FormRequest
{
    public function authorize(): bool
    {
        // 404, never 403 — spec §5.4's anti-enumeration rule. Laravel's
        // default for a `false` return is 403, so the abort is what sets
        // the code.
        abort_unless(Gate::allows('act-as-manager'), 404);

        return true;
    }

    /** @return array<string, list<mixed>> */
    public function rules(): array
    {
        return [
            // `required` refuses a whitespace-only string as well as an
            // empty one, so a manager who submits three spaces gets
            // errors.reason beside the field rather than the errors.rule
            // banner. DeclineDonation::execute's own trim is not made
            // redundant by that: it guards the direct execute() call
            // DonationDecisionsTest makes, where no Form Request runs.
            //
            // max:500 is RejectCommentRequest's ceiling for the same
            // field on the sibling decision. The column is
            // `decision_note text NULL` on a utf8mb4 table, which stops
            // at 65,535 BYTES, so this is well inside it at utf8mb4's
            // four-bytes-a-character worst case (500 x 4 = 2,000).
            'reason' => ['bail', 'required', 'string', 'max:500', 'encoding:UTF-8'],
        ];
    }
}
