import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { migrate } from "../../src/db/migrate";
import { closeAll, resetDatabase, sql } from "../support/db";
import { makeShelf } from "../support/factories";

beforeAll(async () => {
  await migrate(sql);
});
// This file was introspection-only when it was written: four tests reading
// `information_schema`, no rows written, nothing to reset — the same reason
// `folding.test.ts` and `copy-qr-print.test.ts` still carry no reset. PO
// feedback round one added the two tests below that *do* write rows, and the
// missing hook stopped being harmless at that moment: the file now both reads
// whatever the previously-run file left in `bookshelves` and leaves its own
// rows for the next one. `makeShelf`'s default slug is `shelf-N` off a counter
// that Vitest restarts at 1 in every file, so `shelf-1` is generated over and
// over across the suite, and whether this file hits 23505 on
// `bookshelves_slug_unique` depends entirely on which file ran before it —
// green or red purely by ordering. Truncation leaves the schema itself
// standing, so the four introspection tests do not notice this.
beforeEach(resetDatabase);
afterAll(closeAll);

// DATABASE.md §4 defines seventeen tables — count them by `create table`
// statements, not by section headings, since §4.1 alone holds three
// (users, parish_units, memberships) and §4.8 holds four. This array is
// those seventeen plus two the document does not describe: `schema_migrations`,
// which the migration runner owns, and `sessions`, which B2a added.
//
// B4 adds `system_settings`, and DATABASE.md §4.12 now describes it — the
// installation's own row, which had nowhere to live because every other setting
// in this schema is per-shelf by construction.
//
// PO feedback round one adds `bookshelf_contacts`, replacing the single
// keeper on `bookshelves` with up to three ordered contacts per shelf.
const EXPECTED_TABLES = [
  "announcements",
  "audit_log",
  "book_copies",
  "book_donations",
  "books",
  "bookshelf_contacts",
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
  "sessions",
  "system_settings",
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

test("bookshelf_contacts holds up to three ordered contacts per shelf", async () => {
  const shelf = await makeShelf(sql);

  await sql`
    insert into bookshelf_contacts (bookshelf_id, position, name, phone, role_label)
    values (${shelf.id}, 1, 'Maria Nguyễn Thị Lan', '0912345678', 'Người giữ chìa khoá')
  `;

  // position is unique per shelf among live rows
  await expect(
    sql`
      insert into bookshelf_contacts (bookshelf_id, position, name)
      values (${shelf.id}, 1, 'Giuse Trần Minh')
    `,
  ).rejects.toMatchObject({ code: "23505" });

  // position is constrained to 1..3
  await expect(
    sql`
      insert into bookshelf_contacts (bookshelf_id, position, name)
      values (${shelf.id}, 4, 'Têrêsa Lê Ngọc Ánh')
    `,
  ).rejects.toMatchObject({ code: "23514" });
});

test("the keeper columns and opening hours are gone from bookshelves", async () => {
  const columns = await sql<{ column_name: string }[]>`
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'bookshelves'
  `;
  const names = columns.map((c) => c.column_name);
  expect(names).not.toContain("keeper_name");
  expect(names).not.toContain("keeper_phone");
  expect(names).not.toContain("opening_hours");
});

test("leaderboard_opt_in is gone from memberships", async () => {
  const columns = await sql<{ column_name: string }[]>`
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'memberships'
  `;
  expect(columns.map((c) => c.column_name)).not.toContain("leaderboard_opt_in");
});

test("saint_name is required and a reason may be recorded for a missing phone", async () => {
  await expect(
    sql`
      insert into users (full_name, father_name, mother_name)
      values ('Anna Phạm Thu Hà', 'Giuse Phạm Văn C', 'Maria Trần Thị D')
    `,
  ).rejects.toMatchObject({ code: "23502" });

  const [row] = await sql<{ phone_missing_reason: string | null }[]>`
    insert into users (saint_name, full_name, father_name, mother_name, phone_missing_reason)
    values ('Anna', 'Anna Phạm Thu Hà', 'Giuse Phạm Văn C', 'Maria Trần Thị D',
            'Em bé chưa có điện thoại, gia đình sẽ bổ sung sau')
    returning phone_missing_reason
  `;
  expect(row.phone_missing_reason).toBe(
    "Em bé chưa có điện thoại, gia đình sẽ bổ sung sau",
  );
});
