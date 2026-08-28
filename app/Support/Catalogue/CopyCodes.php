<?php

namespace App\Support\Catalogue;

/**
 * The copy-code derivation, verbatim from
 * old_next/src/domain/catalogue/policy.ts (copyCodePrefix, formatCopyCode,
 * escapeLikePattern). Do not invent a scheme — 'DT-0215' is printed on
 * physical labels.
 */
final class CopyCodes
{
    /**
     * The letters in front of a code — 'DT' in 'DT-0215'. A shelf's
     * settings blob may override via copy_code_prefix; the default derives
     * the initials of the slug's hyphen-separated words (dong-thap → DT),
     * capped at three; a single-word slug falls back to its first two
     * letters, since one initial is too thin for a label read off a book.
     *
     * @param  array<string, mixed>|null  $settings
     */
    public static function prefix(string $slug, ?array $settings): string
    {
        $override = $settings['copy_code_prefix'] ?? null;

        if (is_string($override) && trim($override) !== '') {
            return mb_strtoupper(trim($override));
        }

        $initials = implode('', array_map(
            fn (string $word): string => mb_substr($word, 0, 1),
            array_values(array_filter(explode('-', $slug))),
        ));
        $initials = mb_strtoupper($initials);

        return mb_strlen($initials) >= 2
            ? mb_substr($initials, 0, 3)
            : mb_strtoupper(mb_substr($slug, 0, 2));
    }

    /**
     * 'DT' + 215 → 'DT-0215'. Padded here, never with SQL's LPAD, which
     * truncates on the right: LPAD('10000', 4, '0') is '1000', so the
     * ten-thousandth copy would collide with the thousandth. str_pad with
     * STR_PAD_LEFT never shortens a string.
     */
    public static function format(string $prefix, int $sequence): string
    {
        return $prefix.'-'.str_pad((string) $sequence, 4, '0', STR_PAD_LEFT);
    }

    /**
     * Escapes %, _ and the escape character itself for a LIKE pattern (M7):
     * a copy_code_prefix override containing '_' — LIKE's single-character
     * wildcard — would widen the allocator's max-code scan across codes
     * that were never in this prefix's sequence. Call on the prefix only;
     * the trailing '-%' the allocator appends is the intended wildcard.
     * MariaDB's default LIKE escape character is backslash (this codebase
     * never sets NO_BACKSLASH_ESCAPES), so no ESCAPE clause is needed.
     */
    public static function escapeLike(string $value): string
    {
        return addcslashes($value, '\\%_');
    }
}
