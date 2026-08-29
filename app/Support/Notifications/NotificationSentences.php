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
     * one — the caller then reaches for its dateless line rather than
     * printing a half-parsed string.
     *
     * A divergence from kinds.ts, and the only one in this arm: the
     * reference interpolates the stored slice RAW, so its sentence reads
     * "trước ngày 2026-09-01 nhé". AGENTS.md's language rule ("dates read
     * as dates") makes that the wrong sentence to ship in Vietnamese. The
     * two lang templates around it are the reference's word for word
     * (kinds.ts:73-74), placeholder spelling aside.
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
        // AuditSentences::lines() (app/Support/Audit/AuditSentences.php:206)
        // writes it this way for exactly this reason, and that is why it
        // passes today.
        /** @var array<string, string>|null $lines */
        static $lines = null;
        $lines ??= require dirname(__DIR__, 3).'/lang/vi/notifications.php';

        return $lines[$key];
    }
}
