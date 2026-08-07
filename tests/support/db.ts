import postgres, { type Sql } from "postgres";
import { testDatabaseUrl } from "./env";

/**
 * The shared connection for setup and assertions.
 *
 * `max: 1` on purpose: a test that wants concurrency must ask for it through
 * `withTwoConnections`, so the concurrency in a test is visible in the test
 * rather than emerging from pool scheduling.
 */
export const sql: Sql = postgres(testDatabaseUrl(), {
  max: 1,
  onnotice: () => {},
});

const extraConnections: Sql[] = [];

/**
 * Runs `body` with two independent connections.
 *
 * Every invariant that guards against two managers acting at once (INV-1 above
 * all) needs this. A single connection cannot reproduce the race, and a test
 * that cannot reproduce the race would pass against an implementation with no
 * constraint at all — which is the failure mode this harness exists to prevent.
 */
export async function withTwoConnections<T>(
  body: (a: Sql, b: Sql) => Promise<T>,
): Promise<T> {
  const url = testDatabaseUrl();
  const a = postgres(url, { max: 1, onnotice: () => {} });
  const b = postgres(url, { max: 1, onnotice: () => {} });
  extraConnections.push(a, b);
  try {
    return await body(a, b);
  } finally {
    await Promise.all([a.end(), b.end()]);
    extraConnections.length = 0;
  }
}

/**
 * Truncates every table in the public schema.
 *
 * Truncation rather than transaction-rollback, because rollback isolation is
 * incompatible with `withTwoConnections` — see the note above.
 *
 * `restart identity cascade` resets sequences too, so a test asserting a
 * generated copy code like `DT-0001` is not silently dependent on how many
 * tests ran before it.
 */
export async function resetDatabase(): Promise<void> {
  const tables = await sql<{ tablename: string }[]>`
    select tablename from pg_tables where schemaname = 'public'
  `;
  if (tables.length === 0) return;
  const list = tables.map((t) => `public."${t.tablename}"`).join(", ");
  await sql.unsafe(`truncate table ${list} restart identity cascade`);
}

export async function closeAll(): Promise<void> {
  await Promise.all(extraConnections.map((c) => c.end()));
  await sql.end();
}
