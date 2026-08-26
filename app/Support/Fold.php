<?php

namespace App\Support;

/**
 * Diacritic- and case-insensitive folding, the successor to
 * src/domain/kernel/fold.ts's fold() (BR §12).
 *
 * fold() is: mb_strtolower → strtr(MAP) → non-[a-z0-9] runs to one space →
 * trim. FoldExpression::sql() (Task 4) renders the SAME pipeline as SQL:
 * LOWER → a REPLACE per MAP entry → REGEXP_REPLACE → TRIM. One table, two
 * renderings; tests/Feature/FoldParityTest.php proves the renderings agree
 * over every map entry, a U+00C0–U+024F sweep, and the real corpus.
 *
 * No Normalizer, deliberately: MariaDB cannot NFD-decompose, so a
 * decomposition step here would make the two halves different functions for
 * every accented letter outside this table — Kästner folding to 'kastner'
 * in PHP and 'k stner' in the database, a permanently unfindable author.
 * Anything not in MAP (CJK, marks, symbols) degrades to a space on BOTH
 * halves identically, which keeps BR §12's store==search invariant even
 * where the fold is lossy.
 *
 * đ needs its own entry and must not be removed: it is a distinct
 * Vietnamese letter, not a d carrying a diacritic.
 */
final class Fold
{
    /**
     * Lowercase code point → ascii replacement. Uppercase input is handled
     * by mb_strtolower / LOWER() before this table applies; the parity
     * test's uppercase sweep is what proves the two lowercasings agree.
     *
     * @var array<string, string>
     */
    public const MAP = [
        // ── Vietnamese (67) — the reason this table exists ──
        'à' => 'a', 'á' => 'a', 'ả' => 'a', 'ã' => 'a', 'ạ' => 'a',
        'ă' => 'a', 'ằ' => 'a', 'ắ' => 'a', 'ẳ' => 'a', 'ẵ' => 'a', 'ặ' => 'a',
        'â' => 'a', 'ầ' => 'a', 'ấ' => 'a', 'ẩ' => 'a', 'ẫ' => 'a', 'ậ' => 'a',
        'è' => 'e', 'é' => 'e', 'ẻ' => 'e', 'ẽ' => 'e', 'ẹ' => 'e',
        'ê' => 'e', 'ề' => 'e', 'ế' => 'e', 'ể' => 'e', 'ễ' => 'e', 'ệ' => 'e',
        'ì' => 'i', 'í' => 'i', 'ỉ' => 'i', 'ĩ' => 'i', 'ị' => 'i',
        'ò' => 'o', 'ó' => 'o', 'ỏ' => 'o', 'õ' => 'o', 'ọ' => 'o',
        'ô' => 'o', 'ồ' => 'o', 'ố' => 'o', 'ổ' => 'o', 'ỗ' => 'o', 'ộ' => 'o',
        'ơ' => 'o', 'ờ' => 'o', 'ớ' => 'o', 'ở' => 'o', 'ỡ' => 'o', 'ợ' => 'o',
        'ù' => 'u', 'ú' => 'u', 'ủ' => 'u', 'ũ' => 'u', 'ụ' => 'u',
        'ư' => 'u', 'ừ' => 'u', 'ứ' => 'u', 'ử' => 'u', 'ữ' => 'u', 'ự' => 'u',
        'ỳ' => 'y', 'ý' => 'y', 'ỷ' => 'y', 'ỹ' => 'y', 'ỵ' => 'y',
        'đ' => 'd',
        // ── Latin-1 Supplement (16) — European author names ──
        'ä' => 'a', 'å' => 'a', 'æ' => 'ae', 'ç' => 'c', 'ë' => 'e',
        'î' => 'i', 'ï' => 'i', 'ð' => 'd', 'ñ' => 'n', 'ö' => 'o',
        'ø' => 'o', 'û' => 'u', 'ü' => 'u', 'ÿ' => 'y', 'þ' => 'th',
        'ß' => 'ss',
        // ── Latin Extended-A (60) ──
        'ā' => 'a', 'ą' => 'a',
        'ć' => 'c', 'ĉ' => 'c', 'ċ' => 'c', 'č' => 'c',
        'ď' => 'd',
        'ē' => 'e', 'ĕ' => 'e', 'ė' => 'e', 'ę' => 'e', 'ě' => 'e',
        'ĝ' => 'g', 'ğ' => 'g', 'ġ' => 'g', 'ģ' => 'g',
        'ĥ' => 'h', 'ħ' => 'h',
        'ī' => 'i', 'ĭ' => 'i', 'į' => 'i', 'ı' => 'i',
        'ĳ' => 'ij', 'ĵ' => 'j', 'ķ' => 'k',
        'ĺ' => 'l', 'ļ' => 'l', 'ľ' => 'l', 'ŀ' => 'l', 'ł' => 'l',
        'ń' => 'n', 'ņ' => 'n', 'ň' => 'n', 'ŉ' => 'n', 'ŋ' => 'n',
        'ō' => 'o', 'ŏ' => 'o', 'ő' => 'o', 'œ' => 'oe',
        'ŕ' => 'r', 'ŗ' => 'r', 'ř' => 'r',
        'ś' => 's', 'ŝ' => 's', 'ş' => 's', 'š' => 's', 'ſ' => 's',
        'ţ' => 't', 'ť' => 't', 'ŧ' => 't',
        'ū' => 'u', 'ŭ' => 'u', 'ů' => 'u', 'ű' => 'u', 'ų' => 'u',
        'ŵ' => 'w', 'ŷ' => 'y',
        'ź' => 'z', 'ż' => 'z', 'ž' => 'z',
        // ── İ (1) — PHP's full case mapping lowercases U+0130 to i+U+0307;
        //    this maps the pair back to a plain i. The SQL side never
        //    produces the sequence (simple case mapping), so the REPLACE for
        //    it is a harmless no-op there. ──
        "i\u{0307}" => 'i',
    ];

    public static function fold(string $value): string
    {
        $lowered = mb_strtolower($value, 'UTF-8');
        $mapped = strtr($lowered, self::MAP);
        $spaced = (string) preg_replace('/[^a-z0-9]+/u', ' ', $mapped);

        return trim($spaced);
    }

    /** True when $needle, folded, appears anywhere in $haystack, folded. */
    public static function matches(string $haystack, string $needle): bool
    {
        return str_contains(self::fold($haystack), self::fold($needle));
    }
}
