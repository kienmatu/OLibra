import { afterAll, beforeEach, expect, test } from "vitest";
import { closeAll, resetDatabase, sql, withTwoConnections } from "./db";

beforeEach(resetDatabase);
afterAll(closeAll);

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
