# S2 · Domain Kernel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the machinery every one of the 57 commands sits on — the transaction boundary that pairs a state change with its audit record, the named-error taxonomy, and the tenant context that makes RLS impossible to forget.

**Architecture:** One `runCommand` function owns the transaction, sets the RLS session variable, and refuses to commit without an audit record. Commands are plain functions that receive a transaction handle and return a result plus an audit entry; they never open a transaction themselves. That inversion is what makes G3 structural rather than a convention.

**Tech Stack:** TypeScript · `postgres` (porsager) · Vitest.

## Global Constraints

Inherited from [the master plan](2026-08-07-olibra-backend-master.md#global-constraints). Load-bearing here: **G1** (no framework imports), **G3** (change and audit commit together), **G4** (RLS per transaction), **G8** (named errors), **G2** (callable with no web server).

---

## Task 1: The error taxonomy

OPS §2 requires three distinguishable shapes, because the UI treats them differently: an inline field error, a named blocking message, and a 404 page. A single `Error` class cannot express that difference, and a string message cannot be matched on.

**This file already exists — extend it, do not recreate it.** Building the parish-taxonomy module (`docs/superpowers/specs/2026-08-08-parish-taxonomy-design.md`) needed exactly this file before this slice was picked up, so `src/domain/kernel/errors.ts` was created early, seeded with only the three codes `validateSelection` (in `src/domain/members/parish-taxonomy.ts`) throws: `parish_unit_l1_not_found`, `parish_unit_l2_not_found`, `parish_unit_l2_not_in_l1`. The steps below add the rest of the catalogue to that existing file. Whoever picks up this task should open the file and read what's there before touching it — running Step 3 as a blind file creation would delete three working error codes and break the module and its passing tests (`tests/domain/members/parish-taxonomy.test.ts`) that depend on them.

**Files:**
- Extend: `src/domain/kernel/errors.ts` (already exists; keep `parish_unit_l1_not_found`, `parish_unit_l2_not_found`, `parish_unit_l2_not_in_l1` exactly as they are — do not remove or reword them)
- Test: `tests/domain/kernel/errors.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type ErrorCode = "copy_not_available" | "loan_limit_reached" | ...   // the closed union
  class NotFound extends DomainError
  class ValidationFailed extends DomainError
  class RuleViolated extends DomainError
  function messageFor(code: ErrorCode): string          // Vietnamese
  function isUniqueViolation(e: unknown): boolean       // PostgreSQL 23505
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/domain/kernel/errors.test.ts`:

```ts
import { expect, test } from "vitest";
import {
  DomainError,
  NotFound,
  RuleViolated,
  ValidationFailed,
  ERROR_MESSAGES,
  isUniqueViolation,
  messageFor,
} from "../../../src/domain/kernel/errors";

test("the three shapes are distinguishable", () => {
  // OPS §2: the UI renders these differently — an inline field error, a named
  // blocking message, and a 404 page. Collapsing them into one class means the
  // UI has to parse strings to tell them apart.
  expect(new NotFound("book_not_found")).toBeInstanceOf(DomainError);
  expect(new NotFound("book_not_found")).not.toBeInstanceOf(RuleViolated);
  expect(new ValidationFailed("validation_failed")).not.toBeInstanceOf(NotFound);
});

test("every error carries a machine code and a Vietnamese sentence", () => {
  const e = new RuleViolated("copy_not_available");
  expect(e.code).toBe("copy_not_available");
  expect(e.message).toBe("Bản sách này đang được mượn hoặc đang giữ chỗ.");
});

test("every declared code has a message", () => {
  // G8 + G7. A code with no message ships an empty dialog to a volunteer; a
  // message with no code is dead copy. Both fail here.
  for (const code of Object.keys(ERROR_MESSAGES)) {
    expect(messageFor(code as never)).not.toBe("");
  }
});

test("a PostgreSQL unique violation is recognisable", () => {
  // SDD §10.3 lists this as disqualifying for a candidate stack: without it,
  // a lost INV-1 race becomes a 500 instead of "Bản sách này vừa được mượn".
  expect(isUniqueViolation({ code: "23505" })).toBe(true);
  expect(isUniqueViolation({ code: "23514" })).toBe(false);
  expect(isUniqueViolation(new Error("boom"))).toBe(false);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run test tests/domain/kernel/errors.test.ts`
Expected: FAIL — the module resolves (it already exists), but the import fails: `DomainError`, `NotFound`, `RuleViolated`, `ValidationFailed`, `messageFor` and `isUniqueViolation` are not exported yet, only `ErrorCode` and `ERROR_MESSAGES` are. If this instead fails with "Cannot find module", something has deleted the file this task is meant to extend — stop and find out why before continuing.

- [ ] **Step 3: Extend the implementation**

`src/domain/kernel/errors.ts` already exists, but only with `ErrorCode` (a three-member union) and `ERROR_MESSAGES` (those same three entries, typed as `Record<ErrorCode, string>`). `messageFor`, `DomainError`, `NotFound`, `ValidationFailed`, `RuleViolated` and `isUniqueViolation` are not there yet — this task still adds all of those, exactly as below.

**Replace, do not merge, the existing `ErrorCode` and `ERROR_MESSAGES` declarations.** The shipped shape (`export type ErrorCode = "a" | "b" | "c"` alongside `export const ERROR_MESSAGES: Record<ErrorCode, string>`) and the shape below (`export const ERROR_MESSAGES = {…} as const` with `export type ErrorCode = keyof typeof ERROR_MESSAGES`) are two different encodings of the same idea, not additive pieces — keeping both would declare `ErrorCode` and `ERROR_MESSAGES` twice in the same module and fail to compile (TS2300/TS2451). Nothing is lost by replacing: the block below already contains the three shipped parish-taxonomy entries (`parish_unit_l1_not_found`, `parish_unit_l2_not_found`, `parish_unit_l2_not_in_l1`), word for word, so deleting the old declarations and writing the new ones in their place carries those three forward intact. Add everything else in this file — `messageFor` onward — new, alongside the replaced pair:

```ts
/**
 * Named failures, not generic ones.
 *
 * OPS §2: "A command never fails with a bare 500 or an unstructured
 * exception." Every failure mode in the operations catalogue is a stable code
 * paired with the exact Vietnamese sentence the UI shows, matching BR §17.7's
 * requirement that a business-rule violation "surface as a friendly message
 * naming what to do instead."
 */

/**
 * The closed set of failure codes. Adding a command means adding its codes
 * here, which is deliberate: the compiler then finds every place that must
 * handle it.
 */
export const ERROR_MESSAGES = {
  // — catalogue —
  shelf_not_found: "Không tìm thấy tủ sách này.",
  book_not_found: "Không tìm thấy sách này.",
  copy_not_found: "Không tìm thấy bản sách này.",
  validation_failed: "Vui lòng kiểm tra lại thông tin.",
  duplicate_isbn: "Mã ISBN này đã tồn tại trong tủ sách.",
  has_active_loans: "Không thể xoá sách đang có bản được mượn.",
  already_lost: "Bản sách này đã được báo mất.",
  already_retired: "Bản sách đã ngừng dùng, không thể báo mất.",
  not_lost: "Bản sách này hiện không ở trạng thái đã mất.",
  copy_on_loan:
    "Không thể ngừng dùng bản sách đang được mượn. Hãy nhận trả hoặc báo mất trước.",

  // — circulation —
  copy_not_available: "Bản sách này đang được mượn hoặc đang giữ chỗ.",
  copy_lost_or_retired: "Bản sách này đã mất hoặc ngừng dùng.",
  membership_not_active: "Tài khoản đang tạm khoá, không thể mượn thêm.",
  loan_limit_reached: "Bạn đọc đã mượn tối đa số sách cho phép.",
  loan_not_active: "Lượt mượn này đã được xử lý.",
  no_renewals_remaining: "Bạn đã dùng hết số lần gia hạn cho lượt mượn này.",
  title_has_queue: "Có bạn khác đang chờ mượn cuốn này, không thể gia hạn.",
  reason_required: "Vui lòng ghi lý do huỷ.",
  hold_expired: "Thời gian giữ chỗ đã hết. Bạn đọc cần đăng ký lại.",
  no_copy_available: "Không còn bản nào để giữ chỗ.",
  request_not_pending: "Yêu cầu này đã được xử lý.",
  request_not_queued: "Yêu cầu này không còn trong hàng chờ của sách này.",
  duplicate_request: "Bạn đã có một yêu cầu đang chờ cho cuốn này.",
  not_own_request: "Bạn không thể huỷ yêu cầu của người khác.",
  request_already_fulfilled: "Yêu cầu này đã được trao sách, không thể huỷ.",

  // — members —
  membership_not_found: "Không tìm thấy bạn đọc này.",
  change_already_pending: "Bạn đang có một yêu cầu thay đổi chờ duyệt.",
  reason_required_on_reject: "Từ chối cần ghi lý do.",

  // — members: parish taxonomy (already present — do not remove or reword) —
  parish_unit_l1_not_found: "Đơn vị bậc 1 đã chọn không tồn tại.",
  parish_unit_l2_not_found: "Đơn vị bậc 2 đã chọn không tồn tại.",
  parish_unit_l2_not_in_l1:
    "Đơn vị bậc 2 đã chọn không thuộc đơn vị bậc 1 đã chọn.",

  // — access —
  not_authenticated: "Bạn cần đăng nhập để tiếp tục.",
  not_permitted: "Bạn không có quyền thực hiện việc này.",
} as const;

export type ErrorCode = keyof typeof ERROR_MESSAGES;

export function messageFor(code: ErrorCode): string {
  return ERROR_MESSAGES[code];
}

export abstract class DomainError extends Error {
  constructor(readonly code: ErrorCode) {
    super(messageFor(code));
    this.name = new.target.name;
  }
}

/** The thing asked for does not exist, or is not visible to this caller. */
export class NotFound extends DomainError {}

/** The input is malformed. Renders inline, beneath the field. */
export class ValidationFailed extends DomainError {
  constructor(
    code: ErrorCode,
    readonly field?: string,
  ) {
    super(code);
  }
}

/** The input is well-formed but a business rule forbids the result. */
export class RuleViolated extends DomainError {}

/**
 * PostgreSQL 23505. INV-1's loser arrives here, and translating it into
 * `copy_not_available` is what turns a race into a plain Vietnamese sentence
 * rather than a 500 (BR §2).
 */
export function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && e.code === "23505";
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run test tests/domain/kernel/errors.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/domain/kernel/errors.ts tests/domain/kernel/errors.test.ts
git commit -m "feat(domain): extend the error taxonomy with the full Vietnamese catalogue

The file already existed, seeded with the parish-taxonomy module's three
codes (parish_unit_l1_not_found, parish_unit_l2_not_found,
parish_unit_l2_not_in_l1). This adds the rest without touching those three."
```

---

## Task 2: Tenant context

**Files:**
- Create: `src/domain/kernel/tenant.ts`
- Test: `tests/domain/kernel/tenant.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface Actor { userId: string; membershipId: string | null; role: Role }
  interface TenantContext { bookshelfId: string; actor: Actor; clock: Clock }
  function systemContext(bookshelfId: string, clock: Clock): TenantContext
  ```
  Every command and every scoped query takes a `TenantContext` as its first parameter. There is no overload that omits it.

- [ ] **Step 1: Write the failing test**

Create `tests/domain/kernel/tenant.test.ts`:

```ts
import { expect, test } from "vitest";
import { fixedClock } from "../../../src/domain/kernel/clock";
import { ROLE_RANK, atLeast, systemContext } from "../../../src/domain/kernel/tenant";

test("roles are hierarchical within a shelf", () => {
  // BR §13.1: admin ⊃ manager ⊃ reader. OPS §2 relies on this so the
  // operations catalogue never has to repeat an inherited role.
  expect(atLeast("admin", "manager")).toBe(true);
  expect(atLeast("manager", "reader")).toBe(true);
  expect(atLeast("reader", "manager")).toBe(false);
  expect(atLeast("guest", "reader")).toBe(false);
});

test("super_admin outranks everything", () => {
  expect(atLeast("super_admin", "admin")).toBe(true);
});

test("the rank order has no gaps or duplicates", () => {
  const ranks = Object.values(ROLE_RANK);
  expect(new Set(ranks).size).toBe(ranks.length);
});

test("a system context carries no actor", () => {
  // Used by the seed and by scheduled housekeeping. BR §5.4 allows an audit
  // record with no actor precisely for these.
  const ctx = systemContext("shelf-1", fixedClock("2026-08-07T00:00:00Z"));
  expect(ctx.actor.userId).toBeNull();
  expect(ctx.bookshelfId).toBe("shelf-1");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run test tests/domain/kernel/tenant.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/domain/kernel/tenant.ts`:

```ts
import type { Clock } from "./clock";

/** BR §13.1. Hierarchical within a shelf; super_admin is global. */
export const ROLE_RANK = {
  guest: 0,
  reader: 1,
  manager: 2,
  admin: 3,
  super_admin: 4,
} as const;

export type Role = keyof typeof ROLE_RANK;

/** `admin ⊃ manager ⊃ reader` — so no caller list has to repeat inherited roles. */
export function atLeast(held: Role, required: Role): boolean {
  return ROLE_RANK[held] >= ROLE_RANK[required];
}

export interface Actor {
  /** Null for system actions — the seed, scheduled housekeeping. */
  userId: string | null;
  /** Null when the actor has no membership of this shelf (super_admin). */
  membershipId: string | null;
  role: Role;
}

/**
 * Everything a command needs to know about who is asking and where.
 *
 * Every command and every shelf-scoped query takes one of these as its first
 * parameter, with no overload that omits it. That is what makes INV-10
 * structural at the application layer as well as in the database: there is no
 * way to express an unscoped call.
 */
export interface TenantContext {
  bookshelfId: string;
  actor: Actor;
  clock: Clock;
}

export function systemContext(
  bookshelfId: string,
  clock: Clock,
): TenantContext {
  return {
    bookshelfId,
    actor: { userId: null, membershipId: null, role: "super_admin" },
    clock,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run test tests/domain/kernel/tenant.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/domain/kernel/tenant.ts tests/domain/kernel/tenant.test.ts
git commit -m "feat(domain): tenant context and the role hierarchy"
```

---

## Task 3: The transaction boundary that cannot forget its audit record

The centrepiece. G3 says a command's state change and its audit record commit together or not at all. The way to make that structural rather than remembered is to make the command *return* its audit entry, so a command that produces none does not type-check.

**Files:**
- Create: `src/domain/kernel/audit.ts`
- Create: `src/domain/kernel/unit-of-work.ts`
- Modify: `src/db/transaction.ts` (created here)
- Test: `tests/domain/kernel/unit-of-work.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface AuditEntry {
    action: string                       // noun.verb
    entityType: string
    entityId: string
    before?: Record<string, unknown> | null
    after?: Record<string, unknown> | null
  }
  type Command<I, O> = (tx: Tx, ctx: TenantContext, input: I)
    => Promise<{ result: O; audit: AuditEntry | AuditEntry[] }>
  function runCommand<I, O>(sql: Sql, ctx: TenantContext, cmd: Command<I, O>, input: I): Promise<O>
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/domain/kernel/unit-of-work.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { fixedClock } from "../../../src/domain/kernel/clock";
import { RuleViolated } from "../../../src/domain/kernel/errors";
import { runCommand } from "../../../src/domain/kernel/unit-of-work";
import type { TenantContext } from "../../../src/domain/kernel/tenant";
import { migrate } from "../../../src/db/migrate";
import { makeShelf } from "../../support/factories";
import { closeAll, resetDatabase, sql } from "../../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

const clock = fixedClock("2026-08-07T10:00:00Z");

async function contextFor(): Promise<TenantContext> {
  const shelf = await makeShelf(sql);
  return {
    bookshelfId: shelf.id,
    actor: { userId: null, membershipId: null, role: "manager" },
    clock,
  };
}

test("a successful command writes its audit record in the same transaction", async () => {
  const ctx = await contextFor();

  const bookId = await runCommand(sql, ctx, async (tx, c, input: { title: string }) => {
    const [book] = await tx<{ id: string }[]>`
      insert into books (bookshelf_id, title, author, slug, published)
      values (${c.bookshelfId}, ${input.title}, 'Tô Hoài', 'x', true)
      returning id
    `;
    return {
      result: book.id,
      audit: {
        action: "book.created",
        entityType: "book",
        entityId: book.id,
        after: { title: input.title },
      },
    };
  }, { title: "Dế Mèn Phiêu Lưu Ký" });

  const entries = await sql<{ action: string; entity_id: string }[]>`
    select action, entity_id from audit_log
  `;
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({ action: "book.created", entity_id: bookId });
});

test("a failed command leaves neither the change nor the audit record", async () => {
  // G3. This is the property the whole kernel exists for: an audit record and
  // its subject can never diverge, because they are the same transaction.
  const ctx = await contextFor();

  await expect(
    runCommand(sql, ctx, async (tx, c) => {
      await tx`
        insert into books (bookshelf_id, title, author, slug, published)
        values (${c.bookshelfId}, 'Sách hỏng', 'Tô Hoài', 'y', true)
      `;
      throw new RuleViolated("validation_failed");
    }, {}),
  ).rejects.toBeInstanceOf(RuleViolated);

  expect(await sql`select 1 from books`).toHaveLength(0);
  expect(await sql`select 1 from audit_log`).toHaveLength(0);
});

test("the RLS session variable is set for the whole transaction", async () => {
  // G4. Without this the command's own writes would be rejected by the
  // policy, which is the good failure — but the point is that no command has
  // to remember to set it.
  const ctx = await contextFor();

  const seen = await runCommand(sql, ctx, async (tx) => {
    const [row] = await tx<{ v: string }[]>`
      select current_setting('olibra.bookshelf_id', true) as v
    `;
    return { result: row.v, audit: { action: "probe", entityType: "x", entityId: ctx.bookshelfId } };
  }, {});

  expect(seen).toBe(ctx.bookshelfId);
});

test("a command may write several audit entries", async () => {
  // OPS §5: ReceiveReturn with holdForRequestId is two facts, one action, one
  // transaction. The kernel must not force it to pretend to be one.
  const ctx = await contextFor();

  await runCommand(sql, ctx, async (tx, c) => {
    const [book] = await tx<{ id: string }[]>`
      insert into books (bookshelf_id, title, author, slug, published)
      values (${c.bookshelfId}, 'Sách', 'Tô Hoài', 'z', true)
      returning id
    `;
    return {
      result: null,
      audit: [
        { action: "book.created", entityType: "book", entityId: book.id },
        { action: "copy.added", entityType: "book", entityId: book.id },
      ],
    };
  }, {});

  expect(await sql`select 1 from audit_log`).toHaveLength(2);
});

test("the actor and the shelf are recorded on every entry", async () => {
  const shelf = await makeShelf(sql);
  const [user] = await sql<{ id: string }[]>`
    insert into users (full_name, father_name, mother_name, phone)
    values ('Maria Lan', 'A', 'B', '0900000001') returning id
  `;
  const ctx: TenantContext = {
    bookshelfId: shelf.id,
    actor: { userId: user.id, membershipId: null, role: "manager" },
    clock,
  };

  await runCommand(sql, ctx, async () => ({
    result: null,
    audit: { action: "probe.done", entityType: "x", entityId: shelf.id },
  }), {});

  const [entry] = await sql<{ actor_id: string; bookshelf_id: string }[]>`
    select actor_id, bookshelf_id from audit_log
  `;
  expect(entry.actor_id).toBe(user.id);
  expect(entry.bookshelf_id).toBe(shelf.id);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run test tests/domain/kernel/unit-of-work.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the audit entry type and writer**

Create `src/domain/kernel/audit.ts`:

```ts
import type { TenantContext } from "./tenant";

/**
 * One audit record, as a command declares it.
 *
 * BR §14 requires two things this shape encodes: an action name meaningful
 * enough for the browser to filter and label ("manager approved this
 * registration", not "update"), and the before/after values.
 */
export interface AuditEntry {
  /** `noun.verb` — `loan.created`, `credentials.set`. */
  action: string;
  entityType: string;
  entityId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

/**
 * Fields never permitted in an audit record.
 *
 * BR §2: "The audit records the act, never the secret." No password, no hash,
 * no session token — only that a named manager set credentials for a named
 * reader at a given time. The temptation to log "what it was changed to" is
 * strongest exactly here, so this is enforced rather than documented.
 */
const FORBIDDEN = ["password", "password_hash", "token", "session", "secret"];

export function assertNoSecrets(entry: AuditEntry): void {
  for (const bag of [entry.before, entry.after]) {
    if (!bag) continue;
    for (const key of Object.keys(bag)) {
      if (FORBIDDEN.some((f) => key.toLowerCase().includes(f))) {
        throw new Error(
          `Audit entry for ${entry.action} carries a forbidden field "${key}". ` +
            "BR §2: the audit records the act, never the secret.",
        );
      }
    }
  }
}

export type AuditRow = AuditEntry & {
  bookshelfId: string;
  actorId: string | null;
  occurredAt: Date;
};

export function toRow(entry: AuditEntry, ctx: TenantContext): AuditRow {
  assertNoSecrets(entry);
  return {
    ...entry,
    bookshelfId: ctx.bookshelfId,
    actorId: ctx.actor.userId,
    occurredAt: ctx.clock.now(),
  };
}
```

- [ ] **Step 4: Write the unit of work**

Create `src/domain/kernel/unit-of-work.ts`:

```ts
import type { Sql, TransactionSql } from "postgres";
import type { AuditEntry } from "./audit";
import { toRow } from "./audit";
import type { TenantContext } from "./tenant";

export type Tx = TransactionSql;

/**
 * A command: one business fact, plus the audit record that describes it.
 *
 * Returning the audit entry rather than writing it is the whole design. A
 * command that produces no audit entry does not type-check, so G3 — "a
 * command's state change and its audit record commit together or not at all"
 * — is a property of the signature rather than of anyone's memory.
 *
 * Commands never open a transaction. They receive one. That is what keeps
 * "one command, one transaction" true when commands start calling helpers.
 */
export type Command<I, O> = (
  tx: Tx,
  ctx: TenantContext,
  input: I,
) => Promise<{ result: O; audit: AuditEntry | AuditEntry[] }>;

/**
 * Runs a command in one transaction, with tenant scoping applied.
 *
 * `set_config(..., true)` is transaction-local, which is why the driver must
 * be pooled in transaction mode rather than session mode (DB §3). Getting that
 * wrong leaks one request's shelf into the next request on the same
 * connection, and it does so silently.
 */
export async function runCommand<I, O>(
  sql: Sql,
  ctx: TenantContext,
  command: Command<I, O>,
  input: I,
): Promise<O> {
  return sql.begin(async (tx) => {
    await tx`select set_config('olibra.bookshelf_id', ${ctx.bookshelfId}, true)`;

    const { result, audit } = await command(tx as Tx, ctx, input);

    const entries = Array.isArray(audit) ? audit : [audit];
    for (const entry of entries) {
      const row = toRow(entry, ctx);
      await tx`
        insert into audit_log
          (bookshelf_id, actor_id, action, entity_type, entity_id,
           before_values, after_values, occurred_at)
        values
          (${row.bookshelfId}, ${row.actorId}, ${row.action}, ${row.entityType},
           ${row.entityId}, ${tx.json(row.before ?? null)},
           ${tx.json(row.after ?? null)}, ${row.occurredAt})
      `;
    }

    return result;
  }) as Promise<O>;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun run test tests/domain/kernel/unit-of-work.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 6: Commit**

```bash
git add src/domain/kernel/audit.ts src/domain/kernel/unit-of-work.ts tests/domain/kernel/unit-of-work.test.ts
git commit -m "feat(domain): the command transaction boundary

A command returns its audit entry rather than writing it, so a command that
produces none does not type-check. That makes 'the change and its audit record
commit together or not at all' a property of the signature rather than of
anyone's memory."
```

---

## Task 4: INV-8, as its own named test

**Files:**
- Test: `tests/invariants/inv-08-every-transition-audited.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { fixedClock } from "../../src/domain/kernel/clock";
import { assertNoSecrets } from "../../src/domain/kernel/audit";
import { runCommand } from "../../src/domain/kernel/unit-of-work";
import { migrate } from "../../src/db/migrate";
import { makeShelf } from "../support/factories";
import { closeAll, resetDatabase, sql } from "../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

test("INV-8: an audit record names actor, time, before and after", async () => {
  const shelf = await makeShelf(sql);
  const [user] = await sql<{ id: string }[]>`
    insert into users (full_name, father_name, mother_name, phone)
    values ('Maria Lan', 'A', 'B', '0900000001') returning id
  `;
  const clock = fixedClock("2026-08-03T07:32:00Z"); // 14:32 in Ho Chi Minh City

  await runCommand(
    sql,
    { bookshelfId: shelf.id, actor: { userId: user.id, membershipId: null, role: "manager" }, clock },
    async () => ({
      result: null,
      audit: {
        action: "loan.created",
        entityType: "loan",
        entityId: shelf.id,
        before: { state: "available" },
        after: { state: "on_loan" },
      },
    }),
    {},
  );

  const [entry] = await sql<Record<string, unknown>[]>`
    select actor_id, occurred_at, before_values, after_values from audit_log
  `;
  expect(entry.actor_id).toBe(user.id);
  expect(entry.occurred_at).toEqual(clock.now());
  expect(entry.before_values).toEqual({ state: "available" });
  expect(entry.after_values).toEqual({ state: "on_loan" });
});

test("INV-8: a secret can never reach the audit log", () => {
  // BR §2: "The audit records the act, never the secret." SetReaderCredentials
  // is the command where the temptation to log what it was changed to is
  // strongest, so the guard is in the kernel rather than in that command.
  expect(() =>
    assertNoSecrets({
      action: "credentials.set",
      entityType: "user",
      entityId: "x",
      after: { password_hash: "$2b$whatever" },
    }),
  ).toThrow(/never the secret/);
});
```

- [ ] **Step 2: Run it**

Run: `bun run test tests/invariants/inv-08-every-transition-audited.test.ts`
Expected: PASS — 2 tests.

- [ ] **Step 3: Prove the secret guard can fail**

Temporarily remove `password_hash` from `FORBIDDEN` in `src/domain/kernel/audit.ts`, re-run, observe the second test fail, then restore it and re-run.

- [ ] **Step 4: Commit**

```bash
git add tests/invariants/inv-08-every-transition-audited.test.ts
git commit -m "test: INV-8, including the guard that keeps secrets out of the audit log"
```

---

## Task 5: A query counterpart, so reads are scoped too

Commands are covered. Queries are the larger surface — 43 of them — and each one is equally capable of forgetting its shelf.

**Files:**
- Modify: `src/domain/kernel/unit-of-work.ts`
- Test: `tests/domain/kernel/query-scope.test.ts`

**Interfaces:**
- Produces:
  ```ts
  function runQuery<O>(sql: Sql, ctx: TenantContext, q: (tx: Tx, ctx: TenantContext) => Promise<O>): Promise<O>
  ```

- [ ] **Step 1: Write the failing test**

```ts
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { fixedClock } from "../../../src/domain/kernel/clock";
import { runQuery } from "../../../src/domain/kernel/unit-of-work";
import { migrate } from "../../../src/db/migrate";
import { makeBookWithCopies, makeShelf } from "../../support/factories";
import { closeAll, resetDatabase, sql } from "../../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

const clock = fixedClock("2026-08-07T10:00:00Z");

test("a query sees only its own shelf, even with no where clause", async () => {
  // INV-10. The query below is the mistake — `select * from books` with no
  // filter. It must return one row, not two.
  const a = await makeShelf(sql);
  const b = await makeShelf(sql);
  await makeBookWithCopies(sql, a.id, 1);
  await makeBookWithCopies(sql, b.id, 1);

  const rows = await runQuery(
    sql,
    { bookshelfId: a.id, actor: { userId: null, membershipId: null, role: "reader" }, clock },
    (tx) => tx<{ bookshelf_id: string }[]>`select bookshelf_id from books`,
  );

  expect(rows).toHaveLength(1);
  expect(rows[0].bookshelf_id).toBe(a.id);
});

test("a query cannot write", async () => {
  // Queries never change state (OPS §1). The read-only transaction makes that
  // structural rather than a naming convention.
  const a = await makeShelf(sql);
  await expect(
    runQuery(
      sql,
      { bookshelfId: a.id, actor: { userId: null, membershipId: null, role: "reader" }, clock },
      (tx) => tx`insert into books (bookshelf_id, title, author, slug, published)
                 values (${a.id}, 'x', 'y', 'z', true)`,
    ),
  ).rejects.toThrow(/read-only/i);
});
```

- [ ] **Step 2: Run it to verify it fails**

Expected: FAIL — `runQuery` is not exported.

- [ ] **Step 3: Add `runQuery`**

Append to `src/domain/kernel/unit-of-work.ts`:

```ts
/**
 * Runs a read in a scoped, read-only transaction.
 *
 * Read-only is not decoration: OPS §1 says "queries never change state", and
 * a transaction the database refuses writes on turns that from a naming
 * convention into something enforced. A query that grows an `insert` during a
 * hurried afternoon fails loudly instead of quietly becoming a command with no
 * audit record.
 */
export async function runQuery<O>(
  sql: Sql,
  ctx: TenantContext,
  query: (tx: Tx, ctx: TenantContext) => Promise<O>,
): Promise<O> {
  return sql.begin(async (tx) => {
    await tx`set transaction read only`;
    await tx`select set_config('olibra.bookshelf_id', ${ctx.bookshelfId}, true)`;
    return query(tx as Tx, ctx);
  }) as Promise<O>;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run test tests/domain/kernel/query-scope.test.ts`
Expected: PASS — 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/domain/kernel/unit-of-work.ts tests/domain/kernel/query-scope.test.ts
git commit -m "feat(domain): scoped read-only query boundary"
```

---

## Done when

- [ ] Every one of the 57 commands can be written as a `Command<I, O>` with no ability to open its own transaction or skip its audit record.
- [ ] `tests/invariants/inv-08-*.test.ts` passes, including the guard that refuses a password field in an audit entry.
- [ ] A query with a missing `where` clause returns its own shelf's rows only, proved by a test rather than by review.
- [ ] `bun run check` is green.

**Next slice:** [S3 · Identity and session](2026-08-07-s3-identity-session.md).
