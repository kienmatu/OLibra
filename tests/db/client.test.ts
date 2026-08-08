import { afterEach, beforeEach, expect, test } from "vitest";
import { connect, pool } from "../../src/db/client";
import { testDatabaseUrl } from "../support/env";

/**
 * `pool()` (U1 Task 1), and the two things about it that are silent when
 * wrong.
 *
 * No database is touched here and none needs to be: `postgres.js` connects
 * lazily, on the first query, so every handle these tests build is an options
 * object and nothing more. The URL still has to be a real one — `connect()`
 * refuses an unset `DATABASE_URL`, and CI does not set it (only the `TEST_`-
 * prefixed variables, per `tests/architecture/ci-supplies-required-env
 * .test.ts`) — so it is set here, to the test database, for the length of the
 * file.
 *
 * `pool()` caches process-wide by design, which makes it the one thing in this
 * codebase a test cannot get a fresh copy of by importing it again. So the
 * cache is cleared explicitly between tests, through the same registry key the
 * implementation uses. That is not a workaround for the design; it is the
 * design being visible.
 */

/**
 * Re-derived rather than imported. `Symbol.for` reads a process-wide registry,
 * so this expression and the one in `src/db/client.ts` resolve to the same key
 * only if the implementation really did use the registry — which is exactly
 * the property "the pool survives a module re-evaluation" below is about. An
 * imported constant would be satisfied by an implementation that exported a
 * key and then cached somewhere else entirely.
 */
const POOL_KEY = Symbol.for("olibra.db.pool");

type PoolCache = typeof globalThis & { [POOL_KEY]?: unknown };

let previousUrl: string | undefined;

beforeEach(() => {
  previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = testDatabaseUrl();
  delete (globalThis as PoolCache)[POOL_KEY];
});

afterEach(() => {
  delete (globalThis as PoolCache)[POOL_KEY];
  if (previousUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousUrl;
});

test("pool() hands back the same connection every time", () => {
  // The whole point of §3.1 of the U1 plan: forty-six pages will call this on
  // every render. A `pool()` that returned a new `postgres()` each time would
  // be `connect()` with the `end()` removed — a leak rather than a pool, and
  // one nothing else in the suite would notice.
  expect(pool()).toBe(pool());
});

test("the pool is cached on globalThis, under the shared registry key", () => {
  // Next.js re-evaluates server modules on every edit in development. A
  // module-level `let` is discarded with the old module while its sockets stay
  // open, so each edit leaks a pool until Postgres refuses new connections —
  // and the eventual error names neither this file nor hot reload.
  //
  // There is no way to re-evaluate a module inside Vitest that resembles what
  // `next dev` does, so this asserts the property that makes surviving
  // re-evaluation possible instead: the handle is reachable from `globalThis`,
  // under a key any evaluation of the module can re-derive. A module-level
  // `let`, or an unregistered `Symbol()`, leaves nothing here to find.
  const handle = pool();
  expect((globalThis as PoolCache)[POOL_KEY]).toBe(handle);
});

test("pool() inherits connect()'s prepare: false", async () => {
  // The option `connect()`'s own comment calls out: transaction-mode pooling
  // is what makes `set local` — and therefore every RLS policy — hold, and
  // dropping it "is silent cross-tenant leakage rather than an error".
  //
  // Read back off the driver's parsed options, not grepped out of the source
  // text. `postgres.js` defaults `prepare` to `true`, so a `pool()` that built
  // its own options object and forgot the flag reads `true` here, whatever the
  // file says about it.
  const own = connect(testDatabaseUrl());
  try {
    expect(pool().options.prepare).toBe(false);
    expect(pool().options.prepare).toBe(own.options.prepare);
  } finally {
    await own.end();
  }
});
