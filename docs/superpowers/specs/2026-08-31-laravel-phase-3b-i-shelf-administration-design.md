# Phase 3b-i — bookshelves and managers

Status: draft, revised after review
Date: 2026-08-31
Branch: `feat/phase-3b-shelf-administration`, cut from `main` at `213d04f`

## 1. Context

OLibra is a Vietnamese parish lending-library system being ported from Next.js
to Laravel + Inertia + React. `old_next/` is a **read-only** behavioural
reference. Phases 0–3a shipped the schema, catalogue, members, circulation,
community features, statistics, QR labels and — in 3a — the cross-shelf read
capability, the public portal and the super-admin dashboard.

Phase 3 is *the network*: what someone running several bookshelves needs. The
product owner decomposed it on 2026-08-31 into 3a (foundation, shipped), 3b
(shelf administration) and 3c (oversight and feedback). 3b as ruled covers seven
screens — roughly twice 3a — so it is split. **This spec is 3b-i.**

## 2. Problem statement

The super-admin area is mostly scaffolding. `routes/web.php:522-534` registers
**eight** admin routes; the 3a dashboard is real and the **other seven** point at
`ShellController::underConstruction`.

So a super administrator can see that a shelf needs attention and can do nothing
about it. There is no way, anywhere in the running application, to create a
bookshelf, edit its name or lending policy, record who to phone about it, or
appoint and remove a manager. Every shelf and manager in the database got there
by seeder or by hand. **An installation cannot be operated.**

3b-i closes the two routes that block operation — `/admin/shelves` and
`/admin/managers`. `/admin/settings`, `/admin/categories`, the public `/contact`
and the shelf-level `manage/units` and `manage/settings` are 3b-ii; the audit
browser, per-manager activity, cross-shelf profile-change queue and feedback
inbox are 3c.

### 2.1 The prerequisite this phase cannot avoid

The first draft of this spec treated the admin writes as ordinary controller
work. They are not, and the reason is worth stating before any screen is
designed.

**The `/admin` group binds no tenant.** `routes/web.php:522` carries
`middleware('super-admin')` and nothing else. Three things follow:

- `BookshelfScope` **throws** `RuntimeException` on any scoped model when no
  tenant is bound (`app/Models/Scopes/BookshelfScope.php:41-48`) — deliberately
  fail-closed. `Membership` and `BookshelfContact` are both scoped.
- `AuditRecorder::record()` **throws** when `bookshelfId()` is null
  (`app/Support/AuditRecorder.php:39-44`), even though `audit_log.bookshelf_id`
  is nullable precisely so that "a cross-shelf act belongs to no shelf".
- `TenantContext::systemWide()` — 3a's sanctioned widening — is fenced **by
  test** to `app/Queries/Admin/`
  (`tests/Feature/Architecture/WideningArchitectureTest.php:77-89`), whose own
  comment reads: *"A new entry outside this directory is a spec amendment, not
  a fix."*

Administration writes are Actions, not Queries, so they cannot live in
`app/Queries/Admin/`. **This spec is that amendment**, and D0 states it.

## 3. Scope

**In:** `/admin/shelves` — list, create, edit (profile, lending policy, up to
three contacts), archive and un-archive. `/admin/managers` — assign (as manager
or shelf admin), revoke, promote to super admin. A `BookshelfPolicy`. The
cross-shelf write capability and global audit rows of D0. Seven new audit
actions and the fifth audit group they need. A `managersMissing` flag on 3a's
dashboard query.

**Out:** everything in 3b-ii and 3c above. No change to `ResolveTenant` (D4).

## 4. Decisions

### D0 — A sanctioned cross-shelf *write* capability, fenced like 3a's read

3a established the pattern: widening is confined in namespace and in time, and
both are pinned by test. 3b-i extends it to writes, and keeps the fence.

- **Namespace.** Administration commands live in `app/Actions/Admin/`, and
  `WideningArchitectureTest` is amended to allow `systemWide()` there **as well
  as** `app/Queries/Admin/`. Note the amendment is not appending to a list: the
  fence is a closure, `->reject(fn ($path) => str_starts_with($path,
  'app/Queries/Admin/'))` (`tests/Feature/Architecture/WideningArchitectureTest.php:85`),
  and the test's own name string says "confined to app/Queries/Admin" (`:76`).
  Both change, plus the `$allowed` array's comment. The test keeps its shape, and
  it changes in a spec, which is what its comment demands.
- **Time.** `systemWide(callable)` already restores the previous context in a
  `finally`. Nothing in this phase calls the bare `actSystemWide()`, which stays
  pinned to its existing three files.
- **Audit.** `AuditRecorder` gains a sibling for shelf-less acts rather than
  relaxing `record()`. `record()` keeps throwing on a null tenant — that guard
  protects every shelf-scoped command in the app and must not be weakened to
  serve seven administration actions. The new path takes the shelf explicitly
  (or null) and is itself fenced to `app/Actions/Admin/`.

**Widened writes carry a hazard widened reads do not, and admin Actions must
answer it.** Under `systemWide()`, `BookshelfScope::apply()` returns before
adding any `where` (`app/Models/Scopes/BookshelfScope.php:34-37`) and
`BelongsToBookshelf::creating` returns **without stamping `bookshelf_id`**. So a
widened `Membership::find($id)` reaches every shelf, and a widened `create()`
silently writes a null `bookshelf_id`. Every Action in `app/Actions/Admin/`
therefore names its own shelf filter and its own `bookshelf_id` explicitly —
the same discipline `AdminOverviewQuery`'s docblock already states for reads
("under a widening there is no scope doing the narrowing"). Nothing else in the
write path assumes a bound tenant: there are no observers, and
`BelongsToBookshelf::updating` is a no-op under widening.

Two of D10's actions *require* this and cannot be done any other way:
`user.promoted_super_admin` belongs to no shelf, and `bookshelf.created` names a
shelf that does not exist when the command begins.

### D1 — The slug is fixed after creation, and the database already says so

BR §16.4: *"The slug is fixed after creation, since it appears in shared links."*
A parish prints `/shelves/dong-thap` on a notice and glues QR labels inside book
covers; moving it breaks both.

**This is already enforced by a database trigger.**
`database/migrations/2026_08_26_000020_add_immutability_triggers.php:33-37`
raises `SQLSTATE 45000` on any `UPDATE` that changes `slug`, and
`app/Models/Bookshelf.php:29` records it: *"{shelf} binds by slug, and slugs are
immutable by trigger."* Route model binding is by slug (`getRouteKeyName()`).

So the application layer is defence in depth, not the enforcement: the update
path **never passes `slug` through**, so a hand-crafted request is dropped before
it reaches MariaDB. This matters because `Bookshelf::$guarded` lists only the
four generated columns (`app/Models/Bookshelf.php:27`) — `slug` and `status` are
mass-assignable, so `update($request->all())` is live ammunition.

**The test must expect the right failure.** A request carrying a changed slug
leaves the stored slug untouched *because the controller dropped it* — a green
test here must not be a `QueryException` from the trigger, which would mean the
application layer let it through and only the database saved us. The test
asserts both: the slug is unchanged **and** no exception was raised.

Create validates uniqueness against `bookshelves.slug_active`, a stored
generated column (`IF(deleted_at IS NULL, slug, NULL)`) with a unique index, so
uniqueness-while-alive is an index rather than a check.

### D2 — Profile and policy save separately, and the policy form carries eight settings

The reference splits the editor into `updateBookshelfProfileAction` and
`updateBookshelfPolicyAction` (`old_next/src/app/quan-tri/admin-actions.ts:225,263`)
and we keep that seam. They are different kinds of edit — what the shelf *is*
versus how lending behaves — and a typo in `loan_days` should not block
correcting an address. Each form reports its own success and its own refusal,
beside itself; the reference records at length why a single `?saved=1` on a page
with two independently-submittable forms cannot say which form saved.

**The policy form carries the reference's eight**, not BR §5.5's full list:
`loan_days`, `max_concurrent_loans`, `max_renewals`, `renewal_days`,
`hold_days`, `due_soon_days`, `comments_enabled`, `comments_require_approval`.

**The key is `comments_enabled`, not BR §5.5's `allow_comments`.**
`app/Support/Community/CommentSettings.php:22` carries a warning about exactly
this, and `fromShelf()` reads `$settings['comments_enabled'] ?? true` (`:54`).
An editor writing `allow_comments` would appear to save and change nothing. The
first draft of this spec took the key from the requirements instead of the code —
which is the mistake that comment exists to prevent.

Of BR §5.5's remaining four, **two** are live and uneditable:
`public_show_current_borrower` (`app/Queries/BookDetailQuery.php:127`) and
`public_name_display` (`:141`) are both read by shipped code with no editor
anywhere in the application, and this phase does not add one. That is a real gap
and it is recorded in `docs/known-gaps.md` rather than fixed by quietly widening
a form the reference deliberately kept at eight — its own docstring calls them
*"the six lending-policy numbers and the two comment toggles"*
(`old_next/src/app/quan-tri/admin-actions.ts:256`).

The other two are not a gap at all. **`leaderboard_enabled` and
`leaderboard_size` are consumed nowhere** — zero hits across `app/`,
`resources/`, `database/` and `lang/`. The leaderboard opt-in was withdrawn on
2026-08-12 (`docs/DATABASE.md:490`), and *Bạn đọc chăm nhất* now counts every
borrower without reading a setting
(`app/Http/Controllers/Manage/StatisticsController.php:23`). They survive only in
the requirements. Recording them as "shipped but uneditable" would plant exactly
the false-premise-copied-from-requirements defect that `known-gaps.md:4331-4338`
already dissects for 3a, so they are recorded as **stale requirements text**
instead.

### D3 — Contacts: one required, two conditional, none public

BR §189 and §16.4. Up to three per shelf; `bookshelf_contacts.position_key` (a
generated `SHA2` of shelf and position, null when deleted, unique) already
enforces one row per position, and a `CHECK (position BETWEEN 1 AND 3)` bounds
it.

- **Position 1 is required by the interface, not by the column.** A shelf
  onboarded before this table existed may have no contacts, and is *flagged
  incomplete* rather than assigned an invented volunteer. 3a's dashboard already
  returns `contactsMissing` for exactly this.
- **Positions 2 and 3 are saved only when a name is given** — a blank name means
  no row, not an empty row.
- `role_label` is free text: a parish names its own volunteers' jobs
  (*Người giữ chìa khoá*, *Quản lý tủ sách*). No enum.
- **No caller without a membership may read this table** (BR §189, verbatim).
  Nothing in this phase exposes contacts to a public route; 3a's portal already
  refused to.

### D4 — Archived means archived: 404 for everyone, and `ResolveTenant` does not change

**Reversed after review.** The first draft proposed letting an archived shelf's
managers through while 404ing its readers. The reference refuses that carve-out
in a signed comment at the exact line it would live
(`old_next/src/auth/guards.ts:27-37`):

> `status = 'active'` here means an archived shelf resolves to `shelf_not_found`
> for everyone who reaches it by slug — including its own admin… a bespoke "but
> let the admin in anyway" carve-out here would quietly split what "archived"
> means depending on who is asking. If a genuine "manage an archived shelf" need
> shows up later (reactivating it, exporting its records), it should get its own
> explicit admin path.

It names *reactivating and exporting* — the first draft's own two justifications
— and routes them elsewhere. Three further facts, all measured, agreed with it:

1. **A super administrator holds no membership anywhere.** `MembershipRole` has
   no super-admin case; `ResolveTenant` resolves a `Membership`
   (`app/Http/Middleware/ResolveTenant.php:63-68`). A literal role filter would
   404 the super admin too, and the first draft's own table gave them 200 — the
   decision contradicted itself.
2. **`SweepReminders` filters on loan status, never shelf status**, and runs
   system-wide. Under a manager-only carve-out it would keep writing due-soon
   and overdue notices to readers who can no longer open the page that shows
   them.
3. The reader's notification bell, loan history and read-receipts all live under
   `shelves/{shelf}/profile/*` (`routes/web.php:218-233`) and are tenant-bound,
   so a partial carve-out strands them anyway.

**The decision, ruled by the product owner on 2026-08-31 after seeing the
above:** archiving takes a shelf out of circulation entirely. Readers, managers
and the portal alike get 404.

**And therefore `ResolveTenant` is not changed in this phase.** The gap
`docs/known-gaps.md:4306-4338` records is real, but closing it is a change to the
entry condition of every tenant-bound route in the application, and the
behaviour that makes it *safe* to close — un-archiving from the admin area — is
what 3b-i builds. Doing both at once would ship the blast radius and
its remedy in the same unreviewed breath. **3b-i builds the un-archive half of the explicit admin path
the reference names; the resolver filter follows in 3b-ii**, against a phase
where the repair route already exists.

**The other half is not built and not scheduled.** The reference names two needs
— *"reactivating it, exporting its records"* — and 3b-i builds only the first.
Exporting an archived shelf's register has no home in 3b-ii's list either. So the
resolver filter must not land until export is scoped, or archiving becomes a way
to make a parish's own records unreachable. This is recorded in
`docs/known-gaps.md` as a precondition on 3b-ii rather than left implicit.

### D5 — Revoking is demotion to reader, with a confirmation that says so

`revokeManager` sets `role = 'reader'` and leaves the membership standing
(`old_next/src/domain/admin/commands/managers.ts:107`); revoking someone already
a reader is refused as `not_permitted` (`:105`). That is what BR §16.4's
*"states plainly that history is retained"* means concretely — the person keeps
their membership, registration, loan history and audit trail; only the grant
goes.

**The confirmation is an interface requirement, not just a data-model fact.**
BR §16.4: *"Revocation requires confirmation and states plainly that history is
retained."* So the revoke control opens a confirmation naming the person and the
shelf and saying, in Vietnamese, that their history is kept. §5 tests it.

**There is deliberately no demotion from super admin**, and the reference's
docstring is the reasoning (`managers.ts:132-134`):

> Removing the last administrator's own grant would lock the installation out of
> its own administration surface, and nothing in the requirements says what
> should happen instead.

We port the omission as an omission and record it, rather than inventing a rule
the requirements do not contain. `promoteSuperAdmin` refuses a target who is
already a super admin (`:148`).

### D6 — Revoking a shelf's last manager is permitted, and 3b-i makes it visible

The reference permits it: `revokeManager` counts nothing. So a super
administrator can leave a shelf with no manager — no one to approve a
registration or lend a book — and only the admin area can repair it.

We port the behaviour faithfully rather than inventing a refusal, its wording and
its edge cases (what of a shelf whose only manager is suspended?). But the first
draft justified that by claiming 3a's dashboard would flag it, and **that was
false**: `AdminOverviewQuery`'s return shape
(`app/Queries/Admin/AdminOverviewQuery.php:124`) carries no manager count, and
its `readers` figure counts active memberships *including* managers, so it
cannot even serve as a proxy.

So 3b-i adds one: **`managersMissing`** on the dashboard row, beside the
`contactsMissing` that is already there. A permitted sharp edge that nothing
surfaces is just a hole; the same screen that flags a shelf with no contacts
should flag a shelf with no manager. This is a small addition to a 3a query and
is in scope precisely because D6 is otherwise indefensible.

### D7 — Assigning takes a role: manager or shelf admin

`MembershipRole` has `Admin = 'admin'` at rank 3 alongside `Manager`
(`app/Enums/MembershipRole.php:11,22`), `act-as-admin` is a defined gate, and the
reference's `assignManager` takes `role: "manager" | "admin"`, validated
(`managers.ts:20,28`).

So the assign form offers both, revoke demotes either to `reader`, and the
`/admin/managers` list shows which role each person holds. The first draft
mentioned "manager or shelf admin" in passing without ever saying the form
offered a choice.

### D8 — The taxonomy editor lands in 3b-ii, on this same screen

BR §16.4 places the parish-taxonomy editor inside the Bookshelves screen. The
split puts taxonomy in 3b-ii, so 3b-i builds the editor with its profile, policy
and contacts sections and 3b-ii adds a taxonomy section to the same screen.

The rework risk is real — taxonomy is not one more flat form but a sub-editor
with level count, labels, a nesting flag and unit-list CRUD. What makes it
tolerable is D2's rule that **each section is its own form with its own submit
and its own refusal**: adding a fourth such section is an addition, not a
restructure. `parish_taxonomy` is a single JSON key in `bookshelves.settings` and
units live in `parish_units`, so the data seam is clean too. **3b-i must not
build the editor as one submit covering all sections.**

### D9 — A `BookshelfPolicy`, 404 rather than 403

The eight existing policies cover per-shelf resources. Administration is not
tenant-scoped and its gate is `users.is_super_admin`.

`EnsureSuperAdmin` already guards the group and aborts **404**
(`app/Http/Middleware/EnsureSuperAdmin.php:20`). The policy answers the
object-level questions middleware cannot — may this shelf be archived, may this
membership be revoked — and returns the same shape via `denyAsNotFound()`, so a
refusal is indistinguishable from a row that is not there.
`MembershipPolicy`'s own docblock already flags this 403-vs-404 mismatch, which
is what `denyAsNotFound()` anticipates.

### D10 — Seven audit actions, a fifth group, and the tests that pin them

`AuditSentences::ACTIONS` holds **41** entries — pinned literally by
`tests/Unit/Audit/AuditSentencesTest.php:416`. (The first draft said 115, which
was `grep -c "=>"` over the whole file reported as a count of actions.)

| action | when |
|---|---|
| `bookshelf.created` | a shelf is created |
| `bookshelf.updated` | profile or policy saved |
| `bookshelf.archived` | a shelf is archived |
| `bookshelf.unarchived` | a shelf is restored |
| `membership.role_assigned` | a reader is made manager or shelf admin |
| `membership.role_revoked` | a manager or shelf admin is demoted |
| `user.promoted_super_admin` | a person is granted the global role |

None collides: the six existing `membership.*` entries are registered, approved,
rejected, suspended, reactivated and left. The naming follows the file's
`entity.past_participle` convention. `bookshelf.unarchived` is ours rather than
BR §458's six, because D4 makes un-archiving the documented repair path and an
unaudited un-archive would be the one administration act with no record.

**This is more work than a lookup-table edit**, and the first draft treated it as
one. `AuditSentences::GROUPS` is a closed set of four (`:101`), and
`AuditSentencesTest:410-417` asserts those four *partition* the map with nothing
left over, hard-coding both the group names and the count. Every action also
needs a `phrase()` arm (a separate test asserts none falls through to the
fallback) and a Vietnamese line in `lang/vi/audit.php`. So this task adds a fifth
group `administration`, seven `phrase()` arms, seven Vietnamese sentences, and
updates the partition test's group list and its count from 41 to 48.

**And it must first retire `bookshelf.created` as the suite's canonical
stranger.** That exact string is the probe three tests use to obtain the
undescribed-action fallback:

| site | asserts today | after D10 |
|---|---|---|
| `AuditSentencesTest.php:26-31` | `sentence('bookshelf.created')` **is** the fallback | red |
| `AuditSentencesTest.php:188` | `groupOf('bookshelf.created')` is **null** | red |
| `AuditSentencesTest.php:402` | computes `$fallback` from it, then asserts no action equals it | red |

Registering it reddens all three, and the third is the dangerous one: "fixing" it
by swapping in another arbitrary string silently stops the census covering
anything unless the replacement is *guaranteed* unregistered. So the task
introduces a deliberately synthetic probe — an action name no domain will ever
claim — and uses it at all three sites, so the census keeps biting.

(`tests/Feature/Oversight/AuditLogQueryTest.php:67,131` also names
`bookshelf.created`, as a null-shelf row that must not appear in a shelf-scoped
query. That one stays valid and becomes a better test once the action is real.)

## 5. Testing

The risks are authorisation, tenancy and audit completeness — not markup.

1. **Slug immutability, at the application layer** — an update carrying a changed
   slug leaves the slug unchanged **and raises no exception**. A `QueryException`
   from the trigger is a *failure* of this test: it means the controller passed
   it through and only the database saved us.
2. **Contacts are not public** — no route added here reads `bookshelf_contacts`
   for a caller without a membership.
3. **Positions 2 and 3 are conditional** — a blank name saves no row; a named one
   saves exactly one, at the right position.
4. **Revoke is demotion** — the membership row survives with `role = 'reader'`,
   `id` unchanged, and its loans and audit rows still resolve.
5. **Revoking a reader is refused**, and **promoting an existing super admin is
   refused**.
6. **The revocation confirmation exists** and states that history is retained.
7. **`managersMissing` is true for a shelf whose last manager was revoked** —
   the flag D6 depends on, tested through the revoke path rather than by
   fixture, so it proves the sharp edge is actually visible.
8. **Global audit rows land** — `user.promoted_super_admin` writes a row with
   null `bookshelf_id`; `bookshelf.created` writes one naming the new shelf.
9. **The census still passes**, and the partition test covers five groups and 48
   actions.
10. **The widening fence still bites** — a `systemWide()` call added outside
    `app/Queries/Admin/` and `app/Actions/Admin/` still fails
    `WideningArchitectureTest`. Amending an architecture pin is exactly when to
    prove it still refuses everything else.
11. **The audit fence bites too** — the shelf-less `AuditRecorder` sibling is
    pinned to `app/Actions/Admin/` by its own test, in the same shape. D0 makes
    two guarantees; without this, only one of them is pinned.
12. **The fallback probe is genuinely unregistered** — whatever action string
    replaces `bookshelf.created` at the three sites above is absent from
    `AuditSentences::ACTIONS`, asserted rather than assumed.

Per project practice, **every test is watched failing before it is accepted** —
mutate what it protects, see red, restore, confirm `git status --porcelain` is
clean.

## 6. Risks

- **D0 amends a pinned architecture test.** That is sanctioned here (the pin's
  own comment asks for a spec) but it widens the blast radius of any future
  mistake in `app/Actions/Admin/`. Test 10 is the compensating control.
- **A shelf can be left with no manager** (D6), by decision, now flagged.
- **No super-admin demotion** (D5), ported as an omission.
- **Four shipped settings remain uneditable** (D2), recorded rather than fixed.
- **The archived-shelf resolver filter moves to 3b-ii** (D4). Until then an
  archived shelf still serves its routes — the pre-existing Phase 0/1 behaviour,
  unchanged by this phase and still recorded in `known-gaps.md`.
- **The shelf editor reopens in 3b-ii** for taxonomy (D8); D2's per-section forms
  are what keep that an addition.
