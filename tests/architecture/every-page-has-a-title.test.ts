import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { filesUnder } from "../support/source-text";

/**
 * QA remediation Task 25. Audited 2026-08-10: 38 of the 47 `page.tsx` files
 * shipped with no `metadata` and no `generateMetadata`, so every browser tab —
 * every manager screen, every admin screen, and the one page a search engine
 * actually indexes, `/tu-sach/[shelf]/sach/[slug]` — read the root layout's
 * fallback, "OLibra — Tủ sách cộng đồng". A volunteer with six tabs open, one
 * per shelf task, could not tell them apart by their titles; a search result
 * for a specific book showed the same six words as the home page.
 *
 * **The count above is stale on purpose and is not asserted here.** This
 * branch has moved five pages from `/toi` to `/ho-so` and added three more
 * (`/quan-tri/the-loai`, `/quan-ly/co-cau`, `/quan-ly/sach/[id]/sua`) since
 * that audit, and the next branch will move the count again. A test that
 * pinned "38" would go stale the moment a route was added and would not even
 * be wrong in the direction that matters — it would pass while a fresh page
 * shipped with no title, which is the exact defect this file exists to catch.
 * The floor is "zero missing", not a specific number.
 *
 * **Why `page.tsx` alone, not `layout.tsx` too.** A layout's metadata is
 * inherited by every page under it unless a page overrides it — that is the
 * mechanism, not a gap in it. Requiring a *layout* to declare a title as well
 * would ask for a fact no route needs twice. The one layout in this
 * application (`src/app/layout.tsx`) already sets the fallback every one of
 * these pages used to render by doing nothing.
 *
 * **Source text, not a Next.js build.** The same limits every other
 * architecture test in this directory accepts: this looks for the shape
 * `export const metadata` or `export function generateMetadata` /
 * `export async function generateMetadata` in the file's own text, with
 * comments stripped first (`withoutComments`) so a docstring that *mentions*
 * "generateMetadata" — this one does, several times — cannot be mistaken for
 * a page that ships it. It does not check that the title is non-empty, in
 * Vietnamese, or reachable from a `<head>` a browser actually renders;
 * `next build`'s own metadata resolution is the tool for that, and "the
 * export exists" is the property a route-file sweep can check cheaply and
 * honestly.
 *
 * **`withoutComments`, copied from `pages-reading-the-database-are-
 * dynamic.test.ts`, not `stripCommentsAndStrings` from `../support/source-
 * text.ts`.** The shared helper strips quoted strings *before* line comments,
 * and this codebase's own docstrings are prose full of English contractions
 * inside `//` lines ("shelf's", "editor's", "form's" …) — an apostrophe in one
 * such comment pairs with the next single quote the string-stripping regex
 * finds, anywhere later in the file, and deletes every real line in between as
 * if it were part of one giant string literal. Measured on this branch:
 * `stripCommentsAndStrings` applied to `src/app/quan-tri/tu-sach/page.tsx` —
 * which has shipped `export const metadata` since U3 — silently ate that line
 * along with roughly 170 lines around it, because a `//`-comment at line 108
 * contains "shelf's" and the next unescaped `'` the regex meets is deep inside
 * a later JSX comment. Confirmed by walking the five replacements one at a
 * time: `metadata` survives block-comment, double-quote and — critically —
 * *no* single-quote step if line comments are removed first, and disappears
 * exactly at the single-quote step otherwise. `withoutComments` strips block
 * comments and then line comments directly, with no string-literal pass in
 * between, so no apostrophe in a comment ever gets read as a string delimiter.
 * It is not exported from `../support/source-text.ts` because the bug above
 * is that shared helper's, not this file's to carry silently — fixing it
 * there is a separate change with its own blast radius across every test that
 * already depends on its current behaviour, and is out of this task's scope.
 */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function pageFiles(): string[] {
  return filesUnder("src/app")
    .filter((f) => /\/page\.tsx$/.test(f.replace(/\\/g, "/")))
    .sort();
}

/**
 * `export const metadata` or `export function`/`export async function
 * generateMetadata`. Anchored on `export` so a *local* `metadata` variable a
 * page happens to compute for its own body — none does today — would not
 * satisfy the guard; the export is what Next.js reads.
 */
const HAS_TITLE_EXPORT =
  /\bexport\s+(?:const\s+metadata\b|(?:async\s+)?function\s+generateMetadata\b)/;

test("every page.tsx exports metadata or generateMetadata", () => {
  const offenders = pageFiles()
    .filter((file) => {
      const source = withoutComments(readFileSync(file, "utf8"));
      return !HAS_TITLE_EXPORT.test(source);
    })
    .map((f) => f.replace(process.cwd() + "/", ""));

  expect(offenders).toEqual([]);
});

/**
 * The guard's own guard, in the shape `pages-reading-the-database-are-
 * dynamic.test.ts` already established for this directory: a regex that
 * matches nothing passes the assertion above just as cleanly as a correct one
 * does, and that exact failure shipped twice already on this branch per the
 * QA remediation controller notes (Task 25's brief: "prove yours"). Four
 * synthetic sources rather than deleting a real file and putting it back —
 * this runs every time the suite does, instead of once, by hand, and forgotten.
 */
test("the guard can tell a page with a title apart from one without", () => {
  const noExport = `
    export default function Page() {
      return null;
    }
  `;
  const constMetadata = `
    export const metadata = { title: "Ví dụ — OLibra" };
    export default function Page() {
      return null;
    }
  `;
  const generateMetadataFn = `
    export async function generateMetadata() {
      return { title: "Ví dụ — OLibra" };
    }
    export default function Page() {
      return null;
    }
  `;
  // A docstring that talks about the shape, the way this very test file's own
  // header does, must not be read as shipping it.
  const onlyInAComment = `
    // export const metadata = { title: "Ví dụ — OLibra" };
    /* export async function generateMetadata() {} */
    export default function Page() {
      return null;
    }
  `;

  expect(HAS_TITLE_EXPORT.test(withoutComments(noExport))).toBe(false);
  expect(HAS_TITLE_EXPORT.test(withoutComments(constMetadata))).toBe(true);
  expect(HAS_TITLE_EXPORT.test(withoutComments(generateMetadataFn))).toBe(true);
  expect(HAS_TITLE_EXPORT.test(withoutComments(onlyInAComment))).toBe(false);
});
