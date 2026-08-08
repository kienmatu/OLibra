import { readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, expect, test } from "vitest";
import { migrate } from "../../src/db/migrate";
import { closeAll, sql } from "../support/db";

const MIGRATIONS_DIR = join(import.meta.dirname, "../../src/db/migrations");

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

// S1 re-review, item 4: migrate() sorts filenames with a plain string
// `.sort()` (src/db/migrate.ts). The `00NN_` slots are frozen at 0001-0012
// (docs/DATABASE.md §9); everything after them is named `YYYYMMDD_NN_...`.
// A file named `0013_x.sql` sorts, alphabetically, between `0012_...` and
// `20260808_01_...` — '0' < '2' — which is fine in isolation, but not once
// database age enters the picture: migrate() only orders the *pending* set,
// built by sorting every filename and then dropping the ones already
// recorded in schema_migrations. On a fresh database every file is pending,
// so `0013_x.sql` runs interleaved, between 0012 and the 20260808_* run. On
// a database that already has 0001-0012 and every 20260808_* migration
// applied, `0013_x.sql` is the *only* pending file, so it runs last —
// after every 20260808_* migration, not before them. Same file, two
// orderings, depending on when the database was built relative to when the
// file was added. Nothing but convention stops the next migration from
// being named this way — with twelve `00NN_` files already in the
// directory, adding a thirteenth is the natural instinct.
test("every migration filename is a frozen 00NN slot (0001-0012) or a YYYYMMDD_NN timestamp, never a new 00NN one", () => {
  const FROZEN = /^00(0[1-9]|1[0-2])_[a-z0-9_]+\.sql$/;
  const TIMESTAMPED = /^\d{8}_\d{2}_[a-z0-9_]+\.sql$/;

  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
  expect(files.length).toBeGreaterThan(0);

  for (const f of files) {
    const ok = FROZEN.test(f) || TIMESTAMPED.test(f);
    expect(
      ok,
      `${f} is neither a frozen 0001-0012 migration nor a YYYYMMDD_NN one — ` +
        `a new 00NN file (e.g. 0013_x.sql) sorts between 0012 and the first ` +
        `20260808_* migration, which orders differently on a fresh database ` +
        `than on one where 0001-0012 are already applied`,
    ).toBe(true);
  }
});
