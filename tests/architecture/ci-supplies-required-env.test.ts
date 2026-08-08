import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

/**
 * CI must supply every environment variable the suite needs.
 *
 * `vitest.config.ts` loads `.env` through dotenv, so a variable that exists
 * only in a developer's `.env` is invisible locally and missing in CI. That is
 * not hypothetical: `20260808_13_pool_role.sql` and `TEST_POOL_DATABASE_URL`
 * shipped without being added to the workflow, `bun run check` stayed green on
 * every machine that had run `cp .env.example .env`, and `main` went red for
 * three merges before anyone looked at the badge.
 *
 * This test compares the two files, so the failure lands in the suite the
 * author is already running rather than on a page they have to remember to
 * open.
 *
 * It reads the workflow as text on purpose. Parsing the YAML would mean
 * agreeing with the parser about anchors, multi-line scalars and which job's
 * `env:` block a key belongs to; "the string appears in the file that
 * configures CI" is a weaker claim but one that cannot itself be subtly wrong.
 */

/** Variables `.env.example` documents that are only meaningful to the suite. */
const REQUIRED_IN_CI = [
  "TEST_DATABASE_URL",
  "TEST_POOL_DATABASE_URL",
  "OLIBRA_POOL_PASSWORD",
];

test("every variable the test suite needs is set in the CI workflow", () => {
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  const missing = REQUIRED_IN_CI.filter((name) => !workflow.includes(name));
  expect(missing).toEqual([]);
});

test("the variables this test guards are the ones .env.example documents", () => {
  // Keeps the list above honest. If `.env.example` grows a test-only variable
  // and nobody adds it here, this fails and names it — rather than the suite
  // going green locally and red in CI, which is the whole failure mode.
  const example = readFileSync(".env.example", "utf8");
  const documented = [...example.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map(
    (m) => m[1],
  );

  const testOnly = documented.filter(
    (name) => name.startsWith("TEST_") || name === "OLIBRA_POOL_PASSWORD",
  );

  expect([...testOnly].sort()).toEqual([...REQUIRED_IN_CI].sort());
});
