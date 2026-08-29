# Handoff — Laravel migration

Committed on purpose: the per-task ledger under `.superpowers/sdd/` is gitignored and
dies with its plan, so this file is what lets a **different session** pick the work up.
Update it as each task lands.

**Last updated:** 2026-08-29. Phase 1 is COMPLETE — #63 merged, `main` = `317a3b3`.
Phase 2 (Community) has started on `feat/phase-2-community`; the plan is being written.

## Where things stand

| Phase | Plan | PR | State |
|---|---|---|---|
| 0 Foundation | `plans/2026-08-26-…-phase-0-foundation.md` | #57, #59 | merged |
| 1a Catalogue | `plans/2026-08-27-laravel-phase-1a-catalogue.md` | #60 | merged |
| 1b Members | `plans/2026-08-28-laravel-phase-1b-members.md` | #61 | merged |
| 1c Circulation | `plans/2026-08-29-laravel-phase-1c-circulation.md` | #62 | merged (`main` = `6661991`) |
| 1d Oversight | `plans/2026-08-29-laravel-phase-1d-oversight.md` | #63 | merged (`main` = `317a3b3`) |
| **2a Requests & holds** | being written | not opened | **in progress** |
| 2b Community voice | not written | — | — |
| 2c Statistics & labels | not written | — | — |

Phase 1 (1a–1d) IS BR §1.4's core loop, and it is done. Next: Phase 2 (Community), then
3 (Network), 4 (Cutover).

**Why Phase 2 is split into 2a/2b/2c.** Spec §11 lists nine features under one phase
(borrow requests, holds and the queue, comments and moderation, announcements, feedback,
statistics, donations, notifications and the reminder sweep, QR labels) — the same
over-wide shape Phase 1 was split for. The cut:

- **2a — requests, holds, notifications, the sweep.** These are one unit, not three:
  `ReceiveReturn` was deliberately NARROWED in 1c (its docblock says so) pending borrow
  requests — `holdForRequestId`, `queuedRequestId`, the `request.approved` pairing and the
  notification all come back here, in one transaction, so a returned copy is never
  observably available to a stranger while a queued reader waits. The reminder sweep is
  the second `Schedule::` line Phase 0's plan reserved for it.
- **2b — community voice.** Comments and moderation (INV-09 visibility), announcements,
  site feedback and its inbox, donations.
- **2c — statistics and QR labels.**

## Phase 2a — current position

Branch `feat/phase-2-community`, cut from `main` at `317a3b3`.

Plan written by Fable and committed at `49e6c93`:
`plans/2026-08-29-laravel-phase-2a-requests-and-holds.md`, **19 tasks**, 6,130 lines.
Both of its open questions are ANSWERED (see rulings below) — Task 18 executes.

**Plan review 1 (Opus): CHANGES REQUESTED** — six Criticals, eleven Importants, every one
found by RUNNING the plan's own code rather than reading it: a false no-deadlock claim
contradicted by shipped code (`UpdateBook` X-locks `bookshelves` then the book row, closing
a cycle with the plan's new book lock); the phase's notification census RED on the very
commit introducing it (`AuditSentences` already carries `'membership_approved'` as a lang
key, so it counted as a notification writer); `(string)` on an enum-cast attribute fataling
every queue row; Task 10's "never observably available" assertion matching its own
`... for update` SELECT; **14 of 41 literal PHP blocks failing Pint** (the seventh time on
this project); `NotificationSentences` failing Larastan three ways; and — the 1d lesson
again — the phase's headline guarantee (the notification lives inside the command's
transaction) breakable with the whole suite green.

**Fix round (Opus, `f68f8f8`).** It rejected the review's own default on the deadlock and
changed the design: **`CreateBorrowRequest` takes no lock at all.** The duplicate rule
becomes a partial unique index — `borrow_requests.live_request_key`, a STORED generated
column `IF(deleted_at IS NULL AND status IN ('pending','approved'), CONCAT(book_id,':',
member_id), NULL)` under UNIQUE, the shape `loans.active_copy_id` and `bookshelves.
slug_active` already use; the friendly sentence stays a plain read, the losing racer's 1062
goes through the shipped `UniqueViolation::translate`. Its reason for refusing the review's
"serialise on `bookshelves`": that creates a NEW cycle with `UpdateReaderProfile`
(X `memberships` → X `users` → audit insert → S `bookshelves`, against X `bookshelves` →
audit insert → S `users`) — the family known-gaps already reproduced with `pcntl_fork`.
DDL verified live against `laravel-mariadb-1`. No cycle-freedom claim survives in the plan.

**Plan review 2 (fresh Opus, told to attack the index design hardest): CHANGES REQUESTED,
but the design SURVIVED.** It re-ran every live-DDL claim against a scratch clone of the
real schema and all of it held — the 1062 message text verbatim, `approved` holding the
key, all five terminal statuses and both soft-delete shapes freeing it, `down()` reversing,
`UniqueViolation::translate` matching the constraint name, both refusal doors rendering the
same sentence with the loser rolling back whole. The rejection of "serialise on
`bookshelves`" was confirmed correct on the cycle ground.

Its two Criticals were about the FIX, not the design:

- **The new notify-inside-transaction guard was broken in both directions.** Blind to
  `$this->notifier?->notify(...)` (`?->` is a different token), so an Action written that
  way could move its notify outside the transaction and the guard would see zero calls —
  Phase 1d's finding reproduced *inside the guard built to prevent it*. And an interpolated
  Vietnamese string inside a closure (`"bản {$code} …"`) unbalanced its brace ledger, so
  CORRECT code reported as an offender — which is how a guard gets deleted.
- Two blocks failed Larastan level 8 while the plan claimed all of them passed (the
  seventh occurrence of that claim being wrong).

Plus a justification that was **false**: "option 2 would queue every *Xin mượn* behind a
bulk `AddCopies`" — measured with two live transactions, the wait already exists through
the FK's shared lock. It was about to be written into `known-gaps.md`.

**Fix round 2 (`b15f582`).** Guard rewritten to skip strings and heredocs wholesale (which
subsumes the brace fix and also kills the `"$obj->notify"` and heredoc false call sites);
both failure modes added as named mutation checks. The false justification is recorded **as
withdrawn** with its measurement rather than deleted. The lock-claim sentences restated:
the index relocates serialisation into the insert's implicit exclusive record lock, the
loser blocks until the winner commits and then gets 1062.

**Verification of fix round 2: APPROVED — code may start.** The rewritten guard was
attacked as new code and held across 32 cases: the nine-case corpus, 23 adversarial ones
(`${...}` interpolation, nested interpolation, a heredoc containing a literal
`DB::transaction(`, a nowdoc, backticks, a method literally named `transaction`, an
abstract declaration, `finally` on both sides, a class body inside `if (true)`, chained
`DB::connection()->transaction()`, two files where one has no transaction at all) and both
named mutants. Larastan's "43/43 clean" claim — wrong twice before — was true this time,
and both counterfactual errors were reproduced verbatim.

Its findings were accuracy defects, fixed in `e680f1d`:

- the bullet stating what was NOT checked **was itself over-claiming** — only two of the
  shipped-file fragments were ever staged for Larastan; it now names the four that were not
- the one surviving justification for taking no lock **cited three line numbers shifted by
  one** and omitted the audit insert, contradicting the known-gaps entry it cites
- the fixture rule applied to `copy_id` was **half-applied**: the same approved row still
  had the reader deciding their own request. `drhFix` now seeds a manager.
- the guard's documented conservative case was **narrower than the guard** (a
  variable-assigned closure and a first-class callable also report), and it has **no
  receiver filter at all** — the first `$user->notify(new Foo)` anyone writes will redden
  the headline guard on correct code. Both bounds are now written down, and the pre-filter,
  which was narrower than the walk it guards, is widened.

## Phase 2a — task ledger

Plan `49e6c93` → review 1 → fix `f68f8f8` → review 2 → fix `b15f582` → verification →
accuracy fixes `e680f1d`. Then per task: implement → review (fresh agent) → fix round.
Nothing merged; no PR open.

- **1 groundwork** — `555f9a8`, `cc2ee28` · approved. The `live_request_key` index, `RequestRules`,
  `LoanTerms::holdExpiry`, the `LendingSettings` days, the `AuditLogQuery` subject join, the
  eleven sentences. Review's four must-fixes: a docblock claiming no writer had ever written
  `$.userId` (three shipped actions had, since 1b); the new audit join **unguarded** (breaking it
  left all 1,044 tests green) — pinned rather than deferred; a stale plan file-map line still
  saying "book lock first"; and "3 days is exactly 72 hours, no DST" (measured **71** across a
  spring-forward). The migration's two DDL statements now roll back as one.
- **2 notifications** — `cb67f1e`, `a196b17` · approved. The write path plus the phase's headline
  guard. **The review broke that guard while it was green:** its `$checked >= 2` floor does not
  grow, so adding one compliant call covered a writer that had moved its notify outside the
  transaction. Floor now derived per file from `OPS_SECTION_7`. The guard also armed on ANY
  identifier named `transaction` (a property or method by that name made a call invisible), so
  "a false alarm, never a silent pass" was false. Then the fix round found a **fifth** defect the
  reviewer's 28-shape sweep missed: nested interpolation `"a {$o->m("b {$p->q}")} c"` desynced the
  quote toggle and reddened CORRECT code — string tracking deleted entirely in favour of counting
  `T_CURLY_OPEN`. 35-case attack set, 0 mismatches. `known-gaps` was false again (7th).
- **3 policy + binding** — `fe23d54`, `01e2aa8` · approved. Nine actor cases, not the plan's two.
  The review disproved the premise the whole test file rested on: **Laravel re-bootstraps per test
  file**, so no runtime-registered route survives — `Route::has(...)` could never be true, and the
  probe was carrying neither `auth` nor `role:reader` while the real routes will carry both. Probe
  moved onto the real URI and the real stack; three new tests it unlocks. The implementer then found
  dropping `auth` left all 18 green (`EnsureShelfRole` redirects a guest by itself on a KNOWN slug),
  and pinned it with an unknown-slug case. New `PolicyRegistrationTest` covers all five policies,
  derived both ways.
- **4 `CreateBorrowRequest`** — dispatched.

**One correction landed at the source** (`d93d4e9`): the 404-never-403 rule was cited as "BR §5.4"
throughout the plan, `known-gaps.md` and a shipped docblock. `BUSINESS-REQUIREMENTS.md` §5.4 is
"What is recorded about each thing" and `grep -in "enumerat"` over it returns nothing. The section
number is right, the document was not — it is the **migration design spec's** §5.4, "The
TenantIsolation suite". Fixed before it could propagate into the remaining sixteen tasks.

## Phase 1d — closed

Branch `feat/phase-1d-oversight`, 10 tasks, plan committed at `541a017`. Merged as #63.

- **1 Audit sentences** — `0d48b10` · approved
- **2 AuditSecrets guard** — `58b0399`, `3617fb5` · approved
- **3 AuditLogQuery** — `97675c0`, `b4c0252` · approved
- **4 Audit screen** — `6ee9b79` · approved
- **5 Dashboard query** — `13f95ed` · approved
- **6 Dashboard screen** — `7e9bd75` · approved
- **7 `Csv` helper** — `d75f53d` · approved
- **8 export queries** — `afbcc17`, `62bd534` · approved, two nits carried into 9
- **9 export route** — `52283bd`, `d52d17e`, `9978e71`, `7089338` · approved
- **10 wrap-up** — `41c1e4c`, `794cac4`, `9109585` · approved

PR #63 opened, whole-branch reviewed. Its Critical — the audit secrets guard could be
unwired with the whole suite green — plus two Importants fixed in `3d3362f`; a docblock
that repeated a false "reaches no screen" claim corrected in `e599c6a`.

Suite at 1,031 passing on merge. All gates green (Pest, Pint, Larastan level 8, Biome,
tsc, Vite build).

## How the loop runs

Per task: `task-brief` → implement (fresh agent) → `review-package` → review (fresh agent)
→ fix round if the review requests changes → next task. Both scripts live in the
superpowers plugin's `subagent-driven-development/scripts/`.

At the end: open the PR, run a **whole-branch** review (it has caught what per-task review
structurally cannot, in every phase so far), fix, then hand the merge decision to Kien.

## Product-owner rulings (do not relitigate)

**Phase 1b** — manager-registered readers are `active`; the `already_registered_here`
existence oracle is accepted; registration throttle is two-key (30/min/IP + 20/day per
hashed phone); the reactivate button ships.

**Phase 1c** — the quick-lend escape hatch is wired (this made 1b's `active` ruling real);
a suspended reader **cannot** renew (accepted as unreachable, matching the reference); the
void-loan button ships; a copyless title gets its own true refusal sentence.

**Phase 2a** — OQ1 = **B**: a lapsed hold gets a manager exit. `ReleaseExpiredHold` ships
(plan Task 18 EXECUTES), one **Trả về kệ** button on expired rows only, guarded on the clock
(`hold_expires_at <= now` — a manager may not yank a live hold), writing BR §7.2's own
`approved → expired` arrow plus `held → available` in one transaction, new audit action
`request.expired`, OPS §4.2 amended in the same commit. Kien overrode the plan's parity
default: the reference's gap strands a copy in `held` forever unless the READER cancels.
OQ2 = **A**: the reject reason stays **optional** (parity; the form says "Không bắt buộc.",
an empty box stores NULL). Tasks 6/14 take no B-delta.

**Phase 1d** — the audit expansion shows **raw before/after, manager-gated** (verified: it
reveals strictly less than the reader-detail screen already does); `loan.returned`'s previous
condition is **restored** (Task 10, capture-then-use — reading it after the copy update
records the *post*-return value); CSV exports ship **synchronous** with the memory ceiling
recorded; the audit log reads **all of it**, 25/page, filtered, never pruned.

## Standing instructions from Kien

- Run to a PR with an agent review, then announce — do not merge.
- **Every plan: Opus writes it, a DIFFERENT Opus reviews it** before any code. (Ruling
  2026-08-29, mid-2a: Fable wrote the 2a plan and its review came back with six Criticals.
  Only the author changed — the write → independent-review gate is unchanged.)
- Keep this file current so a disrupted session can resume elsewhere.

## Owed by Kien, not by the agents

- **`main` has no branch protection.** CI runs and passes but a red gate would not block a
  merge. Unchanged since Phase 1a.
- **`docs/HOSTING.md` rows 2–14 are unrun.** The deploy pipeline has never touched the
  cPanel host.

## Open item worth a decision later

**This repo has no frontend rendering tests at all** (the only vitest scripts point at
`old_next`). Task 6's reviewer proved the consequence: swapping the two stat cards' values on
the dashboard leaves all 23 of its tests — plus Pint, Larastan, Biome, tsc and the build —
entirely green, because `assertInertia` checks server-side props only. No page in this
codebase can catch a mis-wired label/value pair. Recorded in Phase 1d's known-gaps; whether
to adopt component-level tests is a real decision, not a task.

## Read next

`docs/known-gaps.md` — the durable record, and the thing to trust *after* verifying: it has
been factually wrong six times, always the same way (a plausible claim written without being
run down). `AGENTS.md` for house conventions.
