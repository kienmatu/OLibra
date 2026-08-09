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
