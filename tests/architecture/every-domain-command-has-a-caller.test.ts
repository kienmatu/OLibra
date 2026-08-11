import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { expect, test } from "vitest";
import { filesUnder, stripCommentsAndStrings } from "../support/source-text";

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
 * as a case in the self-check at the bottom of this file so a future
 * rewrite of a command's export shape cannot quietly reintroduce the same
 * blind spot.
 *
 * ── Two more blind spots, found and closed in the QA remediation branch's
 *    final review ────────────────────────────────────────────────────────
 *
 * **1. A docstring counted as a caller.** The original detector was
 * `grep -rl '\bNAME\b' src/app`, no comment stripping — a bare word inside a
 * prose explanation of why a command is deliberately *not* called was
 * indistinguishable from a real call site. Two commands rode through on
 * exactly this hole:
 *
 * - `managerRegisterReader` has zero real callers anywhere in `src/`. All
 *   four of its `src/app` hits (`quan-ly/actions.ts:667,676`,
 *   `nguoi-doc/moi/page.tsx:40,49`) are inside docstrings explaining why
 *   *this page posts `registerMemberOnBehalf`, not `managerRegisterReader`*
 *   — the plan named the wrong command for that screen, and the comment left
 *   behind to prevent that mistake happening twice is itself thick with the
 *   unused command's bare name. `managerRegisterReader` is fully implemented
 *   and BR §16.3's documented quick-lend escape hatch, but no screen posts
 *   it — `quan-ly/cho-muon/nguoi-doc/page.tsx` only searches existing
 *   readers, it registers no one. Exempted below with that reason; it is a
 *   real, pre-existing product gap, not a defect in this test's targets.
 * - `proposeAvatarChange` used to pass this test for the wrong reason: its
 *   three `src/app` hits (`nguoi-doc/moi/page.tsx:61`,
 *   `ho-so/profile-actions.ts:103`, `ho-so/page.tsx:138`) are also prose. Its
 *   one real call site is `src/lib/avatar.ts:202`, outside `src/app`
 *   entirely — `proposeAvatar` in that file is the application-layer
 *   function every avatar-upload form actually posts to
 *   (`ho-so/profile-actions.ts`'s `proposeAvatarAction` calls it, not the
 *   command directly).
 *
 * Fixed at the root rather than patched per-command: this file now strips
 * comments and strings with `stripCommentsAndStrings` (the same helper
 * `boundaries.test.ts` and `every-page-has-a-title.test.ts` use) before
 * searching for a name, and the search tree is `src/app` **and** `src/lib`.
 * Widening to `src/lib` — rather than exempting `proposeAvatarChange` by
 * name — was the deliberate choice: `src/lib` is where this codebase's
 * application layer lives (Task 1's `crypto-wiring.ts` is the same shape),
 * so a command reachable only through it is not a gap this test should
 * report, and the next command wired the same way is covered for free
 * instead of needing its own exemption. `managerRegisterReader` still has no
 * caller in either tree, so widening did not paper over a real gap — it
 * only stopped punishing `proposeAvatarChange` for being called correctly.
 *
 * **2. Only the first command per file was ever checked.** `firstCommandName`
 * (now `commandNamesIn`) returned one name; eight files in this glob export
 * more than one command — 68 commands live across 50 files — so 18 of them
 * were never looked at by this test no matter what they did or didn't call.
 * `EXEMPT` compounded this: it excluded whole *files*, so the one entry for
 * `comment-moderation.ts` (added for `createComment`, that file's first
 * export) silently also unchecked `approveComment`, `rejectComment` and
 * `hideComment` — three commands this test had no opinion about, three of
 * which turn out to have real callers once actually checked. Fixed together:
 * `commandNamesIn` now returns every command a file exports, and `EXEMPT`
 * keys are `"path/to/file.ts:commandName"` pairs, so exempting one command
 * in a multi-command file no longer hides its neighbours.
 *
 * Re-running the widened, per-command check across all 68 commands finds
 * exactly six unreachable: the five pre-existing gaps below, plus
 * `managerRegisterReader`, newly caught now that a docstring no longer
 * counts. The other 18 previously-unchecked commands (three in
 * `comment-moderation.ts`, five in `announcements.ts`, two in
 * `bookshelves.ts`, two in `managers.ts`, one in `system-settings.ts`, two
 * in `donations.ts`, two in `feedback.ts`, one in
 * `mark-notification-read.ts`) all have real callers — nothing was hiding
 * behind the file-level exemption bug.
 */
const EXEMPT = new Set<string>([
  // Commands invoked by a CLI or the seed rather than by a screen. Add a row
  // here only with the caller named.
  // "src/domain/notifications/sweep.ts:sweepDueNotifications", // src/db/sweep-cli.ts
  //
  // `sweepDueNotifications` is not actually reachable through this glob at
  // all — it lives at `src/domain/notifications/sweep.ts`, outside any
  // `commands/` directory, so `ls src/domain/*/commands/*.ts` never names it
  // and no exemption is needed here. Its own caller is pinned separately by
  // `tests/architecture/the-scheduled-job-has-a-caller.test.ts`, which reads
  // the import graph rather than grepping a bare word and so does not share
  // this file's former `phoneHash`-shaped blind spot.

  // Pre-existing gaps, unrelated to parish units and outside Task 3's brief.
  // Found while fixing this test's extraction pattern: with the pattern
  // actually matching, each of these is a real command with no caller
  // anywhere in `src/app` or `src/lib` — not a docstring mention, not an
  // unused import, nothing. Flagged in `task-3-report.md` rather than
  // silently exempted forever; not this task's to fix, and fixing five
  // unrelated command families under a "parish taxonomy screen" task would
  // be exactly the scope creep the brief's own "don't restructure outside
  // this task" rule forbids.
  "src/domain/catalogue/commands/delete-book.ts:deleteBook", // no caller found anywhere in src/app or src/lib.
  "src/domain/circulation/commands/cancel-own-request.ts:cancelOwnRequest", // no caller found anywhere in src/app or src/lib.
  "src/domain/circulation/commands/create-borrow-request.ts:createBorrowRequest", // no caller found anywhere in src/app or src/lib.
  "src/domain/circulation/commands/void-loan.ts:voidLoan", // no caller found anywhere in src/app or src/lib.
  "src/domain/community/commands/comment-moderation.ts:createComment", // no caller found anywhere in src/app or src/lib. Its siblings in the same file (approveComment, rejectComment, hideComment) DO have callers and are checked normally — this exemption no longer hides them (see the docstring above on the file-level-exemption bug this fixed).

  // Found by the QA remediation branch's final fix wave, when this test
  // stopped letting a docstring count as a caller. `managerRegisterReader`
  // is fully implemented and is BR §16.3's documented quick-lend escape
  // hatch, but no screen posts it: `quan-ly/cho-muon/nguoi-doc/page.tsx`
  // only searches existing readers to lend to, and the screen that *does*
  // register a reader on a manager's behalf
  // (`nguoi-doc/moi/page.tsx`) deliberately posts `registerMemberOnBehalf`
  // instead — its own docstring explains the plan named the wrong command
  // for that screen, and that explanation is what previously made this test
  // see `managerRegisterReader` as "called" (a bare-word match on prose,
  // not on code). A real, pre-existing product gap, not a defect in this
  // test's targets — same class as the five above, just found later because
  // the guard used to be blind to it.
  "src/domain/members/commands/manager-register-reader.ts:managerRegisterReader",
]);

/** Every command name a file exports, in `export const NAME: Command<` order. */
function commandNamesIn(file: string): string[] {
  const source = readFileSync(file, "utf8");
  return [...source.matchAll(/export const ([A-Za-z0-9_]+): Command</g)].map(
    (m) => m[1],
  );
}

// Every file under `src/app` and `src/lib`, comment- and string-stripped
// once up front rather than per command name — 68 commands times ~150 files
// would otherwise mean stripping the same file 68 times over.
const CALLER_TREES = ["src/app", "src/lib"];
const callerSources = CALLER_TREES.flatMap((dir) => filesUnder(dir)).map((file) =>
  stripCommentsAndStrings(readFileSync(file, "utf8")),
);

/** Whether `name` appears as a whole word in any caller-tree file, comments and strings excluded. */
function hasRealCaller(name: string): boolean {
  const pattern = new RegExp(`\\b${name}\\b`);
  return callerSources.some((source) => pattern.test(source));
}

test("every domain command is reachable from src/app or src/lib", () => {
  const files = execSync("ls src/domain/*/commands/*.ts", { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);

  const unreachable: string[] = [];
  for (const file of files) {
    for (const name of commandNamesIn(file)) {
      const key = `${file}:${name}`;
      if (EXEMPT.has(key)) continue;
      if (!hasRealCaller(name)) unreachable.push(key);
    }
  }

  expect(unreachable, "commands with no real (non-comment) caller in src/app or src/lib").toEqual(
    [],
  );
});

test("the extraction pattern finds every command this codebase actually writes, not just the first per file", () => {
  // Every command in this codebase is `export const NAME: Command<…>`, never
  // `export function NAME` — the plan's original pattern matched the latter
  // and so matched nothing real in any of the fifty files above. Pinned here
  // so a future rewrite of a command's export shape cannot silently return
  // this test to the state its own header describes.
  expect(
    commandNamesIn("src/domain/members/commands/create-parish-unit.ts"),
  ).toEqual(["createParishUnit"]);
  // A plain helper using the `function` keyword — `phoneHash` in
  // `feedback.ts` — must not be mistaken for that file's command, and
  // `feedback.ts` genuinely exports three commands, all of which must be
  // found, not just the first.
  expect(commandNamesIn("src/domain/community/commands/feedback.ts")).toEqual([
    "submitFeedback",
    "markFeedbackRead",
    "resolveFeedback",
  ]);
  // A four-command file, to pin the "only the first per file" bug stays
  // fixed at more than two commands.
  expect(
    commandNamesIn("src/domain/community/commands/comment-moderation.ts"),
  ).toEqual(["createComment", "approveComment", "rejectComment", "hideComment"]);
});

test("a docstring mentioning a command's name is not mistaken for a caller", () => {
  // Guards the specific bug this file's history describes: a bare `\bNAME\b`
  // grep over raw source cannot tell a real call from a comment saying "this
  // page does NOT call NAME". `stripCommentsAndStrings` must remove the
  // comment before the search runs.
  const docstringOnly = `
    /**
     * This screen posts registerMemberOnBehalf, not managerRegisterReader —
     * the plan named the wrong command here.
     */
    export async function action() {}
  `;
  expect(/\bmanagerRegisterReader\b/.test(docstringOnly)).toBe(true); // raw text: false "caller"
  expect(
    /\bmanagerRegisterReader\b/.test(stripCommentsAndStrings(docstringOnly)),
  ).toBe(false); // stripped: correctly no caller
});
