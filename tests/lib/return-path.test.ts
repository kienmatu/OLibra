import { expect, test } from "vitest";
import {
  RETURN_TO_PARAM,
  safeReturnPath,
  shelfSlugFromReturnPath,
  signInPathFor,
} from "../../src/lib/return-path";

/**
 * U2 §3.1's return path, and the two ways it can go wrong.
 *
 * A pure function with no database and no request, so this file is the one
 * place in the slice where a table of hostile inputs is the right shape of
 * test. `tests/lib/page-data.test.ts` covers what the seam does with the
 * answer; this covers what the answer is.
 */

/** Values that must never come back as somewhere to send a person. */
const REFUSED: ReadonlyArray<readonly [string, unknown]> = [
  // The obvious open redirect. A sign-in form that honours this is a phishing
  // primitive wearing this project's domain.
  ["an absolute http URL", "http://evil.example/pay"],
  ["an absolute https URL", "https://evil.example/pay"],
  // Protocol-relative: an absolute URL to every browser, and a path to a
  // `startsWith("/")` check written by somebody who had not met one.
  ["a protocol-relative URL", "//evil.example/pay"],
  ["a protocol-relative URL with credentials", "//user@evil.example/"],
  // WHATWG treats a backslash as a path separator, so this is `//evil.example`
  // spelled differently. This is the case a hand-written denylist misses.
  ["a backslash-relative URL", "/\\evil.example/pay"],
  ["a backslash-relative URL, doubled", "\\\\evil.example/pay"],
  // Not a path at all — the second failure mode, and the one that surfaces as
  // an exception from inside a render rather than as somebody else's site.
  ["a javascript: URL", "javascript:alert(1)"],
  ["a data: URL", "data:text/html,<script>alert(1)</script>"],
  ["a bare word", "dang-nhap"],
  ["a relative traversal", "../../etc/passwd"],
  ["the empty string", ""],
  // A bare CR or LF in a `Location` header is response splitting; refused
  // before it can reach one, along with every other control character.
  ["a header-splitting newline", "/tu-sach\r\nSet-Cookie: a=b"],
  ["a NUL byte", "/tu-sach\u0000/x"],
  // Absent, or arrived as an array because somebody repeated the parameter.
  ["null", null],
  ["undefined", undefined],
  ["an array", ["/a", "/b"]],
  ["a number", 7],
  // Long enough to be a payload rather than a path.
  ["an over-long path", `/${"a".repeat(600)}`],
];

for (const [what, value] of REFUSED) {
  test(`${what} is refused`, () => {
    expect(safeReturnPath(value as string)).toBeNull();
  });
}

test("an ordinary in-app path survives, search string and all", () => {
  // The case the whole thing exists for: a volunteer who typed a search and
  // was asked to sign in gets their results back, not an empty form.
  expect(safeReturnPath("/tu-sach/dong-thap/danh-muc")).toBe(
    "/tu-sach/dong-thap/danh-muc",
  );
  expect(safeReturnPath("/tu-sach/dong-thap/tim-kiem?q=de%20men")).toBe(
    "/tu-sach/dong-thap/tim-kiem?q=de%20men",
  );
  expect(safeReturnPath("/")).toBe("/");
});

test("what comes back is the parser's normalised path, not the caller's string", () => {
  // The value is validated and then used, so the two must be the same string.
  // Returning the input while validating a parse of it is how a check and its
  // subject drift: `..` segments resolve, and a path that resolved somewhere
  // else than it was read as would be validated as one thing and followed as
  // another.
  expect(safeReturnPath("/tu-sach/dong-thap/../can-tho")).toBe("/tu-sach/can-tho");
  // A fragment is never sent to a server, so one here was typed by hand and
  // has nothing to say about which page to render.
  expect(safeReturnPath("/tu-sach#gac-mai")).toBe("/tu-sach");
});

test("signInPathFor carries an accepted path and silently drops a refused one", () => {
  // Refusing is not an error a visitor should see: they are being sent to sign
  // in either way, and `landingShelfFor` still takes a member of one parish to
  // that parish. The only thing lost is the memory of where they were going —
  // which, for the value that got refused, is the point.
  expect(signInPathFor("/tu-sach/dong-thap/danh-muc")).toBe(
    `/dang-nhap?${RETURN_TO_PARAM}=%2Ftu-sach%2Fdong-thap%2Fdanh-muc`,
  );
  expect(signInPathFor("https://evil.example")).toBe("/dang-nhap");
  expect(signInPathFor(null)).toBe("/dang-nhap");
});

test("the path is encoded, so its own query string cannot become the sign-in URL's", () => {
  // `?tiep=/tim-kiem?q=de&loi=x` unencoded would hand `/dang-nhap` an extra
  // `loi` parameter it never asked for — and the page reads `loi` to decide
  // whether to show a failed-sign-in message. Encoding is what keeps the two
  // query strings from merging.
  const url = signInPathFor("/tu-sach/dong-thap/tim-kiem?q=de&loi=sai");

  expect(url).toBe(
    `/dang-nhap?${RETURN_TO_PARAM}=%2Ftu-sach%2Fdong-thap%2Ftim-kiem%3Fq%3Dde%26loi%3Dsai`,
  );
  const parsed = new URL(url, "http://olibra.invalid");
  expect([...parsed.searchParams.keys()]).toEqual([RETURN_TO_PARAM]);
  expect(parsed.searchParams.get(RETURN_TO_PARAM)).toBe(
    "/tu-sach/dong-thap/tim-kiem?q=de&loi=sai",
  );
});

test("shelfSlugFromReturnPath names the parish a redirect came off", () => {
  // IMPORTANT 3. `curl -L /tu-sach/vinh-long/danh-muc` follows U2's redirect
  // and lands on the sign-in form; before this the form said "Tủ sách Đồng
  // Tháp", because it read a fixture. Every shelf route is `/tu-sach/<slug>/…`,
  // so the return path the redirect already carries knows the answer — this is
  // the half of it that does not need a portal link's `?tu-sach=`.
  expect(shelfSlugFromReturnPath("/tu-sach/vinh-long/danh-muc")).toBe("vinh-long");
  expect(shelfSlugFromReturnPath("/tu-sach/ben-tre/sach/gac-mai")).toBe("ben-tre");
  expect(shelfSlugFromReturnPath("/tu-sach/can-tho")).toBe("can-tho");
  expect(shelfSlugFromReturnPath("/tu-sach/can-tho/tim-kiem?q=de")).toBe("can-tho");
});

test("shelfSlugFromReturnPath is null wherever there is no parish to name", () => {
  // `/tu-sach` is the portal, which is about every shelf and therefore none —
  // a visitor who reached the sign-in form from there picked no parish yet,
  // and the honest header is the front door's.
  expect(shelfSlugFromReturnPath("/tu-sach")).toBeNull();
  expect(shelfSlugFromReturnPath("/tu-sach/")).toBeNull();
  expect(shelfSlugFromReturnPath("/")).toBeNull();
  expect(shelfSlugFromReturnPath("/lien-he")).toBeNull();
  expect(shelfSlugFromReturnPath("/quan-tri/tu-sach")).toBeNull();
  expect(shelfSlugFromReturnPath(null)).toBeNull();
  expect(shelfSlugFromReturnPath(undefined)).toBeNull();

  // Anything that is not slug-shaped is refused rather than passed to a
  // lookup. `bookshelves.slug` is derived by `fold()` and fixed after creation
  // (BR:179), so it is lower-case alphanumerics and hyphens; a value carrying
  // anything else was not produced by this system.
  expect(shelfSlugFromReturnPath("/tu-sach/Đồng Tháp/danh-muc")).toBeNull();
  expect(shelfSlugFromReturnPath("/tu-sach/dong_thap")).toBeNull();
  expect(shelfSlugFromReturnPath("/TU-SACH/dong-thap")).toBeNull();

  // Not a prefix match on the segment: a route that merely *starts* with the
  // same letters is a different route.
  expect(shelfSlugFromReturnPath("/tu-sachs/dong-thap")).toBeNull();
});

test("every path safeReturnPath accepts is safe to ask for a slug", () => {
  // The two functions meet on the sign-in page — the slug is derived from the
  // *validated* path — so the interesting property is that the composition has
  // no gap: nothing safeReturnPath refuses can produce a slug, since the page
  // never asks about a refused value, and nothing it accepts produces one that
  // is not slug-shaped.
  for (const hostile of [
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "/tu-sach/../../evil.example",
  ]) {
    const safe = safeReturnPath(hostile);
    const slug = shelfSlugFromReturnPath(safe);
    expect(slug === null || /^[a-z0-9-]+$/.test(slug), hostile).toBe(true);
  }
});
