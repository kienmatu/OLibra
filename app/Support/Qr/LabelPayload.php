<?php

declare(strict_types=1);

namespace App\Support\Qr;

/**
 * The payload a printed QR label carries, and the way back from it.
 *
 * Ported from `old_next/src/lib/qr.ts`, whose docblock this one restates.
 * The browser-side scanner (Task 12) and the PDF label sheet (Task 9) must
 * agree on one format, so it lives here with no database, model or
 * framework dependency — pure string arithmetic, testable without a shelf.
 *
 * **A copy's UUID, not its code.** `book_copies_code_unique` is unique only
 * within one shelf (`unique (bookshelf_id, code) where deleted_at is null`),
 * so `DT-0142` can exist on two different shelves in the network. A sticker
 * is a physical object that travels in a donated box of books; what is
 * printed on it must not depend on already knowing where it came from.
 *
 * **base64url of the 16 raw bytes, not the 36-character UUID text — and the
 * reason is error correction, not size.** This restates the reference's own
 * argument rather than a measurement made here: QR byte-mode capacity at
 * version 3 is 32 bytes at ECC level Q, and the 27-byte payload below
 * (`OLB1:` plus 22 base64url characters) fits it; the 36 bytes of UUID text
 * would not, forcing a drop to the weaker ECC level M. Level Q means roughly
 * a quarter of the printed symbol can be scuffed, torn or jam-smeared and
 * still decode — the budget a label glued into a book a child carries home
 * in the rain actually needs.
 *
 * **`OLB1` is a format version, not decoration.** A scanner that meets an
 * `OLB2:` payload must refuse it by name instead of decoding it into a wrong
 * UUID — a wrong copy is worse than an unreadable label.
 */
final class LabelPayload
{
    public const PREFIX = 'OLB1:';

    private const HEX32 = '/^[0-9a-f]{32}$/';

    private const TOKEN = '/^[A-Za-z0-9_-]{22}$/';

    /**
     * The prefix plus the UUID's 16 raw bytes, base64url, unpadded.
     *
     * Always 27 bytes: 5 for `OLB1:`, 22 for the token.
     */
    public static function encode(string $uuid): string
    {
        $hex = strtolower(str_replace('-', '', $uuid));

        if (! preg_match(self::HEX32, $hex)) {
            throw new \InvalidArgumentException("not a uuid: {$uuid}");
        }

        $bytes = hex2bin($hex);

        if ($bytes === false) {
            throw new \InvalidArgumentException("not a uuid: {$uuid}");
        }

        $token = strtr(base64_encode($bytes), '+/', '-_');
        $token = rtrim($token, '=');

        return self::PREFIX.$token;
    }

    /**
     * A scanned payload back to a lowercase UUID, or `null`.
     *
     * Validates before it trusts: exact prefix, exactly 22 characters of
     * `[A-Za-z0-9_-]`, a strict base64 decode, exactly 16 bytes back — only
     * then does it re-hyphenate. Any failure returns `null` rather than a
     * UUID derived from bytes meant for another format.
     */
    public static function uuidFrom(string $payload): ?string
    {
        if (! str_starts_with($payload, self::PREFIX)) {
            return null;
        }

        $token = substr($payload, strlen(self::PREFIX));

        if (! preg_match(self::TOKEN, $token)) {
            return null;
        }

        $base64 = strtr($token, '-_', '+/');
        $padded = str_pad($base64, (int) (4 * ceil(strlen($base64) / 4)), '=');

        $bytes = base64_decode($padded, true);

        if ($bytes === false || strlen($bytes) !== 16) {
            return null;
        }

        $hex = bin2hex($bytes);

        return implode('-', [
            substr($hex, 0, 8),
            substr($hex, 8, 4),
            substr($hex, 12, 4),
            substr($hex, 16, 4),
            substr($hex, 20, 12),
        ]);
    }
}
