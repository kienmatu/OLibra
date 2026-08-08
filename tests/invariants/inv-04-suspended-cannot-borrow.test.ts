import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { fixedClock } from "../../src/domain/kernel/clock";
import type { TenantContext } from "../../src/domain/kernel/tenant";
import { runCommand, runQuery } from "../../src/domain/kernel/unit-of-work";
import { memberMayBorrow } from "../../src/domain/circulation/policy";
import { lendCopy } from "../../src/domain/circulation/commands/lend-copy";
import { suspendMembership } from "../../src/domain/members/commands/suspend-membership";
import {
  membershipAllowsNewLoan,
  type MembershipStatus,
} from "../../src/domain/members/policy";
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
// owns both halves stated below; C1 adds the third — that a suspended member
// is refused a new loan — to this same file rather than a second one. C1's
// Tasks 1 and 2 land as much of it as exists without `lendCopy`: the composed
// predicate, fed from real rows. The command itself is Task 3's, and the note
// at the foot of this file says exactly what it still owes.

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

test("INV-4: the composed predicate refuses a suspended reader who is under the limit", async () => {
  // C1's third property, as far as it can be taken without `lendCopy`.
  //
  // `memberMayBorrow` (`src/domain/circulation/policy.ts`) is what `lendCopy`
  // will ask, and it composes two rules that disagree here: INV-4 says no
  // because the membership is suspended, INV-5 says yes because one book is
  // well under the shelf's limit of three. Only one sentence reaches the
  // volunteer, and it has to be INV-4's — "Tài khoản đang tạm khoá, không thể
  // mượn thêm." names something they can act on this afternoon, while "đã mượn
  // tối đa" would send them to collect books that would not unblock anything.
  //
  // Both inputs are read back out of the database rather than written down
  // here, which is the part `tests/domain/circulation/policy.test.ts` cannot
  // do: it pins that the composition agrees with `membershipAllowsNewLoan` for
  // every status *this file's first test already enumerates*, but it invents
  // the statuses. This one takes the value the `membership_status` enum
  // actually produced for a row `suspendMembership` wrote, and the count the
  // `loans` table actually holds, and feeds those to the predicate. A status
  // spelling that drifted from the enum would be caught here and nowhere else.
  const shelf = await makeShelf(sql, { slug: "an-giang" });
  const manager = await makeMember(sql, shelf.id, { role: "manager" });
  const member = await makeMember(sql, shelf.id, { status: "active" });
  const { bookId, copyIds } = await makeBookWithCopies(sql, shelf.id, 1);
  await sql`
    insert into loans (bookshelf_id, copy_id, book_id, borrower_id, lent_by, due_on)
    values (${shelf.id}, ${copyIds[0]}, ${bookId}, ${member.userId},
            ${manager.userId}, date '2026-08-22')
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

  const standing = await runQuery(sql, ctx, async (tx) => {
    const [row] = await tx<
      { status: MembershipStatus; active_loans: string; max_loans: number }[]
    >`
      select m.status,
             (select count(*) from loans l
               where l.borrower_id = m.user_id and l.status = 'active') as active_loans,
             coalesce((b.settings->>'max_concurrent_loans')::int, 3) as max_loans
        from memberships m
        join bookshelves b on b.id = m.bookshelf_id
       where m.id = ${member.id}
    `;
    return row;
  });

  // One book out of three allowed — INV-5 alone would let this reader borrow.
  expect(standing.status).toBe("suspended");
  expect(Number(standing.active_loans)).toBe(1);
  expect(Number(standing.active_loans)).toBeLessThan(standing.max_loans);

  expect(
    memberMayBorrow(
      { status: standing.status, activeLoans: Number(standing.active_loans) },
      standing.max_loans,
    ),
  ).toEqual({ blocked: true, reason: "membership_not_active" });
});

// The property this file has wanted since B2a wrote it, landed by C1's Task 3:
// a real `lendCopy` call against a suspended member, refused with
// `membership_not_active` *before any row is written*.
test("INV-4: lendCopy refuses a suspended member before writing anything", async () => {
  const shelf = await makeShelf(sql, { slug: "can-tho" });
  const manager = await makeMember(sql, shelf.id, { role: "manager" });
  const ctx: TenantContext = {
    bookshelfId: shelf.id,
    actor: { userId: manager.userId, membershipId: manager.id, role: "manager" },
    clock: fixedClock("2026-08-08T03:00:00Z"),
  };
  const { copyIds } = await makeBookWithCopies(sql, shelf.id, 1);
  const reader = await makeMember(sql, shelf.id, { status: "suspended" });

  await expect(
    runCommand(sql, ctx, lendCopy, {
      copyId: copyIds[0],
      membershipId: reader.id,
    }),
  ).rejects.toMatchObject({ code: "membership_not_active" });

  // The two assertions after the `rejects` are the point of it. A command that
  // threw the right error *after* flipping the copy to `on_loan` would satisfy
  // the line above and leave a copy nobody can lend.
  expect(await sql`select 1 from loans`).toHaveLength(0);
  const [copy] = await sql<{ state: string }[]>`
    select state from book_copies where id = ${copyIds[0]}
  `;
  expect(copy.state).toBe("available");
});

// **The remaining half is INV-4's other command, not another test here.**
// `HandoverRequest` (OPS §4.2) applies the same membership check to a reader
// collecting their own hold, and does not exist in any branch yet — C2's, and
// it belongs in this file too when it lands.
