<?php

namespace App\Support;

/**
 * Renders Fold::fold() as a MariaDB generated-column expression.
 *
 * Spec §4.2 option 1: no unaccent(), no stored functions in generated
 * columns, so folding becomes LOWER → one REPLACE per Fold::MAP entry →
 * REGEXP_REPLACE → TRIM (2986 bytes for `title` alone at 144 entries).
 * tests/Feature/FoldParityTest.php asserts the two renderings are the SAME
 * FUNCTION of Fold::MAP — every map entry, upper and lower case, a
 * U+00C0–U+024F sweep, plus the corpus. That property does not, by itself,
 * prove Fold::MAP's targets are correct (a typo could satisfy both sides
 * identically); tests/Unit/FoldTest.php closes that gap with an
 * independent NFD-derived oracle.
 */
final class FoldExpression
{
    /**
     * @param  string  $expression  a SQL expression: a backtick-quoted
     *                              column, a COALESCE(...), or a bare ?
     *                              placeholder.
     */
    public static function sql(string $expression): string
    {
        $inner = "LOWER({$expression})";

        foreach (self::orderedMap() as $from => $to) {
            $inner = "REPLACE({$inner}, '{$from}', '{$to}')";
        }

        return "TRIM(REGEXP_REPLACE({$inner}, '[^a-z0-9]+', ' '))";
    }

    /**
     * Fold::fold() uses strtr(), a single simultaneous left-to-right pass
     * that never re-scans output it just produced. A sequential REPLACE
     * chain can — and, unordered, does: Fold::MAP has one multi-code-point
     * key, "i" + U+0307, and twelve single-character entries (ì í ỉ ĩ ị î
     * ï ī ĭ į ı) whose target is plain ASCII "i". If any of those twelve
     * REPLACE calls runs before the "i"+U+0307 one, a combining dot above
     * that happened to already follow one of those letters in the input
     * gets swept into a replacement strtr() would never make — folding
     * "xị̇x" (ị + U+0307) to "xix" here but "xi x" in PHP, breaking BR
     * §12's store==search invariant. tests/Feature/FoldParityTest.php
     * pins this as a regression.
     *
     * Rendering every multi-code-point key innermost — evaluated before
     * any single-character entry has had a chance to synthesise that
     * sequence — removes the possibility instead of special-casing it.
     * Relative order within a length group doesn't matter: no MAP target
     * is itself a MAP key once the multi-code-point entries go first, so
     * no single-character REPLACE can feed another single-character one.
     *
     * @return array<string, string>
     */
    private static function orderedMap(): array
    {
        $entries = Fold::MAP;

        uksort(
            $entries,
            static fn (string $a, string $b): int => mb_strlen($b, 'UTF-8') <=> mb_strlen($a, 'UTF-8'),
        );

        return $entries;
    }
}
