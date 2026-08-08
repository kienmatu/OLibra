import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { hashPassword, verifyPassword } from "../../../src/auth/password";
import { fixedClock } from "../../../src/domain/kernel/clock";
import { RuleViolated } from "../../../src/domain/kernel/errors";
import type { TenantContext } from "../../../src/domain/kernel/tenant";
import { runCommand } from "../../../src/domain/kernel/unit-of-work";
import { managerRegisterReader } from "../../../src/domain/members/commands/manager-register-reader";
import { registerMemberOnBehalf } from "../../../src/domain/members/commands/register-member-on-behalf";
import { membershipAllowsNewLoan } from "../../../src/domain/members/policy";
import {
  type RegistrationInput,
  setPasswordHasher,
  setPasswordVerifier,
} from "../../../src/domain/members/registration";
import { migrate } from "../../../src/db/migrate";
import { makeMember, makeShelf } from "../../support/factories";
import { closeAll, resetDatabase, sql } from "../../support/db";

beforeAll(async () => {
  await migrate(sql);
  setPasswordHasher(hashPassword);
  setPasswordVerifier(verifyPassword);
});
beforeEach(resetDatabase);
afterAll(closeAll);

const clock = fixedClock("2026-08-08T03:00:00Z");

const FAMILY: RegistrationInput = {
  fullName: "Trần Minh",
  dateOfBirth: "2015-04-02",
  fatherName: "Giuse Trần Văn A",
  motherName: "Maria Nguyễn Thị B",
  phone: "0912345678",
};

async function shelfWithManager(slug = "dong-thap") {
  const shelf = await makeShelf(sql, { slug });
  const manager = await makeMember(sql, shelf.id, { role: "manager" });
  const ctx: TenantContext = {
    bookshelfId: shelf.id,
    actor: { userId: manager.userId, membershipId: manager.id, role: "manager" },
    clock,
  };
  return { shelf, manager, ctx };
}

const membership = (id: string) =>
  sql<
    { status: string; approved_by: string | null; approved_at: Date | null }[]
  >`select status, approved_by, approved_at from memberships where id = ${id}`.then(
    (r) => r[0],
  );

test("the quick-lend escape hatch produces a member who can be lent to at once", async () => {
  // OPS §4.3: "the resulting membership must be created active, not pending,
  // or the escape hatch would defeat its own purpose" (BR §16.3, §1.3).
  const { ctx, manager } = await shelfWithManager();
  const { membershipId } = await runCommand(
    sql,
    ctx,
    managerRegisterReader,
    FAMILY,
  );
  const m = await membership(membershipId);
  expect(m.status).toBe("active");
  expect(m.approved_by).toBe(manager.userId);
  expect(m.approved_at).not.toBeNull();
  // The point of the whole thing, asserted through INV-4's own predicate.
  expect(membershipAllowsNewLoan({ status: m.status as "active" }).blocked).toBe(
    false,
  );
});

test("filling in the form on a child's behalf still needs approving", async () => {
  // BR §16.1: registering on behalf "still creates a pending application
  // rather than an active member, so the approval step and its audit record
  // are never skipped."
  const { ctx } = await shelfWithManager();
  const { membershipId } = await runCommand(
    sql,
    ctx,
    registerMemberOnBehalf,
    FAMILY,
  );
  const m = await membership(membershipId);
  expect(m.status).toBe("pending");
  expect(m.approved_by).toBeNull();
  expect(m.approved_at).toBeNull();
  expect(membershipAllowsNewLoan({ status: "pending" }).blocked).toBe(true);
});

test("both record the manager as actor, unlike a self-registration", async () => {
  // OPS §4.3: recorded "with the completing manager as actor, so the audit
  // trail shows this was manager-assisted".
  const { ctx, manager } = await shelfWithManager();
  await runCommand(sql, ctx, managerRegisterReader, FAMILY);
  await runCommand(sql, ctx, registerMemberOnBehalf, {
    ...FAMILY,
    fullName: "Trần Lan",
    phone: "0912345679",
  });
  const rows = await sql<{ action: string; actor_id: string | null }[]>`
    select action, actor_id from audit_log order by id
  `;
  expect(rows.map((r) => r.action)).toEqual([
    "membership.registered",
    "membership.registered",
  ]);
  expect(rows.every((r) => r.actor_id === manager.userId)).toBe(true);
});

test("a reader cannot register anybody", async () => {
  // BR §13.3: the interface hiding an action is never the security control.
  const { shelf } = await shelfWithManager();
  const reader = await makeMember(sql, shelf.id);
  const readerCtx: TenantContext = {
    bookshelfId: shelf.id,
    actor: { userId: reader.userId, membershipId: reader.id, role: "reader" },
    clock,
  };
  for (const command of [managerRegisterReader, registerMemberOnBehalf]) {
    await expect(
      runCommand(sql, readerCtx, command, FAMILY),
    ).rejects.toBeInstanceOf(RuleViolated);
  }
});

test("a left manager walked back by managerRegisterReader also lands demoted to reader", async () => {
  // Re-review (2026-08-08-b2-members): registerMembership and
  // managerRegisterReader share register()'s walk-back, so the reversal —
  // force role = 'reader' instead of refusing — applies here too. The
  // eligibility check is always against `-> pending` (CRITICAL 1's own
  // comment in registration.ts); this command's own `status = "active"`
  // argument decides what the walked-back row lands at, same as a brand
  // -new registration through this door.
  const { ctx } = await shelfWithManager();
  const first = await runCommand(sql, ctx, managerRegisterReader, FAMILY);
  await sql`
    update memberships set status = 'left', role = 'manager'
    where id = ${first.membershipId}
  `;

  const again = await runCommand(sql, ctx, managerRegisterReader, FAMILY);
  expect(again.membershipId).toBe(first.membershipId);

  const [m] = await sql<{ status: string; role: string }[]>`
    select status, role from memberships where id = ${first.membershipId}
  `;
  expect(m.status).toBe("active");
  expect(m.role).toBe("reader");
});

test("the same person, registered actively at a second shelf, keeps one identity", async () => {
  // BR §5.3, through the manager path rather than the public one.
  const a = await shelfWithManager("dong-thap");
  const b = await shelfWithManager("can-tho");
  const first = await runCommand(sql, a.ctx, registerMemberOnBehalf, FAMILY);
  const second = await runCommand(sql, b.ctx, managerRegisterReader, FAMILY);
  expect(second.userId).toBe(first.userId);
  expect((await membership(second.membershipId)).status).toBe("active");
  expect((await membership(first.membershipId)).status).toBe("pending");
});
