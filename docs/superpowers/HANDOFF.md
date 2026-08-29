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

Opus plan review is the gate before any code. No tasks dispatched yet.

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
- Every plan: Fable writes it, Opus reviews it before any code.
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
