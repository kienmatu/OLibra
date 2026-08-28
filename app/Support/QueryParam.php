<?php

namespace App\Support;

use Illuminate\Http\Request;

/**
 * One query-string value, whatever shape it arrived in.
 *
 * A query string is not typed. `?category[]=a&category[]=b` decodes to
 * `['a', 'b']`, and nothing about the browser, a bookmarklet, or a pasted
 * or hand-mangled link stops that from reaching any GET route in this app.
 * A controller that reads `$request->query('category')` and hands the
 * result straight to a query expecting `?string` gets a raw, unstructured
 * failure instead: `CatalogueController` threw
 * `TypeError: CatalogueQuery::run(): Argument #2 ($slug) must be of type
 * string, array given`, and `SearchController` threw `ErrorException:
 * Array to string conversion` from `trim((string) $request->query('q'))` —
 * both from a repeated key, not from anything resembling an attack.
 * `Manage\BookController` read `q` and `category` the identical way and
 * carried the identical hole. `scope`, `sort` and `page` happened to
 * survive: `===` against a string is simply false for an array, and `(int)`
 * on an array degrades to a PHP warning rather than a thrown exception —
 * that is luck, not a guard, so this helper is the single door every one
 * of them now reads through.
 *
 * **The first value, when several arrive** — the same answer
 * `URLSearchParams.get` gives, and the choice `old_next/src/lib/search-
 * params.ts`'s `param()` already made and documented for this exact
 * failure (its own comment: four pages there shipped a 500 over exactly
 * this shape). Discarding the parameter instead was the alternative
 * considered and rejected there, for a reason that still applies here
 * unchanged: a volunteer whose URL got mangled into a repeated key should
 * see results for the first term they typed, not an empty list that reads
 * as "this shelf doesn't have the book."
 *
 * A nested array (`?category[x][]=a`) is walked the same way, one level
 * at a time, until a scalar or an empty array is reached — an empty array
 * at any level resolves to `null`, the same as the key being absent
 * outright. A non-string scalar (an int or bool arriving via a default,
 * never via the query string itself, which only ever decodes to strings
 * or arrays of strings) is cast to `string` rather than rejected.
 *
 * **This is a parse, never a permission.** Whatever string this resolves
 * to is still exactly as subject to `Gate::authorize`, `BookshelfScope`,
 * and every query's own validation as a value that arrived un-repeated —
 * this helper only decides which string a controller sees, never whether
 * it may act on it.
 */
final class QueryParam
{
    /**
     * The query-string value at $key, taking the first element of an
     * array (recursively) and falling back to $default when the resolved
     * value is null — which covers both an absent key and an array that
     * bottoms out empty. An empty string is a real, distinct value and is
     * never replaced by $default.
     */
    public static function first(Request $request, string $key, ?string $default = null): ?string
    {
        return self::flatten($request->query($key)) ?? $default;
    }

    private static function flatten(mixed $value): ?string
    {
        if (is_array($value)) {
            return self::flatten(array_values($value)[0] ?? null);
        }

        return $value === null ? null : (string) $value;
    }
}
