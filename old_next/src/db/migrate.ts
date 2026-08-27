import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Sql } from "postgres";

const DEFAULT_DIR = join(import.meta.dirname, "migrations");

/**
 * Matches a `__ENV_NAME__` placeholder in a migration file's raw SQL text.
 *
 * CRITICAL 2 is what this exists for: `20260808_13_pool_role.sql` creates the
 * application's connection-pool login role with a password that must differ
 * across every environment (a developer's machine, CI, production) and must
 * never be a literal committed to the migration file. `migrate()` runs each
 * file with `tx.unsafe(body)` — no parameter binding, because a migration is
 * schema DDL, not a query with placeholders postgres.js can bind — so the
 * only way to keep the value out of the file is to substitute it into the
 * text before that call, from `process.env`, here.
 */
const ENV_PLACEHOLDER = /__ENV_([A-Z0-9_]+)__/g;

/**
 * Substitutes every `__ENV_NAME__` in `body` with `process.env.NAME`.
 *
 * Single-quote doubling, not full SQL escaping: the values this substitutes
 * come from trusted deployment configuration (an operator's own environment),
 * not from any request this application ever serves — the threat this guards
 * against is a password that happens to contain a `'` breaking out of the
 * literal it is embedded in, not an adversarial value.
 */
export function renderMigration(body: string): string {
  return body.replace(ENV_PLACEHOLDER, (_match, name: string) => {
    const value = process.env[name];
    if (value === undefined) {
      throw new Error(
        `migration references __ENV_${name}__, but process.env.${name} is not set`,
      );
    }
    return value.replace(/'/g, "''");
  });
}

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
    const body = renderMigration(readFileSync(join(dir, name), "utf8"));
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`insert into schema_migrations (name) values (${name})`;
    });
    applied.push(name);
  }

  return { applied };
}
