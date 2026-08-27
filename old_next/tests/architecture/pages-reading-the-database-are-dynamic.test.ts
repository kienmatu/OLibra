import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, test } from "vitest";
import { filesUnder, isServerActionModule } from "../support/source-text";

/**
 * U1 §2. **A cached render is a cross-tenant leak that no database test can
 * see.**
 *
 * Every tenancy guarantee in this project is enforced in Postgres — RLS keyed
 * on `olibra.bookshelf_id`, `security_invoker` on both views, one deliberate
 * `bypassrls` role — and every one of them is downstream of a query actually
 * running. If Next.js serves shelf A's manager screen to shelf B, or to a
 * guest, RLS was not defeated; it was never consulted. No SQL is issued, so
 * `tests/db/` and `tests/invariants/` are all still green while the leak
 * happens. That is why the guard lives here, in a test that reads the route
 * files themselves.
 *
 * The rule: **a page or layout that reaches the database must be explicitly
 * dynamic.** Not "the lending pages" by path — a path list goes stale the
 * moment a route is renamed and says nothing about the forty-one pages that
 * get wired in later slices. The trigger is reaching Postgres, because that is
 * exactly the property that makes a cached copy dangerous.
 *
 * **Reaching it *through anything*, not only directly.** This shipped reading
 * one file: the route's own import list. A page whose only import is a helper
 * in `src/lib/` that resolves the tenant from the slug and runs `runQuery`
 * therefore passed all three tests, and `next build` prerendered it as
 * `● (SSG)` with real database rows baked into the static HTML — rendered once
 * at build time, with no session, served to everyone, which is §2's failure
 * verbatim. No shipped page has that shape, but this slice adds
 * `src/lib/shelf.ts` and `src/lib/lending.ts` as exactly that kind of helper,
 * and forty-one pages are going to trust this test. So the check follows local
 * imports transitively (`reachTable` below) and asks whether Postgres is
 * anywhere in the closure.
 *
 * Reading `cookies()` (which `loadPage` does on every call) already forces
 * dynamic rendering in the App Router, so for a page that goes through the seam
 * this is belt to that braces. It is written down anyway because relying on it
 * means relying on a side effect of an implementation detail: move the cookie
 * read behind a cache, add a `use cache` above the component, or take the seam
 * somewhere that resolves the tenant without a cookie — which is precisely the
 * shape the transitive gap let through — and the implicit opt-out silently
 * stops applying while the page keeps rendering correctly in development,
 * where there is only ever one tenant signed in.
 *
 * Verified against the installed Next.js (16.3.0) rather than assumed from an
 * older major:
 * - `dynamic: 'force-dynamic'` is still an accepted route segment config —
 *   `node_modules/next/dist/build/segment-config/app/app-segment-config.js`
 *   parses the segment exports against a Zod schema whose `dynamic` key is
 *   `z.enum(['auto', 'error', 'force-static', 'force-dynamic'])`, so an
 *   unrecognised *value* is a build error. An unrecognised *key* is not:
 *   `AppSegmentConfigSchema` is a plain `z.object` with no `.strict()` (three
 *   other schemas in that same file do call it), so a misspelled export is
 *   dropped in silence. Which is one more reason for this file to exist: a
 *   typo'd `dynamik` is a page nothing complains about and nothing protects.
 * - It is honoured at render time, not merely accepted at build time:
 *   `dist/server/app-render/create-component-tree.js` branches on
 *   `dynamic === 'force-dynamic'` to abort a static render, and
 *   `dist/server/app-render/app-render.js` treats "a page with `dynamic =
 *   "force-dynamic"` did not trigger the dynamic pathway" as an internal
 *   invariant violation.
 * - `next build` reports all six wired lending pages as `ƒ (Dynamic)` in its
 *   route table. Measured with the marker deleted from one of them, everything
 *   else unchanged: still `ƒ`, because `loadPage` reads `cookies()`. So the
 *   marker really is belt to that braces *for a page that goes through the
 *   seam* — and the forty-one pages that have not been wired yet are still
 *   `● (SSG)`, prerendered at build time out of `src/lib/fixtures.ts`, which is
 *   what this guard has to keep from happening to a page once it holds real
 *   tenant data. (At `48f9591` only one page was wired and the other five
 *   lending screens were among the prerendered; `af55e95` wired the rest.)
 *
 * Read as source text, with the same limits every other architecture test in
 * this directory declares, now stated for a walk rather than for one file:
 * a specifier assembled at runtime, a reach that leaves the repository and
 * comes back (a re-export through `node_modules`), and a module that opens its
 * own connection without naming any of `DATABASE_REACHING_IMPORTS` all slip
 * past. It catches the shape a person actually types.
 */

/**
 * A module whose presence anywhere in a page's import closure means that page
 * talks to Postgres.
 *
 * `lib/page-data` is the seam every wired page is meant to use. The other two
 * are here so that bypassing the seam — importing `pool()` or `runQuery`
 * straight into a page, or into a helper the page imports — does not also
 * bypass the guard, which would make the check depend on the mistake being
 * made politely. `db/client` is the only door to a connection in this
 * codebase, so a helper that issues SQL either takes a `Tx`
 * (`domain/kernel/unit-of-work`) or opens one (`db/client`), and both are on
 * the list.
 *
 * Matched as a path fragment rather than as the exact `@/…` specifier, so a
 * relative reach (`../../../lib/page-data`) counts too — the same shape
 * `boundaries.test.ts` already allows for.
 */
const DATABASE_REACHING_IMPORTS = [
  "lib/page-data",
  "db/client",
  "domain/kernel/unit-of-work",
];

/**
 * The route files Next.js renders, and therefore the ones it can cache.
 *
 * **`route` and the other two were added by P1**, which introduced the first
 * `route.ts` in this application — the CSV exports. This glob was
 * `/(page|layout)\.tsx?$/`, so a route handler that reached Postgres was
 * invisible to every rule in this file, and the one being added holds every
 * child's name, date of birth, parents' names and telephone number. A `GET`
 * route handler is exactly the shape Next.js is happiest to serve from a cache.
 *
 * The wider set is not invented here: `compose-supplies-storage-env.test.ts`
 * already enumerates `page|layout|route|template|default`, which is Next.js's
 * own list of the files that make a route. Two globs for one concept is how one
 * of them stops matching.
 */
function routeFiles(): string[] {
  return filesUnder("src/app").filter((f) =>
    /\/(page|layout|route|template|default)\.tsx?$/.test(f.replace(/\\/g, "/")),
  );
}

/**
 * Comments removed, string literals kept.
 *
 * The opposite of `stripCommentsAndStrings`, and for the opposite reason: the
 * thing being looked for here *is* a string literal — the module specifier —
 * while a docstring saying "importing `pool()` straight into a page" must not
 * count as one. The `[^:]` guard keeps a `//` inside a URL from being read as
 * the start of a line comment. Not a parser: a `/*` inside a string literal
 * would eat code as if it were a comment, which happens nowhere here and is a
 * false negative rather than a crash.
 */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * Every module specifier a file names, in any of the four spellings.
 *
 * A static import or `export … from`, a side-effect `import "x"`, a dynamic
 * `import("x")` and a `require("x")` alike — the same set `boundaries.test.ts`
 * enumerates, for the same reason: a rule that only catches the tidy spelling
 * is a rule about tidiness.
 */
function specifiersIn(source: string): string[] {
  return [
    ...withoutComments(source).matchAll(
      /\b(?:from|import|require)\s*\(?\s*["']([^"']+)["']/g,
    ),
  ].map((m) => m[1]);
}

/**
 * A specifier resolved to a file in this repository, or `null` for a package.
 *
 * `@/` is the alias `tsconfig.json` maps to `src/`. A package specifier is
 * where the walk stops on purpose: `node_modules` is not this project's code,
 * and following it would turn a source-text check into a module resolver.
 */
function resolveLocal(fromFile: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = join("src", specifier.slice(2));
  else if (specifier.startsWith(".")) base = join(dirname(fromFile), specifier);
  else return null;

  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/**
 * A module every export of which is a server action, and where the walk stops.
 *
 * **A server action is not part of a render.** `"use server"` is the
 * framework's own declaration that these functions run in their own POST, after
 * the HTML has been built and sent, so nothing they read can be baked into a
 * cached page — which is the only thing this file is about. Without this the
 * check is useless in the loudest possible way: `public-header.tsx` renders a
 * sign-out `<form action={signOutAction}>`, `dang-nhap/actions.ts` imports
 * `pool()`, and therefore *every public page in the app* — the landing page,
 * the portal, the catalogue — reports as database-backed and has to be marked
 * `force-dynamic` for rendering a header.
 *
 * The declared gap: a Server Component that `await`s a `"use server"` export
 * directly, during its render, does reach Postgres and is not seen here. Next
 * discourages exactly that (an action is meant to be passed to a `form` or
 * called from the client), no page in this repository does it, and closing it
 * would mean telling a call site apart from a `form` attribute in source text.
 * Stated rather than papered over, in the same spirit as the limits at the top.
 *
 * `isServerActionModule` itself moved to `../support/source-text.ts`
 * (2026-08-12) once it gained a second caller — see that module for the full
 * account of what "directive position" means and why it matters.
 */
function namesADatabaseModule(specifier: string): boolean {
  return DATABASE_REACHING_IMPORTS.some((fragment) =>
    specifier.replace(/\\/g, "/").includes(fragment),
  );
}

/**
 * `file → does anything it can reach issue SQL`, for every route file at once.
 *
 * Computed as one memoised walk rather than per test, because three tests
 * asking the same question of forty-seven pages is the same graph three times.
 * A cycle answers `false` on the edge that closes it — some other path through
 * the cycle still reports the reach, so the answer for the closure is
 * unchanged, and nothing recurses forever.
 */
function reachTable(): (file: string) => boolean {
  const answers = new Map<string, boolean>();

  function reaches(file: string, visiting: Set<string>): boolean {
    const cached = answers.get(file);
    if (cached !== undefined) return cached;
    if (visiting.has(file)) return false;

    const source = readFileSync(file, "utf8");
    if (isServerActionModule(source)) {
      answers.set(file, false);
      return false;
    }

    visiting.add(file);
    let found = false;
    for (const specifier of specifiersIn(source)) {
      if (namesADatabaseModule(specifier)) {
        found = true;
        break;
      }
      const target = resolveLocal(file, specifier);
      if (target && reaches(target, visiting)) {
        found = true;
        break;
      }
    }
    visiting.delete(file);

    answers.set(file, found);
    return found;
  }

  return (file: string) => reaches(file, new Set());
}

const reachesTheDatabase = reachTable();

/** The route files that issue SQL, directly or through anything they import. */
function databaseBackedRoutes(): string[] {
  return routeFiles().filter(reachesTheDatabase);
}

function offendersAmongThem(predicate: (source: string) => boolean): string[] {
  return databaseBackedRoutes()
    .filter((file) => predicate(readFileSync(file, "utf8")))
    .map((f) => f.replace(process.cwd() + "/", ""));
}

test("the guard sees a page that reaches Postgres only through a helper", () => {
  // The guard's own guard. Every assertion below is `toEqual([])`, which a
  // `reachesTheDatabase` that answered `false` for everything would satisfy
  // perfectly — and that is exactly the bug this file shipped with, one level
  // of indirection down. So: the six wired lending screens must be *found*,
  // and every one of them reaches Postgres through `src/lib/`, not by naming
  // `db/client` or `runQuery` itself.
  //
  // Named individually rather than counted, because a count stays green while
  // the set drifts. When a later slice wires the other forty-one pages this
  // list grows; it is not a ceiling, only a floor (`toContain`).
  const found = databaseBackedRoutes().map((f) =>
    f.replace(process.cwd() + "/", "").replace(/\\/g, "/"),
  );
  const base = "src/app/tu-sach/[shelf]/quan-ly";
  for (const page of [
    `${base}/cho-muon/page.tsx`,
    `${base}/cho-muon/nguoi-doc/page.tsx`,
    `${base}/cho-muon/xac-nhan/page.tsx`,
    `${base}/nhan-tra/page.tsx`,
    `${base}/nhan-tra/bao-mat/page.tsx`,
    `${base}/sach/[id]/page.tsx`,
  ]) {
    expect(found, page).toContain(page);
  }

  // U2 Task 2. The portal is the first *public* page to reach Postgres, and
  // it reaches it through `loadPublicPage` rather than `loadPage` — a
  // different export of the same module, so the walk finds it for the same
  // reason. Worth naming individually rather than trusting the floor above:
  // this is precisely the page a reader of the caching rule would assume is
  // exempt, since its rows are identical for every visitor. That is what makes
  // it the one Next.js would prerender at build time and serve with the
  // directory frozen (U2's portal page carries the long version).
  expect(found).toContain("src/app/tu-sach/page.tsx");

  // P1's export route: the first `route.ts` in this application, and the reason
  // the glob above widened. Named individually rather than left to the floor,
  // because a glob that silently stopped matching it would take this whole file
  // back to where it was — green, and blind to the one response that carries a
  // hundred children's records.
  expect(found).toContain("src/app/tu-sach/[shelf]/quan-ly/xuat/[loai]/route.ts");

  // And the walk really is transitive: `src/lib/shelf.ts` names no page-data,
  // no client and no unit-of-work value import — it takes a `Tx` and runs SQL
  // on it — yet a page whose only reach is through it must still be caught.
  expect(reachesTheDatabase("src/lib/shelf.ts")).toBe(true);
  expect(reachesTheDatabase("src/lib/lending.ts")).toBe(true);

  // Task 6 (2026-08-10 QA remediation). `/` used to stand beside `/loi` here
  // as the guard's negative control — proof "flag everything" would not pass
  // this file — because it was marketing copy with nothing to read. It reads
  // one thing now: `loadFrontDoorViewer()`, so its header can greet a
  // signed-in visitor exactly as `/tu-sach` and `/lien-he` already do. Named
  // individually, the same as the portal above, for the reader who assumes a
  // marketing page is exempt from a caching rule about tenant data — this one
  // is exempt from nothing; a session cookie makes two visitors' correct
  // renders of the same URL disagree just as surely as two shelves' rows do.
  expect(found).toContain("src/app/page.tsx");

  // A page that reads nothing is not swept up by it. Without this, "flag
  // everything" would pass every test in the file. `/loi` is what remains of
  // that pair now that `/` has joined the pages above instead: a reference
  // sheet that renders whatever error was thrown, and nothing else.
  expect(found).not.toContain("src/app/loi/page.tsx");
});

test("every page that reaches the database is explicitly dynamic", () => {
  const offenders = offendersAmongThem(
    (source) =>
      !/export\s+const\s+dynamic\s*=\s*["']force-dynamic["']/.test(source),
  );

  expect(offenders).toEqual([]);
});

test("no page that reaches the database is also prerendered by generateStaticParams", () => {
  // `dynamic = "force-dynamic"` wins over `generateStaticParams` in Next.js,
  // so on its own this is not today's leak. It is the leak the moment the
  // marker above is removed — and the marker is one line somebody deletes
  // while chasing a stale-data bug. `generateStaticParams` in these pages is
  // always the fixture-era leftover (`shelves.map(...)` over `src/lib/
  // fixtures.ts`), which is precisely the "rendered once at build time, with
  // no session at all, and served to everyone" shape of U1 §2. Two guards
  // because the first one failing alone should not be enough to leak.
  const offenders = offendersAmongThem((source) =>
    /\bgenerateStaticParams\b/.test(source),
  );

  expect(offenders).toEqual([]);
});

test("no page that reaches the database opts into the use-cache directive", () => {
  // The second shape U1 §2 names: the Full Route Cache. `"use cache"` on a
  // page, or on a function it awaits, makes one render serve every request —
  // which for a tenant-scoped page means one shelf's HTML answering another
  // shelf's URL. `force-dynamic` and `use cache` in the same file is a
  // contradiction Next.js resolves in ways nobody should be reasoning about
  // on a page that renders children's names.
  const offenders = offendersAmongThem((source) =>
    /["']use cache["']/.test(source),
  );

  expect(offenders).toEqual([]);
});
