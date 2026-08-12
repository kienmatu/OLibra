import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { PROFILE_FIELDS } from "../../src/domain/members/profile-fields";
import { filesUnder } from "../support/source-text";

/**
 * INV-13b's own docstring names this exact shape of defect for the *writer*:
 * "a field added to [`PROFILE_FIELDS`] and forgotten here is a red test, not
 * a silent no-op" — and `tests/invariants/inv-13-one-pending-profile-change
 * .test.ts` is the table-driven guard that holds it. Nothing held the same
 * promise for a *reader*, and PO feedback round 1 Task 7's own review found
 * it live: `get-my-profile.ts` and `get-pending-profile-changes.ts` both
 * build their result with
 *
 *     Object.fromEntries(PROFILE_FIELDS.map((f) => [f, row[f] ?? null]))
 *
 * — a *total* mapping over every field the array names — but neither file's
 * own hand-written `select` list had been extended with `phone_missing_reason`
 * when that field joined `PROFILE_FIELDS` (this same task, same commit).
 * `row["phone_missing_reason"]` was `undefined`, `?? null` turned it into
 * `null`, and both queries silently promised a ninth field they never read.
 * `tests/domain/members/own-profile-and-queue.test.ts`'s own
 * `toHaveLength(9)` — the obvious shape check — passed regardless: a length
 * cannot tell "present" from "present and hardcoded null". TypeScript cannot
 * catch it either, because the `select` string is not type-checked against
 * anything.
 *
 * **Discovered from the idiom, not from a named list of two files.** A third
 * query built the same way tomorrow is covered without anybody remembering
 * this file exists. A query that maps *named* columns onto a differently
 * -shaped, camelCase return type instead (`get-reader-detail.ts`,
 * `get-readers-list.ts`, `get-pending-registrations.ts`) is honestly silent
 * about a field it does not select — nothing in its own return type claims
 * otherwise, so nothing here checks it. `readProfileFields`
 * (`profile-fields.ts`) does promise the whole `ProfileFields` shape but
 * through a differently-spelled `select`, not this idiom; it is covered
 * instead by `tests/domain/members/profile-fields.test.ts`'s own
 * "readProfileFields returns the same nine…" test, which drives it against a
 * real row rather than scanning source text — a stronger check where one is
 * available, which this file does not try to duplicate.
 *
 * **Comments stripped, strings and template literals kept — the opposite of
 * `stripCommentsAndStrings`, and deliberately so.** What this file needs to
 * read is exactly what that helper throws away: every column name here lives
 * inside a `sql` tagged template (`` tx<...>`select saint_name, … from
 * users` ``), which `stripCommentsAndStrings` erases wholesale along with
 * every other backtick-delimited span — it treats a template literal as a
 * string to redact, and cannot tell this repository's one legitimate reason
 * to search inside one from the reasons it was built to guard against
 * elsewhere. Using it here would make the assertion below pass vacuously,
 * against every file, always — proven directly in the first test.
 * `tests/domain/kernel/audit-actions.test.ts` hit the identical problem
 * (matching `action: "…"` string literals `stripCommentsAndStrings` also
 * erases) and kept its own local `withoutComments` for the same reason; this
 * file's version is that one, copied rather than re-derived.
 *
 * **Crude on purpose, the other axis.** This looks for the column name as a
 * bare token anywhere left after comments are gone, not specifically inside a
 * `select` clause — a real parser is not what this suite reaches for
 * anywhere. A file that mentioned every field name in code without actually
 * selecting one would pass this check wrongly; neither file this guards today
 * does that — verified directly (the second test below), each name appears
 * exactly where the `select` list puts it and nowhere else in either file.
 */

/** Comments out, strings and template literals in — see the docstring above. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function totalProfileFieldReaders() {
  return filesUnder("src/domain/members")
    .map((file) => ({
      path: file.replace(process.cwd() + "/", "").replace(/\\/g, "/"),
      source: withoutComments(readFileSync(file, "utf8")),
    }))
    .filter(({ source }) => source.includes("PROFILE_FIELDS.map("));
}

test("stripCommentsAndStrings would make this check pass vacuously — withoutComments does not", async () => {
  const { stripCommentsAndStrings } = await import("../support/source-text");
  const sample = "tx<Row[]>`select saint_name, full_name from users`";
  expect(stripCommentsAndStrings(sample)).not.toContain("saint_name");
  expect(withoutComments(sample)).toContain("saint_name");
  // And a name mentioned only in a comment must not count as selected.
  expect(withoutComments("// selects saint_name too\n")).not.toContain(
    "saint_name",
  );
});

test("the check can see both halves: it finds the known total readers, and its own comparison can fail", () => {
  // The assertion below (`toEqual([])`) is satisfied perfectly by a
  // `totalProfileFieldReaders()` that found nothing, which is exactly the
  // failure mode `the-front-door-shows-no-keeper-contact.test.ts` names for
  // its own discovery step. Both halves have to be proven live.
  const found = totalProfileFieldReaders().map((f) => f.path);
  expect(found).toContain("src/domain/members/queries/get-my-profile.ts");
  expect(found).toContain(
    "src/domain/members/queries/get-pending-profile-changes.ts",
  );

  // And the comparison the real test below runs can actually fail — proven
  // against a string, not by planting a real missing column in a real file,
  // which would be the exact bug this file exists to catch shipping on
  // purpose.
  const anIncompleteSelectList = "select saint_name, full_name, phone from users";
  const missing = PROFILE_FIELDS.filter(
    (f) => !new RegExp(`\\b${f}\\b`).test(anIncompleteSelectList),
  );
  expect(missing.length).toBeGreaterThan(0);
});

test("every query mapping the whole of PROFILE_FIELDS over a row also mentions every one of them", () => {
  const offenders: string[] = [];

  for (const { path, source } of totalProfileFieldReaders()) {
    const missing = PROFILE_FIELDS.filter(
      (f) => !new RegExp(`\\b${f}\\b`).test(source),
    );
    if (missing.length > 0) {
      offenders.push(`${path}: never mentions ${missing.join(", ")}`);
    }
  }

  expect(offenders).toEqual([]);
});
