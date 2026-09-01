<?php

namespace App\Actions\Community;

use App\Exceptions\RuleViolated;
use App\Models\Feedback;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\Clock;
use App\Support\ConcurrencyRetry;
use App\Support\Members\Phone;
use App\Support\TenantContext;
use Illuminate\Support\Facades\DB;

/**
 * Góp ý — a message to the administrator, shelf-scoped or site-wide. Port of
 * old_next/src/domain/community/commands/feedback.ts's submitFeedback, BR
 * §13.2 and OPS §4.4's "the same underlying command with bookshelfId present
 * or absent".
 *
 * A COMMUNITY WRITE, NOT AN ADMINISTRATION ONE (spec D7), which is why it is
 * here and not in app/Actions/Admin/ beside the mark-read and resolve pair.
 * It is the one write in the whole catalogue with no floor at all: OPS §4.4
 * lists its caller as `guest, reader`, so there is no policy check, no
 * membership requirement and frequently no actor. The audit row's actor_id is
 * then null, which AuditSentences already renders as "Hệ thống đã…".
 *
 * THE GUEST FIELDS ARE WRITTEN ON EVERY SUBMISSION, and the member id is
 * ADDITIONAL attribution rather than an alternative to them (spec D1). The
 * reference's insert names bookshelf_id, member_id, guest_name, guest_contact
 * and guest_hash together, every time, and records the live incident from
 * treating the two as alternatives (get-feedback-inbox.ts:38-47): a signed-in
 * reader who typed "Chị Hạnh" was displayed to the administrator as "Quản trị
 * viên" — their account's role label — and the administrator rang the wrong
 * person. So the name the sender typed and the account they were signed into
 * are two separate facts on the row, and neither ever stands in for the other.
 *
 * THE SHELF COMES FROM THE BOUND TENANT, NEVER FROM THE FORM. The reference's
 * shelf page omits the field on purpose ("The shelf is not named in the
 * form"), and $siteWide is the one input that can change where a message
 * lands — a boolean the public contact page passes, not an id any request body
 * can carry. Feedback is deliberately not BelongsToBookshelf (its
 * bookshelf_id is the schema's one nullable tenant column), so this command
 * writes that column itself; TenancyArchitectureTest bans hand-written
 * FILTERING on it, not naming it in an insert.
 *
 * THE CONFIGURED RECORDER IS FOR THE PUBLIC PATH ALONE (spec D7).
 * AuditRecorder::record() throws only when no tenant is bound, so the shelf's
 * own form — which runs under one — audits with no configuration at all. Only
 * a site-wide message, from a page with no shelf and no membership, has to
 * name its (absent) shelf to the recorder, and WideningArchitectureTest's
 * audit-configurator fence therefore takes this ONE FILE as an allow-list
 * entry rather than this whole directory: app/Actions/Community/ also holds
 * CreateAnnouncement, the pin/unpin pair and the comment and donation
 * commands, which are precisely the shelf-scoped writes that fence exists to
 * stop opting out of tenancy.
 */
final class SubmitFeedback
{
    /**
     * OPS §8: three per phone number per day, stated verbatim in the shipped
     * form.
     */
    public const int DAILY_LIMIT = 3;

    public function __construct(
        private TenantContext $tenant,
        private AuditRecorder $audit,
        private Clock $clock,
    ) {}

    /**
     * @param  ?User  $sender  the signed-in account, when there is one. Not
     *                         the sender's identity — that is $senderName and
     *                         $phone, which are typed on every submission.
     * @param  bool  $siteWide  true only for the public contact page, which
     *                          has no shelf to belong to.
     * @return array{feedbackId: string}
     */
    public function execute(
        ?User $sender,
        string $senderName,
        string $phone,
        ?string $subject,
        string $body,
        bool $siteWide = false,
    ): array {
        $senderName = trim($senderName);
        $phone = trim($phone);
        $body = trim($body);

        // The reference raises this one as a ValidationFailed. Here it is an
        // ordinary rule refusal thrown from the command, OfferDonation's
        // empty_description shape: the Form Requests on the two routes give
        // the per-field errors a form wants, and this is the floor underneath
        // them, so a caller reaching the command directly cannot store a
        // message with no sender and no text.
        if ($senderName === '' || $phone === '' || $body === '') {
            throw new RuleViolated('feedback_fields_required');
        }

        // Blank is already refused above, so this only judges the shape —
        // Phone::assert's own docblock asks every caller to check blank
        // first. The reference's QA round found "khong-phai-so" accepted and
        // stored by this exact command, on the only form a parish with no
        // shelf has for reaching the administrator.
        Phone::assert($phone);

        $hash = self::phoneHash($phone);

        // Fail closed rather than silently filing a shelf message site-wide.
        // The shelf route runs behind the tenant middleware, so a null here
        // is a wiring mistake, not a reachable state for a reader.
        $bookshelfId = $siteWide ? null : $this->tenant->bookshelfId();
        if (! $siteWide && $bookshelfId === null) {
            throw new RuleViolated('shelf_not_found');
        }

        // A ROLLING 24 HOURS off the INJECTED clock, not a calendar day and
        // not Laravel's RateLimiter (spec D2). The three differ in store
        // (this table vs the cache), window (rolling vs calendar) and outcome
        // (a Vietnamese sentence in the error bag vs a bare 429), and the
        // domain rule is what the reference ships. The injected clock is what
        // lets a test walk past the window without waiting.
        $since = $this->clock->now()->subDay();
        $recent = Feedback::query()
            ->where('guest_hash', $hash)
            ->where('created_at', '>', $since)
            ->count();

        if ($recent >= self::DAILY_LIMIT) {
            // THE FIGURE TRAVELS WITH THE REFUSAL. The sentence in
            // lang/vi/rules.php holds a :count placeholder rather than a 3,
            // for the same reason both forms take DAILY_LIMIT as a prop:
            // this constant is the only place the number is decided, and a
            // refusal banner quoting its own copy of it lies the day the
            // constant moves.
            throw new RuleViolated('rate_limited', replacements: ['count' => self::DAILY_LIMIT]);
        }

        $subject = trim($subject ?? '');

        return DB::transaction(function () use (
            $bookshelfId, $sender, $senderName, $phone, $hash, $subject, $body, $siteWide,
        ): array {
            $feedback = Feedback::query()->create([
                'bookshelf_id' => $bookshelfId,
                // ADDITIONAL attribution, never a substitute for the two
                // fields below. See the class docblock.
                'member_id' => $sender?->id,
                'guest_name' => $senderName,
                'guest_contact' => $phone,
                'guest_hash' => $hash,
                'subject' => $subject,
                'body' => $body,
                'created_at' => $this->clock->now(),
            ]);

            // Neither the number nor the hash is in the payload. The row
            // holds both because the administrator has to be able to reply;
            // the audit log is a different record with a different retention,
            // and BR §14 asks it to record what changed rather than duplicate
            // it.
            $after = ['site_wide' => $siteWide];

            if ($siteWide) {
                $this->audit->global()
                    ->record('feedback.submitted', 'feedback', $feedback->id, null, $after);
            } else {
                $this->audit->record('feedback.submitted', 'feedback', $feedback->id, null, $after);
            }

            return ['feedbackId' => $feedback->id];
        }, ConcurrencyRetry::ATTEMPTS);
    }

    /**
     * OPS §8's rate-limit key, and the reason it is a hash, carried from the
     * reference verbatim because the flattering misreading is easy:
     *
     * > the point is not to make the number unrecoverable by an attacker who
     * > already has the table — a phone number has far too little entropy for
     * > any hash to achieve that — it is that the column is not itself a
     * > directory. A per-row salt would break the lookup this exists to
     * > perform; a fixed pepper would be one more secret to lose.
     *
     * NORMALISED, NOT WHITESPACE-STRIPPED, and that is a DELIBERATE
     * DIVERGENCE from the reference rather than a correction of it (spec D2).
     * The reference hashes `phone.replace(/\s+/g, "")`, so `0912345678`,
     * `0912 345 678`, `0912.345.678`, `0912-345-678` and `+84912345678` —
     * five spellings of one subscriber number, every one of them accepted by
     * Phone::isValid() — get four separate buckets there, which is a 12/day
     * budget wearing a 3/day label. Phone::normalise() also folds dots,
     * hyphens and a leading +84 to a leading 0, so all five land in one
     * bucket here. This port already made exactly this choice once, for the
     * registration limiter (AppServiceProvider's Task 13 fix); a test written
     * against this behaviour would fail against the reference.
     */
    public static function phoneHash(string $phone): string
    {
        return hash('sha256', Phone::normalise($phone));
    }
}
