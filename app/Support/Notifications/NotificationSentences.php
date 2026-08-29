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
        };
    }

    /** ` vì <reason>`, or nothing — a rejection with no reason is still a sentence. */
    private static function because(?string $reason): string
    {
        return $reason === null ? '' : strtr(self::line('_because'), [':reason' => $reason]);
    }

    /** @param array<string, mixed> $payload */
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
