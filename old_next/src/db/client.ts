import postgres, { type Sql } from "postgres";

/**
 * The one place that knows how to reach the database.
 *
 * `DATABASE_URL` is configuration and nothing else (SDD §8) — no code here
 * cares whether Postgres runs in the compose file or somewhere managed.
 */
export function connect(url = process.env.DATABASE_URL): Sql {
  if (!url) throw new Error("DATABASE_URL is not set");
  return postgres(url, {
    // Transaction-mode pooling is compatible with `set local`, which RLS
    // needs (DB §3). Session-mode is not. Recorded here because the failure,
    // if this is ever changed, is silent cross-tenant leakage rather than an
    // error.
    prepare: false,
    onnotice: () => {},
  });
}

/**
 * The key `pool()` caches under, and the reason it is `Symbol.for` rather
 * than `Symbol()`.
 *
 * `Symbol()` mints a fresh, unequal symbol on every evaluation of this module.
 * Under `next dev` that is every edit — see `pool()` — so an unregistered
 * symbol would cache each new pool under a key nothing can ever look up
 * again, which is the module-level `let` bug wearing a symbol's clothes.
 * `Symbol.for` looks the key up in the process-wide registry, so every
 * evaluation of this module resolves to the same key and therefore finds the
 * pool the previous evaluation left behind.
 *
 * Not exported: `tests/db/client.test.ts` re-derives it with `Symbol.for` of
 * its own, which is what makes the assertion "the cache is reachable from
 * `globalThis` under a stable, registry-shared key" mean something. An
 * exported constant would let a module-level `let` satisfy the test by
 * exporting a key it never actually used.
 */
const POOL_KEY = Symbol.for("olibra.db.pool");

type PoolCache = { [POOL_KEY]?: Sql };

/**
 * The connection the running application uses — one pool for the process,
 * never `end()`ed.
 *
 * `connect()` above stays as it is, for the migration runner, the seed and the
 * suite: each of those wants a connection whose lifetime it controls and can
 * close. A page render wants the opposite. The runtime here is a long-lived
 * Bun process (`compose.yaml`'s `app` service), not a serverless function, and
 * `postgres.js` is already a pool — so opening one per request and tearing it
 * down again, which is what `dang-nhap/actions.ts` did while it was the only
 * database caller in `src/app/`, is a per-request TCP handshake and Postgres
 * backend fork for nothing.
 *
 * **Cached on `globalThis`, not in a module-level `let`.** Next.js re-evaluates
 * server modules on every edit in development, and a module-level binding dies
 * with the old module while the pool it names does not: the sockets stay open,
 * unreferenced and unclosable, and after enough edits Postgres answers
 * `sorry, too many clients already` — at which point the failure is a dev
 * server that cannot reach the database and a stack trace that names neither
 * this file nor hot reload. `globalThis` outlives module evaluation, so the
 * second evaluation finds the first one's pool.
 *
 * **Built by calling `connect()`, not by constructing a second options
 * object.** `connect()`'s comment says why `prepare: false` is there and what
 * silently breaks without it — transaction-mode pooling is what makes
 * `set local` (and therefore every RLS policy in `0010_rls.sql`) hold, and
 * getting it wrong "is silent cross-tenant leakage rather than an error". A
 * second `postgres(url, {...})` call here would be a second place to remember
 * that, and the whole failure mode is that nobody remembers. Calling
 * `connect()` makes it impossible to drop the option here without dropping it
 * for the migration runner and the seed too, where the suite would notice.
 * `tests/db/client.test.ts` reads the option back off the driver rather than
 * grepping this file for the string.
 */
export function pool(): Sql {
  const cache = globalThis as typeof globalThis & PoolCache;
  cache[POOL_KEY] ??= connect();
  return cache[POOL_KEY];
}

export type { Sql };
