# S0 · Test Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the project a test runner that can open two concurrent database transactions against a real PostgreSQL, so the fourteen invariants of BR §6 can be tested the way they actually fail in production.

**Architecture:** Vitest on Node, running domain code directly with no web server (G2). Tests talk to a real PostgreSQL 16 from a dedicated compose service on its own port and its own data directory, so running tests never touches development data. Isolation is per-file schema plus truncation, deliberately **not** transaction-rollback, for the reason in Task 3.

**Tech Stack:** Vitest 3 · `postgres` (porsager) · PostgreSQL 16 via Docker Compose.

## Global Constraints

Inherited from [the master plan](2026-08-07-olibra-backend-master.md#global-constraints). The ones this slice turns on:

- **G2** — any operation must be callable from a test with no web server running.
- **G9** — nothing may depend on `Bun.*`. The test runner is Node.
- **G12** — every one of the fourteen invariants gets its own named test, including the structural ones.
- **G6** — timezone is `Asia/Ho_Chi_Minh`; tests must pin it or they pass in Vietnam and fail in CI.

---

## Why Vitest and not `bun test`

Recorded here because it is the decision this slice exists to make, and SDD §9 leaves it open.

`bun test` is faster and already installed. It is rejected because the build already runs on Node (the Dockerfile: Bun segfaults compiling Next in a container), so the project has one demonstrated Bun incompatibility already. Tying the test suite to Bun's runtime bets the *verification* of every business rule on the same runtime that has already failed once in this project. Vitest runs on Node, which is where the build runs and where the domain must stay portable per G9.

The cost is one dependency and a slightly slower start. That is a small price for the invariant suite being the last thing to break.

---

## Task 1: Vitest running against nothing

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json` (scripts, devDependencies)
- Test: `tests/harness.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `bun run test` and `bun run test:watch`; `tests/` as the suite root.

- [ ] **Step 1: Install Vitest**

```bash
bun add -D vitest@^3
```

- [ ] **Step 2: Write the failing test**

Create `tests/harness.test.ts`:

```ts
import { expect, test } from "vitest";

test("the timezone is pinned to Asia/Ho_Chi_Minh", () => {
  // G6. Without this, a test asserting `due_on` behaviour passes in Vietnam
  // and fails in CI, which is the worst possible way to learn about it.
  expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(
    "Asia/Ho_Chi_Minh",
  );
});
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `bunx vitest run tests/harness.test.ts`
Expected: FAIL — either "vitest.config.ts not found"/no tests matched, or the timezone assertion fails with the machine's local zone.

- [ ] **Step 4: Write the config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Domain tests talk to a real database and must not race each other on
    // the same schema. Per-file isolation is handled in tests/support/db.ts;
    // this cap keeps the connection count sane on a laptop.
    maxConcurrency: 4,
    // G6. Set here rather than per-file so no test can forget it.
    env: { TZ: "Asia/Ho_Chi_Minh" },
    // A hung database connection should fail, not hang CI forever.
    testTimeout: 15_000,
  },
});
```

- [ ] **Step 5: Add the scripts**

In `package.json`, add to `scripts`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `bun run test`
Expected: PASS — 1 test.

- [ ] **Step 7: Commit**

```bash
git add vitest.config.ts package.json bun.lock tests/harness.test.ts
git commit -m "test: add vitest, pinned to Asia/Ho_Chi_Minh"
```

---

## Task 2: A PostgreSQL the tests own

**Files:**
- Modify: `compose.yaml`
- Modify: `.env.example`
- Create: `tests/support/env.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `TEST_DATABASE_URL`; a `db-test` compose service on port 5434.

- [ ] **Step 1: Add the test database service**

In `compose.yaml`, after the `db` service:

```yaml
  # ── PostgreSQL, for tests ──────────────────────────────────────────────────
  # A separate service, not a separate database on `db`. Tests truncate tables
  # and create schemas; pointing them at the development database would make
  # `bun run test` a destructive command, which is the kind of footgun that
  # only has to fire once.
  #
  # tmpfs, not a bind mount: test data is worthless by definition and this is
  # substantially faster. Nothing here survives a restart, deliberately.
  db-test:
    image: postgres:16.10-alpine
    restart: unless-stopped
    profiles: ["test"]
    environment:
      POSTGRES_DB: olibra_test
      POSTGRES_USER: olibra
      POSTGRES_PASSWORD: olibra
      POSTGRES_INITDB_ARGS: "--locale=C.UTF-8 --encoding=UTF8"
    tmpfs:
      - /var/lib/postgresql/data
    ports:
      - "${POSTGRES_TEST_PORT:-5434}:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U olibra -d olibra_test"]
      interval: 5s
      timeout: 5s
      retries: 10
      start_period: 10s
```

- [ ] **Step 2: Document it in `.env.example`**

Append:

```bash
# ── Tests ─────────────────────────────────────────────────────────────────────
# The test database is a separate compose service (profile: test) on its own
# port, with tmpfs storage. Start it with:
#
#   docker compose --profile test up -d db-test
#
POSTGRES_TEST_PORT=5434
TEST_DATABASE_URL=postgres://olibra:olibra@localhost:5434/olibra_test
```

- [ ] **Step 3: Write the failing test**

Create `tests/support/env.ts`:

```ts
/** Fails loudly rather than letting a test silently hit the wrong database. */
export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Start the test database with:\n" +
        "  docker compose --profile test up -d db-test\n" +
        "and copy .env.example to .env",
    );
  }
  if (!url.includes("olibra_test")) {
    // The one mistake worth making impossible: pointing the suite, which
    // truncates every table, at the development database.
    throw new Error(
      `TEST_DATABASE_URL must name the olibra_test database, got: ${url}`,
    );
  }
  return url;
}
```

Create `tests/support/env.test.ts`:

```ts
import { expect, test } from "vitest";
import { testDatabaseUrl } from "./env";

test("refuses a URL that is not the test database", () => {
  const saved = process.env.TEST_DATABASE_URL;
  process.env.TEST_DATABASE_URL = "postgres://olibra:x@localhost:5433/olibra";
  expect(() => testDatabaseUrl()).toThrow(/must name the olibra_test database/);
  process.env.TEST_DATABASE_URL = saved;
});

test("returns the URL when it names the test database", () => {
  expect(testDatabaseUrl()).toContain("olibra_test");
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `bun run test tests/support/env.test.ts`
Expected: FAIL on the second test — `TEST_DATABASE_URL is not set`.

- [ ] **Step 5: Load `.env` in the config**

In `vitest.config.ts`, add to the top:

```ts
import { config } from "dotenv";

config({ path: ".env" });
```

and install it:

```bash
bun add -D dotenv
```

- [ ] **Step 6: Start the database and run the tests**

```bash
cp .env.example .env
docker compose --profile test up -d db-test
bun run test
```

Expected: PASS — 3 tests.

- [ ] **Step 7: Commit**

```bash
git add compose.yaml .env.example tests/support/ vitest.config.ts package.json bun.lock
git commit -m "test: add an isolated test database on its own port"
```

---

## Task 3: Isolation that survives concurrent transactions

This is the task the whole slice exists for. **Read the rationale before writing code.**

The common way to isolate database tests is to open a transaction per test and roll it back at the end. It is fast and it is wrong here: INV-1's test must open **two concurrent transactions** and prove exactly one commits. Work done inside a single wrapping transaction cannot see a second connection's uncommitted rows, so the race that INV-1 exists to prevent cannot be reproduced at all — the test would pass against an implementation with no constraint whatsoever.

So: real commits, and truncation between tests.

**Files:**
- Create: `tests/support/db.ts`
- Test: `tests/support/db.test.ts`

**Interfaces:**
- Consumes: `testDatabaseUrl()` from Task 2.
- Produces:
  ```ts
  sql: Sql                                    // the shared connection
  resetDatabase(): Promise<void>              // truncate every table
  withTwoConnections<T>(                      // the INV-1 shape
    body: (a: Sql, b: Sql) => Promise<T>,
  ): Promise<T>
  ```

- [ ] **Step 1: Install the driver**

```bash
bun add postgres
```

`postgres` (porsager) is chosen over `pg` because it exposes transactions as a callback that owns a dedicated connection — exactly what `withTwoConnections` needs — and it surfaces the PostgreSQL error `code` field directly, which SDD §10.3 requires so a unique violation is distinguishable from any other failure.

- [ ] **Step 2: Write the failing test**

Create `tests/support/db.test.ts`:

```ts
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
```

- [ ] **Step 3: Run it to verify it fails**

Run: `bun run test tests/support/db.test.ts`
Expected: FAIL — `Cannot find module './db'`.

- [ ] **Step 4: Write the harness**

Create `tests/support/db.ts`:

```ts
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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun run test tests/support/db.test.ts`
Expected: PASS — 3 tests. The second one is the important one; if it reports two fulfilled, stop and fix the harness before going further.

- [ ] **Step 6: Commit**

```bash
git add tests/support/db.ts tests/support/db.test.ts package.json bun.lock
git commit -m "test: database harness with real concurrent connections

Truncation rather than transaction-rollback isolation, because INV-1's test
must open two concurrent transactions and prove exactly one commits. Work
inside a single wrapping transaction cannot see a second connection's
uncommitted rows, so that race is unreproducible under rollback isolation —
and a test that cannot reproduce it would pass against an implementation with
no constraint at all."
```

---

## Task 4: An injectable clock

Every derived-state rule in G5 compares stored data against "now". A test that reaches for the real clock either sleeps (slow and flaky) or cannot test expiry at all.

**Files:**
- Create: `src/domain/kernel/clock.ts`
- Test: `tests/domain/kernel/clock.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface Clock { now(): Date; today(): string }   // today() is YYYY-MM-DD in Asia/Ho_Chi_Minh
  const systemClock: Clock
  function fixedClock(iso: string): Clock
  ```
  Every domain function that needs the time takes a `Clock`. None calls `new Date()` directly.

- [ ] **Step 1: Write the failing test**

Create `tests/domain/kernel/clock.test.ts`:

```ts
import { expect, test } from "vitest";
import { fixedClock, systemClock } from "../../../src/domain/kernel/clock";

test("today() is a date in Asia/Ho_Chi_Minh, not UTC", () => {
  // 2026-08-07T23:30Z is already 2026-08-08 in Ho Chi Minh City (UTC+7).
  // A naive toISOString().slice(0,10) returns 2026-08-07 and is wrong for
  // seven hours every day — which is exactly when a volunteer is at the
  // shelf after evening mass.
  const clock = fixedClock("2026-08-07T23:30:00Z");
  expect(clock.today()).toBe("2026-08-08");
});

test("today() does not roll over early", () => {
  const clock = fixedClock("2026-08-07T16:00:00Z"); // 23:00 local, same day
  expect(clock.today()).toBe("2026-08-07");
});

test("fixedClock returns the instant it was given", () => {
  const clock = fixedClock("2026-08-07T12:00:00Z");
  expect(clock.now().toISOString()).toBe("2026-08-07T12:00:00.000Z");
});

test("systemClock produces a well-formed date", () => {
  expect(systemClock.today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run test tests/domain/kernel/clock.test.ts`
Expected: FAIL — `Cannot find module '../../../src/domain/kernel/clock'`.

- [ ] **Step 3: Write the implementation**

Create `src/domain/kernel/clock.ts`:

```ts
/**
 * Time, as an injectable dependency.
 *
 * Nothing in the domain calls `new Date()`. Overdue status, hold expiry and
 * availability are all computed on read against the current clock (BR §8), so
 * every one of those rules is only testable if the clock can be moved.
 */
export interface Clock {
  /** The current instant. */
  now(): Date;
  /**
   * Today's date in `Asia/Ho_Chi_Minh`, as `YYYY-MM-DD`.
   *
   * `due_on` is a date, not a timestamp (BR §5.4) — a book is due at the end
   * of a day, not at 14:23 on it. Comparisons against it must therefore be
   * made in the application timezone, or a loan becomes overdue seven hours
   * early every evening.
   */
  today(): string;
}

const TIMEZONE = "Asia/Ho_Chi_Minh";

/** `en-CA` because it formats as YYYY-MM-DD, which is what we want to store. */
const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function todayIn(instant: Date): string {
  return dateFormatter.format(instant);
}

export const systemClock: Clock = {
  now: () => new Date(),
  today: () => todayIn(new Date()),
};

/** A clock frozen at a given instant. The only clock tests should use. */
export function fixedClock(iso: string): Clock {
  const instant = new Date(iso);
  return {
    now: () => new Date(instant),
    today: () => todayIn(instant),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run test tests/domain/kernel/clock.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/domain/kernel/clock.ts tests/domain/kernel/clock.test.ts
git commit -m "feat(domain): injectable clock, timezone-correct

today() formats in Asia/Ho_Chi_Minh rather than slicing an ISO string, which
is wrong for the seven hours a day between local midnight and UTC midnight —
precisely the hours a volunteer is at the shelf after evening mass."
```

---

## Task 5: The layer boundary, enforced

G1 says the domain imports no framework. A rule nobody can break by accident is worth more than a rule everybody agrees with.

**Files:**
- Modify: `eslint.config.mjs`
- Test: `tests/architecture/boundaries.test.ts`

**Interfaces:**
- Produces: a lint failure on any `next/*`, `react`, or `src/app/*` import inside `src/domain/`.

- [ ] **Step 1: Write the failing test**

Create `tests/architecture/boundaries.test.ts`:

```ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

function filesUnder(dir: string): string[] {
  let out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out = out.concat(filesUnder(path));
    else if (path.endsWith(".ts")) out.push(path);
  }
  return out;
}

test("the domain imports no framework", () => {
  // G1 / SDD §3.1. This is what keeps the backend's location (SDD §3.4) a
  // reversible decision: the moment the domain imports `next/*`, moving it to
  // a separate service stops being a packaging change.
  const forbidden = /from\s+["'](next(\/|["'])|react|@\/app\/)/;
  const offenders = filesUnder("src/domain")
    .filter((f) => forbidden.test(readFileSync(f, "utf8")))
    .map((f) => f.replace(process.cwd() + "/", ""));

  expect(offenders).toEqual([]);
});

test("the domain does not use Bun-specific APIs", () => {
  // G9. The runtime is Bun, but the build and the tests run on Node, and the
  // domain must stay runnable under both.
  const offenders = filesUnder("src/domain")
    .filter((f) => /\bBun\./.test(readFileSync(f, "utf8")))
    .map((f) => f.replace(process.cwd() + "/", ""));

  expect(offenders).toEqual([]);
});
```

- [ ] **Step 2: Run it to verify it passes trivially, then prove it can fail**

Run: `bun run test tests/architecture/boundaries.test.ts`
Expected: PASS (the domain currently holds only `clock.ts`).

A test that has never failed is not yet a test. Prove it:

```bash
echo 'import Link from "next/link";' >> src/domain/kernel/clock.ts
bun run test tests/architecture/boundaries.test.ts   # expect FAIL, listing clock.ts
git checkout src/domain/kernel/clock.ts
bun run test tests/architecture/boundaries.test.ts   # expect PASS again
```

- [ ] **Step 3: Add the ESLint rule so the failure arrives at edit time too**

In `eslint.config.mjs`, append to the exported array:

```js
  {
    files: ["src/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["next", "next/*", "react", "react-dom", "@/app/*"],
              message:
                "The domain layer imports no framework (SDD §3.1). Move this to src/app/ and call the domain from there.",
            },
          ],
        },
      ],
    },
  },
```

- [ ] **Step 4: Verify lint still passes**

Run: `bun run lint`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add eslint.config.mjs tests/architecture/boundaries.test.ts
git commit -m "test: enforce the domain layer boundary

SDD §3.1's separation is a condition of putting the backend inside Next.js,
not a nice property of it — the door closes one import at a time. Both a lint
rule (fails at edit time) and a test (fails in CI) so neither path is quiet."
```

---

## Task 6: Wire the suite into `check` and CI

**Files:**
- Modify: `package.json`
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Add tests to the check script**

In `package.json`, change the `check` script to:

```json
"check": "bun run typecheck && bun run lint && bun run format:check && bun run test"
```

`check:links` is deliberately dropped from `check` here — it needs a running dev server, so it belongs in CI as its own step rather than in the command a developer runs constantly.

- [ ] **Step 2: Write the CI workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push: { branches: [main] }
  pull_request:

jobs:
  check:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16.10-alpine
        env:
          POSTGRES_DB: olibra_test
          POSTGRES_USER: olibra
          POSTGRES_PASSWORD: olibra
        ports: ["5434:5432"]
        options: >-
          --health-cmd "pg_isready -U olibra -d olibra_test"
          --health-interval 5s --health-timeout 5s --health-retries 10
    env:
      TEST_DATABASE_URL: postgres://olibra:olibra@localhost:5434/olibra_test
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with: { bun-version: 1.3.14 }
      - run: bun install --frozen-lockfile
        env: { PUPPETEER_SKIP_DOWNLOAD: 1 }
      - run: bun run check

  image:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      # The smoke stage boots the built server under Bun and fails unless it
      # serves the landing page. Next.js does not test against Bun, so this is
      # what stops a Next upgrade quietly shipping a runtime that starts and
      # then serves nothing.
      - run: docker build --target smoke .
```

- [ ] **Step 3: Run the full check locally**

Run: `bun run check`
Expected: typecheck, lint, format and 11 tests all pass.

- [ ] **Step 4: Commit**

```bash
git add package.json .github/workflows/ci.yml
git commit -m "ci: run the suite and the Bun smoke build on every PR"
```

---

## Done when

- [ ] `bun run test` passes with no database running **for the non-database tests**, and with `docker compose --profile test up -d db-test` for the rest.
- [ ] `tests/support/db.test.ts` proves two concurrent inserts of the same key produce exactly one success — the shape INV-1's test will take.
- [ ] `bun run lint` fails if a `next/*` import is added under `src/domain/`, and `bun run test` fails too.
- [ ] CI runs the suite against a real PostgreSQL and builds the smoke target.

**Next slice:** [S1 · Schema and RLS](2026-08-07-s1-schema-rls.md).
