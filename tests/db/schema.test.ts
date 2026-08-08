import { afterAll, beforeAll, expect, test } from "vitest";
import { migrate } from "../../src/db/migrate";
import { closeAll, sql } from "../support/db";

beforeAll(async () => {
  await migrate(sql);
});
afterAll(closeAll);

// DATABASE.md §4 defines seventeen tables — count them by `create table`
// statements, not by section headings, since §4.1 alone holds three
// (users, parish_units, memberships) and §4.8 holds four. This array is
// those seventeen plus schema_migrations, which the migration runner owns
// rather than DATABASE.md.
const EXPECTED_TABLES = [
  "announcements",
  "audit_log",
  "book_copies",
  "book_donations",
  "books",
  "bookshelves",
  "borrow_requests",
  "categories",
  "comments",
  "condition_assessments",
  "feedback",
  "loans",
  "memberships",
  "notifications",
  "parish_units",
  "profile_change_requests",
  "schema_migrations",
  "users",
];

test("every table in DATABASE.md §4 exists", async () => {
  const rows = await sql<{ tablename: string }[]>`
    select tablename from pg_tables where schemaname = 'public' order by tablename
  `;
  expect(rows.map((r) => r.tablename)).toEqual(EXPECTED_TABLES);
});

test("due_on is a date, not a timestamp", async () => {
  // BR §5.4: "a book is due at the end of a day, not at 14:23 on that day."
  // A timestamp here makes a book overdue mid-afternoon, which is confusing
  // for children and wrong for a shelf only open after Sunday mass.
  const [row] = await sql<{ data_type: string }[]>`
    select data_type from information_schema.columns
    where table_name = 'loans' and column_name = 'due_on'
  `;
  expect(row.data_type).toBe("date");
});

test("loans have no deleted_at column", async () => {
  // INV-11 / G10: a loan is never deleted. The absence of the column is the
  // enforcement — there is nothing to set.
  const rows = await sql`
    select 1 from information_schema.columns
    where table_name = 'loans' and column_name = 'deleted_at'
  `;
  expect(rows).toHaveLength(0);
});

test("categories are global, not shelf-scoped", async () => {
  // DB §4.3: shared reference data every shelf draws from. Scoping them would
  // defeat the point.
  const rows = await sql`
    select 1 from information_schema.columns
    where table_name = 'categories' and column_name = 'bookshelf_id'
  `;
  expect(rows).toHaveLength(0);
});
