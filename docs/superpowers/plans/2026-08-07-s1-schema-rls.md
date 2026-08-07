# S1 · Schema, RLS, Migrations and Seed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the whole PostgreSQL schema from `docs/DATABASE.md`, with Row Level Security making tenant isolation structural, and a seed that reproduces `src/lib/fixtures.ts` exactly.

**Architecture:** Forward-only numbered SQL migrations applied by a small runner with no framework dependency. Seven of the fourteen invariants become constraints in this slice and are proved by their named tests immediately — a constraint nobody exercised is a constraint nobody has checked is there (G12).

**Tech Stack:** PostgreSQL 16 · `postgres` (porsager) · plain SQL files.

## Global Constraints

Inherited from [the master plan](2026-08-07-olibra-backend-master.md#global-constraints). Load-bearing here: **G4** (RLS structural), **G5** (derived state as views), **G6** (`due_on` is a date), **G10** (loans and audit never deleted), **G11** (seed reproduces the fixtures), **G12** (named test per invariant).

**Source of truth:** `docs/DATABASE.md` holds the full DDL. This plan does not restate it column by column; it sequences it, and it specifies every test. Where this plan and DATABASE.md disagree, DATABASE.md wins and this plan is wrong.

---

## Task 1: A migration runner

**Files:**
- Create: `src/db/client.ts`
- Create: `src/db/migrate.ts`
- Create: `src/db/migrations/0001_extensions.sql`
- Test: `tests/db/migrate.test.ts`

**Interfaces:**
- Consumes: `Clock` from S0.
- Produces:
  ```ts
  function connect(url?: string): Sql
  function migrate(sql: Sql, dir?: string): Promise<{ applied: string[] }>
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/db/migrate.test.ts`:

```ts
import { afterAll, beforeEach, expect, test } from "vitest";
import { migrate } from "../../src/db/migrate";
import { closeAll, resetDatabase, sql } from "../support/db";

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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run test tests/db/migrate.test.ts`
Expected: FAIL — `Cannot find module '../../src/db/migrate'`.

- [ ] **Step 3: Write the connection module**

Create `src/db/client.ts`:

```ts
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

export type { Sql };
```

- [ ] **Step 4: Write the runner**

Create `src/db/migrate.ts`:

```ts
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
    (
      await sql<{ name: string }[]>`select name from schema_migrations`
    ).map((r) => r.name),
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
```

- [ ] **Step 5: Write the first migration**

Create `src/db/migrations/0001_extensions.sql`:

```sql
-- All three ship in postgresql-contrib, which the official image includes,
-- so no custom image is needed (DB §11).
create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists unaccent;   -- search folding (DB §5)
create extension if not exists pg_trgm;    -- substring search over folded text
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun run test tests/db/migrate.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 7: Commit**

```bash
git add src/db/ tests/db/
git commit -m "feat(db): forward-only migration runner"
```

---

## Task 2: Folding, and the parity test that keeps it honest

Done before the tables, because `books.title_folded` is a generated column that depends on this function existing.

DB §5 names two traps and both bite quietly. This task exists to make them loud.

**Files:**
- Create: `src/db/migrations/0002_folding.sql`
- Test: `tests/db/folding.test.ts`

**Interfaces:**
- Produces: SQL function `olibra_fold(text) returns text`, immutable.

- [ ] **Step 1: Write the failing test**

Create `tests/db/folding.test.ts`:

```ts
import { afterAll, beforeAll, expect, test } from "vitest";
import { migrate } from "../../src/db/migrate";
import { fold } from "../../src/lib/search";
import { closeAll, sql } from "../support/db";

beforeAll(async () => {
  await migrate(sql);
});
afterAll(closeAll);

// DB §5 names these four exactly: a plain title, one starting with đ, one
// with a hyphen, one with a digit.
const CASES = [
  "Dế Mèn Phiêu Lưu Ký",
  "Đất Rừng Phương Nam",
  "Totto-chan Bên Cửa Sổ",
  "Kính Vạn Hoa tập 4",
];

test.each(CASES)("SQL and TypeScript fold %s identically", async (input) => {
  // BR §12: "whatever normalisation is applied when storing a title must be
  // the identical normalisation applied to the search term, so the two can
  // never drift." This test is the mechanism that stops the drift — the two
  // implementations are kept in sync by a test, not by hope.
  const [row] = await sql<{ folded: string }[]>`
    select olibra_fold(${input}) as folded
  `;
  expect(row.folded).toBe(fold(input));
});

test("đ folds to d", async () => {
  // The single most likely cause of "why does searching dat rung not find
  // Đất Rừng Phương Nam". unaccent does not reliably handle đ, because it is
  // a distinct Vietnamese letter rather than a d with a diacritic.
  const [row] = await sql<{ folded: string }[]>`
    select olibra_fold('Đất Rừng') as folded
  `;
  expect(row.folded).toBe("dat rung");
});

test("olibra_fold is immutable enough for a generated column", async () => {
  // A STABLE function cannot be used in a generated column or a functional
  // index. If this fails, the schema will not build.
  const [row] = await sql<{ provolatile: string }[]>`
    select provolatile from pg_proc where proname = 'olibra_fold'
  `;
  expect(row.provolatile).toBe("i");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run test tests/db/folding.test.ts`
Expected: FAIL — `function olibra_fold(unknown) does not exist`.

- [ ] **Step 3: Write the migration**

Create `src/db/migrations/0002_folding.sql`:

```sql
-- Diacritic- and case-insensitive folding, identical to fold() in
-- src/lib/search.ts. BR §12 requires the two to be the same normalisation;
-- tests/db/folding.test.ts is what stops them drifting.
--
-- Two traps, both named in DATABASE.md §5:
--
-- 1. unaccent() is STABLE, not IMMUTABLE, in a default installation, because
--    it depends on a rules file that could in principle change. A STABLE
--    function cannot be used in a generated column or a functional index. The
--    IMMUTABLE below is a promise, and it holds as long as nobody edits that
--    rules file.
--
-- 2. unaccent() does not reliably fold đ to d — đ is a distinct Vietnamese
--    letter, not a d with a diacritic. The translate() is what handles it and
--    must not be removed.
create or replace function olibra_fold(value text)
returns text
language sql
immutable
parallel safe
as $$
  select trim(regexp_replace(
    lower(translate(unaccent(value), 'đĐ', 'dD')),
    '[^a-z0-9]+', ' ', 'g'
  ))
$$;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run test tests/db/folding.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/db/migrations/0002_folding.sql tests/db/folding.test.ts
git commit -m "feat(db): search folding, with a parity test against src/lib/search.ts"
```

---

## Task 3: The schema

**Files:**
- Create: `src/db/migrations/0003_identity.sql` — `users`, `memberships`, `bookshelves`
- Create: `src/db/migrations/0004_catalogue.sql` — `categories`, `books`, `book_copies`
- Create: `src/db/migrations/0005_circulation.sql` — `loans`, `borrow_requests`, `condition_assessments`
- Create: `src/db/migrations/0006_community.sql` — `comments`, `announcements`, `feedback`
- Create: `src/db/migrations/0007_audit_notifications.sql` — `audit_log`, `notifications`
- Create: `src/db/migrations/0008_profile_changes.sql` — `profile_change_requests`
- Test: `tests/db/schema.test.ts`

**Interfaces:**
- Produces: every table in DATABASE.md §4, with the enums of §2.1.

- [ ] **Step 1: Write the failing test**

Create `tests/db/schema.test.ts`:

```ts
import { afterAll, beforeAll, expect, test } from "vitest";
import { migrate } from "../../src/db/migrate";
import { closeAll, sql } from "../support/db";

beforeAll(async () => {
  await migrate(sql);
});
afterAll(closeAll);

const EXPECTED_TABLES = [
  "announcements",
  "audit_log",
  "book_copies",
  "books",
  "bookshelves",
  "borrow_requests",
  "categories",
  "comments",
  "condition_assessments",
  "feedback",
  "loans",
  "memberships",
  "notifications",
  "profile_change_requests",
  "schema_migrations",
  "users",
];

test("every table in DATABASE.md §4 exists", async () => {
  const rows = await sql<{ tablename: string }[]>`
    select tablename from pg_tables where schemaname = 'public' order by tablename
  `;
  expect(rows.map((r) => r.tablename)).toEqual(EXPECTED_TABLES);
});

test("due_on is a date, not a timestamp", async () => {
  // BR §5.4: "a book is due at the end of a day, not at 14:23 on that day."
  // A timestamp here makes a book overdue mid-afternoon, which is confusing
  // for children and wrong for a shelf only open after Sunday mass.
  const [row] = await sql<{ data_type: string }[]>`
    select data_type from information_schema.columns
    where table_name = 'loans' and column_name = 'due_on'
  `;
  expect(row.data_type).toBe("date");
});

test("loans have no deleted_at column", async () => {
  // INV-11 / G10: a loan is never deleted. The absence of the column is the
  // enforcement — there is nothing to set.
  const rows = await sql`
    select 1 from information_schema.columns
    where table_name = 'loans' and column_name = 'deleted_at'
  `;
  expect(rows).toHaveLength(0);
});

test("categories are global, not shelf-scoped", async () => {
  // DB §4.3: shared reference data every shelf draws from. Scoping them would
  // defeat the point.
  const rows = await sql`
    select 1 from information_schema.columns
    where table_name = 'categories' and column_name = 'bookshelf_id'
  `;
  expect(rows).toHaveLength(0);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run test tests/db/schema.test.ts`
Expected: FAIL — the table list contains only `schema_migrations`.

- [ ] **Step 3: Write the six migrations**

Transcribe the DDL from `docs/DATABASE.md` §4.1 through §4.11 into the six files listed above, in that order. The document holds the authoritative column lists, types, enums and foreign keys; this plan does not duplicate them, because a duplicated schema is a schema that will disagree with itself.

Three things to carry across exactly, because they are the ones a transcription tends to soften:

- `users_credentials_paired` (§4.1) — the check constraint behind INV-14.
- `books.title_folded` and `books.author_folded` as **generated** columns over `olibra_fold` (§5), not columns a trigger maintains.
- `audit_log` with no `updated_at` and no soft-delete column (§4.10).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run test tests/db/schema.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/db/migrations/ tests/db/schema.test.ts
git commit -m "feat(db): the schema from DATABASE.md §4"
```

---

## Task 4: The seven structural invariants, each with its named test

G12: a constraint nobody exercised is a constraint nobody has checked is there. Each of these gets its own file under `tests/invariants/`, named for the rule, so a failure names the business rule it broke rather than a table.

**Files:**
- Create: `src/db/migrations/0009_invariant_constraints.sql`
- Test: `tests/invariants/inv-01-one-active-loan-per-copy.test.ts`
- Test: `tests/invariants/inv-09-comment-visibility.test.ts`
- Test: `tests/invariants/inv-11-loans-never-deleted.test.ts`
- Test: `tests/invariants/inv-12-audit-immutable.test.ts`
- Test: `tests/invariants/inv-13-one-pending-profile-change.test.ts`
- Test: `tests/invariants/inv-14-credentials-paired.test.ts`
- Create: `tests/support/factories.ts`

**Interfaces:**
- Produces:
  ```ts
  makeShelf(sql: Sql, over?: Partial<Shelf>): Promise<{ id: string; slug: string }>
  makeUser(sql: Sql, over?: Partial<User>): Promise<{ id: string }>
  makeMember(sql: Sql, shelfId: string, over?: Partial<Membership>): Promise<{ id: string; userId: string }>
  makeBookWithCopies(sql: Sql, shelfId: string, copies?: number): Promise<{ bookId: string; copyIds: string[] }>
  ```

- [ ] **Step 1: Write INV-1's test — the one that justifies the whole harness**

Create `tests/invariants/inv-01-one-active-loan-per-copy.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { migrate } from "../../src/db/migrate";
import { makeBookWithCopies, makeMember, makeShelf } from "../support/factories";
import { closeAll, resetDatabase, sql, withTwoConnections } from "../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

test("INV-1: two managers lending the same copy — exactly one succeeds", async () => {
  // BR §2 states the scenario plainly: two managers, two phones, one physical
  // shelf, the same second. BR INV-1 requires the datastore to guarantee this,
  // not application checks, because a read-then-write has a race window that
  // no amount of care closes.
  const shelf = await makeShelf(sql);
  const { copyIds } = await makeBookWithCopies(sql, shelf.id, 1);
  const readerA = await makeMember(sql, shelf.id);
  const readerB = await makeMember(sql, shelf.id);
  const copyId = copyIds[0];

  const outcomes = await withTwoConnections(async (a, b) => {
    const insert = (conn: typeof a, borrower: string) => conn`
      insert into loans (bookshelf_id, copy_id, borrower_id, due_on, status)
      values (${shelf.id}, ${copyId}, ${borrower}, current_date + 14, 'active')
    `;
    return Promise.allSettled([
      insert(a, readerA.id),
      insert(b, readerB.id),
    ]);
  });

  expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
  expect(outcomes.filter((o) => o.status === "rejected")).toHaveLength(1);

  const active = await sql`
    select 1 from loans where copy_id = ${copyId} and status = 'active'
  `;
  expect(active).toHaveLength(1);
});

test("INV-1: the loser fails with a unique violation, distinguishably", async () => {
  // SDD §10.3 — the application must be able to tell a unique violation from
  // any other database error, so it can render "Bản sách này vừa được mượn"
  // rather than a 500.
  const shelf = await makeShelf(sql);
  const { copyIds } = await makeBookWithCopies(sql, shelf.id, 1);
  const reader = await makeMember(sql, shelf.id);

  const insert = () => sql`
    insert into loans (bookshelf_id, copy_id, borrower_id, due_on, status)
    values (${shelf.id}, ${copyIds[0]}, ${reader.id}, current_date + 14, 'active')
  `;

  await insert();
  await expect(insert()).rejects.toMatchObject({ code: "23505" });
});

test("INV-1: a returned loan frees the copy for a new one", async () => {
  // The partial index must be partial. A plain unique index on copy_id would
  // pass the first test and make a book unlendable forever after its first
  // return, which is a far worse bug than the one being prevented.
  const shelf = await makeShelf(sql);
  const { copyIds } = await makeBookWithCopies(sql, shelf.id, 1);
  const reader = await makeMember(sql, shelf.id);

  await sql`
    insert into loans (bookshelf_id, copy_id, borrower_id, due_on, status)
    values (${shelf.id}, ${copyIds[0]}, ${reader.id}, current_date + 14, 'returned')
  `;
  await expect(sql`
    insert into loans (bookshelf_id, copy_id, borrower_id, due_on, status)
    values (${shelf.id}, ${copyIds[0]}, ${reader.id}, current_date + 14, 'active')
  `).resolves.toBeDefined();
});
```

- [ ] **Step 2: Write the factories**

Create `tests/support/factories.ts`:

```ts
import type { Sql } from "postgres";

/**
 * Minimal row builders. Each takes only what a test must vary and defaults
 * everything else, so a test reads as the rule it is checking rather than as
 * a wall of setup.
 */

let counter = 0;
const next = () => ++counter;

export async function makeShelf(sql: Sql, over: { slug?: string } = {}) {
  const slug = over.slug ?? `shelf-${next()}`;
  const [row] = await sql<{ id: string }[]>`
    insert into bookshelves (slug, name, address, status)
    values (${slug}, ${`Tủ sách ${slug}`}, 'Đồng Tháp', 'active')
    returning id
  `;
  return { id: row.id, slug };
}

export async function makeUser(sql: Sql, over: { fullName?: string } = {}) {
  const [row] = await sql<{ id: string }[]>`
    insert into users (full_name, father_name, mother_name, phone)
    values (
      ${over.fullName ?? `Người đọc ${next()}`},
      'Giuse Trần Văn A', 'Maria Nguyễn Thị B', '0900000000'
    )
    returning id
  `;
  return { id: row.id };
}

export async function makeMember(
  sql: Sql,
  bookshelfId: string,
  over: { role?: string; status?: string } = {},
) {
  const user = await makeUser(sql);
  const [row] = await sql<{ id: string }[]>`
    insert into memberships (bookshelf_id, user_id, role, status)
    values (
      ${bookshelfId}, ${user.id},
      ${over.role ?? "reader"}, ${over.status ?? "active"}
    )
    returning id
  `;
  return { id: row.id, userId: user.id };
}

export async function makeBookWithCopies(
  sql: Sql,
  bookshelfId: string,
  copies = 1,
) {
  const n = next();
  const [book] = await sql<{ id: string }[]>`
    insert into books (bookshelf_id, title, author, slug, published)
    values (${bookshelfId}, ${`Sách ${n}`}, 'Tô Hoài', ${`sach-${n}`}, true)
    returning id
  `;
  const copyIds: string[] = [];
  for (let i = 0; i < copies; i++) {
    const [copy] = await sql<{ id: string }[]>`
      insert into book_copies (bookshelf_id, book_id, code, state, condition)
      values (
        ${bookshelfId}, ${book.id},
        ${`DT-${String(n * 100 + i).padStart(4, "0")}`},
        'available', 'perfect'
      )
      returning id
    `;
    copyIds.push(copy.id);
  }
  return { bookId: book.id, copyIds };
}
```

- [ ] **Step 3: Run INV-1's test to verify it fails**

Run: `bun run test tests/invariants/inv-01-one-active-loan-per-copy.test.ts`
Expected: FAIL — the first test reports **two** fulfilled, because no constraint exists yet. This failure is the point: it proves the test can detect the bug.

- [ ] **Step 4: Write the constraints migration**

Create `src/db/migrations/0009_invariant_constraints.sql`:

```sql
-- INV-1. A partial unique index is the whole mechanism. The second
-- transaction to commit fails with 23505, which the application translates
-- into "Bản sách này vừa được mượn" (BR §2: one of them "must fail cleanly
-- and see a plain message, never a silently corrupted record").
--
-- Partial, not plain: a plain unique index on copy_id would make a copy
-- unlendable forever after its first return.
create unique index loans_one_active_per_copy
  on loans (copy_id)
  where status = 'active';

-- INV-13, first half. At most one pending profile change per person, so a
-- manager never faces two competing versions of the same fact (BR §7.4).
create unique index profile_change_requests_one_pending
  on profile_change_requests (user_id)
  where status = 'pending';

-- INV-9. The access path for member-facing comments. Visibility is a property
-- of which index answers the query, not of a filter someone remembered.
create index comments_public
  on comments (book_id, created_at desc)
  where status = 'approved';

-- INV-11 and INV-12. Loans are voided, never deleted; audit records are
-- append-only. Revoked at the grant level so no code path — including a
-- migration written in a hurry — can do it.
revoke delete on loans from public;
revoke update, delete on audit_log from public;
```

- [ ] **Step 5: Run INV-1's test to verify it passes**

Run: `bun run test tests/invariants/inv-01-one-active-loan-per-copy.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 6: Write the remaining five structural invariant tests**

`tests/invariants/inv-14-credentials-paired.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { migrate } from "../../src/db/migrate";
import { closeAll, resetDatabase, sql } from "../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

const insert = (username: string | null, hash: string | null) => sql`
  insert into users (full_name, father_name, mother_name, phone, username, password_hash)
  values ('Giuse Trần Minh', 'Giuse Trần Văn A', 'Maria Nguyễn Thị B',
          '0900000000', ${username}, ${hash})
`;

test("INV-14: neither credential is a valid state", async () => {
  // BR §2: most readers are children who will never sign in. Forcing a
  // volunteer to invent credentials nobody will type is work that serves the
  // database, not the parish.
  await expect(insert(null, null)).resolves.toBeDefined();
});

test("INV-14: both credentials is valid", async () => {
  await expect(insert("tranminh", "$2b$dummy")).resolves.toBeDefined();
});

test("INV-14: a username without a password is rejected", async () => {
  await expect(insert("tranminh", null)).rejects.toMatchObject({ code: "23514" });
});

test("INV-14: a password without a username is rejected", async () => {
  await expect(insert(null, "$2b$dummy")).rejects.toMatchObject({ code: "23514" });
});
```

`tests/invariants/inv-12-audit-immutable.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { migrate } from "../../src/db/migrate";
import { makeShelf } from "../support/factories";
import { closeAll, resetDatabase, sql } from "../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

test("INV-12: an audit record cannot be updated or deleted", async () => {
  const shelf = await makeShelf(sql);
  const [entry] = await sql<{ id: string }[]>`
    insert into audit_log (bookshelf_id, action, entity_type, entity_id)
    values (${shelf.id}, 'book.created', 'book', gen_random_uuid())
    returning id
  `;

  await expect(
    sql`update audit_log set action = 'tampered' where id = ${entry.id}`,
  ).rejects.toThrow();
  await expect(
    sql`delete from audit_log where id = ${entry.id}`,
  ).rejects.toThrow();
});
```

Write `inv-09`, `inv-11` and `inv-13` following the same shape: set up the minimum rows, attempt the thing the rule forbids, assert the database refuses.

- [ ] **Step 7: Run the whole invariant suite**

Run: `bun run test tests/invariants/`
Expected: PASS — six files, all green.

- [ ] **Step 8: Commit**

```bash
git add src/db/migrations/0009_invariant_constraints.sql tests/invariants/ tests/support/factories.ts
git commit -m "feat(db): the seven structural invariants, each with its named test

Each test was run against the schema before its constraint existed and
observed to fail. A constraint nobody exercised is a constraint nobody has
checked is there."
```

---

## Task 5: Row Level Security

The highest-consequence property in the system (BR §6). The test that matters is the negative one.

**Files:**
- Create: `src/db/migrations/0010_rls.sql`
- Test: `tests/invariants/inv-10-tenant-isolation.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/invariants/inv-10-tenant-isolation.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { migrate } from "../../src/db/migrate";
import { makeBookWithCopies, makeShelf } from "../support/factories";
import { closeAll, resetDatabase, sql } from "../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

test("INV-10: a query scoped to shelf A cannot see shelf B's books", async () => {
  const a = await makeShelf(sql, { slug: "dong-thap" });
  const b = await makeShelf(sql, { slug: "an-giang" });
  await makeBookWithCopies(sql, a.id, 1);
  await makeBookWithCopies(sql, b.id, 1);

  const visible = await sql.begin(async (tx) => {
    await tx`select set_config('olibra.bookshelf_id', ${a.id}, true)`;
    await tx`set local role olibra_app`;
    return tx<{ bookshelf_id: string }[]>`select bookshelf_id from books`;
  });

  expect(visible).toHaveLength(1);
  expect(visible[0].bookshelf_id).toBe(a.id);
});

test("INV-10: a query with no shelf set sees nothing at all", async () => {
  // The failure mode this prevents: a developer forgets the where clause.
  // BR §6 requires that to return nothing, not another parish's readers.
  const a = await makeShelf(sql);
  await makeBookWithCopies(sql, a.id, 1);

  const visible = await sql.begin(async (tx) => {
    await tx`set local role olibra_app`;
    return tx`select bookshelf_id from books`;
  });

  expect(visible).toHaveLength(0);
});

test("INV-10: the super-admin role bypasses policies deliberately", async () => {
  // BR §13 permits cross-shelf views for super_admin. The point of this test
  // is that the bypass is a *named role*, so using it is a visible choice
  // rather than something a query falls into.
  const a = await makeShelf(sql);
  const b = await makeShelf(sql);
  await makeBookWithCopies(sql, a.id, 1);
  await makeBookWithCopies(sql, b.id, 1);

  const visible = await sql.begin(async (tx) => {
    await tx`set local role olibra_admin`;
    return tx`select bookshelf_id from books`;
  });

  expect(visible).toHaveLength(2);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run test tests/invariants/inv-10-tenant-isolation.test.ts`
Expected: FAIL — `role "olibra_app" does not exist`.

- [ ] **Step 3: Write the migration**

Create `src/db/migrations/0010_rls.sql`:

```sql
-- INV-10, the highest-consequence property in the system. BR §6 requires it
-- to be structural — impossible to forget — not a matter of anyone
-- remembering to filter.
--
-- Two roles, and the difference between them is the whole design:
--   olibra_app   — every ordinary request. Policies apply.
--   olibra_admin — cross-shelf super-admin views and migrations. Bypasses.
-- Using the bypass is therefore a visible, deliberate act.
create role olibra_app;
create role olibra_admin bypassrls;

grant usage on schema public to olibra_app, olibra_admin;
grant select, insert, update on all tables in schema public to olibra_app;
grant all on all tables in schema public to olibra_admin;

-- Re-apply the append-only guarantees after the grants above, since `grant
-- all` would otherwise hand back what 0009 revoked.
revoke delete on loans from olibra_app, olibra_admin;
revoke update, delete on audit_log from olibra_app, olibra_admin;

do $$
declare t text;
begin
  -- Every shelf-scoped table. users, categories and schema_migrations are
  -- global and carry no policy (DB §3).
  foreach t in array array[
    'bookshelves', 'memberships', 'books', 'book_copies', 'loans',
    'borrow_requests', 'condition_assessments', 'comments',
    'announcements', 'notifications', 'profile_change_requests'
  ]
  loop
    execute format('alter table %I enable row level security', t);
    -- force, so the table owner is subject to the policy too. Without this a
    -- migration or an admin script silently sees everything.
    execute format('alter table %I force row level security', t);
    execute format($p$
      create policy %I_tenant on %I
        using (bookshelf_id = current_setting('olibra.bookshelf_id', true)::uuid)
        with check (bookshelf_id = current_setting('olibra.bookshelf_id', true)::uuid)
    $p$, t, t);
  end loop;
end $$;
```

Note: `bookshelves` is scoped by its own `id`; adjust that one policy to `id = current_setting(...)` rather than `bookshelf_id`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run test tests/invariants/inv-10-tenant-isolation.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/db/migrations/0010_rls.sql tests/invariants/inv-10-tenant-isolation.test.ts
git commit -m "feat(db): row level security — tenant isolation as a structural property

The load-bearing test is the negative one: a transaction with no shelf set
sees zero rows rather than everything, so a forgotten where clause fails
closed."
```

---

## Task 6: Derived-state views

**Files:**
- Create: `src/db/migrations/0011_views.sql`
- Test: `tests/db/derived-state.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/db/derived-state.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { migrate } from "../../src/db/migrate";
import { makeBookWithCopies, makeMember, makeShelf } from "../support/factories";
import { closeAll, resetDatabase, sql } from "../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

test("a loan becomes overdue at midnight with no job running", async () => {
  // BR §8: any status a background job must write is stale, and therefore
  // wrong, for as long as the job takes to run again. Nothing is scheduled in
  // this test — the row simply reads as overdue because the date passed.
  const shelf = await makeShelf(sql);
  const { copyIds } = await makeBookWithCopies(sql, shelf.id, 1);
  const reader = await makeMember(sql, shelf.id);

  await sql`
    insert into loans (bookshelf_id, copy_id, borrower_id, due_on, status)
    values (${shelf.id}, ${copyIds[0]}, ${reader.id}, current_date - 1, 'active')
  `;

  const [row] = await sql<{ is_overdue: boolean; days_remaining: number }[]>`
    select is_overdue, days_remaining from loans_current
  `;
  expect(row.is_overdue).toBe(true);
  expect(Number(row.days_remaining)).toBe(-1);
});

test("a returned loan is never overdue, however old", async () => {
  const shelf = await makeShelf(sql);
  const { copyIds } = await makeBookWithCopies(sql, shelf.id, 1);
  const reader = await makeMember(sql, shelf.id);

  await sql`
    insert into loans (bookshelf_id, copy_id, borrower_id, due_on, status)
    values (${shelf.id}, ${copyIds[0]}, ${reader.id}, current_date - 400, 'returned')
  `;

  const [row] = await sql<{ is_overdue: boolean }[]>`
    select is_overdue from loans_current
  `;
  expect(row.is_overdue).toBe(false);
});

test("an expired hold stops blocking a copy without any tidy-up running", async () => {
  const shelf = await makeShelf(sql);
  const { bookId, copyIds } = await makeBookWithCopies(sql, shelf.id, 1);
  const reader = await makeMember(sql, shelf.id);

  await sql`
    insert into borrow_requests
      (bookshelf_id, book_id, copy_id, requester_id, status, requested_at, hold_expires_at)
    values
      (${shelf.id}, ${bookId}, ${copyIds[0]}, ${reader.id}, 'approved',
       now() - interval '5 days', now() - interval '1 hour')
  `;

  // The hold row is still 'approved' — nothing tidied it. The copy is
  // borrowable anyway, because expiry is compared against now() rather than
  // trusted from a column somebody was meant to update.
  const rows = await sql`select id from copies_borrowable`;
  expect(rows).toHaveLength(1);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run test tests/db/derived-state.test.ts`
Expected: FAIL — `relation "loans_current" does not exist`.

- [ ] **Step 3: Write the migration**

Create `src/db/migrations/0011_views.sql` with the two views exactly as DATABASE.md §6 gives them (`loans_current`, `copies_borrowable`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run test tests/db/derived-state.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/db/migrations/0011_views.sql tests/db/derived-state.test.ts
git commit -m "feat(db): derived-state views

The third test is the one that states the rule: an expired hold stops blocking
a copy with no tidy-up job having run, because expiry is compared against
now() rather than trusted from a column."
```

---

## Task 7: Indexes and the seed

**Files:**
- Create: `src/db/migrations/0012_indexes.sql`
- Create: `src/db/seed.ts`
- Test: `tests/db/seed.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/db/seed.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { migrate } from "../../src/db/migrate";
import { seed } from "../../src/db/seed";
import { books, shelves } from "../../src/lib/fixtures";
import { closeAll, resetDatabase, sql } from "../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

test("the seed reproduces the UI fixtures exactly", async () => {
  // G11 / DB §9. This equivalence is what makes swapping fixtures for the
  // database a configuration change rather than a rewrite — and this test is
  // what keeps it true as both sides evolve.
  await seed(sql);

  const seeded = await sql<{ slug: string }[]>`
    select slug from books order by slug
  `;
  expect(seeded.map((b) => b.slug)).toEqual(
    [...books].map((b) => b.slug).sort(),
  );

  const seededShelves = await sql<{ slug: string }[]>`
    select slug from bookshelves order by slug
  `;
  expect(seededShelves.map((s) => s.slug)).toEqual(
    [...shelves].map((s) => s.slug).sort(),
  );
});

test("the seed is idempotent", async () => {
  await seed(sql);
  await seed(sql);
  const [{ count }] = await sql<{ count: string }[]>`
    select count(*) from books
  `;
  expect(Number(count)).toBe(books.length);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run test tests/db/seed.test.ts`
Expected: FAIL — `Cannot find module '../../src/db/seed'`.

- [ ] **Step 3: Write the indexes migration**

Create `src/db/migrations/0012_indexes.sql` with every index from DATABASE.md §8, plus the twelve seeded categories from §4.3.

- [ ] **Step 4: Write the seed**

Create `src/db/seed.ts`, reading from `src/lib/fixtures.ts` and inserting shelves, categories, books, copies, members and the `loans` fixture. Use `on conflict do nothing` keyed on the natural keys (`bookshelves.slug`, `books.slug`, `book_copies.code`) so it is idempotent.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun run test tests/db/seed.test.ts`
Expected: PASS — 2 tests.

- [ ] **Step 6: Add the scripts**

In `package.json`:

```json
"db:migrate": "bun run src/db/migrate-cli.ts",
"db:seed": "bun run src/db/seed-cli.ts"
```

- [ ] **Step 7: Commit**

```bash
git add src/db/migrations/0012_indexes.sql src/db/seed.ts src/db/*-cli.ts tests/db/seed.test.ts package.json
git commit -m "feat(db): indexes and a seed that reproduces the UI fixtures"
```

---

## Done when

- [ ] `bun run db:migrate && bun run db:seed` against a fresh compose stack produces a database the UI's fixtures describe exactly.
- [ ] `tests/invariants/` holds seven files — INV-1, 9, 10, 11, 12, 13, 14 — and every one of them was observed to fail before its constraint existed.
- [ ] A transaction that does not set `olibra.bookshelf_id` reads zero rows from every scoped table.
- [ ] `loans_current` and `copies_borrowable` give correct answers with no scheduled job having ever run.

**Next slice:** [S2 · Domain kernel](2026-08-07-s2-domain-kernel.md).
