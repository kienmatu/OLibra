// Relative specifiers, not the `@/` alias, for the reason
// `src/lib/page-data.ts` records at the top of its own imports: the suite
// imports this module directly and Vitest resolves no alias.
import { type ErrorCode, ERROR_MESSAGES } from "../domain/kernel/errors";

/**
 * What the App Router actually hands a page, rather than what a page would
 * like to have been handed.
 *
 * **`string[]` is not a corner case, it is the wire format.** Next.js parses a
 * query string with repeated keys into an array — `?q=de&q=men` arrives as
 * `["de", "men"]` — and nothing stops anybody from typing that into the address
 * bar or a link from doing it by accident. Every lending screen shipped with
 * `searchParams: Promise<{ q?: string }>`, which is not a description of the
 * input; it is an assertion the compiler then propagates as fact, so
 * `q.trim()` type-checks and throws `TypeError: input.q.trim is not a function`
 * from inside a query at runtime. That is the unstructured exception OPS §2
 * forbids, arrived at through the type system rather than around it.
 *
 * So the type is declared honestly and nothing reads a search parameter by
 * destructuring it. `param` below is the only way in.
 */
export type SearchParams = Record<string, string | string[] | undefined>;

/**
 * One value for a query parameter, whatever shape it arrived in.
 *
 * **The first, when several arrive** — the same answer `URLSearchParams.get`
 * gives, which is what every other reader of a query string in this project
 * already uses (`scripts/check-links.mjs`, `tests/lib/lending-actions.test.ts`)
 * and what `FormData.get` gives `actions.ts` for a repeated form field. A
 * repeated parameter is not something any link in this app emits, so the only
 * property worth having is that the page still renders: a search runs on `de`
 * rather than the whole screen becoming a 500 because somebody pasted a URL
 * twice.
 *
 * Discarding it entirely was the alternative and it is worse in the one
 * direction that matters — a volunteer whose URL got mangled would see an empty
 * result list and conclude the shelf does not have the book, rather than seeing
 * the results for the first term they typed.
 *
 * This is a *parse*, never a permission. What a resolved value is allowed to
 * name is still RLS's answer and `requireManager`'s, both of which run inside
 * the queries every one of these strings is passed to — and `lending.ts`'s
 * `readerFromParam` still applies its own shape check on top, for the same
 * reason it always did (a well-formed-looking non-uuid reaching Postgres is a
 * raw `22P02`).
 */
export function param(search: SearchParams, name: string): string | undefined {
  const value = search[name];
  if (Array.isArray(value)) return value[0];
  return value;
}

/**
 * The query-string parameter a server action hands a refusal back through.
 *
 * A *code*, never a sentence: `loi=loan_limit_reached`, and the page looks the
 * Vietnamese up with `messageFor`. `errors.ts:11-16` is the rule — "a screen
 * calls `ERROR_MESSAGES[code]` rather than writing its own wording for a rule
 * it did not define" — and a URL carrying the sentence itself would be a
 * second copy of the wording, editable by whoever is holding the address bar.
 *
 * The same name `dang-nhap/actions.ts` already redirects with, so the two
 * failure paths in this app read alike. That one carries its own fixed marker
 * (`SIGN_IN_FAILED`) rather than an `ErrorCode`, deliberately: which of three
 * sign-in failures happened is exactly what it must not disclose.
 */
export const ACTION_ERROR_PARAM = "loi";

/**
 * A code that arrived in `?loi=`, if it is one this project has a sentence for.
 *
 * The parameter is in the address bar, so it is whatever somebody typed there.
 * `ERROR_MESSAGES` is a closed union and `messageFor` would return `undefined`
 * for a code outside it — which React renders as nothing, quietly turning a
 * hand-edited URL into a blank alert box. Checking membership first means an
 * unknown code shows no banner at all, which is the honest outcome: nothing
 * refused this lend.
 *
 * **`Object.hasOwn`, not `in`.** This shipped three times as
 * `loi in ERROR_MESSAGES`, and `in` walks the prototype chain: `constructor`,
 * `toString`, `valueOf`, `hasOwnProperty`, `isPrototypeOf`,
 * `propertyIsEnumerable`, `toLocaleString` and `__proto__` all answered true,
 * `messageFor` then returned a *function*, and React refuses to render one —
 * so `?loi=constructor` was a 500 on all three screens that read it, in
 * development and in production alike. An arbitrary string was always fine
 * (`?loi=<script>…` renders nothing, exactly as the paragraph above claims);
 * the eight names every object in JavaScript inherits were not.
 *
 * One copy, in one place, because three identical private copies of a
 * membership test is precisely how one of them drifts.
 */
export function refusalFrom(search: SearchParams): ErrorCode | null {
  const code = param(search, ACTION_ERROR_PARAM);
  if (code === undefined) return null;
  return Object.hasOwn(ERROR_MESSAGES, code) ? (code as ErrorCode) : null;
}
