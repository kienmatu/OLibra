import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, expect, test } from "vitest";
import { migrate } from "../../src/db/migrate";
import { runPublicQuery } from "../../src/domain/kernel/unit-of-work";
import { closeAll, sql } from "../support/db";
import { testPoolDatabaseUrl } from "../support/env";

/**
 * IMPORTANT 1 (fix-report, 2026-08-09-u2-shelf-and-portal), and the half that
 * has to be a sweep rather than a sample.
 *
 * `runPublicQuery` used to run as `olibra_app`, on the argument written into
 * its own docstring: "every other table's `<table>_tenant` policy is
 * `bookshelf_id = <the GUC>`, which under the empty scope below is `null` and
 * therefore matches no row at all." Thirteen tables did behave that way. Five
 * did not — `users` and `sessions` carry no RLS at all (so an anonymous public
 * read reached every account row including `password_hash`, and every live
 * session's `token_hash`), `categories` and `schema_migrations` carry none
 * either, and `feedback_tenant`'s `using` admits `bookshelf_id is null`, which
 * is every site-wide row.
 *
 * The test that was meant to be the evidence sampled three tables and stopped,
 * and three tables is exactly the shape of check that agrees with a wrong
 * premise. **So this one discovers its subjects from the catalog.** `pg_class`
 * for the relations, `information_schema.columns` for `bookshelves`' columns:
 * a table added by a later migration, or a column added to `bookshelves`, is
 * covered without anybody remembering this file exists. A hand-written list is
 * the failure mode, not the convenience.
 *
 * **Through `runPublicQuery` itself, and through the real pool role.** The
 * connection is `olibra_pool` (`TEST_POOL_DATABASE_URL`), which is what the
 * application actually authenticates as, and the transaction is opened by the
 * production function rather than by a hand-copied `begin`/`set local role`
 * here — the same reason `tests/auth/pool-role.test.ts` connects as
 * `olibra_pool` rather than asserting on `pg_roles` alone. A test that rebuilt
 * the transaction would keep passing after somebody changed the role inside
 * `runPublicQuery`.
 *
 * `tests/support/db.ts`'s shared `sql` cannot be that connection: it is the
 * `olibra` superuser, which bypasses both RLS and — being a superuser — every
 * privilege check this file is about, so every assertion below would pass
 * against a role with `grant all`.
 */

/**
 * The one relation a public caller may read, and the only one.
 *
 * `bookshelves` is what `bookshelves_public_read`
 * (`20260808_12_bookshelves_public_read.sql`) exists for and what the portal
 * directory is made of (BR §16.1, OPS §3.1's `GetPortalDirectory`). Every other
 * relation in the schema — base table, view or materialised view — must refuse.
 *
 * Adding a name here is the deliberate act: it widens what a stranger with no
 * session anywhere can reach, and it should read like that in a diff.
 */
const PUBLICLY_READABLE_RELATIONS = ["bookshelves"];

/**
 * The columns of `bookshelves` a public caller may read.
 *
 * `slug`, `name` and `location` are what BR §16.1 publishes ("name and address
 * only"). `status` and `deleted_at` are named by `listPublicShelves`' own
 * `where` clause — deliberately, since `bookshelves_tenant` is a second
 * permissive policy and Postgres ORs permissive policies together — and a
 * predicate the *caller* writes needs the caller's own privilege on the
 * column, unlike a policy's `using` expression.
 *
 * Everything else refuses, `keeper_name` / `keeper_phone` / `settings` /
 * `created_by` above all: those four are the `WITHHELD_COLUMNS` of
 * `tests/db/bookshelves-public-columns.test.ts`, which is a regex over source
 * text. This is the same boundary as a fact about the database, which is why
 * both exist — one fails when somebody types the query, the other when
 * somebody runs it.
 */
const PUBLICLY_READABLE_BOOKSHELF_COLUMNS = [
  "slug",
  "name",
  "location",
  "status",
  "deleted_at",
];

/** Postgres's `insufficient_privilege`. */
const INSUFFICIENT_PRIVILEGE = "42501";

let poolSql: Sql;

beforeAll(async () => {
  await migrate(sql);
  poolSql = postgres(testPoolDatabaseUrl(), { max: 1, onnotice: () => {} });
});

afterAll(async () => {
  await poolSql?.end();
  await closeAll();
});

/** `{ ok: true }` or the SQLSTATE the statement raised. */
async function publicSelect(statement: string): Promise<string | "ok"> {
  try {
    await runPublicQuery(poolSql, (tx) => tx.unsafe(statement));
    return "ok";
  } catch (err) {
    return (err as { code?: string }).code ?? `no-sqlstate: ${String(err)}`;
  }
}

/** Every relation in `public` that a `select` could name. */
async function relations(): Promise<string[]> {
  const rows = await sql<{ relname: string }[]>`
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'v', 'm', 'p')
    order by c.relname
  `;
  return rows.map((r) => r.relname);
}

test("the sweep can see both halves of what it compares", async () => {
  // This file's own guard, in the shape `a-wired-page-renders-no-fixtures
  // .test.ts` uses: the assertions below are satisfied perfectly by a sweep
  // that found nothing, and "found nothing" is a live failure mode — a
  // `relations()` that returned `[]` because the schema had not been migrated
  // would make every table below vacuously safe.
  const found = await relations();

  // The five the finding named, plus the one that must stay readable. If any
  // of these ever stops existing this test should be edited, not silently
  // pass.
  for (const name of [
    "users",
    "sessions",
    "categories",
    "schema_migrations",
    "feedback",
    "bookshelves",
  ]) {
    expect(found, `${name} missing from the catalog sweep`).toContain(name);
  }
  // Views too: `loans_current` and `copies_borrowable` are `security_invoker`
  // views over tenant tables, and a sweep that only looked at `relkind = 'r'`
  // would not see them at all.
  expect(found).toContain("loans_current");
  expect(found).toContain("copies_borrowable");
});

test("a public read is refused by privilege on every relation except the portal directory", async () => {
  const offenders: string[] = [];

  for (const relname of await relations()) {
    // `select 1 from x` and not `select * from x`: the wildcard would fail on
    // `bookshelves` for a *column* reason, and this test is about the table.
    const outcome = await publicSelect(`select 1 from "${relname}" limit 1`);
    const shouldBeReadable = PUBLICLY_READABLE_RELATIONS.includes(relname);

    if (shouldBeReadable && outcome !== "ok") {
      offenders.push(`${relname}: expected readable, got ${outcome}`);
    }
    if (!shouldBeReadable && outcome !== INSUFFICIENT_PRIVILEGE) {
      // `ok` here is the finding itself: rows handed to a caller with no
      // session and no membership anywhere.
      offenders.push(
        `${relname}: expected ${INSUFFICIENT_PRIVILEGE}, got ${outcome}`,
      );
    }
  }

  expect(offenders).toEqual([]);
});

test("a public read of bookshelves is refused by privilege on every column except the published ones", async () => {
  const columns = await sql<{ column_name: string }[]>`
    select column_name
    from information_schema.columns
    where table_schema = 'public' and table_name = 'bookshelves'
    order by column_name
  `;
  expect(columns.length).toBeGreaterThan(
    PUBLICLY_READABLE_BOOKSHELF_COLUMNS.length,
  );

  const offenders: string[] = [];
  for (const { column_name } of columns) {
    const outcome = await publicSelect(
      `select "${column_name}" from bookshelves limit 1`,
    );
    const shouldBeReadable =
      PUBLICLY_READABLE_BOOKSHELF_COLUMNS.includes(column_name);

    if (shouldBeReadable && outcome !== "ok") {
      offenders.push(`${column_name}: expected readable, got ${outcome}`);
    }
    if (!shouldBeReadable && outcome !== INSUFFICIENT_PRIVILEGE) {
      offenders.push(
        `${column_name}: expected ${INSUFFICIENT_PRIVILEGE}, got ${outcome}`,
      );
    }
  }

  expect(offenders).toEqual([]);
});

test("a public read cannot select every column of bookshelves, under any spelling", async () => {
  // The database's half of `tests/db/bookshelves-public-columns.test.ts`.
  // That guard is a regex over source text and this is a privilege, so a
  // wildcard that slipped past the regex — `select b.*`, which is how every
  // query in this codebase is actually written — still cannot run.
  expect(await publicSelect("select * from bookshelves limit 1")).toBe(
    INSUFFICIENT_PRIVILEGE,
  );
  expect(await publicSelect("select b.* from bookshelves b limit 1")).toBe(
    INSUFFICIENT_PRIVILEGE,
  );
});

test("olibra_public is not a login role, not a superuser, and does not bypass RLS", async () => {
  // The same static-configuration check `pool-role-privileges.test.ts` makes
  // for `olibra_pool`. `rolcanlogin` is false here and true there, and that is
  // the difference worth pinning: nothing ever connects *as* `olibra_public` —
  // it is only ever reached through `set local role` from a connection already
  // authenticated as `olibra_pool`.
  const [row] = await sql<
    { rolcanlogin: boolean; rolsuper: boolean; rolbypassrls: boolean }[]
  >`
    select rolcanlogin, rolsuper, rolbypassrls
    from pg_roles where rolname = 'olibra_public'
  `;
  expect(row.rolcanlogin).toBe(false);
  expect(row.rolsuper).toBe(false);
  expect(row.rolbypassrls).toBe(false);
});

test("olibra_public holds none of olibra_app's privileges", async () => {
  // Membership in `olibra_app` would hand back exactly what this role exists
  // to withhold. `pg_has_role(..., 'member')` is membership regardless of the
  // INHERIT flag, so this is stronger than checking `usage`.
  const [row] = await sql<{ is_member: boolean }[]>`
    select pg_has_role('olibra_public', 'olibra_app', 'member') as is_member
  `;
  expect(row.is_member).toBe(false);
});

test("olibra_pool may assume olibra_public, but does not inherit it", async () => {
  // `runPublicQuery`'s `set local role olibra_public` runs on a connection
  // authenticated as `olibra_pool`, so the membership has to exist —
  // `with inherit false` for the reason 20260808_13_pool_role.sql records.
  const [row] = await sql<{ is_member: boolean; can_use: boolean }[]>`
    select
      pg_has_role('olibra_pool', 'olibra_public', 'member') as is_member,
      pg_has_role('olibra_pool', 'olibra_public', 'usage')  as can_use
  `;
  expect(row.is_member).toBe(true);
  expect(row.can_use).toBe(false);
});
