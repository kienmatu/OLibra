import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { fixedClock } from "../../../src/domain/kernel/clock";
import { RuleViolated } from "../../../src/domain/kernel/errors";
import type { TenantContext } from "../../../src/domain/kernel/tenant";
import { runQuery, type Tx } from "../../../src/domain/kernel/unit-of-work";
import {
  getOverdueLoans,
  type OverdueLoanRow,
  type OverdueSort,
} from "../../../src/domain/circulation/queries/get-overdue-loans";
import { migrate } from "../../../src/db/migrate";
import { makeBookWithCopies, makeMember, makeShelf } from "../../support/factories";
import { closeAll, resetDatabase, sql } from "../../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

/** The day every loan below is due. Nothing here depends on wall time. */
const DUE_ON = "2026-08-20";
/** 17:00 in Asia/Ho_Chi_Minh on the due date — the last instant that is not late. */
const ON_TIME = "2026-08-20T10:00:00Z";
/** The next day, in the timezone `loans_current` actually compares in. */
const ONE_DAY_LATE = "2026-08-21T10:00:00Z";

function contextFor(
  bookshelfId: string,
  member: { id: string; userId: string },
  role: "manager" | "reader" = "manager",
  instant = ONE_DAY_LATE,
): TenantContext {
  return {
    bookshelfId,
    actor: { userId: member.userId, membershipId: member.id, role },
    clock: fixedClock(instant),
  };
}

async function borrower(
  shelfId: string,
  over: { fullName?: string; phone?: string | null } = {},
) {
  const [user] = await sql<{ id: string }[]>`
    insert into users (full_name, father_name, mother_name, phone)
    values (${over.fullName ?? "Trần Minh"}, 'Giuse Trần Văn A',
            'Maria Nguyễn Thị B',
            ${over.phone === undefined ? "0912345678" : over.phone})
    returning id
  `;
  const [row] = await sql<{ id: string }[]>`
    insert into memberships (bookshelf_id, user_id, status)
    values (${shelfId}, ${user.id}, 'active')
    returning id
  `;
  return { id: row.id, userId: user.id };
}

async function lend(
  shelfId: string,
  borrowerUserId: string,
  lentBy: string,
  dueOn: string,
) {
  const { bookId, copyIds } = await makeBookWithCopies(sql, shelfId, 1);
  const [loan] = await sql<{ id: string }[]>`
    insert into loans (bookshelf_id, copy_id, book_id, borrower_id, lent_by, due_on, status)
    values (${shelfId}, ${copyIds[0]}, ${bookId}, ${borrowerUserId}, ${lentBy},
            ${dueOn}::date, 'active')
    returning id
  `;
  await sql`update book_copies set state = 'on_loan' where id = ${copyIds[0]}`;
  return { loanId: loan.id, bookId, copyId: copyIds[0] };
}

async function shelfWithOneOverdueLoan(slug: string) {
  const shelf = await makeShelf(sql, { slug });
  const manager = await makeMember(sql, shelf.id, { role: "manager" });
  const reader = await borrower(shelf.id);
  const loan = await lend(shelf.id, reader.userId, manager.userId, DUE_ON);
  return { shelf, manager, reader, loan, ctx: contextFor(shelf.id, manager) };
}

test("a loan becomes overdue when the clock moves, with no write and no job", async () => {
  // BR §8 and the reason `20260808_14_olibra_now.sql` exists: `is_overdue` and
  // `days_remaining` are computed on read against `olibra_now()`, which
  // `unit-of-work.ts` sets from `ctx.clock`. Nothing is written between these
  // two reads — the same loan row, the same everything, one day apart. A query
  // that had grown an `is_overdue` column, or that recomputed lateness in
  // TypeScript from `new Date()`, fails here rather than in production in
  // January.
  const a = await shelfWithOneOverdueLoan("dong-thap");

  const onTimeCtx = contextFor(a.shelf.id, a.manager, "manager", ON_TIME);
  const onTime = await runQuery(sql, onTimeCtx, (tx) =>
    getOverdueLoans(tx, onTimeCtx),
  );
  const late = await runQuery(sql, a.ctx, (tx) => getOverdueLoans(tx, a.ctx));

  expect(onTime).toEqual([]);
  expect(late).toHaveLength(1);
  expect(late[0].daysLate).toBe(1);

  // Derived, not stored: nothing wrote anything to say so.
  const [{ count }] = await sql<
    { count: string }[]
  >`select count(*) from audit_log`;
  expect(Number(count)).toBe(0);
});

test("days late keeps counting up as the clock moves further", async () => {
  const a = await shelfWithOneOverdueLoan("dong-thap");
  const muchLater = contextFor(
    a.shelf.id,
    a.manager,
    "manager",
    "2026-09-10T10:00:00Z",
  );
  const rows = await runQuery(sql, muchLater, (tx) =>
    getOverdueLoans(tx, muchLater),
  );
  // 20 Aug to 10 Sep.
  expect(rows[0].daysLate).toBe(21);
});

test("the borrower's phone is on the row, because it is the point of the screen", async () => {
  // BR §16.3: "Sorted by how overdue, showing borrower and contact phone. That
  // phone number is the actual mechanism by which books come back, so it must
  // be tappable." `searchLoansForReturn` — the closest shipped query — returns
  // no phone at all, which is why this is a new query rather than a widening
  // of that one.
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  const manager = await makeMember(sql, shelf.id, { role: "manager" });
  const reader = await borrower(shelf.id, {
    fullName: "Phêrô Nguyễn Văn Bình",
    phone: "0987654321",
  });
  await lend(shelf.id, reader.userId, manager.userId, DUE_ON);
  const ctx = contextFor(shelf.id, manager);

  const [row] = await runQuery(sql, ctx, (tx) => getOverdueLoans(tx, ctx));
  expect(row.borrowerName).toBe("Phêrô Nguyễn Văn Bình");
  expect(row.borrowerPhone).toBe("0987654321");
});

test("a borrower with no phone is listed anyway, with nothing in its place", async () => {
  // `users.phone` is nullable and a family that never gave a number is a real
  // row. Filtering them out would hide the overdue loan a manager is least
  // able to chase; inventing a placeholder would give the screen a `tel:` link
  // that dials nothing.
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  const manager = await makeMember(sql, shelf.id, { role: "manager" });
  const reader = await borrower(shelf.id, { fullName: "Không số", phone: null });
  await lend(shelf.id, reader.userId, manager.userId, DUE_ON);
  const ctx = contextFor(shelf.id, manager);

  const [row] = await runQuery(sql, ctx, (tx) => getOverdueLoans(tx, ctx));
  expect(row.borrowerName).toBe("Không số");
  expect(row.borrowerPhone).toBeNull();
});

test("a returned loan is never overdue, however late it was", async () => {
  const a = await shelfWithOneOverdueLoan("dong-thap");
  // loans_returned_has_condition requires a condition whenever status is
  // 'returned'.
  await sql`
    update loans set status = 'returned', returned_at = now(),
                     return_condition = 'perfect'
    where id = ${a.loan.loanId}
  `;
  const rows = await runQuery(sql, a.ctx, (tx) => getOverdueLoans(tx, a.ctx));
  expect(rows).toEqual([]);
});

test("a loan closed as lost leaves this screen, because it has its own", async () => {
  const a = await shelfWithOneOverdueLoan("dong-thap");
  await sql`update loans set status = 'lost' where id = ${a.loan.loanId}`;
  const rows = await runQuery(sql, a.ctx, (tx) => getOverdueLoans(tx, a.ctx));
  expect(rows).toEqual([]);
});

test("a borrower who left the shelf still appears, holding the book", async () => {
  // The reason `users` is joined directly rather than through `memberships`,
  // as `searchLoansForReturn` already argues: a book somebody still holds after
  // leaving is exactly the overdue loan a manager most needs a phone number
  // for. A `join memberships … status = 'active'` passes every other test in
  // this file and loses this row.
  const a = await shelfWithOneOverdueLoan("dong-thap");
  await sql`update memberships set status = 'left' where id = ${a.reader.id}`;

  const rows = await runQuery(sql, a.ctx, (tx) => getOverdueLoans(tx, a.ctx));
  expect(rows).toHaveLength(1);
  expect(rows[0].borrowerPhone).toBe("0912345678");
});

test("the default order is most overdue first, and the reverse is available", async () => {
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  const manager = await makeMember(sql, shelf.id, { role: "manager" });
  const reader = await borrower(shelf.id);
  // Three loans, three different due dates, all before the clock below.
  for (const due of ["2026-08-01", "2026-08-10", "2026-08-05"]) {
    await lend(shelf.id, reader.userId, manager.userId, due);
  }
  const ctx = contextFor(shelf.id, manager);

  const mostLate = await runQuery(sql, ctx, (tx) => getOverdueLoans(tx, ctx));
  expect(mostLate.map((r) => r.dueOn)).toEqual([
    "2026-08-01",
    "2026-08-05",
    "2026-08-10",
  ]);

  const leastLate = await runQuery(sql, ctx, (tx) =>
    getOverdueLoans(tx, ctx, { sort: "least-late" }),
  );
  expect(leastLate.map((r) => r.dueOn)).toEqual([
    "2026-08-10",
    "2026-08-05",
    "2026-08-01",
  ]);
});

test("sorting by borrower folds the name, so Đặng is not last", async () => {
  // This cluster's collation is `C`, so byte order is the order: `Đ` encodes as
  // two bytes beginning 0xC4, above every ASCII letter, and an unfolded
  // `order by u.full_name` puts every child called Đặng after every child
  // called Vũ. The same defect U2 found in the two catalogue queries and U3
  // wave 1 found in `getReadersList`, on the fifth query to inherit it.
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  const manager = await makeMember(sql, shelf.id, { role: "manager" });
  for (const fullName of ["Vũ Bảo", "Đặng Minh", "An Nhiên"]) {
    const reader = await borrower(shelf.id, { fullName });
    await lend(shelf.id, reader.userId, manager.userId, DUE_ON);
  }
  const ctx = contextFor(shelf.id, manager);

  const rows = await runQuery(sql, ctx, (tx) =>
    getOverdueLoans(tx, ctx, { sort: "borrower" }),
  );
  expect(rows.map((r) => r.borrowerName)).toEqual([
    "An Nhiên",
    "Đặng Minh",
    "Vũ Bảo",
  ]);
});

/**
 * Three borrower names, in the order `olibra_fold` puts them: the fold maps `Đ`
 * to `d`, so the order is An, Đặng, Vũ rather than the byte order that would put
 * `Đặng` last. Written out rather than recomputed here, so this test does not
 * carry a second implementation of the fold.
 */
const TIEBREAK_NAMES = ["An Nhiên", "Đặng Minh", "Vũ Bảo"] as const;
/** Three due dates, ascending, all before `ONE_DAY_LATE`. */
const TIEBREAK_DUES = ["2026-08-01", "2026-08-05", "2026-08-10"] as const;

test("equally late loans are ordered by a key that cannot tie", async () => {
  // The other half of the paging trap, and the half that bites even without
  // paging: two loans due on the same day is the ordinary case for a shelf that
  // lends after Sunday mass, so `order by due_on` alone leaves their relative
  // order to whatever the planner produces. A volunteer working down a call
  // list re-reads this screen, and a list that reshuffles between two reads of
  // the same data is one they lose their place in. `l.id` ends the order.
  //
  // ── Why the fixture is eighteen rows over three dates and three names ──────
  //
  // This test shipped as six namesakes all due the same day, asserting the whole
  // result was ascending by `loanId`. That fixture cannot fail, and the reason
  // is worth writing down because it is not obvious and it is not about this
  // query.
  //
  // With every row sharing one due date and one name, **every** sort key in all
  // three orderings is equal across all six rows, so the `Sort` node is handed
  // an input on which no comparison is ever greater than zero. Postgres's
  // tuplesort short-circuits exactly that case — it checks whether the input is
  // already sorted and, finding it is (vacuously), returns it untouched. So the
  // result is whatever order the scan produced. Measured on this cluster: the
  // first five executions of the statement run a custom plan whose scan order is
  // not id order, and from the sixth — `plan_cache_mode = auto` switching to a
  // generic plan — the scan becomes index-ordered on `loans_pkey`, which *is*
  // ascending by id. postgres.js prepares statements and this file re-uses one
  // connection, so by the time this test runs the statement is long past its
  // fifth execution and the broken query returns ascending ids of its own
  // accord. Raising the row count does not help: the short-circuit fires on any
  // number of rows whose keys all tie.
  //
  // So the fixture has to make the sort **non-degenerate** — a real sort, not a
  // presorted no-op — while still leaving ties for the tiebreak to resolve.
  // Three due dates and three folded names, crossed over eighteen loans: six
  // rows share each due date, six share each name, and two share both. Under
  // every one of the three sorts the leading key genuinely varies, so Postgres
  // runs its quicksort, which is not stable and scrambles the tied rows; only
  // `l.id` puts them back. Eighteen is also past the seven-tuple threshold below
  // which Postgres sorts with a stable insertion sort — measured, at six rows
  // even a varied fixture stays green.
  //
  // Falsified by deleting `l.id` from the `order by`: red in this file and red
  // in isolation, on every run.
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  const manager = await makeMember(sql, shelf.id, { role: "manager" });
  for (let i = 0; i < 18; i++) {
    const reader = await borrower(shelf.id, {
      fullName: TIEBREAK_NAMES[i % 3],
    });
    await lend(
      shelf.id,
      reader.userId,
      manager.userId,
      TIEBREAK_DUES[Math.floor(i / 3) % 3],
    );
  }
  const ctx = contextFor(shelf.id, manager);

  // The leading key of each ordering, as a value that sorts the way the SQL
  // sorts it. `borrower` is the name's index in the folded list above, so this
  // comparison never re-folds anything.
  const leadingKey: Record<OverdueSort, (r: OverdueLoanRow) => string> = {
    "most-late": (r) => r.dueOn,
    "least-late": (r) => r.dueOn,
    borrower: (r) => String(TIEBREAK_NAMES.indexOf(r.borrowerName as never)),
  };

  for (const sort of ["most-late", "least-late", "borrower"] as const) {
    const rows = await runQuery(sql, ctx, (tx) =>
      getOverdueLoans(tx, ctx, { sort }),
    );
    expect(rows, sort).toHaveLength(18);
    expect(new Set(rows.map((r) => r.loanId)).size, sort).toBe(18);

    // The whole contract, in one comparison: the leading key in its own
    // direction, then the id. Without `l.id` the tied rows come back in the
    // order the quicksort left them, which is not this one.
    const key = leadingKey[sort];
    const expected = [...rows].sort((a, b) => {
      const cmp = key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0;
      if (cmp !== 0) return sort === "least-late" ? -cmp : cmp;
      return a.loanId < b.loanId ? -1 : a.loanId > b.loanId ? 1 : 0;
    });
    expect(rows.map((r) => r.loanId), sort).toEqual(
      expected.map((r) => r.loanId),
    );
  }
});

test("it is RLS doing the scoping, not a where clause", async () => {
  // The same property `manager-dashboard.test.ts` asserts for the badge counts,
  // and for the same reason: a `where l.bookshelf_id = ${ctx.bookshelfId}`
  // satisfies "one shelf sees one shelf" perfectly and is then one deletion
  // away from listing every parish's children under one manager's screen — with
  // their phone numbers. So this runs the *same function*, unchanged, against a
  // transaction whose only difference is the role: `olibra_admin` holds
  // `bypassrls`, so no `<table>_tenant` policy applies. The GUCs are still Đồng
  // Tháp's. A query that scoped itself in SQL would answer identically; this one
  // does not.
  const a = await shelfWithOneOverdueLoan("dong-thap");
  await shelfWithOneOverdueLoan("vinh-long");

  const scoped = await runQuery(sql, a.ctx, (tx) => getOverdueLoans(tx, a.ctx));
  const unpoliced = await sql.begin(async (tx) => {
    await tx`select set_config('olibra.bookshelf_id', ${a.ctx.bookshelfId}, true)`;
    await tx`select set_config('olibra.now', ${ONE_DAY_LATE}, true)`;
    await tx`set local role olibra_admin`;
    return getOverdueLoans(tx as unknown as Tx, a.ctx);
  });

  expect(scoped).toHaveLength(1);
  expect(unpoliced).toHaveLength(2);
});

test("a reader is refused, by the domain and not by the page", async () => {
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  const reader = await makeMember(sql, shelf.id);
  const ctx = contextFor(shelf.id, reader, "reader");
  await expect(
    runQuery(sql, ctx, (tx) => getOverdueLoans(tx, ctx)),
  ).rejects.toBeInstanceOf(RuleViolated);
});
