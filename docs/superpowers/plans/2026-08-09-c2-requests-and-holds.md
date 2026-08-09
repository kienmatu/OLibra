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
