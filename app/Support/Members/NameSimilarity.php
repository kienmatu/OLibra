<?php

declare(strict_types=1);

namespace App\Support\Members;

use App\Support\Fold;

/**
 * pg_trgm's similarity(), reimplemented over folded names — divergence 3:
 * MariaDB has no trigram extension, and the reference computed
 * similarity(olibra_fold(a), olibra_fold(b)) in SQL
 * (old_next/src/domain/members/queries/get-pending-registrations.ts:69-74).
 * Same measure, same padding, so the 0.6 threshold (that file's own
 * comment, and the `.where('am.status = ...' ... >= 0.6)` predicate a few
 * lines below it) keeps its calibration: each word is padded with two
 * leading spaces and one trailing space, split into 3-grams, deduplicated
 * across the whole string; similarity is
 * |intersection| / |union|. Pinned against pg_trgm's own measured value in
 * the unit test — the reference's comment says 0.714 (not 0.714286; that
 * six-decimal figure appears nowhere in old_next and was a plan error
 * corrected during review; 10/14 = 0.7142857..., which the reference's
 * printed "0.714" is a rounding of).
 *
 * Fold::fold first, so "Trần Minh" and "Tran Minh" are identical before
 * any trigram exists — BR §16.3's duplicate catch is precisely about a
 * volunteer typing without diacritics. This is why the input here is the
 * raw `full_name`, not the `full_name_ci` column (Task 6): `full_name_ci`
 * is a deterministic, ACCENT-SENSITIVE column purpose-built for
 * Registration's exact identity match — using it here would silently
 * undo the whole point of folding, since "Trần Minh" and "Tran Minh"
 * produce two different `full_name_ci` values by design. `full_name_folded`
 * (Task 3) is the right accent-insensitive idea but is a stored, indexed
 * DB column; this class re-derives the same fold in pure PHP via
 * `Fold::fold()` so it can score any two strings — including two names
 * that never touch the database in the same query — without depending on
 * that column being present or fresh on the model at hand.
 *
 * A warning to a human, never an action: nothing merges, rejects or links
 * on this score's strength.
 */
final class NameSimilarity
{
    public const float THRESHOLD = 0.6;

    public static function similarity(string $a, string $b): float
    {
        $ta = self::trigrams($a);
        $tb = self::trigrams($b);

        if ($ta === [] || $tb === []) {
            return 0.0;
        }

        $shared = count(array_intersect_key($ta, $tb));
        $union = count($ta + $tb);

        return $shared / $union;
    }

    /** @return array<string, true> */
    private static function trigrams(string $name): array
    {
        $out = [];

        // Fold::fold yields lowercase ASCII [a-z0-9 ] — single-byte, so
        // substr() below counts characters correctly.
        foreach (explode(' ', Fold::fold($name)) as $word) {
            if ($word === '') {
                continue;
            }

            $padded = '  '.$word.' ';
            $len = strlen($padded);
            for ($i = 0; $i + 3 <= $len; $i++) {
                $out[substr($padded, $i, 3)] = true;
            }
        }

        return $out;
    }
}
