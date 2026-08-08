# B1 · Catalogue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eight commands and six queries over books and copies — the slice C1 (lending) and every catalogue surface sit on. A title and its first copies are catalogued in one transaction with sequential, human-readable codes; a copy walks the state machine of BR §7.1; and availability is *derived*, never counted into a column.

**Architecture:** `src/domain/catalogue/` — `commands/` (one file per command, each a `Command<I, O>` the kernel runs), `queries/` (one file per query, each a plain function taking the kernel's `Tx`), and `policy.ts` (the pure rules: the copy-state transition table, the slug and copy-code derivations, the role gate). No SQL outside those files; no framework, no `src/auth` import (G1 and `tests/architecture/boundaries.test.ts`).

**Tech Stack:** TypeScript · `postgres` (porsager) · PostgreSQL 16 · Vitest.

---

## Reconciled against what shipped — read this before any code block

Every plan in this repository has been stale by the time its slice was picked up, always inside code blocks that looked authoritative. This section records what was checked against the running database (`docker compose exec -T db-test psql -U olibra -d olibra_test`, port 5436) and the code on `feat/catalogue`, so that this slice does not open with a reconciliation pass of its own.

**Column names, verified with `\d`, not from memory:**

| What an earlier plan says | What the database actually has |
|---|---|
| `books.published` (C1 plan, line ~1005; S2 plan uses the right one) | **`books.is_published`** |
| `audit_log.after_values` / `before_values` (C1 plan, line ~915) | **`audit_log.after` / `audit_log.before`** |
| `borrow_requests.member_id` → `memberships` | **references `users(id)`**, and is *not* a composite tenant FK |
| `categories.bookshelf_id` | **does not exist** — `categories` is a global table with a plain `unique (slug)` (DB §4.3) and no RLS |

**Other live findings that shape the code below:**

- `book_copies` carries `acquired_on date`, `acquired_from text`, `acquired_from_membership_id uuid`, and the composite FK `(bookshelf_id, acquired_from_membership_id) references memberships(bookshelf_id, id)`. Every insert naming a shelf-scoped parent must supply `bookshelf_id` too (DB §3, "Foreign keys stay inside one tenant").
- `book_copies_code_unique` is `unique (bookshelf_id, code) where deleted_at is null`. `code` is `not null`, so — unlike `parish_units_name_unique_in_scope` before its fix — there is no NULLs-are-distinct hole here. It **does** fire; verified live (below).
- `book_copies_retired_has_reason`: `check (state <> 'retired' or retired_reason is not null)`. Retiring without a reason is a constraint violation, not a silent success.
- `copies_borrowable` and `loans_current` are `security_invoker = true` views. `olibra_app` holds `select` on both and nothing else.
- **`olibra_app` has no `DELETE` privilege on any table** except `sessions`. Every "delete" in this slice is `update … set deleted_at = now()`, which is what BR §11 wants anyway.
- `users` and `categories` have `relrowsecurity = false` — global tables, joinable from a scoped query without a policy fight.
- `condition_assessments.assessed_by` is `not null references users(id)`. A command that writes one needs a real `ctx.actor.userId`.
- `tests/architecture/boundaries.test.ts` forbids `src/domain` importing `src/auth` (commit `6e4f510`). `requireRole` from `src/auth/guards.ts` is therefore **not** available to a command; this slice restates it over the kernel's `atLeast` inside `policy.ts`.
- The folding-parity test master §7.1 asks B1 to write **already exists and passes**: `tests/db/folding.test.ts`, with all four DB §5 inputs plus a fifth (lowercase `đ`). B1 must not rewrite it — see Task 5, which adds the half it does not cover.

**Two `lpad` and `unnest` facts, probed live rather than assumed:**

```
select lpad('10000', 4, '0');  ->  1000      -- lpad TRUNCATES on the right
```

That is a copy-code collision waiting for the 10,000th copy on a shelf. Codes are therefore padded in TypeScript with `String(n).padStart(4, "0")`, which never truncates, and passed to Postgres as a `text[]`:

```sql
insert into book_copies (...) select ..., c, ... from unnest(${codes}::text[]) as c returning id, code
```

Verified inserting `DT-0215`, `DT-0216`, `DT-0217` in one statement as `olibra_app` inside a scoped transaction.

---

## Global Constraints

Inherited from [the master plan](2026-08-07-olibra-backend-master.md#global-constraints). Load-bearing in this slice:

- **G3** — state change and audit record commit together. The kernel's `Command<I, O>` return type makes this structural: a command that produces no `AuditEntry` does not type-check.
- **G4** — tenant scoping is structural. Every command runs through `runCommand`, every query through `runQuery`; both set `olibra.bookshelf_id` and `set local role olibra_app`.
- **G5** — derived state is computed on read. **This is the rule this slice is most likely to break under pressure** (BR §8, DB §6). Availability comes from `copies_borrowable`. There is no `copies_available` column and there must never be one.
- **G8** — errors are named. Every new failure below gets a code and an exact Vietnamese sentence in `src/domain/kernel/errors.ts`.
- **G11** — the seed reproduces `src/lib/fixtures.ts` exactly. The slug and copy-code derivations in Task 1 are chosen so that `CreateBook` on shelf `dong-thap` produces the codes and slugs the fixtures already contain.
- **G12** — INV-7 gets its own named test (Task 4).

---

## Decisions this plan makes, rather than leaves open

### Q3 — may an `available` copy be reported lost? **No. Strict reading: `on_loan → lost` only.**

BR §7.1's transition table draws exactly one arrow into `lost`, from `on_loan`. OPS §4.1 says the same and flags the disagreement itself. Master §5 records the assumed reading as strict. Against that: the built manager book-detail page offers **Báo mất** on every copy row.

That screen is not evidence of a product decision. Its copy rows come from a page-local literal (`const COPIES` in `src/app/tu-sach/[shelf]/quan-ly/sach/[id]/page.tsx`) with exactly one conditional in it — `lost` swaps the action pair — and it offers **Ngừng dùng** on an already-`retired` copy too, which nobody claims is intended. It is an unwired fixture, not a specification.

The decisive argument is reversibility. Adding `available → lost` later is purely additive: one row in the transition table, one test, and no existing data to reinterpret. Shipping it now and retracting it later leaves rows already marked `lost` from `available` that no rule explains. **Start strict; widen on a product answer, not on a fixture.**

So: `reportCopyLost` on an `available` (or `held`) copy fails with a new named code, `copy_not_on_loan` — "Chỉ có thể báo mất bản sách đang được mượn." Two consequences to record rather than discover:

1. A book that genuinely walks off the shelf has no honest exit under this reading. `available → retired` is the only available one, and `retired` is a one-way door (BR §7.1 draws `retired → [*]`, no arrow back), whereas `lost` has the whole **Sách đã mất** screen behind it for the "found months later" case BR §3 names. **This is a real hole and it is being left open deliberately, flagged to the product owner, not papered over.**
2. E (UI wiring) must hide **Báo mất** on any row whose state is not `on_loan`, so a volunteer is never offered an action that will refuse. BR §16.3's own rule for quick-lend — blocking conditions surface *before* the confirm step — applies here too.

### Q7 — `DeleteBook` has no UI entry point. **Implement it now.**

Master §5's assumed reading, and the right one. The permission exists (BR §13.2), the deletion policy is written (BR §11), OPS §4.1 specifies its inputs and both failure behaviours, and B1 is the only slice that will ever own it. Deferring it means the next person to want it re-derives the copy-retention rule from BR §11 with no test to check them. It ships unexposed; E adds a confirmation flow when one is designed.

One correction to OPS §4.1 while implementing it. OPS lists `copy_has_history` under **Failure modes**, but describes a *behaviour*: "a copy with loan history is retained rather than deleted, per §11". Those are different things, and BR §11's sentence — "A copy with loan history cannot be removed." — is about the copy, not about the book. This plan implements the behaviour, not a throw: `deleteBook` soft-deletes the book, soft-deletes only those copies with no loan history, and returns `{ copiesDeleted, copiesRetained }` so the caller can say so. **No `copy_has_history` error code is added**, because nothing would ever throw it, and X1's bijection test (§7.11) would then carry a message with no thrower. `has_active_loans` remains a genuine throw.

### The `validation_failed` collision — OPS gives one code three different sentences

`errors.ts` maps one code to one sentence. OPS §4.1 asks `validation_failed` to say three different things:

| Command | OPS sentence | Resolution |
|---|---|---|
| `UpdateBook` | "Vui lòng kiểm tra lại thông tin." | keep `validation_failed` — this is the sentence already shipped |
| `CreateBook` | "Vui lòng điền đầy đủ các trường bắt buộc." | new code `required_fields_missing` |
| `AddCopies` | "Số bản phải lớn hơn 0." | new code `copy_count_invalid` |

### New error codes, written in the register of the ones already in `errors.ts`

```ts
  required_fields_missing: "Vui lòng điền đầy đủ các trường bắt buộc.",
  copy_count_invalid: "Số bản phải lớn hơn 0.",
  category_not_found: "Không tìm thấy thể loại này.",
  copy_not_on_loan: "Chỉ có thể báo mất bản sách đang được mượn.",
  retire_reason_required: "Vui lòng ghi lý do ngừng dùng bản sách này.",
```

The first two are OPS §4.1's own words, verbatim. The last three are new: `category_not_found` mirrors `book_not_found`'s "Không tìm thấy …" shape; `copy_not_on_loan` states the rule and what is allowed instead, as BR §17.7 requires; `retire_reason_required` exists because the shipped `reason_required` says "Vui lòng ghi lý do huỷ." — *huỷ* is the word for cancelling something, not for taking a book off the shelf for good, and this is the wrong screen for it.

Already present and reused unchanged: `book_not_found`, `copy_not_found`, `validation_failed`, `duplicate_isbn`, `has_active_loans`, `already_lost`, `already_retired`, `not_lost`, `copy_on_loan`, `copy_not_available`, `not_permitted`.

### Signature reconciliation — master §7.1 predates S2's `Command` shape

Master §7.1 says `createBook(ctx, input): Promise<{ bookId; copyIds }>`. The shipped kernel's type is `Command<I, O> = (tx, ctx, input) => Promise<{ result, audit }>`. Both are true of different things: the module exports a `Command`, and `runCommand(sql, ctx, createBook, input)` has master §7.1's signature. **Later slices call the `runCommand` form.** The same applies to `retireCopy`.

`searchBooksForLending` has two homes in two plans. Master §7.1 lists it under `src/domain/catalogue/queries/`; the C1 plan imports it from `src/domain/circulation/queries/`. **This slice builds it at master §7.1's path** — that file list is what defines B1's scope — and C1's reconciliation pass must fix the import. Its signature follows C1's call shape, `searchBooksForLending(tx, ctx, { q })`, not master's `(ctx, q)`, because the kernel's `runQuery` hands a query a `Tx` and C1's tests are already written that way.

### Copy codes — what makes concurrent allocation safe

`CreateBook` and `AddCopies` allocate the next sequential codes on a shelf. Two managers cataloguing at the same second must not produce the same code. Three facts, all probed live:

1. `book_copies_code_unique` **does** fire. With two connections racing a read-max-then-insert, one succeeded with `DT-0001` and the other failed `23505 book_copies_code_unique`. So the database already makes a duplicate code impossible — but at the cost of one manager seeing an error for something that is not their fault.
2. Adding `select pg_advisory_xact_lock(hashtext('olibra.copy_code'), hashtext(${bookshelfId}))` as the *first* statement of the allocation turned the same race into `DT-0001` and `DT-0002`, both committing. The lock is transaction-scoped, so it is released by the kernel's commit or rollback with nothing to remember; it is keyed per shelf, so two parishes never wait on each other; and `olibra_app` may call both `pg_advisory_xact_lock` and `hashtext` (verified as that role).
3. The max-sequence scan deliberately **does not filter `deleted_at is null`**, even though the unique index does. A soft-deleted `DT-0215` is a code that was printed onto a QR label and stuck to a physical book; reusing it is worse than skipping it.

The unique index remains the guarantee; the advisory lock is what stops the guarantee from being experienced as an error message. If the lock is ever removed, the failure mode is a raised `23505`, not a duplicate code.

### Availability is derived — the one rule to watch

BR §8 and DB §6 both single this out as the rule most likely to be quietly violated. In this slice it means: **`copies_available` is `count(av.id)` over a join to `copies_borrowable`, in every query that reports it.** Not a column, not a counter maintained by a command, not a number cached anywhere. Task 5's tests assert it by changing a copy's state through a command and re-reading the catalogue with no other action in between.

---

## Task 1: `policy.ts` — the pure rules, and the error codes

Everything else in this slice depends on this file, and none of it touches a database. Writing it first means Tasks 2–6 are about SQL and transactions only.

**Files:**
- Extend: `src/domain/kernel/errors.ts` (five new entries — do not remove or reword anything already there)
- Create: `src/domain/catalogue/policy.ts`
- Test: `tests/domain/catalogue/policy.test.ts`

**Interfaces:**

- Consumes: `ErrorCode`, `RuleViolated` (`src/domain/kernel/errors`); `atLeast`, `TenantContext` (`src/domain/kernel/tenant`).
- Produces:
  ```ts
  export type CopyState = "available" | "held" | "on_loan" | "lost" | "retired";
  export type CopyCondition =
    | "perfect" | "slightly_worn" | "worn" | "torn" | "missing_pages" | "written_on";

  export const COPY_CONDITIONS: readonly CopyCondition[];
  export function isCopyCondition(value: unknown): value is CopyCondition;

  export function copyStateTransition(
    from: CopyState,
    to: CopyState,
  ): { allowed: boolean; reason?: ErrorCode };

  export function slugifyTitle(title: string): string;
  export function copyCodePrefix(shelf: {
    slug: string;
    settings: Record<string, unknown> | null;
  }): string;
  export function formatCopyCode(prefix: string, sequence: number): string;

  export function requireManager(ctx: TenantContext): void;
  export function requireReader(ctx: TenantContext): void;
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/domain/catalogue/policy.test.ts`:

```ts
import { expect, test } from "vitest";
import { RuleViolated } from "../../../src/domain/kernel/errors";
import { fixedClock } from "../../../src/domain/kernel/clock";
import type { TenantContext } from "../../../src/domain/kernel/tenant";
import {
  COPY_CONDITIONS,
  copyCodePrefix,
  copyStateTransition,
  formatCopyCode,
  isCopyCondition,
  requireManager,
  requireReader,
  slugifyTitle,
} from "../../../src/domain/catalogue/policy";

const ctxWith = (role: TenantContext["actor"]["role"]): TenantContext => ({
  bookshelfId: "11111111-1111-1111-1111-111111111111",
  actor: { userId: null, membershipId: null, role },
  clock: fixedClock("2026-08-08T10:00:00Z"),
});

test("the transition table is BR §7.1's table, arrow for arrow", () => {
  // Every arrow BR §7.1 draws, and nothing it does not.
  const allowed: [string, string][] = [
    ["available", "held"],
    ["available", "on_loan"],
    ["available", "retired"],
    ["held", "available"],
    ["held", "on_loan"],
    ["on_loan", "available"],
    ["on_loan", "lost"],
    ["lost", "available"],
    ["lost", "retired"],
  ];
  for (const [from, to] of allowed) {
    expect(copyStateTransition(from as never, to as never).allowed).toBe(true);
  }
});

test("Q3: an available copy cannot be reported lost, and says why", () => {
  // The decision this plan records: BR §7.1 draws only on_loan → lost, and
  // widening it later is additive while retracting it is not.
  const t = copyStateTransition("available", "lost");
  expect(t.allowed).toBe(false);
  expect(t.reason).toBe("copy_not_on_loan");
});

test("a copy on loan cannot be retired, and names the way out", () => {
  // OPS §4.1 RetireCopy: "Hãy nhận trả hoặc báo mất trước."
  const t = copyStateTransition("on_loan", "retired");
  expect(t.allowed).toBe(false);
  expect(t.reason).toBe("copy_on_loan");
});

test("a held copy cannot be retired either", () => {
  // BR §7.1 draws no held → retired arrow; the reader waiting on the hold is
  // the reason. copy_not_available is the sentence that names both cases:
  // "đang được mượn hoặc đang giữ chỗ".
  const t = copyStateTransition("held", "retired");
  expect(t.allowed).toBe(false);
  expect(t.reason).toBe("copy_not_available");
});

test("the terminal and repeated states each get their own reason", () => {
  expect(copyStateTransition("lost", "lost").reason).toBe("already_lost");
  expect(copyStateTransition("retired", "lost").reason).toBe("already_retired");
  expect(copyStateTransition("retired", "available").reason).toBe("already_retired");
  // MarkCopyFound off anything that is not lost.
  expect(copyStateTransition("available", "available").reason).toBe("not_lost");
  expect(copyStateTransition("on_loan", "available").allowed).toBe(true);
});

test("INV-7: a lost or retired copy cannot be lent or held", () => {
  // The predicate half of the invariant. Its access-path half — that such a
  // copy is absent from copies_borrowable — is Task 4's named test.
  for (const from of ["lost", "retired"] as const) {
    for (const to of ["on_loan", "held"] as const) {
      const t = copyStateTransition(from, to);
      expect(t.allowed).toBe(false);
      expect(t.reason).toBe(from === "lost" ? "already_lost" : "already_retired");
    }
  }
});

test("slugifyTitle reproduces the slugs already in the fixtures", () => {
  // G11: the seed must reproduce src/lib/fixtures.ts exactly, so cataloguing
  // one of these titles through CreateBook must land on the same slug the
  // fixtures already carry. Written out rather than imported: fixtures.ts
  // reaches src/lib/status.ts, which imports lucide-react, and the domain
  // does not pull an icon library into a unit test to check a string.
  expect(slugifyTitle("Dế Mèn Phiêu Lưu Ký")).toBe("de-men-phieu-luu-ky");
  expect(slugifyTitle("Totto-chan Bên Cửa Sổ")).toBe("totto-chan-ben-cua-so");
  expect(slugifyTitle("Kính Vạn Hoa tập 4")).toBe("kinh-van-hoa-tap-4");
  expect(slugifyTitle("Đất Rừng Phương Nam")).toBe("dat-rung-phuong-nam");
  expect(slugifyTitle("Cho Tôi Xin Một Vé Đi Tuổi Thơ")).toBe(
    "cho-toi-xin-mot-ve-di-tuoi-tho",
  );
});

test("copyCodePrefix derives DT from dong-thap, and every other fixture shelf", () => {
  const of = (slug: string) => copyCodePrefix({ slug, settings: null });
  expect(of("dong-thap")).toBe("DT");
  expect(of("can-tho")).toBe("CT");
  expect(of("ben-tre")).toBe("BT");
  expect(of("vinh-long")).toBe("VL");
});

test("a one-word slug still yields two characters, and settings can override", () => {
  expect(copyCodePrefix({ slug: "thanhtam", settings: null })).toBe("TH");
  expect(
    copyCodePrefix({ slug: "dong-thap", settings: { copy_code_prefix: "DTX" } }),
  ).toBe("DTX");
});

test("formatCopyCode pads to four digits and never truncates", () => {
  // Postgres lpad('10000', 4, '0') returns '1000' — it truncates on the
  // right, which would collide the 10,000th copy with the 1,000th. Padding
  // in TypeScript is why this slice does not build codes in SQL.
  expect(formatCopyCode("DT", 215)).toBe("DT-0215");
  expect(formatCopyCode("DT", 1)).toBe("DT-0001");
  expect(formatCopyCode("DT", 10000)).toBe("DT-10000");
});

test("the six conditions are BR §9's flat list, and lost is not among them", () => {
  expect(COPY_CONDITIONS).toEqual([
    "perfect",
    "slightly_worn",
    "worn",
    "torn",
    "missing_pages",
    "written_on",
  ]);
  expect(isCopyCondition("torn")).toBe(true);
  // BR §9: "lost is deliberately absent, because it is a copy state (§7.1)."
  expect(isCopyCondition("lost")).toBe(false);
});

test("the role gates are the security control, not the screen", () => {
  // BR §13.3. requireRole lives in src/auth/guards.ts, which the domain may
  // not import (tests/architecture/boundaries.test.ts). These are the same
  // three lines over the kernel's atLeast.
  expect(() => requireManager(ctxWith("manager"))).not.toThrow();
  expect(() => requireManager(ctxWith("admin"))).not.toThrow();
  expect(() => requireManager(ctxWith("reader"))).toThrow(RuleViolated);
  expect(() => requireReader(ctxWith("reader"))).not.toThrow();
  expect(() => requireReader(ctxWith("guest"))).toThrow(RuleViolated);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run test tests/domain/catalogue/policy.test.ts`
Expected: FAIL — `Cannot find module '../../../src/domain/catalogue/policy'`. If it instead fails on the `errors` import, something has changed `src/domain/kernel/errors.ts`; stop and look before continuing.

- [ ] **Step 3: Add the five error codes**

In `src/domain/kernel/errors.ts`, inside the `// — catalogue —` block of `ERROR_MESSAGES`, after `copy_on_loan`. Add only; change nothing else in the file.

```ts
  // — catalogue: added by B1 —
  // OPS §4.1 gives `validation_failed` three different sentences across
  // CreateBook, UpdateBook and AddCopies. One code maps to one sentence, so
  // the two that are not the shipped wording get their own codes.
  required_fields_missing: "Vui lòng điền đầy đủ các trường bắt buộc.",
  copy_count_invalid: "Số bản phải lớn hơn 0.",
  category_not_found: "Không tìm thấy thể loại này.",
  // Q3, decided in the B1 plan: BR §7.1 draws only on_loan → lost. The
  // sentence names what is allowed instead, per BR §17.7.
  copy_not_on_loan: "Chỉ có thể báo mất bản sách đang được mượn.",
  // Distinct from `reason_required`, whose shipped sentence says "lý do
  // huỷ" — a cancellation. Withdrawing a copy from the shelf is not that.
  retire_reason_required: "Vui lòng ghi lý do ngừng dùng bản sách này.",
```

- [ ] **Step 4: Write `policy.ts`**

Create `src/domain/catalogue/policy.ts`:

```ts
import type { ErrorCode } from "../kernel/errors";
import { RuleViolated } from "../kernel/errors";
import { atLeast, type TenantContext } from "../kernel/tenant";

/**
 * The catalogue's pure rules. No SQL, no clock, no I/O — everything here is
 * a function of its arguments, so the state machine can be read and tested
 * without a database, which is what BR §6 means by "the specification of
 * correctness".
 */

/** `copy_state` in the database, spelled exactly as the enum spells it. */
export type CopyState = "available" | "held" | "on_loan" | "lost" | "retired";

/** BR §9. A flat list, not a scale; `lost` is a state, not a condition. */
export const COPY_CONDITIONS = [
  "perfect",
  "slightly_worn",
  "worn",
  "torn",
  "missing_pages",
  "written_on",
] as const;

export type CopyCondition = (typeof COPY_CONDITIONS)[number];

export function isCopyCondition(value: unknown): value is CopyCondition {
  return (COPY_CONDITIONS as readonly unknown[]).includes(value);
}

/**
 * BR §7.1's transition table, arrow for arrow.
 *
 * Written as data rather than as a chain of `if`s so that the table in the
 * requirements and the table here can be compared by eye, and so that adding
 * an arrow (see Q3, below) is one line.
 *
 * **Q3 — `available → lost` is deliberately absent.** BR §7.1 draws only
 * `on_loan → lost`, and OPS §4.1 flags the manager screen's broader "Báo
 * mất" affordance as an open question rather than a decision. The B1 plan
 * records the reasoning: widening this later is additive, while retracting a
 * transition that has already written rows is not. If the product owner says
 * yes, the change is `["available", "lost"]` in ALLOWED and one test.
 */
const ALLOWED: ReadonlySet<string> = new Set(
  (
    [
      ["available", "held"],
      ["available", "on_loan"],
      ["available", "retired"],
      ["held", "available"],
      ["held", "on_loan"],
      ["on_loan", "available"],
      ["on_loan", "lost"],
      ["lost", "available"],
      ["lost", "retired"],
    ] as const
  ).map(([from, to]) => `${from}->${to}`),
);

/**
 * Why a particular refusal, in the words the volunteer will actually read.
 *
 * Ordered most-specific first: the state the copy is *in* usually explains
 * the refusal better than the transition being attempted does.
 */
function refusalFor(from: CopyState, to: CopyState): ErrorCode {
  if (from === "retired") return "already_retired";
  if (from === "lost" && to !== "available" && to !== "retired") {
    return "already_lost";
  }
  if (to === "lost") {
    // Q3. Reached from `available` and from `held`; both mean the same thing
    // to the person holding the phone — this copy is not out with anybody.
    return "copy_not_on_loan";
  }
  if (to === "retired") {
    return from === "on_loan" ? "copy_on_loan" : "copy_not_available";
  }
  if (to === "available") {
    // MarkCopyFound's failure mode (OPS §4.1): the copy is not lost.
    return "not_lost";
  }
  return "copy_not_available";
}

export function copyStateTransition(
  from: CopyState,
  to: CopyState,
): { allowed: boolean; reason?: ErrorCode } {
  if (ALLOWED.has(`${from}->${to}`)) return { allowed: true };
  return { allowed: false, reason: refusalFor(from, to) };
}

/**
 * `books.slug`, derived from the title exactly as `src/lib/fixtures.ts`
 * already spells it — verified against all twelve fixture titles.
 *
 * The folding is the same folding search uses (`src/lib/search.ts`'s
 * `fold`, and its SQL twin `olibra_fold`), reimplemented here rather than
 * imported so the domain does not depend on `src/lib` for a rule of its own;
 * `tests/db/folding.test.ts` is what keeps the two SQL/TS implementations in
 * step, and Task 1's test is what keeps this one honest against the fixtures.
 */
export function slugifyTitle(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // combining marks
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * The letters in front of a copy code — `DT` in `DT-0215`.
 *
 * There is no `copy_code_prefix` column on `bookshelves`, and adding one
 * would be a migration this slice's file list (master §7.1) does not
 * include. `settings` is already `jsonb` and already the documented home for
 * per-shelf configuration (BR §5.5, DB §4.2: "a shelf row need only store
 * what it overrides"), so an override lives there and the default is derived.
 *
 * The derivation is the initials of the slug's hyphen-separated words, which
 * gives `dong-thap` → `DT`, `can-tho` → `CT`, `ben-tre` → `BT`,
 * `vinh-long` → `VL` — every shelf in the fixtures, unambiguously. A
 * single-word slug has only one initial, which is too thin for a label
 * somebody reads off a book, so it falls back to the slug's first two
 * letters.
 */
export function copyCodePrefix(shelf: {
  slug: string;
  settings: Record<string, unknown> | null;
}): string {
  const override = shelf.settings?.copy_code_prefix;
  if (typeof override === "string" && override.trim() !== "") {
    return override.trim().toUpperCase();
  }
  const initials = shelf.slug
    .split("-")
    .filter(Boolean)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
  return initials.length >= 2 ? initials.slice(0, 3) : shelf.slug.slice(0, 2).toUpperCase();
}

/**
 * `DT` + 215 -> `DT-0215`.
 *
 * Padded here rather than with SQL's `lpad`, which truncates on the right:
 * `lpad('10000', 4, '0')` is `'1000'`, so the ten-thousandth copy on a shelf
 * would collide with the thousandth. `padStart` never shortens a string.
 */
export function formatCopyCode(prefix: string, sequence: number): string {
  return `${prefix}-${String(sequence).padStart(4, "0")}`;
}

/**
 * BR §13.3: "the interface hiding an action is never the security control."
 *
 * `src/auth/guards.ts` has `requireRole`, but `tests/architecture/
 * boundaries.test.ts` forbids `src/domain` importing `src/auth` — the domain
 * takes a `TenantContext` and never resolves one. These two are the same
 * three lines over the kernel's own `atLeast`. The tidier end state is
 * `requireRole` moving into `src/domain/kernel/tenant.ts` with `guards.ts`
 * re-exporting it; that touches `src/auth`, which is outside this slice.
 */
export function requireManager(ctx: TenantContext): void {
  if (!atLeast(ctx.actor.role, "manager")) throw new RuleViolated("not_permitted");
}

/** OPS §3.2: every catalogue read requires a membership *of this shelf*. */
export function requireReader(ctx: TenantContext): void {
  if (!atLeast(ctx.actor.role, "reader")) throw new RuleViolated("not_permitted");
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `bun run test tests/domain/catalogue/policy.test.ts tests/domain/kernel/errors.test.ts`
Expected: PASS, both files. The second is included because Step 3 edited the file it covers.

- [ ] **Step 6: Commit**

```bash
git add src/domain/catalogue/policy.ts src/domain/kernel/errors.ts tests/domain/catalogue/policy.test.ts
git commit -m "feat(catalogue): the copy state machine, as data rather than branches"
```

---

## Task 2: `CreateBook` and `AddCopies` — one transaction, sequential codes

These two share everything that is hard about this slice: the copy-code allocator, the donor columns, and the concurrency question. They belong in one task because a reviewer looking at one will want the other on screen.

**Files:**
- Create: `src/domain/catalogue/commands/create-book.ts`, `src/domain/catalogue/commands/add-copies.ts`, `src/domain/catalogue/copy-codes.ts`
- Test: `tests/domain/catalogue/create-book.test.ts`

`copy-codes.ts` is one file more than master §7.1's list. It exists because the allocator is the only piece of SQL both commands run, and a copy-pasted second version of it is exactly how two managers end up with the same code.

**Interfaces:**

- Consumes: `Command`, `Tx` (`src/domain/kernel/unit-of-work`); `TenantContext`; `ValidationFailed`, `NotFound`, `RuleViolated`; `requireManager`, `slugifyTitle`, `copyCodePrefix`, `formatCopyCode` (`../policy`).
- Produces:
  ```ts
  export interface DonorInput {
    donorMembershipId?: string | null;
    donorName?: string | null;
    /** `YYYY-MM-DD`. Defaults to `ctx.clock.today()` (G6). */
    acquiredOn?: string | null;
  }

  export interface CreateBookInput extends DonorInput {
    title: string;
    author: string;
    categorySlug: string;
    publisher?: string | null;
    publishedYear?: number | null;
    pageCount?: number | null;
    isbn?: string | null;
    description?: string | null;
    coverUrl?: string | null;
    language?: string;      // default "vi"
    published?: boolean;    // default true -> books.is_published
    copyCount: number;
  }

  export const createBook: Command<CreateBookInput, { bookId: string; copyIds: string[] }>;
  // effective call: runCommand(sql, ctx, createBook, input)
  //   -> Promise<{ bookId: string; copyIds: string[] }>   (master §7.1)

  export interface AddCopiesInput extends DonorInput {
    bookId: string;
    count: number;
  }

  export const addCopies: Command<AddCopiesInput, { copyIds: string[]; codes: string[] }>;

  // copy-codes.ts
  export function allocateCopyCodes(
    tx: Tx,
    ctx: TenantContext,
    count: number,
  ): Promise<string[]>;
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/domain/catalogue/create-book.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { fixedClock } from "../../../src/domain/kernel/clock";
import { NotFound, ValidationFailed, RuleViolated } from "../../../src/domain/kernel/errors";
import { runCommand } from "../../../src/domain/kernel/unit-of-work";
import type { TenantContext } from "../../../src/domain/kernel/tenant";
import { createBook } from "../../../src/domain/catalogue/commands/create-book";
import { addCopies } from "../../../src/domain/catalogue/commands/add-copies";
import { migrate } from "../../../src/db/migrate";
import { makeMember, makeShelf } from "../../support/factories";
import { closeAll, resetDatabase, sql, withTwoConnections } from "../../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

const clock = fixedClock("2026-08-08T03:00:00Z"); // 10:00 in Ho Chi Minh City

/**
 * A shelf that already holds one copy coded `DT-0214`, so the next codes the
 * allocator hands out are `DT-0215`–`DT-0217` — the exact example both the
 * new-book form's hint and master §7.1's acceptance criterion use. Every test in
 * this file starts from that baseline, so a code assertion reads as the rule
 * rather than as an accident of how many rows a previous test left behind.
 */
async function shelfWithManager(slug = "dong-thap") {
  const shelf = await makeShelf(sql, { slug });
  const manager = await makeMember(sql, shelf.id, { role: "manager" });
  await sql`
    insert into categories (slug, name, sort_order)
    values ('van-hoc-thieu-nhi', 'Văn học thiếu nhi', 10)
    on conflict (slug) do nothing
  `;
  const prefix = slug === "dong-thap" ? "DT" : "CT";
  const [existing] = await sql<{ id: string }[]>`
    insert into books (bookshelf_id, title, slug, author, is_published)
    values (${shelf.id}, 'Cũ', ${`cu-${slug}`}, 'A', true) returning id
  `;
  await sql`
    insert into book_copies (bookshelf_id, book_id, code)
    values (${shelf.id}, ${existing.id}, ${`${prefix}-0214`})
  `;
  const ctx: TenantContext = {
    bookshelfId: shelf.id,
    actor: { userId: manager.userId, membershipId: manager.id, role: "manager" },
    clock,
  };
  return { shelf, manager, ctx };
}

const BOOK = {
  title: "Dế Mèn Phiêu Lưu Ký",
  author: "Tô Hoài",
  categorySlug: "van-hoc-thieu-nhi",
  publisher: "Kim Đồng",
  publishedYear: 2019,
  pageCount: 176,
  copyCount: 3,
};

test("a book and its first copies are one transaction, with sequential codes", async () => {
  // OPS §1: "creating a book together with its initial batch of copies is one
  // cataloguing event ... not several commands stitched together, because a
  // book with zero copies is not yet meaningfully catalogued."
  const { ctx } = await shelfWithManager();

  const { bookId, copyIds } = await runCommand(sql, ctx, createBook, BOOK);

  expect(copyIds).toHaveLength(3);
  const codes = await sql<{ code: string }[]>`
    select code from book_copies where book_id = ${bookId} order by code
  `;
  // Master §7.1's acceptance criterion, spelled out in the new-book form's hint:
  // "Hệ thống sẽ tự sinh mã cho từng bản, ví dụ DT-0215, DT-0216, DT-0217".
  expect(codes.map((c) => c.code)).toEqual(["DT-0215", "DT-0216", "DT-0217"]);
});

test("the slug and the flags land on the row the fixtures already carry", async () => {
  const { ctx } = await shelfWithManager();
  const { bookId } = await runCommand(sql, ctx, createBook, BOOK);

  const [row] = await sql<
    {
      slug: string;
      is_published: boolean;
      language: string;
      title_folded: string;
      category_id: string;
      added_by: string;
    }[]
  >`select slug, is_published, language, title_folded, category_id, added_by
      from books where id = ${bookId}`;

  expect(row.slug).toBe("de-men-phieu-luu-ky");
  expect(row.is_published).toBe(true);
  expect(row.language).toBe("vi");
  // Generated column, not written by the command.
  expect(row.title_folded).toBe("de men phieu luu ky");
  expect(row.category_id).not.toBeNull();
  expect(row.added_by).toBe(ctx.actor.userId);
});

test("every generated copy starts available and perfect", async () => {
  // OPS §4.1: "each generated copy starts `available`".
  const { ctx } = await shelfWithManager();
  const { bookId } = await runCommand(sql, ctx, createBook, BOOK);
  const rows = await sql<{ state: string; condition: string }[]>`
    select state, condition from book_copies where book_id = ${bookId}
  `;
  expect(rows.every((r) => r.state === "available")).toBe(true);
  expect(rows.every((r) => r.condition === "perfect")).toBe(true);
});

test("the donor fields land on every copy the call creates", async () => {
  // Master §7.1's acceptance: donorMembershipId populates acquired_from_membership_id,
  // donorName populates the existing acquired_from text column (DB §4.4).
  const { shelf, ctx } = await shelfWithManager();
  const donor = await makeMember(sql, shelf.id);

  const { bookId } = await runCommand(sql, ctx, createBook, {
    ...BOOK,
    donorMembershipId: donor.id,
    donorName: "bác Hoà",
    acquiredOn: "2026-07-19",
  });

  const rows = await sql<
    {
      acquired_from: string | null;
      acquired_from_membership_id: string | null;
      acquired_on: Date;
    }[]
  >`select acquired_from, acquired_from_membership_id, acquired_on
      from book_copies where book_id = ${bookId}`;
  expect(rows).toHaveLength(3);
  expect(rows.every((r) => r.acquired_from === "bác Hoà")).toBe(true);
  expect(rows.every((r) => r.acquired_from_membership_id === donor.id)).toBe(true);
});

test("a copy with no donor recorded is the ordinary case, not an error", async () => {
  // Master §7.1: "both may be absent, since most copies still arrive with no donor
  // recorded at all." acquiredOn still defaults to today, in Asia/Ho_Chi_Minh.
  const { ctx } = await shelfWithManager();
  const { bookId } = await runCommand(sql, ctx, createBook, BOOK);
  const [row] = await sql<
    { acquired_from: string | null; acquired_from_membership_id: string | null; acquired_on: Date }[]
  >`select acquired_from, acquired_from_membership_id, acquired_on
      from book_copies where book_id = ${bookId} limit 1`;
  expect(row.acquired_from).toBeNull();
  expect(row.acquired_from_membership_id).toBeNull();
  expect(row.acquired_on.toISOString().slice(0, 10)).toBe("2026-08-08");
});

test("one audit entry per cataloguing event, naming the codes it produced", async () => {
  // OPS §4.1: CreateBook's audit action is `book.created` — singular, because
  // OPS §1 calls the book and its first copies one business fact. The codes go
  // in `after` so the audit browser can say which labels were printed.
  const { ctx } = await shelfWithManager();
  const { bookId } = await runCommand(sql, ctx, createBook, BOOK);

  const entries = await sql<
    { action: string; entity_id: string; after: { copyCodes: string[] } }[]
  >`select action, entity_id, after from audit_log`;
  expect(entries).toHaveLength(1);
  expect(entries[0].action).toBe("book.created");
  expect(entries[0].entity_id).toBe(bookId);
  expect(entries[0].after.copyCodes).toEqual(["DT-0215", "DT-0216", "DT-0217"]);
});

test("a missing required field fails with OPS §4.1's own sentence", async () => {
  const { ctx } = await shelfWithManager();
  await expect(
    runCommand(sql, ctx, createBook, { ...BOOK, title: "  " }),
  ).rejects.toBeInstanceOf(ValidationFailed);
  await expect(
    runCommand(sql, ctx, createBook, { ...BOOK, author: "" }),
  ).rejects.toMatchObject({ code: "required_fields_missing" });
  await expect(
    runCommand(sql, ctx, createBook, { ...BOOK, categorySlug: "khong-co" }),
  ).rejects.toMatchObject({ code: "category_not_found" });
  expect(await sql`select 1 from books`).toHaveLength(0);
});

test("a duplicate ISBN on the same shelf is refused; the same ISBN elsewhere is not", async () => {
  const { ctx } = await shelfWithManager();
  await runCommand(sql, ctx, createBook, { ...BOOK, isbn: "978-604-2-12345-6" });

  await expect(
    runCommand(sql, ctx, createBook, {
      ...BOOK,
      title: "Khác",
      isbn: "978-604-2-12345-6",
    }),
  ).rejects.toMatchObject({ code: "duplicate_isbn" });

  // OPS §4.1 scopes it to "trong tủ sách" — another parish holding the same
  // title is not a conflict.
  const other = await shelfWithManager("can-tho");
  await expect(
    runCommand(sql, other.ctx, createBook, { ...BOOK, isbn: "978-604-2-12345-6" }),
  ).resolves.toMatchObject({ bookId: expect.any(String) });
});

test("a reader cannot catalogue a book", async () => {
  // BR §13.3: the screen hiding the button is not the security control.
  const { shelf, ctx } = await shelfWithManager();
  const reader = await makeMember(sql, shelf.id);
  const readerCtx: TenantContext = {
    ...ctx,
    actor: { userId: reader.userId, membershipId: reader.id, role: "reader" },
  };
  await expect(
    runCommand(sql, readerCtx, createBook, BOOK),
  ).rejects.toBeInstanceOf(RuleViolated);
  expect(await sql`select 1 from books`).toHaveLength(0);
});

test("AddCopies continues the same sequence and writes one audit row per copy", async () => {
  // OPS §4.1: "the record affected is singular per entry, so a batch of five
  // new copies is five audit rows".
  const { ctx } = await shelfWithManager();
  const { bookId } = await runCommand(sql, ctx, createBook, BOOK);
  await sql`delete from audit_log`;

  const { codes } = await runCommand(sql, ctx, addCopies, { bookId, count: 2 });

  expect(codes).toEqual(["DT-0218", "DT-0219"]);
  const entries = await sql<{ action: string; after: { code: string } }[]>`
    select action, after from audit_log order by id
  `;
  expect(entries.map((e) => e.action)).toEqual(["copy.added", "copy.added"]);
  expect(entries.map((e) => e.after.code)).toEqual(["DT-0218", "DT-0219"]);
});

test("AddCopies on an unknown book, and a count of zero, are named failures", async () => {
  const { ctx } = await shelfWithManager();
  const { bookId } = await runCommand(sql, ctx, createBook, BOOK);

  await expect(
    runCommand(sql, ctx, addCopies, {
      bookId: "00000000-0000-0000-0000-000000000000",
      count: 1,
    }),
  ).rejects.toBeInstanceOf(NotFound);
  await expect(
    runCommand(sql, ctx, addCopies, { bookId, count: 0 }),
  ).rejects.toMatchObject({ code: "copy_count_invalid" });
});

test("AddCopies cannot reach a book on another shelf", async () => {
  // G4. RLS filters the lookup to zero rows; the command must turn that into
  // book_not_found rather than inserting an orphan copy.
  const a = await shelfWithManager("dong-thap");
  const b = await shelfWithManager("can-tho");
  const { bookId } = await runCommand(sql, b.ctx, createBook, BOOK);

  await expect(
    runCommand(sql, a.ctx, addCopies, { bookId, count: 1 }),
  ).rejects.toBeInstanceOf(NotFound);
  expect(
    await sql`select 1 from book_copies where book_id = ${bookId}`,
  ).toHaveLength(3);
});

test("two managers cataloguing at once get different codes, not an error", async () => {
  // The race this slice exists to get right. Without the per-shelf advisory
  // lock in allocateCopyCodes, both transactions read the same max and one
  // loses to book_copies_code_unique with a raw 23505 — verified live. With
  // it, they queue and both commit.
  const { shelf, ctx } = await shelfWithManager();
  const { bookId } = await runCommand(sql, ctx, createBook, BOOK);

  await withTwoConnections(async (a, b) => {
    const results = await Promise.allSettled([
      runCommand(a, ctx, addCopies, { bookId, count: 2 }),
      runCommand(b, ctx, addCopies, { bookId, count: 2 }),
    ]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
  });

  const codes = await sql<{ code: string }[]>`
    select code from book_copies where bookshelf_id = ${shelf.id} order by code
  `;
  expect(codes.map((c) => c.code)).toEqual([
    "DT-0214", // the baseline copy shelfWithManager seeds
    "DT-0215", "DT-0216", "DT-0217", // createBook's three
    "DT-0218", "DT-0219", "DT-0220", "DT-0221", // two racing AddCopies calls
  ]);
});

test("a soft-deleted code is never handed out again", async () => {
  // book_copies_code_unique is partial (`where deleted_at is null`), so the
  // database would permit reuse. A code is a QR label stuck to a physical
  // book; the allocator scans every row, deleted or not.
  const { ctx } = await shelfWithManager();
  const { bookId } = await runCommand(sql, ctx, createBook, BOOK);
  await sql`update book_copies set deleted_at = now() where code = 'DT-0217'`;

  const { codes } = await runCommand(sql, ctx, addCopies, { bookId, count: 1 });
  expect(codes).toEqual(["DT-0218"]);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run test tests/domain/catalogue/create-book.test.ts`
Expected: FAIL — `Cannot find module '.../commands/create-book'`.

- [ ] **Step 3: Write the allocator**

Create `src/domain/catalogue/copy-codes.ts`:

```ts
import { NotFound } from "../kernel/errors";
import type { TenantContext } from "../kernel/tenant";
import type { Tx } from "../kernel/unit-of-work";
import { copyCodePrefix, formatCopyCode } from "./policy";

/**
 * Reserves the next `count` copy codes on this shelf, in order.
 *
 * **What makes this safe when two managers catalogue at the same second.**
 * `book_copies_code_unique` — `unique (bookshelf_id, code) where deleted_at
 * is null` — is the guarantee, and it works: probed live with two
 * connections racing a read-max-then-insert, one got `DT-0001` and the other
 * got `23505`. But a volunteer seeing "duplicate key value violates unique
 * constraint" for a race they did not cause is BR §2's "must fail cleanly
 * and see a plain message" being missed, and a retry loop around a failed
 * transaction is a lot of machinery for a shelf with two managers.
 *
 * `pg_advisory_xact_lock` is the cheaper answer: the second transaction
 * waits at this line, then reads a max that already includes the first one's
 * codes. The same probe with this line present produced `DT-0001` and
 * `DT-0002`, both committing. The lock is *transaction*-scoped, so the
 * kernel's commit or rollback releases it with nothing to remember, and it
 * is keyed on the shelf, so two parishes never queue behind each other.
 * `olibra_app` may call both `pg_advisory_xact_lock` and `hashtext` — checked
 * as that role, not assumed.
 *
 * The unique index stays the guarantee. This lock only stops the guarantee
 * from being experienced as an error message.
 *
 * **The scan deliberately does not filter `deleted_at is null`,** even
 * though the index does. A soft-deleted `DT-0215` is a code already printed
 * on a label and stuck to a physical book (BR §5.4: "intended to become a QR
 * label"); handing it out again is worse than leaving a gap in the sequence.
 */
export async function allocateCopyCodes(
  tx: Tx,
  ctx: TenantContext,
  count: number,
): Promise<string[]> {
  await tx`
    select pg_advisory_xact_lock(
      hashtext('olibra.copy_code'),
      hashtext(${ctx.bookshelfId})
    )
  `;

  const [shelf] = await tx<
    { slug: string; settings: Record<string, unknown> | null }[]
  >`select slug, settings from bookshelves where id = ${ctx.bookshelfId}`;
  if (!shelf) throw new NotFound("shelf_not_found");

  const prefix = copyCodePrefix(shelf);

  // `substring(code from '([0-9]+)$')` returns the capture group, or null for
  // a code that does not end in digits — `max` ignores those, so a shelf that
  // was imported with hand-written codes does not break the sequence.
  const [{ last }] = await tx<{ last: number }[]>`
    select coalesce(max(substring(code from '([0-9]+)$')::int), 0) as last
    from book_copies
    where bookshelf_id = ${ctx.bookshelfId}
      and code like ${prefix + "-%"}
  `;

  // Padded here, not with SQL's `lpad`, which truncates on the right — see
  // formatCopyCode's docstring.
  return Array.from({ length: count }, (_, i) => formatCopyCode(prefix, last + 1 + i));
}
```

- [ ] **Step 4: Write `create-book.ts`**

Create `src/domain/catalogue/commands/create-book.ts`:

```ts
import type { AuditEntry } from "../../kernel/audit";
import { NotFound, RuleViolated, ValidationFailed } from "../../kernel/errors";
import type { Command } from "../../kernel/unit-of-work";
import { allocateCopyCodes } from "../copy-codes";
import { requireManager, slugifyTitle } from "../policy";

export interface DonorInput {
  /** A member of this shelf, chosen from a search (DB §4.4). */
  donorMembershipId?: string | null;
  /** A typed name, for a donor with no account. Both may be present. */
  donorName?: string | null;
  /** `YYYY-MM-DD`. Defaults to today in Asia/Ho_Chi_Minh (G6). */
  acquiredOn?: string | null;
}

export interface CreateBookInput extends DonorInput {
  title: string;
  author: string;
  /**
   * `categories.slug`, not a name and not an id. `categories` is a *global*
   * table (DB §4.3) with a plain `unique (slug)`, so the slug is the stable
   * handle a form can post.
   */
  categorySlug: string;
  publisher?: string | null;
  publishedYear?: number | null;
  pageCount?: number | null;
  isbn?: string | null;
  description?: string | null;
  coverUrl?: string | null;
  language?: string;
  published?: boolean;
  copyCount: number;
}

const blank = (v: string | null | undefined) => !v || v.trim() === "";

/**
 * Catalogues a title together with its first copies, in one transaction.
 *
 * OPS §1 is explicit that this is *one* business fact, not two commands
 * stitched together: "a book with zero copies is not yet meaningfully
 * catalogued". That is why there is one audit entry, `book.created`, with the
 * codes it produced in `after` — rather than one entry per copy, which is
 * what `AddCopies` does, because there the copies *are* the fact.
 */
export const createBook: Command<
  CreateBookInput,
  { bookId: string; copyIds: string[] }
> = async (tx, ctx, input) => {
  requireManager(ctx);

  if (blank(input.title) || blank(input.author) || blank(input.categorySlug)) {
    throw new ValidationFailed("required_fields_missing", "title");
  }
  if (!Number.isInteger(input.copyCount) || input.copyCount < 1) {
    throw new ValidationFailed("copy_count_invalid", "copyCount");
  }

  const [category] = await tx<{ id: string }[]>`
    select id from categories
    where slug = ${input.categorySlug} and deleted_at is null
  `;
  if (!category) throw new ValidationFailed("category_not_found", "categorySlug");

  if (!blank(input.isbn)) {
    // No unique index backs this — `duplicate_isbn` is a check-then-write.
    // The window is closed against another CreateBook on the same shelf by
    // the advisory lock `allocateCopyCodes` takes below, which serialises
    // this whole command per shelf. See the plan's "Known gaps" for why a
    // partial unique index would be the structural fix and why it is not
    // here.
    const clash = await tx`
      select 1 from books
      where bookshelf_id = ${ctx.bookshelfId}
        and isbn = ${input.isbn!}
        and deleted_at is null
    `;
    if (clash.length > 0) throw new RuleViolated("duplicate_isbn");
  }

  const codes = await allocateCopyCodes(tx, ctx, input.copyCount);

  const [book] = await tx<{ id: string; slug: string }[]>`
    insert into books (
      bookshelf_id, category_id, title, slug, author, publisher,
      published_year, page_count, isbn, description, cover_url,
      language, is_published, added_by
    ) values (
      ${ctx.bookshelfId}, ${category.id}, ${input.title.trim()},
      ${slugifyTitle(input.title)}, ${input.author.trim()},
      ${input.publisher ?? null}, ${input.publishedYear ?? null},
      ${input.pageCount ?? null}, ${input.isbn ?? null},
      ${input.description ?? null}, ${input.coverUrl ?? null},
      ${input.language ?? "vi"}, ${input.published ?? true},
      ${ctx.actor.userId}
    )
    returning id, slug
  `;

  const copies = await tx<{ id: string }[]>`
    insert into book_copies (
      bookshelf_id, book_id, code, state, condition,
      acquired_on, acquired_from, acquired_from_membership_id
    )
    select
      ${ctx.bookshelfId}, ${book.id}, c, 'available', 'perfect',
      ${input.acquiredOn ?? ctx.clock.today()}::date,
      ${input.donorName ?? null},
      ${input.donorMembershipId ?? null}
    from unnest(${codes}::text[]) as c
    returning id
  `;

  const audit: AuditEntry = {
    action: "book.created",
    entityType: "book",
    entityId: book.id,
    after: {
      title: input.title.trim(),
      slug: book.slug,
      author: input.author.trim(),
      category: input.categorySlug,
      isbn: input.isbn ?? null,
      isPublished: input.published ?? true,
      copyCodes: codes,
    },
  };

  return { result: { bookId: book.id, copyIds: copies.map((c) => c.id) }, audit };
};
```

Two notes for whoever implements this. The `unnest(${codes}::text[])` form was probed live and inserts all three rows in one statement as `olibra_app`; a `for` loop would also work but issues one round trip per copy. And `NotFound` is imported but unused here — it is used by `add-copies.ts`; drop it from this file's imports.

- [ ] **Step 5: Write `add-copies.ts`**

Create `src/domain/catalogue/commands/add-copies.ts`:

```ts
import type { AuditEntry } from "../../kernel/audit";
import { NotFound, ValidationFailed } from "../../kernel/errors";
import type { Command } from "../../kernel/unit-of-work";
import { allocateCopyCodes } from "../copy-codes";
import { requireManager } from "../policy";
import type { DonorInput } from "./create-book";

export interface AddCopiesInput extends DonorInput {
  bookId: string;
  count: number;
}

/**
 * Adds physical copies to an already-catalogued title.
 *
 * Separate from `CreateBook` for the reason OPS §4.1 gives and BR §16.3
 * repeats: "a second donated copy of a popular book arrives months after the
 * first, and editing the title is not where a volunteer would look for that."
 * Its donor fields are its own, not the title's — the second copy's giver is
 * frequently not the first copy's.
 *
 * One audit entry per copy, per OPS §4.1: "the record affected is singular
 * per entry, so a batch of five new copies is five audit rows".
 */
export const addCopies: Command<
  AddCopiesInput,
  { copyIds: string[]; codes: string[] }
> = async (tx, ctx, input) => {
  requireManager(ctx);

  if (!Number.isInteger(input.count) || input.count < 1) {
    throw new ValidationFailed("copy_count_invalid", "count");
  }

  // Scoped by RLS to this shelf, so a book on another shelf is simply not
  // here — which is the right answer to give (OPS §2), not a different one.
  const [book] = await tx<{ id: string }[]>`
    select id from books where id = ${input.bookId} and deleted_at is null
  `;
  if (!book) throw new NotFound("book_not_found");

  const codes = await allocateCopyCodes(tx, ctx, input.count);
  const acquiredOn = input.acquiredOn ?? ctx.clock.today();

  const copies = await tx<{ id: string; code: string }[]>`
    insert into book_copies (
      bookshelf_id, book_id, code, state, condition,
      acquired_on, acquired_from, acquired_from_membership_id
    )
    select
      ${ctx.bookshelfId}, ${book.id}, c, 'available', 'perfect',
      ${acquiredOn}::date, ${input.donorName ?? null},
      ${input.donorMembershipId ?? null}
    from unnest(${codes}::text[]) as c
    returning id, code
  `;

  const audit: AuditEntry[] = copies.map((copy) => ({
    action: "copy.added",
    entityType: "copy",
    entityId: copy.id,
    after: {
      code: copy.code,
      bookId: book.id,
      state: "available",
      acquiredOn,
      acquiredFrom: input.donorName ?? null,
      acquiredFromMembershipId: input.donorMembershipId ?? null,
    },
  }));

  return { result: { copyIds: copies.map((c) => c.id), codes }, audit };
};
```

- [ ] **Step 6: Run it to verify it passes**

Run: `bun run test tests/domain/catalogue/create-book.test.ts`
Expected: PASS, all fourteen. If the concurrency test hangs rather than failing, the advisory lock is being taken *outside* the kernel's transaction — it must be the first statement inside `allocateCopyCodes`, which runs on the `tx` the kernel supplies.

- [ ] **Step 7: Commit**

```bash
git add src/domain/catalogue/copy-codes.ts src/domain/catalogue/commands/create-book.ts \
        src/domain/catalogue/commands/add-copies.ts tests/domain/catalogue/create-book.test.ts
git commit -m "feat(catalogue): CreateBook and AddCopies, with per-shelf code allocation"
```

---

## Task 3: `UpdateBook` and `DeleteBook` — the title's own lifecycle

Both act on a title rather than a copy, both share a fixture (one book with three copies, one of them out), and `DeleteBook` is Q7.

**Files:**
- Create: `src/domain/catalogue/commands/update-book.ts`, `src/domain/catalogue/commands/delete-book.ts`
- Test: `tests/domain/catalogue/book-lifecycle.test.ts`

**Interfaces:**

- Consumes: everything Task 2 consumes, plus `assertWritten` (`src/domain/kernel/unit-of-work`).
- Produces:
  ```ts
  export interface UpdateBookInput {
    bookId: string;
    title?: string;
    author?: string;
    categorySlug?: string;
    publisher?: string | null;
    publishedYear?: number | null;
    pageCount?: number | null;
    isbn?: string | null;
    description?: string | null;
    coverUrl?: string | null;
    language?: string;
    /** BR §5.4's "published flag (hides drafts from the public)". */
    published?: boolean;
  }
  export const updateBook: Command<UpdateBookInput, void>;

  export const deleteBook: Command<
    { bookId: string },
    { copiesDeleted: number; copiesRetained: number }
  >;
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/domain/catalogue/book-lifecycle.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { fixedClock } from "../../../src/domain/kernel/clock";
import { NotFound, RuleViolated } from "../../../src/domain/kernel/errors";
import { runCommand } from "../../../src/domain/kernel/unit-of-work";
import type { TenantContext } from "../../../src/domain/kernel/tenant";
import { updateBook } from "../../../src/domain/catalogue/commands/update-book";
import { deleteBook } from "../../../src/domain/catalogue/commands/delete-book";
import { migrate } from "../../../src/db/migrate";
import { makeBookWithCopies, makeMember, makeShelf } from "../../support/factories";
import { closeAll, resetDatabase, sql } from "../../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

const clock = fixedClock("2026-08-08T03:00:00Z");

async function catalogued(copies = 3) {
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  const manager = await makeMember(sql, shelf.id, { role: "manager" });
  const { bookId, copyIds } = await makeBookWithCopies(sql, shelf.id, copies);
  const ctx: TenantContext = {
    bookshelfId: shelf.id,
    actor: { userId: manager.userId, membershipId: manager.id, role: "manager" },
    clock,
  };
  return { shelf, manager, ctx, bookId, copyIds };
}

/** A loan row, written directly — LendCopy is C1, and this slice must not wait for it. */
async function lend(shelfId: string, bookId: string, copyId: string, lentBy: string) {
  const borrower = await makeMember(sql, shelfId);
  const [loan] = await sql<{ id: string }[]>`
    insert into loans (bookshelf_id, copy_id, book_id, borrower_id, lent_by, due_on)
    values (${shelfId}, ${copyId}, ${bookId}, ${borrower.userId}, ${lentBy}, date '2026-08-22')
    returning id
  `;
  await sql`update book_copies set state = 'on_loan' where id = ${copyId}`;
  return loan.id;
}

test("UpdateBook writes only the fields it was given, and audits before and after", async () => {
  const { ctx, bookId } = await catalogued();

  await runCommand(sql, ctx, updateBook, {
    bookId,
    title: "Dế Mèn Phiêu Lưu Ký",
    published: false,
  });

  const [row] = await sql<
    { title: string; author: string; is_published: boolean; slug: string }[]
  >`select title, author, is_published, slug from books where id = ${bookId}`;
  expect(row.title).toBe("Dế Mèn Phiêu Lưu Ký");
  expect(row.is_published).toBe(false);
  // Untouched, because the input did not name it.
  expect(row.author).toBe("Tô Hoài");

  const [entry] = await sql<
    { action: string; before: Record<string, unknown>; after: Record<string, unknown> }[]
  >`select action, before, after from audit_log where action = 'book.updated'`;
  expect(entry.before).toMatchObject({ isPublished: true });
  expect(entry.after).toMatchObject({ title: "Dế Mèn Phiêu Lưu Ký", isPublished: false });
});

test("UpdateBook does not move the slug out from under an existing link", async () => {
  // BR §16.4 fixes a *bookshelf's* slug after creation and the database
  // enforces it (`bookshelves_no_slug_change`). Nothing says the same of a
  // book — but `books.slug` is what /tu-sach/[shelf]/sach/[slug] resolves,
  // and silently rewriting it turns every shared link into a 404. Renaming a
  // title is a metadata edit, not a re-cataloguing; the slug is decided once,
  // by CreateBook.
  const { ctx, bookId } = await catalogued();
  const [before] = await sql<{ slug: string }[]>`select slug from books where id = ${bookId}`;

  await runCommand(sql, ctx, updateBook, { bookId, title: "Một Tên Hoàn Toàn Khác" });

  const [after] = await sql<{ slug: string }[]>`select slug from books where id = ${bookId}`;
  expect(after.slug).toBe(before.slug);
});

test("UpdateBook on another shelf's book is not-found, not a silent no-op", async () => {
  // The exact failure the kernel's guarded Tx exists for: RLS filters an
  // UPDATE to zero rows rather than raising, so without the guard this
  // resolves having changed nothing while committing an audit row that says
  // it did.
  const a = await catalogued();
  const b = await catalogued();

  await expect(
    runCommand(sql, a.ctx, updateBook, { bookId: b.bookId, title: "HACKED" }),
  ).rejects.toBeInstanceOf(NotFound);

  const [row] = await sql<{ title: string }[]>`select title from books where id = ${b.bookId}`;
  expect(row.title).not.toBe("HACKED");
  expect(await sql`select 1 from audit_log`).toHaveLength(0);
});

test("UpdateBook refuses an ISBN already used on this shelf", async () => {
  const { ctx, bookId } = await catalogued();
  const other = await makeBookWithCopies(sql, ctx.bookshelfId, 1);
  await sql`update books set isbn = '978-604-2-12345-6' where id = ${other.bookId}`;

  await expect(
    runCommand(sql, ctx, updateBook, { bookId, isbn: "978-604-2-12345-6" }),
  ).rejects.toMatchObject({ code: "duplicate_isbn" });
});

test("Q7: DeleteBook soft-deletes the book and the copies that have no history", async () => {
  // BR §11: "Only a book's copies follow it when the book itself goes."
  // Nothing is hard-deleted — olibra_app holds no DELETE privilege at all.
  const { ctx, bookId } = await catalogued(3);

  const result = await runCommand(sql, ctx, deleteBook, { bookId });

  expect(result).toEqual({ copiesDeleted: 3, copiesRetained: 0 });
  const [book] = await sql<{ deleted_at: Date | null }[]>`
    select deleted_at from books where id = ${bookId}
  `;
  expect(book.deleted_at).not.toBeNull();
  const copies = await sql<{ deleted_at: Date | null }[]>`
    select deleted_at from book_copies where book_id = ${bookId}
  `;
  expect(copies.every((c) => c.deleted_at !== null)).toBe(true);
});

test("a copy with loan history is retained, not deleted, and the count says so", async () => {
  // BR §11: "A copy with loan history cannot be removed." OPS §4.1 files
  // `copy_has_history` under Failure modes but describes a retention rule;
  // this plan implements the rule, so the command reports what it did rather
  // than refusing the whole delete.
  const { ctx, shelf, manager, bookId, copyIds } = await catalogued(3);
  const loanId = await lend(shelf.id, bookId, copyIds[0], manager.userId);
  await sql`
    update loans set status = 'returned', returned_at = now(),
                     received_by = ${manager.userId}, return_condition = 'perfect'
    where id = ${loanId}
  `;
  await sql`update book_copies set state = 'available' where id = ${copyIds[0]}`;

  const result = await runCommand(sql, ctx, deleteBook, { bookId });

  expect(result).toEqual({ copiesDeleted: 2, copiesRetained: 1 });
  const [kept] = await sql<{ deleted_at: Date | null }[]>`
    select deleted_at from book_copies where id = ${copyIds[0]}
  `;
  expect(kept.deleted_at).toBeNull();
});

test("DeleteBook refuses while a copy is out or held", async () => {
  // OPS §4.1: has_active_loans — "Không thể xoá sách đang có bản được mượn."
  const { ctx, shelf, manager, bookId, copyIds } = await catalogued(2);
  await lend(shelf.id, bookId, copyIds[0], manager.userId);

  await expect(
    runCommand(sql, ctx, deleteBook, { bookId }),
  ).rejects.toMatchObject({ code: "has_active_loans" });

  const [book] = await sql<{ deleted_at: Date | null }[]>`
    select deleted_at from books where id = ${bookId}
  `;
  expect(book.deleted_at).toBeNull();

  // `held` counts too, for the reader waiting on the hold.
  await sql`update book_copies set state = 'available' where id = ${copyIds[0]}`;
  await sql`update loans set status = 'voided', void_reason = 'x' where book_id = ${bookId}`;
  await sql`update book_copies set state = 'held' where id = ${copyIds[1]}`;
  await expect(
    runCommand(sql, ctx, deleteBook, { bookId }),
  ).rejects.toMatchObject({ code: "has_active_loans" });
});

test("DeleteBook audits the delete with the retention it performed", async () => {
  const { ctx, bookId } = await catalogued(2);
  await runCommand(sql, ctx, deleteBook, { bookId });

  const [entry] = await sql<
    { action: string; entity_id: string; after: { copiesDeleted: number } }[]
  >`select action, entity_id, after from audit_log where action = 'book.deleted'`;
  expect(entry.entity_id).toBe(bookId);
  expect(entry.after.copiesDeleted).toBe(2);
});

test("a reader can neither edit nor delete", async () => {
  const { ctx, shelf, bookId } = await catalogued(1);
  const reader = await makeMember(sql, shelf.id);
  const readerCtx: TenantContext = {
    ...ctx,
    actor: { userId: reader.userId, membershipId: reader.id, role: "reader" },
  };
  await expect(
    runCommand(sql, readerCtx, updateBook, { bookId, title: "x" }),
  ).rejects.toBeInstanceOf(RuleViolated);
  await expect(
    runCommand(sql, readerCtx, deleteBook, { bookId }),
  ).rejects.toBeInstanceOf(RuleViolated);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run test tests/domain/catalogue/book-lifecycle.test.ts`
Expected: FAIL — both command modules are missing.

- [ ] **Step 3: Write `update-book.ts`**

Create `src/domain/catalogue/commands/update-book.ts`:

```ts
import { NotFound, RuleViolated, ValidationFailed } from "../../kernel/errors";
import type { Command } from "../../kernel/unit-of-work";
import { assertWritten } from "../../kernel/unit-of-work";
import { requireManager } from "../policy";

export interface UpdateBookInput {
  bookId: string;
  title?: string;
  author?: string;
  categorySlug?: string;
  publisher?: string | null;
  publishedYear?: number | null;
  pageCount?: number | null;
  isbn?: string | null;
  description?: string | null;
  coverUrl?: string | null;
  language?: string;
  /** BR §5.4's published flag, which hides a draft from the shelf's catalogue. */
  published?: boolean;
}

/**
 * Edits a title's metadata.
 *
 * **`slug` is not editable, deliberately.** It is what
 * `/tu-sach/[shelf]/sach/[slug]` resolves, and rewriting it when a manager
 * fixes a typo in a title turns every link anyone has shared into a 404.
 * BR §16.4 fixes a *bookshelf's* slug for the same reason and the database
 * enforces that one with a trigger; nothing says the same of a book, so this
 * is a decision recorded here rather than a rule being restated. If a
 * deliberate re-slug is ever wanted it should be its own command with its own
 * audit action, not a side effect of a metadata edit.
 *
 * Every column is written in one statement, with `coalesce` doing the
 * "only if supplied" work, so there is no dynamic SQL assembly to get wrong.
 * The nullable columns take an explicit `undefined` check rather than
 * `coalesce`, because `null` is a meaningful value for them — clearing an
 * ISBN is an edit, not an omission.
 */
export const updateBook: Command<UpdateBookInput, void> = async (tx, ctx, input) => {
  requireManager(ctx);

  const [before] = await tx<
    {
      title: string;
      author: string | null;
      isbn: string | null;
      is_published: boolean;
      category_id: string | null;
    }[]
  >`
    select title, author, isbn, is_published, category_id
    from books where id = ${input.bookId} and deleted_at is null
  `;
  if (!before) throw new NotFound("book_not_found");

  if (input.title !== undefined && input.title.trim() === "") {
    throw new ValidationFailed("validation_failed", "title");
  }
  if (input.author !== undefined && input.author.trim() === "") {
    throw new ValidationFailed("validation_failed", "author");
  }

  let categoryId = before.category_id;
  if (input.categorySlug !== undefined) {
    const [category] = await tx<{ id: string }[]>`
      select id from categories where slug = ${input.categorySlug} and deleted_at is null
    `;
    if (!category) throw new ValidationFailed("category_not_found", "categorySlug");
    categoryId = category.id;
  }

  if (input.isbn !== undefined && input.isbn !== null && input.isbn !== before.isbn) {
    const clash = await tx`
      select 1 from books
      where bookshelf_id = ${ctx.bookshelfId}
        and isbn = ${input.isbn}
        and id <> ${input.bookId}
        and deleted_at is null
    `;
    if (clash.length > 0) throw new RuleViolated("duplicate_isbn");
  }

  const result = await tx`
    update books set
      category_id    = ${categoryId},
      title          = coalesce(${input.title ?? null}, title),
      author         = coalesce(${input.author ?? null}, author),
      publisher      = ${input.publisher !== undefined ? input.publisher : undefined},
      published_year = ${input.publishedYear !== undefined ? input.publishedYear : undefined},
      page_count     = ${input.pageCount !== undefined ? input.pageCount : undefined},
      isbn           = ${input.isbn !== undefined ? input.isbn : undefined},
      description    = ${input.description !== undefined ? input.description : undefined},
      cover_url      = ${input.coverUrl !== undefined ? input.coverUrl : undefined},
      language       = coalesce(${input.language ?? null}, language),
      is_published   = coalesce(${input.published ?? null}, is_published)
    where id = ${input.bookId} and deleted_at is null
  `.allowZero();
  assertWritten(result, "book_not_found");

  return {
    result: undefined,
    audit: {
      action: "book.updated",
      entityType: "book",
      entityId: input.bookId,
      before: {
        title: before.title,
        author: before.author,
        isbn: before.isbn,
        isPublished: before.is_published,
      },
      after: {
        title: input.title?.trim() ?? before.title,
        author: input.author?.trim() ?? before.author,
        isbn: input.isbn !== undefined ? input.isbn : before.isbn,
        isPublished: input.published ?? before.is_published,
      },
    },
  };
};
```

> **Implementer's note, and the one thing to check first.** The
> `${x !== undefined ? x : undefined}` idiom above is written for readability,
> but `postgres` (porsager) serialises a JavaScript `undefined` as SQL `null`,
> which would *clear* a column the caller never mentioned. Verify this against
> the driver before trusting the listing — a two-line probe inside a
> `runCommand` is enough. If it does bind as `null`, replace those five lines
> with the explicit form used for `title`: read the current value in the
> `select` above and write `${input.publisher !== undefined ? input.publisher :
> before.publisher}`. The test "UpdateBook writes only the fields it was given"
> is what catches this; extend it to assert `publisher` survives an update that
> does not name it, because the version above passes that test on `author`
> (which uses `coalesce`) while still being wrong for `publisher`.

- [ ] **Step 4: Write `delete-book.ts`**

Create `src/domain/catalogue/commands/delete-book.ts`:

```ts
import { NotFound, RuleViolated } from "../../kernel/errors";
import type { Command } from "../../kernel/unit-of-work";
import { requireManager } from "../policy";

/**
 * Soft-deletes a title and the copies that may follow it.
 *
 * **Q7, decided in this plan: implemented now, unexposed until E designs a
 * confirmation flow.** BR §13.2 grants the permission and BR §11 writes the
 * policy; leaving the command unwritten means the next person to want it
 * re-derives the copy-retention rule with no test to check them against.
 *
 * **`copy_has_history` is a retention rule, not a throw.** OPS §4.1 lists it
 * under Failure modes but describes it as "a copy with loan history is
 * retained rather than deleted", and BR §11's sentence — "A copy with loan
 * history cannot be removed." — is about the copy, not the book. So the book
 * goes, the copies with no history go with it (BR §11: "Only a book's copies
 * follow it when the book itself goes"), and the ones with history stay
 * exactly where they are. The counts are returned and audited so the screen
 * can say what happened rather than implying a clean sweep. No
 * `copy_has_history` error code exists, because nothing would ever throw it.
 *
 * Nothing here is a hard delete, and could not be: `olibra_app` holds no
 * `DELETE` privilege on `books` or `book_copies` (verified against
 * `information_schema.role_table_grants`).
 */
export const deleteBook: Command<
  { bookId: string },
  { copiesDeleted: number; copiesRetained: number }
> = async (tx, ctx, input) => {
  requireManager(ctx);

  const [book] = await tx<{ id: string; title: string }[]>`
    select id, title from books where id = ${input.bookId} and deleted_at is null
  `;
  if (!book) throw new NotFound("book_not_found");

  const busy = await tx`
    select 1 from book_copies
    where book_id = ${book.id}
      and deleted_at is null
      and state in ('on_loan', 'held')
  `;
  if (busy.length > 0) throw new RuleViolated("has_active_loans");

  // A copy is "with history" if any loan row references it — including a
  // returned or voided one. Loans are never deleted (INV-11), so this is the
  // permanent record BR §11 means.
  const deleted = await tx`
    update book_copies set deleted_at = now()
    where book_id = ${book.id}
      and deleted_at is null
      and not exists (select 1 from loans l where l.copy_id = book_copies.id)
  `.allowZero();

  const [{ retained }] = await tx<{ retained: number }[]>`
    select count(*)::int as retained from book_copies
    where book_id = ${book.id} and deleted_at is null
  `;

  await tx`update books set deleted_at = now() where id = ${book.id}`;

  const copiesDeleted = deleted.count ?? 0;

  return {
    result: { copiesDeleted, copiesRetained: retained },
    audit: {
      action: "book.deleted",
      entityType: "book",
      entityId: book.id,
      before: { title: book.title, deletedAt: null },
      after: { deletedAt: ctx.clock.now().toISOString(), copiesDeleted, copiesRetained: retained },
    },
  };
};
```

- [ ] **Step 5: Run it to verify it passes, then commit**

Run: `bun run test tests/domain/catalogue/book-lifecycle.test.ts`

```bash
git add src/domain/catalogue/commands/update-book.ts \
        src/domain/catalogue/commands/delete-book.ts \
        tests/domain/catalogue/book-lifecycle.test.ts
git commit -m "feat(catalogue): UpdateBook and DeleteBook, with BR §11's copy retention"
```

---

## Task 4: the four copy-state commands, and INV-7

`AssessCondition`, `ReportCopyLost`, `MarkCopyFound` and `RetireCopy` all read a copy, ask `copyStateTransition` (or, for `AssessCondition`, do not — a condition is not a state), write one row, and audit. One fixture serves all four, and Q3 lives here.

**Files:**
- Create: `src/domain/catalogue/commands/{assess-condition,report-copy-lost,mark-copy-found,retire-copy}.ts`
- Test: `tests/domain/catalogue/copy-state.test.ts`, `tests/invariants/inv-07-lost-or-retired-not-lendable.test.ts`

**Interfaces:**

- Consumes: `copyStateTransition`, `isCopyCondition`, `requireManager`, `CopyCondition`, `CopyState` (`../policy`); `RuleViolated`, `NotFound`, `ValidationFailed`.
- Produces:
  ```ts
  export const assessCondition: Command<
    { copyId: string; condition: CopyCondition; note?: string | null; photoUrl?: string | null },
    { assessmentId: string }
  >;
  export const reportCopyLost: Command<{ copyId: string; note?: string | null }, void>;
  export const markCopyFound: Command<{ copyId: string; note?: string | null }, void>;
  export const retireCopy: Command<{ copyId: string; reason: string }, void>;
  // effective call: runCommand(sql, ctx, retireCopy, { copyId, reason })
  //   -> Promise<void>   (master §7.1)
  ```

- [ ] **Step 1: Write the failing tests**

Create `tests/domain/catalogue/copy-state.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { fixedClock } from "../../../src/domain/kernel/clock";
import { NotFound, RuleViolated, ValidationFailed } from "../../../src/domain/kernel/errors";
import { runCommand } from "../../../src/domain/kernel/unit-of-work";
import type { TenantContext } from "../../../src/domain/kernel/tenant";
import { assessCondition } from "../../../src/domain/catalogue/commands/assess-condition";
import { reportCopyLost } from "../../../src/domain/catalogue/commands/report-copy-lost";
import { markCopyFound } from "../../../src/domain/catalogue/commands/mark-copy-found";
import { retireCopy } from "../../../src/domain/catalogue/commands/retire-copy";
import { migrate } from "../../../src/db/migrate";
import { makeBookWithCopies, makeMember, makeShelf } from "../../support/factories";
import { closeAll, resetDatabase, sql } from "../../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

const clock = fixedClock("2026-08-08T03:00:00Z");

async function onTheShelf(copies = 2) {
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  const manager = await makeMember(sql, shelf.id, { role: "manager" });
  const { bookId, copyIds } = await makeBookWithCopies(sql, shelf.id, copies);
  const ctx: TenantContext = {
    bookshelfId: shelf.id,
    actor: { userId: manager.userId, membershipId: manager.id, role: "manager" },
    clock,
  };
  return { shelf, manager, ctx, bookId, copyIds };
}

async function lendOut(shelfId: string, bookId: string, copyId: string, lentBy: string) {
  const borrower = await makeMember(sql, shelfId);
  const [loan] = await sql<{ id: string }[]>`
    insert into loans (bookshelf_id, copy_id, book_id, borrower_id, lent_by, due_on)
    values (${shelfId}, ${copyId}, ${bookId}, ${borrower.userId}, ${lentBy}, date '2026-08-22')
    returning id
  `;
  await sql`update book_copies set state = 'on_loan' where id = ${copyId}`;
  return loan.id;
}

const stateOf = async (copyId: string) =>
  (
    await sql<{ state: string }[]>`select state from book_copies where id = ${copyId}`
  )[0].state;

// — AssessCondition —

test("a manager may assess a copy at any time, not only at return", async () => {
  // BR §5.4, and why ConditionAssessment is its own table rather than columns
  // on the loan. The copy is available and there is no loan in sight.
  const { ctx, copyIds } = await onTheShelf();

  const { assessmentId } = await runCommand(sql, ctx, assessCondition, {
    copyId: copyIds[0],
    condition: "torn",
    note: "Bìa bị rách góc dưới",
  });

  const [row] = await sql<
    { condition: string; note: string; loan_id: string | null; assessed_by: string }[]
  >`select condition, note, loan_id, assessed_by from condition_assessments where id = ${assessmentId}`;
  expect(row.condition).toBe("torn");
  expect(row.loan_id).toBeNull();
  expect(row.assessed_by).toBe(ctx.actor.userId);

  // The current condition moves with it; the assessment is the history.
  const [copy] = await sql<{ condition: string; condition_note: string; state: string }[]>`
    select condition, condition_note, state from book_copies where id = ${copyIds[0]}
  `;
  expect(copy.condition).toBe("torn");
  expect(copy.condition_note).toBe("Bìa bị rách góc dưới");
  // A condition is not a state (BR §9). Assessing does not move the copy.
  expect(copy.state).toBe("available");
});

test("assessing writes copy.condition_assessed with before and after", async () => {
  const { ctx, copyIds } = await onTheShelf();
  await runCommand(sql, ctx, assessCondition, { copyId: copyIds[0], condition: "worn" });

  const [entry] = await sql<
    { action: string; before: { condition: string }; after: { condition: string } }[]
  >`select action, before, after from audit_log where action = 'copy.condition_assessed'`;
  expect(entry.before.condition).toBe("perfect");
  expect(entry.after.condition).toBe("worn");
});

test("a condition outside BR §9's six is a named validation failure, not a driver error", async () => {
  // Without this check the enum cast raises PostgresError 22P02 from inside
  // the transaction — a raw failure at the kernel boundary, which OPS §2
  // forbids.
  const { ctx, copyIds } = await onTheShelf();
  await expect(
    runCommand(sql, ctx, assessCondition, {
      copyId: copyIds[0],
      condition: "lost" as never,
    }),
  ).rejects.toBeInstanceOf(ValidationFailed);
});

test("assessing an unknown copy is copy_not_found", async () => {
  const { ctx } = await onTheShelf();
  await expect(
    runCommand(sql, ctx, assessCondition, {
      copyId: "00000000-0000-0000-0000-000000000000",
      condition: "worn",
    }),
  ).rejects.toMatchObject({ code: "copy_not_found" });
});

// — ReportCopyLost —

test("reporting an on-loan copy lost closes its loan in the same transaction", async () => {
  // OPS §4.1: "if the copy has an active loan, that loan is closed out
  // (loan.status = lost, not left dangling as active)".
  const { ctx, shelf, manager, bookId, copyIds } = await onTheShelf();
  const loanId = await lendOut(shelf.id, bookId, copyIds[0], manager.userId);

  await runCommand(sql, ctx, reportCopyLost, { copyId: copyIds[0], note: "Cháu để quên ở lớp" });

  expect(await stateOf(copyIds[0])).toBe("lost");
  const [copy] = await sql<{ lost_reported_at: Date | null }[]>`
    select lost_reported_at from book_copies where id = ${copyIds[0]}
  `;
  expect(copy.lost_reported_at).not.toBeNull();

  const [loan] = await sql<
    { status: string; lost_reported_by: string | null }[]
  >`select status, lost_reported_by from loans where id = ${loanId}`;
  expect(loan.status).toBe("lost");
  expect(loan.lost_reported_by).toBe(ctx.actor.userId);
});

test("two audit entries, because two things changed state", async () => {
  // INV-8: "every state transition writes an audit record". OPS §4.1 names
  // copy.lost_reported; the loan's own transition earns its own row.
  const { ctx, shelf, manager, bookId, copyIds } = await onTheShelf();
  await lendOut(shelf.id, bookId, copyIds[0], manager.userId);

  await runCommand(sql, ctx, reportCopyLost, { copyId: copyIds[0] });

  const actions = await sql<{ action: string }[]>`select action from audit_log order by id`;
  expect(actions.map((a) => a.action)).toEqual(["copy.lost_reported", "loan.lost"]);
});

test("Q3: an available copy cannot be reported lost", async () => {
  // The decision this plan records. BR §7.1 draws only on_loan → lost; the
  // manager screen's "Báo mất" on every row is an unwired fixture, and E must
  // hide it on any row that is not on_loan.
  const { ctx, copyIds } = await onTheShelf();

  await expect(
    runCommand(sql, ctx, reportCopyLost, { copyId: copyIds[0] }),
  ).rejects.toMatchObject({ code: "copy_not_on_loan" });
  expect(await stateOf(copyIds[0])).toBe("available");
});

test("an already-lost or already-retired copy says which, not just no", async () => {
  const { ctx, shelf, manager, bookId, copyIds } = await onTheShelf(2);
  await lendOut(shelf.id, bookId, copyIds[0], manager.userId);
  await runCommand(sql, ctx, reportCopyLost, { copyId: copyIds[0] });
  await runCommand(sql, ctx, retireCopy, { copyId: copyIds[1], reason: "Mục nát" });

  await expect(
    runCommand(sql, ctx, reportCopyLost, { copyId: copyIds[0] }),
  ).rejects.toMatchObject({ code: "already_lost" });
  await expect(
    runCommand(sql, ctx, reportCopyLost, { copyId: copyIds[1] }),
  ).rejects.toMatchObject({ code: "already_retired" });
});

// — MarkCopyFound —

test("a lost copy that turns up goes back to available", async () => {
  // BR §3 lists "a book reported lost is found months later" as a case the
  // system must handle, and BR §16.3 built the Sách đã mất screen for it.
  const { ctx, shelf, manager, bookId, copyIds } = await onTheShelf();
  await lendOut(shelf.id, bookId, copyIds[0], manager.userId);
  await runCommand(sql, ctx, reportCopyLost, { copyId: copyIds[0] });

  await runCommand(sql, ctx, markCopyFound, { copyId: copyIds[0], note: "Tìm thấy ở nhà xứ" });

  expect(await stateOf(copyIds[0])).toBe("available");
  const [copy] = await sql<{ lost_reported_at: Date | null }[]>`
    select lost_reported_at from book_copies where id = ${copyIds[0]}
  `;
  // Cleared, so the copy is not still described as reported-lost on a screen
  // that reads that column.
  expect(copy.lost_reported_at).toBeNull();
  const [entry] = await sql<{ action: string }[]>`
    select action from audit_log where action = 'copy.found'
  `;
  expect(entry.action).toBe("copy.found");
});

test("marking a copy found when it is not lost says so", async () => {
  const { ctx, copyIds } = await onTheShelf();
  await expect(
    runCommand(sql, ctx, markCopyFound, { copyId: copyIds[0] }),
  ).rejects.toMatchObject({ code: "not_lost" });
});

test("the loan a found copy came from is not reopened", async () => {
  // BR §7.1 draws lost → available for the *copy*. The loan's own machine
  // (BR §7.3) has no arrow out of lost, and INV-11 forbids deleting it. What
  // happened, happened.
  const { ctx, shelf, manager, bookId, copyIds } = await onTheShelf();
  const loanId = await lendOut(shelf.id, bookId, copyIds[0], manager.userId);
  await runCommand(sql, ctx, reportCopyLost, { copyId: copyIds[0] });
  await runCommand(sql, ctx, markCopyFound, { copyId: copyIds[0] });

  const [loan] = await sql<{ status: string }[]>`select status from loans where id = ${loanId}`;
  expect(loan.status).toBe("lost");
});

// — RetireCopy —

test("retiring records the reason the constraint requires", async () => {
  const { ctx, copyIds } = await onTheShelf();
  await runCommand(sql, ctx, retireCopy, { copyId: copyIds[0], reason: "Mục nát, không đọc được" });

  const [copy] = await sql<
    { state: string; retired_reason: string; retired_at: Date | null }[]
  >`select state, retired_reason, retired_at from book_copies where id = ${copyIds[0]}`;
  expect(copy.state).toBe("retired");
  expect(copy.retired_reason).toBe("Mục nát, không đọc được");
  expect(copy.retired_at).not.toBeNull();
});

test("retiring with no reason is a named failure, not a check-constraint violation", async () => {
  // book_copies_retired_has_reason would raise 23514 from inside the
  // transaction otherwise — the unstructured failure OPS §2 forbids. The
  // sentence is its own, because the shipped `reason_required` says "lý do
  // huỷ" — a cancellation, which this is not.
  const { ctx, copyIds } = await onTheShelf();
  await expect(
    runCommand(sql, ctx, retireCopy, { copyId: copyIds[0], reason: "   " }),
  ).rejects.toMatchObject({ code: "retire_reason_required" });
});

test("a copy on loan cannot be retired, and is told what to do instead", async () => {
  // Master §7.1's acceptance criterion, and BR §7.1's own note: "A copy that is
  // on_loan cannot be retired directly; it must first be returned or reported
  // lost."
  const { ctx, shelf, manager, bookId, copyIds } = await onTheShelf();
  await lendOut(shelf.id, bookId, copyIds[0], manager.userId);

  await expect(
    runCommand(sql, ctx, retireCopy, { copyId: copyIds[0], reason: "Mục nát" }),
  ).rejects.toMatchObject({ code: "copy_on_loan" });
  expect(await stateOf(copyIds[0])).toBe("on_loan");
});

test("a lost copy may be written off; a held one may not", async () => {
  const { ctx, shelf, manager, bookId, copyIds } = await onTheShelf(2);
  await lendOut(shelf.id, bookId, copyIds[0], manager.userId);
  await runCommand(sql, ctx, reportCopyLost, { copyId: copyIds[0] });
  await runCommand(sql, ctx, retireCopy, { copyId: copyIds[0], reason: "Chắc chắn không quay lại" });
  expect(await stateOf(copyIds[0])).toBe("retired");

  await sql`update book_copies set state = 'held' where id = ${copyIds[1]}`;
  await expect(
    runCommand(sql, ctx, retireCopy, { copyId: copyIds[1], reason: "x" }),
  ).rejects.toMatchObject({ code: "copy_not_available" });
});

test("none of the four is reachable across a shelf boundary", async () => {
  // G4. RLS filters the copy lookup to zero rows, and each command turns that
  // into copy_not_found rather than a silent success.
  const a = await onTheShelf();
  const b = await onTheShelf();

  await expect(
    runCommand(sql, a.ctx, retireCopy, { copyId: b.copyIds[0], reason: "x" }),
  ).rejects.toBeInstanceOf(NotFound);
  await expect(
    runCommand(sql, a.ctx, assessCondition, { copyId: b.copyIds[0], condition: "worn" }),
  ).rejects.toBeInstanceOf(NotFound);
  expect(await stateOf(b.copyIds[0])).toBe("available");
  expect(await sql`select 1 from audit_log`).toHaveLength(0);
});

test("a reader may not touch any of them", async () => {
  const { ctx, shelf, copyIds } = await onTheShelf();
  const reader = await makeMember(sql, shelf.id);
  const readerCtx: TenantContext = {
    ...ctx,
    actor: { userId: reader.userId, membershipId: reader.id, role: "reader" },
  };
  await expect(
    runCommand(sql, readerCtx, retireCopy, { copyId: copyIds[0], reason: "x" }),
  ).rejects.toBeInstanceOf(RuleViolated);
});
```

Create `tests/invariants/inv-07-lost-or-retired-not-lendable.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { fixedClock } from "../../src/domain/kernel/clock";
import { runCommand, runQuery } from "../../src/domain/kernel/unit-of-work";
import type { TenantContext } from "../../src/domain/kernel/tenant";
import { copyStateTransition } from "../../src/domain/catalogue/policy";
import { reportCopyLost } from "../../src/domain/catalogue/commands/report-copy-lost";
import { retireCopy } from "../../src/domain/catalogue/commands/retire-copy";
import { migrate } from "../../src/db/migrate";
import { makeBookWithCopies, makeMember, makeShelf } from "../support/factories";
import { closeAll, resetDatabase, sql } from "../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

/**
 * INV-7 — "A copy that is lost or retired cannot be lent or held."
 *
 * DATABASE.md §7 files this as "Application + partial index". B1 owns two of
 * its three halves and C1 owns the third:
 *
 *  1. the predicate — `copyStateTransition` refuses `lost|retired → on_loan`
 *     and `→ held`;
 *  2. the access path — such a copy is absent from `copies_borrowable`, which
 *     is the view every lending decision reads (DB §6);
 *  3. the command — `LendCopy` and `ApproveBorrowRequest` refuse it. Those
 *     commands do not exist until C1, which extends this file rather than
 *     starting a second one.
 *
 * Halves 1 and 2 are asserted here. A test that only checked the predicate
 * would pass against an implementation where the view still offered the copy
 * up, which is the failure that actually reaches a reader.
 */

const clock = fixedClock("2026-08-08T03:00:00Z");

test("INV-7: a lost or retired copy is refused by the transition table", async () => {
  for (const from of ["lost", "retired"] as const) {
    for (const to of ["on_loan", "held"] as const) {
      expect(copyStateTransition(from, to).allowed).toBe(false);
    }
  }
});

test("INV-7: a lost or retired copy disappears from copies_borrowable", async () => {
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  const manager = await makeMember(sql, shelf.id, { role: "manager" });
  const { bookId, copyIds } = await makeBookWithCopies(sql, shelf.id, 3);
  const ctx: TenantContext = {
    bookshelfId: shelf.id,
    actor: { userId: manager.userId, membershipId: manager.id, role: "manager" },
    clock,
  };

  const borrowable = () =>
    runQuery(sql, ctx, (tx) =>
      tx<{ id: string }[]>`select id from copies_borrowable where book_id = ${bookId}`,
    );

  expect(await borrowable()).toHaveLength(3);

  const borrower = await makeMember(sql, shelf.id);
  await sql`
    insert into loans (bookshelf_id, copy_id, book_id, borrower_id, lent_by, due_on)
    values (${shelf.id}, ${copyIds[0]}, ${bookId}, ${borrower.userId}, ${manager.userId},
            date '2026-08-22')
  `;
  await sql`update book_copies set state = 'on_loan' where id = ${copyIds[0]}`;

  await runCommand(sql, ctx, reportCopyLost, { copyId: copyIds[0] });
  await runCommand(sql, ctx, retireCopy, { copyId: copyIds[1], reason: "Mục nát" });

  const left = await borrowable();
  expect(left.map((c) => c.id)).toEqual([copyIds[2]]);
});
```

- [ ] **Step 2: Run both to verify they fail**

Run: `bun run test tests/domain/catalogue/copy-state.test.ts tests/invariants/inv-07-lost-or-retired-not-lendable.test.ts`
Expected: FAIL — the four command modules are missing.

- [ ] **Step 3: Write the four commands**

`src/domain/catalogue/commands/assess-condition.ts`:

```ts
import { NotFound, RuleViolated, ValidationFailed } from "../../kernel/errors";
import type { Command } from "../../kernel/unit-of-work";
import { type CopyCondition, isCopyCondition, requireManager } from "../policy";

export interface AssessConditionInput {
  copyId: string;
  condition: CopyCondition;
  note?: string | null;
  photoUrl?: string | null;
}

/**
 * Records a manager's judgement of a copy's physical state at a point in time.
 *
 * BR §5.4: "Separate from the loan because a manager may assess a copy at any
 * time, not only at return." So `loan_id` is null here; C1's `ReceiveReturn`
 * is what writes an assessment carrying one.
 *
 * **A condition is not a state** (BR §9: "`lost` is deliberately absent,
 * because it is a copy *state*"), so this command consults no transition
 * table and moves no copy. It does update `book_copies.condition`, because
 * that column is "the current judgement" while `condition_assessments` is the
 * history — and BR §11 lists condition assessments among the things never
 * deleted, which is why the history is a table and not a column.
 */
export const assessCondition: Command<AssessConditionInput, { assessmentId: string }> =
  async (tx, ctx, input) => {
    requireManager(ctx);

    if (!isCopyCondition(input.condition)) {
      throw new ValidationFailed("validation_failed", "condition");
    }
    // condition_assessments.assessed_by is `not null references users(id)`, so
    // a system context (userId null, e.g. the seed) cannot write one. Rejected
    // by name rather than by a not-null violation from inside the transaction.
    if (!ctx.actor.userId) throw new RuleViolated("not_permitted");

    const [copy] = await tx<{ id: string; condition: string; condition_note: string | null }[]>`
      select id, condition, condition_note from book_copies
      where id = ${input.copyId} and deleted_at is null
    `;
    if (!copy) throw new NotFound("copy_not_found");

    const [assessment] = await tx<{ id: string }[]>`
      insert into condition_assessments
        (bookshelf_id, copy_id, loan_id, assessed_by, condition, note, photo_url, assessed_at)
      values
        (${ctx.bookshelfId}, ${copy.id}, null, ${ctx.actor.userId}, ${input.condition},
         ${input.note ?? null}, ${input.photoUrl ?? null}, ${ctx.clock.now()})
      returning id
    `;

    await tx`
      update book_copies
      set condition = ${input.condition}, condition_note = ${input.note ?? null}
      where id = ${copy.id}
    `;

    return {
      result: { assessmentId: assessment.id },
      audit: {
        action: "copy.condition_assessed",
        entityType: "copy",
        entityId: copy.id,
        before: { condition: copy.condition, conditionNote: copy.condition_note },
        after: { condition: input.condition, conditionNote: input.note ?? null },
      },
    };
  };
```

`src/domain/catalogue/commands/report-copy-lost.ts`:

```ts
import type { AuditEntry } from "../../kernel/audit";
import { NotFound, RuleViolated } from "../../kernel/errors";
import type { Command } from "../../kernel/unit-of-work";
import { type CopyState, copyStateTransition, requireManager } from "../policy";

/**
 * Marks a copy lost, and closes the loan it was out on.
 *
 * **Q3, decided in this plan: only an `on_loan` copy.** BR §7.1 draws exactly
 * one arrow into `lost`. The refusal comes from `copyStateTransition`, so the
 * rule lives in one table rather than in an `if` here — and widening it, if
 * the product owner ever says `available → lost` is real, is a line in that
 * table plus a test, with nothing to change in this file.
 *
 * OPS §4.1: "if the copy has an active loan, that loan is closed out
 * (`loan.status = lost`, not left dangling as `active`)". That is a second
 * state transition, so INV-8 earns it a second audit entry — the kernel takes
 * an array.
 *
 * `note` has no column. BR §5.4 gives BookCopy a "time reported lost" and no
 * lost note, so the note lives in the audit entry, which is where a manager
 * reading the history a year later will look anyway.
 */
export const reportCopyLost: Command<{ copyId: string; note?: string | null }, void> =
  async (tx, ctx, input) => {
    requireManager(ctx);

    const [copy] = await tx<{ id: string; state: CopyState }[]>`
      select id, state from book_copies where id = ${input.copyId} and deleted_at is null
    `;
    if (!copy) throw new NotFound("copy_not_found");

    const move = copyStateTransition(copy.state, "lost");
    if (!move.allowed) throw new RuleViolated(move.reason!);

    await tx`
      update book_copies
      set state = 'lost', lost_reported_at = ${ctx.clock.now()}
      where id = ${copy.id}
    `;

    const audit: AuditEntry[] = [
      {
        action: "copy.lost_reported",
        entityType: "copy",
        entityId: copy.id,
        before: { state: copy.state },
        after: { state: "lost", note: input.note ?? null },
      },
    ];

    const [loan] = await tx<{ id: string }[]>`
      select id from loans where copy_id = ${copy.id} and status = 'active'
    `;
    if (loan) {
      await tx`
        update loans
        set status = 'lost',
            lost_reported_at = ${ctx.clock.now()},
            lost_reported_by = ${ctx.actor.userId}
        where id = ${loan.id}
      `;
      audit.push({
        action: "loan.lost",
        entityType: "loan",
        entityId: loan.id,
        before: { status: "active" },
        after: { status: "lost" },
      });
    }

    return { result: undefined, audit };
  };
```

`src/domain/catalogue/commands/mark-copy-found.ts`:

```ts
import { NotFound, RuleViolated } from "../../kernel/errors";
import type { Command } from "../../kernel/unit-of-work";
import { type CopyState, copyStateTransition, requireManager } from "../policy";

/**
 * A lost copy turns up again (BR §7.1: `lost → available`).
 *
 * BR §3 lists "a book reported lost is found months later" as a case the
 * system must handle, and BR §16.3 added the shelf-wide **Sách đã mất** view
 * precisely because finding one lost copy from inside each book's own page
 * was not realistic.
 *
 * **The loan is not reopened.** BR §7.3 draws no arrow out of `lost` for a
 * loan, and INV-11 forbids deleting one. The copy comes back; what happened
 * to it stays on the record.
 */
export const markCopyFound: Command<{ copyId: string; note?: string | null }, void> =
  async (tx, ctx, input) => {
    requireManager(ctx);

    const [copy] = await tx<{ id: string; state: CopyState }[]>`
      select id, state from book_copies where id = ${input.copyId} and deleted_at is null
    `;
    if (!copy) throw new NotFound("copy_not_found");

    const move = copyStateTransition(copy.state, "available");
    if (!move.allowed || copy.state !== "lost") {
      throw new RuleViolated(copy.state === "lost" ? move.reason! : "not_lost");
    }

    await tx`
      update book_copies set state = 'available', lost_reported_at = null
      where id = ${copy.id}
    `;

    return {
      result: undefined,
      audit: {
        action: "copy.found",
        entityType: "copy",
        entityId: copy.id,
        before: { state: "lost" },
        after: { state: "available", note: input.note ?? null },
      },
    };
  };
```

> Note the belt-and-braces `copy.state !== "lost"` above. `copyStateTransition`
> allows `on_loan → available` (a return, C1's business) and `held → available`
> (an expired hold, C2's), so the transition table alone would let
> `MarkCopyFound` quietly receive a return. OPS §4.1 gives this command exactly
> one failure mode, `not_lost`, and that is what it must say.

`src/domain/catalogue/commands/retire-copy.ts`:

```ts
import { NotFound, RuleViolated, ValidationFailed } from "../../kernel/errors";
import type { Command } from "../../kernel/unit-of-work";
import { type CopyState, copyStateTransition, requireManager } from "../policy";

/**
 * Permanently withdraws a copy (BR §7.1: `available → retired`, `lost →
 * retired`).
 *
 * The reason is required by the database as well as by the catalogue —
 * `book_copies_retired_has_reason` is `check (state <> 'retired' or
 * retired_reason is not null)`. Checking it here first is what turns a 23514
 * raised from inside the transaction into the named failure OPS §2 requires.
 *
 * `retire_reason_required` rather than the shipped `reason_required`, whose
 * sentence is "Vui lòng ghi lý do huỷ." — *huỷ* is the word for cancelling
 * something, not for taking a book off the shelf for good.
 */
export const retireCopy: Command<{ copyId: string; reason: string }, void> = async (
  tx,
  ctx,
  input,
) => {
  requireManager(ctx);

  if (!input.reason || input.reason.trim() === "") {
    throw new ValidationFailed("retire_reason_required", "reason");
  }

  const [copy] = await tx<{ id: string; state: CopyState }[]>`
    select id, state from book_copies where id = ${input.copyId} and deleted_at is null
  `;
  if (!copy) throw new NotFound("copy_not_found");

  const move = copyStateTransition(copy.state, "retired");
  if (!move.allowed) throw new RuleViolated(move.reason!);

  await tx`
    update book_copies
    set state = 'retired', retired_at = ${ctx.clock.now()}, retired_reason = ${input.reason.trim()}
    where id = ${copy.id}
  `;

  return {
    result: undefined,
    audit: {
      action: "copy.retired",
      entityType: "copy",
      entityId: copy.id,
      before: { state: copy.state },
      after: { state: "retired", reason: input.reason.trim() },
    },
  };
};
```

- [ ] **Step 4: Run both to verify they pass, then commit**

Run: `bun run test tests/domain/catalogue/ tests/invariants/inv-07-lost-or-retired-not-lendable.test.ts`

```bash
git add src/domain/catalogue/commands/assess-condition.ts \
        src/domain/catalogue/commands/report-copy-lost.ts \
        src/domain/catalogue/commands/mark-copy-found.ts \
        src/domain/catalogue/commands/retire-copy.ts \
        tests/domain/catalogue/copy-state.test.ts \
        tests/invariants/inv-07-lost-or-retired-not-lendable.test.ts
git commit -m "feat(catalogue): the four copy-state commands, and INV-7's access path"
```

---

## Task 5: the three reader queries — where availability is derived

`GetCatalogue`, `SearchCatalogue` and `GetBookDetail`. They share the availability join, which is the single most important line in this slice, and the folded search, which is BR §12.

**Files:**
- Create: `src/domain/catalogue/queries/{get-catalogue,search-catalogue,get-book-detail}.ts`
- Test: `tests/domain/catalogue/reader-queries.test.ts`

**Interfaces:**

- Consumes: `Tx` (`src/domain/kernel/unit-of-work`), `TenantContext`, `requireReader` (`../policy`).
- Produces:
  ```ts
  /** The DB's own `copy_state` spelling. E maps `on_loan` to src/lib/status.ts's `onloan`. */
  export type Availability = CopyState;

  export interface CatalogueRow {
    bookId: string;
    slug: string;
    title: string;
    author: string | null;
    coverUrl: string | null;
    category: string | null;
    copiesTotal: number;
    /** Derived from `copies_borrowable` on every read (G5, BR §8). */
    copiesAvailable: number;
    availability: Availability;
  }

  export interface CatalogueInput {
    scope: "available" | "all";
    category?: string;                       // categories.slug
    sort?: "recent" | "title";
    page?: number;                           // 1-based
    pageSize?: number;                       // default 24
  }

  export interface CataloguePage {
    rows: CatalogueRow[];
    page: number;
    pageCount: number;
    total: number;
  }

  export function getCatalogue(tx: Tx, ctx: TenantContext, input: CatalogueInput): Promise<CataloguePage>;
  export function searchCatalogue(tx: Tx, ctx: TenantContext, input: { q: string }): Promise<CatalogueRow[]>;

  export interface BookDetail extends CatalogueRow {
    publisher: string | null;
    publishedYear: number | null;
    pageCount: number | null;
    isbn: string | null;
    description: string | null;
    language: string;
    /** Null unless the shelf's `public_show_current_borrower` is on. */
    currentLoan: { holderName: string | null; daysRemaining: number; dueOn: string } | null;
    queueLength: number;
  }

  export function getBookDetail(tx: Tx, ctx: TenantContext, input: { bookSlug: string }): Promise<BookDetail>;
  ```

  Every one is called as `runQuery(sql, ctx, (tx) => getCatalogue(tx, ctx, input))` — the `tx`-first shape, so a query can compose inside a caller's transaction and `runQuery` stays the single scoping boundary. This matches the shape the C1 plan already calls `searchBooksForLending` with.

**On the folding-parity test.** Master §7.1 lists it as a named test this slice must write. It already exists and passes: `tests/db/folding.test.ts` covers all four DB §5 inputs plus a lowercase-`đ` fifth, asserting `olibra_fold()` and `src/lib/search.ts`'s `fold()` return identical output. **Do not rewrite it.** What it does not cover is the end-to-end claim — that typing those titles without diacritics into the actual query finds them — and that is what the search test below adds. Note also that `searchCatalogue` passes the raw term to `olibra_fold()` in SQL rather than folding in TypeScript first: one implementation does the folding on both sides of the comparison, which is what BR §12's "can never drift" actually asks for.

- [ ] **Step 1: Write the failing test**

Create `tests/domain/catalogue/reader-queries.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { fixedClock } from "../../../src/domain/kernel/clock";
import { NotFound, RuleViolated } from "../../../src/domain/kernel/errors";
import { runCommand, runQuery } from "../../../src/domain/kernel/unit-of-work";
import type { TenantContext } from "../../../src/domain/kernel/tenant";
import { createBook } from "../../../src/domain/catalogue/commands/create-book";
import { retireCopy } from "../../../src/domain/catalogue/commands/retire-copy";
import { getCatalogue } from "../../../src/domain/catalogue/queries/get-catalogue";
import { searchCatalogue } from "../../../src/domain/catalogue/queries/search-catalogue";
import { getBookDetail } from "../../../src/domain/catalogue/queries/get-book-detail";
import { migrate } from "../../../src/db/migrate";
import { makeMember, makeShelf } from "../../support/factories";
import { closeAll, resetDatabase, sql } from "../../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

const clock = fixedClock("2026-08-08T03:00:00Z");

const TITLES = [
  "Dế Mèn Phiêu Lưu Ký",
  "Đất Rừng Phương Nam",
  "Totto-chan Bên Cửa Sổ",
  "Kính Vạn Hoa tập 4",
];

async function shelfWithCatalogue() {
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  const manager = await makeMember(sql, shelf.id, { role: "manager" });
  const reader = await makeMember(sql, shelf.id);
  await sql`
    insert into categories (slug, name, sort_order)
    values ('van-hoc-thieu-nhi', 'Văn học thiếu nhi', 10)
    on conflict (slug) do nothing
  `;
  const managerCtx: TenantContext = {
    bookshelfId: shelf.id,
    actor: { userId: manager.userId, membershipId: manager.id, role: "manager" },
    clock,
  };
  const readerCtx: TenantContext = {
    ...managerCtx,
    actor: { userId: reader.userId, membershipId: reader.id, role: "reader" },
  };
  const ids: Record<string, string> = {};
  for (const title of TITLES) {
    const { bookId } = await runCommand(sql, managerCtx, createBook, {
      title,
      author: "Tô Hoài",
      categorySlug: "van-hoc-thieu-nhi",
      copyCount: 2,
    });
    ids[title] = bookId;
  }
  return { shelf, manager, managerCtx, readerCtx, ids };
}

const catalogue = (ctx: TenantContext, input: Parameters<typeof getCatalogue>[2]) =>
  runQuery(sql, ctx, (tx) => getCatalogue(tx, ctx, input));

test("availability is derived from copies_borrowable, never a stored count", async () => {
  // Master §7.1's acceptance criterion, and the rule BR §8 and DB §6 both single
  // as the most likely to be quietly violated. Nothing is written between the
  // two reads except a state change on one copy — if a counter existed
  // anywhere, this test would still report 2.
  const { readerCtx, managerCtx, ids } = await shelfWithCatalogue();

  const before = await catalogue(readerCtx, { scope: "all" });
  const row = before.rows.find((r) => r.bookId === ids["Dế Mèn Phiêu Lưu Ký"])!;
  expect(row.copiesTotal).toBe(2);
  expect(row.copiesAvailable).toBe(2);

  const [copy] = await sql<{ id: string }[]>`
    select id from book_copies where book_id = ${row.bookId} order by code limit 1
  `;
  await runCommand(sql, managerCtx, retireCopy, { copyId: copy.id, reason: "Mục nát" });

  const after = await catalogue(readerCtx, { scope: "all" });
  const again = after.rows.find((r) => r.bookId === row.bookId)!;
  expect(again.copiesAvailable).toBe(1);
  expect(again.copiesTotal).toBe(1); // the retired copy is no longer a copy on the shelf
});

test("an unexpired hold makes a copy unavailable without changing its state", async () => {
  // BR §8: "a copy is borrowable when it is available and no unexpired hold
  // references it." The state stays `available`; only copies_borrowable knows.
  const { readerCtx, ids } = await shelfWithCatalogue();
  const bookId = ids["Đất Rừng Phương Nam"];
  const [copy] = await sql<{ id: string; bookshelf_id: string }[]>`
    select id, bookshelf_id from book_copies where book_id = ${bookId} order by code limit 1
  `;
  const holder = await makeMember(sql, copy.bookshelf_id);
  await sql`
    insert into borrow_requests
      (bookshelf_id, book_id, copy_id, member_id, status, hold_expires_at)
    values (${copy.bookshelf_id}, ${bookId}, ${copy.id}, ${holder.userId},
            'approved', now() + interval '3 days')
  `;

  const page = await catalogue(readerCtx, { scope: "all" });
  const row = page.rows.find((r) => r.bookId === bookId)!;
  expect(row.copiesTotal).toBe(2);
  expect(row.copiesAvailable).toBe(1);
  expect(await sql`select 1 from book_copies where id = ${copy.id} and state = 'available'`)
    .toHaveLength(1);
});

test("scope=available hides a title with nothing on the shelf; scope=all does not", async () => {
  // The reader catalogue's two segments: "Sách có sẵn" and "Toàn bộ tủ sách"
  // (?loc=tat-ca).
  const { readerCtx, managerCtx, ids } = await shelfWithCatalogue();
  const bookId = ids["Kính Vạn Hoa tập 4"];
  const copies = await sql<{ id: string }[]>`
    select id from book_copies where book_id = ${bookId}
  `;
  for (const c of copies) {
    await runCommand(sql, managerCtx, retireCopy, { copyId: c.id, reason: "Mục nát" });
  }

  const available = await catalogue(readerCtx, { scope: "available" });
  expect(available.rows.map((r) => r.bookId)).not.toContain(bookId);

  const all = await catalogue(readerCtx, { scope: "all" });
  const row = all.rows.find((r) => r.bookId === bookId)!;
  expect(row.availability).toBe("retired");
});

test("an unpublished draft is hidden from members, on both scopes", async () => {
  // BR §5.4's published flag "hides drafts from the public" — member-facing,
  // not public, per BR §1.2. The manager list (Task 6) still shows it.
  const { readerCtx, ids } = await shelfWithCatalogue();
  await sql`update books set is_published = false where id = ${ids["Totto-chan Bên Cửa Sổ"]}`;

  for (const scope of ["available", "all"] as const) {
    const page = await catalogue(readerCtx, { scope });
    expect(page.rows.map((r) => r.bookId)).not.toContain(ids["Totto-chan Bên Cửa Sổ"]);
  }
});

test("the catalogue is paginated and reports its own total", async () => {
  const { readerCtx } = await shelfWithCatalogue();
  const page = await catalogue(readerCtx, { scope: "all", page: 2, pageSize: 3 });
  expect(page.total).toBe(4);
  expect(page.pageCount).toBe(2);
  expect(page.rows).toHaveLength(1);
});

test("a category filter narrows by slug, not by name", async () => {
  const { readerCtx } = await shelfWithCatalogue();
  const all = await catalogue(readerCtx, { scope: "all", category: "van-hoc-thieu-nhi" });
  expect(all.rows).toHaveLength(4);
  const none = await catalogue(readerCtx, { scope: "all", category: "lich-su" });
  expect(none.rows).toHaveLength(0);
});

test("one shelf's catalogue never contains another's", async () => {
  // INV-10, through the query rather than through a raw select.
  const a = await shelfWithCatalogue();
  const b = await makeShelf(sql, { slug: "can-tho" });
  const bManager = await makeMember(sql, b.id, { role: "manager" });
  await runCommand(
    sql,
    { bookshelfId: b.id, actor: { userId: bManager.userId, membershipId: bManager.id, role: "manager" }, clock },
    createBook,
    { title: "Sách Cần Thơ", author: "X", categorySlug: "van-hoc-thieu-nhi", copyCount: 1 },
  );

  const page = await catalogue(a.readerCtx, { scope: "all" });
  expect(page.total).toBe(4);
  expect(page.rows.map((r) => r.title)).not.toContain("Sách Cần Thơ");
});

test("search finds every DB §5 title typed without diacritics", async () => {
  // BR §12: "A child typing 'tim kiem kho bau' on a phone without diacritics
  // must find 'Tìm Kiếm Kho Báu'." tests/db/folding.test.ts already proves
  // olibra_fold() and fold() agree on these four inputs; this is the other
  // half — that the query actually uses that folding on both sides.
  const { readerCtx } = await shelfWithCatalogue();
  const found = async (q: string) =>
    (await runQuery(sql, readerCtx, (tx) => searchCatalogue(tx, readerCtx, { q })))
      .map((r) => r.title);

  expect(await found("de men")).toContain("Dế Mèn Phiêu Lưu Ký");
  expect(await found("dat rung")).toContain("Đất Rừng Phương Nam");
  expect(await found("totto chan")).toContain("Totto-chan Bên Cửa Sổ");
  expect(await found("kinh van hoa tap 4")).toContain("Kính Vạn Hoa tập 4");
  // The hyphen case, from the other direction: a typed hyphen must not break it.
  expect(await found("Totto-chan")).toContain("Totto-chan Bên Cửa Sổ");
});

test("search covers author as well as title, and carries availability", async () => {
  const { readerCtx } = await shelfWithCatalogue();
  const rows = await runQuery(sql, readerCtx, (tx) =>
    searchCatalogue(tx, readerCtx, { q: "to hoai" }),
  );
  expect(rows).toHaveLength(4);
  expect(rows[0].copiesAvailable).toBe(2);
});

test("an empty search term returns nothing rather than the whole shelf", async () => {
  const { readerCtx } = await shelfWithCatalogue();
  expect(
    await runQuery(sql, readerCtx, (tx) => searchCatalogue(tx, readerCtx, { q: "   " })),
  ).toHaveLength(0);
});

test("book detail resolves by slug and reports the queue and the holder", async () => {
  const { readerCtx, ids, shelf, manager } = await shelfWithCatalogue();
  const bookId = ids["Dế Mèn Phiêu Lưu Ký"];
  const [copy] = await sql<{ id: string }[]>`
    select id from book_copies where book_id = ${bookId} order by code limit 1
  `;
  const borrower = await makeMember(sql, shelf.id);
  await sql`update users set full_name = 'Giuse Trần Minh' where id = ${borrower.userId}`;
  await sql`
    insert into loans (bookshelf_id, copy_id, book_id, borrower_id, lent_by, due_on)
    values (${shelf.id}, ${copy.id}, ${bookId}, ${borrower.userId}, ${manager.userId},
            date '2026-08-20')
  `;
  await sql`update book_copies set state = 'on_loan' where id = ${copy.id}`;
  const queued = await makeMember(sql, shelf.id);
  await sql`
    insert into borrow_requests (bookshelf_id, book_id, member_id, status)
    values (${shelf.id}, ${bookId}, ${queued.userId}, 'pending')
  `;

  const detail = await runQuery(sql, readerCtx, (tx) =>
    getBookDetail(tx, readerCtx, { bookSlug: "de-men-phieu-luu-ky" }),
  );

  expect(detail.title).toBe("Dế Mèn Phiêu Lưu Ký");
  expect(detail.copiesTotal).toBe(2);
  expect(detail.copiesAvailable).toBe(1);
  expect(detail.queueLength).toBe(1);
  expect(detail.currentLoan?.holderName).toBe("Giuse Trần Minh");
  // G5/G6: days remaining is computed from loans_current against the clock,
  // in Asia/Ho_Chi_Minh, not stored. 2026-08-20 minus 2026-08-08.
  expect(detail.currentLoan?.daysRemaining).toBe(12);
});

test("public_show_current_borrower off withholds the holder, keeps the availability", async () => {
  // BR §5.5. The panel still says the book is out; it just does not say with
  // whom.
  const { readerCtx, ids, shelf, manager } = await shelfWithCatalogue();
  await sql`
    update bookshelves
    set settings = settings || '{"public_show_current_borrower": false}'::jsonb
    where id = ${shelf.id}
  `;
  const bookId = ids["Dế Mèn Phiêu Lưu Ký"];
  const [copy] = await sql<{ id: string }[]>`
    select id from book_copies where book_id = ${bookId} order by code limit 1
  `;
  const borrower = await makeMember(sql, shelf.id);
  await sql`
    insert into loans (bookshelf_id, copy_id, book_id, borrower_id, lent_by, due_on)
    values (${shelf.id}, ${copy.id}, ${bookId}, ${borrower.userId}, ${manager.userId},
            date '2026-08-20')
  `;
  await sql`update book_copies set state = 'on_loan' where id = ${copy.id}`;

  const detail = await runQuery(sql, readerCtx, (tx) =>
    getBookDetail(tx, readerCtx, { bookSlug: "de-men-phieu-luu-ky" }),
  );
  expect(detail.currentLoan).toBeNull();
  expect(detail.copiesAvailable).toBe(1);
});

test("an unknown slug, and another shelf's book, are both not-found", async () => {
  const a = await shelfWithCatalogue();
  await expect(
    runQuery(sql, a.readerCtx, (tx) => getBookDetail(tx, a.readerCtx, { bookSlug: "khong-co" })),
  ).rejects.toBeInstanceOf(NotFound);
});

test("a guest reaches none of the three", async () => {
  // OPS §2 and BR §1.2: a bookshelf's catalogue, book detail and search now
  // require a membership of that shelf, not merely being signed in somewhere.
  const { readerCtx } = await shelfWithCatalogue();
  const guestCtx: TenantContext = {
    ...readerCtx,
    actor: { userId: null, membershipId: null, role: "guest" },
  };
  await expect(catalogue(guestCtx, { scope: "all" })).rejects.toBeInstanceOf(RuleViolated);
  await expect(
    runQuery(sql, guestCtx, (tx) => searchCatalogue(tx, guestCtx, { q: "de men" })),
  ).rejects.toBeInstanceOf(RuleViolated);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run test tests/domain/catalogue/reader-queries.test.ts`
Expected: FAIL — the three query modules are missing.

- [ ] **Step 3: Write `get-catalogue.ts`**

Create `src/domain/catalogue/queries/get-catalogue.ts`:

```ts
import type { TenantContext } from "../../kernel/tenant";
import type { Tx } from "../../kernel/unit-of-work";
import { type CopyState, requireReader } from "../policy";

/**
 * The DB's own `copy_state` spelling. `src/lib/status.ts` calls the same thing
 * `onloan`; the mapping belongs to E's UI wiring, not here — the domain does
 * not import an icon library to name a state.
 */
export type Availability = CopyState;

export interface CatalogueRow {
  bookId: string;
  slug: string;
  title: string;
  author: string | null;
  coverUrl: string | null;
  category: string | null;
  copiesTotal: number;
  copiesAvailable: number;
  availability: Availability;
}

export interface CatalogueInput {
  scope: "available" | "all";
  /** `categories.slug`. */
  category?: string;
  sort?: "recent" | "title";
  page?: number;
  pageSize?: number;
}

export interface CataloguePage {
  rows: CatalogueRow[];
  page: number;
  pageCount: number;
  total: number;
}

/**
 * **`copies_available` is derived on every read, and there is no column
 * behind it.**
 *
 * BR §8 and DB §6 both name this as the load-bearing rule most likely to be
 * violated under delivery pressure, and this join is where it lives: a left
 * join from each live copy to `copies_borrowable`, counted. `copies_borrowable`
 * is itself the expression of "available and no unexpired hold references it",
 * evaluated against `now()` — so a hold that lapsed a minute ago is already
 * gone from the count with no job having run. If a reviewer ever sees a
 * `copies_available` column appear in a migration, this is the rule it broke.
 *
 * `availability` is the title-level badge the card shows, aggregated from the
 * copy states rather than stored: available if anything is borrowable, then
 * whichever state the shelf's copies are actually in.
 */
export async function getCatalogue(
  tx: Tx,
  ctx: TenantContext,
  input: CatalogueInput,
): Promise<CataloguePage> {
  requireReader(ctx);

  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 24));
  const availableOnly = input.scope === "available";

  const rows = await tx<
    (Omit<CatalogueRow, "copiesTotal" | "copiesAvailable"> & {
      copies_total: number;
      copies_available: number;
      book_id: string;
      cover_url: string | null;
      total_count: number;
    })[]
  >`
    with counted as (
      select
        b.id            as book_id,
        b.slug,
        b.title,
        b.author,
        b.cover_url,
        b.created_at,
        c.name          as category,
        count(cp.id)                                              as copies_total,
        count(av.id)                                              as copies_available,
        count(cp.id) filter (where cp.state = 'on_loan')          as on_loan,
        count(cp.id) filter (where cp.state = 'held')             as held,
        count(cp.id) filter (where cp.state = 'lost')             as lost
      from books b
      left join categories c on c.id = b.category_id
      left join book_copies cp
             on cp.bookshelf_id = b.bookshelf_id
            and cp.book_id = b.id
            and cp.deleted_at is null
            and cp.state <> 'retired'
      -- The whole of BR §8, in one join.
      left join copies_borrowable av on av.id = cp.id
      where b.deleted_at is null
        and b.is_published
        and (${input.category ?? null}::text is null or c.slug = ${input.category ?? null})
      group by b.id, c.name
    ),
    scoped as (
      select *,
        case
          when copies_available > 0 then 'available'
          when on_loan > 0          then 'on_loan'
          when held > 0             then 'held'
          when lost > 0             then 'lost'
          else 'retired'
        end as availability
      from counted
      where not ${availableOnly} or copies_available > 0
    )
    select *, count(*) over ()::int as total_count
    from scoped
    order by
      case when ${input.sort ?? "recent"} = 'title' then title end asc,
      created_at desc
    limit ${pageSize} offset ${(page - 1) * pageSize}
  `;

  const total = rows[0]?.total_count ?? 0;
  return {
    rows: rows.map((r) => ({
      bookId: r.book_id,
      slug: r.slug,
      title: r.title,
      author: r.author,
      coverUrl: r.cover_url,
      category: r.category,
      copiesTotal: Number(r.copies_total),
      copiesAvailable: Number(r.copies_available),
      availability: r.availability as Availability,
    })),
    page,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    total,
  };
}
```

> **Two things to check while implementing, rather than after.** `count(*)
> over ()` returns the total *before* `limit` but *after* `where`, which is
> what `total` wants — confirm it against the pagination test rather than
> trusting this note. And when `rows` is empty the total is `0`, so a page
> beyond the end reports `total: 0` rather than the real count; if the UI needs
> the real total on an empty page, run a separate `count(*)`. The listing above
> is the simpler one and the test only asserts page 2 of 4.

- [ ] **Step 4: Write `search-catalogue.ts` and `get-book-detail.ts`**

Create `src/domain/catalogue/queries/search-catalogue.ts`:

```ts
import type { TenantContext } from "../../kernel/tenant";
import type { Tx } from "../../kernel/unit-of-work";
import { requireReader } from "../policy";
import type { CatalogueRow } from "./get-catalogue";

/**
 * Diacritic- and case-insensitive substring search over title and author
 * (BR §12).
 *
 * **The term is folded by `olibra_fold()` in SQL, not by `fold()` in
 * TypeScript.** `books.title_folded` and `books.author_folded` are generated
 * columns over the same function, so both sides of the comparison go through
 * one implementation and BR §12's "the two can never drift" is structural
 * rather than a convention. `tests/db/folding.test.ts` is what keeps
 * `src/lib/search.ts`'s `fold()` — which the *UI* uses for its own client-side
 * filtering — in step with the SQL one.
 *
 * `like '%' || ... || '%'` rather than a trigram operator: DB §5 is explicit
 * that at a few hundred books per shelf "nothing more elaborate is warranted".
 * The `gin_trgm_ops` indexes on both folded columns are there if a shelf ever
 * outgrows that.
 */
export async function searchCatalogue(
  tx: Tx,
  ctx: TenantContext,
  input: { q: string },
): Promise<CatalogueRow[]> {
  requireReader(ctx);

  if (input.q.trim() === "") return [];

  const rows = await tx<
    {
      book_id: string;
      slug: string;
      title: string;
      author: string | null;
      cover_url: string | null;
      category: string | null;
      copies_total: number;
      copies_available: number;
      availability: string;
    }[]
  >`
    select
      b.id as book_id, b.slug, b.title, b.author, b.cover_url,
      c.name as category,
      count(cp.id)  as copies_total,
      count(av.id)  as copies_available,
      case
        when count(av.id) > 0 then 'available'
        when count(cp.id) filter (where cp.state = 'on_loan') > 0 then 'on_loan'
        when count(cp.id) filter (where cp.state = 'held')    > 0 then 'held'
        when count(cp.id) filter (where cp.state = 'lost')    > 0 then 'lost'
        else 'retired'
      end as availability
    from books b
    left join categories c on c.id = b.category_id
    left join book_copies cp
           on cp.bookshelf_id = b.bookshelf_id
          and cp.book_id = b.id
          and cp.deleted_at is null
          and cp.state <> 'retired'
    left join copies_borrowable av on av.id = cp.id
    where b.deleted_at is null
      and b.is_published
      and (
        b.title_folded  like '%' || olibra_fold(${input.q}) || '%'
        or b.author_folded like '%' || olibra_fold(${input.q}) || '%'
      )
    group by b.id, c.name
    order by b.title
  `;

  return rows.map((r) => ({
    bookId: r.book_id,
    slug: r.slug,
    title: r.title,
    author: r.author,
    coverUrl: r.cover_url,
    category: r.category,
    copiesTotal: Number(r.copies_total),
    copiesAvailable: Number(r.copies_available),
    availability: r.availability as CatalogueRow["availability"],
  }));
}
```

Create `src/domain/catalogue/queries/get-book-detail.ts`:

```ts
import { NotFound } from "../../kernel/errors";
import type { TenantContext } from "../../kernel/tenant";
import type { Tx } from "../../kernel/unit-of-work";
import { requireReader } from "../policy";
import type { CatalogueRow } from "./get-catalogue";

export interface BookDetail extends CatalogueRow {
  publisher: string | null;
  publishedYear: number | null;
  pageCount: number | null;
  isbn: string | null;
  description: string | null;
  language: string;
  currentLoan: { holderName: string | null; daysRemaining: number; dueOn: string } | null;
  queueLength: number;
}

/**
 * BR §5.5's defaults, applied here because a shelf row "need only store what
 * it overrides" (DB §4.2). B4 owns shelf settings; these two are the only ones
 * this slice reads, and reading them with the documented default is cheaper
 * than blocking on B4.
 */
function showsCurrentBorrower(settings: Record<string, unknown> | null): boolean {
  return settings?.public_show_current_borrower !== false;
}
function nameDisplay(settings: Record<string, unknown> | null): string {
  const v = settings?.public_name_display;
  return typeof v === "string" ? v : "full_name";
}

/**
 * A book's reader-facing detail page.
 *
 * BR §16.1: "There is no guest path — only a member of this shelf can see this
 * page at all", which is what `requireReader` plus the kernel's tenant scoping
 * enforce between them.
 *
 * Everything derived is derived: `copiesAvailable` from `copies_borrowable`,
 * `daysRemaining` from `loans_current` (never a stored column — DB §4.5:
 * "There is no `is_overdue` column, and there must never be one"), and
 * `queueLength` from the count of pending requests, since BR §7.2 says
 * "There is no separate reservation concept."
 *
 * **Known gap, recorded rather than invented:** `src/lib/fixtures.ts`'s `Book`
 * type has a `translator` field and `books` has no such column. This query
 * does not return one. Adding it is a migration, which master §7.1 does not
 * put in this slice.
 */
export async function getBookDetail(
  tx: Tx,
  ctx: TenantContext,
  input: { bookSlug: string },
): Promise<BookDetail> {
  requireReader(ctx);

  const [book] = await tx<
    {
      book_id: string;
      slug: string;
      title: string;
      author: string | null;
      cover_url: string | null;
      category: string | null;
      publisher: string | null;
      published_year: number | null;
      page_count: number | null;
      isbn: string | null;
      description: string | null;
      language: string;
      copies_total: number;
      copies_available: number;
      availability: string;
    }[]
  >`
    select
      b.id as book_id, b.slug, b.title, b.author, b.cover_url,
      c.name as category, b.publisher, b.published_year, b.page_count,
      b.isbn, b.description, b.language,
      count(cp.id) as copies_total,
      count(av.id) as copies_available,
      case
        when count(av.id) > 0 then 'available'
        when count(cp.id) filter (where cp.state = 'on_loan') > 0 then 'on_loan'
        when count(cp.id) filter (where cp.state = 'held')    > 0 then 'held'
        when count(cp.id) filter (where cp.state = 'lost')    > 0 then 'lost'
        else 'retired'
      end as availability
    from books b
    left join categories c on c.id = b.category_id
    left join book_copies cp
           on cp.bookshelf_id = b.bookshelf_id
          and cp.book_id = b.id
          and cp.deleted_at is null
          and cp.state <> 'retired'
    left join copies_borrowable av on av.id = cp.id
    where b.slug = ${input.bookSlug} and b.deleted_at is null and b.is_published
    group by b.id, c.name
  `;
  if (!book) throw new NotFound("book_not_found");

  const [{ queue_length: queueLength }] = await tx<{ queue_length: number }[]>`
    select count(*)::int as queue_length
    from borrow_requests
    where book_id = ${book.book_id} and status = 'pending' and deleted_at is null
  `;

  const [shelf] = await tx<{ settings: Record<string, unknown> | null }[]>`
    select settings from bookshelves where id = ${ctx.bookshelfId}
  `;

  let currentLoan: BookDetail["currentLoan"] = null;
  if (showsCurrentBorrower(shelf?.settings ?? null)) {
    const [loan] = await tx<
      { full_name: string; display_name: string | null; due_on: string; days_remaining: number }[]
    >`
      select u.full_name, u.display_name, l.due_on::text as due_on, l.days_remaining
      from loans_current l
      join users u on u.id = l.borrower_id
      where l.book_id = ${book.book_id} and l.status = 'active'
      order by l.due_on
      limit 1
    `;
    if (loan) {
      const display = nameDisplay(shelf?.settings ?? null);
      currentLoan = {
        holderName:
          display === "hidden"
            ? null
            : display === "display_name"
              ? (loan.display_name ?? loan.full_name)
              : loan.full_name,
        daysRemaining: Number(loan.days_remaining),
        dueOn: loan.due_on,
      };
    }
  }

  return {
    bookId: book.book_id,
    slug: book.slug,
    title: book.title,
    author: book.author,
    coverUrl: book.cover_url,
    category: book.category,
    copiesTotal: Number(book.copies_total),
    copiesAvailable: Number(book.copies_available),
    availability: book.availability as CatalogueRow["availability"],
    publisher: book.publisher,
    publishedYear: book.published_year,
    pageCount: book.page_count,
    isbn: book.isbn,
    description: book.description,
    language: book.language,
    currentLoan,
    queueLength,
  };
}
```

- [ ] **Step 5: Run it to verify it passes, then commit**

Run: `bun run test tests/domain/catalogue/reader-queries.test.ts`

```bash
git add src/domain/catalogue/queries/get-catalogue.ts \
        src/domain/catalogue/queries/search-catalogue.ts \
        src/domain/catalogue/queries/get-book-detail.ts \
        tests/domain/catalogue/reader-queries.test.ts
git commit -m "feat(catalogue): the reader queries, with availability derived on read"
```

---

## Task 6: the three manager queries

`GetBooksList`, `GetBookDetail` (manager) and `SearchBooksForLending`. They differ from Task 5's in three ways worth holding together: drafts are visible, per-copy detail is visible, and each lendable row carries its blocking reason so BR §16.3's "before the confirm step" rule can be met.

**Files:**
- Create: `src/domain/catalogue/queries/{get-books-list,get-book-detail-manager,search-books-for-lending}.ts`
- Test: `tests/domain/catalogue/manager-queries.test.ts`

**Interfaces:**

- Produces:
  ```ts
  export interface BooksListRow extends CatalogueRow {
    isPublished: boolean;
    /** The display range the list shows under the title, e.g. "DT-0215 – DT-0217". */
    codes: string;
  }
  export function getBooksList(
    tx: Tx, ctx: TenantContext,
    input: { q?: string; category?: string; sort?: "recent" | "title"; page?: number; pageSize?: number },
  ): Promise<{ rows: BooksListRow[]; page: number; pageCount: number; total: number }>;

  export interface ManagerCopyRow {
    copyId: string;
    code: string;
    state: CopyState;
    condition: CopyCondition;
    conditionNote: string | null;
    acquiredOn: string | null;
    acquiredFrom: string | null;
    acquiredFromMembershipId: string | null;
    /** "Đang ở đâu" — the holder and due date when out, null when on the shelf. */
    holderName: string | null;
    dueOn: string | null;
    isOverdue: boolean;
    lostReportedAt: string | null;
    retiredAt: string | null;
    retiredReason: string | null;
  }
  export interface ManagerBookDetail {
    book: BooksListRow;
    copies: ManagerCopyRow[];
    conditionHistory: {
      assessedAt: string; copyCode: string; assessorName: string | null;
      condition: CopyCondition; note: string | null;
    }[];
    loanHistory: {
      loanId: string; copyCode: string; borrowerName: string;
      lentAt: string; returnedAt: string | null; status: string;
      returnCondition: CopyCondition | null;
    }[];
  }
  export function getBookDetailManager(
    tx: Tx, ctx: TenantContext, input: { bookId: string },
  ): Promise<ManagerBookDetail>;

  export interface LendableBookRow {
    bookId: string; slug: string; title: string; author: string | null;
    coverUrl: string | null; copiesTotal: number; copiesAvailable: number;
    blocked: boolean; reason?: ErrorCode;
  }
  export function searchBooksForLending(
    tx: Tx, ctx: TenantContext, input: { q: string },
  ): Promise<LendableBookRow[]>;
  ```

**Two reconciliations that matter to C1.** `searchBooksForLending` lives at `src/domain/catalogue/queries/` (master §7.1's file list), not `src/domain/circulation/queries/` as the C1 plan's import says; and its signature is `(tx, ctx, { q })`, which is the shape C1's own tests already call it with, not master §7.1's `(ctx, q)`. C1's reconciliation pass fixes the import path; nothing about its call sites changes.

- [ ] **Step 1: Write the failing test**

Create `tests/domain/catalogue/manager-queries.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { fixedClock } from "../../../src/domain/kernel/clock";
import { RuleViolated } from "../../../src/domain/kernel/errors";
import { runCommand, runQuery } from "../../../src/domain/kernel/unit-of-work";
import type { TenantContext } from "../../../src/domain/kernel/tenant";
import { createBook } from "../../../src/domain/catalogue/commands/create-book";
import { assessCondition } from "../../../src/domain/catalogue/commands/assess-condition";
import { getBooksList } from "../../../src/domain/catalogue/queries/get-books-list";
import { getBookDetailManager } from "../../../src/domain/catalogue/queries/get-book-detail-manager";
import { searchBooksForLending } from "../../../src/domain/catalogue/queries/search-books-for-lending";
import { migrate } from "../../../src/db/migrate";
import { makeMember, makeShelf } from "../../support/factories";
import { closeAll, resetDatabase, sql } from "../../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

const clock = fixedClock("2026-08-08T03:00:00Z");

async function shelf() {
  const s = await makeShelf(sql, { slug: "dong-thap" });
  const manager = await makeMember(sql, s.id, { role: "manager" });
  await sql`
    insert into categories (slug, name, sort_order)
    values ('van-hoc-thieu-nhi', 'Văn học thiếu nhi', 10) on conflict (slug) do nothing
  `;
  const ctx: TenantContext = {
    bookshelfId: s.id,
    actor: { userId: manager.userId, membershipId: manager.id, role: "manager" },
    clock,
  };
  const { bookId } = await runCommand(sql, ctx, createBook, {
    title: "Dế Mèn Phiêu Lưu Ký",
    author: "Tô Hoài",
    categorySlug: "van-hoc-thieu-nhi",
    copyCount: 3,
  });
  return { s, manager, ctx, bookId };
}

async function lend(s: string, bookId: string, copyId: string, lentBy: string, due = "2026-08-20") {
  const borrower = await makeMember(sql, s);
  await sql`update users set full_name = 'Giuse Trần Minh' where id = ${borrower.userId}`;
  const [loan] = await sql<{ id: string }[]>`
    insert into loans (bookshelf_id, copy_id, book_id, borrower_id, lent_by, due_on)
    values (${s}, ${copyId}, ${bookId}, ${borrower.userId}, ${lentBy}, ${due}::date)
    returning id
  `;
  await sql`update book_copies set state = 'on_loan' where id = ${copyId}`;
  return loan.id;
}

test("the manager list shows a draft the reader catalogue hides", async () => {
  const { ctx, bookId } = await shelf();
  await sql`update books set is_published = false where id = ${bookId}`;

  const list = await runQuery(sql, ctx, (tx) => getBooksList(tx, ctx, {}));
  const row = list.rows.find((r) => r.bookId === bookId)!;
  expect(row.isPublished).toBe(false);
  expect(row.copiesTotal).toBe(3);
  // The secondary line under the title on the built list page.
  expect(row.codes).toBe("DT-0001 – DT-0003");
});

test("the manager list filters by folded query and by category", async () => {
  const { ctx } = await shelf();
  expect(
    (await runQuery(sql, ctx, (tx) => getBooksList(tx, ctx, { q: "de men" }))).rows,
  ).toHaveLength(1);
  expect(
    (await runQuery(sql, ctx, (tx) => getBooksList(tx, ctx, { q: "khong co" }))).rows,
  ).toHaveLength(0);
  expect(
    (await runQuery(sql, ctx, (tx) => getBooksList(tx, ctx, { category: "lich-su" }))).rows,
  ).toHaveLength(0);
});

test("manager book detail carries per-copy state, condition and 'đang ở đâu'", async () => {
  const { ctx, s, manager, bookId } = await shelf();
  const copies = await sql<{ id: string; code: string }[]>`
    select id, code from book_copies where book_id = ${bookId} order by code
  `;
  await lend(s.id, bookId, copies[1].id, manager.userId);
  await runCommand(sql, ctx, assessCondition, {
    copyId: copies[0].id,
    condition: "slightly_worn",
    note: "Gáy hơi lỏng",
  });

  const detail = await runQuery(sql, ctx, (tx) => getBookDetailManager(tx, ctx, { bookId }));

  expect(detail.copies).toHaveLength(3);
  const [first, second] = detail.copies;
  expect(first.code).toBe(copies[0].code);
  expect(first.state).toBe("available");
  expect(first.condition).toBe("slightly_worn");
  expect(first.conditionNote).toBe("Gáy hơi lỏng");
  expect(first.holderName).toBeNull();
  expect(second.state).toBe("on_loan");
  expect(second.holderName).toBe("Giuse Trần Minh");
  expect(second.dueOn).toBe("2026-08-20");
  expect(second.isOverdue).toBe(false);

  expect(detail.conditionHistory).toHaveLength(1);
  expect(detail.conditionHistory[0].condition).toBe("slightly_worn");
  expect(detail.conditionHistory[0].copyCode).toBe(copies[0].code);

  expect(detail.loanHistory).toHaveLength(1);
  expect(detail.loanHistory[0].borrowerName).toBe("Giuse Trần Minh");
  expect(detail.loanHistory[0].returnedAt).toBeNull();
});

test("overdue on a copy row is computed against the clock, not stored", async () => {
  // G5, and DB §4.5: "There is no is_overdue column, and there must never be
  // one." loans_current does the arithmetic in Asia/Ho_Chi_Minh.
  const { ctx, s, manager, bookId } = await shelf();
  const copies = await sql<{ id: string }[]>`
    select id from book_copies where book_id = ${bookId} order by code
  `;
  await lend(s.id, bookId, copies[0].id, manager.userId, "2026-08-01");

  const detail = await runQuery(sql, ctx, (tx) => getBookDetailManager(tx, ctx, { bookId }));
  expect(detail.copies[0].isOverdue).toBe(true);
});

test("loan history survives the copy being retired", async () => {
  // BR §5.4 stores book_id on the loan for exactly this, and BR §11 keeps the
  // loan forever. The built page says so: "Lịch sử mượn không bao giờ bị xoá,
  // kể cả khi bản sách đã ngừng dùng."
  const { ctx, s, manager, bookId } = await shelf();
  const copies = await sql<{ id: string }[]>`
    select id from book_copies where book_id = ${bookId} order by code
  `;
  const loanId = await lend(s.id, bookId, copies[0].id, manager.userId);
  await sql`
    update loans set status = 'returned', returned_at = now(),
                     received_by = ${manager.userId}, return_condition = 'worn'
    where id = ${loanId}
  `;
  await sql`
    update book_copies set state = 'retired', retired_at = now(), retired_reason = 'Mục nát'
    where id = ${copies[0].id}
  `;

  const detail = await runQuery(sql, ctx, (tx) => getBookDetailManager(tx, ctx, { bookId }));
  expect(detail.loanHistory).toHaveLength(1);
  expect(detail.loanHistory[0].returnCondition).toBe("worn");
  // The retired copy is still listed on the management page, with its reason.
  const retired = detail.copies.find((c) => c.state === "retired")!;
  expect(retired.retiredReason).toBe("Mục nát");
});

test("a title with every copy out is blocked, with the reason the command would throw", async () => {
  // BR §16.3: blocking conditions surface "before the confirm step, never as
  // an error afterwards." C1's own test asserts this exact reason string.
  const { ctx, s, manager, bookId } = await shelf();
  const copies = await sql<{ id: string }[]>`
    select id from book_copies where book_id = ${bookId} order by code
  `;
  for (const c of copies) await lend(s.id, bookId, c.id, manager.userId);

  const [row] = await runQuery(sql, ctx, (tx) =>
    searchBooksForLending(tx, ctx, { q: "de men" }),
  );
  expect(row.blocked).toBe(true);
  expect(row.reason).toBe("copy_not_available");
  expect(row.copiesAvailable).toBe(0);
  expect(row.copiesTotal).toBe(3);
});

test("a title with one copy free is not blocked", async () => {
  const { ctx, s, manager, bookId } = await shelf();
  const copies = await sql<{ id: string }[]>`
    select id from book_copies where book_id = ${bookId} order by code
  `;
  await lend(s.id, bookId, copies[0].id, manager.userId);
  await lend(s.id, bookId, copies[1].id, manager.userId);

  const [row] = await runQuery(sql, ctx, (tx) =>
    searchBooksForLending(tx, ctx, { q: "de men" }),
  );
  expect(row.blocked).toBe(false);
  expect(row.reason).toBeUndefined();
  expect(row.copiesAvailable).toBe(1);
});

test("quick-lend search is diacritic-insensitive, like every other search", async () => {
  const { ctx } = await shelf();
  const rows = await runQuery(sql, ctx, (tx) => searchBooksForLending(tx, ctx, { q: "de men" }));
  expect(rows.map((r) => r.title)).toContain("Dế Mèn Phiêu Lưu Ký");
});

test("a reader reaches none of the three", async () => {
  const { ctx, s, bookId } = await shelf();
  const reader = await makeMember(sql, s.id);
  const readerCtx: TenantContext = {
    ...ctx,
    actor: { userId: reader.userId, membershipId: reader.id, role: "reader" },
  };
  await expect(
    runQuery(sql, readerCtx, (tx) => getBooksList(tx, readerCtx, {})),
  ).rejects.toBeInstanceOf(RuleViolated);
  await expect(
    runQuery(sql, readerCtx, (tx) => getBookDetailManager(tx, readerCtx, { bookId })),
  ).rejects.toBeInstanceOf(RuleViolated);
  await expect(
    runQuery(sql, readerCtx, (tx) => searchBooksForLending(tx, readerCtx, { q: "de" })),
  ).rejects.toBeInstanceOf(RuleViolated);
});
```

- [ ] **Step 2: Run it, watch it fail, then implement the three queries**

Run: `bun run test tests/domain/catalogue/manager-queries.test.ts` — FAIL, three modules missing.

The three follow Task 5's shape closely enough that only what differs is spelled out here; write them against Task 5's listings.

**`get-books-list.ts`** is `getCatalogue` with three changes: `requireManager` instead of `requireReader`; **no `and b.is_published` filter**, because a draft is exactly what a manager needs to find; and a `codes` string built from `min(cp.code)` and `max(cp.code)` —

```sql
      case
        when count(cp.id) = 0 then ''
        when min(cp.code) = max(cp.code) then min(cp.code)
        else min(cp.code) || ' – ' || max(cp.code)
      end as codes
```

— which reproduces `src/lib/fixtures.ts`'s own `codes` display strings (`"DT-0140 – DT-0142"`, `"DT-0087"`), en dash included. The `q` filter is the same folded `like` as `searchCatalogue`.

**`get-book-detail-manager.ts`** is four reads on one `bookId`, scoped by RLS and joined to global `users` for names:

```ts
// The copy rows. `state <> 'retired'` is deliberately absent — a manager's
// page shows retired copies with their reason, unlike a reader's.
const copies = await tx`
  select
    cp.id, cp.code, cp.state, cp.condition, cp.condition_note,
    cp.acquired_on::text as acquired_on, cp.acquired_from,
    cp.acquired_from_membership_id,
    cp.lost_reported_at, cp.retired_at, cp.retired_reason,
    u.full_name as holder_name,
    l.due_on::text as due_on,
    coalesce(l.is_overdue, false) as is_overdue
  from book_copies cp
  left join loans_current l on l.copy_id = cp.id and l.status = 'active'
  left join users u on u.id = l.borrower_id
  where cp.book_id = ${input.bookId} and cp.deleted_at is null
  order by cp.code
`;

// BR §11: condition assessments are never deleted, so this is the whole
// history, oldest last.
const conditionHistory = await tx`
  select ca.assessed_at, ca.condition, ca.note, cp.code as copy_code,
         u.full_name as assessor_name
  from condition_assessments ca
  join book_copies cp on cp.id = ca.copy_id
  left join users u on u.id = ca.assessed_by
  where cp.book_id = ${input.bookId}
  order by ca.assessed_at desc
`;

// `loans.book_id` rather than a join through the copy — DB §4.5 stores it on
// the loan precisely so history survives the copy being retired.
const loanHistory = await tx`
  select l.id, cp.code as copy_code, u.full_name as borrower_name,
         l.lent_at, l.returned_at, l.status, l.return_condition
  from loans l
  join book_copies cp on cp.id = l.copy_id
  join users u on u.id = l.borrower_id
  where l.book_id = ${input.bookId}
  order by l.lent_at desc
`;
```

The `book` field reuses `getBooksList`'s row shape for one id; throw `NotFound("book_not_found")` when it is absent.

**`search-books-for-lending.ts`** is `searchCatalogue` with `requireManager`, no `is_published` filter, and the block derived — not stored:

```ts
return rows.map((r) => {
  const copiesAvailable = Number(r.copies_available);
  return {
    bookId: r.book_id,
    slug: r.slug,
    title: r.title,
    author: r.author,
    coverUrl: r.cover_url,
    copiesTotal: Number(r.copies_total),
    copiesAvailable,
    // The same code LendCopy will throw (C1), so the screen and the command
    // can never tell a volunteer yes and then no — the failure BR §16.3 is
    // written to prevent.
    ...(copiesAvailable === 0
      ? { blocked: true, reason: "copy_not_available" as const }
      : { blocked: false }),
  };
});
```

- [ ] **Step 3: Run it to verify it passes, then commit**

```bash
git add src/domain/catalogue/queries/get-books-list.ts \
        src/domain/catalogue/queries/get-book-detail-manager.ts \
        src/domain/catalogue/queries/search-books-for-lending.ts \
        tests/domain/catalogue/manager-queries.test.ts
git commit -m "feat(catalogue): the manager queries, each lendable row carrying its block reason"
```

- [ ] **Step 4: Run the whole suite before calling the slice done**

Run: `bun run check`
Expected: typecheck, lint, format and the full test suite all green. `bun run check` is what CI runs (X2); a slice that passes its own file and breaks another is not done.

---

## Known gaps, recorded rather than discovered

Each of these was found while writing this plan. None is invented work; each is a place where the source documents, the schema and the built screens do not line up, and where this slice chose not to widen its scope.

1. **`duplicate_isbn` has no unique index behind it.** It is a check-then-write in `CreateBook` and `UpdateBook`. `CreateBook`'s window is closed as a side effect of the per-shelf advisory lock `allocateCopyCodes` takes; `UpdateBook` takes no such lock, so two concurrent edits could both set the same ISBN. The structural fix is `create unique index … on books (bookshelf_id, isbn) where isbn is not null and deleted_at is null`, which is a migration — outside master §7.1's file list for B1. Worth one line in the next schema slice.

   **Correction (fix-report, 2026-08-08-b1-catalogue, IMPORTANT 2): the claim above about `CreateBook` was true of the design, not of what first shipped.** `CreateBook`'s ISBN check originally ran *before* `allocateCopyCodes`, not after — so the advisory lock had not yet been acquired at the point the check ran, and the window it was supposed to close was not actually closed. Verified live: two concurrent `CreateBook` calls with the same ISBN both committed, and `select count(*) from books where isbn = ...` returned 2. The command now runs the ISBN check *after* `allocateCopyCodes`, which is what makes this item's claim about `CreateBook` accurate. The `UpdateBook` half of this gap is unchanged and still open — it takes no lock, and fixing it is out of scope for this pass.

2. **The shelf-wide lost-copies view has no query.** `/tu-sach/[shelf]/quan-ly/sach/mat` renders *copy* rows across every title, and BR §16.3 explains at length why that view exists ("finding the one lost copy inside a shelf of a few hundred books, from within each book's own copy list, is not realistic"). Neither OPS §3.3 nor master §7.1 names a query for it — `GetBooksList` returns title rows. A seventh query is needed; naming it is a change to OPS §3.3, not something a slice plan should do on its own.

3. **Q3 leaves a copy that goes missing off the shelf with no honest state.** Recorded in full above. The product answer is one line in `policy.ts`'s `ALLOWED` if it comes back the other way.

4. **`Book.translator` exists in the fixtures and in no column.** The reader detail page renders "Người dịch" when present. Adding it is a migration.

5. **Two counts on built screens are hardcoded and now have a real source:** `183 cuốn có thể mượn hôm nay` (reader catalogue) and `214 đầu sách · 268 bản` (manager list). `getCatalogue`'s `total` and the sum of `copiesAvailable` supply the first; `getBooksList`'s `total` and a `sum(copiesTotal)` the second. E wires them.

6. **`requireRole` now exists twice** — `src/auth/guards.ts` and `src/domain/catalogue/policy.ts` — because the architecture test forbids the domain importing `src/auth`. The tidier end state is moving it into `src/domain/kernel/tenant.ts` beside `atLeast`, with `guards.ts` re-exporting. That edits `src/auth`, which is outside this slice.

7. **The C1 plan needs a reconciliation pass of its own before it starts**, on three points this slice found: `books.published` should be `books.is_published`; `audit_log.after_values` should be `audit_log.after`; and `search-books-for-lending` lives under `catalogue/queries/`, not `circulation/queries/`.
