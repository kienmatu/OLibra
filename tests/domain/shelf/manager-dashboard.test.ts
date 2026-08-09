import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { fixedClock } from "../../../src/domain/kernel/clock";
import { RuleViolated } from "../../../src/domain/kernel/errors";
import type { TenantContext } from "../../../src/domain/kernel/tenant";
import {
  runCommand,
  runQuery,
  type Tx,
} from "../../../src/domain/kernel/unit-of-work";
import { getOverdueLoans } from "../../../src/domain/circulation/queries/get-overdue-loans";
import { proposeProfileChange } from "../../../src/domain/members/commands/propose-profile-change";
import { getPendingProfileChanges } from "../../../src/domain/members/queries/get-pending-profile-changes";
import { getPendingRegistrations } from "../../../src/domain/members/queries/get-pending-registrations";
import {
  getManagerBadgeCounts,
  getManagerDashboard,
} from "../../../src/domain/shelf/queries/get-manager-dashboard";
import { migrate } from "../../../src/db/migrate";
import { makeBookWithCopies, makeMember, makeShelf } from "../../support/factories";
import { closeAll, resetDatabase, sql } from "../../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

/** The day every loan below is due. Nothing in this file depends on wall time. */
const DUE_ON = "2026-08-20";
/** 17:00 in Asia/Ho_Chi_Minh on the due date — the last instant that is not late. */
const ON_TIME = "2026-08-20T10:00:00Z";
/** The next day, in the timezone `loans_current` actually compares in. */
const LATE = "2026-08-21T10:00:00Z";

function contextFor(
  bookshelfId: string,
  member: { id: string; userId: string },
  role: "manager" | "reader" = "manager",
  instant = ON_TIME,
): TenantContext {
  return {
    bookshelfId,
    actor: { userId: member.userId, membershipId: member.id, role },
    clock: fixedClock(instant),
  };
}

/**
 * A shelf carrying one of each thing a badge counts: a pending application, a
 * pending profile change, and one loan that is due on `DUE_ON`.
 *
 * Written through `proposeProfileChange` rather than by inserting a
 * `profile_change_requests` row, for `tests/support/scenarios.ts`'s stated
 * reason: a count of a queue should be counting a queue the product actually
 * produces, so a change that breaks the proposal cannot leave this green.
 */
async function shelfWithOneOfEach(slug: string) {
  const shelf = await makeShelf(sql, { slug });
  const manager = await makeMember(sql, shelf.id, { role: "manager" });
  const ctx = contextFor(shelf.id, manager);

  await makeMember(sql, shelf.id, { status: "pending" });

  const proposer = await makeMember(sql, shelf.id);
  await runCommand(sql, ctx, proposeProfileChange, {
    membershipId: proposer.id,
    fields: { phone: "0912345678" },
  });

  const borrower = await makeMember(sql, shelf.id);
  const { bookId, copyIds } = await makeBookWithCopies(sql, shelf.id, 2);
  await sql`
    insert into loans (bookshelf_id, copy_id, book_id, borrower_id, lent_by, due_on, status)
    values (
      ${shelf.id}, ${copyIds[0]}, ${bookId}, ${borrower.userId},
      ${manager.userId}, ${DUE_ON}::date, 'active'
    )
  `;
  await sql`update book_copies set state = 'on_loan' where id = ${copyIds[0]}`;

  return { shelf, manager, ctx, bookId, copyIds };
}

test("each badge counts this shelf and no other", async () => {
  const a = await shelfWithOneOfEach("dong-thap");
  await shelfWithOneOfEach("vinh-long");

  const counts = await runQuery(sql, a.ctx, (tx) =>
    getManagerBadgeCounts(tx, a.ctx),
  );

  expect(counts).toEqual({
    pendingRegistrations: 1,
    pendingProfileChanges: 1,
    // On the due date itself, not yet.
    overdue: 0,
  });
});

test("it is RLS doing the scoping, not a where clause", async () => {
  // The property U3 §3.2 asks for, and it cannot be shown by the test above:
  // a `where bookshelf_id = ${ctx.bookshelfId}` would satisfy that one
  // perfectly and would then be one deletion away from counting every parish's
  // applicants under one shelf's badge — a plausible number, on a screen that
  // still looks like it works.
  //
  // So this runs the *same function*, unchanged, against a transaction whose
  // only difference is the role: `olibra_admin` holds `bypassrls`
  // (`0010_rls.sql`), so no `<table>_tenant` policy applies to it. The GUC is
  // still set to Đồng Tháp, so a query that scoped itself in SQL would answer
  // exactly as it did above. It does not: it counts both shelves, which is
  // only possible if the query names no shelf at all.
  const a = await shelfWithOneOfEach("dong-thap");
  await shelfWithOneOfEach("vinh-long");

  const scoped = await runQuery(sql, a.ctx, (tx) =>
    getManagerBadgeCounts(tx, a.ctx),
  );
  const unpoliced = await sql.begin(async (tx) => {
    await tx`select set_config('olibra.bookshelf_id', ${a.ctx.bookshelfId}, true)`;
    // The same instant runQuery would have injected, so the overdue count is
    // comparing like with like rather than against wall-clock time.
    await tx`select set_config('olibra.now', ${ON_TIME}, true)`;
    await tx`set local role olibra_admin`;
    return getManagerBadgeCounts(tx as unknown as Tx, a.ctx);
  });

  expect(scoped.pendingRegistrations).toBe(1);
  expect(scoped.pendingProfileChanges).toBe(1);
  expect(unpoliced.pendingRegistrations).toBe(2);
  expect(unpoliced.pendingProfileChanges).toBe(2);
});

test("the shelf totals are scoped by RLS too", async () => {
  const a = await shelfWithOneOfEach("dong-thap");
  await shelfWithOneOfEach("vinh-long");

  const scoped = await runQuery(sql, a.ctx, (tx) => getManagerDashboard(tx, a.ctx));
  const unpoliced = await sql.begin(async (tx) => {
    await tx`select set_config('olibra.bookshelf_id', ${a.ctx.bookshelfId}, true)`;
    await tx`select set_config('olibra.now', ${ON_TIME}, true)`;
    await tx`set local role olibra_admin`;
    return getManagerDashboard(tx as unknown as Tx, a.ctx);
  });

  // One title, two copies, one active loan; four memberships of which three
  // are active (manager, proposer, borrower) and one is the pending applicant.
  expect(scoped.totals).toEqual({ titles: 1, copies: 2, onLoan: 1, readers: 3 });
  expect(unpoliced.totals).toEqual({ titles: 2, copies: 4, onLoan: 2, readers: 6 });
});

test("a badge shows the number of rows the list it links to shows", async () => {
  // A badge that disagrees with its own queue is worse than no badge: the
  // volunteer taps "Đăng ký chờ duyệt 5", counts four cards, and has to guess
  // which one the software means. The counts mirror those two queries' joins
  // for exactly this reason, so the agreement is asserted rather than assumed.
  const a = await shelfWithOneOfEach("dong-thap");
  await makeMember(sql, a.shelf.id, { status: "pending" });

  const { counts, registrations, changes } = await runQuery(
    sql,
    a.ctx,
    async (tx) => ({
      counts: await getManagerBadgeCounts(tx, a.ctx),
      registrations: await getPendingRegistrations(tx, a.ctx),
      changes: await getPendingProfileChanges(tx, a.ctx),
    }),
  );

  expect(counts.pendingRegistrations).toBe(registrations.length);
  expect(counts.pendingProfileChanges).toBe(changes.length);
  expect(registrations.length).toBe(2);
});

test("the Quá hạn badge shows the number of rows qua-han shows", async () => {
  // The third badge, and the one the two agreement tests above left out.
  // `getManagerBadgeCounts.overdue` is `count(*) from loans_current where
  // is_overdue` — `loans_current` alone. `getOverdueLoans` inner-joins
  // `book_copies`, `books` and `users` to get a code, a title and a phone
  // number. Two different populations, asserted to be the same one.
  //
  // No disagreement could be produced against the shipped pair, and that is why
  // this is worth pinning rather than leaving: every join is one predicate away
  // from narrowing the list below its own badge, and each of the four loans
  // below is one of those predicates.
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  const manager = await makeMember(sql, shelf.id, { role: "manager" });

  const overdue = async (
    over: { deleteBook?: boolean; deleteCopy?: boolean; left?: boolean } = {},
  ) => {
    const who = await makeMember(sql, shelf.id);
    const { bookId, copyIds } = await makeBookWithCopies(sql, shelf.id, 1);
    await sql`
      insert into loans (bookshelf_id, copy_id, book_id, borrower_id, lent_by, due_on, status)
      values (${shelf.id}, ${copyIds[0]}, ${bookId}, ${who.userId},
              ${manager.userId}, ${DUE_ON}::date, 'active')
    `;
    await sql`update book_copies set state = 'on_loan' where id = ${copyIds[0]}`;
    if (over.deleteBook)
      await sql`update books set deleted_at = now() where id = ${bookId}`;
    if (over.deleteCopy)
      await sql`update book_copies set deleted_at = now() where id = ${copyIds[0]}`;
    // A book somebody still holds after leaving the shelf: the row
    // `getOverdueLoans` joins `users` directly to keep, and the one a
    // `join memberships … status = 'active'` in either query would drop from
    // the list while leaving it in the badge.
    if (over.left)
      await sql`update memberships set status = 'left' where id = ${who.id}`;
  };

  await overdue();
  await overdue({ left: true });
  await overdue({ deleteBook: true });
  await overdue({ deleteCopy: true });

  // One loan that is not late, so "they agree" is not "they are both empty" and
  // not "they both count every loan".
  const onTimeBorrower = await makeMember(sql, shelf.id);
  const future = await makeBookWithCopies(sql, shelf.id, 1);
  await sql`
    insert into loans (bookshelf_id, copy_id, book_id, borrower_id, lent_by, due_on, status)
    values (${shelf.id}, ${future.copyIds[0]}, ${future.bookId},
            ${onTimeBorrower.userId}, ${manager.userId}, date '2999-01-01', 'active')
  `;

  const lateCtx = contextFor(shelf.id, manager, "manager", LATE);
  const { counts, list } = await runQuery(sql, lateCtx, async (tx) => ({
    counts: await getManagerBadgeCounts(tx, lateCtx),
    list: await getOverdueLoans(tx, lateCtx),
  }));

  expect(counts.overdue).toBe(4);
  expect(list).toHaveLength(4);
  expect(counts.overdue).toBe(list.length);

  // And they turn over together: on time, both are empty. The badge and the
  // list read the same derived column against the same injected clock, so a
  // clock that moved one and not the other would be two definitions of late.
  const onTimeCtx = contextFor(shelf.id, manager, "manager", ON_TIME);
  const early = await runQuery(sql, onTimeCtx, async (tx) => ({
    counts: await getManagerBadgeCounts(tx, onTimeCtx),
    list: await getOverdueLoans(tx, onTimeCtx),
  }));
  expect(early.counts.overdue).toBe(0);
  expect(early.list).toEqual([]);
});

test("a soft-deleted application leaves the badge, as it leaves the queue", async () => {
  const a = await shelfWithOneOfEach("dong-thap");
  await sql`
    update memberships set deleted_at = now()
    where bookshelf_id = ${a.shelf.id} and status = 'pending'
  `;

  const { counts, registrations } = await runQuery(sql, a.ctx, async (tx) => ({
    counts: await getManagerBadgeCounts(tx, a.ctx),
    registrations: await getPendingRegistrations(tx, a.ctx),
  }));

  expect(counts.pendingRegistrations).toBe(0);
  expect(registrations).toEqual([]);
});

test("the overdue badge turns over at midnight, with no write and no job", async () => {
  // BR §8, and the reason `20260808_14_olibra_now.sql` exists: `is_overdue` is
  // computed on read against the injected clock, so moving the clock is the
  // whole of the setup. Nothing is written between these two reads — the same
  // loan row, the same everything, one day apart.
  const a = await shelfWithOneOfEach("dong-thap");

  const onTime = await runQuery(sql, a.ctx, (tx) =>
    getManagerBadgeCounts(tx, a.ctx),
  );

  const lateCtx = contextFor(a.shelf.id, a.manager, "manager", LATE);
  const late = await runQuery(sql, lateCtx, (tx) =>
    getManagerBadgeCounts(tx, lateCtx),
  );

  expect(onTime.overdue).toBe(0);
  expect(late.overdue).toBe(1);
});

test("a returned loan is never overdue, however late it was", async () => {
  const a = await shelfWithOneOfEach("dong-thap");
  await sql`
    update loans set status = 'returned', return_condition = 'perfect'
    where bookshelf_id = ${a.shelf.id}
  `;

  const lateCtx = contextFor(a.shelf.id, a.manager, "manager", LATE);
  const counts = await runQuery(sql, lateCtx, (tx) =>
    getManagerBadgeCounts(tx, lateCtx),
  );

  expect(counts.overdue).toBe(0);
});

test("a retired copy leaves the copy total; a lost one does not", async () => {
  // `getBooksList`'s own definition of `copiesTotal`, restated here because
  // the dashboard's "Bản sách" sits above a list that uses it. A retired copy
  // has left the shelf; a lost one has not stopped being the shelf's.
  const a = await shelfWithOneOfEach("dong-thap");
  // `book_copies_retired_has_reason` (0004_catalogue.sql:75) requires one, so
  // a fixture that only means to vary the state still has to satisfy it.
  await sql`
    update book_copies
       set state = 'retired', retired_reason = 'lý do khởi tạo cho kiểm thử'
     where id = ${a.copyIds[1]}
  `;

  const first = await runQuery(sql, a.ctx, (tx) => getManagerDashboard(tx, a.ctx));
  expect(first.totals.copies).toBe(1);

  await sql`
    update book_copies set state = 'lost', retired_reason = null
     where id = ${a.copyIds[1]}
  `;
  const second = await runQuery(sql, a.ctx, (tx) => getManagerDashboard(tx, a.ctx));
  expect(second.totals.copies).toBe(2);
});

test("a draft title is counted, because the manager's list shows drafts", async () => {
  const a = await shelfWithOneOfEach("dong-thap");
  await sql`update books set is_published = false where bookshelf_id = ${a.shelf.id}`;

  const dashboard = await runQuery(sql, a.ctx, (tx) =>
    getManagerDashboard(tx, a.ctx),
  );

  expect(dashboard.totals.titles).toBe(1);
});

test("a reader is refused, by the domain and not by the page", async () => {
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  const reader = await makeMember(sql, shelf.id);
  const ctx = contextFor(shelf.id, reader, "reader");

  await expect(
    runQuery(sql, ctx, (tx) => getManagerBadgeCounts(tx, ctx)),
  ).rejects.toMatchObject({ code: "not_permitted" });
  await expect(
    runQuery(sql, ctx, (tx) => getManagerDashboard(tx, ctx)),
  ).rejects.toBeInstanceOf(RuleViolated);
});
