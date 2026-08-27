import { afterAll, beforeAll, expect, test } from "vitest";
import { migrate } from "../../src/db/migrate";
import { closeAll, sql } from "../support/db";

beforeAll(() => migrate(sql));
afterAll(closeAll);

/**
 * IMPORTANT 4: completeness rested on a hand-typed array inside 0010_rls.sql's
 * `do $$ ... $$` block, checked against nothing. Demonstrated live: dropping
 * `memberships_tenant` left the entire invariants directory green — eleven
 * of the fourteen policies had no test asserting they exist at all. CRITICAL
 * 1 (feedback) is that exact failure, already having happened once.
 *
 * One test, not fourteen: the set of tables carrying a `bookshelf_id`
 * column must equal the set of tables with `relrowsecurity` — with an
 * explicit allow-list for the one deliberate exception this loop's shape
 * cannot express.
 */

// `bookshelves` is the one shelf-scoped table with no `bookshelf_id` column
// — it is scoped by its own `id` (0010_rls.sql's own comment: "the one
// table in this migration a plain loop over 'bookshelf_id = ...' cannot
// express"). It genuinely carries RLS; it just cannot be found by scanning
// for the column. Any other table appearing here would mean either a
// column-bearing table skipping RLS (CRITICAL 1's bug) or a table getting
// RLS it should not have — neither should pass silently.
const RLS_WITHOUT_BOOKSHELF_ID_COLUMN = ["bookshelves"];

test("every table with a bookshelf_id column has RLS enabled, and nothing else does (modulo bookshelves)", async () => {
  // Restricted to base tables, not views: loans_current and
  // copies_borrowable (0011_views.sql) both expose a bookshelf_id column
  // too (loans_current via \`l.*\`, copies_borrowable via \`c.*\`), but a
  // view has no RLS of its own to enable — its tenant-scoping comes from
  // \`security_invoker = true\` applying the querying role's policies on the
  // underlying table, which CRITICAL 2's tests cover separately.
  const withColumn = await sql<{ table_name: string }[]>`
    select c.table_name from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public'
      and c.column_name = 'bookshelf_id'
      and t.table_type = 'BASE TABLE'
  `;
  const withRls = await sql<{ relname: string }[]>`
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
  `;

  const expected = new Set([
    ...withColumn.map((r) => r.table_name),
    ...RLS_WITHOUT_BOOKSHELF_ID_COLUMN,
  ]);
  const actual = new Set(withRls.map((r) => r.relname));

  expect([...actual].sort()).toEqual([...expected].sort());
});

test("every RLS-enabled table also forces it onto its own owner", async () => {
  // 0010_rls.sql's comment: without FORCE, "a migration or an admin script
  // silently sees everything" — the table owner (and any superuser) is
  // exempt from RLS unless the table explicitly forces it. A table that
  // enables RLS but forgets FORCE would still pass every olibra_app test
  // (olibra_app is never the owner), so this needs its own assertion.
  const rows = await sql<
    { relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[]
  >`
    select c.relname, c.relrowsecurity, c.relforcerowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
  `;

  for (const row of rows) {
    expect(
      row.relforcerowsecurity,
      `${row.relname} enables RLS but does not FORCE it`,
    ).toBe(true);
  }
  expect(rows.length).toBeGreaterThan(0);
});
