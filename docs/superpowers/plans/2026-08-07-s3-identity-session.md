# S3 · Identity and Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish who is calling and what they may do, so the other 98 operations have a caller to check. Sign in, sign out, session storage, and the guards that turn a session into a `TenantContext`.

**Architecture:** Database-backed sessions keyed by an opaque token in an `HttpOnly` cookie. Role resolution reads the caller's membership *of the shelf in the request* — a valid session for shelf A grants nothing on shelf B. Guards live in `src/auth/`, outside the domain, and produce the `TenantContext` the domain requires.

**Tech Stack:** TypeScript · `postgres` · Argon2id via `@node-rs/argon2` · Vitest.

## Global Constraints

Inherited from [the master plan](2026-08-07-olibra-backend-master.md#global-constraints). Load-bearing here: **G1** (guards are in `src/auth/`, not `src/domain/`), **G8** (named errors), **G9** (no `Bun.password` — the build runs on Node).

---

## The session-store decision, made here

SDD §11 leaves this open. This slice closes it.

**Sessions live in the database.** Not in memory, and not in a signed stateless cookie.

- *In-process* is simplest and correct while exactly one container runs. The moment a second one does, a volunteer signs in and gets signed out again on the next request. Compose makes running a second container a one-word change, so this is a trap with a very short fuse.
- *Stateless signed cookies* cannot be revoked. BR §2 gives a manager the power to set any reader's credentials, and the mitigation for that power is visibility (§14). A credential change that cannot immediately invalidate existing sessions weakens the one control the design leans on.
- *Database-backed* costs one indexed lookup per request against a table that will hold a few hundred rows. That is nothing, and it makes revocation a `delete`.

---

## Task 1: Password hashing

**Files:**
- Create: `src/auth/password.ts`
- Test: `tests/auth/password.test.ts`

**Interfaces:**
- Produces:
  ```ts
  function hashPassword(plain: string): Promise<string>
  function verifyPassword(plain: string, hash: string): Promise<boolean>
  ```

- [ ] **Step 1: Install the hasher**

```bash
bun add @node-rs/argon2
```

Not `Bun.password`, despite Bun being the runtime: G9 forbids `Bun.*` in code the Node-based build and test runner must also execute. Not `bcrypt`, because Argon2id is the current recommendation and there is no legacy hash to be compatible with.

- [ ] **Step 2: Write the failing test**

Create `tests/auth/password.test.ts`:

```ts
import { expect, test } from "vitest";
import { hashPassword, verifyPassword } from "../../src/auth/password";

test("a correct password verifies", async () => {
  const hash = await hashPassword("con-meo-nho");
  expect(await verifyPassword("con-meo-nho", hash)).toBe(true);
});

test("a wrong password does not", async () => {
  const hash = await hashPassword("con-meo-nho");
  expect(await verifyPassword("con-meo-to", hash)).toBe(false);
});

test("the same password hashes differently each time", async () => {
  // Salted. Two children with the same simple password must not have
  // identical rows — that would leak the fact to anyone who reads the table.
  expect(await hashPassword("1234")).not.toBe(await hashPassword("1234"));
});

test("verification of a malformed hash returns false rather than throwing", async () => {
  // A corrupt row must produce a failed sign-in, not a 500.
  expect(await verifyPassword("x", "not-a-hash")).toBe(false);
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `bun run test tests/auth/password.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the implementation**

Create `src/auth/password.ts`:

```ts
import { hash, verify } from "@node-rs/argon2";

/**
 * Argon2id, at the library defaults.
 *
 * Not Bun.password, despite Bun being the production runtime: the build and
 * the test suite run on Node (G9), and a hash function that only exists in one
 * of the three is a hash function the tests cannot exercise.
 */
export function hashPassword(plain: string): Promise<string> {
  return hash(plain);
}

export async function verifyPassword(
  plain: string,
  stored: string,
): Promise<boolean> {
  try {
    return await verify(stored, plain);
  } catch {
    // A malformed or truncated hash is a failed sign-in, not a server error.
    return false;
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun run test tests/auth/password.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 6: Commit**

```bash
git add src/auth/password.ts tests/auth/password.test.ts package.json bun.lock
git commit -m "feat(auth): argon2id password hashing"
```

---

## Task 2: The sessions table

**Files:**
- Create: `src/db/migrations/0013_sessions.sql`
- Test: covered by Task 3.

- [ ] **Step 1: Write the migration**

```sql
-- Database-backed sessions. See the note in the S3 plan for why not
-- in-process and not stateless cookies — the short version is that BR §2's
-- manager-sets-credentials power is only safe if sessions can be revoked, and
-- a signed cookie cannot be.
create table sessions (
  -- The token is stored hashed. A leaked database backup should not be a
  -- stack of usable sessions, for the same reason passwords are not stored
  -- in plaintext.
  token_hash   text        primary key,
  user_id      uuid        not null references users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  -- BR §5.4's audit context fields, so "who signed in from where" is
  -- answerable without a second store.
  user_agent   text,
  ip_address   inet
);

create index sessions_by_user on sessions (user_id);
-- Expiry is compared against now() at read time (G5). This index is for the
-- housekeeping sweep that deletes dead rows, which is tidying rather than
-- correctness: an expired session is already unusable without it.
create index sessions_expiry on sessions (expires_at);

-- Sessions are global, not shelf-scoped: a person's identity works across
-- every bookshelf (BR §5.1), and it is the *membership* that is scoped.
-- No RLS policy here, deliberately.
```

- [ ] **Step 2: Run the migration tests**

Run: `bun run test tests/db/`
Expected: PASS — `schema.test.ts` will fail on the table list until `sessions` is added to `EXPECTED_TABLES`. Add it.

- [ ] **Step 3: Commit**

```bash
git add src/db/migrations/0013_sessions.sql tests/db/schema.test.ts
git commit -m "feat(db): sessions table, tokens stored hashed"
```

---

## Task 3: Sign in, sign out

**Files:**
- Create: `src/auth/session.ts`
- Test: `tests/auth/session.test.ts`

**Interfaces:**
- Produces:
  ```ts
  function signIn(sql: Sql, input: { username: string; password: string; clock: Clock }): Promise<{ token: string; userId: string }>
  function resolveSession(sql: Sql, token: string, clock: Clock): Promise<{ userId: string } | null>
  function signOut(sql: Sql, token: string): Promise<void>
  function revokeAllSessions(sql: Sql, userId: string): Promise<void>
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/auth/session.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { fixedClock } from "../../src/domain/kernel/clock";
import { hashPassword } from "../../src/auth/password";
import {
  resolveSession,
  revokeAllSessions,
  signIn,
  signOut,
} from "../../src/auth/session";
import { migrate } from "../../src/db/migrate";
import { closeAll, resetDatabase, sql } from "../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

const clock = fixedClock("2026-08-07T10:00:00Z");

async function makeUserWithCredentials(username: string, password: string) {
  const [row] = await sql<{ id: string }[]>`
    insert into users (full_name, father_name, mother_name, phone, username, password_hash)
    values ('Giuse Trần Minh', 'Giuse Trần Văn A', 'Maria Nguyễn Thị B',
            '0900000000', ${username}, ${await hashPassword(password)})
    returning id
  `;
  return row.id;
}

test("signing in with correct credentials returns a token", async () => {
  const userId = await makeUserWithCredentials("tranminh", "con-meo-nho");
  const { token } = await signIn(sql, {
    username: "tranminh",
    password: "con-meo-nho",
    clock,
  });
  expect(await resolveSession(sql, token, clock)).toEqual({ userId });
});

test("a wrong password does not sign in", async () => {
  await makeUserWithCredentials("tranminh", "con-meo-nho");
  await expect(
    signIn(sql, { username: "tranminh", password: "sai", clock }),
  ).rejects.toMatchObject({ code: "not_authenticated" });
});

test("an account with no credentials cannot sign in", async () => {
  // INV-14. BR §2: most readers are children who will never use the site;
  // a person may exist purely as a record. That is a valid state, and the
  // sign-in path must handle it as a failed sign-in rather than a crash.
  await sql`
    insert into users (full_name, father_name, mother_name, phone)
    values ('Têrêsa Lê Ngọc Ánh', 'A', 'B', '0900000002')
  `;
  await expect(
    signIn(sql, { username: "leanh", password: "bat-ky", clock }),
  ).rejects.toMatchObject({ code: "not_authenticated" });
});

test("the raw token is never stored", async () => {
  // A leaked backup should not be a stack of usable sessions.
  const { token } = await (async () => {
    await makeUserWithCredentials("tranminh", "con-meo-nho");
    return signIn(sql, { username: "tranminh", password: "con-meo-nho", clock });
  })();

  const rows = await sql<{ token_hash: string }[]>`select token_hash from sessions`;
  expect(rows).toHaveLength(1);
  expect(rows[0].token_hash).not.toBe(token);
});

test("an expired session resolves to nothing, with no sweep having run", async () => {
  // G5. Expiry is compared against the clock at read time; the housekeeping
  // delete is tidying, not correctness.
  await makeUserWithCredentials("tranminh", "con-meo-nho");
  const { token } = await signIn(sql, {
    username: "tranminh",
    password: "con-meo-nho",
    clock,
  });

  const muchLater = fixedClock("2026-12-31T10:00:00Z");
  expect(await resolveSession(sql, token, muchLater)).toBeNull();
  // The row is still there — nothing tidied it — and it is still unusable.
  expect(await sql`select 1 from sessions`).toHaveLength(1);
});

test("signing out invalidates only that session", async () => {
  await makeUserWithCredentials("tranminh", "con-meo-nho");
  const first = await signIn(sql, { username: "tranminh", password: "con-meo-nho", clock });
  const second = await signIn(sql, { username: "tranminh", password: "con-meo-nho", clock });

  await signOut(sql, first.token);

  expect(await resolveSession(sql, first.token, clock)).toBeNull();
  expect(await resolveSession(sql, second.token, clock)).not.toBeNull();
});

test("revoking all sessions ends every one of them", async () => {
  // The reason database-backed sessions were chosen. When a manager sets a
  // reader's credentials (BR §2), every existing session for that reader must
  // end — a signed stateless cookie could not do this.
  const userId = await makeUserWithCredentials("tranminh", "con-meo-nho");
  const a = await signIn(sql, { username: "tranminh", password: "con-meo-nho", clock });
  const b = await signIn(sql, { username: "tranminh", password: "con-meo-nho", clock });

  await revokeAllSessions(sql, userId);

  expect(await resolveSession(sql, a.token, clock)).toBeNull();
  expect(await resolveSession(sql, b.token, clock)).toBeNull();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run test tests/auth/session.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/auth/session.ts`:

```ts
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Sql } from "postgres";
import type { Clock } from "../domain/kernel/clock";
import { RuleViolated } from "../domain/kernel/errors";
import { verifyPassword } from "./password";

const SESSION_DAYS = 30;

/**
 * Tokens are stored hashed, for the same reason passwords are: a leaked
 * backup should not be a stack of usable sessions. SHA-256 rather than Argon2
 * because the token is 256 bits of randomness — there is nothing to brute
 * force, and this runs on every request.
 */
const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export async function signIn(
  sql: Sql,
  input: { username: string; password: string; clock: Clock },
): Promise<{ token: string; userId: string }> {
  const [user] = await sql<{ id: string; password_hash: string | null }[]>`
    select id, password_hash from users
    where lower(username) = lower(${input.username})
      and deleted_at is null
  `;

  // INV-14: an account with no credentials is a valid state (BR §2) and
  // simply cannot sign in. Verify against a dummy hash anyway so a missing
  // account and a wrong password take the same time to fail.
  const stored = user?.password_hash ?? null;
  const ok = stored
    ? await verifyPassword(input.password, stored)
    : (await verifyPassword(input.password, "$argon2id$v=19$m=19456,t=2,p=1$YWFhYWFhYWFhYWFhYWFhYQ$0000000000000000000000000000000000000000000"), false);

  if (!user || !ok) throw new RuleViolated("not_authenticated");

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(
    input.clock.now().getTime() + SESSION_DAYS * 86_400_000,
  );

  await sql`
    insert into sessions (token_hash, user_id, expires_at)
    values (${hashToken(token)}, ${user.id}, ${expiresAt})
  `;

  return { token, userId: user.id };
}

export async function resolveSession(
  sql: Sql,
  token: string,
  clock: Clock,
): Promise<{ userId: string } | null> {
  const [row] = await sql<{ user_id: string }[]>`
    select user_id from sessions
    where token_hash = ${hashToken(token)}
      and expires_at > ${clock.now()}
  `;
  return row ? { userId: row.user_id } : null;
}

export async function signOut(sql: Sql, token: string): Promise<void> {
  await sql`delete from sessions where token_hash = ${hashToken(token)}`;
}

/**
 * Ends every session for a person.
 *
 * Called when a manager sets a reader's credentials (BR §2). The design leans
 * on that power being visible rather than restricted; it must also not leave
 * an old session alive after the credentials behind it changed.
 */
export async function revokeAllSessions(
  sql: Sql,
  userId: string,
): Promise<void> {
  await sql`delete from sessions where user_id = ${userId}`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run test tests/auth/session.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/auth/session.ts tests/auth/session.test.ts
git commit -m "feat(auth): database-backed sessions

Database-backed rather than stateless, because BR §2 gives a manager the power
to set any reader's credentials and the design's mitigation is visibility. A
credential change that cannot end existing sessions weakens the one control
that power leans on."
```

---

## Task 4: Guards — turning a session into a TenantContext

The place OPS §2's "membership, not just authentication" rule is enforced: a valid `reader` session for shelf A grants nothing on shelf B.

**Owned here, not optional: wire `olibra_app`/`olibra_admin` to a real login role.** S1's schema-rls review found this gap and recorded it rather than fixing it, because there was no application connection yet to wire — DATABASE.md §3, "The application role is not wired to a login role yet". This task is the first place a real login role exists, so it is the place this gets closed:

- `contextFor` (or whatever calls it — the connection-pool setup, most likely) must issue `set local role olibra_app` for every ordinary request, inside the same transaction as the query it guards, immediately after `set_config('olibra.bookshelf_id', ...)`. Using `olibra_admin` anywhere outside a deliberate, explicitly-named cross-shelf admin path is a regression of INV-10.
- The connecting Postgres role backing the application's connection pool must be granted membership in `olibra_app` (`grant olibra_app to <pool_role>`) and must **not** itself be a superuser — a superuser bypasses RLS regardless of which role it then `set`s to, which is exactly the trap that let 0010_rls.sql's tests pass throughout S1 with no real enforcement wired to anything. Verify this by running the guards test suite against a pool role that is provably not a superuser (`select rolsuper from pg_roles where rolname = current_user` inside a connection made through the pool) — not by inspecting the grant alone.
- `bookshelves` has no `insert` grant for `olibra_app` (0010_rls.sql; DATABASE.md §3). Whatever handles shelf onboarding must run as `olibra_admin`, deliberately, not as a side effect of `contextFor` defaulting to it when no shelf is set yet.

**Files:**
- Create: `src/auth/guards.ts`
- Test: `tests/auth/guards.test.ts`

**Interfaces:**
- Produces:
  ```ts
  function contextFor(sql: Sql, input: { token: string | null; bookshelfSlug: string; clock: Clock }): Promise<TenantContext>
  function requireRole(ctx: TenantContext, role: Role): void
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/auth/guards.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { fixedClock } from "../../src/domain/kernel/clock";
import { hashPassword } from "../../src/auth/password";
import { contextFor, requireRole } from "../../src/auth/guards";
import { signIn } from "../../src/auth/session";
import { migrate } from "../../src/db/migrate";
import { makeShelf } from "../support/factories";
import { closeAll, resetDatabase, sql } from "../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

const clock = fixedClock("2026-08-07T10:00:00Z");

async function signedInMemberOf(shelfId: string, role = "reader") {
  const [user] = await sql<{ id: string }[]>`
    insert into users (full_name, father_name, mother_name, phone, username, password_hash)
    values ('Giuse Trần Minh', 'A', 'B', '0900000000', 'tranminh',
            ${await hashPassword("x")})
    returning id
  `;
  await sql`
    insert into memberships (bookshelf_id, user_id, role, status)
    values (${shelfId}, ${user.id}, ${role}, 'active')
  `;
  const { token } = await signIn(sql, { username: "tranminh", password: "x", clock });
  return { token, userId: user.id };
}

test("a member of this shelf gets their role", async () => {
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  const { token, userId } = await signedInMemberOf(shelf.id, "manager");

  const ctx = await contextFor(sql, { token, bookshelfSlug: "dong-thap", clock });

  expect(ctx.bookshelfId).toBe(shelf.id);
  expect(ctx.actor.userId).toBe(userId);
  expect(ctx.actor.role).toBe("manager");
});

test("a valid session for shelf A grants nothing on shelf B", async () => {
  // OPS §2, the rule this task exists for. Being signed in *somewhere* is not
  // the same as being a member *here*, and conflating the two would let any
  // reader browse every parish's catalogue.
  const a = await makeShelf(sql, { slug: "dong-thap" });
  await makeShelf(sql, { slug: "an-giang" });
  const { token } = await signedInMemberOf(a.id, "manager");

  const ctx = await contextFor(sql, { token, bookshelfSlug: "an-giang", clock });

  expect(ctx.actor.role).toBe("guest");
  expect(ctx.actor.membershipId).toBeNull();
});

test("a suspended member is not a reader", async () => {
  // INV-4 blocks new loans, but a suspended member should not be reading the
  // shelf either — status, not merely role, decides.
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  const { token, userId } = await signedInMemberOf(shelf.id, "reader");
  await sql`update memberships set status = 'suspended' where user_id = ${userId}`;

  const ctx = await contextFor(sql, { token, bookshelfSlug: "dong-thap", clock });
  expect(ctx.actor.role).toBe("guest");
});

test("no token means guest", async () => {
  await makeShelf(sql, { slug: "dong-thap" });
  const ctx = await contextFor(sql, { token: null, bookshelfSlug: "dong-thap", clock });
  expect(ctx.actor.role).toBe("guest");
});

test("requireRole respects the hierarchy", () => {
  // BR §13.1: admin ⊃ manager ⊃ reader.
  const admin = { bookshelfId: "x", actor: { userId: "u", membershipId: "m", role: "admin" as const }, clock };
  const reader = { bookshelfId: "x", actor: { userId: "u", membershipId: "m", role: "reader" as const }, clock };

  expect(() => requireRole(admin, "manager")).not.toThrow();
  expect(() => requireRole(reader, "manager")).toThrow(/không có quyền/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run test tests/auth/guards.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/auth/guards.ts`:

```ts
import type { Sql } from "postgres";
import type { Clock } from "../domain/kernel/clock";
import { NotFound, RuleViolated } from "../domain/kernel/errors";
import { atLeast, type Role, type TenantContext } from "../domain/kernel/tenant";
import { resolveSession } from "./session";

/**
 * Builds the context a domain call needs, from a cookie and a URL segment.
 *
 * OPS §2 is the rule being enforced here: "a valid `reader` session for shelf
 * A grants nothing on shelf B." Authentication answers *who*; the membership
 * lookup answers *what, here*. Skipping the second would let anyone signed in
 * anywhere browse every parish's catalogue, which BR §1.2 explicitly closed.
 */
export async function contextFor(
  sql: Sql,
  input: { token: string | null; bookshelfSlug: string; clock: Clock },
): Promise<TenantContext> {
  const [shelf] = await sql<{ id: string }[]>`
    select id from bookshelves
    where slug = ${input.bookshelfSlug} and status = 'active'
  `;
  if (!shelf) throw new NotFound("shelf_not_found");

  const guest: TenantContext = {
    bookshelfId: shelf.id,
    actor: { userId: null, membershipId: null, role: "guest" },
    clock: input.clock,
  };

  if (!input.token) return guest;

  const session = await resolveSession(sql, input.token, input.clock);
  if (!session) return guest;

  const [membership] = await sql<
    { id: string; role: Role; is_super_admin: boolean }[]
  >`
    select m.id, m.role, u.is_super_admin
    from users u
    left join memberships m
      on m.user_id = u.id
     and m.bookshelf_id = ${shelf.id}
     -- Status, not merely role. A suspended member is not a reader of this
     -- shelf, though their existing loans survive (INV-4).
     and m.status = 'active'
     and m.deleted_at is null
    where u.id = ${session.userId}
  `;

  if (membership?.is_super_admin) {
    return {
      bookshelfId: shelf.id,
      actor: { userId: session.userId, membershipId: membership.id ?? null, role: "super_admin" },
      clock: input.clock,
    };
  }

  if (!membership?.id) {
    // Signed in, but not a member here. Guest, deliberately — not an error,
    // because the portal exists so a stranger can find their parish.
    return { ...guest, actor: { ...guest.actor, userId: session.userId } };
  }

  return {
    bookshelfId: shelf.id,
    actor: {
      userId: session.userId,
      membershipId: membership.id,
      role: membership.role,
    },
    clock: input.clock,
  };
}

/** BR §13.3: the interface hiding an action is never the security control. */
export function requireRole(ctx: TenantContext, required: Role): void {
  if (!atLeast(ctx.actor.role, required)) {
    throw new RuleViolated("not_permitted");
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run test tests/auth/guards.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/auth/guards.ts tests/auth/guards.test.ts
git commit -m "feat(auth): guards enforcing membership-of-this-shelf

A valid reader session for shelf A grants nothing on shelf B (OPS §2).
Authentication answers who; the membership lookup answers what, here."
```

---

## Task 5: Wire the sign-in screen

**Files:**
- Modify: `src/app/dang-nhap/page.tsx`
- Create: `src/app/dang-nhap/actions.ts`
- Create: `src/lib/session-cookie.ts`
- Test: `tests/auth/cookie.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/auth/cookie.test.ts`:

```ts
import { expect, test } from "vitest";
import { SESSION_COOKIE, cookieOptions } from "../../src/lib/session-cookie";

test("the session cookie is not readable from JavaScript", () => {
  expect(cookieOptions().httpOnly).toBe(true);
});

test("the session cookie is same-site and secure in production", () => {
  const prod = cookieOptions("production");
  expect(prod.secure).toBe(true);
  expect(prod.sameSite).toBe("lax");
});

test("the cookie is not marked secure in development", () => {
  // Otherwise nobody can sign in over plain http on localhost, and the first
  // thing anyone does is disable the flag entirely.
  expect(cookieOptions("development").secure).toBe(false);
});

test("the cookie name does not advertise the framework", () => {
  expect(SESSION_COOKIE).toBe("olibra_session");
});
```

- [ ] **Step 2: Run it to verify it fails**

Expected: FAIL — module not found.

- [ ] **Step 3: Write the cookie module**

Create `src/lib/session-cookie.ts`:

```ts
export const SESSION_COOKIE = "olibra_session";

export function cookieOptions(env = process.env.NODE_ENV) {
  return {
    httpOnly: true,
    // `lax` rather than `strict`: a volunteer following a link to the shelf
    // from a Zalo message should arrive signed in. `strict` would sign them
    // out on every inbound link, which reads as the site being broken.
    sameSite: "lax" as const,
    // Not in development, or nobody can sign in over http on localhost — and
    // the first response to that is to disable the flag everywhere.
    secure: env === "production",
    path: "/",
    maxAge: 30 * 86_400,
  };
}
```

- [ ] **Step 4: Write the server action**

Create `src/app/dang-nhap/actions.ts` calling `signIn` and setting the cookie. It must catch `RuleViolated("not_authenticated")` and return the Vietnamese message for inline display rather than throwing (BR §17.7).

- [ ] **Step 5: Wire the form**

Point `src/app/dang-nhap/page.tsx` at the action. **No visible change to the screen** — the layout, copy and spacing stay exactly as merged.

- [ ] **Step 6: Verify in the browser**

```bash
docker compose up -d
bun run dev
```

Sign in as a seeded reader; confirm the shelf home renders and the cookie is `HttpOnly` in devtools. Then confirm signing out returns you to the landing page.

- [ ] **Step 7: Run the full check**

Run: `bun run check`
Expected: green.

- [ ] **Step 8: Commit**

```bash
git add src/app/dang-nhap/ src/lib/session-cookie.ts tests/auth/cookie.test.ts
git commit -m "feat(auth): wire the sign-in screen to real sessions"
```

---

## Done when

- [ ] A seeded reader can sign in, land on the shelf home, and sign out.
- [ ] A session for shelf A resolves to `guest` on shelf B, proved by a test.
- [ ] An account with no credentials is a valid record that cannot sign in (INV-14).
- [ ] `revokeAllSessions` ends every session for a person — the property that justified a database-backed store.
- [ ] No screen's URL or visible layout changed.
- [ ] The application's connection-pool role is a genuine non-superuser granted membership in `olibra_app` (and, only for the deliberate cross-shelf admin path, `olibra_admin`), and every ordinary request path runs `set local role olibra_app` — closing the gap DATABASE.md §3 records ("The application role is not wired to a login role yet").

**Next:** Wave 1 opens. [B1 Catalogue](2026-08-07-olibra-backend-master.md#71-b1--catalogue), [B2 Members](2026-08-07-olibra-backend-master.md#72-b2--members), [B3 Community](2026-08-07-olibra-backend-master.md#73-b3--community), [B4 Administration](2026-08-07-olibra-backend-master.md#74-b4--administration) and [B5 Storage](2026-08-07-olibra-backend-master.md#75-b5--object-storage) can now run in parallel. [C1 Lending](2026-08-07-c1-lending-core.md) starts when B1 and B2 both land.
