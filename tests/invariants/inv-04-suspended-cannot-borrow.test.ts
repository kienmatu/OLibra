import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { fixedClock } from "../../src/domain/kernel/clock";
import type { TenantContext } from "../../src/domain/kernel/tenant";
import { runCommand } from "../../src/domain/kernel/unit-of-work";
import { suspendMembership } from "../../src/domain/members/commands/suspend-membership";
import { membershipAllowsNewLoan } from "../../src/domain/members/policy";
import { migrate } from "../../src/db/migrate";
import { makeBookWithCopies, makeMember, makeShelf } from "../support/factories";
import { closeAll, resetDatabase, sql } from "../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

// INV-4: "A reader whose membership is not active cannot start a new loan.
// Existing loans are unaffected." (BR §6.)
//
// Two sentences, and the second is the one an implementation gets wrong. B2a
// owns both halves stated below; C1 adds the third — that a real `lendCopy`
// refuses a suspended member — to this same file rather than a second one.

test("INV-4: no status other than active may start a new loan", () => {
  expect(membershipAllowsNewLoan({ status: "active" })).toEqual({ blocked: false });
  for (const status of ["pending", "suspended", "left", "rejected"] as const) {
    expect(membershipAllowsNewLoan({ status })).toEqual({
      blocked: true,
      reason: "membership_not_active",
    });
  }
});

test("INV-4: suspending a member leaves their existing loan exactly as it was", async () => {
  // The second sentence, and the whole reason suspension is not deletion. The
  // reader-detail screen says the same thing in its own words — "Tạm khoá chỉ
  // chặn mượn mới. Sách đang mượn vẫn giữ nguyên." — which OPS §4.3 is careful
  // to label as the built UI's wording rather than the requirements'.
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  const manager = await makeMember(sql, shelf.id, { role: "manager" });
  const member = await makeMember(sql, shelf.id, { status: "active" });
  const { bookId, copyIds } = await makeBookWithCopies(sql, shelf.id, 1);
  const [loan] = await sql<{ id: string }[]>`
    insert into loans (bookshelf_id, copy_id, book_id, borrower_id, lent_by, due_on)
    values (${shelf.id}, ${copyIds[0]}, ${bookId}, ${member.userId},
            ${manager.userId}, date '2026-08-22')
    returning id
  `;
  await sql`update book_copies set state = 'on_loan' where id = ${copyIds[0]}`;

  const ctx: TenantContext = {
    bookshelfId: shelf.id,
    actor: { userId: manager.userId, membershipId: manager.id, role: "manager" },
    clock: fixedClock("2026-08-08T03:00:00Z"),
  };
  await runCommand(sql, ctx, suspendMembership, {
    membershipId: member.id,
    reason: "Giữ sách quá lâu",
  });

  const [after] = await sql<{ status: string; due_on: string }[]>`
    select status, due_on::text from loans where id = ${loan.id}
  `;
  expect(after.status).toBe("active");
  expect(after.due_on).toBe("2026-08-22");
  // And the loan is still the live one every derived read will find (G5).
  const current = await sql`select 1 from loans_current where id = ${loan.id}`;
  expect(current).toHaveLength(1);
});

// Deferred to C1 (lendCopy, master §7.2): a real `lendCopy` call against a
// suspended member's membership must be refused with `membership_not_active`
// before any row is written. Lending does not exist yet in this branch — B2a
// stops at the two properties above, which are provable without it — so that
// third property is not tested here. C1's plan is to extend this same file
// with that case rather than create a second inv-04 test file.
