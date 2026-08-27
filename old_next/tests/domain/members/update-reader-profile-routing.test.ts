import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { migrate } from "../../../src/db/migrate";
import { fixedClock } from "../../../src/domain/kernel/clock";
import type { Role, TenantContext } from "../../../src/domain/kernel/tenant";
import { runCommand } from "../../../src/domain/kernel/unit-of-work";
import { updateReaderProfile } from "../../../src/domain/members/commands/update-reader-profile";
import { closeAll, resetDatabase, sql } from "../../support/db";
import { makeMember, makeShelf } from "../../support/factories";
import { superAdminContext } from "../../support/scenarios";

/**
 * Post-review fix wave, item 1.
 *
 * `UpdateReaderProfile` used to call `requireManager` and nothing else, so any
 * manager could rewrite any other membership's details in one call, with no
 * approval step — a colleague's record, or their own. §9 of
 * `docs/superpowers/specs/2026-08-12-po-feedback-design.md` already routes
 * the *proposal* lifecycle this way (`approve-profile-change.ts`, pinned by
 * `approval-routing.test.ts`, this file's direct model); this is the
 * identical rule, applied to this command's own direct write, which had no
 * routing check at all until this fix landed.
 *
 * `update-reader-profile.test.ts` owns the rest of this command's behaviour
 * (the audit, the empty-proposal rules, the tenant boundary); this file adds
 * only the routing question on top of it.
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

async function aShelfWithTwoManagersAndAReader() {
  const shelf = await makeShelf(sql);
  const reader = await makeMember(sql, shelf.id, { status: "active" });
  const manager = await makeMember(sql, shelf.id, { role: "manager" });
  const otherManager = await makeMember(sql, shelf.id, { role: "manager" });
  return { shelf, reader, manager, otherManager };
}

const phoneOf = async (userId: string) => {
  const [row] = await sql<{ phone: string | null }[]>`
    select phone from users where id = ${userId}
  `;
  return row.phone;
};

test("a manager may not edit another manager's details", async () => {
  const { shelf, manager, otherManager } = await aShelfWithTwoManagersAndAReader();

  await expect(
    runCommand(sql, ctxFor(shelf.id, manager, "manager"), updateReaderProfile, {
      membershipId: otherManager.id,
      fields: { phone: "0912345678" },
    }),
  ).rejects.toMatchObject({ code: "not_permitted" });

  expect(await phoneOf(otherManager.userId)).toBe("0900000000");
});

test("a manager may not edit their own details through this command", async () => {
  const { shelf, manager } = await aShelfWithTwoManagersAndAReader();

  await expect(
    runCommand(sql, ctxFor(shelf.id, manager, "manager"), updateReaderProfile, {
      membershipId: manager.id,
      fields: { phone: "0912345678" },
    }),
  ).rejects.toMatchObject({ code: "not_permitted" });

  expect(await phoneOf(manager.userId)).toBe("0900000000");
});

test("a super admin edits a manager's details", async () => {
  const { shelf, manager } = await aShelfWithTwoManagersAndAReader();
  const { ctx: adminCtx } = await superAdminContext(sql);

  await expect(
    runCommand(sql, { ...adminCtx, bookshelfId: shelf.id }, updateReaderProfile, {
      membershipId: manager.id,
      fields: { phone: "0912345678" },
    }),
  ).resolves.toBeUndefined();

  expect(await phoneOf(manager.userId)).toBe("0912345678");
});

test("a manager still edits a reader's details, unaffected", async () => {
  const { shelf, manager, reader } = await aShelfWithTwoManagersAndAReader();

  await expect(
    runCommand(sql, ctxFor(shelf.id, manager, "manager"), updateReaderProfile, {
      membershipId: reader.id,
      fields: { phone: "0912345678" },
    }),
  ).resolves.toBeUndefined();

  expect(await phoneOf(reader.userId)).toBe("0912345678");
});

// A shelf `admin` is also above `manager` in ROLE_RANK (`admin ⊃ manager`),
// so the same refusal applies to it — worth its own case, since `atLeast`
// checks the *subject's* role here, and an `admin` subject is the other half
// of "manager or admin" in the brief.
test("a manager may not edit a shelf admin's details either", async () => {
  const shelf = await makeShelf(sql);
  const manager = await makeMember(sql, shelf.id, { role: "manager" });
  const shelfAdmin = await makeMember(sql, shelf.id, { role: "admin" });

  await expect(
    runCommand(sql, ctxFor(shelf.id, manager, "manager"), updateReaderProfile, {
      membershipId: shelfAdmin.id,
      fields: { phone: "0912345678" },
    }),
  ).rejects.toMatchObject({ code: "not_permitted" });

  expect(await phoneOf(shelfAdmin.userId)).toBe("0900000000");
});
