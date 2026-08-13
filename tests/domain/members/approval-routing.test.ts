import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { migrate } from "../../../src/db/migrate";
import { fixedClock } from "../../../src/domain/kernel/clock";
import type { Role, TenantContext } from "../../../src/domain/kernel/tenant";
import { runCommand, runQuery } from "../../../src/domain/kernel/unit-of-work";
import { approveProfileChange } from "../../../src/domain/members/commands/approve-profile-change";
import { cancelProfileChange } from "../../../src/domain/members/commands/cancel-profile-change";
import { proposeProfileChange } from "../../../src/domain/members/commands/propose-profile-change";
import { rejectProfileChange } from "../../../src/domain/members/commands/reject-profile-change";
import { getPendingProfileChanges } from "../../../src/domain/members/queries/get-pending-profile-changes";
import { closeAll, resetDatabase, sql } from "../../support/db";
import { makeMember, makeShelf } from "../../support/factories";
import { superAdminContext } from "../../support/scenarios";

/**
 * §9 of docs/superpowers/specs/2026-08-12-po-feedback-design.md — PO feedback
 * round 1, Task 9.
 *
 * `ApproveProfileChange` used to call `requireManager` and nothing else, so
 * any manager could approve any pending change on the shelf, including a
 * colleague's — and, in a one-manager parish, their own. This file is the
 * routing rule layered on top of that gate:
 *
 *   a reader's change     → any manager or admin of the shelf (unchanged)
 *   a manager's/admin's   → a super_admin only
 *   anyone's own proposal → nobody, at any rank
 *
 * plus the shelf queue's filter to reader subjects, so a manager's pending
 * change is not left sitting in a list nobody present can decide.
 *
 * `CancelProfileChange` carries the same table, added later (this file's
 * "— cancelling —" section) once review found `cancelProfileChange` still
 * called only `requireSelfOrManager` — so any manager could cancel a peer
 * manager's own pending change, defeating the routing above by a different
 * verb. **With one deliberate exception:** the subject cancelling their own
 * request is always allowed, at any rank — a withdrawal, not a decision — so
 * "anyone's own proposal → nobody" does not apply to cancelling the way it
 * does to approving and rejecting. See `cancel-profile-change.ts`'s own
 * docstring for why.
 *
 * The lifecycle itself — propose, approve, reject, cancel, the one-pending
 * invariant — is `profile-change-lifecycle.test.ts`'s job; this file only
 * adds the routing question on top of it, so its scenarios (below) build the
 * least each test needs rather than restating that file's `shelfWithReader`.
 */

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

const clock = fixedClock("2026-08-13T09:00:00Z");

function ctxFor(
  bookshelfId: string,
  member: { id: string | null; userId: string | null },
  role: Role,
): TenantContext {
  return {
    bookshelfId,
    actor: { userId: member.userId, membershipId: member.id, role },
    clock,
  };
}

/** The plain case: one reader, one manager, nothing remarkable about either. */
async function aShelfWithAReaderAndAManager() {
  const shelf = await makeShelf(sql);
  const reader = await makeMember(sql, shelf.id, { status: "active" });
  const manager = await makeMember(sql, shelf.id, { role: "manager" });
  return { shelf, reader, manager };
}

/** A reader, a shelf admin, and nobody else. */
async function aShelfWithAShelfAdmin() {
  const shelf = await makeShelf(sql);
  const reader = await makeMember(sql, shelf.id, { status: "active" });
  const shelfAdmin = await makeMember(sql, shelf.id, { role: "admin" });
  return { shelf, reader, shelfAdmin };
}

/**
 * A reader and two managers of the same shelf, plus a super admin who is
 * *also* a member of this shelf — as `admin`, mirroring what `contextFor`
 * (`src/auth/guards.ts:107`) actually builds for such a person: a super admin
 * browsing a shelf they belong to keeps that membership's id, with
 * `role: "super_admin"` layered on top rather than `membershipId: null`.
 *
 * That is what lets "nobody approves their own change, at any rank" propose
 * *as* this person's own membership and then attempt to decide it as the same
 * person — the case a bare `systemContext` (`membershipId: null`) cannot
 * exercise, because nothing here is proposed on `systemContext`'s behalf.
 */
async function aShelfWithTwoManagers() {
  const shelf = await makeShelf(sql);
  const reader = await makeMember(sql, shelf.id, { status: "active" });
  const manager = await makeMember(sql, shelf.id, { role: "manager" });
  const otherManager = await makeMember(sql, shelf.id, { role: "manager" });
  const superAdminMembership = await makeMember(sql, shelf.id, { role: "admin" });
  await sql`
    update users set is_super_admin = true where id = ${superAdminMembership.userId}
  `;
  return {
    shelf,
    reader,
    manager,
    otherManager,
    superAdmin: superAdminMembership,
  };
}

/** A reader proposes a phone change — `PROPOSABLE_FIELDS`' simplest member. */
function propose(ctx: TenantContext, membershipId: string, phone: string) {
  return runCommand(sql, ctx, proposeProfileChange, {
    membershipId,
    fields: { phone },
  });
}

// — approving —

test("a manager approves a reader's change", async () => {
  const { shelf, reader, manager } = await aShelfWithAReaderAndAManager();
  const { profileChangeRequestId } = await propose(
    ctxFor(shelf.id, reader, "reader"),
    reader.id,
    "0912345678",
  );

  await expect(
    runCommand(sql, ctxFor(shelf.id, manager, "manager"), approveProfileChange, {
      profileChangeRequestId,
    }),
  ).resolves.toBeDefined();
});

test("a manager may not approve another manager's change", async () => {
  const { shelf, manager, otherManager } = await aShelfWithTwoManagers();
  const { profileChangeRequestId } = await propose(
    ctxFor(shelf.id, otherManager, "manager"),
    otherManager.id,
    "0912345678",
  );

  await expect(
    runCommand(sql, ctxFor(shelf.id, manager, "manager"), approveProfileChange, {
      profileChangeRequestId,
    }),
  ).rejects.toMatchObject({ code: "not_permitted" });
});

test("a super admin approves a manager's change", async () => {
  const { shelf, manager } = await aShelfWithTwoManagers();
  const { profileChangeRequestId } = await propose(
    ctxFor(shelf.id, manager, "manager"),
    manager.id,
    "0912345678",
  );

  // A super admin with no membership of this shelf at all — `contextFor`'s
  // `membershipId: null` shape for `/quan-tri`'s own context
  // (`superAdminContext`, `tests/support/scenarios.ts`) — is exactly who Task
  // 10's cross-shelf queue runs as. `bookshelfId` is overridden the same way
  // `bookshelves-and-managers.test.ts` does for a named-shelf admin command.
  const { ctx: adminCtx } = await superAdminContext(sql);
  await expect(
    runCommand(sql, { ...adminCtx, bookshelfId: shelf.id }, approveProfileChange, {
      profileChangeRequestId,
    }),
  ).resolves.toBeDefined();
});

test("nobody approves their own change, at any rank", async () => {
  const { shelf, superAdmin } = await aShelfWithTwoManagers();
  const ctx = ctxFor(shelf.id, superAdmin, "super_admin");
  const { profileChangeRequestId } = await propose(
    ctx,
    superAdmin.id,
    "0912345678",
  );

  await expect(
    runCommand(sql, ctx, approveProfileChange, { profileChangeRequestId }),
  ).rejects.toMatchObject({ code: "not_permitted" });
});

test("a shelf admin approves a reader's change, like any manager", async () => {
  const { shelf, reader, shelfAdmin } = await aShelfWithAShelfAdmin();
  const { profileChangeRequestId } = await propose(
    ctxFor(shelf.id, reader, "reader"),
    reader.id,
    "0912345678",
  );

  await expect(
    runCommand(sql, ctxFor(shelf.id, shelfAdmin, "admin"), approveProfileChange, {
      profileChangeRequestId,
    }),
  ).resolves.toBeDefined();
});

// — rejecting: the identical pair of checks, because a rejection is a
// decision too, and a rule enforced on only one of the two paths is not
// enforced —

test("a manager may not reject another manager's change either", async () => {
  const { shelf, manager, otherManager } = await aShelfWithTwoManagers();
  const { profileChangeRequestId } = await propose(
    ctxFor(shelf.id, otherManager, "manager"),
    otherManager.id,
    "0912345678",
  );

  await expect(
    runCommand(sql, ctxFor(shelf.id, manager, "manager"), rejectProfileChange, {
      profileChangeRequestId,
      reason: "Không phải chuyện của tôi",
    }),
  ).rejects.toMatchObject({ code: "not_permitted" });
});

test("a super admin rejects a manager's change", async () => {
  const { shelf, manager } = await aShelfWithTwoManagers();
  const { profileChangeRequestId } = await propose(
    ctxFor(shelf.id, manager, "manager"),
    manager.id,
    "0912345678",
  );

  const { ctx: adminCtx } = await superAdminContext(sql);
  await expect(
    runCommand(sql, { ...adminCtx, bookshelfId: shelf.id }, rejectProfileChange, {
      profileChangeRequestId,
      reason: "Số điện thoại cần xác minh lại",
    }),
  ).resolves.toBeDefined();
});

test("nobody rejects their own change either, at any rank", async () => {
  const { shelf, superAdmin } = await aShelfWithTwoManagers();
  const ctx = ctxFor(shelf.id, superAdmin, "super_admin");
  const { profileChangeRequestId } = await propose(
    ctx,
    superAdmin.id,
    "0912345678",
  );

  await expect(
    runCommand(sql, ctx, rejectProfileChange, {
      profileChangeRequestId,
      reason: "Tự mình không thể quyết chuyện của mình",
    }),
  ).rejects.toMatchObject({ code: "not_permitted" });
});

// — cancelling: the subject may always withdraw their own request; the same
// routing rule as approve/reject governs everyone else —

test("a reader cancels their own change", async () => {
  const { shelf, reader } = await aShelfWithAReaderAndAManager();
  const ctx = ctxFor(shelf.id, reader, "reader");
  const { profileChangeRequestId } = await propose(ctx, reader.id, "0912345678");

  await expect(
    runCommand(sql, ctx, cancelProfileChange, {
      membershipId: reader.id,
      profileChangeRequestId,
    }),
  ).resolves.toBeDefined();
});

test("a manager cancels a reader's change", async () => {
  const { shelf, reader, manager } = await aShelfWithAReaderAndAManager();
  const { profileChangeRequestId } = await propose(
    ctxFor(shelf.id, reader, "reader"),
    reader.id,
    "0912345678",
  );

  await expect(
    runCommand(sql, ctxFor(shelf.id, manager, "manager"), cancelProfileChange, {
      membershipId: reader.id,
      profileChangeRequestId,
    }),
  ).resolves.toBeDefined();
});

test("a manager may not cancel another manager's own change", async () => {
  const { shelf, manager, otherManager } = await aShelfWithTwoManagers();
  const { profileChangeRequestId } = await propose(
    ctxFor(shelf.id, otherManager, "manager"),
    otherManager.id,
    "0912345678",
  );

  await expect(
    runCommand(sql, ctxFor(shelf.id, manager, "manager"), cancelProfileChange, {
      membershipId: otherManager.id,
      profileChangeRequestId,
    }),
  ).rejects.toMatchObject({ code: "not_permitted" });
});

test("a super admin cancels a manager's change", async () => {
  const { shelf, manager } = await aShelfWithTwoManagers();
  const { profileChangeRequestId } = await propose(
    ctxFor(shelf.id, manager, "manager"),
    manager.id,
    "0912345678",
  );

  const { ctx: adminCtx } = await superAdminContext(sql);
  await expect(
    runCommand(sql, { ...adminCtx, bookshelfId: shelf.id }, cancelProfileChange, {
      membershipId: manager.id,
      profileChangeRequestId,
    }),
  ).resolves.toBeDefined();
});

test("unlike approve and reject, a manager may cancel their own change", async () => {
  // The one place cancelling and the rest of the lifecycle deliberately part
  // ways: withdrawing your own request is not "signing both halves of a
  // decision" the way approving or rejecting it would be, so self-cancel is
  // never routed to a super admin, at any rank — not even a mere manager's.
  const { shelf, manager } = await aShelfWithAReaderAndAManager();
  const ctx = ctxFor(shelf.id, manager, "manager");
  const { profileChangeRequestId } = await propose(ctx, manager.id, "0912345678");

  await expect(
    runCommand(sql, ctx, cancelProfileChange, {
      membershipId: manager.id,
      profileChangeRequestId,
    }),
  ).resolves.toBeDefined();
});

test("a super admin may cancel their own change too, the same self path everyone else takes", async () => {
  const { shelf, superAdmin } = await aShelfWithTwoManagers();
  const ctx = ctxFor(shelf.id, superAdmin, "super_admin");
  const { profileChangeRequestId } = await propose(
    ctx,
    superAdmin.id,
    "0912345678",
  );

  await expect(
    runCommand(sql, ctx, cancelProfileChange, {
      membershipId: superAdmin.id,
      profileChangeRequestId,
    }),
  ).resolves.toBeDefined();
});

// — the shelf queue —

test("the shelf queue lists only reader subjects", async () => {
  const { shelf, reader, manager, otherManager } = await aShelfWithTwoManagers();
  await propose(ctxFor(shelf.id, reader, "reader"), reader.id, "0912345678");
  await propose(
    ctxFor(shelf.id, otherManager, "manager"),
    otherManager.id,
    "0987654321",
  );

  const queue = await runQuery(
    sql,
    ctxFor(shelf.id, manager, "manager"),
    (tx, ctx) => getPendingProfileChanges(tx, ctx),
  );
  // Not "missing" — the manager's own change moved to the new super-admin
  // queue at `/quan-tri/doi-thong-tin` (Task 10), which this shelf-level list
  // is not it and cannot decide either way.
  expect(queue).toHaveLength(1);
  expect(queue[0].userId).toBe(reader.userId);
});
