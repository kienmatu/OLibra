import { afterAll, beforeEach, expect, test } from "vitest";
import { closeAll, resetDatabase, sql, withTwoConnections } from "./db";

beforeEach(resetDatabase);

afterAll(async () => {
  // harness_probe is a scratch table created only by this file's tests, via
  // `create table if not exists`. It is never dropped by resetDatabase (it's
  // an ordinary table, not in RESET_EXCLUDED_TABLES) or by anything else, so
  // without this it leaks into `public` forever — and S1's schema test
  // asserts the exact list of tables in `public`, which a stray table fails.
  await sql`drop table if exists harness_probe`;
  await closeAll();
});

test("two connections see each other's committed work", async () => {
  await sql`create table if not exists harness_probe (id int primary key)`;

  const seen = await withTwoConnections(async (a, b) => {
    await a`insert into harness_probe (id) values (1)`;
    // b is a genuinely separate connection, so it sees a's committed row.
    const rows = await b<{ id: number }[]>`select id from harness_probe`;
    return rows.map((r) => r.id);
  });

  expect(seen).toEqual([1]);
});

test("exactly one of two concurrent inserts of the same key survives", async () => {
  // This is the shape every invariant test that involves a race will take.
  // If this passes, INV-1 is testable. If it does not, nothing else matters.
  await sql`create table if not exists harness_probe (id int primary key)`;

  const outcomes = await withTwoConnections(async (a, b) => {
    const results = await Promise.allSettled([
      a`insert into harness_probe (id) values (7)`,
      b`insert into harness_probe (id) values (7)`,
    ]);
    return results.map((r) => r.status);
  });

  expect(outcomes.filter((s) => s === "fulfilled")).toHaveLength(1);
  expect(outcomes.filter((s) => s === "rejected")).toHaveLength(1);
});

test("resetDatabase empties tables between tests", async () => {
  await sql`create table if not exists harness_probe (id int primary key)`;
  await sql`insert into harness_probe (id) values (99)`;
  await resetDatabase();
  const rows = await sql`select id from harness_probe`;
  expect(rows).toHaveLength(0);
});

test("withTwoConnections hands out two distinct backend connections", async () => {
  // The two previous tests both pass even if `withTwoConnections` secretly
  // returned the same connection twice — see the transaction-visibility test
  // below for why that matters, and the discriminator here: two genuinely
  // separate libpq connections are two separate Postgres backend processes,
  // each with its own pid. If a future edit collapses `b` into `a`, this pid
  // comparison is what catches it, where the previous two tests would not.
  const [pidA, pidB] = await withTwoConnections(async (a, b) => {
    const [rowA] = await a<{ pid: number }[]>`select pg_backend_pid() as pid`;
    const [rowB] = await b<{ pid: number }[]>`select pg_backend_pid() as pid`;
    return [rowA.pid, rowB.pid];
  });

  expect(pidA).not.toBe(pidB);
});

test("b cannot see a's uncommitted row while a's transaction is open", async () => {
  // This is the exact property resetDatabase's truncate-over-rollback design
  // rests on (see the comment above resetDatabase in ./db.ts): the harness
  // never gives a test transaction isolation, so nothing else must assume it
  // gets any either. Written as raw `begin`/`rollback` on `a` rather than
  // `a.begin(...)`, deliberately: with the two-connections mutation described
  // in the CRITICAL-3 finding (`return await body(a, a)`), a single
  // `max: 1` connection sending `begin` and then a later, separate query is
  // still just one session executing statements in order — so the "b" select
  // below would run *inside* a's open transaction and see the uncommitted
  // row, flipping this assertion. `a.begin(callback)` would instead reserve
  // the sole connection for the whole callback and deadlock waiting on that
  // same reserved connection when "b" tries to query it — a timeout, not a
  // clean failure.
  await sql`create table if not exists harness_probe (id int primary key)`;

  const seenByB = await withTwoConnections(async (a, b) => {
    await a`begin`;
    try {
      await a`insert into harness_probe (id) values (42)`;
      const rows = await b<{ id: number }[]>`
        select id from harness_probe where id = 42
      `;
      return rows.length;
    } finally {
      await a`rollback`;
    }
  });

  expect(seenByB).toBe(0);
});
