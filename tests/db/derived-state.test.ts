import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { migrate } from "../../src/db/migrate";
import { makeBookWithCopies, makeMember, makeShelf } from "../support/factories";
import { closeAll, resetDatabase, sql } from "../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

test("a loan becomes overdue at midnight with no job running", async () => {
  // BR §8: any status a background job must write is stale, and therefore
  // wrong, for as long as the job takes to run again. Nothing is scheduled in
  // this test — the row simply reads as overdue because the date passed.
  const shelf = await makeShelf(sql);
  const { bookId, copyIds } = await makeBookWithCopies(sql, shelf.id, 1);
  const reader = await makeMember(sql, shelf.id);

  await sql`
    insert into loans (bookshelf_id, copy_id, book_id, borrower_id, lent_by, due_on, status)
    values (${shelf.id}, ${copyIds[0]}, ${bookId}, ${reader.userId}, ${reader.userId}, current_date - 1, 'active')
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
    values (${shelf.id}, ${copyIds[0]}, ${bookId}, ${reader.userId}, ${reader.userId}, current_date - 400, 'returned', 'perfect')
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
  // borrowable anyway, because expiry is compared against now() rather than
  // trusted from a column somebody was meant to update.
  const rows = await sql`select id from copies_borrowable`;
  expect(rows).toHaveLength(1);
});
