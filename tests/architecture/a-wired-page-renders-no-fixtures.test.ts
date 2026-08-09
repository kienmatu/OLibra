import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { filesUnder } from "../support/source-text";

/**
 * U2 §3.4, as a rule rather than as a fix. **A page that reads the database
 * renders nothing from `src/lib/fixtures.ts`.**
 *
 * The defect this generalises shipped and looked fine: `ShelfHeader` imported
 * a fixture `Shelf` and defaulted its reader to `"Giuse Trần Minh"`, so every
 * shelf page in the app was going to render real books, from a real parish,
 * under one invented child's name — and read as working while doing it. A
 * fixture is content nobody wrote for the parish looking at it. Mixed into a
 * page whose other half is real, it is indistinguishable from data, which is
 * exactly what makes it worse than an obviously unfinished screen.
 *
 * Forty-one pages are still to be wired, and every one of them starts as a
 * fixture page and is converted a section at a time. That conversion is where
 * a leftover `announcements.find(...)` or `books.slice(0, 6)` survives next to
 * a real `getCatalogue`, because both compile and both render. This is the
 * check that fails at the moment it is typed.
 *
 * **Direct imports only, deliberately.** `src/components/ui/book.tsx` calls
 * `coverForTitle` from the fixtures for its cover art, so every page that shows
 * a book cover reaches the module transitively and a transitive rule would flag
 * all of them. That is a real (small) piece of fixture content in a wired page
 * and the honest fix is to move the artwork map out of `fixtures.ts` — a
 * component change this slice is not making, recorded here rather than hidden
 * by weakening the rule to nothing. What the direct-import form catches is the
 * shape a person actually types while converting a page: reaching into the
 * fixtures from the route file itself.
 *
 * Same reading strategy as the sibling tests in this directory — source text,
 * with comments removed and string literals *kept*, since the thing being
 * looked for is a module specifier and the docstrings above and below discuss
 * `src/lib/fixtures.ts` in prose.
 */

/** The specifiers that mean "this file reads the database", as the dynamic-rendering guard defines them. */
const DATABASE_REACHING_IMPORTS = [
  "lib/page-data",
  "db/client",
  "domain/kernel/unit-of-work",
];

/**
 * Comments out, strings in.
 *
 * Copied in shape from `pages-reading-the-database-are-dynamic.test.ts`, which
 * needs the identical treatment for the identical reason, and not extracted to
 * `tests/support/` alongside `stripCommentsAndStrings`: that helper does the
 * *opposite* (strings out), the two would sit next to each other with names one
 * word apart, and a caller reaching for the wrong one gets a check that quietly
 * passes everything. Two callers is not yet enough to justify that hazard.
 *
 * The `[^:]` guard keeps a `//` inside a URL from reading as a line comment.
 * Not a parser: a `/*` inside a string literal would eat code as though it were
 * a comment, which happens nowhere here and is a false negative rather than a
 * crash.
 */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Every module specifier a file names, in all four spellings. */
function specifiersIn(source: string): string[] {
  return [
    ...withoutComments(source).matchAll(
      /\b(?:from|import|require)\s*\(?\s*["']([^"']+)["']/g,
    ),
  ].map((m) => m[1]);
}

function routeFiles(): string[] {
  return filesUnder("src/app").filter((f) =>
    /\/(page|layout)\.tsx?$/.test(f.replace(/\\/g, "/")),
  );
}

function namesOneOf(specifier: string, fragments: string[]): boolean {
  const path = specifier.replace(/\\/g, "/");
  return fragments.some((fragment) => path.includes(fragment));
}

/** `{ path, readsTheDatabase, importsFixtures }` for every route file. */
function routes() {
  return routeFiles().map((file) => {
    const specifiers = specifiersIn(readFileSync(file, "utf8"));
    return {
      path: file.replace(process.cwd() + "/", "").replace(/\\/g, "/"),
      readsTheDatabase: specifiers.some((s) =>
        namesOneOf(s, DATABASE_REACHING_IMPORTS),
      ),
      importsFixtures: specifiers.some((s) => namesOneOf(s, ["lib/fixtures"])),
    };
  });
}

test("the check can see both halves of what it compares", () => {
  // This file's own guard. The assertion below is `toEqual([])`, which is
  // satisfied perfectly by a `routes()` that found no wired pages at all —
  // and "found nothing" is the failure mode the dynamic-rendering test in this
  // directory actually shipped with. So: the pages U2 wired must be *seen* as
  // database-backed, and at least one page must still be *seen* as a fixture
  // page, or there is nothing being compared.
  const all = routes();
  const base = "src/app/tu-sach/[shelf]";

  for (const page of [
    `${base}/page.tsx`,
    `${base}/danh-muc/page.tsx`,
    `${base}/tim-kiem/page.tsx`,
    `${base}/sach/[slug]/page.tsx`,
  ]) {
    expect(all.find((r) => r.path === page)?.readsTheDatabase, page).toBe(true);
  }

  // The other half: the reader pages this slice did not wire still render from
  // `src/lib/fixtures.ts`, and are correctly seen doing it. When a later slice
  // wires them this list shrinks; it is a floor for the detector, not a claim
  // that these pages should stay as they are.
  expect(all.filter((r) => r.importsFixtures).map((r) => r.path)).toContain(
    `${base}/toi/page.tsx`,
  );
});

test("no page that reads the database also renders fixtures", () => {
  const offenders = routes()
    .filter((r) => r.readsTheDatabase && r.importsFixtures)
    .map((r) => r.path);

  expect(offenders).toEqual([]);
});
