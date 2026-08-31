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
stamping** (`BookshelfScope.php:35-37`, `BelongsToBookshelf.php:50-52`). A
widened `Membership::find($id)` reaches every shelf; a widened `create()` writes
a null `bookshelf_id`.

**So reach scoped rows through relations from the `Bookshelf`** —
`$shelf->memberships()`, `$shelf->contacts()` — and never write a
`bookshelf_id` predicate by hand. A relation carries its own constraint whatever
the widening state, and `$shelf->memberships()->create([...])` stamps the column
from the relation rather than the hook.

This is not a style preference. `TenancyArchitectureTest` confines
`/where[A-Za-z]*\s*\([^;]*bookshelf_id/i` to a four-file allow-list
(`tests/Feature/Architecture/TenancyArchitectureTest.php:80-95,151`) naming
neither `app/Actions/Admin/` nor `app/Queries/Admin/`. Hand-writing the
predicate reddens a second architecture pin.

**Where code lives:** cross-shelf *reads* in `app/Queries/Admin/`, cross-shelf
*writes* in `app/Actions/Admin/`. A controller never calls `systemWide()`
itself.

### Environment

- Tests: `docker exec laravel-app-1 php artisan test`
- Formatting: `docker exec laravel-app-1 vendor/bin/pint` — **never on the host**,
  the host PHP is broken.
- Frontend build: `npm run laravel:build`. Plain `npm run build` builds the
  read-only `old_next` reference; do not run it.
- No formatter covers `resources/css/app.css`; Biome covers `resources/js/**`.
- Architecture guards live in `tests/Feature/Architecture/`.

### The architecture fences are comment-blind

`offendersFor` in `WideningArchitectureTest` reads **raw file contents** with no
comment stripping — unlike `AuditActionCensusTest`, which runs `token_get_all`
first. So a docblock illustrating a call as `$this->audit->global()->record(...)`
— exactly how spec D0 writes it — makes that file its own offender.

Write such prose without the arrow (`forShelf($id) or global()`). This bit the
project twice before, in `TenancyArchitectureTest`, and is recorded in
`known-gaps.md`.

Line numbers in `WideningArchitectureTest.php` shifted when Task 1 amended it;
re-grep rather than trusting the numbers quoted below.

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

1. Create `app/Actions/Admin/`.
2. Amend `tests/Feature/Architecture/WideningArchitectureTest.php` to allow
   `systemWide()` in `app/Actions/Admin/` as well as `app/Queries/Admin/`.
   **This is not appending to a list.** The fence is a closure at `:85`
   (`->reject(fn ($path) => str_starts_with($path, 'app/Queries/Admin/'))`) and
   the test's name at `:76` says "confined to app/Queries/Admin". Both change.
3. Give `AuditRecorder` a **fluent configurator**: `global()` and
   `forShelf(string $id)`, each returning a configured instance. **Do not add a
   differently named record method.** `record()` keeps its name, signature and
   throw. Call sites must read:

   ```php
   $this->audit->global()->record('user.promoted_super_admin', ...);
   ```

   `AuditActionCensusTest:57` finds actions with a regex hard-coding
   `->record(`, and `:70` asserts set-equality in **both** directions. A
   `recordGlobal(...)` sibling is invisible to it, so the administration actions
   would never enter the census's `$written` set and the census would be
   permanently red. This shape leaves that pin working untouched.
4. Fence the configurator to `app/Actions/Admin/`. **Add a second `it()` to
   `WideningArchitectureTest.php` and reuse its `offendersFor` helper — do not
   create a new file that redefines it.** That helper is process-global by
   design (`:10-13`: "Pest loads every test file into one process, so this name
   is process-global"); redeclaring it is a fatal error.

**Tests:** the widening fence still refuses `systemWide()` outside the two
allowed directories; the audit fence refuses `global()`/`forShelf()` outside
`app/Actions/Admin/`.

**Falsify both:** add a `systemWide()` call in `app/Http/Controllers/`, watch
red, remove; same for the configurator. Amending an architecture pin is exactly
when to prove it still refuses everything else.

---

## Task 2 — Audit vocabulary infrastructure (no actions yet)

Spec D10. This task adds **no entries to `ACTIONS`** — each later task adds its
own alongside its writer, so the census's two-way set-equality holds at every
task boundary. Adding all seven here would leave the suite red for five tasks.

1. Add a fifth group `administration` to `AuditSentences::GROUPS` (`:101`),
   today a closed set of four. An empty group is fine: the partition test
   merges `actionsInGroup()` across the groups and still equals `ACTIONS`.
2. Update `tests/Unit/Audit/AuditSentencesTest.php:410-417` to merge five groups
   rather than four. **Leave `toHaveCount(41)` alone** — it rises as each later
   task lands its actions, ending at 48.
3. **Retire `bookshelf.created` as the suite's canonical stranger**, before any
   task registers it. It is the probe three tests use to obtain the fallback:
   `:26-31` (asserts it *is* the fallback), `:188` (asserts `groupOf` is null),
   `:402` (computes `$fallback` from it, then asserts no action equals it).

   Replace it at all three sites with **`nonesuch.never_registered`** — named
   here so three agents do not pick three strings. It satisfies the census's
   `[a-z_]+\.[a-z_]+` shape and no domain will claim it.

   `:402` is the dangerous one: if the replacement ever becomes real, the census
   silently stops covering anything.
4. Add a test asserting the probe is absent from `ACTIONS` — asserted, not
   assumed.
5. **`GROUPS` is not only a test fixture — it is a live filter whitelist.**
   `app/Http/Controllers/Manage/AuditLogController.php:44` does
   `in_array($groupParam, AuditSentences::GROUPS, true)`, so a fifth group
   immediately becomes an accepted `?group=` value on the **shelf-level** audit
   screen. That is correct behaviour — a shelf's own `bookshelf.updated` and
   `membership.role_assigned` rows belong in it — but the front end has a
   hard-coded union that will now be a lie:

   ```
   resources/js/pages/manage/audit.tsx:20
       group: "loans" | "books" | "readers" | "community" | null;
   ```

   Widen it to include `"administration"`. Verify with `npm run laravel:build`;
   Biome covers `resources/js/**`.

`tests/Feature/Oversight/AuditLogQueryTest.php:67,131` also names
`bookshelf.created`, as a null-shelf row that must not appear in a shelf-scoped
query. **That one stays** and becomes a better test once the action is real.

**Falsify:** register `nonesuch.never_registered` in `ACTIONS` and watch the
fallback tests and the absence test go red. Restore.

---

## Task 3 — `BookshelfPolicy`, and the shelves list

Spec D9.

1. `app/Policies/BookshelfPolicy.php`. Gate is `users.is_super_admin`. Refusals
   return `Response::denyAsNotFound()` so a refusal is indistinguishable from a
   missing row. **Note this is a new pattern here:** all eight existing policies
   return `bool` (e.g. `app/Policies/BookPolicy.php:21-41`), and
   `denyAsNotFound()` appears nowhere in `app/` yet — it is
   `Illuminate\Auth\Access\Response::denyAsNotFound()`.
2. `/admin/shelves` — replace the placeholder with a real list: name, slug,
   status, `contactsMissing`, `managersMissing`. Screen at
   `resources/js/pages/admin/shelves/index.tsx`, beside the existing
   `admin/dashboard.tsx`.
3. Add **`managersMissing`** to `AdminOverviewQuery` — a `groupBy` aggregate in
   the same shape as `contactsMissing` (`:207-211`, mapped at `:234`; the
   `@return` shape at `:124` also grows).

   **The predicate is: no membership on the shelf with `role` in
   (`manager`, `admin`) AND `status = active` AND a surviving user row**
   (`whereHas('user')`, as `readers` does at `:143`). A suspended manager does
   not count — spec D6 raises that case and this is the answer.

   Obey the chain-ordering constraint documented at `:106-109` —
   `groupBy`/`selectRaw` first, `where` last — or `TenancyArchitectureTest`
   fails. `readers` counts active memberships **including managers** (`:78-79`),
   so it cannot serve as a proxy.

**Test — the policy actually refuses at object level.** Do **not** test that a
non-super-admin gets 404: that is already true from `EnsureSuperAdmin.php:20`
before this policy exists, so it passes with the policy file deleted and cannot
falsify. Test an **authenticated super admin denied on a specific shelf**,
returning 404 via `denyAsNotFound()`.

`managersMissing` is asserted in Task 7, through the revoke path.

---

## Task 4 — Create and edit a shelf

Spec D1, D2 (profile half). Registers `bookshelf.created` and
`bookshelf.updated` in `ACTIONS` with their `phrase()` arms, `lang/vi/audit.php`
lines, and the partition count bumped by two.

1. Create: name, slug, location, address, description, established date.
   Validate slug uniqueness against `bookshelves.slug_active`.
2. Edit profile: everything except the slug, rendered read-only.
3. **The update path must never pass `slug` through.** `Bookshelf::$guarded`
   lists only the four generated columns (`app/Models/Bookshelf.php:27`), so
   `slug` and `status` are mass-assignable and `update($request->all())` is live
   ammunition.

Screens: `resources/js/pages/admin/shelves/create.tsx` and `edit.tsx`.

**Test — slug immutability at the application layer.** An update carrying a
changed slug leaves the slug unchanged **and raises no exception**. Use
`withoutExceptionHandling()` so a `QueryException` surfaces as a failure rather
than being rendered as a 500 and quietly passing a status assertion.

A `QueryException` here is a **failure**: a trigger already enforces this
(`database/migrations/2026_08_26_000020_add_immutability_triggers.php:33-37`
raises SQLSTATE 45000), so an exception means the controller let it through and
only MariaDB saved us. Eloquent writes only dirty attributes, so a controller
that drops `slug` never trips the trigger.

**Also test:** `bookshelf.created` writes an audit row naming the new shelf.

**Falsify:** let `slug` through the update path, watch the test go red with a
`QueryException` — the exact failure mode it exists to distinguish. Restore.

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
this mistake; `fromShelf()` reads `$settings['comments_enabled'] ?? true`
(`:54`). Writing `allow_comments` would appear to save and change nothing.

**Contacts — up to three**, reached as `$shelf->contacts()`.
`bookshelf_contacts.position_key` already enforces one row per position and a
`CHECK` bounds it to 1–3.
- Position 1 required by the interface, not the column.
- Positions 2 and 3 saved **only when a name is given**: blank name means no
  row, not an empty row.
- `role_label` is free text. No enum.

**Profile, policy and contacts are three separate forms with three separate
submits and three separate refusals.** Not one save. Spec D8 depends on it:
3b-ii adds a taxonomy section to this same screen, and per-section forms make
that an addition rather than a restructure.

**Tests:** a blank position-2 name saves no row; a named one saves exactly one
at the right position; saving the policy writes `bookshelf.updated`.

(Spec §5.2's "contacts are not public" is **dropped as unfalsifiable** — 3b-i
adds no public route touching contacts, so any implementation is vacuously
green. The disclosure boundary is already held by `BookshelfContact` being
shelf-scoped and by 3a's portal decision. Recorded in Task 8.)

---

## Task 6 — Archive and un-archive

Spec D4. Registers `bookshelf.archived` and `bookshelf.unarchived`.

Archive and un-archive from `/admin/shelves`, each writing its audit action.

**Do not change `ResolveTenant` in this phase.** The archived-shelf resolver
filter is 3b-ii's: closing it alters the entry condition of every tenant-bound
route, and it should land against a phase where the repair path already exists.
Un-archiving is that repair path and this task builds it.

An archived shelf therefore still serves its routes after this task, exactly as
today — the pre-existing Phase 0/1 behaviour at `docs/known-gaps.md:4306-4338`.

**Tests:** archiving sets `status` to archived and writes `bookshelf.archived`;
un-archiving restores it and writes `bookshelf.unarchived`; both refuse for a
non-super-admin.

**Falsify:** drop the audit call from archive, watch the census go red (the
action is registered but unwritten). Restore.

---

## Task 7 — Managers

Spec D5, D7. Registers `membership.role_assigned`, `membership.role_revoked`,
`user.promoted_super_admin` — the last with a **null** `bookshelf_id`, which is
why Task 1 exists.

`/admin/managers` — every manager and shelf admin across every shelf. The
cross-shelf read lives in `app/Queries/Admin/`; the mutations in
`app/Actions/Admin/`. Screen: `resources/js/pages/admin/managers/index.tsx`.

1. **Assign** takes a role: `manager` or `admin`. `MembershipRole` has
   `Admin = 'admin'` (`app/Enums/MembershipRole.php:11`) at rank 3 (`:24`), and
   the reference's `assignManager` takes the same union (`managers.ts:20`).
2. **Revoke** sets `role = 'reader'` and leaves the membership standing. It does
   **not** delete. Revoking someone already a reader is refused.
3. **Revocation requires a confirmation** naming the person and the shelf and
   stating, in Vietnamese, that their history is retained (BR §16.4). Assert the
   rendered Inertia prop, not merely that a `lang` key exists.
4. **Promote to super admin.** Refused if the target already is one.
   **There is no demotion** — spec D5; do not add one.

   **`is_super_admin` is not mass-assignable** (`app/Models/User.php:17-18`:
   "Narrow on purpose. is_super_admin is NOT here"), so
   `update(['is_super_admin' => true])` silently does nothing and returns
   `true`. Set the attribute directly.

**Tests:** revoke keeps the membership row with `id` unchanged and
`role = 'reader'`, and its loans and audit rows still resolve; revoking a reader
is refused; promoting an existing super admin is refused; **the target's
`is_super_admin` is true afterwards** (a test asserting only the audit row
passes while the promotion does nothing); the confirmation prop states history
is retained; `user.promoted_super_admin` writes an audit row with a null
`bookshelf_id`; **`managersMissing` becomes true for a shelf whose only manager
was revoked** — through the revoke path, not by fixture, so it proves spec D6's
sharp edge is actually visible.

---

## Task 8 — Record what this phase leaves open

`docs/known-gaps.md` already ends with `## Phase 3b — the design system port`
(`:4339`). Add a sibling `## Phase 3b-i — shelf administration` after it,
following the existing sections' convention:

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
- **The contacts disclosure boundary has no direct test in this phase** — the
  proposed one was unfalsifiable, since 3b-i adds no public route touching
  contacts. It rests on `BookshelfContact` being shelf-scoped and on 3a's portal
  decision.
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
