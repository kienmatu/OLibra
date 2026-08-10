import { execSync } from "node:child_process";
import { expect, test } from "vitest";

/**
 * A command nothing calls is a feature nobody has.
 *
 * On 10/08/2026 a QA pass on a fresh install found five command families
 * fully implemented, fully tested, and unreachable from any screen: parish
 * units, parish taxonomy, reader credentials, membership suspension, and
 * manager assignment. Every domain test was green. This closes the seam.
 *
 * ── The extraction pattern, and why it is not the plan's own ─────────────
 *
 * The plan that specified this test handed it `export (async )?function
 * NAME` as the way to find each file's command. Every command in this
 * codebase is written `export const NAME: Command<Input, Output> = async
 * (tx, ctx, input) => { … }` — none of the fifty files this test globs uses
 * the `function` keyword for its command export — so that pattern matched
 * nothing anywhere, and this test's first run (kept as this task's RED
 * evidence, `task-3-report.md`) did not fail on the five parish-unit
 * commands it was written to catch. It failed on exactly one file,
 * `feedback.ts`, whose *only* `export function` is `phoneHash`, an ordinary
 * string-hashing helper and not a command at all — every real command,
 * parish units included, was silently treated as reachable
 * (`if (!name) return false`) purely because none of them could ever match
 * the plan's pattern. Matched against `export const NAME: Command<` here
 * instead, which is what every file in this glob actually says, and pinned
 * as the third case in the self-check at the bottom of this file so a
 * future rewrite of a command's export shape cannot quietly reintroduce the
 * same blind spot.
 */
const EXEMPT = new Set<string>([
  // Commands invoked by a CLI or the seed rather than by a screen. Add a row
  // here only with the caller named.
  // "src/domain/notifications/sweep.ts", // src/db/sweep-cli.ts
  //
  // `sweepDueNotifications` is not actually reachable through this glob at
  // all — it lives at `src/domain/notifications/sweep.ts`, outside any
  // `commands/` directory, so `ls src/domain/*/commands/*.ts` never names it
  // and no exemption is needed here. Its own caller is pinned separately by
  // `tests/architecture/the-scheduled-job-has-a-caller.test.ts`, which reads
  // the import graph rather than grepping a bare word and so does not share
  // this file's `phoneHash`-shaped blind spot.

  // Task 4 (QA remediation) gives the reader-detail screen its five missing
  // buttons — set credentials, suspend, reactivate, mark left, edit profile.
  // Each entry here is that command's own file; Task 4 deletes its own row
  // once its screen calls the command.
  "src/domain/members/commands/set-reader-credentials.ts", // TODO(Task 4): remove — reader admin actions get their UI there.
  "src/domain/members/commands/suspend-membership.ts", // TODO(Task 4): remove — reader admin actions get their UI there.
  "src/domain/members/commands/reactivate-membership.ts", // TODO(Task 4): remove — reader admin actions get their UI there.
  "src/domain/members/commands/mark-membership-left.ts", // TODO(Task 4): remove — reader admin actions get their UI there.
  "src/domain/members/commands/update-reader-profile.ts", // TODO(Task 4): remove — reader admin actions get their UI there.

  // Task 5 (QA remediation) wires `assignManager` into the managers screen.
  // `managers.ts` also exports `revokeManager` and `promoteSuperAdmin`, both
  // already called from `src/app/quan-tri/admin-actions.ts` — this test only
  // ever checks a file's *first* exported command (`head -1`, matching the
  // plan's own design), which is `assignManager` here, so the file-level
  // exemption is exactly as wide as it needs to be.
  "src/domain/admin/commands/managers.ts", // TODO(Task 5): remove — assignManager gets its UI there.

  // Pre-existing gaps, unrelated to parish units and outside Task 3's brief.
  // Found while fixing this test's extraction pattern above: with the
  // pattern actually matching, each of these five is a real command with no
  // caller anywhere in `src/app` — not a docstring mention, not an unused
  // import, nothing. Flagged in `task-3-report.md` rather than silently
  // exempted forever; not this task's to fix, and fixing five unrelated
  // command families under a "parish taxonomy screen" task would be exactly
  // the scope creep the brief's own "don't restructure outside this task"
  // rule forbids.
  "src/domain/catalogue/commands/delete-book.ts", // deleteBook — no caller found anywhere in src/app.
  "src/domain/circulation/commands/cancel-own-request.ts", // cancelOwnRequest — no caller found anywhere in src/app.
  "src/domain/circulation/commands/create-borrow-request.ts", // createBorrowRequest — no caller found anywhere in src/app.
  "src/domain/circulation/commands/void-loan.ts", // voidLoan — no caller found anywhere in src/app.
  "src/domain/community/commands/comment-moderation.ts", // createComment (first export in this multi-command file) — no caller found anywhere in src/app.
]);

/** The name of the first command a file exports, or `""` if it exports none. */
function firstCommandName(file: string): string {
  const match = execSync(
    `grep -oE 'export const [A-Za-z0-9_]+: Command<' ${file} | head -1`,
    { encoding: "utf8" },
  ).trim();
  return match.replace(/^export const /, "").replace(/: Command<$/, "");
}

test("every domain command is reachable from src/app", () => {
  const files = execSync("ls src/domain/*/commands/*.ts", { encoding: "utf8" })
    .split("\n")
    .filter(Boolean)
    .filter((f) => !EXEMPT.has(f));

  const unreachable = files.filter((file) => {
    const name = firstCommandName(file);
    if (!name) return false;
    const hits = execSync(`grep -rl '\\b${name}\\b' src/app || true`, {
      encoding: "utf8",
    }).trim();
    return hits === "";
  });

  expect(unreachable, "commands with no caller in src/app").toEqual([]);
});

test("the extraction pattern finds the command this codebase actually writes", () => {
  // Every command in this codebase is `export const NAME: Command<…>`, never
  // `export function NAME` — the plan's original pattern matched the latter
  // and so matched nothing real in any of the fifty files above. Pinned here
  // so a future rewrite of a command's export shape cannot silently return
  // this test to the state its own header describes.
  expect(
    firstCommandName("src/domain/members/commands/create-parish-unit.ts"),
  ).toBe("createParishUnit");
  // A plain helper using the `function` keyword — `phoneHash` in
  // `feedback.ts` — must not be mistaken for that file's command.
  expect(firstCommandName("src/domain/community/commands/feedback.ts")).toBe(
    "submitFeedback",
  );
});
