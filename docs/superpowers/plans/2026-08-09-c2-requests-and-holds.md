# C2 · Requests and holds

**Blocked by:** C1 (merged). **Blocks:** C3 (renewals), D1 (notifications). **Open:** Q1, Q2.

Master plan §7.6. Phase 2's core: the queue a child joins when the book they want is out.

---

## 1. Reconciliation, before anything else

Do this first and write the results into this document as a `## Reconciliation against shipped code` table (`docs/superpowers/plans/2026-08-08-b5-object-storage.md` §2 is the shape). Verify against `main` at `805e2ba`.

Every plan here has gone stale and every reconciliation has found something — C1's found 14, one of which would have survived a naive fix; U3's found a defect already shipped in a query the plan only warned *new* queries about; U2's found the slice's whole premise wrong.

Verify at minimum:

- **`borrow_requests`' real columns.** C1's reconciliation found `member_id` holds a **`users(id)`**, not a membership id, despite its name — and that renaming it would have made the statement run while leaving the comparison wrong, turning INV-3's key case into "a held copy is never lendable" with the pure predicate green throughout. Check every column this slice touches and say which is which.
- **What C1 already built of this.** `lendCopy` closes a hold it collects (`request.fulfilled` beside `loan.created`), `receiveReturn` takes `holdForRequestId` and creates the approved hold, and `copies_borrowable` excludes a copy named by a live hold. Those are C2's mechanics, shipped early. Do not rebuild them; find out exactly what exists.
- **The two named invariant tests.** `inv-03-only-available-or-own-hold.test.ts` exists (C1). `inv-02-not-held-and-on-loan.test.ts` — check whether it does, and read C1's PR note: INV-2 is representable *across two tables* even though `DATABASE.md` §7 claims otherwise, and C1 closed the one window it had found.
- Every `ErrorCode` this slice needs, and **check for OPERATIONS collisions** — `errors.ts` already names two as C2's: `membership_not_active` gets a different sentence under `CreateBorrowRequest` (`OPERATIONS.md:293`) and `copy_lost_or_retired` under `ApproveBorrowRequest` (`:305`). B1, B2a, B2b and C1 each had to split one.
- Whether `quan-ly/yeu-cau-muon` still renders fixtures, and that U3 **removed its nav entry and badge** because no query could answer them. This slice restores both.
- `receiveReturn`'s queued-reader panel, which C1 removed rather than faked because `GetBorrowRequestQueue` did not exist. It returns here.

## Reconciliation against shipped code

Checked against `main` at `805e2ba`, and against the live test database
(`information_schema.columns`, `pg_constraint`, `pg_indexes`, `pg_trigger`)
rather than against the migration files alone — the migrations rewrite each
other, and `20260808_04_composite_tenant_fks.sql` replaces four of
`borrow_requests`' six foreign keys.

Ordered by what each one would have cost had it gone unnoticed.

| The plan (or the catalogue) says | Live code says | Consequence for this slice |
|---|---|---|
| `borrow_requests.member_id` holds a `users(id)` despite its name | Confirmed live: `FOREIGN KEY (member_id) REFERENCES users(id)`. So does `decided_by`. `book_id`, `copy_id` and `fulfilled_loan_id` are composite `(bookshelf_id, …)` keys into shelf-scoped tables; `bookshelf_id` is the shelf | Every id this slice writes into the table is a **user** id except the four shelf-scoped ones. `copyLendable`'s `heldForUserId`/`forUserId` naming is the guard, and `HandoverRequest` resolves `memberships.user_id` before it compares anything |
| — (nothing says this anywhere) | **There is no uniqueness constraint of any kind on `(book_id, member_id)`.** The only indexes are `requests_queue`, `requests_holds`, the pkey and `(bookshelf_id, id)` | `duplicate_request` is an application check with a race window behind it, exactly the shape OPS §6 says an application check cannot close. Two taps in the same second put one child in the queue twice, ahead of the child behind them. Recorded in §7 below rather than fixed: closing it is a migration, and the master plan's file list for this slice has none |
| — | `requested_at` is `not null default now()` — the **database host's** clock, like `lent_at` before C1 wrote it explicitly | `CreateBorrowRequest` writes `requested_at` from `ctx.clock`, or the queue's ordering key and `copies_borrowable`'s `olibra_now()` comparison follow two different clocks and no `fixedClock` can order a queue |
| §1: "INV-2 is representable across two tables even though `DATABASE.md` §7 claims otherwise" | `DATABASE.md:1310` (the §7 table) **already says** the copy's own row is the database's half and the hold is "application, in a transaction", and §4.4 (`:757`) spells the two-table window out in full | C1 corrected the document as well as the code. Nothing to re-argue; the test is still missing |
| §1: check whether `inv-02-not-held-and-on-loan.test.ts` exists | It does not. `tests/invariants/` has INV-1, 3, 4, 5, 7, 8, 9, 10, 11, 12, 13, 14 | Written in this slice. Master §7.6 names it |
| C1 built `lendCopy`'s hold collection | `lend-copy.ts:219-222` collects the hold only when `hold_request_id` is non-null **and** `held_for_user === member.user_id`; `:326-338` writes `status='fulfilled'` + `fulfilled_loan_id` and pushes `request.fulfilled` beside `loan.created`; `loans.request_id` points back | Not rebuilt. `HandoverRequest` is the request-shaped entry to the same two writes and must not restate either |
| C1 built `receiveReturn`'s hold creation | `receive-return.ts:132-134,214-236` — `holdForRequestId` → `resolveHold` → `status='approved'`, `copy_id`, `hold_expires_at` from `ctx.clock`, `decided_by`, `decided_at`, plus a `request.approved` audit row; `:258-265` already returns `queuedRequestId` in `requested_at asc, id asc` order | `ApproveBorrowRequest` is the same effect from the queue screen. The `hold_days` read and the expiry arithmetic (`expiryFrom`) are already written and are lifted, not copied |
| C1 built `copies_borrowable`'s hold clause | `20260808_14_olibra_now.sql:114-126` — `state = 'available'` **and** no `approved`, un-deleted request with `hold_expires_at > olibra_now()` | Both clauses matter, and this slice makes the first one live: `ApproveBorrowRequest` moves the copy `available → held`, which `catalogue/policy.ts`'s table permits. `inv-03-…test.ts:185-212` deliberately exercises both shapes so it survives that choice |
| `errors.ts` names two collisions as C2's | Confirmed, and **no third**. A pass over every `` `code` — "sentence" `` pair in `OPERATIONS.md` finds nine colliding codes; of the nine, exactly `membership_not_active` (`:293`, `CreateBorrowRequest`) and `copy_lost_or_retired` (`:305`, `ApproveBorrowRequest`) belong to this slice's five commands. `request_not_pending` is used twice (`:306`, `:316`) with the identical sentence, so it is a reuse and not a collision | Two new codes. Seven of the nine codes these commands need are already in `ERROR_MESSAGES` (`hold_expired`, `no_copy_available`, `request_not_pending`, `duplicate_request`, `not_own_request`, `request_already_fulfilled`, `loan_limit_reached`) |
| — | OPS gives `HandoverRequest` three failure modes and none of them covers **a request that names no live hold at all** (`pending`, `rejected`, `cancelled`, `fulfilled`) | One code with Vietnamese nobody wrote. Flagged in §8 below and in the report, not slipped in |
| — | `audit-actions.ts` has `request.approved` and `request.fulfilled` (C1's) and nothing else in the family | `request.created`, `request.rejected`, `request.cancelled` are added — three new sentences. `request.skipped` is **not** added: P1 made the map the type, so the absent key is what makes `SkipRequest` unwriteable rather than merely unwritten |
| §1: U3 removed the nav entry and the badge | `manager-shell.tsx:125-158` — no `yeu-cau-muon` entry; `ManagerNavKey` (`:77-92`) still carries the key, deliberately, "because their routes still exist". `ManagerBadgeCounts` (`get-manager-dashboard.ts:35-39`) has three fields | The entry and a fourth count come back. Two docstrings — that one and `getManagerDashboard`'s `:150-156` — assert that no query in this codebase could answer *Yêu cầu mượn*; both become false and are corrected in the same commit that makes them false |
| §1: `quan-ly/yeu-cau-muon` still renders fixtures | `page.tsx` renders `bookBySlug`, `readers`, `shelfBySlug`, three hand-written dates (`02/08`, `03/08`, `04/08`, `30/07`), a hand-written expiry (`09/08`) and `viewer={null} counts={null}` | Rewritten against the query. `src/lib/fixtures.ts:979`'s `dashboardStats` entry is dead already — the dashboard reads `getManagerBadgeCounts` — so nothing else has to move |
| §1: `receiveReturn`'s queued-reader panel returns | `nhan-tra/page.tsx:71-77` and `actions.ts`'s `receiveReturnAction` both say in prose that `holdForRequestId` is never sent because the query does not exist | Panel and action wire up; both paragraphs are rewritten rather than left describing a state that has ended |
| OPS §3.3: `GetBorrowRequestQueue`, "requests grouped by book, in request-time order" | Does not exist. `src/domain/circulation/queries/` holds `get-overdue-loans.ts` and `search-loans-for-return.ts` | Written. `requests_queue` is partial on `status = 'pending'` and carries no `id`, so it cannot serve a query that also reads `approved` rows — the ordering tiebreak is the `order by`'s, never an index's |
| — | `borrow_requests` has **no** `rejection_reason`; the column is `decision_note`, and `decided_by`/`decided_at`/`decision_note` are shared by approve and reject | Q2's optional reason lands in `decision_note`. No migration |
| — | `borrow_requests` carries `borrow_requests_tenant` from `0010_rls.sql`'s loop, and `borrow_requests_set_updated_at` from `20260808_06` | Reads are scoped by RLS, not by a `where bookshelf_id`. Writes are `using`-filtered, so every UPDATE goes through the kernel's zero-row guard rather than trusting the filter |

**Nothing here blocks the slice.** The two genuinely new facts are the missing
uniqueness constraint (§7) and `HandoverRequest`'s unnamed refusal (§8).

## 2. Scope

Five commands, all well specified:

`CreateBorrowRequest`, `ApproveBorrowRequest`, `RejectBorrowRequest`, `CancelOwnRequest`, `HandoverRequest` — plus the queue query the manager screen and `receiveReturn` both need.

**`SkipRequest` is deliberately not in this slice.** See §4.

## 3. Decisions

### 3.1 Hold expiry is derived on read, and that is now testable

Master §7.6's acceptance: *"hold expiry is computed against `now()` at read time (G5) — the test advances an injected `Clock` rather than sleeping, and asserts a hold silently stops being handable-over without any job running."*

That was unachievable when it was written. `olibra_now()` shipped since, so `copies_borrowable`'s `hold_expires_at > olibra_now()` follows the injected clock — `tests/db/sql-clock.test.ts` is the worked example. There is no excuse for a sleep in this slice.

### 3.2 `HandoverRequest` is not `LendCopy`, and the test that separates them is named

Master §7.6: *"reader A holds a hold on copy X; handing X to reader B must fail even though B is an active member in good standing."*

C1's `lendCopy` already refuses this — its own-holder branch compares `heldForUserId` to `forUserId`. What C2 adds is the *request-shaped* path to the same book, and the risk is that it grows a second definition of who may take a held copy. It must consult `copyLendable` in `src/domain/circulation/policy.ts`, not restate it.

### 3.3 The queue is `requested_at` order, with a unique tiebreak

BR §7.2: ordered by `requested_at`, no separate reservation concept.

`requested_at` is a timestamp with no unique constraint, and this project has now shipped that defect twice — U2 measured 304 distinct titles collapsing to 229 across a paged walk, and U3 found *two* tiebreak tests that were green in the broken state (one depending on prepared-statement execution order, the other on an all-keys-tie fixture that made PostgreSQL take its presorted short-circuit). Any ordering here needs a unique tiebreak and a fixture non-degenerate enough that the guard actually bites.

### 3.4 Q2 is implemented on its assumed reading

Q2 asks whether `RejectBorrowRequest` requires a reason. `RejectMembership` and `RejectComment` both require one; the borrow queue's *Từ chối* button says nothing. **Assumed reading: optional, as the UI implies.** Cheap to reverse — a validation rule and a notification field — so it does not block.

## 4. Q1 — `SkipRequest` is out of scope, and this is why

The queue screen shows *Bỏ qua* and *Từ chối* as separate buttons on the same pending row, and neither BR §7.2 nor the UI says what different end state skip produces. OPS calls it *"the least well-specified command in the catalogue"*.

The master plan's assumed reading is that skip is **not terminal**: a pending request stays pending but *deprioritised*; an approved or held one reverts to pending and releases its hold.

**"Deprioritised" cannot be built without deciding something the requirements appear to forbid.** The queue is `requested_at` order with no separate reservation concept (BR §7.2). To move a skipped reader behind others you must store something — a skip count, a `skipped_at`, a synthetic ordering key — and that *is* a separate ordering concept. The alternatives are materially different products:

- skip is a no-op on ordering and merely records that a manager passed over somebody;
- skip pushes the reader to the back of the queue for that title;
- skip suppresses them for one turn only.

A child who asked first and keeps being passed over experiences each of those very differently, and choosing between them is not a technical call. **The other five commands do not depend on it**, so the queue ships and works; *Bỏ qua* renders disabled until it is answered, the way `Xin mượn` did before this slice.

## 5. Acceptance

- [ ] INV-2 (`inv-02-not-held-and-on-loan.test.ts`) and INV-3's handover case are both named tests
- [ ] A hold stops being handable-over when the clock advances — no write, no job
- [ ] Handing reader A's held copy to reader B fails, and the refusal comes from `copyLendable`, not a second rule
- [ ] The queue is `requested_at` order with a unique tiebreak, guarded by a fixture that genuinely discriminates
- [ ] Every refusal carries the sentence OPERATIONS.md gives *that* command; collisions split rather than reused
- [ ] `quan-ly/yeu-cau-muon` reads the database; its nav entry and badge return
- [ ] `receiveReturn`'s queued-reader panel returns
- [ ] `bun run check` green, **CI green on the PR**

## 6. Out of scope

`SkipRequest` (§4); renewals (C3); notifications (D1) — this slice writes no notification row, and the commands that will need to are named so D1 can find them.

## 7. The duplicate-request race, named rather than closed

`duplicate_request` ("Bạn đã có một yêu cầu đang chờ cho cuốn này.") is
enforced by a `select` inside `CreateBorrowRequest`'s transaction and by
nothing else. There is no partial unique index on
`(book_id, member_id) where status in ('pending','approved')`, and OPS §6 is
explicit that a read-then-write pattern "however careful, has a race window
between the two steps".

The window is small and the harm is bounded — a child appears twice in one
title's queue, once ahead of somebody who asked later — but it is the same
shape as INV-1's, and INV-1 got an index. The fix is one migration:

```sql
create unique index requests_one_open_per_member
  on borrow_requests (book_id, member_id)
  where status in ('pending', 'approved') and deleted_at is null;
```

It is not in this slice because master §7.6's file list contains no migration,
because a partial unique index over a *soft-deleted* table is the shape
`20260808_03` and `20260808_09` each had to correct once already, and because
the command's `select` closes the ordinary case (a stale page, a second tap
seconds later) that the queue screen actually produces. Recorded here so the
next slice to open `src/db/migrations/` finds it written down.

## 8. `HandoverRequest`'s fourth refusal, and the Vietnamese it needs

OPS §4.2 gives `HandoverRequest` three failure modes — `hold_expired`,
`membership_not_active`, `loan_limit_reached` — and none of them describes a
`requestId` that names a row with **no live hold to hand over**: a `pending`
request nobody has approved, or one already `rejected`, `cancelled` or
`fulfilled`. The command must still answer, because a stale queue page posts
exactly that.

Nothing in the catalogue fits. `request_not_pending` ("Yêu cầu này đã được xử
lý.") is a false statement about a *pending* request, which is the commonest of
the four. `hold_expired` is a false statement about a request that never had a
hold. `request_not_queued` is `ReceiveReturn`'s, about a different title.

So this slice authors one sentence, and says so:

> `request_not_held` — "Yêu cầu này không có bản sách nào đang được giữ chỗ."

Factual rather than instructive, unlike most of `ERROR_MESSAGES`: BR §17.7 asks
a refusal to name what to do instead, and what to do instead differs across the
four states it covers (approve it; nothing, it was refused; nothing, it was
withdrawn; nothing, the book already went out). The queue screen shows which,
directly above the button. Listed in the fix report as new Vietnamese.
