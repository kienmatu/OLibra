import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { migrate } from "../../src/db/migrate";
import { makeBookWithCopies, makeMember, makeShelf } from "../support/factories";
import { closeAll, resetDatabase, sql } from "../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

/**
 * "Yesterday", in the timezone the view actually compares against.
 *
 * `current_date` is the *session's* date, and the session is UTC here — but
 * `loans_current` compares `due_on` against
 * `(olibra_now() at time zone 'Asia/Ho_Chi_Minh')::date`, because a book is
 * due at the end of a day and not at 17:00 on it (`Clock.today()` says the
 * same thing on the TypeScript side).
 *
 * Between 17:00Z and midnight those two dates differ, so a fixture built from
 * `current_date` was off by one for seven hours out of every twenty-four:
 * `days_remaining` read −2 where this file asserts −1, and the failure
 * appeared and disappeared on a daily cycle with no commit behind it. It went
 * unnoticed because CI happened to run before 17:00Z. This is the exact hazard
 * DATABASE.md §2.2 names — never rely on the session `TimeZone` for
 * correctness.
 */
const APP_TODAY = sql`(olibra_now() at time zone 'Asia/Ho_Chi_Minh')::date`;

test("a loan becomes overdue at midnight with no job running", async () => {
  // BR §8: any status a background job must write is stale, and therefore
  // wrong, for as long as the job takes to run again. Nothing is scheduled in
  // this test — the row simply reads as overdue because the date passed.
  const shelf = await makeShelf(sql);
  const { bookId, copyIds } = await makeBookWithCopies(sql, shelf.id, 1);
  const reader = await makeMember(sql, shelf.id);

  await sql`
    insert into loans (bookshelf_id, copy_id, book_id, borrower_id, lent_by, due_on, status)
    values (${shelf.id}, ${copyIds[0]}, ${bookId}, ${reader.userId}, ${reader.userId}, ${APP_TODAY} - 1, 'active')
  `;

  const [row] = await sql<{ is_overdue: boolean; days_remaining: number }[]>`
    select is_overdue, days_remaining from loans_current
  `;
  expect(row.is_overdue).toBe(true);
  expect(Number(row.days_remaining)).toBe(-1);
});

test("a returned loan is never overdue, however old", async () => {
  const shelf = await makeShelf(sql);
  const { bookId, copyIds } = await makeBookWithCopies(sql, shelf.id, 1);
  const reader = await makeMember(sql, shelf.id);

  await sql`
    insert into loans (bookshelf_id, copy_id, book_id, borrower_id, lent_by, due_on, status, return_condition)
    values (${shelf.id}, ${copyIds[0]}, ${bookId}, ${reader.userId}, ${reader.userId}, ${APP_TODAY} - 400, 'returned', 'perfect')
  `;

  const [row] = await sql<{ is_overdue: boolean }[]>`
    select is_overdue from loans_current
  `;
  expect(row.is_overdue).toBe(false);
});

test("an expired hold stops blocking a copy without any tidy-up running", async () => {
  const shelf = await makeShelf(sql);
  const { bookId, copyIds } = await makeBookWithCopies(sql, shelf.id, 1);
  const reader = await makeMember(sql, shelf.id);

  await sql`
    insert into borrow_requests
      (bookshelf_id, book_id, copy_id, member_id, status, requested_at, hold_expires_at)
    values
      (${shelf.id}, ${bookId}, ${copyIds[0]}, ${reader.userId}, 'approved',
       now() - interval '5 days', now() - interval '1 hour')
  `;

  // The hold row is still 'approved' — nothing tidied it. The copy is
  // borrowable anyway, because expiry is compared against the clock on every
  // read rather than trusted from a column somebody was meant to update.
  //
  // The clock here is real time: the view calls `olibra_now()` since
  // `20260808_14_olibra_now.sql`, and this file queries the raw `sql` handle
  // rather than going through `runQuery`, so `olibra.now` is unset (or the
  // empty string) and `olibra_now()` falls back to `now()`. That is why the
  // fixture is written in `now() - interval` terms and why it still reads the
  // way it did before that migration. `tests/db/sql-clock.test.ts` is the file
  // that moves the clock instead of the fixture.
  const rows = await sql`select id from copies_borrowable`;
  expect(rows).toHaveLength(1);
});

test("M2: a soft-deleted approved request stops blocking its copy", async () => {
  // 0011_views.sql's copies_borrowable checked book_copies.deleted_at but
  // not borrow_requests.deleted_at on the hold it joins against, so a
  // soft-deleted 'approved' request kept blocking a copy forever, with
  // nothing in the UI able to explain why (the request that's doing the
  // blocking is invisible everywhere else deleted_at is filtered).
  const shelf = await makeShelf(sql);
  const { bookId, copyIds } = await makeBookWithCopies(sql, shelf.id, 1);
  const reader = await makeMember(sql, shelf.id);

  const [request] = await sql<{ id: string }[]>`
    insert into borrow_requests
      (bookshelf_id, book_id, copy_id, member_id, status, requested_at, hold_expires_at)
    values
      (${shelf.id}, ${bookId}, ${copyIds[0]}, ${reader.userId}, 'approved',
       now() - interval '1 day', now() + interval '1 day')
    returning id
  `;
  await sql`update borrow_requests set deleted_at = now() where id = ${request.id}`;

  const rows = await sql`select id from copies_borrowable`;
  expect(rows).toHaveLength(1);
});

// CRITICAL 2: both views are created `with (security_invoker = true)`
// (0011_views.sql) specifically so they apply the *querying* role's RLS
// policies rather than the view-owning superuser's. Nothing before this
// pair of tests ever queried either view as `olibra_app` — the three tests
// above run as the superuser, so they assert the arithmetic and nothing
// about tenancy, and inv-10-tenant-isolation.test.ts never touches the
// views at all. Demonstrated live: `alter view loans_current reset
// (security_invoker)` leaves every one of the suite's other 101 tests
// green while `olibra_app` scoped to one shelf sees every shelf's loans.
// These two tests are the ones that would have caught it — see
// fix-report.md for the before/after run that proves it.
test("INV-10: loans_current is tenant-scoped for olibra_app", async () => {
  const a = await makeShelf(sql);
  const b = await makeShelf(sql);
  const readerA = await makeMember(sql, a.id);
  const readerB = await makeMember(sql, b.id);
  const { bookId: bookA, copyIds: copiesA } = await makeBookWithCopies(
    sql,
    a.id,
    1,
  );
  const { bookId: bookB, copyIds: copiesB } = await makeBookWithCopies(
    sql,
    b.id,
    1,
  );

  await sql`
    insert into loans (bookshelf_id, copy_id, book_id, borrower_id, lent_by, due_on, status)
    values
      (${a.id}, ${copiesA[0]}, ${bookA}, ${readerA.userId}, ${readerA.userId}, ${APP_TODAY} + 7, 'active'),
      (${b.id}, ${copiesB[0]}, ${bookB}, ${readerB.userId}, ${readerB.userId}, ${APP_TODAY} + 7, 'active')
  `;

  const visible = await sql.begin(async (tx) => {
    await tx`select set_config('olibra.bookshelf_id', ${a.id}, true)`;
    await tx`set local role olibra_app`;
    return tx<{ bookshelf_id: string }[]>`select bookshelf_id from loans_current`;
  });

  expect(visible).toHaveLength(1);
  expect(visible[0].bookshelf_id).toBe(a.id);
});

test("INV-10: copies_borrowable is tenant-scoped for olibra_app", async () => {
  const a = await makeShelf(sql);
  const b = await makeShelf(sql);
  await makeBookWithCopies(sql, a.id, 1);
  await makeBookWithCopies(sql, b.id, 1);

  const visible = await sql.begin(async (tx) => {
    await tx`select set_config('olibra.bookshelf_id', ${a.id}, true)`;
    await tx`set local role olibra_app`;
    return tx<
      { bookshelf_id: string }[]
    >`select bookshelf_id from copies_borrowable`;
  });

  expect(visible).toHaveLength(1);
  expect(visible[0].bookshelf_id).toBe(a.id);
});
