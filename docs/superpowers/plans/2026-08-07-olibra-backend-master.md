# OLibra Backend — Master Plan and Dependency Map

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement the per-slice plans this document indexes. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the merged fixture-driven UI into a working system — 44 queries and 57 commands over PostgreSQL, enforcing fourteen named business rules — without changing a single screen's URL or visible behaviour.

**Architecture:** Four layers with inward-only dependencies (SDD §3.1). `src/domain/` holds every rule and imports no framework; `src/db/` owns transactions, Row Level Security and migrations; `src/app/` is Next.js and may call the domain but never SQL. Every command is one transaction containing both its state change and its audit record.

**Tech Stack:** Next.js 16 (App Router) · PostgreSQL 16 · S3-compatible object storage · Docker Compose · Bun runtime, Node build · Vitest · `postgres` (porsager) as the driver.

---

## Global Constraints

Every task in every slice inherits these. They are copied verbatim from the source documents; where a number appears, it is the number.

| # | Constraint | Source |
|---|---|---|
| G1 | **The domain layer imports no framework.** No `next/*`, no `react`, no HTTP types in `src/domain/`. Enforced by an ESLint boundary rule, not by discipline. | SDD §3.1, BR §21 |
| G2 | **Any operation must be callable from a test with no web server running.** If a test needs a server, the operation is in the wrong layer. | SDD §3.3 |
| G3 | **A command's state change and its audit record commit together or not at all.** One transaction. Auditing is never deferred to a job. | BR §14, OPS §1 |
| G4 | **Tenant scoping is structural.** Row Level Security on every shelf-scoped table, `olibra.bookshelf_id` set per transaction. A forgotten `where` returns zero rows, never another parish's data. | BR INV-10, DB §3 |
| G5 | **Derived state is computed on read.** Overdue, hold expiry and availability are never written by a job. Views `loans_current` and `copies_borrowable` are the access path. | BR §8, DB §6 |
| G6 | **Timezone is `Asia/Ho_Chi_Minh` everywhere.** `due_on` is a `date`, never a timestamp. | BR §4.1, §5.4 |
| G7 | **No user-facing string is hard-coded.** All copy resolves from a Vietnamese catalogue. | BR §18 |
| G8 | **Errors are named, not generic.** Every failure is a stable machine code (`copy_not_available`) paired with its exact Vietnamese sentence. Three distinguishable shapes: not-found, validation, business-rule. | OPS §2 |
| G9 | **Nothing in the domain may use `Bun.*` APIs.** The runtime is Bun; the build and the test runner are Node. | AGENTS.md |
| G10 | **Loans, audit records, condition assessments and feedback are never deleted.** `revoke delete` where the database can say it. | BR §11, INV-11, INV-12 |
| G11 | **The seed reproduces `src/lib/fixtures.ts` exactly** — Tủ sách Đồng Tháp, the same books and readers — so pointing the UI at a real database is a configuration change with no visible difference. | DB §9 |
| G12 | **Every one of the fourteen invariants gets its own named test**, including the seven the database enforces structurally. A constraint nobody exercised is a constraint nobody has checked is there. | BR §21, DB §7 |

Source shorthand: **BR** = `docs/BUSINESS-REQUIREMENTS.md`, **OPS** = `docs/OPERATIONS.md`, **DB** = `docs/DATABASE.md`, **SDD** = `docs/SDD.md`.

---

## 1. The short answer on sequencing

Four slices are a strict chain that nothing can go around. Everything else fans out.

```mermaid
graph TD
    S0["S0 · Test harness<br/>Vitest + real Postgres"]
    S1["S1 · Schema, RLS, migrations, seed"]
    S2["S2 · Domain kernel<br/>tx · audit · errors · tenant"]
    S3["S3 · Identity and session"]

    S0 --> S1 --> S2 --> S3

    S3 --> B1["B1 · Catalogue"]
    S3 --> B2["B2 · Members"]
    S3 --> B3["B3 · Community"]
    S3 --> B4["B4 · Administration"]
    S2 --> B5["B5 · Object storage"]

    B1 --> C1["C1 · Lending core"]
    B2 --> C1
    C1 --> C2["C2 · Requests and holds"]
    C2 --> C3["C3 · Renewals"]

    B2 --> D1["D1 · Notifications"]
    C2 --> D1
    C1 --> D2["D2 · Statistics and export"]
    C1 --> D3["D3 · Reader dashboard"]

    X1["X1 · Vietnamese string catalogue"]
    X2["X2 · CI pipeline"]

    B1 --> E["E · UI wiring, per surface"]
    B2 --> E
    C1 --> E
    D3 --> E
```

**The critical path is S0 → S1 → S2 → S3 → B1/B2 → C1 → C2 → C3.** Everything else hangs off it and can be worked in parallel by whoever is free.

**Three slices depend on nothing and can start on day one, in parallel with S0:** X1 (the Vietnamese string catalogue), X2 (CI), and — as soon as S2 lands — B5 (object storage). If two people are working, the second person starts on X1 and X2 while the first builds the chain.

---

## Phase 1 — what actually ships first

BR §1.4 defines Phase 1 in one sentence and never mentions a single operation
name. This is that sentence turned into a list, because the dependency graph
above and the phase boundary are **different cuts** and confusing them costs
weeks.

> **Phase 1 — the core loop.** Books and copies, readers and registration
> approval, lending and returning with condition assessment, the audit log, the
> manager dashboard, the public catalogue and search. A single bookshelf, but
> stored as one tenant among many.

Plus BR §2: **CSV export of books, readers and loans ships in Phase 1**, because
volunteers plus modest infrastructure is a real data-loss risk.

### The headline: Phase 1 does not need C2 or C3

The critical path to a *shippable* product is shorter than the critical path
through this plan:

```
S0 → S1 → S2 → S3 → B1 + B2 → C1 → ship
```

Borrow requests, holds and the waiting queue (**C2**) are Phase 2. Renewals
(**C3**) follow them, because INV-6 blocks a renewal when a request is queued
and there is no queue to check against yet. Comments, announcements, feedback
and statistics (**B3**, **D2**'s statistics half) are Phase 2. The portal,
multiple bookshelves and super-admin tooling (**B4**) are Phase 3.

That removes four slices from the road to something a parish can use — and it
retires **Q1**, the least well-specified command in the catalogue, from the
critical path entirely. `SkipRequest` is a Phase 2 problem.

### What is in

| Area | Operations | Slice |
|---|---|---|
| Books and copies | `CreateBook`, `UpdateBook`, `DeleteBook`, `AddCopies`, `AssessCondition`, `ReportCopyLost`, `MarkCopyFound`, `RetireCopy` | B1 |
| Catalogue and search | `GetCatalogue`, `SearchCatalogue`, `GetBookDetail`, `GetBooksList`, `GetBookDetail` (manager) | B1 |
| Readers and registration | all 16 member commands — see the note below on why the profile-change flow cannot be deferred | B2 |
| Reader queries | `GetReadersList`, `GetReaderDetail`, `GetPendingRegistrations`, `GetPendingProfileChanges`, `GetMyDashboard`, `GetMyLoanHistory`, `GetMyProfile`, `GetMyProfileChangeRequest` | B2, D3 |
| Lending and returning | `LendCopy`, `ReceiveReturn`, `VoidLoan` | C1 |
| Lending queries | `SearchBooksForLending`, `SearchReadersForLending`, `SearchLoansForReturn`, `GetOverdueLoans` | C1 |
| Manager dashboard | `GetManagerDashboard`, `GetShelfHome` (without the announcements and comments rows) | C1, B1 |
| Audit log | the kernel's writer, plus `GetAuditLog` scoped to the one shelf | S2, B4 |
| Export | `ExportBooksCSV`, `ExportReadersCSV`, `ExportLoansCSV` | D2 |
| Shelf configuration | `GetShelfSettings`, `UpdateBookshelfSettings`; `CreateBookshelf` runs as seed rather than a screen | B4 |
| Public front door | `GetSiteContact`, `UpdateSiteContact` — the contact page is the only route into the project for a parish with no shelf | B4 |

Roughly **29 of the 57 commands and 25 of the 44 queries** — a little over half
the catalogue, and all four foundation slices in full.

### What is deferred, and what that costs

| Deferred | Phase | What a volunteer loses meanwhile |
|---|---|---|
| Borrow requests, holds, the queue | 2 | A reader cannot reserve a book that is out. They ask the manager, who remembers. This is exactly how the paper system already works. |
| Renewals | 2 | A reader who wants longer brings the book in and it is lent again. Slightly more walking, no lost data. |
| Comments, announcements | 2 | The shelf home is shorter. Nothing breaks. |
| Feedback inbox | 2 | The contact page's form is the fallback, and it already exists. |
| Statistics | 2 | Counting is manual. The audit log holds the data, so nothing is lost — only unaggregated. |
| Portal, multiple shelves, super-admin screens | 3 | Nothing: there is one shelf. |

**Multi-tenancy is not deferred.** BR §1.4 is explicit that it is present from
the first day of data, so RLS, the `bookshelf_id` on every row and the two
database roles are all Phase 1 infrastructure even though the second bookshelf
is Phase 3. Retrofitting tenancy into a live database is the rewrite that
phasing exists to avoid.

### Two things Phase 1 forces that §1.4 does not say

**The profile-change flow cannot be deferred**, even though §1.4 predates it.
It is the *only* path by which a person's details can change — there is no
manager-edit command anywhere in the catalogue. Without it, a family that moves
house has no way to correct their phone number, and BR §16.3 calls that number
"the actual mechanism by which books come back."

**Notifications are optional in Phase 1.** Everything in §15 that Phase 1 could
trigger — registration approved, registration rejected — happens between two
people who are standing next to each other. The bell can wait for Phase 2, when
borrow requests create things a reader genuinely learns about while away. If it
is cut, `GetMyNotifications` and the two `MarkNotification*` commands go with
it.

---

## 2. What blocks what, precisely

### 2.1 Hard blockers — no way around them

| Blocked | Blocked by | Why it is genuinely blocked |
|---|---|---|
| **Everything** | **S0** | G12 requires fourteen named tests and there is no test suite at all today. Writing domain code before the harness means writing it twice — once optimistically, once when the harness reveals the seams. This is the single largest risk in the project right now. |
| Every query and command | S1 | No tables. |
| Every **command** | S2 | G3's transaction-plus-audit pairing is one piece of machinery. Writing it per command guarantees drift, and drift here means an audit record that does not match its change. |
| Everything except `GetPortalDirectory` and `SearchBookshelves` | S3 | OPS §2: every operation whose caller is `reader` or higher requires a membership *of the shelf in the request*. Without session and role resolution there is no caller to check. |
| C1 (lending) | B1 **and** B2 | A loan needs a copy and a member. Both, not either. |
| C2 (requests/holds) | C1 | `HandoverRequest` produces a loan; the hold-to-loan path cannot be tested before loans exist. |
| C3 (renewals) | C2 | INV-6 blocks renewal when a request is queued for the title. The queue must exist to be tested against. |
| D1 (notifications) | B2 **and** C2 | Seven of the nine reader notifications are written by membership and request commands. |
| D2, D3 | C1 | Statistics count completed handovers; the reader dashboard shows held books. Both need loans. |

### 2.2 Soft blockers — orderings that are merely wise

| Ordering | Why, and what happens if ignored |
|---|---|
| X1 (strings) before any UI wiring | G7 forbids hard-coded copy. Wiring screens first means retrofitting every string, which is the kind of task that gets half-done. |
| B5 (storage) before the avatar field in B2 | Registration collects a photograph (BR §16.1). Without the adapter, B2 either stubs it or blocks. Stubbing is fine and expected — but only if B5 lands before B2 ships. |
| X2 (CI) before the first parallel slice | Two people merging domain code without CI is how the invariant tests quietly stop running. |
| D2 (export) after the audit decision in §5 | Whether pulling a CSV of children's names is itself an audited event changes the command's shape. Cheap now, awkward later. |

### 2.3 Not blocked by anything — start whenever

- **X1 · Vietnamese string catalogue.** Pure data extraction from the 42 built screens. No database, no domain.
- **X2 · CI pipeline.** `bun run check`, `docker build --target smoke`, and the invariant suite once S0 exists.
- **B5 · Object storage adapter.** Depends on S2 only for the error taxonomy. Genuinely independent of every domain rule.

---

## 3. Parallelism: who can work on what, at the same time

The honest constraint is that **the first four slices are one person's work**, because each one's output is the next one's foundation and splitting them creates more coordination than they save. Parallelism becomes real at S3.

### Wave 0 — the chain (1 person, plus 1 on the independent track)

| Track | Slices | Notes |
|---|---|---|
| A | S0 → S1 → S2 → S3 | Critical path. One person, start to finish, for coherence. |
| B | X1, X2 | Fully independent. A second person is not idle. |

### Wave 1 — four domain tracks in parallel (up to 4 people)

Once S3 merges, these four touch disjoint directories and disjoint tables:

| Track | Slice | Directory | Tables touched |
|---|---|---|---|
| A | **B1 · Catalogue** | `src/domain/catalogue/` | `books`, `book_copies`, `condition_assessments` |
| B | **B2 · Members** | `src/domain/members/` | `users`, `memberships`, `profile_change_requests` |
| C | **B3 · Community** | `src/domain/community/` | `comments`, `announcements`, `feedback` |
| D | **B4 · Administration** | `src/domain/admin/` | `bookshelves`, `audit_log` (read) |

**The one shared file is `src/db/migrations/`.** Four people adding migrations concurrently will collide on ordering. Mitigation: migrations are timestamped, and S1 lands the full schema, so Wave 1 should need *no* new migrations. If a slice needs one, it is a signal that S1 missed something — raise it rather than adding a migration quietly.

B5 (storage) runs alongside as a fifth track if a fifth person exists; otherwise fold it into B2, which is its only consumer.

### Wave 2 — circulation (1–2 people, mostly sequential)

C1 → C2 → C3 is a chain. C1 is the highest-consequence slice in the project — it is where INV-1 through INV-8 all land at once — and deserves the most careful reviewer, not the most parallelism.

D2 and D3 can run in parallel with C2/C3 once C1 merges.

### Wave 3 — surfaces (highly parallel, up to 6 people)

UI wiring is per-surface and each surface has one owner:

| Surface | Depends on |
|---|---|
| Public (landing, portal) | S3 only |
| Reader (shelf home, catalogue, book detail, search) | B1, D3 |
| Reader (my page, history, profile) | B2, D3 |
| Manager (dashboard, lend, return) | C1 |
| Manager (books, readers, queue, moderation) | B1, B2, B3, C2 |
| Admin (shelves, managers, audit, feedback) | B4 |

---

## 4. File structure

Decided here so no slice has to invent it. Each file has one responsibility; files that change together live together (by domain area, not by technical layer).

```
src/
  domain/                          ← G1: no framework imports, ever
    kernel/
      errors.ts                    DomainError + the three shapes (G8)
      audit.ts                     AuditWriter — the only writer of audit_log
      tenant.ts                    TenantContext — carries bookshelfId + actor
      clock.ts                     Clock interface; timezone-aware today() (G6)
      unit-of-work.ts              runInTransaction — the G3 boundary
    catalogue/
      commands/                    create-book.ts, add-copies.ts, retire-copy.ts, …
      queries/                     get-catalogue.ts, get-book-detail.ts, …
      policy.ts                    copy-state transition table (BR §7.1)
    circulation/
      commands/                    lend-copy.ts, receive-return.ts, void-loan.ts, …
      queries/
      policy.ts                    INV-3..INV-7 predicates, pure and testable alone
    members/
      commands/                    register-membership.ts, set-credentials.ts, …
      queries/
      policy.ts                    membership state machine (BR §7.5)
    community/
    admin/
    notifications/
      write.ts                     called by commands, inside their transaction
  db/
    migrations/                    NNNN_verb_noun.sql, forward-only
    client.ts                      pool; one place that knows the connection string
    transaction.ts                 begin/commit + `set local olibra.bookshelf_id`
    rls.ts                         policy helpers used by migrations
  storage/
    s3.ts                          put/url/delete against any S3-compatible provider
  auth/
    session.ts                     who is calling
    guards.ts                      role resolution; requireManager(shelf) etc.
  i18n/
    vi.ts                          every user-facing string (G7)
  app/                             ← Next.js only; may call domain, never SQL
tests/
  invariants/                      the fourteen named tests (G12) — one file each
  domain/                          per-slice behaviour tests
  support/
    db.ts                          per-file schema, truncation, two-connection helper
    factories.ts                   makeShelf(), makeReader(), makeBookWithCopies()
```

---

## 5. Product decisions that block implementation

These are blocked on **you**, not on code. Each has a slice waiting on it. I have recorded the reading this plan assumes so work is not stalled — but if a reading is wrong, the fix is cheaper before the slice than after.

| # | Question | Slice | Assumed reading | Cost if wrong |
|---|---|---|---|---|
| Q1 | **What does `SkipRequest` actually do?** The queue screen shows *Bỏ qua* and *Từ chối* as separate buttons on the same pending row, but neither BR §7.2 nor the UI says what different end state skip produces. OPS calls this "the least well-specified command in the catalogue". | C2 | Skip is **not terminal**: a pending request stays pending but deprioritised; an approved/held one reverts to pending and releases its hold. | Medium. One command's state machine and its test. |
| Q2 | **Is a rejection reason required for `RejectBorrowRequest`?** `RejectMembership` and `RejectComment` both require one in the built UI copy; the borrow queue's *Từ chối* says nothing. | C2 | Optional, as the UI implies. | Low. A validation rule and a notification field. |
| Q3 | **Can an `available` copy be reported lost?** BR §7.1 draws only `on_loan → lost`, but the manager book-detail screen offers *Báo mất* on every copy row. A book going missing off the shelf is plainly real. | B1 | Strict reading: only `on_loan → lost`. | Low-medium. A transition and the UI affordance disagree today either way. |
| Q4 | **May a suspended reader renew?** INV-4 blocks *new* loans and protects existing ones. Renewal extends an existing loan — arguably not new. | C3 | Allowed. | Low. One predicate, one test. |
| Q5 | **Is running a CSV export an audited event?** It changes nothing, so it is a query — but it reads every child's name, DOB and phone in bulk. BR §14 does not cover it. | D2 | **Audit it.** An entry is cheap; the question "who pulled the children's data" is not one to be unable to answer. | Low. |
| Q6 | **Is `RegisterMembership` rate-limited?** `SubmitFeedback` is (3/phone/day). Public registration is an open unauthenticated form that writes a row, and nothing says. | B2 | Not domain-limited; handled at the edge. | Low. |
| Q7 | **Where does `DeleteBook` live in the UI?** Required by BR §13.2/§11; no screen among the 42 exposes it. (`AddCopies` was in this row and is now resolved — "Thêm bản" on the manager's book detail page.) | B1 | Implement the command; leave it unexposed until a delete-confirmation flow is designed. | Low. |

| Q8 | **Who proposes a profile change for a reader who cannot sign in?** `ProposeProfileChange`'s caller is `reader` (self only), and BR §2 makes credentials optional precisely because most readers are children who will never sign in. No manager-edit command exists either, so a family that moves house has no path to a corrected phone number — the number BR §16.3 calls "the actual mechanism by which books come back". | B2 | A manager may propose on a member's behalf, producing a request another manager approves — keeping INV-13's audit trail intact rather than adding a silent edit. | **Medium, and it is Phase 1.** Unlike Q1–Q7 this is a hole in the flow rather than an ambiguity in it. |

**Q1 is the only one of Q1–Q7 I would want answered before its slice starts — and it is Phase 2, so it is not urgent.** The rest can be implemented on the assumed reading and changed cheaply. **Q8 is the one that matters now:** it is Phase 1, and the assumed reading adds a command rather than changing one.

---

## 6. Slice index

Foundation slices have their own fully-scripted plan documents. Wave 1–3 slices are specified here to task granularity — files, operations, interfaces, named tests, acceptance — and get their scripted plan written at the point they are picked up, because their step-by-step detail depends on the interfaces S2 and S3 actually land.

| Slice | Plan | Ops | Blocks | Blocked by |
|---|---|---|---|---|
| S0 · Test harness | [plan](2026-08-07-s0-test-harness.md) | — | everything | — |
| S1 · Schema & RLS | [plan](2026-08-07-s1-schema-rls.md) | — | everything | S0 |
| S2 · Domain kernel | [plan](2026-08-07-s2-domain-kernel.md) | — | all commands | S1 |
| S3 · Identity & session | [plan](2026-08-07-s3-identity-session.md) | 3 | all but 2 queries | S2 |
| C1 · Lending core | [plan](2026-08-07-c1-lending-core.md) | 3 cmd + 4 qry | C2 | B1, B2 |
| B1 · Catalogue | §7.1 below | 8 cmd + 6 qry | C1, E | S3 |
| B2 · Members | §7.2 below | 16 cmd + 8 qry | C1, D1, E | S3 |
| B3 · Community | §7.3 below | 14 cmd + 4 qry | E | S3 |
| B4 · Administration | §7.4 below | 8 cmd + 12 qry | E | S3 |
| B5 · Object storage | §7.5 below | — | avatars, covers | S2 |
| C2 · Requests & holds | §7.6 below | 6 cmd + 2 qry | C3, D1 | C1, **Q1** |
| C3 · Renewals | §7.7 below | 1 cmd | — | C2 |
| D1 · Notifications | §7.8 below | 2 cmd | E | B2, C2 |
| D2 · Statistics & export | §7.9 below | 4 qry | E | C1, **Q5** |
| D3 · Reader dashboard | §7.10 below | 5 qry | E | C1 |
| X1 · String catalogue | §7.11 below | — | E | — |
| X2 · CI | §7.12 below | — | — | — |
| E · UI wiring | §7.13 below | — | — | per surface |

---

## 7. Wave 1–3 slice specifications

### 7.1 B1 · Catalogue

**Files:** `src/domain/catalogue/commands/{create-book,update-book,delete-book,add-copies,assess-condition,report-copy-lost,mark-copy-found,retire-copy}.ts`, `src/domain/catalogue/queries/{get-catalogue,search-catalogue,get-book-detail,get-books-list,get-book-detail-manager,search-books-for-lending}.ts`, `src/domain/catalogue/policy.ts`, `tests/domain/catalogue/*.test.ts`.

**Produces (later slices consume these signatures):**
```ts
createBook(ctx: TenantContext, input: CreateBookInput): Promise<{ bookId: string; copyIds: string[] }>
retireCopy(ctx: TenantContext, input: { copyId: string; reason: string }): Promise<void>
copyStateTransition(from: CopyState, to: CopyState): { allowed: boolean; reason?: ErrorCode }
searchBooksForLending(ctx: TenantContext, q: string): Promise<LendableBookRow[]>
```

**Named tests required:** INV-7 (`tests/invariants/inv-07-lost-or-retired-not-lendable.test.ts`); the folding-parity test from DB §5 with all four suggested inputs — `Dế Mèn Phiêu Lưu Ký`, `Đất Rừng Phương Nam`, `Totto-chan Bên Cửa Sổ`, `Kính Vạn Hoa tập 4` — asserting `olibra_fold()` in SQL and `fold()` in `src/lib/search.ts` return byte-identical output.

**Acceptance:** `CreateBook` writes a book and its initial copies in one transaction with sequential codes (`DT-0215`–`DT-0217`); a copy on loan cannot be retired (`copy_on_loan`); the catalogue query returns availability derived from `copies_borrowable`, never a stored count.

**Blocked by:** S3. **Blocks:** C1, and the reader/manager catalogue surfaces. **Open:** Q3, Q7.

### 7.2 B2 · Members

**Files:** `src/domain/members/commands/{register-membership,manager-register-reader,register-member-on-behalf,approve-membership,reject-membership,suspend-membership,reactivate-membership,mark-membership-left,set-reader-credentials,update-own-profile,propose-profile-change,approve-profile-change,reject-profile-change,cancel-profile-change,change-own-password,propose-avatar-change}.ts`, `src/domain/members/queries/*`, `src/domain/members/policy.ts`.

**Produces:**
```ts
registerMembership(input: RegistrationInput): Promise<{ userId: string; membershipId: string }>
setReaderCredentials(ctx: TenantContext, input: { membershipId: string; username: string; password: string }): Promise<void>
approveProfileChange(ctx: TenantContext, input: { requestId: string }): Promise<void>
membershipAllowsNewLoan(m: Membership): { allowed: boolean; reason?: ErrorCode }
```

**Named tests required:** INV-4, INV-13, INV-14 — `tests/invariants/inv-04-*.test.ts`, `inv-13-*.test.ts`, `inv-14-*.test.ts`.

INV-14's test is worth stating precisely because it is easy to write a weak version: assert that inserting a user with a username and no password fails, that password-without-username fails, that both-null succeeds, and that both-set succeeds. A test that only checks the happy path proves nothing about a check constraint.

INV-13 has two halves and needs both: a partial unique index makes a second pending request for the same person fail; and a test that writing `users` outside `approveProfileChange` is not something any other command does.

**Acceptance:** identity is reused across shelves when the same person registers at a second parish (BR §5.3) — only tổ and giáo họ are re-entered; `SetReaderCredentials` writes audit action `credentials.set` with before/after both null, never the password or its hash (BR §2); a pending profile change leaves the existing phone number in force.

**Blocked by:** S3, and B5 for avatars. **Blocks:** C1, D1. **Open:** Q6.

### 7.3 B3 · Community

**Files:** `src/domain/community/commands/{create-comment,approve-comment,reject-comment,hide-comment,create-announcement,update-announcement,publish-announcement,pin-announcement,unpin-announcement,hide-announcement,submit-feedback,mark-feedback-read,resolve-feedback,archive-feedback}.ts`, plus queries.

**Named tests required:** INV-9 (`tests/invariants/inv-09-comment-visibility.test.ts`) — a pending comment is absent from the member-facing query and present in the moderation query, asserted through the partial index's access path rather than by filtering in the test.

**Acceptance:** comments are stored as plain text and rendered escaped (BR §5.4) — the test asserts a body containing `<script>` round-trips as literal text; `SubmitFeedback` rate-limits to 3 per hashed phone per day (OPS §8), and the store holds the hash, never the number; an announcement past its expiry is excluded on read, not by a job (G5).

**Blocked by:** S3.

### 7.4 B4 · Administration

**Files:** `src/domain/admin/commands/{create-bookshelf,update-bookshelf-settings,archive-bookshelf,assign-manager,revoke-manager,promote-super-admin,update-system-defaults}.ts`, queries including the audit browser and per-manager activity.

**Site contact.** `GetSiteContact` (public, global) and `UpdateSiteContact` (`super_admin`) back the public contact page — the only route a parish with no bookshelf yet has to reach anybody (BR §16.1). The three fields are name, phone and contact hours. They are configuration rather than page content specifically so that a change of administrator does not need a deploy; the test to write is that the public page renders whatever the command last wrote.

**Acceptance:** the slug is fixed after creation (BR §16.4) — an update attempting to change it fails rather than silently ignoring the field; `RevokeManager` changes a role and never deletes a person (BR §2); cross-shelf queries run as the `bypassrls` role explicitly and every other query does not (G4); the audit browser renders each entry as a Vietnamese sentence with raw before/after on expansion (BR §14).

**The super-admin bypass is the sharpest edge in this slice.** A single query that runs as the bypass role by accident defeats INV-10 across every shelf at once. The test to write is the negative one: a `manager`-role connection issuing a cross-shelf query returns zero rows.

**Blocked by:** S3.

### 7.5 B5 · Object storage

**Files:** `src/storage/s3.ts`, `tests/domain/storage/s3.test.ts`.

**Produces:**
```ts
interface ObjectStore {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>
  url(key: string): string          // uses S3_PUBLIC_URL, not S3_ENDPOINT
  delete(key: string): Promise<void>
}
```

**Acceptance:** the module reads `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`, `S3_PUBLIC_URL` and nothing else; **no MinIO SDK is imported** (SDD §6.8) — assert this with a dependency test, not a comment; `url()` is built from `S3_PUBLIC_URL` so a browser can fetch what the server wrote.

**Blocked by:** S2 only. Genuinely parallel with everything.

### 7.6 C2 · Requests and holds

**Files:** `src/domain/circulation/commands/{create-borrow-request,approve-borrow-request,reject-borrow-request,skip-request,cancel-own-request,handover-request}.ts`.

**Named tests required:** INV-2 (`inv-02-not-held-and-on-loan.test.ts`), INV-3 (`inv-03-only-available-or-own-hold.test.ts`).

INV-3's test needs the case that distinguishes `HandoverRequest` from `LendCopy`: reader A holds a hold on copy X; handing X to reader B must fail even though B is an active member in good standing.

**Acceptance:** hold expiry is computed against `now()` at read time (G5) — the test advances an injected `Clock` rather than sleeping, and asserts a hold silently stops being handable-over without any job running; the queue is ordered by `requested_at` with no separate reservation concept (BR §7.2).

**Blocked by:** C1 and **Q1**.

### 7.7 C3 · Renewals

**Files:** `src/domain/circulation/commands/renew-loan.ts`.

**Named test required:** INV-6 (`inv-06-renewal-rules.test.ts`), which must cover both halves and the arithmetic: renewal fails when renewals are exhausted; renewal fails when any request is queued for the *title* (not the copy); and a successful renewal extends by `renewal_days` **from the current due date, not from today** — the case that catches the obvious wrong implementation is renewing a loan that is already overdue.

**Blocked by:** C2. **Open:** Q4.

### 7.8 D1 · Notifications

**Files:** `src/domain/notifications/write.ts`, `src/domain/notifications/commands/{mark-notification-read,mark-all-notifications-read}.ts`.

**Acceptance:** every reader notification in OPS §7 is written by its named command **inside that command's transaction** — the test rolls back a failed `ApproveMembership` and asserts no notification survives; **no manager-facing notification is ever written** (BR §15); due-soon and overdue notifications come from the one permitted scheduled sweep, and the test asserts that not running the sweep leaves every *badge* still correct (G5).

**Blocked by:** B2, C2.

### 7.9 D2 · Statistics and export

**Files:** `src/domain/admin/queries/{get-statistics,export-books-csv,export-readers-csv,export-loans-csv}.ts`.

**Acceptance:** "most borrowed" counts completed handovers at **title** level, not requests and not copies (BR §4.4) — the test gives one title three copies and asserts it does not rank three times higher; exports stream rather than buffering a whole table (SDD §10.7); every figure is computed for the period at query time, never a materialised counter (BR §16.3).

**Blocked by:** C1, **Q5**.

### 7.10 D3 · Reader dashboard

**Files:** `src/domain/members/queries/{get-my-dashboard,get-my-loan-history,get-my-profile,get-my-profile-change-request,get-my-notifications}.ts`.

**Acceptance:** days-remaining and overdue come from `loans_current` (G5); queue position is computed from `requested_at` ordering; the profile query returns current and proposed values side by side, or an empty pending slot (INV-13).

**Blocked by:** C1.

### 7.11 X1 · Vietnamese string catalogue

**Files:** `src/i18n/vi.ts`, `tests/i18n/no-hardcoded-strings.test.ts`.

**Acceptance:** every user-facing string in the 42 built screens resolves from the catalogue (G7); every named error code in OPS §4 has its exact Vietnamese sentence (G8) — the test asserts the two sets are in bijection, so an error code with no message and a message with no code both fail.

**Blocked by:** nothing. **Start immediately.**

### 7.12 X2 · CI

**Files:** `.github/workflows/ci.yml`.

**Acceptance:** runs `bun run check`, the invariant suite against a real Postgres service, and `docker build --target smoke .`. The smoke target is what catches a Next upgrade breaking the Bun runtime (Dockerfile), so it is not optional.

**Blocked by:** nothing for the first two steps; the invariant suite step lands with S0.

### 7.13 E · UI wiring

Per surface, per §3's Wave 3 table. **The acceptance criterion for the whole of E is that no screen's URL or visible behaviour changes** — G11 makes the seed reproduce the fixtures exactly so that swapping `src/lib/fixtures.ts` for real queries is invisible. `bun run check:links` must still report every internal link resolving, and the exported PDF must still match.

---

## 8. What this plan does not do

Stated so the gaps are deliberate rather than discovered:

- **It does not choose a session store.** SDD §11 leaves it open; S3 picks one and records why. In-process is correct while exactly one container runs and wrong the moment a second does.
- **It does not cover the roadmap** (QR labels, CSV import, offline, Zalo). BR §19 is explicitly future work.
- **It does not script Wave 1–3 step-by-step.** Those slices are specified to files, interfaces, named tests and acceptance; their bite-sized TDD steps get written when the slice is picked up, because writing them now would invent signatures against a kernel that does not exist yet. Scripting a task against a guessed interface produces a plan that is wrong in a way that is expensive to notice.
- **It does not resolve Q1–Q7.** Those are yours. Q1 should be answered before C2 starts; the rest have workable assumed readings recorded in §5.
