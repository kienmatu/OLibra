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
