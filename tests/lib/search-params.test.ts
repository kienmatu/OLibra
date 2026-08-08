import { expect, test } from "vitest";
import { ERROR_MESSAGES, messageFor } from "../../src/domain/kernel/errors";
import {
  ACTION_ERROR_PARAM,
  param,
  refusalFrom,
  type SearchParams,
} from "../../src/lib/search-params";

/**
 * The query string is the whole state model of the six lending screens, and it
 * is entirely under the control of whoever is holding the address bar.
 *
 * Two shipped defects are pinned here, both of which turned a hand-edited URL
 * into an HTTP 500 — the "bare 500 or unstructured exception" OPS §2 forbids,
 * reached from the surface rather than from a command.
 */

/**
 * Every name an ordinary object inherits from `Object.prototype`, plus the
 * accessor `__proto__`.
 *
 * This is the exact list `loi in ERROR_MESSAGES` answered `true` for. `in`
 * walks the prototype chain, `messageFor` then returned the inherited
 * *function*, and React throws rather than render one — so each of these was a
 * 500 on `xac-nhan`, `nhan-tra` and `nhan-tra/bao-mat` alike. Written out
 * rather than computed from `Object.getOwnPropertyNames(Object.prototype)` so
 * that the failing input is readable in the diff, and so the test still says
 * what it is about on a runtime with a different prototype.
 */
const INHERITED = [
  "constructor",
  "toString",
  "toLocaleString",
  "valueOf",
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "__proto__",
];

test("a prototype key in ?loi= shows no banner rather than crashing the page", () => {
  for (const key of INHERITED) {
    const search: SearchParams = { [ACTION_ERROR_PARAM]: key };
    // The assertion that catches the defect is `toBeNull()`. The one that says
    // *why* it mattered is below it: what `in` let through was not a string
    // the page failed to translate, it was a value React refuses to render.
    expect(refusalFrom(search), key).toBeNull();
    expect(typeof (ERROR_MESSAGES as Record<string, unknown>)[key]).not.toBe(
      "string",
    );
  }
});

test("an arbitrary string in ?loi= shows no banner either", () => {
  // The honest outcome the shipped docstring already claimed, and which was
  // always true for this half: nothing refused this lend, so no alert box.
  for (const value of ["", "khong-co-ma-nay", "<script>alert(1)</script>", "0"]) {
    expect(refusalFrom({ [ACTION_ERROR_PARAM]: value }), value).toBeNull();
  }
  expect(refusalFrom({})).toBeNull();
});

test("a real code in ?loi= is returned, and renders as its own sentence", () => {
  // The other direction, so a `refusalFrom` that simply returned null forever
  // would fail: every code a command can hand back must survive the round trip.
  for (const code of Object.keys(
    ERROR_MESSAGES,
  ) as (keyof typeof ERROR_MESSAGES)[]) {
    expect(refusalFrom({ [ACTION_ERROR_PARAM]: code }), code).toBe(code);
    expect(typeof messageFor(code)).toBe("string");
  }
});

test("a repeated ?loi= is read, not concatenated into a code that does not exist", () => {
  expect(refusalFrom({ [ACTION_ERROR_PARAM]: ["loan_limit_reached", "x"] })).toBe(
    "loan_limit_reached",
  );
  expect(
    refusalFrom({ [ACTION_ERROR_PARAM]: ["khong-co", "loan_limit_reached"] }),
  ).toBeNull();
});

test("a repeated parameter is one string, not an array the query then calls .trim on", () => {
  // The second shipped 500: `?q=de&q=men` reaches `searchBooksForLending` as
  // `["de","men"]` and `input.q.trim()` is a `TypeError` from inside the
  // transaction. Every parameter these six screens read is checked, because
  // the care that produced `readerFromParam`'s shape check was applied to
  // `?nguoi-doc=` and to none of the others.
  for (const name of ["q", "sach", "nguoi-doc", "muon", ACTION_ERROR_PARAM]) {
    const value = param({ [name]: ["de", "men"] }, name);
    expect(typeof value, name).toBe("string");
    expect(value, name).toBe("de");
  }
});

test("a single parameter, an absent one and an empty repetition each read plainly", () => {
  expect(param({ q: "de men" }, "q")).toBe("de men");
  expect(param({}, "q")).toBeUndefined();
  expect(param({ q: undefined }, "q")).toBeUndefined();
  // `?q=` with nothing after it is an empty search, not an absent one — the
  // pages treat both the same way, but only because they coalesce it
  // themselves rather than because this function lied about which arrived.
  expect(param({ q: "" }, "q")).toBe("");
  expect(param({ q: [] }, "q")).toBeUndefined();
});
