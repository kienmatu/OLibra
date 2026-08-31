# Phase 3a — the network foundation — design

**Date:** 2026-08-31
**Status:** awaiting approval
**Branch:** `feat/phase-3a-network-foundation`, cut from `main` at `da93891`

## Context

OLibra is a Vietnamese parish library system being rewritten from a Next.js
application (`old_next/`, kept in-tree read-only as a behavioural reference) onto
Laravel + Inertia + React + MariaDB, for deployment to shared cPanel hosting.
Phases 0 through 2c are merged: the catalogue, members, circulation, oversight,
borrow requests and holds, the community voice, and statistics with QR labels.

A reader arriving here needs one fact about the codebase above all others,
because the whole of this phase turns on it. **Every read in this application is
bounded by tenancy.** `BookshelfScope`, applied through the `BelongsToBookshelf`
trait, puts a `bookshelf_id` predicate on every scoped model, and the house rule
is absolute: no query writes that predicate by hand, and a row belonging to
another parish is **not found** rather than **refused** — a 404, never a 403, so
that a refusal cannot confirm which shelf URLs exist (spec §5.4). Thirteen
independent reviews in Phase 2c alone verified some version of that property.

Two further facts shape this phase. `super_admin` is **not** a membership role —
`App\Enums\MembershipRole` has `reader`, `manager` and `admin`, and the super
administrator is the global boolean `users.is_super_admin`. And the source
documents are `docs/BUSINESS-REQUIREMENTS.md` (BR) and `docs/OPERATIONS.md`
(OPS); features are ported from what they describe as built, and every divergence
is numbered and recorded rather than made silently.

## Problem statement

Phase 3 is the network: the portal directory, multiple bookshelves, super-admin
tooling, cross-shelf statistics and per-manager audit views. It is the first
phase in which the product has more than one parish in view.

That creates a problem the previous phases did not have. **The administration
screens must read across shelves, and every safety property this codebase has
been built on assumes reads are bounded to one.** A super administrator's
dashboard showing "one row per bookshelf" is, by construction, a read that no
`BookshelfScope` may bound.

The hatch for this exists and was designed for exactly this moment.
`TenantContext::actSystemWide()` sets a flag that removes filtering — and its own
docblock is explicit that this is "a capability spec §5 sanctions widening into.
Console commands, seeders and admin queries opt in BY NAME." But **no production
code has ever called it.** Only seeders and test fixtures. Phase 3a is where it
becomes real, and it does not narrow the tenant — it removes the predicate
altogether.

So the question this phase must answer, before any administration screen is
built, is: *what stops that capability from spreading?* Answer it once, here, and
3b and 3c inherit the answer. Answer it badly, and every subsequent phase widens
a little further with nothing to notice.

Phase 3 is also too large for one specification — larger than Phase 2, which
shipped as 2a, 2b and 2c. It is decomposed below, and this document specifies
only the first slice.

## The decomposition

Ruled by the product owner on 2026-08-31.

- **3a — the network foundation** (this document). The sanctioned cross-shelf
  capability and its guard, the public portal, and the administration dashboard.
  Few screens, but it is where the tenancy risk lives, so it ships and is
  reviewed alone before anything builds on it.
- **3b — shelf administration.** Bookshelves (create and edit, slug, lending
  policy, up to three contacts, the parish-taxonomy editor and its unit lists),
  Managers (assign, revoke, promote), System settings and the public Contact page
  those settings feed. The manager-side `/units` and `/settings` placeholders fold
  in here, being the same subject matter.
- **3c — oversight and feedback.** The cross-shelf audit browser, per-manager
  activity, the cross-shelf profile-change queue, the feedback inbox, and the
  reader's *Góp ý* — the slice Phase 2b deferred.

## What 3a ships

**1. `AGENTS.md` corrected to describe this repository.**

**2. `App\Queries\Admin\`** — the only namespace permitted to widen tenancy —
with `AdminOverviewQuery` as its first member, and a falsifiable architecture
test as its guard.

**3. The portal.** `/shelves` already renders active shelves from Phase 0's
skeleton (`ShellController::shelves`, verified). It gains a search box and shows
address alongside location.

**4. The administration dashboard.** A new `/admin` index route, its screen, and
the query behind it.

## Decisions taken

### D1. Widening is confined to one namespace, and a test proves it

`TenantContext::actSystemWide()` may be called **only** from within
`app/Queries/Admin/`. `AdminOverviewQuery` calls it once, by name, at the top of
its own method:

```php
final class AdminOverviewQuery
{
    public function run(): array
    {
        // The ONE place this phase removes the tenant predicate. Confined to
        // this namespace by LabelsArchitectureTest's sibling, and pinned there.
        $this->context->actSystemWide();
        ...
    }
}
```

An architecture test asserts that no file outside `app/Queries/Admin/` contains
that call, allow-listing `TenantContext`'s own declaration by name.

**The pin must be watched failing.** Phase 2c shipped an architecture pin whose
first draft was vacuous — it compared a bare path against offender entries
carrying a `"(line N)"` suffix, so deleting the thing it guarded still reported
55 passed. It was caught only because falsification was mandatory. The same
standard applies here: add a call outside the namespace, watch the test redden,
remove it, and prove `git status --porcelain` clean.

**Rejected: binding each shelf in turn.** Looping the shelves and calling
`TenantContext::set()` per shelf would never break the invariant at all, and
would reuse queries that have already passed review. It was rejected for query
count — five metrics across every parish, on a page whose whole purpose is one
screen of totals — but it remains the honest fallback if the pin cannot be made
non-vacuous. **A widening that cannot be pinned must not ship**; take the loop
instead.

**Rejected: raw aggregate SQL grouped by `bookshelf_id`.** One fast statement,
and precisely the shape `TenancyArchitectureTest` exists to catch. It also
hand-writes the tenant column, which every phase of this project has forbidden.

### D2. The portal shows name, location and address

BR §16.1 says the portal shows "**name and address, nothing else**". The shipped
page sends `location`; the `bookshelves` table carries **both** a `location` and
an `address` column. Ruled by the product owner on 2026-08-31: **show both.**

BR's "nothing else" was written to exclude book counts, reader counts and shelf
contacts — the sentence continues "because a person with no membership has no
business knowing them" — not to forbid a second line of geography. A parent
looking for their own parish is served by both.

### D3. "Pending" is the reference's own sum, not a new definition

BR §16.4 says the dashboard shows "pending items" without saying what counts.
`old_next/src/domain/admin/queries/get-admin-overview.ts` defines it, and this
port takes that definition rather than inventing one:

- memberships with `status = 'pending'`
- borrow requests with `status in ('pending', 'approved')`
- comments with `status = 'pending'`
- book donations with `status = 'pending'`

**`approved` counts as pending for requests, and that is deliberate** — an
approved hold that nobody has collected is still waiting on a person, which is
what the number is for.

### D4. A shelf with no contacts is flagged, not filled in

The reference's overview carries an existence check against `bookshelf_contacts`.
BR §5.4 explains it: a shelf onboarded before that table existed "may have no
contacts at all, and is flagged incomplete on `/quan-tri/tu-sach` rather than
assigned an invented volunteer." BR §16.4's dashboard says "anything needing
attention is flagged", so the flag is computed here and shown here.

### D5. Every figure is computed live

No materialised counters. The reference's own docblock gives the reason, and it
is worth keeping: *"a dashboard is exactly where a materialised counter would be
believed longest."* OPS §3.4's `GetAdminOverview` row says the same —
"Overdue counts, pending-item counts per shelf, all live".

### D6. `AGENTS.md` is corrected to describe the repository

It prescribes **fourteen components this repository does not have** — `Pill`,
`StatusBadge`, `StatusPanel`, `StepIndicator`, `ReadOnlyValue`, `BookTitle`,
`Field`, `Textarea`, `BookCover`, `PhoneLink`, `ButtonLink`, `BigActionLink`,
`QrScanner`, `CopyScanField` — and its component table routes twice through a
`field.tsx` that does not exist. Its numbered non-negotiable rules **1, 2 and 6**
each cite one.

This is not cosmetic. It misdirected three tasks in Phase 2b, each of which
needed its brief to override the house style guide, and in Phase 2c it cost a
warning paragraph in every screen dispatch. Phase 3 has thirteen screens across
its three slices, which is the largest exposure yet.

Ruled by the product owner on 2026-08-31: **correct the guide** rather than build
the components. The correction describes what is actually present —
`components/ui/{badge,label,card,checkbox,input,select,button}.tsx` and
`components/input-error.tsx` among them — and rewrites rules 1, 2 and 6 to name
real things. **Where a rule's intent survives its missing component, the intent
is kept and only the mechanism changes**: rule 2's "status is never colour alone"
is a good rule whether or not a `StatusBadge` exists to enforce it.

## Testing

The interesting tests in this phase are **the inverse of every tenancy test
written so far.** Thirteen reviews in Phase 2c verified that another shelf's rows
are invisible; 3a must prove the opposite — that the dashboard sees **every**
shelf — while proving the capability that allows it cannot spread.

- **Two shelves, both visible**, each carrying its own counts, with neither
  shelf's rows inflating the other's row. This is the test that would fail if
  `actSystemWide()` were forgotten, and the test that would fail differently if
  the counts were not correlated per shelf.
- **A non-super-admin meets 404 on `/admin`**, never 403 — spec §5.4, and
  `EnsureSuperAdmin` (already shipped) is what enforces it. Note the trap this
  project has measured: a 404-only assertion is **vacuous when no route claims
  the URI**. `/admin` is a new path, so this block is meaningless until the route
  exists — check it refuses for the right reason afterwards.
- **The architecture pin reddens** when `actSystemWide()` is called from outside
  `app/Queries/Admin/`, measured rather than asserted.
- **The portal's search narrows**, and a shelf with no contacts is flagged.

## Explicitly not in scope

- Everything in 3b and 3c, listed under "The decomposition" above.
- **Building the fourteen components.** D6 corrects the guide; creating a design
  system is a separate piece of work and a separate decision.
- Any change to `BookshelfScope`, `BelongsToBookshelf` or `TenantContext` beyond
  *calling* the capability that already exists. The hatch is built; this phase
  uses it and fences it.

## Risks

1. **The capability spreads.** This is the phase's central risk and D1 is the
   whole answer to it. If the pin is vacuous, the fence is decorative, and every
   later phase widens a little further with nothing to notice. Hence: watch it
   fail, or take the loop instead.
2. **The dashboard is the first page in the product with no tenant bound.** Any
   code it reaches that assumes a bound tenant will fail — loudly, by design,
   since `BookshelfScope` throws on an unset tenant rather than returning
   everything. That is the correct failure mode, but it means the dashboard's
   query must be written against models directly rather than reusing shelf-scoped
   queries that assume a context.
3. **`AGENTS.md`'s correction is judged against a moving target.** The components
   present today are what the correction must describe; anyone adding one later
   must update the guide. That is inherent, and better than a guide describing a
   design system nobody built.
