<?php

namespace App\Http\Requests\Members;

use Illuminate\Foundation\Http\FormRequest;

/**
 * *Từ chối* on either change queue. BR:580 and BR:602 both say the same
 * thing about it — "Approve and Reject, with a required reason on
 * rejection" — which is the pattern every rejection flow in this document
 * follows.
 *
 * THE REASON IS REQUIRED IN TWO PLACES, AND BOTH ARE MEANT.
 * App\Actions\Admin\RejectProfileChange trims and refuses
 * `reject_reason_required` on its own, because a blank reason must be
 * impossible however the command is reached; this request refuses it here
 * so the message lands on the FIELD a manager is looking at rather than as
 * a page-level rule error. The two share one sentence
 * (`rules.reject_reason_required`) so a volunteer never sees two wordings
 * of one refusal — RejectMembershipRequest's shape, kept.
 *
 * A whitespace-only reason passes `required` and is caught by the Action's
 * trim; that is the layer the constraint
 * `profile_change_requests_rejected_has_reason` sits behind, so it is the
 * layer that must not be bypassable.
 *
 * `encoding:UTF-8` per FreeTextEncodingGuardTest — the reason writes to a
 * utf8mb4 column and is typed in Vietnamese; `max:1000` matches every other
 * free-text refusal reason in the members slice.
 *
 * NO authorize() OVERRIDE — see ApproveProfileChangeRequest's own note for
 * why the subject's membership is not something this URL can reach, and
 * what guards the route instead.
 */
class RejectProfileChangeRequest extends FormRequest
{
    /** @return array<string, list<mixed>> */
    public function rules(): array
    {
        return ['reason' => ['bail', 'required', 'string', 'max:1000', 'encoding:UTF-8']];
    }

    /** @return array<string, string> OPS §4.3's own sentence, not validation.php's generic one */
    public function messages(): array
    {
        return ['reason.required' => __('rules.reject_reason_required')];
    }
}
