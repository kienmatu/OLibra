# Laravel Migration — Phase 1c: Circulation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Not started

**Goal:** The point of the whole system, running end to end: a volunteer standing at the shelf lends a book in three taps (`LendCopy`), receives it back with a condition in two (`ReceiveReturn`), reports it lost from inside the return flow (`ReportCopyLost`'s second entry point), sees who is late and calls them (`GetOverdueLoans`), undoes a mistaken lend (`VoidLoan`), and a reader checks their own loans from home and asks for more time (`GetMyDashboard` + `RenewLoan`) — every write serialised against MariaDB's REPEATABLE READ, every state change audited in its own transaction (INV-8), and INV-1 guaranteed by the `loans_one_active_per_copy` unique index, never by a read.

**What this plan is not.** Phase 1 (BR §1.4's core loop) is split into four plans, each producing working software (the split is recorded in the 1a plan's header):

- **1a Catalogue** — done. Categories, books, copies, the copy-state commands.
- **1b Members** — done. Readers, registration, approval, the lifecycle commands.
- **1c Circulation** — this plan. Quick-lend, return with condition, renewals, overdue, void, the lost-copy entry from returns. Needs 1a and 1b; both are merged.
- **1d Oversight** — audit-log surfacing, the manager dashboard, CSV export.

**The OPS §4.2 census, taken fresh for this plan.** §4.2 contains exactly **ten** `####` command entries. By name: `LendCopy`, `HandoverRequest`, `ReceiveReturn`, `RenewLoan`, `VoidLoan`, `CreateBorrowRequest`, `ApproveBorrowRequest`, `RejectBorrowRequest`, `SkipRequest`, `CancelOwnRequest`. **This plan implements four**: `LendCopy`, `ReceiveReturn`, `RenewLoan`, `VoidLoan`. The other six are all borrow-request machinery, and spec §11 assigns "borrow requests, holds and the waiting queue" to **Phase 2** — verified against both the spec and the reference rather than assumed:

- **`CreateBorrowRequest`, `ApproveBorrowRequest`, `RejectBorrowRequest`, `CancelOwnRequest`** — the request lifecycle itself (`pending → approved → fulfilled/…`, BR §7.2). Phase 2, whole. The reference implements all four in `old_next/src/domain/circulation/commands/`.
- **`HandoverRequest`** — `held → on_loan` for the reader an approved hold names (INV-3's second clause). It is a circulation command by OPS placement, but its *precondition is a hold*, which cannot exist before `ApproveBorrowRequest` does. **Phase 2**, alongside the request commands it cannot run without.
- **`SkipRequest`** — Phase 2, and OPS §4.2's own open question calls it "the least well-specified command in the catalogue". Noted for Phase 2's planner: **the reference has no `skip-request.ts` at all** — nine command files exist in `old_next/src/domain/circulation/commands/`, and skip is not among them, so Phase 2 inherits the product-owner question with no reference behaviour to port.

One §4.1 command is *touched* but not re-implemented: **`ReportCopyLost`** (shipped in 1a) gains its second UI entry point — "Bạn đọc báo làm mất" inside receive-return (OPS §4.2's note under `ReceiveReturn`; BR §16.3 step 2) — with its contract unchanged, plus one concurrency hardening to its loan-closing read (Task 4, divergence 2).

**The circulation query census (OPS §3), same discipline.** The queries this plan implements:

- **`SearchBooksForLending`** (§3.3) — quick-lend step 1. **Phase 1a explicitly deferred this query to this plan**; the reference implementation lives in `old_next/src/domain/catalogue/queries/search-books-for-lending.ts`.
- **`SearchReadersForLending`** (§3.3) — quick-lend step 2 (1b's header names it as 1c's; reference in `old_next/src/domain/members/queries/search-readers-for-lending.ts`).
- **`SearchLoansForReturn`** (§3.3) — return step 1.
- **`GetOverdueLoans`** (§3.3) — the overdue screen.
- **`GetMyDashboard`** (§3.2) — **the loans half only**: current loans with days-remaining and the renew button/refusal, plus recently returned. The requests half (pending requests, queue position, hold expiry) is Phase 2's, with the request lifecycle; the section renders as an explicit empty state until then. Building the loans half now is not the defer-the-page-whole call 1a made for `GetShelfHome`, and deliberately so: `RenewLoan` is this plan's command and BR §16.2's "Xin gia hạn" button is its only surface — a renewal command with no screen would ship dead.
- **`GetMyLoanHistory`** (§3.2) — the reader's full history with return condition. Pure circulation data, no Phase-2 dependency.

**Deliberately absent, each named with the phase that owns it:**

- **`GetBorrowRequestQueue`** (§3.3) — Phase 2, with the queue it reads. This has a visible consequence inside `ReceiveReturn`: OPS §5's step 3 ("Check the queue… the manager is offered Giữ chỗ cho…") cannot happen with no queue to check, so this plan's `ReceiveReturn` ships **without** the `holdForRequestId` input and without the `queuedRequestId` result — see divergence 4 for the exact contract narrowing and what Phase 2 must restore.
- **`GetManagerDashboard`** (§3.3) — 1d builds the dashboard; this plan's data makes the overdue stat card computable. The `/manage` route stays `under-construction`.
- **`ExportLoansCSV`** (§3.3) — 1d, with the other exports.
- **`ResolveCopyById`** (§3.3) and the `CopyScanField` QR-scan box on the lend/return screens — spec §11 puts QR labels in Phase 2; until a label exists there is nothing to scan. Typing the copy code into the search box (which all three lending searches match) is the complete path meanwhile.
- **Due-soon/overdue notifications and the sweep** (OPS §7) — Phase 2, with the notification system. BR §8 keeps the overdue *status* correct meanwhile: it is computed on read, so nothing a user sees is wrong, only not-yet-announced.
- **`GetStatistics`, `GetAuditLog`, `GetManagerActivity`** — 1d/Phase 3 per spec §11.

**Architecture:** Per the spec's §1.3 carve-out and 1a/1b's established shape: single-purpose Action classes in `app/Actions/Circulation/`, Form Requests in `app/Http/Requests/Circulation/`, `LoanPolicy` delegating to the act-as gates, thin controllers, Inertia pages. Pure functions with no I/O in `app/Support/Circulation/` (the lending predicates, the date arithmetic, the copy chooser); read shapes in `app/Queries/`. Every command writes its audit rows in the same `DB::transaction` as its state change (INV-8, OPS §1).

**Tech Stack:** unchanged — PHP 8.4, Laravel 13, Inertia v3, React 19, Tailwind v4, MariaDB 10.11, Pest 5, Larastan level 8, Pint, Biome 2, Bun.

**Spec:** docs/superpowers/specs/2026-08-26-laravel-mariadb-inertia-migration-design.md

**The reference implementation is the specification.** `old_next/src/domain/circulation/` (commands, queries, `policy.ts`, `settings.ts`), `old_next/src/domain/catalogue/queries/search-books-for-lending.ts`, `old_next/src/domain/members/queries/search-readers-for-lending.ts`, and the tests — `old_next/tests/domain/circulation/` plus the invariant suites `old_next/tests/invariants/inv-01…inv-07` and `inv-11` — encode rules that took many fix-waves to get right (the held-for-me clause of INV-3, the INV-4-before-INV-5 refusal order, the renew-from-due-date-not-today arithmetic, the queue-on-title-not-copy check, the one-statement returned+condition write). **Every Action task below starts by reading the TypeScript test it ports.** Where this plan diverges from the reference, the divergence is named inline with its reason. The divergences, collected:

1. **Every circulation write serialises on a row lock taken as the transaction's FIRST statement, and the lock order is fixed: copy before loan, copy before membership.** The reference ran plain selects then writes, affordable under Postgres's per-statement READ COMMITTED plus RLS; under InnoDB's REPEATABLE READ the read view pins at the transaction's first consistent read, and a lock taken afterwards cannot un-pin it — the exact rule 1a paid two fix rounds for and 1b carried from the start ("nothing may read before the lock"). Concretely: `LendCopy` locks the **copy** row first, then the **membership** row; `ReceiveReturn` and `VoidLoan` lock the **copy** row first (located from the route-bound loan's own `copy_id`, an in-memory attribute, no query), then the **loan** row; `RenewLoan` locks only the **loan** row (it writes no copy state, and holding a single lock keeps it out of every two-lock ordering question). One global order means no AB–BA deadlock between any two of this phase's commands.

   **The explicit order is not the whole lock set — named here after a review traced every path.** Every one of these transactions also takes *implicit* InnoDB locks nobody wrote down: an FK check on INSERT takes a **shared** record lock on each parent row. So `AuditRecorder::record` ends every command by taking S on the shelf's `bookshelves` row and on the actor's `users` row; `LendCopy`'s `loans` INSERT takes S on `bookshelves`, `books`, `book_copies` and both `users` rows; `ReceiveReturn`'s `condition_assessments` INSERT takes S on `bookshelves`, `book_copies` and `loans`. Traced against the shipped 1a/1b paths, **no AB–BA cycle exists**: 1a's `AllocateCopyCodes` takes `bookshelves` **X** as its first statement, but everything it needs afterwards is an S lock on rows it already holds or on freshly inserted ones, so it never waits on a circulation-held lock — the wait is one-directional (a circulation write blocks behind an in-flight `CreateBook`/`AddCopies` on the same shelf, never the reverse), and 1b's lifecycle commands hold `memberships` X and then need only S on `bookshelves`/`users`, which no circulation command holds exclusively. What this *does* mean, and what Task 14 must record, is that **an in-flight `AddCopies` serialises every concurrent lend, return, renewal and void on that shelf** — because each of them needs an S lock on the very `bookshelves` row `AllocateCopyCodes` is holding in X. That is a throughput property, not a correctness one, and it predates this phase; it is named so Phase 2 does not rediscover it as a mystery. Any future circulation command must follow copy → loan → membership *and* keep its audit write last, or the implicit set can reorder underneath the explicit one.

   Each command's test pins the lock **position** with the query-log idiom (`$log[0]`), with `DB::flushQueryLog()` between commands in any multi-command test method — known-gaps: `disableQueryLog()` does not clear the buffer.
2. **1a's `ReportCopyLost` gains the same discipline for its loan close** (Task 4). As shipped, it locks the copy and then closes the active loan through a *plain* read + blind `update()` — racing this plan's `ReceiveReturn`, that update could blindly flip a just-`returned` loan to `lost` after the return commits (the plain read sees `active` from its snapshot, the UPDATE waits on the return's row lock, then applies over the committed return). The fix is one word: the loan read becomes `->lockForUpdate()->first()` — a locking read sees the latest committed row, and the copy→loan order matches divergence 1.
3. **INV-5's count gains a serialisation the reference never had.** The reference's loan-limit count was a plain read with no structural backstop (no unique index counts loans), so two concurrent lends of *different* copies to the same reader could exceed `max_concurrent_loans`. Here the membership-row lock (divergence 1) serialises every `LendCopy` for a given reader, so the count is taken while no rival lend for that reader can be in flight. INV-1 remains the only *index-backed* invariant in this phase; each task's plan text says per check what serialises it and what backs it structurally, rather than implying more than is true.
4. **`ReceiveReturn`'s contract is narrowed for this phase, explicitly.** No `holdForRequestId` input, no `queuedRequestId` result, no `request_not_queued` failure mode, no `request.approved` second audit row, no notification write — all of it is the queued-reader decision, which cannot exist before Phase 2's requests do. What ships is OPS §5 step 5's first sentence whole: close the loan (`status`, `returned_at`, `received_by`, `return_condition`, note, photo) **and** write the `ConditionAssessment` row in one transaction, copy `on_loan → available`. Phase 2 must restore the hold branch exactly as `old_next/src/domain/circulation/commands/receive-return.ts` writes it (both facts one transaction, two audit rows, `hold_expires_at` from the injected clock, the copy never observably `available` in between) — Task 14 records this in known-gaps so it is a ledger entry, not a memory.
5. **`RenewLoan`'s arithmetic runs in PHP on the locked row, not in SQL.** The reference computed `due_on + n` in SQL so no expression could accidentally mean "today"; that reasoning assumed an unlocked row. Under divergence 1 the row is locked before the read, so `LoanTerms::renewedDueDate($loan->due_on, $renewalDays)` is equally race-free — and the INV-6 property (from the *current due date*, never today) is pinned by renewing an already-overdue loan and asserting the result is `due_on + renewal_days`, not `today + renewal_days`.
6. **`loans_current` (the Postgres view) becomes `App\Support\Circulation\LoanTerms`** — spec §4's row: views "encode read shapes, not invariants". `is_overdue` and `days_remaining` get ONE home, BR §8's shape, exactly as 1a made `CountsCopies::borrowable()` the one home for availability. 1b's `ReaderDetailQuery` derived both locally with a declared intent to move here ("two definitions of overdue is the drift BR §8 exists to prevent") — Task 1 performs that move and repoints the query.
7. **Query-string and form field names are English** (`?q=`, `?book=`, `?reader=`, `?loan=`, `?sort=`; posts carry `copy_id`, `membership_id`, `condition`, `note`, `reason`) where the reference used Vietnamese (`?sach=`, `?nguoi-doc=`, `?muon=`, `?ban=`, `?loi=`) — spec §6, the same rule 1b applied.
8. **A refusal renders through `back()->withErrors(['rule' => …])`**, the one `RuleViolated` render hook in `bootstrap/app.php`, instead of the reference's `?loi=` query-param round-trip — 1b's divergence 9, unchanged. The confirm screen still shows its *pre-flight* blocks from query data (BR §16.3: before the confirm step), and the command's own refusal arrives as the shared `errors.rule` prop.
9. **The quick-lend copy chooser ports the reference, not BR §16.3's copy selector.** BR §16.3 sketches "a copy selector appears between steps one and two" for multi-copy titles; the reference never built one — `chooseCopyToLend` (`old_next/src/lib/lending.ts:120`) auto-picks the lowest-code lendable copy so step 2 and step 3 name the same physical book. Parity mandate: port the chooser (`App\Support\Circulation\ChooseCopy`), defect included — a title with copies recorded but none returnable reads `copy_lost_or_retired`; a title with **no copies at all** keeps `copy_not_available` ("Bản sách này đang được mượn hoặc đang giữ chỗ." — wrong for that case, and the reference's own comment says so and says why a private fix here would make step 1 and step 3 disagree). Task 14 records both in known-gaps.
10. **Refusal code spellings are the reference's `errors.ts`, sentences verbatim** — the same two-ledger rule 1b's divergence 6 established. New keys this plan adds to `lang/vi/rules.php`: `copy_lost_or_retired`, `membership_not_active`, `loan_limit_reached`, `loan_not_active`, `loan_not_active_cannot_void`, `no_renewals_remaining`, `title_has_queue`, `reason_required` ("Vui lòng ghi lý do huỷ." — VoidLoan's, distinct from 1a's `retire_reason_required` and 1b's `reject_reason_required`, a collision `errors.ts`'s own comment block documents resolving). `copy_not_available`, `membership_not_found` and `shelf_not_found` already exist from 1a/1b and are reused, not re-keyed. `loan_not_active` covers not-found, not-mine and already-processed alike — OPS §4.2 lists no `loan_not_found`, and distinguishing them would leak that another shelf's loan exists (the reference's argument, kept). `loan_not_active_cannot_void` is `VoidLoan`'s own, because "Chỉ có thể huỷ lượt mượn đang diễn ra." asks something different of the manager than the double-submit sentence does.

## Global Constraints

Phase 0's, 1a's and 1b's Global Constraints all still bind — branch `feat/phase-1c-circulation` (already created off merged `main`, `d87933a`), MariaDB 10.11 via the `mariadb` driver, PHP 8.4, UUIDv7 `VARCHAR(36) ascii_bin`, `DATETIME(6)` UTC, enums as `VARCHAR(20) ascii_bin` + CHECK, English URIs, Bun/Composer, Pint + Larastan level 8 clean at every commit, commit per task in lowercase `type: sentence` style. Additionally, for this plan:

- **`old_next/` is read-only.** Nothing under it is edited, moved or deleted.
- **Nothing may read before the lock.** Every circulation write transaction's first statement is a `lockForUpdate()` re-read (divergence 1's order: copy → loan, copy → membership). Route-bound models are treated as stale snapshots — 1a's copy-state actions validated one and would have retired a copy on loan. Every check after the lock reads either a locked row or a query issued after the first lock.
- **INV-1 is a constraint, not a check.** `loans_one_active_per_copy` (errno 1062, translated by `App\Support\UniqueViolation` to `copy_not_available`) is the only thing standing between two phones and two active loans on one book. No pre-check replaces it; every pre-check exists only for the kind sentence.
- **Derived state is computed on read** (BR §8): overdue, days-remaining and availability come from stored data plus `App\Support\Clock` at query time. Overdue's one home is `App\Support\Circulation\LoanTerms`; availability's is `CountsCopies::borrowable()`. If a task seems to need an `is_overdue` column or a status-writing job, the task is wrong.
- **Domain time goes through `App\Support\Clock`** — `now()` is UTC, `today()` is the civil date in `Asia/Ho_Chi_Minh`. Nothing in this plan calls `now()`/`Carbon::now()` directly; `due_on` is a DATE and all due-date arithmetic starts from `Clock::today()` (BR §5.4: a book is due at the end of a day, and a lend at 23:30 UTC is already tomorrow morning in Hồ Chí Minh City).
- **Every command writes audit in the same transaction** (INV-8, OPS §1), through `AuditRecorder`, storing the book's title *in* the entry (the audit sentence must not re-read a title `UpdateBook` can later correct — the reference's P1 §3.2a rule).
- **`loans` stores user ids, not membership ids.** `borrower_id`, `lent_by`, `received_by`, `voided_by`, `lost_reported_by` all reference `users(id)`. `LendCopy`'s *input* is a membership (what the screen has); the Action resolves `->user_id` once and writes only that. The reference's docblock calls the membership-id-into-borrower_id mistake unwriteable-without-noticing; keep it that way by naming every variable for the id it carries.
- **`loans_returned_has_condition` and `loans_voided_has_reason` are single-statement writes.** Status and its companion column (`return_condition` / `void_reason`) go in ONE `update()`, never two — split writes raise the CHECK mid-transaction. The same constraint bites test fixtures: **a `returned` loan fixture must carry a `return_condition`** (this exact CHECK has already broken two tasks' fixtures in this repo).
- **No hand-written `where('bookshelf_id', …)`** outside `BookshelfScope` — `TenancyArchitectureTest` greps for it. The loan-limit count, the queue check and every list query rely on `BelongsToBookshelf`'s global scope for tenancy.
- **Never call `withoutGlobalScopes()` with no argument** (it strips `SoftDeletingScope` too); the one named skip is `withoutGlobalScope(BookshelfScope::class)`.
- **Authorization refusals over HTTP are 404, never 403** (BR §5.4 anti-enumeration). Routes sit behind `role:manager`/`role:reader` middleware (which 404s); every new Form Request `authorize()` uses `abort_unless(Gate::allows(...), 404)`, never a bare bool — the exact five-request fix 1b's PR #61 landed.
- **`SessionGuard` caches the `actingAs` user for the rest of a test method** — guest and non-member coverage is ALWAYS its own `it()` block, never appended after any `actingAs(...)`, including one inside a fixture helper.
- **UUID v7 primary keys make an unordered scan return rows in creation order** — every ordering test seeds in an order that DIFFERS from the asserted order, forcing collisions on the primary sort key so the tiebreak is falsifiable; where the tiebreak is the v7 id itself (which always equals creation order), the test pins the ORDER BY mechanism and says so.
- **`DB::flushQueryLog()` between commands** in any test method that pins lock position for more than one command — `disableQueryLog()` does not clear the buffer, and a stale buffer makes the pin pass regardless of mutation.
- **Prove an absence by leaking exactly one key** — `array_key_exists()` per key, one assertion each; never `not->toHaveKeys([...])`, never `not->toHaveKey($key, "message")` (both inert, known-gaps). Every fixture row in a same-shape sweep gets a distinct identity, or an unordered `->first()` collapses the cases.
- **Fixture names must dodge `UserFactory`'s pool and `DemoShelfSeeder`** — the factory's five-name pool contains `'Trần Minh'` verbatim and the seeder reuses names across roles; any test that matches on a name pins it explicitly to a name outside the pool.
- **The "second shelf" fixture template needs `TenantContext::actSystemWide()`** before creating tenant-scoped rows, then `set()` to rebind — three tasks failed identically without it.
- **A validation rule can crash on bytes it was not written for** — every free-text field's rule list leads with `bail` and carries `encoding:UTF-8` (`note`, `reason`), the exact fix 1b's PR #61 Task 1 landed after a NUL byte 500'd `POST /register` from inside validation.
- **Every new literal `new RuleViolated('code')` under `app/`** is added to `RuleViolatedCodesHaveSentencesTest`'s census (Task 14); predicate codes thrown as variables are censused by `LoanRulesTest` (Task 1), the `CopyStateMachineTest` precedent.
- **No inline Vietnamese in TSX** — client copy in `resources/js/lib/copy.ts` (Biome's `noJsxLiterals` is an error), server refusal sentences in `lang/vi/rules.php`.
- **Test helper names are process-global** (AGENTS.md). This plan's helpers, checked against `grep -rn "^function " tests/` and the 1a/1b registries (`lcFixture`, `rdFixture`, `rqFixture` etc. are TAKEN): `lendFix` (Task 3 — `assertLocksCopyFirst` struck in review: the draft defined it and never called it), `lpFix` (Task 2), `retFix` (Task 4), `renFix` (Task 5), `voidFix` (Task 6), `lqFix` (Task 7), `odFix` (Task 8), `mydFix` (Task 9), `qlFix` (Task 10), `rtsFix` (Task 11), `ovdFix` (Task 12), `rdbFix` (Task 13). Before adding any further helper, grep first.
- **Factories under a bound tenant:** build fixtures under `TenantContext::actSystemWide()` (or pass `bookshelf_id` explicitly), then `set()` the tenant before acting.
- **`make test FILTER=…`** runs a filtered suite; `make lint` is Pint; `make analyse` is Larastan. Scratch output goes to `.artifacts/` (gitignored).

## Open questions surfaced by this plan — the product owner's, not this plan's, to settle

1. **Q4: may a suspended reader renew?** INV-4 blocks *new* loans and explicitly protects existing ones; a renewal extends an existing loan. OPS §4.2's open question under `RenewLoan` says both readings are defensible and the requirements never settle it. The reference implements **allowed** — no membership-status check in `renewLoan`, with a named test ("Q4: a suspended reader may still renew") so reversing is loud. **This plan ports that reading** (parity mandate; a product change must not smuggle in mid-migration). Reversing later is one predicate call in `RenewLoan` plus one test — Task 5 marks the exact line.
2. **`VoidLoan` gets a button this plan invents.** Verified by grep: no file under `old_next/src/app/` calls `voidLoan` — the reference implements and tests it but surfaces it from **no screen**, the `DeleteBook`/`ManagerRegisterReader` shape. But BR §3 names "a manager records a loan by mistake and needs to undo it" as a case the system must handle, and a command with no surface handles nothing — the same trap-with-no-way-back argument that earned `ReactivateMembership` its 1b button. **This plan puts "Huỷ lượt mượn" on the manager book detail's on-loan copy row** (Task 12), behind a required-reason form. If the product owner rules the other way, delete the one form and the route — the Action and its tests stay, and the architecture pin flips to absence.
3. **The quick-lend escape hatch — and why the reference reading defeats a 1b ruling, so this plan should NOT simply port it.** BR §16.3 step 2 wants "a register a new reader escape hatch". Verified in the reference: `cho-muon/nguoi-doc/page.tsx:262` links to `nguoi-doc/moi` — the **on-behalf form** (`RegisterMemberOnBehalf` → `pending`). So the button, *as shipped*, produces a reader the very next screen refuses under INV-4.

   **But the reference's own documentation says that button is wired to the wrong command.** `quan-ly/actions.ts:743-747` and `quan-ly/nguoi-doc/moi/page.tsx:50-53` both state, in the reference's own words, that `managerRegisterReader` "is BR §16.3's quick-lend escape hatch, which lives on `quan-ly/cho-muon/nguoi-doc`… a different screen for a different moment (mid-lend, with a book in hand)". The reference implements `managerRegisterReader`, tests it, documents where it belongs — and never built that screen. What ships on `cho-muon/nguoi-doc` is a link to the *other* form. That is a reference **gap**, not a reference **decision**, and porting a gap as though it were a decision is the failure mode this project's divergence discipline exists to prevent.

   **And Phase 1b already ruled on it.** The 1b plan's divergence 8 (`docs/superpowers/plans/2026-08-28-laravel-phase-1b-members.md:64`) says verbatim: "`ManagerRegisterReader` ships with no route… the quick-lend escape hatch (`/manage/lend/reader`) is **1c's surface**. This plan ports the Action and its tests, and Task 16's architecture test pins the route's *absence* so wiring it is a decision, not an accident." 1b's open question 1 chose `active` **on the explicit ground that a pending result "would defeat the escape hatch's purpose"**, and its Task 7 test is named "the quick-lend escape hatch produces a member who can be lent to at once" (1b:2389). 1b deferred exactly one thing to 1c — the screen — and this plan declines to build it.

   **The consequence, stated plainly: as drafted, this plan defeats 1b's ruling in practice.** `ManagerRegisterReader` becomes permanently unreachable code whose architecture pin now asserts a *permanent* absence rather than a one-phase deferral; the walk-up child in BR §1.3's own scenario still cannot be lent to in one visit; and BR §16.3's escape hatch ships doing the opposite of what its own justification requires.

   **Recommended resolution (a change from the drafted reading):** wire the hatch to `ManagerRegisterReader` — one `GET /manage/lend/reader/new` + `POST`, reusing `RegisterReaderOnBehalfRequest`'s field list and `ReaderController::create`'s parish context, redirecting straight to `lend.confirm?book=…&reader={new membership}`. That honours BR §16.3, 1b's ruling, the reference's *documented* design, and leaves `/manage/readers/create` (on-behalf → `pending`, BR §16.1's explicit sentence) exactly as it is for the queue path. If instead the product owner confirms the shipped-reference behaviour, then **1b's `active` ruling must be revisited in the same breath**, because its only stated justification no longer holds — that is the real question for the owner, and it is not "port or not", it is "which of two 1b/1c positions is wrong". Task 14's architecture pin and known-gaps entry must say which was chosen and why. Until settled, this is the plan's single largest open item; the drafted reading is recorded above so the owner sees both.
4. **A title with no copies reads "đang được mượn hoặc đang giữ chỗ".** Divergence 9's ported defect: `copy_not_available`'s sentence is false for a copyless title, there is no third code whose Vietnamese sentence anybody wrote, and the reference deliberately reproduced the aggregation so step 1 and step 3 say the same (wrong) sentence rather than two different ones. Fixing it means a new code + OPS failure-mode entry — a domain change for the owner to sanction, recorded in known-gaps (Task 14).
5. **`GetMyDashboard` ships half a page.** The loans half (with renew) is this plan's; the requests half is Phase 2's, rendered as an explicit empty state. The alternative — defer the whole page like 1a's `GetShelfHome` — would strand `RenewLoan` with no surface. Stated here so the half-page is a decision the owner has seen, not a surprise.
6. **`ReceiveReturn` without the queue offer narrows OPS §5 until Phase 2** (divergence 4). Nothing a manager can do in 1c is lost — there are no queued readers to hold for — but the OPS §5 walk-through will not match the shipped screen verbatim until Phase 2 restores the branch. Recorded in known-gaps with the exact reference behaviour Phase 2 ports.

---

## File Structure

```
app/Support/Circulation/
  LoanRules.php          copyLendable / memberMayBorrow / loanRenewable (pure, INV-3/4/5/6/7)
  LoanTerms.php          dueDateFor / renewedDueDate / isOverdue / daysRemaining (pure — overdue's ONE home)
  LendingSettings.php    BR §5.5's lending numbers off the shelf's settings blob (14/3/1/7)
  ChooseCopy.php         the quick-lend copy chooser (pure; divergence 9)
app/Actions/Circulation/
  LendCopy.php           quick-lend terminal step (INV-1..5, 7, 8)
  ReceiveReturn.php      close loan + ConditionAssessment, one transaction (INV-1, 2, 8, 11)
  RenewLoan.php          due_on + renewal_days from the CURRENT due date (INV-6, 8)
  VoidLoan.php           active → voided with reason, copy → available (INV-2, 8, 11)
app/Actions/Catalogue/ReportCopyLost.php   (modified: locking read on the loan close — divergence 2)
app/Policies/LoanPolicy.php
app/Queries/
  SearchBooksForLendingQuery.php     step 1 rows, blocked flag = the code LendCopy throws
  SearchReadersForLendingQuery.php   step 2 rows, block = LoanRules::memberMayBorrow's, never filtered out
  SearchLoansForReturnQuery.php      return step 1: active loans by title / reader / copy code
  OverdueLoansQuery.php              days late, borrower phone, three sorts
  MyDashboardQuery.php               reader's loans + renewBlockedBy + recently returned
  MyLoanHistoryQuery.php             reverse-chronological, paginated, with return condition
app/Queries/ReaderDetailQuery.php    (modified: due-date math repointed at LoanTerms)
app/Http/Requests/Circulation/
  LendCopyRequest.php      copy_id + membership_id
  ReceiveReturnRequest.php condition + note
  VoidLoanRequest.php      reason (required)
app/Http/Controllers/Manage/
  LendController.php       index / reader / confirm / store
  ReturnController.php     index / store / lost
  OverdueController.php    index
  LoanController.php       void
app/Http/Controllers/Reader/MyLoansController.php   overview / history / renew
app/Http/Middleware/HandleInertiaRequests.php       (modified: flash.success shared prop)
app/Models/Bookshelf.php                            (+ loans() relation for the {loan} binding)
resources/js/pages/manage/lend/index.tsx            step 1 — find the book
resources/js/pages/manage/lend/reader.tsx           step 2 — pick the reader (+ escape hatch)
resources/js/pages/manage/lend/confirm.tsx          step 3 — confirm, one button
resources/js/pages/manage/returns/index.tsx         find loan + condition picker + confirm
resources/js/pages/manage/returns/lost.tsx          "Bạn đọc báo làm mất" → ReportCopyLost
resources/js/pages/manage/overdue.tsx               sorted, tappable phone numbers
resources/js/pages/shelves/profile/overview.tsx     reader dashboard: loans + renew
resources/js/pages/shelves/profile/history.tsx      full history
resources/js/pages/manage/books/show.tsx            (modified: Cho mượn / Nhận trả / Huỷ lượt mượn entry points)
resources/js/lib/copy.ts                            (extended)
resources/js/lib/dates.ts                           formatDate — vi-VN date rendering, one place
lang/vi/rules.php                                   (extended — divergence 10's eight keys)
lang/vi/validation.php                              (attributes: condition, reason, copy_id, membership_id)
routes/web.php                                      (lend / returns / overdue / profile routes filled in)
database/seeders/DemoShelfSeeder.php                (extended: one active loan, one overdue loan)
tests/Unit/Circulation/…  tests/Feature/Circulation/…  tests/Feature/Architecture/…  docs/known-gaps.md
```

---
### Task 1: Circulation groundwork — the refusal sentences, `LoanRules`, `LendingSettings`, `LoanTerms`

Read first: `old_next/src/domain/circulation/policy.ts` and `old_next/src/domain/circulation/settings.ts` (whole files — the docblocks carry the arguments this task ports), and `old_next/tests/domain/circulation/policy.test.ts` — the unit tests below are its port. Also `old_next/tests/invariants/inv-04-suspended-cannot-borrow.test.ts` (first test) and `inv-05-loan-limit.test.ts` ("the boundary is at the limit").

**Files:**
- Modify: `lang/vi/rules.php` (append keys — never rewrite 1a's/1b's)
- Modify: `lang/vi/validation.php` (the `attributes` array only: `condition`, `note`, `reason`, `copy_id`, `membership_id`)
- Create: `app/Support/Circulation/LoanRules.php`
- Create: `app/Support/Circulation/LendingSettings.php`
- Create: `app/Support/Circulation/LoanTerms.php`
- Modify: `app/Queries/ReaderDetailQuery.php` (repoint the local due-date math — divergence 6)
- Test: `tests/Unit/Circulation/LoanRulesTest.php`
- Test: `tests/Unit/Circulation/LoanTermsTest.php`
- Test: `tests/Unit/Circulation/LendingSettingsTest.php`

**Interfaces:**
- Consumes: `App\Enums\CopyState`, `App\Enums\MembershipStatus` (Phase 0 backed enums), `App\Support\Clock` (`today(): string` — `Y-m-d` in `Asia/Ho_Chi_Minh`), `App\Models\Bookshelf` (`settings` is `AsArrayObject`).
- Produces (every later task builds on these exact signatures):
  - `LoanRules::copyLendable(CopyState $state, ?string $heldForUserId, string $forUserId): ?string` — `null` when lendable, else the refusal code (`copy_lost_or_retired` | `copy_not_available`). `$heldForUserId`/`$forUserId` are **users.id** values; the names are load-bearing (the reference's docblock: comparing a membership id here silently turns INV-3's held-for-me clause into "never lendable").
  - `LoanRules::memberMayBorrow(MembershipStatus $status, int $activeLoans, int $maxConcurrentLoans): ?string` — INV-4 then INV-5, in that order (`membership_not_active` | `loan_limit_reached`).
  - `LoanRules::loanRenewable(int $renewalsUsed, int $maxRenewals, bool $titleHasQueue): ?string` — INV-6's two refusals, renewals first (`no_renewals_remaining` | `title_has_queue`).
  - `LoanRules::CODES` — `list<string>` of every code the three predicates can return, for the census test.
  - `LendingSettings::fromShelf(Bookshelf $shelf): self` with `public readonly int $loanDays, $maxConcurrentLoans, $maxRenewals, $renewalDays` (defaults 14/3/1/7 per BR §5.5 — a shelf's blob stores only what it overrides).
  - `LoanTerms::dueDateFor(string $today, int $loanDays): string`, `LoanTerms::renewedDueDate(string $dueOn, int $renewalDays): string`, `LoanTerms::isOverdue(string $dueOn, string $today): bool`, `LoanTerms::daysRemaining(string $dueOn, string $today): int` (negative when overdue). All strings are `Y-m-d`.

- [ ] **Step 1: Append the refusal sentences**

In `lang/vi/rules.php`, append after the 1b block (sentences verbatim from OPS §4.2 / `old_next/src/domain/kernel/errors.ts:77-110` — divergence 10):

```php
    // ── Circulation (Phase 1c) ────────────────────────────────────────
    'copy_lost_or_retired' => 'Bản sách này đã mất hoặc ngừng dùng.',
    'membership_not_active' => 'Tài khoản đang tạm khoá, không thể mượn thêm.',
    'loan_limit_reached' => 'Bạn đọc đã mượn tối đa số sách cho phép.',
    'loan_not_active' => 'Lượt mượn này đã được xử lý.',
    'loan_not_active_cannot_void' => 'Chỉ có thể huỷ lượt mượn đang diễn ra.',
    'no_renewals_remaining' => 'Bạn đã dùng hết số lần gia hạn cho lượt mượn này.',
    'title_has_queue' => 'Có bạn khác đang chờ mượn cuốn này, không thể gia hạn.',
    'reason_required' => 'Vui lòng ghi lý do huỷ.',
```

`copy_not_available` already exists (1a) with exactly OPS's sentence — reuse, do not duplicate the key. In `lang/vi/validation.php`, extend `attributes` with **only the two keys that are genuinely absent**:

```php
    'copy_id' => 'bản sách',
    'membership_id' => 'bạn đọc',
```

**Verified against the shipped file (review): `attributes` ALREADY carries `'condition' => 'tình trạng'` (`lang/vi/validation.php:189`), `'note' => 'ghi chú'` (:190) and `'reason' => 'lý do'` (:191), all from 1a.** Re-adding them would put duplicate keys in one array literal — legal PHP, last-wins, silent — and the `condition` re-spelling drafted here ('tình trạng sách') would quietly change 1a's label on the assess-condition form. Do not add those three. This is the Global Constraints' "append keys — never rewrite 1a's/1b's" rule, and it bites here specifically.

- [ ] **Step 2: Write the failing unit tests**

Create `tests/Unit/Circulation/LoanRulesTest.php` — the port of `policy.test.ts`, plus the census:

```php
<?php

use App\Enums\CopyState;
use App\Enums\MembershipStatus;
use App\Support\Circulation\LoanRules;

it('INV-3: an available copy is lendable to anyone', function () {
    expect(LoanRules::copyLendable(CopyState::Available, null, 'user-a'))->toBeNull();
});

it('INV-3: a held copy is lendable only to its holder', function () {
    expect(LoanRules::copyLendable(CopyState::Held, 'user-a', 'user-a'))->toBeNull()
        ->and(LoanRules::copyLendable(CopyState::Held, 'user-a', 'user-b'))->toBe('copy_not_available');
});

it('INV-3: a held copy with an expired hold is nobody\'s to collect', function () {
    // Expiry presents as absence: the caller reads the holder through a
    // hold_expires_at > now filter (Phase 2), so a lapsed hold arrives as
    // null — and null must not match any reader, its own ex-holder included.
    expect(LoanRules::copyLendable(CopyState::Held, null, 'user-a'))->toBe('copy_not_available');
});

it('INV-3: a copy already on loan is not lendable, even to a hold-holder', function () {
    // The reference's measured guard: an on_loan copy with a live hold naming
    // this reader still refuses — the book is in another child's hands, and a
    // predicate rescued by INV-1's index after the fact is still wrong.
    expect(LoanRules::copyLendable(CopyState::OnLoan, null, 'user-a'))->toBe('copy_not_available')
        ->and(LoanRules::copyLendable(CopyState::OnLoan, 'user-a', 'user-a'))->toBe('copy_not_available');
});

it('INV-7: a lost or retired copy is never lendable', function () {
    expect(LoanRules::copyLendable(CopyState::Lost, null, 'user-a'))->toBe('copy_lost_or_retired')
        ->and(LoanRules::copyLendable(CopyState::Retired, null, 'user-a'))->toBe('copy_lost_or_retired');
});

it('INV-7 over INV-3: a lost copy someone holds still reads as lost', function () {
    expect(LoanRules::copyLendable(CopyState::Lost, 'user-a', 'user-a'))->toBe('copy_lost_or_retired');
});

it('INV-4: no status other than active may start a new loan', function () {
    foreach ([MembershipStatus::Pending, MembershipStatus::Suspended, MembershipStatus::Left, MembershipStatus::Rejected] as $status) {
        expect(LoanRules::memberMayBorrow($status, 0, 3))
            ->toBe('membership_not_active', "status {$status->value} should refuse");
    }
    expect(LoanRules::memberMayBorrow(MembershipStatus::Active, 0, 3))->toBeNull();
});

it('INV-4 before INV-5: a suspended reader at the limit hears about the suspension', function () {
    expect(LoanRules::memberMayBorrow(MembershipStatus::Suspended, 5, 3))->toBe('membership_not_active');
});

it('INV-5: the boundary is at the limit, not one past it', function () {
    expect(LoanRules::memberMayBorrow(MembershipStatus::Active, 2, 3))->toBeNull()
        ->and(LoanRules::memberMayBorrow(MembershipStatus::Active, 3, 3))->toBe('loan_limit_reached')
        ->and(LoanRules::memberMayBorrow(MembershipStatus::Active, 4, 3))->toBe('loan_limit_reached');
});

it('INV-5: the limit is the shelf\'s, not a constant', function () {
    expect(LoanRules::memberMayBorrow(MembershipStatus::Active, 3, 5))->toBeNull()
        ->and(LoanRules::memberMayBorrow(MembershipStatus::Active, 1, 1))->toBe('loan_limit_reached');
});

it('INV-6: renewals first, then the queue — the order decides which sentence a reader gets', function () {
    expect(LoanRules::loanRenewable(0, 1, false))->toBeNull()
        ->and(LoanRules::loanRenewable(1, 1, false))->toBe('no_renewals_remaining')
        ->and(LoanRules::loanRenewable(0, 1, true))->toBe('title_has_queue')
        // Both true: the renewals sentence wins — it is the one that stays
        // true tomorrow (the reference's stated ordering argument).
        ->and(LoanRules::loanRenewable(1, 1, true))->toBe('no_renewals_remaining');
});

it('every code the predicates can return has a Vietnamese sentence', function () {
    // The CopyStateMachineTest precedent: these codes are thrown as
    // `new RuleViolated($code)` with a VARIABLE, so the app/-wide literal
    // census (RuleViolatedCodesHaveSentencesTest) cannot see them. This is
    // their census. Delete `title_has_queue` from lang/vi/rules.php and
    // this test, alone, goes red.
    expect(LoanRules::CODES)->toEqualCanonicalizing([
        'copy_lost_or_retired', 'copy_not_available',
        'membership_not_active', 'loan_limit_reached',
        'no_renewals_remaining', 'title_has_queue',
    ]);

    $rules = require __DIR__.'/../../../lang/vi/rules.php';
    foreach (LoanRules::CODES as $code) {
        expect(array_key_exists($code, $rules))->toBeTrue("missing rules.{$code}")
            ->and($rules[$code])->toBeString()->not->toBe('');
    }
});
```

Create `tests/Unit/Circulation/LoanTermsTest.php`:

```php
<?php

use App\Support\Circulation\LoanTerms;

it('the due date is loan_days from today', function () {
    expect(LoanTerms::dueDateFor('2026-08-28', 14))->toBe('2026-09-11');
});

it('the due date crosses a month and a year boundary correctly', function () {
    expect(LoanTerms::dueDateFor('2026-08-25', 14))->toBe('2026-09-08')
        ->and(LoanTerms::dueDateFor('2026-12-27', 14))->toBe('2027-01-10')
        // 2028 is a leap year; Feb 29 exists.
        ->and(LoanTerms::dueDateFor('2028-02-20', 14))->toBe('2028-03-05');
});

it('INV-6: a renewal extends the CURRENT due date, never today', function () {
    // The signature admits no "today" at all — this test pins the arithmetic,
    // Task 5 pins the caller by renewing an already-overdue loan.
    expect(LoanTerms::renewedDueDate('2026-08-20', 7))->toBe('2026-08-27');
});

it('overdue is strictly after the due date — due today is not overdue', function () {
    // BR §5.4: a book is due at the END of a day.
    expect(LoanTerms::isOverdue('2026-08-28', '2026-08-28'))->toBeFalse()
        ->and(LoanTerms::isOverdue('2026-08-28', '2026-08-29'))->toBeTrue()
        ->and(LoanTerms::isOverdue('2026-08-28', '2026-08-27'))->toBeFalse();
});

it('days remaining counts down to zero on the due day and goes negative after', function () {
    expect(LoanTerms::daysRemaining('2026-08-30', '2026-08-28'))->toBe(2)
        ->and(LoanTerms::daysRemaining('2026-08-28', '2026-08-28'))->toBe(0)
        ->and(LoanTerms::daysRemaining('2026-08-28', '2026-08-31'))->toBe(-3);
});
```

Create `tests/Unit/Circulation/LendingSettingsTest.php`:

```php
<?php

use App\Models\Bookshelf;
use App\Support\Circulation\LendingSettings;

it('BR §5.5 defaults: 14 / 3 / 1 / 7 off an empty settings blob', function () {
    $shelf = new Bookshelf(['settings' => []]);
    $s = LendingSettings::fromShelf($shelf);

    expect($s->loanDays)->toBe(14)
        ->and($s->maxConcurrentLoans)->toBe(3)
        ->and($s->maxRenewals)->toBe(1)
        ->and($s->renewalDays)->toBe(7);
});

it('a shelf overrides only what it stores', function () {
    $shelf = new Bookshelf(['settings' => ['loan_days' => 21, 'max_renewals' => 2]]);
    $s = LendingSettings::fromShelf($shelf);

    expect($s->loanDays)->toBe(21)
        ->and($s->maxConcurrentLoans)->toBe(3)
        ->and($s->maxRenewals)->toBe(2)
        ->and($s->renewalDays)->toBe(7);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `make test FILTER=Circulation`
Expected: FAIL — `Class "App\Support\Circulation\LoanRules" not found` (and siblings).

- [ ] **Step 4: Implement the three support classes**

Create `app/Support/Circulation/LoanRules.php`:

```php
<?php

namespace App\Support\Circulation;

use App\Enums\CopyState;
use App\Enums\MembershipStatus;

/**
 * The circulation domain's pure rules — the port of
 * old_next/src/domain/circulation/policy.ts. No SQL, no clock, no I/O.
 *
 * BR §16.3: blocking conditions surface BEFORE the confirm step, never as an
 * error afterwards — so the same predicates answer the screen's "can I?" and
 * the command's "may I?". Two implementations would drift, and a volunteer
 * would be told yes and then no, which is worse than no: the book is already
 * in the child's hands.
 *
 * Returns ?string (null = allowed, else the RuleViolated code), the
 * MembershipTransitions::check idiom. Every returnable code is in CODES,
 * censused against lang/vi/rules.php by LoanRulesTest.
 */
final class LoanRules
{
    /** @var list<string> every code the predicates below can return */
    public const CODES = [
        'copy_lost_or_retired', 'copy_not_available',
        'membership_not_active', 'loan_limit_reached',
        'no_renewals_remaining', 'title_has_queue',
    ];

    /**
     * INV-3 and INV-7 as one predicate.
     *
     * $heldForUserId and $forUserId are users.id, NOT memberships.id, and
     * the names are load-bearing (the reference's own docblock): a caller
     * that passed a membership id would turn "a held copy is lendable to
     * its holder" into "a held copy is never lendable", with every test
     * here still green. In 1c no hold can exist ($heldForUserId is always
     * null — Phase 2 owns borrow requests), but the clause ports whole so
     * Phase 2 wires a caller, not a new rule.
     *
     * This is not a second CopyStateMachine: the transition table already
     * refuses lost|retired → on_loan; what it structurally cannot answer is
     * WHOSE hold a held copy is under.
     */
    public static function copyLendable(CopyState $state, ?string $heldForUserId, string $forUserId): ?string
    {
        if ($state === CopyState::Lost || $state === CopyState::Retired) {
            return 'copy_lost_or_retired';
        }
        if ($state === CopyState::Available) {
            return null;
        }
        if ($state === CopyState::Held && $heldForUserId === $forUserId && $heldForUserId !== null) {
            return null;
        }

        // on_loan, and held under somebody else's hold or no live hold at
        // all. A lapsed hold arrives as null (expiry presents as absence)
        // and must not match a reader.
        return 'copy_not_available';
    }

    /**
     * INV-4 then INV-5, in the order that decides which single sentence a
     * volunteer reads: a suspended reader who is also at the limit hears
     * about the suspension — something actionable — not the limit.
     *
     * INV-4 is deliberately narrow: a non-active membership blocks a NEW
     * loan and leaves existing ones alone (BR §6). The status list is one
     * comparison here because MembershipStatus is the single enum — there
     * is no second hand-maintained list to drift (the B2a defect the
     * reference documents).
     */
    public static function memberMayBorrow(MembershipStatus $status, int $activeLoans, int $maxConcurrentLoans): ?string
    {
        if ($status !== MembershipStatus::Active) {
            return 'membership_not_active';
        }
        if ($activeLoans >= $maxConcurrentLoans) {
            return 'loan_limit_reached';
        }

        return null;
    }

    /**
     * INV-6's two refusals. Renewals first, matching the command and the
     * reference: with both true, the reader reads the sentence about their
     * own turn — the one that stays true tomorrow.
     */
    public static function loanRenewable(int $renewalsUsed, int $maxRenewals, bool $titleHasQueue): ?string
    {
        if ($renewalsUsed >= $maxRenewals) {
            return 'no_renewals_remaining';
        }
        if ($titleHasQueue) {
            return 'title_has_queue';
        }

        return null;
    }
}
```

Create `app/Support/Circulation/LendingSettings.php`:

```php
<?php

namespace App\Support\Circulation;

use App\Models\Bookshelf;

/**
 * BR §5.5's lending numbers, read once per command off the shelf row the
 * tenant middleware already loaded — the port of circulation/settings.ts.
 * One module, not a private coalesce in each command: two copies of
 * "default to 3" is how one later stops matching the settings screen.
 *
 * The defaults are the values nearly every shelf uses: a shelf that has
 * never opened its settings screen stores {} and gets 14/3/1/7 from here,
 * not from a column. hold_days is deliberately absent until Phase 2 —
 * nothing in 1c reads it.
 */
final readonly class LendingSettings
{
    public function __construct(
        public int $loanDays,
        public int $maxConcurrentLoans,
        public int $maxRenewals,
        public int $renewalDays,
    ) {}

    public static function fromShelf(Bookshelf $shelf): self
    {
        $settings = (array) $shelf->settings;

        return new self(
            loanDays: (int) ($settings['loan_days'] ?? 14),
            maxConcurrentLoans: (int) ($settings['max_concurrent_loans'] ?? 3),
            maxRenewals: (int) ($settings['max_renewals'] ?? 1),
            renewalDays: (int) ($settings['renewal_days'] ?? 7),
        );
    }
}
```

Create `app/Support/Circulation/LoanTerms.php`:

```php
<?php

namespace App\Support\Circulation;

use Carbon\CarbonImmutable;

/**
 * Due-date arithmetic and the overdue/days-remaining derivations — the ONE
 * home BR §8 demands, replacing the loans_current view's is_overdue and
 * days_remaining columns (spec §4: views encode read shapes, not
 * invariants). Availability's one home is CountsCopies::borrowable();
 * overdue's is here. Every caller passes Clock::today() — the civil date
 * in Asia/Ho_Chi_Minh — so a book lent at 23:30 UTC is not a day short.
 *
 * All parameters and returns are Y-m-d strings. '!Y-m-d' zeroes the time
 * part, and UTC keeps the host's timezone out of date arithmetic entirely:
 * the timezone conversion already happened, in Clock::today(), and doing
 * it twice is how a date shifts by one (the reference's dueDateFor note).
 */
final class LoanTerms
{
    public static function dueDateFor(string $today, int $loanDays): string
    {
        return self::date($today)->addDays($loanDays)->toDateString();
    }

    /** INV-6: from the CURRENT due date. The signature admits no "today". */
    public static function renewedDueDate(string $dueOn, int $renewalDays): string
    {
        return self::date($dueOn)->addDays($renewalDays)->toDateString();
    }

    /** BR §8: active + due date before today. Due today is NOT overdue. */
    public static function isOverdue(string $dueOn, string $today): bool
    {
        return $dueOn < $today; // Y-m-d compares correctly as bytes
    }

    /** 0 on the due day, negative once overdue. */
    public static function daysRemaining(string $dueOn, string $today): int
    {
        return (int) self::date($today)->diffInDays(self::date($dueOn), false);
    }

    private static function date(string $ymd): CarbonImmutable
    {
        return CarbonImmutable::createFromFormat('!Y-m-d', $ymd, 'UTC') ?: throw new \InvalidArgumentException("not a date: {$ymd}");
    }
}
```

- [ ] **Step 5: Run the unit tests, verify they pass**

Run: `make test FILTER=Circulation`
Expected: PASS.

- [ ] **Step 6: Repoint `ReaderDetailQuery` at `LoanTerms`**

In `app/Queries/ReaderDetailQuery.php`, the `currentLoans` mapping derives locally (around lines 84–94):

```php
            $due = CarbonImmutable::parse((string) $loan->due_on);
            ...
                'isOverdue' => $due->lessThan($today),
                'daysRemaining' => (int) $today->diffInDays($due, false),
```

Replace the derivation with the shared home (keep every other key untouched):

```php
            $dueOn = $loan->due_on->toDateString();
            ...
                'isOverdue' => LoanTerms::isOverdue($dueOn, $today),
                'daysRemaining' => LoanTerms::daysRemaining($dueOn, $today),
```

where `$today = app(Clock::class)->today()` is already the string the query reads (adjust the local variable to stay a `Y-m-d` string; drop the now-unused CarbonImmutable import if nothing else uses it). This closes 1b's declared-temporary gap ("1c must move the due-date math to app/Support/Circulation/ and point this query at it").

- [ ] **Step 7: Run the members suite to prove the repoint changed nothing**

Run: `make test FILTER=ReaderDetail`
Expected: PASS — same behaviour, one home.

- [ ] **Step 8: Lint, analyse, commit**

Run: `make lint && make analyse`
Expected: clean, level 8.

```bash
git add lang/vi/rules.php lang/vi/validation.php app/Support/Circulation tests/Unit/Circulation app/Queries/ReaderDetailQuery.php
git commit -m "feat: circulation pure rules, lending settings and the one home for overdue"
```

---

### Task 2: `LoanPolicy`, the `{loan}` binding, and the `loans()` relation

**Files:**
- Create: `app/Policies/LoanPolicy.php`
- Modify: `app/Models/Bookshelf.php` (add `loans()` relation)
- Modify: `app/Providers/AppServiceProvider.php` (register the policy beside `MembershipPolicy`'s registration)
- Test: `tests/Feature/Circulation/LoanPolicyTest.php`

**Interfaces:**
- Consumes: the `act-as-manager` / `act-as-reader` gates (Phase 0, `AppServiceProvider` — membership read from `TenantContext`, super-admin waved through by `Gate::before`), `App\Models\Loan`.
- Produces:
  - `LoanPolicy::lend(User $user, Loan $loan): bool`, `receiveReturn(...)`, `void(...)` — all `Gate::allows('act-as-manager')`.
  - `LoanPolicy::renew(User $user, Loan $loan): bool` — `Gate::allows('act-as-reader')` only; **ownership is NOT checked here** — the Action folds not-own into `loan_not_active` (divergence 10's anti-enumeration argument), and a policy that also checked it would 403 where the command's 404-shaped refusal is required.
  - `Bookshelf::loans(): HasMany` — what `scopeBindings()` resolves the `{loan}` route parameter through; `BookshelfScope` independently 404s a foreign loan id (the two-layer note in `routes/web.php`).

- [ ] **Step 1: Write the failing test**

Create `tests/Feature/Circulation/LoanPolicyTest.php`:

```php
<?php

use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Illuminate\Support\Facades\Gate;

/**
 * @return array{Bookshelf, User, User, Loan} shelf, manager, reader, the reader's active loan
 */
function lpFix(string $actorRole = 'manager'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['settings' => []]);
    $actor = User::factory()->create();
    $actorMembership = Membership::factory()->for($shelf)->create([
        'user_id' => $actor->id, 'role' => $actorRole, 'status' => 'active',
    ]);
    $reader = User::factory()->create();
    Membership::factory()->for($shelf)->create([
        'user_id' => $reader->id, 'role' => 'reader', 'status' => 'active',
    ]);
    $book = Book::query()->create([
        'bookshelf_id' => $shelf->id, 'title' => 'Hoàng Tử Bé', 'slug' => 'hoang-tu-be',
    ]);
    $copy = BookCopy::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0001', 'state' => 'on_loan',
    ]);
    $loan = Loan::query()->create([
        'bookshelf_id' => $shelf->id, 'copy_id' => $copy->id, 'book_id' => $book->id,
        'borrower_id' => $reader->id, 'lent_by' => $actor->id,
        'due_on' => '2026-09-11', 'status' => 'active',
    ]);
    app(TenantContext::class)->set($shelf, $actorMembership);

    return [$shelf, $actor, $reader, $loan];
}

it('a manager may lend, receive and void; a reader may not', function () {
    [, $manager, , $loan] = lpFix('manager');
    expect(Gate::forUser($manager)->allows('lend', $loan))->toBeTrue()
        ->and(Gate::forUser($manager)->allows('receiveReturn', $loan))->toBeTrue()
        ->and(Gate::forUser($manager)->allows('void', $loan))->toBeTrue();
});

it('a reader is refused the manager abilities', function () {
    [, $reader, , $loan] = lpFix('reader');
    expect(Gate::forUser($reader)->allows('lend', $loan))->toBeFalse()
        ->and(Gate::forUser($reader)->allows('receiveReturn', $loan))->toBeFalse()
        ->and(Gate::forUser($reader)->allows('void', $loan))->toBeFalse();
});

it('renew asks only for a reader membership — ownership is the Action\'s question', function () {
    // The policy answering "is this MY loan" would 403 a guessed loan id
    // where the command's loan_not_active (rendered as a refusal sentence,
    // not an existence oracle) is the specified shape — OPS §4.2 lists no
    // loan_not_found and the reference folds all three cases into one code.
    [, $actor, , $loan] = lpFix('reader');
    expect(Gate::forUser($actor)->allows('renew', $loan))->toBeTrue();
});

it('Bookshelf::loans() is shelf-local — the relation the {loan} binding resolves through', function () {
    // Review fix: the draft called this "…and 404s a foreign loan" while
    // making no HTTP request at all. The 404 itself is asserted over HTTP
    // in QuickLendScreensTest / ReturnScreensTest / VoidLoanScreenTest,
    // where scopeBindings() is actually in play. This block pins only the
    // relation those bindings need to exist.
    [$shelfA] = lpFix();
    expect($shelfA->loans()->count())->toBe(1);

    // Second shelf, colliding data — the actSystemWide() template.
    app(TenantContext::class)->actSystemWide();
    $shelfB = Bookshelf::factory()->create(['settings' => []]);
    expect($shelfB->loans()->count())->toBe(0);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `make test FILTER=LoanPolicyTest`
Expected: FAIL — abilities not defined / `loans()` undefined.

- [ ] **Step 3: Implement**

Create `app/Policies/LoanPolicy.php`:

```php
<?php

namespace App\Policies;

use App\Models\Loan;
use App\Models\User;
use Illuminate\Support\Facades\Gate;

/**
 * BR §13.2's circulation abilities, delegating to the act-as gates the way
 * BookPolicy and MembershipPolicy do. renew() deliberately checks role
 * only: ownership folds into RenewLoan's loan_not_active (OPS §4.2 lists
 * no loan_not_found; a policy-level 403 would confirm the loan exists).
 */
final class LoanPolicy
{
    public function lend(User $user, Loan $loan): bool
    {
        return Gate::forUser($user)->allows('act-as-manager');
    }

    public function receiveReturn(User $user, Loan $loan): bool
    {
        return Gate::forUser($user)->allows('act-as-manager');
    }

    public function void(User $user, Loan $loan): bool
    {
        return Gate::forUser($user)->allows('act-as-manager');
    }

    public function renew(User $user, Loan $loan): bool
    {
        return Gate::forUser($user)->allows('act-as-reader');
    }
}
```

In `app/Models/Bookshelf.php`, beside `bookCopies()`:

```php
    /** @return HasMany<Loan, $this> */
    public function loans(): HasMany
    {
        return $this->hasMany(Loan::class);
    }
```

In `app/Providers/AppServiceProvider.php`, register beside the existing policy registrations (match the file's established mechanism — `Gate::policy(Loan::class, LoanPolicy::class)`).

- [ ] **Step 4: Run the test, verify it passes**

Run: `make test FILTER=LoanPolicyTest`
Expected: PASS.

- [ ] **Step 5: Lint, analyse, commit**

```bash
make lint && make analyse
git add app/Policies/LoanPolicy.php app/Models/Bookshelf.php app/Providers/AppServiceProvider.php tests/Feature/Circulation/LoanPolicyTest.php
git commit -m "feat: loan policy and the {loan} binding through the shelf"
```

---
### Task 3: `LendCopy` — the most important command in the application

Read first: `old_next/src/domain/circulation/commands/lend-copy.ts` (the whole file — its docblock is the specification of the check order and the audit shape), `old_next/tests/domain/circulation/lend-copy.test.ts`, `old_next/tests/invariants/inv-01-one-active-loan-per-copy.test.ts`, `inv-03-only-available-or-own-hold.test.ts`, `inv-04-suspended-cannot-borrow.test.ts` (last test), `inv-05-loan-limit.test.ts` (the four lendCopy tests), `inv-07-lost-or-retired-not-lendable.test.ts` (last test). Also OPS §5 ("`LendCopy` end to end") and OPS §6.

**Files:**
- Create: `app/Actions/Circulation/LendCopy.php`
- Test: `tests/Feature/Circulation/LendCopyTest.php`

**Interfaces:**
- Consumes: `LoanRules` / `LendingSettings` / `LoanTerms` (Task 1, exact signatures there), `LoanPolicy::lend` (Task 2), `AuditRecorder::record(string $action, string $entityType, ?string $entityId, ?array $before, ?array $after)`, `Clock`, `TenantContext::bookshelf()`, `UniqueViolation::translate(QueryException $e, array $map): never`.
- Produces: `LendCopy::execute(User $actor, BookCopy $copy, Membership $membership): array{loanId: string, dueOn: string}` — throws `RuleViolated` with `copy_lost_or_retired` | `copy_not_available` | `membership_not_active` | `loan_limit_reached`; audit action `loan.created`. Task 10's controller and Task 12's book-detail entry point both call exactly this.

**What serialises each check (divergence 1 and 3, stated per check):**

| Check | Serialised by | Structural backstop |
|---|---|---|
| copy is available (INV-3/7) | the copy-row `FOR UPDATE`, transaction's **first** statement | `loans_one_active_per_copy` (errno 1062 → `copy_not_available`) — the only index-backed guarantee |
| membership active (INV-4) | the membership-row `FOR UPDATE`, second statement | none — a suspension committing after our lock waits on it (1b's lifecycle commands lock the same row) |
| loan count < max (INV-5) | the membership-row lock: every `LendCopy` for this reader locks it, so no rival lend is in flight while we count | none — the lock IS the guarantee; the reference had neither |

- [ ] **Step 1: Write the failing tests**

Create `tests/Feature/Circulation/LendCopyTest.php`:

```php
<?php

use App\Actions\Circulation\LendCopy;
use App\Enums\CopyState;
use App\Enums\LoanStatus;
use App\Enums\MembershipStatus;
use App\Exceptions\RuleViolated;
use App\Models\AuditLog;
use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Carbon\Carbon;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;

afterEach(fn () => Carbon::setTestNow());

/**
 * Shelf + manager (acting) + reader membership + one book with one available
 * copy. Names pinned OUTSIDE UserFactory's pool (known-gaps: the pool holds
 * 'Trần Minh' verbatim). Distinct slug per call so multi-command tests get
 * independent worlds.
 *
 * @return array{Bookshelf, User, Membership, BookCopy}
 */
function lendFix(array $shelfSettings = [], string $memberStatus = 'active', string $copyState = 'available', string $slug = 'dong-thap-lend'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => $shelfSettings]);
    $manager = User::factory()->create(['full_name' => 'Maria Quản Lý Kho']);
    $managerMembership = Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);
    $readerUser = User::factory()->create(['full_name' => 'Têrêsa Bạn Đọc Nhỏ']);
    $membership = Membership::factory()->for($shelf)->create([
        'user_id' => $readerUser->id, 'role' => 'reader', 'status' => $memberStatus,
    ]);
    $book = Book::query()->create([
        'bookshelf_id' => $shelf->id, 'title' => 'Dế Mèn Phiêu Lưu Ký', 'slug' => 'de-men',
    ]);
    $copy = BookCopy::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0001', 'state' => $copyState,
    ]);
    app(TenantContext::class)->set($shelf, $managerMembership);
    test()->actingAs($manager);

    return [$shelf, $manager, $membership, $copy];
}

it('lends: loan row active, copy on_loan, due in loan_days from the local today', function () {
    // 23:30 UTC on the 27th is already the morning of the 28th in
    // Asia/Ho_Chi_Minh — BR §5.4's whole point. due_on must count from the
    // 28th; counting from the UTC date makes every evening's loans a day
    // short (the reference's dueDateFor note, lend-copy.test.ts
    // "lent_at and due_on both come from ctx.clock").
    Carbon::setTestNow(Carbon::parse('2026-08-27 23:30:00', 'UTC'));
    [, $manager, $membership, $copy] = lendFix();

    $result = app(LendCopy::class)->execute($manager, $copy, $membership);

    expect($result['dueOn'])->toBe('2026-09-11'); // 2026-08-28 + 14

    $loan = Loan::query()->findOrFail($result['loanId']);
    expect($loan->status)->toBe(LoanStatus::Active)
        ->and($loan->borrower_id)->toBe($membership->user_id)   // users.id, NEVER membership id
        ->and($loan->lent_by)->toBe($manager->id)
        ->and($loan->copy_id)->toBe($copy->id)
        ->and($loan->book_id)->toBe($copy->book_id)
        ->and($loan->due_on->toDateString())->toBe('2026-09-11')
        ->and($loan->renewals_used)->toBe(0)
        ->and($copy->fresh()->state)->toBe(CopyState::OnLoan);
});

it('loan_days is the shelf\'s own setting, defaulting to 14', function () {
    Carbon::setTestNow(Carbon::parse('2026-08-28 03:00:00', 'UTC'));
    [, $manager, $membership, $copy] = lendFix(['loan_days' => 21]);

    $result = app(LendCopy::class)->execute($manager, $copy, $membership);

    expect($result['dueOn'])->toBe('2026-09-18'); // 2026-08-28 + 21
});

it('INV-7: a lost and a retired copy are refused with INV-7\'s reason, before the reader is even considered', function () {
    [, $manager, $membership, $copy] = lendFix(copyState: 'lost');
    expect(fn () => app(LendCopy::class)->execute($manager, $copy, $membership))
        ->toThrow(RuleViolated::class, 'copy_lost_or_retired');
});

it('INV-3: a copy already on loan is refused', function () {
    [, $manager, $membership, $copy] = lendFix(copyState: 'on_loan');
    expect(fn () => app(LendCopy::class)->execute($manager, $copy, $membership))
        ->toThrow(RuleViolated::class, 'copy_not_available');
});

it('OPS §5 order: the copy-side refusal beats the reader-side one', function () {
    // Lost copy AND suspended reader: the manager searched for a book that
    // is gone and needs to hear that first, not after picking a reader.
    [, $manager, $membership, $copy] = lendFix(memberStatus: 'suspended', copyState: 'lost');
    expect(fn () => app(LendCopy::class)->execute($manager, $copy, $membership))
        ->toThrow(RuleViolated::class, 'copy_lost_or_retired');
});

it('INV-4: a suspended member is refused before anything is written', function () {
    [, $manager, $membership, $copy] = lendFix(memberStatus: 'suspended');

    expect(fn () => app(LendCopy::class)->execute($manager, $copy, $membership))
        ->toThrow(RuleViolated::class, 'membership_not_active');
    expect(Loan::query()->count())->toBe(0)
        ->and($copy->fresh()->state)->toBe(CopyState::Available);
});

it('INV-5: the fourth book on a default shelf is refused; a returned loan stops counting', function () {
    [$shelf, $manager, $membership, $copy] = lendFix();

    // Three OTHER copies already out to this reader, plus one returned —
    // seeded directly. The returned fixture MUST carry return_condition:
    // loans_returned_has_condition rejects it otherwise (known-gaps, twice).
    app(TenantContext::class)->actSystemWide();
    $book2 = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Hoàng Tử Bé', 'slug' => 'hoang-tu-be']);
    foreach ([2, 3, 4] as $i) {
        $c = BookCopy::query()->create([
            'bookshelf_id' => $shelf->id, 'book_id' => $book2->id, 'code' => sprintf('DT-%04d', $i), 'state' => 'on_loan',
        ]);
        Loan::query()->create([
            'bookshelf_id' => $shelf->id, 'copy_id' => $c->id, 'book_id' => $book2->id,
            'borrower_id' => $membership->user_id, 'lent_by' => $manager->id,
            'due_on' => '2026-09-11', 'status' => 'active',
        ]);
    }
    $returnedCopy = BookCopy::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $book2->id, 'code' => 'DT-0005', 'state' => 'available',
    ]);
    Loan::query()->create([
        'bookshelf_id' => $shelf->id, 'copy_id' => $returnedCopy->id, 'book_id' => $book2->id,
        'borrower_id' => $membership->user_id, 'lent_by' => $manager->id,
        'due_on' => '2026-08-01', 'status' => 'returned',
        'returned_at' => now(), 'received_by' => $manager->id, 'return_condition' => 'perfect',
    ]);
    app(TenantContext::class)->set($shelf, Membership::query()->where('user_id', $manager->id)->firstOrFail());

    expect(fn () => app(LendCopy::class)->execute($manager, $copy, $membership))
        ->toThrow(RuleViolated::class, 'loan_limit_reached');
});

it('INV-5: the limit counts per shelf — three books elsewhere do not block here', function () {
    [$shelf, $manager, $membership, $copy] = lendFix();

    // The same PERSON holds three active loans on ANOTHER shelf. The count
    // must be BookshelfScope's, not a cross-shelf borrower_id scan.
    app(TenantContext::class)->actSystemWide();
    $other = Bookshelf::factory()->create(['slug' => 'can-tho-lend', 'settings' => []]);
    $otherBook = Book::query()->create(['bookshelf_id' => $other->id, 'title' => 'Đất Rừng Phương Nam', 'slug' => 'dat-rung']);
    foreach ([1, 2, 3] as $i) {
        $c = BookCopy::query()->create([
            'bookshelf_id' => $other->id, 'book_id' => $otherBook->id, 'code' => sprintf('CT-%04d', $i), 'state' => 'on_loan',
        ]);
        Loan::query()->create([
            'bookshelf_id' => $other->id, 'copy_id' => $c->id, 'book_id' => $otherBook->id,
            'borrower_id' => $membership->user_id, 'lent_by' => $manager->id,
            'due_on' => '2026-09-11', 'status' => 'active',
        ]);
    }
    app(TenantContext::class)->set($shelf, Membership::query()->where('user_id', $manager->id)->firstOrFail());

    $result = app(LendCopy::class)->execute($manager, $copy, $membership);
    expect(Loan::query()->find($result['loanId']))->not->toBeNull();
});

it('INV-1: the index, not the predicate, refuses the loser — 1062 becomes copy_not_available', function () {
    // The two-connection race cannot run under RefreshDatabase (1a
    // divergence 2), so this constructs the exact state the loser's
    // transaction would meet: copy still reads available, but an active
    // loan row already committed. The predicate passes; the INSERT hits
    // loans_one_active_per_copy; the 1062 must surface as the SAME code a
    // stale copy read produces — BR §2's "fail cleanly, plain message".
    [$shelf, $manager, $membership, $copy] = lendFix();
    app(TenantContext::class)->actSystemWide();
    $rival = User::factory()->create(['full_name' => 'Anna Người Thắng Cuộc']);
    Loan::query()->create([
        'bookshelf_id' => $shelf->id, 'copy_id' => $copy->id, 'book_id' => $copy->book_id,
        'borrower_id' => $rival->id, 'lent_by' => $manager->id,
        'due_on' => '2026-09-11', 'status' => 'active',
    ]);
    app(TenantContext::class)->set($shelf, Membership::query()->where('user_id', $manager->id)->firstOrFail());

    expect(fn () => app(LendCopy::class)->execute($manager, $copy, $membership))
        ->toThrow(RuleViolated::class, 'copy_not_available');
    // The loser wrote NOTHING: no second loan, copy untouched.
    expect(Loan::query()->where('copy_id', $copy->id)->count())->toBe(1)
        ->and($copy->fresh()->state)->toBe(CopyState::Available);
});

it('INV-8: the lend writes one audit record naming both ids and storing the title', function () {
    Carbon::setTestNow(Carbon::parse('2026-08-28 03:00:00', 'UTC'));
    [, $manager, $membership, $copy] = lendFix();

    $result = app(LendCopy::class)->execute($manager, $copy, $membership);

    $entry = AuditLog::query()->where('action', 'loan.created')->firstOrFail();
    $after = (array) $entry->after;
    expect($entry->entity_id)->toBe($result['loanId'])
        ->and($entry->actor_id)->toBe($manager->id)
        ->and($after['borrower_id'])->toBe($membership->user_id)   // what the row holds
        ->and($after['membership_id'])->toBe($membership->id)      // what the screen picked
        ->and($after['title'])->toBe('Dế Mèn Phiêu Lưu Ký')        // stored, never re-read
        ->and($after['due_on'])->toBe('2026-09-11')
        ->and($after['request_id'])->toBeNull();                   // a walk-up lend, visibly
});

```

**REVIEW FIX — do not write `assertLocksCopyFirst`.** The draft of this task
defined it here and then never called it: the lock test below inlines the
same logic, and the Global Constraints registered a process-global helper
name for a function with no callers. Write the inline version only, and
strike `assertLocksCopyFirst` from the Global Constraints' helper registry
(the name stays free for a later task that genuinely shares it across
files).

```php
it('the copy lock is the transaction\'s first statement, the membership lock its second', function () {
    [, $manager, $membership, $copy] = lendFix(slug: 'dong-thap-lend-lock');

    DB::flushQueryLog();
    DB::enableQueryLog();
    app(LendCopy::class)->execute($manager, $copy, $membership);
    $log = DB::getQueryLog();
    DB::disableQueryLog();

    expect(str_contains($log[0]['query'], 'book_copies'))->toBeTrue($log[0]['query'])
        ->and(str_contains(strtolower($log[0]['query']), 'for update'))->toBeTrue($log[0]['query'])
        ->and(str_contains($log[1]['query'], 'memberships'))->toBeTrue($log[1]['query'])
        ->and(str_contains(strtolower($log[1]['query']), 'for update'))->toBeTrue($log[1]['query']);
});

it('the availability check reads the LOCKED row, not the stale route-bound model', function () {
    // 1a's copy-state actions validated the route-bound snapshot and would
    // have retired a copy on loan. Here: the in-memory $copy still says
    // available while the database row says on_loan. The command must
    // refuse — proof it re-reads under the lock.
    [$shelf, $manager, $membership, $copy] = lendFix(slug: 'dong-thap-lend-stale');
    BookCopy::query()->whereKey($copy->id)->update(['state' => 'on_loan']);
    expect($copy->state)->toBe(CopyState::Available); // the stale snapshot

    expect(fn () => app(LendCopy::class)->execute($manager, $copy, $membership))
        ->toThrow(RuleViolated::class, 'copy_not_available');
});

it('a reader may not lend', function () {
    [$shelf, , $membership, $copy] = lendFix(slug: 'dong-thap-lend-reader');
    $readerUser = $membership->user; // acting as the reader themselves
    test()->actingAs($readerUser);
    app(TenantContext::class)->set($shelf->fresh(), $membership);

    expect(fn () => app(LendCopy::class)->execute($readerUser, $copy, $membership))
        ->toThrow(AuthorizationException::class);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `make test FILTER=LendCopyTest`
Expected: FAIL — `Class "App\Actions\Circulation\LendCopy" not found`.

- [ ] **Step 3: Implement `LendCopy`**

Create `app/Actions/Circulation/LendCopy.php`:

```php
<?php

namespace App\Actions\Circulation;

use App\Enums\CopyState;
use App\Enums\LoanStatus;
use App\Exceptions\RuleViolated;
use App\Models\BookCopy;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\Circulation\LendingSettings;
use App\Support\Circulation\LoanRules;
use App\Support\Circulation\LoanTerms;
use App\Support\Clock;
use App\Support\TenantContext;
use App\Support\UniqueViolation;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * Hands a copy to a reader — the quick-lend terminal step (BR §16.3, OPS
 * §5) and the most important command in the application. Port of
 * lend-copy.ts; read that file's docblock before changing the order here.
 *
 * The two-part shape is deliberate and neither part is redundant:
 *
 *   1. Locked re-reads + pure predicates, for the COMMON case — the kind,
 *      named sentence BR §16.3 requires ("Bạn đọc đã mượn tối đa…").
 *   2. The INSERT, judged by loans_one_active_per_copy, for the case BR §2
 *      describes: two managers, two phones, the same second. Only the
 *      index closes that window (INV-1); the losing 1062 is translated,
 *      never prevented.
 *
 * Lock order (plan divergence 1): copy FIRST — the transaction's first
 * statement, before anything reads — then membership. Under REPEATABLE
 * READ the read view pins at the first consistent read, so the plain
 * loan-count below is taken only after both locks: any rival lend for the
 * same copy waits on the copy lock, any rival lend for the same READER
 * waits on the membership lock — which is what makes the INV-5 count
 * accurate while we hold it (divergence 3; the reference had no such
 * serialisation and its count could race past the limit).
 *
 * borrower_id / lent_by are users(id), never membership ids — the input is
 * a Membership because that is what the screen has (OPS §4.2), and
 * $membership->user_id is resolved exactly once, below.
 *
 * The held-for-me clause (INV-3's second half) is live in LoanRules but
 * unreachable here until Phase 2: no hold can exist, so $heldForUserId is
 * passed as null. Phase 2's request commands wire the real holder through
 * the same predicate — and re-add the reference's collected-hold close
 * (request.fulfilled in this same transaction).
 *
 * @return array{loanId: string, dueOn: string}
 */
final class LendCopy
{
    public function __construct(
        private Clock $clock,
        private AuditRecorder $audit,
        private TenantContext $tenant,
    ) {}

    /** @return array{loanId: string, dueOn: string} */
    public function execute(User $actor, BookCopy $copy, Membership $membership): array
    {
        Gate::forUser($actor)->authorize('lend', $copy->loans()->make());

        return DB::transaction(function () use ($actor, $copy, $membership): array {
            // FIRST statement — see the class docblock.
            $copy = BookCopy::query()->lockForUpdate()->findOrFail($copy->id);
            // SECOND — serialises this reader's lends for the INV-5 count.
            $membership = Membership::query()->lockForUpdate()->findOrFail($membership->id);

            // OPS §5's order: copy-side refusals first — "a manager who
            // searched for a book that's already gone needs to know that
            // immediately, not after they've also picked a reader."
            if (($code = LoanRules::copyLendable($copy->state, null, $membership->user_id)) !== null) {
                throw new RuleViolated($code);
            }

            $shelf = $this->tenant->bookshelf();
            if ($shelf === null) {
                throw new RuleViolated('shelf_not_found');
            }
            $settings = LendingSettings::fromShelf($shelf);

            // Counted at write time, after both locks — never a value read
            // earlier in the flow (OPS §5 step 5). BookshelfScope makes
            // this the PER-SHELF count BR §5.5 specifies.
            $activeLoans = Loan::query()
                ->where('borrower_id', $membership->user_id)
                ->where('status', LoanStatus::Active)
                ->count();

            if (($code = LoanRules::memberMayBorrow($membership->status, $activeLoans, $settings->maxConcurrentLoans)) !== null) {
                throw new RuleViolated($code);
            }

            $dueOn = LoanTerms::dueDateFor($this->clock->today(), $settings->loanDays);

            try {
                $loan = Loan::query()->create([
                    'copy_id' => $copy->id,
                    'book_id' => $copy->book_id,
                    'borrower_id' => $membership->user_id,
                    'lent_by' => $actor->id,
                    'lent_at' => $this->clock->now(),
                    'due_on' => $dueOn,
                    'status' => LoanStatus::Active,
                ]);
            } catch (QueryException $e) {
                // INV-1's loser. Matched by constraint name so an unrelated
                // 1062 is never dressed up as the wrong refusal; anything
                // else rethrows untouched.
                UniqueViolation::translate($e, ['loans_one_active_per_copy' => 'copy_not_available']);
            }

            $copy->update(['state' => CopyState::OnLoan]);

            $this->audit->record('loan.created', 'loan', $loan->id,
                ['copy_state' => 'available'],
                [
                    'copy_state' => 'on_loan',
                    // Both ids — they answer different questions six months
                    // later: borrower_id is what the row holds and every
                    // join keys on; membership_id is what the manager
                    // picked and the only shelf-specific one of the two.
                    'borrower_id' => $membership->user_id,
                    'membership_id' => $membership->id,
                    'due_on' => $dueOn,
                    // The title AS IT IS NOW, stored: an audit sentence
                    // that re-read books.title would restate history the
                    // moment UpdateBook corrects a title.
                    'title' => $copy->book?->title,
                    // Null = a walk-up lend, visibly. Phase 2's collected
                    // hold writes the request id here.
                    'request_id' => null,
                ]);

            return ['loanId' => $loan->id, 'dueOn' => $dueOn];
        });
    }
}
```

Note on the Gate line: `authorize('lend', $copy->loans()->make())` hands the policy an unsaved `Loan` carrying the copy's shelf — the policy only consults the act-as gate, but the ability is registered on `Loan`. If Larastan objects to the unsaved-model shape, register `lend` as a plain gate check instead: `Gate::forUser($actor)->authorize('lend', new Loan())` is equivalent for a policy that reads no attributes — pick whichever the analyser accepts and keep the policy method signature from Task 2.

- [ ] **Step 4: Run the tests, verify they pass**

Run: `make test FILTER=LendCopyTest`
Expected: PASS — including the two lock-position pins and the 1062 translation.

- [ ] **Step 5: Prove the lock pins are falsifiable (mutation check, not committed)**

Temporarily swap the two `lockForUpdate()` lines' order, run `make test FILTER=LendCopyTest`, and confirm the lock-order test FAILS; restore. Temporarily drop `->lockForUpdate()` from the copy re-read and confirm the stale-model test still passes but the lock-position test FAILS; restore. (This is the 1b Task 9 discipline: a pin that cannot fail guards nothing.)

- [ ] **Step 6: Lint, analyse, commit**

```bash
make lint && make analyse
git add app/Actions/Circulation/LendCopy.php tests/Feature/Circulation/LendCopyTest.php
git commit -m "feat: lendcopy — three taps, two locks, one index deciding the race"
```

---

### Task 4: `ReceiveReturn` — close the loan, record the condition, one transaction

Read first: `old_next/src/domain/circulation/commands/receive-return.ts` and `old_next/tests/domain/circulation/receive-return.test.ts` (tests 1–8 and the last three — the hold-branch tests in the middle are Phase 2's), plus OPS §5 ("`ReceiveReturn`, and the decision that is never automatic") — including the T27 paragraph: **a worse condition never diverts the copy away from `available`**.

**Files:**
- Create: `app/Actions/Circulation/ReceiveReturn.php`
- Modify: `app/Actions/Catalogue/ReportCopyLost.php` (divergence 2: the loan close becomes a locking read)
- Test: `tests/Feature/Circulation/ReceiveReturnTest.php`

**Interfaces:**
- Consumes: Task 1's support classes, `LoanPolicy::receiveReturn`, `AuditRecorder`, `Clock`, `App\Enums\CopyCondition`.
- Produces: `ReceiveReturn::execute(User $actor, Loan $loan, CopyCondition $condition, ?string $note = null, ?string $photoUrl = null): void` — throws `RuleViolated('loan_not_active')`; audit action `loan.returned`. **No `holdForRequestId`, no queue answer — divergence 4**; Phase 2 re-widens this signature.

- [ ] **Step 1: Write the failing tests**

Create `tests/Feature/Circulation/ReceiveReturnTest.php`:

```php
<?php

use App\Actions\Catalogue\ReportCopyLost;
use App\Actions\Circulation\LendCopy;
use App\Actions\Circulation\ReceiveReturn;
use App\Enums\CopyCondition;
use App\Enums\CopyState;
use App\Enums\LoanStatus;
use App\Exceptions\RuleViolated;
use App\Models\AuditLog;
use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\ConditionAssessment;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Carbon\Carbon;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;

afterEach(fn () => Carbon::setTestNow());

/**
 * Shelf + manager + an ACTIVE loan of one copy to one reader.
 *
 * @return array{Bookshelf, User, Loan, BookCopy}
 */
function retFix(string $slug = 'dong-thap-ret'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);
    $manager = User::factory()->create(['full_name' => 'Maria Nhận Trả Sách']);
    $managerMembership = Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);
    $reader = User::factory()->create(['full_name' => 'Giuse Người Mượn Sách']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $reader->id, 'role' => 'reader', 'status' => 'active',
    ]);
    $book = Book::query()->create([
        'bookshelf_id' => $shelf->id, 'title' => 'Hoàng Tử Bé', 'slug' => 'hoang-tu-be',
    ]);
    $copy = BookCopy::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0002', 'state' => 'on_loan',
    ]);
    $loan = Loan::query()->create([
        'bookshelf_id' => $shelf->id, 'copy_id' => $copy->id, 'book_id' => $book->id,
        'borrower_id' => $reader->id, 'lent_by' => $manager->id,
        'due_on' => '2026-09-11', 'status' => 'active',
    ]);
    app(TenantContext::class)->set($shelf, $managerMembership);
    test()->actingAs($manager);

    return [$shelf, $manager, $loan, $copy];
}

it('a returned copy becomes available again, and the loan carries who, when, in what condition', function () {
    Carbon::setTestNow(Carbon::parse('2026-08-28 07:00:00', 'UTC'));
    [, $manager, $loan, $copy] = retFix();

    app(ReceiveReturn::class)->execute($manager, $loan, CopyCondition::Perfect);

    $fresh = $loan->fresh();
    expect($fresh->status)->toBe(LoanStatus::Returned)
        ->and($fresh->received_by)->toBe($manager->id)
        ->and($fresh->return_condition)->toBe(CopyCondition::Perfect)
        ->and($fresh->returned_at->toDateTimeString())->toBe('2026-08-28 07:00:00')
        ->and($copy->fresh()->state)->toBe(CopyState::Available);
});

it('the return records a ConditionAssessment tied to the loan, in the same transaction', function () {
    [, $manager, $loan, $copy] = retFix();

    app(ReceiveReturn::class)->execute($manager, $loan, CopyCondition::Torn, 'rách gáy');

    $assessment = ConditionAssessment::query()->where('loan_id', $loan->id)->firstOrFail();
    expect($assessment->copy_id)->toBe($copy->id)
        ->and($assessment->assessed_by)->toBe($manager->id)
        ->and($assessment->condition)->toBe(CopyCondition::Torn)
        ->and($assessment->note)->toBe('rách gáy');
});

it('T27: a worse condition NEVER diverts the copy away from available', function () {
    // BR §7.1 draws exactly one arrow out of on_loan on a return. A Rách
    // copy is exactly as lendable the instant it returns; the condition
    // record is what a manager reads before deciding, by hand, to retire.
    [, $manager, $loan, $copy] = retFix();

    app(ReceiveReturn::class)->execute($manager, $loan, CopyCondition::MissingPages, 'mất trang 12-20');

    expect($copy->fresh()->state)->toBe(CopyState::Available)
        ->and($copy->fresh()->condition)->toBe(CopyCondition::MissingPages)
        ->and($copy->fresh()->condition_note)->toBe('mất trang 12-20');
});

it('returning an already-returned loan fails with loan_not_active and writes nothing more', function () {
    [, $manager, $loan] = retFix();
    app(ReceiveReturn::class)->execute($manager, $loan, CopyCondition::Perfect);

    expect(fn () => app(ReceiveReturn::class)->execute($manager, $loan, CopyCondition::Perfect))
        ->toThrow(RuleViolated::class, 'loan_not_active');
    expect(ConditionAssessment::query()->count())->toBe(1);
});

it('INV-11: a loan is never deleted on return', function () {
    [, $manager, $loan] = retFix();
    app(ReceiveReturn::class)->execute($manager, $loan, CopyCondition::Perfect);

    expect(Loan::query()->whereKey($loan->id)->exists())->toBeTrue();
});

it('INV-1 stays satisfiable: the returned copy can immediately be lent again', function () {
    [$shelf, $manager, $loan, $copy] = retFix();
    app(ReceiveReturn::class)->execute($manager, $loan, CopyCondition::Perfect);

    app(TenantContext::class)->actSystemWide();
    $next = User::factory()->create(['full_name' => 'Anna Người Mượn Kế']);
    $nextMembership = Membership::factory()->for($shelf)->create([
        'user_id' => $next->id, 'role' => 'reader', 'status' => 'active',
    ]);
    app(TenantContext::class)->set($shelf, Membership::query()->where('user_id', $manager->id)->firstOrFail());

    $result = app(LendCopy::class)->execute($manager, $copy->fresh(), $nextMembership);
    expect(Loan::query()->find($result['loanId'])?->status)->toBe(LoanStatus::Active);
});

it('INV-8: the return audits before and after, storing the title and the borrower', function () {
    [, $manager, $loan] = retFix();

    app(ReceiveReturn::class)->execute($manager, $loan, CopyCondition::SlightlyWorn);

    $entry = AuditLog::query()->where('action', 'loan.returned')->firstOrFail();
    $after = (array) $entry->after;
    expect((array) $entry->before)->toMatchArray(['status' => 'active', 'copy_state' => 'on_loan'])
        ->and($after['status'])->toBe('returned')
        ->and($after['copy_state'])->toBe('available')
        ->and($after['condition'])->toBe('slightly_worn')
        ->and($after['title'])->toBe('Hoàng Tử Bé')
        ->and($after['borrower_id'])->toBe($loan->borrower_id);
});

it('the copy lock is the transaction\'s first statement, the loan lock its second', function () {
    [, $manager, $loan] = retFix(slug: 'dong-thap-ret-lock');

    DB::flushQueryLog();
    DB::enableQueryLog();
    app(ReceiveReturn::class)->execute($manager, $loan, CopyCondition::Perfect);
    $log = DB::getQueryLog();
    DB::disableQueryLog();

    expect(str_contains($log[0]['query'], 'book_copies'))->toBeTrue($log[0]['query'])
        ->and(str_contains(strtolower($log[0]['query']), 'for update'))->toBeTrue($log[0]['query'])
        ->and(str_contains($log[1]['query'], 'loans'))->toBeTrue($log[1]['query'])
        ->and(str_contains(strtolower($log[1]['query']), 'for update'))->toBeTrue($log[1]['query']);
});

it('the status check reads the LOCKED row: a loan closed underneath the route binding refuses', function () {
    [, $manager, $loan] = retFix(slug: 'dong-thap-ret-stale');
    // Close it out from underneath — single statement, so
    // loans_returned_has_condition holds.
    Loan::query()->whereKey($loan->id)->update([
        'status' => 'returned', 'return_condition' => 'perfect',
        'returned_at' => now(), 'received_by' => $manager->id,
    ]);
    expect($loan->status)->toBe(LoanStatus::Active); // the stale snapshot

    expect(fn () => app(ReceiveReturn::class)->execute($manager, $loan, CopyCondition::Perfect))
        ->toThrow(RuleViolated::class, 'loan_not_active');
});

it('divergence 2: report-lost\'s loan close now takes a locking read, copy first then loan', function () {
    // The AB-BA hardening this task applies to 1a's ReportCopyLost: its
    // loan close must be a FOR UPDATE read issued AFTER its copy lock, so
    // a racing return either wins cleanly (report-lost then sees no active
    // loan) or waits — never a blind overwrite of a committed return.
    [$shelf, $manager, $loan, $copy] = retFix(slug: 'dong-thap-ret-rcl');

    DB::flushQueryLog();
    DB::enableQueryLog();
    app(ReportCopyLost::class)->execute($manager, $copy, 'bạn đọc báo làm mất');
    $log = DB::getQueryLog();
    DB::disableQueryLog();

    $copyLockAt = null;
    $loanReadAt = null;
    foreach ($log as $i => $q) {
        $sql = strtolower($q['query']);
        if ($copyLockAt === null && str_contains($sql, 'book_copies') && str_contains($sql, 'for update')) {
            $copyLockAt = $i;
        }
        if ($loanReadAt === null && str_contains($sql, 'from `loans`')) {
            $loanReadAt = $i;
            expect(str_contains($sql, 'for update'))->toBeTrue('loan close read is not FOR UPDATE: '.$q['query']);
        }
    }
    expect($copyLockAt)->not->toBeNull()->and($loanReadAt)->not->toBeNull()
        ->and($copyLockAt)->toBeLessThan($loanReadAt);
    expect($loan->fresh()->status)->toBe(LoanStatus::Lost);
});

it('a reader may not receive a return', function () {
    [$shelf, , $loan] = retFix(slug: 'dong-thap-ret-reader');
    $borrower = User::query()->findOrFail($loan->borrower_id);
    $borrowerMembership = Membership::query()->where('user_id', $borrower->id)->firstOrFail();
    test()->actingAs($borrower);
    app(TenantContext::class)->set($shelf->fresh(), $borrowerMembership);

    expect(fn () => app(ReceiveReturn::class)->execute($borrower, $loan, CopyCondition::Perfect))
        ->toThrow(AuthorizationException::class);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `make test FILTER=ReceiveReturnTest`
Expected: FAIL — class not found (the divergence-2 test also fails: the current `ReportCopyLost` loan read carries no FOR UPDATE).

- [ ] **Step 3: Implement `ReceiveReturn`**

Create `app/Actions/Circulation/ReceiveReturn.php`:

```php
<?php

namespace App\Actions\Circulation;

use App\Enums\CopyCondition;
use App\Enums\CopyState;
use App\Enums\LoanStatus;
use App\Exceptions\RuleViolated;
use App\Models\BookCopy;
use App\Models\ConditionAssessment;
use App\Models\Loan;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\Clock;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * Closes a loan and records the copy's condition — OPS §5's walk, BR
 * §16.3's two-tap common case. Port of receive-return.ts, NARROWED for 1c
 * (plan divergence 4): no holdForRequestId, no queuedRequestId, no
 * request.approved pairing, no notification — the queued-reader decision
 * needs Phase 2's borrow requests to exist. Phase 2 re-widens this
 * signature to the reference's exact shape: both facts in one transaction,
 * two audit rows, the copy never observably available in between.
 *
 * Lock order (divergence 1): copy FIRST — located from the route-bound
 * loan's own copy_id attribute, no query — then the loan. Same order as
 * ReportCopyLost, so a return racing "bạn đọc báo làm mất" on the same
 * copy serialises instead of deadlocking, and whichever commits second
 * sees the closed loan and refuses cleanly (loan_not_active — the
 * double-submit sentence, OPS §4.2's one deliberate code for not-found,
 * not-mine and already-processed alike).
 *
 * T27 (OPS §5): a worse condition never diverts the copy away from
 * available. condition_note moves with condition — one judgement, exactly
 * as AssessCondition writes them.
 *
 * loans_returned_has_condition: status and return_condition are ONE
 * update() — split writes raise the CHECK mid-transaction.
 */
final class ReceiveReturn
{
    public function __construct(
        private Clock $clock,
        private AuditRecorder $audit,
    ) {}

    public function execute(User $actor, Loan $loan, CopyCondition $condition, ?string $note = null, ?string $photoUrl = null): void
    {
        Gate::forUser($actor)->authorize('receiveReturn', $loan);

        DB::transaction(function () use ($actor, $loan, $condition, $note, $photoUrl): void {
            // FIRST statement — copy_id is an in-memory attribute of the
            // route-bound model; reading it issues no query, so the copy
            // lock is genuinely the transaction's first statement.
            $copy = BookCopy::query()->lockForUpdate()->findOrFail($loan->copy_id);
            // SECOND — the loan, latest committed row, not the snapshot.
            $loan = Loan::query()->lockForUpdate()->findOrFail($loan->id);

            if ($loan->status !== LoanStatus::Active) {
                throw new RuleViolated('loan_not_active');
            }

            $now = $this->clock->now();
            $trimmedNote = ($note === null || trim($note) === '') ? null : trim($note);

            ConditionAssessment::query()->create([
                'copy_id' => $copy->id,
                'loan_id' => $loan->id,
                'assessed_by' => $actor->id,
                'condition' => $condition,
                'note' => $trimmedNote,
                'photo_url' => $photoUrl,
                'assessed_at' => $now,
            ]);

            $loan->update([
                'status' => LoanStatus::Returned,
                'returned_at' => $now,
                'received_by' => $actor->id,
                'return_condition' => $condition,
                'return_note' => $trimmedNote,
                'return_photo_url' => $photoUrl,
            ]);

            $copy->update([
                'state' => CopyState::Available,
                'condition' => $condition,
                'condition_note' => $trimmedNote,
            ]);

            $this->audit->record('loan.returned', 'loan', $loan->id,
                ['status' => 'active', 'copy_state' => 'on_loan'],
                [
                    'status' => 'returned',
                    'copy_state' => 'available',
                    'condition' => $condition->value,
                    'title' => $copy->book?->title,
                    'borrower_id' => $loan->borrower_id,
                ]);
        });
    }
}
```

- [ ] **Step 4: Harden `ReportCopyLost`'s loan close (divergence 2)**

In `app/Actions/Catalogue/ReportCopyLost.php`, the loan close currently reads:

```php
            $loan = $copy->loans()->where('status', 'active')->first();
```

Replace with a locking read, and extend the class docblock:

```php
            // REVISED (1c, divergence 2): a LOCKING read, issued after this
            // transaction's copy lock — the global circulation order (copy
            // before loan). The plain read it replaces saw 'active' from
            // its own snapshot and then updated blindly: racing
            // ReceiveReturn, that update waited on the return's row lock
            // and then flipped a committed 'returned' loan to 'lost'. The
            // locking read sees the latest committed row instead, so a
            // return that won cleanly leaves nothing here to close.
            $loan = $copy->loans()->where('status', 'active')->lockForUpdate()->first();
```

- [ ] **Step 5: Run the tests, verify they pass**

Run: `make test FILTER=ReceiveReturnTest && make test FILTER=ReportCopyLost`
Expected: PASS — including 1a's existing `ReportCopyLost` suite, unchanged behaviourally.

- [ ] **Step 6: Lint, analyse, commit**

```bash
make lint && make analyse
git add app/Actions/Circulation/ReceiveReturn.php app/Actions/Catalogue/ReportCopyLost.php tests/Feature/Circulation/ReceiveReturnTest.php
git commit -m "feat: receivereturn — loan closed and condition recorded in one transaction"
```

---
### Task 5: `RenewLoan` — more time, from the current due date

Read first: `old_next/src/domain/circulation/commands/renew-loan.ts` (the docblock carries INV-6's whole argument) and `old_next/tests/invariants/inv-06-renewal-rules.test.ts` — the tests below are its port.

**Files:**
- Create: `app/Actions/Circulation/RenewLoan.php`
- Test: `tests/Feature/Circulation/RenewLoanTest.php`

**Interfaces:**
- Consumes: `LoanRules::loanRenewable`, `LendingSettings`, `LoanTerms::renewedDueDate`, `LoanPolicy::renew` (role only — ownership is this Action's), `App\Models\BorrowRequest`, `App\Enums\RequestStatus`.
- Produces: `RenewLoan::execute(User $actor, Loan $loan): array{dueOn: string, renewalsUsed: int}` — throws `RuleViolated` with `loan_not_active` | `no_renewals_remaining` | `title_has_queue`; audit action `loan.renewed`. Task 13's controller calls exactly this.

**What serialises what:** the loan-row lock (the transaction's first and only lock — this command writes no copy state, so it holds one lock and sits outside every two-lock ordering question). The queue check is a plain `exists` on `borrow_requests` issued after the lock; it has **no structural backstop** — a request created concurrently can slip past, exactly as in the reference. Harmless in 1c (no command creates requests until Phase 2) and recorded in known-gaps by Task 14 so Phase 2 decides with open eyes.

- [ ] **Step 1: Write the failing tests**

Create `tests/Feature/Circulation/RenewLoanTest.php`:

```php
<?php

use App\Actions\Circulation\RenewLoan;
use App\Exceptions\RuleViolated;
use App\Models\AuditLog;
use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\BorrowRequest;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

afterEach(fn () => Carbon::setTestNow());

/**
 * Shelf + a reader (ACTING — renewal is reader-initiated) holding one
 * active loan due 2026-09-04 with no renewals used.
 *
 * @return array{Bookshelf, User, Loan, Book}
 */
function renFix(array $shelfSettings = [], string $readerStatus = 'active', string $slug = 'dong-thap-ren'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => $shelfSettings]);
    $manager = User::factory()->create(['full_name' => 'Maria Thủ Thư Trưởng']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);
    $reader = User::factory()->create(['full_name' => 'Phêrô Xin Gia Hạn']);
    $readerMembership = Membership::factory()->for($shelf)->create([
        'user_id' => $reader->id, 'role' => 'reader', 'status' => $readerStatus,
    ]);
    $book = Book::query()->create([
        'bookshelf_id' => $shelf->id, 'title' => 'Totto-chan Bên Cửa Sổ', 'slug' => 'totto-chan',
    ]);
    $copy = BookCopy::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0003', 'state' => 'on_loan',
    ]);
    $loan = Loan::query()->create([
        'bookshelf_id' => $shelf->id, 'copy_id' => $copy->id, 'book_id' => $book->id,
        'borrower_id' => $reader->id, 'lent_by' => $manager->id,
        'due_on' => '2026-09-04', 'status' => 'active', 'renewals_used' => 0,
    ]);
    app(TenantContext::class)->set($shelf, $readerMembership);
    test()->actingAs($reader);

    return [$shelf, $reader, $loan, $book];
}

it('INV-6: a renewal extends the CURRENT due date, not today — even when overdue', function () {
    // Today is 2026-09-10, six days past due. today+7 = 2026-09-17;
    // due_on+7 = 2026-09-11. The wrong arithmetic reads identical on every
    // early renewal and quietly LENGTHENS a late one — this is the fixture
    // that tells them apart (inv-06's first test).
    Carbon::setTestNow(Carbon::parse('2026-09-10 03:00:00', 'UTC'));
    [, $reader, $loan] = renFix();

    $result = app(RenewLoan::class)->execute($reader, $loan);

    expect($result['dueOn'])->toBe('2026-09-11')
        ->and($result['renewalsUsed'])->toBe(1)
        ->and($loan->fresh()->due_on->toDateString())->toBe('2026-09-11');
});

it('the extension is the shelf\'s renewal_days, not a hard-coded seven', function () {
    [, $reader, $loan] = renFix(['renewal_days' => 14]);

    $result = app(RenewLoan::class)->execute($reader, $loan);
    expect($result['dueOn'])->toBe('2026-09-18');
});

it('renewals run out, and the second attempt says so', function () {
    [, $reader, $loan] = renFix();
    app(RenewLoan::class)->execute($reader, $loan);

    expect(fn () => app(RenewLoan::class)->execute($reader, $loan->fresh()))
        ->toThrow(RuleViolated::class, 'no_renewals_remaining');
});

it('a shelf that allows more renewals allows more', function () {
    [, $reader, $loan] = renFix(['max_renewals' => 2]);
    app(RenewLoan::class)->execute($reader, $loan);
    $result = app(RenewLoan::class)->execute($reader, $loan->fresh());

    expect($result['renewalsUsed'])->toBe(2)
        ->and($result['dueOn'])->toBe('2026-09-18'); // 09-04 + 7 + 7
});

it('somebody queued for the TITLE blocks the renewal — pending only, and only this title', function () {
    // Requests are Phase 2's to CREATE; the INV-6 check ships now and is
    // tested by seeding rows directly. Three fixtures, three distinct
    // requesters (one row per case — the collapsed-fixture trap).
    [$shelf, $reader, $loan, $book] = renFix();
    app(TenantContext::class)->actSystemWide();
    $otherBook = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Đất Rừng Phương Nam', 'slug' => 'dat-rung']);
    $waiting = User::factory()->create(['full_name' => 'Anna Đang Chờ Sách']);

    // A CANCELLED request for this title: not somebody waiting.
    BorrowRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $book->id,
        'member_id' => $waiting->id, 'status' => 'cancelled',
    ]);
    // A PENDING request for a DIFFERENT title: not this book's queue.
    BorrowRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $otherBook->id,
        'member_id' => $waiting->id, 'status' => 'pending',
    ]);
    app(TenantContext::class)->set($shelf, Membership::query()->where('user_id', $reader->id)->firstOrFail());

    // Neither blocks:
    $result = app(RenewLoan::class)->execute($reader, $loan);
    expect($result['renewalsUsed'])->toBe(1);

    // A PENDING request for THIS title blocks (fresh loan on a fresh shelf
    // so renewals remain — the refusal must be the queue's, not the count's).
    [$shelf2, $reader2, $loan2, $book2] = renFix(slug: 'dong-thap-ren-q');
    app(TenantContext::class)->actSystemWide();
    $waiting2 = User::factory()->create(['full_name' => 'Gioan Đợi Đến Lượt']);
    BorrowRequest::query()->create([
        'bookshelf_id' => $shelf2->id, 'book_id' => $book2->id,
        'member_id' => $waiting2->id, 'status' => 'pending',
    ]);
    app(TenantContext::class)->set($shelf2, Membership::query()->where('user_id', $reader2->id)->firstOrFail());

    expect(fn () => app(RenewLoan::class)->execute($reader2, $loan2))
        ->toThrow(RuleViolated::class, 'title_has_queue');
});

it('Q4: a suspended reader may still renew — the assumed reading, pinned by name', function () {
    // INV-4 blocks NEW loans and protects existing ones; OPS §4.2's open
    // question records both readings and the reference implements ALLOWED.
    // Reversing is one predicate call in RenewLoan::execute (marked there)
    // plus flipping this test — loud either way.
    [, $reader, $loan] = renFix(readerStatus: 'suspended');

    $result = app(RenewLoan::class)->execute($reader, $loan);
    expect($result['renewalsUsed'])->toBe(1);
});

it('a reader cannot renew somebody else\'s loan, and hears loan_not_active, not whose it is', function () {
    [$shelf, , $loan] = renFix(slug: 'dong-thap-ren-own');
    app(TenantContext::class)->actSystemWide();
    $stranger = User::factory()->create(['full_name' => 'Đaminh Người Khác Hẳn']);
    $strangerMembership = Membership::factory()->for($shelf)->create([
        'user_id' => $stranger->id, 'role' => 'reader', 'status' => 'active',
    ]);
    app(TenantContext::class)->set($shelf->fresh(), $strangerMembership);
    test()->actingAs($stranger);

    expect(fn () => app(RenewLoan::class)->execute($stranger, $loan))
        ->toThrow(RuleViolated::class, 'loan_not_active');
});

it('a returned loan cannot be renewed', function () {
    [, $reader, $loan] = renFix();
    Loan::query()->whereKey($loan->id)->update([
        'status' => 'returned', 'return_condition' => 'perfect', 'returned_at' => now(),
    ]);

    expect(fn () => app(RenewLoan::class)->execute($reader, $loan))
        ->toThrow(RuleViolated::class, 'loan_not_active');
});

it('the renewal is audited, with both dates', function () {
    [, $reader, $loan] = renFix();
    app(RenewLoan::class)->execute($reader, $loan);

    $entry = AuditLog::query()->where('action', 'loan.renewed')->firstOrFail();
    expect((array) $entry->before)->toMatchArray(['due_on' => '2026-09-04', 'renewals_used' => 0])
        ->and((array) $entry->after)->toMatchArray(['due_on' => '2026-09-11', 'renewals_used' => 1]);
});

it('the loan lock is the transaction\'s first statement', function () {
    [, $reader, $loan] = renFix(slug: 'dong-thap-ren-lock');

    DB::flushQueryLog();
    DB::enableQueryLog();
    app(RenewLoan::class)->execute($reader, $loan);
    $log = DB::getQueryLog();
    DB::disableQueryLog();

    expect(str_contains($log[0]['query'], 'loans'))->toBeTrue($log[0]['query'])
        ->and(str_contains(strtolower($log[0]['query']), 'for update'))->toBeTrue($log[0]['query']);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `make test FILTER=RenewLoanTest`
Expected: FAIL — class not found.

- [ ] **Step 3: Implement `RenewLoan`**

Create `app/Actions/Circulation/RenewLoan.php`:

```php
<?php

namespace App\Actions\Circulation;

use App\Enums\LoanStatus;
use App\Enums\RequestStatus;
use App\Exceptions\RuleViolated;
use App\Models\BorrowRequest;
use App\Models\Loan;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\Circulation\LendingSettings;
use App\Support\Circulation\LoanRules;
use App\Support\Circulation\LoanTerms;
use App\Support\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * A reader extends their own loan — port of renew-loan.ts, reached from BR
 * §16.2's "Xin gia hạn".
 *
 * INV-6 has two halves and an arithmetic. The halves are LoanRules::
 * loanRenewable's (one predicate, shared with the dashboard so screen and
 * command cannot disagree). The arithmetic is LoanTerms::renewedDueDate on
 * the LOCKED row's due_on — from the current due date, never today
 * (divergence 5: PHP on a locked row replaces the reference's SQL, same
 * race-freedom, and the overdue-renewal test pins the property).
 *
 * The queue is checked on the TITLE (book_id), not the copy — a waiting
 * reader does not care which copy they get — and on status pending only:
 * an approved request already holds a specific copy and is not waiting on
 * this loan. Soft-deleted requests are excluded by the model's own scope.
 *
 * Q4 (open question 1): NO membership-status check, deliberately — a
 * suspended reader may renew on the reference's reading. To reverse:
 * resolve this reader's membership and call LoanRules::memberMayBorrow
 * here, plus flip RenewLoanTest's named Q4 test.
 *
 * Ownership folds into loan_not_active — OPS §4.2 lists no loan_not_found
 * and no not_your_loan; distinguishing them would confirm the loan exists.
 * borrower_id is a users(id): the comparison is against $actor->id, never
 * a membership id.
 *
 * @return array{dueOn: string, renewalsUsed: int}
 */
final class RenewLoan
{
    public function __construct(
        private AuditRecorder $audit,
        private TenantContext $tenant,
    ) {}

    /** @return array{dueOn: string, renewalsUsed: int} */
    public function execute(User $actor, Loan $loan): array
    {
        Gate::forUser($actor)->authorize('renew', $loan);

        return DB::transaction(function () use ($actor, $loan): array {
            // FIRST statement — the only lock this command takes.
            $loan = Loan::query()->lockForUpdate()->findOrFail($loan->id);

            if ($loan->status !== LoanStatus::Active || $loan->borrower_id !== $actor->id) {
                throw new RuleViolated('loan_not_active');
            }

            $shelf = $this->tenant->bookshelf();
            if ($shelf === null) {
                throw new RuleViolated('shelf_not_found');
            }
            $settings = LendingSettings::fromShelf($shelf);

            $titleHasQueue = BorrowRequest::query()
                ->where('book_id', $loan->book_id)
                ->where('status', RequestStatus::Pending)
                ->exists();

            if (($code = LoanRules::loanRenewable($loan->renewals_used, $settings->maxRenewals, $titleHasQueue)) !== null) {
                throw new RuleViolated($code);
            }

            $before = ['due_on' => $loan->due_on->toDateString(), 'renewals_used' => $loan->renewals_used];
            $dueOn = LoanTerms::renewedDueDate($before['due_on'], $settings->renewalDays);

            $loan->update(['due_on' => $dueOn, 'renewals_used' => $loan->renewals_used + 1]);

            $this->audit->record('loan.renewed', 'loan', $loan->id,
                $before,
                ['due_on' => $dueOn, 'renewals_used' => $loan->renewals_used]);

            return ['dueOn' => $dueOn, 'renewalsUsed' => $loan->renewals_used];
        });
    }
}
```

- [ ] **Step 4: Run the tests, verify they pass**

Run: `make test FILTER=RenewLoanTest`
Expected: PASS.

- [ ] **Step 5: Mutation check on the arithmetic (not committed)**

Temporarily change `renewedDueDate($before['due_on'], …)` to compute from `app(\App\Support\Clock::class)->today()` and confirm the overdue-renewal test FAILS (it would report 2026-09-17); restore. This is the silent wrong-arithmetic the reference's docblock warns reads identical on every early renewal.

- [ ] **Step 6: Lint, analyse, commit**

```bash
make lint && make analyse
git add app/Actions/Circulation/RenewLoan.php tests/Feature/Circulation/RenewLoanTest.php
git commit -m "feat: renewloan — renewal_days from the current due date, queue checked on the title"
```

---

### Task 6: `VoidLoan` — the undo that is never a delete

Read first: `old_next/src/domain/circulation/commands/void-loan.ts` and `old_next/tests/invariants/inv-11-loans-never-deleted.test.ts` — the tests below port its voidLoan half (the trigger half is Phase 0's `DbGuaranteesTest`, already green).

**Files:**
- Create: `app/Actions/Circulation/VoidLoan.php`
- Test: `tests/Feature/Circulation/VoidLoanTest.php`

**Interfaces:**
- Consumes: `LoanPolicy::void`, `AuditRecorder`, `Clock`.
- Produces: `VoidLoan::execute(User $actor, Loan $loan, string $reason): void` — throws `RuleViolated` with `reason_required` | `loan_not_active_cannot_void`; audit action `loan.voided`. Task 12's book-detail form calls exactly this.

- [ ] **Step 1: Write the failing tests**

Create `tests/Feature/Circulation/VoidLoanTest.php`:

```php
<?php

use App\Actions\Circulation\VoidLoan;
use App\Enums\CopyState;
use App\Enums\LoanStatus;
use App\Exceptions\RuleViolated;
use App\Models\AuditLog;
use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Carbon\Carbon;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;

afterEach(fn () => Carbon::setTestNow());

/** @return array{Bookshelf, User, Loan, BookCopy} shelf, manager (acting), active loan, its copy */
function voidFix(string $slug = 'dong-thap-void'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);
    $manager = User::factory()->create(['full_name' => 'Maria Sửa Sai Sổ Sách']);
    $managerMembership = Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);
    $reader = User::factory()->create(['full_name' => 'Giuse Bị Ghi Nhầm']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $reader->id, 'role' => 'reader', 'status' => 'active',
    ]);
    $book = Book::query()->create([
        'bookshelf_id' => $shelf->id, 'title' => 'Đất Rừng Phương Nam', 'slug' => 'dat-rung-pn',
    ]);
    $copy = BookCopy::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0004', 'state' => 'on_loan',
    ]);
    $loan = Loan::query()->create([
        'bookshelf_id' => $shelf->id, 'copy_id' => $copy->id, 'book_id' => $book->id,
        'borrower_id' => $reader->id, 'lent_by' => $manager->id,
        'due_on' => '2026-09-11', 'status' => 'active',
    ]);
    app(TenantContext::class)->set($shelf, $managerMembership);
    test()->actingAs($manager);

    return [$shelf, $manager, $loan, $copy];
}

it('INV-11: voiding keeps the row — status, reason, voider, time — and frees the copy', function () {
    Carbon::setTestNow(Carbon::parse('2026-08-28 05:00:00', 'UTC'));
    [, $manager, $loan, $copy] = voidFix();

    app(VoidLoan::class)->execute($manager, $loan, 'Ghi nhầm bạn đọc');

    $fresh = $loan->fresh();
    expect($fresh)->not->toBeNull()
        ->and($fresh->status)->toBe(LoanStatus::Voided)
        ->and($fresh->void_reason)->toBe('Ghi nhầm bạn đọc')
        ->and($fresh->voided_by)->toBe($manager->id)
        ->and($fresh->voided_at->toDateTimeString())->toBe('2026-08-28 05:00:00')
        ->and($copy->fresh()->state)->toBe(CopyState::Available);
});

it('a reason is required, and three spaces are no reason at all', function () {
    [, $manager, $loan] = voidFix();

    expect(fn () => app(VoidLoan::class)->execute($manager, $loan, '   '))
        ->toThrow(RuleViolated::class, 'reason_required');
    expect($loan->fresh()->status)->toBe(LoanStatus::Active);
});

it('only an active loan can be voided — the undo that no longer applies says so', function () {
    [, $manager, $loan] = voidFix();
    Loan::query()->whereKey($loan->id)->update([
        'status' => 'returned', 'return_condition' => 'perfect', 'returned_at' => now(),
    ]);

    expect(fn () => app(VoidLoan::class)->execute($manager, $loan, 'muộn rồi'))
        ->toThrow(RuleViolated::class, 'loan_not_active_cannot_void');
});

it('INV-1\'s other half: a voided loan frees the copy for the next lend', function () {
    // The generated column goes NULL on the voided row, so a new active
    // loan for the same copy no longer collides.
    [$shelf, $manager, $loan, $copy] = voidFix();
    app(VoidLoan::class)->execute($manager, $loan, 'Ghi nhầm');

    app(TenantContext::class)->actSystemWide();
    $next = Loan::query()->create([
        'bookshelf_id' => $shelf->id, 'copy_id' => $copy->id, 'book_id' => $loan->book_id,
        'borrower_id' => $loan->borrower_id, 'lent_by' => $manager->id,
        'due_on' => '2026-09-25', 'status' => 'active',
    ]);
    expect($next->exists)->toBeTrue();
});

it('voiding writes an audit record naming the reason', function () {
    // INV-12 makes the audit append-only, while loans.void_reason is an
    // ordinary column — the record here is the durable copy.
    [, $manager, $loan] = voidFix();
    app(VoidLoan::class)->execute($manager, $loan, 'Ghi nhầm bạn đọc');

    $entry = AuditLog::query()->where('action', 'loan.voided')->firstOrFail();
    expect((array) $entry->before)->toMatchArray(['status' => 'active', 'copy_state' => 'on_loan'])
        ->and((array) $entry->after)->toMatchArray([
            'status' => 'voided', 'copy_state' => 'available', 'reason' => 'Ghi nhầm bạn đọc',
        ]);
});

it('the copy lock is the transaction\'s first statement, the loan lock its second', function () {
    [, $manager, $loan] = voidFix(slug: 'dong-thap-void-lock');

    DB::flushQueryLog();
    DB::enableQueryLog();
    app(VoidLoan::class)->execute($manager, $loan, 'Ghi nhầm');
    $log = DB::getQueryLog();
    DB::disableQueryLog();

    expect(str_contains($log[0]['query'], 'book_copies'))->toBeTrue($log[0]['query'])
        ->and(str_contains(strtolower($log[0]['query']), 'for update'))->toBeTrue($log[0]['query'])
        ->and(str_contains($log[1]['query'], 'loans'))->toBeTrue($log[1]['query'])
        ->and(str_contains(strtolower($log[1]['query']), 'for update'))->toBeTrue($log[1]['query']);
});

it('a reader may not void a loan', function () {
    [$shelf, , $loan] = voidFix(slug: 'dong-thap-void-reader');
    $borrower = User::query()->findOrFail($loan->borrower_id);
    $borrowerMembership = Membership::query()->where('user_id', $borrower->id)->firstOrFail();
    test()->actingAs($borrower);
    app(TenantContext::class)->set($shelf->fresh(), $borrowerMembership);

    expect(fn () => app(VoidLoan::class)->execute($borrower, $loan, 'không phải việc của em'))
        ->toThrow(AuthorizationException::class);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `make test FILTER=VoidLoanTest`
Expected: FAIL — class not found.

- [ ] **Step 3: Implement `VoidLoan`**

Create `app/Actions/Circulation/VoidLoan.php`:

```php
<?php

namespace App\Actions\Circulation;

use App\Enums\CopyState;
use App\Enums\LoanStatus;
use App\Exceptions\RuleViolated;
use App\Models\BookCopy;
use App\Models\Loan;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\Clock;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * Undoes a loan recorded in error — BR §3's edge case, port of
 * void-loan.ts. Never a delete (INV-11): the row survives with status,
 * reason and voider, so "why is there no loan here" has an answer six
 * months later; the loans_no_delete trigger refuses DELETE regardless,
 * which is what makes this a rule rather than a convention.
 *
 * The reason check runs BEFORE the transaction: trimmed, so three spaces
 * are no reason (loans_voided_has_reason only catches NULL, and would
 * surface as a raw CHECK violation rather than OPS §4.2's sentence).
 * status + void_reason are ONE update() for the same constraint.
 *
 * loan_not_active_cannot_void, not loan_not_active — the two refusals
 * differ: a double-submitted return is nothing wrong, while voiding a
 * closed loan is an undo that no longer applies, and BR §17.7 asks the
 * message to say what is allowed instead. Not-found and another shelf's
 * loan share the code, the usual anti-enumeration fold.
 *
 * Lock order: copy first (from the bound loan's in-memory copy_id), then
 * loan — divergence 1's global order, shared with ReceiveReturn and
 * ReportCopyLost so the three serialise instead of deadlocking.
 */
final class VoidLoan
{
    public function __construct(
        private Clock $clock,
        private AuditRecorder $audit,
    ) {}

    public function execute(User $actor, Loan $loan, string $reason): void
    {
        Gate::forUser($actor)->authorize('void', $loan);

        $reason = trim($reason);
        if ($reason === '') {
            throw new RuleViolated('reason_required');
        }

        DB::transaction(function () use ($actor, $loan, $reason): void {
            // FIRST statement — copy_id is an in-memory attribute, no query.
            $copy = BookCopy::query()->lockForUpdate()->findOrFail($loan->copy_id);
            $loan = Loan::query()->lockForUpdate()->findOrFail($loan->id);

            if ($loan->status !== LoanStatus::Active) {
                throw new RuleViolated('loan_not_active_cannot_void');
            }

            $loan->update([
                'status' => LoanStatus::Voided,
                'voided_at' => $this->clock->now(),
                'voided_by' => $actor->id,
                'void_reason' => $reason,
            ]);

            // INV-2, and INV-1's other half: the generated column already
            // frees the copy as far as the index is concerned, but state
            // is what every screen and borrowable() read — a copy left
            // on_loan with no active loan is a book nobody can lend and
            // nobody can find the loan for.
            $copy->update(['state' => CopyState::Available]);

            $this->audit->record('loan.voided', 'loan', $loan->id,
                ['status' => 'active', 'copy_state' => 'on_loan'],
                ['status' => 'voided', 'copy_state' => 'available', 'reason' => $reason]);
        });
    }
}
```

- [ ] **Step 4: Run the tests, verify they pass**

Run: `make test FILTER=VoidLoanTest`
Expected: PASS.

- [ ] **Step 5: Lint, analyse, commit**

```bash
make lint && make analyse
git add app/Actions/Circulation/VoidLoan.php tests/Feature/Circulation/VoidLoanTest.php
git commit -m "feat: voidloan — the undo that keeps the row and frees the copy"
```

---
### Task 7: The three lending searches — quick-lend steps 1 and 2, return step 1

Read first: `old_next/src/domain/catalogue/queries/search-books-for-lending.ts` (the whole docblock — the blocked-reason aggregation carries a fix-wave's reasoning), `old_next/src/domain/members/queries/search-readers-for-lending.ts` ("never filters a blocked reader out"), `old_next/src/domain/circulation/queries/search-loans-for-return.ts` (the copy-code branch is the search key the shelf actually uses), and `old_next/tests/domain/circulation/lending-queries.test.ts` — the tests below are its port.

**Files:**
- Create: `app/Queries/SearchBooksForLendingQuery.php`
- Create: `app/Queries/SearchReadersForLendingQuery.php`
- Create: `app/Queries/SearchLoansForReturnQuery.php`
- Test: `tests/Feature/Circulation/LendingQueriesTest.php`

**Interfaces:**
- Consumes: `Fold::fold(string): string`, `CopyCodes::escapeLike(string): string`, `CountsCopies::borrowable()` (availability's one home), `LoanRules::memberMayBorrow`, `LendingSettings`, `LoanTerms`, `Clock::today()`, `ParishContextQuery` + `Support\Members\ParishUnits::describeSelection` (1b — the parish line on reader rows, the shelf's own labels).
- Produces:
  - `SearchBooksForLendingQuery::run(string $q): list<array{bookId: string, slug: string, title: string, author: ?string, coverUrl: ?string, copiesTotal: int, copiesAvailable: int, blocked: bool, reason: ?string}>` — `reason` is exactly the code `LendCopy` throws (`copy_lost_or_retired` when every recorded copy is lost/retired, `copy_not_available` otherwise), `null` when not blocked.
  - `SearchReadersForLendingQuery::run(string $q): list<array{membershipId: string, userId: string, fullName: string, saintName: ?string, parishLine: string, activeLoans: int, blocked: bool, reason: ?string}>` — `reason` from `LoanRules::memberMayBorrow`; **blocked rows are returned, never filtered** (BR §16.3: a clear message before the confirm step, not a silently missing row).
  - `SearchLoansForReturnQuery::run(string $q): list<array{loanId: string, copyId: string, copyCode: string, bookId: string, title: string, coverUrl: ?string, borrowerUserId: string, borrowerName: string, dueOn: string, isOverdue: bool, daysRemaining: int}>` — active loans only; overdue derived through `LoanTerms`.
  - All three: a blank or garbage query (folds to `''`) returns `[]` — the M7 guard, one behaviour across the three, not three that agree by accident.

- [ ] **Step 1: Write the failing tests**

Create `tests/Feature/Circulation/LendingQueriesTest.php`:

```php
<?php

use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\User;
use App\Queries\SearchBooksForLendingQuery;
use App\Queries\SearchLoansForReturnQuery;
use App\Queries\SearchReadersForLendingQuery;
use App\Support\TenantContext;
use Carbon\Carbon;

afterEach(fn () => Carbon::setTestNow());

/**
 * One shelf: a manager (acting), two readers, one title with three copies —
 * one available, one on loan to reader 1, one lost.
 *
 * @return array{Bookshelf, User, Membership, Membership, Book, Loan}
 */
function lqFix(string $slug = 'dong-thap-lq'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);
    $manager = User::factory()->create(['full_name' => 'Maria Tìm Sách Giúp']);
    $managerMembership = Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);
    $reader1 = User::factory()->create(['full_name' => 'Têrêsa Đặng Ngọc Ánh']);
    $m1 = Membership::factory()->for($shelf)->create([
        'user_id' => $reader1->id, 'role' => 'reader', 'status' => 'active',
    ]);
    $reader2 = User::factory()->create(['full_name' => 'Anna Đặng Thu Hà']);
    $m2 = Membership::factory()->for($shelf)->create([
        'user_id' => $reader2->id, 'role' => 'reader', 'status' => 'suspended',
    ]);
    $book = Book::query()->create([
        'bookshelf_id' => $shelf->id, 'title' => 'Dế Mèn Phiêu Lưu Ký',
        'author' => 'Tô Hoài', 'slug' => 'de-men-plk',
    ]);
    BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0101', 'state' => 'available']);
    $out = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0102', 'state' => 'on_loan']);
    BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0103', 'state' => 'lost']);
    $loan = Loan::query()->create([
        'bookshelf_id' => $shelf->id, 'copy_id' => $out->id, 'book_id' => $book->id,
        'borrower_id' => $reader1->id, 'lent_by' => $manager->id,
        'due_on' => '2026-09-04', 'status' => 'active',
    ]);
    app(TenantContext::class)->set($shelf, $managerMembership);
    test()->actingAs($manager);

    return [$shelf, $manager, $m1, $m2, $book, $loan];
}

it('finds a book without diacritics and reports honest counts', function () {
    lqFix();
    $rows = app(SearchBooksForLendingQuery::class)->run('de men');

    expect($rows)->toHaveCount(1)
        ->and($rows[0]['title'])->toBe('Dế Mèn Phiêu Lưu Ký')
        ->and($rows[0]['copiesTotal'])->toBe(2)      // lost excluded — "N bản trong tủ" must not count a book that is not there
        ->and($rows[0]['copiesAvailable'])->toBe(1)
        ->and($rows[0]['blocked'])->toBeFalse()
        ->and($rows[0]['reason'])->toBeNull();
});

it('a book is findable by a copy code, without collapsing its counts', function () {
    // The exists-not-filter shape: matching by ONE copy's code must not
    // narrow the aggregates to that copy (the reference's own fix — a
    // code-matched book once reported copiesTotal 1 regardless of reality).
    lqFix();
    $rows = app(SearchBooksForLendingQuery::class)->run('dt-0102');

    expect($rows)->toHaveCount(1)
        ->and($rows[0]['copiesTotal'])->toBe(2)
        ->and($rows[0]['copiesAvailable'])->toBe(1);
});

it('the book search\'s block reason is the code LendCopy throws, in every copy state', function () {
    [$shelf] = lqFix();
    app(TenantContext::class)->actSystemWide();

    // All copies out → copy_not_available (a copy can still come back).
    $allOut = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Hoàng Tử Bé', 'slug' => 'htb-lq']);
    BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $allOut->id, 'code' => 'DT-0110', 'state' => 'on_loan']);

    // Every copy lost or retired → copy_lost_or_retired (nothing can come back).
    $allGone = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Totto-chan Bên Cửa Sổ', 'slug' => 'ttc-lq']);
    BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $allGone->id, 'code' => 'DT-0111', 'state' => 'lost']);
    BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $allGone->id, 'code' => 'DT-0112', 'state' => 'retired']);

    // No copies recorded at all → copy_not_available (the ported defect,
    // open question 4: nothing about it is lost, and there is no third code).
    Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Sách Chưa Có Bản Nào', 'slug' => 'chua-co-lq']);

    app(TenantContext::class)->set($shelf->fresh(), Membership::query()->where('role', 'manager')->firstOrFail());

    $q = app(SearchBooksForLendingQuery::class);
    $out = $q->run('hoang tu be');
    $gone = $q->run('totto chan');
    $none = $q->run('sach chua co ban nao');

    expect($out[0]['blocked'])->toBeTrue()->and($out[0]['reason'])->toBe('copy_not_available')
        ->and($gone[0]['blocked'])->toBeTrue()->and($gone[0]['reason'])->toBe('copy_lost_or_retired')
        ->and($none[0]['blocked'])->toBeTrue()->and($none[0]['reason'])->toBe('copy_not_available');
});

it('the reader search returns a blocked reader WITH the code LendCopy throws — never filters them out', function () {
    lqFix();
    $rows = app(SearchReadersForLendingQuery::class)->run('dang');

    // Both Đặng readers, folded match; suspended one flagged, not missing.
    expect($rows)->toHaveCount(2);
    $byName = collect($rows)->keyBy('fullName');
    expect($byName['Têrêsa Đặng Ngọc Ánh']['blocked'])->toBeFalse()
        ->and($byName['Têrêsa Đặng Ngọc Ánh']['activeLoans'])->toBe(1)
        ->and($byName['Anna Đặng Thu Hà']['blocked'])->toBeTrue()
        ->and($byName['Anna Đặng Thu Hà']['reason'])->toBe('membership_not_active');
});

it('a reader at the shelf\'s own limit reads loan_limit_reached', function () {
    [$shelf, $manager, $m1] = lqFix(slug: 'dong-thap-lq-limit');
    app(TenantContext::class)->actSystemWide();
    $book2 = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Đất Rừng Phương Nam', 'slug' => 'drpn-lq']);
    foreach ([1, 2] as $i) { // reader1 already holds 1 → total 3 = default limit
        $c = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book2->id, 'code' => sprintf('DT-02%02d', $i), 'state' => 'on_loan']);
        Loan::query()->create([
            'bookshelf_id' => $shelf->id, 'copy_id' => $c->id, 'book_id' => $book2->id,
            'borrower_id' => $m1->user_id, 'lent_by' => $manager->id,
            'due_on' => '2026-09-04', 'status' => 'active',
        ]);
    }
    app(TenantContext::class)->set($shelf->fresh(), Membership::query()->where('role', 'manager')->firstOrFail());

    $rows = app(SearchReadersForLendingQuery::class)->run('ngoc anh');
    expect($rows)->toHaveCount(1)
        ->and($rows[0]['activeLoans'])->toBe(3)
        ->and($rows[0]['reason'])->toBe('loan_limit_reached');
});

it('a loan out is findable by title, by reader and by the code on the copy', function () {
    lqFix();
    $q = app(SearchLoansForReturnQuery::class);

    foreach (['de men', 'ngoc anh', 'dt-0102'] as $needle) {
        $rows = $q->run($needle);
        expect($rows)->toHaveCount(1, "needle: {$needle}")
            ->and($rows[0]['copyCode'])->toBe('DT-0102')
            ->and($rows[0]['borrowerName'])->toBe('Têrêsa Đặng Ngọc Ánh');
    }
});

it('a loan already received back is not offered again', function () {
    [, , , , , $loan] = lqFix();
    Loan::query()->whereKey($loan->id)->update([
        'status' => 'returned', 'return_condition' => 'perfect', 'returned_at' => now(),
    ]);

    expect(app(SearchLoansForReturnQuery::class)->run('de men'))->toBe([]);
});

it('overdue is derived on read and moves with the clock, with no command in between', function () {
    lqFix();

    Carbon::setTestNow(Carbon::parse('2026-09-03 03:00:00', 'UTC'));
    $before = app(SearchLoansForReturnQuery::class)->run('de men');
    Carbon::setTestNow(Carbon::parse('2026-09-06 03:00:00', 'UTC'));
    $after = app(SearchLoansForReturnQuery::class)->run('de men');

    expect($before[0]['isOverdue'])->toBeFalse()
        ->and($before[0]['daysRemaining'])->toBe(1)
        ->and($after[0]['isOverdue'])->toBeTrue()
        ->and($after[0]['daysRemaining'])->toBe(-2);
});

it('M7: a garbage query returns nothing, not every row on the shelf', function () {
    lqFix();
    foreach (['', '   ', '%%%', '!!!'] as $garbage) {
        expect(app(SearchBooksForLendingQuery::class)->run($garbage))->toBe([], "books: '{$garbage}'")
            ->and(app(SearchReadersForLendingQuery::class)->run($garbage))->toBe([], "readers: '{$garbage}'")
            ->and(app(SearchLoansForReturnQuery::class)->run($garbage))->toBe([], "loans: '{$garbage}'");
    }
});

it('INV-10: a manager of one shelf finds none of another shelf\'s loans', function () {
    lqFix();
    // Second shelf with colliding data, the actSystemWide template.
    app(TenantContext::class)->actSystemWide();
    $other = Bookshelf::factory()->create(['slug' => 'can-tho-lq', 'settings' => []]);
    $otherUser = User::factory()->create(['full_name' => 'Têrêsa Đặng Ngọc Ánh']); // colliding name
    $otherBook = Book::query()->create(['bookshelf_id' => $other->id, 'title' => 'Dế Mèn Phiêu Lưu Ký', 'slug' => 'de-men-plk']);
    $otherCopy = BookCopy::query()->create(['bookshelf_id' => $other->id, 'book_id' => $otherBook->id, 'code' => 'DT-0102', 'state' => 'on_loan']);
    Loan::query()->create([
        'bookshelf_id' => $other->id, 'copy_id' => $otherCopy->id, 'book_id' => $otherBook->id,
        'borrower_id' => $otherUser->id, 'lent_by' => $otherUser->id,
        'due_on' => '2026-09-04', 'status' => 'active',
    ]);
    // Re-bind shelf A — the query must see exactly ONE loan, its own.
    $shelfA = Bookshelf::query()->where('slug', 'dong-thap-lq')->firstOrFail();
    app(TenantContext::class)->set($shelfA, Membership::query()->where('bookshelf_id', $shelfA->id)->where('role', 'manager')->firstOrFail());

    expect(app(SearchLoansForReturnQuery::class)->run('de men'))->toHaveCount(1);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `make test FILTER=LendingQueriesTest`
Expected: FAIL — classes not found.

- [ ] **Step 3: Implement the three query classes**

Create `app/Queries/SearchBooksForLendingQuery.php`:

```php
<?php

namespace App\Queries;

use App\Enums\CopyState;
use App\Models\Book;
use App\Queries\Concerns\CountsCopies;
use App\Support\Catalogue\CopyCodes;
use App\Support\Fold;
use Illuminate\Database\Eloquent\Builder;

/**
 * Quick-lend step 1 — port of search-books-for-lending.ts. Drafts are
 * included (a manager may lend an unannounced title); the blocked flag
 * carries the SAME code LendCopy throws, so the screen refuses before the
 * confirm step for the reason the command would refuse after it (BR §16.3).
 *
 * The reason mapping is the aggregate's honest translation of the per-copy
 * rule: copy_lost_or_retired only when copies are recorded and NONE can
 * come back (available/on_loan/held all count as returnable);
 * copy_not_available otherwise — including the no-copies-at-all title,
 * the reference's own documented defect kept for step-1/step-3 agreement
 * (plan open question 4).
 *
 * The copy-code branch matches with an EXISTS, never a WHERE on the
 * aggregate join: narrowing the counted rows by the matched code would
 * report copiesTotal 1 for a three-copy book (the reference's T27 fix).
 */
final class SearchBooksForLendingQuery
{
    use CountsCopies;

    /** @return list<array<string, mixed>> */
    public function run(string $q): array
    {
        $folded = Fold::fold($q);
        if ($folded === '') {
            return [];
        }
        $code = CopyCodes::escapeLike(trim($q));

        $books = $this->withCopyCounts(Book::query())
            ->withCount([
                'copies as copies_returnable' => fn (Builder $b) => $b->whereIn('state', [CopyState::Available, CopyState::OnLoan, CopyState::Held]),
                'copies as copies_recorded' => fn (Builder $b) => $b,
            ])
            ->where(fn (Builder $w) => $w
                ->where('title_folded', 'like', '%'.$folded.'%')
                ->orWhere('author_folded', 'like', '%'.$folded.'%')
                ->orWhereHas('copies', fn (Builder $c) => $c->where('code', 'like', '%'.$code.'%')))
            ->orderBy('title_folded')->orderBy('slug')
            ->get();

        return $books->map(function (Book $book): array {
            $available = (int) $book->getAttribute('available_count');
            $returnable = (int) $book->getAttribute('copies_returnable');
            $recorded = (int) $book->getAttribute('copies_recorded');
            $blocked = $available === 0;

            return [
                'bookId' => $book->id,
                'slug' => $book->slug,
                'title' => $book->title,
                'author' => $book->author,
                'coverUrl' => $book->cover_url,
                'copiesTotal' => (int) $book->getAttribute('copies_total'),
                'copiesAvailable' => $available,
                'blocked' => $blocked,
                'reason' => ! $blocked ? null
                    : ($returnable === 0 && $recorded > 0 ? 'copy_lost_or_retired' : 'copy_not_available'),
            ];
        })->values()->all();
    }
}
```

Create `app/Queries/SearchReadersForLendingQuery.php`:

```php
<?php

namespace App\Queries;

use App\Enums\LoanStatus;
use App\Models\Loan;
use App\Models\Membership;
use App\Support\Circulation\LendingSettings;
use App\Support\Circulation\LoanRules;
use App\Support\Fold;
use App\Support\Members\ParishUnits;
use App\Support\TenantContext;

/**
 * Quick-lend step 2 — port of search-readers-for-lending.ts. Never filters
 * a blocked reader out: a silently missing row sends the volunteer
 * searching again; a row saying "Tài khoản đang tạm khoá" tells them what
 * to do. The block is LoanRules::memberMayBorrow's — the ONE predicate
 * LendCopy applies, so the row carries the very code the command throws
 * (lending-queries.test.ts pins exactly this agreement).
 *
 * The count is per shelf via BookshelfScope on Loan, INV-5's own scoping.
 */
final class SearchReadersForLendingQuery
{
    public function __construct(
        private TenantContext $tenant,
        private ParishContextQuery $parishContext,
    ) {}

    /** @return list<array<string, mixed>> */
    public function run(string $q): array
    {
        $folded = Fold::fold($q);
        if ($folded === '') {
            return [];
        }

        $shelf = $this->tenant->bookshelf();
        if ($shelf === null) {
            return [];
        }
        $settings = LendingSettings::fromShelf($shelf);
        $context = $this->parishContext->run();

        $memberships = Membership::query()
            ->join('users', 'users.id', '=', 'memberships.user_id')
            ->whereNull('users.deleted_at')
            ->where('users.full_name_folded', 'like', '%'.$folded.'%')
            ->orderBy('users.full_name_folded')->orderBy('memberships.id')
            ->select('memberships.*', 'users.full_name', 'users.saint_name')
            ->get();

        $counts = Loan::query()
            ->whereIn('borrower_id', $memberships->pluck('user_id'))
            ->where('status', LoanStatus::Active)
            ->selectRaw('borrower_id, count(*) as n')
            ->groupBy('borrower_id')
            ->pluck('n', 'borrower_id');

        return $memberships->map(function (Membership $m) use ($counts, $settings, $context): array {
            $activeLoans = (int) ($counts[$m->user_id] ?? 0);
            $reason = LoanRules::memberMayBorrow($m->status, $activeLoans, $settings->maxConcurrentLoans);

            return [
                'membershipId' => $m->id,
                'userId' => $m->user_id,
                'fullName' => (string) $m->getAttribute('full_name'),
                'saintName' => $m->getAttribute('saint_name'),
                'parishLine' => ParishUnits::describeSelection(
                    $context['taxonomy'], $context['units'],
                    $m->parish_unit_l1_id, $m->parish_unit_l2_id,
                ),
                'activeLoans' => $activeLoans,
                'blocked' => $reason !== null,
                'reason' => $reason,
            ];
        })->values()->all();
    }
}
```

**Adjust the two 1b call shapes to what actually shipped** before finalising: `ParishContextQuery::run()`'s exact return array and `ParishUnits::describeSelection`'s exact parameter list are 1b's — read `app/Queries/ParishContextQuery.php` and `app/Support/Members/ParishUnits.php` and call them as they are (the roster query `ReadersListQuery` already composes the pair; mirror its usage verbatim rather than this sketch if they differ).

Create `app/Queries/SearchLoansForReturnQuery.php`:

```php
<?php

namespace App\Queries;

use App\Enums\LoanStatus;
use App\Models\Loan;
use App\Support\Catalogue\CopyCodes;
use App\Support\Circulation\LoanTerms;
use App\Support\Clock;
use App\Support\Fold;
use Illuminate\Database\Eloquent\Builder;

/**
 * Return step 1 — port of search-loans-for-return.ts. Three search keys:
 * title, borrower name, and the code printed on the copy in the
 * volunteer's hand — the key the shelf actually uses (a title matches as
 * many rows as copies out; the code matches exactly one).
 *
 * Active rows only: the explicit filter is what makes this "out right
 * now", and what keeps an already-returned loan off the screen so a
 * double submit cannot be aimed at it (the command refuses one anyway —
 * this is the screen not offering what the command would refuse).
 *
 * The borrower's name joins users directly, never memberships: a reader
 * who has since left still holds the book, and that is exactly the loan a
 * manager most needs to find. isOverdue/daysRemaining come from LoanTerms
 * (BR §8's one home), so a fixed clock moves both with no write.
 */
final class SearchLoansForReturnQuery
{
    public function __construct(private Clock $clock) {}

    /** @return list<array<string, mixed>> */
    public function run(string $q): array
    {
        $folded = Fold::fold($q);
        if ($folded === '') {
            return [];
        }
        $code = CopyCodes::escapeLike(trim($q));
        $today = $this->clock->today();

        $loans = Loan::query()
            ->where('status', LoanStatus::Active)
            ->join('books', 'books.id', '=', 'loans.book_id')
            ->join('book_copies', 'book_copies.id', '=', 'loans.copy_id')
            ->join('users', 'users.id', '=', 'loans.borrower_id')
            ->where(fn (Builder $w) => $w
                ->where('books.title_folded', 'like', '%'.$folded.'%')
                ->orWhere('users.full_name_folded', 'like', '%'.$folded.'%')
                ->orWhere('book_copies.code', 'like', '%'.$code.'%'))
            ->orderBy('loans.due_on')->orderBy('loans.id')
            ->select('loans.*', 'books.title', 'books.cover_url', 'book_copies.code as copy_code', 'users.full_name as borrower_name')
            ->get();

        return $loans->map(function (Loan $loan) use ($today): array {
            $dueOn = $loan->due_on->toDateString();

            return [
                'loanId' => $loan->id,
                'copyId' => $loan->copy_id,
                'copyCode' => (string) $loan->getAttribute('copy_code'),
                'bookId' => $loan->book_id,
                'title' => (string) $loan->getAttribute('title'),
                'coverUrl' => $loan->getAttribute('cover_url'),
                'borrowerUserId' => $loan->borrower_id,
                'borrowerName' => (string) $loan->getAttribute('borrower_name'),
                'dueOn' => $dueOn,
                'isOverdue' => LoanTerms::isOverdue($dueOn, $today),
                'daysRemaining' => LoanTerms::daysRemaining($dueOn, $today),
            ];
        })->values()->all();
    }
}
```

Note the joins carry no tenant predicate — `Loan`'s `BookshelfScope` filters the base table, and `books`/`book_copies`/`users` rows are reached only through this shelf's loans' FKs (the composite tenant FKs make a cross-shelf reference unstorable). This is the same reach 1b's holding-count query makes; `TenancyArchitectureTest`'s grep stays clean because no hand-written `bookshelf_id` appears.

- [ ] **Step 4: Run the tests, verify they pass**

Run: `make test FILTER=LendingQueriesTest`
Expected: PASS.

- [ ] **Step 5: Lint, analyse, commit**

```bash
make lint && make analyse
git add app/Queries/SearchBooksForLendingQuery.php app/Queries/SearchReadersForLendingQuery.php app/Queries/SearchLoansForReturnQuery.php tests/Feature/Circulation/LendingQueriesTest.php
git commit -m "feat: the three lending searches, block reasons shared with the command"
```

---

### Task 8: `OverdueLoansQuery` — who is late, sorted by how late, with a phone number

Read first: `old_next/src/domain/circulation/queries/get-overdue-loans.ts` and `old_next/tests/domain/circulation/overdue-loans.test.ts`.

**Files:**
- Create: `app/Queries/OverdueLoansQuery.php`
- Test: `tests/Feature/Circulation/OverdueLoansQueryTest.php`

**Interfaces:**
- Consumes: `LoanTerms::isOverdue`/`daysRemaining`, `Clock::today()`, `Fold` (borrower sort).
- Produces: `OverdueLoansQuery::run(string $sort = 'most-late'): list<array{loanId: string, copyId: string, copyCode: string, bookId: string, title: string, coverUrl: ?string, borrowerUserId: string, borrowerName: string, borrowerPhone: ?string, dueOn: string, daysLate: int}>` — sorts `most-late` (default, `due_on` asc), `least-late` (`due_on` desc), `borrower` (`full_name_folded` asc); tiebreak `loans.id` always. **Unpaged**, the reference's decision: the set is bounded by its own state, and a parish with two hundred overdue loans has a problem no pagination control addresses.

- [ ] **Step 1: Write the failing tests**

Create `tests/Feature/Circulation/OverdueLoansQueryTest.php`:

```php
<?php

use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\User;
use App\Queries\OverdueLoansQuery;
use App\Support\TenantContext;
use Carbon\Carbon;

afterEach(fn () => Carbon::setTestNow());

/**
 * Manager (acting) + three overdue loans seeded in NEITHER most-late nor
 * name order (UUIDv7 trap: creation order must differ from every asserted
 * order), plus one on-time, one returned-late and one lost loan.
 * Borrower names force the folded sort to differ from byte order (Đặng).
 *
 * @return Bookshelf
 */
function odFix(string $slug = 'dong-thap-od'): Bookshelf
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);
    $manager = User::factory()->create(['full_name' => 'Maria Gọi Điện Nhắc']);
    $managerMembership = Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);
    $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Hoàng Tử Bé', 'slug' => 'htb-od']);

    $seed = [
        // [code, name, phone, due_on, status] — seeded mid-late first, so
        // neither most-late (0403 first) nor name order equals creation order.
        ['DT-0301', 'Vũ Văn Sáu Muộn', '0912000001', '2026-08-10', 'active'],
        ['DT-0302', 'Đặng Thị Bảy Muộn', null, '2026-08-20', 'active'],
        ['DT-0303', 'An Văn Tám Muộn', '0912000003', '2026-08-01', 'active'],
        ['DT-0304', 'Gioan Đúng Hạn', '0912000004', '2026-09-20', 'active'],
        ['DT-0305', 'Phaolô Trả Muộn Rồi', '0912000005', '2026-08-01', 'returned'],
        ['DT-0306', 'Đaminh Làm Mất Sách', '0912000006', '2026-08-01', 'lost'],
    ];
    foreach ($seed as [$code, $name, $phone, $due, $status]) {
        $u = User::factory()->create(['full_name' => $name, 'phone' => $phone]);
        $c = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => $code, 'state' => $status === 'active' ? 'on_loan' : 'available']);
        Loan::query()->create(array_merge([
            'bookshelf_id' => $shelf->id, 'copy_id' => $c->id, 'book_id' => $book->id,
            'borrower_id' => $u->id, 'lent_by' => $manager->id,
            'due_on' => $due, 'status' => $status,
        ], $status === 'returned' ? ['returned_at' => now(), 'return_condition' => 'perfect'] : [],
            $status === 'lost' ? ['lost_reported_at' => now()] : []));
    }
    app(TenantContext::class)->set($shelf, $managerMembership);
    test()->actingAs($manager);

    return $shelf;
}

it('a loan becomes overdue when the clock moves, with no write and no job', function () {
    odFix();

    Carbon::setTestNow(Carbon::parse('2026-08-05 03:00:00', 'UTC'));
    $early = app(OverdueLoansQuery::class)->run();
    Carbon::setTestNow(Carbon::parse('2026-08-25 03:00:00', 'UTC'));
    $later = app(OverdueLoansQuery::class)->run();

    expect(collect($early)->pluck('copyCode')->all())->toBe(['DT-0303'])
        ->and(collect($later)->pluck('copyCode')->all())->toBe(['DT-0303', 'DT-0301', 'DT-0302']);
});

it('days late keeps counting up as the clock moves further', function () {
    odFix(slug: 'dong-thap-od-days');
    Carbon::setTestNow(Carbon::parse('2026-08-25 03:00:00', 'UTC'));
    $rows = app(OverdueLoansQuery::class)->run();
    $mostLate = $rows[0];
    expect($mostLate['dueOn'])->toBe('2026-08-01')->and($mostLate['daysLate'])->toBe(24);

    Carbon::setTestNow(Carbon::parse('2026-08-30 03:00:00', 'UTC'));
    expect(app(OverdueLoansQuery::class)->run()[0]['daysLate'])->toBe(29);
});

it('a returned loan is never overdue however late it was, and a lost loan has its own screen', function () {
    odFix(slug: 'dong-thap-od-closed');
    Carbon::setTestNow(Carbon::parse('2026-09-01 03:00:00', 'UTC'));
    $codes = collect(app(OverdueLoansQuery::class)->run())->pluck('copyCode');

    // The three not->toContain assertions below all pass vacuously on an
    // EMPTY collection — the exact shape known-gaps warns about — so the
    // positive assertion comes first and is what makes them mean anything
    // (review fix).
    expect($codes->all())->toBe(['DT-0303', 'DT-0301', 'DT-0302'])
        ->and($codes)->not->toContain('DT-0305')
        ->and($codes)->not->toContain('DT-0306')
        ->and($codes)->not->toContain('DT-0304');
});

it('the phone is on the row — it is the point of the screen — and its absence is null, not omission', function () {
    odFix(slug: 'dong-thap-od-phone');
    Carbon::setTestNow(Carbon::parse('2026-08-25 03:00:00', 'UTC'));
    $rows = collect(app(OverdueLoansQuery::class)->run())->keyBy('copyCode');

    expect($rows['DT-0301']['borrowerPhone'])->toBe('0912000001')
        ->and(array_key_exists('borrowerPhone', $rows['DT-0302']))->toBeTrue()
        ->and($rows['DT-0302']['borrowerPhone'])->toBeNull();
});

it('most-late is the default, least-late reverses, borrower folds the name so Đặng is not last', function () {
    odFix(slug: 'dong-thap-od-sort');
    Carbon::setTestNow(Carbon::parse('2026-08-25 03:00:00', 'UTC'));
    $q = app(OverdueLoansQuery::class);

    expect(collect($q->run())->pluck('copyCode')->all())->toBe(['DT-0303', 'DT-0301', 'DT-0302'])
        ->and(collect($q->run('least-late'))->pluck('copyCode')->all())->toBe(['DT-0302', 'DT-0301', 'DT-0303'])
        // Folded: An, Đặng(→dang), Vũ(→vu). Byte order would put Đặng LAST.
        ->and(collect($q->run('borrower'))->pluck('borrowerName')->all())
        ->toBe(['An Văn Tám Muộn', 'Đặng Thị Bảy Muộn', 'Vũ Văn Sáu Muộn']);
});

it('equally late loans are ordered by a key that cannot tie — the ORDER BY is pinned', function () {
    // The tiebreak is loans.id, a UUIDv7 that always equals creation order —
    // a data assertion cannot falsify it (known-gaps, fired four times).
    // Pin the mechanism instead.
    odFix(slug: 'dong-thap-od-tie');
    \Illuminate\Support\Facades\DB::flushQueryLog();
    \Illuminate\Support\Facades\DB::enableQueryLog();
    app(OverdueLoansQuery::class)->run();
    $log = \Illuminate\Support\Facades\DB::getQueryLog();
    \Illuminate\Support\Facades\DB::disableQueryLog();

    $main = collect($log)->first(fn ($q) => str_contains($q['query'], 'order by'));
    expect($main)->not->toBeNull()
        ->and(str_contains($main['query'], '`loans`.`id`'))->toBeTrue('no id tiebreak: '.$main['query']);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `make test FILTER=OverdueLoansQueryTest`
Expected: FAIL — class not found.

- [ ] **Step 3: Implement**

Create `app/Queries/OverdueLoansQuery.php`:

```php
<?php

namespace App\Queries;

use App\Enums\LoanStatus;
use App\Models\Loan;
use App\Support\Circulation\LoanTerms;
use App\Support\Clock;

/**
 * OPS §3.3's GetOverdueLoans — port of get-overdue-loans.ts. The phone
 * number is the actual mechanism by which books come back (BR §16.3), so
 * it rides every row, null when absent rather than omitted.
 *
 * Overdue is LoanTerms::isOverdue against Clock::today() — derived on
 * read, never stored (BR §8): the where clause below compares due_on to
 * today's DATE, so the set moves at midnight Asia/Ho_Chi_Minh with no job
 * running. Only active loans: a returned loan was late once, not overdue;
 * a lost loan has its own screen (the 1a lost-copies view).
 *
 * Unpaged, deliberately — the set is bounded by its own state (the
 * reference's argument, kept), and the order is total so paging later is
 * two lines, not a re-derivation.
 */
final class OverdueLoansQuery
{
    public function __construct(private Clock $clock) {}

    /** @return list<array<string, mixed>> */
    public function run(string $sort = 'most-late'): array
    {
        $today = $this->clock->today();

        $query = Loan::query()
            ->where('status', LoanStatus::Active)
            // Plain `where`, not `whereDate`: due_on IS a DATE column, so
            // whereDate would wrap it in DATE(due_on) and make the
            // loans_active_by_shelf (bookshelf_id, due_on) index unusable
            // for nothing (review fix). Bare `<` against a Y-m-d string is
            // also literally LoanTerms::isOverdue's comparison, which is
            // the "one definition of overdue" this class claims.
            ->where('loans.due_on', '<', $today)
            ->join('books', 'books.id', '=', 'loans.book_id')
            ->join('book_copies', 'book_copies.id', '=', 'loans.copy_id')
            ->join('users', 'users.id', '=', 'loans.borrower_id')
            ->select('loans.*', 'books.title', 'books.cover_url',
                'book_copies.code as copy_code',
                'users.full_name as borrower_name', 'users.phone as borrower_phone',
                'users.full_name_folded as borrower_name_folded');

        match ($sort) {
            'least-late' => $query->orderByDesc('loans.due_on'),
            'borrower' => $query->orderBy('borrower_name_folded'),
            default => $query->orderBy('loans.due_on'),
        };
        $query->orderBy('loans.id');

        return $query->get()->map(function (Loan $loan) use ($today): array {
            $dueOn = $loan->due_on->toDateString();

            return [
                'loanId' => $loan->id,
                'copyId' => $loan->copy_id,
                'copyCode' => (string) $loan->getAttribute('copy_code'),
                'bookId' => $loan->book_id,
                'title' => (string) $loan->getAttribute('title'),
                'coverUrl' => $loan->getAttribute('cover_url'),
                'borrowerUserId' => $loan->borrower_id,
                'borrowerName' => (string) $loan->getAttribute('borrower_name'),
                'borrowerPhone' => $loan->getAttribute('borrower_phone'),
                'dueOn' => $dueOn,
                'daysLate' => -LoanTerms::daysRemaining($dueOn, $today),
            ];
        })->values()->all();
    }
}
```

(`where('loans.due_on', '<', $today)` compares the DATE column against the `Y-m-d` string — literally `LoanTerms::isOverdue`'s comparison, one definition of overdue — and the `daysLate` mapping negates `daysRemaining` rather than subtracting dates a second way, the reference's own no-second-definition rule. The column is qualified because three tables are joined; `status` and `due_on` happen to be unambiguous across `loans`/`books`/`book_copies`/`users` today, but qualifying costs nothing and a future column need not stay unambiguous.)

- [ ] **Step 4: Run the tests, verify they pass**

Run: `make test FILTER=OverdueLoansQueryTest`
Expected: PASS.

- [ ] **Step 5: Lint, analyse, commit**

```bash
make lint && make analyse
git add app/Queries/OverdueLoansQuery.php tests/Feature/Circulation/OverdueLoansQueryTest.php
git commit -m "feat: overdue loans query — derived on read, phone on every row"
```

---

### Task 9: `MyDashboardQuery` and `MyLoanHistoryQuery` — the reader's own view

Read first: `old_next/src/domain/circulation/queries/get-my-dashboard.ts` (the loans half; the requests half is Phase 2's) and `old_next/tests/domain/circulation/my-dashboard.test.ts` (tests 1–3, 5 and the history test — the queue-position tests are Phase 2's).

**Files:**
- Create: `app/Queries/MyDashboardQuery.php`
- Create: `app/Queries/MyLoanHistoryQuery.php`
- Test: `tests/Feature/Circulation/MyDashboardQueryTest.php`

**Interfaces:**
- Consumes: `LoanRules::loanRenewable`, `LendingSettings`, `LoanTerms`, `Clock`, `App\Enums\RequestStatus`.
- Produces:
  - `MyDashboardQuery::run(User $reader): array{loans: list<array{loanId: string, bookId: string, slug: string, title: string, coverUrl: ?string, copyCode: string, dueOn: string, isOverdue: bool, daysRemaining: int, renewalsUsed: int, renewBlockedBy: ?string}>, recentlyReturned: list<array{loanId: string, title: string, slug: string, returnedOn: string, returnCondition: string}>}` — `renewBlockedBy` is `null` when the button works, else exactly the code `RenewLoan` throws (`no_renewals_remaining` | `title_has_queue`); `recentlyReturned` is the five latest returned loans.
  - `MyLoanHistoryQuery::run(User $reader, int $page = 1): array{rows: list<array{loanId: string, title: string, slug: string, copyCode: string, lentOn: string, dueOn: string, status: string, returnedOn: ?string, returnCondition: ?string}>, page: int, pageCount: int, total: int}` — reverse-chronological by `lent_at`, id tiebreak, 20 per page.

- [ ] **Step 1: Write the failing tests**

Create `tests/Feature/Circulation/MyDashboardQueryTest.php`:

```php
<?php

use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\BorrowRequest;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\User;
use App\Queries\MyDashboardQuery;
use App\Queries\MyLoanHistoryQuery;
use App\Support\TenantContext;
use Carbon\Carbon;

afterEach(fn () => Carbon::setTestNow());

/**
 * A reader (acting) with one active loan due 2026-09-04 (0 renewals used)
 * and one returned loan, plus ANOTHER reader's active loan that must never
 * appear.
 *
 * @return array{Bookshelf, User, Loan, Book}
 */
function mydFix(array $shelfSettings = [], string $slug = 'dong-thap-myd'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => $shelfSettings]);
    $manager = User::factory()->create(['full_name' => 'Maria Trực Tủ Sách']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);
    $reader = User::factory()->create(['full_name' => 'Têrêsa Xem Trang Mình']);
    $readerMembership = Membership::factory()->for($shelf)->create([
        'user_id' => $reader->id, 'role' => 'reader', 'status' => 'active',
    ]);
    $other = User::factory()->create(['full_name' => 'Gioan Người Bên Cạnh']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $other->id, 'role' => 'reader', 'status' => 'active',
    ]);
    $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Dế Mèn Phiêu Lưu Ký', 'slug' => 'de-men-myd']);
    $c1 = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0401', 'state' => 'on_loan']);
    $c2 = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0402', 'state' => 'available']);
    $c3 = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0403', 'state' => 'on_loan']);
    // ORDER MATTERS (review fix): the RETURNED loan is created FIRST and the
    // ACTIVE one SECOND, so creation order — and the monotonic UUIDv7 id
    // order with it — is the OPPOSITE of the reverse-chronological order the
    // history test asserts. Seeded the other way round (as drafted) that
    // test passed with no ORDER BY at all.
    Loan::query()->create([
        'bookshelf_id' => $shelf->id, 'copy_id' => $c2->id, 'book_id' => $book->id,
        'borrower_id' => $reader->id, 'lent_by' => $manager->id,
        'lent_at' => '2026-08-01 03:00:00', 'due_on' => '2026-08-15', 'status' => 'returned',
        'returned_at' => '2026-08-14 08:00:00', 'received_by' => $manager->id, 'return_condition' => 'slightly_worn',
    ]);
    $loan = Loan::query()->create([
        'bookshelf_id' => $shelf->id, 'copy_id' => $c1->id, 'book_id' => $book->id,
        'borrower_id' => $reader->id, 'lent_by' => $manager->id,
        'lent_at' => '2026-08-21 03:00:00', 'due_on' => '2026-09-04', 'status' => 'active',
    ]);
    Loan::query()->create([
        'bookshelf_id' => $shelf->id, 'copy_id' => $c3->id, 'book_id' => $book->id,
        'borrower_id' => $other->id, 'lent_by' => $manager->id,
        'due_on' => '2026-09-04', 'status' => 'active',
    ]);
    app(TenantContext::class)->set($shelf, $readerMembership);
    test()->actingAs($reader);

    return [$shelf, $reader, $loan, $book];
}

it('a reader sees their own loan with days remaining, and only their own', function () {
    Carbon::setTestNow(Carbon::parse('2026-09-01 03:00:00', 'UTC'));
    [, $reader] = mydFix();

    $dash = app(MyDashboardQuery::class)->run($reader);

    expect($dash['loans'])->toHaveCount(1)
        ->and($dash['loans'][0]['copyCode'])->toBe('DT-0401')
        ->and($dash['loans'][0]['daysRemaining'])->toBe(3)
        ->and($dash['loans'][0]['isOverdue'])->toBeFalse()
        ->and($dash['loans'][0]['renewBlockedBy'])->toBeNull()
        ->and($dash['recentlyReturned'])->toHaveCount(1)
        ->and($dash['recentlyReturned'][0]['returnCondition'])->toBe('slightly_worn');
});

it('overdue and days remaining follow the clock, with no write', function () {
    [, $reader] = mydFix(slug: 'dong-thap-myd-clock');

    Carbon::setTestNow(Carbon::parse('2026-09-08 03:00:00', 'UTC'));
    $dash = app(MyDashboardQuery::class)->run($reader);

    expect($dash['loans'][0]['isOverdue'])->toBeTrue()
        ->and($dash['loans'][0]['daysRemaining'])->toBe(-4);
});

it('the renew refusal is the code RenewLoan throws — not a literal', function () {
    // max_renewals 0: even the first renewal is refused.
    [, $reader] = mydFix(['max_renewals' => 0], slug: 'dong-thap-myd-cap');

    $dash = app(MyDashboardQuery::class)->run($reader);
    expect($dash['loans'][0]['renewBlockedBy'])->toBe('no_renewals_remaining');
});

it('somebody queued for the title blocks renewal, and the screen says which reason', function () {
    [$shelf, $reader, , $book] = mydFix(slug: 'dong-thap-myd-q');
    app(TenantContext::class)->actSystemWide();
    $waiting = User::factory()->create(['full_name' => 'Anna Chờ Dế Mèn']);
    BorrowRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $book->id,
        'member_id' => $waiting->id, 'status' => 'pending',
    ]);
    app(TenantContext::class)->set($shelf->fresh(), Membership::query()->where('user_id', $reader->id)->firstOrFail());

    $dash = app(MyDashboardQuery::class)->run($reader);
    expect($dash['loans'][0]['renewBlockedBy'])->toBe('title_has_queue');
});

it('history keeps a returned loan and says how it came back, newest first', function () {
    [, $reader] = mydFix(slug: 'dong-thap-myd-hist');

    $history = app(MyLoanHistoryQuery::class)->run($reader);

    expect($history['total'])->toBe(2)
        // REVIEW FIX — the comment this replaces claimed creation order was
        // "the OPPOSITE of the asserted order". It was not: as drafted,
        // mydFix() created the 08-21 (active) loan FIRST and the 08-01
        // (returned) loan SECOND, so creation order — and therefore the
        // monotonic UUIDv7 id order — was active-then-returned, EXACTLY the
        // asserted order. Strip both orderings and an unordered scan still
        // passed. **mydFix must be edited to create the RETURNED (08-01)
        // loan first and the ACTIVE (08-21) loan second** (see the fixture
        // above), which makes creation order genuinely opposite and this
        // assertion falsifiable. lentOn is asserted too, pinning the column
        // the ordering is actually on.
        ->and(collect($history['rows'])->pluck('lentOn')->all())->toBe(['2026-08-21', '2026-08-01'])
        ->and($history['rows'][0]['status'])->toBe('active')
        ->and($history['rows'][1]['status'])->toBe('returned')
        ->and($history['rows'][1]['returnCondition'])->toBe('slightly_worn')
        ->and($history['rows'][1]['returnedOn'])->toBe('2026-08-14');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `make test FILTER=MyDashboardQueryTest`
Expected: FAIL — classes not found.

- [ ] **Step 3: Implement the two queries**

Create `app/Queries/MyDashboardQuery.php`:

```php
<?php

namespace App\Queries;

use App\Enums\LoanStatus;
use App\Enums\RequestStatus;
use App\Exceptions\RuleViolated;
use App\Models\BorrowRequest;
use App\Models\Loan;
use App\Support\Circulation\LendingSettings;
use App\Support\Circulation\LoanRules;
use App\Support\Circulation\LoanTerms;
use App\Support\Clock;
use App\Support\TenantContext;
use App\Models\User;

/**
 * The loans half of OPS §3.2's GetMyDashboard — BR §16.2's "My page".
 * renewBlockedBy is LoanRules::loanRenewable's answer, the ONE predicate
 * RenewLoan applies, so the disabled button and the command can never
 * disagree (my-dashboard.test.ts: "the renew refusal is the code renewLoan
 * throws — not a literal"). The requests half is Phase 2's; the page
 * renders an explicit empty state meanwhile (plan open question 5).
 *
 * This is the screen where a second subtraction is most tempting — the
 * due date is right there. Both derived numbers come from LoanTerms.
 */
final class MyDashboardQuery
{
    public function __construct(
        private Clock $clock,
        private TenantContext $tenant,
    ) {}

    /** @return array{loans: list<array<string, mixed>>, recentlyReturned: list<array<string, mixed>>} */
    public function run(User $reader): array
    {
        $today = $this->clock->today();
        $shelf = $this->tenant->bookshelf();
        if ($shelf === null) {
            // `use App\Exceptions\RuleViolated;` at the top and the SHORT
            // form here (review fix): RuleViolatedCodesHaveSentencesTest's
            // regex is /new RuleViolated\(\s*['"]…['"]\s*\)/ and does not
            // match a fully-qualified `new \App\Exceptions\RuleViolated(…)`,
            // so the fully-qualified spelling would silently sit outside
            // the census the whole phase depends on. Task 14 forbids
            // widening that regex; write the code so it does not need to.
            throw new RuleViolated('shelf_not_found');
        }
        $settings = LendingSettings::fromShelf($shelf);

        $active = Loan::query()
            ->where('borrower_id', $reader->id)
            ->where('status', LoanStatus::Active)
            ->join('books', 'books.id', '=', 'loans.book_id')
            ->join('book_copies', 'book_copies.id', '=', 'loans.copy_id')
            ->orderBy('loans.due_on')->orderBy('loans.id')
            ->select('loans.*', 'books.title', 'books.slug', 'books.cover_url', 'book_copies.code as copy_code')
            ->get();

        $queuedBookIds = BorrowRequest::query()
            ->whereIn('book_id', $active->pluck('book_id'))
            ->where('status', RequestStatus::Pending)
            ->pluck('book_id')->unique()->flip();

        $loans = $active->map(function (Loan $loan) use ($today, $settings, $queuedBookIds): array {
            $dueOn = $loan->due_on->toDateString();

            return [
                'loanId' => $loan->id,
                'bookId' => $loan->book_id,
                'slug' => (string) $loan->getAttribute('slug'),
                'title' => (string) $loan->getAttribute('title'),
                'coverUrl' => $loan->getAttribute('cover_url'),
                'copyCode' => (string) $loan->getAttribute('copy_code'),
                'dueOn' => $dueOn,
                'isOverdue' => LoanTerms::isOverdue($dueOn, $today),
                'daysRemaining' => LoanTerms::daysRemaining($dueOn, $today),
                'renewalsUsed' => $loan->renewals_used,
                'renewBlockedBy' => LoanRules::loanRenewable(
                    $loan->renewals_used, $settings->maxRenewals,
                    $queuedBookIds->has($loan->book_id),
                ),
            ];
        })->values()->all();

        $recentlyReturned = Loan::query()
            ->where('borrower_id', $reader->id)
            ->where('status', LoanStatus::Returned)
            ->join('books', 'books.id', '=', 'loans.book_id')
            ->orderByDesc('loans.returned_at')->orderByDesc('loans.id')
            ->limit(5)
            ->select('loans.*', 'books.title', 'books.slug')
            ->get()
            ->map(fn (Loan $loan): array => [
                'loanId' => $loan->id,
                'title' => (string) $loan->getAttribute('title'),
                'slug' => (string) $loan->getAttribute('slug'),
                'returnedOn' => $loan->returned_at?->timezone('Asia/Ho_Chi_Minh')->toDateString() ?? '',
                'returnCondition' => $loan->return_condition?->value ?? '',
            ])->values()->all();

        return ['loans' => $loans, 'recentlyReturned' => $recentlyReturned];
    }
}
```

Create `app/Queries/MyLoanHistoryQuery.php`:

```php
<?php

namespace App\Queries;

use App\Models\Loan;
use App\Models\User;

/**
 * OPS §3.2's GetMyLoanHistory: every loan the reader ever had on this
 * shelf, reverse-chronological by lent_at with the id tiebreak (a total
 * order, so pages never lose a row between them — the paging lesson U2
 * measured). The return condition rides the row: the history is where a
 * reader sees how their book came back.
 */
final class MyLoanHistoryQuery
{
    private const PER_PAGE = 20;

    /** @return array{rows: list<array<string, mixed>>, page: int, pageCount: int, total: int} */
    public function run(User $reader, int $page = 1): array
    {
        $page = max(1, $page);
        $base = Loan::query()
            ->where('borrower_id', $reader->id)
            ->join('books', 'books.id', '=', 'loans.book_id')
            ->join('book_copies', 'book_copies.id', '=', 'loans.copy_id');

        $total = (clone $base)->count();
        $rows = $base
            ->orderByDesc('loans.lent_at')->orderByDesc('loans.id')
            ->forPage($page, self::PER_PAGE)
            ->select('loans.*', 'books.title', 'books.slug', 'book_copies.code as copy_code')
            ->get()
            ->map(fn (Loan $loan): array => [
                'loanId' => $loan->id,
                'title' => (string) $loan->getAttribute('title'),
                'slug' => (string) $loan->getAttribute('slug'),
                'copyCode' => (string) $loan->getAttribute('copy_code'),
                'lentOn' => $loan->lent_at->timezone('Asia/Ho_Chi_Minh')->toDateString(),
                'dueOn' => $loan->due_on->toDateString(),
                'status' => $loan->status->value,
                'returnedOn' => $loan->returned_at?->timezone('Asia/Ho_Chi_Minh')->toDateString(),
                'returnCondition' => $loan->return_condition?->value,
            ])->values()->all();

        return [
            'rows' => $rows,
            'page' => $page,
            'pageCount' => (int) max(1, ceil($total / self::PER_PAGE)),
            'total' => $total,
        ];
    }
}
```

- [ ] **Step 4: Run the tests, verify they pass**

Run: `make test FILTER=MyDashboardQueryTest`
Expected: PASS.

- [ ] **Step 5: Lint, analyse, commit**

```bash
make lint && make analyse
git add app/Queries/MyDashboardQuery.php app/Queries/MyLoanHistoryQuery.php tests/Feature/Circulation/MyDashboardQueryTest.php
git commit -m "feat: reader dashboard and history queries, renew refusal shared with the command"
```

---
### Task 10: The quick-lend screens — three taps, routes, controller, pages

Read first: `old_next/src/app/tu-sach/[shelf]/quan-ly/cho-muon/page.tsx`, `cho-muon/nguoi-doc/page.tsx`, `cho-muon/xac-nhan/page.tsx`, and `old_next/src/lib/lending.ts` (`chooseCopyToLend`'s docblock — divergence 9's whole argument). BR §16.3 "Quick lend" and AGENTS.md's design rules (three-tap flow, 56px primary buttons, `StepIndicator` semantics, one terracotta per screen).

**Files:**
- Create: `app/Support/Circulation/ChooseCopy.php`
- Create: `app/Http/Requests/Circulation/LendCopyRequest.php`
- Create: `app/Http/Controllers/Manage/LendController.php`
- Create: `resources/js/pages/manage/lend/index.tsx`
- Create: `resources/js/pages/manage/lend/reader.tsx`
- Create: `resources/js/pages/manage/lend/confirm.tsx`
- Create: `resources/js/lib/dates.ts`
- Modify: `routes/web.php` (replace the four under-construction lend routes)
- Modify: `app/Http/Middleware/HandleInertiaRequests.php` (share `flash.success`)
- Modify: `resources/js/types/index.ts` (`SharedData` gains `flash: { success: string | null }`)
- Modify: `resources/js/lib/copy.ts` (the circulation blocks below)
- Test: `tests/Feature/Circulation/QuickLendScreensTest.php`
- Test: `tests/Unit/Circulation/ChooseCopyTest.php`

**Interfaces:**
- Consumes: `SearchBooksForLendingQuery::run`, `SearchReadersForLendingQuery::run` (Task 7 shapes), `LendCopy::execute` (Task 3), `LoanRules::memberMayBorrow`, `LendingSettings`, `LoanTerms::dueDateFor`, `QueryParam::first($request, 'key', ?default)`, `ReaderDetailQuery` (1b — the confirm screen's reader re-read).
- Produces:
  - `ChooseCopy::lowestLendable(Collection $copies): array{copy: ?BookCopy, reason: ?string}` — takes an `Illuminate\Support\Collection<int, BookCopy>` (an Eloquent collection satisfies it); first lendable copy in `code` order, or the aggregate refusal (`copy_lost_or_retired` when copies exist and none returnable, else `copy_not_available`).
  - Routes `shelves.manage.lend` (GET, `?q=`), `shelves.manage.lend.reader` (GET, `?book=&q=`), `shelves.manage.lend.confirm` (GET, `?book=&reader=`), `shelves.manage.lend.store` (POST `copy_id`, `membership_id`).
  - `flash.success` in shared props — Task 11's and 13's redirects use it too.
  - `copy.ts` circulation blocks — Tasks 11–13 extend, never rewrite.

- [ ] **Step 1: Write the failing tests**

Create `tests/Unit/Circulation/ChooseCopyTest.php`:

```php
<?php

use App\Enums\CopyState;
use App\Models\BookCopy;
use App\Support\Circulation\ChooseCopy;

function ccCopy(string $code, CopyState $state): BookCopy
{
    return new BookCopy(['code' => $code, 'state' => $state]);
}

it('picks the lowest-code lendable copy, so step 2 and step 3 name the same physical book', function () {
    $result = ChooseCopy::lowestLendable(collect([
        ccCopy('DT-0003', CopyState::Available),
        ccCopy('DT-0001', CopyState::OnLoan),
        ccCopy('DT-0002', CopyState::Available),
    ]));

    expect($result['copy']?->code)->toBe('DT-0002')
        ->and($result['reason'])->toBeNull();
});

it('every copy out reads copy_not_available; every copy gone reads copy_lost_or_retired', function () {
    $out = ChooseCopy::lowestLendable(collect([
        ccCopy('DT-0001', CopyState::OnLoan), ccCopy('DT-0002', CopyState::Held),
    ]));
    $gone = ChooseCopy::lowestLendable(collect([
        ccCopy('DT-0001', CopyState::Lost), ccCopy('DT-0002', CopyState::Retired),
    ]));

    expect($out['copy'])->toBeNull()->and($out['reason'])->toBe('copy_not_available')
        ->and($gone['copy'])->toBeNull()->and($gone['reason'])->toBe('copy_lost_or_retired');
});

it('a title with no copies keeps copy_not_available — the ported defect, pinned by name', function () {
    // Plan open question 4 / divergence 9: the sentence is wrong for this
    // case and the reference kept it so step 1 and step 3 agree. Changing
    // this is a domain change (new code + OPS entry), not a refactor.
    $result = ChooseCopy::lowestLendable(collect([]));
    expect($result['reason'])->toBe('copy_not_available');
});

it('a held copy is never auto-chosen — collecting a hold is Phase 2\'s HandoverRequest', function () {
    $result = ChooseCopy::lowestLendable(collect([ccCopy('DT-0001', CopyState::Held)]));
    expect($result['copy'])->toBeNull()->and($result['reason'])->toBe('copy_not_available');
});
```

Create `tests/Feature/Circulation/QuickLendScreensTest.php`:

```php
<?php

use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Inertia\Testing\AssertableInertia;

/**
 * @return array{Bookshelf, User, Membership, Book, BookCopy}
 */
function qlFix(string $slug = 'dong-thap-ql'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);
    $manager = User::factory()->create(['full_name' => 'Maria Ba Chạm Là Xong']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);
    $reader = User::factory()->create(['full_name' => 'Têrêsa Cầm Sách Chờ']);
    $membership = Membership::factory()->for($shelf)->create([
        'user_id' => $reader->id, 'role' => 'reader', 'status' => 'active',
    ]);
    $book = Book::query()->create([
        'bookshelf_id' => $shelf->id, 'title' => 'Dế Mèn Phiêu Lưu Ký', 'author' => 'Tô Hoài', 'slug' => 'de-men-ql',
    ]);
    $copy = BookCopy::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0501', 'state' => 'available',
    ]);
    app(TenantContext::class)->clear();

    return [$shelf, $manager, $membership, $book, $copy];
}

it('step 1 searches and annotates each row with its block state', function () {
    [$shelf, $manager] = qlFix();

    $this->actingAs($manager)
        ->get(route('shelves.manage.lend', ['shelf' => $shelf->slug, 'q' => 'de men']))
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('manage/lend/index')
            ->where('filters.q', 'de men')
            ->count('results', 1)
            ->where('results.0.title', 'Dế Mèn Phiêu Lưu Ký')
            ->where('results.0.blocked', false));
});

it('step 2 carries the chosen book and searches readers with their block reasons', function () {
    [$shelf, $manager] = qlFix(slug: 'dong-thap-ql-s2');

    $this->actingAs($manager)
        ->get(route('shelves.manage.lend.reader', ['shelf' => $shelf->slug, 'book' => 'de-men-ql', 'q' => 'cam sach']))
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('manage/lend/reader')
            ->where('book.title', 'Dế Mèn Phiêu Lưu Ký')
            ->count('results', 1)
            ->where('results.0.fullName', 'Têrêsa Cầm Sách Chờ')
            ->where('results.0.blocked', false));
});

it('step 3 previews the pair, the chosen copy and the calculated due date', function () {
    \Carbon\Carbon::setTestNow(\Carbon\Carbon::parse('2026-08-28 03:00:00', 'UTC'));
    [$shelf, $manager, $membership] = qlFix(slug: 'dong-thap-ql-s3');

    $this->actingAs($manager)
        ->get(route('shelves.manage.lend.confirm', [
            'shelf' => $shelf->slug, 'book' => 'de-men-ql', 'reader' => $membership->id,
        ]))
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('manage/lend/confirm')
            ->where('book.title', 'Dế Mèn Phiêu Lưu Ký')
            ->where('chosen.copyCode', 'DT-0501')
            ->where('reader.fullName', 'Têrêsa Cầm Sách Chờ')
            ->where('dueOn', '2026-09-11')
            ->where('blocking', null));
    \Carbon\Carbon::setTestNow();
});

it('the confirm POST lends and redirects to step 1 with the success flash', function () {
    [$shelf, $manager, $membership, $book, $copy] = qlFix(slug: 'dong-thap-ql-post');

    $response = $this->actingAs($manager)->post(
        route('shelves.manage.lend.store', ['shelf' => $shelf->slug]),
        ['copy_id' => $copy->id, 'membership_id' => $membership->id],
    );

    $response->assertRedirect(route('shelves.manage.lend', ['shelf' => $shelf->slug]))
        ->assertSessionHas('success');
    expect(Loan::query()->where('copy_id', $copy->id)->where('status', 'active')->exists())->toBeTrue();
});

it('a refusal comes back as errors.rule, in Vietnamese, with nothing written', function () {
    [$shelf, $manager, $membership, , $copy] = qlFix(slug: 'dong-thap-ql-refuse');
    BookCopy::query()->whereKey($copy->id)->update(['state' => 'on_loan']);

    $this->actingAs($manager)
        ->from(route('shelves.manage.lend.confirm', ['shelf' => $shelf->slug, 'book' => 'de-men-ql', 'reader' => $membership->id]))
        ->post(route('shelves.manage.lend.store', ['shelf' => $shelf->slug]),
            ['copy_id' => $copy->id, 'membership_id' => $membership->id])
        ->assertRedirect()
        ->assertSessionHasErrors(['rule' => 'Bản sách này đang được mượn hoặc đang giữ chỗ.']);
    expect(Loan::query()->count())->toBe(0);
});

it('a foreign copy id 404s out of the scoped resolution, never lends', function () {
    [$shelf, $manager, $membership] = qlFix(slug: 'dong-thap-ql-foreign');
    app(TenantContext::class)->actSystemWide();
    $other = Bookshelf::factory()->create(['slug' => 'can-tho-ql', 'settings' => []]);
    $otherBook = Book::query()->create(['bookshelf_id' => $other->id, 'title' => 'Sách Tủ Khác', 'slug' => 'sach-khac-ql']);
    $foreign = BookCopy::query()->create(['bookshelf_id' => $other->id, 'book_id' => $otherBook->id, 'code' => 'CT-0501', 'state' => 'available']);
    app(TenantContext::class)->clear();

    $this->actingAs($manager)
        ->post(route('shelves.manage.lend.store', ['shelf' => $shelf->slug]),
            ['copy_id' => $foreign->id, 'membership_id' => $membership->id])
        ->assertNotFound();
    expect(Loan::query()->count())->toBe(0);
});

it('a guest is redirected to login', function () {
    [$shelf] = qlFix(slug: 'dong-thap-ql-guest');
    $this->get(route('shelves.manage.lend', ['shelf' => $shelf->slug]))
        ->assertRedirect(route('login'));
});

it('a reader 404s on every lend screen — 404, never 403 (BR §5.4)', function () {
    // Review fix: the draft asserted ONE of the four routes while its title
    // said "every lend screen". All four, including the POST, which is the
    // one whose refusal comes from LendCopyRequest::authorize's
    // abort_unless(..., 404) rather than from the role middleware.
    [$shelf, , $membership, , $copy] = qlFix(slug: 'dong-thap-ql-reader404');
    $reader = User::query()->findOrFail($membership->user_id);

    $this->actingAs($reader)
        ->get(route('shelves.manage.lend', ['shelf' => $shelf->slug]))
        ->assertNotFound();
    $this->actingAs($reader)
        ->get(route('shelves.manage.lend.reader', ['shelf' => $shelf->slug, 'book' => 'de-men-ql']))
        ->assertNotFound();
    $this->actingAs($reader)
        ->get(route('shelves.manage.lend.confirm', ['shelf' => $shelf->slug, 'book' => 'de-men-ql', 'reader' => $membership->id]))
        ->assertNotFound();
    $this->actingAs($reader)
        ->post(route('shelves.manage.lend.store', ['shelf' => $shelf->slug]),
            ['copy_id' => $copy->id, 'membership_id' => $membership->id])
        ->assertNotFound();
    expect(Loan::query()->count())->toBe(0);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `make test FILTER=QuickLend && make test FILTER=ChooseCopyTest`
Expected: FAIL — routes render `under-construction`, classes missing.

- [ ] **Step 3: `ChooseCopy`**

Create `app/Support/Circulation/ChooseCopy.php`:

```php
<?php

namespace App\Support\Circulation;

use App\Enums\CopyState;
use App\Models\BookCopy;
use App\Support\Circulation\LoanRules;
use Illuminate\Support\Collection;

/**
 * The quick-lend copy chooser — port of chooseCopyToLend
 * (old_next/src/lib/lending.ts:120). BR §16.3 sketched a copy selector;
 * the reference auto-picks the lowest-code lendable copy instead, so step
 * 2 and step 3 name the same physical book (plan divergence 9).
 *
 * heldForUserId is passed as null and forUserId as '' — '' is never a
 * users.id, so the held branch always refuses here: this screen can lend
 * a held copy to nobody (collecting a hold is Phase 2's HandoverRequest),
 * which is the conservative answer the reference gives for the same
 * reason.
 *
 * The no-copies case keeps copy_not_available — wrong sentence, kept
 * deliberately (open question 4): a private fix here would make step 1's
 * aggregate and this screen disagree, the exact failure BR §16.3 forbids.
 *
 * @param  Collection<int, BookCopy>  $copies  the title's live copies, any order
 * @return array{copy: ?BookCopy, reason: ?string}
 */
final class ChooseCopy
{
    /**
     * @param  Collection<int, BookCopy>  $copies
     * @return array{copy: ?BookCopy, reason: ?string}
     */
    public static function lowestLendable(Collection $copies): array
    {
        $sawReturnable = false;

        foreach ($copies->sortBy('code')->values() as $copy) {
            $reason = LoanRules::copyLendable($copy->state, null, '');
            if ($reason === null) {
                return ['copy' => $copy, 'reason' => null];
            }
            if ($reason === 'copy_not_available') {
                $sawReturnable = true;
            }
        }

        return [
            'copy' => null,
            'reason' => $copies->isNotEmpty() && ! $sawReturnable
                ? 'copy_lost_or_retired'
                : 'copy_not_available',
        ];
    }
}
```

- [ ] **Step 4: Routes, Form Request, flash, controller**

In `routes/web.php`, replace the **three** `under-construction` lend routes (`routes/web.php:119-121` — `lend`, `lend.reader`, `lend.confirm`; there is no placeholder POST) and add a fourth, new one (import `LendController`):

```php
        Route::get('/lend', [LendController::class, 'index'])->name('lend');
        Route::get('/lend/reader', [LendController::class, 'reader'])->name('lend.reader');
        Route::get('/lend/confirm', [LendController::class, 'confirm'])->name('lend.confirm');
        Route::post('/lend', [LendController::class, 'store'])->name('lend.store');
```

In `app/Http/Middleware/HandleInertiaRequests.php`, add to `share()`'s array:

```php
            'flash' => [
                'success' => fn () => $request->session()->get('success'),
            ],
```

and in `resources/js/types/index.ts`, extend `SharedData`:

```ts
    flash: { success: string | null };
```

Create `app/Http/Requests/Circulation/LendCopyRequest.php`:

```php
<?php

namespace App\Http\Requests\Circulation;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

class LendCopyRequest extends FormRequest
{
    public function authorize(): bool
    {
        // 404, never 403 — BR §5.4's anti-enumeration rule, the backstop
        // behind the role:manager middleware (PR #61 Task 4's shape).
        abort_unless(Gate::allows('act-as-manager'), 404);

        return true;
    }

    /** @return array<string, list<string>> */
    public function rules(): array
    {
        return [
            'copy_id' => ['bail', 'required', 'string', 'uuid'],
            'membership_id' => ['bail', 'required', 'string', 'uuid'],
        ];
    }
}
```

Create `app/Http/Controllers/Manage/LendController.php`:

```php
<?php

namespace App\Http\Controllers\Manage;

use App\Actions\Circulation\LendCopy;
use App\Http\Controllers\Controller;
use App\Http\Requests\Circulation\LendCopyRequest;
use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\User;
use App\Queries\SearchBooksForLendingQuery;
use App\Queries\SearchReadersForLendingQuery;
use App\Support\Circulation\ChooseCopy;
use App\Support\Circulation\LendingSettings;
use App\Support\Circulation\LoanRules;
use App\Support\Circulation\LoanTerms;
use App\Support\Clock;
use App\Support\QueryParam;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * BR §16.3's quick lend, the most important screen in the application.
 * Steps 1 and 2 are searches; step 3 re-reads everything from the URL —
 * a URL is not evidence (a bookmark from last Sunday, a colleague's
 * pasted link) — and shows the exact refusal LendCopy would throw, BEFORE
 * the confirm tap. The command then re-checks a third time inside its
 * transaction, because even this read is seconds old by the time anybody
 * taps (OPS §5).
 */
class LendController extends Controller
{
    public function index(Request $request, Bookshelf $shelf, SearchBooksForLendingQuery $books): Response
    {
        $q = QueryParam::first($request, 'q') ?? '';

        return Inertia::render('manage/lend/index', [
            'filters' => ['q' => $q],
            'results' => $books->run($q),
        ]);
    }

    public function reader(Request $request, Bookshelf $shelf, SearchReadersForLendingQuery $readers): Response
    {
        $q = QueryParam::first($request, 'q') ?? '';
        $slug = QueryParam::first($request, 'book');
        $book = $slug !== null ? Book::query()->where('slug', $slug)->first() : null;

        return Inertia::render('manage/lend/reader', [
            'filters' => ['q' => $q],
            'book' => $book === null ? null : [
                'slug' => $book->slug, 'title' => $book->title,
                'author' => $book->author, 'coverUrl' => $book->cover_url,
            ],
            'results' => $q === '' ? [] : $readers->run($q),
        ]);
    }

    public function confirm(Request $request, Bookshelf $shelf, Clock $clock): Response
    {
        $slug = QueryParam::first($request, 'book');
        $membershipId = QueryParam::first($request, 'reader');

        $book = $slug !== null ? Book::query()->where('slug', $slug)->with('copies')->first() : null;
        $chosen = $book !== null
            ? ChooseCopy::lowestLendable($book->copies)
            : ['copy' => null, 'reason' => null];

        $membership = null;
        if ($membershipId !== null && preg_match('/^[0-9a-f-]{36}$/', $membershipId) === 1) {
            $membership = Membership::query()->with('user')->find($membershipId);
        }

        $settings = LendingSettings::fromShelf($shelf);
        $readerReason = null;
        $activeLoans = 0;
        if ($membership !== null) {
            $activeLoans = \App\Models\Loan::query()
                ->where('borrower_id', $membership->user_id)
                ->where('status', \App\Enums\LoanStatus::Active)
                ->count();
            $readerReason = LoanRules::memberMayBorrow($membership->status, $activeLoans, $settings->maxConcurrentLoans);
        }

        // OPS §5's order: copy-side refusal first, then reader-side. The
        // step indicator on the page draws the step actually reached.
        $blocking = match (true) {
            $book === null => 'book_missing',
            $chosen['reason'] !== null => $chosen['reason'],
            $membership === null => 'reader_missing',
            $readerReason !== null => $readerReason,
            default => null,
        };

        return Inertia::render('manage/lend/confirm', [
            'book' => $book === null ? null : [
                'slug' => $book->slug, 'title' => $book->title,
                'author' => $book->author, 'coverUrl' => $book->cover_url,
            ],
            'chosen' => $chosen['copy'] === null ? null : [
                'copyId' => $chosen['copy']->id, 'copyCode' => $chosen['copy']->code,
            ],
            'reader' => $membership === null ? null : [
                'membershipId' => $membership->id,
                'fullName' => $membership->user?->full_name,
                'activeLoans' => $activeLoans,
            ],
            'lentOn' => $clock->today(),
            'dueOn' => LoanTerms::dueDateFor($clock->today(), $settings->loanDays),
            'blocking' => $blocking,
        ]);
    }

    public function store(LendCopyRequest $request, Bookshelf $shelf, LendCopy $lendCopy): RedirectResponse
    {
        /** @var User $user */
        $user = $request->user();
        $validated = $request->validated();

        // Scoped finds: a foreign or unknown id is a 404 out of
        // BookshelfScope, the same non-answer an unknown URL gets.
        $copy = BookCopy::query()->findOrFail($validated['copy_id']);
        $membership = Membership::query()->findOrFail($validated['membership_id']);

        $result = $lendCopy->execute($user, $copy, $membership);

        return redirect()
            ->route('shelves.manage.lend', ['shelf' => $shelf->slug])
            ->with('success', __('rules.lend_success_flash', [
                'title' => $copy->book?->title ?? '',
                'name' => $membership->user?->full_name ?? '',
                'due' => $result['dueOn'],
            ]));
    }
}
```

Add the flash sentence to `lang/vi/rules.php` (a UI sentence, not a refusal — kept beside them so server copy stays in `lang/vi/`):

```php
    'lend_success_flash' => 'Đã cho :name mượn ":title" — hạn trả :due.',
```

(The census test only walks `new RuleViolated(...)` literals, so a non-refusal key here is inert to it.)

- [ ] **Step 5: Client copy and the date helper**

In `resources/js/lib/copy.ts`, append one `circulation` block (Tasks 11–13 extend it):

```ts
    circulation: {
        rules: {
            copy_not_available: "Bản sách này đang được mượn hoặc đang giữ chỗ.",
            copy_lost_or_retired: "Bản sách này đã mất hoặc ngừng dùng.",
            membership_not_active: "Tài khoản đang tạm khoá, không thể mượn thêm.",
            loan_limit_reached: "Bạn đọc đã mượn tối đa số sách cho phép.",
            no_renewals_remaining: "Bạn đã dùng hết số lần gia hạn cho lượt mượn này.",
            title_has_queue: "Có bạn khác đang chờ mượn cuốn này, không thể gia hạn.",
        },
        steps: ["Tìm sách", "Chọn người đọc", "Xác nhận"],
        lend: {
            title1: "Tìm sách cần cho mượn",
            title2: "Chọn người đọc",
            title3: "Xác nhận cho mượn",
            searchBookPlaceholder: "Tên sách hoặc mã bản",
            searchBookHint: "Không cần gõ dấu — gõ de men vẫn tìm ra Dế Mèn.",
            searchReaderPlaceholder: "Tên bạn đọc",
            search: "Tìm",
            available: "Còn sách",
            copies: "{available}/{total} bản",
            holding: "Đang mượn {count} cuốn",
            registerNewReader: "Đăng ký người đọc mới",
            bookLabel: "Sách",
            copyLabel: "Bản",
            readerLabel: "Người đọc",
            lentOnLabel: "Ngày mượn",
            dueOnLabel: "Hạn trả",
            confirmButton: "Xác nhận cho mượn",
            bookMissing: "Chưa chọn sách — quay lại bước 1.",
            readerMissing: "Chưa chọn người đọc — quay lại bước 2.",
        },
    },
```

Create `resources/js/lib/dates.ts`:

```ts
/**
 * One place a Y-m-d string becomes a Vietnamese date. AGENTS.md: dates
 * read as dates, never timestamps — a loan is due at the end of a day.
 */
export function formatDate(ymd: string): string {
    const [y, m, d] = ymd.split("-").map(Number);
    return new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }).format(
        new Date(Date.UTC(y, m - 1, d)),
    );
}
```

- [ ] **Step 6: The three pages**

Create `resources/js/pages/manage/lend/index.tsx`:

```tsx
import { Head, Link, router, usePage } from "@inertiajs/react";
import { type FormEvent, useState } from "react";
import { route } from "ziggy-js";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ManageLayout from "@/layouts/manage-layout";
import { copy, t } from "@/lib/copy";
import type { SharedData } from "@/types";

interface LendableBookRow {
    bookId: string;
    slug: string;
    title: string;
    author: string | null;
    coverUrl: string | null;
    copiesTotal: number;
    copiesAvailable: number;
    blocked: boolean;
    reason: keyof typeof copy.circulation.rules | null;
}

interface PageProps extends SharedData {
    filters: { q: string };
    results: LendableBookRow[];
}

export default function QuickLendStepOne() {
    const { shelf, filters, results, flash } = usePage<PageProps>().props;
    const [q, setQ] = useState(filters.q);
    if (!shelf) return null;

    const submit = (event: FormEvent) => {
        event.preventDefault();
        router.get(route("shelves.manage.lend", { shelf: shelf.slug, q: q || undefined }), {}, { preserveState: true });
    };

    return (
        <ManageLayout>
            <Head title={copy.circulation.lend.title1} />
            <h1 className="mb-1 text-2xl font-semibold">{copy.circulation.lend.title1}</h1>
            <p className="mb-4 text-sm text-muted-foreground">{copy.circulation.lend.searchBookHint}</p>

            {flash.success ? (
                <p role="status" className="mb-4 rounded-md border border-green-700/30 bg-green-700/10 px-3 py-2 text-sm">
                    {flash.success}
                </p>
            ) : null}

            <form onSubmit={submit} className="mb-4 flex gap-2">
                <Input
                    autoFocus
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder={copy.circulation.lend.searchBookPlaceholder}
                    className="h-12 max-w-md text-base"
                />
                <Button type="submit" className="h-12">
                    {copy.circulation.lend.search}
                </Button>
            </form>

            <ul className="divide-y border-y">
                {results.map((book) => {
                    const row = (
                        <div className="flex items-center justify-between gap-3 py-3">
                            <div className="min-w-0">
                                <p className="truncate font-serif text-base">{book.title}</p>
                                <p className="truncate text-sm text-muted-foreground">{book.author}</p>
                                {book.reason ? (
                                    <p className="mt-1 text-sm text-muted-foreground">
                                        {copy.circulation.rules[book.reason]}
                                    </p>
                                ) : null}
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                                {book.blocked ? null : <Badge>{copy.circulation.lend.available}</Badge>}
                                <span className="text-sm text-muted-foreground">
                                    {t(copy.circulation.lend.copies, {
                                        available: book.copiesAvailable,
                                        total: book.copiesTotal,
                                    })}
                                </span>
                            </div>
                        </div>
                    );

                    return (
                        <li key={book.bookId}>
                            {book.blocked ? (
                                <div className="opacity-70">{row}</div>
                            ) : (
                                <Link
                                    href={route("shelves.manage.lend.reader", { shelf: shelf.slug, book: book.slug })}
                                    className="block hover:bg-muted/50"
                                >
                                    {row}
                                </Link>
                            )}
                        </li>
                    );
                })}
            </ul>
        </ManageLayout>
    );
}
```

Create `resources/js/pages/manage/lend/reader.tsx`:

```tsx
import { Head, Link, router, usePage } from "@inertiajs/react";
import { type FormEvent, useState } from "react";
import { route } from "ziggy-js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ManageLayout from "@/layouts/manage-layout";
import { copy, t } from "@/lib/copy";
import type { SharedData } from "@/types";

interface LendableReaderRow {
    membershipId: string;
    fullName: string;
    saintName: string | null;
    parishLine: string;
    activeLoans: number;
    blocked: boolean;
    reason: keyof typeof copy.circulation.rules | null;
}

interface PageProps extends SharedData {
    filters: { q: string };
    book: { slug: string; title: string; author: string | null; coverUrl: string | null } | null;
    results: LendableReaderRow[];
}

export default function QuickLendStepTwo() {
    const { shelf, filters, book, results } = usePage<PageProps>().props;
    const [q, setQ] = useState(filters.q);
    if (!shelf) return null;

    const submit = (event: FormEvent) => {
        event.preventDefault();
        router.get(
            route("shelves.manage.lend.reader", { shelf: shelf.slug, book: book?.slug, q: q || undefined }),
            {},
            { preserveState: true },
        );
    };

    return (
        <ManageLayout>
            <Head title={copy.circulation.lend.title2} />
            <h1 className="mb-1 text-2xl font-semibold">{copy.circulation.lend.title2}</h1>
            {book ? <p className="mb-4 font-serif text-base">{book.title}</p> : null}

            <form onSubmit={submit} className="mb-4 flex gap-2">
                <Input
                    autoFocus
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder={copy.circulation.lend.searchReaderPlaceholder}
                    className="h-12 max-w-md text-base"
                />
                <Button type="submit" className="h-12">
                    {copy.circulation.lend.search}
                </Button>
            </form>

            <ul className="divide-y border-y">
                {results.map((reader) => {
                    const row = (
                        <div className="flex items-center justify-between gap-3 py-3">
                            <div className="min-w-0">
                                <p className="truncate text-base">
                                    {reader.saintName ? `${reader.saintName} ` : ""}
                                    {reader.fullName}
                                </p>
                                <p className="truncate text-sm text-muted-foreground">{reader.parishLine}</p>
                                {reader.reason ? (
                                    <p className="mt-1 text-sm text-muted-foreground">
                                        {copy.circulation.rules[reader.reason]}
                                    </p>
                                ) : null}
                            </div>
                            <span className="shrink-0 text-sm text-muted-foreground">
                                {t(copy.circulation.lend.holding, { count: reader.activeLoans })}
                            </span>
                        </div>
                    );

                    return (
                        <li key={reader.membershipId}>
                            {reader.blocked ? (
                                <div className="opacity-70">{row}</div>
                            ) : (
                                <Link
                                    href={route("shelves.manage.lend.confirm", {
                                        shelf: shelf.slug,
                                        book: book?.slug,
                                        reader: reader.membershipId,
                                    })}
                                    className="block hover:bg-muted/50"
                                >
                                    {row}
                                </Link>
                            )}
                        </li>
                    );
                })}
            </ul>

            {/* BR §16.3's escape hatch. Links to the ON-BEHALF form, the
                reference's own wiring (plan open question 3): the new reader
                lands pending and needs approval before a lend. */}
            <Button asChild variant="outline" className="mt-6">
                <Link href={route("shelves.manage.readers.create", { shelf: shelf.slug })}>
                    {copy.circulation.lend.registerNewReader}
                </Link>
            </Button>
        </ManageLayout>
    );
}
```

Create `resources/js/pages/manage/lend/confirm.tsx`:

```tsx
import { Head, useForm, usePage } from "@inertiajs/react";
import { type FormEvent } from "react";
import { route } from "ziggy-js";
import { Button } from "@/components/ui/button";
import ManageLayout from "@/layouts/manage-layout";
import { copy } from "@/lib/copy";
import { formatDate } from "@/lib/dates";
import type { SharedData } from "@/types";

interface PageProps extends SharedData {
    book: { slug: string; title: string; author: string | null; coverUrl: string | null } | null;
    chosen: { copyId: string; copyCode: string } | null;
    reader: { membershipId: string; fullName: string; activeLoans: number } | null;
    lentOn: string;
    dueOn: string;
    blocking: string | null;
}

export default function QuickLendConfirm() {
    const { shelf, book, chosen, reader, lentOn, dueOn, blocking, errors } = usePage<PageProps>().props;
    const form = useForm({ copy_id: chosen?.copyId ?? "", membership_id: reader?.membershipId ?? "" });
    if (!shelf) return null;

    const blockingText =
        blocking === null
            ? null
            : blocking === "book_missing"
              ? copy.circulation.lend.bookMissing
              : blocking === "reader_missing"
                ? copy.circulation.lend.readerMissing
                : (copy.circulation.rules[blocking as keyof typeof copy.circulation.rules] ?? blocking);

    const submit = (event: FormEvent) => {
        event.preventDefault();
        form.post(route("shelves.manage.lend.store", { shelf: shelf.slug }));
    };

    return (
        <ManageLayout>
            <Head title={copy.circulation.lend.title3} />
            <h1 className="mb-4 text-2xl font-semibold">{copy.circulation.lend.title3}</h1>

            {errors.rule ? (
                <p role="alert" className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
                    {errors.rule}
                </p>
            ) : null}
            {blockingText ? (
                <p role="alert" className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
                    {blockingText}
                </p>
            ) : null}

            <dl className="mb-6 max-w-md divide-y rounded-md border">
                <div className="px-4 py-3">
                    <dt className="text-sm text-muted-foreground">{copy.circulation.lend.bookLabel}</dt>
                    <dd className="mt-1 font-serif text-base">{book?.title ?? "—"}</dd>
                </div>
                <div className="px-4 py-3">
                    <dt className="text-sm text-muted-foreground">{copy.circulation.lend.copyLabel}</dt>
                    <dd className="mt-1">{chosen?.copyCode ?? "—"}</dd>
                </div>
                <div className="px-4 py-3">
                    <dt className="text-sm text-muted-foreground">{copy.circulation.lend.readerLabel}</dt>
                    <dd className="mt-1">{reader?.fullName ?? "—"}</dd>
                </div>
                <div className="px-4 py-3">
                    <dt className="text-sm text-muted-foreground">{copy.circulation.lend.lentOnLabel}</dt>
                    <dd className="mt-1">{formatDate(lentOn)}</dd>
                </div>
                <div className="px-4 py-3">
                    <dt className="text-sm text-muted-foreground">{copy.circulation.lend.dueOnLabel}</dt>
                    <dd className="mt-1 font-medium">{formatDate(dueOn)}</dd>
                </div>
            </dl>

            <form onSubmit={submit}>
                <Button type="submit" className="h-14 px-8 text-base" disabled={blocking !== null || form.processing}>
                    {copy.circulation.lend.confirmButton}
                </Button>
            </form>
        </ManageLayout>
    );
}
```

- [ ] **Step 7: Run the tests, verify they pass**

Run: `make test FILTER=QuickLend && make test FILTER=ChooseCopyTest`
Expected: PASS. Also run `bun run build && bun run lint` (Biome — `noJsxLiterals` must stay clean; every literal above reads from `copy.ts`).

- [ ] **Step 8: Lint, analyse, commit**

```bash
make lint && make analyse
git add app/Support/Circulation/ChooseCopy.php app/Http/Requests/Circulation/LendCopyRequest.php \
  app/Http/Controllers/Manage/LendController.php resources/js/pages/manage/lend resources/js/lib/dates.ts \
  resources/js/lib/copy.ts resources/js/types/index.ts app/Http/Middleware/HandleInertiaRequests.php \
  routes/web.php lang/vi/rules.php tests/Feature/Circulation/QuickLendScreensTest.php tests/Unit/Circulation/ChooseCopyTest.php
git commit -m "feat: quick-lend screens — three taps from search to confirmed loan"
```

---
### Task 11: The return screens — condition in two taps, and the lost-copy exit

Read first: `old_next/src/app/tu-sach/[shelf]/quan-ly/nhan-tra/page.tsx` and `nhan-tra/bao-mat/page.tsx`, BR §16.3 "Receive return" (the "Bạn đọc báo làm mất" paragraph is this task's second screen), OPS §5's ReceiveReturn walk.

**Files:**
- Create: `app/Http/Requests/Circulation/ReceiveReturnRequest.php`
- Create: `app/Http/Controllers/Manage/ReturnController.php`
- Create: `resources/js/pages/manage/returns/index.tsx`
- Create: `resources/js/pages/manage/returns/lost.tsx`
- Modify: `routes/web.php` (replace the two under-construction return routes; add the POST)
- Modify: `resources/js/lib/copy.ts` (extend `circulation` with the `returns` block)
- Test: `tests/Feature/Circulation/ReturnScreensTest.php`

**Interfaces:**
- Consumes: `SearchLoansForReturnQuery::run` (Task 7 row shape), `ReceiveReturn::execute` (Task 4), the existing `shelves.manage.copies.report-lost` route + `CopyController::reportLost` (1a — reused verbatim, OPS §4.2: "the command's contract is unchanged; it simply gains a second entry point"), `copy.catalogue.condition` labels (1a's six-value map in `copy.ts`).
- Produces: routes `shelves.manage.returns` (GET, `?q=&loan=`), `shelves.manage.returns.store` (POST `/returns/{loan}` — `condition`, `note`), `shelves.manage.returns.lost` (GET, `?q=&loan=`).

- [ ] **Step 1: Write the failing tests**

Create `tests/Feature/Circulation/ReturnScreensTest.php`:

```php
<?php

use App\Enums\CopyState;
use App\Enums\LoanStatus;
use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\ConditionAssessment;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Inertia\Testing\AssertableInertia;

/** @return array{Bookshelf, User, Loan, BookCopy} */
function rtsFix(string $slug = 'dong-thap-rts'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);
    $manager = User::factory()->create(['full_name' => 'Maria Nhận Lại Sách']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);
    $reader = User::factory()->create(['full_name' => 'Giuse Mang Sách Về']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $reader->id, 'role' => 'reader', 'status' => 'active',
    ]);
    $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Hoàng Tử Bé', 'slug' => 'htb-rts']);
    $copy = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0601', 'state' => 'on_loan']);
    $loan = Loan::query()->create([
        'bookshelf_id' => $shelf->id, 'copy_id' => $copy->id, 'book_id' => $book->id,
        'borrower_id' => $reader->id, 'lent_by' => $manager->id,
        'due_on' => '2026-09-11', 'status' => 'active',
    ]);
    app(TenantContext::class)->clear();

    return [$shelf, $manager, $loan, $copy];
}

it('the returns screen lists matching active loans and marks the chosen one', function () {
    [$shelf, $manager, $loan] = rtsFix();

    $this->actingAs($manager)
        ->get(route('shelves.manage.returns', ['shelf' => $shelf->slug, 'q' => 'hoang tu', 'loan' => $loan->id]))
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('manage/returns/index')
            ->count('loans', 1)
            ->where('loans.0.copyCode', 'DT-0601')
            ->where('chosenLoanId', $loan->id));
});

it('posting the return closes the loan with the condition and flashes success', function () {
    [$shelf, $manager, $loan, $copy] = rtsFix(slug: 'dong-thap-rts-post');

    $this->actingAs($manager)
        ->post(route('shelves.manage.returns.store', ['shelf' => $shelf->slug, 'loan' => $loan->id]),
            ['condition' => 'torn', 'note' => 'rách bìa sau'])
        ->assertRedirect(route('shelves.manage.returns', ['shelf' => $shelf->slug]))
        ->assertSessionHas('success');

    expect($loan->fresh()->status)->toBe(LoanStatus::Returned)
        ->and($copy->fresh()->state)->toBe(CopyState::Available)
        ->and(ConditionAssessment::query()->where('loan_id', $loan->id)->exists())->toBeTrue();
});

it('a condition outside the six is refused by validation before the Action runs', function () {
    [$shelf, $manager, $loan] = rtsFix(slug: 'dong-thap-rts-badcond');

    $this->actingAs($manager)
        ->post(route('shelves.manage.returns.store', ['shelf' => $shelf->slug, 'loan' => $loan->id]),
            ['condition' => 'lost'])   // a copy STATE, deliberately absent from the condition list (BR §9)
        ->assertSessionHasErrors('condition');
    expect($loan->fresh()->status)->toBe(LoanStatus::Active);
});

it('a double submit comes back as errors.rule with the double-submit sentence', function () {
    [$shelf, $manager, $loan] = rtsFix(slug: 'dong-thap-rts-double');
    $this->actingAs($manager)
        ->post(route('shelves.manage.returns.store', ['shelf' => $shelf->slug, 'loan' => $loan->id]),
            ['condition' => 'perfect'])->assertSessionHas('success');

    $this->actingAs($manager)
        ->post(route('shelves.manage.returns.store', ['shelf' => $shelf->slug, 'loan' => $loan->id]),
            ['condition' => 'perfect'])
        ->assertSessionHasErrors(['rule' => 'Lượt mượn này đã được xử lý.']);
});

it('the lost screen shows the chosen loan and posts to the EXISTING report-lost route', function () {
    // OPS §4.2: choosing "Bạn đọc báo làm mất" does not call ReceiveReturn
    // at all — it switches to ReportCopyLost with the loan's copy already
    // identified. Same command, second entry point, contract unchanged.
    [$shelf, $manager, $loan, $copy] = rtsFix(slug: 'dong-thap-rts-lost');

    $this->actingAs($manager)
        ->get(route('shelves.manage.returns.lost', ['shelf' => $shelf->slug, 'q' => 'hoang tu', 'loan' => $loan->id]))
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('manage/returns/lost')
            ->where('chosen.loanId', $loan->id)
            ->where('chosen.copyId', $copy->id)
            ->where('chosen.copyCode', 'DT-0601'));

    // The wired POST target closes the loan as lost, not returned.
    $this->actingAs($manager)
        ->post(route('shelves.manage.copies.report-lost', ['shelf' => $shelf->slug, 'bookCopy' => $copy->id]),
            ['note' => 'bạn đọc báo làm mất']);

    expect($loan->fresh()->status)->toBe(LoanStatus::Lost)
        ->and($copy->fresh()->state)->toBe(CopyState::Lost);
});

it('a foreign loan id 404s on the return POST', function () {
    [$shelf, $manager] = rtsFix(slug: 'dong-thap-rts-foreign');
    [, , $foreignLoan] = rtsFix(slug: 'can-tho-rts');

    $this->actingAs($manager)
        ->post(route('shelves.manage.returns.store', ['shelf' => $shelf->slug, 'loan' => $foreignLoan->id]),
            ['condition' => 'perfect'])
        ->assertNotFound();
    expect($foreignLoan->fresh()->status)->toBe(LoanStatus::Active);
});

it('a guest is redirected to login', function () {
    // Review fix: the draft title said "and a reader 404s" and asserted no
    // such thing. Two blocks, each named for what it checks.
    [$shelf] = rtsFix(slug: 'dong-thap-rts-guest');
    $this->get(route('shelves.manage.returns', ['shelf' => $shelf->slug]))
        ->assertRedirect(route('login'));
});

it('a reader 404s on both return screens — 404, never 403 (BR §5.4)', function () {
    [$shelf, , $loan] = rtsFix(slug: 'dong-thap-rts-reader');
    $reader = User::query()->findOrFail($loan->borrower_id);

    $this->actingAs($reader)
        ->get(route('shelves.manage.returns', ['shelf' => $shelf->slug]))
        ->assertNotFound();
    $this->actingAs($reader)
        ->get(route('shelves.manage.returns.lost', ['shelf' => $shelf->slug]))
        ->assertNotFound();
    $this->actingAs($reader)
        ->post(route('shelves.manage.returns.store', ['shelf' => $shelf->slug, 'loan' => $loan->id]),
            ['condition' => 'perfect'])
        ->assertNotFound();
    expect($loan->fresh()->status)->toBe(LoanStatus::Active);
});
```

(The foreign-loan test builds its second world through a second `rtsFix` call with a different slug and a different manager — the returned `$manager` of shelf A is re-authenticated by `actingAs` in its own request; the guest test is its own `it()` block per the SessionGuard rule.)

- [ ] **Step 2: Run to verify failure**

Run: `make test FILTER=ReturnScreensTest`
Expected: FAIL — routes render under-construction.

- [ ] **Step 3: Routes, Form Request, controller**

In `routes/web.php`, replace the two under-construction return routes (lost declared before the `{loan}` POST, matching the spec-§6 declaration-order discipline even across verbs):

```php
        Route::get('/returns', [ReturnController::class, 'index'])->name('returns');
        Route::get('/returns/lost', [ReturnController::class, 'lost'])->name('returns.lost');
        Route::post('/returns/{loan}', [ReturnController::class, 'store'])->name('returns.store');
```

Create `app/Http/Requests/Circulation/ReceiveReturnRequest.php`:

```php
<?php

namespace App\Http\Requests\Circulation;

use App\Enums\CopyCondition;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;

class ReceiveReturnRequest extends FormRequest
{
    public function authorize(): bool
    {
        abort_unless(Gate::allows('act-as-manager'), 404);

        return true;
    }

    /** @return array<string, list<mixed>> */
    public function rules(): array
    {
        return [
            'condition' => ['bail', 'required', 'string', Rule::enum(CopyCondition::class)],
            // bail + encoding:UTF-8 — a NUL byte must fail as validation,
            // never crash a later rule (PR #61 Task 1's lesson).
            'note' => ['bail', 'nullable', 'string', 'max:1000', 'encoding:UTF-8'],
        ];
    }
}
```

Create `app/Http/Controllers/Manage/ReturnController.php`:

```php
<?php

namespace App\Http\Controllers\Manage;

use App\Actions\Circulation\ReceiveReturn;
use App\Enums\CopyCondition;
use App\Http\Controllers\Controller;
use App\Http\Requests\Circulation\ReceiveReturnRequest;
use App\Models\Bookshelf;
use App\Models\Loan;
use App\Models\User;
use App\Queries\SearchLoansForReturnQuery;
use App\Support\QueryParam;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * BR §16.3's receive return: find the loan, pick a condition (Nguyên vẹn
 * preselected — the common case is two taps), confirm. The lost screen is
 * the same search with a different exit: it posts to the 1a report-lost
 * route, because "Bạn đọc báo làm mất" is ReportCopyLost's second entry
 * point, not a ReceiveReturn variant (OPS §4.2).
 *
 * The queued-reader offer (OPS §5 steps 3-4) is ABSENT until Phase 2 —
 * plan divergence 4; there is no queue to check yet.
 */
class ReturnController extends Controller
{
    public function index(Request $request, Bookshelf $shelf, SearchLoansForReturnQuery $loans): Response
    {
        $q = QueryParam::first($request, 'q') ?? '';
        $chosen = QueryParam::first($request, 'loan');
        $rows = $loans->run($q);

        return Inertia::render('manage/returns/index', [
            'filters' => ['q' => $q],
            'loans' => $rows,
            // Only a loan the CURRENT search returned can be "chosen" — a
            // stale ?loan= from a bookmark degrades to nothing selected.
            'chosenLoanId' => collect($rows)->firstWhere('loanId', $chosen)['loanId'] ?? null,
        ]);
    }

    public function store(ReceiveReturnRequest $request, Bookshelf $shelf, Loan $loan, ReceiveReturn $receiveReturn): RedirectResponse
    {
        /** @var User $user */
        $user = $request->user();
        $validated = $request->validated();

        $receiveReturn->execute(
            $user,
            $loan,
            CopyCondition::from($validated['condition']),
            $validated['note'] ?? null,
        );

        return redirect()
            ->route('shelves.manage.returns', ['shelf' => $shelf->slug])
            ->with('success', __('rules.return_success_flash', [
                'code' => $loan->copy?->code ?? '',
            ]));
    }

    public function lost(Request $request, Bookshelf $shelf, SearchLoansForReturnQuery $loans): Response
    {
        $q = QueryParam::first($request, 'q') ?? '';
        $chosenId = QueryParam::first($request, 'loan');
        $rows = $loans->run($q);
        $chosen = collect($rows)->firstWhere('loanId', $chosenId);

        return Inertia::render('manage/returns/lost', [
            'filters' => ['q' => $q],
            'loans' => $rows,
            'chosen' => $chosen === null ? null : [
                'loanId' => $chosen['loanId'],
                'copyId' => $chosen['copyId'],
                'copyCode' => $chosen['copyCode'],
                'title' => $chosen['title'],
                'borrowerName' => $chosen['borrowerName'],
                'dueOn' => $chosen['dueOn'],
            ],
        ]);
    }
}
```

Add to `lang/vi/rules.php`:

```php
    'return_success_flash' => 'Đã nhận trả bản :code — sách đã về kệ.',
```

- [ ] **Step 4: Client copy**

Extend `copy.ts`'s `circulation` block:

```ts
        returns: {
            title: "Nhận trả sách",
            lostTitle: "Bạn đọc báo làm mất",
            searchPlaceholder: "Tên sách, tên bạn đọc hoặc mã bản",
            search: "Tìm",
            dueLine: "Hạn trả {date}",
            overdueLine: "Quá hạn {days} ngày",
            conditionLegend: "Tình trạng sách khi trả",
            noteLabel: "Ghi chú",
            confirmButton: "Xác nhận nhận trả",
            reportLostLink: "Bạn đọc báo làm mất",
            backToReturns: "Quay lại nhận trả",
            lostExplain: "Sau khi xác nhận, bản {code} sẽ chuyển sang trạng thái Đã mất và lượt mượn khép lại là mất sách.",
            lostNoteLabel: "Ghi chú",
            lostConfirmButton: "Xác nhận báo mất",
            noneFound: "Không tìm thấy lượt mượn nào đang mở.",
            chooseFirst: "Tìm và chọn lượt mượn cần xử lý.",
        },
```

- [ ] **Step 5: The two pages**

Create `resources/js/pages/manage/returns/index.tsx`:

```tsx
import { Head, Link, router, useForm, usePage } from "@inertiajs/react";
import { type FormEvent, useState } from "react";
import { route } from "ziggy-js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ManageLayout from "@/layouts/manage-layout";
import { copy, t } from "@/lib/copy";
import { formatDate } from "@/lib/dates";
import type { SharedData } from "@/types";

interface LoanRow {
    loanId: string;
    copyCode: string;
    title: string;
    borrowerName: string;
    dueOn: string;
    isOverdue: boolean;
    daysRemaining: number;
}

interface PageProps extends SharedData {
    filters: { q: string };
    loans: LoanRow[];
    chosenLoanId: string | null;
}

const CONDITIONS = ["perfect", "slightly_worn", "worn", "torn", "missing_pages", "written_on"] as const;

export default function ReturnsIndex() {
    const { shelf, filters, loans, chosenLoanId, errors, flash } = usePage<PageProps>().props;
    const [q, setQ] = useState(filters.q);
    // BR §16.3: Nguyên vẹn preselected — the common case is two taps.
    const form = useForm({ condition: "perfect", note: "" });
    if (!shelf) return null;

    const chosen = loans.find((l) => l.loanId === chosenLoanId) ?? null;
    const worse = form.data.condition !== "perfect";

    const submitSearch = (event: FormEvent) => {
        event.preventDefault();
        router.get(route("shelves.manage.returns", { shelf: shelf.slug, q: q || undefined }), {}, { preserveState: true });
    };

    const submitReturn = (event: FormEvent) => {
        event.preventDefault();
        if (!chosen) return;
        form.post(route("shelves.manage.returns.store", { shelf: shelf.slug, loan: chosen.loanId }));
    };

    return (
        <ManageLayout>
            <Head title={copy.circulation.returns.title} />
            <h1 className="mb-4 text-2xl font-semibold">{copy.circulation.returns.title}</h1>

            {flash.success ? (
                <p role="status" className="mb-4 rounded-md border border-green-700/30 bg-green-700/10 px-3 py-2 text-sm">
                    {flash.success}
                </p>
            ) : null}
            {errors.rule ? (
                <p role="alert" className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
                    {errors.rule}
                </p>
            ) : null}

            <form onSubmit={submitSearch} className="mb-4 flex gap-2">
                <Input
                    autoFocus
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder={copy.circulation.returns.searchPlaceholder}
                    className="h-12 max-w-md text-base"
                />
                <Button type="submit" className="h-12">
                    {copy.circulation.returns.search}
                </Button>
            </form>

            <ul className="mb-6 divide-y border-y">
                {loans.map((loan) => (
                    <li key={loan.loanId}>
                        <Link
                            href={route("shelves.manage.returns", {
                                shelf: shelf.slug,
                                q: filters.q || undefined,
                                loan: loan.loanId,
                            })}
                            preserveState
                            className={`flex items-center justify-between gap-3 py-3 ${loan.loanId === chosenLoanId ? "bg-muted/60" : "hover:bg-muted/40"}`}
                        >
                            <div className="min-w-0">
                                <p className="truncate font-serif text-base">{loan.title}</p>
                                <p className="truncate text-sm text-muted-foreground">
                                    {loan.copyCode} · {loan.borrowerName}
                                </p>
                            </div>
                            <span className="shrink-0 text-sm text-muted-foreground">
                                {loan.isOverdue
                                    ? t(copy.circulation.returns.overdueLine, { days: -loan.daysRemaining })
                                    : t(copy.circulation.returns.dueLine, { date: formatDate(loan.dueOn) })}
                            </span>
                        </Link>
                    </li>
                ))}
                {loans.length === 0 && filters.q !== "" ? (
                    <li className="py-3 text-sm text-muted-foreground">{copy.circulation.returns.noneFound}</li>
                ) : null}
            </ul>

            {chosen ? (
                <form onSubmit={submitReturn} className="max-w-md space-y-4">
                    <fieldset>
                        <legend className="mb-2 text-sm font-medium">
                            {copy.circulation.returns.conditionLegend}
                        </legend>
                        <div className="flex flex-wrap gap-2">
                            {CONDITIONS.map((value) => (
                                <Button
                                    key={value}
                                    type="button"
                                    variant={form.data.condition === value ? "default" : "outline"}
                                    className="h-11"
                                    onClick={() => form.setData("condition", value)}
                                >
                                    {copy.catalogue.condition[value]}
                                </Button>
                            ))}
                        </div>
                        {errors.condition ? (
                            <p className="mt-1 text-sm text-destructive">{errors.condition}</p>
                        ) : null}
                    </fieldset>

                    {worse ? (
                        <label className="block">
                            <span className="mb-1 block text-sm font-medium">
                                {copy.circulation.returns.noteLabel}
                            </span>
                            <Input value={form.data.note} onChange={(e) => form.setData("note", e.target.value)} />
                        </label>
                    ) : null}

                    <div className="flex items-center gap-4">
                        <Button type="submit" className="h-14 px-8 text-base" disabled={form.processing}>
                            {copy.circulation.returns.confirmButton}
                        </Button>
                        <Link
                            href={route("shelves.manage.returns.lost", {
                                shelf: shelf.slug,
                                q: filters.q || undefined,
                                loan: chosen.loanId,
                            })}
                            className="text-sm text-muted-foreground underline"
                        >
                            {copy.circulation.returns.reportLostLink}
                        </Link>
                    </div>
                </form>
            ) : (
                <p className="text-sm text-muted-foreground">{copy.circulation.returns.chooseFirst}</p>
            )}
        </ManageLayout>
    );
}
```

(`copy.catalogue.condition` is 1a's six-label map — verify the exact key path in `copy.ts` (`catalogue.condition` vs a sibling) and use whatever 1a shipped; do not add a second condition-label map.)

Create `resources/js/pages/manage/returns/lost.tsx`:

```tsx
import { Head, Link, useForm, usePage } from "@inertiajs/react";
import { type FormEvent } from "react";
import { route } from "ziggy-js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ManageLayout from "@/layouts/manage-layout";
import { copy, t } from "@/lib/copy";
import { formatDate } from "@/lib/dates";
import type { SharedData } from "@/types";

interface PageProps extends SharedData {
    filters: { q: string };
    chosen: {
        loanId: string;
        copyId: string;
        copyCode: string;
        title: string;
        borrowerName: string;
        dueOn: string;
    } | null;
}

export default function ReturnsLost() {
    const { shelf, filters, chosen, errors } = usePage<PageProps>().props;
    const form = useForm({ note: "" });
    if (!shelf) return null;

    const submit = (event: FormEvent) => {
        event.preventDefault();
        if (!chosen) return;
        // ReportCopyLost's second entry point — the 1a route, unchanged.
        form.post(route("shelves.manage.copies.report-lost", { shelf: shelf.slug, bookCopy: chosen.copyId }));
    };

    return (
        <ManageLayout>
            <Head title={copy.circulation.returns.lostTitle} />
            <h1 className="mb-4 text-2xl font-semibold">{copy.circulation.returns.lostTitle}</h1>

            {errors.rule ? (
                <p role="alert" className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
                    {errors.rule}
                </p>
            ) : null}

            {chosen ? (
                <form onSubmit={submit} className="max-w-md space-y-4">
                    <div className="rounded-md border px-4 py-3">
                        <p className="font-serif text-base">{chosen.title}</p>
                        <p className="text-sm text-muted-foreground">
                            {chosen.copyCode} · {chosen.borrowerName}
                        </p>
                        <p className="text-sm text-muted-foreground">
                            {t(copy.circulation.returns.dueLine, { date: formatDate(chosen.dueOn) })}
                        </p>
                    </div>

                    <p className="text-sm">
                        {t(copy.circulation.returns.lostExplain, { code: chosen.copyCode })}
                    </p>

                    <label className="block">
                        <span className="mb-1 block text-sm font-medium">
                            {copy.circulation.returns.lostNoteLabel}
                        </span>
                        <Input value={form.data.note} onChange={(e) => form.setData("note", e.target.value)} />
                    </label>

                    <Button type="submit" variant="destructive" className="h-14 px-8 text-base" disabled={form.processing}>
                        {copy.circulation.returns.lostConfirmButton}
                    </Button>
                </form>
            ) : (
                <p className="text-sm text-muted-foreground">{copy.circulation.returns.chooseFirst}</p>
            )}

            <Link
                href={route("shelves.manage.returns", { shelf: shelf.slug, q: filters.q || undefined })}
                className="mt-6 inline-block text-sm underline"
            >
                {copy.circulation.returns.backToReturns}
            </Link>
        </ManageLayout>
    );
}
```

- [ ] **Step 6: Run the tests, verify they pass**

Run: `make test FILTER=ReturnScreensTest`
Expected: PASS. Then `bun run build && bun run lint` (Biome clean).

- [ ] **Step 7: Lint, analyse, commit**

```bash
make lint && make analyse
git add app/Http/Requests/Circulation/ReceiveReturnRequest.php app/Http/Controllers/Manage/ReturnController.php \
  resources/js/pages/manage/returns resources/js/lib/copy.ts routes/web.php lang/vi/rules.php \
  tests/Feature/Circulation/ReturnScreensTest.php
git commit -m "feat: return screens — two-tap condition flow and the lost-copy exit"
```

---

### Task 12: The overdue screen, and the book-detail entry points (Cho mượn / Nhận trả / Huỷ lượt mượn)

Read first: `old_next/src/app/tu-sach/[shelf]/quan-ly/qua-han/page.tsx`, OPS §5's "A second, shorter entry point: book detail", BR §16.3 "Overdue" ("that phone number is the actual mechanism by which books come back, so it must be tappable").

**Files:**
- Create: `app/Http/Requests/Circulation/VoidLoanRequest.php`
- Create: `app/Http/Controllers/Manage/OverdueController.php`
- Create: `app/Http/Controllers/Manage/LoanController.php`
- Create: `resources/js/pages/manage/overdue.tsx`
- Modify: `routes/web.php` (overdue GET, void POST)
- Modify: `app/Queries/ManagerBookDetailQuery.php` (each on-loan copy row gains `activeLoanId`)
- Modify: `resources/js/pages/manage/books/show.tsx` (the three entry points)
- Modify: `resources/js/lib/copy.ts` (extend `circulation` with `overdue` and `voidLoan` blocks)
- Test: `tests/Feature/Circulation/OverdueScreenTest.php`
- Test: `tests/Feature/Circulation/VoidLoanScreenTest.php`

**Interfaces:**
- Consumes: `OverdueLoansQuery::run` (Task 8), `VoidLoan::execute` (Task 6), `ManagerBookDetailQuery` (1a — copy rows already carry `state`, `holderName`, `dueOn`).
- Produces: routes `shelves.manage.overdue` (GET, `?sort=`), `shelves.manage.loans.void` (POST `/loans/{loan}/void` — `reason`). Book-detail affordances: **Cho mượn** (title-level, visible when a copy is available → `manage.lend.reader?book={slug}` — quick-lend's three taps become two, OPS §5), **Nhận trả** (per on-loan copy → `manage.returns?q={copy code}` — the loan pre-found by its unambiguous code), **Huỷ lượt mượn** (per on-loan copy, required-reason inline form → `manage.loans.void` — open question 2's invented button).

- [ ] **Step 1: Write the failing tests**

Create `tests/Feature/Circulation/OverdueScreenTest.php`:

```php
<?php

use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Inertia\Testing\AssertableInertia;

/** @return array{Bookshelf, User} */
function ovdFix(string $slug = 'dong-thap-ovd'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);
    $manager = User::factory()->create(['full_name' => 'Maria Nhắc Trả Sách']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);
    $reader = User::factory()->create(['full_name' => 'Giuse Quên Trả Sách', 'phone' => '0912999888']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $reader->id, 'role' => 'reader', 'status' => 'active',
    ]);
    $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Totto-chan Bên Cửa Sổ', 'slug' => 'ttc-ovd']);
    $copy = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0701', 'state' => 'on_loan']);
    Loan::query()->create([
        'bookshelf_id' => $shelf->id, 'copy_id' => $copy->id, 'book_id' => $book->id,
        'borrower_id' => $reader->id, 'lent_by' => $manager->id,
        'due_on' => '2026-08-01', 'status' => 'active',
    ]);
    app(TenantContext::class)->clear();

    return [$shelf, $manager];
}

it('lists overdue loans with days late and the borrower\'s phone', function () {
    \Carbon\Carbon::setTestNow(\Carbon\Carbon::parse('2026-08-28 03:00:00', 'UTC'));
    [$shelf, $manager] = ovdFix();

    $this->actingAs($manager)
        ->get(route('shelves.manage.overdue', ['shelf' => $shelf->slug]))
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('manage/overdue')
            ->count('loans', 1)
            ->where('loans.0.daysLate', 27)
            ->where('loans.0.borrowerPhone', '0912999888')
            ->where('sort', 'most-late'));
    \Carbon\Carbon::setTestNow();
});

it('a guest is redirected to login', function () {
    // Its own it() block, and named only for what it asserts (review fix:
    // the draft title claimed "a reader 404s" and never checked one). The
    // reader case is the block below — separate, because SessionGuard
    // caches the actingAs user for the rest of a method.
    [$shelf] = ovdFix(slug: 'dong-thap-ovd-guest');
    $this->get(route('shelves.manage.overdue', ['shelf' => $shelf->slug]))
        ->assertRedirect(route('login'));
});

it('a reader 404s on the overdue screen — 404, never 403 (BR §5.4)', function () {
    [$shelf] = ovdFix(slug: 'dong-thap-ovd-reader');
    $reader = User::query()->where('full_name', 'Giuse Quên Trả Sách')->firstOrFail();

    $this->actingAs($reader)
        ->get(route('shelves.manage.overdue', ['shelf' => $shelf->slug]))
        ->assertNotFound();
});
```

Create `tests/Feature/Circulation/VoidLoanScreenTest.php`:

```php
<?php

use App\Enums\CopyState;
use App\Enums\LoanStatus;
use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Inertia\Testing\AssertableInertia;

/** @return array{Bookshelf, User, Loan, BookCopy, Book} */
function vlsFix(string $slug = 'dong-thap-vls'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);
    $manager = User::factory()->create(['full_name' => 'Maria Bấm Nhầm Tay']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);
    $reader = User::factory()->create(['full_name' => 'Anna Không Hề Mượn']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $reader->id, 'role' => 'reader', 'status' => 'active',
    ]);
    $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Đất Rừng Phương Nam', 'slug' => 'drpn-vls']);
    $copy = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0801', 'state' => 'on_loan']);
    $loan = Loan::query()->create([
        'bookshelf_id' => $shelf->id, 'copy_id' => $copy->id, 'book_id' => $book->id,
        'borrower_id' => $reader->id, 'lent_by' => $manager->id,
        'due_on' => '2026-09-11', 'status' => 'active',
    ]);
    app(TenantContext::class)->clear();

    return [$shelf, $manager, $loan, $copy, $book];
}

it('the book detail hands the page each on-loan copy\'s activeLoanId', function () {
    [$shelf, $manager, $loan, , $book] = vlsFix();

    $this->actingAs($manager)
        ->get(route('shelves.manage.books.show', ['shelf' => $shelf->slug, 'book' => $book->slug]))
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('manage/books/show')
            ->where('detail.copies.0.activeLoanId', $loan->id));
});

it('voiding from the book page needs a reason, voids, and returns there', function () {
    [$shelf, $manager, $loan, $copy, $book] = vlsFix(slug: 'dong-thap-vls-post');

    $from = route('shelves.manage.books.show', ['shelf' => $shelf->slug, 'book' => $book->slug]);

    $this->actingAs($manager)->from($from)
        ->post(route('shelves.manage.loans.void', ['shelf' => $shelf->slug, 'loan' => $loan->id]), ['reason' => ''])
        ->assertSessionHasErrors('reason');

    $this->actingAs($manager)->from($from)
        ->post(route('shelves.manage.loans.void', ['shelf' => $shelf->slug, 'loan' => $loan->id]),
            ['reason' => 'Ghi nhầm bạn đọc'])
        ->assertRedirect($from);

    expect($loan->fresh()->status)->toBe(LoanStatus::Voided)
        ->and($copy->fresh()->state)->toBe(CopyState::Available);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `make test FILTER=OverdueScreenTest && make test FILTER=VoidLoanScreenTest`
Expected: FAIL.

- [ ] **Step 3: Implement — routes, requests, controllers, query addition**

Routes (replace the under-construction `overdue` entry; add the void POST beside the copy actions):

```php
        Route::get('/overdue', [OverdueController::class, 'index'])->name('overdue');
        Route::post('/loans/{loan}/void', [LoanController::class, 'void'])->name('loans.void');
```

Create `app/Http/Requests/Circulation/VoidLoanRequest.php`:

```php
<?php

namespace App\Http\Requests\Circulation;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

class VoidLoanRequest extends FormRequest
{
    public function authorize(): bool
    {
        abort_unless(Gate::allows('act-as-manager'), 404);

        return true;
    }

    /** @return array<string, list<string>> */
    public function rules(): array
    {
        // Required at the screen; the Action's own trim-check remains the
        // backstop (the suspension-reason screen/command split, 1b).
        return [
            'reason' => ['bail', 'required', 'string', 'max:500', 'encoding:UTF-8'],
        ];
    }
}
```

Create `app/Http/Controllers/Manage/OverdueController.php`:

```php
<?php

namespace App\Http\Controllers\Manage;

use App\Http\Controllers\Controller;
use App\Models\Bookshelf;
use App\Queries\OverdueLoansQuery;
use App\Support\QueryParam;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class OverdueController extends Controller
{
    public function index(Request $request, Bookshelf $shelf, OverdueLoansQuery $overdue): Response
    {
        $sort = QueryParam::first($request, 'sort');
        $sort = in_array($sort, ['most-late', 'least-late', 'borrower'], true) ? $sort : 'most-late';

        return Inertia::render('manage/overdue', [
            'sort' => $sort,
            'loans' => $overdue->run($sort),
        ]);
    }
}
```

Create `app/Http/Controllers/Manage/LoanController.php`:

```php
<?php

namespace App\Http\Controllers\Manage;

use App\Actions\Circulation\VoidLoan;
use App\Http\Controllers\Controller;
use App\Http\Requests\Circulation\VoidLoanRequest;
use App\Models\Bookshelf;
use App\Models\Loan;
use App\Models\User;
use Illuminate\Http\RedirectResponse;

class LoanController extends Controller
{
    public function void(VoidLoanRequest $request, Bookshelf $shelf, Loan $loan, VoidLoan $voidLoan): RedirectResponse
    {
        /** @var User $user */
        $user = $request->user();

        $voidLoan->execute($user, $loan, $request->validated()['reason']);

        return back();
    }
}
```

In `app/Queries/ManagerBookDetailQuery.php`, the per-copy mapping already resolves `$loan = $activeLoans->get($copy->id)`; add one key beside `holderName`/`dueOn`:

```php
                'activeLoanId' => $loan?->id,
```

- [ ] **Step 4: The overdue page and the book-detail affordances**

Extend `copy.ts`'s `circulation` block:

```ts
        overdue: {
            title: "Sách quá hạn",
            sortMostLate: "Trễ nhất trước",
            sortLeastLate: "Trễ ít trước",
            sortBorrower: "Theo tên bạn đọc",
            daysLate: "Trễ {days} ngày",
            dueLine: "Hạn trả {date}",
            empty: "Không có sách nào quá hạn. Tuyệt vời!",
            noPhone: "Chưa có số điện thoại",
        },
        voidLoan: {
            button: "Huỷ lượt mượn",
            reasonLabel: "Lý do huỷ",
            confirm: "Huỷ",
        },
        entryPoints: {
            lend: "Cho mượn",
            receive: "Nhận trả",
        },
```

Create `resources/js/pages/manage/overdue.tsx`:

```tsx
import { Head, router, usePage } from "@inertiajs/react";
import { route } from "ziggy-js";
import ManageLayout from "@/layouts/manage-layout";
import { copy, t } from "@/lib/copy";
import { formatDate } from "@/lib/dates";
import type { SharedData } from "@/types";

interface OverdueRow {
    loanId: string;
    copyCode: string;
    title: string;
    borrowerName: string;
    borrowerPhone: string | null;
    dueOn: string;
    daysLate: number;
}

interface PageProps extends SharedData {
    sort: "most-late" | "least-late" | "borrower";
    loans: OverdueRow[];
}

const SORTS = [
    ["most-late", copy.circulation.overdue.sortMostLate],
    ["least-late", copy.circulation.overdue.sortLeastLate],
    ["borrower", copy.circulation.overdue.sortBorrower],
] as const;

export default function ManageOverdue() {
    const { shelf, sort, loans } = usePage<PageProps>().props;
    if (!shelf) return null;

    return (
        <ManageLayout>
            <Head title={copy.circulation.overdue.title} />
            <h1 className="mb-4 text-2xl font-semibold">{copy.circulation.overdue.title}</h1>

            <select
                className="mb-4 h-9 rounded-md border border-input bg-background px-2 text-sm"
                value={sort}
                onChange={(e) => router.get(route("shelves.manage.overdue", { shelf: shelf.slug, sort: e.target.value }))}
            >
                {SORTS.map(([value, label]) => (
                    <option key={value} value={value}>
                        {label}
                    </option>
                ))}
            </select>

            {loans.length === 0 ? (
                <p className="text-sm text-muted-foreground">{copy.circulation.overdue.empty}</p>
            ) : (
                <ul className="divide-y border-y">
                    {loans.map((loan) => (
                        <li key={loan.loanId} className="flex items-center justify-between gap-3 py-3">
                            <div className="min-w-0">
                                <p className="truncate font-serif text-base">{loan.title}</p>
                                <p className="truncate text-sm text-muted-foreground">
                                    {loan.copyCode} · {loan.borrowerName}
                                </p>
                                <p className="text-sm text-muted-foreground">
                                    {t(copy.circulation.overdue.dueLine, { date: formatDate(loan.dueOn) })}
                                </p>
                            </div>
                            <div className="shrink-0 text-right">
                                <p className="text-sm font-medium text-destructive">
                                    {t(copy.circulation.overdue.daysLate, { days: loan.daysLate })}
                                </p>
                                {/* BR §16.3: the phone is the mechanism by
                                    which books come back — tappable. */}
                                {loan.borrowerPhone ? (
                                    <a href={`tel:${loan.borrowerPhone}`} className="text-sm underline">
                                        {loan.borrowerPhone}
                                    </a>
                                ) : (
                                    <span className="text-sm text-muted-foreground">
                                        {copy.circulation.overdue.noPhone}
                                    </span>
                                )}
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </ManageLayout>
    );
}
```

In `resources/js/pages/manage/books/show.tsx`:

1. The copy-row interface gains `activeLoanId: string | null`.
2. Beside the page heading, when any copy row has `state === "available"`, render the title-level lend shortcut (a `Link` styled as the page's secondary button — one terracotta per screen, and this page's primary is already taken):

```tsx
                <Button asChild variant="outline">
                    <Link href={route("shelves.manage.lend.reader", { shelf: shelf.slug, book: detail.book.slug })}>
                        {copy.circulation.entryPoints.lend}
                    </Link>
                </Button>
```

3. In each copy row's action cluster, when `copyRow.state === "on_loan"`, add the receive shortcut and the void form (the reference's affordance plus open question 2's button):

```tsx
                {copyRow.state === "on_loan" ? (
                    <>
                        <Button asChild variant="outline" size="sm">
                            <Link href={route("shelves.manage.returns", { shelf: shelf.slug, q: copyRow.code })}>
                                {copy.circulation.entryPoints.receive}
                            </Link>
                        </Button>
                        {copyRow.activeLoanId ? <VoidLoanForm loanId={copyRow.activeLoanId} /> : null}
                    </>
                ) : null}
```

with a small local component at the bottom of the file:

```tsx
function VoidLoanForm({ loanId }: { loanId: string }) {
    const { shelf } = usePage<SharedData>().props;
    const form = useForm({ reason: "" });
    const [open, setOpen] = useState(false);
    if (!shelf) return null;

    if (!open) {
        return (
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
                {copy.circulation.voidLoan.button}
            </Button>
        );
    }

    return (
        <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
                e.preventDefault();
                form.post(route("shelves.manage.loans.void", { shelf: shelf.slug, loan: loanId }), {
                    preserveScroll: true,
                });
            }}
        >
            <Input
                value={form.data.reason}
                onChange={(e) => form.setData("reason", e.target.value)}
                placeholder={copy.circulation.voidLoan.reasonLabel}
                className="h-9 w-48"
            />
            <Button type="submit" variant="destructive" size="sm" disabled={form.processing}>
                {copy.circulation.voidLoan.confirm}
            </Button>
        </form>
    );
}
```

(Add the missing imports — `useForm`, `useState`, `Input` — to the file's existing import lines; render `form.errors.reason` and the shared `errors.rule` beside the form the same way the page's other forms do.)

- [ ] **Step 5: Run the tests, verify they pass**

Run: `make test FILTER=OverdueScreenTest && make test FILTER=VoidLoanScreenTest && make test FILTER=ManageBookScreens`
Expected: PASS — including 1a's existing book-show suite (the added prop must not break its assertions).

- [ ] **Step 6: Lint, analyse, commit**

```bash
make lint && make analyse
git add app/Http/Requests/Circulation/VoidLoanRequest.php app/Http/Controllers/Manage/OverdueController.php \
  app/Http/Controllers/Manage/LoanController.php resources/js/pages/manage/overdue.tsx \
  resources/js/pages/manage/books/show.tsx app/Queries/ManagerBookDetailQuery.php resources/js/lib/copy.ts \
  routes/web.php tests/Feature/Circulation/OverdueScreenTest.php tests/Feature/Circulation/VoidLoanScreenTest.php
git commit -m "feat: overdue screen, book-detail lend/return shortcuts, void button"
```

---
### Task 13: The reader's own pages — dashboard with renew, and the history

Read first: `old_next/src/app/tu-sach/[shelf]/(doc-gia)/ho-so/tong-quan/page.tsx` (the loans section and the renew form), `ho-so/lich-su/page.tsx`, BR §16.2, and `old_next/tests/domain/circulation/my-dashboard.test.ts`'s renew tests.

**Files:**
- Create: `app/Http/Controllers/Reader/MyLoansController.php`
- Create: `resources/js/pages/shelves/profile/overview.tsx`
- Create: `resources/js/pages/shelves/profile/history.tsx`
- Modify: `routes/web.php` (replace the under-construction `profile.overview` and `profile.history`; add the renew POST)
- Modify: `resources/js/lib/copy.ts` (extend `circulation` with the `myLoans` block)
- Test: `tests/Feature/Circulation/ReaderDashboardScreenTest.php`

**Interfaces:**
- Consumes: `MyDashboardQuery::run(User)`, `MyLoanHistoryQuery::run(User, int)` (Task 9 shapes), `RenewLoan::execute` (Task 5), `QueryParam::first`.
- Produces: routes `shelves.profile.overview` (GET), `shelves.profile.history` (GET, `?page=`), `shelves.profile.loans.renew` (POST `/profile/loans/{loan}/renew`, no body). All three inside the existing `['auth', 'role:reader']` profile group — a guest redirects, a non-member 404s, for free.

- [ ] **Step 1: Write the failing tests**

Create `tests/Feature/Circulation/ReaderDashboardScreenTest.php`:

```php
<?php

use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Inertia\Testing\AssertableInertia;

/** @return array{Bookshelf, User, Loan} */
function rdbFix(string $slug = 'dong-thap-rdb'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);
    $manager = User::factory()->create(['full_name' => 'Maria Trực Quầy Sách']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);
    $reader = User::factory()->create(['full_name' => 'Têrêsa Đọc Ở Nhà']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $reader->id, 'role' => 'reader', 'status' => 'active',
    ]);
    $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Dế Mèn Phiêu Lưu Ký', 'slug' => 'de-men-rdb']);
    $copy = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0901', 'state' => 'on_loan']);
    $loan = Loan::query()->create([
        'bookshelf_id' => $shelf->id, 'copy_id' => $copy->id, 'book_id' => $book->id,
        'borrower_id' => $reader->id, 'lent_by' => $manager->id,
        'due_on' => '2026-09-04', 'status' => 'active',
    ]);
    app(TenantContext::class)->clear();

    return [$shelf, $reader, $loan];
}

it('the overview shows the reader\'s loans with days remaining and a live renew button', function () {
    \Carbon\Carbon::setTestNow(\Carbon\Carbon::parse('2026-09-01 03:00:00', 'UTC'));
    [$shelf, $reader] = rdbFix();

    $this->actingAs($reader)
        ->get(route('shelves.profile.overview', ['shelf' => $shelf->slug]))
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('shelves/profile/overview')
            ->count('dashboard.loans', 1)
            ->where('dashboard.loans.0.daysRemaining', 3)
            ->where('dashboard.loans.0.renewBlockedBy', null));
    \Carbon\Carbon::setTestNow();
});

it('renewing from the dashboard moves the date the dashboard shows', function () {
    [$shelf, $reader, $loan] = rdbFix(slug: 'dong-thap-rdb-renew');

    $this->actingAs($reader)
        ->post(route('shelves.profile.loans.renew', ['shelf' => $shelf->slug, 'loan' => $loan->id]))
        ->assertRedirect()
        ->assertSessionHas('success');

    expect($loan->fresh()->due_on->toDateString())->toBe('2026-09-11')
        ->and($loan->fresh()->renewals_used)->toBe(1);
});

it('a second renewal comes back as errors.rule with the renewals sentence', function () {
    [$shelf, $reader, $loan] = rdbFix(slug: 'dong-thap-rdb-cap');
    $this->actingAs($reader)
        ->post(route('shelves.profile.loans.renew', ['shelf' => $shelf->slug, 'loan' => $loan->id]));

    $this->actingAs($reader)
        ->post(route('shelves.profile.loans.renew', ['shelf' => $shelf->slug, 'loan' => $loan->id]))
        ->assertSessionHasErrors(['rule' => 'Bạn đã dùng hết số lần gia hạn cho lượt mượn này.']);
});

it('the history page keeps a returned loan and says how it came back', function () {
    [$shelf, $reader, $loan] = rdbFix(slug: 'dong-thap-rdb-hist');
    app(TenantContext::class)->actSystemWide();
    Loan::query()->whereKey($loan->id)->update([
        'status' => 'returned', 'return_condition' => 'worn',
        'returned_at' => '2026-08-25 08:00:00',
    ]);
    app(TenantContext::class)->clear();

    $this->actingAs($reader)
        ->get(route('shelves.profile.history', ['shelf' => $shelf->slug]))
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('shelves/profile/history')
            ->where('history.total', 1)
            ->where('history.rows.0.status', 'returned')
            ->where('history.rows.0.returnCondition', 'worn'));
});

it('another reader\'s renew POST is refused as loan_not_active — never an existence oracle', function () {
    [$shelf, , $loan] = rdbFix(slug: 'dong-thap-rdb-other');
    app(TenantContext::class)->actSystemWide();
    $other = User::factory()->create(['full_name' => 'Gioan Không Phải Chủ']);
    Membership::factory()->for(Bookshelf::query()->where('slug', 'dong-thap-rdb-other')->firstOrFail())->create([
        'user_id' => $other->id, 'role' => 'reader', 'status' => 'active',
    ]);
    app(TenantContext::class)->clear();

    $this->actingAs($other)
        ->post(route('shelves.profile.loans.renew', ['shelf' => $shelf->slug, 'loan' => $loan->id]))
        ->assertSessionHasErrors(['rule' => 'Lượt mượn này đã được xử lý.']);
    expect($loan->fresh()->renewals_used)->toBe(0);
});

it('a guest is redirected to login', function () {
    [$shelf] = rdbFix(slug: 'dong-thap-rdb-guest');
    $this->get(route('shelves.profile.overview', ['shelf' => $shelf->slug]))
        ->assertRedirect(route('login'));
});
```

- [ ] **Step 2: Run to verify failure**

Run: `make test FILTER=ReaderDashboardScreenTest`
Expected: FAIL.

- [ ] **Step 3: Routes and controller**

In `routes/web.php`'s profile group, replace the two under-construction entries and add the POST:

```php
        Route::get('/history', [MyLoansController::class, 'history'])->name('history');
        Route::get('/overview', [MyLoansController::class, 'overview'])->name('overview');
        Route::post('/loans/{loan}/renew', [MyLoansController::class, 'renew'])->name('loans.renew');
```

Create `app/Http/Controllers/Reader/MyLoansController.php`:

```php
<?php

namespace App\Http\Controllers\Reader;

use App\Actions\Circulation\RenewLoan;
use App\Http\Controllers\Controller;
use App\Models\Bookshelf;
use App\Models\Loan;
use App\Models\User;
use App\Queries\MyDashboardQuery;
use App\Queries\MyLoanHistoryQuery;
use App\Support\QueryParam;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * BR §16.2's "My page", the loans half (plan open question 5): current
 * loans with days remaining and Xin gia hạn, recently returned, and the
 * full history. The requests section is Phase 2's; the page renders its
 * named empty state meanwhile.
 */
class MyLoansController extends Controller
{
    public function overview(Request $request, Bookshelf $shelf, MyDashboardQuery $dashboard): Response
    {
        /** @var User $user */
        $user = $request->user();

        return Inertia::render('shelves/profile/overview', [
            'dashboard' => $dashboard->run($user),
        ]);
    }

    public function history(Request $request, Bookshelf $shelf, MyLoanHistoryQuery $history): Response
    {
        /** @var User $user */
        $user = $request->user();

        return Inertia::render('shelves/profile/history', [
            'history' => $history->run($user, (int) QueryParam::first($request, 'page', '1')),
        ]);
    }

    public function renew(Request $request, Bookshelf $shelf, Loan $loan, RenewLoan $renewLoan): RedirectResponse
    {
        /** @var User $user */
        $user = $request->user();

        $result = $renewLoan->execute($user, $loan);

        return back()->with('success', __('rules.renew_success_flash', ['due' => $result['dueOn']]));
    }
}
```

Add to `lang/vi/rules.php`:

```php
    'renew_success_flash' => 'Đã gia hạn — hạn trả mới là :due.',
```

- [ ] **Step 4: Client copy and the two pages**

Extend `copy.ts`'s `circulation` block:

```ts
        myLoans: {
            overviewTitle: "Trang của tôi",
            historyTitle: "Lịch sử mượn sách",
            currentSection: "Sách đang mượn",
            requestsSection: "Đăng ký mượn",
            requestsComingSoon: "Chức năng đăng ký mượn sẽ có trong đợt cập nhật sau.",
            recentSection: "Vừa trả gần đây",
            daysRemaining: "Còn {days} ngày",
            dueToday: "Đến hạn hôm nay",
            overdueDays: "Quá hạn {days} ngày",
            dueLine: "Hạn trả {date}",
            renewButton: "Xin gia hạn",
            renewedLine: "Đã gia hạn {count} lần",
            returnedLine: "Đã trả ngày {date}",
            lentLine: "Mượn ngày {date}",
            statusReturned: "Đã trả",
            statusActive: "Đang mượn",
            statusLost: "Báo mất",
            statusVoided: "Đã huỷ",
            emptyLoans: "Bạn chưa mượn cuốn nào. Ra tủ sách chọn một cuốn nhé!",
            emptyHistory: "Chưa có lượt mượn nào.",
            prev: "Trước",
            next: "Sau",
        },
```

Create `resources/js/pages/shelves/profile/overview.tsx`:

```tsx
import { Head, useForm, usePage } from "@inertiajs/react";
import { route } from "ziggy-js";
import { Button } from "@/components/ui/button";
import AppLayout from "@/layouts/app-layout";
import { copy, t } from "@/lib/copy";
import { formatDate } from "@/lib/dates";
import type { SharedData } from "@/types";

interface MyLoanRow {
    loanId: string;
    title: string;
    slug: string;
    copyCode: string;
    dueOn: string;
    isOverdue: boolean;
    daysRemaining: number;
    renewalsUsed: number;
    renewBlockedBy: keyof typeof copy.circulation.rules | null;
}

interface PageProps extends SharedData {
    dashboard: {
        loans: MyLoanRow[];
        recentlyReturned: { loanId: string; title: string; slug: string; returnedOn: string; returnCondition: string }[];
    };
}

function RenewForm({ loan }: { loan: MyLoanRow }) {
    const { shelf } = usePage<SharedData>().props;
    const form = useForm({});
    if (!shelf) return null;

    if (loan.renewBlockedBy) {
        return <p className="text-sm text-muted-foreground">{copy.circulation.rules[loan.renewBlockedBy]}</p>;
    }

    return (
        <form
            onSubmit={(e) => {
                e.preventDefault();
                form.post(route("shelves.profile.loans.renew", { shelf: shelf.slug, loan: loan.loanId }), {
                    preserveScroll: true,
                });
            }}
        >
            <Button type="submit" variant="outline" size="sm" disabled={form.processing}>
                {copy.circulation.myLoans.renewButton}
            </Button>
        </form>
    );
}

export default function ProfileOverview() {
    const { dashboard, errors, flash } = usePage<PageProps>().props;

    return (
        <AppLayout>
            <Head title={copy.circulation.myLoans.overviewTitle} />
            <h1 className="mb-4 text-2xl font-semibold">{copy.circulation.myLoans.overviewTitle}</h1>

            {flash.success ? (
                <p role="status" className="mb-4 rounded-md border border-green-700/30 bg-green-700/10 px-3 py-2 text-sm">
                    {flash.success}
                </p>
            ) : null}
            {errors.rule ? (
                <p role="alert" className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
                    {errors.rule}
                </p>
            ) : null}

            <h2 className="mb-2 text-lg font-medium">{copy.circulation.myLoans.currentSection}</h2>
            {dashboard.loans.length === 0 ? (
                <p className="mb-6 text-sm text-muted-foreground">{copy.circulation.myLoans.emptyLoans}</p>
            ) : (
                <ul className="mb-6 divide-y border-y">
                    {dashboard.loans.map((loan) => (
                        <li key={loan.loanId} className="flex items-center justify-between gap-3 py-3">
                            <div className="min-w-0">
                                <p className="truncate font-serif text-base">{loan.title}</p>
                                <p className="text-sm text-muted-foreground">
                                    {loan.copyCode} · {t(copy.circulation.myLoans.dueLine, { date: formatDate(loan.dueOn) })}
                                </p>
                                <p className={`text-sm ${loan.isOverdue ? "font-medium text-destructive" : "text-muted-foreground"}`}>
                                    {loan.isOverdue
                                        ? t(copy.circulation.myLoans.overdueDays, { days: -loan.daysRemaining })
                                        : loan.daysRemaining === 0
                                          ? copy.circulation.myLoans.dueToday
                                          : t(copy.circulation.myLoans.daysRemaining, { days: loan.daysRemaining })}
                                </p>
                            </div>
                            <div className="shrink-0">
                                <RenewForm loan={loan} />
                            </div>
                        </li>
                    ))}
                </ul>
            )}

            {/* Phase 2's requests half — the named empty state, plan open
                question 5, so a reader is told rather than shown a hole. */}
            <h2 className="mb-2 text-lg font-medium">{copy.circulation.myLoans.requestsSection}</h2>
            <p className="mb-6 text-sm text-muted-foreground">{copy.circulation.myLoans.requestsComingSoon}</p>

            <h2 className="mb-2 text-lg font-medium">{copy.circulation.myLoans.recentSection}</h2>
            {dashboard.recentlyReturned.length === 0 ? (
                <p className="text-sm text-muted-foreground">{copy.circulation.myLoans.emptyHistory}</p>
            ) : (
                <ul className="divide-y border-y">
                    {dashboard.recentlyReturned.map((row) => (
                        <li key={row.loanId} className="flex items-center justify-between gap-3 py-3">
                            <p className="truncate font-serif text-base">{row.title}</p>
                            <span className="shrink-0 text-sm text-muted-foreground">
                                {t(copy.circulation.myLoans.returnedLine, { date: formatDate(row.returnedOn) })}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </AppLayout>
    );
}
```

Create `resources/js/pages/shelves/profile/history.tsx`:

```tsx
import { Head, Link, usePage } from "@inertiajs/react";
import { route } from "ziggy-js";
import AppLayout from "@/layouts/app-layout";
import { copy, t } from "@/lib/copy";
import { formatDate } from "@/lib/dates";
import type { SharedData } from "@/types";

interface HistoryRow {
    loanId: string;
    title: string;
    slug: string;
    copyCode: string;
    lentOn: string;
    dueOn: string;
    status: "active" | "returned" | "lost" | "voided";
    returnedOn: string | null;
    returnCondition: string | null;
}

interface PageProps extends SharedData {
    history: { rows: HistoryRow[]; page: number; pageCount: number; total: number };
}

const STATUS_LABEL = {
    active: copy.circulation.myLoans.statusActive,
    returned: copy.circulation.myLoans.statusReturned,
    lost: copy.circulation.myLoans.statusLost,
    voided: copy.circulation.myLoans.statusVoided,
} as const;

export default function ProfileHistory() {
    const { shelf, history } = usePage<PageProps>().props;
    if (!shelf) return null;

    return (
        <AppLayout>
            <Head title={copy.circulation.myLoans.historyTitle} />
            <h1 className="mb-4 text-2xl font-semibold">{copy.circulation.myLoans.historyTitle}</h1>

            {history.rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">{copy.circulation.myLoans.emptyHistory}</p>
            ) : (
                <ul className="divide-y border-y">
                    {history.rows.map((row) => (
                        <li key={row.loanId} className="py-3">
                            <div className="flex items-center justify-between gap-3">
                                <p className="truncate font-serif text-base">{row.title}</p>
                                <span className="shrink-0 text-sm">{STATUS_LABEL[row.status]}</span>
                            </div>
                            <p className="text-sm text-muted-foreground">
                                {row.copyCode} · {t(copy.circulation.myLoans.lentLine, { date: formatDate(row.lentOn) })}
                                {row.returnedOn
                                    ? ` · ${t(copy.circulation.myLoans.returnedLine, { date: formatDate(row.returnedOn) })}`
                                    : ""}
                            </p>
                            {row.returnCondition ? (
                                <p className="text-sm text-muted-foreground">
                                    {copy.catalogue.condition[row.returnCondition as keyof typeof copy.catalogue.condition]}
                                </p>
                            ) : null}
                        </li>
                    ))}
                </ul>
            )}

            {history.pageCount > 1 ? (
                <div className="mt-4 flex gap-2">
                    {history.page > 1 ? (
                        <Link
                            href={route("shelves.profile.history", { shelf: shelf.slug, page: history.page - 1 })}
                            className="text-sm underline"
                        >
                            {copy.circulation.myLoans.prev}
                        </Link>
                    ) : null}
                    {history.page < history.pageCount ? (
                        <Link
                            href={route("shelves.profile.history", { shelf: shelf.slug, page: history.page + 1 })}
                            className="text-sm underline"
                        >
                            {copy.circulation.myLoans.next}
                        </Link>
                    ) : null}
                </div>
            ) : null}
        </AppLayout>
    );
}
```

(As in Task 11: `copy.catalogue.condition` names 1a's condition-label map — verify its exact path in `copy.ts` and reuse it; never a second map. `AppLayout` is the reader-area layout the shelves pages already use — mirror `shelves/catalogue.tsx`'s import.)

- [ ] **Step 5: Run the tests, verify they pass**

Run: `make test FILTER=ReaderDashboardScreenTest`
Expected: PASS. Then `bun run build && bun run lint`.

- [ ] **Step 6: Lint, analyse, commit**

```bash
make lint && make analyse
git add app/Http/Controllers/Reader/MyLoansController.php resources/js/pages/shelves/profile \
  resources/js/lib/copy.ts routes/web.php lang/vi/rules.php tests/Feature/Circulation/ReaderDashboardScreenTest.php
git commit -m "feat: reader dashboard and history — days remaining and xin gia han"
```

---

### Task 14: The guarantee sweep — architecture pins, the OPS walk, known-gaps

The 1a/1b closing discipline: re-verify the phase's claims against the shipped code, pin what must not silently change, and write the durable record.

**Files:**
- Modify: `tests/Unit/Catalogue/RuleViolatedCodesHaveSentencesTest.php` (the census list)
- Create: `tests/Feature/Architecture/CirculationArchitectureTest.php`
- Modify: `tests/support/TenantHarness.php` — only if the isolation census needs it (it already seeds a colliding `Loan` and `ConditionAssessment` per shelf; verify, do not duplicate)
- Modify: `database/seeders/DemoShelfSeeder.php` (one active loan, one overdue loan)
- Modify: `docs/known-gaps.md` (the Phase 1c section)
- Modify: this plan's `Status:` header

- [ ] **Step 1: Update the literal-code census**

The new literal `new RuleViolated('…')` codes under `app/` from this phase: `loan_not_active` (ReceiveReturn, RenewLoan), `loan_not_active_cannot_void` (VoidLoan), `reason_required` (VoidLoan), plus `shelf_not_found` occurrences (already in the list). Add to `RuleViolatedCodesHaveSentencesTest`'s `toEqualCanonicalizing` array:

```php
        'loan_not_active',
        'loan_not_active_cannot_void',
        'reason_required',
```

Run the census test; if the glob finds a code this list missed (or vice versa), the DIFF is the finding — resolve it by fixing whichever side is wrong, never by widening the regex.

- [ ] **Step 2: The architecture pins**

Create `tests/Feature/Architecture/CirculationArchitectureTest.php`:

```php
<?php

use Illuminate\Support\Facades\Route;

it('every circulation write transaction opens with a FOR UPDATE — the grep pin', function () {
    // Belt to the per-command query-log braces: each Action file must
    // contain lockForUpdate. Position is pinned per command in its own
    // test; this catches a NEW circulation Action shipped without any lock
    // at all.
    foreach ([
        app_path('Actions/Circulation/LendCopy.php'),
        app_path('Actions/Circulation/ReceiveReturn.php'),
        app_path('Actions/Circulation/RenewLoan.php'),
        app_path('Actions/Circulation/VoidLoan.php'),
    ] as $file) {
        expect(str_contains((string) file_get_contents($file), 'lockForUpdate'))
            ->toBeTrue(basename($file).' has no lockForUpdate');
    }
});

it('HandoverRequest and the borrow-request commands have no route — Phase 2\'s, by decision', function () {
    // The 1a DeleteBook / 1b ManagerRegisterReader precedent: absence is
    // pinned so wiring one later is a decision, not an accident.
    $uris = collect(Route::getRoutes()->getRoutes())->map(fn ($r) => $r->uri());

    foreach (['handover', 'borrow-requests/{', 'requests/{'] as $fragment) {
        expect($uris->first(fn (string $uri) => str_contains($uri, $fragment)))
            ->toBeNull("unexpected Phase-2 route: {$fragment}");
    }
});

it('the lend and return POST routes are manager-gated, the renew POST reader-gated', function () {
    $routes = collect(Route::getRoutes()->getRoutes());

    $lend = $routes->first(fn ($r) => $r->getName() === 'shelves.manage.lend.store');
    $return = $routes->first(fn ($r) => $r->getName() === 'shelves.manage.returns.store');
    $void = $routes->first(fn ($r) => $r->getName() === 'shelves.manage.loans.void');
    $renew = $routes->first(fn ($r) => $r->getName() === 'shelves.profile.loans.renew');

    foreach ([$lend, $return, $void] as $route) {
        expect($route)->not->toBeNull()
            ->and($route->gatherMiddleware())->toContain('role:manager');
    }
    expect($renew)->not->toBeNull()
        ->and($renew->gatherMiddleware())->toContain('role:reader')
        ->and($renew->gatherMiddleware())->not->toContain('role:manager');
});

it('returns/lost is declared before returns/{loan} — spec §6\'s declaration-order rule', function () {
    $uris = collect(Route::getRoutes()->getRoutes())
        ->map(fn ($r) => $r->uri())
        ->filter(fn (string $uri) => str_contains($uri, 'returns'))
        ->values();

    $lost = $uris->search(fn (string $uri) => str_ends_with($uri, 'returns/lost'));
    $bound = $uris->search(fn (string $uri) => str_contains($uri, 'returns/{loan}'));

    expect($lost)->toBeInt()->and($bound)->toBeInt()
        ->and($lost)->toBeLessThan($bound);
});

it('no Action under app/Actions/Circulation calls now() — the Clock rule, greppable', function () {
    // REVIEW FIX: the title this replaces said "nothing under app/" while
    // the body walks app/Actions/Circulation only. Either widen the walk to
    // app_path() with an allow-list (Clock.php itself, and any 1a/1b file
    // that already trips it — measure before widening), or keep the narrow
    // walk and this narrow title. A test whose name overclaims its body is
    // how a rule gets believed without being enforced.
    // Clock is the only place Carbon reads the wall clock. A circulation
    // file calling now() bypasses setTestNow-driven derivations and BR
    // §5.4's timezone rule at once.
    $offenders = [];
    $files = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator(app_path('Actions/Circulation'), FilesystemIterator::SKIP_DOTS)
    );
    foreach ($files as $file) {
        $src = (string) file_get_contents($file->getPathname());
        // (?<!>) excludes `$this->clock->now()` — the Clock's own method IS
        // the sanctioned door; what this bans is the bare now() helper and
        // the static Carbon reads.
        if (preg_match('/(?<![->])\bnow\(\)|Carbon::now|CarbonImmutable::now/', $src) === 1) {
            $offenders[] = basename($file->getPathname());
        }
    }
    expect($offenders)->toBe([]);
});
```

Run: `make test FILTER=CirculationArchitectureTest` — expected PASS; then verify each pin is falsifiable (comment a `lockForUpdate`, re-run, watch it fail, restore).

- [ ] **Step 3: The tenant-isolation walk**

Run the full `TenantIsolation` and `Tenancy` suites. `TenantHarness` already seeds a colliding `Loan`, `BorrowRequest` and `ConditionAssessment` per shelf, and `RouteIsolationTest` walks the route map — confirm the NEW routes (`manage/lend*`, `manage/returns*`, `manage/overdue`, `profile/overview`, `profile/history`) appear in its walked set (its mechanism enumerates the route table; if any of this phase's GET routes is excluded by name, add it). A member of shelf A must get **404, not 403**, on every one of them under shelf B's slug, and no Inertia prop may carry a foreign `bookshelf_id`.

- [ ] **Step 4: The OPS §4.2 walk — the ledger check**

Walk the census against the shipped branch and record the result in the known-gaps entry (Step 6):

| OPS §4.2 entry | Disposition |
|---|---|
| `LendCopy` | shipped (Task 3), both entry points (dashboard flow + book detail) |
| `HandoverRequest` | Phase 2 (holds); route absence pinned |
| `ReceiveReturn` | shipped narrowed (Task 4, divergence 4); hold branch Phase 2 |
| `RenewLoan` | shipped (Task 5); Q4 = allowed, pinned by name |
| `VoidLoan` | shipped (Task 6) + the invented button (open question 2) |
| `CreateBorrowRequest` / `ApproveBorrowRequest` / `RejectBorrowRequest` / `CancelOwnRequest` | Phase 2 |
| `SkipRequest` | Phase 2 — and NO reference implementation exists to port |

And the queries: `SearchBooksForLending`, `SearchReadersForLending`, `SearchLoansForReturn`, `GetOverdueLoans`, `GetMyDashboard` (loans half), `GetMyLoanHistory` shipped; `GetBorrowRequestQueue` Phase 2; `GetManagerDashboard`, `ExportLoansCSV` 1d; `ResolveCopyById` Phase 2.

- [ ] **Step 5: Seed a living shelf**

In `database/seeders/DemoShelfSeeder.php`, after the demo readers, add one active loan and one overdue loan so the lend/return/overdue screens demo with real rows. **Respect the seeder's own trap** (known-gaps: name-reuse collisions): resolve the borrower by username (`docgia1`-style keys if present) or create a NEW distinctly-named user, never by a `full_name` the seeder already used; pick two seeded copies that exist and are `available`, flip them `on_loan` in the same block that creates the loans; the overdue loan's `due_on` is `Clock::today()` minus 10 days, the active one's plus 10.

Run: `php artisan migrate:fresh --seed` — then `make test FILTER=SeederTest`.

- [ ] **Step 6: Write the known-gaps section**

Append `## Phase 1c — Circulation` to `docs/known-gaps.md`, recording at minimum:

- The **OPS walk table** from Step 4 (with the `SkipRequest`-has-no-reference note for Phase 2's planner).
- **`ReceiveReturn`'s narrowed contract** and the exact reference behaviour Phase 2 must restore (`receive-return.ts`: `holdForRequestId` resolution, the `request.approved` second audit row in the same transaction, `hold_expires_at` from the injected clock, the copy never observably `available`, the `queuedRequestId` answer read AFTER the writes with the `requested_at, id` ordering).
- **`LendCopy`'s hold-collection branch is unported** — the reference closes a collected hold (`request.fulfilled`) inside the lend transaction; Phase 2 must port it when holds exist, and `LoanRules::copyLendable`'s held-for-me clause is already live and unit-tested waiting for it.
- **INV-5's guarantee is the membership-row lock, not an index** — stronger than the reference (which could race past the limit), but a caller bypassing `LendCopy` bypasses it; the only index-backed circulation invariant is INV-1.
- **`RenewLoan`'s queue check has no structural backstop** — a pending request committing concurrently slips past; unreachable in 1c (nothing creates requests), Phase 2 decides whether to care.
- **The `ReceiveReturn`/`ReportCopyLost`/`VoidLoan` lock order (copy → loan) is a convention enforced by tests, not by the database** — any future circulation command must follow it or re-open the AB-BA deadlock this phase closed (divergence 2's blind-overwrite reproduction recorded).
- **The implicit FK shared locks, and the shelf-row contention they create** (divergence 1's second paragraph): every command's audit insert takes S on the shelf's `bookshelves` row, `LendCopy`'s loans insert takes S on `bookshelves`/`books`/`book_copies`/`users`, and 1a's `AllocateCopyCodes` holds that same `bookshelves` row in **X** for the whole of `CreateBook`/`AddCopies`. No cycle — the wait is one-directional — but an in-flight bulk copy-add serialises every lend, return, renewal and void on that shelf. Named so Phase 2 does not rediscover it, and so a future command that inverts the direction is recognised as the cycle it would be.
- **Step 1's block flag is hold-aware and `ChooseCopy` is not.** `SearchBooksForLendingQuery` derives `blocked` from `CountsCopies::borrowable()`, which excludes an `available` copy carrying an unexpired approved hold; `ChooseCopy::lowestLendable` reads only `book_copies.state` and would auto-pick that same copy on the confirm screen. Unreachable in 1c (nothing creates holds), and consistent as long as `ApproveBorrowRequest` also flips the copy to `held` — **Phase 2 must either guarantee that or teach `ChooseCopy` the hold**, or step 1 and step 3 disagree, which is exactly what divergence 9 exists to prevent.
- **The copyless-title sentence defect** (open question 4) and the **no-copy-selector divergence** from BR §16.3 (divergence 9), both reference-faithful.
- **The VoidLoan button and the two flash sentences (`lend_success_flash`, `return_success_flash`, `renew_success_flash`) are authored by this plan**, not by OPS — the `member_has_active_loans` precedent.
- **The escape hatch lands on the on-behalf (pending) form** — reference parity; the walk-up child still needs approval before a lend (open question 3, with 1b's open question 1 still live).
- **Due-soon/overdue notifications do not exist yet** — Phase 2's sweep; the overdue SCREEN is live and correct meanwhile (BR §8).
- Anything Steps 1–5 turned up.

- [ ] **Step 7: Full suite, lint, analyse, status, commit**

```bash
make test
make lint && make analyse
bun run build && bun run lint
```

Expected: everything green. Update this plan's `Status:` to `Complete`, then:

```bash
git add tests/Unit/Catalogue/RuleViolatedCodesHaveSentencesTest.php tests/Feature/Architecture/CirculationArchitectureTest.php \
  database/seeders/DemoShelfSeeder.php docs/known-gaps.md docs/superpowers/plans/2026-08-29-laravel-phase-1c-circulation.md
git commit -m "test: circulation guarantee sweep, ops walk and the durable record"
```

---

## Execution notes

- Tasks 1→6 are strictly ordered (groundwork → policy → commands). Tasks 7–9 depend on 1–2 only and may run in parallel with 3–6. Tasks 10–13 depend on their command + query tasks. Task 14 is last.
- Where a sketch in this plan calls a 1b helper (`ParishContextQuery::run()`, `ParishUnits::describeSelection`, `copy.catalogue.condition`), the shipped signature wins over the sketch — read the file, mirror the existing caller, and keep the plan's behaviour.
- Every task ends with `make lint && make analyse` green at level 8 before its commit; no task leaves the suite red for the next.
