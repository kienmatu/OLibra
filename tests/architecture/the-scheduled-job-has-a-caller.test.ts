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
 *
 * **A third half, added in QA remediation Task 24: something has to invoke
 * the script, unattended, on a schedule.** The first two halves prove `bun
 * run db:sweep` is a real, runnable command — they do not prove anything ever
 * types it. That gap was the entire finding this file exists to name: a CLI
 * with a docstring, a test suite, a `package.json` entry and still zero
 * callers in any deployment, because nothing scheduled it. A CLI is the same
 * shape of nothing-calls-it risk one level up, and the fix is the same kind
 * of check — read the wiring, not the behaviour, because every test of
 * *this* also calls the thing it's testing.
 *
 * So a third assertion: `compose.yaml` must define a service that runs `bun
 * run db:sweep`. Not merely mention it — `compose.yaml`'s own comments on
 * that service discuss `db:sweep` in prose at length, for the same reason
 * `sweep-cli.ts`'s docstring does, and a comment is not a scheduler any more
 * than it was a caller two paragraphs up. `serviceBlock` below isolates one
 * named service's body from the rest of the file (and from full-line `#`
 * comments) before the search runs, mirroring `callersOf`'s comment-stripping
 * for exactly the same reason.
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

/**
 * One named service's body from `compose.yaml`, comments stripped — from its
 * `  <name>:` line up to (not including) the next line at the same
 * two-space indent, which is the next service. `""` if no such service
 * exists at all.
 *
 * Not a YAML parser, deliberately, the same disclaimer `source-text.ts` makes
 * for its TypeScript counterpart: it does not resolve anchors, does not
 * understand flow-style mappings, and would mis-slice a service whose name
 * is indented differently from every other one in this file. It has to
 * correctly slice exactly the one file this repository has, not YAML in
 * general.
 */
function serviceBlock(compose: string, name: string): string {
  const withoutComments = compose
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");

  const lines = withoutComments.split("\n");
  const start = lines.findIndex((line) => line === `  ${name}:`);
  if (start === -1) return "";

  const rest = lines.slice(start + 1);
  const next = rest.findIndex((line) => /^ {2}\S/.test(line));
  return lines.slice(start, next === -1 ? undefined : start + 1 + next).join("\n");
}

test("and compose.yaml actually schedules that entry point, not only defines it", () => {
  // The two tests above prove `bun run db:sweep` is runnable. Neither proves
  // anything runs it — that was BR §15's reminders' entire failure mode until
  // this task: a caller existed, and nobody had ever typed the command.
  const compose = readFileSync("compose.yaml", "utf8");
  const sweepService = serviceBlock(compose, "sweep");

  expect(sweepService, "compose.yaml defines no `sweep:` service").not.toBe("");
  expect(sweepService).toMatch(/db:sweep/);
});

test("the check would notice if the scheduler stopped scheduling", () => {
  // Its own guard, matching the caller check's own three lines down: a
  // detector that matches `db:sweep` anywhere in the file, comments included,
  // would stay green forever — this file's own docstring above names
  // `db:sweep` three times in prose, and none of those is a scheduler.
  const commentOnly = `
services:
  # runs bun run db:sweep, eventually, once somebody adds the service
  app:
    image: olibra-app:latest
`;
  expect(serviceBlock(commentOnly, "sweep")).toBe("");

  // A service that exists but doesn't run the sweep is caught too — the
  // service block itself must contain the command, not merely exist.
  const wrongService = `
services:
  sweep:
    image: olibra-app:latest
    command: ["bun", "run", "start"]
  app:
    image: olibra-app:latest
`;
  expect(serviceBlock(wrongService, "sweep")).not.toMatch(/db:sweep/);

  // And the real shape passes: a named service whose own body runs it.
  const realService = `
services:
  sweep:
    image: olibra-app:latest
    command: ["bun", "run", "db:sweep"]
  app:
    image: olibra-app:latest
`;
  expect(serviceBlock(realService, "sweep")).toMatch(/db:sweep/);
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
