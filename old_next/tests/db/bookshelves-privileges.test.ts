import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { migrate } from "../../src/db/migrate";
import { closeAll, resetDatabase, sql } from "../support/db";

beforeAll(() => migrate(sql));
// The second test below inserts a row; if the insert is not rejected (the
// pre-fix state this test exists to catch going red), the transaction
// commits, so the table needs resetting before each run rather than relying
// on the insert always failing.
beforeEach(resetDatabase);
afterAll(closeAll);

// S1 re-review, REQUIRED: DATABASE.md §3 claimed "olibra_app holds no insert
// grant on bookshelves at all" — a claim later copied into the S3 plan's
// acceptance criteria. It was false: 0010_rls.sql's `grant select, insert,
// update on all tables in schema public to olibra_app` sweeps up
// `bookshelves` along with every other table that exists when it runs, and
// the bespoke `bookshelves_tenant` policy right below it only scopes *which*
// rows an insert may target, not *whether* olibra_app may insert at all.
// 20260808_08_revoke_bookshelves_insert_from_app.sql closes the gap by
// revoking the grant explicitly, so this claim is finally true rather than
// aspirational.
test("olibra_app can read and update bookshelves but not insert one", async () => {
  const [priv] = await sql<
    {
      can_select: boolean;
      can_insert: boolean;
      can_update: boolean;
    }[]
  >`
    select
      has_table_privilege('olibra_app', 'bookshelves', 'SELECT') as can_select,
      has_table_privilege('olibra_app', 'bookshelves', 'INSERT') as can_insert,
      has_table_privilege('olibra_app', 'bookshelves', 'UPDATE') as can_update
  `;

  expect(priv.can_select).toBe(true);
  expect(priv.can_insert).toBe(false);
  // Deliberately left granted: a shelf legitimately edits its own row
  // (name, opening hours, settings) as olibra_app, scoped by
  // bookshelves_tenant's `with check (id = ...)` the same way every other
  // tenant table's self-service write already works. Only *creating* a new
  // bookshelf is reserved for olibra_admin.
  expect(priv.can_update).toBe(true);
});

test("an olibra_app session cannot create a bookshelf, even one matching its own session GUC", async () => {
  // The live reproduction this test locks in: before the fix, a session
  // scoped to a shelf id of its own choosing could insert a bookshelf row
  // with that exact id — bookshelves_tenant's `with check (id = ...)` was
  // satisfiable by any caller who picks the id first and the row second.
  const id = "22222222-2222-2222-2222-222222222222";

  await expect(
    sql.begin(async (tx) => {
      await tx`select set_config('olibra.bookshelf_id', ${id}, true)`;
      await tx`set local role olibra_app`;
      return tx`
        insert into bookshelves (id, slug, name, address, status)
        values (${id}, 'evil-shelf', 'Evil Shelf', 'Nowhere', 'active')
      `;
    }),
  ).rejects.toMatchObject({ code: "42501" });
});
