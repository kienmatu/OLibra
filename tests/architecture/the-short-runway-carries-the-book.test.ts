import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

/** Block and line comments out; string literals kept, since those are the subject. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * OPS §5's "second, shorter entry point" (OPERATIONS.md:917), asserted on both
 * pages that offer it rather than on the one that happened to get it right.
 *
 * The rule the spec states is not "there are two buttons on book detail" — it
 * is that they open the two flows "with step 1 … already done, because the book
 * is the page the manager is already looking at". A button labelled `Cho mượn`
 * that lands on the flow's own search box satisfies the first reading and
 * defeats the entire point of the second: the volunteer types in the title of
 * the book they are holding, on a page that already knew it.
 *
 * That is what the reader-facing book detail shipped — `${base}/quan-ly/cho-muon`
 * and `${base}/quan-ly/nhan-tra`, both bare — under a paragraph promising it was
 * "mở sẵn với cuốn này đã chọn". The manager-facing twin had the real links all
 * along, which is why this is a guard on the pair: the same shortcut written
 * twice will not stay written twice on its own.
 *
 * Source text, like the rest of this directory. The parameter names are the
 * subject and not an implementation detail — `?sach=` is what
 * `cho-muon/nguoi-doc` reads to skip step 1, and `?q=` is what `nhan-tra` reads
 * to arrive with the search already run. A link that carried the book under any
 * other key would render a flow that had forgotten it.
 */

const SHORTCUT_PAGES = [
  // The reader-facing detail page's "Dành cho quản lý" panel.
  "src/app/tu-sach/[shelf]/sach/[slug]/page.tsx",
  // The manager-facing detail page's header actions.
  "src/app/tu-sach/[shelf]/quan-ly/sach/[id]/page.tsx",
];

test.each(SHORTCUT_PAGES)(
  "%s opens the lend flow at step 2, with the book",
  (page) => {
    const source = withoutComments(readFileSync(page, "utf8"));

    // Step 2 by route, and the book by parameter. Encoded, because a slug is
    // interpolated into a query string.
    expect(source).toMatch(/cho-muon\/nguoi-doc\?sach=\$\{\s*encodeURIComponent\(/);
  },
);

test.each(SHORTCUT_PAGES)(
  "%s opens the return flow with the search already run",
  (page) => {
    const source = withoutComments(readFileSync(page, "utf8"));

    // `searchLoansForReturn` folds the title on both sides, so the title is a
    // usable key here and the diacritics survive the round trip.
    expect(source).toMatch(/nhan-tra\?q=\$\{\s*encodeURIComponent\(/);
  },
);

test.each(SHORTCUT_PAGES)(
  "%s links no flow root that would ask for the book again",
  (page) => {
    const source = withoutComments(readFileSync(page, "utf8"));

    // A template href ending at `/cho-muon` or `/nhan-tra` — no query, nothing
    // carried. The dashboard (`quan-ly/page.tsx`) links exactly this and should:
    // it is the entry point for a manager who has *not* got a book in hand. On a
    // page about one book it is the bug.
    expect(source).not.toMatch(/href=\{`[^`]*\/(cho-muon|nhan-tra)`\}/);
  },
);
