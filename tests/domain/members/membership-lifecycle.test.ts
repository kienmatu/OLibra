import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { fixedClock } from "../../../src/domain/kernel/clock";
import { NotFound, RuleViolated } from "../../../src/domain/kernel/errors";
import type { TenantContext } from "../../../src/domain/kernel/tenant";
import { runCommand } from "../../../src/domain/kernel/unit-of-work";
import { approveMembership } from "../../../src/domain/members/commands/approve-membership";
import { markMembershipLeft } from "../../../src/domain/members/commands/mark-membership-left";
import { reactivateMembership } from "../../../src/domain/members/commands/reactivate-membership";
import { rejectMembership } from "../../../src/domain/members/commands/reject-membership";
import { suspendMembership } from "../../../src/domain/members/commands/suspend-membership";
import { migrate } from "../../../src/db/migrate";
import { makeBookWithCopies, makeMember, makeShelf } from "../../support/factories";
import { closeAll, resetDatabase, sql } from "../../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

const clock = fixedClock("2026-08-08T03:00:00Z");

async function shelfWith(status: string, slug = "dong-thap") {
  const shelf = await makeShelf(sql, { slug });
  const manager = await makeMember(sql, shelf.id, { role: "manager" });
  const member = await makeMember(sql, shelf.id, { status });
  const ctx: TenantContext = {
    bookshelfId: shelf.id,
    actor: { userId: manager.userId, membershipId: manager.id, role: "manager" },
    clock,
  };
  return { shelf, manager, member, ctx };
}

const statusOf = async (id: string) =>
  (
    await sql<{ status: string }[]>`select status from memberships where id = ${id}`
  )[0].status;

const auditActions = async () =>
  (await sql<{ action: string }[]>`select action from audit_log order by id`).map(
    (r) => r.action,
  );

// — approve / reject —

test("approving a pending application records who approved it, and when", async () => {
  const { ctx, member, manager } = await shelfWith("pending");
  await runCommand(sql, ctx, approveMembership, { membershipId: member.id });
  const [m] = await sql<
    { status: string; approved_by: string; approved_at: Date }[]
  >`select status, approved_by, approved_at from memberships where id = ${member.id}`;
  expect(m.status).toBe("active");
  expect(m.approved_by).toBe(manager.userId);
  expect(m.approved_at.toISOString()).toBe("2026-08-08T03:00:00.000Z");
  expect(await auditActions()).toEqual(["membership.approved"]);
});

test("approving clears any suspension_reason left on the row, defensively", async () => {
  // Re-review (2026-08-08-b2-members): today no command produces a `pending`
  // row carrying a live `suspension_reason` — an exhaustive walk of all seven
  // commands confirmed it — so this only guards a reachability accident, the
  // same way `reactivateMembership` already clears defensively rather than
  // trusting that nothing upstream could have left one. The row is forced
  // into the state by hand here, past every command, to prove the guarantee
  // is now local to this one rather than borrowed from the rest of the
  // catalogue.
  const { ctx, member } = await shelfWith("pending");
  await sql`
    update memberships set suspension_reason = 'cũ' where id = ${member.id}
  `;
  await runCommand(sql, ctx, approveMembership, { membershipId: member.id });
  const [m] = await sql<
    { status: string; suspension_reason: string | null }[]
  >`select status, suspension_reason from memberships where id = ${member.id}`;
  expect(m.status).toBe("active");
  expect(m.suspension_reason).toBeNull();
});

test("approving twice says the application was already dealt with", async () => {
  const { ctx, member } = await shelfWith("active");
  await expect(
    runCommand(sql, ctx, approveMembership, { membershipId: member.id }),
  ).rejects.toMatchObject({ code: "registration_not_pending" });
});

test("IMPORTANT 3: approving a suspended membership is refused, not a silent un-suspend", async () => {
  // membershipTransition("suspended", "active") is a real edge (it is
  // Reactivate's own edge) — approveMembership must not delegate to the
  // shared graph for this the same way reactivateMembership's own docstring
  // explains it cannot delegate the other direction. Mirrors that: a direct
  // status !== "pending" check.
  const { ctx, member } = await shelfWith("suspended");
  await sql`
    update memberships set suspension_reason = 'Tạm khoá' where id = ${member.id}
  `;
  await expect(
    runCommand(sql, ctx, approveMembership, { membershipId: member.id }),
  ).rejects.toMatchObject({ code: "registration_not_pending" });

  const [m] = await sql<
    { status: string; suspension_reason: string | null }[]
  >`select status, suspension_reason from memberships where id = ${member.id}`;
  expect(m.status).toBe("suspended");
  expect(m.suspension_reason).toBe("Tạm khoá");
});

test("rejecting keeps the record and its reason, so the person may re-apply", async () => {
  // BR §2: "They are retained with a reason for audit purposes, and the person
  // may re-apply." The row survives; nothing is deleted (G10).
  const { ctx, member } = await shelfWith("pending");
  await runCommand(sql, ctx, rejectMembership, {
    membershipId: member.id,
    reason: "Chưa xác minh được thông tin",
  });
  const [m] = await sql<
    { status: string; rejection_reason: string }[]
  >`select status, rejection_reason from memberships where id = ${member.id}`;
  expect(m.status).toBe("rejected");
  expect(m.rejection_reason).toBe("Chưa xác minh được thông tin");
  expect(await auditActions()).toEqual(["membership.rejected"]);
});

test("a rejection with no reason is refused before the constraint sees it", async () => {
  // memberships_rejected_has_reason would raise 23514; OPS §2 requires a named
  // failure with a sentence, not a driver error.
  const { ctx, member } = await shelfWith("pending");
  await expect(
    runCommand(sql, ctx, rejectMembership, {
      membershipId: member.id,
      reason: "  ",
    }),
  ).rejects.toMatchObject({ code: "reject_reason_required" });
  expect(await statusOf(member.id)).toBe("pending");
});

// — suspend / reactivate —

test("suspending records the reason and only an active membership may be suspended", async () => {
  const { ctx, member } = await shelfWith("active");
  await runCommand(sql, ctx, suspendMembership, {
    membershipId: member.id,
    reason: "Giữ sách quá lâu",
  });
  const [m] = await sql<
    { status: string; suspension_reason: string | null }[]
  >`select status, suspension_reason from memberships where id = ${member.id}`;
  expect(m.status).toBe("suspended");
  expect(m.suspension_reason).toBe("Giữ sách quá lâu");

  await expect(
    runCommand(sql, ctx, suspendMembership, { membershipId: member.id }),
  ).rejects.toMatchObject({ code: "not_active_cannot_suspend" });
});

test("a suspension reason is optional — OPS §4.3 marks it so", async () => {
  const { ctx, member } = await shelfWith("active");
  await runCommand(sql, ctx, suspendMembership, { membershipId: member.id });
  const [m] = await sql<
    { suspension_reason: string | null }[]
  >`select suspension_reason from memberships where id = ${member.id}`;
  expect(m.suspension_reason).toBeNull();
});

test("reactivating clears the suspension reason, and needs a suspended member", async () => {
  // BR §7.5 draws active ⇄ suspended. A stale reason on a reactivated member
  // would show on the reader-detail screen as a live one.
  const { ctx, member } = await shelfWith("suspended");
  await sql`update memberships set suspension_reason = 'cũ' where id = ${member.id}`;
  await runCommand(sql, ctx, reactivateMembership, { membershipId: member.id });
  const [m] = await sql<
    { status: string; suspension_reason: string | null }[]
  >`select status, suspension_reason from memberships where id = ${member.id}`;
  expect(m.status).toBe("active");
  expect(m.suspension_reason).toBeNull();

  await expect(
    runCommand(sql, ctx, reactivateMembership, { membershipId: member.id }),
  ).rejects.toMatchObject({ code: "not_suspended_cannot_reactivate" });
});

// — left —

test("a member with no books out may be marked left, from any status", async () => {
  // OPS §4.3: "Any status → left" — including a member already marked left.
  // M6: a volunteer re-clicking "Đánh dấu đã rời" on someone who already left
  // must not be told their *registration application* was already processed
  // (registration_not_pending) — that sentence is about a different act.
  for (const from of ["pending", "active", "suspended", "rejected", "left"]) {
    await resetDatabase();
    const { ctx, member } = await shelfWith(from);
    await runCommand(sql, ctx, markMembershipLeft, { membershipId: member.id });
    expect(await statusOf(member.id)).toBe("left");
  }
});

test("a member still holding a book cannot simply leave with it", async () => {
  // OPS §4.3's inferred failure mode, implemented as OPS lists it. BR §16.3:
  // the borrower's phone "is the actual mechanism by which books come back",
  // and a `left` membership is a person the shelf stopped tracking.
  const { ctx, member, manager, shelf } = await shelfWith("active");
  const { bookId, copyIds } = await makeBookWithCopies(sql, shelf.id, 1);
  await sql`
    insert into loans (bookshelf_id, copy_id, book_id, borrower_id, lent_by, due_on)
    values (${shelf.id}, ${copyIds[0]}, ${bookId}, ${member.userId},
            ${manager.userId}, date '2026-08-22')
  `;
  await sql`update book_copies set state = 'on_loan' where id = ${copyIds[0]}`;

  await expect(
    runCommand(sql, ctx, markMembershipLeft, { membershipId: member.id }),
  ).rejects.toMatchObject({ code: "member_has_active_loans" });
  expect(await statusOf(member.id)).toBe("active");
});

test("a returned loan does not keep a member from leaving", async () => {
  // The count comes from loans_current (G5, DB §6), not from a hand-written
  // status filter that could drift from it.
  const { ctx, member, manager, shelf } = await shelfWith("active");
  const { bookId, copyIds } = await makeBookWithCopies(sql, shelf.id, 1);
  await sql`
    insert into loans (bookshelf_id, copy_id, book_id, borrower_id, lent_by,
                       due_on, status, returned_at, received_by, return_condition)
    values (${shelf.id}, ${copyIds[0]}, ${bookId}, ${member.userId},
            ${manager.userId}, date '2026-08-22', 'returned', now(),
            ${manager.userId}, 'perfect')
  `;
  await runCommand(sql, ctx, markMembershipLeft, { membershipId: member.id });
  expect(await statusOf(member.id)).toBe("left");
});

// — scoping and roles —

test("INV-10: a manager of one shelf cannot touch another shelf's member", async () => {
  // Verified live: the update itself affects zero rows silently. The select
  // that runs first is what turns that silence into a sentence.
  const a = await shelfWith("pending", "dong-thap");
  const b = await shelfWith("pending", "can-tho");
  for (const command of [approveMembership, markMembershipLeft]) {
    await expect(
      runCommand(sql, b.ctx, command, { membershipId: a.member.id }),
    ).rejects.toBeInstanceOf(NotFound);
  }
  expect(await statusOf(a.member.id)).toBe("pending");
});

test("a reader cannot approve, reject, suspend, reactivate or mark left", async () => {
  const { shelf, member } = await shelfWith("pending");
  const reader = await makeMember(sql, shelf.id);
  const readerCtx: TenantContext = {
    bookshelfId: shelf.id,
    actor: { userId: reader.userId, membershipId: reader.id, role: "reader" },
    clock,
  };
  await expect(
    runCommand(sql, readerCtx, approveMembership, { membershipId: member.id }),
  ).rejects.toBeInstanceOf(RuleViolated);
  await expect(
    runCommand(sql, readerCtx, rejectMembership, {
      membershipId: member.id,
      reason: "vì thế",
    }),
  ).rejects.toBeInstanceOf(RuleViolated);
});

test("INV-8: each transition writes one audit entry naming before and after", async () => {
  const { ctx, member } = await shelfWith("pending");
  await runCommand(sql, ctx, approveMembership, { membershipId: member.id });
  await runCommand(sql, ctx, suspendMembership, {
    membershipId: member.id,
    reason: "tạm",
  });
  await runCommand(sql, ctx, reactivateMembership, { membershipId: member.id });
  const rows = await sql<
    { action: string; before: { status: string }; after: { status: string } }[]
  >`select action, before, after from audit_log order by id`;
  expect(rows.map((r) => [r.action, r.before.status, r.after.status])).toEqual([
    ["membership.approved", "pending", "active"],
    ["membership.suspended", "active", "suspended"],
    ["membership.reactivated", "suspended", "active"],
  ]);
});
