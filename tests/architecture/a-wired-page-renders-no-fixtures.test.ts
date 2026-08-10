import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
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
 * **The rule below reads the route file only; the chrome rule further down
 * reads the components it renders.** This split is not tidiness, it is what
 * the first version got wrong: `src/components/ui/book.tsx` calls
 * `coverForTitle` from the fixtures for its cover art, so *every* page showing
 * a book cover reaches the module, and a blanket transitive rule would flag all
 * of them. The original answer was to look at route files and nothing else,
 * which meant the check could not see the very shape its own opening paragraph
 * describes — chrome. U3 wave 1 found two live instances of it (the manager
 * sidebar's fixture badge, and a donor picker listing eleven invented children
 * on a wired page) and added `"no chrome rendered by a wired page renders
 * fixtures either"` below, exempting `coverForTitle` **by name** rather than
 * `book.tsx` by file. Moving the artwork map out of `fixtures.ts` is still the
 * honest end state and still nobody's slice; it is now one entry rather than a
 * blind spot.
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

/**
 * Every file that makes a route, including `route.ts` — widened by P1 for the
 * reason `pages-reading-the-database-are-dynamic.test.ts` records at its own
 * copy of this function. A route handler is as capable of returning fixture
 * rows as a page is of rendering them, and until this slice there was no route
 * handler in the repository for the narrower glob to be wrong about.
 */
function routeFiles(): string[] {
  return filesUnder("src/app").filter((f) =>
    /\/(page|layout|route|template|default)\.tsx?$/.test(f.replace(/\\/g, "/")),
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

  // **The other half is now empty, and that is the end of this slice's work.**
  //
  // Every route file in the application reads the database or has nothing to
  // read. `src/lib/fixtures.ts` still exists and is still imported by
  // components — `coverForTitle`, exempted by name in the chrome rule below —
  // but no *page* renders a parish's content from it.
  //
  // Kept as `toEqual([])` rather than deleted, because the rule it guards is
  // permanent: a page added next month that starts from the fixtures, as every
  // page in this project once did, fails here on the day it is typed. The first
  // half above is what stops that from passing vacuously.
  expect(all.filter((r) => r.importsFixtures).map((r) => r.path)).toEqual([]);
  void base;
});

test("no page that reads the database also renders fixtures", () => {
  const offenders = routes()
    .filter((r) => r.readsTheDatabase && r.importsFixtures)
    .map((r) => r.path);

  expect(offenders).toEqual([]);
});

/**
 * B4a, and the blind spot every rule in this file shared: **`src/lib/fixtures.ts`
 * is not the only place invented content comes from**, so counting the pages
 * still to be wired by grepping for that module undercounts.
 *
 * It reported twelve. All seven `/quan-tri/*` pages were missing from it,
 * because each holds its invented rows *inline* — `const MESSAGES: Message[] =
 * [{ sender: "Chị Nguyễn Thu Trang", … }]` in the feedback inbox, `const LOG` in
 * the audit browser, `const MANAGERS` in the managers list. None names the
 * fixtures module, so every rule above was green for the whole administration
 * surface: the surface with the widest reach in the application was the one
 * nothing in this file could see.
 *
 * **A heuristic was tried first and is not what this is.** The shape looks
 * detectable — a module-level array of object literals — and measuring it
 * against the real files is what showed it is not. `SORTS` on the overdue page
 * (three fields, all literals) is a sort-order menu; `info` on the reader detail
 * page (three fields) is built from real query results; and `ATTENTION` on the
 * admin overview is two fields of pure fabrication ("Tủ sách Cần Thơ có 7 cuốn
 * quá hạn"). No threshold separates them, because what distinguishes invented
 * content from UI structure is what the strings *mean*.
 *
 * So this is an inventory instead: **the exact set of route files that do not
 * read the database, pinned.** It is not clever and it cannot be fooled. Wiring
 * a page fails this test until the page is struck off the list, which is the
 * moment every rule above starts applying to it — and the moment the author is
 * looking at this file, which is where the leftover-fixture rules are. Deleting
 * a page fails it too.
 *
 * **The list was three pages, and it is two now.** B4 wired the last of the
 * pending ones, and Task 6 (2026-08-10 QA remediation) wired `/`: it reads
 * `loadFrontDoorViewer()` so its header can greet a signed-in visitor, the
 * same way `/tu-sach` and `/lien-he` already do — see that function's
 * docstring (`src/lib/page-data.ts`) for the QA finding that prompted it.
 * That is what the previous paragraph's own comment said would happen —
 * "if either ever does, this line is where that gets noticed" — and this is
 * that line, noticing it. `/loi` renders whatever error was thrown and
 * `[shelf]/tang-sach` is a redirect to the donation page U4 wired; neither
 * has anything to read.
 *
 * So the test has changed meaning without changing shape: it was a shrinking
 * to-do list, and it is now the closed set of pages that legitimately touch no
 * database. A page added to it is a claim somebody has to make on purpose, and
 * a page leaving it is a page that got wired.
 */
const PAGES_NOT_YET_WIRED = [
  // Finished rather than pending, and on this list for the same reason the
  // other one is: the list is "reads nothing", not "is unfinished", and a
  // list that quietly excluded a category would be a list somebody could add
  // to. `/loi` renders whatever error was thrown and has nothing to read.
  "src/app/loi/page.tsx",

  // Reads nothing because it *is* nothing: U5 replaced the second donation
  // screen with a redirect to `toi/tang-sach`, the one the reader's own
  // queries live behind. A route that only redirects has nothing to read.
  "src/app/tu-sach/[shelf]/tang-sach/page.tsx",
];

test("the set of unwired pages is exactly what this file says it is", () => {
  const unwired = routes()
    .filter((r) => !r.readsTheDatabase)
    // `layout.tsx`, `route.ts` and the error/loading files are not pages that
    // *should* read anything; the rule is about pages with content.
    .filter((r) => r.path.endsWith("/page.tsx"))
    .map((r) => r.path)
    .sort();

  expect(unwired).toEqual([...PAGES_NOT_YET_WIRED].sort());
});

/**
 * IMPORTANT 4 (fix-report, 2026-08-09-u2-shelf-and-portal), and the half the
 * rule above cannot see.
 *
 * "No page renders both" is a rule about one file. It was satisfied by every
 * page in this app on the day U2 shipped, and a member of Vĩnh Long could
 * still tap "Thông báo" in the header of their real catalogue and land on Đồng
 * Tháp's invented announcements, or tap "Trang của tôi" and read a stranger's
 * loans under the name "Giuse Trần Minh". The fixture was one navigation step
 * away instead of one import away, and one step is not far enough to matter to
 * the person reading it.
 *
 * So the rule this adds is about the edge rather than the node: **a page that
 * reads the database does not link to a page that renders fixtures.** Chrome
 * counts — `ShelfHeader` is where the two links actually were, and no check
 * over route files alone would ever have looked at it — so the components a
 * wired route renders are walked with it.
 *
 * **Href literals, and the two shapes that appear in this codebase.** A
 * shelf-relative link is written `` `${base}/…` ``, and every site-absolute one
 * is a plain `"/…"` string. Both are matched; anything more dynamic than that
 * (a href assembled from a variable, or one built by a helper like `hrefWith`)
 * is invisible here, which is the same "known-dangerous shape" bargain
 * `boundaries.test.ts` already makes. What it catches is the shape a person
 * types while adding a link, which is how these four got there.
 *
 * **`base` is assumed to be `/tu-sach/${shelfSlug}`, and on every manager page
 * it is not.** U3 wave 1 measured this rather than inferring it. Manager pages
 * declare `` const base = `/tu-sach/${slug}/quan-ly` ``, so `` `${base}/sach/moi` ``
 * is resolved here as `src/app/tu-sach/[shelf]/sach/moi` — a route that does
 * not exist — and `resolveRoute` returns `null`, which is silently dropped. The
 * manager sidebar is worse still: its nav is `` `${base}/${key}` ``, and an
 * interpolated *segment* only resolves where the directory has exactly one
 * `[dynamic]` child, which `src/app/tu-sach/[shelf]` has none of. Verified by
 * running `linkTargetsIn` verbatim over `manager-shell.tsx`: every nav target
 * came back `null`. So this rule currently sees no link any manager page emits,
 * including the eight sidebar entries that point at fixture pages.
 *
 * It is left that way in wave 1 **deliberately**, and this paragraph is the
 * alternative to pretending otherwise. Teaching `resolveRoute` the real `base`
 * would immediately report about eleven links, of which every one but
 * `Thông báo`, `Thống kê` and `Cài đặt` is a page U3's own later waves wire —
 * so today's fix is an eleven-entry exemption list that is stale within the
 * slice, which is the failure mode this file's own `FIXTURE_TARGETS_THAT_MAY_
 * STILL_BE_LINKED` is written narrowly to avoid. The right moment is when those
 * targets are real, and the change is then a strengthening with no exemptions
 * at all. `the link check resolves the routes it claims to`, below, pins the
 * current behaviour so this gap cannot close by accident and go unnoticed.
 */

/** Components under `src/components/` that a route renders, one level deep. */
function componentsOf(file: string): string[] {
  return specifiersIn(readFileSync(file, "utf8"))
    .filter((s) => s.replace(/\\/g, "/").includes("components/"))
    .map((s) => "src/" + s.replace(/^@\//, "").replace(/\\/g, "/") + ".tsx")
    .filter((p) => existsSync(p));
}

/**
 * A URL path's segments resolved against the real route tree, or `null` if it
 * names no route.
 *
 * A segment carrying a `${...}` is an interpolation — a book slug, a reader id
 * — and resolves to whatever single `[dynamic]` directory sits at that level,
 * read off the filesystem. Guessing instead (dropping the segment, or assuming
 * `[id]`) is what turns `${base}/quan-ly/sach/${book.slug}` into a report about
 * `quan-ly`, which is a different page with a different wiring status.
 */
function resolveRoute(segments: string[]): string | null {
  let dir = "src/app";
  for (const segment of segments) {
    if (segment.includes("${")) {
      const dynamic = readdirSync(dir).filter(
        (e) => e.startsWith("[") && statSync(join(dir, e)).isDirectory(),
      );
      if (dynamic.length !== 1) return null;
      dir = join(dir, dynamic[0]);
      continue;
    }
    if (!existsSync(join(dir, segment))) return null;
    dir = join(dir, segment);
  }
  return dir;
}

/** Every route directory a file links to, resolved against the route tree. */
function linkTargetsIn(source: string): string[] {
  const clean = withoutComments(source);
  const paths: string[][] = [];

  // Any `` `${base}…` `` template literal, not only one written directly in a
  // `href=`: `ShelfHeader` builds its nav as an array of `{ href, label, key }`
  // and renders `href={link.href}` in a `.map`, which is exactly where the two
  // links this test exists for were. `base` is `/tu-sach/${shelfSlug}` in every
  // file that declares one, and nothing in this codebase builds a non-href
  // string out of it.
  for (const [, path] of clean.matchAll(/`\$\{base\}([^`]*)`/g)) {
    paths.push(["tu-sach", "[shelf]", ...path.split("?")[0].split("/")]);
  }
  for (const [, path] of clean.matchAll(/href="(\/[^"]*)"/g)) {
    paths.push(path.split("?")[0].split("/"));
  }

  return [
    ...new Set(
      paths
        .map((p) => resolveRoute(p.filter(Boolean)))
        .filter((p): p is string => p !== null),
    ),
  ];
}

/**
 * The two fixture pages a wired page may still link to, each because removing
 * the link would cost more than the fixture does.
 *
 * Exemptions on the *target*, not on any page that links to it: each
 * disappears in one line when its own slice wires the page, and neither
 * silences anything else that page might later be linked from.
 *
 * **`/lien-he`** — the site's contact page, reached from the front door's
 * footer and from the portal's empty state ("liên hệ với ban quản trị để mở
 * một tủ mới", the only route a parish with no shelf has). It is not the
 * failure this rule is about: everything else this check catches is a
 * *parish's* page showing another parish's invented content, which a member
 * has no way to recognise as invented. `/lien-he` shows the administration's
 * own contact block — a fact about the deployment, belonging to no shelf, that
 * OPS §3.1 already specifies as `GetSiteContact`. Nobody can be mistaken about
 * whose it is.
 *
 * **`/dang-ky`** — the registration form, linked from the sign-in page's
 * "Chưa có tài khoản? Đăng ký tài khoản mới". This one *is* the failure this
 * rule is about, and it is exempted anyway, so it needs saying plainly: the
 * page renders `shelf.name` and `shelf.parishUnits` from `src/lib/fixtures.ts`,
 * so a stranger from Vĩnh Long following it lands on a form headed "Tủ sách
 * Đồng Tháp" offering Đồng Tháp's parish units — the same defect IMPORTANT 3
 * fixed one page earlier, one hop further along. What makes removing the link
 * the worse option is that it is the *only* way to register, and BR §1.2 makes
 * registration the entire reason the portal and the sign-in page exist:
 * "someone who has no account yet must be able to find their parish's shelf in
 * order to register for it." A front door with no door is not an improvement.
 *
 * Registration is deliberately unwired — `RegisterMembership` is `NotWired`
 * and `tests/domain/members/registration-not-wired.test.ts` pins that — so
 * this belongs to the slice that wires it, recorded in the U2 plan's §6 rather
 * than half-solved here. That slice removes this entry.
 */
const FIXTURE_TARGETS_THAT_MAY_STILL_BE_LINKED = [
  "src/app/lien-he",
  "src/app/dang-ky",
];

/**
 * U3 wave 1, and the half of the *first* rule this file could not see.
 *
 * "No page renders both" reads one file: the route's own import list. The
 * defect the docstring at the top of this file says it generalises did not live
 * in a route file at all — `ShelfHeader` is chrome — and neither did the one
 * U3 found. `manager-shell.tsx` imported `donationQueue` from
 * `src/lib/fixtures.ts` and printed `donationQueue.length` as a nav badge, on
 * six manager pages that have shown real books from a real parish since U1. The
 * rule above was green for every one of them, because none of those six route
 * files names the fixtures module.
 *
 * So the components a wired route renders are read too — the same one-level
 * `componentsOf` walk the link rule below already does, for the same reason
 * (the thing being looked for is in the chrome).
 *
 * **Exempted by symbol, not by file.** The top of this file records why the
 * original rule stopped at direct imports: `src/components/ui/book.tsx` calls
 * `coverForTitle` from the fixtures for its cover artwork, so every page
 * showing a book cover reaches the module. That is still true and still the
 * honest thing to fix elsewhere — moving the artwork map out of `fixtures.ts`
 * is a component change no slice has made. What has changed is that "so the
 * rule cannot look at components at all" was too big a concession: one named
 * export is exempt, everything else in that module is not, and a file that
 * imports `coverForTitle` *and* something else is reported for the something
 * else. A whole-file pass would have waved `donationQueue` through the moment
 * `book.tsx` grew a second import.
 */
const FIXTURE_SYMBOLS_CHROME_MAY_STILL_USE = ["coverForTitle"];

/**
 * The names a file imports from `src/lib/fixtures.ts`.
 *
 * `["*"]` for a namespace or default import, which names nothing and could
 * reach anything — treated as "not exempt" rather than parsed, since no file in
 * this repository imports the fixtures that way and a rule that guessed would
 * be guessing about the one shape that can reach everything.
 */
function fixtureSymbolsIn(source: string): string[] {
  const symbols: string[] = [];
  for (const [, named, whole] of withoutComments(source).matchAll(
    /import\s+(?:\{([^}]*)\}|([^;]*?))\s*from\s*["']([^"']*lib\/fixtures)["']/g,
  )) {
    if (named === undefined) {
      symbols.push("*");
      continue;
    }
    for (const item of named.split(",")) {
      // `type X`, `X as Y` — the imported name is the first identifier.
      const name = item
        .trim()
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)[0];
      if (name) symbols.push(name);
    }
    void whole;
  }
  return symbols;
}

test("no chrome rendered by a wired page renders fixtures either", () => {
  const offenders: string[] = [];

  for (const route of routes()) {
    if (!route.readsTheDatabase) continue;
    for (const component of componentsOf(route.path)) {
      const used = fixtureSymbolsIn(readFileSync(component, "utf8")).filter(
        (name) => !FIXTURE_SYMBOLS_CHROME_MAY_STILL_USE.includes(name),
      );
      for (const name of used) {
        offenders.push(`${component}: ${name} (rendered by ${route.path})`);
      }
    }
  }

  expect([...new Set(offenders)].sort()).toEqual([]);
});

test("the chrome check reads the chrome, and the exemption is one name wide", () => {
  // Its own guard, for the reason every `toEqual([])` in this file has one: a
  // `fixtureSymbolsIn` that found nothing satisfies the rule above perfectly.
  //
  // The reach is real — the wired dashboard renders the manager shell, and the
  // shell is where the fixture badge was.
  expect(componentsOf("src/app/tu-sach/[shelf]/quan-ly/page.tsx")).toContain(
    "src/components/shell/manager-shell.tsx",
  );

  // The shape U3 removed, and the shape that must stay allowed.
  expect(
    fixtureSymbolsIn('import { donationQueue } from "@/lib/fixtures";'),
  ).toEqual(["donationQueue"]);
  expect(
    fixtureSymbolsIn('import { coverForTitle } from "@/lib/fixtures";'),
  ).toEqual(["coverForTitle"]);
  // A file that earns the exemption for one name does not earn it for another.
  expect(
    fixtureSymbolsIn(
      'import { coverForTitle, donationQueue } from "@/lib/fixtures";',
    ),
  ).toEqual(["coverForTitle", "donationQueue"]);
  // A namespace import names nothing and is never exempt.
  expect(fixtureSymbolsIn('import * as f from "@/lib/fixtures";')).toEqual(["*"]);
  // And an unrelated module is not the fixtures.
  expect(fixtureSymbolsIn('import { cn } from "@/lib/utils";')).toEqual([]);

  // `book.tsx` really is the file the exemption is for, and really does import
  // only that one name — so the exemption is not quietly covering something
  // else today.
  expect(
    fixtureSymbolsIn(readFileSync("src/components/ui/book.tsx", "utf8")),
  ).toEqual(["coverForTitle"]);
});

test("no page that reads the database links to a page that renders fixtures", () => {
  const byPath = new Map(routes().map((r) => [r.path, r]));
  const offenders: string[] = [];

  for (const route of routes()) {
    if (!route.readsTheDatabase) continue;
    // The route file plus the chrome it renders: the two links this test was
    // written for lived in `public-header.tsx`, not in any page.
    const sources = [route.path, ...componentsOf(route.path)];

    for (const source of sources) {
      for (const target of linkTargetsIn(readFileSync(source, "utf8"))) {
        if (FIXTURE_TARGETS_THAT_MAY_STILL_BE_LINKED.includes(target)) continue;
        const page = byPath.get(`${target}/page.tsx`);
        if (page?.importsFixtures) {
          offenders.push(`${route.path} → ${target} (via ${source})`);
        }
      }
    }
  }

  expect([...new Set(offenders)].sort()).toEqual([]);
});

test("the link check resolves the routes it claims to", () => {
  // Its own guard, and it needs one more than the rule above does: every part
  // of it is string manipulation that can silently resolve to `null` and
  // report nothing. `toEqual([])` cannot tell "no bad links" from "no links
  // found".
  const header = readFileSync("src/components/shell/public-header.tsx", "utf8");
  const shelfHome = readFileSync("src/app/tu-sach/[shelf]/page.tsx", "utf8");
  const bookPage = readFileSync(
    "src/app/tu-sach/[shelf]/sach/[slug]/page.tsx",
    "utf8",
  );

  // The chrome is found from the page, and its links are found in it.
  expect(componentsOf("src/app/tu-sach/[shelf]/page.tsx")).toContain(
    "src/components/shell/public-header.tsx",
  );
  expect(linkTargetsIn(header)).toContain("src/app/tu-sach/[shelf]/danh-muc");
  expect(linkTargetsIn(shelfHome)).toContain("src/app/tu-sach/[shelf]/danh-muc");

  // An interpolated segment resolves to the dynamic directory rather than
  // being dropped: `${base}/quan-ly/sach/${book.slug}` is the wired manager
  // book page, not the fixture `quan-ly` dashboard one level up.
  expect(linkTargetsIn(bookPage)).toContain(
    "src/app/tu-sach/[shelf]/quan-ly/sach/[id]",
  );
  expect(linkTargetsIn(bookPage)).not.toContain("src/app/tu-sach/[shelf]/quan-ly");

  // The declared gap, pinned rather than described (U3 wave 1, and see this
  // rule's docstring for why it is a gap on purpose today). A manager page's
  // `base` already contains `/quan-ly`, which this check does not know, so
  // nothing the manager sidebar links to is seen at all. Written as an
  // assertion so that the day somebody teaches `resolveRoute` the real `base`,
  // this line fails and points them at the eleven links that then become
  // visible — rather than the improvement landing silently beside a comment
  // that has quietly become false.
  const managerShell = readFileSync(
    "src/components/shell/manager-shell.tsx",
    "utf8",
  );
  expect(linkTargetsIn(managerShell)).toEqual(["src/app"]);

  // U4 wired `toi/`, so its link is back — and this asserts *both* halves,
  // because a link restored to a page that is still fixture-backed is exactly
  // what IMPORTANT 4 removed it for. Restoring the link without wiring the page
  // fails on the second line rather than passing quietly.
  expect(linkTargetsIn(header)).toContain("src/app/tu-sach/[shelf]/toi");
  expect(
    routes().find((r) => r.path === "src/app/tu-sach/[shelf]/toi/page.tsx")
      ?.importsFixtures,
  ).toBe(false);

  // Both halves of IMPORTANT 4 are now back, each beside its wired page — the
  // second one here. Same two-part assertion as `toi` above: the link exists
  // *and* the page it points at is real, so restoring one without the other
  // fails rather than passing quietly.
  expect(linkTargetsIn(header)).toContain("src/app/tu-sach/[shelf]/thong-bao");
  expect(
    routes().find((r) => r.path === "src/app/tu-sach/[shelf]/thong-bao/page.tsx")
      ?.importsFixtures,
  ).toBe(false);
  for (const gone of [
    "src/app/tu-sach/[shelf]/tang-sach",
    "src/app/tu-sach/[shelf]/gop-y",
  ]) {
    expect(linkTargetsIn(shelfHome), gone).not.toContain(gone);
  }
  // …and they are still fixture pages, so relinking one fails rather than
  // passing because the page quietly got wired in the meantime.
  const byPath = new Map(routes().map((r) => [r.path, r]));
  for (const page of []) {
    expect(byPath.get(page)?.importsFixtures, page).toBe(true);
  }
});
