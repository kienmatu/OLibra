import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { filesUnder, stripCommentsAndStrings } from "../support/source-text";

/**
 * BR §16.1's disclosure boundary, as a rule about *where a page is* rather than
 * about what a query returns.
 *
 * IMPORTANT 3 (fix-report, 2026-08-09-u2-shelf-and-portal). `src/app/dang-nhap
 * /page.tsx` rendered "Quên mật khẩu thì nhắn cho quản lý tủ sách — cô Maria
 * Nguyễn Thị Lan 0912 345 678", with the number as a live `tel:` link, on a
 * page with no session — from `src/lib/fixtures.ts`, so it was always Đồng
 * Tháp's keeper regardless of which parish the visitor came from. §16.1 is
 * explicit that keeper contact belongs on the shelf's *own* page and not on
 * the public side: "a person with no membership has no business knowing them."
 * `readShelfIdentity` gates exactly those two columns behind `requireReader`
 * for that reason, and `list-public-shelves.ts` refuses them by naming three
 * columns and taking no exemption — and then the sign-in form, one hop from
 * the portal, published them anyway.
 *
 * **Why a rule about the route tree and not another column guard.**
 * `tests/db/bookshelves-public-columns.test.ts` watches what a query *selects*.
 * It could not have caught this: the sign-in page selected nothing at all — it
 * imported a fixture. The property that actually failed is positional. Every
 * route under `src/app/tu-sach/[shelf]/` is behind `loadPage`, which refuses a
 * caller with no membership (U2 §3.1: a guest is redirected, a signed-in
 * non-member gets a 404). Every route outside it is the front door — the
 * landing page, the portal, the two auth forms, the contact page and the error
 * page — and BR:426 is explicit that a `guest` "sees only the landing page, the
 * portal directory, and the sign-in and registration forms". So keeper contact
 * on a front-door route is wrong wherever the string came from, and this is the
 * check that says so.
 *
 * Discovered from the route tree, not from a list of pages: a front-door route
 * added later is covered without anybody remembering this file.
 */

/** Every route under `src/app/`, as `{ path, source }` with comments and strings removed. */
function routes() {
  return filesUnder("src/app")
    .filter((f) => /\/(page|layout)\.tsx?$/.test(f.replace(/\\/g, "/")))
    .map((file) => ({
      path: file.replace(process.cwd() + "/", "").replace(/\\/g, "/"),
      // Comments out, so this file's own prose and the sign-in page's note
      // about what it removed do not trip it; strings out too, since neither
      // token below is ever a legitimate string literal on these pages.
      source: stripCommentsAndStrings(readFileSync(file, "utf8")),
    }));
}

/**
 * The two route trees that are somebody's private area rather than the front
 * door.
 *
 * `tu-sach/[shelf]/` is a shelf's own pages, where BR §16.1 *puts* keeper
 * contact — the book page renders it word for word ("Liên hệ {keeper} ·
 * {phone} để nhận sách.") and `readShelfIdentity` gates it behind
 * `requireReader`. `quan-tri/` is the super-admin area (BR §13.2), which is
 * nobody's idea of a public page whatever state its wiring is in.
 *
 * Naming what is *excluded* rather than listing the six front-door routes is
 * deliberate: a route added under `src/app/` tomorrow is treated as public
 * until somebody says otherwise, which is the direction this check should fail
 * in.
 */
const GATED_TREES = ["src/app/tu-sach/[shelf]/", "src/app/quan-tri/"];

/** A route BR:426 puts in front of a caller with no membership anywhere. */
function isFrontDoor(path: string): boolean {
  return !GATED_TREES.some((tree) => path.startsWith(tree));
}

/**
 * Four tokens, none of them an innocent guess at a spelling, each closing off
 * a different way a shelf's contact could reach a front-door route.
 *
 * `keeper` is the old field and column name (`keeper_name`, `keeper_phone`,
 * the fixture's `shelf.keeper`) — gone from `ShelfIdentity` since PO feedback
 * round 1 Task 2, but `src/lib/fixtures.ts` still carries `shelf.keeper` for
 * whatever still reads that fixture, and IMPORTANT 3's own bug (see this
 * file's header docstring) is a fixture field reaching a page nobody gated,
 * not a query. Kept for that reason, not because any current page reads it.
 *
 * `PhoneLink` is the phone half, still true today, and named separately
 * because the fixture's own field was plain `phone` — a token far too common
 * to forbid on its own.
 *
 * **The name half of the *current* shape has no `keeper` token to catch it.**
 * Task 2 replaced `keeper_name`/`keeper_phone` with `bookshelf_contacts`, and
 * Task 11 replaced `ShelfIdentity.keeperName` with `ShelfIdentity.contacts` —
 * `shelf.contacts.find((c) => c.position === 1) ?? shelf.contacts[0]` on the
 * book page today. A front-door route that rendered `primaryContact.name` in
 * plain text, with no `PhoneLink` and no literal `"keeper"`, sailed through
 * this list undetected until this pair of tokens was added. Rather than guess
 * at a variable name (`primaryContact`, or whatever the next refactor calls
 * it, is page-local and not a stable target), these two forbid the
 * *mechanism* instead:
 *
 * - `readShelfIdentity` — the one gated read (`requireReader`) anywhere in
 *   `src/lib/` that returns a shelf's contacts. Nothing legitimate on a
 *   front-door route calls it: every caller today is one of the four member
 *   pages under `tu-sach/[shelf]/(doc-gia)/`, all excluded by `GATED_TREES`.
 * - `ContactList` — the one component (`src/components/ui/contact-list.tsx`)
 *   anywhere in `src/` that renders a contact array. Its one caller today is
 *   the shelf home page, also gated.
 *
 * A front-door route naming either is wrong by construction, whatever it
 * calls the variable it puts the name in — the same argument `keeper`/
 * `PhoneLink` made for the shape this replaces, applied to the shape that
 * replaced it.
 */
const FORBIDDEN_ON_THE_FRONT_DOOR = [
  "keeper",
  "PhoneLink",
  "readShelfIdentity",
  "ContactList",
];

/**
 * `/lien-he` is the contact page, and the number on it is the *administration's*,
 * not any shelf's.
 *
 * OPS §3.1 lists `GetSiteContact` — "the administration's contact details for
 * the public contact page (§16.1)" — as **Global** and `guest`-callable,
 * returning name, phone and contact hours. That is a fact about the deployment
 * rather than about a parish, and §16.1 publishes it deliberately. The
 * exemption is per-token and covers `PhoneLink` only: a `keeper` on this page
 * would still be wrong, and would still fail.
 */
const EXEMPT: Readonly<Record<string, readonly string[]>> = {
  "src/app/lien-he/page.tsx": ["PhoneLink"],
};

test("the check can see both halves of what it compares", () => {
  // The assertion below is `toEqual([])`, satisfied perfectly by a `routes()`
  // that found nothing — the failure mode the dynamic-rendering guard in this
  // directory actually shipped with. Both sides must be non-empty and
  // correctly classified.
  const all = routes();
  expect(all.some((r) => r.path === "src/app/dang-nhap/page.tsx")).toBe(true);
  expect(isFrontDoor("src/app/dang-nhap/page.tsx")).toBe(true);
  expect(isFrontDoor("src/app/tu-sach/page.tsx")).toBe(true);
  // The member side exists and is correctly *not* front door — it is where
  // keeper contact is specified to appear, and the book page renders it today.
  const bookPage = all.find(
    (r) => r.path === "src/app/tu-sach/[shelf]/(doc-gia)/sach/[slug]/page.tsx",
  );
  expect(bookPage).toBeDefined();
  expect(isFrontDoor(bookPage!.path)).toBe(false);
  // `PhoneLink` rather than `keeper`: PO feedback round 1 Task 11 replaced
  // `shelf.keeperName`/`keeperPhone` on this very page with
  // `shelf.contacts.find((c) => c.position === 1) ?? shelf.contacts[0]`, so
  // the literal token "keeper" no longer appears in its non-comment source at
  // all (it survives only inside this file's own stripped-out prose above).
  // `PhoneLink` is still the component the contact line renders the number
  // with, and it is a member of `FORBIDDEN_ON_THE_FRONT_DOOR` in its own
  // right, so this keeps proving the same thing the "keeper" check did: that
  // `routes()` found real, non-empty source for the page BR §16.1 names.
  expect(bookPage!.source).toContain("PhoneLink");
});

test("no front-door route renders a shelf's keeper contact", () => {
  const offenders: string[] = [];

  for (const { path, source } of routes()) {
    if (!isFrontDoor(path)) continue;
    const exempt = new Set(EXEMPT[path] ?? []);
    for (const token of FORBIDDEN_ON_THE_FRONT_DOOR) {
      if (exempt.has(token)) continue;
      if (source.includes(token)) {
        offenders.push(`${path}: names "${token}" on a page with no session`);
      }
    }
  }

  expect(offenders).toEqual([]);
});
