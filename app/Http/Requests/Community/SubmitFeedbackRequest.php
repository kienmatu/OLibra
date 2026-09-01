<?php

namespace App\Http\Requests\Community;

use Illuminate\Foundation\Http\FormRequest;

/**
 * The shelf Góp ý submit, for OPS §4.4's SubmitFeedback.
 *
 * THE ROUTE IS `shelves.feedback.store`, and it is the one write in this
 * directory that authorises EVERYBODY. Every sibling here opens with
 * `abort_unless(Gate::allows('act-as-…'), 404)`; this class has no such
 * line and its absence is the rule, not an omission. routes/web.php:220's
 * GET sits deliberately outside the shelf's `role:reader` group because
 * `submitFeedback`'s own docstring in the reference takes neither
 * `requireReader` nor `requireIdentifiedActor` — a guest may leave
 * feedback for a shelf they are not a member of — and a POST that gated
 * on membership would refuse exactly the sender the page exists for. So
 * there is no floor to abort against, and this class is therefore NOT in
 * tests/Feature/Community/FormRequestAuthorize404Test.php: it has no
 * denial branch whose status code could be pinned.
 *
 * NO SHELF FIELD, and that is the point of spec D1 rather than an
 * oversight. The shelf is the `{shelf}` segment of the URI, bound by the
 * `tenant` middleware and read by SubmitFeedback off TenantContext; the
 * reference's own page says "The shelf is not named in the form" and
 * gives the reason — under OPS §4.4's literal reading, a form that forgot
 * the field would have filed a parish's message into the administrator's
 * site-wide inbox, silently and in the wrong direction. Here the
 * corresponding hazard is the opposite direction and worse: a body that
 * COULD name a shelf would let any visitor file a message into any
 * parish's inbox from any address. rules() below is the whole of what a
 * request body can say, and no key in it names a shelf.
 *
 * The phone's SHAPE is not judged here. Phone::assert() inside
 * SubmitFeedback is the single judge of that (spec D2), so a direct
 * caller and an HTTP caller meet the same ruling — this class checks that
 * a number was typed at all, and that what arrived is storable text.
 *
 * FreeTextEncodingGuardTest instantiates every class under
 * app/Http/Requests and demands `encoding:UTF-8` on every field it cannot
 * prove non-text. All four fields here are free text and carry it, each
 * behind `bail`; the class of bug it exists for is an unmapped MariaDB
 * errno 1366 turning a legitimate POST into a 500.
 */
class SubmitFeedbackRequest extends FormRequest
{
    public function authorize(): bool
    {
        // A GUEST MAY WRITE HERE. See the class docblock: this is the one
        // Form Request in the directory with no `abort_unless`, because
        // the route it backs has no role floor to enforce.
        return true;
    }

    /** @return array<string, list<string>> */
    public function rules(): array
    {
        return [
            // The name the sender TYPED, which is a separate fact from the
            // account they may be signed into (spec D1) — the controller
            // passes both to SubmitFeedback and the command writes both.
            // 120 sits well inside the column (`varchar(255)`, characters
            // not bytes on utf8mb4).
            'guest_name' => ['bail', 'required', 'string', 'max:120', 'encoding:UTF-8'],
            // Free text and NOT a `regex`: the number's shape is
            // Phone::assert()'s ruling inside the command, so a bad number
            // comes back as the `phone_invalid` rule banner whichever way
            // the command was reached. `required` here refuses a
            // whitespace-only string as well as an empty one, which is
            // what puts the error beside the field for the ordinary
            // mistake.
            'guest_contact' => ['bail', 'required', 'string', 'max:30', 'encoding:UTF-8'],
            // Genuinely optional — the reference's form marks the other
            // three required and leaves this one bare, and the column is
            // NOT NULL, so a message with no subject line stores the empty
            // string (SubmitFeedback trims a null to '').
            'subject' => ['bail', 'nullable', 'string', 'max:200', 'encoding:UTF-8'],
            // The message itself. max:2000 is the ceiling a góp ý is held
            // to, well inside a utf8mb4 `text` column's 65,535 BYTES at the
            // four-bytes-a-character worst case (2,000 × 4 = 8,000).
            'body' => ['bail', 'required', 'string', 'max:2000', 'encoding:UTF-8'],
        ];
    }
}
