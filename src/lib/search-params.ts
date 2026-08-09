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
 * `?trang=` as a page number, or 1.
 *
 * A query parameter is a string somebody can type, so every way of getting it
 * wrong ends at page 1 rather than at an error: `?trang=abc` is `NaN`,
 * `?trang=0` and `?trang=-3` are not pages, and `?trang=99999999999999999999`
 * is not a safe integer and would otherwise be handed to Postgres as an
 * `offset` in exponential notation. The paged queries clamp the low end too
 * (`Math.max(1, …)`), but `Math.max(1, NaN)` is `NaN`, so the guard has to be
 * on this side of the call.
 *
 * **Moved here from `danh-muc/page.tsx` rather than copied to a second page**
 * (U3 wave 1, which wires the second paged screen). It is the same class of
 * defect `param` above exists for, one type further along, and two private
 * copies of a parse is how one of them later stops clamping.
 *
 * ── An open defect this function cannot fix, recorded where it starts ────────
 *
 * **A page number past the end strands the reader, on every paged screen in
 * this application.** `?trang=99` over 30 rows at pageSize 10 is a well-formed
 * page number, so it arrives here unchanged and reaches the query, which
 * answers `{ rows: [], total: 0, pageCount: 1, page: 99 }` — `total` is read
 * off `rows[0]` and there is no row zero, so the window function that would
 * have said 30 never ran. The screen then renders its *empty state* ("Chưa có
 * việc nào được ghi lại", "Chưa có bạn đọc nào"), which is a false statement
 * about a shelf that has thirty, and it hides the pager, because every one of
 * them draws it behind `pageCount > 1`. There is no control left on the page to
 * get back with. Only editing the URL by hand recovers, and the person on a
 * parish phone who reached this by tapping a stale bookmark cannot.
 *
 * **It is repo-wide, not one screen's**, which is why it is written here and
 * not fixed in whichever query a reviewer happened to be reading. Four queries
 * carry the identical shape — `get-audit-log.ts:215,232`,
 * `get-readers-list.ts:142,161`, `get-catalogue.ts:216,236`,
 * `get-books-list.ts:155,177` — and half-fixing one would leave three screens
 * behaving differently from the fourth over the same URL, which is worse than
 * the defect.
 *
 * The fix belongs in one place and is a decision, not a patch: either every
 * paged query counts before it selects (a second statement, so an out-of-range
 * page can be clamped to the real `pageCount` and the row re-read), or every
 * paged *page* treats `rows.length === 0 && page > 1` as "past the end" and
 * renders a way back rather than an empty state. The second is cheaper and
 * needs no extra query. Neither is P1's, and P1 shipped the fourth instance of
 * the pattern rather than the first — U3 found the same class of thing in a
 * query its plan had only warned new queries about.
 */
export function pageNumber(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? "", 10);
  return Number.isSafeInteger(n) && n > 0 ? n : 1;
}

/**
 * Whether a string is shaped like a `uuid`.
 *
 * **A parse, never a permission**, and the reason it exists at all is that this
 * project's ids are `uuid` columns: a hand-edited or stale value that is not one
 * reaches Postgres as a failed cast and comes back a raw `22P02` from inside the
 * transaction — the unstructured exception OPS §2 forbids, rendered to a
 * volunteer as a 500. Which rows a *well-formed* id may name is still RLS's
 * answer and `requireManager`'s.
 *
 * **One copy, moved here from `src/lib/lending.ts`** (U3 wave 2, which needed
 * the same check on a route segment rather than on a query parameter). Two
 * private copies of a shape test is how one of them later stops matching — the
 * same reason `pageNumber` above moved out of `danh-muc/page.tsx`.
 *
 * The two callers answer differently and deliberately so. `readerFromParam`
 * returns `null`, because `?nguoi-doc=` is a *volunteer's* parameter and the
 * page around it still exists; `quan-ly/nguoi-doc/[id]` calls `notFound()`,
 * because the segment is the router's and a URL naming no reader is a mistyped
 * address. `scripts/check-links.mjs` states the same distinction in its own
 * words.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A type predicate rather than a plain `boolean`, so a caller that has narrowed
// an `string | undefined` parameter does not then need a non-null assertion to
// pass it on — which is the shape that quietly stops being checked.
export function isUuid(value: string | undefined): value is string {
  return value !== undefined && UUID.test(value);
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
