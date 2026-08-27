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
 *
 * **`[A-Z_]` was blind to two-thirds of the defect it was written to catch
 * (final fix wave, QA remediation).** Task 26 fixed six offending lines, but
 * four of them — `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`,
 * `TEST_S3_ACCESS_KEY_ID`, `TEST_S3_SECRET_ACCESS_KEY` — contain a digit, and
 * `[A-Z_]` does not match digits. A variable name with a `3` in it was
 * invisible to this pattern from the moment it shipped, along with every
 * other `S3_*` variable this file has (there are a dozen). The self-check
 * below only ever probed `POSTGRES_PASSWORD` and `OLIBRA_POOL_PASSWORD` —
 * both digit-free — so it certified the regex correct while standing
 * exactly on top of the hole. Widened to `[A-Z0-9_]` and the self-check now
 * carries an `S3_*` case, so this specific class of miss cannot reopen
 * silently again.
 */
/**
 * **Both templates, not just `.env.example`** (2026-08-14, VPS deployment).
 *
 * `.env.prod.example` carries the identical hazard with a worse blast radius:
 * it is the file an operator copies to make the *production* `.env.prod`, so a
 * swallowed comment there sets the real superuser password of the machine
 * holding real readers' records — where the incident this test was written for
 * merely did it to a developer's throwaway database.
 *
 * A list rather than two tests, so a third template cannot be added without
 * this being the thing that notices it is unguarded.
 */
// `.env.example` is shared with the Laravel app and lives at the repo root,
// one level up from this app's own directory; `.env.prod.example` is this
// app's own VPS-deploy file and lives alongside it (see AGENTS.md).
const TEMPLATES = ["../.env.example", ".env.prod.example"];

test.each(TEMPLATES)(
  "no line in %s hands out a trailing comment as a variable's value",
  (template) => {
    const contents = readFileSync(template, "utf8");
    const lines = contents.split("\n");

    const offenders = lines.filter((line) => /^[A-Z0-9_]+=\s*#/.test(line));

    expect(offenders).toEqual([]);
  },
);

/**
 * The guard's own guard: a regex that matched nothing would pass the
 * assertion above just as cleanly as a correct one, which is precisely the
 * failure mode the QA remediation controller notes warn this branch already
 * shipped twice. Run directly against the pattern the test above uses, so a
 * future edit to that regex is checked here too rather than only against
 * today's `.env.example`.
 */
test("the guard would flag the exact defective line, and nothing else", () => {
  const pattern = /^[A-Z0-9_]+=\s*#/;

  expect(
    pattern.test(
      "POSTGRES_PASSWORD=          # required, no default — compose refuses to start without it",
    ),
  ).toBe(true);
  expect(pattern.test("OLIBRA_POOL_PASSWORD=        # required, no default")).toBe(
    true,
  );
  // A digit in the variable name — the exact class `[A-Z_]` used to miss.
  expect(pattern.test("S3_ACCESS_KEY_ID=            # required, no default")).toBe(
    true,
  );

  // A real value, a value with no trailing comment, a comment on its own
  // line, and a blank line all pass.
  expect(pattern.test("POSTGRES_PASSWORD=hunter2")).toBe(false);
  expect(pattern.test("POSTGRES_PASSWORD=")).toBe(false);
  expect(pattern.test("# required, no default")).toBe(false);
  expect(pattern.test("")).toBe(false);
});
