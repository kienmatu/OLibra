# OLibra — Operations Catalogue

**Status:** Draft for backend implementation. Transport-neutral by design.
**Date:** 2026-08-07
**Scope:** Every operation the system can perform — the contract between the built UI (`src/app/`, 45 screens) and whatever backend gets chosen.

This document does not restate [BUSINESS-REQUIREMENTS.md](BUSINESS-REQUIREMENTS.md); it references it by section and adds what that document does not already say: names, inputs, callers, invariant enforcement, audit actions, and named failure modes for every command and query the UI needs. [DESIGN.md](DESIGN.md) is referenced only for the UI behaviour that shapes an operation's contract (e.g. why blocking conditions must be visible before a confirm step).

---

## 1. How to read this

Every operation is either a **query** or a **command**. Nothing is a third thing.

- **Queries never change state.** They may be arbitrarily expensive to compute (a statistics page, a cross-shelf audit search) but they never write a row, and they never need a request to be idempotent because nothing happens twice.
- **Commands change exactly one business fact**, and **always write an audit record in the same transaction as the change**. "One business fact" is a business-level unit, not a row count — creating a book together with its initial batch of copies is one cataloguing event (§5.4 of the requirements), not several commands stitched together, because a book with zero copies is not yet meaningfully catalogued. Where a single user action genuinely triggers two independent facts (see §5's discussion of `ReceiveReturn` and the queued-reader decision), this document says so explicitly rather than pretending it's one thing.
- A command that fails a business rule is not a partial success. Either the whole transaction — state change and audit record — commits, or nothing does.

**The transport is deliberately unspecified.** Nothing here says REST, GraphQL, RPC, or server actions, and nothing here names a framework. An operation is a name, a set of inputs, and a contract. Whoever picks the stack maps that contract onto endpoints, resolvers, or function calls; the contract itself must not change when they do. This is what makes it possible, per the requirements' Definition of Done (§21), to add a public API later without duplicating a single rule.

---

## 2. Conventions

**Scoping.** Every operation takes a `bookshelfId` (or resolves one from the caller's session) and is scoped to that one bookshelf, per INV-10. The exceptions are named explicitly wherever they appear and are few: the portal directory, blog post management, promote-to-super-admin, and the cross-shelf views under Administration. INV-10 is described in the requirements as the highest-consequence property in the system and structural, not a matter of discipline — so scoping is not a parameter an implementer can choose to skip; every query and command below either takes a shelf identifier or is flagged **Global**.

**Identifiers.** `bookshelfId` — the tenant. `userId` — the global identity (§5.3): username, password, name, DOB, phone, etc. `membershipId` — a user's relationship to *one* shelf: role, status, tổ, giáo họ, approval history. Most day-to-day reader-facing operations act on a `membershipId`, not a bare `userId`, because role and status live on the membership, not the person. `bookId` (title), `copyId` (physical object), `loanId`, `requestId` (a `BorrowRequest`), `commentId`, `announcementId`, `postId` (global), `feedbackId`.

**Callers.** Roles are hierarchical within a shelf: `admin` ⊃ `manager` ⊃ `reader` (§13.1). Where a command lists `manager` as the minimum caller, `admin` can call it too, automatically — the table never repeats the inherited role. `guest` is listed only where unauthenticated calls are genuinely allowed. `super_admin` can call anything anywhere; it is listed explicitly only for the handful of operations that are exclusively its own.

**Errors are named, not generic.** A command never fails with a bare 500 or an unstructured exception. Every failure mode below is a stable, machine-readable code (e.g. `copy_not_available`) paired with the plain Vietnamese sentence the UI shows, matching §17.7's requirement that business-rule violations "surface as a friendly message naming what to do instead." A candidate stack must be able to distinguish *not found*, *validation failure*, and *business-rule violation* as different error shapes, because the UI treats them differently (inline field error vs. a named blocking message vs. a 404 page).

**Nothing is hard-deleted except where §11 permits it.** Users, memberships, books, copies, categories, comments, announcements, posts, borrow requests, and bookshelves may be soft-deleted to undo a mistake. Loans, audit records, condition assessments, and feedback are never deleted under any command in this catalogue — loans get `VoidLoan` instead (INV-11), and nothing below offers to delete an audit record, because none should exist.

---

## 3. Queries

### 3.1 Public (unauthenticated)

| Query | Purpose | Inputs | Returns | Caller | Derived on read |
|---|---|---|---|---|---|
| `GetPortalDirectory` | List every active bookshelf for the front door. **Global.** | — | Per shelf: name, location, book count, active reader count, keeper contact | `guest` | Active reader count, book count |
| `GetShelfHome` | The shelf's public landing page (§16.1). | `bookshelfId` | Identity, opening hours, keeper contact, pinned + recent announcements, most-borrowed row, most-active readers, latest approved comments | `guest` | Most-borrowed ranking, availability badges |
| `GetCatalogue` | Browse or filter the public catalogue. | `bookshelfId`, `scope` (`available` \| `all`), `category?`, `sort?`, `page` | Paginated book cards: cover, title, author, availability badge | `guest` | Availability badge per book (§8) |
| `SearchCatalogue` | Live, diacritic-insensitive search over title and author (§12). | `bookshelfId`, `q` | Ranked book list; empty state suggests popular titles | `guest` | Availability badge |
| `GetBookDetail` | One book's public page. | `bookshelfId`, `bookSlug` | Metadata, description, availability panel, approved comments | `guest` | Availability, current holder (if `public_show_current_borrower`), queue length, days remaining on current loan |
| `GetAnnouncementsList` | Public announcements, pinned first. | `bookshelfId` | Published, non-expired announcements | `guest` | Expiry (an announcement whose `publication_time` or expiry has lapsed is excluded on read, not by a job) |
| `GetAnnouncementDetail` | One announcement's full body. | `bookshelfId`, `announcementSlug` | Title, body, author, date | `guest` | — |
| `GetPostsList` | The global blog. **Global.** | — | Published posts, newest first | `guest` | — |
| `GetPostDetail` | One blog post. **Global.** | `postSlug` | Title, body, cover, author, date | `guest` | — |

Reader full names on public pages are governed by the shelf's `public_name_display` setting (§5.5, assumption 6 in §4) — `GetShelfHome`, `GetBookDetail`, and any leaderboard-bearing query must apply it, never returning the manager-only fields (§5.3: DOB, parents' names, phone, tổ, giáo họ) regardless of the setting.

### 3.2 Reader (authenticated `reader`)

| Query | Purpose | Inputs | Returns | Caller | Derived on read |
|---|---|---|---|---|---|
| `GetMyDashboard` | "My page" — held books, pending requests, recent reads (§16.2). | `membershipId` | Current loans with days-remaining, pending/held requests with queue position, recently returned | `reader` | Days remaining/overdue per loan (§8), queue position |
| `GetMyLoanHistory` | Full borrowing history, reverse-chronological. | `membershipId`, `page` | Loan rows with return condition | `reader` | — |
| `GetMyProfile` | View/edit own profile. | `membershipId` | Personal fields, tổ/giáo họ (read-only), leaderboard toggle | `reader` | — |
| `GetMyNotifications` | Bell dropdown / notifications page. | `membershipId` | Notification list, unread count | `reader` | Unread count |

### 3.3 Manager

| Query | Purpose | Inputs | Returns | Caller | Derived on read |
|---|---|---|---|---|---|
| `GetManagerDashboard` | The four stat cards, shelf totals, recent activity (§16.3). | `bookshelfId` | Counts: overdue, pending registrations, pending requests, pending comments; shelf totals; recent activity feed | `manager` | All four stat counts (§8) — never a stored counter, since a counter can drift |
| `SearchBooksForLending` | Step 1 of quick-lend: find a book, with blocking reasons inline. | `bookshelfId`, `q` | Book rows, each flagged blocked/not with a reason (e.g. "Cả 3 bản đang được mượn") | `manager` | Availability, block reason |
| `SearchReadersForLending` | Step 2 of quick-lend: pick a reader, with blocking reasons inline. | `bookshelfId`, `q` | Member rows, each flagged blocked/not (suspended, at loan limit) | `manager` | Loan-limit and membership-status block reasons (INV-4, INV-5) |
| `SearchLoansForReturn` | Find the loan to receive back, by book or reader. | `bookshelfId`, `q` | Active loan rows with borrower, due date, copy code | `manager` | Overdue flag |
| `GetBooksList` | Manager's book list, filterable. | `bookshelfId`, `q?`, `category?`, `sort?`, `page` | Title rows with copy counts and status | `manager` | Aggregate status per title |
| `GetBookDetail` (manager) | A book's management page. | `bookshelfId`, `bookId` | Metadata, per-copy state/condition/location, condition-assessment history, full loan history | `manager` | Per-copy state, "đang ở đâu" (on shelf / with whom) |
| `GetReadersList` | Manager's reader list, filterable by status. | `bookshelfId`, `status?`, `q?`, `page` | Reader rows with parish, current holding count, status | `manager` | Holding count |
| `GetReaderDetail` (manager) | A reader's full profile. | `bookshelfId`, `membershipId` | Full profile incl. manager-only fields, current loans, loan history | `manager` | Current loans, days remaining |
| `GetPendingRegistrations` | The approval queue. | `bookshelfId` | Pending applications with a similar-name warning where one exists | `manager` | Similar-name match (fuzzy name comparison against existing active members) |
| `GetBorrowRequestQueue` | Requests grouped by book, in request-time order. | `bookshelfId` | Per book: queue position, requester, status, hold expiry where approved | `manager` | Queue position, hold-expired flag (§8) |
| `GetOverdueLoans` | Loans past due, sorted by lateness. | `bookshelfId`, `sort` | Borrower, phone, days late, due date | `manager` | Days late — computed from `due_on` vs. today (§8), never stored |
| `GetCommentsList` | Comments by moderation status. | `bookshelfId`, `status` | Comment rows with book and author | `manager` | — |
| `GetAnnouncementsList` (manager) | All announcements regardless of publication state. | `bookshelfId`, `status?` | Draft/showing/expired announcements | `manager` | Publication state (draft = no `publication_time`; expired = expiry passed) |
| `GetStatistics` | Period-based shelf statistics (§16.3). | `bookshelfId`, `period` (`week` \| `month` \| `year` \| `all`) | Loan count, distinct borrowers, books added, books lost, daily/category charts, top books, top readers | `manager` | Every figure is computed for the period at query time — nothing here is a materialised counter |
| `GetShelfSettings` (manager, read-only) | View this shelf's profile and lending policy. | `bookshelfId` | Profile fields, lending-policy values (§5.5) | `manager` | — |
| `GetAuditLog` (shelf-scoped) | This shelf's audit trail. | `bookshelfId`, filters | Readable Vietnamese sentences per entry, raw before/after on expansion | `manager` | — |
| `ExportBooksCSV` | Data-export insurance (§2). | `bookshelfId` | CSV of the book catalogue | `manager` | — |
| `ExportReadersCSV` | — | `bookshelfId` | CSV of readers | `manager` | — |
| `ExportLoansCSV` | — | `bookshelfId` | CSV of loan history | `manager` | — |

> **Open question.** Exports are queries by this document's own definition — they change nothing — yet they read every reader's manager-only personal fields (§5.3) in bulk. The requirements do not say whether pulling a CSV of children's names, DOB, and phone numbers should itself be an audited domain event. Given the sensitivity, treating `run_export` as always writing an explicit audit entry (§14) even though no *record* changes would be a reasonable, cheap safeguard — but that is an addition to what §14 currently says, not a restatement of it.

### 3.4 Administration (`super_admin`, **Global** unless noted)

| Query | Purpose | Inputs | Returns | Caller | Derived on read |
|---|---|---|---|---|---|
| `GetAdminOverview` | Cross-shelf dashboard, one row per shelf. | — | Per shelf: books, readers, loans, overdue count, pending items; an "attention" list | `super_admin` | Overdue counts, pending-item counts per shelf, all live |
| `GetBookshelvesList` | All shelves for administration. | — | Shelf rows | `super_admin` | — |
| `GetBookshelfSettings` (admin, editable view) | One shelf's full profile + lending policy for editing. | `bookshelfId` | Profile, lending policy, slug (read-only after creation) | `super_admin` | — |
| `GetManagersList` | Every manager/admin across every shelf. | `shelfFilter?`, `q?` | Person, shelf, role, last-active | `super_admin` | Last-active recency (flags e.g. "32 ngày trước" as stale) |
| `GetManagerActivity` | One manager's full activity, grouped by type (§16.4). | `membershipId` (or `userId` for the global `admin` role), `period` | Grouped sections: lends, returns, registrations approved, books added | `super_admin` | All counts read live from the audit log — "trang này đọc từ nhật ký" |
| `GetAuditLog` (cross-shelf) | Filterable by shelf, actor, action, date range. | filters | Same entry shape as the shelf-scoped version, any shelf | `super_admin` | — |
| `GetFeedbackInbox` | Messages from readers and guests. | `status?` (`new` \| `read` \| `resolved`), `shelfFilter?` | Sender, subject, shelf (or site-wide), time, unread flag | `super_admin` | Unread flag/count |
| `GetFeedbackDetail` | One message. | `feedbackId` | Full body, sender contact, shelf | `super_admin` | — |
| `GetPostsList` (admin) | Blog posts incl. drafts. | — | All posts with publication status | `super_admin` | — |
| `GetSystemSettings` | Global defaults and read-only system facts. | — | Default lending-policy values for new shelves, locale, timezone (read-only: `Asia/Ho_Chi_Minh`), last backup time | `super_admin` | — |
| `DownloadSystemBackup` | Retrieve the most recent backup artifact. | — | Backup file/link | `super_admin` | — |

---

## 4. Commands

Each command's **Caller** is the minimum role; §2's hierarchy note applies throughout. Audit actions use a `noun.verb` convention.

### 4.1 Catalogue

#### `CreateBook`
Catalogues a new title together with its initial batch of copies, in one transaction — the "Số bản sách" field on the new-book form auto-generates sequential copy codes (e.g. `DT-0215`–`DT-0217`) as part of the same save.

- **Inputs:** `bookshelfId`, title, author, category, publisher?, year?, pages?, ISBN?, description?, language, cover image?, `published` flag, initial copy count
- **Caller:** `manager`
- **Invariants enforced:** INV-8 (audit written); each generated copy starts `available`
- **Audit action:** `book.created`
- **Failure modes:**
  - `validation_failed` — "Vui lòng điền đầy đủ các trường bắt buộc." (missing title/author/category)
  - `duplicate_isbn` — "Mã ISBN này đã tồn tại trong tủ sách." (if ISBN provided and already used on this shelf)

#### `UpdateBook`
Edits a book's metadata, including the `published` flag that hides drafts from the public catalogue.

- **Inputs:** `bookshelfId`, `bookId`, changed fields
- **Caller:** `manager`
- **Invariants enforced:** INV-8
- **Audit action:** `book.updated`
- **Failure modes:**
  - `not_found` — "Không tìm thấy sách này."
  - `validation_failed` — "Vui lòng kiểm tra lại thông tin."

#### `DeleteBook`
Soft-deletes a book. Permitted per §13.2's permission set and §11's deletion policy; no dedicated confirmation screen exists in the current 45 built screens (`src/app/tu-sach/[shelf]/quan-ly/sach/page.tsx` offers only "Sửa" and "Xem bản").

- **Inputs:** `bookshelfId`, `bookId`
- **Caller:** `manager`
- **Invariants enforced:** INV-8; §11 (its copies are soft-deleted with it, unless a copy carries loan history — see failure mode below)
- **Audit action:** `book.deleted`
- **Failure modes:**
  - `has_active_loans` — "Không thể xoá sách đang có bản được mượn." (a copy is `on_loan` or `held`)
  - `copy_has_history` — a copy with loan history is retained rather than deleted, per §11: "A copy with loan history cannot be removed."

> **Open question.** The built UI has no visible entry point for `DeleteBook`, only for creating and editing. The permission exists in §13.2; the screen doesn't. Flagging rather than inventing a delete-confirmation flow.

#### `AddCopies`
Adds more physical copies to an existing title, auto-generating the next sequential codes — the same mechanism `CreateBook` uses for its initial batch, exposed separately for a title that later receives more donated copies.

- **Inputs:** `bookshelfId`, `bookId`, count, acquired-from?, acquired-date?
- **Caller:** `manager`
- **Invariants enforced:** INV-8
- **Audit action:** `copy.added` (one entry per generated copy, or one entry naming the batch — see the audit note in §4.4 of the requirements: "the record affected" is singular per entry, so a batch of five new copies is five audit rows referencing the same action and timestamp context)
- **Failure modes:**
  - `not_found` — "Không tìm thấy sách này."
  - `validation_failed` — "Số bản phải lớn hơn 0."

> **Open question.** No screen in the built UI exposes this as its own action distinct from `CreateBook`'s copy-count field; the operation is required by the domain model (a book's copy count must be able to grow after cataloguing) but its UI trigger isn't yet designed.

#### `AssessCondition`
Records a manager's judgement of a copy's physical state at a point in time, independent of any loan (§5.4: "a manager may assess a copy at any time, not only at return").

- **Inputs:** `bookshelfId`, `copyId`, condition (one of the six in §9), note?, photo?
- **Caller:** `manager`
- **Invariants enforced:** INV-8
- **Audit action:** `copy.condition_assessed`
- **Failure modes:**
  - `not_found` — "Không tìm thấy bản sách này."

#### `ReportCopyLost`
Marks a copy lost, removing it from circulation (§7.1: `on_loan → lost`).

- **Inputs:** `bookshelfId`, `copyId`, note?
- **Caller:** `manager`
- **Invariants enforced:** INV-2, INV-7, INV-8; if the copy has an active loan, that loan is closed out (`loan.status = lost`, not left dangling as `active`)
- **Audit action:** `copy.lost_reported`
- **Failure modes:**
  - `already_lost` — "Bản sách này đã được báo mất."
  - `already_retired` — "Bản sách đã ngừng dùng, không thể báo mất."

> **Open question.** The state diagram in §7.1 only draws `on_loan → lost`. The built manager book-detail page (`src/app/.../sach/[id]/page.tsx`) shows a "Báo mất" action on every copy row regardless of current status, including copies currently `available`. Real-world loss ("a book goes missing off the shelf without ever being checked out") is plausible, but the requirements don't authorise `available → lost` explicitly. This document assumes the stricter reading (only an `on_loan` copy can be reported lost) and flags the UI's apparent broader affordance as something the product owner should resolve.

#### `MarkCopyFound`
A lost copy turns up again (§7.1: `lost → available`).

- **Inputs:** `bookshelfId`, `copyId`, note?
- **Caller:** `manager`
- **Invariants enforced:** INV-2, INV-8
- **Audit action:** `copy.found`
- **Failure modes:**
  - `not_lost` — "Bản sách này hiện không ở trạng thái đã mất."

> **Open question.** No screen among the 45 exposes this action directly (there is no "lost copies" filtered list built yet); included because §7.1 requires a path back from `lost`, per §3's edge case "A book reported lost is found months later."

#### `RetireCopy`
Permanently withdraws a copy from circulation (§7.1: `available → retired` or `lost → retired`).

- **Inputs:** `bookshelfId`, `copyId`, reason
- **Caller:** `manager`
- **Invariants enforced:** INV-2, INV-7, INV-8
- **Audit action:** `copy.retired`
- **Failure modes:**
  - `copy_on_loan` — "Không thể ngừng dùng bản sách đang được mượn. Hãy nhận trả hoặc báo mất trước." (must return or report lost first — §7.1's explicit note)

### 4.2 Circulation

#### `LendCopy`
Direct, request-free lend — the quick-lend flow's terminal step (§16.3, walked in full in §5 below).

- **Inputs:** `bookshelfId`, `copyId` (or `bookId` when the title has exactly one copy), `membershipId` (the reader)
- **Caller:** `manager`
- **Invariants enforced:** INV-1, INV-2, INV-3, INV-4, INV-5, INV-7, INV-8
- **Audit action:** `loan.created`
- **Failure modes:**
  - `copy_not_available` — "Bản sách này đang được mượn hoặc đang giữ chỗ." (INV-3)
  - `copy_lost_or_retired` — "Bản sách này đã mất hoặc ngừng dùng." (INV-7)
  - `membership_not_active` — "Tài khoản đang tạm khoá, không thể mượn thêm." (INV-4)
  - `loan_limit_reached` — "Bạn đọc đã mượn tối đa số sách cho phép." (INV-5)

#### `HandoverRequest`
Confirms handover of a copy already held for a specific reader via an approved `BorrowRequest` (§7.1: `held → on_loan`). Distinct from `LendCopy` because the precondition is "the reader who holds the hold," not "any active reader" (INV-3).

- **Inputs:** `bookshelfId`, `requestId`
- **Caller:** `manager`
- **Invariants enforced:** INV-1, INV-2, INV-3, INV-4, INV-5, INV-7, INV-8
- **Audit action:** `loan.created` (with `request.fulfilled` written in the same transaction — see the note under §4.3's `ReceiveReturn`-adjacent discussion for why a fulfilled request is a second fact, not folded into the first)
- **Failure modes:**
  - `hold_expired` — "Thời gian giữ chỗ đã hết. Bạn đọc cần đăng ký lại." (§8: hold expiry is computed on read; a stale hold can't be handed over)
  - `membership_not_active` — "Tài khoản đang tạm khoá, không thể mượn thêm."
  - `loan_limit_reached` — "Bạn đọc đã mượn tối đa số sách cho phép."

#### `ReceiveReturn`
Closes a loan and records the copy's condition; walked in full in §5.

- **Inputs:** `bookshelfId`, `loanId`, condition, note?, photo?, `holdForRequestId?` (present only when the manager chooses to hold the returned copy for the next queued reader)
- **Caller:** `manager`
- **Invariants enforced:** INV-1, INV-2, INV-8, INV-11 (this closes the loan as `returned`, never deletes it)
- **Audit action:** `loan.returned` (plus `request.approved` in the same transaction when `holdForRequestId` is supplied — two facts, one user action, one transaction; see §5)
- **Failure modes:**
  - `loan_not_active` — "Lượt mượn này đã được xử lý." (double-submit guard, also INV-1/2 safety net)
  - `request_not_queued` — "Yêu cầu này không còn trong hàng chờ của sách này." (if `holdForRequestId` no longer points at a pending request for this title — e.g. the reader cancelled between page load and confirm)

#### `RenewLoan`
Extends a loan's due date, reader-initiated (§16.2's dashboard "Xin gia hạn").

- **Inputs:** `bookshelfId`, `loanId`
- **Caller:** `reader` (own loan only)
- **Invariants enforced:** INV-6 (renewals remaining **and** no queued request for the title; due date extended by `renewal_days` from the *current* due date, not from today), INV-8
- **Audit action:** `loan.renewed`
- **Failure modes:**
  - `no_renewals_remaining` — "Bạn đã dùng hết số lần gia hạn cho lượt mượn này."
  - `title_has_queue` — "Có bạn khác đang chờ mượn cuốn này, không thể gia hạn." (matches the reader-dashboard example: "Không gia hạn được... Có bạn khác đang chờ cuốn này.")

> **Open question.** INV-4 says a suspended reader's *existing* loans are unaffected and only *new* loans are blocked. Renewing extends an existing loan rather than starting one — this document treats renewal as **allowed** for a suspended reader on that reading, but the requirements never say so explicitly, and a stricter reading ("renewal is a new commitment, block it") is equally defensible. Worth a named test either way (§21).

#### `VoidLoan`
Undoes a loan recorded in error (§3's edge case: "A manager records a loan by mistake and needs to undo it"). Never a delete — INV-11.

- **Inputs:** `bookshelfId`, `loanId`, reason
- **Caller:** `manager`
- **Invariants enforced:** INV-2 (copy returns to `available`), INV-8, INV-11
- **Audit action:** `loan.voided`
- **Failure modes:**
  - `loan_not_active` — "Chỉ có thể huỷ lượt mượn đang diễn ra."
  - `reason_required` — "Vui lòng ghi lý do huỷ."

#### `CreateBorrowRequest`
A logged-in reader expresses intent to borrow a title that has no copy free right now, or wants to queue even when copies exist (§16.1: pressing "Xin mượn" as a logged-in reader "submits immediately with a confirmation dialog").

- **Inputs:** `bookshelfId`, `bookId`, `membershipId`
- **Caller:** `reader`
- **Invariants enforced:** INV-8
- **Audit action:** `request.created`
- **Failure modes:**
  - `membership_not_active` — "Tài khoản đang tạm khoá, không thể gửi yêu cầu mượn."
  - `duplicate_request` — "Bạn đã có một yêu cầu đang chờ cho cuốn này."

#### `CreateGuestBorrowRequest`
An unauthenticated visitor's request, per the "Xin mượn sách" guest form (§16.1, `src/app/.../xin-muon/page.tsx`) — explicitly "a lead, not an account" (§2, assumption 5 in §4).

- **Inputs:** `bookshelfId`, `bookId`, guest name, guest phone, note?, honeypot field
- **Caller:** `guest`, only when `allow_guest_requests` is on for the shelf
- **Invariants enforced:** INV-8
- **Audit action:** `request.created`
- **Failure modes:**
  - `guest_requests_disabled` — "Tủ sách hiện không nhận yêu cầu mượn từ khách."
  - `rate_limited` — see §8
  - `honeypot_triggered` — request silently dropped (no user-visible error, so as not to teach bots which field to leave blank), still recorded as a rejected attempt for the spam log

#### `ApproveBorrowRequest`
`pending → approved`, assigning a specific available copy and starting the hold clock (§16.3: "Approve (creating a hold with a visible expiry)").

- **Inputs:** `bookshelfId`, `requestId`, `copyId` (an available copy of the requested title)
- **Caller:** `manager`
- **Invariants enforced:** INV-2, INV-3, INV-7, INV-8; `hold_expiry = now + hold_days`
- **Audit action:** `request.approved`
- **Failure modes:**
  - `no_copy_available` — "Không còn bản nào để giữ chỗ."
  - `copy_lost_or_retired` — "Bản sách đã chọn đã mất hoặc ngừng dùng."
  - `request_not_pending` — "Yêu cầu này đã được xử lý."

#### `RejectBorrowRequest`
`pending → rejected`.

- **Inputs:** `bookshelfId`, `requestId`, reason?
- **Caller:** `manager`
- **Invariants enforced:** INV-8
- **Audit action:** `request.rejected`
- **Failure modes:**
  - `request_not_pending` — "Yêu cầu này đã được xử lý."

> **Open question.** Registration rejection (`RejectMembership`) and comment rejection (`RejectComment`) both explicitly require a reason in the built UI copy ("Từ chối cần ghi lý do"). The borrow-request queue screen's "Từ chối" button carries no such statement, and §15's notification list ("borrow request rejected") doesn't say whether the reason is shown to the reader. This document lists the reason as optional for `RejectBorrowRequest` on that basis, but the inconsistency with the other two rejection flows looks unintentional rather than a deliberate product decision.

#### `SkipRequest`
A manager passes over a reader in the queue — either one who hasn't reached their turn yet, or one with an active hold who never came to collect (§3: "the first does not show up; the manager skips to the next"; §14 names this as an explicit domain event, "manager skipped this reader in the queue").

- **Inputs:** `bookshelfId`, `requestId`
- **Caller:** `manager`
- **Invariants enforced:** INV-2 (if the request was `approved`/held, the copy returns to `available` or is offered to the next queued reader), INV-8
- **Audit action:** `request.skipped`
- **Failure modes:**
  - `request_not_active` — "Yêu cầu này không còn ở trạng thái có thể bỏ qua."

> **Open question.** The requirements name "skip" as its own domain event but never define how it differs from `RejectBorrowRequest` in terms of resulting state. The built queue screen (`src/app/.../yeu-cau-muon/page.tsx`) shows *both* "Bỏ qua" and "Từ chối" as separate buttons on the same still-pending request rows, which only makes sense if skip and reject leave the request in genuinely different end states — but neither the state machine (§7.2) nor the UI copy says what those states are. This document treats skip as *not* a terminal status (the request presumably stays `pending`, just deprioritised, or — for an approved/held request — reverts to `pending` with the hold released) rather than `rejected`, but this is the least well-specified command in the catalogue and deserves product clarification before implementation.

#### `CancelOwnRequest`
A reader withdraws their own pending or held request (§16.2 dashboard: "Huỷ đăng ký").

- **Inputs:** `bookshelfId`, `requestId`
- **Caller:** `reader` (own request only)
- **Invariants enforced:** INV-2 (releases the hold if one exists), INV-8
- **Audit action:** `request.cancelled`
- **Failure modes:**
  - `not_own_request` — "Bạn không thể huỷ yêu cầu của người khác." (should be structurally unreachable via UI, but the command must still check)
  - `request_already_fulfilled` — "Yêu cầu này đã được trao sách, không thể huỷ."

#### `ConvertGuestRequestToMembership`
Turns a guest lead into a real, registered member — the explicit manager action §2 requires: "a manager action to convert a legitimate request into a real account."

- **Inputs:** `bookshelfId`, `requestId`, the membership fields normally collected at registration (§16.1)
- **Caller:** `manager`
- **Invariants enforced:** INV-8
- **Audit action:** `membership.registered` (with a note linking back to the originating guest request)
- **Failure modes:**
  - `request_not_guest` — "Yêu cầu này không phải của khách, không cần chuyển đổi."

> **Open question.** Required by §2 but not exposed anywhere in the 45 built screens — there is no button on the borrow-request queue or anywhere else that performs this conversion. Listed because the requirement is explicit and unambiguous even though the UI hasn't caught up to it yet.

### 4.3 Members

#### `RegisterMembership`
Public self-registration (§16.1, `src/app/dang-ky/page.tsx`) — creates a `pending` membership. Reuses an existing global `User` identity if the phone/username already exists at another shelf (§5.3: "identity is reused" across shelves).

- **Inputs:** `bookshelfId`, username, password, saint name?, full name, DOB, father's name?, mother's name?, phone, tổ, giáo họ
- **Caller:** `guest`
- **Invariants enforced:** INV-8
- **Audit action:** `membership.registered`
- **Failure modes:**
  - `username_taken` — "Tên đăng nhập đã được dùng, hãy chọn tên khác."
  - `password_too_short` — "Mật khẩu cần ít nhất 8 ký tự."
  - `passwords_dont_match` — "Mật khẩu nhập lại không khớp."
  - `validation_failed` — "Vui lòng điền đầy đủ các trường bắt buộc."

#### `ManagerRegisterReader`
A manager registers a new reader in person, from the quick-lend flow's "Đăng ký người đọc mới" escape hatch (§16.3) or the readers list. Because this exists specifically so a manager standing at the shelf can lend to a brand-new reader in the same visit — the entire point of the three-tap quick-lend flow (§1.3) — the resulting membership must be created `active`, not `pending`, or the escape hatch would defeat its own purpose.

- **Inputs:** `bookshelfId`, the same fields as `RegisterMembership`
- **Caller:** `manager`
- **Invariants enforced:** INV-8
- **Audit action:** `membership.registered` (recorded with the approving manager as actor, distinguishing it from a self-registration awaiting approval)
- **Failure modes:** same as `RegisterMembership`

> **Open question.** The requirements' assumption 3 (§4) says "a manager approving a registration constitutes the consent needed to hold a minor's data" — worded around *approving*, which implies a two-step pending→active flow even here. This document infers immediate-active status from the UX intent (§1.3) rather than from an explicit rule, since nothing in §7.4's state machine or §16.3's description of the escape hatch says whether it skips `pending`. Flagging the inference rather than presenting it as settled.

#### `ApproveMembership`
`pending → active` (§16.3: "Approve... reviewing card lays out exactly the fields the manager must verify in person").

- **Inputs:** `bookshelfId`, `membershipId`
- **Caller:** `manager`
- **Invariants enforced:** INV-8
- **Audit action:** `membership.approved`
- **Failure modes:**
  - `not_pending` — "Đơn đăng ký này đã được xử lý."

#### `RejectMembership`
`pending → rejected`, retained with a reason so the person may re-apply (§2).

- **Inputs:** `bookshelfId`, `membershipId`, reason (required)
- **Caller:** `manager`
- **Invariants enforced:** INV-8
- **Audit action:** `membership.rejected`
- **Failure modes:**
  - `reason_required` — "Vui lòng ghi lý do từ chối."
  - `not_pending` — "Đơn đăng ký này đã được xử lý."

#### `SuspendMembership`
`active → suspended`. Blocks new loans only — existing loans are explicitly unaffected (INV-4, §16.3: "Tạm khoá chỉ chặn mượn mới. Sách đang mượn vẫn giữ nguyên.").

- **Inputs:** `bookshelfId`, `membershipId`, reason?
- **Caller:** `manager`
- **Invariants enforced:** INV-8
- **Audit action:** `membership.suspended`
- **Failure modes:**
  - `not_active` — "Chỉ có thể tạm khoá tài khoản đang hoạt động."

#### `ReactivateMembership`
`suspended → active` (§7.4 draws this as bidirectional: `active ⇄ suspended`).

- **Inputs:** `bookshelfId`, `membershipId`
- **Caller:** `manager`
- **Invariants enforced:** INV-8
- **Audit action:** `membership.reactivated`
- **Failure modes:**
  - `not_suspended` — "Chỉ có thể kích hoạt lại tài khoản đang tạm khoá."

> **Open question.** The reader-detail management screen (`src/app/.../nguoi-doc/[id]/page.tsx`) renders the same three action buttons ("Đặt lại mật khẩu", "Tạm khoá tài khoản", "Đánh dấu đã rời") unconditionally, regardless of the reader's actual membership status in the fixture data — there is no visible "Kích hoạt lại" button anywhere in the 45 screens. The command is required by §7.4's bidirectional arrow; the UI simply hasn't been built state-aware yet.

#### `MarkMembershipLeft`
Any status `→ left` (§16.3: "Đánh dấu đã rời").

- **Inputs:** `bookshelfId`, `membershipId`
- **Caller:** `manager`
- **Invariants enforced:** INV-8
- **Audit action:** `membership.left`
- **Failure modes:**
  - `has_active_loans` — a reader who currently holds books cannot simply leave with them unaccounted for; the manager must resolve the loans first (this is inferred from general soundness, not stated explicitly — see the note below)

> **Open question.** Nothing in §7.4 or §16.3 says whether a reader with active loans can be marked `left`. Blocking it (as listed above) protects the "Đang mượn" count from becoming orphaned, but the requirements never say this explicitly — a valid alternative reading is that leaving is allowed and the loans simply continue to display against a `left` membership.

#### `ResetReaderPassword`
The only account-recovery path in v1, since there's no outbound email (§4, assumption 2). Manager-issued only.

- **Inputs:** `bookshelfId`, `membershipId`, new password (or a manager-visible temporary one)
- **Caller:** `manager`
- **Invariants enforced:** INV-8; the audit record must never capture the password itself (§14: "Passwords and session tokens are never captured")
- **Audit action:** `membership.password_reset`
- **Failure modes:**
  - `not_found` — "Không tìm thấy bạn đọc này."

#### `UpdateOwnProfile`
Reader edits personal fields, including the leaderboard-visibility toggle; tổ and giáo họ are read-only from this command (§16.2: "Muốn đổi tổ hoặc giáo họ thì nhờ quản lý tủ sách giúp").

- **Inputs:** `membershipId`, changed personal fields (saint name, full name, DOB, phone, email?), leaderboard-visible flag
- **Caller:** `reader` (self only)
- **Invariants enforced:** INV-8
- **Audit action:** `membership.updated`
- **Failure modes:**
  - `validation_failed` — "Vui lòng kiểm tra lại thông tin."

#### `ChangeOwnPassword`

- **Inputs:** `userId`, current password, new password
- **Caller:** `reader` (self only)
- **Invariants enforced:** INV-8; password value never captured in the audit record (§14)
- **Audit action:** `user.password_changed`
- **Failure modes:**
  - `current_password_incorrect` — "Mật khẩu hiện tại không đúng."
  - `password_too_short` — "Mật khẩu mới cần ít nhất 8 ký tự."

#### `UpdateAvatar`

- **Inputs:** `userId`, image file (≤2 MB, square, per the profile screen's own copy)
- **Caller:** `reader` (self only)
- **Invariants enforced:** INV-8
- **Audit action:** `user.avatar_updated`
- **Failure modes:**
  - `file_too_large` — "Ảnh vượt quá 2 MB."
  - `invalid_image` — "Tệp này không phải là ảnh hợp lệ."

### 4.4 Community

#### `CreateComment`
A reader comments on a book (§16.1). No guest comments (§5.4).

- **Inputs:** `bookshelfId`, `bookId`, `membershipId`, body (plain text)
- **Caller:** `reader`
- **Invariants enforced:** INV-8, INV-9 (starts `pending` unless `comments_require_approval` is off, in which case it starts `approved` and is immediately public)
- **Audit action:** `comment.created`
- **Failure modes:**
  - `comments_disabled` — "Tủ sách hiện không nhận bình luận."
  - `empty_body` — "Vui lòng nhập nội dung bình luận."

#### `ApproveComment`
`pending → approved` — the only status that makes a comment publicly visible (INV-9).

- **Inputs:** `bookshelfId`, `commentId`
- **Caller:** `manager`
- **Invariants enforced:** INV-8, INV-9
- **Audit action:** `comment.approved`
- **Failure modes:**
  - `not_pending` — "Bình luận này đã được xử lý."

#### `RejectComment`
`pending → rejected`, reason shown to the author (§16.3: "Từ chối cần ghi lý do, bạn đọc sẽ thấy lý do này").

- **Inputs:** `bookshelfId`, `commentId`, reason (required)
- **Caller:** `manager`
- **Invariants enforced:** INV-8
- **Audit action:** `comment.rejected`
- **Failure modes:**
  - `reason_required` — "Vui lòng ghi lý do từ chối."
  - `not_pending` — "Bình luận này đã được xử lý."

#### `HideComment`
`approved → hidden` — pulls a previously public comment (§7.5).

- **Inputs:** `bookshelfId`, `commentId`, reason?
- **Caller:** `manager`
- **Invariants enforced:** INV-8, INV-9
- **Audit action:** `comment.hidden`
- **Failure modes:**
  - `not_approved` — "Chỉ có thể ẩn bình luận đang hiển thị."

#### `CreateAnnouncement` / `UpdateAnnouncement`
Shelf news, written by managers (§16.3).

- **Inputs (create):** `bookshelfId`, title, rich body, pinned?, publication time? (absent = draft), expiry?
- **Inputs (update):** `bookshelfId`, `announcementId`, changed fields
- **Caller:** `manager`
- **Invariants enforced:** INV-8
- **Audit action:** `announcement.created` / `announcement.updated`
- **Failure modes:**
  - `validation_failed` — "Vui lòng điền tiêu đề và nội dung."

#### `PublishAnnouncement`
Draft → published, or a previously expired announcement republished with a fresh expiry (§16.3: "Đăng ngay" / "Đăng lại").

- **Inputs:** `bookshelfId`, `announcementId`, publication time (default now), new expiry?
- **Caller:** `manager`
- **Invariants enforced:** INV-8
- **Audit action:** `announcement.published`
- **Failure modes:**
  - `already_published` — "Thông báo này đã được đăng."

#### `PinAnnouncement` / `UnpinAnnouncement`

- **Inputs:** `bookshelfId`, `announcementId`
- **Caller:** `manager`
- **Invariants enforced:** INV-8 (only one pinned announcement is meaningful at a time on the shelf home per §16.1's "pinned first"; pinning a second one is either exclusive-pin or additive — see open question)
- **Audit action:** `announcement.pinned` / `announcement.unpinned`
- **Failure modes:** none beyond `not_found`

> **Open question.** §16.1 says pinned announcements come first, "most recent next" — implying possibly more than one pinned item, ordered among themselves by recency. Nothing states a cap. Left as multiple-pins-allowed, ordered by pin time, unless the product owner wants a hard limit of one.

#### `HideAnnouncement`
Pulls a showing announcement from public view (§16.3: "Ẩn").

- **Inputs:** `bookshelfId`, `announcementId`
- **Caller:** `manager`
- **Invariants enforced:** INV-8
- **Audit action:** `announcement.hidden`
- **Failure modes:** none beyond `not_found`

#### `SubmitFeedback`
A message to the administrator, from anyone, shelf-scoped or site-wide (the `gop-y` and `lien-he` forms are the same underlying command with `bookshelfId` present or absent).

- **Inputs:** `bookshelfId?` (absent = site-wide), sender name, phone, subject?, body
- **Caller:** `guest`, `reader`
- **Invariants enforced:** INV-8
- **Audit action:** `feedback.submitted`
- **Failure modes:**
  - `rate_limited` — see §8 (stated in the UI itself: "Mỗi số điện thoại gửi tối đa 3 góp ý mỗi ngày")
  - `validation_failed` — "Vui lòng điền đầy đủ các trường bắt buộc."

#### `MarkFeedbackRead` / `ResolveFeedback`
`new → read` / `→ resolved` (§5.4's three-state status).

- **Inputs:** `feedbackId`
- **Caller:** `super_admin`
- **Invariants enforced:** INV-8
- **Audit action:** `feedback.read` / `feedback.resolved`
- **Failure modes:** none beyond `not_found`

#### `ArchiveFeedback`

- **Inputs:** `feedbackId`
- **Caller:** `super_admin`
- **Invariants enforced:** INV-8
- **Audit action:** `feedback.archived`
- **Failure modes:** none beyond `not_found`

> **Open question.** §5.4 defines Feedback's `status` as exactly three values: `new`, `read`, `resolved`. The built admin inbox (`src/app/quan-tri/gop-y/page.tsx`) has a fourth button, "Lưu trữ" (archive), with no corresponding status in the domain model. Either the domain model needs a fourth status, or "archive" is meant to be a filter/soft-delete over `resolved` items rather than a true status transition — the requirements don't say which, so this command is listed provisionally.

> **Open question — feedback visibility scope.** §13.2 groups "view feedback, resolve feedback" under the general *Community* permission category, without restricting it to `super_admin`. The only built screen for it, however, is the admin-only inbox at `/quan-tri/gop-y`, which lists messages across every shelf in one view. Whether a shelf's own `manager`/`admin` should see (and resolve) feedback addressed to *their* shelf specifically is not resolved by either document — this catalogue follows the built UI and restricts these two commands to `super_admin`.

### 4.5 Administration (`super_admin`, **Global** unless noted)

#### `CreateBookshelf`
Provisions a new tenant (§16.4: "Create and edit shelves, including the slug that becomes the URL").

- **Inputs:** name, slug (fixed after creation), description?, location, keeper name + phone, opening hours, timezone, locale, initial lending-policy values (defaulting from `GetSystemSettings`)
- **Caller:** `super_admin`
- **Invariants enforced:** INV-8
- **Audit action:** `bookshelf.created`
- **Failure modes:**
  - `slug_taken` — "Đường dẫn này đã được dùng cho tủ sách khác."
  - `validation_failed` — "Vui lòng điền đầy đủ các trường bắt buộc."

> **Open question.** No dedicated "new bookshelf" screen exists among the 45 built pages (only the edit form at `/quan-tri/tu-sach/[id]`); this command is included because §16.4 explicitly describes creation as part of this page's job.

#### `UpdateBookshelfSettings`
Edits a shelf's profile and lending policy together, in one save (the built settings form submits both under a single "Lưu cài đặt" button).

- **Inputs:** `bookshelfId`, changed profile fields (name, description, location, hours, keeper name/phone — **not** the slug), changed lending-policy values (§5.5)
- **Caller:** `super_admin` — see the open question below on whether a shelf's own `admin` role should also be able to call this
- **Invariants enforced:** INV-8; the slug is immutable after creation ("Đường dẫn không đổi được sau khi tạo") — attempting to change it is a validation failure, not silently ignored
- **Audit action:** `bookshelf.updated`
- **Failure modes:**
  - `slug_immutable` — "Đường dẫn tủ sách không thể thay đổi."
  - `validation_failed` — "Vui lòng kiểm tra lại thông tin."

> **Open question.** The manager-facing settings page (`src/app/.../quan-ly/cai-dat/page.tsx`) is read-only and states "Chỉ quản trị viên mới đổi được các mục này" ("only the *quản trị viên* can change these"). Vietnamese "quản trị viên" is used in this codebase both for the shelf-level `admin` role (labelled "Quản trị tủ sách" in the managers list) and for the global `super_admin` role (labelled "Quản trị viên" there too). The only settings-*edit* screen actually built lives under the super-admin-only `/quan-tri` route tree, not under any shelf-scoped route a shelf `admin` could reach. Whether a shelf's own `admin` role is meant to have an equivalent in-shelf settings-edit screen — matching the role hierarchy's implication that `admin ⊃ manager` should include *more* than a manager, not the same read-only view — is unresolved by the built UI. This document restricts `UpdateBookshelfSettings` to `super_admin` to match what's actually built, but flags this as very likely a gap: a shelf `admin` role with no privilege beyond a `manager` (read-only settings) makes the role distinction in §13.1 pointless.

#### `ArchiveBookshelf`
`active → archived` — hides the shelf from the portal, retains everything (§16.3: "Lưu trữ sẽ ẩn tủ sách khỏi cổng, nhưng giữ lại toàn bộ dữ liệu và lịch sử").

- **Inputs:** `bookshelfId`
- **Caller:** `super_admin`
- **Invariants enforced:** INV-8
- **Audit action:** `bookshelf.archived`
- **Failure modes:**
  - `already_archived` — "Tủ sách này đã được lưu trữ."

#### `AssignManager`
Grants `manager` or `admin` role at a specific shelf to an existing user (creates or upgrades their `membership` there) — §16.4 "Giao quyền quản lý".

- **Inputs:** `userId` (or the identifying fields to find/create one), `bookshelfId`, role (`manager` \| `admin`)
- **Caller:** `super_admin`
- **Invariants enforced:** INV-8; §4 assumption 8 — a person has at most one role per bookshelf, so this either creates a fresh membership or overwrites the role field on an existing one, never adds a second role row
- **Audit action:** `membership.role_assigned`
- **Failure modes:**
  - `not_found` — "Không tìm thấy người dùng này."

#### `RevokeManager`
Demotes a `manager`/`admin` back to `reader` at that shelf. Membership and its audit trail are retained (§16.4: "Revocation requires confirmation and states plainly that history is retained").

- **Inputs:** `membershipId`
- **Caller:** `super_admin`
- **Invariants enforced:** INV-8, INV-12 (nothing in the person's audit history is touched)
- **Audit action:** `membership.role_revoked`
- **Failure modes:**
  - `not_a_manager` — "Người này hiện không giữ vai trò quản lý."

#### `PromoteSuperAdmin`
Grants the global `super_admin` role — listed as its own command because §13.2 names it as a distinct permission from `AssignManager`/`RevokeManager`, which only ever act at shelf scope.

- **Inputs:** `userId`
- **Caller:** `super_admin`
- **Invariants enforced:** INV-8
- **Audit action:** `user.promoted_super_admin`
- **Failure modes:**
  - `already_super_admin` — "Người này đã là quản trị viên hệ thống."

> **Open question.** No button in the 45 built screens performs this distinct from `AssignManager`'s "Giao quyền quản lý" action — the managers list shows one existing `super_admin` (role `admin` in that screen's local type, distinct from the shelf-level `shelf-admin`) but no visible affordance to create another. Listed because §13.2 names the permission explicitly.

#### `CreatePost` / `UpdatePost` / `PublishPost`
Global blog articles (§16.4: "Manage posts"; §5.1: "written by the super admin").

- **Inputs (create):** title, excerpt, rich body, cover?
- **Inputs (update):** `postId`, changed fields
- **Inputs (publish):** `postId`, publication time (default now)
- **Caller:** `super_admin`
- **Invariants enforced:** INV-8
- **Audit action:** `post.created` / `post.updated` / `post.published`
- **Failure modes:**
  - `validation_failed` — "Vui lòng điền tiêu đề và nội dung."
  - `already_published` — "Bài viết này đã được đăng." (`PublishPost` only)

#### `UpdateSystemDefaults`
Default lending-policy values applied to newly created shelves (§16.4's system settings screen). Changing this never retroactively touches an existing shelf's own settings.

- **Inputs:** default `loan_days`, `max_concurrent_loans`, `hold_days`
- **Caller:** `super_admin`
- **Invariants enforced:** INV-8
- **Audit action:** `system_settings.updated`
- **Failure modes:**
  - `validation_failed` — "Giá trị phải lớn hơn 0."

### 4.6 Notifications (cross-cutting)

#### `MarkNotificationRead` / `MarkAllNotificationsRead`

- **Inputs:** `membershipId`, `notificationId` (single) or none (all)
- **Caller:** `reader` (own notifications only)
- **Invariants enforced:** INV-8 is arguably overkill for a read-flag flip with no business consequence — see the open question in §7
- **Audit action:** `notification.read` — see §7 for why this one is questionable
- **Failure modes:** none beyond `not_found`

---

## 5. The lending flow in detail

### `LendCopy` end to end

The UI already filters out anything that would fail (§16.3: "Blocking conditions... surface as a clear message before the confirm step, never as an error afterwards") — `SearchBooksForLending` and `SearchReadersForLending` annotate every row with its block reason so a manager never reaches the confirm screen with an invalid pair. But the command itself cannot trust that filtering, for two reasons: the data can go stale between the search screen and the tap on "Xác nhận cho mượn" (seconds, but on a shared shelf that's enough — see §6), and a command is a contract with any future caller, not just this UI.

`LendCopy` therefore re-checks everything, in this order, inside one transaction:

1. **Copy exists and belongs to this shelf** (INV-10 — a copy id from another tenant must be structurally unreachable, not merely rejected here as a courtesy).
2. **Copy is not lost or retired** (INV-7). Checked before availability because a lost/retired copy needs its own message, not a generic "not available."
3. **Copy is `available`** (INV-3). If another manager's `LendCopy` or `HandoverRequest` committed first, this check — backed by a datastore constraint, not just this read (§6) — fails here with `copy_not_available`.
4. **Reader's membership is `active`** (INV-4).
5. **Reader is under `max_concurrent_loans`** (INV-5), counted at write time, not from a value read earlier in the flow.
6. **Write, atomically:** create the `Loan` row (`status = active`, `due_on = today + loan_days`, borrower, lending manager, originating request = none), transition the copy to `on_loan`, write the audit record (INV-8).

Why the order matters: lost/retired and availability are checked before the reader-side checks, because a manager who searched for a book that's already gone needs to know that immediately, not after they've also picked a reader. If any check fails, nothing commits, and the manager sees the named error and returns to the relevant step — never a stack trace, never a half-created loan.

The `HandoverRequest` command runs the identical sequence with one substitution at step 3: the copy must be `held` **and** the collecting reader must be the one the hold was created for (INV-3's second clause), and a fourth check is inserted — the hold must not have expired (computed on read, §8, exactly like everywhere else derived state appears).

### `ReceiveReturn` end to end, including the queued-reader decision

1. **Find the loan** — `SearchLoansForReturn` by book or reader; the manager selects the specific active loan (there is exactly one active loan per copy per INV-1, so this is unambiguous once a copy is chosen).
2. **Assess condition** — the six-value picker (§9) defaults to *Nguyên vẹn*; note and photo fields only appear once a worse grade is chosen, matching §16.3's "the common case is two taps."
3. **Check the queue** — the same screen surfaces, before confirmation, whether anyone is waiting for this title (`GetBorrowRequestQueue`'s data, read at this point). If so, the manager is offered "Giữ chỗ cho [name]" or "Không giữ chỗ, trả về kệ" as part of the same form.
4. **The manager decides — nothing here is automatic.** The requirements are explicit about why (§16.3): "Nothing happens automatically: the manager decides, because the next reader may not be standing there." A queued reader who registered from home might not be at the shelf that Sunday; only a human knows that.
5. **Confirm, atomically:** `ReceiveReturn` closes the loan (`status = returned`, return time, return condition, receiving manager) and writes a `ConditionAssessment` row. If the manager chose to hold for the next reader, the *same* transaction also performs the effect of `ApproveRequest` on that request — assigning this newly-freed copy, setting `hold_expiry`, transitioning the copy `available → held` in the same beat it would otherwise have gone `on_loan → available`, so the copy is never observably `available` for an instant in between.

This is the one place in this catalogue where a single user action deliberately produces two audit-worthy facts — the loan closing and, conditionally, a new hold opening — because they are two different things happening to two different records (a `Loan` and a `BorrowRequest`), even though the manager experiences them as one tap. Both audit rows share the same transaction and timestamp context, so an auditor reading the log sees them as obviously paired.

---

## 6. Concurrency

§2 of the requirements states the risk plainly: two managers can lend the same copy in the same second, from two phones, standing at the same physical shelf. This is not a hypothetical — it's the normal failure mode of a system whose primary UI is "several volunteers with phones near one shelf."

**What must happen:** whichever `LendCopy` (or `HandoverRequest`, or `ApproveBorrowRequest` assigning a copy) transaction *commits first* wins. The other must fail cleanly, with the named error `copy_not_available`, and — critically — must not have written a `Loan` row at all. There is no "undo" here because there is nothing to undo; the losing transaction simply never succeeded.

**Why this cannot be an application-level check alone.** A naive implementation reads the copy's status, sees `available`, and then writes the loan. Two managers' app-server processes can both perform that read before either performs the write — both see `available`, both proceed, and without a datastore-enforced guarantee, both writes succeed, producing two active loans for one physical book. This is exactly the failure INV-1 rules out: "This must be guaranteed by the datastore, not by application checks." A read-then-write pattern, however careful, has a race window between the two steps; only the datastore closing that window — via a uniqueness constraint, an exclusion constraint, or a transaction isolation level that turns the second writer's commit into a conflict — actually prevents it.

Concretely, whichever storage engine is chosen must offer *one* of:
- a constraint that makes "more than one row with `status = active` for a given `copy_id`" simply impossible to persist (e.g. a partial/filtered unique index on `loans(copy_id) WHERE status = 'active'`), so the second writer's `COMMIT` fails outright and the application maps that failure to `copy_not_available`; or
- a serializable (or stricter) transaction isolation level combined with row locking on the copy itself, so the second transaction blocks or aborts rather than silently succeeding; or
- an equivalent optimistic-concurrency scheme (a version/`updated_at` compare-and-swap on the copy row) that the second writer's update fails against, detected and translated to the same named error.

Whichever mechanism is chosen, the requirement is the same: the guarantee lives in the datastore's transactional machinery, not in a `SELECT` the application trusts.

---

## 7. Notifications

Per §15, notifications are in-app only, no email, surfaced as a bell with an unread count. **Managers get none, by design** — "this avoids notification fatigue for volunteers and removes any dependency on timely background work." No command in §4 writes a manager-facing notification; managers work entirely from the dashboard's live counts (`GetManagerDashboard`).

Every reader-facing notification below is written by the command named, in the same transaction as the state change it announces (matching the general rule that a command changes one thing and records it truthfully):

| Notification | Written by |
|---|---|
| Đăng ký được duyệt | `ApproveMembership` |
| Đăng ký bị từ chối | `RejectMembership` |
| Yêu cầu mượn được duyệt (kèm hạn đến nhận) | `ApproveBorrowRequest` (and the equivalent effect inside `ReceiveReturn` when it holds for the next reader) |
| Yêu cầu mượn bị từ chối | `RejectBorrowRequest` |
| Sách đã sẵn sàng để nhận | Same trigger as "yêu cầu mượn được duyệt" above — the requirements list these as two separate notification types in §15, but every command in this catalogue that creates a hold is the same event a reader experiences as "it's ready." This document treats them as one underlying trigger with (at most) two message templates, and flags that reading as an inference rather than something §15 states outright. |
| Sắp đến hạn trả | Not written by any command in §4 — see below |
| Quá hạn | Not written by any command in §4 — see below |
| Bình luận được duyệt | `ApproveComment` |

**Due-soon and overdue notifications are the one place this document departs from "every notification is written by a command."** §8 is emphatic that overdue *status* is computed on read, never written by a job. But a *notification* is a discrete, persisted, dismissible record — it cannot be computed on read the way a status badge can, because "has this reader already been told" is itself state. Some process must, on a schedule, compare `due_on` against today across all active loans and write the due-soon/overdue notifications once. §8 explicitly permits this category of background work — "tidying up expired holds as housekeeping rather than as correctness" — and a scheduled notification sweep is the same kind of housekeeping: if it doesn't run for a few hours, nothing a user can observe becomes *wrong* (the loan's overdue badge is still correct, computed live), only *late to be told*. This is a narrow, deliberate exception, not a contradiction of §8.

---

## 8. Rate limiting

Two operations are explicitly open to unauthenticated (`guest`) callers and are named spam vectors in the requirements (§2):

| Operation | Limit stated | Source |
|---|---|---|
| `CreateGuestBorrowRequest` | Rate-limited by a hashed identifier; honeypot field required | §5.4: "Guest requests are rate-limited by a hashed identifier." No numeric threshold is given anywhere in either source document. |
| `SubmitFeedback` | 3 per phone number per day | Stated verbatim in the built UI (`src/app/tu-sach/[shelf]/gop-y/page.tsx`): "Mỗi số điện thoại gửi tối đa 3 góp ý mỗi ngày, để tránh tin rác." |

Both use a **hashed** identifier (§5.4), not the raw phone number, so the rate-limit store itself doesn't become another place personal data sits in plaintext.

> **Open question.** `CreateGuestBorrowRequest`'s limit is described qualitatively ("rate-limited by a hashed identifier") but no concrete number appears anywhere, unlike feedback's explicit "3 per day." A sensible default would mirror feedback's figure, but that is this document's suggestion, not a requirement already stated.

`RegisterMembership` (public self-registration) is not named as rate-limited anywhere, despite also being an open, unauthenticated form that writes a database row. Given it requires substantially more input than a guest borrow request (§16.1's full field set) and produces a `pending` record a manager must act on rather than anything immediately consequential, the absence of a stated limit may be intentional — but it is not confirmed as such by either source document, so it is listed here as unaddressed rather than assumed fine.

No other operation in this catalogue is open to `guest` callers except the read-only public queries in §3.1, which carry no state-changing risk and are addressed only by ordinary infrastructure-level abuse protection (outside this document's scope — see §9).

---

## 9. What this document does not decide

Deliberately out of scope, per this document's own charter:

- **Transport** — REST, GraphQL, RPC, server actions, or anything else. An operation's name and contract must survive any of these unchanged.
- **Auth mechanism** — how a caller proves they are a given `userId` with a given `membershipId`'s role at a given shelf. Session cookie, JWT, magic link (there is no email in v1, per §4) — unspecified.
- **Session storage** — where "who is calling" lives between requests.
- **Framework** — Next.js is the current UI's framework (visible from the route tree), but nothing here depends on it, and the backend need not share it.
- **ORM / persistence layer** — this document specifies *what the datastore must guarantee* (§6's concurrency constraint, INV-1 through INV-12 generally) but not which database, which query builder, or which migration tool delivers those guarantees.

**Any candidate stack must be able to satisfy, without exception:**

1. Every invariant in §6 of the requirements, each covered by a named test (§21's Definition of Done).
2. Tenant scoping (INV-10) as a structural property — not something a developer has to remember to add to a query.
3. Derived state (§8) staying derived — overdue, hold expiry, and availability computed at read time, never cached into a field a background job updates.
4. The transactional pairing this document repeats throughout: a command's state change and its audit record commit together or not at all (§14), and the specific datastore-level concurrency guarantee described in §6 — because no amount of careful application code substitutes for it.

Anything a stack cannot do from that list is not a viable candidate, regardless of its other merits.
