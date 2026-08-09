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
 * **Href literals, and the two shapes that appear in this codebase.** Every
 * shelf-relative link is written `` `${base}/…` `` where `base` is
 * `/tu-sach/${shelfSlug}`, and every site-absolute one is a plain `"/…"`
 * string. Both are matched; anything more dynamic than that (a href assembled
 * from a variable, or one built by a helper like `hrefWith`) is invisible here,
 * which is the same "known-dangerous shape" bargain `boundaries.test.ts`
 * already makes. What it catches is the shape a person types while adding a
 * link, which is how these four got there.
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

  // And the four links IMPORTANT 4 removed are the ones this would now report.
  for (const gone of [
    "src/app/tu-sach/[shelf]/thong-bao",
    "src/app/tu-sach/[shelf]/toi",
  ]) {
    expect(linkTargetsIn(header), gone).not.toContain(gone);
  }
  for (const gone of [
    "src/app/tu-sach/[shelf]/tang-sach",
    "src/app/tu-sach/[shelf]/gop-y",
  ]) {
    expect(linkTargetsIn(shelfHome), gone).not.toContain(gone);
  }
  // …and they are still fixture pages, so relinking one fails rather than
  // passing because the page quietly got wired in the meantime.
  const byPath = new Map(routes().map((r) => [r.path, r]));
  for (const page of [
    "src/app/tu-sach/[shelf]/thong-bao/page.tsx",
    "src/app/tu-sach/[shelf]/toi/page.tsx",
    "src/app/tu-sach/[shelf]/tang-sach/page.tsx",
    "src/app/tu-sach/[shelf]/gop-y/page.tsx",
  ]) {
    expect(byPath.get(page)?.importsFixtures, page).toBe(true);
  }
});
