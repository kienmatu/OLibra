import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

/**
 * Task 7 (2026-08-10 QA remediation) renamed the reader area from `toi` to
 * `ho-so` and left three permanent redirects in `next.config.ts` for anyone
 * holding an old URL. Next matches redirects top to bottom and stops at the
 * first hit, so the entry for `/toi/ho-so` — the old profile page, which
 * became the new area's own index at `/ho-so` — has to appear *before* the
 * `/toi/:rest*` catch-all. Reversed, `/toi/ho-so` would match the wildcard
 * first and land on `/ho-so/ho-so`, a route that does not exist.
 *
 * Read as text rather than imported and invoked, matching this directory's
 * other config-reading tests (e.g. `ci-pins-the-storage-image.test.ts`):
 * `next.config.ts` only carries an `import type` from `next`, so nothing stops
 * it importing cleanly under Vitest, but a text match is a weaker, harder-to-
 * get-subtly-wrong claim than parsing the module and calling `redirects()`.
 */
test("the /toi -> /ho-so redirects exist, are permanent, and /toi/ho-so precedes the /toi/:rest* wildcard", () => {
  const config = readFileSync("next.config.ts", "utf8");
  const body = config.match(/async redirects\(\) \{[\s\S]*?\n  \},\n\};/)?.[0];
  expect(body).toBeDefined();

  const sources = [...body!.matchAll(/source: "([^"]+)"/g)].map((m) => m[1]);
  const destinations = [...body!.matchAll(/destination: "([^"]+)"/g)].map(
    (m) => m[1],
  );
  const permanents = [...body!.matchAll(/permanent: (true|false)/g)].map(
    (m) => m[1],
  );

  expect(sources).toEqual([
    "/tu-sach/:shelf/toi",
    "/tu-sach/:shelf/toi/ho-so",
    "/tu-sach/:shelf/toi/:rest*",
  ]);
  expect(destinations).toEqual([
    "/tu-sach/:shelf/ho-so/tong-quan",
    "/tu-sach/:shelf/ho-so",
    "/tu-sach/:shelf/ho-so/:rest*",
  ]);
  // A bookmark is not a request the reader repeats deliberately — 308s so
  // browsers cache the new address rather than re-asking the server forever.
  expect(permanents).toEqual(["true", "true", "true"]);

  // The load-bearing assertion: `/toi/ho-so` before the catch-all.
  const profileIndex = sources.indexOf("/tu-sach/:shelf/toi/ho-so");
  const wildcardIndex = sources.indexOf("/tu-sach/:shelf/toi/:rest*");
  expect(profileIndex).toBeGreaterThanOrEqual(0);
  expect(wildcardIndex).toBeGreaterThanOrEqual(0);
  expect(profileIndex).toBeLessThan(wildcardIndex);
});
