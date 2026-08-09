import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { NOTIFICATION_KINDS } from "../../src/domain/notifications/kinds";

function filesUnder(dir: string): string[] {
  let out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out = out.concat(filesUnder(path));
    else if (path.endsWith(".ts")) out.push(path);
  }
  return out;
}

/**
 * BR §15 and OPS §7: **managers get no notifications, by design.** The
 * requirements give the reason rather than leaving it to taste — it "avoids
 * notification fatigue for volunteers and removes any dependency on timely
 * background work", and managers work from the dashboard's live counts instead.
 *
 * "Never" is the hard shape to test. A behavioural test can only show that the
 * commands somebody thought to exercise do not notify a manager; the rule has to
 * hold for the ones nobody thought of, including the next one written. So this
 * enumerates the call sites instead and pins them against OPS §7's own table.
 * Adding a notification anywhere fails this test until the table it is added to
 * is updated deliberately.
 *
 * Two things it does not claim:
 *
 * - It does not prove the *recipient* is a reader — that is
 *   `notifications.test.ts`'s "approving a registration tells the reader, and
 *   nobody else", which asserts the row count as well as the user, because
 *   notifying the actor is the ordinary way this rule gets broken.
 * - It reads source text, so a `notify` reached through an alias or a wrapper
 *   would slip past. The backstop is the other direction: `NotificationKind` is
 *   `keyof typeof NOTIFICATIONS`, so a kind that no sentence covers does not
 *   compile, and the second test below fails when a kind has no writer at all.
 */

/** OPS §7's table, as code. Each kind, and the file the catalogue says writes it. */
const OPS_SECTION_7: Record<string, string[]> = {
  membership_approved: ["src/domain/members/commands/approve-membership.ts"],
  membership_rejected: ["src/domain/members/commands/reject-membership.ts"],
  request_approved: [
    "src/domain/circulation/commands/approve-borrow-request.ts",
    // "…and the equivalent effect inside `ReceiveReturn` when it holds for the
    // next reader" — OPS §7, verbatim. One kind, two doors.
    "src/domain/circulation/commands/receive-return.ts",
  ],
  request_rejected: ["src/domain/circulation/commands/reject-borrow-request.ts"],
  comment_approved: ["src/domain/community/commands/comment-moderation.ts"],
  // "Not written by any command in §4 — see below." The sweep is the exception
  // OPS §7 argues for at length, and it is not a command.
  loan_due_soon: ["src/domain/notifications/sweep.ts"],
  loan_overdue: ["src/domain/notifications/sweep.ts"],
};

/** Every file under `src/domain` that mentions a kind in a writing position. */
function writersOf(kind: string): string[] {
  return filesUnder("src/domain")
    .filter((file) => {
      if (file.endsWith("kinds.ts")) return false; // the map itself
      const source = readFileSync(file, "utf8");
      // `kind: "x"` for a `notify` call, or `'x'` inside the sweep's SQL.
      return (
        new RegExp(`kind:\\s*"${kind}"`).test(source) ||
        new RegExp(`'${kind}'`).test(source)
      );
    })
    .map((f) => f.replace(process.cwd() + "/", ""))
    .sort();
}

test("every notification is written where OPERATIONS §7 says it is", () => {
  for (const kind of NOTIFICATION_KINDS) {
    expect(writersOf(kind), kind).toEqual([...OPS_SECTION_7[kind]].sort());
  }
});

test("the table this guards covers every kind that exists", () => {
  // Keeps the map above honest. A kind added to `kinds.ts` with no entry here
  // would otherwise be guarded by nothing at all — the same failure mode
  // `ci-supplies-required-env.test.ts` closes for environment variables.
  expect([...NOTIFICATION_KINDS].sort()).toEqual(Object.keys(OPS_SECTION_7).sort());
});

test("nothing outside src/domain writes a notification", () => {
  // The surface renders them and marks them read; it never authors one. A page
  // that inserted its own would bypass the transaction rule OPS §7 states, since
  // a page has no command transaction to be inside of.
  const offenders = [...filesUnder("src/app"), ...filesUnder("src/lib")]
    .filter((f) =>
      /insert\s+into\s+notifications|notifications\/write/.test(
        readFileSync(f, "utf8"),
      ),
    )
    .map((f) => f.replace(process.cwd() + "/", ""));

  expect(offenders).toEqual([]);
});
