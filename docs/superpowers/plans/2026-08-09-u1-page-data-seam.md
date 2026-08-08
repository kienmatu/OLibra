# U1 · The page-data seam, and the lending screens

**Split out of C1's Task 7**, on that plan's own advice: *"Landing Tasks 1–6 with Task 7 deferred is an honest outcome; landing a half-wired UI is not."*

**Blocked by:** C1 (merged). **Blocks:** every later slice's UI, because this establishes the pattern each one copies.

---

## 1. What this slice is

C1 shipped three commands and three queries that no human being can reach. Forty-seven pages exist under `src/app/`; **not one of them calls `runQuery` or `runCommand`.** `src/app/dang-nhap/actions.ts` is the only file under `src/app/` that touches Postgres at all, and it goes through `signIn`/`landingShelfFor` rather than the kernel.

So this is the first page-level database read in the project. What it decides — how a page gets a connection, how it gets a `TenantContext`, what happens when a refusal is thrown, and what Next.js is allowed to cache — is what forty-six other pages will copy without re-deciding. That is the whole reason it is a slice and not a task.

**Scope: the seam, plus the six lending screens.** Not the other forty-one pages. They keep their fixtures until their own slice.

## 2. The risk that dominates this slice

**Next.js caching is a cross-tenant leak waiting to happen.**

Every guarantee this project has about tenancy is enforced at the database: RLS policies keyed on `olibra.bookshelf_id`, `security_invoker` on both views, a `bypassrls` role used deliberately in exactly one place. All of it is downstream of a query actually running.

A cached render never reaches the database. If Next.js serves shelf A's manager dashboard to shelf B — or to a guest — RLS was not defeated; it was **not consulted**. Nothing in `tests/db/` can see that happen, because no SQL is issued. INV-10 holds and the leak occurs anyway.

Two shapes of it:
- **Static rendering.** A route with no dynamic API gets rendered once at build time and served to everyone. A manager page rendered at build time has no session at all.
- **The Full Route Cache / `use cache`.** A route explicitly or implicitly cached across requests serves one tenant's HTML to another.

**Decision: every page in this seam is explicitly dynamic, and there is an architecture test that says so.** Reading `cookies()` already forces dynamic rendering in the App Router, and the seam reads the session cookie on every call — but relying on that is relying on a side effect of an implementation detail. It is stated directly *and* asserted.

The test is the deliverable, not the setting. It must fail if a lending page loses its dynamic marker.

## 3. Decisions

### 3.1 One pooled connection for the process, not one per request

`dang-nhap/actions.ts` calls `connect()` and `sql.end()` inside every action. That opens and tears down a connection pool per sign-in. It is correct — just wasteful — and it was the right call when it was the only database caller in the app.

It is the wrong pattern to copy onto every page render. The runtime here is a long-lived Bun process (`compose.yaml`'s `app` service), not a serverless function, and `postgres.js` is a pool already.

**`src/db/client.ts` gains `pool()`** — a module-level cached `Sql` that is never `end()`ed. `connect()` stays, unchanged, for the migration runner, the seed and the tests, which each want their own lifetime.

Two things `pool()` must get right, both of which are silent when wrong:

- **Dev hot-reload.** Next.js re-evaluates modules on every edit, so a module-level `let` leaks a pool per reload until Postgres refuses connections. Cache it on `globalThis` behind a symbol.
- **`prepare: false` must survive.** `connect()`'s comment says why: transaction-mode pooling is compatible with `set local`, and session-mode is not, and the failure mode "is silent cross-tenant leakage rather than an error." `pool()` must not construct its own options object and quietly drop it. Build it through `connect()`.

**`dang-nhap/actions.ts` moves to `pool()` too.** Leaving it on `connect()`/`end()` gives the project two connection patterns and no way for the next person to tell which is intended.

### 3.2 The seam is one function, and it owns the whole sequence

```ts
// src/lib/page-data.ts
export async function loadPage<T>(
  shelfSlug: string,
  read: (tx: Tx, ctx: TenantContext) => Promise<T>,
): Promise<T>
```

It reads the session cookie, resolves the `TenantContext` with `contextFor`, and runs `read` through `runQuery`. One function, so the sequence cannot be got subtly wrong forty-six times.

**It lives in `src/lib/`, not `src/domain/`.** `tests/architecture/boundaries.test.ts` forbids the domain importing `next/*`, and this reads `cookies()`. The dependency runs the correct direction: the surface imports the domain, never the reverse.

**A missing shelf is `notFound()`, not an error page.** `contextFor` throws `NotFound("shelf_not_found")` for a slug that does not resolve. A typo'd URL is a 404, which is what a 404 is for.

### 3.3 Refusals render as sentences, never as stack traces

`errors.ts:11-16` is explicit: *"a screen calls `ERROR_MESSAGES[code]` rather than writing its own wording for a rule it did not define."*

- A **query's** block reason is already an `ErrorCode`. Render it through `messageFor`.
- A **command's** `RuleViolated` is caught by the server action and returned to the form as a code, which the page renders through `messageFor`.
- Anything that is *not* a `RuleViolated` is a real fault and must keep throwing. Swallowing a `PostgresError` into a friendly Vietnamese sentence would tell a volunteer their input was wrong when the database was down.

That last distinction is the one worth a test, because the tempting implementation is `catch (e) { return { error: messageFor(...) } }`.

### 3.4 Authorisation happens in the domain, and the page must not duplicate it

Every C1 command already calls `requireManager` and `requireIdentifiedActor`. A page that renders a manager screen still needs to decide what a reader sees when they navigate to one — but it must not become a *second* definition of who may lend a book.

**The page decides visibility; the domain decides permission.** A reader reaching a manager URL gets `notFound()` — not a redirect to a "you may not" page, which confirms the page exists. The command would refuse them anyway; that refusal is the guarantee, and the page is a courtesy.

### 3.5 Formatting differences from the fixtures are expected

G11 made the seed reproduce the fixtures, so a seeded database should render near-identically. **Near, not exactly.** The fixtures carry pre-computed display strings (`dueOn: "Chúa nhật 20/08"`, `daysLeft`, `borrowedOn: "06/08"` — `src/lib/fixtures.ts:1034-1092`; lines 1022-1033, which this plan originally cited and `src/lib/dates.ts` then copied, are the `Loan` *type*) that the database does not store and `loans_current` derives differently. A diff there is formatting work, not a wrong query.

Dates and numbers go through the locale, never a hand-written format string (SDD §6.6). **With one substitution**: `vi-VN` renders Sunday as "Chủ Nhật" and this codebase says "Chúa nhật" in nine places, so `formatDueDate` replaces that one `formatToParts` part. Shipping both meant the confirm screen and the dashboard it redirects to disagreed inside one session, over the word a parish shelf says most often. Every other weekday, separator and digit order stays `Intl`'s.

## 4. Tasks

**1 — `pool()`**, with the hot-reload cache and the `prepare: false` inheritance. Migrate `dang-nhap/actions.ts`. A test that `pool()` returns the same handle twice and that its options match `connect()`'s.

**2 — `loadPage`**, plus the dynamic-rendering architecture test from §2. Establish it on **one** screen only — `quan-ly/cho-muon/page.tsx`, the simplest: one query, one input, no writes. Review the seam before repeating it.

**3 — the remaining five lending screens**, once the seam is settled:
`cho-muon/nguoi-doc`, `cho-muon/xac-nhan`, `nhan-tra`, `nhan-tra/bao-mat` (which per OPS §4.2 calls `ReportCopyLost`, **not** `ReceiveReturn`), and the two entry points on `quan-ly/sach/[id]`.

The shelf's `settings` are read by the *page*, not inside a query — `searchReadersForLending` takes `maxConcurrentLoans` as a parameter precisely so one place knows where policy configuration lives (BR §5.5 defaults: `loan_days` 14, `max_concurrent_loans` 3, `hold_days` 3).

**4 — the server actions** the confirm buttons post to: `lendCopy`, `receiveReturn`, `reportCopyLost`. Each catches `RuleViolated` and returns the code; each lets everything else throw.

**5 — verify in the browser.** Not by reading the code:

```bash
docker compose up -d && bun run db:migrate && bun run db:seed
```

Walk the three-step lend, the two-step lend from book detail, and the return. Confirm a blocking message appears **before** the confirm step, and that the confirm button then refuses consistently with it — C1's review found exactly that pair disagreeing.

**6 — `bun run check` and `bun run check:links`.**

## 5. Acceptance

- [ ] No lending page can be served from cache; asserted by a test, not by a setting
- [ ] One connection pattern in the whole app, pooled, never `end()`ed per request
- [ ] `prepare: false` provably survives into `pool()`
- [ ] A refusal renders as its OPERATIONS.md sentence; a fault still throws — both tested
- [ ] A reader reaching a manager URL gets a 404 that does not confirm the page exists
- [ ] A manager of shelf A cannot render shelf B's lending screens
- [ ] The three-step lend works end to end against a seeded database, verified in a browser
- [ ] `bun run check` and `bun run check:links` green, and **CI green on the PR** — checked on the badge, not locally

## 6. Out of scope

The other forty-one pages; requests, holds and the queue (C2); renewals (C3); notifications (D1); statistics and CSV export (D2); avatar upload (B2b, though B5 shipped the store it needs).

### 6.1 Deferred during the fix pass, with reasons

Two things this slice touched and deliberately did not finish. Recorded here rather than left silently missing, which is what this section exists for.

**The return form's photo field (BR §16.3:548).** `main` offered "Ghi chú và ảnh" — as a dashed placeholder box reading "Ghi chú và ảnh · hiện khi chọn tình trạng xấu hơn", never a working upload. HEAD offers a real `Ghi chú` textarea and no photo at all, so the field regressed from a promise to an absence. `receiveReturn` already accepts `photo`, and B5 shipped `src/storage/s3.ts` (`put`, `url`, `delete`, `objectKey`), so the pieces exist. **Wiring them is a slice, not a fix**, and specifically:

- **Nothing in the application constructs an `ObjectStore`.** `createObjectStore`/`s3ConfigFromEnv` have no caller outside `src/storage/` and its tests. It needs the `pool()` treatment — one instance for the process, cached where hot reload cannot lose it — and a decision about where it lives, since `tests/architecture/boundaries.test.ts` forbids the domain importing it. That is §3.1 again, for a second resource.
- **The running app has never been given the seven `S3_*` variables.** They are in `.env.example` and in CI as `TEST_S3_*` for the storage suite; whether compose's `app` service passes them is untested because nothing has needed them.
- **Three policies do not exist anywhere.** A maximum upload size, an allowed content-type list, and what a volunteer sees when a photo is rejected. BR does not state any of them, and inventing them here is a decision rather than a fix.
- **A failed `put` has no answer.** `s3.ts` is explicit that storage failure is a 500 with no `ErrorCode` — "putting it in that catalogue would sit an infrastructure fault beside entries that all name something the user can do instead". So a photo the store refuses would lose the whole return, condition assessment included, unless the action decides to write the return anyway. That is a product decision about which half matters more.
- **Nothing renders `condition_assessments.photo_url`.** An upload with no screen that shows it is a write-only field.

It belongs with **B2b's avatar upload**, which is out of scope above for the same reason and needs the identical first three bullets. Whichever slice takes it decides the upload pattern for the project the way this one decided the page-data seam.

**The manager shell's chrome.** `src/components/shell/manager-shell.tsx` still hardcodes "Maria Nguyễn Thị Lan" / "Quản lý" in the sidebar footer and a fixed integer on every nav badge (`5`, `2`, `2`, `donationQueue.length`, `3`, `1`) — on all six now-database-backed screens. A page showing real rows under a hardcoded name reads as working and is not.

Sized honestly, it is two very different halves:

- **The name and role are small.** `loadPage` already resolves a `TenantContext`, but `Actor` carries `userId`, `membershipId` and `role` and no display name, so it needs either one extra `select` beside `readShelf` or a field on `Actor` — and the latter is a kernel change that every command's context construction would have to follow. Perhaps a day, and it is a decision about `TenantContext` rather than a page edit.
- **The badge counts are not.** Six counts across four unshipped slices: pending registrations and profile-change requests (B2), the borrow-request queue (C2), the donation queue (D-something), overdue loans, and comment moderation. OPS §3 defines a query for almost none of them, and inventing six would be exactly the domain change U1 refuses to make.

So: **its own slice**, taken with the first of the forty-one pages, and the two halves can land separately. Until then the chrome is visibly fixture data on screens whose body is not, which is the least confusing of the available wrong states — a badge that read `0` would be a claim, and this is plainly a placeholder.

## 7. Found here, owned elsewhere

Two defects this slice is merely the first to show a volunteer. Both are domain-level and inherited, neither is U1's to fix, and both are recorded at the surface site that renders them so the owning slice finds them from either direction.

**A title with zero copies is described as "đang được mượn hoặc đang giữ chỗ."** `searchBooksForLending` documents the choice deliberately — a title with no copies recorded keeps `copy_not_available`, "because nothing about it is lost or retired" and `ErrorCode` may not gain a third code whose Vietnamese nobody wrote. `src/lib/lending.ts`'s `chooseCopyToLend` reproduces the aggregation so the two screens agree. The consequence is still a sentence that is untrue: a title with no copies at all is not on loan and is not on hold. **Owner: whichever slice adds the code and its sentence** — it is a new entry in `ERROR_MESSAGES` and a new failure mode in OPS §4.1/§4.2, not a surface fix.

**`pending` and `left` memberships both render the *suspended* sentence.** `membershipAllowsNewLoan` (`src/domain/members/policy.ts`) returns `membership_not_active` for every status that is not `active`, and `errors.ts:58` pairs that code with "Tài khoản đang tạm khoá, không thể mượn thêm." A reader whose registration has not been approved yet, and one who has left the shelf, are both told their account is temporarily locked. **Owner: B2's membership lifecycle** — the same one-code-one-sentence split `errors.ts` has already made three times (B1's `validation_failed`, B2a's `reject_reason_required`, C1's `loan_not_active_cannot_void`).
