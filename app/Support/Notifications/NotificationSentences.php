<?php

declare(strict_types=1);

namespace App\Support\Notifications;

/**
 * kind + stored payload → the sentence a reader reads. Pure (the lang
 * file loads by require, no framework), mirroring AuditSentences' shape —
 * but with the OPPOSITE storage rule, deliberately: an audit entry is
 * evidence and shows stored values; a notification is a message to one
 * person, and re-rendering it from the payload is how "Dế Mèn" follows a
 * corrected title and a typo in the wording is fixable retroactively.
 *
 * Absent payload fields degrade, never throw; an unknown stored kind (a
 * row from another build) renders the neutral line, never the raw token.
 */
final class NotificationSentences
{
    /** @param array<string, mixed> $payload */
    public static function sentence(string $kind, array $payload): string
    {
        $known = NotificationKind::tryFrom($kind);
        if ($known === null) {
            return self::line('_unknown');
        }

        return match ($known) {
            NotificationKind::MembershipApproved => self::line('membership_approved'),
            NotificationKind::MembershipRejected => strtr(
                self::line('membership_rejected'),
                [':because' => self::because(self::str($payload, 'reason'))],
            ),
            NotificationKind::RequestApproved => (function () use ($payload): string {
                $book = self::which(self::str($payload, 'title'));
                $until = self::date(self::str($payload, 'hold_until'));

                return $until === null
                    ? strtr(self::line('_request_approved_no_date'), [':book' => $book])
                    : strtr(self::line('request_approved'), [':book' => $book, ':until' => $until]);
            })(),
            NotificationKind::RequestRejected => strtr(self::line('request_rejected'), [
                ':book' => self::which(self::str($payload, 'title')),
                ':because' => self::because(self::str($payload, 'reason')),
            ]),
            NotificationKind::LoanDueSoon => (function () use ($payload): string {
                $book = self::which(self::str($payload, 'title'));
                $due = self::date(self::str($payload, 'due_on'));

                return $due === null
                    ? strtr(self::line('_loan_due_soon_bare'), [':book' => $book])
                    : strtr(self::line('loan_due_soon'), [':book' => $book, ':due' => $due]);
            })(),
            NotificationKind::LoanOverdue => strtr(self::line('loan_overdue'), [
                ':book' => self::which(self::str($payload, 'title')),
            ]),
            // No strtr — the MembershipApproved shape, because the
            // payload is empty (divergence 10).
            NotificationKind::CommentApproved => self::line('comment_approved'),
            // BR:490's pair. Approved is the MembershipApproved shape —
            // no payload, because the reader's own profile page is where
            // the new values are, and repeating them in a bell line would
            // freeze a copy of them beside the record they came from.
            NotificationKind::ProfileChangeApproved => self::line('profile_change_approved'),
            // Rejected carries the manager's reason, which BR:490 names in
            // the requirement itself. It degrades through because() like
            // every other reason-bearing line: a row written without one
            // still reads as a sentence rather than as " vì ".
            NotificationKind::ProfileChangeRejected => strtr(
                self::line('profile_change_rejected'),
                [':because' => self::because(self::str($payload, 'reason'))],
            ),
        };
    }

    /** ` vì <reason>`, or nothing — a rejection with no reason is still a sentence. */
    private static function because(?string $reason): string
    {
        return $reason === null ? '' : strtr(self::line('_because'), [':reason' => $reason]);
    }

    /** `Dế Mèn Phiêu Lưu Ký` when stored, `cuốn sách` when not. */
    private static function which(?string $title): string
    {
        return $title ?? self::line('_which');
    }

    /**
     * `Y-m-d` (Asia/Ho_Chi_Minh civil date, plan divergence 5) → `d/m/Y`,
     * or null when the payload holds no date or holds something that is not
     * SHAPED like one — the caller then reaches for its dateless line
     * rather than printing a half-parsed string.
     *
     * Shape, not validity, and the distinction is deliberate rather than
     * overlooked (Task 19's sweep; the sentence above used to say "is not
     * one", which claims more than the regex does): the pattern is four
     * digits, two, two, so a stored `2026-99-99` renders `99/99/2026`
     * instead of falling back. Nothing shipped stores such a value: the
     * payload keys this method reads are written by Carbon's
     * ->toDateString(), which the check `grep -rn "'hold_until'" app/` and
     * the same for `'due_on' =>` will re-run rather than ask you to trust.
     * So tightening this to a calendar check (checkdate) would change no
     * shipped sentence, which is why a wrap-up task did not do it. A
     * future writer that stores a hand-built date string is the case that
     * makes it worth doing.
     *
     * A divergence from kinds.ts, applying wherever an arm renders a
     * stored date — every one of them reaches the payload through here.
     * The reference interpolates the stored slice RAW at both places
     * ported so far (kinds.ts:73 "trước ngày 2026-09-01 nhé" and
     * kinds.ts:89 "ngày 2026-08-27."), and AGENTS.md's language rule
     * ("dates read as dates") makes that the wrong sentence to ship in
     * Vietnamese. The lang templates around it are otherwise the
     * reference's word for word (kinds.ts:73-74 and 89), placeholder
     * spelling aside — including the dateless fallbacks, whose Vietnamese
     * ("sớm nhé", "ngày sắp tới") is the reference's own.
     *
     * The fallback fires one case wider than the reference's, and that
     * widening is deliberate rather than accidental: the reference falls
     * back only on an absent value, this also falls back on a stored value
     * that is not date-SHAPED (see above — shape, not validity), so a
     * half-parsed string never reaches a reader.
     * NotificationSentencesTest pins both.
     */
    private static function date(?string $ymd): ?string
    {
        if ($ymd === null || preg_match('/^\d{4}-\d{2}-\d{2}$/', $ymd) !== 1) {
            return null;
        }
        [$y, $m, $d] = explode('-', $ymd);

        return "{$d}/{$m}/{$y}";
    }

    /**
     * A payload field as a non-blank string, or null.
     *
     * One deliberate divergence from kinds.ts, named because it is a
     * divergence: the reference tests `value.trim() !== ""` but returns
     * the RAW value, so a stored `" thiếu thông tin "` renders with its
     * padding inside the sentence. This trims what it returns. Both
     * writers store trim($reason) today, so nothing observable changes —
     * it matters only for a row written by hand or by a future caller
     * that does not trim, where the reference would render " vì  X  ."
     *
     * @param  array<string, mixed>  $payload
     */
    private static function str(array $payload, string $key): ?string
    {
        $value = $payload[$key] ?? null;

        return is_string($value) && trim($value) !== '' ? trim($value) : null;
    }

    private static function line(string $key): string
    {
        // `= null` is not decoration: a bare `static $lines;` makes the
        // variable a non-nullable `mixed` that always exists, and Larastan
        // level 8 rejects the `??=` beneath it as nullCoalesce.variable.
        // AuditSentences::lines() (app/Support/Audit/AuditSentences.php)
        // writes it this way for exactly this reason, and that is why it
        // passes today.
        /** @var array<string, string>|null $lines */
        static $lines = null;
        $lines ??= require dirname(__DIR__, 3).'/lang/vi/notifications.php';

        return $lines[$key];
    }
}
