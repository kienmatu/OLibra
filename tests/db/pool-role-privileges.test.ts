import { afterAll, beforeAll, expect, test } from "vitest";
import { migrate } from "../../src/db/migrate";
import { closeAll, sql } from "../support/db";

beforeAll(() => migrate(sql));
afterAll(closeAll);

// CRITICAL 2. The same class of static-grant check bookshelves-privileges
// .test.ts and schema-migrations-privileges.test.ts already make for other
// roles — tests/auth/pool-role.test.ts is the one that proves this actually
// enforces anything end to end, by connecting *as* olibra_pool and running
// the guard path through it; this one documents the configuration a
// reviewer would otherwise have to read the migration to find.
test("olibra_pool is a login role, not a superuser, and does not bypass RLS", async () => {
  const [row] = await sql<
    { rolcanlogin: boolean; rolsuper: boolean; rolbypassrls: boolean }[]
  >`
    select rolcanlogin, rolsuper, rolbypassrls
    from pg_roles where rolname = 'olibra_pool'
  `;
  expect(row.rolcanlogin).toBe(true);
  expect(row.rolsuper).toBe(false);
  expect(row.rolbypassrls).toBe(false);
});

test("olibra_pool is a member of olibra_app and olibra_admin, but inherits neither automatically", async () => {
  // `with inherit false` (20260808_13_pool_role.sql): membership alone must
  // not hand olibra_pool either role's table privileges the moment it
  // connects — every call site has to `set local role` explicitly, the same
  // way DATABASE.md §3 already required by convention before this made it
  // structural. `pg_has_role(..., 'usage')` reflects privileges actually
  // available for use right now (SET ROLE or inherited); `'member')`
  // reflects membership regardless of inherit.
  const rows = await sql<
    { target: string; is_member: boolean; can_use: boolean }[]
  >`
    select
      target,
      pg_has_role('olibra_pool', target, 'member') as is_member,
      pg_has_role('olibra_pool', target, 'usage')  as can_use
    from unnest(array['olibra_app', 'olibra_admin']) as target
  `;

  for (const row of rows) {
    expect(row.is_member, `${row.target}: expected membership`).toBe(true);
    expect(row.can_use, `${row.target}: expected no automatic inherit`).toBe(false);
  }
});
