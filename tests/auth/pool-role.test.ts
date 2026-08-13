import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { fixedClock } from "../../src/domain/kernel/clock";
import { contextFor } from "../../src/auth/guards";
import { hashPassword } from "../../src/auth/password";
import {
  resolveSession,
  revokeAllSessions,
  signIn,
  signOut,
} from "../../src/auth/session";
import { migrate } from "../../src/db/migrate";
import { makeShelf } from "../support/factories";
import { testPoolDatabaseUrl } from "../support/env";
import { closeAll, resetDatabase, sql } from "../support/db";

/**
 * CRITICAL 2's acceptance test — Task 4's own bullet, finally run for real:
 * "Verify this by running the guards test suite against a pool role that is
 * provably not a superuser ... not by inspecting the grant alone."
 *
 * `sql` (tests/support/db.ts) stays the superuser throughout: it is what
 * `beforeEach(resetDatabase)` truncates every table with, and what the
 * factories below insert fixture rows with. Neither of those is what this
 * file exists to check. `poolSql` is the thing under test — a second,
 * independent connection authenticated as `olibra_pool`
 * (20260808_13_pool_role.sql), which every function below runs through
 * instead of `sql`. If `olibra_pool` were ever accidentally granted
 * superuser, or `bypassrls`, or lost its `olibra_app`/`olibra_admin`
 * membership, this file — not a grant inspected by eye — is what turns red.
 */
let poolSql: Sql;

beforeAll(async () => {
  await migrate(sql);
  poolSql = postgres(testPoolDatabaseUrl(), { max: 1, onnotice: () => {} });
});
beforeEach(resetDatabase);
afterAll(async () => {
  await poolSql.end();
  await closeAll();
});

const clock = fixedClock("2026-08-07T10:00:00Z");

test("olibra_pool is provably not a superuser and does not bypass row level security", async () => {
  // The assertion Task 4's bullet insists on making inside the test itself,
  // not trusted from the migration or from .env: "select rolsuper from
  // pg_roles where rolname = current_user inside a connection made through
  // the pool." A superuser bypasses RLS regardless of which role it then
  // `set local role`s to — that was the entire failure mode CRITICAL 2 named.
  const [row] = await poolSql<{ rolsuper: boolean; rolbypassrls: boolean }[]>`
    select rolsuper, rolbypassrls from pg_roles where rolname = current_user
  `;
  expect(row.rolsuper).toBe(false);
  expect(row.rolbypassrls).toBe(false);
});

async function signedInMemberOf(shelfId: string, role = "reader") {
  const [user] = await sql<{ id: string }[]>`
    insert into users (saint_name, full_name, father_name, mother_name, phone, username, password_hash)
    values ('Giuse', 'Giuse Trần Minh', 'A', 'B', '0900000000', 'tranminh', ${await hashPassword("x")})
    returning id
  `;
  await sql`
    insert into memberships (bookshelf_id, user_id, role, status)
    values (${shelfId}, ${user.id}, ${role}, 'active')
  `;
  return user.id;
}

test("the whole guard path — signIn, contextFor on the member's own shelf and another shelf, resolveSession, revokeAllSessions, signOut — works through olibra_pool", async () => {
  const a = await makeShelf(sql, { slug: "dong-thap" });
  const b = await makeShelf(sql, { slug: "an-giang" });
  const userId = await signedInMemberOf(a.id, "manager");

  // signIn, through the pool connection — not the superuser `sql`.
  const { token } = await signIn(poolSql, {
    username: "tranminh",
    password: "x",
    clock,
  });
  expect(await resolveSession(poolSql, token, clock)).toEqual({ userId });

  // contextFor on the member's own shelf: RLS must actually let this
  // through, not merely appear to — this is exactly the query the S3 plan's
  // reconciliation found broken (returning `guest` for a real member) the
  // first time RLS genuinely applied, because neither resolveShelfId nor
  // membershipFor originally set the role/GUC the policies require.
  const own = await contextFor(poolSql, {
    token,
    bookshelfSlug: "dong-thap",
    clock,
  });
  expect(own.actor.role).toBe("manager");
  expect(own.actor.userId).toBe(userId);

  // OPS §2, the rule this whole slice exists for, now proved through a
  // connection that cannot cheat by bypassing RLS: a valid session for shelf
  // A grants nothing on shelf B.
  const other = await contextFor(poolSql, {
    token,
    bookshelfSlug: "an-giang",
    clock,
  });
  expect(other.actor.role).toBe("guest");
  expect(other.actor.membershipId).toBeNull();

  // revokeAllSessions / signOut, also through the pool connection.
  await revokeAllSessions(poolSql, userId);
  expect(await resolveSession(poolSql, token, clock)).toBeNull();

  const second = await signIn(poolSql, {
    username: "tranminh",
    password: "x",
    clock,
  });
  await signOut(poolSql, second.token);
  expect(await resolveSession(poolSql, second.token, clock)).toBeNull();
});
