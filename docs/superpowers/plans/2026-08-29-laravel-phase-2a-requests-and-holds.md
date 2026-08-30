# Laravel Migration — Phase 2a: Requests, Holds, Notifications, the Sweep — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Reviewed and fixed (2026-08-29, post-review round). Both product-owner questions are ANSWERED and recorded as rulings below — nothing in this plan is still open. Ready to execute.

**Goal:** The waiting queue, end to end: a reader presses "Xin mượn" on a title (`CreateBorrowRequest`), a manager works the queue — approve onto a copy with a visible hold expiry (`ApproveBorrowRequest`), decline with an optional reason (`RejectBorrowRequest`), hand the held book over (`HandoverRequest` → the one `LendCopy` implementation) — a reader withdraws their own place (`CancelOwnRequest`), `ReceiveReturn` is re-widened to its reference shape so a returned copy can be held for the next child without ever being observably available in between, every reader-facing event lands as an in-app notification written in the same transaction as the fact it announces, and the 07:00 Asia/Ho_Chi_Minh sweep writes the due-soon and overdue reminders that no command can (`reminders:sweep`).

**What this plan is not.** Spec §11's "Phase 2 — Community" is split into three plans (the split is recorded in `docs/superpowers/HANDOFF.md`):

- **2a — this plan.** Borrow requests, holds and the queue; the notifications system (kinds, write path, reader list, mark-read, the bell); the reminder sweep; the `ReceiveReturn` and `LendCopy` re-widenings 1c's docblocks promised.
- **2b — community voice.** Comments and moderation (INV-09), announcements, feedback, donations. The `comment_approved` notification kind arrives THERE, with `ApproveComment`, its writer — see divergence 7.
- **2c — statistics and QR labels.** `ResolveCopyById`, the scan pages, and therefore the `copyId` input on `CreateBorrowRequest` — see divergence 3.

**The OPS §4.2 census, taken fresh for this plan.** Phase 1c implemented four of §4.2's ten commands and pinned the rest as Phase 2's. This plan implements **five**: `CreateBorrowRequest`, `ApproveBorrowRequest`, `RejectBorrowRequest`, `CancelOwnRequest`, `HandoverRequest`. It re-widens two shipped ones: `ReceiveReturn` (the `holdForRequestId`/`queuedRequestId`/`request.approved`/notification quartet its own docblock names) and `LendCopy` (the collected-hold close, `request.fulfilled`). The tenth, **`SkipRequest`, is implemented by nobody and that is now verified as a product decision, not a gap**: the reference queue page's own comment block (`old_next/src/app/tu-sach/[shelf]/quan-ly/yeu-cau-muon/page.tsx:91-110`) records that the product owner answered OPS §4.2's "least well-specified command" question **by removing the *Bỏ qua* button** (2026-08-09) — *Từ chối*, with its reader-visible reason, is the only decision a manager makes about a queued request. 1c's known-gaps row "`SkipRequest` — Phase 2, and no reference implementation exists to port" is closed by Task 19 with this citation, not by writing the command.

**Who approves and rejects — verified, not assumed.** The scope note asked whether approve/reject is "manager or volunteer". The reference's rule is `requireManager` on all three manager-side commands (`approve-borrow-request.ts`, `reject-borrow-request.ts`, `handover-request.ts`) and on the queue query (`get-borrow-request-queue.ts`). In this system the volunteers standing at the shelf ARE the members holding the `manager` role (BR §13.1; BR §16 titles its manager walks "the volunteer walks"); there is no separate volunteer role in `membership_role` (`reader | manager | admin`). So: `role:manager` middleware plus `act-as-manager` gates, exactly as 1c gated lend/return. `create` and `cancel` are `reader (own … only)` per OPS §4.2, enforced the way the reference enforces them — by comparing user ids, never by rank alone.

**The query census (OPS §3).** This plan implements `GetBorrowRequestQueue` (§3.3, with its `bookId` narrowing for the return screen and the badge-count companion), `GetMyNotifications` (§3.2), and the **requests half of `GetMyDashboard`** that 1c's plan explicitly left as "an explicit empty state until then" (1c's open question 5). It extends `GetManagerDashboard` with the third of BR §16.3's four stat cards (pending requests — the fourth, pending comments, is 2b's) and `GetBookDetail` (reader) with the caller's own request. `ResolveCopyById` stays 2c's.

**Architecture:** unchanged from 1a–1d: single-purpose Action classes in `app/Actions/Circulation/`, pure predicates in `app/Support/Circulation/`, read shapes in `app/Queries/`, Form Requests in `app/Http/Requests/Circulation/`, thin controllers, Inertia pages, Vietnamese copy in `resources/js/lib/copy.ts` + `lang/vi/`, English URIs. The one NEW architectural element is `app/Support/Notifications/` — the kinds map, the sentence renderer and the write path — mirroring `app/Support/Audit/`'s shape, because the reference's `src/domain/notifications/` makes exactly the same argument for it that `audit-actions.ts` made for the audit map: the map is the type, an uncovered kind is a build failure, and the Vietnamese is rendered from the stored payload at read time, never stored pre-glued.

**Tech Stack:** unchanged — PHP 8.4, Laravel 13, Inertia v3, React 19, Tailwind v4, MariaDB 10.11, Pest 5, Larastan level 8, Pint, Biome 2, Bun.

**Spec:** docs/superpowers/specs/2026-08-26-laravel-mariadb-inertia-migration-design.md

**The reference implementation is the specification.** `old_next/src/domain/circulation/commands/{create,approve,reject}-borrow-request.ts`, `cancel-own-request.ts`, `handover-request.ts`, the FULL `receive-return.ts` and `lend-copy.ts` (the shapes 1c narrowed), `queries/get-borrow-request-queue.ts`, `get-my-dashboard.ts` (requests half), and the whole of `old_next/src/domain/notifications/` — plus the tests: `old_next/tests/domain/circulation/borrow-requests.test.ts` (33 tests, the core), `borrow-request-queue.test.ts`, `borrow-request-by-copy.test.ts` (2c's, see divergence 3), `receive-return.test.ts` (the hold-branch middle that 1c skipped), `tests/invariants/inv-03-only-available-or-own-hold.test.ts` (all ten), `tests/domain/notifications/notifications.test.ts`, `the-sweep-is-housekeeping.test.ts`, `tests/architecture/notifications-are-reader-facing.test.ts`, `tests/lib/borrow-request-actions.test.ts`. **Every Action task below starts by reading the TypeScript it ports.** Where this plan diverges, the divergence is named inline with its reason. The divergences, collected:

1. **The lock order extends 1c's, and it is: copy → loan → membership → request, audit last.** 1c fixed copy-before-loan and copy-before-membership; every command here that touches a request row alongside a copy or loan takes the request lock LAST. Concretely: `ApproveBorrowRequest` locks the **copy** (its input) then the **request**; `CancelOwnRequest` locks the **copy** first *when the route-bound snapshot names one* (`copy_id` is an in-memory attribute, no query — the exact 1c `ReceiveReturn` idiom), then the **request**; `ReceiveReturn` locks copy → loan → the **pending hold-for request** (a third lock the reference never took — its `resolveHold` was a plain read that a concurrent `CancelOwnRequest` could invalidate mid-transaction); `RejectBorrowRequest` touches no copy and locks only the request; `LendCopy` keeps copy → membership and its collected-hold close is a guarded UPDATE on a row whose copy lock it already holds; `HandoverRequest` takes **no locks of its own** (divergence 11). Each locking command's test pins lock **position** with the `$log[0]` query-log idiom, `DB::flushQueryLog()` between commands (never `disableQueryLog()`, which does not clear the buffer).

   **One AB–BA edge this plan CREATES, recorded at Task 8 rather than claimed away.** `LendCopy`'s re-widening (Task 8) makes it hold the **copy** lock and then take a row lock on `borrow_requests` when it closes a collected hold. `CancelOwnRequest` (Task 7) has a documented residual window that is the mirror image: when the route-bound snapshot names no copy — a request bound before its approval — it locks the **request** first and the guarded release takes the copy's row lock second. Both can name the same (copy C, request R) pair, so `LendCopy` can hold C waiting on R while `CancelOwnRequest` holds R waiting on C. That is an InnoDB deadlock: errno **1213**, arriving as a `QueryException` (nothing translates it — `UniqueViolation` handles 1062 only) and rolling the whole transaction back, so the manager sees a server error rather than a Vietnamese sentence. Before Task 8, `LendCopy` touched no `borrow_requests` row and this counterparty did not exist. **No frequency is claimed and none was measured** — a two-connection race cannot run under `RefreshDatabase`, and this plan's house rule is that a cycle claim needs two real OS processes to earn it. There is no better ordering available inside one transaction without a retry loop, so the edge is accepted and written down rather than designed away. Task 19 carries it into known-gaps.

   **One ordering that no test can pin, flagged so a later reviewer does not delete it.** `LendCopy.php`'s `orderBy('requested_at')->orderBy('id')` on the hold probe survives deletion with the whole suite green. Task 5's polish round deleted the analogous line from `ApproveBorrowRequest` for exactly that reason — correctly, because that probe asks only whether a live hold EXISTS. `LendCopy`'s does not: the row's identity decides `loans.request_id` and which request gets closed. Two live holds on one copy are unreachable today (Task 5 writes `held` in the same transaction as the hold), which is why no test can distinguish the ordered from the unordered version — that unreachability is the argument for keeping it, not for dropping it.

   **One residual window is documented rather than claimed away, and no cycle-free claim is made for it.** `CancelOwnRequest` bound while its request was `pending` (snapshot `copy_id` null → no copy lock taken) can find, under its request lock, that a concurrent approval has since attached a copy; its guarded release (`UPDATE book_copies SET state='available' WHERE id=? AND state='held'`) then wants a copy lock *after* the request lock — the one place this phase's order inverts. The partner that could hold that copy X while wanting this request X is a mid-flight `HandoverRequest`/`LendCopy` collecting the same hold. The interleaving requires the reader's cancel to bind pre-approval and reach its copy write mid-handover of a hold approved after their page loaded; the loser gets InnoDB's 1213 and the transaction rolls back whole (nothing half-applied — that is the transaction's property). The reference took **zero** locks in any of these commands, so every schedule this window admits, the reference admitted plus more. Task 19 records the window in `docs/known-gaps.md` with this exact interleaving, per the house rule that a *deadlock-freedom* claim needs two real OS processes — this plan claims a *window*, not its absence, so the burden is the record, not the reproduction.
2. **`CreateBorrowRequest` takes NO lock at all, and the duplicate rule becomes a constraint instead.** The reference's `duplicate_request` check is a plain read ("no unique index on `(book_id, member_id)` — verified against `pg_indexes`… two taps in the same second produce two pending rows", its own docblock). This plan's first draft answered that with `Book::query()->lockForUpdate()` as the transaction's first statement. **That was wrong, and it is withdrawn.** `app/Actions/Catalogue/UpdateBook.php:73-84` opens its transaction with `DB::table('bookshelves')->where('id', $bookshelfId)->lockForUpdate()` and then WRITES the book row — an exclusive lock on the `books` clustered record — while this command's own `borrow_requests` insert and its audit insert each take a SHARED lock on the shelf's `bookshelves` row through their `RESTRICT` foreign keys (`2026_08_26_000019_add_composite_tenant_fks.php:34` for the composite book FK; `docs/known-gaps.md:1633-1640` records the audit-insert edge). A book lock here therefore closes a real AB–BA cycle:

   ```
   T1  UpdateBook (a manager fixes a typo):    X(bookshelves S1) ──► wants X(books B)
   T2  CreateBorrowRequest (a child taps):     X(books B)        ──► wants S(bookshelves S1)
   ```

   Both are clustered-record locks, so the secondary-index luck that saves the `book_copies ↔ memberships` near-miss (known-gaps.md:1706-1724) does not apply, and the reachable case is mundane: a title being renamed while a child taps *Xin mượn* on it.

   **The decision, and it is a decision, not a menu:** this command takes no `lockForUpdate` anywhere, and the rule the lock was protecting becomes a **partial unique index** — `borrow_requests.live_request_key`, a STORED generated column `IF(deleted_at IS NULL AND status IN ('pending','approved'), CONCAT(book_id, ':', member_id), NULL)` under a UNIQUE constraint (Task 1's migration). Three shipped tables already carry exactly this shape — `loans.active_copy_id` (INV-1), `profile_change_requests.pending_user_id` (INV-13), `bookshelves.slug` — and it is strictly stronger than any lock could be: two taps in the same millisecond cannot both land, at any isolation level, from any number of PHP workers. The plain read stays as the *sentence* half (the friendly refusal in the common case); the losing insert's errno 1062 is translated by the shipped `App\Support\UniqueViolation::translate`, matched BY CONSTRAINT NAME, exactly as `LendCopy` translates `loans_one_active_per_copy`. This is 1c's own two-part shape ("locked re-reads + pure predicates for the common case; the INSERT, judged by the index, for the case BR §2 describes") with the lock half removed because the uniqueness it was protecting is now the index's job — NOT because the write stopped serialising; see the paragraph below, which is careful about exactly this.

   Moving the serialisation point to `bookshelves` instead — matching `UpdateBook`/`AllocateCopyCodes` — was the other candidate, and it is rejected on ONE ground, which is enough: it would create a NEW edge of the cycle known-gaps.md:1653-1700 has already REPRODUCED with two real OS processes — a transaction holding `X(bookshelves)` and then wanting `S(users:actor)` through its own audit insert, against `UpdateReaderProfile`/`SetReaderCredentials` (`app/Actions/Members/UpdateReaderProfile.php:61,69,108` — X `memberships`, X `users`, then the audit insert) holding `X(users)` and wanting `S(bookshelves)`. Adding the reader-facing queue entry point to that family is the opposite of the fix.

   **A second reason was offered in an earlier draft and is withdrawn as false**, recorded here rather than quietly deleted because it is the kind of plausible sentence this project keeps having to run down. It said option 2 "would make every child's *Xin mượn* queue behind a bulk `AddCopies` run". Measured with the no-lock design in place: a transaction holding `SELECT id FROM bookshelves WHERE id = ? FOR UPDATE` makes an ordinary `INSERT INTO borrow_requests` wait for that transaction's whole life (a deliberate 3 s sleep) before it lands — because `borrow_requests_bookshelf_id_foreign` takes a SHARED lock on that shelf row on every insert, which known-gaps.md:1633-1640 already records. The queueing exists with or without option 2; what option 2 would have added is the exclusive edge, not the wait. No weight rests on the withdrawn claim.

   **No cycle-freedom claim is made anywhere in this plan — not for this command, not for any other.** The house rule is that such a claim needs two real OS processes to earn it, and this plan contains no task that runs them; the residual window in divergence 1 is likewise recorded, never claimed away. What IS claimed here is exactly one thing, and it is pinned by a test rather than by reading: **`CreateBorrowRequest` contains no `lockForUpdate` call at all** (Task 4's grep pin, plus a query-log filter). No inference is drawn from it.

   In particular, **the index does not remove serialisation; it relocates it**, and the plan says so rather than implying otherwise. An INSERT holds an implicit exclusive record lock on the unique-index entry it creates until the transaction commits, so two racing creates for the same `(book_id, member_id)` really do queue — measured: the loser waited for the winner's whole transaction (a deliberate 3 s sleep — the duration is the sleep, not a property of the index) before receiving `ERROR 1062 … for key 'borrow_requests_one_live_per_title_member'`. What changes versus a `books` `FOR UPDATE` is not "no waiting" but *which row is locked and by what*: an index entry created by this insert, rather than a `books` row that `UpdateBook` also takes exclusively. The waiting is fine; the AB–BA was not.

   Verified live against the `laravel-mariadb-1` container before this plan was fixed, not reasoned about: the DDL applies to the shipped `borrow_requests` table; a second `pending` row for the same `(book_id, member_id)` raises `ERROR 1062 (23000): Duplicate entry 'b1:u1' for key 'borrow_requests_one_live_per_title_member'`; `approved` holds the key as `pending` does; and `fulfilled`, `rejected`, `cancelled`, `expired` and soft-deleted rows every one release it, so a reader whose request ended may queue for that title again.
3. **`CreateBorrowRequest` ships without the reference's optional `copyId`** (the QR-scan "which copy prompted this" record, `borrow-request-by-copy.test.ts`). Nothing in 2a can produce a scanned copy id — `ResolveCopyById`, the scan pages and the labels themselves are 2c. Shipping the parameter with no caller would be the "implemented, reachable from nowhere" shape 1b's ledger existed to close. The 1c `ReceiveReturn` precedent applies: the narrowing is stated in the Action's docblock, recorded in known-gaps (Task 19) with the exact reference behaviour 2c restores — the nullable `copy_id` on create, the same-title/same-shelf/not-deleted guards, the `copy_id` key in the `request.created` audit payload (which this plan writes as an always-present `null` so the payload shape does not change when 2c lands).
4. **The `membershipId` input is dropped; the session is the scope.** The reference's create takes a caller-supplied `membershipId` and compares it against `ctx.actor.membershipId` because its form posted a hidden field. Here `TenantContext::membership()` IS the caller's own membership of the bound shelf (ResolveTenant resolved it from the session — the same place the reference's `guards.ts` resolved its), so there is no field to lie in; the Action still compares `membership->user_id` against the acting user defensively. Same shape for `CancelOwnRequest`: OWNERSHIP is `borrow_requests.member_id === $actor->id` — both sides `users.id`, the trap the reference's docblock calls out by name (a membership id on either side is never equal and every cancel would refuse).
5. **Notification payload dates are Asia/Ho_Chi_Minh civil dates, rendered d/m/Y.** The reference stores `hold_until` and `due_on` as `toISOString().slice(0,10)` — the **UTC** civil date — and renders them raw ("nhận trước ngày 2026-09-01"). Every other date in this system is the parish's day (`Clock::today()`, spec §5.4), and AGENTS.md's language rule is "dates read as dates". So the payload stores `Y-m-d` computed in `Asia/Ho_Chi_Minh`, and `NotificationSentences` renders it `d/m/Y`. Two small, named corrections to the reference, both citing house rules older than this plan.
6. **`request.approved`'s audit payload carries `userId` from BOTH doors.** The reference writes it from `ApproveBorrowRequest` and omits it from `ReceiveReturn`'s hold branch, which makes the second door's entry subject-less in the audit browser. One payload shape, both doors — the reference's own "same payload shape … so one resolution rule covers both" comment, applied to itself.
7. **The kinds map grows per task and holds six kinds at this phase's end** — `membership_approved`, `membership_rejected`, `request_approved`, `request_rejected`, `loan_due_soon`, `loan_overdue`. The reference's seventh, `comment_approved`, arrives in 2b with `ApproveComment`, its writer, because the ported architecture test (`NotificationsAreReaderFacingTest`) holds kind↔writer set-equal in both directions at every commit — a kind with no writer is exactly what it exists to refuse. (BR §15 also lists profile-change approved/rejected notifications; the reference implements neither — no kind, no writer — and the profile-change queues are Phase 3's, so Task 19 records that pair in known-gaps as Phase 3's to decide, with the BR line cited.)
8. **`RenewLoan`'s queue check stays a plain, unlocked read** — the decision 1c's known-gaps entry deferred to "Phase 2". A pending request committing between that read and the renewal's commit is indistinguishable, to every observer, from one arriving a second after the renewal — the reader keeps a book they were entitled to renew at the instant they asked. The reference made the same read the same way. Task 19 updates the known-gaps entry from "Phase 2 decides" to this decision and its reasoning.
9. **The sweep inserts through Eloquent, not `INSERT … SELECT`.** The reference's two set-based inserts rely on Postgres generating ids; here every id is an application-generated UUIDv7 (`HasUuids`) and MariaDB 10.11 has no v7 function, so the command selects the candidate loans (two queries) and creates `Notification` rows one by one inside one transaction. The idempotence predicate is identical in meaning: per loan and per kind, "already told" is the existence of a notification with the same user, kind, `due_on` and title — the notification itself is the cursor, exactly as `sweep.ts` argues (no `last_swept_at` to drift, roll back, or be reset by a restore).
10. **The bell is a header link with a count, not a dropdown.** The shipped Laravel layout is deliberately spare (no badges anywhere; the 1d dashboard's cards are the counts). `unreadNotifications` becomes a lazy shared prop and the header renders "Thông báo (3)" linking to the notifications page — BR §15's "a bell with an unread count" satisfied without inventing a dropdown no other screen has.
11. **`HandoverRequest`'s pre-flight reads run OUTSIDE any transaction, and the one write transaction is `LendCopy`'s.** The reference reads the request unlocked and delegates; under the house rule "every circulation write transaction's first statement is a lock", the clean port is: no transaction of handover's own — its reads pick the kind sentence (`hold_expired`, `request_not_held`), then `LendCopy::execute` opens the transaction with the copy lock and re-establishes every fact on locked rows. A hold that lapses or is cancelled in the microseconds between produces `copy_not_available` instead of `hold_expired` — a stale *sentence* in a race the reference had identically, never a wrong write. Locking the request first instead would invert divergence 1's order against `LendCopy` and `CancelOwnRequest` and manufacture the AB–BA this ordering exists to avoid.

    **Corrected at Task 9: the race produces a WRITE, not only a stale sentence.** The sentence above promised "a stale *sentence* in a race the reference had identically, never a wrong write". That is not the full set of outcomes, and the omission was found by the implementer reading the two files' shapes. If a `CancelOwnRequest` commits inside the window, it releases the copy to `available` — and `LendCopy` then lends it to the reader standing at the table as an ordinary **walk-up lend that closes nobody's request**. A loan is written. It is a loan of the right copy to the right reader, and the reference had unlocked reads here too, so this is not a defect and no code changes — but "never a wrong write" was false and is withdrawn. **Task 18's `ReleaseExpiredHold` reproduces exactly this shape** and inherits the same disclosure.

    **Two constraints this places on Task 18, both discovered at Task 9:**

    - **`ReleaseExpiredHold` must NOT null `borrow_requests.copy_id` when it releases.** `HandoverRequest`'s `RequestStatus::Expired → hold_expired` branch fires only if `copy_id` is still populated; if Task 18 nulls it, the Action's earlier `copy_id === null` check fires first, the sentence silently reverts to `request_not_held`, and **the branch is dead in production while Task 9's test stays green** — that test sets `status` alone. The precedent already points the right way: `CancelOwnRequest` sets `status`/`cancelled_at` and releases the copy without touching `copy_id`. Task 18 follows it, and says in its commit that it does.
    - **Task 18 writes the same walk-up-lend race outcome as the paragraph above**, so its docblock states it rather than repeating the withdrawn "never a wrong write".
12. **Refusal code spellings are the reference's `errors.ts`, sentences verbatim** (the two-ledger rule). New keys this plan adds to `lang/vi/rules.php`: `duplicate_request`, `membership_not_active_cannot_request`, `request_not_pending`, `request_not_queued`, `no_copy_available`, `chosen_copy_lost_or_retired`, `hold_expired`, `request_not_held`, `not_own_request`, `request_already_fulfilled`, `copy_not_found` — all eleven exist in `errors.ts` already, so unlike 1c's `title_has_no_copies` **no OPS amendment is needed for the refusal SENTENCES this plan ships**. ~~One precision the review earned: `request_not_held` has **no failure-mode entry under any OPS §4.2 command** (checked by opening the file). That is defensible — OPS §4.2's `HandoverRequest` entry states its failure modes as the `/errors.ts` disjunction rather than enumerating them, and every other code this plan uses IS enumerated — but "defensible" is a thing the record must say out loud, so Task 19's OPS walk states it explicitly instead of letting this blanket sentence cover it silently.~~ **STRUCK AT THE SOURCE by Task 19's OPS walk — false in both halves, and both were checked by opening `docs/OPERATIONS.md` rather than re-reading this sentence.** (a) `request_not_held` IS enumerated in §4.2, with its Vietnamese sentence, under `ReleaseExpiredHold` — the entry Task 18 wrote on ruling 1, which is this plan's own one permitted amendment, so the claim went false *inside this phase*. (b) `HandoverRequest`'s §4.2 entry is a **plain enumerated list** (`hold_expired`, `membership_not_active`, `loan_limit_reached`), not a disjunction, and the string `errors.ts` appears nowhere in `OPERATIONS.md` — `grep -n "errors.ts" docs/OPERATIONS.md` exits 1 — so the justification describes a document that does not exist. What is actually true and remains open: `HandoverRequest` throws `request_not_held` from several branches and its OPS entry omits it, which is a **documentation lag, not a contract gap** — the shipped command already throws the code and `lang/vi/rules.php` already carries the sentence, so closing it is a one-row edit to a table, not an amendment to a contract. `docs/known-gaps.md`'s Phase 2a wrap-up section carries the full disposition. Ruling 1 adds one audit action and carries its own OPS edit (Task 18), plus one authored code, `hold_not_expired`, which has no `errors.ts` spelling and gets the `title_has_no_copies` treatment: minted with its OPS entry in the same commit.
13. **An `available` copy under somebody else's live hold is lendable, and that hole is PORTED, not closed.** `LoanRules::copyLendable`'s `available` branch returns null without looking at holds — the faithful port of `old_next/src/domain/circulation/policy.ts:86-108`. ~~The row is reachable with shipped 1a commands: approve onto copy C (`held`), `ReportCopyLost` (C → `lost`, the request still `approved` with a live hold), `MarkCopyFound` (C → `available`) — now a walk-up lend of C takes a copy promised to somebody else.~~ **STRUCK AT THE SOURCE by Task 19, which RAN the walk instead of reading it: `CopyStateMachine::ALLOWED` draws no `held → lost` arrow (BR §7.1 draws only `on_loan → lost`, and `refusalFor`'s own comment says the `to === Lost` refusal is "reached from available *and from held*"), so step two throws `copy_not_on_loan` and the sequence stops there.** Measured against the real MariaDB: a throwaway Pest block executing `ApproveBorrowRequest` → `ReportCopyLost` printed `PROBE: ReportCopyLost REFUSED with code: copy_not_on_loan`. No other command walk to the row was found — by this task, or by its reviewer's independent search — but an unsuccessful search is not a proof, so the honest statement is that the row is constructed directly in both tests that need it, exactly as Task 5's own test comment always said ("No shipped command produces available+held-for … Constructed directly"). The hole in `LoanRules::copyLendable` is real and ported regardless; what stands between it and reachability is a transition table nobody wrote as a guard for it, whose docblock calls widening the arrows into `lost` "one line here plus one test". `ApproveBorrowRequest` refuses that row (Task 5's two-clause predicate has a named test for it); `LendCopy` does not, and neither does the reference. The port keeps the reference's behaviour and adds the one guarantee that matters: the walk-up lend must never CLOSE the other reader's request (`$collectedHoldId`'s second half). Task 8 seeds exactly this row and asserts both halves — the lend succeeds, the foreign hold stays `approved` with a null `fulfilled_loan_id` — which is also what makes Task 8's second mutation check fire. Task 19 records the hole in known-gaps — **with the walk corrected, not copied**.
14. **`ChooseCopy` is NOT taught the hold predicate; `ApproveBorrowRequest` keeps step 1 and step 3 in sync instead.** known-gaps' Phase-2 landmine ("the moment `ApproveBorrowRequest` exists and flips a copy to `held`, step 1 (search) and step 3 (confirm) will disagree unless `ApproveBorrowRequest` keeps them in sync or `ChooseCopy` is taught the same predicate") names two acceptable resolutions and this plan takes the first, deliberately. `CountsCopies::borrowable()` (`app/Queries/Concerns/CountsCopies.php:33-48`) excludes an `available` copy under a live hold; `ChooseCopy::lowestLendable` (`app/Support/Circulation/ChooseCopy.php:47`) branches on `book_copies.state` alone. Every hold-creating command in this plan writes `held` in the SAME transaction as the hold (Tasks 5 and 10), so the two predicates select the same set and the quick-lend walk stays coherent with no change to `ChooseCopy` — which is pure over a `Collection<BookCopy>` and would have to be given hold data by every caller to learn the predicate. The residual is exactly divergence 13's row, and only that row. Task 19 pins the agreement with a test and amends the landmine entry to this disposition rather than leaving it open.
15. **`CancelOwnRequest` does NOT fold "no such request" into `not_own_request`, and that is a within-shelf existence oracle the reference did not have.** Added at Task 7, after the review found the divergence shipped as an inline comment only. The reference (`old_next/src/domain/circulation/commands/cancel-own-request.ts:106-110`) throws `not_own_request` when the row is missing *or* not the caller's, so a reader cannot tell a guessed uuid from a real request belonging to someone else on their own shelf. The port answers those two cases differently: `lockForUpdate()->findOrFail()` raises `ModelNotFoundException` → **404** for missing-or-foreign-shelf, while a same-shelf request belonging to another reader raises `RuleViolated('not_own_request')`, which `bootstrap/app.php:93` renders as a **302** back with the Vietnamese sentence. **Both the reviewer and the implementer verified this against the documents rather than assuming it**: OPS §4.2 (`docs/OPERATIONS.md:351-360`) lists `not_own_request` and `request_already_fulfilled` as distinct failure modes and calls the former "should be structurally unreachable via UI, but the command must still check"; spec §5.4 demands only that a *foreign shelf's* request be indistinguishable from a nonexistent one, which the 404 delivers. So the split is right and OPS is the authority — but the leak is real and belongs on this list: a reader who already has a valid request id for their own shelf can distinguish "exists, someone else's" from "does not exist". The Global Constraints sentence below is corrected to match, and Task 19 records the oracle in known-gaps.


## Global Constraints

Phase 0's, 1a's, 1b's, 1c's and 1d's Global Constraints all still bind — branch `feat/phase-2-community` (already created off merged `main`, `317a3b3`), MariaDB 10.11 via the `mariadb` driver, PHP 8.4, UUIDv7 `VARCHAR(36) ascii_bin`, `DATETIME(6)` UTC, English URIs, Pint + Larastan level 8 + Biome + tsc + Vite build clean at every commit, commit per task in lowercase `type: sentence` style. Additionally, for this plan:

- **`old_next/` is read-only.** `git diff origin/main...HEAD -- old_next/` stays empty for the whole branch. Task 19 runs that exact command and pastes its (empty) output.
- **Nothing may read before the lock, and the order is copy → loan → membership → request** (divergence 1). Route-bound models are stale snapshots; an in-memory attribute read (`$request->copy_id`) is not a query and may steer which lock comes first. Every check after a lock reads locked rows or queries issued after the first lock. `DB::flushQueryLog()` between commands in any multi-command lock-position test.
- **Derived state is computed on read** (BR §8): hold expiry is `hold_expires_at` compared against the injected clock at read time. `holdExpired` on the queue is computed per row; a lapsed hold "arrives as absence" through the `hold_expires_at > now` filter, which is what makes `LoanRules::copyLendable`'s null-holder branch fire. **Exactly one thing in this plan writes the `expired` status: `ReleaseExpiredHold` (Task 18), on the owner's ruling 1** — and it writes it only as the RECORD of a lapse the clock had already produced, at a manager's explicit request, guarded on `hold_expires_at <= now`. Expiry itself stays derived; nothing computes status from a job. If a task seems to need a *scheduled* job that flips `approved` rows to `expired`, the task is wrong — the sweep (Task 17) writes notification rows and nothing else.
- **Domain time goes through `App\Support\Clock`** — nothing calls `now()`/`Carbon::now()` directly; the sweep's window arithmetic starts from `Clock::today()` (the Asia/Ho_Chi_Minh civil date), hold expiry from `Clock::now()` (UTC instant) via `LoanTerms::holdExpiry`.
- **Every reader-facing notification is written by `Notifier::notify()` inside the command's own `DB::transaction`** — a notification cannot outlive a rolled-back approval, and an approval cannot commit without its notification. **That sentence is a guarantee, so it gets a guard that can fail**: `NotificationsAreReaderFacingTest`'s fourth test tokenises every file that calls `notifier->notify(` and asserts each call's byte offset falls inside a `DB::transaction(` closure's brace range — the token-walking shape `AuditActionCensusTest` already uses (Task 2 writes it; every later writer is covered by it automatically). This exists because moving `$this->notifier->notify(...)` to after `DB::transaction(...)` returns otherwise leaves every behavioural test in this plan green — Phase 1d's exact finding (a headline guard unwireable with 1,028 tests passing), which this project has decided not to accept a second time. The sweep is the one non-command writer (OPS §7's argued exception), writes its own rows with explicit `bookshelf_id` under `actSystemWide()`, and is named in the guard's allow-list. `NotificationsAreReaderFacingTest` also holds the kind↔writer table set-equal in both directions at every commit, so **every task that adds a kind adds its writer, its `lang/vi/notifications.php` sentence, its `NotificationSentences` match arm and its table row in the same commit**.
- **`borrow_requests.member_id` and `notifications.user_id` are `users(id)`, never membership ids** — the recurring trap the reference names in four separate docblocks. Every variable carrying one is named for the id it holds (`$userId`, `$heldForUserId`); `Notifier::notify()`'s parameter is `string $userId`.
- **Anti-enumeration (spec §5.4 — the MIGRATION DESIGN spec's "The TenantIsolation
  suite", NOT `BUSINESS-REQUIREMENTS.md`, whose §5.4 is "What is recorded about each
  thing" and contains no such rule; a Task 3 review caught this document mis-cited as
  "BR §5.4" throughout the plan, `docs/known-gaps.md` and one shipped docblock, and
  `grep -in "enumerat" docs/BUSINESS-REQUIREMENTS.md` returns nothing): refusals over
  HTTP are 404, never 403.** New routes sit behind `role:manager`/`role:reader`; every new Form Request `authorize()` is `abort_unless(Gate::allows(...), 404)`. **Corrected at Task 7 — the original sentence here was wrong against OPS §4.2 and against three shipped commands.** What actually holds: "no such request" and "another shelf's request" are indistinguishable FROM EACH OTHER, both `ModelNotFoundException` → 404, and that is the whole of the anti-enumeration guarantee spec §5.4 asks for. "Already decided" is a SEPARATE answer — `request_not_pending` for approve/reject, `request_not_held` for handover, `not_own_request` for cancel — raised as `RuleViolated` and rendered by `bootstrap/app.php:93` as a 302 back carrying the Vietnamese sentence, **never a 404 and never a 500**. It leaks nothing, because reaching it at all means `findOrFail` already resolved the row on the caller's own bound shelf. The one residual leak is divergence 15's, and it is recorded there rather than hidden behind "share one code".
- **Soft deletion is undo (BR §11):** `BorrowRequest` uses `SoftDeletes` and no query in this plan calls `withTrashed()`; the duplicate check, the queue, the hold reads and the sweep all see live rows only, via the model's own scope. **One new uniqueness rule IS added** (divergence 2): `borrow_requests_one_live_per_title_member` over the STORED generated column `live_request_key`, whose expression names `deleted_at IS NULL` explicitly, so a soft-deleted row frees its slot the way `bookshelves.slug_active` does — verified live, not assumed (divergence 2's paragraph carries the command output). Every fixture in this plan that seeds two `pending`-or-`approved` rows for one title therefore uses two DIFFERENT readers; Task 1 states the rule and the tasks that seed rivals (5, 8, 9, 10, 12, 13) each honour it.
- **No hand-written `where('bookshelf_id', <value>)`** — tenancy comes from `BookshelfScope`. The queue query's `memberships` join uses **column-to-column** equality (`memberships.bookshelf_id = borrow_requests.bookshelf_id`) — a join predicate, not a tenant filter; Task 11 confirms `TenancyArchitectureTest` stays green and says why in a comment at the join.
- **`SessionGuard` caches the `actingAs` user for a whole test method** — every actor switch is its own `it()` block or a fresh request. Fired four times on this project; zero tolerance.
- **UUID v7 keys are chronologically monotonic** — every ordering test seeds OUT of intended order, and every same-instant tiebreak test pins the mechanism (`orderBy('id')`) explicitly with a comment when the v7 id equals creation order by construction.
- **Pest traps:** prove an absence key-by-key with `array_key_exists()`; never `not->toHaveKeys([...])` (means "has ALL"), never `not->toHaveKey($k, "msg")` (passes unconditionally); never `toContain` on a whole row for a positional claim; a fixture with nothing to exclude cannot prove exclusion — every exclusion test seeds the thing to be excluded.
- **Every new literal `new RuleViolated('code')`** is written in the short, imported form and added to `RuleViolatedCodesHaveSentencesTest`'s `toEqualCanonicalizing` list **in the same task**; predicate codes returned as data are censused by their own predicate test (`RequestRulesTest`, the `LoanRulesTest` precedent) and must NOT be added to the literal census.
- **Free-text rules lead with `bail` and carry `encoding:UTF-8`** (`reason`); `FreeTextEncodingGuardTest` sweeps every Form Request automatically — new requests must pass it, not be exempted from it. Id-shaped inputs that reach a query without route binding (`copy_id`, `hold_for_request_id`) are validated `uuid` in the Form Request so an emoji in a form post is a validation message, never an errno 1267 collation 500 (the `SafeId` lesson, PR #62).
- **A `returned` loan fixture carries `return_condition`** (`loans_returned_has_condition` has broken four fixtures on this repo); an `approved` request fixture carries `copy_id`, `hold_expires_at`, `decided_by`, `decided_at` together — the shape every live approval writes — and its copy is `held`, or the fixture describes a state no command produces.
- **Fixture names dodge `UserFactory`'s pool** ('Trần Minh' is in it verbatim) and `DemoShelfSeeder`; the second-shelf template needs `TenantContext::actSystemWide()` before creating rows, then `set()` to rebind.
- **Test helper names are process-global** (AGENTS.md), and so is a top-level `const`. The COMPLETE list this plan mints — corrected after the review found the first version incomplete, so treat it as the registry, not as a sample: `lrkFix` and `lrkRow` (Task 1), `nwpFix` (2), `brpFix` (3), `cbrFix` (4), `abrFix` (5), `rjbFix` (6), `corFix` (7), `lchFix` (8), `hovFix` (9), `rrwFix` (10), `quqFix` and `quqRequest` (11), `rrsFix` (12), `drhFix` (13), `mqsFix` (14), `rhoFix` (15), `mynFix` (16), `swpFix` (17), `ehxFix` (18) — **twenty functions** — plus one top-level constant, `OPS_SECTION_7` (Task 2's census table), which is a global symbol under the same rule and would fatal on redeclaration exactly as a function would. Checked against `grep -rhn "^function \|^const " tests/`: no collision with the 1a–1d registry (`lendFix`, `retFix`, `renFix`, `voidFix`, `qlFix`, `rqFixture`, `rdrHold` etc. are TAKEN). Before adding any further helper OR constant, grep first — for both keywords.
- **`make test FILTER=…`** runs a filtered suite; `make lint` is Pint; `make analyse` is Larastan; the JS gates run via the repo's standard scripts (Biome, tsc, `bun run build` — see AGENTS.md / package.json). Scratch output goes to `.artifacts/` (gitignored).

## Product-owner rulings — ANSWERED. Do not relitigate.

This port surfaced two genuine product decisions. **Kien answered both on 2026-08-29, before any code**, and they are recorded here (and in `docs/superpowers/HANDOFF.md`) as settled. The reasoning is kept because the reasoning is what stops the question being reopened; the options are kept because a ruling with its rejected alternative beside it is a ruling somebody can check. Nothing below is still open.

### RULING 1 (was OQ1) — a lapsed hold gets a manager exit. `ReleaseExpiredHold` SHIPS; **Task 18 EXECUTES.**

**Context.** When a hold lapses (the reader never came), the copy sits in `held` and the request in `approved`. The queue screen keeps the row, flagged "Thời gian giữ chỗ đã hết" — deliberately, so the one thing going wrong stays visible. But **the reference gives the manager no way to act on it**: *Xác nhận trao sách* refuses with `hold_expired` ("…Bạn đọc cần đăng ký lại."), *Từ chối* exists only on `pending` rows (`RejectBorrowRequest` refuses `approved` with `request_not_pending`), and grep confirms no command in `old_next/src/domain/` performs `approved → expired` or frees a held copy except the READER's own `CancelOwnRequest` (`grep -rn "state = 'available'" old_next/src/domain` finds only cancel, void-loan and mark-copy-found). The queue query's own docblock says "a manager has to record `held → available` or offer it to the next reader" — and no command does it. BR §7.2 draws the arrow (`approved → expired — hold lapsed, reader never collected`), the `expired` status is in the CHECK constraint, `HandoverRequest` even checks for it defensively — and nothing ever writes it. This is the `ManagerRegisterReader` shape 1c's settled decision 3 named: a reference **gap**, not a reference **decision**.

**The rejected option (A) — port the gap faithfully.** The expired row would stay on the queue screen with only the handover button (which refuses); the copy freed only if the reader cancels. Worked example — the row a volunteer would see, before and forever after:

> **1** · **Têrêsa Lê Ngọc Ánh** — Đăng ký 14:05 24/08 · Giáo họ Đức Mẹ
> 🕒 Thời gian giữ chỗ đã hết lúc 07:00 28/08 · bản DT-0142
> [Xác nhận trao sách] → tapping it: *"Thời gian giữ chỗ đã hết. Bạn đọc cần đăng ký lại."*

DT-0142's copy row on the book page reads **Đang giữ chỗ** indefinitely; `SearchBooksForLending` counts it unavailable; the next child asking for the title is told nothing is free while the book sits on the shelf. Known-gaps records the dead end verbatim.

**THE RULING (B) — build the exit: a `ReleaseExpiredHold` command (Task 18, written below in full, and Task 18 EXECUTES).** One button on the expired row only — **Trả về kệ** — performing `approved → expired` (BR §7.2's own arrow, at last written by something) + `held → available` in one transaction, copy locked first, guarded on the hold actually having lapsed by the clock (`hold_expires_at <= now`, else refused — a manager may not yank a live hold; offering the freed copy to the next reader is then one ordinary *Duyệt & giữ chỗ*). New audit action `request.expired`, and — the `title_has_no_copies` precedent — an OPS §4.2 amendment naming the command, in the same commit that mints it. Worked example, the same row after the ruling:

> **1** · **Têrêsa Lê Ngọc Ánh** — Đăng ký 14:05 24/08 · Giáo họ Đức Mẹ
> 🕒 Thời gian giữ chỗ đã hết lúc 07:00 28/08 · bản DT-0142
> [Xác nhận trao sách] [Trả về kệ]

Tapping *Trả về kệ*: the row leaves the queue (status `expired`, terminal), DT-0142 flips to **Còn sách**, the audit log gains "Maria Quản Lý Kho đã kết thúc giữ chỗ quá hạn của Têrêsa Lê Ngọc Ánh và trả bản sách về kệ", and no notification is written (BR §15 lists no "your hold lapsed" event — the child was already told the deadline in the approval notification).

**Kien's words, recorded:** the reference's gap strands a copy in `held` forever unless the READER cancels, and a volunteer standing at the shelf with a book in their hand needs a way to put it back. The plan had defaulted to A on parity grounds; the owner overrode that default deliberately.

**What this ruling changes across the plan, so nothing is left half-answered:** Task 18 executes (it is no longer conditional, and its heading says so). The Global Constraints' derived-state bullet no longer says "nothing in this plan writes `expired`" — `ReleaseExpiredHold` does, and the bullet now says which and under what guard. `HandoverRequest`'s `RequestStatus::Expired → hold_expired` branch stops being defensive-against-nothing and becomes REACHABLE — a manager releases a lapsed hold while a stale queue page still shows its handover button — so Task 9 carries a named test for that branch and the docblock says so. `request.expired` is the phase's sixth new audit action, taking `AuditSentences`' count to 27 — written by **Task 18**, in the commit that mints the command (Task 8 owns `request.fulfilled`, the fifth). 21 + 6 = 27. Task 19's known-gaps entry records the ruling instead of the gap, and OPS §4.2 gains the command entry in Task 18's own commit.

### RULING 2 (was OQ2) — the reject reason stays **OPTIONAL**. (OPS §4.2's own open question, Q2, now closed.)

**Context.** `RejectMembership` and `RejectProfileChange` both REQUIRE a reason and their screens say so ("Từ chối cần ghi lý do"); the borrow queue's *Từ chối* carries no such statement, OPS lists no `reason_required` failure mode for `RejectBorrowRequest`, and the reference implements **optional** with a named test ("the reason is optional, and an empty one is stored as no reason") and a hint on the form ("Không bắt buộc."). OPS's open-question note calls the inconsistency with the other two rejection flows "unintentional rather than a deliberate product decision"-looking.

**THE RULING (A) — optional, the reference's shipped reading.** The reject disclosure:

> Lý do từ chối — *Không bắt buộc.*
> [________________]  [Xác nhận từ chối]

Submitted empty: `decision_note` stores NULL (an empty box is no reason, not a reason that says nothing), the audit sentence reads "…đã từ chối yêu cầu mượn Dế Mèn Phiêu Lưu Ký của Têrêsa Lê Ngọc Ánh" (no because-clause), and the reader's notification reads **"Yêu cầu mượn Dế Mèn Phiêu Lưu Ký chưa được duyệt."**

**The rejected option (B) — required, aligning with the other two rejection flows.** The form would say "Từ chối cần ghi lý do", `reason` would become `required` in `RejectBorrowRequestRequest`, an empty submit a per-field validation error, and the reader would always see a because-clause. Rejected: parity with the reference, whose inconsistency with `RejectMembership`/`RejectProfileChange` OPS itself only ever described as *looking* unintentional. Reversing this later is one validation word and one hint string.

**What this ruling changes across the plan:** **Tasks 6 and 14 take NO B-delta.** The inline "on OQ2 = B…" notes in those two tasks are deleted — the Form Request rule is `['bail', 'nullable', 'string', 'max:500', 'encoding:UTF-8']`, full stop; `rejectReasonHint` is `"Không bắt buộc."`, full stop; the Action's named test "the reason is optional, and an empty one is stored as no reason" is the shipped behaviour, not a behaviour that survives a switch. An empty box stores NULL — an empty box is no reason, not a reason that says nothing.

### Ported readings — settled by the reference or an earlier phase, listed so nobody relitigates them silently

1. **A suspended reader cannot create or cancel a request over HTTP, and that is the 1c Q4 ruling extending itself.** `ResolveTenant` resolves only `active` memberships (the faithful port of the reference's `membershipFor` filter — its comment: "A suspended member is not a reader of this shelf, though their existing loans survive"), so `role:reader` 404s a suspended reader before any request route runs. `RequestRules::memberMayRequest` still ports whole and the Action still calls it (defence in depth, and the sentence exists for any future caller) — the same accepted-as-unreachable shape as `RenewLoan`'s status gate, recorded in known-gaps by Task 19.
2. **Only the FIRST pending reader can be approved — a screen rule, not a command rule.** The reference command approves any pending request; its queue screen offers the approve form only on the first pending row ("Chỉ duyệt được khi tới lượt." on the rest). Ported as-is on both layers.
3. **A request is a statement about a TITLE, never a claim on a copy** — create reads no `book_copies` at all, a free copy is not a reason to refuse ("a copy being free is not a reason to refuse a request" is a named reference test), and `approved` counts toward `duplicate_request` alongside `pending` so one child cannot hold a copy AND queue for the same title.
4. **INV-5 is not checked at create.** A reader at the loan limit may queue; the limit is re-checked by `HandoverRequest` (via `LendCopy`) when the book actually changes hands. OPS lists `loan_limit_reached` under handover, not create.
5. **Cancelling releases the copy guarded on `state = 'held'`** — a copy that moved on (lent, lost, retired) is left alone; zero affected rows is a legitimate outcome, not an error. `hold_expires_at` and `copy_id` stay on the cancelled row (the record of what the reader gave up).
6. **`request_approved` is ONE kind from two doors** (`ApproveBorrowRequest` and `ReceiveReturn`'s hold branch) — BR §15 lists "approved" and "ready for collection" as two lines, OPS §7 reads them as one event a child experiences once, flagged as an inference; the reference shipped one kind and this plan follows.
7. **Mark-as-read writes no audit row** — deliberately; the reference's three-part argument (a Vietnamese sentence for a non-fact, BR §14's readability, nothing recoverable) is restated in the Action's docblock and pinned by a named test.
8. **Managers get no notifications, structurally** — the architecture census, not a behavioural spot-check, is the guard (Task 2).

---

## File Structure

```
database/migrations/
  2026_08_29_000001_add_borrow_requests_live_request_key.php   the partial unique index divergence 2 chose instead of a lock
app/Support/Circulation/
  RequestRules.php         copyHoldable / memberMayRequest (pure; INV-3/4/7 from the request side)
  LoanTerms.php            (modified: + holdExpiry — hold_days after an instant, one home)
  LendingSettings.php      (modified: + holdDays (3), + dueSoonDays (3) off the settings blob)
app/Support/Notifications/
  NotificationKind.php     the closed set of kinds — a backed enum, grown per task (divergence 7)
  NotificationSentences.php  kind + payload → the Vietnamese a reader reads; unknown kind → neutral line
  Notifier.php             one reader-facing row, inside the CALLER's transaction, user ids only
app/Actions/Circulation/
  CreateBorrowRequest.php  reader joins the queue (NO lock at all — divergence 2; no copyId — divergence 3)
  ApproveBorrowRequest.php pending → approved, copy → held, hold clock from the injected clock
  RejectBorrowRequest.php  pending → rejected, optional reason (ruling 2), notify
  CancelOwnRequest.php     own request → cancelled, guarded copy release
  HandoverRequest.php      pre-flight sentences, then THE LendCopy implementation (divergence 11)
  LendCopy.php             (modified: hold read after locks, held-for-me live, collected-hold close)
  ReceiveReturn.php        (modified: re-widened to the reference's full shape — the 1c promise)
  ReleaseExpiredHold.php   (Task 18 — SHIPS, on ruling 1)
app/Actions/Members/
  ApproveMembership.php    (modified: + membership_approved notify, same transaction)
  RejectMembership.php     (modified: + membership_rejected notify, same transaction)
app/Policies/BorrowRequestPolicy.php
app/Queries/
  BorrowRequestQueueQuery.php   the queue grouped by book + freeCopies + the badge count
  MyNotificationsQuery.php      the bell's page: sentences rendered from payloads, unread count
  MyDashboardQuery.php          (modified: the requests half — queue position, hold expiry)
  BookDetailQuery.php           (modified: + myRequest for the signed-in reader)
  ManagerDashboardQuery.php     (modified: + counts.pendingRequests, mirroring the queue's filter)
  AuditLogQuery.php             (modified: subject join also reads payload $.userId — request entries)
app/Console/Commands/SweepReminders.php   reminders:sweep — 07:00 Asia/Ho_Chi_Minh (Phase 0's reserved line)
app/Http/Requests/Circulation/
  ApproveBorrowRequestRequest.php  copy_id (uuid)
  RejectBorrowRequestRequest.php   reason (nullable — ruling 2; bail + encoding:UTF-8)
  ReceiveReturnRequest.php         (modified: + hold_for_request_id (nullable uuid))
app/Http/Controllers/Manage/
  BorrowRequestController.php   index / approve / reject / handover / release (release added in Task 18)
  ReturnController.php          (modified: waiting panel data + hold_for_request_id through)
app/Http/Controllers/Reader/
  BorrowRequestController.php   store (from book detail) / cancel (book detail + dashboard)
  NotificationController.php    index / read / readAll
app/Http/Middleware/HandleInertiaRequests.php  (modified: lazy unreadNotifications shared prop)
app/Models/Bookshelf.php      (+ borrowRequests() and notifications() relations for scoped bindings)
app/Models/BorrowRequest.php  (+ book()/copy() relations)
routes/web.php                (borrow-request + notification routes; under-construction rows replaced)
routes/console.php            (the second Schedule:: line Phase 0 reserved)
resources/js/pages/manage/borrow-requests.tsx     the queue: approve / reject / handover per row
resources/js/pages/manage/returns/index.tsx       (modified: the "N bạn đọc đang chờ" radio panel)
resources/js/pages/manage/dashboard.tsx           (modified: third stat card — Yêu cầu mượn)
resources/js/pages/shelves/book.tsx               (modified: Xin mượn / Đăng ký chờ mượn / Huỷ yêu cầu)
resources/js/pages/shelves/profile/overview.tsx   (modified: the requests half replaces the empty state)
resources/js/pages/shelves/profile/notifications.tsx   the bell's page
resources/js/layouts/app-layout.tsx               (modified: the bell link with unread count)
resources/js/layouts/manage-layout.tsx            (modified: Yêu cầu mượn nav item)
resources/js/lib/copy.ts                          (extended)
resources/js/types/index.d.ts                     (SharedData + unreadNotifications)
lang/vi/rules.php             (extended — divergence 12's eleven keys + three flash lines)
lang/vi/audit.php             (extended — the five request.* sentences, group 'loans')
lang/vi/notifications.php     NEW — the kinds' sentences (grown per task)
app/Support/Audit/AuditSentences.php  (modified: five request.* entries + phrase arms)
database/seeders/DemoShelfSeeder.php  (extended: one pending request, one approved hold, one notification)
docs/OPERATIONS.md            (modified in Task 18 — §4.2 gains ReleaseExpiredHold, on ruling 1)
tests/Feature/Architecture/NotificationsAreReaderFacingTest.php   NEW — the ported census
tests/Feature/Architecture/CirculationArchitectureTest.php        (modified: absence pins → presence pins)
tests/Unit/Circulation/RequestRulesTest.php  tests/Unit/Notifications/…
tests/Feature/Circulation/…  tests/Feature/Notifications/…  docs/known-gaps.md
```

---

### Task 1: Request groundwork — the live-request unique index, the refusal sentences, `RequestRules`, `LoanTerms::holdExpiry`, the settings, the audit subject join

Read first: `old_next/src/domain/circulation/policy.ts` (`copyHoldable` and `memberMayRequest` docblocks — the arguments this task ports), `old_next/src/domain/circulation/settings.ts` (`holdDaysFor`), `old_next/src/domain/kernel/errors.ts:105-165` (the sentences, verbatim), 1c's Task 1 (the shape this task copies), and — for Step 0's migration — `database/migrations/2026_08_26_000007_create_loans_table.php:70-81` (`loans.active_copy_id`, the generated-column-plus-unique idiom this copies verbatim) and `2026_08_26_000016_create_profile_change_requests_table.php:40-53`.

**Files:**
- Create: `database/migrations/2026_08_29_000001_add_borrow_requests_live_request_key.php`
- Modify: `lang/vi/rules.php` (append keys — never rewrite earlier phases')
- Create: `app/Support/Circulation/RequestRules.php`
- Modify: `app/Support/Circulation/LoanTerms.php` (append `holdExpiry`)
- Modify: `app/Support/Circulation/LendingSettings.php` (add `holdDays`, `dueSoonDays`)
- Modify: `app/Queries/AuditLogQuery.php` (second payload subject join on `$.userId`)
- Test: `tests/Unit/Circulation/RequestRulesTest.php`
- Test: `tests/Unit/Circulation/LoanTermsTest.php` (append)
- Test: `tests/Unit/Circulation/LendingSettingsTest.php` (append)
- Test: `tests/Feature/Schema/LiveRequestKeyTest.php`

**Interfaces:**
- Consumes: `App\Enums\CopyState`, `App\Enums\MembershipStatus`, `App\Models\Bookshelf`, `Carbon\CarbonImmutable`.
- Produces (every later task builds on these exact signatures):
  - `RequestRules::copyHoldable(CopyState $state, ?string $heldForUserId): ?string` — `null` when the copy may be put aside, else `chosen_copy_lost_or_retired` | `no_copy_available`. NO `$forUserId` parameter, and that absence is the point (the reference's signature-as-argument): this predicate answers "may this copy be promised to somebody who is not standing here", and a copy under a live hold is already promised. `$heldForUserId` is a **users.id** read through a `hold_expires_at > now` filter, so a lapsed hold arrives as null.
  - `RequestRules::memberMayRequest(MembershipStatus $status): ?string` — `null` for active, else `membership_not_active_cannot_request` (INV-4 with the queue's own sentence — OPS §4.2 `:293`'s wording, not LendCopy's, because a child told they cannot borrow *more* would reasonably conclude the queue is still open).
  - `RequestRules::CODES` — `list<string>` of every code the two predicates return, censused against `lang/vi/rules.php` by `RequestRulesTest` (the `LoanRulesTest` precedent — these are returned as data, so the app-wide literal census cannot see them).
  - `LoanTerms::holdExpiry(CarbonImmutable $now, int $holdDays): CarbonImmutable` — `hold_days` after the instant, fixed-length wall time (no timezone/DST reasoning applies — unlike `dueDateFor`, this produces an instant, not a civil date; the reference's `holdExpiryFrom` note). Written from the injected clock and compared against the injected clock everywhere it is read.
  - `LendingSettings` gains `public readonly int $holdDays` (default 3 — BR §5.5's hold_days) and `public readonly int $dueSoonDays` (default 3 — the sweep's per-shelf window, `bookshelves.settings->due_soon_days`, the reference's QA-remediation Task 23/24 pair).
  - `borrow_requests_one_live_per_title_member` — the constraint NAME every later `UniqueViolation::translate` call matches on (Task 4). Nothing else in the codebase may spell it differently.

- [ ] **Step 0: The live-request unique index (divergence 2)**

Create `database/migrations/2026_08_29_000001_add_borrow_requests_live_request_key.php`:

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        // Divergence 2. "One live place in this title's queue per reader"
        // was going to be a FOR UPDATE on the books row; that closes a real
        // AB-BA cycle against UpdateBook (which X-locks bookshelves, then
        // writes the book row, while every insert here wants S on that same
        // bookshelves row through its RESTRICT foreign keys). The rule
        // becomes a constraint instead — the single-column-predicate form
        // loans.active_copy_id and profile_change_requests.pending_user_id
        // already use: the key exists only while the row is LIVE and
        // undecided, NULLs are distinct, so every terminal status and a soft
        // delete free the slot and the reader may queue for that title again.
        //
        // 73 = 36 + 1 + 36, ascii_bin to match book_id and member_id exactly
        // (a differing collation on either side would compare, and index,
        // wrongly).
        DB::statement("
            ALTER TABLE borrow_requests ADD COLUMN live_request_key VARCHAR(73)
                CHARACTER SET ascii COLLATE ascii_bin
                GENERATED ALWAYS AS (
                    IF(deleted_at IS NULL AND status IN ('pending', 'approved'),
                       CONCAT(book_id, ':', member_id), NULL)
                ) STORED
        ");
        DB::statement('
            ALTER TABLE borrow_requests
            ADD CONSTRAINT borrow_requests_one_live_per_title_member UNIQUE (live_request_key)
        ');
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE borrow_requests DROP INDEX borrow_requests_one_live_per_title_member');
        DB::statement('ALTER TABLE borrow_requests DROP COLUMN live_request_key');
    }
};
```

Create `tests/Feature/Schema/LiveRequestKeyTest.php` — the constraint's own test, because a structural guarantee nothing asserts is a comment:

```php
<?php

use App\Enums\RequestStatus;
use App\Models\Book;
use App\Models\Bookshelf;
use App\Models\BorrowRequest;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Illuminate\Database\QueryException;

/**
 * Shelf + one reader + one book. @return array{Bookshelf, User, Book}
 */
function lrkFix(string $slug = 'dong-thap-lrk'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);
    $reader = User::factory()->create(['full_name' => 'Têrêsa Bạn Đọc Nhỏ']);
    $membership = Membership::factory()->for($shelf)->create([
        'user_id' => $reader->id, 'role' => 'reader', 'status' => 'active',
    ]);
    $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Dế Mèn Phiêu Lưu Ký', 'slug' => 'de-men']);
    app(TenantContext::class)->set($shelf, $membership);

    return [$shelf, $reader, $book];
}

/** @param array<string, mixed> $extra */
function lrkRow(Bookshelf $shelf, Book $book, User $reader, string $status, array $extra = []): BorrowRequest
{
    return BorrowRequest::query()->create(array_merge([
        'bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'member_id' => $reader->id,
        'status' => $status, 'requested_at' => now(),
    ], $extra));
}

it('a second live request for the same title by the same reader is refused by the database', function () {
    [$shelf, $reader, $book] = lrkFix();
    lrkRow($shelf, $book, $reader, 'pending');

    expect(fn () => lrkRow($shelf, $book, $reader, 'pending'))
        ->toThrow(QueryException::class, 'borrow_requests_one_live_per_title_member');
});

it('approved holds the slot exactly as pending does', function () {
    [$shelf, $reader, $book] = lrkFix('dong-thap-lrk-approved');
    lrkRow($shelf, $book, $reader, 'approved', ['hold_expires_at' => now()->addDays(3)]);

    expect(fn () => lrkRow($shelf, $book, $reader, 'pending'))
        ->toThrow(QueryException::class, 'borrow_requests_one_live_per_title_member');
});

it('every terminal status frees the slot, and so does a soft delete', function () {
    // Five separate rows would collide with each other, so each ending is
    // taken in turn on ONE row: end it, queue again, end that, and so on.
    [$shelf, $reader, $book] = lrkFix('dong-thap-lrk-free');
    foreach (['fulfilled', 'rejected', 'cancelled', 'expired'] as $ending) {
        $row = lrkRow($shelf, $book, $reader, 'pending');
        BorrowRequest::query()->whereKey($row->id)->update(['status' => $ending]);
    }
    $live = lrkRow($shelf, $book, $reader, 'pending');
    $live->delete();                                  // SoftDeletes

    // The slot is free after all five endings: this insert is the proof.
    expect(lrkRow($shelf, $book, $reader, 'pending')->status)->toBe(RequestStatus::Pending);
});

it('a different reader, and a different title, never collide', function () {
    [$shelf, $reader, $book] = lrkFix('dong-thap-lrk-distinct');
    lrkRow($shelf, $book, $reader, 'pending');

    app(TenantContext::class)->actSystemWide();
    $other = User::factory()->create(['full_name' => 'Anna Người Khác']);
    Membership::factory()->for($shelf)->create(['user_id' => $other->id, 'role' => 'reader', 'status' => 'active']);
    $otherBook = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Hoàng Tử Bé', 'slug' => 'hoang-tu-be']);
    app(TenantContext::class)->set($shelf->fresh(), Membership::query()->where('user_id', $reader->id)->firstOrFail());

    lrkRow($shelf, $book, $other, 'pending');         // same title, other reader
    lrkRow($shelf, $otherBook, $reader, 'pending');   // other title, same reader

    expect(BorrowRequest::query()->count())->toBe(3);
});
```

Run: `make test FILTER=LiveRequestKeyTest`. Expected: PASS after `php artisan migrate` (the suite migrates its own database). Mutation check: change the generated expression's `status IN ('pending', 'approved')` to `status = 'pending'` → "approved holds the slot exactly as pending does" red; restore.

Two helper names for the registry: `lrkFix`, `lrkRow` (Task 1) — Global Constraints' list is amended by this task, and it is the only task that adds a helper the registry did not already name.

- [ ] **Step 1: Append the refusal sentences**

In `lang/vi/rules.php`, append after the 1c/1d block (spellings and sentences verbatim from `errors.ts` / OPS §4.2 — divergence 12):

```php
    // ── Requests & holds (Phase 2a) ───────────────────────────────────
    'copy_not_found' => 'Không tìm thấy bản sách này.',
    'duplicate_request' => 'Bạn đã có một yêu cầu đang chờ cho cuốn này.',
    'membership_not_active_cannot_request' => 'Tài khoản đang tạm khoá, không thể gửi yêu cầu mượn.',
    'request_not_pending' => 'Yêu cầu này đã được xử lý.',
    'request_not_queued' => 'Yêu cầu này không còn trong hàng chờ của sách này.',
    'no_copy_available' => 'Không còn bản nào để giữ chỗ.',
    'chosen_copy_lost_or_retired' => 'Bản sách đã chọn đã mất hoặc ngừng dùng.',
    'hold_expired' => 'Thời gian giữ chỗ đã hết. Bạn đọc cần đăng ký lại.',
    'request_not_held' => 'Yêu cầu này không có bản sách nào đang được giữ chỗ.',
    'not_own_request' => 'Bạn không thể huỷ yêu cầu của người khác.',
    'request_already_fulfilled' => 'Yêu cầu này đã được trao sách, không thể huỷ.',
    // flash lines (the lend/return flash precedent, 1c)
    'request_success_flash' => 'Đã gửi. Quản lý tủ sách sẽ xem và báo lại cho bạn.',
    'request_cancel_flash' => 'Đã huỷ yêu cầu mượn.',
    'return_hold_success_flash' => 'Đã nhận trả bản :code và giữ chỗ cho bạn đọc đang chờ.',
    'approve_success_flash' => 'Đã giữ chỗ — bạn đọc sẽ được báo, hạn đến nhận :until.',
    'reject_request_flash' => 'Đã từ chối yêu cầu — bạn đọc sẽ được báo.',
    // The handover flash. 1c's lend_success_flash takes :name/:title, and
    // the handover controller has neither at hand — it holds the request
    // and LendCopy's dueOn. Minted HERE, in the one task that owns this
    // block, rather than retroactively edited into it from Task 14.
    'lend_success_flash_short' => 'Đã trao sách — hạn trả :due.',
    'release_hold_flash' => 'Đã trả bản sách về kệ.',
    // Authored on ruling 1 (no errors.ts spelling): a manager may not yank
    // a live hold. OPS §4.2 gains its entry in Task 18's own commit — the
    // title_has_no_copies two-ledger precedent.
    'hold_not_expired' => 'Thời gian giữ chỗ chưa hết, không thể trả về kệ.',
```

`chosen_copy_lost_or_retired` is a distinct code from 1c's `copy_lost_or_retired` because OPS gives the two commands different sentences ("Bản sách **đã chọn**…" — the copy a manager picked from a list a moment ago, not the one in their hand); do not collapse them. None of these keys exists yet — verify with `grep -c "'copy_not_found'" lang/vi/rules.php` (expect 0) before appending; `membership_not_found` (1b) is a different key and stays untouched.

- [ ] **Step 2: Write the failing unit tests**

Create `tests/Unit/Circulation/RequestRulesTest.php`:

```php
<?php

use App\Enums\CopyState;
use App\Enums\MembershipStatus;
use App\Support\Circulation\RequestRules;

it('INV-3/7: only an available copy under no live hold may be put aside', function () {
    expect(RequestRules::copyHoldable(CopyState::Available, null))->toBeNull();
});

it('a copy under a live hold is already promised — never promised twice', function () {
    // No forUserId parameter exists to compare against, deliberately: the
    // reader a hold could be "for" is not standing at the shelf. The
    // signature is the rule (the reference's copyHoldable docblock).
    expect(RequestRules::copyHoldable(CopyState::Available, 'user-a'))->toBe('no_copy_available');
});

it('an on_loan copy and a held copy both refuse with no_copy_available', function () {
    expect(RequestRules::copyHoldable(CopyState::OnLoan, null))->toBe('no_copy_available')
        ->and(RequestRules::copyHoldable(CopyState::Held, null))->toBe('no_copy_available')
        ->and(RequestRules::copyHoldable(CopyState::Held, 'user-a'))->toBe('no_copy_available');
});

it('a held copy whose hold lapsed is refused by the STATE branch, not freed in passing', function () {
    // BR §8's "if the tidy-up never runs, availability is still right" from
    // the other side: expiry presents as absence (heldForUserId null), and
    // the copy still refuses because state is held — held → available is a
    // transition somebody records, never one an approval performs en route.
    expect(RequestRules::copyHoldable(CopyState::Held, null))->toBe('no_copy_available');
});

it('INV-7: a lost or retired copy has its own sentence, and it beats the hold branch', function () {
    expect(RequestRules::copyHoldable(CopyState::Lost, null))->toBe('chosen_copy_lost_or_retired')
        ->and(RequestRules::copyHoldable(CopyState::Retired, null))->toBe('chosen_copy_lost_or_retired')
        ->and(RequestRules::copyHoldable(CopyState::Lost, 'user-a'))->toBe('chosen_copy_lost_or_retired');
});

it('INV-4: no status other than active may join a queue, in the queue\'s own words', function () {
    foreach ([MembershipStatus::Pending, MembershipStatus::Suspended, MembershipStatus::Left, MembershipStatus::Rejected] as $status) {
        expect(RequestRules::memberMayRequest($status))
            ->toBe('membership_not_active_cannot_request', "status {$status->value} should refuse");
    }
    expect(RequestRules::memberMayRequest(MembershipStatus::Active))->toBeNull();
});

it('every code the predicates can return has a Vietnamese sentence', function () {
    // The LoanRulesTest precedent: these codes are thrown as
    // `new RuleViolated($code)` with a VARIABLE, so the app/-wide literal
    // census cannot see them. This is their census. Delete
    // `no_copy_available` from lang/vi/rules.php and this test, alone,
    // goes red.
    expect(RequestRules::CODES)->toEqualCanonicalizing([
        'no_copy_available', 'chosen_copy_lost_or_retired',
        'membership_not_active_cannot_request',
    ]);

    $rules = require __DIR__.'/../../../lang/vi/rules.php';
    foreach (RequestRules::CODES as $code) {
        expect(array_key_exists($code, $rules))->toBeTrue("missing rules.{$code}")
            ->and($rules[$code])->toBeString()->not->toBe('');
    }
});
```

Append to `tests/Unit/Circulation/LoanTermsTest.php`:

```php
it('a hold placed now lapses hold_days later, as an instant, wall-time exact', function () {
    $now = \Carbon\CarbonImmutable::parse('2026-08-28 07:30:00', 'UTC');

    expect(\App\Support\Circulation\LoanTerms::holdExpiry($now, 3)->toIso8601ZuluString())
        ->toBe('2026-08-31T07:30:00Z')
        // Fixed-length wall time: 3 days is exactly 72 hours from the
        // instant — no end-of-day rounding, unlike due dates. The hold ends
        // mid-morning if it started mid-morning (the reference's
        // holdExpiryFrom, kept). Pinned as a second instant rather than a
        // diff — Carbon's diff sign conventions are exactly the kind of
        // trap plan code has failed gates on before.
        ->and(\App\Support\Circulation\LoanTerms::holdExpiry($now, 1)->toIso8601ZuluString())
        ->toBe('2026-08-29T07:30:00Z');
});
```

Append to `tests/Unit/Circulation/LendingSettingsTest.php`:

```php
it('hold_days and due_soon_days default to 3 and read from the blob', function () {
    $bare = \App\Support\Circulation\LendingSettings::fromShelf(new \App\Models\Bookshelf(['settings' => []]));
    $set = \App\Support\Circulation\LendingSettings::fromShelf(new \App\Models\Bookshelf([
        'settings' => ['hold_days' => 5, 'due_soon_days' => 7],
    ]));

    expect($bare->holdDays)->toBe(3)
        ->and($bare->dueSoonDays)->toBe(3)
        ->and($set->holdDays)->toBe(5)
        ->and($set->dueSoonDays)->toBe(7);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `make test FILTER=RequestRulesTest && make test FILTER=LoanTermsTest && make test FILTER=LendingSettingsTest`
Expected: FAIL — `Class "App\Support\Circulation\RequestRules" not found`; `Call to undefined method … holdExpiry`; `Undefined property … $holdDays`.

- [ ] **Step 4: Implement**

Create `app/Support/Circulation/RequestRules.php`:

```php
<?php

namespace App\Support\Circulation;

use App\Enums\CopyState;
use App\Enums\MembershipStatus;

/**
 * The borrow-request side of the circulation domain's pure rules — the
 * port of policy.ts's copyHoldable and memberMayRequest. No SQL, no
 * clock, no I/O. Returns ?string (null = allowed, else the RuleViolated
 * code); every returnable code is in CODES, censused against
 * lang/vi/rules.php by RequestRulesTest.
 */
final class RequestRules
{
    /** @var list<string> every code the predicates below can return */
    public const CODES = [
        'no_copy_available', 'chosen_copy_lost_or_retired',
        'membership_not_active_cannot_request',
    ];

    /**
     * Whether a copy may be put aside for a queued reader —
     * ApproveBorrowRequest's question, INV-3 and INV-7 from the other end.
     *
     * NOT LoanRules::copyLendable with a different caller: that predicate
     * answers "may THIS reader take this copy away" and its whole reason
     * for existing is the held-for-me case. This one answers "may this
     * copy be promised to somebody who is not standing here", and the
     * held case is the opposite answer — a copy under a live hold is
     * already promised, and promising it twice is how one child is sent
     * home. So there is no $forUserId parameter: there is nobody to
     * compare against, which is the difference, stated as a signature.
     *
     * $heldForUserId is read through a hold_expires_at > now filter, so a
     * lapsed hold arrives as null — and a copy left `held` by an
     * uncollected hold is then refused by the STATE branch, not freed on
     * the way past (BR §8: held → available is a transition a command
     * performs, never one an approval performs in passing).
     */
    public static function copyHoldable(CopyState $state, ?string $heldForUserId): ?string
    {
        if ($state === CopyState::Lost || $state === CopyState::Retired) {
            return 'chosen_copy_lost_or_retired';
        }
        if ($state === CopyState::Available && $heldForUserId === null) {
            return null;
        }

        return 'no_copy_available';
    }

    /**
     * INV-4 for CreateBorrowRequest — the same single status comparison
     * LoanRules::memberMayBorrow makes (MembershipStatus is the one enum;
     * there is no second hand-maintained list to drift), with the queue's
     * own sentence: OPS §4.2 words LendCopy's refusal "không thể mượn
     * thêm" and this one "không thể gửi yêu cầu mượn", because a child
     * told they cannot borrow MORE would reasonably conclude the queue is
     * still open to them.
     *
     * INV-5 is deliberately not consulted: a reader at the loan limit may
     * queue — nothing goes out on a request, and the limit is re-checked
     * by HandoverRequest at the moment a book actually changes hands.
     */
    public static function memberMayRequest(MembershipStatus $status): ?string
    {
        return $status === MembershipStatus::Active
            ? null
            : 'membership_not_active_cannot_request';
    }
}
```

Append to `app/Support/Circulation/LoanTerms.php` (inside the class):

```php
    /**
     * When a hold placed NOW lapses — hold_days after the instant, in
     * fixed-length wall time. No timezone or DST reasoning applies, unlike
     * dueDateFor: this produces an INSTANT (hold_expires_at is
     * DATETIME(6) UTC), not a civil date. What matters is only which
     * clock the arithmetic starts from — the injected one, because every
     * later read of hold_expires_at compares it against the same injected
     * clock (the reference's holdExpiryFrom argument, kept whole). Moved
     * here rather than written privately in two commands:
     * ApproveBorrowRequest and ReceiveReturn write the same column from
     * the same rule.
     */
    public static function holdExpiry(\Carbon\CarbonImmutable $now, int $holdDays): \Carbon\CarbonImmutable
    {
        return $now->addDays($holdDays);
    }
```

In `app/Support/Circulation/LendingSettings.php`, add the two properties and constructor lines (the docblock's "hold_days is deliberately absent until Phase 2 — nothing in 1c reads it" sentence is DELETED in the same edit — it is now false):

```php
final readonly class LendingSettings
{
    public function __construct(
        public int $loanDays,
        public int $maxConcurrentLoans,
        public int $maxRenewals,
        public int $renewalDays,
        public int $holdDays,
        public int $dueSoonDays,
    ) {}

    public static function fromShelf(Bookshelf $shelf): self
    {
        $settings = (array) $shelf->settings;

        return new self(
            loanDays: (int) ($settings['loan_days'] ?? 14),
            maxConcurrentLoans: (int) ($settings['max_concurrent_loans'] ?? 3),
            maxRenewals: (int) ($settings['max_renewals'] ?? 1),
            renewalDays: (int) ($settings['renewal_days'] ?? 7),
            // BR §5.5's hold_days — how long a hold stands (default 3).
            holdDays: (int) ($settings['hold_days'] ?? 3),
            // The sweep's per-shelf due-soon window (default 3) — the
            // reference's QA Task 23/24 pair: a setting the nightly job
            // actually obeys, or it is inert.
            dueSoonDays: (int) ($settings['due_soon_days'] ?? 3),
        );
    }
}
```

- [ ] **Step 5: The audit subject join learns `$.userId`**

The five `request.*` audit payloads store the reader under `userId` (the reference's key, which its `get-audit-log.ts` subject join reads; 1d's port reads only `$.borrower_id`). In `app/Queries/AuditLogQuery.php`, directly after the existing `payload_user` join, add a fourth left join and extend the coalesce:

```php
            // request.* entries store the reader under $.userId (the
            // reference's key — its subject join reads borrower_id AND
            // userId; 1d ported only the first because no shipped writer
            // used the second until Phase 2a). Same CONVERT/COLLATE guard:
            // JSON_UNQUOTE yields utf8mb4, users.id is ascii_bin, and the
            // raw comparison is errno 1267 — this repo's six-times-paid
            // live 500.
            ->leftJoin('users as payload_subject', function ($join) {
                $join->on('payload_subject.id', '=', DB::raw(
                    "CONVERT(JSON_UNQUOTE(JSON_EXTRACT(audit_log.after, '$.userId')) USING ascii) COLLATE ascii_bin"
                ));
            })
```

and change the subject select to:

```php
            ->selectRaw('coalesce(subject_user.full_name, member_user.full_name, payload_user.full_name, payload_subject.full_name) as subject_name')
```

No test lands here (there is no `request.*` writer yet); Task 6's audit test is the one that pins this join by asserting `request.rejected`'s rendered sentence names the reader — a mutation check there (drop the new join, that named test goes red) proves it load-bearing.

- [ ] **Step 6: Run the tests, lint, analyse, commit**

Run: `make test FILTER=Circulation` — expected: PASS (including 1c's untouched suites).
Run: `make test FILTER=AuditLogQuery` — expected: PASS (the join is additive; existing subject tests unaffected).

```bash
make lint && make analyse
git add database/migrations/2026_08_29_000001_add_borrow_requests_live_request_key.php lang/vi/rules.php app/Support/Circulation/ app/Queries/AuditLogQuery.php tests/Unit/Circulation/ tests/Feature/Schema/LiveRequestKeyTest.php
git commit -m "feat: request groundwork — the live-request index, the sentences, requestrules, hold expiry, the audit subject key"
```

---

### Task 2: The notification write path — kinds, sentences, `Notifier`, the membership retrofit, and the reader-facing census

Read first: `old_next/src/domain/notifications/kinds.ts` and `write.ts` (whole files — the docblocks carry every argument this task ports), `old_next/tests/architecture/notifications-are-reader-facing.test.ts`, `old_next/tests/domain/notifications/notifications.test.ts` (tests 1–3), and the "Phase 2 must add…" docblock lines in `app/Actions/Members/ApproveMembership.php:31` and `RejectMembership.php:20`.

**Files:**
- Create: `app/Support/Notifications/NotificationKind.php`
- Create: `app/Support/Notifications/NotificationSentences.php`
- Create: `app/Support/Notifications/Notifier.php`
- Create: `lang/vi/notifications.php`
- Modify: `app/Actions/Members/ApproveMembership.php`, `app/Actions/Members/RejectMembership.php` (the promised notify writes; delete each "Phase 2 must add…" docblock paragraph in the same edit)
- Test: `tests/Unit/Notifications/NotificationSentencesTest.php`
- Test: `tests/Feature/Notifications/NotificationWritePathTest.php`
- Test: `tests/Feature/Architecture/NotificationsAreReaderFacingTest.php`

**Interfaces:**
- Consumes: `App\Models\Notification` (Phase 0 model — `UPDATED_AT = null`, `payload` array cast), `App\Support\Clock`, `App\Support\TenantContext`.
- Produces:
  - `enum NotificationKind: string` — cases grown per task; THIS task ships `MembershipApproved = 'membership_approved'` and `MembershipRejected = 'membership_rejected'`. Tasks 5/6/10/17 append theirs (each with sentence + writer + census row, same commit).
  - `NotificationSentences::sentence(string $kind, array $payload): string` — the Vietnamese a reader reads, rendered at read time from the stored payload (a corrected title flows into old notifications; a typo in the wording is fixable retroactively — the reference's anti-freeze argument, and the deliberate OPPOSITE of the audit browser's stored-values rule). An unknown stored kind (a row written by a newer build than the one reading) renders the neutral `'Bạn có một thông báo mới.'`, never the raw token.
  - `Notifier::notify(string $userId, NotificationKind $kind, array $payload = []): void` — inserts one row inside the CALLER's transaction (takes no transaction of its own); `bookshelf_id` from the model's own `BelongsToBookshelf` create-hook (the bound tenant), `created_at` from `Clock::now()`. `$userId` is a `users(id)` — the parameter name makes a membership id read wrong at the call site.

- [ ] **Step 1: Write the failing tests**

Create `tests/Unit/Notifications/NotificationSentencesTest.php`:

```php
<?php

use App\Support\Notifications\NotificationKind;
use App\Support\Notifications\NotificationSentences;

it('membership_approved renders its fixed sentence', function () {
    expect(NotificationSentences::sentence('membership_approved', []))
        ->toBe('Đơn đăng ký của bạn đã được duyệt. Chúc bạn đọc sách vui!');
});

it('membership_rejected carries the reason when there is one, and degrades when not', function () {
    expect(NotificationSentences::sentence('membership_rejected', ['reason' => 'thiếu thông tin']))
        ->toBe('Đơn đăng ký của bạn chưa được duyệt vì thiếu thông tin.')
        ->and(NotificationSentences::sentence('membership_rejected', []))
        ->toBe('Đơn đăng ký của bạn chưa được duyệt.')
        // A blank or whitespace reason is NO reason — never " vì ".
        ->and(NotificationSentences::sentence('membership_rejected', ['reason' => '  ']))
        ->toBe('Đơn đăng ký của bạn chưa được duyệt.');
});

it('an unknown stored kind renders the neutral line, never the raw token', function () {
    // Rows written by an older or newer build survive a deploy; a kind
    // this build does not know is a real state, not a programming error
    // (the reference's kinds.ts rule).
    expect(NotificationSentences::sentence('request_teleported', ['title' => 'X']))
        ->toBe('Bạn có một thông báo mới.');
});

it('every enum case has a lang line, and no lang line is orphaned', function () {
    $lines = require __DIR__.'/../../../lang/vi/notifications.php';
    $kinds = array_map(
        fn (NotificationKind $k) => $k->value,
        NotificationKind::cases(),
    );
    // Kind keys only — helper lines are prefixed with underscore.
    $langKinds = array_values(array_filter(array_keys($lines), fn (string $k) => ! str_starts_with($k, '_')));

    expect($langKinds)->toEqualCanonicalizing($kinds);
});
```

Create `tests/Feature/Notifications/NotificationWritePathTest.php`:

```php
<?php

use App\Actions\Members\ApproveMembership;
use App\Actions\Members\RejectMembership;
use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\Notification;
use App\Models\User;
use App\Support\Notifications\NotificationKind;
use App\Support\Notifications\Notifier;
use App\Support\TenantContext;
use Illuminate\Support\Facades\DB;

/**
 * Shelf + acting manager + one pending reader membership. Names outside
 * UserFactory's pool. @return array{Bookshelf, User, Membership}
 */
function nwpFix(string $slug = 'dong-thap-nwp'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);
    $manager = User::factory()->create(['full_name' => 'Maria Quản Lý Kho']);
    $managerMembership = Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);
    $readerUser = User::factory()->create(['full_name' => 'Têrêsa Bạn Đọc Nhỏ']);
    $membership = Membership::factory()->for($shelf)->create([
        'user_id' => $readerUser->id, 'role' => 'reader', 'status' => 'pending',
    ]);
    app(TenantContext::class)->set($shelf, $managerMembership);
    test()->actingAs($manager);

    return [$shelf, $manager, $membership];
}

it('approving a registration tells the reader, and nobody else', function () {
    [$shelf, $manager, $membership] = nwpFix();

    app(ApproveMembership::class)->execute($manager, $membership);

    // Row COUNT as well as recipient — notifying the actor is the
    // ordinary way this rule gets broken (the reference's test note).
    $rows = Notification::query()->get();
    expect($rows)->toHaveCount(1)
        ->and($rows[0]->user_id)->toBe($membership->user_id)   // users.id, never membership id
        ->and($rows[0]->kind)->toBe('membership_approved')
        ->and($rows[0]->bookshelf_id)->toBe($shelf->id);
});

it('a rejection carries its reason to the reader', function () {
    [, $manager, $membership] = nwpFix('dong-thap-nwp-rej');

    app(RejectMembership::class)->execute($manager, $membership, 'chưa đủ thông tin liên hệ');

    $row = Notification::query()->firstOrFail();
    expect($row->kind)->toBe('membership_rejected')
        ->and($row->payload)->toMatchArray(['reason' => 'chưa đủ thông tin liên hệ']);
});

it('a notification cannot survive the transaction that wrote it failing', function () {
    [, , $membership] = nwpFix('dong-thap-nwp-tx');

    // Notifier writes inside the CALLER's transaction — fail the caller
    // mid-flight and nothing survives (OPS §7: written by the command
    // named, in the same transaction as the state change it announces).
    try {
        DB::transaction(function () use ($membership): void {
            app(Notifier::class)->notify($membership->user_id, NotificationKind::MembershipApproved);
            throw new RuntimeException('mid-flight failure');
        });
    } catch (RuntimeException) {
    }

    expect(Notification::query()->count())->toBe(0);
});
```

Create `tests/Feature/Architecture/NotificationsAreReaderFacingTest.php` — the port of `notifications-are-reader-facing.test.ts`. The census strips comments first (the `AuditActionCensusTest` idiom, reusing its process-global `stripCommentTokens` helper — do NOT redeclare it):

```php
<?php

use App\Support\Notifications\NotificationKind;

/**
 * BR §15 and OPS §7: managers get NO notifications, by design — the
 * requirements give the reason ("avoids notification fatigue for
 * volunteers and removes any dependency on timely background work").
 * "Never" is the hard shape to test, so this enumerates the call sites
 * and pins them against OPS §7's own table. Adding a notification
 * anywhere fails this until the table is updated deliberately.
 *
 * Grown per task: each task that adds a kind adds its writer AND its row
 * here in the same commit (plan divergence 7). comment_approved arrives
 * in 2b with ApproveComment; the profile-change pair BR §15 names has no
 * reference implementation and is Phase 3's to decide (known-gaps).
 */
const OPS_SECTION_7 = [
    'membership_approved' => ['app/Actions/Members/ApproveMembership.php'],
    'membership_rejected' => ['app/Actions/Members/RejectMembership.php'],
];

it('every notification is written where OPERATIONS §7 says it is', function () {
    $files = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator(app_path(), FilesystemIterator::SKIP_DOTS)
    );

    $writers = [];
    foreach ($files as $file) {
        $path = $file->getPathname();
        if (! str_ends_with($path, '.php') || str_ends_with($path, 'NotificationKind.php') || str_ends_with($path, 'NotificationSentences.php')) {
            continue;
        }
        $code = stripCommentTokens((string) file_get_contents($path));
        foreach (NotificationKind::cases() as $kind) {
            // The enum case, ONLY. The first draft of this census also
            // matched the raw string "'{$kind->value}'", to catch a direct
            // insert — and it was RED on the commit that introduced it,
            // because app/Support/Audit/AuditSentences.php:138-139 carries
            // the lang keys 'membership_approved' and 'membership_rejected'
            // as live code, which stripCommentTokens rightly does not strip.
            // Renaming those audit keys to dodge a test would churn 1b's
            // shipped sentences, so the test narrows instead: every writer
            // in this system reaches a kind through the enum, the sweep
            // (Task 17) included — it passes NotificationKind::LoanDueSoon
            // to its own tell() helper and writes $kind->value from there,
            // never a literal. If a future writer ever needs the raw
            // string, it adds itself to this census by hand, in the commit
            // that needs it, with the reason.
            if (str_contains($code, 'NotificationKind::'.$kind->name)) {
                $writers[$kind->value][] = str_replace(base_path().'/', '', $path);
            }
        }
    }
    foreach ($writers as &$list) {
        sort($list);
    }

    expect($writers)->toEqual(OPS_SECTION_7);
});

it('the table this guards covers every kind that exists', function () {
    expect(array_keys(OPS_SECTION_7))->toEqualCanonicalizing(
        array_map(fn (NotificationKind $k) => $k->value, NotificationKind::cases()),
    );
});

it('nothing outside the write path and the sweep inserts a notification row', function () {
    // Controllers and queries render notifications and mark them read;
    // they never author one — a page has no command transaction to be
    // inside of. Notification::query()->create / Notification::create
    // may appear ONLY in Notifier and the sweep command.
    $allowed = [
        'app/Support/Notifications/Notifier.php',
        'app/Console/Commands/SweepReminders.php', // Task 17; absent until then is fine
    ];
    $files = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator(app_path(), FilesystemIterator::SKIP_DOTS)
    );
    $offenders = [];
    foreach ($files as $file) {
        $path = $file->getPathname();
        if (! str_ends_with($path, '.php')) {
            continue;
        }
        $rel = str_replace(base_path().'/', '', $path);
        if (in_array($rel, $allowed, true)) {
            continue;
        }
        $code = stripCommentTokens((string) file_get_contents($path));
        if (preg_match('/Notification::(query\(\)->)?create\(/', $code) === 1) {
            $offenders[] = $rel;
        }
    }

    expect($offenders)->toEqual([]);
});

it('every notify() call sits inside its command\'s own DB::transaction closure', function () {
    // THE PHASE'S HEADLINE GUARANTEE, made falsifiable. Global Constraints
    // claims "a notification cannot outlive a rolled-back approval, and an
    // approval cannot commit without its notification" — and without this
    // test, moving $this->notifier->notify(...) to AFTER
    // DB::transaction(...) returns in ApproveBorrowRequest,
    // RejectBorrowRequest or ReceiveReturn leaves every behavioural test in
    // this plan green. That is Phase 1d's finding verbatim (a headline
    // guard deletable with 1,028 tests passing), and this project decided
    // not to accept it a second time.
    //
    // A token walk, not a regex: brace depth is not a regular language and
    // "inside the closure" is exactly a brace-range question. Comments are
    // stripped first (the AuditActionCensusTest helper) so a docblock
    // showing a notify() call is not a call site.
    //
    // Three things in the walk are corrections to a first version that a
    // review broke in both directions, and none of them is decoration:
    //
    //   1. T_NULLSAFE_OBJECT_OPERATOR is accepted beside T_OBJECT_OPERATOR.
    //      Without it `$this->notifier?->notify(...)` moved AFTER the
    //      transaction is INVISIBLE — zero call sites counted, no offender,
    //      and the $checked floor below satisfied by other files. One
    //      Action written with `?->` would walk straight through the
    //      phase's headline guarantee in silence: Phase 1d's finding
    //      reproduced inside the guard built to prevent it.
    //   2. Anything inside a string is skipped entirely, tracked by the
    //      `"` / backtick character tokens and T_START_HEREDOC /
    //      T_END_HEREDOC. Two reasons, both measured. `"$obj->notify"`
    //      tokenises as T_VARIABLE + T_OBJECT_OPERATOR + T_STRING — a
    //      property read in a string registers as a CALL SITE. And an
    //      interpolation unbalances the brace ledger: `"bản {$code}"`
    //      emits its `{` as the ARRAY token T_CURLY_OPEN (so `$token ===
    //      '{'` is false and depth is never incremented) while its `}`
    //      arrives as a plain character (so depth IS decremented). One
    //      ordinary Vietnamese line — `"Đã cho mượn bản {$code}"` — inside
    //      a transaction closure therefore made a COMPLIANT notify()
    //      report as an offender. A red architecture test on correct code
    //      is how a guard gets deleted. Skipping strings fixes both at
    //      once and subsumes the narrower fix of counting T_CURLY_OPEN and
    //      T_DOLLAR_OPEN_CURLY_BRACES as opening braces.
    //   3. The pre-filter is `->notify` with NO paren, so it admits both
    //      `?->notify(` and `->notify (`; anything narrower than the walk
    //      means a file never reaches the walk at all.
    //
    // Known and deliberate: the walk is CONSERVATIVE about transactions it
    // cannot see. It recognises a transaction body only when a `{` follows
    // the token `transaction` LEXICALLY — so all three of these report a
    // correct call as an offender: a helper wrapper
    // (`$this->atomically(fn () => … notify …)`), a closure assigned to a
    // variable first (`$work = function () { … notify … }; DB::transaction($work);`)
    // and a first-class callable (`DB::transaction($this->work(...))`). No
    // shipped Action uses any of the three, and the failure direction is
    // the safe one (a false alarm, never a silent pass). If one appears,
    // teach the walk that shape; do not conclude the guard is wrong.
    //
    // Second known bound: there is NO receiver filter. Any `->notify(`
    // under app/ outside a transaction is an offender, whatever the object
    // — `$this->slack->notify('deploy finished')` would redden this. That
    // is harmless today (`grep -rn -- "->notify(" app/` finds nothing, and
    // no class uses Laravel's Notifiable trait), but `$user->notify(new
    // Foo)` is idiomatic Laravel, so the first person to write one will
    // redden the phase's headline guard on correct code. Add a receiver
    // check then — reddening correct code is precisely how a guard ends up
    // deleted by someone in a hurry.
    $files = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator(app_path(), FilesystemIterator::SKIP_DOTS)
    );

    $offenders = [];
    $checked = 0;
    foreach ($files as $file) {
        $path = $file->getPathname();
        if (! str_ends_with($path, '.php')) {
            continue;
        }
        $code = stripCommentTokens((string) file_get_contents($path));
        // Notifier's own declaration is `public function notify(`, never
        // `->notify(`, so the class that defines the method is skipped
        // here and pinned by the rollback test instead.
        // Deliberately '->notify' without the paren: `->notify ('u', $k)`
        // (space before the paren) would otherwise never reach the walk,
        // which matches on TOKENS and would have caught it. Pint's
        // no_spaces_after_function_name flags that spelling too, so this is
        // belt-and-braces — but a pre-filter narrower than the walk it
        // guards is a hole in the cheapest possible place.
        if (! str_contains($code, '->notify')) {
            continue;
        }
        $rel = str_replace(base_path().'/', '', $path);

        $depth = 0;
        $txDepths = [];     // brace depths whose body is a DB::transaction closure
        $armed = false;     // `transaction` seen; its closure body not yet opened
        $inString = 0;      // inside a double-quoted string, backtick or heredoc
        $previous = null;
        foreach (token_get_all($code) as $token) {
            if (is_array($token)) {
                if ($token[0] === T_WHITESPACE) {
                    continue;
                }
                if ($token[0] === T_START_HEREDOC) {
                    $inString++;
                    $previous = $token;

                    continue;
                }
                if ($token[0] === T_END_HEREDOC) {
                    $inString--;
                    $previous = $token;

                    continue;
                }
                if ($inString > 0) {
                    $previous = $token;

                    continue;
                }
                if ($token[0] === T_STRING && $token[1] === 'transaction') {
                    $armed = true;
                    $previous = $token;

                    continue;
                }
                if ($token[0] === T_STRING && $token[1] === 'notify'
                    && is_array($previous)
                    && ($previous[0] === T_OBJECT_OPERATOR || $previous[0] === T_NULLSAFE_OBJECT_OPERATOR)) {
                    $checked++;
                    if ($txDepths === []) {
                        $offenders[] = $rel.' (line '.$token[2].')';
                    }
                }
                $previous = $token;

                continue;
            }
            // A plain `"` or backtick token only appears around a string
            // that interpolates or escapes — a flat "abc" arrives as one
            // T_CONSTANT_ENCAPSED_STRING and never gets here — so these
            // come in pairs and toggling is sound.
            if ($token === '"' || $token === '`') {
                $inString = $inString === 0 ? 1 : 0;
                $previous = $token;

                continue;
            }
            if ($inString > 0) {
                $previous = $token;

                continue;
            }
            if ($token === '{') {
                $depth++;
                if ($armed) {
                    $txDepths[] = $depth;
                    $armed = false;
                }
            } elseif ($token === '}') {
                if ($txDepths !== [] && end($txDepths) === $depth) {
                    array_pop($txDepths);
                }
                $depth--;
            } elseif ($token === ';') {
                // A `DB::transaction(fn () => …);` opens no brace — disarm
                // so the next unrelated `{` is not mistaken for its body.
                $armed = false;
            }
            $previous = $token;
        }
    }

    expect($offenders)->toEqual([])
        // A guard that inspected nothing would pass silently. This task
        // ships two call sites; Tasks 5, 6 and 10 add three more.
        ->and($checked)->toBeGreaterThanOrEqual(2);
});
```

The walk was run over a nine-file corpus before this plan was committed, and the table below is its actual output — the first version of this guard was wrong on three of the nine, in both directions:

| Case | Result | |
|---|---|---|
| notify inside the closure | `checked=1` offenders NONE | correct |
| notify moved after the transaction | `checked=1` offender at the moved line | mutation 4 fires |
| notify inside a closure nested in the closure | `checked=1` offenders NONE | correct |
| two transactions, one notify between them | `checked=3` offender on the middle one | correct |
| `"$obj->notify"` plus a heredoc, no real call | `checked=0` offenders NONE | **was `checked=2`, two false offenders** |
| `"bản {$code}"` interpolation inside the closure, notify inside | `checked=1` offenders NONE | **was a false offender — the brace ledger** |
| `?->notify(` after the transaction | `checked=1` offender at that line | **was `checked=0`, INVISIBLE** |
| `DB::transaction(fn () => …);` then notify in a `foreach` | `checked=1` offender | correct — that notify really is outside |
| transaction wrapped in a helper, notify inside | `checked=1` offender | conservative false alarm, documented above |

Run over this plan's own four notify-bearing full-file blocks (`ApproveBorrowRequest`, `RejectBorrowRequest`, `ReceiveReturn`, and the rollback test): `checked=1` and no offenders on every one.

- [ ] **Step 2: Run to verify failure**

Run: `make test FILTER=Notification`
Expected: FAIL — `Class "App\Support\Notifications\NotificationSentences" not found` (and siblings).

- [ ] **Step 3: Implement the write path**

Create `app/Support/Notifications/NotificationKind.php`:

```php
<?php

declare(strict_types=1);

namespace App\Support\Notifications;

/**
 * The closed set of notification kinds — the port of kinds.ts, where the
 * map is the type: notifications.kind is a bare string column, so nothing
 * in the schema stops a command inventing a kind, and a kind with no
 * sentence would reach a child's bell as a raw token. A backed enum makes
 * an uncovered kind unrepresentable at the call site, and
 * NotificationSentences' exhaustive match makes a sentence-less case a
 * Larastan error rather than something a test notices afterwards.
 *
 * Managers get none of these — BR §15 / OPS §7, by design; every case is
 * phrased to a reader, and NotificationsAreReaderFacingTest enumerates
 * the call sites rather than trusting this comment.
 *
 * Grown per task (plan divergence 7). comment_approved is 2b's, with its
 * writer; the profile-change pair BR §15 names has no reference
 * implementation and is Phase 3's to decide.
 */
enum NotificationKind: string
{
    case MembershipApproved = 'membership_approved';
    case MembershipRejected = 'membership_rejected';
}
```

Create `lang/vi/notifications.php` (sentences verbatim from `kinds.ts`; helper lines under `_`-prefixed keys, the `lang/vi/audit.php` `frame`/`because` shape):

```php
<?php

// The Vietnamese a reader's bell shows — rendered at READ time from the
// stored payload by NotificationSentences, never stored pre-glued (a
// stored sentence would freeze every typo forever). Kind keys mirror
// NotificationKind cases exactly; NotificationSentencesTest holds the two
// sets equal. Helper lines are _-prefixed and excluded from that census.
return [
    '_unknown' => 'Bạn có một thông báo mới.',
    '_which' => 'cuốn sách',       // when a payload carries no title
    '_because' => ' vì :reason',   // absent reason → absent clause, never "null"

    'membership_approved' => 'Đơn đăng ký của bạn đã được duyệt. Chúc bạn đọc sách vui!',
    'membership_rejected' => 'Đơn đăng ký của bạn chưa được duyệt:because.',
];
```

Create `app/Support/Notifications/NotificationSentences.php`:

```php
<?php

declare(strict_types=1);

namespace App\Support\Notifications;

/**
 * kind + stored payload → the sentence a reader reads. Pure (the lang
 * file loads by require, no framework), mirroring AuditSentences' shape —
 * but with the OPPOSITE storage rule, deliberately: an audit entry is
 * evidence and shows stored values; a notification is a message to one
 * person, and re-rendering it from the payload is how "Dế Mèn" follows a
 * corrected title and a typo in the wording is fixable retroactively.
 *
 * Absent payload fields degrade, never throw; an unknown stored kind (a
 * row from another build) renders the neutral line, never the raw token.
 */
final class NotificationSentences
{
    /** @param array<string, mixed> $payload */
    public static function sentence(string $kind, array $payload): string
    {
        $known = NotificationKind::tryFrom($kind);
        if ($known === null) {
            return self::line('_unknown');
        }

        return match ($known) {
            NotificationKind::MembershipApproved => self::line('membership_approved'),
            NotificationKind::MembershipRejected => strtr(
                self::line('membership_rejected'),
                [':because' => self::because(self::str($payload, 'reason'))],
            ),
        };
    }

    /** ` vì <reason>`, or nothing — a rejection with no reason is still a sentence. */
    private static function because(?string $reason): string
    {
        return $reason === null ? '' : strtr(self::line('_because'), [':reason' => $reason]);
    }

    /** @param array<string, mixed> $payload */
    private static function str(array $payload, string $key): ?string
    {
        $value = $payload[$key] ?? null;

        return is_string($value) && trim($value) !== '' ? trim($value) : null;
    }

    private static function line(string $key): string
    {
        // `= null` is not decoration: a bare `static $lines;` makes the
        // variable a non-nullable `mixed` that always exists, and Larastan
        // level 8 rejects the `??=` beneath it as nullCoalesce.variable.
        // AuditSentences::lines() (app/Support/Audit/AuditSentences.php:206)
        // writes it this way for exactly this reason, and that is why it
        // passes today.
        /** @var array<string, string>|null $lines */
        static $lines = null;
        $lines ??= require dirname(__DIR__, 3).'/lang/vi/notifications.php';

        return $lines[$key];
    }
}
```

**`which()` and `date()` are deliberately NOT in this file yet.** They have no caller until Task 5's `request_approved` arm, and Larastan level 8 reports an uncalled private static method as `method.unused` — the whole class fails `make analyse` at this commit if they ship here. (Measured, not guessed: this exact file, placed under `app/Support/Notifications/` and run through `./vendor/bin/phpstan analyse --level=8`, produced three errors — `which() is unused`, `date() is unused`, and the `nullCoalesce.variable` above; with those three corrections it is clean, and Pint passes.) Task 5 adds `which()` in the same edit that first calls it; Task 5 also adds `date()`, which Task 17 then reuses. The `_which` lang line ships here regardless — it is `_`-prefixed, so the lang census does not require a kind for it, and shipping the sentence beside the kind it belongs to would be the churn this split avoids.

Create `app/Support/Notifications/Notifier.php`:

```php
<?php

namespace App\Support\Notifications;

use App\Models\Notification;
use App\Support\Clock;

/**
 * Writes one reader-facing notification, INSIDE the caller's transaction
 * — that last part is the whole design (OPS §7: written by the command
 * named, in the same transaction as the state change it announces). This
 * class opens no transaction and never will: a notification cannot
 * outlive a rolled-back approval, and an approval cannot commit without
 * the notification that tells the child about it.
 *
 * Deliberately NOT an audited action: a notification is a consequence of
 * something a manager did, and the audit record already names that act —
 * a second row per approval saying "the system told somebody" is noise
 * in the one log BR §14 asks to stay readable.
 *
 * bookshelf_id comes from BelongsToBookshelf's create-hook (the bound
 * tenant), never from a parameter — the same single-source-of-scope rule
 * as every other tenant write. $userId is a users(id): the parameter is
 * named so a membership id reads wrong at the call site (the recurring
 * member_id trap).
 */
final class Notifier
{
    public function __construct(private Clock $clock) {}

    /** @param array<string, string> $payload */
    public function notify(string $userId, NotificationKind $kind, array $payload = []): void
    {
        Notification::query()->create([
            'user_id' => $userId,
            'kind' => $kind->value,
            'payload' => $payload,
            'created_at' => $this->clock->now(),
        ]);
    }
}
```

- [ ] **Step 4: The membership retrofit**

In `app/Actions/Members/ApproveMembership.php`: constructor gains `private Notifier $notifier`; after the `audit->record` line, inside the same transaction closure, add:

```php
            // OPS §7's first row: "Đăng ký được duyệt — ApproveMembership".
            // member's user_id, resolved from the locked row — never the
            // membership id (the recurring trap).
            $this->notifier->notify($membership->user_id, NotificationKind::MembershipApproved);
```

In `app/Actions/Members/RejectMembership.php`: same shape, after its audit write. The reason is written **unconditionally**, and there is no null branch, because the shipped Action's signature is `execute(User $actor, Membership $membership, string $reason)` — non-nullable — and it throws `reject_reason_required` at line 31 when `trim($reason) === ''`. By the time this line runs the reason is a non-empty string. `trim($reason)` is what `rejection_reason` and the audit payload already store (lines 44 and 48), so this is the same value, spelled the same way:

```php
            $this->notifier->notify(
                $membership->user_id,
                NotificationKind::MembershipRejected,
                ['reason' => trim($reason)],
            );
```

(The first draft wrote `$reason === null ? [] : ['reason' => $reason]` and told the executor to "adapt if its variable is `$trimmed` or inline". Both were wrong: Larastan level 8 reports `Strict comparison using === between non-empty-string and null will always evaluate to false` on that line, and the hedge is what let it through. There is nothing to adapt — read the file, use `trim($reason)`.) Delete both "Phase 2 must add…" docblock paragraphs, and add the two imports **in Pint's order** — `App\Support\Notifications\NotificationKind` and `App\Support\Notifications\Notifier` sort AFTER `App\Support\Members\MembershipTransitions`, not beside `App\Support\AuditRecorder`; dropping them next to the alphabetically-nearest-looking line is an `ordered_imports` failure, which is the single defect that recurred most often across this plan's blocks.

- [ ] **Step 5: Run, mutation-check, commit**

Run: `make test FILTER=Notification && make test FILTER=Members`
Expected: PASS — including 1b's untouched membership suites.

Mutation checks (perform, observe red, restore, observe green, `git status --porcelain` clean):
1. Comment out the `notify` call in `ApproveMembership` → `NotificationsAreReaderFacingTest` "every notification is written where OPERATIONS §7 says it is" AND `NotificationWritePathTest` "approving a registration tells the reader" both red.
2. Comment out the `notify` call in `RejectMembership` → "a rejection carries its reason to the reader" AND the reader-facing census both red. Restore. (A nested-transaction mutation on `Notifier` is NOT a valid check here — Laravel nests as savepoints, so the rollback test would stay green either way; the transactional guarantee is pinned by the rollback test's direct shape and by mutation 4 below.)
3. Add a fake `Notification::query()->create` to any controller → the third architecture test goes red.
4. **The headline guard's own mutation, and the one that matters most:** in `ApproveMembership`, MOVE the `$this->notifier->notify(...)` line from inside the `DB::transaction` closure to immediately after the transaction returns — a change no behavioural test can see. Expected: "every notify() call sits inside its command's own DB::transaction closure" goes red, naming the file and the line. Restore, confirm green, `git status --porcelain` clean. If this mutation does NOT redden that test, the guard is broken and nothing in this task may be committed until it is fixed — that failure would be Phase 1d's finding recurring, which is the one outcome this task exists to prevent.
5. Delete the `->and($checked)->toBeGreaterThanOrEqual(2)` assertion and rename `Notifier::notify` to `notifyReader` everywhere → the guard's brace walk would now inspect zero call sites and pass vacuously; with the assertion in place it goes red. Restore both.
6. **The nullsafe hole, which mutation 4 does NOT cover.** Do mutation 4 again, but write the moved call as `$this->notifier?->notify(...)`. Expected: still red, still naming the file and line. Before the review this mutation passed silently — `?->` is `T_NULLSAFE_OBJECT_OPERATOR`, the walk matched only `T_OBJECT_OPERATOR`, so the call was not even counted and the `$checked` floor was met by the other file. Restore.
7. **The interpolation false positive, which no other check covers because it reddens CORRECT code.** In `ApproveMembership`, inside the transaction closure and ABOVE the (unmoved, compliant) notify call, add a throwaway line with an interpolated Vietnamese string — `$note = "Đã duyệt {$membership->id} rồi";`. Expected: the guard STAYS GREEN. Before the review it went red, because the interpolation's opening brace arrives as the array token `T_CURLY_OPEN` (never incrementing depth) while its closing brace arrives as a plain character (decrementing it), so the closure's range closed early and a compliant call looked outside. A guard that reddens on ordinary copy is a guard somebody deletes. Remove the line.

```bash
make lint && make analyse
git add app/Support/Notifications/ lang/vi/notifications.php app/Actions/Members/ tests/Unit/Notifications/ tests/Feature/Notifications/ tests/Feature/Architecture/NotificationsAreReaderFacingTest.php
git commit -m "feat: the notification write path — kinds, sentences, notifier, the membership retrofit"
```

---

### Task 3: `BorrowRequestPolicy`, the `{borrowRequest}` binding, and the model relations

Read first: `app/Policies/LoanPolicy.php` (the delegation shape and the renew() docblock), `app/Models/Bookshelf.php` (the existing relation list), and OPS §4.2's caller lines for the five commands.

**Files:**
- Create: `app/Policies/BorrowRequestPolicy.php`
- Modify: `app/Models/Bookshelf.php` (+ `borrowRequests()`, `notifications()` HasMany relations — scoped bindings resolve `{borrowRequest}`/`{notification}` through them)
- Modify: `app/Models/BorrowRequest.php` (+ `book()`, `copy()` BelongsTo relations)
- Test: `tests/Feature/Circulation/BorrowRequestPolicyTest.php`

**Interfaces:**
- Produces: `BorrowRequestPolicy::create(User): bool` (act-as-reader), `::cancel(User, BorrowRequest): bool` (act-as-reader — OWNERSHIP deliberately not here: it folds into the Action's `not_own_request`, because a policy-level 403 would confirm the request exists, the exact `LoanPolicy::renew` argument), `::approve/reject/handover(User, BorrowRequest): bool` (act-as-manager). `Bookshelf::borrowRequests(): HasMany<BorrowRequest, $this>`, `Bookshelf::notifications(): HasMany<Notification, $this>`, `BorrowRequest::book(): BelongsTo<Book, $this>`, `BorrowRequest::copy(): BelongsTo<BookCopy, $this>` (nullable FK — a pending request names no copy).

- [ ] **Step 1: Write the failing test**

Create `tests/Feature/Circulation/BorrowRequestPolicyTest.php` (the `LoanPolicy` test shape — one `it()` per actor, `SessionGuard` rule):

```php
<?php

use App\Models\Bookshelf;
use App\Models\BorrowRequest;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Illuminate\Support\Facades\Gate;

/** @return array{Bookshelf, User, User} shelf, manager, reader */
function brpFix(string $slug = 'dong-thap-brp'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);
    $manager = User::factory()->create(['full_name' => 'Maria Quản Lý Kho']);
    Membership::factory()->for($shelf)->create(['user_id' => $manager->id, 'role' => 'manager', 'status' => 'active']);
    $reader = User::factory()->create(['full_name' => 'Têrêsa Bạn Đọc Nhỏ']);
    Membership::factory()->for($shelf)->create(['user_id' => $reader->id, 'role' => 'reader', 'status' => 'active']);

    return [$shelf, $manager, $reader];
}

it('a reader may create and cancel; only a manager may approve, reject, hand over', function () {
    [$shelf, $manager, $reader] = brpFix();
    app(TenantContext::class)->set($shelf, Membership::query()->where('user_id', $reader->id)->firstOrFail());
    test()->actingAs($reader);

    $request = new BorrowRequest;
    expect(Gate::forUser($reader)->allows('create', BorrowRequest::class))->toBeTrue()
        ->and(Gate::forUser($reader)->allows('cancel', $request))->toBeTrue()
        ->and(Gate::forUser($reader)->allows('approve', $request))->toBeFalse()
        ->and(Gate::forUser($reader)->allows('reject', $request))->toBeFalse()
        ->and(Gate::forUser($reader)->allows('handover', $request))->toBeFalse();
});

it('a manager holds all five abilities — act-as-manager implies act-as-reader', function () {
    [$shelf, $manager] = brpFix('dong-thap-brp-mgr');
    app(TenantContext::class)->set($shelf, Membership::query()->where('user_id', $manager->id)->firstOrFail());
    test()->actingAs($manager);

    $request = new BorrowRequest;
    foreach (['approve', 'reject', 'handover', 'cancel'] as $ability) {
        expect(Gate::forUser($manager)->allows($ability, $request))->toBeTrue($ability);
    }
    expect(Gate::forUser($manager)->allows('create', BorrowRequest::class))->toBeTrue();
});
```

(If the shipped `act-as-reader` gate does NOT wave a manager through — read `AppServiceProvider`'s gate definitions before writing the second test — flip those two expectations to match the shipped hierarchy and say so in a comment: BR §13's `admin ⊃ manager ⊃ reader` is the intent, and the gates are the authority on how it was encoded.)

- [ ] **Step 2: Run to verify failure** — `make test FILTER=BorrowRequestPolicyTest`. Expected: FAIL (policy class missing → Gate denies everything).

- [ ] **Step 3: Implement**

Create `app/Policies/BorrowRequestPolicy.php`:

```php
<?php

namespace App\Policies;

use App\Models\BorrowRequest;
use App\Models\User;
use Illuminate\Support\Facades\Gate;

/**
 * OPS §4.2's callers, delegating to the act-as gates the way LoanPolicy
 * does. Ownership is deliberately NOT here: cancel's "own request only"
 * folds into the Action's not_own_request (both sides users.id), because
 * a policy-level 403 would confirm the request exists — spec §5.4.
 */
final class BorrowRequestPolicy
{
    public function create(User $user): bool
    {
        return Gate::forUser($user)->allows('act-as-reader');
    }

    public function cancel(User $user, BorrowRequest $request): bool
    {
        return Gate::forUser($user)->allows('act-as-reader');
    }

    public function approve(User $user, BorrowRequest $request): bool
    {
        return Gate::forUser($user)->allows('act-as-manager');
    }

    public function reject(User $user, BorrowRequest $request): bool
    {
        return Gate::forUser($user)->allows('act-as-manager');
    }

    public function handover(User $user, BorrowRequest $request): bool
    {
        return Gate::forUser($user)->allows('act-as-manager');
    }
}
```

In `app/Models/Bookshelf.php`, beside the existing relations:

```php
    /** @return HasMany<BorrowRequest, $this> */
    public function borrowRequests(): HasMany
    {
        return $this->hasMany(BorrowRequest::class);
    }

    /** @return HasMany<Notification, $this> */
    public function notifications(): HasMany
    {
        return $this->hasMany(Notification::class);
    }
```

In `app/Models/BorrowRequest.php`:

```php
    /** @return BelongsTo<Book, $this> */
    public function book(): BelongsTo
    {
        return $this->belongsTo(Book::class);
    }

    /** @return BelongsTo<BookCopy, $this> */
    public function copy(): BelongsTo
    {
        return $this->belongsTo(BookCopy::class, 'copy_id');
    }
```

- [ ] **Step 4: Run, lint, commit**

Run: `make test FILTER=BorrowRequestPolicyTest` — PASS. `make test` (whole suite) — PASS (relations are additive).

```bash
make lint && make analyse
git add app/Policies/BorrowRequestPolicy.php app/Models/Bookshelf.php app/Models/BorrowRequest.php tests/Feature/Circulation/BorrowRequestPolicyTest.php
git commit -m "feat: borrowrequestpolicy and the request model relations"
```

---

### Task 4: `CreateBorrowRequest` — a reader joins the queue

Read first: `old_next/src/domain/circulation/commands/create-borrow-request.ts` (whole file — the docblock is the specification), `old_next/tests/domain/circulation/borrow-requests.test.ts` tests 1–8 (`describe` block "createBorrowRequest"), and plan divergences 2, 3, 4.

**Files:**
- Create: `app/Actions/Circulation/CreateBorrowRequest.php`
- Modify: `app/Support/Audit/AuditSentences.php` (+ `request.created`), `lang/vi/audit.php` (+ line)
- Modify: `tests/Unit/Catalogue/RuleViolatedCodesHaveSentencesTest.php` (census + `duplicate_request`, `not_permitted` already listed — add only `duplicate_request`)
- Modify: `tests/Feature/Architecture/CirculationArchitectureTest.php` (the lockForUpdate grep-pin list gains this Action)
- Test: `tests/Feature/Circulation/CreateBorrowRequestTest.php`

**Interfaces:**
- Consumes: `RequestRules::memberMayRequest` (Task 1), `AuditRecorder`, `Clock`, `TenantContext::membership()`.
- Produces: `CreateBorrowRequest::execute(User $actor, Book $book): array{requestId: string}` — throws `RuleViolated` with `not_permitted` | `membership_not_active_cannot_request` | `duplicate_request`; audit action `request.created`. Task 12's controller calls exactly this.

**What serialises each check (divergence 1's per-command table):**

| Check | Serialised by | Structural backstop |
|---|---|---|
| duplicate (pending/approved for this title+reader) | **nothing — this command takes no lock at all** (divergence 2: a `books` `FOR UPDATE` here closes a real AB–BA cycle against `UpdateBook`, so the lock is withdrawn) | **`borrow_requests_one_live_per_title_member`** (Task 1's Step 0). The plain read is the sentence half; the losing insert's 1062 is translated by constraint name. This is the ONE check in the phase whose backstop is structural rather than a lock — and it is the stronger of the two |
| membership active (INV-4) | nothing (plain read of the session's membership) — unreachable over HTTP anyway (ported reading 1) | none |

- [ ] **Step 1: Write the failing tests**

Create `tests/Feature/Circulation/CreateBorrowRequestTest.php`:

```php
<?php

use App\Actions\Circulation\CreateBorrowRequest;
use App\Enums\RequestStatus;
use App\Exceptions\RuleViolated;
use App\Models\AuditLog;
use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\BorrowRequest;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

afterEach(fn () => Carbon::setTestNow());

/**
 * Shelf + reader (acting, tenant-bound to their own membership) + one
 * book with one available copy. @return array{Bookshelf, User, Membership, Book}
 */
function cbrFix(string $slug = 'dong-thap-cbr'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);
    $readerUser = User::factory()->create(['full_name' => 'Têrêsa Bạn Đọc Nhỏ']);
    $membership = Membership::factory()->for($shelf)->create([
        'user_id' => $readerUser->id, 'role' => 'reader', 'status' => 'active',
    ]);
    $book = Book::query()->create([
        'bookshelf_id' => $shelf->id, 'title' => 'Dế Mèn Phiêu Lưu Ký', 'slug' => 'de-men',
    ]);
    BookCopy::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0001', 'state' => 'available',
    ]);
    app(TenantContext::class)->set($shelf, $membership);
    test()->actingAs($readerUser);

    return [$shelf, $readerUser, $membership, $book];
}

it('a reader joins the queue, and the row carries their USER id and the injected clock', function () {
    Carbon::setTestNow(Carbon::parse('2026-08-28 03:00:00', 'UTC'));
    [, $reader, $membership, $book] = cbrFix();

    $result = app(CreateBorrowRequest::class)->execute($reader, $book);

    $row = BorrowRequest::query()->findOrFail($result['requestId']);
    expect($row->status)->toBe(RequestStatus::Pending)
        ->and($row->member_id)->toBe($membership->user_id)      // users.id, NEVER membership id
        ->and($row->book_id)->toBe($book->id)
        ->and($row->copy_id)->toBeNull()
        // requested_at is the queue's ordering key and every hold derived
        // from it is compared against the injected clock — a column
        // default would order the queue by the DB host's clock while
        // expiring holds by the injected one (the reference's docblock).
        ->and($row->requested_at->toIso8601ZuluString())->toBe('2026-08-28T03:00:00Z');
});

it('a copy being free is not a reason to refuse a request', function () {
    // OPS §4.2: a reader may queue even when copies exist — a request is
    // a statement of intent about a TITLE, never a claim on a copy.
    // Nothing reads book_copies at all.
    [, $reader, , $book] = cbrFix('dong-thap-cbr-free');

    $result = app(CreateBorrowRequest::class)->execute($reader, $book);

    expect(BorrowRequest::query()->find($result['requestId']))->not->toBeNull();
});

it('a second request for the same title is refused, pending or approved', function () {
    [$shelf, $reader, $membership, $book] = cbrFix('dong-thap-cbr-dup');

    app(CreateBorrowRequest::class)->execute($reader, $book);
    expect(fn () => app(CreateBorrowRequest::class)->execute($reader, $book))
        ->toThrow(RuleViolated::class, 'duplicate_request');

    // Approved counts too: a child whose copy is on the shelf with their
    // name on it must not also stand in the queue for the same title.
    BorrowRequest::query()->update(['status' => RequestStatus::Approved]);
    expect(fn () => app(CreateBorrowRequest::class)->execute($reader, $book))
        ->toThrow(RuleViolated::class, 'duplicate_request');
});

it('a cancelled request does not block a second attempt', function () {
    [, $reader, , $book] = cbrFix('dong-thap-cbr-again');

    $first = app(CreateBorrowRequest::class)->execute($reader, $book);
    BorrowRequest::query()->whereKey($first['requestId'])
        ->update(['status' => RequestStatus::Cancelled, 'cancelled_at' => now()]);

    $second = app(CreateBorrowRequest::class)->execute($reader, $book);
    expect($second['requestId'])->not->toBe($first['requestId']);
});

it('a suspended reader is refused in the queue\'s own words', function () {
    // Unreachable over HTTP (ResolveTenant resolves active memberships
    // only — ported reading 1); the command still checks, so the rule and
    // its sentence exist for any future caller. The tenant is bound to
    // the suspended membership directly, below the middleware.
    [$shelf, $reader, $membership, $book] = cbrFix('dong-thap-cbr-susp');
    Membership::query()->whereKey($membership->id)->update([
        'status' => 'suspended', 'suspension_reason' => 'thử nghiệm',
    ]);
    app(TenantContext::class)->set($shelf->fresh(), $membership->fresh());

    expect(fn () => app(CreateBorrowRequest::class)->execute($reader, $book))
        ->toThrow(RuleViolated::class, 'membership_not_active_cannot_request');
    expect(BorrowRequest::query()->count())->toBe(0);
});

it('this command takes no row lock at all — divergence 2, pinned rather than described', function () {
    // The withdrawn book lock closed an AB-BA cycle against UpdateBook
    // (which X-locks bookshelves, then writes the book row, while this
    // command's inserts want S on that same bookshelves row through their
    // RESTRICT foreign keys). "It takes no lock" is a claim a grep can
    // falsify, unlike a claim about cycles — so this is the claim made.
    DB::flushQueryLog();
    DB::enableQueryLog();
    [, $reader, , $book] = cbrFix('dong-thap-cbr-nolock');
    DB::flushQueryLog();
    app(CreateBorrowRequest::class)->execute($reader, $book);
    $log = DB::getQueryLog();
    DB::disableQueryLog();

    $locking = array_values(array_filter(
        $log,
        fn (array $q) => str_contains(strtolower($q['query']), 'for update'),
    ));
    expect($locking)->toBe([]);
    // And the source itself, so a lock added to a branch the fixture does
    // not reach is caught too.
    expect(file_get_contents(app_path('Actions/Circulation/CreateBorrowRequest.php')))
        ->not->toContain('lockForUpdate');
});

it('INV-8: the create writes one audit record storing the title and both ids', function () {
    [, $reader, $membership, $book] = cbrFix('dong-thap-cbr-audit');

    $result = app(CreateBorrowRequest::class)->execute($reader, $book);

    $entry = AuditLog::query()->where('action', 'request.created')->firstOrFail();
    $after = (array) $entry->after;
    expect($entry->entity_id)->toBe($result['requestId'])
        ->and($entry->actor_id)->toBe($reader->id)
        ->and($entry->before)->toBeNull()                        // the row did not exist
        ->and($after['status'])->toBe('pending')
        ->and($after['title'])->toBe('Dế Mèn Phiêu Lưu Ký')      // stored, never re-read
        ->and($after['userId'])->toBe($membership->user_id)
        ->and($after['membership_id'])->toBe($membership->id)
        // Always-present null: 2c's QR-scan path fills it (divergence 3),
        // and the payload shape must not change when it does.
        ->and(array_key_exists('copy_id', $after))->toBeTrue()
        ->and($after['copy_id'])->toBeNull();
});

it('a manager cannot queue on a reader\'s behalf through this command', function () {
    // OPS names the caller `reader`; a manager queueing for a child is a
    // DIFFERENT command nobody has specified (the reference's argument).
    // The manager's own membership is the bound one, and its user_id is
    // not the actor being requested for — there is no parameter to say
    // "for somebody else" at all; this pins that the row is always the
    // CALLER's.
    [$shelf, , , $book] = cbrFix('dong-thap-cbr-mgr');
    app(TenantContext::class)->actSystemWide();
    $manager = User::factory()->create(['full_name' => 'Maria Quản Lý Kho']);
    $mm = Membership::factory()->for($shelf)->create(['user_id' => $manager->id, 'role' => 'manager', 'status' => 'active']);
    app(TenantContext::class)->set($shelf->fresh(), $mm);
    test()->actingAs($manager);

    $result = app(CreateBorrowRequest::class)->execute($manager, $book);

    // The row belongs to the MANAGER (their own request as a member) —
    // never to any other member.
    expect(BorrowRequest::query()->findOrFail($result['requestId'])->member_id)->toBe($manager->id);
});
```

- [ ] **Step 2: Run to verify failure** — `make test FILTER=CreateBorrowRequestTest`. Expected: FAIL — class not found.

- [ ] **Step 3: Implement**

Create `app/Actions/Circulation/CreateBorrowRequest.php`:

```php
<?php

namespace App\Actions\Circulation;

use App\Enums\RequestStatus;
use App\Exceptions\RuleViolated;
use App\Models\Book;
use App\Models\BorrowRequest;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\Circulation\RequestRules;
use App\Support\Clock;
use App\Support\TenantContext;
use App\Support\UniqueViolation;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * A reader joins the queue for a title — BR §16.1's "Xin mượn", port of
 * create-borrow-request.ts. This does not check whether a copy is free,
 * and that is the whole point (OPS §4.2, BR §7.2): a request is a
 * statement of intent about a TITLE and never a claim on a physical
 * object — the claim is made by ApproveBorrowRequest, by a manager, on a
 * copy they chose. Nothing here reads book_copies at all.
 *
 * NO LOCK IS TAKEN HERE, and that absence is deliberate (plan divergence
 * 2). An earlier draft opened with Book::query()->lockForUpdate(); that
 * closes a real AB-BA cycle against UpdateBook, which takes X on the
 * shelf's bookshelves row and then WRITES the book row, while this
 * command's borrow_requests insert and its audit insert each want S on
 * that same bookshelves row through their RESTRICT foreign keys. The rule
 * the lock protected — one live place in this title's queue per reader —
 * is a CONSTRAINT instead: borrow_requests_one_live_per_title_member over
 * the generated column live_request_key, which nothing can race at any
 * isolation level. The read below is the sentence half (the friendly
 * refusal in the common case); the losing insert's errno 1062 is
 * translated by constraint name, exactly as LendCopy translates
 * loans_one_active_per_copy. The reference documents the race it ships
 * ("two taps in the same second produce two pending rows"); this port
 * closes it structurally rather than by serialising the whole title.
 *
 * No claim is made here, or anywhere in this phase, that the codebase is
 * deadlock-free — that claim needs two real OS processes to earn. The
 * claim is only this: no lockForUpdate appears in this file. Its test
 * greps for exactly that, and draws no further inference — the INSERT
 * below still holds an implicit exclusive record lock on the unique-index
 * entry until commit, so a racing create for the same (book_id,
 * member_id) BLOCKS on it and then receives 1062 (measured at ~3 s behind
 * a slowed winner). Both the read above and that 1062 resolve to the same
 * duplicate_request sentence, so the racer's experience is identical
 * either way; what the withdrawn books lock would have added is not the
 * waiting but an exclusive edge on a row UpdateBook also takes.
 *
 * The membership is the SESSION's, never a form field (plan divergence
 * 4): TenantContext::membership() is what ResolveTenant resolved for the
 * signed-in caller, so "a reader who edited the hidden field" cannot
 * exist here; the user_id comparison below is defence in depth.
 *
 * NARROWED against the reference, explicitly (plan divergence 3): no
 * copyId input. The reference records which scanned copy prompted a
 * request; QR labels and ResolveCopyById are 2c's, so nothing in 2a can
 * produce one. 2c restores the optional input, its same-title/same-shelf
 * guards, and fills the copy_id audit key this class already writes as
 * null. member_id receives a users(id), despite its name — the schema's
 * recurring trap; the resolve happens exactly once, below.
 *
 * requested_at is written from the injected clock, though the column
 * carries a default: it is the queue's ordering key, and every hold
 * derived from it is compared against the same injected clock.
 */
final class CreateBorrowRequest
{
    public function __construct(
        private Clock $clock,
        private AuditRecorder $audit,
        private TenantContext $tenant,
    ) {}

    /** @return array{requestId: string} */
    public function execute(User $actor, Book $book): array
    {
        Gate::forUser($actor)->authorize('create', BorrowRequest::class);

        return DB::transaction(function () use ($actor, $book): array {
            // The latest committed row, not the route-bound snapshot — but
            // NOT locked (see the class docblock).
            $book = Book::query()->findOrFail($book->id);

            $membership = $this->tenant->membership();
            if ($membership === null || $membership->user_id !== $actor->id) {
                throw new RuleViolated('not_permitted');
            }
            if (($code = RequestRules::memberMayRequest($membership->status)) !== null) {
                throw new RuleViolated($code);
            }

            // approved counts as well as pending: a child holding a copy
            // must not also stand in the queue for the same title.
            // Soft-deleted rows are excluded by the model's own scope —
            // and by live_request_key's own expression, which names
            // deleted_at, so the read and the index select the same set.
            $existing = BorrowRequest::query()
                ->where('book_id', $book->id)
                ->where('member_id', $membership->user_id)
                ->whereIn('status', [RequestStatus::Pending, RequestStatus::Approved])
                ->exists();
            if ($existing) {
                throw new RuleViolated('duplicate_request');
            }

            try {
                $request = BorrowRequest::query()->create([
                    'book_id' => $book->id,
                    'member_id' => $membership->user_id,
                    'status' => RequestStatus::Pending,
                    'requested_at' => $this->clock->now(),
                ]);
            } catch (QueryException $e) {
                // Divergence 2's loser: the read above missed because the
                // rival committed after it. Matched BY CONSTRAINT NAME so
                // an unrelated 1062 is never dressed up as the wrong
                // refusal; anything else rethrows untouched.
                UniqueViolation::translate($e, [
                    'borrow_requests_one_live_per_title_member' => 'duplicate_request',
                ]);
            }

            $this->audit->record('request.created', 'request', $request->id,
                // Null rather than an invented "before": the row did not exist.
                null,
                [
                    'status' => 'pending',
                    'book_id' => $book->id,
                    // Always-present null until 2c's scan path fills it.
                    'copy_id' => null,
                    // The title AS IT IS NOW, stored (P1 §3.2a) — an audit
                    // sentence must not re-read a title UpdateBook can correct.
                    'title' => $book->title,
                    // Both ids, the loan.created rule: member_id/userId is
                    // what the row holds and what the subject join reads;
                    // membership_id is the only shelf-specific one.
                    'userId' => $membership->user_id,
                    'membership_id' => $membership->id,
                ]);

            return ['requestId' => $request->id];
        });
    }
}
```

- [ ] **Step 4: The sentence, the censuses, the grep pin**

In `lang/vi/audit.php`, after the loan lines (group `— mượn trả —`):

```php
    'request_created' => 'gửi yêu cầu mượn :title',
```

In `app/Support/Audit/AuditSentences.php`: **the class docblock's opening line says "21 entries" (`app/Support/Audit/AuditSentences.php:8-9`) and it must be corrected in the same edit that changes the count — every time, in every task, not once at the end.** 2a adds six actions: `request.created` (this task, → 22), `request.approved` (T5, → 23), `request.rejected` (T6, → 24), `request.cancelled` (T7, → 25), `request.fulfilled` (T8, → 26), `request.expired` (T18, → **27**, the number the branch ends on). A docblock that counts wrong is the same defect as a map that maps wrong — `AuditActionCensusTest` holds the map honest and nothing holds the prose honest but this instruction. `ACTIONS` gains `'request.created' => 'loans',` (the reference groups `request.*` with `loan.*` — "one family to a volunteer", its `muon-tra` group), and `phrase()` gains the arm:

```php
            'request.created' => strtr(self::line('request_created'), [':title' => self::which(self::str($after, 'title'))]),
```

`AuditActionCensusTest` needs no edit — it recomputes both sets; it goes red only if writer and map do not land together, which is exactly its job.

In `tests/Unit/Catalogue/RuleViolatedCodesHaveSentencesTest.php`, add `'duplicate_request',` to the `toEqualCanonicalizing` list (alphabetical position). `not_permitted` and `membership_not_active_cannot_request` are NOT added: the first is already listed (1b), the second is thrown as a variable and censused by `RequestRulesTest`.

In `tests/Feature/Architecture/CirculationArchitectureTest.php`, the lockForUpdate grep-pin list does **NOT** gain this Action — it takes no lock (divergence 2). Add the exemption comment above the list instead, so the absence is a recorded decision rather than an omission:

```php
    // CreateBorrowRequest is deliberately absent: it takes no lock at all
    // (plan divergence 2 — a books FOR UPDATE here closes an AB-BA cycle
    // against UpdateBook). Its duplicate rule is the
    // borrow_requests_one_live_per_title_member index, and
    // CreateBorrowRequestTest greps the file for lockForUpdate to keep the
    // absence true.
```

- [ ] **Step 5: Run all touched suites**

Run: `make test FILTER=CreateBorrowRequestTest && make test FILTER=RuleViolatedCodesHaveSentencesTest && make test FILTER=AuditActionCensusTest && make test FILTER=AuditSentencesTest`
Expected: PASS.

- [ ] **Step 6: Mutation checks, then commit**

1. ADD `->lockForUpdate()` back to the book read → "this command takes no row lock at all" goes red on both of its assertions (the query log and the source grep). Restore. (The mutation is backwards on purpose: the property under guard is an absence, and an absence is only guarded if putting the thing back is caught.)
2. ~~Change `whereIn(... Pending, Approved)` to Pending only → "a second request … pending or approved" goes red. Restore.~~ **STRUCK as unsatisfiable, and REPLACED** (coordinator ruling, Task 4 review round 1). It contradicts 2b by construction: 2b requires that deleting the read ENTIRELY leaves that test green, because `live_request_key` covers `pending` and `approved` alike and the losing insert's 1062 becomes the same `duplicate_request`. Narrowing the read is strictly weaker than deleting it, so it cannot redden what deletion must leave green — measured green at Task 4. The property mutation 2 was reaching for is real but is about WHICH LAYER refuses, so pin that instead: **on the second attempt, assert no `insert into `borrow_requests`` statement was attempted, captured via `DB::beforeExecuting`** — then narrowing the read to `Pending` only DOES redden, because the approved rival now travels to the index. Do **not** use `getQueryLog()` for this: `Connection::run()` calls `logQuery()` only after the callback returns and `handleQueryException` rethrows immediately inside a transaction, so a throwing insert never reaches the log and the assertion is a tautology that passes either way (measured at Task 4: `getQueryLog()`=0, `beforeExecuting()`=1). This defect appears once in this plan, at this line; no other task inherits it.
2b. **The backstop check — the one mutation that must NOT redden.** Delete the whole `$existing` read and its `throw`, leaving only the insert and its catch. Expected: "a second request for the same title is refused, pending or approved" STILL PASSES, now travelling through errno 1062 and `UniqueViolation::translate` instead of the read; the refusal is still `duplicate_request`, still a `RuleViolated`, never a 500. If it instead fails with a `QueryException`, the constraint name in the translate map does not match the migration's and both must be fixed before this task ships. Restore the read (it is the friendly path; the index is the guarantee). Task 1's `LiveRequestKeyTest` proves the constraint independently.
3. Delete the `request_created` line from `lang/vi/audit.php` → `AuditSentencesTest`'s existing every-action-renders sweep (or, if that sweep enumerates from ACTIONS, the census) goes red. If NEITHER goes red, add to `tests/Unit/Audit/AuditSentencesTest.php` a one-line render test for `request.created` before proceeding — a sentence nothing pins is not shipped. Restore.

```bash
make lint && make analyse
git add app/Actions/Circulation/CreateBorrowRequest.php app/Support/Audit/AuditSentences.php lang/vi/audit.php tests/
git commit -m "feat: createborrowrequest — a statement about a title, serialised on the title"
```

---

### Task 5: `ApproveBorrowRequest` — a copy put aside, a hold clock started, a child told

Read first: `old_next/src/domain/circulation/commands/approve-borrow-request.ts` (whole file), `old_next/tests/domain/circulation/borrow-requests.test.ts` tests 9–15 ("approveBorrowRequest" block), `inv-03-only-available-or-own-hold.test.ts` tests 3–4.

**Files:**
- Create: `app/Actions/Circulation/ApproveBorrowRequest.php`
- Modify: `app/Support/Notifications/NotificationKind.php` (+ `RequestApproved = 'request_approved'`), `NotificationSentences.php` (+ arm), `lang/vi/notifications.php` (+ line), `tests/Feature/Architecture/NotificationsAreReaderFacingTest.php` (+ table row)
- Modify: `app/Support/Audit/AuditSentences.php` (+ `request.approved`), `lang/vi/audit.php`
- Modify: `tests/Unit/Catalogue/RuleViolatedCodesHaveSentencesTest.php` (+ `request_not_pending`, `copy_not_found`)
- Modify: `tests/Feature/Architecture/CirculationArchitectureTest.php` (lock grep-pin list + this Action)
- Test: `tests/Feature/Circulation/ApproveBorrowRequestTest.php`

**Interfaces:**
- Consumes: `RequestRules::copyHoldable`, `LoanTerms::holdExpiry`, `LendingSettings::holdDays`, `Notifier`, `AuditRecorder`, `Clock`, `TenantContext`.
- Produces: `ApproveBorrowRequest::execute(User $actor, BorrowRequest $request, string $copyId): array{requestId: string, copyId: string, holdExpiresAt: \Carbon\CarbonImmutable}` — throws `copy_not_found` | `request_not_pending` | `no_copy_available` | `chosen_copy_lost_or_retired`; audit `request.approved`; notification `request_approved`. Task 14's controller calls exactly this. `$copyId` is a raw string (a form field, not a route binding) — the Form Request validates it `uuid` so a stray emoji is a validation message, never an errno 1267.

**What serialises each check:**

| Check | Serialised by | Structural backstop |
|---|---|---|
| copy is available and free of a live hold (INV-3/7) | the **copy-row** `FOR UPDATE`, first statement — two managers approving two readers onto one copy serialise here; the second reads `held` and hears `no_copy_available` (the reference's own row-lock argument, OPS §6) | none — `borrow_requests` has no uniqueness on `copy_id`; the lock IS the guarantee, as in the reference |
| request still pending | the **request-row** `FOR UPDATE`, second statement (the reference read it unlocked — this port serialises a rival reject/cancel too) | none |

- [ ] **Step 1: Write the failing tests**

Create `tests/Feature/Circulation/ApproveBorrowRequestTest.php`:

```php
<?php

use App\Actions\Circulation\ApproveBorrowRequest;
use App\Enums\CopyState;
use App\Enums\RequestStatus;
use App\Exceptions\RuleViolated;
use App\Models\AuditLog;
use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\BorrowRequest;
use App\Models\Membership;
use App\Models\Notification;
use App\Models\User;
use App\Support\TenantContext;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

afterEach(fn () => Carbon::setTestNow());

/**
 * Shelf + acting manager + reader + book with one available copy + one
 * PENDING request by the reader. @return array{Bookshelf, User, User, BookCopy, BorrowRequest}
 */
function abrFix(array $shelfSettings = [], string $slug = 'dong-thap-abr'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => $shelfSettings]);
    $manager = User::factory()->create(['full_name' => 'Maria Quản Lý Kho']);
    $mm = Membership::factory()->for($shelf)->create(['user_id' => $manager->id, 'role' => 'manager', 'status' => 'active']);
    $reader = User::factory()->create(['full_name' => 'Têrêsa Bạn Đọc Nhỏ']);
    Membership::factory()->for($shelf)->create(['user_id' => $reader->id, 'role' => 'reader', 'status' => 'active']);
    $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Hoàng Tử Bé', 'slug' => 'hoang-tu-be']);
    $copy = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0002', 'state' => 'available']);
    $request = BorrowRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'member_id' => $reader->id,
        'status' => RequestStatus::Pending, 'requested_at' => now(),
    ]);
    app(TenantContext::class)->set($shelf, $mm);
    test()->actingAs($manager);

    return [$shelf, $manager, $reader, $copy, $request];
}

it('approving puts the copy aside and starts the hold clock from the injected clock', function () {
    Carbon::setTestNow(Carbon::parse('2026-08-28 07:00:00', 'UTC'));
    [, $manager, $reader, $copy, $request] = abrFix(['hold_days' => 5]);

    $result = app(ApproveBorrowRequest::class)->execute($manager, $request, $copy->id);

    $row = $request->fresh();
    expect($row->status)->toBe(RequestStatus::Approved)
        ->and($row->copy_id)->toBe($copy->id)
        ->and($row->decided_by)->toBe($manager->id)
        // hold_days is the SHELF's (5 here, not the default 3), counted
        // from the injected instant.
        ->and($row->hold_expires_at->toIso8601ZuluString())->toBe('2026-09-02T07:00:00Z')
        ->and($result['holdExpiresAt']->toIso8601ZuluString())->toBe('2026-09-02T07:00:00Z')
        ->and($copy->fresh()->state)->toBe(CopyState::Held);
});

it('the approval tells the reader — one notification with the title and the HCM deadline date', function () {
    // 17:30 UTC on the 28th is already the morning of the 29th in
    // Asia/Ho_Chi_Minh; +3 days lands 17:30Z on the 31st, which is
    // 00:30 on 01/09 HCM — the payload date is the PARISH's day (plan
    // divergence 5; the reference stored the UTC slice, 2026-08-31).
    Carbon::setTestNow(Carbon::parse('2026-08-28 17:30:00', 'UTC'));
    [, $manager, $reader, $copy, $request] = abrFix([], 'dong-thap-abr-notify');

    app(ApproveBorrowRequest::class)->execute($manager, $request, $copy->id);

    $note = Notification::query()->get();
    expect($note)->toHaveCount(1)
        ->and($note[0]->user_id)->toBe($reader->id)
        ->and($note[0]->kind)->toBe('request_approved')
        ->and($note[0]->payload)->toMatchArray(['title' => 'Hoàng Tử Bé', 'hold_until' => '2026-09-01']);
});

it('a copy of a different title cannot be assigned — not found, not refused about availability', function () {
    [$shelf, $manager, , , $request] = abrFix([], 'dong-thap-abr-other');
    app(TenantContext::class)->actSystemWide();
    $other = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Đất Rừng Phương Nam', 'slug' => 'dat-rung']);
    $otherCopy = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $other->id, 'code' => 'DT-0009', 'state' => 'available']);
    app(TenantContext::class)->set($shelf->fresh(), Membership::query()->where('user_id', $manager->id)->firstOrFail());

    expect(fn () => app(ApproveBorrowRequest::class)->execute($manager, $request, $otherCopy->id))
        ->toThrow(RuleViolated::class, 'copy_not_found');
});

it('a copy already held or on loan cannot be promised again', function () {
    [, $manager, , $copy, $request] = abrFix([], 'dong-thap-abr-held');
    BookCopy::query()->whereKey($copy->id)->update(['state' => 'held']);
    expect(fn () => app(ApproveBorrowRequest::class)->execute($manager, $request, $copy->id))
        ->toThrow(RuleViolated::class, 'no_copy_available');
});

it('a lost copy cannot be put aside, and says so in its own words', function () {
    [, $manager, , $copy, $request] = abrFix([], 'dong-thap-abr-lost');
    BookCopy::query()->whereKey($copy->id)->update(['state' => 'lost']);
    expect(fn () => app(ApproveBorrowRequest::class)->execute($manager, $request, $copy->id))
        ->toThrow(RuleViolated::class, 'chosen_copy_lost_or_retired');
});

it('an AVAILABLE copy under a live hold is refused — the two-clause predicate, not state alone', function () {
    // No shipped command produces available+held-for, but no constraint
    // forbids it either; the predicate must refuse it (the reference's
    // copies_borrowable second clause). Constructed directly.
    Carbon::setTestNow(Carbon::parse('2026-08-28 07:00:00', 'UTC'));
    [$shelf, $manager, $reader, $copy, $request] = abrFix([], 'dong-thap-abr-twoclause');
    app(TenantContext::class)->actSystemWide();
    $rival = User::factory()->create(['full_name' => 'Anna Người Giữ Trước']);
    BorrowRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $request->book_id, 'member_id' => $rival->id,
        'status' => RequestStatus::Approved, 'requested_at' => now()->subHour(),
        'copy_id' => $copy->id, 'hold_expires_at' => now()->addDays(2),
        'decided_by' => $manager->id, 'decided_at' => now()->subHour(),
    ]);
    app(TenantContext::class)->set($shelf->fresh(), Membership::query()->where('user_id', $manager->id)->firstOrFail());

    expect(fn () => app(ApproveBorrowRequest::class)->execute($manager, $request, $copy->id))
        ->toThrow(RuleViolated::class, 'no_copy_available');
});

it('a LAPSED rival hold is no obstacle — the expiry filter, pinned directly', function () {
    // The mirror of the test above, and the one that makes the
    // `hold_expires_at > now` filter falsifiable: same shape, same rival
    // row, only the deadline moved into the past. BR §8 — no job flipped
    // anything; the clock alone made the hold absent, and the copy the
    // ex-holder never collected was put back on the shelf by an ordinary
    // ReleaseExpiredHold (ruling 1) or was never taken off it. Delete the
    // filter and the rival reads as live: this test goes red with
    // no_copy_available while the live-hold test above stays green, which
    // is why BOTH are needed.
    Carbon::setTestNow(Carbon::parse('2026-08-28 07:00:00', 'UTC'));
    [$shelf, $manager, $reader, $copy, $request] = abrFix([], 'dong-thap-abr-lapsed');
    app(TenantContext::class)->actSystemWide();
    $rival = User::factory()->create(['full_name' => 'Anna Người Không Đến']);
    Membership::factory()->for($shelf)->create(['user_id' => $rival->id, 'role' => 'reader', 'status' => 'active']);
    BorrowRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $request->book_id, 'member_id' => $rival->id,
        'status' => RequestStatus::Approved, 'requested_at' => now()->subDays(5),
        'copy_id' => $copy->id, 'hold_expires_at' => now()->subDay(),   // LAPSED
        'decided_by' => $manager->id, 'decided_at' => now()->subDays(5),
    ]);
    // The copy is available: the lapsed holder never came, and the shelf
    // has it back. (A different reader, so the live-request unique index
    // — Task 1 — is not in play.)
    app(TenantContext::class)->set($shelf->fresh(), Membership::query()->where('user_id', $manager->id)->firstOrFail());

    $result = app(ApproveBorrowRequest::class)->execute($manager, $request, $copy->id);

    expect($request->fresh()->status)->toBe(RequestStatus::Approved)
        ->and($result['copyId'])->toBe($copy->id)
        ->and($copy->fresh()->state)->toBe(CopyState::Held)
        // And the lapsed row was left exactly as it was — approving over
        // a dead hold is not a licence to rewrite it.
        ->and(BorrowRequest::query()->where('member_id', $rival->id)->sole()->status)
        ->toBe(RequestStatus::Approved);
});

it('a request that has already been decided cannot be approved again', function () {
    [, $manager, , $copy, $request] = abrFix([], 'dong-thap-abr-decided');
    BorrowRequest::query()->whereKey($request->id)->update(['status' => RequestStatus::Rejected]);
    expect(fn () => app(ApproveBorrowRequest::class)->execute($manager, $request, $copy->id))
        ->toThrow(RuleViolated::class, 'request_not_pending');
    // And the refusal wrote nothing: no notification, copy untouched.
    expect(Notification::query()->count())->toBe(0)
        ->and($copy->fresh()->state)->toBe(CopyState::Available);
});

it('the copy lock is first, the request lock second', function () {
    [, $manager, , $copy, $request] = abrFix([], 'dong-thap-abr-lock');

    DB::flushQueryLog();
    DB::enableQueryLog();
    app(ApproveBorrowRequest::class)->execute($manager, $request, $copy->id);
    $log = DB::getQueryLog();
    DB::disableQueryLog();

    expect(str_contains($log[0]['query'], 'book_copies'))->toBeTrue($log[0]['query'])
        ->and(str_contains(strtolower($log[0]['query']), 'for update'))->toBeTrue($log[0]['query'])
        ->and(str_contains($log[1]['query'], 'borrow_requests'))->toBeTrue($log[1]['query'])
        ->and(str_contains(strtolower($log[1]['query']), 'for update'))->toBeTrue($log[1]['query']);
});

it('INV-8: request.approved stores the copy, the expiry and the reader under userId', function () {
    Carbon::setTestNow(Carbon::parse('2026-08-28 07:00:00', 'UTC'));
    [, $manager, $reader, $copy, $request] = abrFix([], 'dong-thap-abr-audit');

    app(ApproveBorrowRequest::class)->execute($manager, $request, $copy->id);

    $entry = AuditLog::query()->where('action', 'request.approved')->firstOrFail();
    $before = (array) $entry->before;
    $after = (array) $entry->after;
    expect($entry->entity_id)->toBe($request->id)
        ->and($before)->toMatchArray(['status' => 'pending', 'copy_id' => null])
        ->and($after['status'])->toBe('approved')
        ->and($after['copy_id'])->toBe($copy->id)
        ->and($after['hold_expires_at'])->toBe('2026-08-31T07:00:00.000000Z')
        ->and($after['userId'])->toBe($reader->id);
});
```

- [ ] **Step 2: Run to verify failure** — `make test FILTER=ApproveBorrowRequestTest`. Expected: FAIL — class not found.

- [ ] **Step 3: Implement**

Create `app/Actions/Circulation/ApproveBorrowRequest.php`:

```php
<?php

namespace App\Actions\Circulation;

use App\Enums\CopyState;
use App\Enums\RequestStatus;
use App\Exceptions\RuleViolated;
use App\Models\Book;
use App\Models\BookCopy;
use App\Models\BorrowRequest;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\Circulation\LendingSettings;
use App\Support\Circulation\LoanTerms;
use App\Support\Circulation\RequestRules;
use App\Support\Clock;
use App\Support\Notifications\NotificationKind;
use App\Support\Notifications\Notifier;
use App\Support\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * A manager puts a specific copy aside for the reader whose turn it is —
 * BR §7.2's pending → approved, BR §16.3's "Approve (creating a hold with
 * a visible expiry)". Port of approve-borrow-request.ts.
 *
 * The same effect ReceiveReturn performs when it holds a returned copy,
 * reached from the queue screen instead of the return form — which is
 * why holdDays and holdExpiry live in shared homes (LendingSettings,
 * LoanTerms) rather than being restated here.
 *
 * Lock order (divergence 1): copy FIRST — two managers approving two
 * readers onto one copy would otherwise each read it available and each
 * write a hold, INV-3's premise broken with no index to catch it
 * (borrow_requests has no uniqueness on copy_id; the row lock IS the
 * guarantee, the reference's own argument) — then the REQUEST row, which
 * the reference read unlocked; locking it serialises a racing reject or
 * cancel of the same request.
 *
 * The copy moves available → held in the same transaction, so state and
 * hold never disagree. A lapsed rival hold arrives as null through the
 * hold_expires_at > now filter and the copy is then refused by the STATE
 * branch — freeing it is a recorded transition, never a side effect.
 *
 * $copyId is a raw string (form field, not a binding); the Form Request
 * validated it uuid, and find() on a non-row is copy_not_found — one
 * answer for "no such copy", "another shelf's copy" (BookshelfScope) and
 * "a copy of a different title", deliberately (spec §5.4).
 */
final class ApproveBorrowRequest
{
    public function __construct(
        private Clock $clock,
        private AuditRecorder $audit,
        private Notifier $notifier,
        private TenantContext $tenant,
    ) {}

    /** @return array{requestId: string, copyId: string, holdExpiresAt: CarbonImmutable} */
    public function execute(User $actor, BorrowRequest $request, string $copyId): array
    {
        Gate::forUser($actor)->authorize('approve', $request);

        return DB::transaction(function () use ($actor, $request, $copyId): array {
            // FIRST statement — see the class docblock.
            $copy = BookCopy::query()->lockForUpdate()->find($copyId);
            if ($copy === null) {
                throw new RuleViolated('copy_not_found');
            }
            // SECOND — the request, latest committed row.
            $request = BorrowRequest::query()->lockForUpdate()->findOrFail($request->id);

            if ($request->status !== RequestStatus::Pending) {
                throw new RuleViolated('request_not_pending');
            }
            // "An available copy OF THE REQUESTED TITLE" — OPS §4.2's own
            // wording; a copy of another title is simply not found.
            if ($copy->book_id !== $request->book_id) {
                throw new RuleViolated('copy_not_found');
            }

            // The live hold on this copy, if any — read AFTER the copy
            // lock, through the expiry filter, so a lapsed hold arrives
            // as absence (the convention copyHoldable is written against).
            $heldForUserId = BorrowRequest::query()
                ->where('copy_id', $copy->id)
                ->where('status', RequestStatus::Approved)
                ->where('hold_expires_at', '>', $this->clock->now())
                ->orderBy('requested_at')->orderBy('id')
                ->value('member_id');
            if (($code = RequestRules::copyHoldable($copy->state, $heldForUserId)) !== null) {
                throw new RuleViolated($code);
            }

            $shelf = $this->tenant->bookshelf();
            if ($shelf === null) {
                throw new RuleViolated('shelf_not_found');
            }
            $now = $this->clock->now();
            $holdExpiresAt = LoanTerms::holdExpiry($now, LendingSettings::fromShelf($shelf)->holdDays);

            // The title, read inside the transaction so the audit entry
            // and the notification STORE it (P1 §3.2a).
            $title = (string) Book::query()->whereKey($request->book_id)->value('title');

            $request->update([
                'status' => RequestStatus::Approved,
                'copy_id' => $copy->id,
                'hold_expires_at' => $holdExpiresAt,
                'decided_by' => $actor->id,
                'decided_at' => $now,
            ]);
            $copy->update(['state' => CopyState::Held]);

            $this->audit->record('request.approved', 'request', $request->id,
                ['status' => 'pending', 'copy_id' => null],
                [
                    'status' => 'approved',
                    'copy_id' => $copy->id,
                    'hold_expires_at' => $holdExpiresAt->toISOString(),
                    // A users(id) — member_id's name says membership, its
                    // FK says otherwise; stored under userId, the subject
                    // join's key (Task 1's AuditLogQuery arm).
                    'userId' => $request->member_id,
                ]);

            // OPS §7: approval and "sách đã sẵn sàng" are ONE event a
            // child experiences once — one kind, one row. The deadline is
            // in the payload because a hold whose end a child does not
            // know is a hold they will miss; the date is the PARISH's day
            // (plan divergence 5).
            $this->notifier->notify($request->member_id, NotificationKind::RequestApproved, [
                'title' => $title,
                'hold_until' => $holdExpiresAt->timezone('Asia/Ho_Chi_Minh')->toDateString(),
            ]);

            return ['requestId' => $request->id, 'copyId' => $copy->id, 'holdExpiresAt' => $holdExpiresAt];
        });
    }
}
```

- [ ] **Step 4: The kind, the sentences, the censuses**

`NotificationKind` gains `case RequestApproved = 'request_approved';`. `lang/vi/notifications.php` gains (sentences verbatim from `kinds.ts`, date already d/m/Y-rendered by `NotificationSentences::date`):

```php
    'request_approved' => ':book đã sẵn sàng, bạn đến nhận trước ngày :until nhé.',
    // Underscore-prefixed because it is a HELPER line, not a kind: a
    // payload with no hold_until still needs a sentence, and
    // NotificationSentencesTest's census holds the non-underscored keys
    // set-equal to NotificationKind::cases(). A bare
    // 'request_approved_no_date' would fail that census on this commit.
    '_request_approved_no_date' => ':book đã sẵn sàng, bạn đến nhận sớm nhé.',
```

**`NotificationSentences` gains its two helpers HERE, in the commit that first calls them** (Task 2 deliberately shipped without them — Larastan level 8 reports an uncalled private static method as `method.unused` and would have failed `make analyse` at that commit; measured, not guessed). Add both beside `because()`:

```php
    /** `Dế Mèn Phiêu Lưu Ký` when stored, `cuốn sách` when not. */
    private static function which(?string $title): string
    {
        return $title ?? self::line('_which');
    }

    /** `Y-m-d` (Asia/Ho_Chi_Minh civil date, plan divergence 5) → `d/m/Y`. */
    private static function date(?string $ymd): ?string
    {
        if ($ymd === null || preg_match('/^\d{4}-\d{2}-\d{2}$/', $ymd) !== 1) {
            return null;
        }
        [$y, $m, $d] = explode('-', $ymd);

        return "{$d}/{$m}/{$y}";
    }
```

`date()` is called by this task's arm and again by Task 17's due-soon arm; `which()` by this task's arm, Task 6's and Task 17's. Both have a caller from this commit onward, so level 8 stays clean with no ignores. Then `NotificationSentences::sentence` gains:

```php
            NotificationKind::RequestApproved => (function () use ($payload): string {
                $book = self::which(self::str($payload, 'title'));
                $until = self::date(self::str($payload, 'hold_until'));

                return $until === null
                    ? strtr(self::line('_request_approved_no_date'), [':book' => $book])
                    : strtr(self::line('request_approved'), [':book' => $book, ':until' => $until]);
            })(),
```

Add to `tests/Unit/Notifications/NotificationSentencesTest.php`:

```php
it('request_approved renders the title and the deadline as a Vietnamese date', function () {
    expect(NotificationSentences::sentence('request_approved', ['title' => 'Hoàng Tử Bé', 'hold_until' => '2026-09-01']))
        ->toBe('Hoàng Tử Bé đã sẵn sàng, bạn đến nhận trước ngày 01/09/2026 nhé.')
        ->and(NotificationSentences::sentence('request_approved', []))
        ->toBe('cuốn sách đã sẵn sàng, bạn đến nhận sớm nhé.');
});
```

`NotificationsAreReaderFacingTest`'s table gains `'request_approved' => ['app/Actions/Circulation/ApproveBorrowRequest.php'],` (Task 10 appends the second door). `lang/vi/audit.php` gains `'request_approved' => 'giữ chỗ một cuốn sách cho bạn đọc đang chờ',`; `AuditSentences::ACTIONS` gains `'request.approved' => 'loans',` with the arm `'request.approved' => self::line('request_approved'),`. The literal census gains `'request_not_pending'` and `'copy_not_found'`. The CirculationArchitectureTest lock list gains this Action.

- [ ] **Step 5: Run, mutation-check, commit**

Run: `make test FILTER=ApproveBorrowRequestTest && make test FILTER=Notification && make test FILTER=Audit`
Expected: PASS.

Mutation checks (red → restore → green each):
1. Swap the two lock lines → "the copy lock is first…" red.
2. Drop the `hold_expires_at > now` filter from the rival-hold read entirely → "a LAPSED rival hold is no obstacle" goes red (the dead hold now reads as live and the approval is refused `no_copy_available`), while "an AVAILABLE copy under a live hold" stays green. Restore. Then change the filter to `<` → **BOTH** tests go red, not just the live-hold one (corrected at Task 5, measured: 2 failed). The word "instead" in the first draft of this line was wrong, and the truth is stronger than the prediction: with `<`, the live rival (`+2d`) drops out of the filter so the approval succeeds where `no_copy_available` was expected, AND the lapsed rival (`-1d`) enters it so that approval is refused where success was expected. Both tests stay load-bearing, which is exactly what this mutation is for. Restore. Both directions are checked because either one alone leaves half the predicate unguarded — this was a review finding: the first draft conceded the filter was untestable and substituted a weaker mutation.
3. Comment out the `notify` call → the notification test AND the reader-facing census both red.

```bash
make lint && make analyse
git add app/Actions/Circulation/ApproveBorrowRequest.php app/Support/ lang/vi/ tests/
git commit -m "feat: approveborrowrequest — copy locked first, held in the same beat, the child told"
```

---

### Task 6: `RejectBorrowRequest` — terminal, kept, optionally explained

Read first: `old_next/src/domain/circulation/commands/reject-borrow-request.ts` (whole file), `borrow-requests.test.ts` tests 16–18, and **ruling 2** — the reason is OPTIONAL, settled. This task carries no conditional deltas; the earlier "on OQ2 = B…" notes are deleted, not hidden.

**Files:**
- Create: `app/Actions/Circulation/RejectBorrowRequest.php`
- Modify: `app/Support/Notifications/NotificationKind.php` (+ `RequestRejected`), `NotificationSentences.php`, `lang/vi/notifications.php`, `NotificationsAreReaderFacingTest.php` (+ row)
- Modify: `app/Support/Audit/AuditSentences.php` (+ `request.rejected`), `lang/vi/audit.php`
- Modify: `tests/Feature/Architecture/CirculationArchitectureTest.php` (lock list + this Action)
- Test: `tests/Feature/Circulation/RejectBorrowRequestTest.php`

**Interfaces:**
- Produces: `RejectBorrowRequest::execute(User $actor, BorrowRequest $request, ?string $reason = null): array{requestId: string}` — throws `request_not_pending`; audit `request.rejected`; notification `request_rejected`. The request lock is this command's only lock (it touches no copy — a pending request names none).

- [ ] **Step 1: Write the failing tests**

Create `tests/Feature/Circulation/RejectBorrowRequestTest.php` (fixture `rjbFix` — clone `abrFix`'s shape without the copy assignment; same shelf/manager/reader/pending-request skeleton, slug base `dong-thap-rjb`):

```php
<?php

use App\Actions\Circulation\RejectBorrowRequest;
use App\Enums\RequestStatus;
use App\Exceptions\RuleViolated;
use App\Models\AuditLog;
use App\Models\Book;
use App\Models\Bookshelf;
use App\Models\BorrowRequest;
use App\Models\Membership;
use App\Models\Notification;
use App\Models\User;
use App\Queries\AuditLogQuery;
use App\Support\TenantContext;
use Illuminate\Support\Facades\DB;

/** @return array{Bookshelf, User, User, BorrowRequest} */
function rjbFix(string $slug = 'dong-thap-rjb'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);
    $manager = User::factory()->create(['full_name' => 'Maria Quản Lý Kho']);
    $mm = Membership::factory()->for($shelf)->create(['user_id' => $manager->id, 'role' => 'manager', 'status' => 'active']);
    $reader = User::factory()->create(['full_name' => 'Têrêsa Bạn Đọc Nhỏ']);
    Membership::factory()->for($shelf)->create(['user_id' => $reader->id, 'role' => 'reader', 'status' => 'active']);
    $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Totto-chan Bên Cửa Sổ', 'slug' => 'totto-chan']);
    $request = BorrowRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'member_id' => $reader->id,
        'status' => RequestStatus::Pending, 'requested_at' => now(),
    ]);
    app(TenantContext::class)->set($shelf, $mm);
    test()->actingAs($manager);

    return [$shelf, $manager, $reader, $request];
}

it('rejecting is terminal, keeps the row, and records the reason', function () {
    [, $manager, $reader, $request] = rjbFix();

    app(RejectBorrowRequest::class)->execute($manager, $request, 'sách đang được kiểm kê');

    $row = $request->fresh();
    expect($row->status)->toBe(RequestStatus::Rejected)
        ->and($row->decided_by)->toBe($manager->id)
        ->and($row->decision_note)->toBe('sách đang được kiểm kê')
        ->and($row->deleted_at)->toBeNull();     // nothing is deleted — BR §11

    $note = Notification::query()->firstOrFail();
    expect($note->user_id)->toBe($reader->id)
        ->and($note->kind)->toBe('request_rejected')
        ->and($note->payload)->toMatchArray(['title' => 'Totto-chan Bên Cửa Sổ', 'reason' => 'sách đang được kiểm kê']);
});

it('the reason is optional, and an empty one is stored as no reason', function () {
    // Ruling 2: optional, the reference's shipped reading, its named test
    // kept. This is the behaviour, not a behaviour that survives a switch.
    [, $manager, , $request] = rjbFix('dong-thap-rjb-noreason');

    app(RejectBorrowRequest::class)->execute($manager, $request, '   ');

    expect($request->fresh()->decision_note)->toBeNull();
    // And the notification degrades to a sentence with no because-clause:
    expect(array_key_exists('reason', Notification::query()->firstOrFail()->payload))->toBeFalse();
});

it('a decided request cannot be rejected', function () {
    [, $manager, , $request] = rjbFix('dong-thap-rjb-decided');
    BorrowRequest::query()->whereKey($request->id)->update(['status' => RequestStatus::Cancelled, 'cancelled_at' => now()]);

    expect(fn () => app(RejectBorrowRequest::class)->execute($manager, $request, null))
        ->toThrow(RuleViolated::class, 'request_not_pending');
    expect(Notification::query()->count())->toBe(0);
});

it('the request lock is the transaction\'s first statement', function () {
    [, $manager, , $request] = rjbFix('dong-thap-rjb-lock');

    DB::flushQueryLog();
    DB::enableQueryLog();
    app(RejectBorrowRequest::class)->execute($manager, $request, null);
    $log = DB::getQueryLog();
    DB::disableQueryLog();

    expect(str_contains($log[0]['query'], 'borrow_requests'))->toBeTrue($log[0]['query'])
        ->and(str_contains(strtolower($log[0]['query']), 'for update'))->toBeTrue($log[0]['query']);
});

it('INV-8: request.rejected names the reader and the reason, and the audit screen renders them', function () {
    [$shelf, $manager, $reader, $request] = rjbFix('dong-thap-rjb-audit');

    app(RejectBorrowRequest::class)->execute($manager, $request, 'thiếu thẻ');

    $entry = AuditLog::query()->where('action', 'request.rejected')->firstOrFail();
    $after = (array) $entry->after;
    expect((array) $entry->before)->toMatchArray(['status' => 'pending'])
        ->and($after['status'])->toBe('rejected')
        ->and($after['title'])->toBe('Totto-chan Bên Cửa Sổ')
        ->and($after['userId'])->toBe($reader->id)
        ->and($after['reason'])->toBe('thiếu thẻ');

    // The Task-1 subject join, pinned here: the rendered sentence names
    // the reader from the payload's userId. Drop that join and THIS goes
    // red (the mutation check below performs exactly that).
    $rendered = app(AuditLogQuery::class)->run(page: 1);
    $line = collect($rendered['rows'])->firstWhere('action', 'request.rejected');
    expect($line['sentence'])->toContain('Têrêsa Bạn Đọc Nhỏ')
        ->and($line['sentence'])->toContain('vì thiếu thẻ');
});
```

(Before writing the last test, read `AuditLogQuery::run`'s actual signature and row shape from 1d and adapt the two access lines — the assertion is the sentence containing the subject name and the because-clause; the plumbing follows the shipped query, not this sketch. If `run` requires filters, pass its defaults.)

- [ ] **Step 2: Run to verify failure** — `make test FILTER=RejectBorrowRequestTest`. Expected: FAIL.

- [ ] **Step 3: Implement**

Create `app/Actions/Circulation/RejectBorrowRequest.php`:

```php
<?php

namespace App\Actions\Circulation;

use App\Enums\RequestStatus;
use App\Exceptions\RuleViolated;
use App\Models\Book;
use App\Models\BorrowRequest;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\Clock;
use App\Support\Notifications\NotificationKind;
use App\Support\Notifications\Notifier;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * A manager declines a queued request — BR §7.2's pending → rejected,
 * terminal. Port of reject-borrow-request.ts. Nothing is deleted (BR
 * §11): the row stays with its reason, so "why did this not happen" has
 * an answer six months later.
 *
 * The reason is OPTIONAL (product-owner ruling 2, the reference's
 * shipped reading with its named test): OPS §4.2 lists no
 * reason_required here, unlike the
 * registration and profile-change rejections. It lands in decision_note
 * — decided_by/decided_at/decision_note are shared by approval and
 * rejection alike. An empty box is NO reason, not a reason that says
 * nothing.
 *
 * One lock, the request row (this command touches no copy — a pending
 * request names none), taken as the transaction's first statement.
 * "No such request", "another shelf's" (scope) and "already decided"
 * share request_not_pending — telling them apart would confirm the
 * other shelf's request exists.
 */
final class RejectBorrowRequest
{
    public function __construct(
        private Clock $clock,
        private AuditRecorder $audit,
        private Notifier $notifier,
    ) {}

    /** @return array{requestId: string} */
    public function execute(User $actor, BorrowRequest $request, ?string $reason = null): array
    {
        Gate::forUser($actor)->authorize('reject', $request);

        return DB::transaction(function () use ($actor, $request, $reason): array {
            // FIRST statement — the only lock this command takes.
            $request = BorrowRequest::query()->lockForUpdate()->findOrFail($request->id);

            if ($request->status !== RequestStatus::Pending) {
                throw new RuleViolated('request_not_pending');
            }

            $trimmed = ($reason === null || trim($reason) === '') ? null : trim($reason);
            $title = (string) Book::query()->whereKey($request->book_id)->value('title');

            $request->update([
                'status' => RequestStatus::Rejected,
                'decided_by' => $actor->id,
                'decided_at' => $this->clock->now(),
                'decision_note' => $trimmed,
            ]);

            $this->audit->record('request.rejected', 'request', $request->id,
                ['status' => 'pending'],
                [
                    'status' => 'rejected',
                    'title' => $title,
                    // The one sentence in the request family whose actor
                    // and subject are different people — a manager
                    // refusing a child. userId is the subject join's key.
                    'userId' => $request->member_id,
                    // 'reason', matching copy.retired and
                    // membership.rejected, so because() finds it without a
                    // third spelling.
                    'reason' => $trimmed,
                ]);

            $this->notifier->notify(
                $request->member_id,
                NotificationKind::RequestRejected,
                $trimmed === null ? ['title' => $title] : ['title' => $title, 'reason' => $trimmed],
            );

            return ['requestId' => $request->id];
        });
    }
}
```

- [ ] **Step 4: The kind, the sentences, the censuses**

`NotificationKind` + `case RequestRejected = 'request_rejected';`. `lang/vi/notifications.php` + `'request_rejected' => 'Yêu cầu mượn :book chưa được duyệt:because.',`. Sentence arm:

```php
            NotificationKind::RequestRejected => strtr(self::line('request_rejected'), [
                ':book' => self::which(self::str($payload, 'title')),
                ':because' => self::because(self::str($payload, 'reason')),
            ]),
```

Sentence test (append to `NotificationSentencesTest`):

```php
it('request_rejected carries the title and, when given, the reason', function () {
    expect(NotificationSentences::sentence('request_rejected', ['title' => 'Totto-chan Bên Cửa Sổ', 'reason' => 'thiếu thẻ']))
        ->toBe('Yêu cầu mượn Totto-chan Bên Cửa Sổ chưa được duyệt vì thiếu thẻ.')
        ->and(NotificationSentences::sentence('request_rejected', []))
        ->toBe('Yêu cầu mượn cuốn sách chưa được duyệt.');
});
```

Census table + `'request_rejected' => ['app/Actions/Circulation/RejectBorrowRequest.php'],`. `lang/vi/audit.php` + `'request_rejected' => 'từ chối yêu cầu mượn :title của :subject:because',`; `AuditSentences::ACTIONS` + `'request.rejected' => 'loans',` and the arm (mirror `membership.rejected`'s construction — `:subject` from `$facts['subject']` via the existing `who()`-equivalent helper; read `AuditSentences::phrase` for the house helper names and reuse them):

```php
            'request.rejected' => strtr(self::line('request_rejected'), [
                ':title' => self::which(self::str($after, 'title')),
                ':subject' => $subject ?? self::line('someone'),
                ':because' => self::because(self::str($after, 'reason')),
            ]),
```

`request_not_pending` is already in the literal census (Task 5). Lock list + this Action.

- [ ] **Step 5: Run, mutation-check, commit**

Run: `make test FILTER=RejectBorrowRequestTest && make test FILTER=Notification && make test FILTER=AuditActionCensusTest` — PASS.

Mutation checks: (1) drop the Task-1 `payload_subject` join from `AuditLogQuery` → the named audit-rendering test red; restore. (2) skip the `notify` call → notification test + census red; restore. (3) store `''` instead of null for a blank reason → "the reason is optional…" red; restore.

```bash
make lint && make analyse
git add app/Actions/Circulation/RejectBorrowRequest.php app/Support/ lang/vi/ tests/
git commit -m "feat: rejectborrowrequest — terminal, kept, the child told with the reason"
```

---

### Task 7: `CancelOwnRequest` — a reader withdraws, and a held copy goes back on the shelf

Read first: `old_next/src/domain/circulation/commands/cancel-own-request.ts` (whole file — the ownership-comparison and guarded-release docblocks are the specification), `borrow-requests.test.ts` tests 19–24.

**Files:**
- Create: `app/Actions/Circulation/CancelOwnRequest.php`
- Modify: `app/Support/Audit/AuditSentences.php` (+ `request.cancelled`), `lang/vi/audit.php`
- Modify: `tests/Unit/Catalogue/RuleViolatedCodesHaveSentencesTest.php` (+ `not_own_request`, `request_already_fulfilled`)
- Modify: `tests/Feature/Architecture/CirculationArchitectureTest.php` (lock list + this Action)
- Test: `tests/Feature/Circulation/CancelOwnRequestTest.php`

**Interfaces:**
- Produces: `CancelOwnRequest::execute(User $actor, BorrowRequest $request): array{requestId: string, releasedCopyId: ?string}` — throws `not_own_request` | `request_already_fulfilled` | `request_not_pending`; audit `request.cancelled`. No notification (BR §15 lists no event for a reader's own withdrawal — the reference's "the one of the five that may genuinely need none", decided the same way here).

- [ ] **Step 1: Write the failing tests**

Create `tests/Feature/Circulation/CancelOwnRequestTest.php`:

```php
<?php

use App\Actions\Circulation\CancelOwnRequest;
use App\Enums\CopyState;
use App\Enums\RequestStatus;
use App\Exceptions\RuleViolated;
use App\Models\AuditLog;
use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\BorrowRequest;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Illuminate\Support\Facades\DB;

/**
 * Shelf + reader (acting) + their PENDING request; pass approved: true
 * for an approved-with-held-copy variant (the full live-approval shape).
 *
 * @return array{Bookshelf, User, BorrowRequest, ?BookCopy}
 */
function corFix(bool $approved = false, string $slug = 'dong-thap-cor'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);
    $manager = User::factory()->create(['full_name' => 'Maria Quản Lý Kho']);
    Membership::factory()->for($shelf)->create(['user_id' => $manager->id, 'role' => 'manager', 'status' => 'active']);
    $reader = User::factory()->create(['full_name' => 'Têrêsa Bạn Đọc Nhỏ']);
    $membership = Membership::factory()->for($shelf)->create(['user_id' => $reader->id, 'role' => 'reader', 'status' => 'active']);
    $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Đất Rừng Phương Nam', 'slug' => 'dat-rung']);
    $copy = null;
    $fields = [
        'bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'member_id' => $reader->id,
        'status' => RequestStatus::Pending, 'requested_at' => now(),
    ];
    if ($approved) {
        $copy = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0003', 'state' => 'held']);
        $fields = [...$fields, 'status' => RequestStatus::Approved, 'copy_id' => $copy->id,
            'hold_expires_at' => now()->addDays(3), 'decided_by' => $manager->id, 'decided_at' => now()];
    }
    $request = BorrowRequest::query()->create($fields);
    app(TenantContext::class)->set($shelf, $membership);
    test()->actingAs($reader);

    return [$shelf, $reader, $request, $copy];
}

it('a reader withdraws a pending request', function () {
    [, $reader, $request] = corFix();

    $result = app(CancelOwnRequest::class)->execute($reader, $request);

    expect($request->fresh()->status)->toBe(RequestStatus::Cancelled)
        ->and($request->fresh()->cancelled_at)->not->toBeNull()
        ->and($result['releasedCopyId'])->toBeNull();
});

it('withdrawing a held request puts the copy back on the shelf, in the same transaction', function () {
    [, $reader, $request, $copy] = corFix(approved: true, slug: 'dong-thap-cor-held');

    $result = app(CancelOwnRequest::class)->execute($reader, $request);

    $row = $request->fresh();
    expect($row->status)->toBe(RequestStatus::Cancelled)
        ->and($copy->fresh()->state)->toBe(CopyState::Available)
        ->and($result['releasedCopyId'])->toBe($copy->id)
        // hold_expires_at and copy_id are LEFT WHERE THEY STAND — the
        // record of what the reader gave up; every read of either is
        // gated on status=approved, so a cancelled row's hold is inert.
        ->and($row->copy_id)->toBe($copy->id)
        ->and($row->hold_expires_at)->not->toBeNull();
});

it('withdrawing never drags a copy that has moved on back to available', function () {
    // The guard is state='held' in the WHERE itself: if the copy was
    // since lent, lost or retired, this cancellation must not put a lost
    // book on the shelf.
    [, $reader, $request, $copy] = corFix(approved: true, slug: 'dong-thap-cor-moved');
    BookCopy::query()->whereKey($copy->id)->update(['state' => 'lost']);

    $result = app(CancelOwnRequest::class)->execute($reader, $request);

    expect($copy->fresh()->state)->toBe(CopyState::Lost)
        ->and($result['releasedCopyId'])->toBeNull()
        ->and($request->fresh()->status)->toBe(RequestStatus::Cancelled);
});

it('a reader cannot withdraw somebody else\'s request', function () {
    // Same shelf, different reader: the binding resolves, the ownership
    // comparison refuses — and it compares USER ids on both sides; a
    // membership id on either side would refuse every cancel (the
    // reference's unwriteable-without-noticing trap).
    [$shelf, , $request] = corFix(slug: 'dong-thap-cor-other');
    app(TenantContext::class)->actSystemWide();
    $rival = User::factory()->create(['full_name' => 'Anna Người Khác']);
    $rivalMembership = Membership::factory()->for($shelf)->create(['user_id' => $rival->id, 'role' => 'reader', 'status' => 'active']);
    app(TenantContext::class)->set($shelf->fresh(), $rivalMembership);
    test()->actingAs($rival);

    expect(fn () => app(CancelOwnRequest::class)->execute($rival, $request))
        ->toThrow(RuleViolated::class, 'not_own_request');
});

it('a fulfilled request cannot be withdrawn, and says why', function () {
    [, $reader, $request] = corFix(slug: 'dong-thap-cor-ful');
    BorrowRequest::query()->whereKey($request->id)->update(['status' => RequestStatus::Fulfilled]);

    expect(fn () => app(CancelOwnRequest::class)->execute($reader, $request))
        ->toThrow(RuleViolated::class, 'request_already_fulfilled');
});

it('a rejected request is already decided', function () {
    [, $reader, $request] = corFix(slug: 'dong-thap-cor-rej');
    BorrowRequest::query()->whereKey($request->id)->update(['status' => RequestStatus::Rejected]);

    expect(fn () => app(CancelOwnRequest::class)->execute($reader, $request))
        ->toThrow(RuleViolated::class, 'request_not_pending');
});

it('for a held request the copy lock is first, the request lock second', function () {
    [, $reader, $request] = corFix(approved: true, slug: 'dong-thap-cor-lock');

    DB::flushQueryLog();
    DB::enableQueryLog();
    app(CancelOwnRequest::class)->execute($reader, $request);
    $log = DB::getQueryLog();
    DB::disableQueryLog();

    expect(str_contains($log[0]['query'], 'book_copies'))->toBeTrue($log[0]['query'])
        ->and(str_contains(strtolower($log[0]['query']), 'for update'))->toBeTrue($log[0]['query'])
        ->and(str_contains($log[1]['query'], 'borrow_requests'))->toBeTrue($log[1]['query'])
        ->and(str_contains(strtolower($log[1]['query']), 'for update'))->toBeTrue($log[1]['query']);
});

it('INV-8: request.cancelled records which copy went back, and null when none did', function () {
    [, $reader, $request, $copy] = corFix(approved: true, slug: 'dong-thap-cor-audit');

    app(CancelOwnRequest::class)->execute($reader, $request);

    $entry = AuditLog::query()->where('action', 'request.cancelled')->firstOrFail();
    expect((array) $entry->before)->toMatchArray(['status' => 'approved', 'copy_id' => $copy->id])
        ->and((array) $entry->after)->toMatchArray([
            'status' => 'cancelled',
            'title' => 'Đất Rừng Phương Nam',
            'released_copy_id' => $copy->id,
        ]);
});
```

- [ ] **Step 2: Run to verify failure** — `make test FILTER=CancelOwnRequestTest`. Expected: FAIL.

- [ ] **Step 3: Implement**

Create `app/Actions/Circulation/CancelOwnRequest.php`:

```php
<?php

namespace App\Actions\Circulation;

use App\Enums\CopyState;
use App\Enums\RequestStatus;
use App\Exceptions\RuleViolated;
use App\Models\Book;
use App\Models\BookCopy;
use App\Models\BorrowRequest;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\Clock;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * A reader withdraws their own request — BR §7.2's cancelled, reachable
 * from pending AND approved. Port of cancel-own-request.ts.
 *
 * Cancelling a held request releases the copy IN THIS TRANSACTION (OPS
 * §4.2's "releases the hold if one exists"): a request left approved
 * goes on naming the copy, the state goes on saying held, and every
 * public surface tells the next child there is none free while the book
 * sits on the shelf with nobody left to hand it to.
 *
 * held → available is guarded ON THE STATE, in the WHERE itself: a copy
 * that has since moved on (lent, lost, retired) is left alone — zero
 * affected rows is a legitimate outcome, not an error.
 *
 * OWNERSHIP is the whole of the permission and both sides are users.id:
 * borrow_requests.member_id against $actor->id. Comparing against a
 * membership id would never be equal, so EVERY cancellation would be
 * refused as somebody else's, with no pure predicate to notice — the
 * reference's named trap. A manager therefore cannot cancel a reader's
 * request through this command (Từ chối is their command for the row).
 *
 * Lock order (divergence 1): copy first WHEN the route-bound snapshot
 * names one (copy_id is an in-memory attribute — no query), then the
 * request. A snapshot bound pre-approval names none; the release then
 * runs as a guarded single-statement UPDATE after the request lock —
 * the one order inversion this phase admits, documented in the plan's
 * divergence 1 and in known-gaps (Task 19), chosen over locking the
 * request first everywhere because THAT order would deadlock against
 * ApproveBorrowRequest and LendCopy on every contested schedule rather
 * than this vanishing one.
 *
 * No notification: BR §15 lists no event for a reader's own withdrawal
 * (the reference's "the one of the five that may genuinely need none").
 */
final class CancelOwnRequest
{
    public function __construct(
        private Clock $clock,
        private AuditRecorder $audit,
    ) {}

    /** @return array{requestId: string, releasedCopyId: ?string} */
    public function execute(User $actor, BorrowRequest $request): array
    {
        Gate::forUser($actor)->authorize('cancel', $request);

        $snapshotCopyId = $request->copy_id;   // in-memory attribute; no query

        return DB::transaction(function () use ($actor, $request, $snapshotCopyId): array {
            // FIRST statement when a copy is named — see the class docblock.
            if ($snapshotCopyId !== null) {
                BookCopy::query()->lockForUpdate()->find($snapshotCopyId);
            }
            $request = BorrowRequest::query()->lockForUpdate()->findOrFail($request->id);

            // Ownership before status: "does not exist", "another
            // reader's" and "another shelf's" are one answer (OPS §4.2's
            // not_own_request note), and a caller who guessed a uuid
            // learns nothing either way.
            if ($request->member_id !== $actor->id) {
                throw new RuleViolated('not_own_request');
            }
            if ($request->status === RequestStatus::Fulfilled) {
                throw new RuleViolated('request_already_fulfilled');
            }
            if ($request->status !== RequestStatus::Pending && $request->status !== RequestStatus::Approved) {
                throw new RuleViolated('request_not_pending');
            }

            $before = ['status' => $request->status->value, 'copy_id' => $request->copy_id];
            $title = (string) Book::query()->whereKey($request->book_id)->value('title');

            $request->update([
                'status' => RequestStatus::Cancelled,
                'cancelled_at' => $this->clock->now(),
            ]);

            // Guarded release: the WHERE repeats the decision so a copy
            // that changed state between bind and lock is left alone.
            $released = false;
            if ($request->copy_id !== null) {
                $released = BookCopy::query()
                    ->whereKey($request->copy_id)
                    ->where('state', CopyState::Held)
                    ->update(['state' => CopyState::Available]) === 1;
            }

            $this->audit->record('request.cancelled', 'request', $request->id,
                $before,
                [
                    'status' => 'cancelled',
                    'title' => $title,
                    // Which copy went back on the shelf, and null when
                    // none did — a withdrawal from a queue and a
                    // withdrawal that freed a book, tellable apart without
                    // joining anything.
                    'released_copy_id' => $released ? $request->copy_id : null,
                ]);

            return [
                'requestId' => $request->id,
                'releasedCopyId' => $released ? $request->copy_id : null,
            ];
        });
    }
}
```

- [ ] **Step 4: Sentences and censuses**

`lang/vi/audit.php` + `'request_cancelled' => 'rút lại yêu cầu mượn :title',` ("rút lại … của mình" construction — the actor withdrew their own; naming them twice would read as though somebody withdrew somebody else's). `AuditSentences::ACTIONS` + `'request.cancelled' => 'loans',` and the arm mirroring `request.created`'s. Literal census + `'not_own_request'`, `'request_already_fulfilled'` (`request_not_pending` already there). Lock list + this Action.

- [ ] **Step 5: Run, mutation-check, commit**

Run: `make test FILTER=CancelOwnRequestTest && make test FILTER=AuditActionCensusTest` — PASS.

Mutation checks: (1) drop `->where('state', CopyState::Held)` from the release → "never drags a copy that has moved on…" red; restore. (2) compare `member_id` against `$this->tenant`-less `$actor->id`… instead: change the comparison to `$request->member_id !== $actor->id && false` (ownership disabled) → "a reader cannot withdraw somebody else's" red; restore. (3) reorder the two locks → the lock-position test red; restore.

```bash
make lint && make analyse
git add app/Actions/Circulation/CancelOwnRequest.php app/Support/Audit/ lang/vi/audit.php tests/
git commit -m "feat: cancelownrequest — ownership by user id, the held copy released under guard"
```

---

### Task 8: `LendCopy` re-widened — the held-for-me clause goes live, and a collected hold closes in the same transaction

Read first: `old_next/src/domain/circulation/commands/lend-copy.ts` lines 110–345 (the hold lateral join, `collectedHoldId`, the fulfilled close and its docblock), `old_next/tests/invariants/inv-03-only-available-or-own-hold.test.ts` (tests 5–10), `receive-return.test.ts` tests "a copy held for the next reader is lendable to them and to nobody else", "collecting a hold closes its request…", "collecting a hold writes both facts, one audit row each", "a lend that collects nobody's hold leaves the queue and the loan unlinked", "a hold belonging to somebody else is never the one a lend closes", "the hold clock is the injected one…". Also `app/Actions/Circulation/LendCopy.php` as shipped (its docblock promises exactly this task) and known-gaps' "`LendCopy`'s hold-collection branch is unported" entry.

**Files:**
- Modify: `app/Actions/Circulation/LendCopy.php`
- Modify: `app/Support/Audit/AuditSentences.php` (+ `request.fulfilled`), `lang/vi/audit.php`
- Test: `tests/Feature/Circulation/LendCopyHoldTest.php` (new file — 1c's `LendCopyTest` is untouched and must stay green, which is itself the proof the walk-up path did not change)

**Interfaces:**
- Consumes/produces: `LendCopy::execute` signature UNCHANGED (`array{loanId: string, dueOn: string}`). New behaviour: the live hold on the copy is read after the locks; `LoanRules::copyLendable` receives the real `$heldForUserId` (1c passed a hard-coded null); when the hold is the borrower's own, `loans.request_id` is written, the request moves `approved → fulfilled` with `fulfilled_loan_id`, and a second audit row `request.fulfilled` lands in the same transaction. Task 9's `HandoverRequest` delegates to exactly this.

- [ ] **Step 1: Write the failing tests**

Create `tests/Feature/Circulation/LendCopyHoldTest.php`:

```php
<?php

use App\Actions\Circulation\LendCopy;
use App\Enums\CopyState;
use App\Enums\LoanStatus;
use App\Enums\RequestStatus;
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

afterEach(fn () => Carbon::setTestNow());

/**
 * Shelf + acting manager + holder (reader with a LIVE approved hold on
 * the one copy, the full live-approval shape) + a second reader with no
 * hold. @return array{Bookshelf, User, Membership, Membership, BookCopy, BorrowRequest}
 */
function lchFix(string $slug = 'dong-thap-lch'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);
    $manager = User::factory()->create(['full_name' => 'Maria Quản Lý Kho']);
    $mm = Membership::factory()->for($shelf)->create(['user_id' => $manager->id, 'role' => 'manager', 'status' => 'active']);
    $holderUser = User::factory()->create(['full_name' => 'Têrêsa Người Giữ Chỗ']);
    $holder = Membership::factory()->for($shelf)->create(['user_id' => $holderUser->id, 'role' => 'reader', 'status' => 'active']);
    $otherUser = User::factory()->create(['full_name' => 'Anna Người Đến Sau']);
    $other = Membership::factory()->for($shelf)->create(['user_id' => $otherUser->id, 'role' => 'reader', 'status' => 'active']);
    $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Dế Mèn Phiêu Lưu Ký', 'slug' => 'de-men']);
    $copy = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0001', 'state' => 'held']);
    $hold = BorrowRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'member_id' => $holderUser->id,
        'status' => RequestStatus::Approved, 'requested_at' => now()->subDay(),
        'copy_id' => $copy->id, 'hold_expires_at' => now()->addDays(2),
        'decided_by' => $manager->id, 'decided_at' => now()->subDay(),
    ]);
    app(TenantContext::class)->set($shelf, $mm);
    test()->actingAs($manager);

    return [$shelf, $manager, $holder, $other, $copy, $hold];
}

it('INV-3: a held copy is lendable to its holder, and the lend closes the hold', function () {
    [, $manager, $holder, , $copy, $hold] = lchFix();

    $result = app(LendCopy::class)->execute($manager, $copy, $holder);

    $loan = Loan::query()->findOrFail($result['loanId']);
    $request = $hold->fresh();
    expect($loan->status)->toBe(LoanStatus::Active)
        ->and($loan->request_id)->toBe($hold->id)                    // the rows point at each other
        ->and($request->status)->toBe(RequestStatus::Fulfilled)
        ->and($request->fulfilled_loan_id)->toBe($loan->id)
        ->and($request->hold_expires_at)->not->toBeNull()            // the deadline they met, kept
        ->and($copy->fresh()->state)->toBe(CopyState::OnLoan);
});

it('INV-3: a held copy is refused to anyone but its holder, and nothing is written', function () {
    [, $manager, , $other, $copy] = lchFix('dong-thap-lch-other');

    expect(fn () => app(LendCopy::class)->execute($manager, $copy, $other))
        ->toThrow(RuleViolated::class, 'copy_not_available');
    expect(Loan::query()->count())->toBe(0)
        ->and($copy->fresh()->state)->toBe(CopyState::Held);
});

it('INV-3: a lapsed hold makes the copy lendable to nobody, its own ex-holder included', function () {
    // The clock alone lapses it: no job ran, no row changed — the filter
    // reads the holder as absent and the state branch refuses. BR §8.
    [, $manager, $holder, , $copy, $hold] = lchFix('dong-thap-lch-lapsed');
    Carbon::setTestNow(Carbon::now()->addDays(3));

    expect(fn () => app(LendCopy::class)->execute($manager, $copy, $holder))
        ->toThrow(RuleViolated::class, 'copy_not_available');
    expect($hold->fresh()->status)->toBe(RequestStatus::Approved);   // nothing wrote 'expired'
});

it('an AVAILABLE copy under somebody else\'s live hold still lends — and never closes their request', function () {
    // TWO things at once, and both are deliberate (plan divergence 13).
    //
    // (a) The lend SUCCEEDS. LoanRules::copyLendable's available branch
    //     does not look at holds — the faithful port of the reference's
    //     policy.ts:86-108, hole included. ApproveBorrowRequest refuses
    //     that row (Task 5 has the named test); LendCopy does not, and
    //     neither does the reference. Task 19 records it in known-gaps.
    //
    //     CORRECTED AT THE SOURCE by Task 19: this comment used to claim
    //     the row is "reachable with shipped 1a commands: approve onto
    //     this copy (held), ReportCopyLost, MarkCopyFound". It is not —
    //     CopyStateMachine has no held->lost arrow, so ReportCopyLost on a
    //     held copy throws copy_not_on_loan (measured, not read). The
    //     fixture constructs the row directly, which is what the SHIPPED
    //     version of this comment now says. See plan divergence 13.
    //
    // (b) The lend must NEVER close the other reader's request. That is
    //     the second half of $collectedHoldId, and this row is the only
    //     one that can exercise it — the fixture's own hold names DT-0001,
    //     so a hold on a DIFFERENT copy leaves $hold null and the branch
    //     untested. (The first draft did exactly that, and its mutation
    //     check could not fire; this is the correction.)
    //
    // A third reader owns the foreign hold, not the fixture's holder:
    // holder already has a live approved row for this title, and
    // borrow_requests_one_live_per_title_member (Task 1) allows one.
    [$shelf, $manager, , $other, , $hold] = lchFix('dong-thap-lch-foreign');
    app(TenantContext::class)->actSystemWide();
    $free = BookCopy::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $hold->book_id, 'code' => 'DT-0044', 'state' => 'available',
    ]);
    $promised = User::factory()->create(['full_name' => 'Phêrô Người Được Hứa']);
    Membership::factory()->for($shelf)->create(['user_id' => $promised->id, 'role' => 'reader', 'status' => 'active']);
    $foreignHold = BorrowRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $hold->book_id, 'member_id' => $promised->id,
        'status' => RequestStatus::Approved, 'requested_at' => now()->subHours(2),
        'copy_id' => $free->id, 'hold_expires_at' => now()->addDays(2),
        'decided_by' => $manager->id, 'decided_at' => now()->subHours(2),
    ]);
    app(TenantContext::class)->set($shelf->fresh(), Membership::query()->whereHas('user', fn ($q) => $q->where('full_name', 'Maria Quản Lý Kho'))->firstOrFail());

    $result = app(LendCopy::class)->execute($manager, $free, $other);

    expect(Loan::query()->findOrFail($result['loanId'])->request_id)->toBeNull()
        ->and($foreignHold->fresh()->status)->toBe(RequestStatus::Approved)
        ->and($foreignHold->fresh()->fulfilled_loan_id)->toBeNull()
        // The fixture's own hold, on the other copy, is untouched too.
        ->and($hold->fresh()->status)->toBe(RequestStatus::Approved);
});

it('collecting a hold writes both facts, one audit row each, in one transaction', function () {
    [, $manager, $holder, , $copy, $hold] = lchFix('dong-thap-lch-audit');

    $result = app(LendCopy::class)->execute($manager, $copy, $holder);

    $created = AuditLog::query()->where('action', 'loan.created')->firstOrFail();
    $fulfilled = AuditLog::query()->where('action', 'request.fulfilled')->firstOrFail();
    expect(((array) $created->after)['request_id'])->toBe($hold->id)     // no longer the walk-up null
        ->and($fulfilled->entity_id)->toBe($hold->id)
        ->and((array) $fulfilled->before)->toMatchArray(['status' => 'approved', 'copy_id' => $copy->id, 'fulfilled_loan_id' => null])
        ->and((array) $fulfilled->after)->toMatchArray(['status' => 'fulfilled', 'copy_id' => $copy->id, 'fulfilled_loan_id' => $result['loanId']]);
});

it('a walk-up lend still audits request_id as null — 1c\'s test stays green beside this one', function () {
    // Belt to LendCopyTest's existing pin: the whole 1c suite runs
    // untouched, and this asserts the same fact from this file so a
    // regression here is named here too.
    [$shelf, $manager, , $other] = lchFix('dong-thap-lch-walkup');
    app(TenantContext::class)->actSystemWide();
    $book2 = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Hoàng Tử Bé', 'slug' => 'hoang-tu-be']);
    $free = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book2->id, 'code' => 'DT-0090', 'state' => 'available']);
    app(TenantContext::class)->set($shelf->fresh(), Membership::query()->whereHas('user', fn ($q) => $q->where('full_name', 'Maria Quản Lý Kho'))->firstOrFail());

    app(LendCopy::class)->execute($manager, $free, $other);

    expect(((array) AuditLog::query()->where('action', 'loan.created')->firstOrFail()->after)['request_id'])->toBeNull();
});
```

- [ ] **Step 2: Run to verify failure** — `make test FILTER=LendCopyHoldTest`. Expected: FAIL — the held-to-holder lend currently throws `copy_not_available` (the shipped hard-coded null).

- [ ] **Step 3: Re-widen `LendCopy`**

In `app/Actions/Circulation/LendCopy.php`, inside the transaction, replace the hard-coded-null predicate call and thread the hold through. After the two lock statements and before the predicates:

```php
            // The live hold on this copy, if any — read AFTER both locks
            // (a query issued under the locks, never before them), through
            // the expiry filter, so a lapsed hold arrives as absence.
            // requested_at asc, id asc: the same total order every hold
            // read in this codebase uses — limit 1 over an unordered set
            // is whatever the plan produced (the reference's lateral-join
            // note).
            $hold = BorrowRequest::query()
                ->where('copy_id', $copy->id)
                ->where('status', RequestStatus::Approved)
                ->where('hold_expires_at', '>', $this->clock->now())
                ->orderBy('requested_at')->orderBy('id')
                ->first();

            // OPS §5's order: copy-side refusals first.
            if (($code = LoanRules::copyLendable($copy->state, $hold?->member_id, $membership->user_id)) !== null) {
                throw new RuleViolated($code);
            }

            // The hold this lend collects, or null when the copy was
            // simply available. BOTH halves required: a live hold names
            // this copy, AND it is this reader's — closing somebody
            // else's would take a child's turn away, the one thing worse
            // than leaving the row open.
            $collectedHoldId = ($hold !== null && $hold->member_id === $membership->user_id)
                ? $hold->id
                : null;
```

The loan insert gains `'request_id' => $collectedHoldId,`; the audit `after` array's `'request_id' => null,` becomes `'request_id' => $collectedHoldId,` (update its comment: "Null = a walk-up lend; the collected hold's id when this lend came out of a queue"). After the copy update and BEFORE the audit record (audit last — divergence 1), add:

```php
            if ($collectedHoldId !== null) {
                // fulfilled, from BR §7.2's pending → approved → fulfilled
                // — the only status that means the reader got the book.
                // hold_expires_at is left where it stands: the record of a
                // deadline this reader MET; every read of it is gated on
                // status=approved, so a fulfilled row's expiry is inert.
                // A guarded update on a row whose COPY lock we hold — the
                // status guard makes a mid-flight cancel (which would have
                // waited on our copy lock anyway, or won before we read)
                // a no-op rather than an overwrite.
                BorrowRequest::query()
                    ->whereKey($collectedHoldId)
                    ->where('status', RequestStatus::Approved)
                    ->update(['status' => RequestStatus::Fulfilled, 'fulfilled_loan_id' => $loan->id]);
            }
```

and after the existing `loan.created` audit record:

```php
            if ($collectedHoldId !== null) {
                $this->audit->record('request.fulfilled', 'request', $collectedHoldId,
                    ['status' => 'approved', 'copy_id' => $copy->id, 'fulfilled_loan_id' => null],
                    ['status' => 'fulfilled', 'copy_id' => $copy->id, 'fulfilled_loan_id' => $loan->id]);
            }
```

Add the `use App\Models\BorrowRequest;` and `use App\Enums\RequestStatus;` imports. Update the class docblock: delete the "held-for-me clause … unreachable here until Phase 2" paragraph and replace with two sentences naming this task ("Phase 2a wired the real holder through the same predicate and re-added the collected-hold close — request.fulfilled in this same transaction, the rows pointing at each other").

- [ ] **Step 4: Sentence and map**

`lang/vi/audit.php` + `'request_fulfilled' => 'giao cuốn sách đã giữ chỗ cho bạn đọc',`; `AuditSentences::ACTIONS` + `'request.fulfilled' => 'loans',`; arm `'request.fulfilled' => self::line('request_fulfilled'),`.

- [ ] **Step 5: Run everything circulation, mutation-check, commit**

Run: `make test FILTER=LendCopy` (BOTH files — the 1c suite must stay green untouched) and `make test FILTER=AuditActionCensusTest`.
Expected: PASS.

Mutation checks: (1) change `$hold?->member_id` back to `null` in the predicate call → "a held copy is lendable to its holder…" red. (2) drop the `$hold->member_id === $membership->user_id` half of `$collectedHoldId` (leaving `$collectedHoldId = $hold?->id`) → "an AVAILABLE copy under somebody else's live hold still lends — and never closes their request" red on both of its request assertions: the walk-up lend closes Phêrô's row as `fulfilled` and stamps his `fulfilled_loan_id` with a loan that is not his. This is the mutation the first draft could not fire, because its fixture put the foreign hold on a different copy than the one being lent; the corrected fixture puts it on the SAME copy, which is also the row divergence 13 is about. (3) drop the expiry filter → "a lapsed hold makes the copy lendable to nobody" red. Restore all; `git status --porcelain` clean.

```bash
make lint && make analyse
git add app/Actions/Circulation/LendCopy.php app/Support/Audit/AuditSentences.php lang/vi/audit.php tests/Feature/Circulation/LendCopyHoldTest.php
git commit -m "feat: lendcopy re-widened — the held-for-me clause live, a collected hold closed in the same transaction"
```

---

### Task 9: `HandoverRequest` — the book actually changes hands

Read first: `old_next/src/domain/circulation/commands/handover-request.ts` (whole file — the delegation argument and the two-refusals-first section ARE the specification), `borrow-requests.test.ts` tests 25–33, plan divergence 11.

**Files:**
- Create: `app/Actions/Circulation/HandoverRequest.php`
- Modify: `tests/Unit/Catalogue/RuleViolatedCodesHaveSentencesTest.php` (+ `hold_expired`, `request_not_held`)
- Modify: `tests/Feature/Architecture/CirculationArchitectureTest.php` — the lockForUpdate grep-pin list does NOT gain this Action; instead the test gains an explicit exemption comment naming divergence 11 ("HandoverRequest takes no locks of its own — its one write transaction is LendCopy's, already pinned")
- Test: `tests/Feature/Circulation/HandoverRequestTest.php`

**Interfaces:**
- Produces: `HandoverRequest::execute(User $actor, BorrowRequest $request): array{loanId: string, dueOn: string}` — throws `request_not_held` | `hold_expired` before delegation, then anything `LendCopy` throws (`membership_not_active`, `loan_limit_reached`, `copy_not_available`, `copy_lost_or_retired`); audit rows are `LendCopy`'s pair (`loan.created` + `request.fulfilled`). No notification (BR §15's "your book is ready" was the APPROVAL's).

- [ ] **Step 1: Write the failing tests**

Create `tests/Feature/Circulation/HandoverRequestTest.php` (fixture `hovFix` — identical skeleton to `lchFix` with slug base `dong-thap-hov`; copy the function, rename, change slugs — the plan repeats rather than references so tasks stand alone):

```php
<?php

use App\Actions\Circulation\HandoverRequest;
use App\Enums\CopyState;
use App\Enums\LoanStatus;
use App\Enums\RequestStatus;
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

afterEach(fn () => Carbon::setTestNow());

/** @return array{Bookshelf, User, Membership, BookCopy, BorrowRequest} */
function hovFix(string $slug = 'dong-thap-hov'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);
    $manager = User::factory()->create(['full_name' => 'Maria Quản Lý Kho']);
    $mm = Membership::factory()->for($shelf)->create(['user_id' => $manager->id, 'role' => 'manager', 'status' => 'active']);
    $holderUser = User::factory()->create(['full_name' => 'Têrêsa Người Giữ Chỗ']);
    $holder = Membership::factory()->for($shelf)->create(['user_id' => $holderUser->id, 'role' => 'reader', 'status' => 'active']);
    $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Dế Mèn Phiêu Lưu Ký', 'slug' => 'de-men']);
    $copy = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0001', 'state' => 'held']);
    $hold = BorrowRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'member_id' => $holderUser->id,
        'status' => RequestStatus::Approved, 'requested_at' => now()->subDay(),
        'copy_id' => $copy->id, 'hold_expires_at' => now()->addDays(2),
        'decided_by' => $manager->id, 'decided_at' => now()->subDay(),
    ]);
    app(TenantContext::class)->set($shelf, $mm);
    test()->actingAs($manager);

    return [$shelf, $manager, $holder, $copy, $hold];
}

it('handing over the held copy creates the loan and closes the request', function () {
    [, $manager, $holder, $copy, $hold] = hovFix();

    $result = app(HandoverRequest::class)->execute($manager, $hold);

    $loan = Loan::query()->findOrFail($result['loanId']);
    expect($loan->status)->toBe(LoanStatus::Active)
        ->and($loan->borrower_id)->toBe($holder->user_id)
        ->and($loan->request_id)->toBe($hold->id)
        ->and($hold->fresh()->status)->toBe(RequestStatus::Fulfilled)
        ->and($hold->fresh()->fulfilled_loan_id)->toBe($loan->id)
        ->and($copy->fresh()->state)->toBe(CopyState::OnLoan);
});

it('the handover writes loan.created and request.fulfilled — LendCopy\'s pair, untouched', function () {
    [, $manager, , , $hold] = hovFix('dong-thap-hov-audit');

    app(HandoverRequest::class)->execute($manager, $hold);

    expect(AuditLog::query()->where('action', 'loan.created')->count())->toBe(1)
        ->and(AuditLog::query()->where('action', 'request.fulfilled')->count())->toBe(1);
});

it('a hold that lapsed by the clock alone can no longer be handed over', function () {
    [, $manager, , $copy, $hold] = hovFix('dong-thap-hov-lapsed');
    Carbon::setTestNow(Carbon::now()->addDays(3));

    expect(fn () => app(HandoverRequest::class)->execute($manager, $hold))
        ->toThrow(RuleViolated::class, 'hold_expired');
    // Nothing wrote anything: no loan, request approved, copy held.
    expect(Loan::query()->count())->toBe(0)
        ->and($hold->fresh()->status)->toBe(RequestStatus::Approved)
        ->and($copy->fresh()->state)->toBe(CopyState::Held);
});

it('a request with nothing held for it is refused, whatever state it is in', function (string $case, array $override) {
    // A DATASET, not a foreach. hovFix ends with test()->actingAs($manager),
    // and SessionGuard caches the acting user for a whole test METHOD —
    // calling the fixture four times inside one it() is the zero-tolerance
    // violation Global Constraints names (fired four times on this
    // project). Each dataset case is its own test method, so each gets its
    // own guard, its own database state and its own slug.
    //
    // copy_id is left SET on the three decided cases on purpose: nulling it
    // would trip the first check and the STATUS branch would never run.
    // These are stale-queue-page shapes — the row moved on while the page
    // stood still — which is exactly what request_not_held answers.
    [, $manager, , , $hold] = hovFix('dong-thap-hov-unheld-'.$case);
    BorrowRequest::query()->whereKey($hold->id)->update($override);

    expect(fn () => app(HandoverRequest::class)->execute($manager, $hold->fresh()))
        ->toThrow(RuleViolated::class, 'request_not_held');
})->with([
    'pending' => ['pending', ['status' => 'pending', 'copy_id' => null, 'hold_expires_at' => null, 'decided_by' => null, 'decided_at' => null]],
    'rejected' => ['rejected', ['status' => 'rejected']],
    'cancelled' => ['cancelled', ['status' => 'cancelled', 'cancelled_at' => '2026-08-28 00:00:00']],
    'fulfilled' => ['fulfilled', ['status' => 'fulfilled']],
]);

it('a hold whose row already carries the expired status refuses with hold_expired', function () {
    // Ruling 1 made this branch REACHABLE: ReleaseExpiredHold (Task 18) is
    // the one writer of `expired`, and a manager who releases a lapsed hold
    // while a volunteer's queue page still shows its handover button
    // produces exactly this row. Before that ruling the branch was
    // defensive against nothing and the docblock said so; it no longer
    // does, and this test is why. The SENTENCE matters as much as the
    // refusal: request_not_held ("Yêu cầu này không có bản sách nào đang
    // được giữ chỗ") would be a false statement about a row that plainly
    // names a copy — hold_expired names the remedy ("Bạn đọc cần đăng ký
    // lại").
    [, $manager, , $copy, $hold] = hovFix('dong-thap-hov-expired');
    BorrowRequest::query()->whereKey($hold->id)->update(['status' => 'expired']);

    expect(fn () => app(HandoverRequest::class)->execute($manager, $hold->fresh()))
        ->toThrow(RuleViolated::class, 'hold_expired');
    expect(Loan::query()->count())->toBe(0)
        ->and($copy->fresh()->state)->toBe(CopyState::Held);
});

it('a suspended holder is refused at handover — LendCopy\'s own sentence, not a second definition', function () {
    // Named for what it asserts. The first draft called this "a suspended
    // holder, AND ONE AT THE LOAN LIMIT, are refused" and tested only the
    // suspension; the limit case belongs to LendCopyTest, which owns
    // memberMayBorrow's count, and is not restated here.
    [, $manager, $holder, , $hold] = hovFix('dong-thap-hov-susp');
    Membership::query()->whereKey($holder->id)->update(['status' => 'suspended', 'suspension_reason' => 'thử nghiệm']);

    expect(fn () => app(HandoverRequest::class)->execute($manager, $hold))
        ->toThrow(RuleViolated::class, 'membership_not_active');
});

it('the handover fulfils the request it was asked about, never an earlier one', function () {
    // Two live approved holds on one copy is a state the approve lock
    // exists to prevent and no constraint enforces; constructed directly.
    // The EARLIER hold is the one LendCopy's ordered read finds, so a
    // handover asked about the LATER row must refuse rather than
    // silently close somebody else's.
    [$shelf, $manager, , $copy, $hold] = hovFix('dong-thap-hov-first');
    app(TenantContext::class)->actSystemWide();
    $later = User::factory()->create(['full_name' => 'Anna Đăng Ký Sau']);
    Membership::factory()->for($shelf)->create(['user_id' => $later->id, 'role' => 'reader', 'status' => 'active']);
    $laterHold = BorrowRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $hold->book_id, 'member_id' => $later->id,
        'status' => RequestStatus::Approved, 'requested_at' => now(),          // AFTER $hold's subDay()
        'copy_id' => $copy->id, 'hold_expires_at' => now()->addDays(2),
        'decided_by' => $manager->id, 'decided_at' => now(),
    ]);
    app(TenantContext::class)->set($shelf->fresh(), Membership::query()->whereHas('user', fn ($q) => $q->where('full_name', 'Maria Quản Lý Kho'))->firstOrFail());

    expect(fn () => app(HandoverRequest::class)->execute($manager, $laterHold))
        ->toThrow(RuleViolated::class, 'request_not_held');
    expect($hold->fresh()->status)->toBe(RequestStatus::Approved);
});

it('the holder having left the shelf refuses cleanly rather than passing null onward', function () {
    [$shelf, $manager, $holder, , $hold] = hovFix('dong-thap-hov-left');
    Membership::query()->whereKey($holder->id)->delete();   // soft delete

    expect(fn () => app(HandoverRequest::class)->execute($manager, $hold))
        ->toThrow(RuleViolated::class, 'request_not_held');
});
```

- [ ] **Step 2: Run to verify failure** — `make test FILTER=HandoverRequestTest`. Expected: FAIL.

- [ ] **Step 3: Implement**

Create `app/Actions/Circulation/HandoverRequest.php`:

```php
<?php

namespace App\Actions\Circulation;

use App\Enums\RequestStatus;
use App\Exceptions\RuleViolated;
use App\Models\BookCopy;
use App\Models\BorrowRequest;
use App\Models\Membership;
use App\Models\User;
use App\Support\Clock;
use Illuminate\Support\Facades\Gate;

/**
 * The manager hands a child the copy their approved request put aside —
 * BR §7.1's held → on_loan and §7.2's approved → fulfilled, at the
 * moment the book actually changes hands. Port of handover-request.ts.
 *
 * DELEGATES to LendCopy instead of restating it (the reference's whole
 * argument): OPS §5 defines this command as LendCopy with one
 * substitution — the copy must be held FOR THIS READER (INV-3's second
 * clause) — plus the hold-not-expired check. LendCopy's locked hold read
 * and copyLendable already perform the substituted step, and it already
 * closes the collected hold (request.fulfilled beside loan.created).
 * There is no second definition of who may take a held copy to drift.
 *
 * The pre-flight reads below run OUTSIDE any transaction (plan
 * divergence 11): they choose the KIND sentence — hold_expired names the
 * remedy where copy_not_available would be a false statement about a
 * book on the shelf; request_not_held covers a stale queue page's
 * pending/rejected/cancelled/fulfilled row — and every fact is
 * re-established on locked rows inside LendCopy's transaction, whose
 * first statement is the copy lock. A hold cancelled in the microseconds
 * between produces LendCopy's sentence instead of this one — a stale
 * sentence in a race the reference had identically, never a wrong write.
 *
 * The first-hold check: LendCopy collects the EARLIEST live approved
 * hold on the copy; here the request is the input, so this command
 * checks the hold LendCopy will find is the one it was asked about and
 * refuses when not — two live holds on one copy is a state the approve
 * lock prevents and no constraint enforces, and without this the command
 * would hand the book to the right person while closing somebody else's
 * row.
 *
 * No notification: "your book is ready" was the APPROVAL's (OPS §7).
 */
final class HandoverRequest
{
    public function __construct(
        private Clock $clock,
        private LendCopy $lendCopy,
    ) {}

    /** @return array{loanId: string, dueOn: string} */
    public function execute(User $actor, BorrowRequest $request): array
    {
        Gate::forUser($actor)->authorize('handover', $request);

        // Fresh read, not the route-bound snapshot — these are courtesy
        // checks and should at least start from the latest committed row.
        $request = BorrowRequest::query()->findOrFail($request->id);

        // One code for "no such request", "another shelf's" (scope) and
        // "nothing held" — a manager's screen never offers this button on
        // any of those rows, and telling them apart would confirm the
        // other shelf's request exists.
        if ($request->copy_id === null) {
            throw new RuleViolated('request_not_held');
        }
        if ($request->status === RequestStatus::Expired) {
            // REACHABLE, not defensive. ReleaseExpiredHold (product-owner
            // ruling 1) is the one writer of `expired`, and a manager who
            // releases a lapsed hold while a volunteer's queue page still
            // shows its handover button produces exactly this row. It
            // takes its own branch rather than falling through to the
            // status check below because request_not_held would be a false
            // statement about a row that plainly names a copy —
            // hold_expired names the remedy instead. HandoverRequestTest
            // pins it by name.
            throw new RuleViolated('hold_expired');
        }
        if ($request->status !== RequestStatus::Approved) {
            throw new RuleViolated('request_not_held');
        }
        if ($request->hold_expires_at === null || $request->hold_expires_at <= $this->clock->now()) {
            throw new RuleViolated('hold_expired');
        }

        // This shelf's membership for the holder — member_id is a
        // users(id); LendCopy's input is a Membership, which is what this
        // lookup exists to produce. Soft-deleted rows are excluded by the
        // model's scope: a holder who left has no membership to lend to.
        $membership = Membership::query()->where('user_id', $request->member_id)->first();
        if ($membership === null) {
            throw new RuleViolated('request_not_held');
        }

        // The hold LendCopy is about to collect, resolved by the same
        // ordered read — see the class docblock.
        $firstHold = BorrowRequest::query()
            ->where('copy_id', $request->copy_id)
            ->where('status', RequestStatus::Approved)
            ->where('hold_expires_at', '>', $this->clock->now())
            ->orderBy('requested_at')->orderBy('id')
            ->value('id');
        if ($firstHold !== $request->id) {
            throw new RuleViolated('request_not_held');
        }

        $copy = BookCopy::query()->findOrFail($request->copy_id);

        // INV-1..5, 7, both audit rows, the fulfilled close — the one
        // implementation, under its own locks.
        return $this->lendCopy->execute($actor, $copy, $membership);
    }
}
```

- [ ] **Step 4: Censuses**

Literal census + `'hold_expired'`, `'request_not_held'`. In `CirculationArchitectureTest`'s lock grep-pin, add above the file list:

```php
    // HandoverRequest is deliberately absent: it takes no locks of its
    // own (plan divergence 11) — its one write transaction is LendCopy's,
    // whose lock position LendCopyTest already pins.
```

- [ ] **Step 5: Run, mutation-check, commit**

Run: `make test FILTER=HandoverRequestTest && make test FILTER=RuleViolatedCodesHaveSentencesTest` — PASS.

Mutation checks: (1) delete the first-hold check → "fulfils the request it was asked about, never an earlier one" red; restore. (2) change the expiry comparison to `<` … to `>=`? Instead: remove the `hold_expires_at` pre-check entirely → "a hold that lapsed…" red (it now reaches LendCopy and throws `copy_not_available`, the wrong code); restore.

```bash
make lint && make analyse
git add app/Actions/Circulation/HandoverRequest.php tests/
git commit -m "feat: handoverrequest — the sentences up front, the one lendcopy implementation underneath"
```

---

### Task 10: `ReceiveReturn` re-widened — both facts, one transaction, never observably available in between

Read first: `old_next/src/domain/circulation/commands/receive-return.ts` (WHOLE file — this task restores it), `receive-return.test.ts` tests 8–20 (the hold-branch middle 1c skipped), `app/Actions/Circulation/ReceiveReturn.php` as shipped (its docblock names exactly what comes back), and known-gaps' "`ReceiveReturn`'s contract is deliberately narrower…" entry (the four things, verbatim).

**Files:**
- Modify: `app/Actions/Circulation/ReceiveReturn.php`
- Modify: `tests/Unit/Catalogue/RuleViolatedCodesHaveSentencesTest.php` (+ `request_not_queued`)
- Modify: `tests/Feature/Architecture/NotificationsAreReaderFacingTest.php` (`request_approved`'s writer list gains this file — the second door)
- Test: `tests/Feature/Circulation/ReceiveReturnHoldTest.php` (new file; 1c's `ReceiveReturnTest` stays untouched and green)

**Interfaces:**
- Produces: `ReceiveReturn::execute(User $actor, Loan $loan, CopyCondition $condition, ?string $note = null, ?string $photoUrl = null, ?string $holdForRequestId = null): array{loanId: string, queuedRequestId: ?string}` — **a signature change**: 1c's `void` return becomes the reference's result shape. Throws the 1c codes plus `request_not_queued`. Audit: `loan.returned` always; `request.approved` when a hold is made. Notification: `request_approved` when a hold is made. Task 15's controller consumes the new signature; **this task updates `ReturnController::store` minimally in the same commit** (pass null, ignore the result — the screen work is Task 15's) so every commit stays green.

- [ ] **Step 1: Write the failing tests**

Create `tests/Feature/Circulation/ReceiveReturnHoldTest.php`:

```php
<?php

use App\Actions\Circulation\ReceiveReturn;
use App\Enums\CopyCondition;
use App\Enums\CopyState;
use App\Enums\LoanStatus;
use App\Enums\RequestStatus;
use App\Exceptions\RuleViolated;
use App\Models\AuditLog;
use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\BorrowRequest;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\Notification;
use App\Models\User;
use App\Support\TenantContext;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

afterEach(fn () => Carbon::setTestNow());

/**
 * Shelf + acting manager + borrower with an ACTIVE loan on the one copy
 * + a queue of $queued PENDING requests by distinct readers, seeded OUT
 * of requested_at order (UUIDv7 rule).
 *
 * @return array{Bookshelf, User, Loan, BookCopy, list<BorrowRequest>}
 */
function rrwFix(int $queued = 0, string $slug = 'dong-thap-rrw'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);
    $manager = User::factory()->create(['full_name' => 'Maria Quản Lý Kho']);
    $mm = Membership::factory()->for($shelf)->create(['user_id' => $manager->id, 'role' => 'manager', 'status' => 'active']);
    $borrower = User::factory()->create(['full_name' => 'Giuse Người Đang Mượn']);
    Membership::factory()->for($shelf)->create(['user_id' => $borrower->id, 'role' => 'reader', 'status' => 'active']);
    $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Dế Mèn Phiêu Lưu Ký', 'slug' => 'de-men']);
    $copy = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0001', 'state' => 'on_loan']);
    $loan = Loan::query()->create([
        'bookshelf_id' => $shelf->id, 'copy_id' => $copy->id, 'book_id' => $book->id,
        'borrower_id' => $borrower->id, 'lent_by' => $manager->id,
        'due_on' => '2026-09-11', 'status' => 'active',
    ]);
    // Queue seeded NEWEST-FIRST so creation order (and the v7 ids)
    // DISAGREES with requested_at order — the ordering is falsifiable.
    $requests = [];
    for ($i = $queued; $i >= 1; $i--) {
        $u = User::factory()->create(['full_name' => "Bạn Chờ Thứ {$i}"]);
        Membership::factory()->for($shelf)->create(['user_id' => $u->id, 'role' => 'reader', 'status' => 'active']);
        $requests[$i] = BorrowRequest::query()->create([
            'bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'member_id' => $u->id,
            'status' => RequestStatus::Pending, 'requested_at' => now()->subMinutes(100 - $i),
        ]);
    }
    ksort($requests);
    app(TenantContext::class)->set($shelf, $mm);
    test()->actingAs($manager);

    return [$shelf, $manager, $loan, $copy, array_values($requests)];
}

it('nothing is held automatically when the manager does not ask', function () {
    [, $manager, $loan, $copy, $queue] = rrwFix(queued: 2);

    $result = app(ReceiveReturn::class)->execute($manager, $loan, CopyCondition::Perfect);

    expect($copy->fresh()->state)->toBe(CopyState::Available)
        ->and($queue[0]->fresh()->status)->toBe(RequestStatus::Pending)
        // …but the earliest waiter IS reported, so the confirmation can
        // offer them (BR §16.3: "the confirmation says so immediately").
        ->and($result['queuedRequestId'])->toBe($queue[0]->id);
});

it('the queue is reported in requested_at order with the id tiebreak, not insertion order', function () {
    // Fixture seeds newest-first, so creation order is the WRONG answer.
    [, $manager, $loan, , $queue] = rrwFix(queued: 3, slug: 'dong-thap-rrw-order');

    $result = app(ReceiveReturn::class)->execute($manager, $loan, CopyCondition::Perfect);

    expect($result['queuedRequestId'])->toBe($queue[0]->id);
});

it('holding for the next reader is a second fact, in the same transaction, and the copy is never available', function () {
    Carbon::setTestNow(Carbon::parse('2026-08-28 07:00:00', 'UTC'));
    [, $manager, $loan, $copy, $queue] = rrwFix(queued: 2, slug: 'dong-thap-rrw-hold');

    $result = app(ReceiveReturn::class)->execute(
        $manager, $loan, CopyCondition::Perfect, null, null, $queue[0]->id,
    );

    $held = $queue[0]->fresh();
    expect($loan->fresh()->status)->toBe(LoanStatus::Returned)
        // ONE copy write, straight to held — never available in between
        // (OPS §5; the single-UPDATE shape is pinned by the query-log
        // test below).
        ->and($copy->fresh()->state)->toBe(CopyState::Held)
        ->and($held->status)->toBe(RequestStatus::Approved)
        ->and($held->copy_id)->toBe($copy->id)
        ->and($held->hold_expires_at->toIso8601ZuluString())->toBe('2026-08-31T07:00:00Z')
        ->and($held->decided_by)->toBe($manager->id)
        // The reported next-in-line is read AFTER the writes: the held
        // request is no longer pending, so it is the person after them.
        ->and($result['queuedRequestId'])->toBe($queue[1]->id);
});

it('the hold writes request.approved beside loan.returned, and tells the child — one transaction', function () {
    Carbon::setTestNow(Carbon::parse('2026-08-28 07:00:00', 'UTC'));
    [, $manager, $loan, $copy, $queue] = rrwFix(queued: 1, slug: 'dong-thap-rrw-audit');

    app(ReceiveReturn::class)->execute($manager, $loan, CopyCondition::Perfect, null, null, $queue[0]->id);

    $returned = AuditLog::query()->where('action', 'loan.returned')->firstOrFail();
    $approved = AuditLog::query()->where('action', 'request.approved')->firstOrFail();
    expect(((array) $returned->after)['copy_state'])->toBe('held')
        ->and($approved->entity_id)->toBe($queue[0]->id)
        ->and((array) $approved->before)->toMatchArray(['status' => 'pending', 'copy_id' => null])
        ->and(((array) $approved->after)['copy_id'])->toBe($copy->id)
        // Divergence 6: userId from THIS door too.
        ->and(((array) $approved->after)['userId'])->toBe($queue[0]->member_id);

    $note = Notification::query()->firstOrFail();
    expect($note->user_id)->toBe($queue[0]->member_id)
        ->and($note->kind)->toBe('request_approved')
        ->and($note->payload)->toMatchArray(['title' => 'Dế Mèn Phiêu Lưu Ký', 'hold_until' => '2026-08-31']);
});

it('holding for a request that is no longer queued fails cleanly, and the return rolls back with it', function () {
    [, $manager, $loan, $copy, $queue] = rrwFix(queued: 1, slug: 'dong-thap-rrw-gone');
    BorrowRequest::query()->whereKey($queue[0]->id)->update(['status' => RequestStatus::Cancelled, 'cancelled_at' => now()]);

    expect(fn () => app(ReceiveReturn::class)->execute($manager, $loan, CopyCondition::Perfect, null, null, $queue[0]->id))
        ->toThrow(RuleViolated::class, 'request_not_queued');
    // G3 in its sharpest form: a return that succeeded while its hold
    // failed would leave a book on the shelf the system believes is with
    // a reader. NOTHING committed.
    expect($loan->fresh()->status)->toBe(LoanStatus::Active)
        ->and($copy->fresh()->state)->toBe(CopyState::OnLoan)
        ->and(Notification::query()->count())->toBe(0);
});

it('holding for a request queued against a different title fails the same way', function () {
    [$shelf, $manager, $loan] = rrwFix(0, 'dong-thap-rrw-othertitle');
    app(TenantContext::class)->actSystemWide();
    $other = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Hoàng Tử Bé', 'slug' => 'hoang-tu-be']);
    $u = User::factory()->create(['full_name' => 'Anna Chờ Sách Khác']);
    Membership::factory()->for($shelf)->create(['user_id' => $u->id, 'role' => 'reader', 'status' => 'active']);
    $foreign = BorrowRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $other->id, 'member_id' => $u->id,
        'status' => RequestStatus::Pending, 'requested_at' => now(),
    ]);
    app(TenantContext::class)->set($shelf->fresh(), Membership::query()->whereHas('user', fn ($q) => $q->where('full_name', 'Maria Quản Lý Kho'))->firstOrFail());

    expect(fn () => app(ReceiveReturn::class)->execute($manager, $loan, CopyCondition::Perfect, null, null, $foreign->id))
        ->toThrow(RuleViolated::class, 'request_not_queued');
});

it('the lock order is copy, loan, then the hold-for request', function () {
    [, $manager, $loan, , $queue] = rrwFix(queued: 1, slug: 'dong-thap-rrw-lock');

    DB::flushQueryLog();
    DB::enableQueryLog();
    app(ReceiveReturn::class)->execute($manager, $loan, CopyCondition::Perfect, null, null, $queue[0]->id);
    $log = DB::getQueryLog();
    DB::disableQueryLog();

    expect(str_contains($log[0]['query'], 'book_copies'))->toBeTrue($log[0]['query'])
        ->and(str_contains(strtolower($log[0]['query']), 'for update'))->toBeTrue($log[0]['query'])
        ->and(str_contains($log[1]['query'], 'loans'))->toBeTrue($log[1]['query'])
        ->and(str_contains(strtolower($log[1]['query']), 'for update'))->toBeTrue($log[1]['query'])
        ->and(str_contains($log[2]['query'], 'borrow_requests'))->toBeTrue($log[2]['query'])
        ->and(str_contains(strtolower($log[2]['query']), 'for update'))->toBeTrue($log[2]['query']);

    // And the copy write is ONE statement, straight to held.
    //
    // str_starts_with, not str_contains: the transaction's FIRST statement
    // is `select * from `book_copies` … limit 1 for update`, which
    // contains the substring "update" inside "for update" — a
    // str_contains filter matches it, returns two entries, and reads the
    // SELECT as the copy write, whose text has no `state`. (Shipped
    // precedent for the log text: tests/Feature/Circulation/
    // LendCopyTest.php:221 asserts on exactly that string.) Anchoring at
    // the start of the statement leaves only real UPDATEs.
    $copyWrites = array_values(array_filter(
        $log,
        fn (array $q) => str_starts_with(trim($q['query']), 'update `book_copies`'),
    ));
    expect($copyWrites)->toHaveCount(1)
        ->and(str_contains($copyWrites[0]['query'], 'state'))->toBeTrue($copyWrites[0]['query']);
});

it('with no queue at all, queuedRequestId is null and the 1c behaviour is byte-identical', function () {
    [, $manager, $loan, $copy] = rrwFix(0, 'dong-thap-rrw-plain');

    $result = app(ReceiveReturn::class)->execute($manager, $loan, CopyCondition::Worn, 'gáy hơi sờn');

    expect($result['queuedRequestId'])->toBeNull()
        ->and($copy->fresh()->state)->toBe(CopyState::Available)
        ->and($loan->fresh()->return_condition)->toBe(CopyCondition::Worn);
});
```

- [ ] **Step 2: Run to verify failure** — `make test FILTER=ReceiveReturnHoldTest`. Expected: FAIL — `execute()` takes no sixth argument / returns void.

- [ ] **Step 3: Re-widen the Action**

Rewrite `app/Actions/Circulation/ReceiveReturn.php`. The 1c body stays recognisable; what changes: the signature, the third lock, the hold branch, the copy-state value, the second audit row, the notification, the queued read, the docblock. Full new file:

```php
<?php

namespace App\Actions\Circulation;

use App\Enums\CopyCondition;
use App\Enums\CopyState;
use App\Enums\LoanStatus;
use App\Enums\RequestStatus;
use App\Exceptions\RuleViolated;
use App\Models\BookCopy;
use App\Models\BorrowRequest;
use App\Models\ConditionAssessment;
use App\Models\Loan;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\Circulation\LendingSettings;
use App\Support\Circulation\LoanTerms;
use App\Support\Clock;
use App\Support\Notifications\NotificationKind;
use App\Support\Notifications\Notifier;
use App\Support\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * Closes a loan and records the copy's condition — OPS §5's walk, BR
 * §16.3's two-tap common case. RE-WIDENED in Phase 2a to the reference's
 * full shape (receive-return.ts), discharging 1c divergence 4: the
 * queued-reader decision is back, and it is NEVER automatic — OPS §5:
 * "the manager decides, because the next reader may not be standing
 * there." A pending request for this title is REPORTED
 * (queuedRequestId) and acted on only when the caller passes
 * $holdForRequestId. When they do, both facts commit in this one
 * transaction with two audit rows — a return that succeeded while its
 * hold failed would leave a book on the shelf the system believes is
 * with a reader (G3).
 *
 * Lock order (divergence 1): copy FIRST (from the route-bound loan's
 * own copy_id attribute, no query), then the loan, then — new here —
 * the PENDING hold-for request, a third lock the reference never took:
 * its resolveHold was a plain read a concurrent CancelOwnRequest could
 * invalidate mid-transaction. copy → loan → request is the phase's one
 * global order.
 *
 * The copy moves in ONE statement to held-or-available — never
 * available then held. The transaction makes the intermediate state
 * unobservable anyway; one write is also one fewer state to reason
 * about, and the state-machine table is deliberately not consulted for
 * the composed arrow (the reference's on_loan → held note).
 *
 * hold_expires_at is written from the injected clock and compared
 * against the injected clock on every later read — the sharpest case of
 * the two-clocks rule (the reference's docblock).
 *
 * T27 (OPS §5): a worse condition never diverts the copy away from its
 * destination. loans_returned_has_condition: status and
 * return_condition are ONE update().
 */
final class ReceiveReturn
{
    public function __construct(
        private Clock $clock,
        private AuditRecorder $audit,
        private Notifier $notifier,
        private TenantContext $tenant,
    ) {}

    /** @return array{loanId: string, queuedRequestId: ?string} */
    public function execute(
        User $actor,
        Loan $loan,
        CopyCondition $condition,
        ?string $note = null,
        ?string $photoUrl = null,
        ?string $holdForRequestId = null,
    ): array {
        Gate::forUser($actor)->authorize('receiveReturn', $loan);

        return DB::transaction(function () use ($actor, $loan, $condition, $note, $photoUrl, $holdForRequestId): array {
            // FIRST statement — copy_id is an in-memory attribute of the
            // route-bound model; reading it issues no query.
            $copy = BookCopy::query()->lockForUpdate()->findOrFail($loan->copy_id);
            // SECOND — the loan, latest committed row, not the snapshot.
            $loan = Loan::query()->lockForUpdate()->findOrFail($loan->id);

            if ($loan->status !== LoanStatus::Active) {
                throw new RuleViolated('loan_not_active');
            }

            // THIRD — the hold-for request, when asked. Resolved before
            // anything is written, so a request_not_queued refusal costs
            // no write at all (the rollback is the guarantee either way —
            // the named test pins it — but this ordering spares a
            // reviewer reasoning about a partially-applied return).
            // request_not_queued covers both halves of OPS §4.2's wording
            // — the id "no longer points at a pending request FOR THIS
            // TITLE": the reader cancelled between page load and confirm,
            // or another manager approved them onto a different copy.
            $hold = null;
            if ($holdForRequestId !== null) {
                $hold = BorrowRequest::query()->lockForUpdate()->find($holdForRequestId);
                if ($hold === null || $hold->status !== RequestStatus::Pending || $hold->book_id !== $loan->book_id) {
                    throw new RuleViolated('request_not_queued');
                }
            }

            $now = $this->clock->now();
            $trimmedNote = ($note === null || trim($note) === '') ? null : trim($note);
            // Captured BEFORE the copy update rewrites the row.
            $previousCondition = $copy->condition->value;
            $title = (string) $copy->book?->title;

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

            // ONE statement, held or available — see the class docblock.
            $copyState = $hold !== null ? CopyState::Held : CopyState::Available;
            $copy->update([
                'state' => $copyState,
                'condition' => $condition,
                'condition_note' => $trimmedNote,
            ]);

            $this->audit->record('loan.returned', 'loan', $loan->id,
                [
                    'status' => 'active',
                    'copy_state' => 'on_loan',
                    'condition' => $previousCondition,
                ],
                [
                    'status' => 'returned',
                    'copy_state' => $copyState->value,
                    'condition' => $condition->value,
                    'title' => $title,
                    'borrower_id' => $loan->borrower_id,
                ]);

            if ($hold !== null) {
                $shelf = $this->tenant->bookshelf();
                if ($shelf === null) {
                    throw new RuleViolated('shelf_not_found');
                }
                $holdExpiresAt = LoanTerms::holdExpiry($now, LendingSettings::fromShelf($shelf)->holdDays);

                $hold->update([
                    'status' => RequestStatus::Approved,
                    'copy_id' => $copy->id,
                    'hold_expires_at' => $holdExpiresAt,
                    'decided_by' => $actor->id,
                    'decided_at' => $now,
                ]);

                // The same payload shape ApproveBorrowRequest writes, so
                // ONE resolution rule covers both ways a hold is created
                // (divergence 6: userId from this door too).
                $this->audit->record('request.approved', 'request', $hold->id,
                    ['status' => 'pending', 'copy_id' => null],
                    [
                        'status' => 'approved',
                        'copy_id' => $copy->id,
                        'hold_expires_at' => $holdExpiresAt->toISOString(),
                        'userId' => $hold->member_id,
                    ]);

                // OPS §7: one kind from two doors — a child experiences
                // one event: their book is ready.
                $this->notifier->notify($hold->member_id, NotificationKind::RequestApproved, [
                    'title' => $title,
                    'hold_until' => $holdExpiresAt->timezone('Asia/Ho_Chi_Minh')->toDateString(),
                ]);
            }

            // Read AFTER the writes, so it answers "is anyone STILL
            // waiting?" — a just-held request is no longer pending, and
            // this is the next person along, or null. requested_at is the
            // ordering key; id breaks the tie deterministically.
            $queuedRequestId = BorrowRequest::query()
                ->where('book_id', $loan->book_id)
                ->where('status', RequestStatus::Pending)
                ->orderBy('requested_at')->orderBy('id')
                ->value('id');

            return ['loanId' => $loan->id, 'queuedRequestId' => $queuedRequestId];
        });
    }
}
```

In `app/Http/Controllers/Manage/ReturnController.php::store`, the call site changes minimally (Task 15 does the screen): the `execute(...)` call's return is assigned but only the flash uses the old path — pass `null` for the two new arguments implicitly (they default), and delete the docblock line "The queued-reader offer … is ABSENT until Phase 2" (now false), replacing it with "The queued-reader offer's screen work lands in Task 15; the Action is already the full shape."

- [ ] **Step 4: Census rows**

Literal census + `'request_not_queued'`. `NotificationsAreReaderFacingTest`'s `request_approved` row becomes:

```php
    'request_approved' => [
        'app/Actions/Circulation/ApproveBorrowRequest.php',
        // "…and the equivalent effect inside ReceiveReturn when it holds
        // for the next reader" — OPS §7, verbatim. One kind, two doors.
        'app/Actions/Circulation/ReceiveReturn.php',
    ],
```

- [ ] **Step 5: Run the full circulation suite, mutation-check, commit**

Run: `make test FILTER=ReceiveReturn` (both files) and `make test FILTER=Notification` — PASS. Then the WHOLE suite (`make test`) — the signature change touches `ReturnController`; everything else must be untouched.

Mutation checks: (1) split the copy write into two statements (available then held) → the single-copy-write pin in the lock test red; restore. (2) move the queued read BEFORE the hold update → "the reported next-in-line is read AFTER the writes" (in the hold test) red; restore. (3) drop the `book_id` clause from the hold resolve → "a different title fails the same way" red; restore.

```bash
make lint && make analyse
git add app/Actions/Circulation/ReceiveReturn.php app/Http/Controllers/Manage/ReturnController.php tests/
git commit -m "feat: receivereturn re-widened — the hold branch back, both facts in one transaction"
```

---

### Task 11: `BorrowRequestQueueQuery` — the queue grouped by book, the free copies, the badge count, the dashboard card's number

Read first: `old_next/src/domain/circulation/queries/get-borrow-request-queue.ts` (whole file — the what-counts-as-queued, the total order and the scoping docblocks), `borrow-request-queue.test.ts` (all eleven tests), `app/Queries/ReadersListQuery.php` (the ParishUnits::describeSelection idiom), `app/Queries/ManagerDashboardQuery.php`.

**Files:**
- Create: `app/Queries/BorrowRequestQueueQuery.php`
- Modify: `app/Queries/ManagerDashboardQuery.php` (+ `counts.pendingRequests`)
- Test: `tests/Feature/Circulation/BorrowRequestQueueQueryTest.php`
- Test: `tests/Feature/Oversight/ManagerDashboardQueryTest.php` (append; 1d owns it — the path is `Oversight/`, not `Manage/`, verified by listing the directory)

**Interfaces:**
- Produces:
  - `BorrowRequestQueueQuery::run(?string $bookId = null): list<array{bookId: string, title: string, author: ?string, slug: string, coverUrl: ?string, waiting: int, holdDays: int, requests: list<array{requestId: string, position: int, membershipId: ?string, readerUserId: string, readerName: string, parishLine: string, requestedAt: string, status: string, copyId: ?string, copyCode: ?string, holdExpiresAt: ?string, holdExpired: bool}>, freeCopies: list<array{copyId: string, code: string}>}>` — timestamps as ISO-8601 UTC strings (the page formats them; `formatInstantParts` exists).
  - `BorrowRequestQueueQuery::countWaiting(): int` — the badge/card count, the SAME filters as the list (status pending|approved, live books, live users) — "a badge that disagrees with the list it links to is worse than no badge".
  - `ManagerDashboardQuery` return gains `counts.pendingRequests` (int), computed by delegating to `BorrowRequestQueueQuery::countWaiting()` so the two cannot drift.

**Semantics ported exactly (do not invent ordering):**
- Queued = `pending` and `approved`, nothing else. `expired` is what a lapsed hold WOULD carry if anything wrote it; nothing does — `holdExpired` is computed per row against the injected clock, and the lapsed row STAYS, flagged (hiding it would hide the one thing needing doing).
- Within a title: `requested_at asc, id asc`. Between titles: `books.title_folded asc, books.id asc`. `position` = `ROW_NUMBER() OVER (PARTITION BY book_id ORDER BY requested_at ASC, id ASC)` — same keys as the outer order, so the printed number and the row's place cannot disagree. Not paged (the set is bounded by its own state — the `getOverdueLoans` argument).
- `users` joined directly (live rows); `memberships` joined OUTWARD for the id and parish placement alone — an inner join would drop every request whose reader left the shelf, precisely the row a manager must see to clear it. `membershipId` null renders a name with no profile link.
- `freeCopies` per queued title: copies `state = 'available'`, ordered by `code`. One note the port must carry in a comment: the reference read `copies_borrowable` (state + no-live-hold); here every hold-creating command sets `held` in the same transaction, so state alone is the same set — and `ApproveBorrowRequest`'s two-clause predicate (Task 5) still refuses the theoretical divergent row, so list and command cannot disagree in the lend-a-promised-copy direction.

- [ ] **Step 1: Write the failing tests**

Create `tests/Feature/Circulation/BorrowRequestQueueQueryTest.php`:

```php
<?php

use App\Enums\RequestStatus;
use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\BorrowRequest;
use App\Models\Membership;
use App\Models\User;
use App\Queries\BorrowRequestQueueQuery;
use App\Support\TenantContext;
use Carbon\Carbon;

afterEach(fn () => Carbon::setTestNow());

/**
 * Shelf bound to an acting manager; caller seeds its own books/requests.
 *
 * @return array{Bookshelf, User}
 */
function quqFix(string $slug = 'dong-thap-quq'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => ['hold_days' => 4]]);
    $manager = User::factory()->create(['full_name' => 'Maria Quản Lý Kho']);
    $mm = Membership::factory()->for($shelf)->create(['user_id' => $manager->id, 'role' => 'manager', 'status' => 'active']);
    app(TenantContext::class)->set($shelf, $mm);
    test()->actingAs($manager);

    return [$shelf, $manager];
}

/** One reader + one PENDING request for $book at $requestedAt. */
function quqRequest(Bookshelf $shelf, Book $book, string $name, string $requestedAt): BorrowRequest
{
    app(TenantContext::class)->actSystemWide();
    $u = User::factory()->create(['full_name' => $name]);
    Membership::factory()->for($shelf)->create(['user_id' => $u->id, 'role' => 'reader', 'status' => 'active']);
    $r = BorrowRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'member_id' => $u->id,
        'status' => RequestStatus::Pending, 'requested_at' => $requestedAt,
    ]);
    // Rebind after systemWide — the caller's manager context.
    $shelf = $shelf->fresh();
    app(TenantContext::class)->set($shelf, Membership::query()->whereHas('user', fn ($q) => $q->where('full_name', 'Maria Quản Lý Kho'))->firstOrFail());

    return $r;
}

it('groups by book and numbers each reader\'s place, seeded out of order', function () {
    [$shelf] = quqFix();
    app(TenantContext::class)->actSystemWide();
    $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Dế Mèn Phiêu Lưu Ký', 'slug' => 'de-men']);
    app(TenantContext::class)->set($shelf->fresh(), Membership::query()->whereHas('user', fn ($q) => $q->where('full_name', 'Maria Quản Lý Kho'))->firstOrFail());
    // Seeded LATER-first: creation order and v7 ids disagree with
    // requested_at order, so the ordering is falsifiable.
    $second = quqRequest($shelf, $book, 'Anna Đăng Ký Sau', '2026-08-28 09:00:00');
    $first = quqRequest($shelf, $book, 'Têrêsa Đăng Ký Trước', '2026-08-28 08:00:00');

    $queues = app(BorrowRequestQueueQuery::class)->run();

    expect($queues)->toHaveCount(1)
        ->and($queues[0]['waiting'])->toBe(2)
        ->and($queues[0]['holdDays'])->toBe(4)
        ->and($queues[0]['requests'][0]['requestId'])->toBe($first->id)
        ->and($queues[0]['requests'][0]['position'])->toBe(1)
        ->and($queues[0]['requests'][0]['readerName'])->toBe('Têrêsa Đăng Ký Trước')
        ->and($queues[0]['requests'][1]['requestId'])->toBe($second->id)
        ->and($queues[0]['requests'][1]['position'])->toBe(2);
});

it('cancelling ahead of somebody moves them up, because position is derived', function () {
    [$shelf] = quqFix('dong-thap-quq-derive');
    app(TenantContext::class)->actSystemWide();
    $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Hoàng Tử Bé', 'slug' => 'hoang-tu-be']);
    app(TenantContext::class)->set($shelf->fresh(), Membership::query()->whereHas('user', fn ($q) => $q->where('full_name', 'Maria Quản Lý Kho'))->firstOrFail());
    $first = quqRequest($shelf, $book, 'Têrêsa Đăng Ký Trước', '2026-08-28 08:00:00');
    $second = quqRequest($shelf, $book, 'Anna Đăng Ký Sau', '2026-08-28 09:00:00');
    BorrowRequest::query()->whereKey($first->id)->update(['status' => RequestStatus::Cancelled, 'cancelled_at' => now()]);

    $queues = app(BorrowRequestQueueQuery::class)->run();

    expect($queues[0]['requests'])->toHaveCount(1)
        ->and($queues[0]['requests'][0]['requestId'])->toBe($second->id)
        ->and($queues[0]['requests'][0]['position'])->toBe(1);
});

it('only pending and approved rows are waiting on anybody', function () {
    [$shelf] = quqFix('dong-thap-quq-status');
    app(TenantContext::class)->actSystemWide();
    $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Totto-chan Bên Cửa Sổ', 'slug' => 'totto-chan']);
    app(TenantContext::class)->set($shelf->fresh(), Membership::query()->whereHas('user', fn ($q) => $q->where('full_name', 'Maria Quản Lý Kho'))->firstOrFail());
    $pending = quqRequest($shelf, $book, 'Bạn Còn Chờ', '2026-08-28 08:00:00');
    foreach ([RequestStatus::Rejected, RequestStatus::Cancelled, RequestStatus::Fulfilled] as $i => $status) {
        $gone = quqRequest($shelf, $book, "Bạn Đã Xong {$i}", '2026-08-28 07:0'.$i.':00');
        BorrowRequest::query()->whereKey($gone->id)->update(['status' => $status]);
    }

    $queues = app(BorrowRequestQueueQuery::class)->run();

    expect($queues[0]['requests'])->toHaveCount(1)
        ->and($queues[0]['requests'][0]['requestId'])->toBe($pending->id);
});

it('a hold expires because the clock moved, and the row stays on the screen, flagged', function () {
    [$shelf, $manager] = quqFix('dong-thap-quq-expired');
    app(TenantContext::class)->actSystemWide();
    $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Đất Rừng Phương Nam', 'slug' => 'dat-rung']);
    $copy = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0142', 'state' => 'held']);
    app(TenantContext::class)->set($shelf->fresh(), Membership::query()->whereHas('user', fn ($q) => $q->where('full_name', 'Maria Quản Lý Kho'))->firstOrFail());
    $held = quqRequest($shelf, $book, 'Têrêsa Người Giữ Chỗ', '2026-08-24 08:00:00');
    BorrowRequest::query()->whereKey($held->id)->update([
        'status' => RequestStatus::Approved, 'copy_id' => $copy->id,
        'hold_expires_at' => now()->addDay(), 'decided_by' => $manager->id, 'decided_at' => now(),
    ]);

    $before = app(BorrowRequestQueueQuery::class)->run();
    expect($before[0]['requests'][0]['holdExpired'])->toBeFalse()
        ->and($before[0]['requests'][0]['copyCode'])->toBe('DT-0142');

    Carbon::setTestNow(Carbon::now()->addDays(2));   // no job, no write — the clock alone
    $after = app(BorrowRequestQueueQuery::class)->run();
    expect($after[0]['requests'])->toHaveCount(1)
        ->and($after[0]['requests'][0]['holdExpired'])->toBeTrue()
        ->and($after[0]['requests'][0]['status'])->toBe('approved');
});

it('a reader who left the shelf is still in the queue, with nothing to link to', function () {
    [$shelf] = quqFix('dong-thap-quq-left');
    app(TenantContext::class)->actSystemWide();
    $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Dế Mèn Phiêu Lưu Ký', 'slug' => 'de-men-left']);
    app(TenantContext::class)->set($shelf->fresh(), Membership::query()->whereHas('user', fn ($q) => $q->where('full_name', 'Maria Quản Lý Kho'))->firstOrFail());
    $r = quqRequest($shelf, $book, 'Bạn Đã Rời Tủ', '2026-08-28 08:00:00');
    Membership::query()->where('user_id', $r->member_id)->delete();   // soft delete

    $queues = app(BorrowRequestQueueQuery::class)->run();

    expect($queues[0]['requests'])->toHaveCount(1)
        ->and($queues[0]['requests'][0]['membershipId'])->toBeNull()
        ->and($queues[0]['requests'][0]['readerName'])->toBe('Bạn Đã Rời Tủ');
});

it('the order is total across titles — folded title, then book id, and Đ does not sort above Alice', function () {
    [$shelf] = quqFix('dong-thap-quq-fold');
    app(TenantContext::class)->actSystemWide();
    // Seeded Đ-first: byte order would put Đất above Alice; folded order
    // must not.
    $dat = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Đất Rừng Phương Nam', 'slug' => 'dat-rung-f']);
    $alice = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Alice Ở Xứ Sở Diệu Kỳ', 'slug' => 'alice']);
    app(TenantContext::class)->set($shelf->fresh(), Membership::query()->whereHas('user', fn ($q) => $q->where('full_name', 'Maria Quản Lý Kho'))->firstOrFail());
    quqRequest($shelf, $dat, 'Bạn Chờ Một', '2026-08-28 08:00:00');
    quqRequest($shelf, $alice, 'Bạn Chờ Hai', '2026-08-28 08:00:00');

    $titles = array_column(app(BorrowRequestQueueQuery::class)->run(), 'title');

    expect($titles)->toBe(['Alice Ở Xứ Sở Diệu Kỳ', 'Đất Rừng Phương Nam']);
});

it('bookId narrows the answer to one title, and free copies are listed by code', function () {
    [$shelf] = quqFix('dong-thap-quq-narrow');
    app(TenantContext::class)->actSystemWide();
    $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Hoàng Tử Bé', 'slug' => 'hoang-tu-be-n']);
    $other = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Totto-chan Bên Cửa Sổ', 'slug' => 'totto-n']);
    // Free copies seeded out of code order; an on_loan one must not appear.
    BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0022', 'state' => 'available']);
    BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0011', 'state' => 'available']);
    BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0001', 'state' => 'on_loan']);
    app(TenantContext::class)->set($shelf->fresh(), Membership::query()->whereHas('user', fn ($q) => $q->where('full_name', 'Maria Quản Lý Kho'))->firstOrFail());
    quqRequest($shelf, $book, 'Bạn Chờ Ba', '2026-08-28 08:00:00');
    quqRequest($shelf, $other, 'Bạn Chờ Bốn', '2026-08-28 08:00:00');

    $queues = app(BorrowRequestQueueQuery::class)->run($book->id);

    expect($queues)->toHaveCount(1)
        ->and($queues[0]['bookId'])->toBe($book->id)
        ->and(array_column($queues[0]['freeCopies'], 'code'))->toBe(['DT-0011', 'DT-0022']);
});

it('the badge counts what the list shows', function () {
    [$shelf, $manager] = quqFix('dong-thap-quq-badge');
    app(TenantContext::class)->actSystemWide();
    $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Dế Mèn Phiêu Lưu Ký', 'slug' => 'de-men-b']);
    $copy = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0300', 'state' => 'held']);
    app(TenantContext::class)->set($shelf->fresh(), Membership::query()->whereHas('user', fn ($q) => $q->where('full_name', 'Maria Quản Lý Kho'))->firstOrFail());
    quqRequest($shelf, $book, 'Bạn Chờ Năm', '2026-08-28 08:00:00');
    $approved = quqRequest($shelf, $book, 'Bạn Chờ Sáu', '2026-08-28 07:00:00');
    BorrowRequest::query()->whereKey($approved->id)->update([
        'status' => RequestStatus::Approved, 'copy_id' => $copy->id,
        'hold_expires_at' => now()->addDay(), 'decided_by' => $manager->id, 'decided_at' => now(),
    ]);
    $gone = quqRequest($shelf, $book, 'Bạn Đã Huỷ', '2026-08-28 06:00:00');
    BorrowRequest::query()->whereKey($gone->id)->update(['status' => RequestStatus::Cancelled, 'cancelled_at' => now()]);

    $q = app(BorrowRequestQueueQuery::class);
    expect($q->countWaiting())->toBe(2)
        ->and($q->countWaiting())->toBe(array_sum(array_column($q->run(), 'waiting')));
});

it('another shelf\'s queue is invisible — BookshelfScope, not a where clause', function () {
    [$shelf] = quqFix('dong-thap-quq-tenant');
    app(TenantContext::class)->actSystemWide();
    $other = Bookshelf::factory()->create(['slug' => 'can-tho-quq', 'settings' => []]);
    $foreignBook = Book::query()->create(['bookshelf_id' => $other->id, 'title' => 'Sách Tủ Khác', 'slug' => 'sach-khac']);
    $foreignUser = User::factory()->create(['full_name' => 'Bạn Tủ Khác']);
    Membership::factory()->for($other)->create(['user_id' => $foreignUser->id, 'role' => 'reader', 'status' => 'active']);
    BorrowRequest::query()->create([
        'bookshelf_id' => $other->id, 'book_id' => $foreignBook->id, 'member_id' => $foreignUser->id,
        'status' => RequestStatus::Pending, 'requested_at' => now(),
    ]);
    app(TenantContext::class)->set($shelf->fresh(), Membership::query()->whereHas('user', fn ($q) => $q->where('full_name', 'Maria Quản Lý Kho'))->firstOrFail());

    expect(app(BorrowRequestQueueQuery::class)->run())->toBe([])
        ->and(app(BorrowRequestQueueQuery::class)->countWaiting())->toBe(0);
});
```

- [ ] **Step 2: Run to verify failure** — `make test FILTER=BorrowRequestQueueQueryTest`. Expected: FAIL.

- [ ] **Step 3: Implement**

Create `app/Queries/BorrowRequestQueueQuery.php`:

```php
<?php

namespace App\Queries;

use App\Enums\CopyState;
use App\Enums\RequestStatus;
use App\Models\BookCopy;
use App\Models\BorrowRequest;
use App\Support\Circulation\LendingSettings;
use App\Support\Clock;
use App\Support\Members\ParishUnits;
use App\Support\TenantContext;
use Carbon\CarbonImmutable;
use RuntimeException;

/**
 * OPS §3.3's GetBorrowRequestQueue — requests grouped by book in
 * request-time order, with position, hold expiry and the free copies a
 * manager may approve somebody onto. Port of
 * get-borrow-request-queue.ts; its docblock's three arguments travel:
 *
 * WHAT COUNTS AS QUEUED: pending and approved, nothing else. The
 * approved row is the one the manager most needs — the child whose copy
 * waits on the shelf. `expired` is the status a lapsed hold WOULD carry
 * if anything wrote it, and nothing does: holdExpired below is computed
 * per row against the injected clock, and the lapsed row STAYS, flagged
 * — hiding it would hide the one thing on the screen going wrong.
 *
 * THE ORDER IS TOTAL and one half of it is folded: title_folded then
 * book id between titles (byte order puts every Đất above every Alice —
 * the defect the reference shipped twice), requested_at then id within
 * one (two children queueing after the same Sunday mass tie to the
 * second, and untied rows renumber between reads). position's window
 * uses the SAME two keys as the outer order, so the number printed
 * beside a row and the row's place cannot disagree. Not paged: the set
 * is bounded by its own state.
 *
 * SCOPING: BookshelfScope on BorrowRequest does the tenancy; users
 * carries no scope and is joined directly (it can only narrow);
 * memberships is joined OUTWARD, on user AND the shelf column
 * (column-to-column — a join predicate, not a hand-written tenant
 * filter), for the id and parish placement alone: an inner join would
 * drop every request whose reader has left, precisely the row a manager
 * needs in order to clear it.
 *
 * NO INLINE GATE, and that is the house shape, not an omission: every
 * shipped query in app/Queries/ relies on the route's role middleware
 * plus the controller's own Gate — OverdueLoansQuery::run(string $sort),
 * ManagerDashboardQuery::run() and MyDashboardQuery::run(User) each carry
 * none (verified by opening all three). An inline Gate::authorize here
 * would also break the one legitimate non-HTTP caller this plan creates,
 * ManagerDashboardQuery's delegation to countWaiting(). Task 14's routes
 * carry role:manager and its architecture test asserts so.
 */
final class BorrowRequestQueueQuery
{
    public function __construct(
        private Clock $clock,
        private TenantContext $tenant,
        private ParishContextQuery $parishContext,
    ) {}

    /** @return list<array<string, mixed>> */
    public function run(?string $bookId = null): array
    {
        $shelf = $this->tenant->bookshelf();
        if ($shelf === null) {
            throw new RuntimeException('BorrowRequestQueueQuery needs a bound tenant.');
        }
        $holdDays = LendingSettings::fromShelf($shelf)->holdDays;
        $now = $this->clock->now();

        $rows = BorrowRequest::query()
            ->join('books', function ($join) {
                $join->on('books.id', '=', 'borrow_requests.book_id')->whereNull('books.deleted_at');
            })
            ->join('users', function ($join) {
                $join->on('users.id', '=', 'borrow_requests.member_id')->whereNull('users.deleted_at');
            })
            ->leftJoin('memberships', function ($join) {
                // Column-to-column shelf equality: a JOIN predicate — the
                // person may hold memberships of several shelves, and the
                // parish line must be THIS shelf's. Not a tenant filter
                // (BookshelfScope on borrow_requests already did that);
                // TenancyArchitectureTest's grep targets where('bookshelf_id',
                // <value>) and stays green.
                $join->on('memberships.user_id', '=', 'borrow_requests.member_id')
                    ->on('memberships.bookshelf_id', '=', 'borrow_requests.bookshelf_id')
                    ->whereNull('memberships.deleted_at');
            })
            ->leftJoin('book_copies', 'book_copies.id', '=', 'borrow_requests.copy_id')
            ->whereIn('borrow_requests.status', [RequestStatus::Pending, RequestStatus::Approved])
            ->when($bookId !== null, fn ($q) => $q->where('borrow_requests.book_id', $bookId))
            ->select([
                'borrow_requests.id as request_id', 'borrow_requests.book_id',
                'borrow_requests.member_id as reader_user_id', 'borrow_requests.requested_at',
                'borrow_requests.status', 'borrow_requests.copy_id', 'borrow_requests.hold_expires_at',
                'books.title', 'books.author', 'books.slug', 'books.cover_url',
                'users.full_name as reader_name',
                'memberships.id as membership_id', 'memberships.parish_unit_l1_id', 'memberships.parish_unit_l2_id',
                'book_copies.code as copy_code',
            ])
            ->selectRaw('ROW_NUMBER() OVER (PARTITION BY borrow_requests.book_id ORDER BY borrow_requests.requested_at ASC, borrow_requests.id ASC) as position')
            ->orderBy('books.title_folded')->orderBy('books.id')
            ->orderBy('borrow_requests.requested_at')->orderBy('borrow_requests.id')
            ->get();

        // The copies a manager may choose from, per queued title. One
        // grouped query, not a per-row subquery. state=available IS the
        // borrowable set here: every hold-creating command sets `held` in
        // the same transaction (Tasks 5/10), so no available copy carries
        // a live hold — and ApproveBorrowRequest's two-clause predicate
        // still refuses the theoretical divergent row, so the list this
        // screen offers and the command's answer cannot disagree in the
        // promise-it-twice direction. Ordered by code: stable between two
        // loads.
        $bookIds = $rows->pluck('book_id')->unique()->values();
        $freeByBook = BookCopy::query()
            ->whereIn('book_id', $bookIds)
            ->where('state', CopyState::Available)
            ->orderBy('code')
            ->get(['id', 'book_id', 'code'])
            ->groupBy('book_id');

        $context = $this->parishContext->run();

        $queues = [];
        foreach ($rows as $r) {
            $bid = (string) $r->getAttribute('book_id');
            if (! isset($queues[$bid])) {
                $queues[$bid] = [
                    'bookId' => $bid,
                    'title' => (string) $r->getAttribute('title'),
                    'author' => $r->getAttribute('author'),
                    'slug' => (string) $r->getAttribute('slug'),
                    'coverUrl' => $r->getAttribute('cover_url'),
                    'waiting' => 0,
                    'holdDays' => $holdDays,
                    'requests' => [],
                    'freeCopies' => ($freeByBook[$bid] ?? collect())->map(fn (BookCopy $c) => [
                        'copyId' => $c->id, 'code' => $c->code,
                    ])->values()->all(),
                ];
            }
            $holdExpiresAt = $r->getAttribute('hold_expires_at');
            $queues[$bid]['requests'][] = [
                'requestId' => (string) $r->getAttribute('request_id'),
                'position' => (int) $r->getAttribute('position'),
                'membershipId' => $r->getAttribute('membership_id'),
                'readerUserId' => (string) $r->getAttribute('reader_user_id'),
                'readerName' => (string) $r->getAttribute('reader_name'),
                'parishLine' => ParishUnits::describeSelection(
                    $context['taxonomy'], $context['units'],
                    $r->getAttribute('parish_unit_l1_id'), $r->getAttribute('parish_unit_l2_id'),
                ),
                'requestedAt' => CarbonImmutable::parse((string) $r->getAttribute('requested_at'), 'UTC')->toISOString(),
                // ->status->value, NOT (string) $r->getAttribute('status').
                // $r is a BorrowRequest and the model casts status to
                // RequestStatus (app/Models/BorrowRequest.php:21), so the
                // cast form is (string) on an enum OBJECT — a fatal on
                // every row, taking down every queue test, the manager
                // queue screen, the return screen's waiting panel and the
                // dashboard card. Task 13 gets this right; this line did
                // not, until the review ran it down.
                'status' => $r->status->value,
                'copyId' => $r->getAttribute('copy_id'),
                'copyCode' => $r->getAttribute('copy_code'),
                'holdExpiresAt' => $holdExpiresAt === null ? null : CarbonImmutable::parse((string) $holdExpiresAt, 'UTC')->toISOString(),
                // BR §8, derived against the injected clock; false for a
                // pending row, which has no hold to have expired.
                'holdExpired' => $holdExpiresAt !== null
                    && CarbonImmutable::parse((string) $holdExpiresAt, 'UTC')->lessThanOrEqualTo($now),
            ];
            $queues[$bid]['waiting'] = count($queues[$bid]['requests']);
        }

        return array_values($queues);
    }

    /**
     * The badge/card count — counted the way the list is selected, never
     * a shorter way that happens to agree today: same statuses, same
     * live-book and live-user joins that could drop a row.
     */
    public function countWaiting(): int
    {
        return BorrowRequest::query()
            ->join('books', function ($join) {
                $join->on('books.id', '=', 'borrow_requests.book_id')->whereNull('books.deleted_at');
            })
            ->join('users', function ($join) {
                $join->on('users.id', '=', 'borrow_requests.member_id')->whereNull('users.deleted_at');
            })
            ->whereIn('borrow_requests.status', [RequestStatus::Pending, RequestStatus::Approved])
            ->count();
    }
}
```

(Both questions the first draft left to the executor are answered above and in the block itself, checked by opening the files rather than inferred. **The inline gates are gone** — `OverdueLoansQuery::run(string $sort = 'most-late')`, `ManagerDashboardQuery::run()` and `MyDashboardQuery::run(User $reader)` carry no `Gate::` call of any kind, so this query carries none either, and the docblock says why. **`books.author` IS a column** — `database/migrations/2026_08_26_000005_create_books_table.php:24`, `$table->string('author')->nullable()` — so it stays in the select and in the returned shape. The row-shape accessor style follows `MyDashboardQuery`'s `getAttribute` idiom, except for `status`, which goes through the model's cast; see the comment at that line.)

In `app/Queries/ManagerDashboardQuery.php`: constructor gains `private BorrowRequestQueueQuery $queue`; `counts` gains `'pendingRequests' => $this->queue->countWaiting(),` with a comment ("delegated, not restated — the card and the screen it links to cannot drift; the mirror rule the overdue card already follows"). Update the `@return` shape.

**One shipped test in that file breaks and must be updated in the same commit, deliberately:** `it('counts only the bound shelf, proven by distinguishable figures')` asserts the WHOLE return with `expect($d)->toBe([...])`, so adding a key to `counts` reddens it. That is the assertion doing its job — add `'pendingRequests' => 0` to its expected `counts` array (the fixture seeds no requests) rather than loosening the assertion to `toMatchArray`. Append it LAST in `counts`, matching the position the query emits it: `toBe` is `assertSame`, and `===` on arrays compares key ORDER, so prepending in one place and appending in the other reddens the test with a confusing diff.

Then append the new test. The fixture helper is `mdqFix()` (`tests/Feature/Oversight/ManagerDashboardQueryTest.php:25`); it takes no arguments, binds the tenant and the acting manager itself, and returns `compact('shelf', 'other')` — an associative array, so destructure by key:

```php
it('pendingRequests counts pending and approved, and mirrors the queue count exactly', function () {
    ['shelf' => $shelf] = mdqFix();
    $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Hoàng Tử Bé', 'slug' => 'hoang-tu-be-mdq']);
    // Three readers, because borrow_requests_one_live_per_title_member
    // (Task 1) allows one live row per title per reader — and because a
    // count that cannot tell three people apart is not a count.
    foreach ([
        ['Anna Chờ Duyệt', 'pending'],
        ['Giuse Đang Giữ Chỗ', 'approved'],
        ['Têrêsa Đã Huỷ', 'cancelled'],
    ] as [$name, $status]) {
        $u = User::factory()->create(['full_name' => $name]);
        Membership::factory()->for($shelf)->create(['user_id' => $u->id, 'role' => 'reader', 'status' => 'active']);
        BorrowRequest::query()->create([
            'bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'member_id' => $u->id,
            'status' => $status, 'requested_at' => now(),
            'cancelled_at' => $status === 'cancelled' ? now() : null,
        ]);
    }

    $counts = app(ManagerDashboardQuery::class)->run()['counts'];

    // The cancelled row is the thing being excluded, and it exists —
    // a fixture with nothing to exclude cannot prove exclusion.
    expect($counts['pendingRequests'])->toBe(2)
        ->and($counts['pendingRequests'])->toBe(app(BorrowRequestQueueQuery::class)->countWaiting());
});
```

(Add whichever of `Book`, `BorrowRequest`, `Membership`, `User`, `ManagerDashboardQuery`, `BorrowRequestQueueQuery` the file does not already import — it already has `Book`, `BookCopy`, `Membership`, `User` and `ManagerDashboardQuery`.)

- [ ] **Step 4: Run, mutation-check, commit**

Run: `make test FILTER=BorrowRequestQueueQueryTest && make test FILTER=ManagerDashboardQueryTest && make test FILTER=TenancyArchitectureTest` — PASS (the third proves the column-to-column join is not flagged).

Mutation checks: (1) drop `->orderBy('borrow_requests.id')` from the outer order AND the window → "groups by book and numbers…" red (fixture seeds out of order); restore. (2) make the memberships join an inner join → "a reader who left the shelf…" red; restore. (3) change `countWaiting` to pending-only → "the badge counts what the list shows" red; restore.

```bash
make lint && make analyse
git add app/Queries/BorrowRequestQueueQuery.php app/Queries/ManagerDashboardQuery.php tests/
git commit -m "feat: the borrow-request queue query — derived positions, flagged lapses, a badge that counts the list"
```

---

### Task 12: The reader's request surfaces — "Xin mượn" on book detail, cancel, and the routes

Read first: `old_next/src/app/tu-sach/[shelf]/(doc-gia)/sach/[slug]/page.tsx:480-620` (the button/card block — labels, states, refusal placement), `old_next/tests/lib/borrow-actions.test.ts` if present for the action shape, `app/Queries/BookDetailQuery.php` and `resources/js/pages/shelves/book.tsx` as shipped, plan divergence 4.

**Files:**
- Create: `app/Http/Controllers/Reader/BorrowRequestController.php`
- Modify: `app/Queries/BookDetailQuery.php` (+ `myRequest`, and `run()` gains a `?User $viewer` parameter — a signature change, see Interfaces)
- Modify: `app/Http/Controllers/Reader/BookController.php` (`show()` gains `Request $request` and passes `$request->user()` — the query's only call site)
- Modify: `routes/web.php` (reader request routes)
- Modify: `resources/js/pages/shelves/book.tsx` (the request block)
- Modify: `resources/js/lib/copy.ts` (+ `circulation.requests` section)
- Modify: `tests/Feature/Architecture/CirculationArchitectureTest.php` (the absence pin: `'requests/{'` leaves the forbidden list, replaced by a presence pin — this commit is the decision)
- Test: `tests/Feature/Circulation/ReaderRequestSurfaceTest.php`

**Interfaces:**
- Routes (inside the reader group / profile group):
  - `POST /shelves/{shelf}/books/{book}/request` → `store` — name `shelves.books.request` (reader group).
  - `POST /shelves/{shelf}/profile/requests/{borrowRequest}/cancel` → `cancel` — name `shelves.profile.requests.cancel` (profile group; also posted from the book page — one route, two doors, like the reference's one `cancelRequestAction`).
- **`BookDetailQuery::run` changes signature**, and that is an interface change, not prose: `run(Book $book): array` (`app/Queries/BookDetailQuery.php:43` as shipped — it takes no viewer and reads no `Auth`) becomes **`run(Book $book, ?User $viewer = null): array`**. It has exactly one call site, `app/Http/Controllers/Reader/BookController::show`, whose signature gains `Request $request` as its first parameter so it can pass `$request->user()`; nullable because a guest reads this page and has no request to have made. Do not reach for `TenantContext::membership()?->user_id` instead — a memberless super admin viewing the page would resolve to null there for a different reason, and the parameter is the honest shape (`MyDashboardQuery::run(User $reader)` is the precedent).
- `BookDetailQuery`'s returned array gains `myRequest`: the viewer's own `pending|approved` request for this book — `null` (always, for a guest) or `{requestId, status, queuePosition (?int — pending: count of pending rows ahead + 1; approved: null), holdExpiresAt (?string ISO)}`. `queueLength` (shipped) is untouched.
- No Form Requests: neither post carries fields; authorization is the route middleware + the Action's Gate (the 1c renew-POST precedent).

- [ ] **Step 1: Write the failing tests**

Create `tests/Feature/Circulation/ReaderRequestSurfaceTest.php`:

```php
<?php

use App\Enums\RequestStatus;
use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\BorrowRequest;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Inertia\Testing\AssertableInertia;

/**
 * Shelf + reader + one published book with one available copy.
 *
 * @return array{Bookshelf, User, Book}
 */
function rrsFix(string $slug = 'dong-thap-rrs'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);
    $reader = User::factory()->create(['full_name' => 'Têrêsa Bạn Đọc Nhỏ']);
    Membership::factory()->for($shelf)->create(['user_id' => $reader->id, 'role' => 'reader', 'status' => 'active']);
    $book = Book::query()->create([
        'bookshelf_id' => $shelf->id, 'title' => 'Dế Mèn Phiêu Lưu Ký', 'slug' => 'de-men',
        'is_published' => true,
    ]);
    BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0001', 'state' => 'available']);

    return [$shelf, $reader, $book];
}

it('POST books/{book}/request creates the reader\'s own pending request and flashes', function () {
    [$shelf, $reader, $book] = rrsFix();

    $response = test()->actingAs($reader)->post("/shelves/{$shelf->slug}/books/{$book->slug}/request");

    $response->assertRedirect()->assertSessionHas('success');
    $row = BorrowRequest::query()->sole();
    expect($row->member_id)->toBe($reader->id)
        ->and($row->status)->toBe(RequestStatus::Pending);
});

it('a second tap comes back as the duplicate sentence under errors.rule, not a 500', function () {
    [$shelf, $reader, $book] = rrsFix('dong-thap-rrs-dup');
    test()->actingAs($reader)->post("/shelves/{$shelf->slug}/books/{$book->slug}/request");

    $response = test()->actingAs($reader)->post("/shelves/{$shelf->slug}/books/{$book->slug}/request");

    $response->assertSessionHasErrors(['rule']);
    expect(session('errors')->first('rule'))->toBe(__('rules.duplicate_request'))
        ->and(BorrowRequest::query()->count())->toBe(1);
});

it('the book page carries myRequest for the signed-in reader, with a queue position', function () {
    [$shelf, $reader, $book] = rrsFix('dong-thap-rrs-mine');
    // Somebody AHEAD, requested earlier, so the position is 2.
    app(TenantContext::class)->actSystemWide();
    $ahead = User::factory()->create(['full_name' => 'Anna Đăng Ký Trước']);
    Membership::factory()->for($shelf)->create(['user_id' => $ahead->id, 'role' => 'reader', 'status' => 'active']);
    BorrowRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'member_id' => $ahead->id,
        'status' => RequestStatus::Pending, 'requested_at' => now()->subHour(),
    ]);
    BorrowRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'member_id' => $reader->id,
        'status' => RequestStatus::Pending, 'requested_at' => now(),
    ]);

    test()->actingAs($reader)->get("/shelves/{$shelf->slug}/books/{$book->slug}")
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->where('detail.myRequest.status', 'pending')
            ->where('detail.myRequest.queuePosition', 2)
            ->where('detail.myRequest.holdExpiresAt', null));
});

it('an approved request renders as a hold with its expiry, not a position', function () {
    [$shelf, $reader, $book] = rrsFix('dong-thap-rrs-hold');
    app(TenantContext::class)->actSystemWide();
    $copy = BookCopy::query()->where('book_id', $book->id)->firstOrFail();
    $copy->update(['state' => 'held']);
    BorrowRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'member_id' => $reader->id,
        'status' => RequestStatus::Approved, 'requested_at' => now()->subDay(),
        'copy_id' => $copy->id, 'hold_expires_at' => now()->addDays(2),
        'decided_by' => $reader->id, 'decided_at' => now(),
    ]);

    test()->actingAs($reader)->get("/shelves/{$shelf->slug}/books/{$book->slug}")
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->where('detail.myRequest.status', 'approved')
            ->where('detail.myRequest.queuePosition', null)
            ->whereNot('detail.myRequest.holdExpiresAt', null));
});

it('another reader\'s request is NOT my request', function () {
    // The exclusion has something to exclude: the other reader's row
    // exists, and myRequest is null all the same.
    [$shelf, $reader, $book] = rrsFix('dong-thap-rrs-notmine');
    app(TenantContext::class)->actSystemWide();
    $other = User::factory()->create(['full_name' => 'Anna Người Khác']);
    Membership::factory()->for($shelf)->create(['user_id' => $other->id, 'role' => 'reader', 'status' => 'active']);
    BorrowRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'member_id' => $other->id,
        'status' => RequestStatus::Pending, 'requested_at' => now(),
    ]);

    test()->actingAs($reader)->get("/shelves/{$shelf->slug}/books/{$book->slug}")
        ->assertInertia(fn (AssertableInertia $page) => $page->where('detail.myRequest', null));
});

it('POST profile/requests/{borrowRequest}/cancel withdraws my own request', function () {
    [$shelf, $reader, $book] = rrsFix('dong-thap-rrs-cancel');
    app(TenantContext::class)->actSystemWide();
    $request = BorrowRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'member_id' => $reader->id,
        'status' => RequestStatus::Pending, 'requested_at' => now(),
    ]);

    $response = test()->actingAs($reader)
        ->post("/shelves/{$shelf->slug}/profile/requests/{$request->id}/cancel");

    $response->assertRedirect()->assertSessionHas('success');
    expect($request->fresh()->status)->toBe(RequestStatus::Cancelled);
});

it('a guest is redirected to login on the request POST', function () {
    // Named for what it asserts: the non-member case is the it() below,
    // which has to be its own block anyway (SessionGuard caches the
    // acting user for a whole test method).
    [$shelf, , $book] = rrsFix('dong-thap-rrs-guest');

    test()->post("/shelves/{$shelf->slug}/books/{$book->slug}/request")->assertRedirect('/login');
});

it('a signed-in non-member 404s on the request POST', function () {
    // Its own it() block — SessionGuard caches the actingAs user.
    [$shelf, , $book] = rrsFix('dong-thap-rrs-nonmember');
    app(TenantContext::class)->actSystemWide();
    $stranger = User::factory()->create(['full_name' => 'Người Lạ Qua Đường']);

    test()->actingAs($stranger)->post("/shelves/{$shelf->slug}/books/{$book->slug}/request")->assertNotFound();
});
```

- [ ] **Step 2: Run to verify failure** — `make test FILTER=ReaderRequestSurfaceTest`. Expected: FAIL — 404 (no routes).

- [ ] **Step 3: Routes, controller, query, page**

In `routes/web.php`, inside the reader group after the `books/{book}` GET:

```php
        Route::post('/books/{book}/request', [ReaderBorrowRequestController::class, 'store'])->name('books.request');
```

and inside the profile group, after the renew POST:

```php
        Route::post('/requests/{borrowRequest}/cancel', [ReaderBorrowRequestController::class, 'cancel'])->name('requests.cancel');
```

(import `App\Http\Controllers\Reader\BorrowRequestController as ReaderBorrowRequestController`). `{borrowRequest}` resolves through `Bookshelf::borrowRequests()` under `scopeBindings()` — plus `BookshelfScope` independently, the routes file's own documented double layer.

Create `app/Http/Controllers/Reader/BorrowRequestController.php`:

```php
<?php

namespace App\Http\Controllers\Reader;

use App\Actions\Circulation\CancelOwnRequest;
use App\Actions\Circulation\CreateBorrowRequest;
use App\Http\Controllers\Controller;
use App\Models\Book;
use App\Models\Bookshelf;
use App\Models\BorrowRequest;
use App\Models\User;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;

/**
 * BR §16.1's "Xin mượn" and its withdrawal. No Form Request: neither
 * POST carries a field — the book and the request are route-bound, the
 * membership is the session's (plan divergence 4) — and authorization is
 * the role middleware plus the Action's own Gate (the renew-POST shape).
 */
class BorrowRequestController extends Controller
{
    public function store(Request $request, Bookshelf $shelf, Book $book, CreateBorrowRequest $create): RedirectResponse
    {
        /** @var User $user */
        $user = $request->user();
        $create->execute($user, $book);

        return back()->with('success', __('rules.request_success_flash'));
    }

    public function cancel(Request $request, Bookshelf $shelf, BorrowRequest $borrowRequest, CancelOwnRequest $cancel): RedirectResponse
    {
        /** @var User $user */
        $user = $request->user();
        $cancel->execute($user, $borrowRequest);

        return back()->with('success', __('rules.request_cancel_flash'));
    }
}
```

In `app/Queries/BookDetailQuery.php`: `run(Book $book): array` becomes `run(Book $book, ?User $viewer = null): array` (add the `App\Models\User` import), and `app/Http/Controllers/Reader/BookController::show` gains `Request $request` as its first parameter and calls `$detail->run($book, $request->user())`. Nothing else calls this query — `Manage\BookController` uses `ManagerBookDetailQuery`, a different class. Then, beside `queueLength`:

```php
        // The viewer's own place in this title's queue, or null. Own =
        // member_id (a users id) equals the signed-in user — never a
        // membership id. Position is derived on read: pending rows ahead
        // + 1, by the queue's own two ordering keys; an approved request
        // has a hold, not a position. A guest has no request to have made,
        // and $viewer being nullable is how that reads at the call site
        // rather than being hidden behind an Auth:: call inside a query.
        $mine = $viewer === null ? null : BorrowRequest::query()
            ->where('book_id', $book->id)
            ->where('member_id', $viewer->id)
            ->whereIn('status', [RequestStatus::Pending, RequestStatus::Approved])
            ->orderBy('requested_at')->orderBy('id')
            ->first();
        $myRequest = null;
        if ($mine !== null) {
            $ahead = $mine->status === RequestStatus::Pending
                ? BorrowRequest::query()
                    ->where('book_id', $book->id)
                    ->where('status', RequestStatus::Pending)
                    ->where(function ($q) use ($mine) {
                        $q->where('requested_at', '<', $mine->requested_at)
                            ->orWhere(fn ($qq) => $qq->where('requested_at', $mine->requested_at)->where('id', '<', $mine->id));
                    })
                    ->count()
                : null;
            $myRequest = [
                'requestId' => $mine->id,
                'status' => $mine->status->value,
                'queuePosition' => $ahead === null ? null : $ahead + 1,
                'holdExpiresAt' => $mine->hold_expires_at?->toISOString(),
            ];
        }
```

and the returned array gains `'myRequest' => $myRequest,`.

In `resources/js/lib/copy.ts`, inside `circulation`, add:

```ts
        requests: {
            requestButton: "Xin mượn",
            queueButton: "Đăng ký chờ mượn",
            waitingLine: "Bạn đang chờ cuốn này · vị trí {position}",
            heldLine: "Sách đã để dành cho bạn · nhận trước {time} ngày {date}",
            heldLineNoDate: "Sách đã để dành cho bạn",
            cancelButton: "Huỷ yêu cầu",
        },
```

In `resources/js/pages/shelves/book.tsx`: extend the page props type with `myRequest`, and render, below the availability panel (one primary action per screen — the request button is the page's solid button ONLY when no other primary exists; read the shipped page and keep whichever element is currently primary, demoting this to `variant="outline"` if the page already has a solid action):

```tsx
{detail.myRequest ? (
    <div className="mt-6 max-w-sm rounded-md border p-4">
        <p className="text-sm font-medium">
            {detail.myRequest.queuePosition !== null
                ? t(copy.circulation.requests.waitingLine, {
                      position: detail.myRequest.queuePosition,
                  })
                : detail.myRequest.holdExpiresAt
                  ? t(copy.circulation.requests.heldLine, {
                        ...formatInstantParts(detail.myRequest.holdExpiresAt),
                    })
                  : copy.circulation.requests.heldLineNoDate}
        </p>
        <form
            className="mt-3"
            onSubmit={(e) => {
                e.preventDefault();
                cancelForm.post(
                    route("shelves.profile.requests.cancel", {
                        shelf: shelf.slug,
                        borrowRequest: detail.myRequest?.requestId,
                    }),
                    { preserveScroll: true },
                );
            }}
        >
            <Button type="submit" variant="outline" size="sm" disabled={cancelForm.processing}>
                {copy.circulation.requests.cancelButton}
            </Button>
        </form>
    </div>
) : (
    <form
        className="mt-6"
        onSubmit={(e) => {
            e.preventDefault();
            requestForm.post(
                route("shelves.books.request", { shelf: shelf.slug, book: detail.slug }),
                { preserveScroll: true },
            );
        }}
    >
        <Button type="submit" disabled={requestForm.processing}>
            {detail.copiesAvailable > 0
                ? copy.circulation.requests.requestButton
                : copy.circulation.requests.queueButton}
        </Button>
    </form>
)}
```

with `const requestForm = useForm({});` and `const cancelForm = useForm({});` at the top, and the flash/`errors.rule` banners in the page's existing pattern. The availability field is **`detail.copiesAvailable`** — checked by opening `resources/js/pages/shelves/book.tsx`, whose `PageProps["detail"]` declares `copiesTotal`, `copiesAvailable`, `availability`, `onLoan` and `queueLength`; there is no `availableCopies`. The two-labels-one-command rule is the reference's: the label moves with availability, the POST does not.

- [ ] **Step 4: Flip the architecture pin**

In `CirculationArchitectureTest`, the forbidden-fragment loop loses `'requests/{'` and the test gains, in the same commit:

```php
it('the reader request routes exist, reader-gated — 2a\'s decision, no longer an absence', function () {
    $routes = collect(Route::getRoutes()->getRoutes());
    $create = $routes->first(fn ($r) => $r->getName() === 'shelves.books.request');
    $cancel = $routes->first(fn ($r) => $r->getName() === 'shelves.profile.requests.cancel');

    foreach ([$create, $cancel] as $route) {
        expect($route)->not->toBeNull()
            ->and($route->gatherMiddleware())->toContain('role:reader');
    }
});
```

(`'handover'` and `'borrow-requests/{'` STAY forbidden until Task 14 — the loop keeps both.)

- [ ] **Step 5: Run everything, JS gates, commit**

Run: `make test FILTER=ReaderRequestSurfaceTest && make test FILTER=CirculationArchitectureTest` — PASS. Run the JS gates (Biome, tsc, `bun run build`) — clean.

Mutation check: swap `member_id` for `membership` anything in the myRequest read → "another reader's request is NOT my request" stays green (still filters correctly)… instead: remove the `where('member_id', $viewer->id)` clause → that named test goes red. Restore.

```bash
make lint && make analyse
git add routes/web.php app/Http/Controllers/Reader/ app/Queries/BookDetailQuery.php resources/js/ tests/
git commit -m "feat: xin muon on book detail — create and cancel, the session as the scope"
```

---

### Task 13: The reader dashboard's requests half — the empty state retired

Read first: `old_next/src/domain/circulation/queries/get-my-dashboard.ts` (the requests half — `MyRequestRow`, the queue-position subquery), `old_next/src/app/tu-sach/[shelf]/(doc-gia)/ho-so/tong-quan/page.tsx:225-265` (the card and the Huỷ button), `app/Queries/MyDashboardQuery.php` and `resources/js/pages/shelves/profile/overview.tsx` as shipped.

**Files:**
- Modify: `app/Queries/MyDashboardQuery.php` (+ `requests` list; the docblock's "requests half is Phase 2's" sentence replaced)
- Modify: `resources/js/pages/shelves/profile/overview.tsx` (the `requestsComingSoon` block replaced with the real section)
- Modify: `resources/js/lib/copy.ts` (retire `requestsComingSoon`, add the section lines)
- Test: `tests/Feature/Circulation/MyDashboardRequestsTest.php`

**Interfaces:**
- `MyDashboardQuery::run(User $reader)` return gains `requests: list<array{requestId: string, bookId: string, slug: string, title: string, status: string, queuePosition: ?int, holdExpiresAt: ?string}>` — own `pending|approved` rows, ordered `requested_at asc, id asc`; `queuePosition` = pending rows ahead + 1 (the same two keys — the reference's count subquery), null for approved; `holdExpiresAt` ISO or null.

- [ ] **Step 1: Write the failing tests**

Create `tests/Feature/Circulation/MyDashboardRequestsTest.php`:

```php
<?php

use App\Enums\RequestStatus;
use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\BorrowRequest;
use App\Models\Membership;
use App\Models\User;
use App\Queries\MyDashboardQuery;
use App\Support\TenantContext;

/** @return array{Bookshelf, User, Book, Book, User} */
function drhFix(string $slug = 'dong-thap-drh'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);
    $reader = User::factory()->create(['full_name' => 'Têrêsa Bạn Đọc Nhỏ']);
    $membership = Membership::factory()->for($shelf)->create(['user_id' => $reader->id, 'role' => 'reader', 'status' => 'active']);
    // A manager exists so that a decided row can name a plausible decider.
    // `decided_by` pointing at the requester is the same class of impossible
    // state as an approved row with no copy_id: no command writes it, and a
    // fixture that encodes one teaches this test's next reader a shape that
    // cannot occur. Nothing in MyDashboardQuery reads the column — which is
    // the reason it went unnoticed, not a reason to leave it wrong.
    $manager = User::factory()->create(['full_name' => 'Maria Quản Lý Kho']);
    Membership::factory()->for($shelf)->create(['user_id' => $manager->id, 'role' => 'manager', 'status' => 'active']);
    $bookA = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Dế Mèn Phiêu Lưu Ký', 'slug' => 'de-men']);
    $bookB = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Hoàng Tử Bé', 'slug' => 'hoang-tu-be']);
    app(TenantContext::class)->set($shelf, $membership);
    test()->actingAs($reader);

    return [$shelf, $reader, $bookA, $bookB, $manager];
}

it('my pending request reports my derived position — others ahead counted, others behind not', function () {
    [$shelf, $reader, $bookA] = drhFix();
    app(TenantContext::class)->actSystemWide();
    foreach ([['Anna Trước Tôi', '-2 hours'], ['Giuse Sau Tôi', '+2 hours']] as [$name, $offset]) {
        $u = User::factory()->create(['full_name' => $name]);
        Membership::factory()->for($shelf)->create(['user_id' => $u->id, 'role' => 'reader', 'status' => 'active']);
        BorrowRequest::query()->create([
            'bookshelf_id' => $shelf->id, 'book_id' => $bookA->id, 'member_id' => $u->id,
            'status' => RequestStatus::Pending, 'requested_at' => now()->modify($offset),
        ]);
    }
    BorrowRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $bookA->id, 'member_id' => $reader->id,
        'status' => RequestStatus::Pending, 'requested_at' => now(),
    ]);
    app(TenantContext::class)->set($shelf->fresh(), Membership::query()->where('user_id', $reader->id)->firstOrFail());

    $dashboard = app(MyDashboardQuery::class)->run($reader);

    expect($dashboard['requests'])->toHaveCount(1)
        ->and($dashboard['requests'][0]['title'])->toBe('Dế Mèn Phiêu Lưu Ký')
        ->and($dashboard['requests'][0]['queuePosition'])->toBe(2)
        ->and($dashboard['requests'][0]['holdExpiresAt'])->toBeNull();
});

it('an approved request carries the hold expiry and no position; decided rows are absent', function () {
    [$shelf, $reader, $bookA, $bookB, $manager] = drhFix('dong-thap-drh-hold');
    app(TenantContext::class)->actSystemWide();
    // The FULL approval shape — copy_id, hold_expires_at, decided_by,
    // decided_at together, and the copy held (Global Constraints). An
    // approved request with no copy_id is a state no command produces,
    // and a fixture describing one teaches the reader of this test a
    // shape that cannot occur.
    $heldCopy = BookCopy::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $bookA->id, 'code' => 'DT-0007', 'state' => 'held',
    ]);
    BorrowRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $bookA->id, 'member_id' => $reader->id,
        'status' => RequestStatus::Approved, 'requested_at' => now()->subDay(),
        'copy_id' => $heldCopy->id,
        'hold_expires_at' => now()->addDays(2), 'decided_by' => $manager->id, 'decided_at' => now(),
    ]);
    // A decided row exists TO be excluded — the exclusion has substance.
    BorrowRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $bookB->id, 'member_id' => $reader->id,
        'status' => RequestStatus::Rejected, 'requested_at' => now()->subDays(2),
        'decided_by' => $manager->id, 'decided_at' => now(),
    ]);
    app(TenantContext::class)->set($shelf->fresh(), Membership::query()->where('user_id', $reader->id)->firstOrFail());

    $dashboard = app(MyDashboardQuery::class)->run($reader);

    expect($dashboard['requests'])->toHaveCount(1)
        ->and($dashboard['requests'][0]['status'])->toBe('approved')
        ->and($dashboard['requests'][0]['queuePosition'])->toBeNull()
        ->and($dashboard['requests'][0]['holdExpiresAt'])->not->toBeNull();
});

it('the overview page renders the requests section with a cancel per row', function () {
    [$shelf, $reader, $bookA] = drhFix('dong-thap-drh-page');
    app(TenantContext::class)->actSystemWide();
    $request = BorrowRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $bookA->id, 'member_id' => $reader->id,
        'status' => RequestStatus::Pending, 'requested_at' => now(),
    ]);

    test()->actingAs($reader)->get("/shelves/{$shelf->slug}/profile/overview")
        ->assertInertia(fn ($page) => $page
            ->where('dashboard.requests.0.requestId', $request->id)
            ->where('dashboard.requests.0.queuePosition', 1));
});
```

- [ ] **Step 2: Run to verify failure** — `make test FILTER=MyDashboardRequestsTest`. Expected: FAIL — `requests` key absent.

- [ ] **Step 3: Implement**

In `app/Queries/MyDashboardQuery.php`, after `recentlyReturned`, add (and extend the `@return` shape and the docblock — "The requests half is Phase 2's" becomes "The requests half landed in 2a"):

```php
        $mine = BorrowRequest::query()
            ->where('member_id', $reader->id)
            ->whereIn('status', [RequestStatus::Pending, RequestStatus::Approved])
            ->join('books', 'books.id', '=', 'borrow_requests.book_id')
            ->orderBy('borrow_requests.requested_at')->orderBy('borrow_requests.id')
            ->select('borrow_requests.*', 'books.title', 'books.slug')
            ->get();

        $requests = array_values($mine->map(function (BorrowRequest $r): array {
            $ahead = $r->status === RequestStatus::Pending
                ? BorrowRequest::query()
                    ->where('book_id', $r->book_id)
                    ->where('status', RequestStatus::Pending)
                    ->where(function ($q) use ($r) {
                        $q->where('requested_at', '<', $r->requested_at)
                            ->orWhere(fn ($qq) => $qq->where('requested_at', $r->requested_at)->where('id', '<', $r->id));
                    })
                    ->count()
                : null;

            return [
                'requestId' => $r->id,
                'bookId' => $r->book_id,
                'slug' => (string) $r->getAttribute('slug'),
                'title' => (string) $r->getAttribute('title'),
                'status' => $r->status->value,
                // Derived on read — the same two ordering keys as the
                // manager's queue, so the number a child sees and the row
                // a manager sees cannot disagree.
                'queuePosition' => $ahead === null ? null : $ahead + 1,
                'holdExpiresAt' => $r->hold_expires_at?->toISOString(),
            ];
        })->all());
```

and return `'requests' => $requests,` alongside the two existing keys.

In `resources/js/lib/copy.ts`: inside `circulation.myLoans`, DELETE `requestsComingSoon` and add:

```ts
        requestsEmpty: "Bạn chưa đăng ký chờ mượn cuốn nào.",
        requestPositionLine: "Bạn ở vị trí {position}",
        requestHeldLine: "Đã sẵn sàng, nhận trước {time} ngày {date}",
        requestHeldLineNoDate: "Đã sẵn sàng để nhận",
```

(`requestsSection` — "Đăng ký mượn" — already exists and stays.) In `resources/js/pages/shelves/profile/overview.tsx`, the props type gains `requests`, and the `requestsComingSoon` paragraph becomes:

```tsx
{dashboard.requests.length === 0 ? (
    <p className="mb-6 text-sm text-muted-foreground">{copy.circulation.myLoans.requestsEmpty}</p>
) : (
    <ul className="mb-6 divide-y border-y">
        {dashboard.requests.map((r) => (
            <li key={r.requestId} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                    <p className="truncate font-serif text-base">{r.title}</p>
                    <p className="text-sm text-muted-foreground">
                        {r.queuePosition !== null
                            ? t(copy.circulation.myLoans.requestPositionLine, { position: r.queuePosition })
                            : r.holdExpiresAt
                              ? t(copy.circulation.myLoans.requestHeldLine, {
                                    ...formatInstantParts(r.holdExpiresAt),
                                })
                              : copy.circulation.myLoans.requestHeldLineNoDate}
                    </p>
                </div>
                <CancelRequestButton requestId={r.requestId} />
            </li>
        ))}
    </ul>
)}
```

with a small `CancelRequestButton` component in the same file posting `shelves.profile.requests.cancel` via `useForm` (the `RenewForm` shape beside it — copy its structure exactly, including the `preserveScroll` option and the disabled-while-processing state), labelled `copy.circulation.requests.cancelButton` (add the import path used by the page — the requests copy landed in Task 12).

- [ ] **Step 4: Run, JS gates, commit**

Run: `make test FILTER=MyDashboardRequestsTest && make test FILTER=MyDashboard` (1c's suite stays green). JS gates clean.

First add the same-instant test — the tiebreak is pinned HERE, directly, not deferred to another task's transitive coverage (the first draft's version of this step offered the executor three options and no decision; this is the decision):

```php
it('two requests at the same instant are numbered by id, the mechanism named', function () {
    // requested_at ties by construction — two children queueing after the
    // same Sunday mass. UUIDv7 ids are chronologically monotonic, so the
    // row created first has the lower id and MUST be position 1: seeding
    // "out of intended order" is impossible for a same-instant pair, so
    // this block pins the MECHANISM (orderBy('id') as the tiebreak) rather
    // than an ordering the fixture could have shuffled. Global
    // Constraints' UUIDv7 rule allows exactly this, with this comment.
    [$shelf, $reader, $bookA] = drhFix('dong-thap-drh-tie');
    app(TenantContext::class)->actSystemWide();
    $instant = now();
    $ahead = User::factory()->create(['full_name' => 'Anna Cùng Lúc']);
    Membership::factory()->for($shelf)->create(['user_id' => $ahead->id, 'role' => 'reader', 'status' => 'active']);
    $first = BorrowRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $bookA->id, 'member_id' => $ahead->id,
        'status' => RequestStatus::Pending, 'requested_at' => $instant,
    ]);
    $second = BorrowRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $bookA->id, 'member_id' => $reader->id,
        'status' => RequestStatus::Pending, 'requested_at' => $instant,
    ]);
    app(TenantContext::class)->set($shelf->fresh(), Membership::query()->where('user_id', $reader->id)->firstOrFail());

    // The premise the assertion rests on, asserted rather than assumed:
    // v7 monotonicity is what makes "created first" and "lower id" the
    // same statement.
    expect($first->id < $second->id)->toBeTrue();

    $dashboard = app(MyDashboardQuery::class)->run($reader);

    expect($dashboard['requests'][0]['queuePosition'])->toBe(2);
});
```

Mutation check for it: delete the `->orWhere(fn ($qq) => $qq->where('requested_at', $r->requested_at)->where('id', '<', $r->id))` branch from the ahead-count → this test goes red (position collapses to 1 for both rows). Restore. Task 11's queue test pins the same tiebreak on the manager's side; the two must not disagree, which is why both are pinned rather than one leaning on the other.

```bash
make lint && make analyse
git add app/Queries/MyDashboardQuery.php resources/js/ tests/Feature/Circulation/MyDashboardRequestsTest.php
git commit -m "feat: the reader dashboard's requests half — position derived, hold expiry shown, cancel wired"
```

---

### Task 14: The manager's queue screen — `/manage/borrow-requests`, approve / reject / handover

Read first: `old_next/src/app/tu-sach/[shelf]/quan-ly/yeu-cau-muon/page.tsx` (WHOLE file — the per-row rules: approve on the first pending row only, reject on every pending row, the one solid button on the approved row, the lapsed-hold note, and the Bỏ-qua-is-gone comment block), `old_next/tests/lib/borrow-request-actions.test.ts`, and **ruling 2** — the reject reason is optional, settled, no delta to carry.

**Note on the release button:** ruling 1 ships `ReleaseExpiredHold`, and Task 18 adds a fourth POST route and a *Trả về kệ* button to the page this task creates. Build the page here without it; Task 18's edit is additive and its own commit. The architecture presence-pin below therefore lists three route names now and gains the fourth in Task 18.

**Files:**
- Create: `app/Http/Controllers/Manage/BorrowRequestController.php`
- Create: `app/Http/Requests/Circulation/ApproveBorrowRequestRequest.php`
- Create: `app/Http/Requests/Circulation/RejectBorrowRequestRequest.php`
- Create: `resources/js/pages/manage/borrow-requests.tsx`
- Modify: `routes/web.php` (the under-construction GET becomes real; three POSTs)
- Modify: `resources/js/layouts/manage-layout.tsx` (+ Yêu cầu mượn nav item, between returns and readers)
- Modify: `resources/js/pages/manage/dashboard.tsx` (+ the third stat card) and its props type
- Modify: `resources/js/lib/copy.ts` (+ `manageRequests` section; `manage.requests` nav label; `manageDashboard.requestsCard`)
- Modify: `tests/Feature/Architecture/CirculationArchitectureTest.php` (`'borrow-requests/{'` and `'handover'` leave the forbidden list; presence pins added)
- Test: `tests/Feature/Circulation/ManagerQueueScreenTest.php`

**Interfaces:**
- Routes (manage group, replacing the under-construction line, adjacent to `/overdue`):
  - `GET /manage/borrow-requests` → `index` — name `shelves.manage.borrow-requests` (name unchanged from the placeholder — nav links keep working).
  - `POST /manage/borrow-requests/{borrowRequest}/approve` → `approve` — `shelves.manage.borrow-requests.approve`.
  - `POST /manage/borrow-requests/{borrowRequest}/reject` → `reject` — `shelves.manage.borrow-requests.reject`.
  - `POST /manage/borrow-requests/{borrowRequest}/handover` → `handover` — `shelves.manage.borrow-requests.handover`.
- `ApproveBorrowRequestRequest`: `copy_id => ['bail', 'required', 'string', 'uuid']` (an empty select posts `''` → a field error before the Action — "approving with no free copy is a sentence, not a failed uuid cast", the reference's named test). `RejectBorrowRequestRequest`: `reason => ['bail', 'nullable', 'string', 'max:500', 'encoding:UTF-8']` — `nullable`, settled by ruling 2, with no conditional branch. Both `authorize()`: `abort_unless(Gate::allows('act-as-manager'), 404)`.

- [ ] **Step 1: Write the failing tests**

Create `tests/Feature/Circulation/ManagerQueueScreenTest.php`:

```php
<?php

use App\Enums\CopyState;
use App\Enums\RequestStatus;
use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\BorrowRequest;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Inertia\Testing\AssertableInertia;

/**
 * Shelf + manager (acting over HTTP) + book with one free copy + one
 * pending request. @return array{Bookshelf, User, Book, BookCopy, BorrowRequest}
 */
function mqsFix(string $slug = 'dong-thap-mqs'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);
    $manager = User::factory()->create(['full_name' => 'Maria Quản Lý Kho']);
    Membership::factory()->for($shelf)->create(['user_id' => $manager->id, 'role' => 'manager', 'status' => 'active']);
    $reader = User::factory()->create(['full_name' => 'Têrêsa Bạn Đọc Nhỏ']);
    Membership::factory()->for($shelf)->create(['user_id' => $reader->id, 'role' => 'reader', 'status' => 'active']);
    $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Dế Mèn Phiêu Lưu Ký', 'slug' => 'de-men']);
    $copy = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0001', 'state' => 'available']);
    $request = BorrowRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'member_id' => $reader->id,
        'status' => RequestStatus::Pending, 'requested_at' => now(),
    ]);

    return [$shelf, $manager, $book, $copy, $request];
}

it('GET /manage/borrow-requests renders the queues with free copies', function () {
    [$shelf, $manager] = mqsFix();

    test()->actingAs($manager)->get("/shelves/{$shelf->slug}/manage/borrow-requests")
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('manage/borrow-requests')
            ->where('queues.0.title', 'Dế Mèn Phiêu Lưu Ký')
            ->where('queues.0.waiting', 1)
            ->where('queues.0.freeCopies.0.code', 'DT-0001'));
});

it('POST approve puts the chosen copy aside and lands back on the queue', function () {
    [$shelf, $manager, , $copy, $request] = mqsFix('dong-thap-mqs-approve');

    $response = test()->actingAs($manager)->post(
        "/shelves/{$shelf->slug}/manage/borrow-requests/{$request->id}/approve",
        ['copy_id' => $copy->id],
    );

    $response->assertRedirect()->assertSessionHas('success');
    expect($request->fresh()->status)->toBe(RequestStatus::Approved)
        ->and($copy->fresh()->state)->toBe(CopyState::Held);
});

it('approving with no free copy is a field error, not a failed uuid cast', function () {
    [$shelf, $manager, , , $request] = mqsFix('dong-thap-mqs-nocopy');

    $response = test()->actingAs($manager)->post(
        "/shelves/{$shelf->slug}/manage/borrow-requests/{$request->id}/approve",
        ['copy_id' => ''],
    );

    $response->assertSessionHasErrors(['copy_id']);
    expect($request->fresh()->status)->toBe(RequestStatus::Pending);
});

it('POST reject with an empty reason box is accepted and stores no reason', function () {
    // Ruling 2: the reason is optional, settled. An empty box is NO
    // reason — decision_note NULL — not a reason that says nothing.
    [$shelf, $manager, , , $request] = mqsFix('dong-thap-mqs-reject');

    $response = test()->actingAs($manager)->post(
        "/shelves/{$shelf->slug}/manage/borrow-requests/{$request->id}/reject",
        ['reason' => ''],
    );

    $response->assertRedirect()->assertSessionHas('success');
    expect($request->fresh()->status)->toBe(RequestStatus::Rejected)
        ->and($request->fresh()->decision_note)->toBeNull();
});

it('POST handover posts one id, and the book goes out', function () {
    [$shelf, $manager, , $copy, $request] = mqsFix('dong-thap-mqs-handover');
    // Promote to a live hold first (the full approval shape).
    BookCopy::query()->whereKey($copy->id)->update(['state' => 'held']);
    BorrowRequest::query()->whereKey($request->id)->update([
        'status' => RequestStatus::Approved, 'copy_id' => $copy->id,
        'hold_expires_at' => now()->addDays(2), 'decided_by' => $manager->id, 'decided_at' => now(),
    ]);

    $response = test()->actingAs($manager)->post(
        "/shelves/{$shelf->slug}/manage/borrow-requests/{$request->id}/handover",
    );

    $response->assertRedirect()->assertSessionHas('success');
    expect($request->fresh()->status)->toBe(RequestStatus::Fulfilled)
        ->and($copy->fresh()->state)->toBe(CopyState::OnLoan)
        ->and(Loan::query()->count())->toBe(1);
});

it('a lapsed hold\'s handover comes back as the hold_expired sentence', function () {
    [$shelf, $manager, , $copy, $request] = mqsFix('dong-thap-mqs-lapsed');
    BookCopy::query()->whereKey($copy->id)->update(['state' => 'held']);
    BorrowRequest::query()->whereKey($request->id)->update([
        'status' => RequestStatus::Approved, 'copy_id' => $copy->id,
        'hold_expires_at' => now()->subHour(), 'decided_by' => $manager->id, 'decided_at' => now()->subDays(3),
    ]);

    $response = test()->actingAs($manager)->post(
        "/shelves/{$shelf->slug}/manage/borrow-requests/{$request->id}/handover",
    );

    $response->assertSessionHasErrors(['rule']);
    expect(session('errors')->first('rule'))->toBe(__('rules.hold_expired'));
});

it('a reader 404s on the queue screen and on every POST', function () {
    // All four surfaces, in one it() because the actor never changes —
    // one actingAs, four requests, which SessionGuard is perfectly happy
    // with. The name says "every POST", so every POST is here; the first
    // draft asserted only the GET.
    [$shelf, , , $copy, $request] = mqsFix('dong-thap-mqs-reader');
    $reader = User::query()->where('full_name', 'Têrêsa Bạn Đọc Nhỏ')->firstOrFail();
    $base = "/shelves/{$shelf->slug}/manage/borrow-requests";

    test()->actingAs($reader)->get($base)->assertNotFound();
    // 404, never 403 — spec §5.4: a reader must not learn the request
    // exists. The Form Requests' authorize() aborts before validation, so
    // a well-formed body is answered the same way as an empty one.
    test()->actingAs($reader)->post("{$base}/{$request->id}/approve", ['copy_id' => $copy->id])->assertNotFound();
    test()->actingAs($reader)->post("{$base}/{$request->id}/reject", ['reason' => 'thử'])->assertNotFound();
    test()->actingAs($reader)->post("{$base}/{$request->id}/handover")->assertNotFound();

    // And nothing happened on the way past.
    expect($request->fresh()->status)->toBe(RequestStatus::Pending)
        ->and($copy->fresh()->state)->toBe(CopyState::Available)
        ->and(Loan::query()->count())->toBe(0);
});

it('the dashboard shows the third card, counting this queue', function () {
    [$shelf, $manager] = mqsFix('dong-thap-mqs-card');

    test()->actingAs($manager)->get("/shelves/{$shelf->slug}/manage")
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->where('dashboard.counts.pendingRequests', 1));
});
```

- [ ] **Step 2: Run to verify failure** — `make test FILTER=ManagerQueueScreenTest`. Expected: FAIL — the GET renders `under-construction`.

- [ ] **Step 3: Routes, Form Requests, controller**

In `routes/web.php`, replace the under-construction line with:

```php
        Route::get('/borrow-requests', [ManageBorrowRequestController::class, 'index'])->name('borrow-requests');
        Route::post('/borrow-requests/{borrowRequest}/approve', [ManageBorrowRequestController::class, 'approve'])->name('borrow-requests.approve');
        Route::post('/borrow-requests/{borrowRequest}/reject', [ManageBorrowRequestController::class, 'reject'])->name('borrow-requests.reject');
        Route::post('/borrow-requests/{borrowRequest}/handover', [ManageBorrowRequestController::class, 'handover'])->name('borrow-requests.handover');
```

(import `App\Http\Controllers\Manage\BorrowRequestController as ManageBorrowRequestController`).

Create `app/Http/Requests/Circulation/ApproveBorrowRequestRequest.php`:

```php
<?php

namespace App\Http\Requests\Circulation;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

class ApproveBorrowRequestRequest extends FormRequest
{
    public function authorize(): bool
    {
        // 404, never 403 — spec §5.4, the PR #61 shape.
        abort_unless(Gate::allows('act-as-manager'), 404);

        return true;
    }

    /** @return array<string, list<mixed>> */
    public function rules(): array
    {
        return [
            // uuid: the empty-select post ('') and a stray emoji are field
            // errors here, never an errno 1267 downstairs (the SafeId
            // lesson) — "a sentence, not a failed uuid cast".
            'copy_id' => ['bail', 'required', 'string', 'uuid'],
        ];
    }
}
```

Create `app/Http/Requests/Circulation/RejectBorrowRequestRequest.php`:

```php
<?php

namespace App\Http\Requests\Circulation;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

class RejectBorrowRequestRequest extends FormRequest
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
            // Optional, per product-owner ruling 2 (settled 2026-08-29):
            // OPS §4.2 lists no reason_required for this command, unlike
            // the registration and profile-change rejections, and the
            // reference ships optional with a named test. bail first and
            // encoding:UTF-8 because this is free text
            // (FreeTextEncodingGuardTest sweeps for exactly that).
            'reason' => ['bail', 'nullable', 'string', 'max:500', 'encoding:UTF-8'],
        ];
    }
}
```

Create `app/Http/Controllers/Manage/BorrowRequestController.php`:

```php
<?php

namespace App\Http\Controllers\Manage;

use App\Actions\Circulation\ApproveBorrowRequest;
use App\Actions\Circulation\HandoverRequest;
use App\Actions\Circulation\RejectBorrowRequest;
use App\Http\Controllers\Controller;
use App\Http\Requests\Circulation\ApproveBorrowRequestRequest;
use App\Http\Requests\Circulation\RejectBorrowRequestRequest;
use App\Models\Bookshelf;
use App\Models\BorrowRequest;
use App\Models\User;
use App\Queries\BorrowRequestQueueQuery;
use Carbon\Carbon;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * BR §16.3's borrow-request queue. Every row here was queued by
 * somebody; nothing on this page happens by itself ("the manager
 * decides, because the next reader may not be standing there").
 * Bỏ qua is deliberately absent — the product owner removed SkipRequest
 * from the reference (2026-08-09); Từ chối is the only decision a
 * manager makes about a pending row.
 */
class BorrowRequestController extends Controller
{
    public function index(Bookshelf $shelf, BorrowRequestQueueQuery $queue): Response
    {
        return Inertia::render('manage/borrow-requests', [
            'queues' => $queue->run(),
        ]);
    }

    public function approve(ApproveBorrowRequestRequest $request, Bookshelf $shelf, BorrowRequest $borrowRequest, ApproveBorrowRequest $approve): RedirectResponse
    {
        /** @var User $user */
        $user = $request->user();
        /** @var string $copyId */
        $copyId = $request->validated()['copy_id'];

        $result = $approve->execute($user, $borrowRequest, $copyId);

        return redirect()
            ->route('shelves.manage.borrow-requests', ['shelf' => $shelf->slug])
            ->with('success', __('rules.approve_success_flash', [
                // d/m/Y, the flash-date house rule (1c's renew precedent).
                'until' => $result['holdExpiresAt']->timezone('Asia/Ho_Chi_Minh')->format('d/m/Y'),
            ]));
    }

    public function reject(RejectBorrowRequestRequest $request, Bookshelf $shelf, BorrowRequest $borrowRequest, RejectBorrowRequest $reject): RedirectResponse
    {
        /** @var User $user */
        $user = $request->user();

        $reject->execute($user, $borrowRequest, $request->validated()['reason'] ?? null);

        return redirect()
            ->route('shelves.manage.borrow-requests', ['shelf' => $shelf->slug])
            ->with('success', __('rules.reject_request_flash'));
    }

    public function handover(Request $request, Bookshelf $shelf, BorrowRequest $borrowRequest, HandoverRequest $handover): RedirectResponse
    {
        /** @var User $user */
        $user = $request->user();

        $result = $handover->execute($user, $borrowRequest);

        return redirect()
            ->route('shelves.manage.borrow-requests', ['shelf' => $shelf->slug])
            ->with('success', __('rules.lend_success_flash_short', ['due' => Carbon::parse($result['dueOn'])->format('d/m/Y')]));
    }
}
```

(`lend_success_flash_short` already exists: Task 1 mints it in the flash block it owns, with the reason — 1c's `lend_success_flash` takes `:name`/`:title` this flow does not have at hand. Nothing is retroactively edited into an earlier task's committed block.)

- [ ] **Step 4: The page, the nav, the card**

`resources/js/lib/copy.ts` additions:

```ts
    // in manage:
        requests: "Yêu cầu mượn",
    // in manageDashboard:
        requestsCard: "Yêu cầu chờ xử lý",
    // new top-level section:
    manageRequests: {
        title: "Yêu cầu mượn",
        subtitle: "Xếp theo thứ tự đăng ký.",
        subtitleCounted: "{count} cuốn có người đang chờ · Xếp theo thứ tự đăng ký.",
        empty: "Hiện không có bạn đọc nào đang chờ mượn sách.",
        waitingCount: "{count} người đang chờ",
        requestedLine: "Đăng ký {time} ngày {date}",
        holdNote: "Đang giữ chỗ cho bạn này · hết hạn giữ {time} ngày {date}",
        holdNoteBare: "Đang giữ chỗ cho bạn này",
        holdExpiredNote: "Thời gian giữ chỗ đã hết lúc {time} ngày {date}",
        holdExpiredBare: "Thời gian giữ chỗ đã hết",
        copySuffix: "bản {code}",
        firstPendingNote: "Giữ chỗ {days} ngày kể từ khi duyệt.",
        notYourTurnNote: "Chỉ duyệt được khi tới lượt.",
        approveButton: "Duyệt & giữ chỗ",
        copyLabel: "Bản sách",
        noFreeCopies: "Chưa có bản nào rảnh để giữ chỗ.",
        rejectSummary: "Từ chối",
        rejectReasonLabel: "Lý do từ chối",
        rejectReasonHint: "Không bắt buộc.",
        rejectConfirm: "Xác nhận từ chối",
        handoverButton: "Xác nhận trao sách",
        nothingAutomatic: "Hệ thống không tự động giữ chỗ. Quản lý quyết định từng trường hợp.",
    },
```

(`rejectReasonHint` is `"Không bắt buộc."` — ruling 2, no alternative.)

Create `resources/js/pages/manage/borrow-requests.tsx` — the reference page's structure in the house's spare idiom. Per book: a card with title (serif), author, "{n} người đang chờ"; rows in order; per row: position number, name, `requestedLine` (+ parish line when non-empty, ` · ` separated); THEN by status:

- `approved` row: the hold note (`holdNote`/`holdExpiredNote` chosen by `holdExpired`, formatted from `holdExpiresAt` via `formatInstantParts`; append ` · bản {copyCode}` when present) and the ONE solid button on the page — `handoverButton`, posting `borrow-requests.handover`. A lapsed hold KEEPS its button (the command's refusal names the remedy; a missing button names nothing).
- first PENDING row (`requests.findIndex(r => r.status === "pending") === index`): `firstPendingNote` with `holdDays`, plus the approve form — a `<select name="copy_id">` over `freeCopies` when `length > 1`, a hidden value when `length === 1`, a disabled button and empty value when `0` (the refusal arrives before the confirm step) — `variant="outline"` (the solid button on this page is the handover); plus the reject disclosure.
- other pending rows: `notYourTurnNote` + the reject disclosure only.

Reject disclosure: a `<details>` with `rejectSummary`, a labelled input for `reason` (hint `rejectReasonHint`), posting `borrow-requests.reject` via `useForm<{ reason: string }>`. Below all cards, when any waiting: the `nothingAutomatic` line; `noFreeCopies` under a card with an empty `freeCopies`. Empty state: `manageRequests.empty`. Flash + `errors.rule` banners in the house pattern (copy `manage/overdue.tsx`'s). All copy through `copy.ts` (Biome `noJsxLiterals`); dates via `formatInstantParts`; the page uses `ManageLayout`. Type the props to `BorrowRequestQueueQuery`'s documented shape.

`resources/js/layouts/manage-layout.tsx`: after the returns item, add

```ts
        {
            name: copy.manage.requests,
            href: route("shelves.manage.borrow-requests", { shelf: shelf.slug }),
        },
```

`resources/js/pages/manage/dashboard.tsx`: the counts type gains `pendingRequests: number`, and a third card beside the two (whole-card link, the shipped Card component):

```tsx
<StatCard
    href={route("shelves.manage.borrow-requests", { shelf: shelf.slug })}
    label={copy.manageDashboard.requestsCard}
    value={dashboard.counts.pendingRequests}
/>
```

(Use the page's actual card component name — read the file; the 1d comment "the other two arrive with…" is updated to name only pending comments/2b.)

- [ ] **Step 5: Flip the remaining architecture pins**

`CirculationArchitectureTest`: the forbidden loop drops `'borrow-requests/{'` and `'handover'` (now empty, delete the loop and its test); add:

```php
it('the borrow-request manager routes exist, manager-gated — 2a\'s decision, no longer an absence', function () {
    $routes = collect(Route::getRoutes()->getRoutes());
    foreach ([
        'shelves.manage.borrow-requests.approve',
        'shelves.manage.borrow-requests.reject',
        'shelves.manage.borrow-requests.handover',
    ] as $name) {
        $route = $routes->first(fn ($r) => $r->getName() === $name);
        expect($route)->not->toBeNull($name)
            ->and($route->gatherMiddleware())->toContain('role:manager');
    }
});
```

- [ ] **Step 6: Run everything, JS gates, mutation-check, commit**

Run: `make test FILTER=ManagerQueueScreenTest && make test FILTER=CirculationArchitectureTest && make test FILTER=FreeTextEncodingGuardTest` (the new `reason` field passes the sweep) — PASS. JS gates clean.

Mutation check: point the dashboard card's `value` at `counts.overdue` → the dashboard test here stays green (it asserts the prop, not the pixel) — this is the known frontend blind spot recorded in HANDOFF ("no page can catch a mis-wired label/value pair"); note it in the commit body rather than pretending a test covers it.

```bash
make lint && make analyse
git add routes/web.php app/Http/ resources/js/ lang/vi/rules.php tests/
git commit -m "feat: the borrow-request queue screen — approve when it is their turn, one solid handover"
```

---

### Task 15: The return screen's queued-reader panel — "N bạn đọc đang chờ cuốn này"

Read first: `old_next/src/app/tu-sach/[shelf]/quan-ly/nhan-tra/page.tsx:100-395` (the `waiting` derivation — pending only — and the radio fieldset), `receiveReturnAction`'s docblock in `old_next/src/app/tu-sach/[shelf]/quan-ly/actions.ts:312-345`, the shipped `ReturnController` and `resources/js/pages/manage/returns/index.tsx`.

**Files:**
- Modify: `app/Http/Controllers/Manage/ReturnController.php` (`index` gains the waiting list for the chosen loan; `store` passes the hold through and flashes the hold variant)
- Modify: `app/Http/Requests/Circulation/ReceiveReturnRequest.php` (+ `hold_for_request_id`)
- Modify: `resources/js/pages/manage/returns/index.tsx` (the radio fieldset)
- Modify: `resources/js/lib/copy.ts` (+ `circulation.returns.waiting*` lines)
- Test: `tests/Feature/Circulation/ReturnHoldOfferTest.php`

**Interfaces:**
- `index` prop added: `waiting: list<array{requestId: string, readerName: string, requestedAt: string}> | null` — null when no loan chosen; else the chosen loan's title's PENDING requests in queue order (`BorrowRequestQueueQuery::run($bookId)`, first queue's requests filtered to `status === 'pending'` — the same query the queue screen reads, so the two screens cannot show two answers; approved rows are NOT offered: their copy exists already).
- `ReceiveReturnRequest` gains `'hold_for_request_id' => ['bail', 'nullable', 'string', 'uuid']` **plus a `prepareForValidation()`**, and the pair is required, not belt-and-braces: the radio's "no hold" option posts `""`, and `nullable` does not treat an empty string as absent for a `uuid` rule — it would be a validation error on the ordinary path. `prepareForValidation()` merges `''` to `null` first, so an empty string becomes the absence it means ("the absence of a choice to hold, not a request id of zero length"), and the test "the empty radio value means no hold" is what keeps that true.

- [ ] **Step 1: Write the failing tests**

Create `tests/Feature/Circulation/ReturnHoldOfferTest.php`:

```php
<?php

use App\Enums\CopyState;
use App\Enums\RequestStatus;
use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\BorrowRequest;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Inertia\Testing\AssertableInertia;

/**
 * Shelf + manager + an active loan + one PENDING request for its title +
 * a second reader whose request for the same title is already APPROVED
 * on a second copy. The approved row is not decoration: the waiting panel
 * offers pending rows only, and a fixture with nothing to exclude cannot
 * prove exclusion (Global Constraints' Pest rule). It is also what makes
 * this task's mutation check able to fire.
 *
 * @return array{Bookshelf, User, Loan, BorrowRequest, BorrowRequest}
 */
function rhoFix(string $slug = 'dong-thap-rho'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);
    $manager = User::factory()->create(['full_name' => 'Maria Quản Lý Kho']);
    Membership::factory()->for($shelf)->create(['user_id' => $manager->id, 'role' => 'manager', 'status' => 'active']);
    $borrower = User::factory()->create(['full_name' => 'Giuse Người Đang Mượn']);
    Membership::factory()->for($shelf)->create(['user_id' => $borrower->id, 'role' => 'reader', 'status' => 'active']);
    $waiter = User::factory()->create(['full_name' => 'Têrêsa Người Đang Chờ']);
    Membership::factory()->for($shelf)->create(['user_id' => $waiter->id, 'role' => 'reader', 'status' => 'active']);
    $holder = User::factory()->create(['full_name' => 'Anna Đã Được Giữ Chỗ']);
    Membership::factory()->for($shelf)->create(['user_id' => $holder->id, 'role' => 'reader', 'status' => 'active']);
    $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Dế Mèn Phiêu Lưu Ký', 'slug' => 'de-men']);
    $copy = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0001', 'state' => 'on_loan']);
    // The approved row's own copy — an approved request always names one
    // and its copy is held, or the fixture describes a state no command
    // produces (Global Constraints).
    $heldCopy = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0002', 'state' => 'held']);
    $loan = Loan::query()->create([
        'bookshelf_id' => $shelf->id, 'copy_id' => $copy->id, 'book_id' => $book->id,
        'borrower_id' => $borrower->id, 'lent_by' => $manager->id,
        'due_on' => '2026-09-11', 'status' => 'active',
    ]);
    $request = BorrowRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'member_id' => $waiter->id,
        'status' => RequestStatus::Pending, 'requested_at' => now(),
    ]);
    // A DIFFERENT reader: borrow_requests_one_live_per_title_member
    // (Task 1) allows one live row per title per reader.
    $approved = BorrowRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'member_id' => $holder->id,
        'status' => RequestStatus::Approved, 'requested_at' => now()->subHour(),
        'copy_id' => $heldCopy->id, 'hold_expires_at' => now()->addDays(2),
        'decided_by' => $manager->id, 'decided_at' => now()->subHour(),
    ]);

    return [$shelf, $manager, $loan, $request, $approved];
}

it('the chosen loan surfaces who is waiting, pending only, before confirmation', function () {
    [$shelf, $manager, $loan, $request, $approved] = rhoFix();

    test()->actingAs($manager)
        ->get("/shelves/{$shelf->slug}/manage/returns?loan={$loan->id}")
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->where('waiting.0.requestId', $request->id)
            ->where('waiting.0.readerName', 'Têrêsa Người Đang Chờ')
            // PENDING ONLY, and the approved row exists to prove it: Anna
            // already has DT-0002 put aside for her, so offering this
            // returned copy to her would put two copies under one request.
            // One entry, and it is not hers.
            ->count('waiting', 1));
    expect($approved->fresh()->status)->toBe(RequestStatus::Approved);
});

it('with nobody waiting the panel data is empty, and no loan chosen means null', function () {
    [$shelf, $manager, $loan, $request] = rhoFix('dong-thap-rho-empty');
    BorrowRequest::query()->whereKey($request->id)->update(['status' => RequestStatus::Cancelled, 'cancelled_at' => now()]);

    test()->actingAs($manager)
        ->get("/shelves/{$shelf->slug}/manage/returns?loan={$loan->id}")
        ->assertInertia(fn (AssertableInertia $page) => $page->where('waiting', []));

    test()->actingAs($manager)
        ->get("/shelves/{$shelf->slug}/manage/returns")
        ->assertInertia(fn (AssertableInertia $page) => $page->where('waiting', null));
});

it('the POST with a chosen reader holds the copy and flashes the hold sentence', function () {
    [$shelf, $manager, $loan, $request] = rhoFix('dong-thap-rho-hold');

    $response = test()->actingAs($manager)->post(
        "/shelves/{$shelf->slug}/manage/returns/{$loan->id}",
        ['condition' => 'perfect', 'hold_for_request_id' => $request->id],
    );

    $response->assertRedirect()->assertSessionHas('success', fn ($msg) => str_contains($msg, 'giữ chỗ'));
    expect($request->fresh()->status)->toBe(RequestStatus::Approved)
        ->and(BookCopy::query()->findOrFail($loan->copy_id)->state)->toBe(CopyState::Held);
});

it('the empty radio value means no hold, and the copy goes back on the shelf', function () {
    [$shelf, $manager, $loan, $request] = rhoFix('dong-thap-rho-none');

    $response = test()->actingAs($manager)->post(
        "/shelves/{$shelf->slug}/manage/returns/{$loan->id}",
        ['condition' => 'perfect', 'hold_for_request_id' => ''],
    );

    $response->assertRedirect()->assertSessionHas('success');
    expect($request->fresh()->status)->toBe(RequestStatus::Pending)
        ->and(BookCopy::query()->findOrFail($loan->copy_id)->state)->toBe(CopyState::Available);
});

it('a stale request id comes back as the request_not_queued sentence, return not applied', function () {
    [$shelf, $manager, $loan, $request] = rhoFix('dong-thap-rho-stale');
    BorrowRequest::query()->whereKey($request->id)->update(['status' => RequestStatus::Cancelled, 'cancelled_at' => now()]);

    $response = test()->actingAs($manager)->post(
        "/shelves/{$shelf->slug}/manage/returns/{$loan->id}",
        ['condition' => 'perfect', 'hold_for_request_id' => $request->id],
    );

    $response->assertSessionHasErrors(['rule']);
    expect(session('errors')->first('rule'))->toBe(__('rules.request_not_queued'))
        ->and($loan->fresh()->status->value)->toBe('active');
});
```

- [ ] **Step 2: Run to verify failure** — `make test FILTER=ReturnHoldOfferTest`. Expected: FAIL — no `waiting` prop; unknown field.

- [ ] **Step 3: Implement**

`ReceiveReturnRequest` gains:

```php
    protected function prepareForValidation(): void
    {
        // "Không giữ chỗ, trả về kệ" posts the empty string — the absence
        // of a choice to hold, not a request id of zero length.
        if ($this->input('hold_for_request_id') === '') {
            $this->merge(['hold_for_request_id' => null]);
        }
    }
```

and the rule `'hold_for_request_id' => ['bail', 'nullable', 'string', 'uuid'],`.

`ReturnController::index`: after resolving `$chosen` (the shipped `chosenLoanId` logic keeps working — extend it to keep the matched row, not only the id), add:

```php
        $chosenRow = collect($rows)->firstWhere('loanId', $chosen);
        $waiting = null;
        if ($chosenRow !== null) {
            // The SAME query the queue screen reads, narrowed to this
            // title (OPS §5 step 3) — the two screens must not show two
            // answers. Pending only: an approved row already has its copy.
            $queues = $queue->run($chosenRow['bookId']);
            $waiting = array_values(array_map(
                fn (array $r) => [
                    'requestId' => $r['requestId'],
                    'readerName' => $r['readerName'],
                    'requestedAt' => $r['requestedAt'],
                ],
                array_filter($queues[0]['requests'] ?? [], fn (array $r) => $r['status'] === 'pending'),
            ));
        }
```

(inject `BorrowRequestQueueQuery $queue`; `SearchLoansForReturnQuery`'s rows must carry `bookId` — read it; 1c's rows carry `copyId`/`title` etc., add `bookId` to its select/shape if absent, a two-line additive change with its existing test extended by one `->and(...)` assertion). Pass `'waiting' => $waiting` to the render. `store` becomes:

```php
        $result = $receiveReturn->execute(
            $user,
            $loan,
            CopyCondition::from($validated['condition']),
            $validated['note'] ?? null,
            null,
            $validated['hold_for_request_id'] ?? null,
        );

        $held = ($validated['hold_for_request_id'] ?? null) !== null;

        return redirect()
            ->route('shelves.manage.returns', ['shelf' => $shelf->slug])
            ->with('success', __($held ? 'rules.return_hold_success_flash' : 'rules.return_success_flash', [
                'code' => $copy === null ? '' : $copy->code,
            ]));
```

`copy.ts` `circulation.returns` gains:

```ts
        waitingLegend: "{count} bạn đọc đang chờ cuốn này",
        noHoldOption: "Không giữ chỗ, trả về kệ",
        holdForOption: "Giữ chỗ cho {name}",
        holdForRequestedSuffix: "đăng ký {time} ngày {date}",
        nothingAutomatic: "Hệ thống không tự động giữ chỗ. Quản lý quyết định từng trường hợp.",
```

`returns/index.tsx`: the confirm form's `useForm` data gains `hold_for_request_id: ""`; between the condition picker and the submit, when `waiting !== null && waiting.length > 0`, render a bordered fieldset: legend `waitingLegend`; first radio value `""` `defaultChecked` labelled `noHoldOption` (not holding is the default — OPS §5); one radio per waiter labelled `holdForOption` + the requested suffix via `formatInstantParts`; the `nothingAutomatic` line beneath. Radios set `form.setData("hold_for_request_id", value)`.

- [ ] **Step 4: Run, JS gates, mutation-check, commit**

Run: `make test FILTER=ReturnHoldOfferTest && make test FILTER=ReceiveReturn && make test FILTER=SearchLoansForReturn` — PASS. JS gates clean.

Mutation check: drop the `$r['status'] === 'pending'` filter from `$waiting` → "the chosen loan surfaces who is waiting, pending only…" goes red on its `count('waiting', 1)` assertion (Anna's approved row appears as a second offer). Restore. The fixture already contains the row to be excluded — `rhoFix` seeds it, with its own held copy — so this mutation fires as written; the earlier draft told the executor to go and build that fixture mid-check, which is a fixture the plan should simply contain.

```bash
make lint && make analyse
git add app/Http/ resources/js/ tests/
git commit -m "feat: the return screen offers the queue — pending readers, not holding by default"
```

---

### Task 16: The reader's notifications — the query, mark-read, the page, the bell

Read first: `old_next/src/domain/notifications/queries/get-my-notifications.ts` and `commands/mark-notification-read.ts` (whole files — the no-audit argument and the `.allowZero()` semantics), `old_next/tests/domain/notifications/notifications.test.ts` tests 4–8, `old_next/src/app/tu-sach/[shelf]/(doc-gia)/ho-so/thong-bao/page.tsx`.

**Files:**
- Create: `app/Queries/MyNotificationsQuery.php`
- Create: `app/Actions/Notifications/MarkNotificationRead.php` (both marks in one class — two methods, one argument set; the reference ships them as two commands in one file)
- Create: `app/Http/Controllers/Reader/NotificationController.php`
- Create: `resources/js/pages/shelves/profile/notifications.tsx`
- Modify: `routes/web.php` (the under-construction notifications GET becomes real; two POSTs)
- Modify: `app/Http/Middleware/HandleInertiaRequests.php` (+ lazy `unreadNotifications`)
- Modify: `resources/js/layouts/app-layout.tsx` (+ the bell link), `resources/js/types/index.d.ts` (SharedData)
- Modify: `resources/js/lib/copy.ts` (+ `notifications` section)
- Test: `tests/Feature/Notifications/MyNotificationsTest.php`

**Interfaces:**
- `MyNotificationsQuery::run(User $reader, int $limit = 30): array{rows: list<array{id: string, kind: string, sentence: string, createdAt: string, readAt: ?string}>, unread: int}` — own rows only (`user_id = $reader->id` — the session scopes the person, `BookshelfScope` the shelf), `created_at desc, id desc` (the sweep writes many rows in one instant — the tie is by construction; the id tiebreak is the mechanism, pinned with a comment), limit clamped 1..100; `sentence` from `NotificationSentences` — never the raw kind.
- `MarkNotificationRead::one(User $reader, string $notificationId): void` and `::all(User $reader): int` — keyed on `user_id = $reader->id` so somebody else's id updates zero rows silently (a double-tap and a foreign id are both ordinary no-ops, not errors); **no audit row, deliberately** — the reference's three-part argument restated in the docblock, and a named test pins the absence.
- Routes: `GET /profile/notifications` (name exists — `shelves.profile.notifications`), `POST /profile/notifications/read-all` → `shelves.profile.notifications.read-all` (declared BEFORE the bound route), `POST /profile/notifications/{notification}/read` → `shelves.profile.notifications.read`.
- Shared prop `unreadNotifications: ?int` — a closure (lazy), non-null only when a user is signed in AND a shelf is bound; the bell renders in `app-layout` as a link "Thông báo (n)" to the notifications page, count omitted at zero.

- [ ] **Step 1: Write the failing tests**

Create `tests/Feature/Notifications/MyNotificationsTest.php`:

```php
<?php

use App\Actions\Notifications\MarkNotificationRead;
use App\Models\AuditLog;
use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\Notification;
use App\Models\User;
use App\Queries\MyNotificationsQuery;
use App\Support\TenantContext;
use Inertia\Testing\AssertableInertia;

/**
 * Shelf + reader with $count notifications (alternating kinds), written
 * OLDEST-FIRST so created_at desc must invert creation order.
 *
 * @return array{Bookshelf, User, list<Notification>}
 */
function mynFix(int $count = 3, string $slug = 'dong-thap-myn'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);
    $reader = User::factory()->create(['full_name' => 'Têrêsa Bạn Đọc Nhỏ']);
    $membership = Membership::factory()->for($shelf)->create(['user_id' => $reader->id, 'role' => 'reader', 'status' => 'active']);
    $rows = [];
    for ($i = 0; $i < $count; $i++) {
        $rows[] = Notification::query()->create([
            'bookshelf_id' => $shelf->id, 'user_id' => $reader->id,
            'kind' => 'request_approved',
            'payload' => ['title' => "Cuốn Thứ {$i}", 'hold_until' => '2026-09-0'.($i + 1)],
            'created_at' => now()->subMinutes($count - $i),
        ]);
    }
    app(TenantContext::class)->set($shelf, $membership);
    test()->actingAs($reader);

    return [$shelf, $reader, $rows];
}

it('a reader reads their own bell: sentences rendered, newest first, unread counted', function () {
    [, $reader, $rows] = mynFix(3);

    $mine = app(MyNotificationsQuery::class)->run($reader);

    expect($mine['unread'])->toBe(3)
        ->and($mine['rows'][0]['id'])->toBe($rows[2]->id)              // newest first
        ->and($mine['rows'][0]['sentence'])->toBe('Cuốn Thứ 2 đã sẵn sàng, bạn đến nhận trước ngày 03/09/2026 nhé.')
        ->and($mine['rows'][0]['kind'])->toBe('request_approved');
});

it('one reader\'s bell never shows another\'s', function () {
    [$shelf, $reader] = mynFix(1, 'dong-thap-myn-other');
    app(TenantContext::class)->actSystemWide();
    $other = User::factory()->create(['full_name' => 'Anna Người Khác']);
    Notification::query()->create([
        'bookshelf_id' => $shelf->id, 'user_id' => $other->id,
        'kind' => 'membership_approved', 'payload' => [], 'created_at' => now(),
    ]);
    app(TenantContext::class)->set($shelf->fresh(), Membership::query()->where('user_id', $reader->id)->firstOrFail());

    $mine = app(MyNotificationsQuery::class)->run($reader);

    expect($mine['rows'])->toHaveCount(1)
        ->and($mine['unread'])->toBe(1);
});

it('an unknown stored kind renders the neutral sentence, never the token', function () {
    [$shelf, $reader] = mynFix(0, 'dong-thap-myn-unknown');
    app(TenantContext::class)->actSystemWide();
    Notification::query()->create([
        'bookshelf_id' => $shelf->id, 'user_id' => $reader->id,
        'kind' => 'request_teleported', 'payload' => [], 'created_at' => now(),
    ]);
    app(TenantContext::class)->set($shelf->fresh(), Membership::query()->where('user_id', $reader->id)->firstOrFail());

    expect(app(MyNotificationsQuery::class)->run($reader)['rows'][0]['sentence'])
        ->toBe('Bạn có một thông báo mới.');
});

it('marking one read leaves the rest, and marking all clears the bell', function () {
    [, $reader, $rows] = mynFix(3, 'dong-thap-myn-read');

    app(MarkNotificationRead::class)->one($reader, $rows[0]->id);
    expect(app(MyNotificationsQuery::class)->run($reader)['unread'])->toBe(2)
        ->and($rows[0]->fresh()->read_at)->not->toBeNull();

    $marked = app(MarkNotificationRead::class)->all($reader);
    expect($marked)->toBe(2)
        ->and(app(MyNotificationsQuery::class)->run($reader)['unread'])->toBe(0);
});

it('a reader cannot mark somebody else\'s notification read — a silent no-op', function () {
    [$shelf, $reader] = mynFix(0, 'dong-thap-myn-foreign');
    app(TenantContext::class)->actSystemWide();
    $other = User::factory()->create(['full_name' => 'Anna Người Khác']);
    $foreign = Notification::query()->create([
        'bookshelf_id' => $shelf->id, 'user_id' => $other->id,
        'kind' => 'membership_approved', 'payload' => [], 'created_at' => now(),
    ]);
    app(TenantContext::class)->set($shelf->fresh(), Membership::query()->where('user_id', $reader->id)->firstOrFail());

    app(MarkNotificationRead::class)->one($reader, $foreign->id);   // no exception

    expect($foreign->fresh()->read_at)->toBeNull();
});

it('two notifications written in the same instant come back newest-first by id', function () {
    // The sweep writes many rows in ONE instant, so created_at ties BY
    // CONSTRUCTION and orderByDesc('id') is the only thing separating
    // them — the reference measured the cost of omitting it twice (rows
    // repeating and vanishing across pages). UUIDv7 ids are chronologically
    // monotonic, so the row created SECOND has the higher id and must come
    // first: seeding "out of intended order" is impossible for a
    // same-instant pair, so this block pins the MECHANISM and says so
    // (Global Constraints' UUIDv7 rule). Pinned HERE rather than deferred
    // to Task 17, which asserts idempotence and not ordering.
    [, $reader] = mynFix(0, 'dong-thap-myn-tie');
    $instant = now();
    $first = Notification::query()->create([
        'user_id' => $reader->id, 'kind' => 'membership_approved',
        'payload' => [], 'created_at' => $instant,
    ]);
    $second = Notification::query()->create([
        'user_id' => $reader->id, 'kind' => 'membership_rejected',
        'payload' => [], 'created_at' => $instant,
    ]);
    expect($first->id < $second->id)->toBeTrue();

    $rows = app(MyNotificationsQuery::class)->run($reader)['rows'];

    expect(array_column($rows, 'id'))->toBe([$second->id, $first->id]);
});

it('marking read writes no audit entry, deliberately', function () {
    [, $reader, $rows] = mynFix(1, 'dong-thap-myn-noaudit');

    app(MarkNotificationRead::class)->one($reader, $rows[0]->id);
    app(MarkNotificationRead::class)->all($reader);

    expect(AuditLog::query()->count())->toBe(0);
});

it('the page renders with the unread subtitle and the bell prop carries the count', function () {
    [$shelf, $reader] = mynFix(2, 'dong-thap-myn-page');

    test()->actingAs($reader)->get("/shelves/{$shelf->slug}/profile/notifications")
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('shelves/profile/notifications')
            ->where('mine.unread', 2)
            ->where('unreadNotifications', 2));
});

it('the mark-read POSTs work over HTTP and land back on the page', function () {
    [$shelf, $reader, $rows] = mynFix(2, 'dong-thap-myn-post');

    test()->actingAs($reader)
        ->post("/shelves/{$shelf->slug}/profile/notifications/{$rows[0]->id}/read")
        ->assertRedirect();
    expect($rows[0]->fresh()->read_at)->not->toBeNull();

    test()->actingAs($reader)
        ->post("/shelves/{$shelf->slug}/profile/notifications/read-all")
        ->assertRedirect();
    expect(Notification::query()->whereNull('read_at')->count())->toBe(0);
});
```

- [ ] **Step 2: Run to verify failure** — `make test FILTER=MyNotificationsTest`. Expected: FAIL.

- [ ] **Step 3: Implement**

Create `app/Queries/MyNotificationsQuery.php`:

```php
<?php

namespace App\Queries;

use App\Models\Notification;
use App\Models\User;
use App\Support\Notifications\NotificationSentences;

/**
 * OPS §3.2's GetMyNotifications — the bell's page, with BR §15's unread
 * count. The sentence is rendered HERE from the stored payload — not on
 * the page (a screen cannot invent phrasing for an event it did not
 * define) and not stored (a stored sentence freezes every typo forever;
 * re-rendering is how "Dế Mèn" follows a corrected title). The
 * deliberate opposite of the audit browser's stored-values rule.
 *
 * Own rows only, keyed on the session's user id — users has no tenant
 * scope, so the person-scope comes from the caller and the shelf-scope
 * from BookshelfScope. id desc beside created_at desc: the sweep writes
 * many rows in one instant, so the timestamps tie BY CONSTRUCTION and
 * the v7 id is the deterministic mechanism (measured cost of omitting
 * it, twice in the reference: rows repeating and vanishing across pages).
 */
final class MyNotificationsQuery
{
    /** @return array{rows: list<array{id: string, kind: string, sentence: string, createdAt: string, readAt: ?string}>, unread: int} */
    public function run(User $reader, int $limit = 30): array
    {
        $limit = max(1, min(100, $limit));

        // array_values around the whole thing, and the (string) cast on
        // createdAt, are both level-8 requirements rather than taste —
        // MyLoanHistoryQuery.php:29 writes it the same way. ->values()
        // ->all() gives PHPStan array<int, …>, not list<…>, so the
        // declared shape above fails without the wrap; and
        // Carbon::toISOString() is ?string (readAt is legitimately
        // nullable and keeps the nullsafe, createdAt is not and gets the
        // cast). Both were caught by running phpstan over this block, not
        // by reading it.
        $rows = array_values(Notification::query()
            ->where('user_id', $reader->id)
            ->orderByDesc('created_at')->orderByDesc('id')
            ->limit($limit)
            ->get()
            ->map(fn (Notification $n): array => [
                'id' => $n->id,
                'kind' => $n->kind,
                'sentence' => NotificationSentences::sentence($n->kind, (array) $n->payload),
                'createdAt' => (string) $n->created_at->toISOString(),
                'readAt' => $n->read_at?->toISOString(),
            ])->values()->all());

        $unread = Notification::query()
            ->where('user_id', $reader->id)
            ->whereNull('read_at')
            ->count();

        return ['rows' => $rows, 'unread' => $unread];
    }
}
```

Create `app/Actions/Notifications/MarkNotificationRead.php`:

```php
<?php

namespace App\Actions\Notifications;

use App\Models\Notification;
use App\Models\User;
use App\Support\Clock;

/**
 * A reader dismisses one notification, or all of them — OPS §4.6.
 *
 * NEITHER writes an audit entry, and that is a decision, not an
 * omission (the reference's three-part argument): the audit map is the
 * type, so notification.read would need a Vietnamese sentence for an
 * event that is not a business fact about the shelf; one row per bell
 * tap buries every real entry under the most frequent and least
 * meaningful action in the system; and nothing is recoverable from it —
 * read_at is a fact about one person's inbox, visible only to them.
 * MyNotificationsTest pins the absence by name.
 *
 * Keyed on user_id, so somebody else's id — and a double-tap — update
 * zero rows silently: both are ordinary outcomes, not errors. Query-
 * builder updates (no model event ceremony; the table has no updated_at).
 */
final class MarkNotificationRead
{
    public function __construct(private Clock $clock) {}

    public function one(User $reader, string $notificationId): void
    {
        Notification::query()
            ->whereKey($notificationId)
            ->where('user_id', $reader->id)
            ->whereNull('read_at')
            ->update(['read_at' => $this->clock->now()]);
    }

    /** @return int how many were marked */
    public function all(User $reader): int
    {
        return Notification::query()
            ->where('user_id', $reader->id)
            ->whereNull('read_at')
            ->update(['read_at' => $this->clock->now()]);
    }
}
```

Create `app/Http/Controllers/Reader/NotificationController.php`:

```php
<?php

namespace App\Http\Controllers\Reader;

use App\Actions\Notifications\MarkNotificationRead;
use App\Http\Controllers\Controller;
use App\Models\Bookshelf;
use App\Models\Notification;
use App\Models\User;
use App\Queries\MyNotificationsQuery;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class NotificationController extends Controller
{
    public function index(Request $request, Bookshelf $shelf, MyNotificationsQuery $query): Response
    {
        /** @var User $user */
        $user = $request->user();

        return Inertia::render('shelves/profile/notifications', [
            'mine' => $query->run($user, 50),
        ]);
    }

    public function read(Request $request, Bookshelf $shelf, Notification $notification, MarkNotificationRead $mark): RedirectResponse
    {
        /** @var User $user */
        $user = $request->user();
        $mark->one($user, $notification->id);

        return back();
    }

    public function readAll(Request $request, Bookshelf $shelf, MarkNotificationRead $mark): RedirectResponse
    {
        /** @var User $user */
        $user = $request->user();
        $mark->all($user);

        return back();
    }
}
```

Routes (profile group; `read-all` declared first — static before bound, the house habit):

```php
        Route::get('/notifications', [NotificationController::class, 'index'])->name('notifications');
        Route::post('/notifications/read-all', [NotificationController::class, 'readAll'])->name('notifications.read-all');
        Route::post('/notifications/{notification}/read', [NotificationController::class, 'read'])->name('notifications.read');
```

(replace the under-construction line; import the controller; `{notification}` resolves through `Bookshelf::notifications()`.)

`HandleInertiaRequests::share` gains (after `'role'`):

```php
            // BR §15's bell count — lazy, evaluated per render, only when
            // both a user and a shelf are bound (BookshelfScope needs the
            // tenant; a guest has no bell). One indexed count
            // (notifications_unread covers user_id, created_at).
            'unreadNotifications' => fn () => ($request->user() !== null && $shelf !== null)
                ? \App\Models\Notification::query()
                    ->where('user_id', $request->user()->id)
                    ->whereNull('read_at')
                    ->count()
                : null,
```

`resources/js/types/index.d.ts`: `SharedData` gains `unreadNotifications: number | null;`. `app-layout.tsx`: beside the shelf link, when `shelf && auth.user`:

```tsx
<Link href={route("shelves.profile.notifications", { shelf: shelf.slug })}>
    {unreadNotifications
        ? t(copy.notifications.bellWithCount, { count: unreadNotifications })
        : copy.notifications.bell}
</Link>
```

`copy.ts` gains:

```ts
    notifications: {
        bell: "Thông báo",
        bellWithCount: "Thông báo ({count})",
        title: "Thông báo",
        allRead: "Bạn đã đọc hết rồi.",
        unreadCount: "Bạn có {count} thông báo chưa đọc.",
        markAll: "Đánh dấu đã đọc hết",
        markOne: "Đánh dấu đã đọc",
        newBadge: "Mới",
        empty: "Chưa có thông báo nào. Khi đơn đăng ký hoặc yêu cầu mượn của bạn được duyệt, bạn sẽ thấy ở đây.",
        backToOverview: "Về trang của tôi",
    },
```

Create `resources/js/pages/shelves/profile/notifications.tsx` — the reference page in the house idiom: heading + subtitle (`allRead` / `unreadCount`), a mark-all button (posting `read-all` via `useForm`) shown when unread > 0, the list (unread rows: tinted background AND the `newBadge` word — never colour alone; per-row `markOne` button posting the read route), timestamps via `formatInstantParts`, the `empty` paragraph, a link back to the overview. All copy through `copy.ts`; `AppLayout`.

- [ ] **Step 4: Run, JS gates, mutation-check, commit**

Run: `make test FILTER=MyNotificationsTest && make test FILTER=Notification` — PASS. JS gates clean.

Mutation checks: (1) drop `->where('user_id', …)` from `one()` → "cannot mark somebody else's…" red; restore. (2) drop `->orderByDesc('id')` → no test reds (same-instant rows need the sweep — Task 17's idempotence test covers ordering indirectly); the comment in the query names the mechanism per the UUID constraint, and Task 17 adds the direct pin. (3) return the raw kind from the query instead of the sentence → "an unknown stored kind renders the neutral sentence" and the first test both red; restore.

```bash
make lint && make analyse
git add app/ routes/web.php resources/js/ tests/
git commit -m "feat: the bell — own rows, rendered sentences, mark-read with no audit ceremony"
```

---

### Task 17: `reminders:sweep` — the one scheduled job, and the second `Schedule::` line Phase 0 reserved

Read first: `old_next/src/domain/notifications/sweep.ts` (WHOLE file — the housekeeping bound, the not-exists idempotence, the per-shelf window, the "runs as admin across every shelf" argument), `the-sweep-is-housekeeping.test.ts` (all eight), OPS §7's sweep paragraphs, `routes/console.php`'s reserved comment (the exact line Phase 0 wrote), plan divergence 9.

**Why "housekeeping" matters before writing anything.** BR §8 forbids a job from WRITING overdue status — it is computed on read, so the badge, the dashboard count and the overdue list are correct even if this job never runs. A *notification* is the one thing that cannot be computed on read: "has this reader already been told" is itself state. OPS §7 permits exactly this sweep and bounds it — "if it doesn't run for a few hours, nothing a user can observe becomes wrong, only late to be told" — and the FIRST test below is that bound, verbatim: advance the clock past a due date WITHOUT running the sweep and assert everything a user sees is already right.

**Files:**
- Create: `app/Console/Commands/SweepReminders.php`
- Modify: `routes/console.php` (the reserved comment becomes the live line)
- Modify: `app/Support/Notifications/NotificationKind.php` (+ `LoanDueSoon`, `LoanOverdue`), `NotificationSentences.php`, `lang/vi/notifications.php`, `NotificationsAreReaderFacingTest.php` (+ two rows pointing at the command file)
- Test: `tests/Feature/Notifications/SweepIsHousekeepingTest.php`

**Interfaces:**
- `php artisan reminders:sweep` — cross-shelf (`TenantContext::actSystemWide()`), one transaction, prints exactly one completion line always: `Sweep complete: {d} due-soon, {o} overdue notification(s).` (OPS §7's evidence-the-job-ran line, kept verbatim in English? NO — the reference's line is English and it is operator-facing console output, not UI; keep it verbatim: the OPS §7 doc quotes it exactly and the schedule's log is where it lands.)
- Due-soon: active loans with `today <= due_on <= today + shelf's dueSoonDays`; overdue: active loans with `due_on < today` (no shelf setting — a lapsed loan is late regardless of warning window). `today` = `Clock::today()` (Asia/Ho_Chi_Minh). Idempotent per loan and per kind: "already told" = a notification exists with the same `user_id`, `kind`, `payload.due_on` and `payload.title` — the notification is the cursor (no `last_swept_at` to drift or be reset by a restore). A loan warned due-soon still gets its overdue row when it lapses — two different things to say about one book.

- [ ] **Step 1: Write the failing tests**

Create `tests/Feature/Notifications/SweepIsHousekeepingTest.php`:

```php
<?php

use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\Notification;
use App\Models\User;
use App\Queries\ManagerDashboardQuery;
use App\Support\TenantContext;
use Carbon\Carbon;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Support\Facades\Artisan;

afterEach(fn () => Carbon::setTestNow());

/**
 * One shelf, one borrower, one active loan due on $dueOn.
 *
 * @return array{Bookshelf, User, Loan}
 */
function swpFix(string $dueOn, array $settings = [], string $slug = 'dong-thap-swp'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => $settings]);
    $manager = User::factory()->create(['full_name' => 'Maria Quản Lý Kho '.$slug]);
    Membership::factory()->for($shelf)->create(['user_id' => $manager->id, 'role' => 'manager', 'status' => 'active']);
    $borrower = User::factory()->create(['full_name' => 'Giuse Người Mượn '.$slug]);
    Membership::factory()->for($shelf)->create(['user_id' => $borrower->id, 'role' => 'reader', 'status' => 'active']);
    $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Dế Mèn Phiêu Lưu Ký', 'slug' => 'de-men-'.$slug]);
    $copy = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0001', 'state' => 'on_loan']);
    $loan = Loan::query()->create([
        'bookshelf_id' => $shelf->id, 'copy_id' => $copy->id, 'book_id' => $book->id,
        'borrower_id' => $borrower->id, 'lent_by' => $manager->id,
        'due_on' => $dueOn, 'status' => 'active',
    ]);

    return [$shelf, $borrower, $loan];
}

it('the badge is right before the sweep has ever run — the whole exception, bounded', function () {
    // 2026-08-20 was the due date; "today" is the 25th. NO sweep runs.
    Carbon::setTestNow(Carbon::parse('2026-08-25 02:00:00', 'UTC'));
    [$shelf, $borrower] = swpFix('2026-08-20');
    $manager = Membership::query()->where('role', 'manager')->firstOrFail();
    app(TenantContext::class)->set($shelf, $manager);

    $counts = app(ManagerDashboardQuery::class)->run()['counts'];

    expect($counts['overdue'])->toBe(1)                       // computed live, BR §8
        ->and(Notification::query()->count())->toBe(0);       // only late to be TOLD
});

it('the sweep tells the borrower a book is overdue, and prints its evidence line', function () {
    Carbon::setTestNow(Carbon::parse('2026-08-25 02:00:00', 'UTC'));
    [, $borrower] = swpFix('2026-08-20', [], 'dong-thap-swp-over');

    Artisan::call('reminders:sweep');

    expect(Artisan::output())->toContain('Sweep complete: 0 due-soon, 1 overdue notification(s).');
    $note = Notification::query()->sole();
    expect($note->user_id)->toBe($borrower->id)
        ->and($note->kind)->toBe('loan_overdue')
        ->and($note->payload)->toMatchArray(['title' => 'Dế Mèn Phiêu Lưu Ký', 'due_on' => '2026-08-20']);
});

it('running the sweep twice does not tell a child twice', function () {
    Carbon::setTestNow(Carbon::parse('2026-08-25 02:00:00', 'UTC'));
    swpFix('2026-08-20', [], 'dong-thap-swp-idem');

    Artisan::call('reminders:sweep');
    Artisan::call('reminders:sweep');

    expect(Artisan::output())->toContain('Sweep complete: 0 due-soon, 0 overdue notification(s).');
    expect(Notification::query()->count())->toBe(1);
});

it('a book due in two days is due-soon, not overdue — and the window is in HCM days', function () {
    // 23:00 UTC on the 24th is already the 25th in Asia/Ho_Chi_Minh;
    // due 2026-08-27 is two HCM days out — inside the default 3-day
    // window. A UTC "today" would compute three days and still pass, so
    // the pin is the due-soon KIND plus the boundary test below.
    Carbon::setTestNow(Carbon::parse('2026-08-24 23:00:00', 'UTC'));
    swpFix('2026-08-27', [], 'dong-thap-swp-soon');

    Artisan::call('reminders:sweep');

    expect(Notification::query()->sole()->kind)->toBe('loan_due_soon');
});

it('a shelf\'s own due_soon_days sets its window, not the global default', function () {
    Carbon::setTestNow(Carbon::parse('2026-08-25 02:00:00', 'UTC'));
    // Due in 5 HCM days: outside the default 3, inside this shelf's 7.
    swpFix('2026-08-30', ['due_soon_days' => 7], 'dong-thap-swp-window');
    // And a second shelf at the default, same due date: NOT swept.
    swpFix('2026-08-30', [], 'dong-thap-swp-window-b');

    Artisan::call('reminders:sweep');

    expect(Artisan::output())->toContain('Sweep complete: 1 due-soon, 0 overdue notification(s).');
    expect(Notification::query()->sole()->bookshelf_id)
        ->toBe(Bookshelf::withoutGlobalScopes()->where('slug', 'dong-thap-swp-window')->sole()->id);
});

it('a book warned as due-soon is still told when it goes overdue', function () {
    Carbon::setTestNow(Carbon::parse('2026-08-25 02:00:00', 'UTC'));
    [, $borrower] = swpFix('2026-08-26', [], 'dong-thap-swp-both');
    Artisan::call('reminders:sweep');   // due-soon written

    Carbon::setTestNow(Carbon::parse('2026-08-29 02:00:00', 'UTC'));
    Artisan::call('reminders:sweep');   // now overdue — a DIFFERENT thing to say

    expect(Notification::query()->where('user_id', $borrower->id)->pluck('kind')->sort()->values()->all())
        ->toBe(['loan_due_soon', 'loan_overdue']);
});

it('a returned book is never swept', function () {
    Carbon::setTestNow(Carbon::parse('2026-08-25 02:00:00', 'UTC'));
    [, , $loan] = swpFix('2026-08-20', [], 'dong-thap-swp-ret');
    Loan::query()->whereKey($loan->id)->update([
        'status' => 'returned', 'returned_at' => now(),
        'received_by' => $loan->lent_by, 'return_condition' => 'perfect',
    ]);

    Artisan::call('reminders:sweep');

    expect(Notification::query()->count())->toBe(0);
});

it('the sweep crosses shelves, because a nightly job serves every parish', function () {
    Carbon::setTestNow(Carbon::parse('2026-08-25 02:00:00', 'UTC'));
    swpFix('2026-08-20', [], 'dong-thap-swp-a');
    swpFix('2026-08-20', [], 'can-tho-swp-b');

    Artisan::call('reminders:sweep');

    expect(Artisan::output())->toContain('0 due-soon, 2 overdue')
        ->and(Notification::query()->count())->toBe(2);
});

it('the 07:00 Asia/Ho_Chi_Minh schedule line exists — Phase 0\'s reservation discharged', function () {
    $schedule = app(Schedule::class);
    $event = collect($schedule->events())
        ->first(fn ($e) => str_contains((string) $e->command, 'reminders:sweep'));

    expect($event)->not->toBeNull()
        ->and($event->expression)->toBe('0 7 * * *')
        ->and($event->timezone)->toBe('Asia/Ho_Chi_Minh');
});
```

- [ ] **Step 2: Run to verify failure** — `make test FILTER=SweepIsHousekeepingTest`. Expected: FAIL — command not found.

- [ ] **Step 3: Implement**

Create `app/Console/Commands/SweepReminders.php`:

```php
<?php

namespace App\Console\Commands;

use App\Enums\LoanStatus;
use App\Models\Bookshelf;
use App\Models\Loan;
use App\Models\Notification;
use App\Support\Circulation\LendingSettings;
use App\Support\Clock;
use App\Support\Notifications\NotificationKind;
use App\Support\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Console\Command;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * The one scheduled job this system permits, and the exception is
 * argued, not assumed (sweep.ts, OPS §7): BR §8 keeps overdue STATUS
 * derived on read — the badge is right whether or not this ever runs —
 * but "has this reader already been told" is itself state, and a
 * dismissible record cannot be computed on read without telling somebody
 * twice or losing that they were told. The bound is the acceptance
 * criterion: if this does not run for a few hours, nothing observable is
 * wrong, only late to be told — SweepIsHousekeepingTest's first test.
 *
 * Idempotent by existence, not by cursor: "already told" is the
 * notification itself (same user, kind, due_on, title) — no
 * last_swept_at to drift, roll back, or be reset by a restore. Per loan
 * AND per kind, so a due-soon warning does not eat the overdue notice.
 *
 * Cross-shelf under actSystemWide() — the one caller with no tenant to
 * scope to; bookshelf_id is copied from each loan onto the row it
 * produces, so every write is correctly scoped even though the read was
 * not. Per-shelf due_soon_days comes off each shelf's settings blob
 * (LendingSettings — the same coalesce the settings screen shows), the
 * fallback being 3. The overdue half reads no shelf setting: a lapsed
 * loan is late regardless of how much warning its shelf asked for.
 *
 * Deliberately NOT an audited action: no actor to name (INV-8 has
 * nobody), and nothing about the shelf's record changed — a book became
 * late on its own. Rows are created directly (not via Notifier, which
 * takes its shelf from a bound tenant this job does not have);
 * NotificationsAreReaderFacingTest names this file as the two kinds'
 * writer and its allowed-inserters list includes it.
 *
 * Eloquent per-row inserts rather than INSERT…SELECT (plan divergence
 * 9): ids are application-generated UUIDv7 and MariaDB 10.11 has no v7
 * function. The candidate sets are two indexed queries; the volume is a
 * shelf's active loans.
 */
final class SweepReminders extends Command
{
    protected $signature = 'reminders:sweep';

    protected $description = 'Write due-soon and overdue reader notifications (07:00 Asia/Ho_Chi_Minh housekeeping)';

    public function handle(Clock $clock, TenantContext $tenant): int
    {
        $tenant->actSystemWide();
        $today = $clock->today();
        $now = $clock->now();

        // $clock is deliberately NOT in the use() list: $today and $now are
        // already taken from it above, and an unused import is a Pint
        // failure (lambda_not_used_import).
        [$dueSoon, $overdue] = DB::transaction(function () use ($today, $now): array {
            // Per-shelf windows, one read. Keyed by shelf id.
            $windows = Bookshelf::query()->get()
                ->mapWithKeys(fn (Bookshelf $s) => [$s->id => LendingSettings::fromShelf($s)->dueSoonDays]);
            $maxWindow = (int) max([3, ...$windows->values()->all()]);

            $candidates = Loan::query()
                ->where('status', LoanStatus::Active)
                ->where('due_on', '>=', $today)
                ->where('due_on', '<=', CarbonImmutable::parse($today)->addDays($maxWindow)->toDateString())
                ->join('books', 'books.id', '=', 'loans.book_id')
                ->select('loans.*', 'books.title')
                ->get()
                // The shelf's OWN window, per row — the broad SQL window
                // only bounds the candidate read.
                ->filter(function (Loan $l) use ($today, $windows): bool {
                    $limit = CarbonImmutable::parse($today)->addDays((int) ($windows[$l->bookshelf_id] ?? 3))->toDateString();

                    return $l->due_on->toDateString() <= $limit;
                });

            $dueSoon = $this->tell($candidates, NotificationKind::LoanDueSoon, $now);

            $lapsed = Loan::query()
                ->where('status', LoanStatus::Active)
                ->where('due_on', '<', $today)
                ->join('books', 'books.id', '=', 'loans.book_id')
                ->select('loans.*', 'books.title')
                ->get();

            $overdue = $this->tell($lapsed, NotificationKind::LoanOverdue, $now);

            return [$dueSoon, $overdue];
        });

        // Always printed, even at 0,0 — the line itself is the evidence
        // the job ran (OPS §7's operator walk quotes it verbatim).
        $this->info(sprintf('Sweep complete: %d due-soon, %d overdue notification(s).', $dueSoon, $overdue));

        return self::SUCCESS;
    }

    /** @param Collection<int, Loan> $loans */
    private function tell(Collection $loans, NotificationKind $kind, CarbonImmutable $now): int
    {
        $written = 0;
        foreach ($loans as $loan) {
            $dueOn = $loan->due_on->toDateString();
            $title = (string) $loan->getAttribute('title');

            $alreadyTold = Notification::query()
                ->where('user_id', $loan->borrower_id)
                ->where('kind', $kind->value)
                ->where('payload->due_on', $dueOn)
                ->where('payload->title', $title)
                ->exists();
            if ($alreadyTold) {
                continue;
            }

            Notification::query()->create([
                'bookshelf_id' => $loan->bookshelf_id,
                'user_id' => $loan->borrower_id,
                'kind' => $kind->value,
                'payload' => ['title' => $title, 'due_on' => $dueOn],
                'created_at' => $now,
            ]);
            $written++;
        }

        return $written;
    }
}
```

(If `payload->due_on` JSON-path wheres misbehave against MariaDB's LONGTEXT-backed json — run the test first; the fallback, noted here in advance rather than improvised: `whereRaw("JSON_UNQUOTE(JSON_EXTRACT(payload, '$.due_on')) = ?", [$dueOn])` — Laravel's `->` operator compiles to exactly that on MySQL-family drivers, so the builder form should hold.)

In `routes/console.php`, the reserved comment block (the four comment lines ending with the sample line) is REPLACED by:

```php
// The second Schedule:: line Phase 0 reserved: BR §15's nhắc trả sách —
// three days before due (per-shelf due_soon_days), and again once
// lapsed. 07:00 Asia/Ho_Chi_Minh, the hour the compose sweep service ran
// (OPS §7). Housekeeping, bounded: if it misses a day, nothing a user
// sees is wrong — overdue is computed on read — only late to be told.
Schedule::command('reminders:sweep')->dailyAt('07:00')->timezone('Asia/Ho_Chi_Minh');
```

`NotificationKind` gains `LoanDueSoon = 'loan_due_soon'` and `LoanOverdue = 'loan_overdue'`; `lang/vi/notifications.php` gains:

```php
    'loan_due_soon' => ':book sắp đến hạn trả, ngày :due.',
    '_loan_due_soon_bare' => ':book sắp đến hạn trả, ngày sắp tới.',
    'loan_overdue' => ':book đã quá hạn trả. Bạn mang sách đến trả giúp nhé.',
```

sentence arms:

```php
            NotificationKind::LoanDueSoon => (function () use ($payload): string {
                $book = self::which(self::str($payload, 'title'));
                $due = self::date(self::str($payload, 'due_on'));

                return $due === null
                    ? strtr(self::line('_loan_due_soon_bare'), [':book' => $book])
                    : strtr(self::line('loan_due_soon'), [':book' => $book, ':due' => $due]);
            })(),
            NotificationKind::LoanOverdue => strtr(self::line('loan_overdue'), [
                ':book' => self::which(self::str($payload, 'title')),
            ]),
```

plus two `NotificationSentencesTest` cases (due-soon with `due_on: '2026-09-01'` → "…ngày 01/09/2026."; overdue with a title). The census table gains:

```php
    'loan_due_soon' => ['app/Console/Commands/SweepReminders.php'],
    'loan_overdue' => ['app/Console/Commands/SweepReminders.php'],
```

- [ ] **Step 4: Run, mutation-check, commit**

Run: `make test FILTER=SweepIsHousekeepingTest && make test FILTER=Notification` — PASS.

Mutation checks: (1) delete the `$alreadyTold` guard → "running the sweep twice…" red; restore. (2) drop the per-shelf filter (use `$maxWindow` for everyone) → "a shelf's own due_soon_days…" red (shelf B gets swept); restore. (3) change the schedule to `dailyAt('08:00')` → the schedule test red; restore.

```bash
make lint && make analyse
git add app/Console/ routes/console.php app/Support/Notifications/ lang/vi/notifications.php tests/
git commit -m "feat: reminders:sweep — housekeeping bounded, idempotent by the notification itself"
```

---

### Task 18: `ReleaseExpiredHold` — the lapsed hold's exit (product-owner ruling 1; this task EXECUTES)

Read first: ruling 1's full context above, BR §7.2's `approved → expired` arrow, `old_next/src/app/tu-sach/[shelf]/quan-ly/yeu-cau-muon/page.tsx:110-140` (the HoldNote), the `title_has_no_copies` OPS-amendment precedent (1c settled decision 4), and Task 9's `hold_expired` branch — this command is what makes that branch reachable.

**Files:**
- Create: `app/Actions/Circulation/ReleaseExpiredHold.php`
- Modify: `app/Policies/BorrowRequestPolicy.php` (+ `release` → act-as-manager)
- Modify: `app/Support/Audit/AuditSentences.php` (+ `request.expired`), `lang/vi/audit.php`
- Modify: `docs/OPERATIONS.md` (§4.2 gains the command entry — the one OPS amendment this plan can make, on the owner's ruling)
- Modify: `routes/web.php` (+ `POST /manage/borrow-requests/{borrowRequest}/release` → `shelves.manage.borrow-requests.release`), `app/Http/Controllers/Manage/BorrowRequestController.php` (+ `release`), `resources/js/pages/manage/borrow-requests.tsx` (the Trả về kệ button on expired rows only), `resources/js/lib/copy.ts` (+ `manageRequests.releaseButton: "Trả về kệ"`), `RuleViolatedCodesHaveSentencesTest` (+ `hold_not_expired`; `request_not_held` was added by Task 9), `CirculationArchitectureTest` (lock list + this Action). **`lang/vi/rules.php` needs no edit here** — Task 1 already minted `hold_not_expired` and `release_hold_flash` in the flash block it owns, with the reason (`hold_not_expired` is a NEW code with no `errors.ts` spelling, authored on the ruling exactly as `title_has_no_copies` was; the OPS entry below is its second ledger)
- Test: `tests/Feature/Circulation/ReleaseExpiredHoldTest.php`

**Interfaces:**
- `ReleaseExpiredHold::execute(User $actor, BorrowRequest $request): array{requestId: string, copyId: string}` — throws `request_not_held` (not approved / no copy) | `hold_not_expired` (the hold still stands — a manager may not yank a live hold); audit `request.expired`; NO notification (the child was told the deadline at approval; BR §15 lists no lapsed-hold event).
- Transaction: copy lock FIRST (from the snapshot's `copy_id` — an approved row always names one), request lock second — the Task 5 order exactly. The expiry check compares the LOCKED row's `hold_expires_at` against `Clock::now()` — this command is the one writer of the `expired` status, and it writes it only for a hold the clock has already ended (derived state stays derived; the write is a RECORD of the lapse a manager chose to act on, not a job's tidy-up).

- [ ] **Step 1: Write the failing tests** — `tests/Feature/Circulation/ReleaseExpiredHoldTest.php` with fixture `ehxFix` (clone `corFix`'s approved-variant skeleton, slug base `dong-thap-ehx`, the manager acting): six tests — (1) a lapsed hold releases: `Carbon::setTestNow(now()->addDays(4))` after fixture, execute, expect request `Expired`, copy `Available`, audit row `request.expired` with before `{status: approved}` / after `{status: expired, copy_id, title, userId}`, result carries both ids; (2) a LIVE hold refuses `hold_not_expired` and writes nothing; (3) a pending request refuses `request_not_held`; (4) the lock order pin — copy first, request second (`$log[0]`/`$log[1]`, the Task 7 idiom verbatim); (5) the released copy is immediately approvable onto the next reader (chain: release, then `ApproveBorrowRequest` for a second pending request **by a DIFFERENT reader** — `borrow_requests_one_live_per_title_member` allows one live row per title per reader — onto the same copy succeeds; `DB::flushQueryLog()` between commands if logging); (6) a copy that has since gone to `lost` is left alone by the guarded release, and the expiry is still recorded (`request.expired` written, request `expired`, copy still `lost`) — the pin for mutation check 2 below. Write the real code for all six following Task 7's test file as the template — same imports, same fixture discipline, distinct names.

- [ ] **Step 2: Run to verify failure** — `make test FILTER=ReleaseExpiredHoldTest`.

- [ ] **Step 3: Implement** — the Action:

```php
<?php

namespace App\Actions\Circulation;

use App\Enums\CopyState;
use App\Enums\RequestStatus;
use App\Exceptions\RuleViolated;
use App\Models\Book;
use App\Models\BookCopy;
use App\Models\BorrowRequest;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\Clock;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * BR §7.2's approved → expired, at last written by something — the
 * product owner's ruling 1 (2a plan): the reference left a lapsed
 * hold with no manager exit (the copy in `held` forever unless the
 * reader cancelled), and the queue query's own docblock demanded a
 * command that never existed. This is that command: the manager records
 * the lapse the clock already produced, and the copy goes back on the
 * shelf in the same transaction.
 *
 * Guarded on the hold actually having lapsed (hold_not_expired
 * otherwise): a live hold is a promise to a child who may be on their
 * way, and yanking it is not this command. Freeing early has an
 * ordinary path — the reader cancels, or the hold runs out.
 *
 * Lock order: copy first (an approved row always names one; the
 * snapshot's copy_id is an in-memory attribute), request second — Task
 * 5's order exactly. No notification: BR §15 lists no lapsed-hold
 * event; the approval notification carried the deadline.
 */
final class ReleaseExpiredHold
{
    public function __construct(
        private Clock $clock,
        private AuditRecorder $audit,
    ) {}

    /** @return array{requestId: string, copyId: string} */
    public function execute(User $actor, BorrowRequest $request): array
    {
        Gate::forUser($actor)->authorize('release', $request);

        $snapshotCopyId = $request->copy_id;   // in-memory attribute

        return DB::transaction(function () use ($request, $snapshotCopyId): array {
            $copy = $snapshotCopyId === null ? null
                : BookCopy::query()->lockForUpdate()->find($snapshotCopyId);
            $request = BorrowRequest::query()->lockForUpdate()->findOrFail($request->id);

            if ($request->status !== RequestStatus::Approved || $request->copy_id === null || $copy === null || $copy->id !== $request->copy_id) {
                throw new RuleViolated('request_not_held');
            }
            if ($request->hold_expires_at === null || $request->hold_expires_at > $this->clock->now()) {
                throw new RuleViolated('hold_not_expired');
            }

            $title = (string) Book::query()->whereKey($request->book_id)->value('title');

            $request->update(['status' => RequestStatus::Expired]);
            // Guarded like the cancel release: a copy that moved on is
            // left alone (then the audit still records the expiry).
            BookCopy::query()->whereKey($copy->id)
                ->where('state', CopyState::Held)
                ->update(['state' => CopyState::Available]);

            $this->audit->record('request.expired', 'request', $request->id,
                ['status' => 'approved', 'copy_id' => $copy->id],
                ['status' => 'expired', 'copy_id' => $copy->id, 'title' => $title, 'userId' => $request->member_id]);

            return ['requestId' => $request->id, 'copyId' => $copy->id];
        });
    }
}
```

Audit sentence: `'request_expired' => 'kết thúc giữ chỗ quá hạn của :subject và trả bản sách về kệ',` + map entry (`'request.expired' => 'loans'`) + arm (the `request.rejected` construction minus `:because`). **`AuditSentences`' class docblock count goes 26 → 27 in this same edit** — the branch's final number (Task 4 states the arithmetic). Controller `release` method + route + the button on expired rows only (`entry.holdExpired ? <ReleaseForm/> : null`, `variant="outline"` — the handover stays the solid one) + flash `release_hold_flash`. OPS §4.2 amendment, after `CancelOwnRequest`:

```markdown
#### `ReleaseExpiredHold`
*Added 2026-08-29 (Laravel migration, phase 2a — product-owner ruling 1).* A manager records a lapsed hold's end: `approved → expired` (§7.2's arrow, previously written by nothing) and the copy `held → available`, one transaction. The guard is the clock's own verdict — a live hold cannot be released here.

- **Inputs:** `bookshelfId`, `requestId`
- **Caller:** `manager`
- **Invariants enforced:** INV-2, INV-8; §8 (expiry is decided by comparing `hold_expires_at` to now — this command records a lapse, it never creates one)
- **Audit action:** `request.expired`
- **Failure modes:**
  - `request_not_held` — "Yêu cầu này không có bản sách nào đang được giữ chỗ."
  - `hold_not_expired` — "Thời gian giữ chỗ chưa hết, không thể trả về kệ."
```

Task 14's architecture presence-pin gains a fourth name in this commit: `'shelves.manage.borrow-requests.release'`, asserted `role:manager` like the other three.

- [ ] **Step 4: Run, mutation-check, commit**

Run: `make test FILTER=ReleaseExpiredHoldTest && make test FILTER=HandoverRequestTest && make test FILTER=AuditActionCensusTest && make test FILTER=ManagerQueueScreenTest` — PASS. The handover suite is in that list on purpose: this command is what makes its `hold_expired`-on-an-`expired`-row test describe a reachable state rather than a defensive one, and the two must go green together.

Mutation checks: (1) drop the `hold_expires_at > now` guard → test 2 ("a LIVE hold refuses `hold_not_expired`") red; restore. (2) drop the `->where('state', CopyState::Held)` guard from the copy release → no test reddens with the fixtures as written, so ALSO seed, in test 1, a variant where the copy has since gone to `lost`: the release must still record `request.expired` and must NOT flip a lost copy to available. Write that as a sixth test now rather than leaving the guard unpinned. (3) remove the audit `record` call → `AuditActionCensusTest` red (a sentence with no writer); restore.

```bash
make lint && make analyse
git add app/ docs/OPERATIONS.md routes/web.php resources/js/ lang/vi/ tests/
git commit -m "feat: releaseexpiredhold — the lapsed hold's exit, on the owner's ruling"
```

---

### Task 19: The guarantee sweep — architecture pins, the OPS walk, the durable record

Read first: 1c's Task 14 and 1d's Task 10 (the shape of a wrap-up that earned its name), `docs/known-gaps.md`'s Phase 1c section (the entries this phase discharges or amends), `docs/superpowers/HANDOFF.md`.

**Files:**
- Modify: `docs/known-gaps.md` (the Phase 2a section — new; amendments to 1b/1c entries)
- Modify: `docs/superpowers/HANDOFF.md` (2a's table row and per-task ledger)
- Modify: `database/seeders/DemoShelfSeeder.php` (+ one pending request, one approved hold with its held copy, one notification — so a demo walk shows the queue and the bell; fixture names from AGENTS.md's sample content)
- Test: none new beyond the seeder run; this task's substance is verification and the record

- [ ] **Step 1: The full-suite and full-gate run**

Run, in order, pasting each command's tail into the task log: `make test` (expect: all green — record the count), `make lint`, `make analyse`, the JS gates (Biome, tsc, `bun run build`), and `git diff origin/main...HEAD -- old_next/` (expect: EMPTY output — paste the nothing).

- [ ] **Step 2: The OPS §4.2/§3 walk, against the branch, not the plan**

Open each named file and record the disposition table in known-gaps (the 1c precedent — "walked by opening the named file, not inferred"):

| Entry | Disposition |
|---|---|
| `CreateBorrowRequest` / `ApproveBorrowRequest` / `RejectBorrowRequest` / `CancelOwnRequest` / `HandoverRequest` | shipped (Tasks 4–9) |
| `ReceiveReturn` | RE-WIDENED to the reference's full shape (Task 10) — the 1c narrowing entry below is discharged |
| `SkipRequest` | closed WITHOUT implementation: the product owner removed *Bỏ qua* from the reference (queue page comment block, 2026-08-09); *Từ chối* is the one manager decision on a pending row |
| `ReleaseExpiredHold` | shipped (Task 18), on ruling 1 — with its own OPS §4.2 entry written in that task's commit |
| `request_not_held`'s absence from OPS §4.2 | ~~**stated, not covered over.** No §4.2 command enumerates this code; OPS states `HandoverRequest`'s failure modes as the `/errors.ts` disjunction rather than a list…~~ **STRUCK — this instruction repeated divergence 12's false premise; see the strike there.** What the walk actually found and recorded: the code IS enumerated under `ReleaseExpiredHold` (Task 18's entry), and `HandoverRequest`'s entry is an enumerated list that omits it — a documentation lag against a contract that already throws it, closable as one table row |
| `ChooseCopy` vs `CountsCopies::borrowable()` | **dispositioned, not left as a landmine** (divergence 14) — see step 3 below |
| `GetBorrowRequestQueue`, `GetMyNotifications`, `GetMyDashboard` (requests half), `MarkNotificationRead`/`MarkAllNotificationsRead` | shipped |
| the sweep | shipped as `reminders:sweep`, scheduled 07:00 Asia/Ho_Chi_Minh |
| `CreateBorrowRequest`'s `copyId` | NARROWED — 2c restores it with the scan pages (the exact reference behaviour listed: nullable copy of the same title, same shelf, not deleted; audit `copy_id` fills) |

- [ ] **Step 3: The known-gaps amendments — each opened, edited, verified**

1. **Discharge** "`ReceiveReturn`'s contract is deliberately narrower…" — replace with a one-line pointer to the re-widening commit.
2. **Discharge** "`LendCopy`'s hold-collection branch is unported…" — same treatment.
3. **Amend** "`RenewLoan`'s queue check has no structural backstop" — "Phase 2 decides whether the queue check needs a lock" becomes the decision: it keeps the plain read (divergence 8's indistinguishability argument, spelled out), now REACHABLE since requests exist, and the racing-request case is benign by argument, not by absence.
4. **Discharge** "`ApproveMembership`/`RejectMembership` write NO notification rows yet" (known-gaps:1035) — Task 2 landed both.
5. **Amend** the Phase-2 landmine entry — "Step 1's block flag is hold-aware; `ChooseCopy` is not" (`docs/known-gaps.md:1725-1736`) — from a warning into the recorded disposition (divergence 14). Its own words offer two resolutions; write down which was taken and why: **`ApproveBorrowRequest` keeps them in sync** — it flips the copy to `held` in the same transaction as the hold, so `ChooseCopy::lowestLendable`'s state-only branch and `CountsCopies::borrowable()`'s state-plus-no-live-hold branch select the same set — and `ChooseCopy` is left alone, because it is pure over a `Collection<BookCopy>` and would have to be handed hold data by every caller to learn the predicate. Name the one residual: an `available` copy under a live hold, where the two DO still disagree and the walk-up lend wins. (~~reachable only through `ReportCopyLost` + `MarkCopyFound` on a held copy~~ — **struck; see divergence 13's strike.** No command walk to that row was found, and the residual is stated as a predicate disagreement rather than as a reachable state.) Add the pin in the same commit — a test in `tests/Feature/Circulation/` that approves a request onto a copy and then asserts `SearchBooksForLendingQuery`'s `blocked` flag and `ChooseCopy::lowestLendable` agree that the title has nothing lendable; without it this row is a paragraph, and a paragraph is what the entry was already.
6. **Add** the C1 record: `CreateBorrowRequest` was going to take a `books` `FOR UPDATE` and does not, because `UpdateBook` X-locks `bookshelves` and then writes the book row while every insert here wants S on that same `bookshelves` row — the AB–BA the review found by reading `UpdateBook.php:73-84` against `2026_08_26_000019_add_composite_tenant_fks.php:34`. Record the diagram, the rejected `bookshelves`-first alternative and the ONE reason it was rejected — it would join the users-actor cycle at known-gaps:1653-1700, already reproduced with two OS processes — and the constraint that replaced the lock with its verified 1062 behaviour. Record ALSO, in the same entry, the reason that was offered and withdrawn: "option 2 would serialise every *Xin mượn* behind a bulk `AddCopies`" is FALSE, because `borrow_requests_bookshelf_id_foreign` makes that insert wait on the shelf row either way (measured: ~3 s behind a held `FOR UPDATE`, with the no-lock design in place), which known-gaps:1633-1640 already records. This file has been factually wrong six times in the same way; an entry that says which of its own sentences did not survive being run is worth more than one that only states the survivor.

   State plainly that **no cycle-freedom claim is made anywhere in the 2a branch**, and state the lock claim as what it is: `CreateBorrowRequest` contains no `lockForUpdate` (pinned by Task 4's grep), which is NOT the same as taking no exclusive lock — its INSERT holds an implicit exclusive record lock on the unique index entry, and a racing insert blocks on it until commit and then receives 1062 (measured: the loser waited ~3 s before its verdict). Both outcomes resolve to the same `duplicate_request` sentence.
7. **Add** divergence 13's hole: an `available` copy under somebody else's live hold is lendable, the reference has it identically (`policy.ts:86-108`), and what is guarded instead is that such a lend never closes the other reader's request (Task 8's named test). This is a ported hole with a stated answer, not an unknown. (~~the reachability walk is `ApproveBorrowRequest` → `ReportCopyLost` → `MarkCopyFound`~~ — **struck; that walk was executed and refused at step two.** See divergence 13's strike above.)
8. **Add** the rest of the Phase 2a section: the cancel-window residual (divergence 1's exact interleaving, and why no cycle-freedom is claimed); the suspended-reader unreachability of `memberMayRequest`/cancel (ported reading 1); the `comment_approved` kind arriving in 2b and the BR §15 profile-change pair being Phase 3's to decide (divergence 7); the freeCopies state-equals-borrowable note (Task 11's comment, recorded durably); ruling 1's disposition (the gap is closed, with the command and the OPS entry that closed it); the frontend blind spot extending to the new pages (the dashboard card mutation check in Task 14 that no test can catch — HANDOFF's open item, restated for the three new screens).
9. **Update HANDOFF.md**: the 2a row → plan committed, tasks 1–19 with commit hashes as they land (the executing session maintains it; this step seeds the structure).

- [ ] **Step 4: The demo seed**

`DemoShelfSeeder` gains, in its existing idiom (read the file first): one pending request by Anna Phạm Thu Hà for Totto-chan Bên Cửa Sổ; one approved hold for Têrêsa Lê Ngọc Ánh on a Đất Rừng Phương Nam copy (copy → `held`, `hold_expires_at` 3 days out, the full approval shape); one `request_approved` notification for Têrêsa matching that hold. Run `php artisan migrate:fresh --seed` against the dev database and load `/manage/borrow-requests` and the profile pages by hand; record the walk's result in the task log.

- [ ] **Step 5: The whole-branch mutation spot-checks (the 1d lesson — the headline guard must not be deletable)**

Four cross-task checks, each performed and restored: (1) delete `Notifier`'s use in ALL three circulation writers at once → at least three named tests red (list them); (2) gut `NotificationsAreReaderFacingTest`'s table to `[]` → its own second test red (the census cannot be emptied silently); (3) remove the `Schedule::command('reminders:sweep'…)` line → the schedule test red; (4) **the 1d lesson applied to this phase's own headline claim**: in `ApproveBorrowRequest`, `RejectBorrowRequest` AND `ReceiveReturn` at once, move each `$this->notifier->notify(...)` to after its `DB::transaction(...)` returns → the transaction-placement guard names all three files and their lines, and nothing else in the suite reddens. That "nothing else reddens" half is the point: it is the measurement of how much this phase's guarantee depended on one architecture test. Record the observed output in the task log. `git status --porcelain` clean after.

- [ ] **Step 6: Commit**

```bash
git add docs/ database/seeders/DemoShelfSeeder.php
git commit -m "test: 2a guarantee sweep — the ops walk, the durable record, the demo queue"
```

---

## Self-review (performed at planning time)

**1. Spec coverage.** The scope's seven numbered items, each to a task: (1) lifecycle create/cancel/approve/reject/handover → Tasks 4, 7, 5, 6, 9; (2) INV-03 and queue semantics ported without invented ordering → Tasks 8 (held-for-me live), 11 (requested_at asc, id asc; folded title between books — the reference's own keys); (3) `ReceiveReturn` re-widening, all four named facts in one transaction → Task 10; (4) notification kinds, write path, reader list, mark-read, the reader-facing architecture intent → Tasks 2 and 16; (5) the 07:00 sweep on Phase 0's reserved line, the housekeeping bound understood and tested first → Task 17; (6) manager and reader screens, Vietnamese copy, English URIs → Tasks 12–16; (7) audit sentences for every new audited action → Tasks 4–8, 10 and 18; no new CSV columns exist (no export touches requests — verified against 1d's three export queries, none of which reads `borrow_requests` or `notifications`). NOT-in-2a items stayed out; the two things that could not be built without later phases (`copyId` needing 2c's scanner; `comment_approved` needing 2b's moderation) are named divergences 3 and 7, not silent widenings.

**2. Placeholder scan (re-run after the review, which found four unresolved instructions the first pass did not count).** Every "if X, do Y; otherwise Z" has been resolved by opening the file: Task 11's inline gates are GONE (no shipped query carries one — `OverdueLoansQuery`, `ManagerDashboardQuery`, `MyDashboardQuery` all checked); `books.author` EXISTS and stays; Task 12's availability field is `detail.copiesAvailable` (checked in `book.tsx`); Task 11's dashboard test lives in `tests/Feature/Oversight/`, not `Manage/`; Task 13's Step 4 now names one test and writes it out instead of offering three options; Task 8's mutation check 2 has a fixture that fires it; Task 15's mutation check has its excluded row seeded in the fixture; `lend_success_flash_short`, `hold_not_expired` and `release_hold_flash` are minted in Task 1 rather than edited retroactively into its committed block. Two steps still delegate line-level plumbing against a named shipped file — Task 11's dashboard-test fixture CALL (the assertions are written out) and Task 18's six tests from Task 7's template — each stating exactly WHAT to assert and WHICH file's idiom to copy, the 1c convention for appending to a file another phase owns. No "add validation", no "handle edge cases", no bare "similar to Task N".

**3. Type consistency.** `RequestRules::copyHoldable(CopyState, ?string): ?string` (Tasks 1→5); `LoanTerms::holdExpiry(CarbonImmutable, int): CarbonImmutable` (1→5, 10, 18); `Notifier::notify(string, NotificationKind, array): void` (2→5, 6, 10); `CreateBorrowRequest::execute(User, Book): array{requestId}` (4→12); `ApproveBorrowRequest::execute(User, BorrowRequest, string): array{requestId, copyId, holdExpiresAt}` (5→14); `RejectBorrowRequest::execute(User, BorrowRequest, ?string)` (6→14); `CancelOwnRequest::execute(User, BorrowRequest): array{requestId, releasedCopyId}` (7→12, 13); `HandoverRequest::execute(User, BorrowRequest): array{loanId, dueOn}` (9→14); `ReceiveReturn::execute(…, ?string $holdForRequestId): array{loanId, queuedRequestId}` (10→15); `BorrowRequestQueueQuery::run(?string)/countWaiting()` (11→14, 15, and ManagerDashboardQuery); `MyNotificationsQuery::run(User, int)` (16); route names used by pages match the routes declared (`shelves.books.request`, `shelves.profile.requests.cancel`, `shelves.manage.borrow-requests[.approve/.reject/.handover]`, `shelves.profile.notifications[.read/.read-all]`).

**4. House rules visibility.** Lock-first + `$log[0]` pins: Tasks 5, 6, 7, 10, 18; Task 4 pins the OPPOSITE — an absence of locks — with a query-log filter and a source grep, because divergence 2 withdrew its lock (C1). The one order inversion is documented, not hidden (divergence 1, Task 7, Task 19), and **no cycle-freedom claim appears anywhere in this plan**: the phase contains no two-OS-process harness, so it makes no claim that would need one. 404-never-403: both Form Requests + route-gating tests (12, 14, 16 — and 14's reader test now exercises all four surfaces, not just the GET). Derived state: `holdExpired`, queue position, and `expired`-written-only-by-`ReleaseExpiredHold`-under-a-clock-guard each carry their argument and a test. Composite-FK/tenancy: no new tables; one new column and one new unique index (Task 1), both verified live against the real MariaDB before the plan shipped; the one join that touches `bookshelf_id` is column-to-column with the TenancyArchitectureTest run named (11). Soft-delete-aware: the new uniqueness names `deleted_at IS NULL` in its own expression and its test proves a soft delete frees the slot; every exclusion test seeds the excluded thing. Mutation testing: every task ends with named break-observe-restore checks, and three of them are corrections the review forced — Task 4's is inverted (add the lock back), Task 8's fixture now puts the foreign hold on the copy being lent, Task 15's excluded row is in the fixture rather than built mid-check. SessionGuard: every actor switch is its own `it()` or its own dataset case (Task 9's four unheld states are a `->with()` dataset, not a `foreach`). UUIDv7: every ordering fixture seeds out of order, or pins the mechanism by name with the monotonicity premise itself asserted (Tasks 13 and 16). Pest traps: absence proofs use `array_key_exists`, exclusion fixtures contain the excluded row. Level 8 and Pint — stated precisely, because the first version of this sentence was itself the seventh instance of the failure it describes. What was run, and what it covered:

- **Pint:** all 43 blocks that begin `<?php` were written to files and run through `pint --test`. Result: `PASS 43 files`. `php -l` clean on all 43.
- **Larastan level 8:** the 21 blocks that are real `app/` classes were staged at their namespace paths, together with the GROWN `NotificationKind`, `NotificationSentences`, `LendingSettings` and `LoanTerms` (so that a case or method a later task adds could not masquerade as an error), and `./vendor/bin/phpstan analyse --level=8` was run over the repo's own `phpstan.neon` paths — `app`, `database`, `routes`, the whole tree, not a subset. Result: `[OK] No errors`. The two `use` fragments that edit shipped Actions (`ApproveMembership`, `RejectMembership`) were applied to the real files and analysed the same way: clean.
- **The first version of this claim was FALSE and a re-review caught it.** It said all blocks passed level 8 when only five had ever been staged. Two did not: `MyNotificationsQuery` (`Carbon::toISOString()` is `?string`, and `->values()->all()` is `array<int, …>` not `list<…>` — both now fixed the way `MyLoanHistoryQuery.php:29` does it), and the `RejectMembership` notify fragment (`$reason === null` is dead code against a non-nullable parameter the Action already refuses empty — `Strict comparison … will always evaluate to false`). Both are fixed above and both were re-run.
- **Not covered by any of this, and deliberately so:** the `.tsx`/`.ts` blocks (no PHP tooling applies; the executor's Biome/tsc/build gates are the check) and the code FRAGMENTS that are snippets rather than whole files — they have no compilable context on their own. Where a fragment edits a shipped file, **only the two `use`/notify fragments in Task 2 were staged** into `ApproveMembership.php` / `RejectMembership.php` and analysed. The other shipped-file fragments — `AuditLogQuery`'s fourth join, `AuditSentences`' arms, `LendCopy`'s collected-hold close, `ManagerDashboardQuery`'s constructor and `counts` — were NOT staged; each mirrors an adjacent shipped line in the same file, and `make analyse` at that task's own commit is the check. (A verification round caught this bullet over-claiming, which is worth naming: the one paragraph whose job is to state what was NOT checked is the last place to be loose.) Where a fragment edits a file this plan creates, the created file was analysed with the fragment applied.

**5. Census integrity re-checked.** Literal `RuleViolated` codes added to the list: `duplicate_request` (T4), `request_not_pending`+`copy_not_found` (T5), `not_own_request`+`request_already_fulfilled` (T7), `hold_expired`+`request_not_held` (T9), `request_not_queued` (T10), `hold_not_expired` (T18) — each in the task that mints the literal. `AuditSentences`' docblock count moves 21 → 27 across Tasks 4, 5, 6, 7, 8, 18, one increment per task (T4 states the arithmetic). Predicate codes stay out (censused in `RequestRulesTest`). Audit actions and their sentences land writer-and-map-together in Tasks 4, 5, 6, 7, 8 (`request.fulfilled`), 18 — matching `AuditActionCensusTest`'s both-directions rule at every commit. Notification kinds land case+sentence+writer+census-row together in Tasks 2, 5, 6, 10 (second door), 17.

## Execution notes

- Task order is dependency order; nothing may be reordered past its consumers (1 before everything — its migration is what makes Task 4's duplicate rule real; 2 before 5/6/10; 8 before 9; 11 before 14/15; 14 before 18, which adds a button to 14's page).
- Both product-owner questions are ANSWERED (rulings 1 and 2, above). **Task 18 executes.** Tasks 6 and 14 carry no conditional deltas — the reject reason is optional, full stop.
- Per the standing instructions: Fable wrote this plan; Opus reviews it before any code; execution runs task-brief → implement → review-package → review per task, ending in a PR with a whole-branch review, then Kien merges.
