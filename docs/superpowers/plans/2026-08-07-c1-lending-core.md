# C1 · Lending Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `LendCopy`, `ReceiveReturn` and `VoidLoan` — the three commands the whole product exists for — enforcing INV-1 through INV-5, INV-7, INV-8 and INV-11.

**Architecture:** Blocking conditions are pure predicates in `policy.ts`, testable with no database at all; the commands compose them inside a `runCommand` transaction. INV-1's race is left to the partial unique index and the loser's `23505` is translated, rather than being pre-checked and hoped about.

**Reconciled against what shipped (fix-report, 2026-08-07-s2-domain-kernel):** `runCommand` is treated as a black box throughout this plan — the ~15 call sites below pass it a command function and never reproduce its internals — so nothing here needed to change when that kernel was hardened after this plan was first written. Two things are still worth knowing before writing a command against it: (1) `runCommand` now switches the transaction into `olibra_app` before running the command body, not only setting the RLS session variable — the earlier version did not, and its own first test failed live; see the S2 fix report for the reproduction. (2) `unit-of-work.ts` now also exports `assertWritten`, for the one case `runCommand` cannot make structural on its own — a `update`/`delete` targeting a row belonging to another shelf silently affects zero rows rather than erroring, because RLS's `using` clause filters rather than raises on those statements (only `insert`'s `with check` raises). `lendCopy`'s own `update book_copies set state = 'on_loan' where id = ${copy.id}` (Task 3, below) is annotated with why it does not need this — `copy` is already shelf-scoped by a prior select in the same transaction — but any future command that writes by id without such a select first must wrap the write in `assertWritten`. **Superseded in part — see § Reconciliation, below:** `unit-of-work.ts` has since gained the `Tx` wrapper (`guardWrites`), which makes the zero-row `UPDATE`/`DELETE` case structural for *every* command by default; `assertWritten` is now the opt-in for a command that wants its own `ErrorCode` or a count other than one, not the thing standing between this slice and a silent write.

**Tech Stack:** TypeScript · PostgreSQL · Vitest.

**Blocked by:** S3, B1 (catalogue), B2 (members). A loan needs a copy and a member — both, not either. **All three have shipped** (`main` at `ad5a49e`), along with B5 and `feat/sql-clock`; nothing in this slice is blocked. What that shipping changed is in § Reconciliation, immediately after "Why this slice deserves the most careful reviewer" — read it before Task 1, because several task bodies were wrong about the schema and are now corrected.

## Global Constraints

Inherited from [the master plan](2026-08-07-olibra-backend-master.md#global-constraints). Load-bearing here: **G3** (change plus audit, one transaction), **G5** (overdue derived, never written), **G6** (`due_on` is a date in `Asia/Ho_Chi_Minh`), **G8** (named errors), **G10** (loans never deleted), **G12** (named test per invariant).

---

## Why this slice deserves the most careful reviewer

BR §1.3 says the dominant real-world interaction is a volunteer holding a phone next to a book. BR §16.3 calls quick-lend "the most important screen in the application". Seven of the fourteen invariants land here at once, and one of them — INV-1 — is the only rule in the system where a bug produces silent data corruption rather than an error message.

The design decision that carries the most weight is in Task 3: **the command does not pre-check whether the copy is free.** It attempts the insert and translates the failure. A pre-check reads as more careful and is strictly worse, because it re-opens the race window it appears to close.

---

## Reconciliation against shipped code

This plan was written before B1 (catalogue), B2a (members), B5 (object storage)
and `feat/sql-clock` shipped. Checked line by line against `main` at `ad5a49e`;
every row below was verified by reading the file named, not by inference. The
task bodies further down have been corrected in place — this table is the
*record* of what changed, not a substitute for reading the tasks.

| The plan says | The code says | Consequence |
|---|---|---|
| Task 3 writes `borrower_id = ${input.membershipId}` and `lent_by = ${ctx.actor.membershipId}` | `0005_circulation.sql:20,23` — both columns are `references users(id)`, and `20260808_04_composite_tenant_fks.sql:42` deliberately leaves every `users(id)` FK alone because `users` is global | A membership id in either column is a `23503` on the very first lend. Both are **user** ids. Task 3 corrected; `makeMember` already returns `{ id, userId }` for exactly this. |
| Task 3's `held_for` subquery reads `borrow_requests.requester_id`; Task 4's fixtures insert the same column | `0005_circulation.sql:63` — the column is `member_id`, and it too references `users(id)` | Every one of those statements fails on a column that does not exist. Renaming it is not enough: it holds a *user* id, so comparing it to `input.membershipId` never matches and "a held copy is lendable to its holder" degrades silently into "a held copy is never lendable" — INV-3's most interesting case, passing its unit test and failing in the shelf. Corrected in Tasks 3 and 4. |
| Task 3 counts INV-5 with `where l.borrower_id = m.id` | same column, same mismatch; the shipped `members/queries/search-readers-for-lending.ts:67` already joins `l.borrower_id = u.id` | The count would be `0` for every reader and INV-5 would never fire — with Task 2's INV-5 test passing only because a *different* bug (the FK violation above) rejects the lend first. Corrected. |
| Task 5 asserts `select action, after_values from audit_log` | `0007_audit_notifications.sql:29-30` — the columns are `before` and `after` | Test fails on a missing column. Corrected. |
| Task 6's fixture inserts `into books (…, slug, published)` | `0004_catalogue.sql:44` — `is_published` | Same failure. Corrected (that test is dropped for other reasons — see below). |
| Task 6 creates `src/domain/circulation/queries/search-books-for-lending.ts` | already shipped, at `catalogue/queries/search-books-for-lending.ts:27`, with the `blocked`/`reason` shape and the `copy_not_available` code the plan wants | Creating a second one forks the block reason into two implementations — precisely the drift Task 6's own preamble forbids. Task 6 rewritten. |
| Task 6 creates `…/search-readers-for-lending.ts` | shipped at `members/queries/search-readers-for-lending.ts:35`. Signature is `{ q: string; maxConcurrentLoans: number }` — the limit is passed *in*, not read from `settings` — it returns `block: Block`, **not** flat `blocked`/`reason`, and it returns `[]` for a blank `q` (`:42`) | All four of the plan's reader assertions are written against a shape that does not exist, and two of them pass `{ q: "" }`, which returns nothing. Task 6 rewritten. |
| Task 1's `memberMayBorrow` reimplements `status !== "active"` | `members/policy.ts:116-119` ships `membershipAllowsNewLoan`, whose docstring names this slice: "C1's `memberMayBorrow` composes the two; it does not restate this one, because two copies of a status list are two things that can disagree" | B2a shipped a defect in this exact shape — a hand-maintained status list drifted from the transition graph beside it and a suspended reader could clear their own suspension. Task 1 corrected to delegate. |
| Task 1 declares `CopyState` and `MembershipStatus` in `circulation/policy.ts` | `catalogue/policy.ts:14` and `members/policy.ts:14` already export both, spelled as the enums spell them | Two more lists free to drift from the enums. Task 1 corrected to import. |
| Task 2 creates `tests/invariants/inv-04-suspended-cannot-borrow.test.ts` | **B2a already created it.** Its closing comment (`:69-74`) reserves the third property for C1 by name and asks C1 to extend this file rather than start a second | Creating it overwrites two shipped tests. Task 2 corrected to append one case. |
| Task 2's "suspending a member does not disturb their existing loan" | already the second test in that file (`inv-04-…:32`), and it goes further — it also asserts the loan is still visible through `loans_current` | Duplicate. Dropped from Task 2. |
| — (the plan does not mention INV-7 at all beyond Task 1's predicate) | `inv-07-lost-or-retired-not-lendable.test.ts:33-41` says plainly: "**Deferred to C1** … C1 must add that case to this same file when `LendCopy` lands, not assume the first two halves are enough on their own" | A named obligation the plan silently drops. Added as a step in Task 2. |
| Task 6 proposes six query tests | five already exist: `catalogue/manager-queries.test.ts:198,216,231,244` and `members/manager-queries.test.ts:299,331` | Only "the query's block reason matches what the command would throw" is new — and it is the one that matters, because it is the only one that can exist before `lendCopy` does not. Task 6 rebuilt around it. |
| `loan_not_active` for both `ReceiveReturn` and `VoidLoan` | `OPERATIONS.md:256` gives it "Lượt mượn này đã được xử lý."; `OPERATIONS.md:282` gives the *same code* "Chỉ có thể huỷ lượt mượn đang diễn ra." `errors.ts:60` ships only the first | The same one-code-two-sentences collision B2a found in OPS §4.3 and B1 found in §4.1. C1 adds a second code. Task 5 corrected. |
| Task 7: "Replace fixture reads with query calls. No visible change." | **No route under `src/app/` calls `runQuery` or `runCommand`.** Grepped the whole tree: `src/app/dang-nhap/actions.ts` is the only file that reaches the database at all, and it does so through `signIn`, not the kernel. Every manager page still imports `@/lib/fixtures` | C1's Task 7 would be the first page in this project to read from the database — establishing the `connect`/`contextFor`/`runQuery` pattern for everyone after it. That is a slice, not a step. Task 7 rescoped, and the risk stated there rather than discovered mid-task. |

Verified as **still correct**, and listed so the next reader knows these were
checked rather than skipped:

- **INV-1's mechanism.** `loans_one_active_per_copy` — `unique (copy_id) where status = 'active'` — is exactly as described (`0009_invariant_constraints.sql:21-23`), and `isUniqueViolation` (`errors.ts:167`) still tests `23505`. Task 3's whole argument holds unchanged.
- **`lent_at` and the `feat/sql-clock` constraint.** `loans.lent_at timestamptz not null default now()` is still there (`0005_circulation.sql:24`), so the temptation the recorded constraint refuses is still live, and Task 3's explicit `${ctx.clock.now()}` is still the thing that must not be simplified away. Nothing about that section needed changing.
- **The kernel API.** `runCommand` (`unit-of-work.ts:462`), `runQuery` (`:527`), `runGlobalCommand` (`:488`), `assertWritten` (`:323`), `Command` (`:344`), `Tx` and `allowZero()` (`:198-216`) all match the plan's usage. `assertValidClockInstant` (`:104`) was added ahead of `sql.begin` and moves nothing this plan calls.
- **`TenantContext`** is still `{ bookshelfId, actor: { userId, membershipId, role }, clock }` (`tenant.ts:19-39`), so every `managerContext` helper in this plan is correctly shaped.
- **`AuditEntry`** still accepts an array from a command (`unit-of-work.ts:348`), and `toRow` still stamps `actorId: ctx.actor.userId` and `occurredAt: ctx.clock.now()` (`audit.ts:185-194`) — Task 4's two-entries-one-transaction design is supported as written.
- **`Block`** lives at `kernel/block.ts:12`, exactly the shape Task 1 imports. The note explaining why is accurate.
- **`dueDateFor`'s two boundary cases.** Recomputed against the shipped `fixedClock`/`todayIn` (`clock.ts:32-48`): 23:30Z on the 7th is 06:30 on the 8th in Ho Chi Minh City, so `2026-08-22` is right, and 10:00Z is still the 7th, so `2026-08-21` is right.
- **The factories.** `makeShelf`, `makeMember`, `makeBookWithCopies` and `withTwoConnections` all exist with the shapes this plan assumes (`tests/support/factories.ts:12,34,59`; `tests/support/db.ts:24`). `makeShelf` leaves `settings` as `{}`, so Task 3's `coalesce(…, 3)` and `coalesce(…, 14)` defaults are what the tests will actually exercise — matching BR §5.5's table (`loan_days` 14, `max_concurrent_loans` 3, `hold_days` 3).
- **Every other `ErrorCode` this slice throws already exists**: `copy_not_available`, `copy_lost_or_retired`, `membership_not_active`, `loan_limit_reached`, `loan_not_active`, `reason_required`, `request_not_queued` (`errors.ts:56-67`), plus `copy_not_found` (`:32`) and `membership_not_found` (`:73`). `reason_required`'s sentence — "Vui lòng ghi lý do huỷ." — is VoidLoan's own from OPS §4.2; the four OPS sites that say "lý do từ chối" were already split off into `reject_reason_required` (`:100`) by B2a, so there is no second collision hiding there.
- **`copyStateTransition`** (`catalogue/policy.ts:88`) allows `available → on_loan` and `held → on_loan` and refuses both `lost`/`retired → on_loan`, which is INV-3/INV-7 from the *transition* side. `copyLendable` is not a duplicate of it: it answers a question the transition table cannot, which is *whose* hold a held copy is under. Task 1 keeps it and now says so.
- **The route files Task 7 names** all exist, along with three the plan does not name.

**Nothing in this slice is blocked.** B1, B2a and B5 have all landed, `Block`
and `membershipAllowsNewLoan` are on disk, and every dependency this plan
declares is satisfiable today. The one thing that is *larger* than the plan
believed is Task 7, for the reason in the last table row.

---

## Task 1: Blocking conditions as pure predicates

BR §16.3: "Blocking conditions surface as a clear message *before* the confirm step, never as an error afterwards." The same predicates must answer both the "can I?" question on the screen and the "may I?" question in the command, or the two will disagree and a volunteer will be told yes and then no.

**`Block` already exists — import it, do not redefine it.** The parish-taxonomy module needed this same "can I?" shape before this slice was written (`src/domain/members/parish-taxonomy.ts`'s `validateSelection` already returns it), so it was pulled out to `src/domain/kernel/block.ts` rather than being defined inside a lending-specific file — the members domain has no business depending on circulation, so the shape had to live somewhere neither owns. `policy.ts` below imports it from there; it does not declare its own copy.

**`memberMayBorrow` delegates INV-4; it does not restate it.** `membershipAllowsNewLoan` shipped in B2a (`src/domain/members/policy.ts:116`) and its docstring names this function: "C1's `memberMayBorrow` composes the two; it does not restate this one, because two copies of a status list are two things that can disagree." That is not a stylistic preference — B2a shipped a defect in exactly this shape, where a hand-maintained status list drifted from the transition graph sitting a few lines above it and a suspended reader could clear their own suspension. `memberMayBorrow` is the *composition* of INV-4 (borrowed) and INV-5 (its own), and INV-4's status list appears once in this codebase.

**The two state unions are imported, not declared.** `CopyState` is exported from `src/domain/catalogue/policy.ts:14` and `MembershipStatus` from `src/domain/members/policy.ts:14`, both already spelled exactly as the Postgres enums spell them. A third and fourth copy here would be two more things free to drift from `copy_state` and `membership_status`.

**`copyLendable` is not a second `copyStateTransition`.** `src/domain/catalogue/policy.ts:88` already refuses `lost|retired → on_loan` and permits `available|held → on_loan`, and INV-7's shipped test leans on it. What that table structurally cannot answer is *whose* hold a `held` copy is under — the one question that distinguishes `LendCopy` from `HandoverRequest`, and the reason this predicate exists.

**Files:**
- Create: `src/domain/circulation/policy.ts`
- Test: `tests/domain/circulation/policy.test.ts`

**Interfaces:**
- Consumes: `Block` from `../kernel/block` (already exists — see note above); `membershipAllowsNewLoan` and `MembershipStatus` from `../members/policy`; `CopyState` from `../catalogue/policy`; `Clock` from `../kernel/clock`.
- Produces:
  ```ts
  function copyLendable(copy: { state: CopyState; heldForUserId: string | null }, forUserId: string): Block
  function memberMayBorrow(m: { status: MembershipStatus; activeLoans: number }, maxConcurrentLoans: number): Block
  function dueDateFor(clock: Clock, loanDays: number): string        // YYYY-MM-DD
  ```

  `heldForUserId`/`forUserId`, not `…MembershipId`. A hold's holder is read off `borrow_requests.member_id`, which references `users(id)` (`0005_circulation.sql:63`) — not memberships. Naming the parameter after the id it actually carries is what stops Task 3 comparing a membership id against a user id and getting a permanently-false answer.

- [ ] **Step 1: Write the failing test**

Create `tests/domain/circulation/policy.test.ts`:

```ts
import { expect, test } from "vitest";
import { fixedClock } from "../../../src/domain/kernel/clock";
import { membershipAllowsNewLoan } from "../../../src/domain/members/policy";
import {
  copyLendable,
  dueDateFor,
  memberMayBorrow,
} from "../../../src/domain/circulation/policy";

const HELD_BY_NOBODY = null;

test("INV-3: an available copy is lendable to anyone", () => {
  expect(
    copyLendable({ state: "available", heldForUserId: HELD_BY_NOBODY }, "u1"),
  ).toEqual({ blocked: false });
});

test("INV-3: a held copy is lendable only to its holder", () => {
  // The case that distinguishes LendCopy from HandoverRequest. Reader A holds
  // the hold; handing the book to reader B must fail even though B is a
  // perfectly good member. Ids here are *user* ids — borrow_requests.member_id
  // references users(id) (0005_circulation.sql:63).
  const held = { state: "held" as const, heldForUserId: "u1" };
  expect(copyLendable(held, "u1")).toEqual({ blocked: false });
  expect(copyLendable(held, "u2")).toEqual({
    blocked: true,
    reason: "copy_not_available",
  });
});

test("INV-3: a copy already on loan is not lendable", () => {
  expect(
    copyLendable({ state: "on_loan", heldForUserId: HELD_BY_NOBODY }, "u1"),
  ).toEqual({ blocked: true, reason: "copy_not_available" });
});

test("INV-7: a lost or retired copy is never lendable", () => {
  for (const state of ["lost", "retired"] as const) {
    expect(
      copyLendable({ state, heldForUserId: HELD_BY_NOBODY }, "u1"),
    ).toEqual({ blocked: true, reason: "copy_lost_or_retired" });
  }
});

test("INV-4: memberMayBorrow refuses whatever membershipAllowsNewLoan refuses", () => {
  // Not a second statement of INV-4's status list — that list lives in
  // members/policy.ts and inv-04-suspended-cannot-borrow.test.ts already pins
  // every status against it. What this pins is the *composition*: that
  // memberMayBorrow's status answer is byte-for-byte the delegate's, for every
  // status, so the two can never disagree about a reader at the shelf.
  for (const status of ["pending", "active", "suspended", "left", "rejected"] as const) {
    expect(memberMayBorrow({ status, activeLoans: 0 }, 3)).toEqual(
      membershipAllowsNewLoan({ status }),
    );
  }
});

test("INV-4 before INV-5: a suspended reader at the limit hears about the suspension", () => {
  // Both rules refuse; only one sentence is shown. "Tài khoản đang tạm khoá"
  // names something the volunteer can act on today; "đã mượn tối đa" would send
  // them to collect books that would not unblock anything.
  expect(memberMayBorrow({ status: "suspended", activeLoans: 5 }, 3)).toEqual({
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
import type { Block } from "../kernel/block";
// Imported, never redeclared: both unions already exist, spelled exactly as
// `copy_state` and `membership_status` spell them. A local copy is a fourth
// place the enums can drift away from.
import type { CopyState } from "../catalogue/policy";
import { membershipAllowsNewLoan, type MembershipStatus } from "../members/policy";

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
  copy: { state: CopyState; heldForUserId: string | null },
  forUserId: string,
): Block {
  if (copy.state === "lost" || copy.state === "retired") {
    return no("copy_lost_or_retired");
  }
  if (copy.state === "available") return OK;
  if (copy.state === "held" && copy.heldForUserId === forUserId) {
    // The hold is this reader's — collecting it is exactly the permitted
    // held → on_loan transition (BR §7.1). Both sides are `users.id`: a hold
    // is `borrow_requests.member_id`, which references users(id), not
    // memberships(id) (0005_circulation.sql:63).
    return OK;
  }
  return no("copy_not_available");
}

/**
 * INV-4 and INV-5, composed — INV-4 borrowed, INV-5 this function's own.
 *
 * The status half is `membershipAllowsNewLoan` (`../members/policy`), called
 * rather than restated. That function's own docstring asks for exactly this,
 * and B2a's fix report is why: a hand-maintained status list drifted from the
 * transition graph beside it and a suspended reader could clear their own
 * suspension. INV-4's list of statuses appears once in this codebase, in the
 * domain that owns memberships.
 *
 * INV-4 is checked first, deliberately. A suspended reader who is also at the
 * limit hears "Tài khoản đang tạm khoá" — something a volunteer can act on —
 * rather than being sent to collect books that would not unblock anything.
 *
 * INV-4 is also deliberately narrow: a non-active membership blocks a *new*
 * loan and leaves existing ones alone. A reader suspended while holding a book
 * keeps the book (BR §3).
 */
export function memberMayBorrow(
  member: { status: MembershipStatus; activeLoans: number },
  maxConcurrentLoans: number,
): Block {
  const standing = membershipAllowsNewLoan({ status: member.status });
  if (standing.blocked) return standing;
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

## Task 2: The invariant tests for INV-3, INV-4, INV-5 and INV-7

Written before `LendCopy` exists, against the command's signature. They will not compile yet; that is the point.

**Two of these four files already exist and must be extended, not created.** B2a and B1 each shipped an invariant test that stops exactly where C1 begins, and each says so in the file. Overwriting either loses shipped coverage:

- `tests/invariants/inv-04-suspended-cannot-borrow.test.ts` — B2a's. Holds two passing tests (`membershipAllowsNewLoan` over every status; a suspension leaving an existing loan and its `loans_current` row untouched) and closes with a comment reserving the third property for C1 by name: "C1's plan is to extend this same file with that case rather than create a second inv-04 test file."
- `tests/invariants/inv-07-lost-or-retired-not-lendable.test.ts` — B1's. Holds the predicate half and the `copies_borrowable` half, and states plainly: "**Deferred to C1** … C1 must add that case to this same file when `LendCopy` lands, not assume the first two halves are enough on their own." The original draft of this plan dropped that obligation entirely; Step 4 below reinstates it.

**Files:**
- Create: `tests/invariants/inv-03-only-available-or-own-hold.test.ts`
- Create: `tests/invariants/inv-05-loan-limit.test.ts`
- Extend: `tests/invariants/inv-04-suspended-cannot-borrow.test.ts` (append one test; delete nothing)
- Extend: `tests/invariants/inv-07-lost-or-retired-not-lendable.test.ts` (append one test; delete nothing)

- [ ] **Step 1: Append INV-4's third property to B2a's file**

Replace the closing "Deferred to C1" comment with the test it describes. The only new import is `lendCopy`; `fixedClock`, `TenantContext`, `runCommand`, `makeShelf`, `makeMember` and `makeBookWithCopies` are all already imported at the top of that file. The rest of it — the `beforeAll`/`beforeEach`/`afterAll` block, both existing tests — stays exactly as it is.

```ts
test("INV-4: lendCopy refuses a suspended member before writing anything", async () => {
  const shelf = await makeShelf(sql, { slug: "can-tho" });
  const manager = await makeMember(sql, shelf.id, { role: "manager" });
  const ctx: TenantContext = {
    bookshelfId: shelf.id,
    actor: { userId: manager.userId, membershipId: manager.id, role: "manager" },
    clock: fixedClock("2026-08-08T03:00:00Z"),
  };
  const { copyIds } = await makeBookWithCopies(sql, shelf.id, 1);
  const reader = await makeMember(sql, shelf.id, { status: "suspended" });

  await expect(
    runCommand(sql, ctx, lendCopy, { copyId: copyIds[0], membershipId: reader.id }),
  ).rejects.toMatchObject({ code: "membership_not_active" });

  // "Before any row is written" is the half a `rejects` alone does not prove.
  expect(await sql`select 1 from loans`).toHaveLength(0);
  const [copy] = await sql<{ state: string }[]>`
    select state from book_copies where id = ${copyIds[0]}
  `;
  expect(copy.state).toBe("available");
});
```

The "suspending a member does not disturb their existing loan" test the earlier draft of this plan proposed here is **dropped**: B2a already ships it, one test further up the same file, and its version is stronger — it also asserts the loan is still the live row `loans_current` returns.

For the two new files, the shared context helper:

```ts
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { fixedClock } from "../../src/domain/kernel/clock";
import type { TenantContext } from "../../src/domain/kernel/tenant";
import { lendCopy } from "../../src/domain/circulation/commands/lend-copy";
import { runCommand } from "../../src/domain/kernel/unit-of-work";
import { migrate } from "../../src/db/migrate";
import { makeBookWithCopies, makeMember, makeShelf } from "../support/factories";
import { closeAll, resetDatabase, sql } from "../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

const clock = fixedClock("2026-08-07T10:00:00Z");

async function managerContext(bookshelfId: string): Promise<TenantContext> {
  const manager = await makeMember(sql, bookshelfId, { role: "manager" });
  return {
    bookshelfId,
    actor: { userId: manager.userId, membershipId: manager.id, role: "manager" },
    clock,
  };
}
```

- [ ] **Step 2: Write INV-5's test**

`tests/invariants/inv-05-loan-limit.test.ts`, on the helper above.

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
  //
  // This is the test that catches the count being written as a bare
  // `where borrower_id = ...` outside a scoped transaction. `loans.borrower_id`
  // is a *user* id (0005_circulation.sql:20), and one user has one id across
  // every shelf — so the per-shelf part of INV-5 comes entirely from RLS
  // scoping the `loans` rows the count can see, not from anything in the
  // where clause. Two shelves, one person, is the only shape that proves it.
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

`tests/invariants/inv-03-only-available-or-own-hold.test.ts`, covering the three cases from Task 1's predicate, this time end to end: an available copy lends; a copy held for reader A refuses to lend to reader B; a copy already on loan refuses.

Setting up the "held" case means an `approved` `borrow_requests` row with a live `hold_expires_at`. Two things about that row, both verified against the schema rather than assumed:

- the holder column is **`member_id`**, not `requester_id`, and it references `users(id)` — so it takes `reader.userId`, not `reader.id` (`0005_circulation.sql:63`);
- `hold_expires_at` must be written from `ctx.clock`, not `now() + interval '3 days'`. `copies_borrowable` compares it against `olibra_now()` (`20260808_14_olibra_now.sql:124`), which under `runQuery`/`runCommand` is the *injected* clock. A hold written from the database clock and read against a `fixedClock` set in 2026 is being compared against a clock that did not produce it — the sharpest case in the constraint recorded from the `feat/sql-clock` review, below.

That second point is now testable rather than merely true, which is new since this plan was written: a `fixedClock` moved past `hold_expires_at` makes the copy reappear in `copies_borrowable` with no wall-clock waiting. Assert the expiry case as well as the live one.

- [ ] **Step 4: Append INV-7's third half to B1's file**

`tests/invariants/inv-07-lost-or-retired-not-lendable.test.ts:33-41` states the obligation and names the two halves it already proves. Add the third: a `lost` copy and a `retired` copy each refused by `lendCopy` itself with `copy_lost_or_retired` — not merely absent from `copies_borrowable`, which is what the shipped half proves. Delete nothing; replace the "Deferred to C1" paragraph in the file docstring with a sentence saying C1 landed it.

Reaching a `lost` copy needs `on_loan → lost` (`catalogue/policy.ts:46-60`), so the setup lends first and then calls `reportCopyLost` — which is what the file's existing second test already does, so the fixture is there to copy.

- [ ] **Step 5: Run them to verify they fail**

Run: `bun run test tests/invariants/inv-0{3,4,5,7}*`
Expected: FAIL — `Cannot find module '.../commands/lend-copy'` in all four. The two extended files fail to *load*, taking their shipped passing tests with them; that is expected and temporary, and is why Task 3 follows immediately.

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

**`loans` stores user ids, not membership ids, and this is where the plan was wrong.** `borrower_id`, `lent_by`, `received_by`, `voided_by` and `lost_reported_by` all `references users(id)` (`0005_circulation.sql:20,23,30,41,38`), and `20260808_04_composite_tenant_fks.sql:42` says so deliberately: "every foreign key that points at `users(id)` … because `users` is a global table, not a shelf-scoped one; there is no second shelf-scoped column to pair it with." Same for `borrow_requests.member_id` (`:63`). The shipped `search-readers-for-lending.ts:67` already joins `loans_current l on l.borrower_id = u.id`, so a `lendCopy` that wrote membership ids would produce loans that query cannot see — if it committed at all, which it would not: it fails `23503` on the first lend.

So the command's *input* is a `membershipId` (OPS §4.2 names it, and it is what the screen has), and the command resolves it to a `user_id` in the same select that reads the membership's status. The two are never interchangeable and the code below keeps them visibly apart.

**Where INV-5's per-shelf scoping actually comes from.** `count(*) from loans where borrower_id = ${member.user_id}` looks global and is not: `loans` is RLS-scoped (`0010_rls.sql:62`) and the command body runs as `olibra_app`, so the count sees only this shelf's loans. That is the whole of BR §5.5's "per bookshelf" — there is no `bookshelf_id` term to add, and adding one would be harmless but misleading about where the guarantee lives.

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
  // Both rows are read before either predicate runs, because `copyLendable`
  // needs this reader's *user* id to answer "is this hold theirs?" while OPS
  // §5 requires the copy-side refusals to be the ones a manager hears first.
  // Reading then judging keeps both: two selects, then two predicates in OPS's
  // order.
  const [copy] = await tx<
    {
      id: string;
      book_id: string;
      state: "available" | "held" | "on_loan" | "lost" | "retired";
      held_for_user: string | null;
    }[]
  >`
    select c.id, c.book_id, c.state,
           -- member_id, not requester_id (0005_circulation.sql:63), and it
           -- holds a users(id). Compared against olibra_now() rather than a
           -- bound ctx.clock.now() for the same reason copies_borrowable does
           -- (20260808_14_olibra_now.sql:124): one clock, set once per
           -- transaction, read by every statement in it.
           (select r.member_id
              from borrow_requests r
             where r.copy_id = c.id
               and r.status = 'approved'
               and r.deleted_at is null
               and r.hold_expires_at > olibra_now()
             limit 1) as held_for_user
      from book_copies c
     where c.id = ${input.copyId} and c.deleted_at is null
  `;
  if (!copy) throw new NotFound("copy_not_found");

  const [member] = await tx<
    { id: string; user_id: string; status: string; active_loans: string; max_loans: number }[]
  >`
    select m.id, m.user_id, m.status,
           -- borrower_id is a users(id) (0005_circulation.sql:20). Per-shelf
           -- (BR §5.5) comes from RLS scoping `loans`, not from a clause here.
           (select count(*) from loans l
             where l.borrower_id = m.user_id and l.status = 'active') as active_loans,
           coalesce((b.settings->>'max_concurrent_loans')::int, 3) as max_loans
      from memberships m
      join bookshelves b on b.id = m.bookshelf_id
     where m.id = ${input.membershipId} and m.deleted_at is null
  `;
  if (!member) throw new NotFound("membership_not_found");

  // OPS §5, steps 2 and 3, before steps 4 and 5 — and it says why: "a manager
  // who searched for a book that's already gone needs to know that
  // immediately, not after they've also picked a reader."
  const copyBlock = copyLendable(
    { state: copy.state, heldForUserId: copy.held_for_user },
    member.user_id,
  );
  if (copyBlock.blocked) throw new RuleViolated(copyBlock.reason);

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
          (${ctx.bookshelfId}, ${copy.id}, ${copy.book_id}, ${member.user_id},
           ${ctx.actor.userId}, ${ctx.clock.now()}, ${due}, 'active')
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

  // Domain-kernel fix report (2026-08-07-s2-domain-kernel, IMPORTANT 1):
  // RLS's `with check` raises on a cross-shelf insert, but its `using`
  // clause only *filters* rows on update — a blind `update ... where id =
  // ...` against a row belonging to another shelf affects zero rows rather
  // than erroring. Two things now stand between that and a silent success,
  // and it is worth knowing which is which:
  //
  //   1. `copy` was fetched by a shelf-scoped select earlier in this same
  //      transaction, so `copy.id` is already known to belong to
  //      `ctx.bookshelfId`. That is this command's own reasoning.
  //   2. Since the `Tx` wrapper shipped (`guardWrites`,
  //      `src/domain/kernel/unit-of-work.ts:290`), *every* UPDATE/DELETE a
  //      command runs through `tx` that affects zero rows throws
  //      `NotFound("write_target_not_found")` by default, whether or not the
  //      command reasoned about it. That is the kernel's, and it is the
  //      backstop, not the argument.
  //
  // So this line needs no `assertWritten` — and neither does any other
  // update in this slice. Reach for `assertWritten` (same module, `:323`)
  // only to swap the kernel's generic code for a *specific* one, or to
  // assert a count other than one; pair it with `.allowZero()` on the query
  // when you do.
  await tx`update book_copies set state = 'on_loan' where id = ${copy.id}`;

  return {
    result: { loanId: loanRow.id, dueOn },
    audit: {
      action: "loan.created",
      entityType: "loan",
      entityId: loanRow.id,
      before: { copy_state: copy.state },
      after: {
        copy_state: "on_loan",
        borrower_id: member.user_id,
        membership_id: member.id,
        due_on: dueOn,
      },
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
Expected: PASS — INV-3, INV-5 and the newly appended INV-4 and INV-7 cases green alongside the structural ones, and B2a's and B1's own tests in those two files still green.

- [ ] **Step 3: Extend INV-1's test to go through the command**

INV-1 already has a test at the SQL level from S1 — `tests/invariants/inv-01-one-active-loan-per-copy.test.ts`, three tests, all at raw-`sql` level (it asserts `rejects.toMatchObject({ code: "23505" })` directly). Add a second file, `tests/invariants/inv-01-lend-race.test.ts`, that runs two concurrent `runCommand(sql, ctx, lendCopy, …)` calls and asserts one resolves and the other rejects with `copy_not_available` — the named error, not a raw `23505`. That is the half the shipped file deliberately does not cover.

The harness exists: `withTwoConnections` (`tests/support/db.ts:24`), which the shipped INV-1 file already uses for exactly this shape.

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
- Consumes: `CopyCondition` (and `isCopyCondition`, if the caller's value is unvalidated) from `../../catalogue/policy` — B1 shipped both (`src/domain/catalogue/policy.ts:17-30`), spelled exactly as the `copy_condition` enum spells them. There is no type called `Condition`; the earlier draft of this signature invented one.
- Produces:
  ```ts
  const receiveReturn: Command<
    { loanId: string; condition: CopyCondition; note?: string; photo?: string; holdForRequestId?: string },
    { loanId: string; queuedRequestId: string | null }
  >
  ```

**Three schema facts this command is written against, all verified:**

- **`borrow_requests`'s holder column is `member_id`, referencing `users(id)`** (`0005_circulation.sql:63`) — not `requester_id`, and not a membership id. The fixtures below insert `queued.userId`.
- **`loans_returned_has_condition`** (`0005_circulation.sql:50`) — `check (status <> 'returned' or return_condition is not null)`. Closing the loan without writing `return_condition` in the same statement raises `23514`, so the two are one `update`, never two.
- **`condition_assessments` has no `updated_at`** and is deliberately excluded from the `set_updated_at` trigger loop (`20260808_06_updated_at_triggers.sql:14`). It also has no `deleted_at`: OPS §2 lists it among the tables never deleted.

**Every timestamp this command writes comes from `ctx.clock`** — `returned_at`, `assessed_at`, and above all `hold_expires_at`. See the constraint recorded from the `feat/sql-clock` review, at the foot of this plan; `hold_expires_at` is named there as the sharpest case, because `copies_borrowable` compares it against `olibra_now()` on every later read (`20260808_14_olibra_now.sql:124`). The column defaults stay; they are not what a command uses. `hold_expires_at` is `ctx.clock.now()` plus `coalesce((settings->>'hold_days')::int, 3)` days (BR §5.5's table).

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
      (bookshelf_id, book_id, member_id, status, requested_at)
    values (${ctx.bookshelfId}, ${bookId}, ${queued.userId}, 'pending', ${clock.now()})
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
      (bookshelf_id, book_id, member_id, status, requested_at)
    values (${ctx.bookshelfId}, ${bookId}, ${queued.userId}, 'pending', ${clock.now()})
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
      (bookshelf_id, book_id, member_id, status, requested_at)
    values (${ctx.bookshelfId}, ${bookId}, ${queued.userId}, 'cancelled', ${clock.now()})
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
      (bookshelf_id, book_id, member_id, status, requested_at)
    values (${ctx.bookshelfId}, ${bookId}, ${queued.userId}, 'cancelled', ${clock.now()})
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

The command: load the loan (must be `active`), write the condition assessment, close the loan as `returned` **with its `return_condition` in the same statement** (the check constraint above), set the copy's `state` back to `available` and its `condition` forward to the assessed one, and — only when `holdForRequestId` is given — approve that request and start its hold clock. Two audit entries in that case, one otherwise.

`received_by` and `condition_assessments.assessed_by` are both `references users(id)` (`0005_circulation.sql:30,91`), so both take `ctx.actor.userId`, not `ctx.actor.membershipId` — the same distinction Task 3 got wrong before this reconciliation.

`queuedRequestId` — what the command returns even when it holds nothing — is the earliest `pending` request for this `book_id`, ordered by `requested_at` (the column's own comment calls it "the queue ordering key"). That is the fact BR §16.3's confirmation screen renders; it is a read, and it changes nothing.

When `holdForRequestId` *is* given, the request must still be `pending` **and** belong to this loan's `book_id` — `request_not_queued` covers both, per OPS §4.2's wording ("no longer points at a pending request **for this title**"). The copy goes `available → held` in the same statement rather than being set `available` and then `held`: OPS §5 asks that "the copy is never observably `available` for an instant in between", and although the transaction makes that unobservable to another session anyway, one write is also one fewer state for a reviewer to reason about.

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
- Modify: `src/domain/kernel/errors.ts` (one new code — see below)
- Test: `tests/invariants/inv-11-loans-never-deleted.test.ts` (extend)

**This task adds the one `ErrorCode` C1 needs, and it is a collision, not a gap.** OPS uses `loan_not_active` for two different sentences:

| Where | Sentence |
|---|---|
| OPS §4.2, `ReceiveReturn` (`docs/OPERATIONS.md:256`) | "Lượt mượn này đã được xử lý." |
| OPS §4.2, `VoidLoan` (`docs/OPERATIONS.md:282`) | "Chỉ có thể huỷ lượt mượn đang diễn ra." |

`src/domain/kernel/errors.ts:60` ships only the first. This is the same shape B1 found in OPS §4.1 (`validation_failed` across three commands, split into `required_fields_missing` and `copy_count_invalid`) and B2a found in OPS §4.3 (split into `reject_reason_required`, `not_active_cannot_suspend`, `not_suspended_cannot_reactivate`). One code maps to one sentence, or `messageFor` becomes a lie. Add, beside the existing circulation block:

```ts
// C1. OPS §4.2 gives `loan_not_active` above one sentence under
// ReceiveReturn — "Lượt mượn này đã được xử lý.", the shipped wording —
// and a different one under VoidLoan. The two refusals are not the same
// refusal: returning a returned loan is a double-submit and nothing is
// wrong, while voiding a closed loan is a manager reaching for an undo
// that no longer applies. The sentence names what is allowed instead, per
// BR §17.7.
loan_not_active_cannot_void: "Chỉ có thể huỷ lượt mượn đang diễn ra.",
```

Everything else this slice throws already exists (`errors.ts:32,56-67,73`), `reason_required` included — its shipped sentence, "Vui lòng ghi lý do huỷ.", is VoidLoan's own from OPS §4.2, and the four OPS sites that say "lý do từ chối" were split off into `reject_reason_required` by B2a. There is no second collision here.

**`loans.voided_by` is a `users(id)`** (`0005_circulation.sql:41`), like every other actor column on the table. `ctx.actor.userId`.

- [ ] **Step 1: Write the failing test**

Append to `tests/invariants/inv-11-loans-never-deleted.test.ts` — which already ships two tests (the delete trigger, and that an `update` to `voided` is unaffected) and must keep them — reusing the
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
  expect(loan.voided_by).toBe(ctx.actor.userId); // users(id), not memberships(id)

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
  // `loan_not_active_cannot_void`, not `loan_not_active`. OPS §4.2 gives the
  // two commands different sentences for what looks like one code; this is
  // the assertion that keeps them apart. See the collision table above.
  const { ctx, loanId } = await lentOut();
  await runCommand(sql, ctx, receiveReturn, { loanId, condition: "perfect" });

  await expect(
    runCommand(sql, ctx, voidLoan, { loanId, reason: "Ghi nhầm" }),
  ).rejects.toMatchObject({ code: "loan_not_active_cannot_void" });
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
    { action: string; after: { reason: string } }[]
  >`select action, after from audit_log where action = 'loan.voided'`;
  expect(entry.action).toBe("loan.voided");
  expect(entry.after.reason).toBe("Ghi nhầm bạn đọc");
});
```

- [ ] **Step 2: Implement, run, commit**

```bash
git add src/domain/circulation/commands/void-loan.ts src/domain/kernel/errors.ts \
        tests/invariants/inv-11-loans-never-deleted.test.ts
git commit -m "feat(circulation): VoidLoan — a mistake is recorded, never erased

Adds loan_not_active_cannot_void. OPS §4.2 gives loan_not_active two
different Vietnamese sentences, one under ReceiveReturn and one under
VoidLoan; one code maps to one sentence, or messageFor is a lie. The third
time this collision has turned up in the catalogue."
```

---

## Task 6: The lending queries — two shipped, one to write

**Two of the three already exist, and this task was written before they did.** Creating them again under `src/domain/circulation/queries/` would fork every block reason into two implementations, which is precisely what this task's own preamble forbids.

| The plan named | Where it actually is | Shape |
|---|---|---|
| `circulation/queries/search-books-for-lending.ts` | `src/domain/catalogue/queries/search-books-for-lending.ts:27` | `(tx, ctx, { q }) => LendableBookRow[]`, each row carrying flat `blocked` / `reason?` plus `copiesTotal` / `copiesAvailable` |
| `circulation/queries/search-readers-for-lending.ts` | `src/domain/members/queries/search-readers-for-lending.ts:35` | `(tx, ctx, { q, maxConcurrentLoans }) => LendableReaderRow[]`, each row carrying **`block: Block`** — not flat `blocked`/`reason` — plus `activeLoans` and `parishLine` |
| `circulation/queries/search-loans-for-return.ts` | does not exist | C1 writes it |

Two differences worth internalising before writing anything against them:

- **`maxConcurrentLoans` is a parameter of the reader search, not something it reads.** Its docstring is explicit: "the shelf's own setting (BR §5.5) which the *caller* reads and passes in, so this query is not a second place that knows where policy configuration lives." Task 7's screen is what reads `settings`.
- **Both return `[]` for a blank `q`** (`:34` and `:42`), and both refuse a garbage query that folds to empty — B1's M7. The earlier draft of this task called both with `{ q: "" }` and asserted on `rows[0]`.

Five of the six tests this task proposed also already exist: `tests/domain/catalogue/manager-queries.test.ts:198,216,231,244` and `tests/domain/members/manager-queries.test.ts:299,331` cover every-copy-out, one-copy-free, diacritic-insensitivity, the garbage query, blocked-readers-listed-not-filtered, and the per-shelf limit. Rewriting them here would be duplication, not coverage.

**Files:**
- Create: `src/domain/circulation/queries/search-loans-for-return.ts`
- Modify: `src/domain/members/queries/search-readers-for-lending.ts` (delegate to `memberMayBorrow`)
- Test: `tests/domain/circulation/lending-queries.test.ts` (the agreement test, and the return search)

- [ ] **Step 1: Make the reader search delegate to Task 1's predicate**

`search-readers-for-lending.ts:86-93` composes `membershipAllowsNewLoan` with an inline `activeLoans >= maxConcurrentLoans`. That was correct when B2a shipped it — `memberMayBorrow` did not exist — and it is a second implementation of INV-5 now that it does. Replace the composition with the call:

```ts
const block = memberMayBorrow(
  { status: r.status as MembershipStatus, activeLoans },
  input.maxConcurrentLoans,
);
```

Behaviour is unchanged and the four shipped tests in `members/manager-queries.test.ts` must stay green untouched — that is the check that this is a refactor. What changes is that INV-5's threshold comparison now appears once in the codebase instead of twice, which is the same argument Task 1 makes about INV-4's status list one level down.

This makes the members domain import from circulation. `tests/architecture/boundaries.test.ts` forbids `src/domain` importing `next/*`, `src/auth` and `src/storage`, and says nothing about module-to-module imports inside the domain — verified by reading it, not assumed. Circulation already depends on members (Task 1), so this is a cycle at the *module* level; it is not a cycle at the *symbol* level (`policy.ts → members/policy.ts`, `members/queries → circulation/policy.ts`) and ES modules resolve it fine. If it later reads badly, the resolution is to move `memberMayBorrow` down into the kernel beside `Block`, not to keep two copies of the comparison.

- [ ] **Step 2: Write the agreement test — the one genuinely new test**

`tests/domain/circulation/lending-queries.test.ts`. This is the test the earlier draft got right and the only one of its six worth keeping, because it is the only one that could not be written before `lendCopy` existed. `managerContext()` below is Task 2's helper — a shelf, a manager, a `TenantContext` on a `fixedClock`; lift it to `tests/support/scenarios.ts` alongside `lentOut()` when this third file wants it.

```ts
test("the query's block reason matches what the command would throw", async () => {
  // The test that keeps the screen and the command honest with each other.
  // If these two ever disagree, a volunteer is told yes and then no — which
  // is the failure BR §16.3 is written to prevent. Both sides now route
  // through memberMayBorrow, so this asserts the wiring rather than a
  // coincidence.
  const { ctx, shelfId } = await managerContext();
  const reader = await makeMember(sql, shelfId);   // makeMember names readers "Người đọc N"
  for (let i = 0; i < 3; i++) {
    const { copyIds } = await makeBookWithCopies(sql, shelfId, 1);
    await runCommand(sql, ctx, lendCopy, { copyId: copyIds[0], membershipId: reader.id });
  }

  const rows = await runQuery(sql, ctx, (tx, c) =>
    searchReadersForLending(tx, c, { q: "nguoi doc", maxConcurrentLoans: 3 }),
  );
  const queried = rows.find((r) => r.membershipId === reader.id)!.block;

  const { copyIds } = await makeBookWithCopies(sql, shelfId, 1);
  const thrown = await runCommand(sql, ctx, lendCopy, {
    copyId: copyIds[0],
    membershipId: reader.id,
  }).catch((e) => e.code);

  expect(queried).toEqual({ blocked: true, reason: thrown });
});
```

Note `q: "nguoi doc"`, not `q: ""` — a blank query returns `[]` (`:42`). And `.block`, not `.reason` — the row carries a `Block`, and asserting the whole object rather than a field is what catches a `blocked: false` row that happens to carry a stale reason.

Write the same agreement test on the book side: every copy of a title out, then `searchBooksForLending`'s `reason` against what `lendCopy` throws for the last one.

- [ ] **Step 3: Write `searchLoansForReturn`**

The third query, and the only one with no shipped counterpart — it feeds the "Nhận trả" screen's step 1. It reads `loans_current`, not `loans`, so `is_overdue` and `days_remaining` come from the view (G5: overdue is derived, never written) and now follow `ctx.clock` (`20260808_14_olibra_now.sql:97-105`). That last part is new since this plan was written and is what makes an overdue row assertable in a test without waiting real time.

It searches on the reader's name and on the copy code, so `olibra_fold(u.full_name)` with the same `olibra_fold(${q}) <> ''` garbage guard both shipped searches carry (B1's M7), plus a plain match on `book_copies.code`. `requireManager` first, as its two siblings do.

- [ ] **Step 4: Implement, run, commit**

```bash
git add src/domain/circulation/queries/ src/domain/members/queries/search-readers-for-lending.ts \
        tests/domain/circulation/lending-queries.test.ts
git commit -m "feat(circulation): the return search, and one predicate behind both lending searches

searchBooksForLending and searchReadersForLending already shipped with B1
and B2a. This adds the third query and makes the reader search call
memberMayBorrow instead of restating INV-5's comparison, so the screen and
the command cannot disagree about a reader."
```

---

## Task 7: Wire the three screens

**Read this before starting: Task 7 is bigger than the two paragraphs it used to be.** The original said "Replace fixture reads with query calls. No visible change." That assumed some page somewhere already read from the database. **None does.** Grepped across `src/app/`: not one route calls `runQuery` or `runCommand`. `src/app/dang-nhap/actions.ts` is the only file under `src/app/` that reaches Postgres at all, and it does so through `signIn`/`landingShelfFor`, not through the kernel. Every manager page — including all six named below — still imports `@/lib/fixtures` and renders from arrays.

So C1's Task 7 is the first page-level database read in this project. It establishes the pattern every later slice copies: obtain a pooled handle (`connect`, `src/db/client.ts` — the shape `dang-nhap/actions.ts:5,70` already demonstrates, `sql.end()` included), resolve the caller with `contextFor` (`src/auth/guards.ts:87`), then `runQuery`. That is a decision worth making deliberately rather than discovering halfway through a page.

**This does not block the slice, and it should not silently expand it.** Tasks 1–6 are the invariants, the commands and the queries; they stand alone, they are fully testable, and they are what the "Done when" list below is mostly about. If Task 7 turns out to want its own plan — a page-data-loading seam, error rendering via `messageFor`, the server actions the confirm buttons post to — split it out and say so, rather than letting it grow inside this one. Landing Tasks 1–6 with Task 7 deferred is an honest outcome; landing a half-wired UI is not.

**Files** (all six exist; the plan previously named three globs):
- `quan-ly/cho-muon/page.tsx` — step 1, find the book
- `quan-ly/cho-muon/nguoi-doc/page.tsx` — step 2, find the reader (already imports `describeSelection` from the domain, so the parish line is a pure-helper call away from being real)
- `quan-ly/cho-muon/xac-nhan/page.tsx` — step 3, confirm
- `quan-ly/nhan-tra/page.tsx` — find the loan, then assess
- `quan-ly/nhan-tra/bao-mat/page.tsx` — the "Bạn đọc báo làm mất" branch, which per OPS §4.2 calls `ReportCopyLost` (B1, shipped) and **not** `ReceiveReturn`
- `quan-ly/sach/[id]/page.tsx` — the two-step entry points from BR §16.1

- [ ] **Step 1: Establish the page-data seam on one screen first**

`quan-ly/cho-muon/page.tsx`, the simplest of the six: one query (`searchBooksForLending`), one input, no writes. Get `connect` → `contextFor` → `runQuery` → render working there, review it, and only then repeat it. Doing all six at once means discovering the seam is wrong six times.

The shelf's `settings` are read here too, not inside a query: `searchReadersForLending` takes `maxConcurrentLoans` as a parameter precisely so the page is the one place that knows where policy configuration lives (BR §5.5 defaults: `loan_days` 14, `max_concurrent_loans` 3, `hold_days` 3).

- [ ] **Step 2: Replace fixture reads on the remaining five**

G11 made the seed reproduce the fixtures, so against a seeded database the screens should render near-identically. "Near", not "exactly" — the fixtures carry pre-computed display strings (`dueOn: "Chúa nhật 20/08"`, `daysLeft`, `borrowedOn: "06/08"`; `src/lib/fixtures.ts:1022-1033`) that the database does not store and `loans_current` derives differently. Expect formatting work, and do not treat a diff there as a bug in the query.

- [ ] **Step 3: Render refusals through `messageFor`**

`ERROR_MESSAGES` is the domain's own Vietnamese, and `errors.ts:11-16` is explicit that "a screen calls `ERROR_MESSAGES[code]` rather than writing its own wording for a rule it did not define." A block reason arriving from either search is an `ErrorCode`; render it through `messageFor`, not through a copy of the sentence in a component.

- [ ] **Step 4: Verify in the browser**

```bash
docker compose up -d
bun run db:migrate && bun run db:seed
bun run dev
```

Walk the full three-step lend, then the two-step lend from book detail, then the return. Confirm the blocking messages appear before the confirm step.

- [ ] **Step 5: Verify the links still resolve**

Run: `bun run check:links`
Expected: every internal link resolves, same as before.

- [ ] **Step 6: Run the full check**

Run: `bun run check` (typecheck, lint, format:check, test — `package.json:16`)

- [ ] **Step 7: Commit**

```bash
git add src/app/tu-sach/
git commit -m "feat(ui): wire quick-lend and receive-return to the domain"
```

---

## Constraint, recorded from the `feat/sql-clock` review (this slice must honour it)

**Every timestamp this slice writes comes from `ctx.clock`, never from a column default.** `lent_at` is the first column the rule applies to, and Task 3's `insert into loans` above already writes `${ctx.clock.now()}` into it explicitly — **keep that.** It reads like an optional flourish next to `lent_at timestamptz not null default now()` in `0005_circulation.sql`; it is not, and dropping it to "let the default handle it" is the tempting simplification this note exists to refuse.

The reason changed under this plan's feet. `20260808_14_olibra_now.sql` (branch `feat/sql-clock`) made `loans_current` read the injected clock: `is_overdue` and `days_remaining` are now computed against `ctx.clock`, via the transaction-local `olibra.now` GUC, rather than against SQL `now()`. So a `runCommand` transaction runs under **two** clocks — the application host's for anything sourced from `ctx.clock`, the database host's for anything sourced from a `default now()` or from `set_updated_at()`. Both are observable in the same transaction. DB §6, "Two clocks in one transaction", has the full table and the drift scenario.

Two things follow for C1 specifically:

1. **`lent_at` must be `ctx.clock`'s instant.** Otherwise a test that sets a `fixedClock` to 2026, lends a copy, and reads the loan back gets a `due_on` and an `is_overdue` from the injected clock and a `lent_at` from real wall-clock time — three columns on one row, two of them agreeing and one of them not. Any assertion relating them cannot be written, and INV-8's "a loan's `lent_at` precedes its `due_on`" becomes untestable rather than false.
2. **The same applies to every timestamp C2 and B3 add next** — `requested_at`, `assessed_at`, `hold_expires_at`. `hold_expires_at` is the sharpest case: it is *written* by whichever process approved the request and *compared against `olibra_now()`* on every later read, so if it is not written from `ctx.clock` it is being compared against a clock that did not produce it.

   **Correction from the reconciliation above: two of those three are C1's own, not C2's.** `ReceiveReturn` (Task 4) writes `assessed_at` on the `condition_assessments` row it inserts, and writes `hold_expires_at` whenever `holdForRequestId` is supplied — the very column this paragraph calls the sharpest case, on the very command in this slice. `returned_at` joins them. Task 4 now states the rule in its own body; this note was written as if C1 only wrote `lent_at`, and it did not.

The column defaults themselves stay. They are the backstop for rows written outside the domain — migrations, `seed()`, a `psql` session — and `feat/sql-clock` deliberately changed none of them. This is a rule about what a *command* writes, not a schema change; if a later slice wants to drop the defaults, that is its own decision with its own migration.

**Not in scope for C1:** nothing here asks this slice to change an existing command or a column default. `LendCopy` is simply the first command written after the rule existed.

---

## Forward risk, recorded from B1's code review (not this slice's to fix)

**Watch lock ordering if a command here ever row-locks a `book_copies` row and then calls `allocateCopyCodes`.** B1's allocator (`src/domain/catalogue/copy-codes.ts`) takes a per-shelf `pg_advisory_xact_lock` as its first statement, before touching any row. Both of B1's current callers (`CreateBook`, `AddCopies`) take that lock before any row-level lock exists in their transaction at all, so there is no ordering inversion today — verified by reading both call sites, not assumed.

A C1 command that acquired a row-level lock on `book_copies` (e.g. `select ... for update`) and *then* called `allocateCopyCodes` would invert that order: row lock first, advisory lock second. Two such transactions, each already holding a different row lock and each waiting on the other's advisory lock (or vice versa), is exactly the shape of a deadlock — Postgres would detect and abort one side with `40P01`, not silently corrupt anything, but that is still an unstructured failure a volunteer should never see (BR §2). Nothing in C1's current task list (`LendCopy`, `ReceiveReturn`, `VoidLoan`) calls `allocateCopyCodes` at all, so this is not a live bug in this plan — it is a note for whichever future command is first to combine a row lock with a copy-code allocation: take the advisory lock first, or take no row lock before it, matching the order B1's two callers already establish.

---

## Done when

- [ ] Two concurrent `lendCopy` calls on separate connections produce exactly one loan, and the loser sees `copy_not_available` — the named error, not a `23505`.
- [ ] `tests/invariants/` holds a passing test for INV-1, 2, 3, 4, 5, 7, 8 and 11 — and B2a's two tests in `inv-04-…` and B1's two in `inv-07-…` are still there, extended rather than replaced.
- [ ] A reader suspended mid-loan keeps their book (B2a's test, still green).
- [ ] A return with a queued reader does **not** hold the copy unless the manager asked.
- [ ] Overdue still comes from `loans_current` — no scheduled job writes a status anywhere in this slice.
- [ ] Every timestamp this slice writes comes from `ctx.clock`, not from a column default — `lent_at`, `returned_at`, `assessed_at` and `hold_expires_at` (see the constraint recorded from the `feat/sql-clock` review, and its correction).
- [ ] `loans.borrower_id`, `lent_by`, `received_by` and `voided_by` all hold **user** ids, and the tests that read them say so.
- [ ] `messageFor("loan_not_active_cannot_void")` returns VoidLoan's own sentence, distinct from ReceiveReturn's.
- [ ] `searchReadersForLending`'s block reason comes from `memberMayBorrow`, and `members/manager-queries.test.ts`'s four shipped tests pass untouched.
- [ ] The screens look and behave as they did against fixtures — or Task 7 is deliberately deferred and the deferral is written down, not implied.

**Next:** [C2 · Requests and holds](2026-08-07-olibra-backend-master.md#76-c2--requests-and-holds) — but resolve **Q1** (what `SkipRequest` actually does) first.
