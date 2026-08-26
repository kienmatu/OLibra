<?php

namespace App\Support;

/**
 * Renders Fold::fold() as a MariaDB generated-column expression.
 *
 * Spec §4.2 option 1: no unaccent(), no stored functions in generated
 * columns, so folding becomes LOWER → one REPLACE per Fold::MAP entry →
 * REGEXP_REPLACE → TRIM, roughly 4 KB of SQL emitted from the same table
 * the PHP fold reads. tests/Feature/FoldParityTest.php asserts the two
 * renderings agree property-wise — every map entry, upper and lower case,
 * plus a U+00C0–U+024F sweep — so a wrong target in ONE entry ('ệ' => 'a')
 * is caught by construction, not by hoping a corpus title contains ệ.
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

        foreach (Fold::MAP as $from => $to) {
            $inner = "REPLACE({$inner}, '{$from}', '{$to}')";
        }

        return "TRIM(REGEXP_REPLACE({$inner}, '[^a-z0-9]+', ' '))";
    }
}
