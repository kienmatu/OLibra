import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { fixedClock } from "../../../src/domain/kernel/clock";
import { RuleViolated } from "../../../src/domain/kernel/errors";
import type { TenantContext } from "../../../src/domain/kernel/tenant";
import {
  runCommand,
  runQuery,
  type Tx,
} from "../../../src/domain/kernel/unit-of-work";
import { markCopyFound } from "../../../src/domain/catalogue/commands/mark-copy-found";
import { reportCopyLost } from "../../../src/domain/catalogue/commands/report-copy-lost";
import { retireCopy } from "../../../src/domain/catalogue/commands/retire-copy";
import {
  getLostCopies,
  getLostCopyCount,
} from "../../../src/domain/catalogue/queries/get-lost-copies";
import { migrate } from "../../../src/db/migrate";
import { makeBookWithCopies, makeMember, makeShelf } from "../../support/factories";
import { closeAll, resetDatabase, sql } from "../../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

const WHEN = "2026-08-09T03:00:00Z";

function contextFor(
  bookshelfId: string,
  member: { id: string; userId: string },
  role: "manager" | "reader" = "manager",
  instant = WHEN,
): TenantContext {
  return {
    bookshelfId,
    actor: { userId: member.userId, membershipId: member.id, role },
    clock: fixedClock(instant),
  };
}

async function borrower(shelfId: string, fullName = "Trần Minh") {
  const [user] = await sql<{ id: string }[]>`
    insert into users (full_name, father_name, mother_name, phone)
    values (${fullName}, 'Giuse Trần Văn A', 'Maria Nguyễn Thị B', '0912345678')
    returning id
  `;
  const [row] = await sql<{ id: string }[]>`
    insert into memberships (bookshelf_id, user_id, status)
    values (${shelfId}, ${user.id}, 'active')
    returning id
  `;
  return { id: row.id, userId: user.id };
}

/**
 * A copy lent out and then reported lost **through the shipped commands**, not
 * by writing `state = 'lost'` by hand.
 *
 * The same discipline `manager-dashboard.test.ts` records for its profile
 * change: a screen whose whole purpose is to undo `ReportCopyLost` should be
 * tested against what `ReportCopyLost` actually produces, so a change to that
 * command cannot leave this file green while the screen goes blank.
 */
async function lostCopy(
  shelfId: string,
  ctx: TenantContext,
  managerUserId: string,
  over: { fullName?: string; instant?: string } = {},
) {
  const { bookId, copyIds } = await makeBookWithCopies(sql, shelfId, 1);
  const reader = await borrower(shelfId, over.fullName);
  await sql`
    insert into loans (bookshelf_id, copy_id, book_id, borrower_id, lent_by, due_on, status)
    values (${shelfId}, ${copyIds[0]}, ${bookId}, ${reader.userId}, ${managerUserId},
            date '2026-08-20', 'active')
  `;
  await sql`update book_copies set state = 'on_loan' where id = ${copyIds[0]}`;

  const at = over.instant ? { ...ctx, clock: fixedClock(over.instant) } : ctx;
  await runCommand(sql, at, reportCopyLost, { copyId: copyIds[0] });
  return { bookId, copyId: copyIds[0], reader };
}

async function shelfWithOneLostCopy(slug: string) {
  const shelf = await makeShelf(sql, { slug });
  const manager = await makeMember(sql, shelf.id, { role: "manager" });
  const ctx = contextFor(shelf.id, manager);
  const lost = await lostCopy(shelf.id, ctx, manager.userId);
  return { shelf, manager, ctx, lost };
}

test("a copy reported lost appears, with the book it belongs to", async () => {
  const a = await shelfWithOneLostCopy("dong-thap");

  const [row] = await runQuery(sql, a.ctx, (tx) => getLostCopies(tx, a.ctx));

  expect(row.copyId).toBe(a.lost.copyId);
  expect(row.bookId).toBe(a.lost.bookId);
  expect(row.title).toMatch(/^Sách /);
  expect(row.bookSlug).toMatch(/^sach-/);
  expect(row.code).toMatch(/^DT-/);
  expect(row.reportedAt).not.toBeNull();
});

test("the row names who was holding it, from the loan the command closed", async () => {
  // `ReportCopyLost` closes the copy's active loan as `lost` in the same
  // transaction (OPS §4.1). That closed loan is where the name comes from —
  // there is no "who lost it" column on `book_copies`, and inventing one would
  // be a second record of a fact the loan already holds.
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  const manager = await makeMember(sql, shelf.id, { role: "manager" });
  const ctx = contextFor(shelf.id, manager);
  await lostCopy(shelf.id, ctx, manager.userId, { fullName: "Đặng Thị Mai" });

  const [row] = await runQuery(sql, ctx, (tx) => getLostCopies(tx, ctx));
  expect(row.lastBorrowerName).toBe("Đặng Thị Mai");
});

test("a copy lost with no loan behind it is listed with no name, not dropped", async () => {
  // Reachable by import or by a hand-corrected row, and it is still a copy this
  // screen exists to give a way back. A `join loans` rather than a
  // `left join lateral` loses it silently, which is the one outcome BR:559
  // forbids: "marking a copy found appears in none of them".
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  const manager = await makeMember(sql, shelf.id, { role: "manager" });
  const { copyIds } = await makeBookWithCopies(sql, shelf.id, 1);
  await sql`update book_copies set state = 'lost' where id = ${copyIds[0]}`;
  const ctx = contextFor(shelf.id, manager);

  const rows = await runQuery(sql, ctx, (tx) => getLostCopies(tx, ctx));
  expect(rows).toHaveLength(1);
  expect(rows[0].lastBorrowerName).toBeNull();
  expect(rows[0].reportedAt).toBeNull();
});

test("only lost copies — never available, on loan or retired ones", async () => {
  const a = await shelfWithOneLostCopy("dong-thap");
  // One available copy and one retired copy on the same shelf.
  const { copyIds } = await makeBookWithCopies(sql, a.shelf.id, 2);
  await sql`
    update book_copies
       set state = 'retired', retired_reason = 'lý do khởi tạo cho kiểm thử'
     where id = ${copyIds[0]}
  `;

  const rows = await runQuery(sql, a.ctx, (tx) => getLostCopies(tx, a.ctx));
  expect(rows.map((r) => r.copyId)).toEqual([a.lost.copyId]);
});

test("the two exits BR §7.1 draws out of lost both empty this screen", async () => {
  // The screen's whole reason for existing, asserted against the two commands
  // it posts to rather than against the state column: `lost → available` and
  // `lost → retired`.
  const a = await shelfWithOneLostCopy("dong-thap");
  const b = await lostCopy(a.shelf.id, a.ctx, a.manager.userId);

  const before = await runQuery(sql, a.ctx, (tx) => getLostCopies(tx, a.ctx));
  expect(before).toHaveLength(2);

  await runCommand(sql, a.ctx, markCopyFound, { copyId: a.lost.copyId });
  await runCommand(sql, a.ctx, retireCopy, {
    copyId: b.copyId,
    reason: "Gia đình đã chuyển đi, sách không quay lại",
  });

  const after = await runQuery(sql, a.ctx, (tx) => getLostCopies(tx, a.ctx));
  expect(after).toEqual([]);
});

test("the newest report is first, and the order is total", async () => {
  // `lost_reported_at` is written from `ctx.clock.now()`, which is fixed for a
  // transaction — a manager reporting three copies of a set lost in one sitting
  // writes the same instant on all three, so ties are the ordinary case rather
  // than a coincidence. `c.code` is `unique (bookshelf_id, code)` and ends the
  // order.
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  const manager = await makeMember(sql, shelf.id, { role: "manager" });
  const ctx = contextFor(shelf.id, manager);

  const older = await lostCopy(shelf.id, ctx, manager.userId, {
    instant: "2026-07-01T03:00:00Z",
  });

  // Five rows at the same instant, with their codes written *against* insertion
  // order, so that the heap arrives at the sort in descending code order.
  //
  // **The tie assertion below is a description, not a guard, and saying so is
  // the point.** Deleting `c.code` from the `order by` leaves this test green:
  // the plan is a `Sort` over a `Seq Scan` (checked with `explain (costs off)`,
  // not assumed), and Postgres's sort is not stable, so five rows whose keys are
  // all equal come back in an arbitrary order that happens to be the ascending
  // one. Nothing about the data available here changes that. The two assertions
  // that *are* falsifiable — newest first, and the `nulls last` in the test
  // below — were each planted and confirmed red. `getOverdueLoans`' own
  // tiebreak test does have a real red, because loan ids are random uuids and
  // "ascending by id" is therefore not a shape any scan order produces.
  const tied: string[] = [];
  for (let i = 0; i < 5; i++) {
    const copy = await lostCopy(shelf.id, ctx, manager.userId, {
      instant: "2026-08-01T03:00:00Z",
    });
    await sql`
      update book_copies set code = ${`DT-900${4 - i}`} where id = ${copy.copyId}
    `;
    tied.push(`DT-900${4 - i}`);
  }

  const rows = await runQuery(sql, ctx, (tx) => getLostCopies(tx, ctx));

  expect(rows).toHaveLength(6);
  // The five tied rows first, in code order; the older report last.
  expect(rows.slice(0, 5).map((r) => r.code)).toEqual([...tied].sort());
  expect(rows.at(-1)!.copyId).toBe(older.copyId);
});

test("a copy with no report time sorts last rather than first", async () => {
  // `desc` puts nulls first in Postgres by default, which would have stood the
  // least informative rows at the top of the screen.
  const a = await shelfWithOneLostCopy("dong-thap");
  const { copyIds } = await makeBookWithCopies(sql, a.shelf.id, 1);
  await sql`update book_copies set state = 'lost' where id = ${copyIds[0]}`;

  const rows = await runQuery(sql, a.ctx, (tx) => getLostCopies(tx, a.ctx));
  expect(rows.map((r) => r.copyId)).toEqual([a.lost.copyId, copyIds[0]]);
});

test("the count is the number of rows the list it labels shows", async () => {
  // BR:559 makes the count the reason the **Đã mất (n)** chip exists at all, so
  // the chip and the screen behind it must not be able to disagree — the same
  // property wave 1 asserted between each sidebar badge and its queue.
  const a = await shelfWithOneLostCopy("dong-thap");
  await lostCopy(a.shelf.id, a.ctx, a.manager.userId);

  const { rows, count } = await runQuery(sql, a.ctx, async (tx) => ({
    rows: await getLostCopies(tx, a.ctx),
    count: await getLostCopyCount(tx, a.ctx),
  }));

  expect(count).toBe(rows.length);
  expect(count).toBe(2);
});

test("a soft-deleted copy leaves both the chip's count and the list", async () => {
  // G10: nothing is hard-deleted, so `deleted_at` is the only thing keeping a
  // withdrawn row off either. Written as one test over both because the two
  // statements are separate — the count is not `getLostCopies(...).length` — and
  // a predicate dropped from one of them is exactly the drift that makes a chip
  // promise a row the screen behind it does not have.
  const a = await shelfWithOneLostCopy("dong-thap");
  const gone = await lostCopy(a.shelf.id, a.ctx, a.manager.userId);
  await sql`update book_copies set deleted_at = now() where id = ${gone.copyId}`;

  const { rows, count } = await runQuery(sql, a.ctx, async (tx) => ({
    rows: await getLostCopies(tx, a.ctx),
    count: await getLostCopyCount(tx, a.ctx),
  }));

  expect(rows.map((r) => r.copyId)).toEqual([a.lost.copyId]);
  expect(count).toBe(1);
});

test("a soft-deleted book takes its lost copies off both, too", async () => {
  // `deleteBook` soft-deletes the title, not each copy under it, so a screen
  // reading `book_copies` alone would go on offering "Đánh dấu tìm thấy" for a
  // book that is no longer catalogued. Both statements join `books` for its own
  // `deleted_at`; this is what says so.
  const a = await shelfWithOneLostCopy("dong-thap");
  const gone = await lostCopy(a.shelf.id, a.ctx, a.manager.userId);
  await sql`update books set deleted_at = now() where id = ${gone.bookId}`;

  const { rows, count } = await runQuery(sql, a.ctx, async (tx) => ({
    rows: await getLostCopies(tx, a.ctx),
    count: await getLostCopyCount(tx, a.ctx),
  }));

  expect(rows.map((r) => r.copyId)).toEqual([a.lost.copyId]);
  expect(count).toBe(1);
});

test("it is RLS doing the scoping, not a where clause", async () => {
  const a = await shelfWithOneLostCopy("dong-thap");
  await shelfWithOneLostCopy("vinh-long");

  const scoped = await runQuery(sql, a.ctx, async (tx) => ({
    rows: await getLostCopies(tx, a.ctx),
    count: await getLostCopyCount(tx, a.ctx),
  }));
  const unpoliced = await sql.begin(async (tx) => {
    await tx`select set_config('olibra.bookshelf_id', ${a.ctx.bookshelfId}, true)`;
    await tx`select set_config('olibra.now', ${WHEN}, true)`;
    await tx`set local role olibra_admin`;
    return {
      rows: await getLostCopies(tx as unknown as Tx, a.ctx),
      count: await getLostCopyCount(tx as unknown as Tx, a.ctx),
    };
  });

  expect(scoped.rows).toHaveLength(1);
  expect(scoped.count).toBe(1);
  expect(unpoliced.rows).toHaveLength(2);
  expect(unpoliced.count).toBe(2);
});

test("a reader is refused, by the domain and not by the page", async () => {
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  const reader = await makeMember(sql, shelf.id);
  const ctx = contextFor(shelf.id, reader, "reader");
  await expect(
    runQuery(sql, ctx, (tx) => getLostCopies(tx, ctx)),
  ).rejects.toBeInstanceOf(RuleViolated);
  await expect(
    runQuery(sql, ctx, (tx) => getLostCopyCount(tx, ctx)),
  ).rejects.toBeInstanceOf(RuleViolated);
});
