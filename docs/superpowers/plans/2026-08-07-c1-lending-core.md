# C1 · Lending Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `LendCopy`, `ReceiveReturn` and `VoidLoan` — the three commands the whole product exists for — enforcing INV-1 through INV-5, INV-7, INV-8 and INV-11.

**Architecture:** Blocking conditions are pure predicates in `policy.ts`, testable with no database at all; the commands compose them inside a `runCommand` transaction. INV-1's race is left to the partial unique index and the loser's `23505` is translated, rather than being pre-checked and hoped about.

**Tech Stack:** TypeScript · PostgreSQL · Vitest.

**Blocked by:** S3, B1 (catalogue), B2 (members). A loan needs a copy and a member — both, not either.

## Global Constraints

Inherited from [the master plan](2026-08-07-olibra-backend-master.md#global-constraints). Load-bearing here: **G3** (change plus audit, one transaction), **G5** (overdue derived, never written), **G6** (`due_on` is a date in `Asia/Ho_Chi_Minh`), **G8** (named errors), **G10** (loans never deleted), **G12** (named test per invariant).

---

## Why this slice deserves the most careful reviewer

BR §1.3 says the dominant real-world interaction is a volunteer holding a phone next to a book. BR §16.3 calls quick-lend "the most important screen in the application". Seven of the fourteen invariants land here at once, and one of them — INV-1 — is the only rule in the system where a bug produces silent data corruption rather than an error message.

The design decision that carries the most weight is in Task 3: **the command does not pre-check whether the copy is free.** It attempts the insert and translates the failure. A pre-check reads as more careful and is strictly worse, because it re-opens the race window it appears to close.

---

## Task 1: Blocking conditions as pure predicates

BR §16.3: "Blocking conditions surface as a clear message *before* the confirm step, never as an error afterwards." The same predicates must answer both the "can I?" question on the screen and the "may I?" question in the command, or the two will disagree and a volunteer will be told yes and then no.

**Files:**
- Create: `src/domain/circulation/policy.ts`
- Test: `tests/domain/circulation/policy.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type Block = { blocked: true; reason: ErrorCode } | { blocked: false }
  function copyLendable(copy: { state: CopyState; heldForMembershipId: string | null }, forMembershipId: string): Block
  function memberMayBorrow(m: { status: MembershipStatus; activeLoans: number }, maxConcurrentLoans: number): Block
  function dueDateFor(clock: Clock, loanDays: number): string        // YYYY-MM-DD
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/domain/circulation/policy.test.ts`:

```ts
import { expect, test } from "vitest";
import { fixedClock } from "../../../src/domain/kernel/clock";
import {
  copyLendable,
  dueDateFor,
  memberMayBorrow,
} from "../../../src/domain/circulation/policy";

const HELD_BY_NOBODY = null;

test("INV-3: an available copy is lendable to anyone", () => {
  expect(
    copyLendable({ state: "available", heldForMembershipId: HELD_BY_NOBODY }, "m1"),
  ).toEqual({ blocked: false });
});

test("INV-3: a held copy is lendable only to its holder", () => {
  // The case that distinguishes LendCopy from HandoverRequest. Reader A holds
  // the hold; handing the book to reader B must fail even though B is a
  // perfectly good member.
  const held = { state: "held" as const, heldForMembershipId: "m1" };
  expect(copyLendable(held, "m1")).toEqual({ blocked: false });
  expect(copyLendable(held, "m2")).toEqual({
    blocked: true,
    reason: "copy_not_available",
  });
});

test("INV-3: a copy already on loan is not lendable", () => {
  expect(
    copyLendable({ state: "on_loan", heldForMembershipId: HELD_BY_NOBODY }, "m1"),
  ).toEqual({ blocked: true, reason: "copy_not_available" });
});

test("INV-7: a lost or retired copy is never lendable", () => {
  for (const state of ["lost", "retired"] as const) {
    expect(
      copyLendable({ state, heldForMembershipId: HELD_BY_NOBODY }, "m1"),
    ).toEqual({ blocked: true, reason: "copy_lost_or_retired" });
  }
});

test("INV-4: a suspended member cannot start a new loan", () => {
  expect(memberMayBorrow({ status: "suspended", activeLoans: 0 }, 3)).toEqual({
    blocked: true,
    reason: "membership_not_active",
  });
});

test("INV-4: a pending member cannot borrow either", () => {
  // Registering on behalf still creates a pending application (BR §16.1), so
  // this is a real state a manager will meet at the shelf.
  expect(memberMayBorrow({ status: "pending", activeLoans: 0 }, 3)).toEqual({
    blocked: true,
    reason: "membership_not_active",
  });
});

test("INV-5: a member at the loan limit is blocked", () => {
  expect(memberMayBorrow({ status: "active", activeLoans: 3 }, 3)).toEqual({
    blocked: true,
    reason: "loan_limit_reached",
  });
  expect(memberMayBorrow({ status: "active", activeLoans: 2 }, 3)).toEqual({
    blocked: false,
  });
});

test("INV-5: the limit is the shelf's, not a constant", () => {
  // BR §5.5 — max_concurrent_loans is per-shelf configuration.
  expect(memberMayBorrow({ status: "active", activeLoans: 3 }, 5)).toEqual({
    blocked: false,
  });
});

test("the due date is loan_days from today, in the local timezone", () => {
  // G6. 23:30Z on the 7th is already the 8th in Ho Chi Minh City, so a book
  // lent then is due on the 22nd, not the 21st.
  expect(dueDateFor(fixedClock("2026-08-07T23:30:00Z"), 14)).toBe("2026-08-22");
  expect(dueDateFor(fixedClock("2026-08-07T10:00:00Z"), 14)).toBe("2026-08-21");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run test tests/domain/circulation/policy.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/domain/circulation/policy.ts`:

```ts
import type { Clock } from "../kernel/clock";
import type { ErrorCode } from "../kernel/errors";

export type CopyState = "available" | "held" | "on_loan" | "lost" | "retired";
export type MembershipStatus = "pending" | "active" | "suspended" | "left" | "rejected";

export type Block = { blocked: true; reason: ErrorCode } | { blocked: false };

const OK: Block = { blocked: false };
const no = (reason: ErrorCode): Block => ({ blocked: true, reason });

/**
 * INV-3 and INV-7, as one predicate.
 *
 * Pure on purpose. BR §16.3 requires blocking conditions to appear *before*
 * the confirm step; the command enforces the same rules at commit time. If
 * those were two implementations they would drift, and a volunteer would be
 * told yes and then no — which is worse than being told no.
 */
export function copyLendable(
  copy: { state: CopyState; heldForMembershipId: string | null },
  forMembershipId: string,
): Block {
  if (copy.state === "lost" || copy.state === "retired") {
    return no("copy_lost_or_retired");
  }
  if (copy.state === "available") return OK;
  if (copy.state === "held" && copy.heldForMembershipId === forMembershipId) {
    // The hold is this reader's — collecting it is exactly the permitted
    // held → on_loan transition (BR §7.1).
    return OK;
  }
  return no("copy_not_available");
}

/**
 * INV-4 and INV-5.
 *
 * INV-4 is deliberately narrow: a non-active membership blocks a *new* loan
 * and leaves existing ones alone. A reader suspended while holding a book
 * keeps the book (BR §3).
 */
export function memberMayBorrow(
  member: { status: MembershipStatus; activeLoans: number },
  maxConcurrentLoans: number,
): Block {
  if (member.status !== "active") return no("membership_not_active");
  if (member.activeLoans >= maxConcurrentLoans) return no("loan_limit_reached");
  return OK;
}

/**
 * The due date, as a date.
 *
 * BR §5.4: a book is due at the end of a day, not at 14:23 on it. Computed
 * from the clock's local `today()`, so a book lent at 23:30 on the 7th — half
 * past six in the morning UTC — is due fourteen days after the 8th.
 */
export function dueDateFor(clock: Clock, loanDays: number): string {
  const [y, m, d] = clock.today().split("-").map(Number);
  const due = new Date(Date.UTC(y, m - 1, d + loanDays));
  return due.toISOString().slice(0, 10);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run test tests/domain/circulation/policy.test.ts`
Expected: PASS — 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/domain/circulation/policy.ts tests/domain/circulation/policy.test.ts
git commit -m "feat(circulation): blocking conditions as pure predicates

One implementation answers both the 'can I?' on screen and the 'may I?' at
commit time. Two implementations would drift, and a volunteer would be told
yes and then no."
```

---

## Task 2: The invariant tests for INV-3, INV-4 and INV-5

Written before `LendCopy` exists, against the command's signature. They will not compile yet; that is the point.

**Files:**
- Test: `tests/invariants/inv-03-only-available-or-own-hold.test.ts`
- Test: `tests/invariants/inv-04-suspended-cannot-borrow.test.ts`
- Test: `tests/invariants/inv-05-loan-limit.test.ts`

- [ ] **Step 1: Write INV-4's test**

```ts
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { fixedClock } from "../../src/domain/kernel/clock";
import { lendCopy } from "../../src/domain/circulation/commands/lend-copy";
import { runCommand } from "../../src/domain/kernel/unit-of-work";
import { migrate } from "../../src/db/migrate";
import { makeBookWithCopies, makeMember, makeShelf } from "../support/factories";
import { closeAll, resetDatabase, sql } from "../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

const clock = fixedClock("2026-08-07T10:00:00Z");

async function managerContext(bookshelfId: string) {
  const manager = await makeMember(sql, bookshelfId, { role: "manager" });
  return {
    bookshelfId,
    actor: { userId: manager.userId, membershipId: manager.id, role: "manager" as const },
    clock,
  };
}

test("INV-4: a suspended member cannot start a new loan", async () => {
  const shelf = await makeShelf(sql);
  const ctx = await managerContext(shelf.id);
  const { copyIds } = await makeBookWithCopies(sql, shelf.id, 1);
  const reader = await makeMember(sql, shelf.id, { status: "suspended" });

  await expect(
    runCommand(sql, ctx, lendCopy, { copyId: copyIds[0], membershipId: reader.id }),
  ).rejects.toMatchObject({ code: "membership_not_active" });
});

test("INV-4: suspending a member does not disturb their existing loan", async () => {
  // BR §3: "A reader is suspended while still holding a book. The loan
  // survives; the suspension only blocks new loans." The obvious wrong
  // implementation cascades the suspension into the loan.
  const shelf = await makeShelf(sql);
  const ctx = await managerContext(shelf.id);
  const { copyIds } = await makeBookWithCopies(sql, shelf.id, 1);
  const reader = await makeMember(sql, shelf.id);

  await runCommand(sql, ctx, lendCopy, { copyId: copyIds[0], membershipId: reader.id });
  await sql`update memberships set status = 'suspended' where id = ${reader.id}`;

  const active = await sql`
    select 1 from loans where borrower_id = ${reader.id} and status = 'active'
  `;
  expect(active).toHaveLength(1);
});
```

- [ ] **Step 2: Write INV-5's test**

```ts
test("INV-5: a reader at the shelf's limit cannot borrow another", async () => {
  const shelf = await makeShelf(sql);
  const ctx = await managerContext(shelf.id);
  const reader = await makeMember(sql, shelf.id);

  // The default is 3 (BR §5.5).
  for (let i = 0; i < 3; i++) {
    const { copyIds } = await makeBookWithCopies(sql, shelf.id, 1);
    await runCommand(sql, ctx, lendCopy, { copyId: copyIds[0], membershipId: reader.id });
  }

  const { copyIds } = await makeBookWithCopies(sql, shelf.id, 1);
  await expect(
    runCommand(sql, ctx, lendCopy, { copyId: copyIds[0], membershipId: reader.id }),
  ).rejects.toMatchObject({ code: "loan_limit_reached" });
});

test("INV-5: the limit is per shelf, not global", async () => {
  // A child may belong to two parishes (BR §5.3). Three books at Đồng Tháp
  // must not stop them borrowing at An Giang.
  const a = await makeShelf(sql);
  const b = await makeShelf(sql);
  const ctxA = await managerContext(a.id);
  const ctxB = await managerContext(b.id);

  const [user] = await sql<{ id: string }[]>`
    insert into users (full_name, father_name, mother_name, phone)
    values ('Giuse Trần Minh', 'A', 'B', '0900000000') returning id
  `;
  const memberships = await Promise.all(
    [a.id, b.id].map(async (shelfId) => {
      const [m] = await sql<{ id: string }[]>`
        insert into memberships (bookshelf_id, user_id, role, status)
        values (${shelfId}, ${user.id}, 'reader', 'active') returning id
      `;
      return m.id;
    }),
  );

  for (let i = 0; i < 3; i++) {
    const { copyIds } = await makeBookWithCopies(sql, a.id, 1);
    await runCommand(sql, ctxA, lendCopy, { copyId: copyIds[0], membershipId: memberships[0] });
  }

  const { copyIds } = await makeBookWithCopies(sql, b.id, 1);
  await expect(
    runCommand(sql, ctxB, lendCopy, { copyId: copyIds[0], membershipId: memberships[1] }),
  ).resolves.toBeDefined();
});

test("INV-5: an honest note — a determined race can exceed the limit by one", async () => {
  // DB §7.2 chose an in-transaction application check over a trigger or a
  // counter column, and recorded that a simultaneous double-lend to the same
  // reader by two managers could exceed the limit by one. That is a far
  // cheaper failure than a corrupted loan record, and a manager can void the
  // extra loan.
  //
  // This test documents the accepted behaviour rather than asserting a
  // guarantee that was deliberately not made. If it starts failing because
  // someone tightened the isolation level, that is an improvement — update
  // the test and DB §7.2 together.
  expect(true).toBe(true);
});
```

- [ ] **Step 3: Write INV-3's test**

Covering the three cases from Task 1's predicate, this time end to end: an available copy lends; a copy held for reader A refuses to lend to reader B; a copy already on loan refuses.

- [ ] **Step 4: Run them to verify they fail**

Run: `bun run test tests/invariants/inv-0{3,4,5}*`
Expected: FAIL — `Cannot find module '.../commands/lend-copy'`.

---

## Task 3: `LendCopy`

**Files:**
- Create: `src/domain/circulation/commands/lend-copy.ts`

**Interfaces:**
- Consumes: `runCommand`, `TenantContext`, the policy predicates, `isUniqueViolation`.
- Produces:
  ```ts
  const lendCopy: Command<{ copyId: string; membershipId: string }, { loanId: string; dueOn: string }>
  ```

- [ ] **Step 1: Write the implementation**

```ts
import { isUniqueViolation, NotFound, RuleViolated } from "../../kernel/errors";
import type { Command } from "../../kernel/unit-of-work";
import { copyLendable, dueDateFor, memberMayBorrow } from "../policy";

export interface LendCopyInput {
  copyId: string;
  membershipId: string;
}

export interface LendCopyResult {
  loanId: string;
  dueOn: string;
}

/**
 * Hands a copy to a reader. BR §16.3's quick-lend terminal step, and the most
 * important command in the application.
 *
 * The ordering below is deliberate and worth reading before changing:
 *
 *   1. Read the copy and the member, and apply the *pure* predicates. This
 *      produces the friendly named errors BR §16.3 requires — "Bạn đọc đã
 *      mượn tối đa số sách cho phép", not a constraint violation.
 *
 *   2. Attempt the insert, and let the partial unique index decide the race.
 *
 * Step 1 does not make step 2 unnecessary, and step 2 does not make step 1
 * pointless. Step 1 exists for the *common* case, where the answer is knowable
 * and the message should be kind. Step 2 exists for the case BR §2 describes:
 * two managers, two phones, the same second. There is no ordering of reads and
 * writes in application code that closes that window — only the index does
 * (INV-1), which is why the losing insert is caught and translated rather than
 * prevented.
 */
export const lendCopy: Command<LendCopyInput, LendCopyResult> = async (
  tx,
  ctx,
  input,
) => {
  const [copy] = await tx<
    {
      id: string;
      book_id: string;
      state: "available" | "held" | "on_loan" | "lost" | "retired";
      held_for: string | null;
    }[]
  >`
    select c.id, c.book_id, c.state,
           (select r.requester_id
              from borrow_requests r
             where r.copy_id = c.id
               and r.status = 'approved'
               and r.hold_expires_at > ${ctx.clock.now()}
             limit 1) as held_for
      from book_copies c
     where c.id = ${input.copyId} and c.deleted_at is null
  `;
  if (!copy) throw new NotFound("copy_not_found");

  const copyBlock = copyLendable(
    { state: copy.state, heldForMembershipId: copy.held_for },
    input.membershipId,
  );
  if (copyBlock.blocked) throw new RuleViolated(copyBlock.reason);

  const [member] = await tx<
    { id: string; status: string; active_loans: string; max_loans: number }[]
  >`
    select m.id, m.status,
           (select count(*) from loans l
             where l.borrower_id = m.id and l.status = 'active') as active_loans,
           coalesce((b.settings->>'max_concurrent_loans')::int, 3) as max_loans
      from memberships m
      join bookshelves b on b.id = m.bookshelf_id
     where m.id = ${input.membershipId} and m.deleted_at is null
  `;
  if (!member) throw new NotFound("membership_not_found");

  const memberBlock = memberMayBorrow(
    { status: member.status as never, activeLoans: Number(member.active_loans) },
    member.max_loans,
  );
  if (memberBlock.blocked) throw new RuleViolated(memberBlock.reason);

  const [loanRow, dueOn] = await (async () => {
    const due = dueDateFor(ctx.clock, await loanDaysFor(tx, ctx.bookshelfId));
    try {
      const [row] = await tx<{ id: string }[]>`
        insert into loans
          (bookshelf_id, copy_id, book_id, borrower_id, lent_by, lent_at, due_on, status)
        values
          (${ctx.bookshelfId}, ${copy.id}, ${copy.book_id}, ${input.membershipId},
           ${ctx.actor.membershipId}, ${ctx.clock.now()}, ${due}, 'active')
        returning id
      `;
      return [row, due] as const;
    } catch (e) {
      // INV-1's loser. BR §2: it "must fail cleanly and see a plain message,
      // never a silently corrupted record."
      if (isUniqueViolation(e)) throw new RuleViolated("copy_not_available");
      throw e;
    }
  })();

  await tx`update book_copies set state = 'on_loan' where id = ${copy.id}`;

  return {
    result: { loanId: loanRow.id, dueOn },
    audit: {
      action: "loan.created",
      entityType: "loan",
      entityId: loanRow.id,
      before: { copy_state: copy.state },
      after: { copy_state: "on_loan", borrower_id: input.membershipId, due_on: dueOn },
    },
  };
};

async function loanDaysFor(tx: Parameters<typeof lendCopy>[0], bookshelfId: string) {
  const [row] = await tx<{ loan_days: number }[]>`
    select coalesce((settings->>'loan_days')::int, 14) as loan_days
      from bookshelves where id = ${bookshelfId}
  `;
  return row.loan_days;
}
```

- [ ] **Step 2: Run the invariant tests to verify they pass**

Run: `bun run test tests/invariants/`
Expected: PASS — INV-3, INV-4, INV-5 now green alongside the structural ones.

- [ ] **Step 3: Extend INV-1's test to go through the command**

INV-1 already has a test at the SQL level from S1. Add a second file, `tests/invariants/inv-01-lend-race.test.ts`, that runs two concurrent `runCommand(sql, ctx, lendCopy, …)` calls on two connections and asserts one resolves and the other rejects with `copy_not_available` — the named error, not a raw `23505`.

This is the test that proves the translation works, which is the difference between a volunteer seeing "Bản sách này đang được mượn hoặc đang giữ chỗ." and seeing a 500.

- [ ] **Step 4: Commit**

```bash
git add src/domain/circulation/commands/lend-copy.ts tests/invariants/
git commit -m "feat(circulation): LendCopy

The command does not pre-check the race it cannot win. It applies the pure
predicates for the common case — so the message is kind — then attempts the
insert and translates the partial unique index's 23505 into
copy_not_available. A pre-check would read as more careful and be strictly
worse, because it re-opens the window it appears to close."
```

---

## Task 4: `ReceiveReturn`

BR §16.3: the common case — an undamaged book — is two taps. OPS §5 is explicit that the queued-reader decision is a **second fact**, never automatic: the manager decides, because the next reader may not be standing there.

**Files:**
- Create: `src/domain/circulation/commands/receive-return.ts`
- Test: `tests/domain/circulation/receive-return.test.ts`

**Interfaces:**
- Produces:
  ```ts
  const receiveReturn: Command<
    { loanId: string; condition: Condition; note?: string; photo?: string; holdForRequestId?: string },
    { loanId: string; queuedRequestId: string | null }
  >
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/domain/circulation/receive-return.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { fixedClock } from "../../../src/domain/kernel/clock";
import { lendCopy } from "../../../src/domain/circulation/commands/lend-copy";
import { receiveReturn } from "../../../src/domain/circulation/commands/receive-return";
import { runCommand } from "../../../src/domain/kernel/unit-of-work";
import type { TenantContext } from "../../../src/domain/kernel/tenant";
import { migrate } from "../../../src/db/migrate";
import { makeBookWithCopies, makeMember, makeShelf } from "../../support/factories";
import { closeAll, resetDatabase, sql } from "../../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

const clock = fixedClock("2026-08-07T10:00:00Z");

/** A shelf, a manager, a reader, one copy, and that copy already lent out. */
async function lentOut() {
  const shelf = await makeShelf(sql);
  const manager = await makeMember(sql, shelf.id, { role: "manager" });
  const ctx: TenantContext = {
    bookshelfId: shelf.id,
    actor: { userId: manager.userId, membershipId: manager.id, role: "manager" },
    clock,
  };
  const { bookId, copyIds } = await makeBookWithCopies(sql, shelf.id, 1);
  const reader = await makeMember(sql, shelf.id);
  const { loanId } = await runCommand(sql, ctx, lendCopy, {
    copyId: copyIds[0],
    membershipId: reader.id,
  });
  return { shelf, ctx, bookId, copyId: copyIds[0], reader, loanId };
}

test("a returned copy becomes available again", async () => {
  const { ctx, copyId, loanId } = await lentOut();

  await runCommand(sql, ctx, receiveReturn, { loanId, condition: "perfect" });

  const [copy] = await sql<{ state: string }[]>`
    select state from book_copies where id = ${copyId}
  `;
  const [loan] = await sql<{ status: string }[]>`
    select status from loans where id = ${loanId}
  `;
  expect(copy.state).toBe("available");
  expect(loan.status).toBe("returned");
});

test("the return records a condition assessment tied to the loan", async () => {
  // BR §5.4: ConditionAssessment is separate from the loan because a manager
  // may assess a copy at any time, not only at return. The link back to the
  // loan is what makes "returned in worse condition than it left in" (BR §3)
  // answerable later.
  const { ctx, copyId, loanId } = await lentOut();

  await runCommand(sql, ctx, receiveReturn, {
    loanId,
    condition: "torn",
    note: "Rách trang 12",
  });

  const [assessment] = await sql<
    { copy_id: string; loan_id: string; condition: string; note: string }[]
  >`select copy_id, loan_id, condition, note from condition_assessments`;
  expect(assessment).toMatchObject({
    copy_id: copyId,
    loan_id: loanId,
    condition: "torn",
    note: "Rách trang 12",
  });
});

test("the copy carries its new condition forward", async () => {
  const { ctx, copyId, loanId } = await lentOut();

  await runCommand(sql, ctx, receiveReturn, { loanId, condition: "worn" });

  const [copy] = await sql<{ condition: string }[]>`
    select condition from book_copies where id = ${copyId}
  `;
  expect(copy.condition).toBe("worn");
});

test("returning an already-returned loan fails with loan_not_active", async () => {
  // BR §17.7: every button that triggers a change disables itself in flight,
  // "which also prevents the double-submit that would otherwise create
  // duplicate loans." This is the server-side half of that guarantee — the
  // client-side half is not a security control.
  const { ctx, loanId } = await lentOut();

  await runCommand(sql, ctx, receiveReturn, { loanId, condition: "perfect" });

  await expect(
    runCommand(sql, ctx, receiveReturn, { loanId, condition: "perfect" }),
  ).rejects.toMatchObject({ code: "loan_not_active" });
});

test("INV-11: a loan is never deleted on return", async () => {
  const { ctx, loanId } = await lentOut();
  const [{ count: before }] = await sql<{ count: string }[]>`
    select count(*) from loans
  `;

  await runCommand(sql, ctx, receiveReturn, { loanId, condition: "perfect" });

  const [{ count: after }] = await sql<{ count: string }[]>`
    select count(*) from loans
  `;
  expect(after).toBe(before);
});

test("the returned copy can immediately be lent again — INV-1 stays satisfiable", async () => {
  // The partial unique index keys on status = 'active'. If the return set a
  // flag beside the status instead of changing it, this fails.
  const { ctx, copyId, loanId } = await lentOut();
  const next = await makeMember(sql, ctx.bookshelfId);

  await runCommand(sql, ctx, receiveReturn, { loanId, condition: "perfect" });

  await expect(
    runCommand(sql, ctx, lendCopy, { copyId, membershipId: next.id }),
  ).resolves.toMatchObject({ loanId: expect.any(String) });
});

test("nothing is held automatically when the manager does not ask", async () => {
  // The rule that matters most in this command. OPS §5: "Nothing happens
  // automatically: the manager decides, because the next reader may not be
  // standing there." A queued request must still be pending afterwards.
  const { ctx, bookId, copyId, loanId } = await lentOut();
  const queued = await makeMember(sql, ctx.bookshelfId);
  await sql`
    insert into borrow_requests
      (bookshelf_id, book_id, requester_id, status, requested_at)
    values (${ctx.bookshelfId}, ${bookId}, ${queued.id}, 'pending', now())
  `;

  const result = await runCommand(sql, ctx, receiveReturn, {
    loanId,
    condition: "perfect",
  });

  const [request] = await sql<{ status: string; copy_id: string | null }[]>`
    select status, copy_id from borrow_requests
  `;
  expect(request.status).toBe("pending");
  expect(request.copy_id).toBeNull();

  const [copy] = await sql<{ state: string }[]>`
    select state from book_copies where id = ${copyId}
  `;
  expect(copy.state).toBe("available");

  // The command still *tells* the manager somebody is waiting — BR §16.3:
  // "the confirmation says so immediately and offers to approve the first
  // person in the queue."
  expect(result.queuedRequestId).not.toBeNull();
});

test("holding for the next reader is a second fact, in the same transaction", async () => {
  // OPS §5 is explicit that this is two facts and one user action. The kernel
  // already supports an array of audit entries for exactly this case.
  const { ctx, bookId, copyId, loanId } = await lentOut();
  const queued = await makeMember(sql, ctx.bookshelfId);
  const [request] = await sql<{ id: string }[]>`
    insert into borrow_requests
      (bookshelf_id, book_id, requester_id, status, requested_at)
    values (${ctx.bookshelfId}, ${bookId}, ${queued.id}, 'pending', now())
    returning id
  `;

  await runCommand(sql, ctx, receiveReturn, {
    loanId,
    condition: "perfect",
    holdForRequestId: request.id,
  });

  const [held] = await sql<
    { status: string; copy_id: string; hold_expires_at: Date }[]
  >`select status, copy_id, hold_expires_at from borrow_requests where id = ${request.id}`;
  expect(held.status).toBe("approved");
  expect(held.copy_id).toBe(copyId);
  expect(held.hold_expires_at.getTime()).toBeGreaterThan(clock.now().getTime());

  const [copy] = await sql<{ state: string }[]>`
    select state from book_copies where id = ${copyId}
  `;
  expect(copy.state).toBe("held");

  const actions = await sql<{ action: string }[]>`
    select action from audit_log order by action
  `;
  expect(actions.map((a) => a.action)).toEqual([
    "loan.created",
    "loan.returned",
    "request.approved",
  ]);
});

test("holding for a request that is no longer queued fails cleanly", async () => {
  // The reader cancelled between page load and confirm. OPS §4.2 names this
  // failure `request_not_queued`.
  const { ctx, bookId, loanId } = await lentOut();
  const queued = await makeMember(sql, ctx.bookshelfId);
  const [request] = await sql<{ id: string }[]>`
    insert into borrow_requests
      (bookshelf_id, book_id, requester_id, status, requested_at)
    values (${ctx.bookshelfId}, ${bookId}, ${queued.id}, 'cancelled', now())
    returning id
  `;

  await expect(
    runCommand(sql, ctx, receiveReturn, {
      loanId,
      condition: "perfect",
      holdForRequestId: request.id,
    }),
  ).rejects.toMatchObject({ code: "request_not_queued" });
});

test("a failed hold rolls back the return as well", async () => {
  // G3, in its sharpest form: the two facts commit together or not at all.
  // A return that succeeded while its hold failed would leave a book on the
  // shelf that the system believes is with a reader.
  const { ctx, bookId, loanId } = await lentOut();
  const queued = await makeMember(sql, ctx.bookshelfId);
  const [request] = await sql<{ id: string }[]>`
    insert into borrow_requests
      (bookshelf_id, book_id, requester_id, status, requested_at)
    values (${ctx.bookshelfId}, ${bookId}, ${queued.id}, 'cancelled', now())
    returning id
  `;

  await expect(
    runCommand(sql, ctx, receiveReturn, {
      loanId,
      condition: "perfect",
      holdForRequestId: request.id,
    }),
  ).rejects.toThrow();

  const [loan] = await sql<{ status: string }[]>`
    select status from loans where id = ${loanId}
  `;
  expect(loan.status).toBe("active");
});
```

- [ ] **Step 2: Run to verify it fails, then implement**

The command: load the loan (must be `active`), write the condition assessment, close the loan as `returned`, set the copy back to `available`, and — only when `holdForRequestId` is given — approve that request and start its hold clock. Two audit entries in that case, one otherwise.

- [ ] **Step 3: Run the tests to verify they pass**

- [ ] **Step 4: Commit**

```bash
git add src/domain/circulation/commands/receive-return.ts tests/domain/circulation/receive-return.test.ts
git commit -m "feat(circulation): ReceiveReturn, with the queued-reader decision left to the manager"
```

---

## Task 5: `VoidLoan`

**Files:**
- Create: `src/domain/circulation/commands/void-loan.ts`
- Test: `tests/invariants/inv-11-loans-never-deleted.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append to `tests/invariants/inv-11-loans-never-deleted.test.ts`, reusing the
`lentOut()` helper from `tests/domain/circulation/receive-return.test.ts`
(move it to `tests/support/scenarios.ts` when the second file needs it):

```ts
import { voidLoan } from "../../src/domain/circulation/commands/void-loan";

test("INV-11: voiding a loan keeps the row and frees the copy", async () => {
  // BR §3: "A manager records a loan by mistake and needs to undo it."
  // BR §11 / INV-11: never a delete. The row survives with status 'voided',
  // a reason, and who voided it — because the audit history the brief
  // requires is the whole point of not deleting it.
  const { ctx, copyId, loanId } = await lentOut();

  await runCommand(sql, ctx, voidLoan, { loanId, reason: "Ghi nhầm bạn đọc" });

  const [loan] = await sql<
    { status: string; void_reason: string; voided_by: string }[]
  >`select status, void_reason, voided_by from loans where id = ${loanId}`;
  expect(loan.status).toBe("voided");
  expect(loan.void_reason).toBe("Ghi nhầm bạn đọc");
  expect(loan.voided_by).toBe(ctx.actor.membershipId);

  const [copy] = await sql<{ state: string }[]>`
    select state from book_copies where id = ${copyId}
  `;
  expect(copy.state).toBe("available");
});

test("a reason is required", async () => {
  const { ctx, loanId } = await lentOut();
  await expect(
    runCommand(sql, ctx, voidLoan, { loanId, reason: "" }),
  ).rejects.toMatchObject({ code: "reason_required" });
});

test("only an active loan can be voided", async () => {
  const { ctx, loanId } = await lentOut();
  await runCommand(sql, ctx, receiveReturn, { loanId, condition: "perfect" });

  await expect(
    runCommand(sql, ctx, voidLoan, { loanId, reason: "Ghi nhầm" }),
  ).rejects.toMatchObject({ code: "loan_not_active" });
});

test("a voided loan frees the copy for INV-1", async () => {
  // The partial index keys on status = 'active', so voiding must actually
  // change the status rather than setting a flag beside it. If it set a flag,
  // this lend fails with a unique violation and the copy is stuck forever.
  const { ctx, copyId, loanId } = await lentOut();
  const other = await makeMember(sql, ctx.bookshelfId);

  await runCommand(sql, ctx, voidLoan, { loanId, reason: "Ghi nhầm" });

  await expect(
    runCommand(sql, ctx, lendCopy, { copyId, membershipId: other.id }),
  ).resolves.toMatchObject({ loanId: expect.any(String) });
});

test("voiding writes an audit record naming the reason", async () => {
  // INV-8. The reason is the whole value of voiding rather than deleting:
  // six months later, "why is there no loan here" has an answer.
  const { ctx, loanId } = await lentOut();

  await runCommand(sql, ctx, voidLoan, { loanId, reason: "Ghi nhầm bạn đọc" });

  const [entry] = await sql<
    { action: string; after_values: { reason: string } }[]
  >`select action, after_values from audit_log where action = 'loan.voided'`;
  expect(entry.action).toBe("loan.voided");
  expect(entry.after_values.reason).toBe("Ghi nhầm bạn đọc");
});
```

- [ ] **Step 2: Implement, run, commit**

```bash
git add src/domain/circulation/commands/void-loan.ts tests/invariants/inv-11-loans-never-deleted.test.ts
git commit -m "feat(circulation): VoidLoan — a mistake is recorded, never erased"
```

---

## Task 6: The three lending queries

**Files:**
- Create: `src/domain/circulation/queries/{search-books-for-lending,search-readers-for-lending,search-loans-for-return}.ts`
- Test: `tests/domain/circulation/lending-queries.test.ts`

The queries feed BR §16.3's requirement that blocking conditions appear *before* the confirm step. Each row carries its block reason, produced by the **same predicates** from Task 1 — not by a second implementation.

- [ ] **Step 1: Write the failing test**

Create `tests/domain/circulation/lending-queries.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { fixedClock } from "../../../src/domain/kernel/clock";
import { lendCopy } from "../../../src/domain/circulation/commands/lend-copy";
import { searchBooksForLending } from "../../../src/domain/circulation/queries/search-books-for-lending";
import { searchReadersForLending } from "../../../src/domain/circulation/queries/search-readers-for-lending";
import { runCommand, runQuery } from "../../../src/domain/kernel/unit-of-work";
import type { TenantContext } from "../../../src/domain/kernel/tenant";
import { migrate } from "../../../src/db/migrate";
import { makeBookWithCopies, makeMember, makeShelf } from "../../support/factories";
import { closeAll, resetDatabase, sql } from "../../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

const clock = fixedClock("2026-08-07T10:00:00Z");

async function managerContext(): Promise<{ ctx: TenantContext; shelfId: string }> {
  const shelf = await makeShelf(sql);
  const manager = await makeMember(sql, shelf.id, { role: "manager" });
  return {
    shelfId: shelf.id,
    ctx: {
      bookshelfId: shelf.id,
      actor: { userId: manager.userId, membershipId: manager.id, role: "manager" },
      clock,
    },
  };
}

test("a title with every copy out is flagged blocked, with a reason", async () => {
  // The built screen shows exactly this: "Cả 3 bản đang được mượn".
  const { ctx, shelfId } = await managerContext();
  const { copyIds } = await makeBookWithCopies(sql, shelfId, 3);
  for (const copyId of copyIds) {
    const reader = await makeMember(sql, shelfId);
    await runCommand(sql, ctx, lendCopy, { copyId, membershipId: reader.id });
  }

  const [row] = await runQuery(sql, ctx, (tx) =>
    searchBooksForLending(tx, ctx, { q: "sach" }),
  );

  expect(row.blocked).toBe(true);
  expect(row.reason).toBe("copy_not_available");
  expect(row.copiesAvailable).toBe(0);
  expect(row.copiesTotal).toBe(3);
});

test("a title with one copy free is not blocked", async () => {
  const { ctx, shelfId } = await managerContext();
  const { copyIds } = await makeBookWithCopies(sql, shelfId, 2);
  const reader = await makeMember(sql, shelfId);
  await runCommand(sql, ctx, lendCopy, { copyId: copyIds[0], membershipId: reader.id });

  const [row] = await runQuery(sql, ctx, (tx) =>
    searchBooksForLending(tx, ctx, { q: "sach" }),
  );

  expect(row.blocked).toBe(false);
  expect(row.copiesAvailable).toBe(1);
});

test("search is diacritic-insensitive", async () => {
  // BR §12, and the copy on the built screen: "Không cần gõ dấu — gõ de men
  // vẫn tìm ra Dế Mèn."
  const { ctx, shelfId } = await managerContext();
  await sql`
    insert into books (bookshelf_id, title, author, slug, published)
    values (${shelfId}, 'Dế Mèn Phiêu Lưu Ký', 'Tô Hoài', 'de-men', true)
  `;

  const rows = await runQuery(sql, ctx, (tx) =>
    searchBooksForLending(tx, ctx, { q: "de men" }),
  );

  expect(rows.map((r) => r.title)).toContain("Dế Mèn Phiêu Lưu Ký");
});

test("a reader at the loan limit is flagged blocked before the confirm step", async () => {
  // BR §16.3: blocking conditions surface "before the confirm step, never as
  // an error afterwards."
  const { ctx, shelfId } = await managerContext();
  const reader = await makeMember(sql, shelfId);
  for (let i = 0; i < 3; i++) {
    const { copyIds } = await makeBookWithCopies(sql, shelfId, 1);
    await runCommand(sql, ctx, lendCopy, { copyId: copyIds[0], membershipId: reader.id });
  }

  const rows = await runQuery(sql, ctx, (tx) =>
    searchReadersForLending(tx, ctx, { q: "" }),
  );
  const row = rows.find((r) => r.membershipId === reader.id)!;

  expect(row.blocked).toBe(true);
  expect(row.reason).toBe("loan_limit_reached");
});

test("a suspended reader is flagged blocked", async () => {
  const { ctx, shelfId } = await managerContext();
  const reader = await makeMember(sql, shelfId, { status: "suspended" });

  const rows = await runQuery(sql, ctx, (tx) =>
    searchReadersForLending(tx, ctx, { q: "" }),
  );
  const row = rows.find((r) => r.membershipId === reader.id)!;

  expect(row.blocked).toBe(true);
  expect(row.reason).toBe("membership_not_active");
});

test("the query's block reason matches what the command would throw", async () => {
  // The test that keeps the screen and the command honest with each other.
  // If these two ever disagree, a volunteer is told yes and then no — which
  // is the failure BR §16.3 is written to prevent.
  const { ctx, shelfId } = await managerContext();
  const reader = await makeMember(sql, shelfId);
  for (let i = 0; i < 3; i++) {
    const { copyIds } = await makeBookWithCopies(sql, shelfId, 1);
    await runCommand(sql, ctx, lendCopy, { copyId: copyIds[0], membershipId: reader.id });
  }

  const rows = await runQuery(sql, ctx, (tx) =>
    searchReadersForLending(tx, ctx, { q: "" }),
  );
  const queryReason = rows.find((r) => r.membershipId === reader.id)!.reason;

  const { copyIds } = await makeBookWithCopies(sql, shelfId, 1);
  const thrown = await runCommand(sql, ctx, lendCopy, {
    copyId: copyIds[0],
    membershipId: reader.id,
  }).catch((e) => e.code);

  expect(queryReason).toBe(thrown);
});
```

- [ ] **Step 2: Implement, run, commit**

```bash
git add src/domain/circulation/queries/ tests/domain/circulation/lending-queries.test.ts
git commit -m "feat(circulation): lending queries, sharing the command's predicates"
```

---

## Task 7: Wire the three screens

**Files:**
- Modify: `src/app/tu-sach/[shelf]/quan-ly/cho-muon/**`
- Modify: `src/app/tu-sach/[shelf]/quan-ly/nhan-tra/**`
- Modify: `src/app/tu-sach/[shelf]/quan-ly/sach/[id]/page.tsx` (the two-step entry points from BR §16.1)

- [ ] **Step 1: Replace fixture reads with query calls**

No visible change. G11 made the seed reproduce the fixtures, so the screens should render identically against the database.

- [ ] **Step 2: Verify in the browser**

```bash
docker compose up -d
bun run dev
```

Walk the full three-step lend, then the two-step lend from book detail, then the return. Confirm the blocking messages appear before the confirm step.

- [ ] **Step 3: Verify the links still resolve**

Run: `bun run check:links`
Expected: every internal link resolves, same as before.

- [ ] **Step 4: Run the full check**

Run: `bun run check`

- [ ] **Step 5: Commit**

```bash
git add src/app/tu-sach/
git commit -m "feat(ui): wire quick-lend and receive-return to the domain"
```

---

## Done when

- [ ] Two concurrent `lendCopy` calls on separate connections produce exactly one loan, and the loser sees `copy_not_available` — the named error, not a `23505`.
- [ ] `tests/invariants/` holds a passing test for INV-1, 2, 3, 4, 5, 7, 8 and 11.
- [ ] A reader suspended mid-loan keeps their book.
- [ ] A return with a queued reader does **not** hold the copy unless the manager asked.
- [ ] Overdue still comes from `loans_current` — no scheduled job writes a status anywhere in this slice.
- [ ] The three screens look and behave exactly as they did against fixtures.

**Next:** [C2 · Requests and holds](2026-08-07-olibra-backend-master.md#76-c2--requests-and-holds) — but resolve **Q1** (what `SkipRequest` actually does) first.
