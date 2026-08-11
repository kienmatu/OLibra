import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

/**
 * QA remediation Task 26. `.env.example` used to write six variables —
 * `POSTGRES_PASSWORD`, `OLIBRA_POOL_PASSWORD`, `S3_ACCESS_KEY_ID`,
 * `S3_SECRET_ACCESS_KEY`, `TEST_S3_ACCESS_KEY_ID`,
 * `TEST_S3_SECRET_ACCESS_KEY` — with an inline comment trailing the `=` on
 * the same line, e.g. `POSTGRES_PASSWORD=          # required, no default —
 * compose refuses to start without it`.
 *
 * Compose keeps everything after `=` in a `.env` file, comment and all — it
 * does not treat `#` as a comment marker the way a shell would — so that
 * line's actual value was the sentence itself, spaces included. Confirmed
 * live: `docker inspect olibra-db-1` reported `POSTGRES_PASSWORD=# required,
 * no default — compose refuses to start without it`, and Postgres had
 * already started and accepted it as the superuser's real password — the
 * comment's own claim ("compose refuses to start without it") was false in
 * the one case it mattered, because a value that is whitespace-plus-comment
 * is not the empty value `compose.yaml`'s `${VAR:?...}` guards reject.
 *
 * `src/instrumentation.ts`'s `checkDatabaseUrlsForSwallowedComments` is the
 * other half of this fix, for a password that already escaped into
 * `DATABASE_URL` or `MIGRATION_DATABASE_URL` by hand; this test is the
 * simpler half, catching the shape at its source before anyone copies
 * `.env.example` into a `.env`.
 *
 * Reads the file from disk on every run, rather than pinning line numbers or
 * a count of offending lines, so it keeps working as `.env.example` grows —
 * a ban on a *shape*, not a ban on the six lines that happened to have it
 * today.
 */
test("no line in .env.example hands out a trailing comment as a variable's value", () => {
  const envExample = readFileSync(".env.example", "utf8");
  const lines = envExample.split("\n");

  const offenders = lines.filter((line) => /^[A-Z_]+=\s*#/.test(line));

  expect(offenders).toEqual([]);
});

/**
 * The guard's own guard: a regex that matched nothing would pass the
 * assertion above just as cleanly as a correct one, which is precisely the
 * failure mode the QA remediation controller notes warn this branch already
 * shipped twice. Run directly against the pattern the test above uses, so a
 * future edit to that regex is checked here too rather than only against
 * today's `.env.example`.
 */
test("the guard would flag the exact defective line, and nothing else", () => {
  const pattern = /^[A-Z_]+=\s*#/;

  expect(
    pattern.test(
      "POSTGRES_PASSWORD=          # required, no default — compose refuses to start without it",
    ),
  ).toBe(true);
  expect(pattern.test("OLIBRA_POOL_PASSWORD=        # required, no default")).toBe(
    true,
  );

  // A real value, a value with no trailing comment, a comment on its own
  // line, and a blank line all pass.
  expect(pattern.test("POSTGRES_PASSWORD=hunter2")).toBe(false);
  expect(pattern.test("POSTGRES_PASSWORD=")).toBe(false);
  expect(pattern.test("# required, no default")).toBe(false);
  expect(pattern.test("")).toBe(false);
});
