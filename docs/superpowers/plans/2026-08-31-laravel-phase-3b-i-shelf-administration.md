# Implementation plan: Phase 3b-i — bookshelves and managers

Spec: `docs/superpowers/specs/2026-08-31-laravel-phase-3b-i-shelf-administration-design.md`
Branch: `feat/phase-3b-shelf-administration`, cut from `main` at `213d04f`

## Context for whoever picks this up

OLibra is a Vietnamese parish lending-library system being ported from Next.js to
Laravel + Inertia + React. `old_next/` is a **read-only** behavioural reference —
never write to it. Phases 0–3a shipped the schema, catalogue, members,
circulation, community features, statistics, QR labels, the public portal and the
super-admin dashboard.

This phase makes an installation **operable**. Today `routes/web.php:522-534`
registers eight admin routes; only the 3a dashboard is real and the other seven
are `ShellController::underConstruction`. A super administrator can see that a
shelf needs attention and can do nothing about it — no way to create a shelf,
edit its lending policy, record who to phone, or appoint a manager.

**Read the spec before starting.** Its decisions are settled and several of them
reverse things that look obvious.

### The one thing that will bite you first

**The `/admin` route group binds no tenant**, and this codebase is deliberately
fail-closed about that:

- `BookshelfScope` **throws** on any scoped model when no tenant is bound
  (`app/Models/Scopes/BookshelfScope.php:41-48`). `Membership` and
  `BookshelfContact` are both scoped.
- `AuditRecorder::record()` **throws** when no shelf is bound
  (`app/Support/AuditRecorder.php:39-44`).
- `BelongsToBookshelf::creating` **throws** with no tenant and no explicit shelf
  (`app/Models/Concerns/BelongsToBookshelf.php:64-70`).

So you cannot write an ordinary admin controller. Task 1 builds the sanctioned
capability; every later task uses it. If you find yourself adding
`middleware('tenant')` to the admin group, stop — the admin area is cross-shelf
by nature and that would bind it to one shelf.

**Under `systemWide()` the scope stops narrowing and the creating hook stops
stamping** (`BookshelfScope.php:34-37`, `BelongsToBookshelf.php:50-52`). So every
admin Action names its own shelf filter and its own `bookshelf_id`. A widened
`Membership::find($id)` reaches every shelf; a widened `create()` writes a null
`bookshelf_id`.

### Environment

- Tests: `docker exec laravel-app-1 php artisan test`
- Formatting: `docker exec laravel-app-1 vendor/bin/pint` — **never on the host**,
  the host PHP is broken.
- Frontend build: `npm run laravel:build`. Plain `npm run build` builds the
  read-only `old_next` reference; do not run it.
- No formatter covers `resources/css/app.css`; Biome covers `resources/js/**`.
- Architecture guards live in `tests/Feature/Architecture/`.

### House rule: mandatory falsification

Every test is **watched failing before it is accepted** — mutate what it
protects, run it, see red, restore, run it, see green, confirm
`git status --porcelain` is clean. **Restore by targeted edit, never
`git checkout -- <file>`**: your work is uncommitted and a checkout discards the
whole task. A test never seen failing is not evidence; this repo has shipped
guards that passed unconditionally.

---

## Task 1 — The cross-shelf write capability

Spec D0. Nothing else can be built first.

1. Create `app/Actions/Admin/`. Administration commands live here.
2. Amend `tests/Feature/Architecture/WideningArchitectureTest.php` to allow
   `systemWide()` in `app/Actions/Admin/` as well as `app/Queries/Admin/`.
   **This is not appending to a list.** The fence is a closure at `:85`
   (`->reject(fn ($path) => str_starts_with($path, 'app/Queries/Admin/'))`), and
   the test's own name at `:76` says "confined to app/Queries/Admin". Both
   change, plus the `$allowed` array's comment. Keep the comment's meaning: a new
   directory is a spec amendment, not a fix.
3. Give `AuditRecorder` a sibling for shelf-less acts. **Do not relax
   `record()`** — its throw protects every shelf-scoped command in the app.
   The new method takes the shelf explicitly, or null. `audit_log.bookshelf_id`
   is already nullable
   (`database/migrations/2026_08_26_000015_create_audit_log_table.php:17`) and
   `AuditLog` deliberately does not use `BelongsToBookshelf`.
4. Fence the new method to `app/Actions/Admin/` with its own architecture test,
   in the same shape as the widening fence.

**Tests:** the widening fence still refuses a `systemWide()` call added anywhere
outside the two allowed directories; the audit fence refuses the new recorder
method outside `app/Actions/Admin/`.

**Falsify both:** add a `systemWide()` call in `app/Http/Controllers/`, watch
red, remove. Same for the recorder method. Amending an architecture pin is
exactly when to prove it still refuses everything else.

---

## Task 2 — The administration audit vocabulary

Spec D10. Bigger than it looks; read the whole task before starting.

Add seven actions to `AuditSentences::ACTIONS`: `bookshelf.created`,
`bookshelf.updated`, `bookshelf.archived`, `bookshelf.unarchived`,
`membership.role_assigned`, `membership.role_revoked`,
`user.promoted_super_admin`.

This requires **all** of:

1. A fifth group `administration` in `AuditSentences::GROUPS` (`:101`), today a
   closed set of four.
2. A `phrase()` arm for each of the seven — a test asserts no action falls
   through to the undescribed-action fallback.
3. A Vietnamese sentence for each in `lang/vi/audit.php`.
4. `tests/Unit/Audit/AuditSentencesTest.php:410-417` — the partition test
   hard-codes both the four group names and `toHaveCount(41)`. Both change; the
   count becomes 48.
5. **Retire `bookshelf.created` as the suite's canonical stranger.** It is the
   probe three tests use to obtain the fallback:
   - `:26-31` asserts `sentence('bookshelf.created')` **is** the fallback
   - `:188` asserts `groupOf('bookshelf.created')` is **null**
   - `:402` computes `$fallback` from it, then asserts no action equals it

   Registering it reddens all three. Replace it at all three sites with a
   deliberately synthetic action no domain will ever claim. The third site is the
   dangerous one: choosing an arbitrary replacement that later becomes real
   silently stops the census covering anything.

`tests/Feature/Oversight/AuditLogQueryTest.php:67,131` also names
`bookshelf.created`, as a null-shelf row that must not appear in a shelf-scoped
query. **That one stays** and becomes a better test once the action is real.

**Tests:** the census (`AuditActionCensusTest`) still passes with 48 actions; the
partition covers five groups; the new fallback probe is asserted absent from
`ACTIONS` rather than assumed absent.

**Falsify:** register the synthetic probe and watch the fallback tests go red;
remove one `phrase()` arm and watch the no-fallback test go red.

---

## Task 3 — `BookshelfPolicy`, and the shelves list

Spec D9, D6.

1. `app/Policies/BookshelfPolicy.php`. The gate is `users.is_super_admin`.
   Refusals return `denyAsNotFound()` so a refusal is indistinguishable from a
   row that is not there — `EnsureSuperAdmin` already aborts 404
   (`app/Http/Middleware/EnsureSuperAdmin.php:20`), and `MembershipPolicy`'s
   docblock already flags the 403-vs-404 mismatch this anticipates.
2. `/admin/shelves` — replace the `underConstruction` placeholder with a real
   list: name, slug, status, and the two flags.
3. **Add `managersMissing` to `AdminOverviewQuery`**, beside the existing
   `contactsMissing` (`app/Queries/Admin/AdminOverviewQuery.php:124`). A
   `groupBy` aggregate in the same shape. Note `readers` counts active
   memberships **including managers** (its own docblock at `:78-79` says so), so
   it cannot serve as a proxy.

   This is in scope because spec D6 permits revoking a shelf's last manager and
   is only defensible if something surfaces the result.

**Tests:** a non-super-admin gets 404, not 403; `managersMissing` is true for a
shelf whose only manager was revoked — **tested through the revoke path, not by
fixture**, so it proves the sharp edge is actually visible.

---

## Task 4 — Create and edit a shelf

Spec D1, D2 (profile half).

1. Create: name, slug, location, address, description, established date.
   Validate slug uniqueness against `bookshelves.slug_active`, a stored
   generated column with a unique index.
2. Edit profile: everything except the slug, which renders read-only.
3. **The update path must never pass `slug` through.** `Bookshelf::$guarded`
   lists only the four generated columns (`app/Models/Bookshelf.php:27`), so
   `slug` and `status` are mass-assignable and `update($request->all())` is live
   ammunition.

**Test — slug immutability at the application layer:** an update carrying a
changed slug leaves the slug unchanged **and raises no exception**.

A `QueryException` here is a **failure**, not a pass. A database trigger already
enforces this (`database/migrations/2026_08_26_000020_add_immutability_triggers.php:33-37`
raises SQLSTATE 45000), so an exception means the controller let it through and
only MariaDB saved us. Assert both halves.

**Falsify:** let `slug` through the update path and watch the test go red with a
`QueryException` — which is exactly the failure mode the test exists to
distinguish. Restore.

---

## Task 5 — Lending policy and contacts

Spec D2 (policy half), D3.

**Policy — exactly eight settings**, matching the reference's own
`updateBookshelfPolicyAction` ("the six lending-policy numbers and the two
comment toggles", `old_next/src/app/quan-tri/admin-actions.ts:256`):
`loan_days`, `max_concurrent_loans`, `max_renewals`, `renewal_days`,
`hold_days`, `due_soon_days`, `comments_enabled`, `comments_require_approval`.

**The key is `comments_enabled`, not BR §5.5's `allow_comments`.**
`app/Support/Community/CommentSettings.php:22` carries a warning about exactly
this mistake, and `fromShelf()` reads `$settings['comments_enabled'] ?? true`
(`:54`). Writing `allow_comments` would appear to save and change nothing.

**Contacts — up to three.** `bookshelf_contacts.position_key` already enforces
one row per position and a `CHECK` bounds it to 1–3.
- Position 1 required by the interface, not the column — a shelf with none is
  flagged, never given an invented volunteer.
- Positions 2 and 3 saved **only when a name is given**: blank name means no row,
  not an empty row.
- `role_label` is free text. No enum.

**Profile, policy and contacts are three separate forms with three separate
submits and three separate refusals.** Not one save. The reference records why,
and spec D8 depends on it: 3b-ii adds a taxonomy section to this same screen, and
per-section forms make that an addition rather than a restructure.

**Tests:** a blank position-2 name saves no row; a named one saves exactly one at
the right position; no route added here reads `bookshelf_contacts` for a caller
without a membership.

---

## Task 6 — Archive and un-archive

Spec D4.

Archive and un-archive a shelf from `/admin/shelves`, each writing its audit
action.

**Do not change `ResolveTenant` in this phase.** The archived-shelf resolver
filter is 3b-ii's, deliberately: closing it alters the entry condition of every
tenant-bound route in the application, and it should land against a phase where
the repair path already exists. Un-archiving is that repair path and this task
builds it.

An archived shelf therefore still serves its routes after this task, exactly as
today. That is the pre-existing Phase 0/1 behaviour recorded at
`docs/known-gaps.md:4306-4338`, unchanged here.

---

## Task 7 — Managers

Spec D5, D7.

`/admin/managers` — every manager and shelf admin across every shelf.

1. **Assign** takes a role: `manager` or `admin`. `MembershipRole` has
   `Admin = 'admin'` at rank 3 (`app/Enums/MembershipRole.php:11,22`) and the
   reference's `assignManager` takes the same union (`managers.ts:20`).
2. **Revoke** sets `role = 'reader'` and leaves the membership standing. It does
   **not** delete. Revoking someone already a reader is refused.
3. **Revocation requires a confirmation** naming the person and the shelf and
   stating, in Vietnamese, that their history is retained. This is a BR §16.4
   interface requirement, not merely a fact about the data model.
4. **Promote to super admin.** Refused if the target already is one.
   **There is no demotion**, deliberately — see spec D5; do not add one.

**Tests:** revoke keeps the membership row with `id` unchanged and
`role = 'reader'`, and its loans and audit rows still resolve; revoking a reader
is refused; promoting an existing super admin is refused; the confirmation exists
and states history is retained; `user.promoted_super_admin` writes an audit row
with a **null** `bookshelf_id`.

---

## Task 8 — Record what this phase leaves open

`docs/known-gaps.md`, under a new `## Phase 3b-i` heading at the end, following
the existing phase sections' convention:

- **A shelf may be left with no manager** (D6), by decision, now surfaced by
  `managersMissing`.
- **No super-admin demotion** (D5), ported as an omission with the reference's
  reasoning.
- **Two live settings remain uneditable**: `public_show_current_borrower`
  (`app/Queries/BookDetailQuery.php:127`) and `public_name_display` (`:141`) are
  read by shipped code with no editor anywhere.
- **`leaderboard_enabled` and `leaderboard_size` are stale requirements text** —
  consumed nowhere, the opt-in having been withdrawn on 2026-08-12. Record them
  as stale, **not** as "shipped but uneditable"; the latter would plant the same
  false-premise-from-requirements defect `known-gaps.md:4331-4338` dissects.
- **Exporting an archived shelf's records is unbuilt and unscheduled.** The
  reference names reactivating *and* exporting as the two needs an explicit admin
  path must serve; 3b-i builds only the first. **The 3b-ii resolver filter must
  not land until export is scoped**, or archiving becomes a way to make a
  parish's own records unreachable.

---

## Definition of done

- Full suite green in `laravel-app-1`; `pint --test` clean.
- Every test above watched failing and restored, `git status --porcelain` clean.
- Screenshots of `/admin/shelves` and `/admin/managers` in both light and dark.
- No task left the suite red across a boundary.
