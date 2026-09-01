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
 *
 * **The body-aware sibling, `input()`.** The identical shape hazard exists
 * for a POST body field, not just a query-string one, and it is not
 * hypothetical: `RateLimiter::for('register', ...)` in
 * `AppServiceProvider::boot()` read `$request->string('phone')` — Laravel's
 * `Stringable` cast — on the raw merged input bag, before
 * `RegisterMembershipRequest`'s Form Request validation ever runs (the
 * named limiter is route middleware; middleware runs before the
 * controller method's Form Request is resolved). `phone[]=...`,
 * `phone[a][b]=...` and a bare `phone[]` all decode to an array there the
 * identical way a repeated query key does, and casting an array with
 * `(string)` — which is what `Stringable`'s constructor does — throws
 * `ErrorException: Array to string conversion`, promoted from a PHP
 * warning by Laravel's own error handler: a guest 500, over the
 * application's only unauthenticated write route, before any validation
 * gets a chance to refuse the shape cleanly. `input()` reuses the exact
 * same `flatten()` this class already carries for the query-string case,
 * reading from `$request->input()` (query string + parsed body, the same
 * bag `Request::string()`/`Request::get()` read from) instead of
 * `$request->query()`, so a body field gets the identical
 * first-value-of-an-array treatment as a query-string one, and the two
 * cannot drift on what "first value" means. A second, near-duplicate
 * class was considered and rejected: this IS a query-param problem in the
 * general sense (an HTTP field arriving as either a scalar or an array,
 * decoded from `x-www-form-urlencoded` or a query string by the identical
 * PHP mechanism), and every caller needing "read arbitrary input as a
 * string, pre-validation" is served by one flattening rule, not two that
 * some future edit could quietly diverge.
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

    /**
     * The same flattening as first(), read from the merged input bag
     * ($request->input(): the query string AND the parsed request body —
     * form-encoded, multipart or JSON) instead of the query string alone.
     * For code that must read a field as a plain string before a Form
     * Request's own validation runs (a rate limiter keyed on a request
     * field is the motivating case — see the class docblock), so it never
     * hands an array to a string-only API the way `Request::string()` or
     * a raw `(string)` cast would.
     */
    public static function input(Request $request, string $key, ?string $default = null): ?string
    {
        return self::flatten($request->input($key)) ?? $default;
    }

    /**
     * The value at $key as a real calendar day (`Y-m-d`), or null.
     *
     * Both audit browsers take `?from=`/`?to=` and both must refuse a date
     * that only LOOKS like one: `2026-02-31` matches the shape and is not a
     * day, and handing it to CarbonImmutable::parse() rolls it forward to
     * 3 March — a range silently different from the one the URL asked for.
     * checkdate() is what says so.
     *
     * It lives here rather than privately in a controller because phase
     * 3c-ii Task 5 gave this parse a second caller (`/admin/audit` beside
     * `/shelves/{shelf}/manage/audit`), and two copies of a rule this
     * specific are two places for it to drift. Same flattening as first(),
     * so a repeated key is treated identically.
     */
    public static function civilDay(Request $request, string $key): ?string
    {
        $raw = self::first($request, $key);

        if ($raw === null || preg_match('/^\d{4}-\d{2}-\d{2}$/', $raw) !== 1) {
            return null;
        }

        [$y, $m, $d] = array_map(intval(...), explode('-', $raw));

        return checkdate($m, $d, $y) ? $raw : null;
    }

    private static function flatten(mixed $value): ?string
    {
        if (is_array($value)) {
            return self::flatten(array_values($value)[0] ?? null);
        }

        return $value === null ? null : (string) $value;
    }
}
