import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { filesUnder } from "../support/source-text";

/**
 * **A job nothing runs is a feature that does not exist**, and this one had a
 * docstring, a test suite and no caller.
 *
 * `sweepDueNotifications` (`src/domain/notifications/sweep.ts`) is the single
 * scheduled job OPS §7 permits. D1 wrote it, argued the exception carefully,
 * made it idempotent by a `not exists` rather than a cursor, and tested that
 * running it twice tells a child once. Nothing called it. A grep across `src`,
 * `scripts` and `package.json` returned the definition and nothing else, so
 * BR §15's *"nhắc trả sách"* had never fired in any deployment.
 *
 * **It was invisible because of the very property that makes the job safe.**
 * OPS §7 bounds it: "if it doesn't run for a few hours, nothing a user can
 * observe becomes wrong (the loan's overdue badge is still correct, computed
 * live), only late to be told." Every badge, every dashboard count and every
 * manager's overdue list derives from `olibra_now()` and was correct the whole
 * time. A job that never ran at all looked exactly like a working system.
 *
 * No test could catch that, because every test *calls the function*. The gap is
 * not in what the sweep does; it is in whether anything invokes it. So this
 * reads the wiring instead:
 *
 * 1. Something outside `src/domain/` imports it — an entry point, not another
 *    domain module quoting it in prose.
 * 2. `package.json` exposes that entry point as a script, so the answer to "how
 *    do I run this nightly" is in the repository rather than in somebody's
 *    crontab.
 *
 * Neither half is sufficient alone. An entry point no script names is one
 * nobody finds; a script naming a file that does not import the sweep runs
 * something else.
 */

const SWEEP = "sweepDueNotifications";

/** Files outside the domain that name `sweepDueNotifications` in an import. */
function callersOf(symbol: string): string[] {
  return filesUnder("src")
    .map((f) => f.replace(process.cwd() + "/", "").replace(/\\/g, "/"))
    .filter((f) => !f.startsWith("src/domain/"))
    .filter((f) => /\.tsx?$/.test(f))
    .filter((f) => {
      const source = readFileSync(f, "utf8")
        // Comments out: this very file's neighbours discuss the sweep in prose,
        // and a docstring mentioning it is not a caller.
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
      return new RegExp(`import[^;]*\\b${symbol}\\b[^;]*from`, "s").test(source);
    });
}

test("the one permitted scheduled job is imported by a runnable entry point", () => {
  const callers = callersOf(SWEEP);

  expect(callers, `nothing outside src/domain imports ${SWEEP}`).not.toEqual([]);
  expect(callers).toContain("src/db/sweep-cli.ts");
});

test("and package.json exposes that entry point as a script", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
    scripts: Record<string, string>;
  };

  const naming = Object.entries(pkg.scripts).filter(([, cmd]) =>
    cmd.includes("src/db/sweep-cli.ts"),
  );

  expect(naming.map(([name]) => name)).toEqual(["db:sweep"]);
});

test("the check would notice if the caller stopped calling", () => {
  // Its own guard, for the reason every rule in this directory has one: both
  // assertions above are satisfied by a detector that matches too eagerly.
  //
  // A file that only *mentions* the symbol is not a caller…
  expect(
    new RegExp(`import[^;]*\\b${SWEEP}\\b[^;]*from`, "s").test(
      "// see sweepDueNotifications for why\nconst x = 1;",
    ),
  ).toBe(false);
  // …and one that imports it is.
  expect(
    new RegExp(`import[^;]*\\b${SWEEP}\\b[^;]*from`, "s").test(
      'import { sweepDueNotifications } from "../domain/notifications/sweep";',
    ),
  ).toBe(true);

  // The domain is excluded on purpose: the module that *defines* the sweep
  // must not count as the thing that runs it.
  expect(callersOf(SWEEP)).not.toContain("src/domain/notifications/sweep.ts");
});
