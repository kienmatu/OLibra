import { afterAll, beforeAll, expect, test } from "vitest";
import { migrate } from "../../src/db/migrate";
import { closeAll, sql } from "../support/db";

beforeAll(() => migrate(sql));
afterAll(closeAll);

// M6: 0010_rls.sql's `grant select, insert, update on all tables in schema
// public to olibra_app` swept up schema_migrations along with every real
// table. Harmless while nothing calls migrate() as olibra_app, but wrong
// for the role serving untrusted requests. 20260808_07_revoke_schema_
// migrations_from_app.sql revokes insert/update, leaving select (there is
// no reason to hide the ledger, only to stop writing it).
test("olibra_app can read but not write schema_migrations", async () => {
  const [priv] = await sql<
    {
      can_select: boolean;
      can_insert: boolean;
      can_update: boolean;
    }[]
  >`
    select
      has_table_privilege('olibra_app', 'schema_migrations', 'SELECT') as can_select,
      has_table_privilege('olibra_app', 'schema_migrations', 'INSERT') as can_insert,
      has_table_privilege('olibra_app', 'schema_migrations', 'UPDATE') as can_update
  `;

  expect(priv.can_select).toBe(true);
  expect(priv.can_insert).toBe(false);
  expect(priv.can_update).toBe(false);
});
