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

// S1 re-review, item 4: this test used to assert MUTABLE_TABLES ⊆ triggers
// against a hardcoded list — a future table that grows an updated_at column
// and no trigger would pass silently, exactly the gap
// tests/invariants/rls-policy-completeness.test.ts closed for RLS with
// set-equality instead of a one-directional subset check. Copying that
// pattern here: the set of tables carrying an updated_at column must equal
// the set of tables with the trigger attached, not merely contain the
// hardcoded list as a subset.
test("every table with an updated_at column carries the trigger, and nothing else does", async () => {
  const withColumn = await sql<{ table_name: string }[]>`
    select c.table_name from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public'
      and c.column_name = 'updated_at'
      and t.table_type = 'BASE TABLE'
  `;
  const withTrigger = await sql<{ event_object_table: string }[]>`
    select event_object_table
    from information_schema.triggers
    where trigger_schema = 'public' and action_statement = 'EXECUTE FUNCTION set_updated_at()'
  `;

  const expected = new Set(withColumn.map((r) => r.table_name));
  const actual = new Set(withTrigger.map((r) => r.event_object_table));

  expect([...actual].sort()).toEqual([...expected].sort());
  expect(actual.size).toBeGreaterThan(0);
});
