import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { filesUnder } from "../support/source-text";

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
 * Reading `cookies()` (which `loadPage` does on every call) already forces
 * dynamic rendering in the App Router, so today this is belt to that braces.
 * It is written down anyway because relying on it means relying on a side
 * effect of an implementation detail: move the cookie read behind a cache, add
 * a `use cache` above the component, or take the seam somewhere that resolves
 * the tenant without a cookie, and the implicit opt-out silently stops
 * applying while the page keeps rendering correctly in development, where
 * there is only ever one tenant signed in.
 *
 * Verified against the installed Next.js (16.3.0) rather than assumed from an
 * older major:
 * - `dynamic: 'force-dynamic'` is still an accepted route segment config —
 *   `node_modules/next/dist/build/segment-config/app/app-segment-config.js`
 *   parses the segment exports against a Zod schema whose `dynamic` key is
 *   `z.enum(['auto', 'error', 'force-static', 'force-dynamic'])`, and an
 *   unrecognised key or value is a build error rather than a shrug.
 * - It is honoured at render time, not merely accepted at build time:
 *   `dist/server/app-render/create-component-tree.js` branches on
 *   `dynamic === 'force-dynamic'` to abort a static render, and
 *   `dist/server/app-render/app-render.js` treats "a page with `dynamic =
 *   "force-dynamic"` did not trigger the dynamic pathway" as an internal
 *   invariant violation.
 * - `next build` reports this project's wired page as `ƒ (Dynamic)` in its
 *   route table. Measured with the marker deleted, everything else unchanged:
 *   still `ƒ`, because `loadPage` reads `cookies()`. So the marker really is
 *   belt to that braces *today* — and the five not-yet-wired lending pages
 *   beside it are still `● (SSG)`, prerendered at build time out of
 *   `src/lib/fixtures.ts`, which is what this guard has to keep from happening
 *   to a page once it holds real tenant data.
 *
 * Read as source text, with the same limits every other architecture test in
 * this directory declares: an export assembled at runtime, or re-exported from
 * another module, slips past. It catches the shape a person actually types.
 */

/**
 * A module whose presence means this file talks to Postgres.
 *
 * `lib/page-data` is the seam every wired page is meant to use. The other two
 * are here so that bypassing the seam — importing `pool()` or `runQuery`
 * straight into a page — does not also bypass the guard, which would make the
 * check depend on the mistake being made politely.
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

/** The route files Next.js renders, and therefore the ones it can cache. */
function routeFiles(): string[] {
  return filesUnder("src/app").filter((f) =>
    /\/(page|layout)\.tsx?$/.test(f.replace(/\\/g, "/")),
  );
}

function reachesTheDatabase(source: string): boolean {
  return DATABASE_REACHING_IMPORTS.some((specifier) => {
    const literal = specifier.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    return new RegExp(
      `\\b(?:from|import|require)\\s*\\(?\\s*["'][^"']*${literal}["']`,
    ).test(source);
  });
}

test("every page that reaches the database is explicitly dynamic", () => {
  const offenders = routeFiles()
    .filter((file) => {
      const source = readFileSync(file, "utf8");
      if (!reachesTheDatabase(source)) return false;
      return !/export\s+const\s+dynamic\s*=\s*["']force-dynamic["']/.test(source);
    })
    .map((f) => f.replace(process.cwd() + "/", ""));

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
  const offenders = routeFiles()
    .filter((file) => {
      const source = readFileSync(file, "utf8");
      if (!reachesTheDatabase(source)) return false;
      return /\bgenerateStaticParams\b/.test(source);
    })
    .map((f) => f.replace(process.cwd() + "/", ""));

  expect(offenders).toEqual([]);
});

test("no page that reaches the database opts into the use-cache directive", () => {
  // The second shape U1 §2 names: the Full Route Cache. `"use cache"` on a
  // page, or on a function it awaits, makes one render serve every request —
  // which for a tenant-scoped page means one shelf's HTML answering another
  // shelf's URL. `force-dynamic` and `use cache` in the same file is a
  // contradiction Next.js resolves in ways nobody should be reasoning about
  // on a page that renders children's names.
  const offenders = routeFiles()
    .filter((file) => {
      const source = readFileSync(file, "utf8");
      if (!reachesTheDatabase(source)) return false;
      return /["']use cache["']/.test(source);
    })
    .map((f) => f.replace(process.cwd() + "/", ""));

  expect(offenders).toEqual([]);
});
