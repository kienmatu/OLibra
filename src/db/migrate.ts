import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Sql } from "postgres";

const DEFAULT_DIR = join(import.meta.dirname, "migrations");

/**
 * Applies every not-yet-applied migration, in filename order, each in its own
 * transaction.
 *
 * Forward-only (DB §9). There is no `down`: the safety net is testing a
 * migration against a restored copy of production data before it runs for
 * real, not a rollback path that has itself never been exercised.
 */
export async function migrate(
  sql: Sql,
  dir: string = DEFAULT_DIR,
): Promise<{ applied: string[] }> {
  await sql`
    create table if not exists schema_migrations (
      name        text primary key,
      applied_at  timestamptz not null default now()
    )
  `;

  const done = new Set(
    (await sql<{ name: string }[]>`select name from schema_migrations`).map(
      (r) => r.name,
    ),
  );

  const pending = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .filter((f) => !done.has(f));

  const applied: string[] = [];
  for (const name of pending) {
    const body = readFileSync(join(dir, name), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`insert into schema_migrations (name) values (${name})`;
    });
    applied.push(name);
  }

  return { applied };
}
