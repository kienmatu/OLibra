import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { migrate } from "../../../src/db/migrate";
import { fixedClock } from "../../../src/domain/kernel/clock";
import { DomainError } from "../../../src/domain/kernel/errors";
import type { TenantContext } from "../../../src/domain/kernel/tenant";
import { runCommand } from "../../../src/domain/kernel/unit-of-work";
import { approveProfileChange } from "../../../src/domain/members/commands/approve-profile-change";
import { cancelProfileChange } from "../../../src/domain/members/commands/cancel-profile-change";
import { proposeAvatarChange } from "../../../src/domain/members/commands/propose-avatar-change";
import { proposeProfileChange } from "../../../src/domain/members/commands/propose-profile-change";
import {
  closeAll,
  resetDatabase,
  sql,
  withDelayedQuery,
  withTwoConnections,
} from "../../support/db";
import { makeMember, makeShelf } from "../../support/factories";

/**
 * The profile-change lifecycle under concurrency — two people acting on one
 * person's record at the same moment.
 *
 * Everything here was found by review rather than by the suite, and both
 * findings have the same cause: the lifecycle touches two tables (`users` and
 * `profile_change_requests`) and had no agreed order between them.
 * `src/domain/members/profile-fields.ts`'s `lockPerson` is that order now, and
 * these are the tests that hold it.
 *
 * **The interleaving is forced, not hoped for.** `withDelayedQuery` holds one
 * command's own read open, inside its own transaction, past its own await,
 * while a second, fully separate command runs against a second connection. A
 * plain two-connection race would land in the window sometimes and pass against
 * an implementation with no lock at all — wave A already found a delay-based
 * concurrency test in this project that proved nothing, so each test below was
 * run against the unlocked implementation first and observed to fail.
 */

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

const clock = fixedClock("2026-08-09T02:00:00Z");

async function shelfWithReader() {
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  const manager = await makeMember(sql, shelf.id, { role: "manager" });
  const reader = await makeMember(sql, shelf.id, { status: "active" });
  const managerCtx: TenantContext = {
    bookshelfId: shelf.id,
    actor: { userId: manager.userId, membershipId: manager.id, role: "manager" },
    clock,
  };
  const readerCtx: TenantContext = {
    bookshelfId: shelf.id,
    actor: { userId: reader.userId, membershipId: reader.id, role: "reader" },
    clock,
  };
  return { shelf, manager, reader, managerCtx, readerCtx };
}

const pending = (userId: string) =>
  sql<{ id: string; status: string; proposed_values: Record<string, string> }[]>`
    select id, status, proposed_values from profile_change_requests
     where user_id = ${userId}
  `.then((rows) => rows[0]);

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("two proposals landing together merge; neither is silently overwritten", async () => {
  // IMPORTANT 2. A parent uploads their child's photograph in one tab and
  // corrects the phone number in another. Before `lockPerson`, both commands
  // read the same pending row, each merged onto that same stale copy, and
  // whichever wrote second replaced `proposed_values` **wholesale** — with both
  // commands reporting success. Reproduced three times against the real
  // commands: twice the phone proposal vanished; once the photograph did,
  // which additionally left its object sitting in a public bucket referenced by
  // nothing and deletable by no code path.
  //
  // The assertion is deliberately about all three keys at once. A test that
  // checked only `phone` would pass against an implementation that had lost the
  // storage key, which is the more expensive half of the same bug.
  const { reader, readerCtx } = await shelfWithReader();

  // A pending request already exists — which is the shape the failure needs.
  // With no pending row both commands insert, and the unique index turns the
  // loser into `change_already_pending` rather than into a lost update.
  // `makeMember` -> `makeUser` seeds every reader with saint_name "Maria"
  // (PO feedback round 1, Task 1), so the proposal below has to name a
  // different value or `proposeProfileChange`'s own "not a proposal" filter
  // ("a field proposed at its current value is not a proposal") drops it and
  // there is no pending row for the race to interleave against.
  await runCommand(sql, readerCtx, proposeProfileChange, {
    membershipId: reader.id,
    fields: { saint_name: "Giuse" },
  });

  await withTwoConnections(async (a, b) => {
    let releaseGate: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    // `readPendingProposal`'s own select, and nothing else: the update in
    // `writePendingProposal` mentions the same two columns but does not begin
    // `select id, proposed_values`.
    const delayedA = withDelayedQuery(
      a,
      (s) => s.includes("select id, proposed_values"),
      gate,
    );

    const photograph = runCommand(delayedA, readerCtx, proposeAvatarChange, {
      membershipId: reader.id,
      avatarUrl: "http://localhost:9000/olibra/avatars/a.png",
      avatarObject: "avatars/a.png",
    });
    // Long enough for A's read to have been sent and its delayed resolution
    // queued, so B starts strictly inside A's window.
    await pause(50);

    const phone = runCommand(b, readerCtx, proposeProfileChange, {
      membershipId: reader.id,
      fields: { phone: "0912345678" },
    });
    // B is *not* awaited before the gate is released, unlike the two-connection
    // test in `catalogue/book-lifecycle.test.ts`. With the lock in place B
    // blocks here until A commits, so awaiting it first would deadlock the
    // test itself; without the lock B sails past and the bug reproduces.
    await pause(150);
    releaseGate();
    await Promise.all([photograph, phone]);
  });

  const row = await pending(reader.userId);
  expect(row.proposed_values.saint_name).toBe("Giuse");
  expect(row.proposed_values.phone).toBe("0912345678");
  expect(row.proposed_values.avatar_url).toBe(
    "http://localhost:9000/olibra/avatars/a.png",
  );
  expect(row.proposed_values.avatar_object).toBe("avatars/a.png");
});

/**
 * Runs approve and cancel against one pending request with the interleaving
 * forced, and reports what each of them did.
 *
 * `first` names the command whose own read is held open while the other runs,
 * so the two directions of the race are one function called twice. The
 * assertion both callers make is the same: whatever happens, neither side may
 * come back with a `PostgresError`. `attempt()` in the profile screen's action
 * catches `DomainError` and rethrows everything else, so a `40P01` reaching a
 * caller is a 500 with no Vietnamese — OPS §2 forbids exactly that.
 */
async function raceApproveAgainstCancel(first: "approve" | "cancel") {
  const { reader, readerCtx, managerCtx } = await shelfWithReader();
  await runCommand(sql, readerCtx, proposeProfileChange, {
    membershipId: reader.id,
    fields: { phone: "0912345678" },
  });
  const request = await pending(reader.userId);

  const approve = (handle: Parameters<typeof runCommand>[0]) =>
    runCommand(handle, managerCtx, approveProfileChange, {
      profileChangeRequestId: request.id,
    });
  const cancel = (handle: Parameters<typeof runCommand>[0]) =>
    runCommand(handle, readerCtx, cancelProfileChange, {
      membershipId: reader.id,
      profileChangeRequestId: request.id,
    });

  // Where each command has to be held for the *old* interleaving to be
  // reachable: at the moment it holds the first of its two locks and has not
  // yet asked for the second. Held anywhere earlier the race cannot form at
  // all, and a test that held it earlier would pass against the deadlocking
  // implementation — which is the failure mode this file's header names.
  //
  // - approve: after `applyProfileFields`' statement (`with prev as (…) update
  //   users …`), which is where it takes `for update` on the reader's `users`
  //   row. Its next act is the `update profile_change_requests` it deadlocked on.
  // - cancel: after its own `update profile_change_requests`, which is where it
  //   takes the request row. Its next act is the audit insert, whose `actor_id`
  //   foreign key needs `FOR KEY SHARE` on that same `users` row.
  const heldAt =
    first === "approve"
      ? (s: string) => s.includes("with prev as")
      : (s: string) => s.includes("update profile_change_requests");

  return withTwoConnections(async (a, b) => {
    let releaseGate: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const delayed = withDelayedQuery(a, heldAt, gate);

    const held = first === "approve" ? approve(delayed) : cancel(delayed);
    await pause(50);
    const other = first === "approve" ? cancel(b) : approve(b);
    await pause(150);
    releaseGate();

    const outcomes = await Promise.allSettled([held, other]);
    return outcomes.map((o) =>
      o.status === "fulfilled"
        ? { ok: true as const }
        : { ok: false as const, error: o.reason as unknown },
    );
  });
}

/** A driver-level fault — the thing neither direction may produce. */
function isDriverError(error: unknown): boolean {
  return !(error instanceof DomainError);
}

for (const first of ["approve", "cancel"] as const) {
  test(`approving and cancelling at the same moment refuses in Vietnamese, not with a deadlock (${first} first)`, async () => {
    // IMPORTANT 3, confirmed 3/3 in both directions before the fix: approval
    // held `for update` on the reader's `users` row and then updated
    // `profile_change_requests`; cancellation held the request row and then
    // needed `FOR KEY SHARE` on the same `users` row for its audit entry's
    // `actor_id`. A manager clicking *Duyệt* as the reader clicked *Huỷ* got
    // `deadlock detected`, and the loser's 40P01 escaped `attempt()` as a 500.
    //
    // Both directions are tested because a lock order is only fixed if it is
    // fixed from both ends — the version of this fix that reorders one command
    // and not the other passes one of these two tests.
    const outcomes = await raceApproveAgainstCancel(first);

    const failures = outcomes.filter((o) => !o.ok);
    for (const failure of failures) {
      expect(
        isDriverError(failure.error),
        `expected a DomainError, got ${String(failure.error)}`,
      ).toBe(false);
    }
    // One of them wins and the other is told the request is already decided —
    // never both, and never neither.
    expect(outcomes.filter((o) => o.ok)).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect((failures[0].error as DomainError).code).toBe(
      "profile_change_not_pending",
    );
  });
}
