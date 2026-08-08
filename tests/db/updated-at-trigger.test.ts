import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { migrate } from "../../src/db/migrate";
import { makeBookWithCopies, makeShelf } from "../support/factories";
import { closeAll, resetDatabase, sql } from "../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

// M5: DATABASE.md §2 claims, for every table, "updated_at where the row is
// mutable" — but nothing wrote to it after insert, so a manager reading
// "last updated" on a book was always looking at its creation time.
// 20260808_06_updated_at_triggers.sql attaches a BEFORE UPDATE trigger to
// every mutable table carrying the column.

test("updating a bookshelf advances its updated_at", async () => {
  const shelf = await makeShelf(sql);
  const [before] = await sql<{ updated_at: Date }[]>`
    select updated_at from bookshelves where id = ${shelf.id}
  `;

  await sql`select pg_sleep(0.01)`; // guarantee now() reads later than the insert
  await sql`update bookshelves set name = 'Tên mới' where id = ${shelf.id}`;

  const [after] = await sql<{ updated_at: Date }[]>`
    select updated_at from bookshelves where id = ${shelf.id}
  `;
  expect(new Date(after.updated_at).getTime()).toBeGreaterThan(
    new Date(before.updated_at).getTime(),
  );
});

test("updating a book advances its updated_at", async () => {
  const shelf = await makeShelf(sql);
  const { bookId } = await makeBookWithCopies(sql, shelf.id, 1);
  const [before] = await sql<{ updated_at: Date }[]>`
    select updated_at from books where id = ${bookId}
  `;

  await sql`select pg_sleep(0.01)`;
  await sql`update books set title = 'Tên sách mới' where id = ${bookId}`;

  const [after] = await sql<{ updated_at: Date }[]>`
    select updated_at from books where id = ${bookId}
  `;
  expect(new Date(after.updated_at).getTime()).toBeGreaterThan(
    new Date(before.updated_at).getTime(),
  );
});

test("every table with both updated_at and mutable rows carries the trigger", async () => {
  const MUTABLE_TABLES = [
    "users",
    "bookshelves",
    "parish_units",
    "memberships",
    "categories",
    "books",
    "book_copies",
    "loans",
    "borrow_requests",
    "comments",
    "announcements",
    "book_donations",
    "profile_change_requests",
  ];

  const rows = await sql<{ event_object_table: string }[]>`
    select event_object_table
    from information_schema.triggers
    where trigger_schema = 'public' and action_statement = 'EXECUTE FUNCTION set_updated_at()'
  `;
  const actual = new Set(rows.map((r) => r.event_object_table));

  for (const table of MUTABLE_TABLES) {
    expect(actual.has(table), `${table} is missing its updated_at trigger`).toBe(
      true,
    );
  }
});
