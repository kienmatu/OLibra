import postgres, { type Sql, type TransactionSql } from "postgres";
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
  try {
    return await body(a, b);
  } finally {
    await Promise.all([a.end(), b.end()]);
  }
}

/**
 * Wraps `raw` so that any query issued inside a transaction whose first
 * template chunk satisfies `match` does not resolve to its caller until
 * `gate` resolves — while the query is still sent, and its real result
 * still fetched, immediately.
 *
 * Built for IMPORTANT 3 (fix-report, 2026-08-08-b1-catalogue): a "lost
 * update" bug only reproduces when a second, fully separate transaction
 * commits in the exact window between a first command's own read and its
 * own later write, within the *same* open transaction. A real two-connection
 * race for that is a coin flip — nothing forces the interleaving to land in
 * that window. This holds a command's transaction open exactly where that
 * window is (right after a query matching `match` resolves), so a caller
 * can run a second, independent command to completion in between,
 * deterministically, against the real production command — not a
 * hand-rolled duplicate of its SQL.
 *
 * Positioned *underneath* the kernel's own `guardWrites` (this wraps the raw
 * `sql.begin`, before the kernel wraps its `tx` argument), so the delayed
 * query still carries every method (`.allowZero`, `.simple`, `.raw`, ...)
 * `guardPendingQuery` expects to find and re-bind — it copies them across
 * exactly the way that function does, rather than returning a bare
 * `.then()` chain that would be missing them.
 */
export function withDelayedQuery(
  raw: Sql,
  match: (firstChunk: string) => boolean,
  gate: Promise<void>,
): Sql {
  const delayMatchingQueries = (tx: TransactionSql): TransactionSql => {
    const callable = tx as unknown as (...args: unknown[]) => any;
    return new Proxy(callable, {
      apply(target, thisArg, argArray) {
        const real = Reflect.apply(target, thisArg, argArray);
        const strings = argArray[0] as TemplateStringsArray | undefined;
        if (!strings || !match(strings[0])) return real;
        const delayed = real.then(async (result: unknown) => {
          await gate;
          return result;
        });
        return Object.assign(delayed, {
          simple: real.simple.bind(real),
          readable: real.readable.bind(real),
          writable: real.writable.bind(real),
          execute: real.execute.bind(real),
          cancel: real.cancel.bind(real),
          forEach: real.forEach.bind(real),
          cursor: real.cursor.bind(real),
          describe: real.describe.bind(real),
          values: real.values.bind(real),
          raw: real.raw.bind(real),
        });
      },
    }) as unknown as TransactionSql;
  };

  return new Proxy(raw, {
    get(target, prop, receiver) {
      if (prop === "begin") {
        return (fn: (tx: TransactionSql) => unknown) =>
          (target.begin as (fn: (tx: TransactionSql) => unknown) => unknown)((tx) =>
            fn(delayMatchingQueries(tx)),
          );
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as Sql;
}

/**
 * Tables `resetDatabase` must never truncate, and why.
 *
 * - `schema_migrations`: the migration ledger (see docs/superpowers/plans
 *   .../s1-schema-rls.md). Truncating it while the objects it records still
 *   exist would empty the ledger but leave the schema built, so the next
 *   `migrate()` call re-applies an already-applied migration and fails
 *   (e.g. Postgres 42710, "type ... already exists"). The ledger is additive
 *   and small; it does not need to be reset between tests the way ordinary
 *   data tables do.
 */
export const RESET_EXCLUDED_TABLES = ["schema_migrations"] as const;

/**
 * Truncates every table in the public schema except `RESET_EXCLUDED_TABLES`.
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
  const toTruncate = tables
    .map((t) => t.tablename)
    .filter((name) => !(RESET_EXCLUDED_TABLES as readonly string[]).includes(name));
  if (toTruncate.length === 0) return;
  const list = toTruncate.map((name) => `public."${name}"`).join(", ");
  await sql.unsafe(`truncate table ${list} restart identity cascade`);
}

export async function closeAll(): Promise<void> {
  await sql.end();
}
