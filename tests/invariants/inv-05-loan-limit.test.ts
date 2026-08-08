import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { fixedClock } from "../../src/domain/kernel/clock";
import type { TenantContext } from "../../src/domain/kernel/tenant";
import { runCommand, runQuery } from "../../src/domain/kernel/unit-of-work";
import { memberMayBorrow } from "../../src/domain/circulation/policy";
import { lendCopy } from "../../src/domain/circulation/commands/lend-copy";
import { migrate } from "../../src/db/migrate";
import { makeBookWithCopies, makeMember, makeShelf } from "../support/factories";
import { closeAll, resetDatabase, sql } from "../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

/**
 * INV-5 — "A reader may hold at most `max_concurrent_loans` active loans, per
 * bookshelf." (BR §5.5; the default is 3.)
 *
 * Unlike INV-1, this invariant has **no database constraint behind it**. DB
 * §7.2 chose an in-transaction application check over a trigger or a counter
 * column, and recorded the cost: two managers lending to the same reader in
 * the same instant can exceed the limit by one. That is a far cheaper failure
 * than a corrupted loan record, and a manager can void the extra loan. The
 * plan for this slice proposed an `expect(true).toBe(true)` test to "document"
 * that; it is written here as prose instead, because a test that asserts a
 * tautology is indistinguishable from a test that has quietly stopped checking
 * anything, and this project has shipped that mistake before. If someone later
 * tightens the isolation level, update DB §7.2 and add a real race test.
 *
 * So every part of INV-5 that *is* enforced lives in application code, and
 * this file pins the three things that code depends on:
 *
 *  1. the predicate's boundary — `memberMayBorrow` refuses at the limit, not
 *     one past it;
 *  2. the limit itself — per shelf, defaulting to 3, read from `settings`;
 *  3. **where "per bookshelf" actually comes from** — RLS, not a `where`
 *     clause. `loans.borrower_id` is a *user* id (`0005_circulation.sql:20`)
 *     and one person has one user id across every shelf they belong to, so a
 *     count keyed on it is global unless the transaction it runs in is scoped.
 *     The third test below is the one that catches a count written outside
 *     `runCommand`/`runQuery`, and it is the reason this file needs a database
 *     at all.
 *
 * The command half — `lendCopy` refusing the fourth book — is **deferred to
 * C1's Task 3**; see the closing note.
 */

function ctxAt(bookshelfId: string, instant: string): TenantContext {
  return {
    bookshelfId,
    actor: { userId: null, membershipId: null, role: "super_admin" },
    clock: fixedClock(instant),
  };
}

/** The active-loan count `lendCopy` will run, spelled the way Task 3 spells it. */
function activeLoanCount(bookshelfId: string, userId: string, instant: string) {
  return runQuery(sql, ctxAt(bookshelfId, instant), async (tx) => {
    const [row] = await tx<{ n: string }[]>`
      select count(*) as n from loans
       where borrower_id = ${userId} and status = 'active'
    `;
    return Number(row.n);
  });
}

async function lendDirectly(
  bookshelfId: string,
  userId: string,
  over: { dueOn?: string; status?: string; condition?: string | null } = {},
) {
  const { bookId, copyIds } = await makeBookWithCopies(sql, bookshelfId, 1);
  const [loan] = await sql<{ id: string }[]>`
    insert into loans
      (bookshelf_id, copy_id, book_id, borrower_id, lent_by, due_on, status,
       return_condition, void_reason)
    values
      (${bookshelfId}, ${copyIds[0]}, ${bookId}, ${userId}, ${userId},
       ${over.dueOn ?? "2026-08-22"}::date, ${over.status ?? "active"},
       ${over.condition ?? null}, ${over.status === "voided" ? "Ghi nhầm" : null})
    returning id
  `;
  await sql`update book_copies set state = 'on_loan' where id = ${copyIds[0]}`;
  return loan.id;
}

test("INV-5: the boundary is at the limit, not one past it", () => {
  // Off-by-one here is a rule that lets everybody hold four books. It is worth
  // one line each way.
  expect(memberMayBorrow({ status: "active", activeLoans: 2 }, 3)).toEqual({
    blocked: false,
  });
  expect(memberMayBorrow({ status: "active", activeLoans: 3 }, 3)).toEqual({
    blocked: true,
    reason: "loan_limit_reached",
  });
  expect(memberMayBorrow({ status: "active", activeLoans: 4 }, 3)).toEqual({
    blocked: true,
    reason: "loan_limit_reached",
  });
});

test("INV-5: the limit is the shelf's own, defaulting to 3", async () => {
  // BR §5.5's table. `makeShelf` leaves `settings` as `{}`, which is also what
  // a real shelf created through the product has until somebody changes it —
  // DB §4.2: "a shelf row need only store what it overrides" — so the
  // `coalesce` default is the value nearly every shelf will actually use, not
  // a fallback for a corner case. It is read here with the same expression
  // `lendCopy` will read it with, against a real row.
  const plain = await makeShelf(sql, { slug: "dong-thap" });
  const custom = await makeShelf(sql, { slug: "an-giang" });
  await sql`
    update bookshelves
       set settings = settings || ${sql.json({ max_concurrent_loans: 5 })}
     where id = ${custom.id}
  `;

  const limitOf = (id: string) =>
    sql<{ max_loans: number }[]>`
      select coalesce((settings->>'max_concurrent_loans')::int, 3) as max_loans
        from bookshelves where id = ${id}
    `.then(([r]) => r.max_loans);

  expect(await limitOf(plain.id)).toBe(3);
  expect(await limitOf(custom.id)).toBe(5);

  // And the two feed the same predicate to different answers, which is the
  // whole point of the setting existing.
  expect(memberMayBorrow({ status: "active", activeLoans: 3 }, 3)).toEqual({
    blocked: true,
    reason: "loan_limit_reached",
  });
  expect(memberMayBorrow({ status: "active", activeLoans: 3 }, 5)).toEqual({
    blocked: false,
  });
});

test("INV-5: 'per bookshelf' comes from RLS, not from the where clause", async () => {
  // BR §5.3: a child may belong to two parishes. Three books at Đồng Tháp must
  // not stop them borrowing at An Giang.
  //
  // One person, two shelves, one user id — the only shape that can tell the
  // two possible implementations apart. `loans.borrower_id` is a users(id)
  // (0005_circulation.sql:20), so `where borrower_id = ...` sees every shelf's
  // loans unless the transaction it runs in is scoped. The last assertion
  // below runs the identical count on the unscoped handle and gets the wrong
  // answer, which is what makes the first two assertions a guard rather than a
  // coincidence.
  const a = await makeShelf(sql, { slug: "dong-thap" });
  const b = await makeShelf(sql, { slug: "an-giang" });
  const [user] = await sql<{ id: string }[]>`
    insert into users (full_name, father_name, mother_name, phone)
    values ('Giuse Trần Minh', 'Giuse Trần Văn A', 'Maria Nguyễn Thị B', '0900000000')
    returning id
  `;
  for (const shelfId of [a.id, b.id]) {
    await sql`
      insert into memberships (bookshelf_id, user_id, role, status)
      values (${shelfId}, ${user.id}, 'reader', 'active')
    `;
  }
  for (let i = 0; i < 3; i++) await lendDirectly(a.id, user.id);

  const at = "2026-08-08T03:00:00Z";
  expect(await activeLoanCount(a.id, user.id, at)).toBe(3);
  expect(await activeLoanCount(b.id, user.id, at)).toBe(0);

  // So the same reader is blocked at Đồng Tháp and free at An Giang, from the
  // same three rows.
  expect(memberMayBorrow({ status: "active", activeLoans: 3 }, 3)).toEqual({
    blocked: true,
    reason: "loan_limit_reached",
  });
  expect(memberMayBorrow({ status: "active", activeLoans: 0 }, 3)).toEqual({
    blocked: false,
  });

  // The negative control, and the reason this test is here. `sql` is the raw
  // test handle: no `set local role olibra_app`, no `olibra.bookshelf_id`, and
  // it authenticates as a bypassrls superuser (DB §3). The identical count
  // answers 3 for a reader who has borrowed nothing at An Giang.
  const [unscoped] = await sql<{ n: string }[]>`
    select count(*) as n from loans
     where borrower_id = ${user.id} and status = 'active'
  `;
  expect(Number(unscoped.n)).toBe(3);
});

test("INV-5: an overdue loan still counts, and the clock alone does not change that", async () => {
  // G5: overdue is derived on read, never written. A loan going overdue must
  // therefore not quietly leave the count — otherwise the reader who is
  // holding books longest would be the one INV-5 stops constraining, which is
  // exactly backwards.
  //
  // The clock is the only thing that moves between the two reads: same rows,
  // no write, no scheduled job. That is testable at all only because
  // `20260808_14_olibra_now.sql` made `loans_current` read the injected clock.
  const shelf = await makeShelf(sql, { slug: "vinh-long" });
  const reader = await makeMember(sql, shelf.id);
  for (let i = 0; i < 3; i++) {
    await lendDirectly(shelf.id, reader.userId, { dueOn: "2026-08-09" });
  }

  const before = "2026-08-08T03:00:00Z";
  const after = "2026-08-20T03:00:00Z";

  // `xmin` is the id of the transaction that last wrote a row, so an unchanged
  // set of them says the rows are physically untouched — a stronger statement
  // than comparing `updated_at`, which a trigger could rewrite to the same
  // value. Confirmatory rather than a guard, and `tests/db/sql-clock.test.ts`
  // explains why at length: every read below goes through `runQuery`, which
  // issues `set transaction read only` first, so a write inside one is
  // rejected outright rather than committing and bumping `xmin`.
  const xmins = () =>
    sql<{ xmin: string }[]>`
      select xmin::text from loans where borrower_id = ${reader.userId} order by id
    `.then((rows) => rows.map((r) => r.xmin));
  const xminsBefore = await xmins();
  expect(xminsBefore).toHaveLength(3);

  const overdueAt = (instant: string) =>
    runQuery(sql, ctxAt(shelf.id, instant), async (tx) => {
      const [row] = await tx<{ n: string }[]>`
        select count(*) as n from loans_current
         where borrower_id = ${reader.userId} and is_overdue
      `;
      return Number(row.n);
    });

  expect(await overdueAt(before)).toBe(0);
  expect(await activeLoanCount(shelf.id, reader.userId, before)).toBe(3);

  expect(await overdueAt(after)).toBe(3);
  expect(await activeLoanCount(shelf.id, reader.userId, after)).toBe(3);

  // Still blocked twelve days later, with nothing written in between.
  expect(await xmins()).toEqual(xminsBefore);
  expect(memberMayBorrow({ status: "active", activeLoans: 3 }, 3)).toEqual({
    blocked: true,
    reason: "loan_limit_reached",
  });
});

test("INV-5: a returned or voided loan stops counting; INV-11 keeps the row", async () => {
  // The other half of the boundary, and the reason the count is keyed on
  // `status = 'active'` rather than on the row existing. G10/INV-11: loans are
  // never deleted, so "how many books does this reader have out" can only ever
  // be a question about status. A count that forgot the status clause would
  // block a reader permanently after their third book, and the shelf would
  // have no way to unblock them.
  const shelf = await makeShelf(sql, { slug: "tra-vinh" });
  const reader = await makeMember(sql, shelf.id);
  await lendDirectly(shelf.id, reader.userId);
  await lendDirectly(shelf.id, reader.userId, {
    status: "returned",
    condition: "perfect",
  });
  await lendDirectly(shelf.id, reader.userId, { status: "voided" });

  const at = "2026-08-08T03:00:00Z";
  expect(await activeLoanCount(shelf.id, reader.userId, at)).toBe(1);

  // All three rows are still there. The count moved; nothing was deleted.
  const [{ n }] = await sql<{ n: string }[]>`
    select count(*) as n from loans where borrower_id = ${reader.userId}
  `;
  expect(Number(n)).toBe(3);
  expect(memberMayBorrow({ status: "active", activeLoans: 1 }, 3)).toEqual({
    blocked: false,
  });
});

// The two cases C1's Task 3 owed this file, in the order the note that stood
// here asked for: the cross-shelf one first, because it is the only shape that
// fails if `lendCopy` runs its count outside the scoped transaction, and the
// third test above shows exactly how wrong that answer is (3 where it should
// be 0).
//
// `managerContext` rather than `ctxAt`: `loans.lent_by` is `not null
// references users(id)`, so the `super_admin` context the read-only tests
// share — whose `actor.userId` is null — cannot lend at all.

async function managerContext(bookshelfId: string): Promise<TenantContext> {
  const manager = await makeMember(sql, bookshelfId, { role: "manager" });
  return {
    bookshelfId,
    actor: { userId: manager.userId, membershipId: manager.id, role: "manager" },
    clock: fixedClock("2026-08-08T03:00:00Z"),
  };
}

test("INV-5: lendCopy counts per shelf — three books at one, still lendable at another", async () => {
  // BR §5.3: a child may belong to two parishes. The end-to-end form of the
  // third test above. One user id, two memberships, two scoped transactions:
  // if `lendCopy`'s count ran on an unscoped handle it would answer 3 here and
  // refuse this lend with `loan_limit_reached`.
  const a = await makeShelf(sql, { slug: "dong-thap" });
  const b = await makeShelf(sql, { slug: "an-giang" });
  const ctxA = await managerContext(a.id);
  const ctxB = await managerContext(b.id);

  const [user] = await sql<{ id: string }[]>`
    insert into users (full_name, father_name, mother_name, phone)
    values ('Giuse Trần Minh', 'Giuse Trần Văn A', 'Maria Nguyễn Thị B', '0900000000')
    returning id
  `;
  const memberships: string[] = [];
  for (const shelfId of [a.id, b.id]) {
    const [m] = await sql<{ id: string }[]>`
      insert into memberships (bookshelf_id, user_id, role, status)
      values (${shelfId}, ${user.id}, 'reader', 'active')
      returning id
    `;
    memberships.push(m.id);
  }

  for (let i = 0; i < 3; i++) {
    const { copyIds } = await makeBookWithCopies(sql, a.id, 1);
    await runCommand(sql, ctxA, lendCopy, {
      copyId: copyIds[0],
      membershipId: memberships[0],
    });
  }

  const { copyIds } = await makeBookWithCopies(sql, b.id, 1);
  await expect(
    runCommand(sql, ctxB, lendCopy, {
      copyId: copyIds[0],
      membershipId: memberships[1],
    }),
  ).resolves.toMatchObject({ loanId: expect.any(String) });
});

test("INV-5: lendCopy refuses the fourth book on a default shelf", async () => {
  const shelf = await makeShelf(sql, { slug: "vinh-long" });
  const ctx = await managerContext(shelf.id);
  const reader = await makeMember(sql, shelf.id);

  // The default is 3 (BR §5.5); `makeShelf` leaves `settings` as `{}`.
  for (let i = 0; i < 3; i++) {
    const { copyIds } = await makeBookWithCopies(sql, shelf.id, 1);
    await runCommand(sql, ctx, lendCopy, {
      copyId: copyIds[0],
      membershipId: reader.id,
    });
  }

  const { copyIds } = await makeBookWithCopies(sql, shelf.id, 1);
  await expect(
    runCommand(sql, ctx, lendCopy, {
      copyId: copyIds[0],
      membershipId: reader.id,
    }),
  ).rejects.toMatchObject({ code: "loan_limit_reached" });

  // Refused before any write, like every other blocking condition: the fourth
  // copy is still on the shelf, and there are still three loans, not four.
  const [copy] = await sql<{ state: string }[]>`
    select state from book_copies where id = ${copyIds[0]}
  `;
  expect(copy.state).toBe("available");
  expect(await sql`select 1 from loans`).toHaveLength(3);

  // And the shelf's own setting is what moved the boundary, not a constant:
  // raise it and the same fourth lend succeeds, with nothing else changed.
  await sql`
    update bookshelves
       set settings = settings || ${sql.json({ max_concurrent_loans: 5 })}
     where id = ${shelf.id}
  `;
  await expect(
    runCommand(sql, ctx, lendCopy, {
      copyId: copyIds[0],
      membershipId: reader.id,
    }),
  ).resolves.toMatchObject({ loanId: expect.any(String) });
});

test("INV-5: lendCopy counts active loans, not every loan the reader ever had", async () => {
  // The command half of the fifth test above. G10/INV-11: loans are never
  // deleted, so "how many books does this reader have out" can only be a
  // question about status — a count keyed on the row existing would block a
  // reader permanently after their third book, with no way for the shelf to
  // unblock them, and every test that lends three books and stops would stay
  // green.
  //
  // The two closed loans are written with raw SQL rather than through
  // `receiveReturn`/`voidLoan`: this is C1's Task 3, and those two commands are
  // Tasks 4 and 5. What the test is about is what `lendCopy` *counts*, not how
  // a loan came to be closed.
  const shelf = await makeShelf(sql, { slug: "soc-trang" });
  const ctx = await managerContext(shelf.id);
  const reader = await makeMember(sql, shelf.id);
  await lendDirectly(shelf.id, reader.userId);
  await lendDirectly(shelf.id, reader.userId, {
    status: "returned",
    condition: "perfect",
  });
  await lendDirectly(shelf.id, reader.userId, { status: "voided" });

  // Three rows, one of them active. A count that ignored `status` would see
  // three and refuse the next lend.
  const [{ n }] = await sql<{ n: string }[]>`
    select count(*) as n from loans where borrower_id = ${reader.userId}
  `;
  expect(Number(n)).toBe(3);

  const { copyIds } = await makeBookWithCopies(sql, shelf.id, 1);
  await expect(
    runCommand(sql, ctx, lendCopy, {
      copyId: copyIds[0],
      membershipId: reader.id,
    }),
  ).resolves.toMatchObject({ loanId: expect.any(String) });
});
