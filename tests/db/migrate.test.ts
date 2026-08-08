import { afterAll, beforeEach, expect, test } from "vitest";
import { migrate } from "../../src/db/migrate";
import { closeAll, sql } from "../support/db";

beforeEach(async () => {
  await sql`drop schema public cascade`;
  await sql`create schema public`;
});
afterAll(closeAll);

test("applies every migration in order", async () => {
  const { applied } = await migrate(sql);
  expect(applied.length).toBeGreaterThan(0);
  expect(applied).toEqual([...applied].sort());
});

test("is idempotent — a second run applies nothing", async () => {
  await migrate(sql);
  const { applied } = await migrate(sql);
  expect(applied).toEqual([]);
});

test("records what it applied", async () => {
  await migrate(sql);
  const rows = await sql<{ name: string }[]>`
    select name from schema_migrations order by name
  `;
  expect(rows[0].name).toBe("0001_extensions.sql");
});
