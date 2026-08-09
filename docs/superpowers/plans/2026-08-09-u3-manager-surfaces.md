# U3 · The manager surfaces

**Blocked by:** U1 (the seam), U2 (`Viewer`, the fixture guard, the wired-page link guard). **Blocks:** nothing.

This is the last large Phase 1 UI gap. After it, what remains of Phase 1 is the audit browser and CSV export.

---

## 1. Reconciliation, before anything else

Every plan in this project has gone stale, and every reconciliation pass has found something. Verify against `main` at `7211997` before starting. In particular:

- Which manager queries actually exist under `src/domain/*/queries/`, and their **real** signatures and return shapes. Do not trust this document's list.
- Which of the commands these screens post to exist, and their **real** inputs. B1 shipped the catalogue commands, B2a the membership lifecycle, B2b the profile-change and parish-unit ones, C1 lending.
- `src/lib/page-data.ts` — `loadPage` passes a **third argument**, the `Viewer`, resolved once in the seam. U2 established that and said U3 should take the manager shell's identity from it rather than growing a second read of `users`.
- The three architecture guards U1 and U2 built, because they will fire on this work: `pages-reading-the-database-are-dynamic`, `a-wired-page-renders-no-fixtures`, and `bookshelves-public-columns` (whose per-column exemptions each carry a justification you must match if you need another).

## Reconciliation against shipped code

Done before wave 1, against `main` at `7211997` — which is still `main`'s head, so the base this document names is the base it was read against. Every row was verified by opening the file at the line given; the two rows that make a claim about a *test* were verified by running that test's own functions over the file in question rather than by reading them.

| The plan says | The code says | Consequence |
|---|---|---|
| §2: `quan-ly/nguoi-doc/moi` "posts `RegisterMembership` on a reader's behalf" | `registerMembership` (`src/domain/members/commands/register-membership.ts:31`) is the **guest's own** registration. Registering on somebody's behalf is two *other* commands: `registerMemberOnBehalf` (`register-member-on-behalf.ts:28`, creates `pending`) and `managerRegisterReader` (`manager-register-reader.ts:31`, creates `active`), whose docstrings say they "disagree about `pending` on purpose" | The named command is the wrong one, and the right one is a choice this plan does not make. BR:523 puts the readers-list form on `registerMemberOnBehalf` ("Registering on behalf still creates a pending application"); the quick-lend escape hatch is `managerRegisterReader`. Posting `registerMembership` would post a screen behind `requireManager` to a command that has none. Wave 2's decision, recorded here so it is a decision |
| §1: the three guards "will fire on this work" | `a-wired-page-renders-no-fixtures.test.ts` cannot see the manager shell at all, in **both** halves. `routes()` (`:89-100`) reads only each route file's own import list, so `manager-shell.tsx:25`'s `import { donationQueue } from "@/lib/fixtures"` is invisible although six wired C1 pages render it. And `resolveRoute` (`:184-199`) returns `null` for every href the shell emits: the nav is `` `${base}/${key}` ``, and an interpolated segment resolves only where the directory has exactly one `[dynamic]` child — `src/app/tu-sach/[shelf]` has none. Verified by running `withoutComments`/`linkTargetsIn`/`resolveRoute` verbatim over `manager-shell.tsx`: every nav target came back `null` | The one file this slice repeats across eleven pages was the one file the fixture guard was blind to, in the exact shape its own docstring says it generalises ("`ShelfHeader` imported a fixture… and read as working while doing it"). Wave 1 removes the fixture import and extends the guard to the chrome a wired route renders |
| §4: "Any **new** ordered-and-paged query here inherits both [collation and tiebreak] traps" | `getReadersList` (`src/domain/members/queries/get-readers-list.ts:54`) is an **existing** paged query, and its `order by u.full_name` (`:113`) is neither folded nor tie-broken | The trap is not only ahead of this slice, it is already behind it: the reader list sorts every `Đ` name after every unaccented one under the cluster's `C` collation, and — with `full_name` not unique — repeats and drops rows across page boundaries exactly as `getCatalogue` did. Same defect, same fix as U2's three; corrected in wave 1 with the query the page will read |
| §3.3: the role label "is a translation of an enum… find where that mapping already lives" | It does not live anywhere. Nothing in `src/` maps BR §13.1's `Role` (`src/domain/kernel/tenant.ts:5-13`) to Vietnamese. The only role→label map is `src/app/quan-tri/quan-ly-vien/page.tsx:21-36`, and it is over a *fixture* enum (`"admin" \| "shelf-admin" \| "manager"`) that is not the domain's | The mapping has to be written. What must not be written is the **words**: all three are already shipped — `Quản lý` (`manager-shell.tsx:209`), `Quản trị tủ sách` (`quan-ly-vien/page.tsx:31`, the fixture's per-shelf admin), `Quản trị viên` (`manager-shell.tsx:308`) |
| §2: the dashboard "needs a new one" | True — nothing under `src/domain/*/queries/` answers it. But BR:537 specifies **four** stat cards and two of them (`Yêu cầu mượn`, `Bình luận chờ duyệt`) are C2 and B3; OPS:81's "recent activity feed" needs `audit_log` rendered as BR §14's Vietnamese sentences, which is D2 and which §6 puts out of scope | §3.1's rule is not only about the sidebar. The dashboard ships the two cards that can be answered, BR:537's two big buttons and its shelf totals, and no activity feed. BR:571 forbids inventing a replacement card in as many words: the fourth card "was already chosen for a reason; a fifth card would be a change to that decision, not an addition to it" |
| §3.1: three badges have "no query that could answer them and no page behind them that does anything" | Verified, and verbatim: `manager-shell.tsx:58,60,61,62,63,64` hard-code `5`, `2`, `2`, `donationQueue.length` (`=3`, evaluated), `3`, `1`. But three *further* nav entries — `thong-bao`, `thong-ke`, `cai-dat` — carry no badge and point at fixture pages whose queries are equally absent (`GetAnnouncementsList` (manager) OPS:95, `GetStatistics` OPS:96, `GetShelfSettings` OPS:97; none implemented) | The three §3.1 names are removed. The other three are left, and that is a decision rather than an oversight: §3.1's argument is about an **invented number**, and a plain link to an unfinished page invents nothing. It is flagged because the *link* half of the same argument (U2's removed header links) does apply to them, and this plan does not settle it |
| §2: `quan-ly/sach/mat` — "the lost-copies view — check what exists" | Nothing. No query anywhere selects copies by state across a shelf; `getBookDetailManager` (`get-book-detail-manager.ts:55`) is per-book and per-copy. The two commands the screen needs do exist: `mark-copy-found.ts`, `retire-copy.ts` | A new query, in a later wave. BR:559 is the specification and it is unusually explicit about why the screen exists ("marking a copy found appears in none of them") |
| §2: `quan-ly/qua-han` — "the overdue list — needs a new one" | True. The closest shipped query is `searchLoansForReturn` (`search-loans-for-return.ts:57`), which already derives `isOverdue`/`daysRemaining` — but it requires a search term and returns no borrower phone, which BR:573 makes the whole point of the screen ("that phone number is the actual mechanism by which books come back") | A new query, in a later wave. Not a widening of the return search |
| §3.5 / the task brief: the dashboard's specified shape is at OPS §3.2 | `GetManagerDashboard` is `OPERATIONS.md:81`, inside **§3.3 Manager** (which begins at `:77`). §3.2 is the reader section and its dashboard is `GetMyDashboard` (`:63`), a different operation for a different caller | The shape is specified and quotable — "Counts: overdue, pending registrations, pending requests, pending comments; shelf totals; recent activity feed" — one section along from where it was cited |
| §3.3: "`loadPage` already hands each page a `Viewer`. Use it" | True (`src/lib/page-data.ts:261-264`), and `Viewer` (`:49-56`) carries `name` and nothing else — no role | The role must either widen `Viewer` or be read from `ctx.actor.role` in each of the eleven pages. Wave 1 widens `Viewer`, which is what its own docstring anticipates ("Adding that field then is one line here; widening a positional string parameter across forty-six pages is not") |
| §3.4: "Each of those commands already exists and already enforces its own permissions" | Verified, all five: `approveMembership` (`approve-membership.ts:41`), `rejectMembership` (`:23`), `approveProfileChange` (`approve-profile-change.ts:88`), `rejectProfileChange` (`reject-profile-change.ts:52`), `createBook` (`create-book.ts:47`) — each opens with `requireManager` | Nothing to build; nothing to re-check in a page |
| §2: `quan-ly/sach/` → `getBooksList` | Exists, `get-books-list.ts:52`, `(tx, ctx, { q?, category?, sort?: "recent" \| "title", page?, pageSize? })` → `{ rows, page, pageCount, total }`. Already folded and already tie-broken on `slug` (`:148-151`) | Wave 1 wires it unchanged. It is the one paged query in this slice that already survives its own page boundaries |
| §2: `getReadersList`, `getReaderDetail`, `getPendingRegistrations`, `getPendingProfileChanges` | All four exist — `get-readers-list.ts:54`, `get-reader-detail.ts:61`, `get-pending-registrations.ts:32`, `get-pending-profile-changes.ts:84` — all `(tx, ctx, …)` and all opening with `requireManager` | The plan's list is right about existence. See the `getReadersList` row above for the one that is not right about correctness |
| §3.5: overdue "is derived on read… since `20260808_14_olibra_now.sql`" | True. `loans_current` computes `is_overdue` and `days_remaining` against `olibra_now()`, and `unit-of-work.ts` sets `olibra.now` transaction-locally from `ctx.clock` | The badge count and the dashboard card are both testable by moving a `fixedClock`, with no write and no job — and wave 1 does test them that way |
| §4: "`users` has no RLS at all" | True — `0010_rls.sql`'s loop comment names `users`, `categories` and site-wide `feedback` as the three tables that get no policy, and `users` is absent from the array at `:60-65` | Every count and every join in this slice reaches a person through `memberships`, never through `users` alone. The badge counts do this even where a `users` join would have been shorter |

**What none of it changes.** The slice is buildable as specified and no shipped access gate is wrong. The corrections above are one wrong command name, one existing query with U2's paging defect, one absent mapping the plan assumed existed, one guard that could not see the file this slice is about, and a dashboard whose specified content is half unanswerable.

## 2. What this slice is

The volunteer's whole working surface, in one pass, because these pages share a shell and a shell that is half real is worse than one that is honestly fixture:

| Page | Query |
|---|---|
| `quan-ly/` | the dashboard — needs a new one |
| `quan-ly/sach/` | `getBooksList` |
| `quan-ly/sach/moi` | posts `CreateBook` |
| `quan-ly/sach/mat` | the lost-copies view — check what exists |
| `quan-ly/nguoi-doc/` | `getReadersList` |
| `quan-ly/nguoi-doc/[id]` | `getReaderDetail` |
| `quan-ly/nguoi-doc/moi` | posts `RegisterMembership` on a reader's behalf |
| `quan-ly/dang-ky-cho-duyet` | `getPendingRegistrations` |
| `quan-ly/doi-thong-tin` | `getPendingProfileChanges` |
| `quan-ly/qua-han` | the overdue list — needs a new one |
| the shell | the badge counts — need a new one |

## 3. Decisions

### 3.1 A badge for a slice that has not shipped shows nothing — not zero

`manager-shell.tsx` hard-codes six counts: `Đăng ký chờ duyệt 5`, `Đổi thông tin 2`, `Yêu cầu mượn 2`, `Tặng sách 3`, `Quá hạn 3`, `Bình luận 1`.

Three of those belong to slices that do not exist. **Yêu cầu mượn** is C2, **Tặng sách** and **Bình luận** are B3. There is no query that could answer them and no page behind them that does anything.

Showing the fixture number is a lie. Showing `0` is a different lie — a volunteer reads "no comments waiting" and stops checking. **Remove the badge, and the nav entry with it**, exactly as U2 removed the header links to unwired pages, and for the same stated reason: mixed into a shell whose other half is real, an invented number is indistinguishable from data.

Three badges *can* be answered: `Đăng ký chờ duyệt`, `Đổi thông tin`, `Quá hạn`. They get a real count.

### 3.2 The badge counts are one query, not six

Six counts across four tables, on every manager page render. One query returning one row. `runQuery` is read-only and already scoped, so the counts are per-shelf by RLS rather than by a `where` clause anyone can forget — and that is worth a test, because a count is exactly the shape of query where a missing predicate looks like a working feature.

### 3.3 The shell's identity comes from the `Viewer` the seam already resolved

`manager-shell.tsx` renders a hardcoded "Maria Nguyễn Thị Lan / Quản lý" on every manager page — including the six C1 wired, which have been showing real books under a fixed name since U1.

`loadPage` already hands each page a `Viewer`. Use it. Do not add a second read of `users`, and do not resolve the name in each page.

The role label is a display of `ctx.actor.role`. It is a translation of an enum, not new copy — find where that mapping already lives rather than writing a second one.

### 3.4 Every page that writes goes through a server action, and refusals render as sentences

U1 established the shape: `submitCommand` catches `RuleViolated` and returns the code; the page renders it through `messageFor`; **anything that is not a `RuleViolated` keeps throwing**, because swallowing a `PostgresError` into a friendly Vietnamese sentence tells a volunteer their input was wrong when the database was down.

The screens that write here are: approve/reject a registration, approve/reject a profile change, create a book, register a reader on their behalf. Each of those commands already exists and already enforces its own permissions — **do not reimplement `requireManager` in a page or an action.**

### 3.5 Two pages need a query nobody has written

**Overdue** (`qua-han`) and the **dashboard**. Both are reads over `loans_current`, which since `20260808_14_olibra_now.sql` derives `is_overdue` and `days_remaining` from the injected clock — so both are testable by advancing a `fixedClock` with no job running and no write, and both must be. That is BR §8's rule and the thing most likely to be quietly broken by adding a column.

Check `sach/mat` (lost copies) too — BR §1.4 names it as Phase 1, "the lost-copies view that gives `lost → available` a screen to actually happen on".

## 4. Risks specific to this slice

- **Volume.** Eleven pages. Do them in waves, and get the shell and one page reviewed before repeating the pattern ten times — U1 did exactly that and it was right.
- **The `Đ` collation trap.** U2 found `order by title` sorting `Đất Rừng Phương Nam` after `Vĩnh Long` under the cluster's `C` collation, and then found that folding the sort without a unique tiebreak silently **loses rows across pages** — 304 titles collected, 229 unique. Any new ordered-and-paged query here inherits both traps.
- **`getReaderDetail` returns a child's date of birth, phone and parish placement.** It is the most identifying read in the system. Check what the page renders against BR §16.1, and remember `users` has no RLS — scoping comes from the `memberships` join, never from the row.

## 5. Acceptance

- [ ] The shell names the person actually signed in, with their real role
- [ ] Every badge shows a real count, or is absent — no badge shows an invented or misleading number
- [ ] Badge counts are per-shelf, and a test proves it is RLS doing it
- [ ] A reader reaching any of these URLs gets a 404 that does not confirm the page exists
- [ ] Overdue state is derived on read — a test advances a `fixedClock` and the row changes with no write and no job
- [ ] Every ordered-and-paged query has a unique tiebreak, tested with titles that fold alike
- [ ] Refusals render their OPERATIONS.md sentence; faults still throw
- [ ] No page in this slice can be served from cache to a different viewer
- [ ] `bun run check` and `bun run check:links` green, and **CI green on the PR**

## 6. Out of scope

The audit browser and CSV export (D2 / B4 — the two remaining Phase 1 items); comments, announcements, donations (B3); borrow requests and the queue (C2); renewals (C3); notifications (D1); the reader's own pages `toi/*`; `/quan-tri/*` (super-admin, Phase 3).

## 7. Wave 2, and the decisions it had to make

Wave 2 shipped the remaining eight pages, their two missing queries and their eight server actions. Everything below is a decision this document left open or got wrong; each one is also argued at length in the file that carries it, and this section exists so the *set* of them is readable in one place.

**The on-behalf command is `registerMemberOnBehalf`.** §2 named `RegisterMembership`, which is the guest's own registration and has no manager gate; the reconciliation table above narrowed it to two and left the choice here. BR §16.1 settles it in one sentence — "registering on behalf still creates a pending application rather than an active member, so the approval step and its audit record are never skipped" — and BR §4's assumption 3 makes that approval the consent for holding a minor's data. The page's own shipped copy already promised it, above a button reading **Tạo hồ sơ chờ duyệt**. `managerRegisterReader` stays what OPS §4.3 calls it: the quick-lend escape hatch on `quan-ly/cho-muon/nguoi-doc`, a different screen for a different moment. `tests/lib/manager-actions.test.ts` asserts the resulting `status`, because a page pointed at the other command renders and redirects identically.

**The two new queries.** `getOverdueLoans` (`src/domain/circulation/queries/`) is OPS §3.3's `GetOverdueLoans` — borrower, phone, days late, due date, three orderings (which are OPS:93's `sort` input and the fixture `<select>`'s labels, not BR §16.3's; BR:573 specifies one), no search term. `getLostCopies` / `getLostCopyCount` (`src/domain/catalogue/queries/`) back BR:559's screen and the **Đã mất (n)** chip that wave 1 removed for want of them. Neither is paged and both carry a total order anyway.

This line used to end: "Both derive their headline number from `loans_current` against the injected clock, and both have a test that moves a `fixedClock` with no write and no job." That is true of `getOverdueLoans` and false of the other one, in every clause. `getLostCopies`/`getLostCopyCount` do not read `loans_current` at all — they read `book_copies.state`, which is **stored** state written by `ReportCopyLost` and cleared by `MarkCopyFound`/`RetireCopy`, and their only join to `loans` is a `left join lateral` fetching the last borrower's *name*. There is no clock in either, so `lost-copies.test.ts` has no clock-advance test and should not: what it asserts instead is that the two commands BR §7.1 draws out of `lost` empty the screen. The G5/BR §8 "derived on read" property is `getOverdueLoans`', where it is real and tested by moving a `fixedClock` with no write and no job. Recorded because the sentence read as though the same guard covered both queries, and it covered one.

The unpaged decision also does not rest on the parity this section implied. See `get-lost-copies.ts`' own docstring: the two shipped queues drain by manager throughput, whereas a `lost` copy leaves only by an explicit command, so that set is the one thing here that grows monotonically until somebody acts.

**OPS defines no `GetLostCopies`.** Its query table omits one; OPS §4.1 names this exact view as `MarkCopyFound`'s UI trigger, which is why the read is a domain query rather than a `src/lib/` helper beside `readCatalogueCategories`.

**`getReaderDetail`'s `currentLoans` gained `title` and `copyCode`.** It returned a `bookId` and nothing renderable; two joins, no change to what the query admits. Recorded because it is a shipped query's shape changing.

**Four things are deliberately absent, and none of them is an oversight:**

- **Credentials on the registration form.** Nothing in the running application calls `setPasswordHasher`, so any screen that sets a password reaches `NotWired` — a fault, not a refusal. The fields are gone rather than shipped as a 500; `SetReaderCredentials` is the shipped path and BR §16.3 puts it on the reader's detail page. **Wiring the hasher belongs to the slice that wires registration**, and this is the second file to record that it is unwired.
- **A photograph at registration.** `RegistrationInput.avatarUrl` wants a URL to an object already in storage, and the only upload path in this codebase is the avatar lifecycle, which needs a membership that does not exist yet.
- **The reader detail's administrative actions.** All five commands exist; wiring them is five more forms and five more refusal paths, and one of them is the credentials one above. The page is read-only and says so.
- **A reader's loan history.** BR §16.3 asks for it and no query answers it — `getBookDetailManager` has a history per *book*. The fixture page filled the gap with four titles sliced out of `src/lib/fixtures.ts` under this reader's name.

**A defect this wave shipped and `bun run check:links` caught.** `quan-ly/nguoi-doc/[id]` took the URL segment straight to a `uuid` column, so the fixture-era link `/quan-ly/nguoi-doc/minh` was a raw `22P02` and an HTTP 500. The shape check now lives once, in `src/lib/search-params.ts`, shared with `readerFromParam`; the page answers 404 and the query parameter answers an empty state, because one is the router's and one is the volunteer's.
