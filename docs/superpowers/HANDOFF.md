# Handoff — Laravel migration

Committed on purpose: the per-task ledger under `.superpowers/sdd/` is gitignored and
dies with its plan, so this file is what lets a **different session** pick the work up.
Update it as each task lands.

**Last updated:** 2026-08-29, after Phase 1d Task 6 (its review in flight).

## Where things stand

| Phase | Plan | PR | State |
|---|---|---|---|
| 0 Foundation | `plans/2026-08-26-…-phase-0-foundation.md` | #57, #59 | merged |
| 1a Catalogue | `plans/2026-08-27-laravel-phase-1a-catalogue.md` | #60 | merged |
| 1b Members | `plans/2026-08-28-laravel-phase-1b-members.md` | #61 | merged |
| 1c Circulation | `plans/2026-08-29-laravel-phase-1c-circulation.md` | #62 | merged (`main` = `6661991`) |
| **1d Oversight** | `plans/2026-08-29-laravel-phase-1d-oversight.md` | not opened | **in progress** |

Phase 1d completes BR §1.4's core loop. After it: Phase 2 (Community), 3 (Network), 4 (Cutover).

## Phase 1d — current position

Branch `feat/phase-1d-oversight`, 10 tasks, plan committed at `541a017`.

- **1 Audit sentences** — `0d48b10` · approved
- **2 AuditSecrets guard** — `58b0399`, `3617fb5` · approved
- **3 AuditLogQuery** — `97675c0`, `b4c0252` · approved
- **4 Audit screen** — `6ee9b79` · approved
- **5 Dashboard query** — `13f95ed` · approved
- **6 Dashboard screen** — `7e9bd75` · review in flight
- 7 `Csv` helper · 8 export queries · 9 export route · 10 wrap-up — not started

Suite at 997 passing. All gates green (Pest, Pint, Larastan level 8, Biome, tsc, Vite build).

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

## Read next

`docs/known-gaps.md` — the durable record, and the thing to trust *after* verifying: it has
been factually wrong six times, always the same way (a plausible claim written without being
run down). `AGENTS.md` for house conventions.
