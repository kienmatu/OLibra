<?php

namespace App\Http\Requests\Community;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

/**
 * The "Đăng ngay" / "Đăng lại" form for OPS §4.4's PublishAnnouncement.
 *
 * ONE FIELD, AND ITS WHOLE JOB IS TO ARRIVE IN THREE DISTINGUISHABLE
 * SHAPES. App\Actions\Community\PublishAnnouncement refuses a live
 * announcement only when the caller said NOTHING about the expiry, so
 * the difference between "expires_at absent" and "expires_at present and
 * empty" is the difference between a refusal and a successful *Đăng
 * lại*. MEASURED against this class's own rules() — a Validator built
 * from `(new PublishAnnouncementRequest)->rules()`, five payloads, each
 * validated() read with array_key_exists rather than `??`:
 *
 *   - absent          -> key_exists=false
 *   - present, null   -> key_exists=true, value NULL
 *   - present, ''     -> key_exists=true, value ''
 *   - present, a date -> key_exists=true, value '2026-09-30T03:00:00Z'
 *   - present, junk   -> refused, "expires at không phải là ngày hợp lệ."
 *
 * Over real HTTP the second and third rows are the same submission:
 * Laravel's global ConvertEmptyStringsToNull turns the empty field into
 * null before validation runs, so the row that matters is the NULL one.
 * (That middleware sits ahead of the validator, which is why the ''
 * result above is what these rules alone do with a value the request
 * pipeline would not hand them.)
 *
 * `nullable` is what admits the null row — `required` would refuse the
 * ordinary republish ("the shelf is closed until further notice"), which
 * is the single most common thing this form is for. There is deliberately
 * no `sometimes`: the null row is what the form itself sends, and the
 * absent row already comes out of validated() without the key, measured
 * above.
 *
 * A NOTE ON THE PROBE THAT PRODUCED THAT TABLE, because the bug this
 * class exists to prevent got committed while measuring it: the first
 * run read the value as `$validated['expires_at'] ?? '<<no key>>'` and
 * printed the same "<<no key>>" for the absent row and the null row. The
 * distinction survived the Form Request and died in the reading. That is
 * the whole lesson in one line.
 *
 * THE PARSE AND THE RENAME BELONG TO THE CONTROLLER, and getting either
 * wrong collapses the three shapes back into two — silently, with this
 * class and the Action both correct. Both spellings of the collapse were
 * MEASURED in this repository's container, with Carbon::setTestNow
 * pinned to 2026-08-30T04:00:00Z:
 *
 *   - `$request->date('expires_at')` returned NULL for the absent shape
 *     AND NULL for the present-empty one — the distinction erased at the
 *     boundary. `$request->has('expires_at')` DOES separate them (false
 *     vs true); `$request->filled('expires_at')` does NOT (false for
 *     both). So presence is read with array_key_exists over validated(),
 *     never with date() and never with filled().
 *   - `CarbonImmutable::parse(null)` returned
 *     `2026-08-30T04:00:00+00:00`, the frozen instant — not null. So a
 *     cast that reaches for parse() on a cleared expiry republishes an
 *     announcement that expires in the same instant, posted and lapsed
 *     at once, while every assertion about published_at, status and
 *     flash still passes.
 *
 * The cast that survives both is null-preserving:
 *
 *     $validated['expires_at'] === null
 *         ? null
 *         : CarbonImmutable::parse($validated['expires_at'])
 *
 * and the key is renamed `expires_at` -> `expiresAt` on the way into the
 * command's $changes array.
 *
 * THAT CAST AND THAT RENAME NOW EXIST, AND THEY ARE PINNED. Task 14 wrote
 * them as App\Http\Controllers\Manage\AnnouncementController::changes()
 * and its instant() / expiry() pair, and
 * tests/Feature/Community/ManagerAnnouncementsScreenTest.php holds them
 * by asserting the expires_at COLUMN: "POST Đăng lại with no date
 * republishes a lapsed notice and leaves the expiry null" catches the
 * parse, "POST Đăng lại with a date puts that date in the column" catches
 * the rename, and "PATCH naming only the title leaves the expiry where it
 * was" catches the presence reading. An earlier draft of this paragraph
 * read "Nothing pins that today because nothing binds this class to a
 * route" — true when this file shipped in Task 11, falsified by the
 * commit that wrote that controller.
 *
 * ONE THING THAT CONTROLLER ADDED THAT THIS TABLE DOES NOT SHOW: a
 * date-only value ("2026-09-30", which is all an `<input type="date">`
 * can send) is read as the END of that day in Asia/Ho_Chi_Minh, not its
 * first microsecond — AGENTS.md's rule that a date is a day. The
 * measurement is in expiry()'s own docblock. The five shapes above are
 * unaffected: the treatment is applied after these rules have run, and
 * `nullable` still short-circuits `date` for the null row.
 *
 * expires_at is a `date`, so FreeTextEncodingGuardTest reads it as
 * provably-non-text and no `encoding:UTF-8` applies — this class has no
 * free-text field at all, which is why it carries no `bail`/max pair the
 * way its two siblings do.
 *
 * THE ROUTE IS `shelves.manage.announcements.publish`, reached in Task
 * 14: routes/web.php binds that POST to that controller's publish(),
 * whose signature type-hints this class, and "a reader of the shelf 404s
 * on the publish POST" is the block behind the abort below. An earlier
 * draft said "NO ROUTE POINTS AT THIS CLASS YET — the publish buttons are
 * a later task"; the buttons exist now, in
 * resources/js/pages/manage/announcements/index.tsx, and they are
 * withheld from a SHOWING row precisely because this class's field is
 * always posted — see that file, and
 * ManagerAnnouncementsScreenTest's "POST publish to a showing row with no
 * expiry key at all is refused". This class also remains subject to the
 * two sweeps that read every class under app/Http/Requests: the encoding
 * guard above, and this directory's FormRequestAuthorize404Test, which is
 * why the denial below is an abort() rather than `return false`.
 */
class PublishAnnouncementRequest extends FormRequest
{
    public function authorize(): bool
    {
        // 404, never 403: a refusal must not tell a stranger which shelf
        // URLs are real (spec §5.4). Laravel's default for a `false`
        // return is 403, so the abort is what sets the code.
        //
        // The gate, not the `publish` ability: that ability delegates to
        // this same gate (App\Policies\AnnouncementPolicy::publish), and
        // asking it here would need a bound Announcement, which is a row
        // this class would then be answering questions about. Both
        // sibling Announcement requests ask the same gate the same way.
        abort_unless(Gate::allows('act-as-manager'), 404);

        return true;
    }

    /** @return array<string, list<mixed>> */
    public function rules(): array
    {
        return [
            // nullable, and it is load-bearing — see the class docblock.
            // An empty submitted value arrives here as null (Laravel's
            // ConvertEmptyStringsToNull) and `nullable` short-circuits
            // `date`, so the key survives into validated() carrying null,
            // which is the shape *Đăng lại* rests on.
            'expires_at' => ['nullable', 'date'],
        ];
    }
}
