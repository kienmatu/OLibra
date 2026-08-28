<?php

namespace App\Support\Catalogue;

use App\Support\Fold;

/**
 * books.slug derivation — old_next/src/domain/catalogue/policy.ts's
 * slugifyTitle and nextAvailableSlug, over App\Support\Fold so the slug
 * and the search index share one normalisation (BR §12: two copies of a
 * normalisation drift, and drift between the slug and the search index is
 * exactly the failure DATABASE.md §5 is written about).
 */
final class Slugs
{
    /**
     * Fold with hyphens instead of spaces. A punctuation-only title folds
     * to nothing, which is not a routable URL segment — it falls back to
     * 'sach' and nextAvailable() disambiguates from there.
     */
    public static function fromTitle(string $title): string
    {
        $slug = str_replace(' ', '-', Fold::fold($title));

        return $slug === '' ? 'sach' : $slug;
    }

    /**
     * CRITICAL 1 (fix-report, 2026-08-08-b1-catalogue): a second, different
     * edition of a title this shelf already holds collides on the identical
     * slug under books_bookshelf_id_slug_key. Disambiguate — base, base-2,
     * base-3, … — rather than reject: a volunteer holding a second edition
     * should not have to invent a different title to get past a uniqueness
     * rule they cannot see. Pure: the caller supplies the live slugs.
     *
     * @param  list<string>  $existing
     */
    public static function nextAvailable(string $base, array $existing): string
    {
        if (! in_array($base, $existing, true)) {
            return $base;
        }

        $n = 2;
        while (in_array("{$base}-{$n}", $existing, true)) {
            $n++;
        }

        return "{$base}-{$n}";
    }
}
