import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { fixedClock } from "../../../src/domain/kernel/clock";
import { runQuery } from "../../../src/domain/kernel/unit-of-work";
import { sweepDueNotifications } from "../../../src/domain/notifications/sweep";
import { getOverdueLoans } from "../../../src/domain/circulation/queries/get-overdue-loans";
import { getManagerBadgeCounts } from "../../../src/domain/shelf/queries/get-manager-dashboard";
import { migrate } from "../../../src/db/migrate";
import { closeAll, resetDatabase, sql } from "../../support/db";
import { managerContextFor, lentOut } from "../../support/scenarios";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

/** Twenty days after `lentOut`'s loan falls due on 2026-08-21. */
const LATE = "2026-09-10T10:00:00Z";
/** Two days before it falls due. */
const NEARLY = "2026-08-19T10:00:00Z";

test("the badge is right before the sweep has ever run — G5, and the whole exception", async () => {
  // This is the acceptance criterion for permitting a scheduled job at all.
  // OPS §7: "if it doesn't run for a few hours, nothing a user can observe
  // becomes wrong (the loan's overdue badge is still correct, computed live),
  // only late to be told."
  //
  // So: advance the clock past the due date, run **nothing**, and assert that
  // every derived thing a volunteer looks at is already correct. If this test
  // ever needs the sweep to pass, the sweep has stopped being housekeeping and
  // has become the source of truth — which is the failure BR §8 rules out.
  const { shelf, manager, loanId } = await lentOut(sql);
  const late = managerContextFor(shelf.id, manager, LATE);

  const notifications = await sql`select id from notifications`;
  expect(notifications).toHaveLength(0);

  const counts = await runQuery(sql, late, (tx, ctx) =>
    getManagerBadgeCounts(tx, ctx),
  );
  expect(counts.overdue).toBe(1);

  const rows = await runQuery(sql, late, (tx, ctx) => getOverdueLoans(tx, ctx, {}));
  expect(rows).toHaveLength(1);
  expect(rows[0].loanId).toBe(loanId);
  expect(rows[0].daysLate).toBe(20);
});

test("the sweep tells the borrower a book is overdue", async () => {
  const { shelf, reader } = await lentOut(sql);

  const result = await sweepDueNotifications(sql, fixedClock(LATE));
  expect(result.overdue).toBe(1);

  const [row] = await sql<
    { user_id: string; kind: string; bookshelf_id: string }[]
  >`select user_id, kind, bookshelf_id from notifications`;
  expect(row.kind).toBe("loan_overdue");
  expect(row.user_id).toBe(reader.userId);
  // Written by a job with no tenant scope, but scoped correctly all the same:
  // the shelf is copied from the loan, not from the caller.
  expect(row.bookshelf_id).toBe(shelf.id);
});

test("running the sweep twice does not tell a child twice", async () => {
  // Idempotence is what makes a nightly job safe to re-run after a failure, and
  // the honest key is the notification itself rather than a `last_swept_at`
  // column that can drift, roll back, or be reset by a restore.
  await lentOut(sql);

  await sweepDueNotifications(sql, fixedClock(LATE));
  const second = await sweepDueNotifications(sql, fixedClock(LATE));

  expect(second.overdue).toBe(0);
  expect(await sql`select id from notifications`).toHaveLength(1);
});

test("a book due in two days is due-soon, not overdue", async () => {
  await lentOut(sql);

  const result = await sweepDueNotifications(sql, fixedClock(NEARLY));
  expect(result.dueSoon).toBe(1);
  expect(result.overdue).toBe(0);

  const [row] = await sql<{ kind: string }[]>`select kind from notifications`;
  expect(row.kind).toBe("loan_due_soon");
});

test("a book warned as due-soon is still told when it goes overdue", async () => {
  // Two different things to say about one book, so the idempotence key is per
  // kind and not per loan. Keying it per loan would silence the overdue notice
  // for every reader who had already been warned — which is every reader.
  await lentOut(sql);

  await sweepDueNotifications(sql, fixedClock(NEARLY));
  const later = await sweepDueNotifications(sql, fixedClock(LATE));

  expect(later.overdue).toBe(1);
  const kinds = await sql<{ kind: string }[]>`
    select kind from notifications order by kind
  `;
  expect(kinds.map((k) => k.kind)).toEqual(["loan_due_soon", "loan_overdue"]);
});

test("a returned book is never swept", async () => {
  const { loanId } = await lentOut(sql);
  await sql`
    update loans set status = 'returned', return_condition = 'slightly_worn'
     where id = ${loanId}
  `;

  const result = await sweepDueNotifications(sql, fixedClock(LATE));
  expect(result).toEqual({ dueSoon: 0, overdue: 0 });
});

test("the sweep crosses shelves, because a nightly job serves every parish", async () => {
  const a = await lentOut(sql, { slug: "dong-thap" });
  const b = await lentOut(sql, { slug: "vinh-long" });

  const result = await sweepDueNotifications(sql, fixedClock(LATE));
  expect(result.overdue).toBe(2);

  const shelves = await sql<{ bookshelf_id: string }[]>`
    select distinct bookshelf_id from notifications
  `;
  expect(shelves.map((s) => s.bookshelf_id).sort()).toEqual(
    [a.shelf.id, b.shelf.id].sort(),
  );
});

test("a shelf's own due_soon_days sets its window, not the sweep's global default", async () => {
  // QA remediation Task 24. Task 23 made `due_soon_days` a real per-shelf
  // column — `coalesce((settings->>'due_soon_days')::int, 3)`, writable
  // through `updateBookshelfSettings`, shown on `/quan-ly/cai-dat` as "Báo sắp
  // đến hạn trước" — but `sweepDueNotifications` still took a single global
  // `dueInDays` and never joined `bookshelves`, so the setting was inert: a
  // manager could raise it to 7 days, watch the form save, and reminders would
  // keep firing at 3 forever. This is the falsification `every-shown-policy-
  // is-editable.test.ts` cannot be: that test compares what a screen shows
  // against what a command can change, not what the sweep actually obeys.
  const wide = await lentOut(sql, { slug: "dong-thap" });
  const narrow = await lentOut(sql, { slug: "vinh-long" });
  expect(wide.dueOn).toBe(narrow.dueOn); // same clock, same default loan_days

  await sql`
    update bookshelves
       set settings = settings || ${sql.json({ due_soon_days: 7 })}
     where id = ${wide.shelf.id}
  `;
  // narrow.shelf is left untouched: no due_soon_days key, so the same
  // coalesce `getShelfSettings` uses reports (and this task's rewiring must
  // also honour) the deployment default of 3.

  // Five days before both loans fall due: inside dong-thap's 7-day window,
  // outside vinh-long's 3-day (default) window, and not yet overdue for
  // either — the one clock position where the two shelves must disagree.
  const [y, m, d] = wide.dueOn.split("-").map(Number);
  const fiveBefore = new Date(Date.UTC(y, m - 1, d - 5, 10));
  const clock = fixedClock(fiveBefore.toISOString());

  const result = await sweepDueNotifications(sql, clock);
  expect(result).toEqual({ dueSoon: 1, overdue: 0 });

  const notified = await sql<{ bookshelf_id: string; kind: string }[]>`
    select bookshelf_id, kind from notifications
  `;
  expect(notified).toEqual([
    { bookshelf_id: wide.shelf.id, kind: "loan_due_soon" },
  ]);

  // And two days before due — inside *both* shelves' windows now — vinh-long
  // (still at the default of 3) catches up on its own, unprompted schedule.
  // This is what rules out "narrow shelves just never fire": it is a window,
  // not a flag.
  const twoBefore = new Date(Date.UTC(y, m - 1, d - 2, 10));
  const second = await sweepDueNotifications(
    sql,
    fixedClock(twoBefore.toISOString()),
  );
  expect(second).toEqual({ dueSoon: 1, overdue: 0 });

  const secondRound = await sql<{ bookshelf_id: string }[]>`
    select bookshelf_id from notifications where kind = 'loan_due_soon'
     order by bookshelf_id
  `;
  expect(secondRound.map((r) => r.bookshelf_id).sort()).toEqual(
    [wide.shelf.id, narrow.shelf.id].sort(),
  );
});
