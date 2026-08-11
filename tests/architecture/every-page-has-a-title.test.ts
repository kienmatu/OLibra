import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { filesUnder, stripCommentsAndStrings } from "../support/source-text";

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
 * comments and strings stripped first (`stripCommentsAndStrings`) so a
 * docstring that *mentions* "generateMetadata" — this one does, several times
 * — cannot be mistaken for a page that ships it. It does not check that the
 * title is non-empty, in Vietnamese, or reachable from a `<head>` a browser
 * actually renders; `next build`'s own metadata resolution is the tool for
 * that, and "the export exists" is the property a route-file sweep can check
 * cheaply and honestly.
 *
 * **This used to carry a local `withoutComments`, not `stripCommentsAndStrings`
 * from `../support/source-text.ts`, over a bug in the shared helper — now
 * fixed there instead of routed around here.** The shared helper stripped
 * quoted strings *before* line comments, and this codebase's own docstrings
 * are prose full of English contractions inside `//` lines ("shelf's",
 * "editor's", "form's" …): an apostrophe in one such comment paired with the
 * next single quote the string-stripping regex found, anywhere later in the
 * file, and deleted every real line in between as if it were part of one
 * giant string literal. Measured on this branch, two independent instances:
 * `src/app/quan-tri/tu-sach/page.tsx`'s `export const metadata` (which has
 * shipped since U3) and `src/app/tu-sach/[shelf]/ho-so/tong-quan/page.tsx`'s
 * own `export const metadata` (added by this very task) were both silently
 * swallowed, each along with roughly a hundred real lines around it. Code
 * review on this task caught both and asked for the root fix rather than a
 * second local workaround: `stripCommentsAndStrings` itself now strips line
 * comments right after block comments, before any string is touched, guarded
 * against a `:` immediately before the `//` so a still-quoted `"http://…"` is
 * not itself misread as a comment start — the same guard `pages-reading-the-
 * database-are-dynamic.test.ts`'s own (still local, still separate) `without
 * Comments` uses, so the two no longer disagree about which of two defensible
 * orderings is correct. See that function's own docstring in `../support/
 * source-text.ts` for the fuller account and for what re-running the full
 * suite after the reorder confirmed.
 */
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
      const source = stripCommentsAndStrings(readFileSync(file, "utf8"));
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

  expect(HAS_TITLE_EXPORT.test(stripCommentsAndStrings(noExport))).toBe(false);
  expect(HAS_TITLE_EXPORT.test(stripCommentsAndStrings(constMetadata))).toBe(true);
  expect(HAS_TITLE_EXPORT.test(stripCommentsAndStrings(generateMetadataFn))).toBe(
    true,
  );
  expect(HAS_TITLE_EXPORT.test(stripCommentsAndStrings(onlyInAComment))).toBe(
    false,
  );
});
