# P1 · The audit browser and CSV export

**Blocked by:** U3 (merged). **Blocks:** nothing. **This is the last of Phase 1.**

---

## 1. Reconciliation, before anything else

Every plan in this project has gone stale and every reconciliation pass has found something — C1's found 14, one of which would have survived a naive fix; U3's found a paging defect already shipped in a query the plan only warned *new* queries about. Verify against `main` at `f000c19` and write the results into this document as a `## Reconciliation against shipped code` table (`docs/superpowers/plans/2026-08-08-b5-object-storage.md` §2 is the shape).

Verify at least:

- **Every audit action name actually written**, discovered from the code rather than from any list. `runCommand` makes a command *return* its audit entry, so the set is enumerable — find where, and how reliably.
- `src/domain/kernel/audit.ts` — the entry shape, `before`/`after`, `toRow`, and the FORBIDDEN token list that throws `audit_forbidden_field`.
- `audit_log`'s real columns (`before`/`after`, **not** `*_values` — C1's reconciliation had to correct exactly that).
- Whether any query reads `audit_log` today.
- `src/lib/page-data.ts`'s seam, U3's `src/lib/roles.ts` / `membership-status.ts` / `profile-labels.ts` — label maps already exist and must not be duplicated.

## Reconciliation against shipped code

Checked against `main` at `f000c19`. Every row was verified at the file and line
it names; nothing here is inferred from another document.

| The plan says | Live code says | Consequence |
|---|---|---|
| §1: "the set is enumerable — find where, and how reliably" | `AuditEntry.action` is a bare **`string`** (`src/domain/kernel/audit.ts:13`). Nothing constrains it, in either direction | The set is enumerable only by grepping source text. §3.1's preferred compile-time guarantee is *achievable but not present* — it has to be built. See the row below for the shape chosen. |
| §3.1: "the mapping is exhaustive over the action names discovered from the shipped commands" | 34 literal `action: "…"` sites under `src/domain`, **33 distinct** names. One of them is **not under any `commands/` directory**: `registrationAudit` at `src/domain/members/registration.ts:402` writes `membership.registered` for all three registration commands | A discovery rule globbing `*/commands/*.ts` misses the only action a *reader-facing* registration writes. Discovery must be over `src/domain` entire. |
| §1: "`audit_log`'s real columns (`before`/`after`, **not** `*_values`)" | `before jsonb, after jsonb` (`src/db/migrations/0007_audit_notifications.sql:29-30`) | Correct as written. C1's correction holds. |
| — | `audit_log` also has **`context jsonb not null default '{}'`** (`0007:31`, commented "address, device, screen"), and `runAs`'s insert never names it (`src/domain/kernel/unit-of-work.ts:424-432`) | Every row in the system has `context = {}`. The browser must not offer an address/device/screen column: there is nothing behind it. Not a defect — nothing claims to write it — but it is the one `audit_log` column a reader of §3.2 would expect to render. |
| §3.2: "Nothing in the payload is secret — `audit.ts` throws `audit_forbidden_field` rather than trusting the caller. Verify that guard actually covers what this screen will render" | `assertNoSecrets` walks **`entry.before` and `entry.after` only** (`audit.ts:173`). `action`, `entityType` and `entityId` are never inspected | The guard covers exactly the two bags the `<details>` renders, so §3.2's claim holds — but for a narrower reason than "audit.ts guards the entry". The other three fields are an enum, an enum and a uuid, none of them caller free text, which is why they need no guard rather than why they have one. |
| — | `FORBIDDEN` (`audit.ts:66-77`) matches whole tokens, and `propose-avatar-change.ts:178` deliberately stores an **object storage key** under `avatar_object` (`src/domain/members/pending-proposal.ts:67`), which no token matches | The expansion will render a bucket key to any manager of the shelf, and it should. **The original reason given here was factually backwards** and is replaced rather than trimmed: it said the key "is not a credential — the object is served through `src/lib/object-store.ts`, not by knowing its key." The opposite is true. `tests/support/bucket-policy.ts` grants `s3:GetObject` to `Principal: {AWS: ["*"]}` on the whole bucket, its docstring states there are no presigned URLs anywhere in the module, and `src/storage/s3.ts:356`'s `objectUrl()` is string concatenation — **knowing the key is exactly how the object is served.** SDD §6.8's privacy argument is that `objectKey()`'s uuids are unguessable, not that they are gated, which is also why that file refuses `s3:ListBucket`. The conclusion stands on two different facts: (1) the same audit payload already stores the full **public** `avatar_url` (`propose-avatar-change.ts:177-178`), so the key discloses nothing the entry beside it does not; and (2) `decideAndDiscardAvatar` (`src/lib/avatar.ts:249-256`) deletes the object as soon as the request is decided, so a key in a historical entry points at nothing. Recorded so it is not discovered on screen and mistaken for a leak — and so the *reason* it is safe is one a reader can check. |
| §1: "Whether any query reads `audit_log` today" | **Nothing does.** No `select … from audit_log` exists anywhere in `src/`. `get-manager-dashboard.ts:151-155` declines to build the activity feed and says why | `GetAuditLog` is the first reader. There is no shipped query to copy, and no existing behaviour to preserve. |
| §2: the browser is "filterable by actor, action type and date range" | `audit_log_actor on (actor_id, occurred_at desc)` and `audit_log_shelf on (bookshelf_id, occurred_at desc)` exist (`0007:35-36`). There is **no index on `action`** and none on `(bookshelf_id, actor_id, occurred_at)` | BR §14's headline — "what has manager A been doing" — is served by `audit_log_actor`, and that is what makes it fast. The action and date filters ride on top of whichever of the two indexes drives; neither gets its own. Stated rather than measured-and-forgotten. |
| §2: a paged browser ordered by time | `audit_log.id` is `bigint generated always as identity` (`0007:23`); `occurred_at` carries **no unique constraint**, and `toRow` stamps `ctx.clock.now()` per entry (`audit.ts:192`) while `runAs` inserts a command's entries in a loop (`unit-of-work.ts:422`). `addCopies` emits one entry per copy (`add-copies.ts:58`), `deleteParishUnit` one per cascaded child (`delete-parish-unit.ts:101-104`) | **The `Đ`-trap's second half, on a new query.** `order by occurred_at desc` with `limit`/`offset` is not a total order, and a multi-entry command guarantees the ties rather than merely allowing them. `id desc` is the tiebreak and it is free — the identity column cannot tie. This is U2's measured 304→229 defect in a query the plan did not warn about. |
| §1: "label maps already exist and must not be duplicated" | `src/lib/roles.ts:42` (`ROLE_LABELS`), `src/lib/membership-status.ts:38` (`MEMBERSHIP_STATUS`), `src/lib/profile-labels.ts:38` (`PROFILE_FIELD_LABELS`) — all three total `Record`s, all three with `Object.hasOwn` lookups | Reused, not rewritten — `src/lib/audit-log.ts` keys its four marks by *group* rather than by action for the same anti-duplication reason, and `src/lib/exports.ts` builds the CSV headers out of `PROFILE_FIELD_LABELS`. **This row originally claimed "the role word in the sentence's `Quản lý …` prefix is `roleLabel`'s", and the shipped sentence has no role prefix at all.** `auditSentence` (`kernel/audit-actions.ts:468`) renders `{actor} đã {phrase} lúc … ngày …`, and `AuditFacts`' docstring gives the argument for dropping the role BR §14's example carries: `audit_log` stores none, so re-reading today's membership would relabel a demoted manager's entire history "Bạn đọc" — a claim about authority the log never recorded. The behaviour is right and stays; the row is corrected, because the row is what a reviewer checks the reuse claim against. `roleLabel` *is* reused, in `src/lib/exports.ts:98`'s `roleWord`, which is a different surface. |
| §3.1 quotes BR §14's example sentence, "…lúc **14:32** ngày 03/08" | `src/lib/dates.ts` exports `formatDate`, `formatDueDate`, `formatInstant`, `formatYear`. `INSTANT` (`dates.ts:66-71`) has **no `hour`/`minute`** — `formatInstant` renders a date and no time | The example sentence is unrenderable with what ships. A time-of-day formatter is needed, and SDD §6.6 puts it through the locale in `dates.ts` rather than in the page. |
| §3.1: the sentence "is owned by the domain", citing `errors.ts:11-16` | `ERROR_MESSAGES` (`errors.ts:28`) is a closed union of **fixed, complete sentences**. Nothing in this codebase interpolates a domain-owned string | The precedent settles *where* the copy lives, not *what shape* it takes. An audit sentence has to carry a name, a title and a time, so this slice introduces the first parameterised domain copy. Called out because "follow `ERROR_MESSAGES`" would otherwise read as "a flat `Record<string, string>`", which cannot express BR §14's example. |
| §3.1's example: "Quản lý Maria Lan đã cho Giuse Minh mượn *Dế Mèn Phiêu Lưu Ký*" | `loan.created`'s payload is `{ copy_state, borrower_id, membership_id, due_on, request_id }` (`lend-copy.ts:280-293`) — **no title**. `loan.returned`'s is `{ status, copy_state, condition }` (`receive-return.ts:188-192`) — no title and no borrower | BR §14's own example cannot be assembled from a stored payload, and re-deriving the title from `books` today is exactly the rewrite §3.2 forbids (`update-book.ts:170` audits a title *change*, so titles do move). Resolved by widening those two payloads — see §3.2a below. No action name changes. |
| §3.5(c): "not put it in a URL a shared parish phone keeps in its address bar" | There is **no `route.ts` anywhere in `src/app`** — this slice adds the first one | Nothing to copy, and one guard gap: `pages-reading-the-database-are-dynamic.test.ts:108` and `a-wired-page-renders-no-fixtures.test.ts:84` both glob `/(page\|layout)\.tsx?$/`, so a route handler that reaches Postgres is invisible to both. `compose-supplies-storage-env.test.ts:162` already globs the wider set, so the wider glob is this repo's own precedent. Widened here. |
| §4 task 4: "the download route or action they come back through" | `loadPage` calls `notFound()` and `redirect()` from `next/navigation` (`page-data.ts:290, 300-301`) | The page seam cannot serve a route handler, which must answer with a `Response` and a status. The export needs its own short seam beside `loadPage`, not a fourth branch inside it. |
| §3.5: "`ExportReadersCSV` puts every child's name, date of birth, parents' names and phone number into a file" | `getReaderDetail` returns exactly those, plus `email`, `manager_notes`, `approved_at` and `has_credentials` (`get-reader-detail.ts:106-118`). **This row originally said all of them were "rendered on `quan-ly/nguoi-doc/[id]`", and that was false for two.** The page (`nguoi-doc/[id]/page.tsx:150-172` as it then stood) rendered saint name, date of birth, parish rows, father, mother, phone and email, and stopped: `grep -rn "managerNotes\|manager_notes" src --include='*.tsx'` returned nothing, and so did `approvedAt\|approved_at`. The bound was checked against the *query*, which is not what §3.5(b) says | §3.5(b)'s bound is real but it was not met, and the correction is not symmetric. **`manager_notes` is removed from the export** (`exports.ts`, `lib/exports.ts`): BR §5.4's "manager's private notes" are on no screen, have no writer command today, and a later slice shipping the box a volunteer types "bố hay uống rượu, gọi mẹ" into would have put that sentence in a downloadable file with this row certifying the surface as checked. `tests/domain/shelf/exports.test.ts` now writes a note into the column and asserts it does not reach the CSV. **`approved_at` is rendered instead of dropped** — the detail page gains a "Ngày tham gia" row from the same value — because it is a fact a manager has an ordinary use for and the column's timezone correctness is already pinned by a test; a bound that holds for one column and not the other is not a bound. `password_hash` and `username` were never in: `has_credentials` is the boolean the detail query substitutes, and INV-14 is why. |
| §3.5(b) cites "BR §16.1" for what a manager sees of a child | **§16.1 is *Public pages*** — landing, contact, portal, catalogue, book detail (`BUSINESS-REQUIREMENTS.md:488`). The section that governs is **§16.3, Readers**: "Detail view shows the full profile — including the manager-only fields" (`:561`) | The bound being invoked is real; the number was wrong, and a bound is only checkable against the section that states it. Corrected at all four sites it was written: `exports.ts`, `tests/domain/shelf/exports.test.ts`, this row's predecessor, and §3.5(b) below. |
| §3.4: "Three exports over a few hundred books are small" | The seed writes 4 shelves; the largest catalogue in `src/db/seed.ts` is two orders of magnitude below anything that streams | Correct. The exports are unpaged and buffered, and §3.4's instruction is to *say so* rather than discover it — the limit and where it bites are stated in `src/lib/csv.ts`. |

**Superseded, 2026-08-13.** The row above (`FORBIDDEN` / `avatar_object`)
gives its conclusion two independent reasons. Reason (1) — "the same audit
payload already stores the full public `avatar_url`, so the key discloses
nothing the entry beside it does not" — no longer holds: the
avatar-upload-preview-and-compression branch removed `avatar_url` from
`propose-avatar-change.ts`'s payload, which now carries `avatar_object` alone
(see that file's own docstring, "`proposed_values` carries `avatar_object`,
the storage key, and nothing else"). Reason (2) — `decideAndDiscardAvatar`
deletes the object as soon as the request is decided, so a key in a historical
entry points at nothing — was not touched by that branch and still carries the
row's conclusion on its own. The argument above is left as written, since it
was true when made; this note is what keeps a later reader from trusting its
first half.

### 3.2a — what the sentence resolves, and why it is not a re-derivation

An entry stores two different kinds of thing, and they must be read
differently:

- **References** — `actor_id` (`0007:25`) and `entity_id` (`0007:28`), plus any
  id a command chose to put in its payload. An id is not readable. Resolving one
  to a person's name at read time is what a reference is *for*, and it stays
  true when that person's name changes: "this person did it" is the fact, and
  `Maria Nguyễn Thị Lan` is how a volunteer recognises them **today**, which is
  the only way BR §14's "who has been touching whose account" can be answered.
- **Values** — everything inside `before`/`after`. These are printed exactly as
  stored and never looked up. A title in `book.created`'s `after.title`
  (`create-book.ts:149`) is the title as it was typed that day; re-reading
  `books.title` instead would silently restate history the moment
  `UpdateBook` corrects it (`update-book.ts:170` audits precisely that change).

So the rule is: **people are resolved by id, values are printed as stored, and
a value the payload does not hold is not rendered at all.** No category name, no
unit name and no book title is ever read from today's rows.

The price of that rule is the row above: BR §14's own headline example needs a
book title as a *value*, and neither circulation command stores one. Two
choices, both honest, and the second is taken:

1. Leave the payloads alone and drop the title from the loan sentences. BR §14
   names the title in the one example it gives, so this is refusing the
   requirement rather than meeting it.
2. **Widen the payloads.** `lend-copy.ts` and `receive-return.ts` record
   `title` (and, for a return, `borrower_id`) alongside what they already
   record. No action name changes, no entry moves entity, nothing is removed.
   This is the same argument `void-loan.ts:112-115` already makes for putting
   the void reason in the payload as well as on the row: the audit is
   append-only and the column is not.

Entries written **before** this widening carry no title, and the sentence for
them renders without one rather than reaching for `books`. That asymmetry is
the honest shape of an append-only log whose writers improved.

## 2. What this slice is

Two surfaces, both about *looking at what happened*:

- **The shelf's audit browser** (`quan-ly/nhat-ky`), OPS §3.3's `GetAuditLog`, filterable by actor, action type and date range.
- **Three CSV exports** — books, readers, loans. OPS §3.3 calls them "data-export insurance (§2)".

BR §14's last line is a requirement, not a nicety: *"Answering 'what has manager A been doing' is a headline requirement and must be fast."*

## 3. Decisions

### 3.1 The Vietnamese sentence is owned by the domain, and the mapping must be total by test

BR §14: *"The audit browser renders each entry as a readable Vietnamese sentence — 'Quản lý Maria Lan đã cho Giuse Minh mượn *Dế Mèn Phiêu Lưu Ký* lúc 14:32 ngày 03/08' — with the raw before/after values available on expansion."*

`errors.ts:11-16` already settled where copy like this lives: *"a screen calls `ERROR_MESSAGES[code]` rather than writing its own wording for a rule it did not define."* The same holds here. The sentence is a fact about a domain event, not a presentation choice.

**The guard that matters: an audit action with no sentence must never render its raw action name.** `loan.created` on a volunteer's screen is a failure, not a fallback. So:

- the mapping is exhaustive over the action names **discovered from the shipped commands**, not over a hand-maintained list — a hand-maintained list beside a transition graph is exactly what let a suspended reader clear their own suspension in B2a;
- a test fails when a command writes an action the mapping does not cover;
- and the type system should make an uncovered action a compile error if that is achievable, because a test that runs after the fact is the weaker of the two.

### 3.2 Raw before/after is behind an expansion, and it is the *stored* value

BR §14 is precise: readable by default, raw *"for when something is genuinely being investigated"*. Render the sentence; put `before`/`after` behind a `<details>`.

Show what is stored, not a re-derivation. The point of an audit trail is that it says what was recorded at the time — a screen that recomputes a label from today's data would quietly rewrite history when a category is renamed.

**Nothing in the payload is secret** — `audit.ts` throws `audit_forbidden_field` rather than trusting the caller. Verify that guard actually covers what this screen will render, rather than assuming it.

### 3.3 CSV has two traps, and both are specific to this audience

**Excel and Vietnamese.** A UTF-8 CSV opened by double-click in Excel on Windows renders `Đặng Thị Kim Chi` as mojibake unless the file begins with a UTF-8 BOM. The person opening this file is a volunteer with Excel, not an engineer with a text editor — the export exists as *insurance*, and insurance that reads as garbage is not insurance. Emit the BOM, and test for its bytes.

**Formula injection.** A cell beginning `=`, `+`, `-` or `@` is executed as a formula by Excel and LibreOffice. Book titles, reader names and audit reasons are all free text a person typed. Neutralise it, and test with a title that starts `=`.

Neither is hypothetical and neither is caught by "the CSV parses".

### 3.4 An export streams, or it is honest about not streaming

Three exports over a few hundred books are small. Say what the limit is and where it bites, rather than discovering it — U3's lost-copies query shipped a false parity argument about being unpaged and had to be corrected.

### 3.5 A CSV of children is a disclosure surface

`ExportReadersCSV` puts every child's name, date of birth, parents' names and phone number into a file that leaves the system. It is `manager`-gated and BR §2 authorises it, so this is not a reason to refuse — it *is* a reason to (a) make the gate provable by test, (b) put nothing in it that BR §16.3 does not already show a manager on screen, and (c) not put it in a URL a shared parish phone keeps in its address bar.

*(b) said "§16.1" when this plan was written. That section is *Public pages* and says nothing about a manager's view of a child; §16.3, Readers, is the one that does — "Detail view shows the full profile — including the manager-only fields". Corrected in review, along with the three other places the wrong number had been copied to. See the two reconciliation rows above for what the correct bound then cost.*

## 4. Tasks

**1 — Reconciliation, written into this document.**

**2 — `GetAuditLog`** with its filters, plus the sentence mapping and its totality guard.

**3 — `quan-ly/nhat-ky`**, following U3's worked pages.

**4 — The three exports**, with BOM and injection handled, and the download route or action they come back through.

**5 — Verify in a browser.** Download all three, **open them and look at the diacritics** — do not verify a CSV by reading the code that generated it.

## 5. Acceptance

- [ ] Every audit action a shipped command writes renders as a Vietnamese sentence; a new action with no sentence fails a test (or does not compile)
- [ ] Raw before/after is available on expansion and is the stored value, not a re-derivation
- [ ] "What has manager A been doing" is answerable by a filter and is fast — say what makes it fast
- [ ] Each CSV opens in a spreadsheet with Vietnamese intact — verified by opening one, not by reading the writer
- [ ] A title beginning `=` does not become a formula
- [ ] A reader cannot reach the audit browser or any export; a manager of shelf A cannot export shelf B
- [ ] `bun run check` and `bun run check:links` green, and **CI green on the PR**

## 6. Out of scope

The cross-shelf audit browser and everything else under `/quan-tri/*` (B4, Phase 3); statistics (D2); comments, announcements and donations (B3); borrow requests (C2); notifications (D1).
