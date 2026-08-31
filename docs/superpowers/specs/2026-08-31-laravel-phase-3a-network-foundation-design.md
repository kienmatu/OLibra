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
**Console commands**, seeders and admin queries opt in BY NAME."

**RETRACTED:** an earlier draft of this section said "no production code has ever
called it. Only seeders and test fixtures." That is false, and the repository
already knew it. `app/Console/Commands/SweepReminders.php:106` calls
`$tenant->actSystemWide()` — a nightly scheduled command serving every parish,
shipped in Phase 2a — and `tests/Feature/Architecture/TenancyArchitectureTest.php`
allow-lists that file with the comment *"the reminder sweep is the one non-seeder
caller of `TenantContext::actSystemWide()`"*. The claim was written without being
grepped, which is this project's chronic defect committed in the sentence
introducing a phase about being careful.

The honest framing is stronger than the false one. **There is a precedent, and it
is allow-listed rather than forbidden.** The question 3a must answer is not
"should we ever widen" — that was settled in 2a — but whether the allow-list
generalises from one nightly console job to a family of request-path queries.
3a's widening is the **second**, and the first on an HTTP request path. That
distinction is the whole of D1, because a console command runs in a process that
exits; a request does not.

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

**2. A scoped widening capability and its two guards.** `TenantContext` gains a
`systemWide(callable)` wrapper that restores the prior state in a `finally` (D1);
`App\Queries\Admin\` becomes the only namespace permitted to call it, with
`AdminOverviewQuery` as its first member; and two falsifiable architecture tests
pin the namespace and the lifetime respectively.

**3. The portal.** `/shelves` already renders active shelves from Phase 0's
skeleton (`ShellController::shelves`, verified — it sends `slug`, `name`,
`location`). It gains a **diacritic-folding** search box and shows address
alongside location. **This brings 3a's one migration** (D8): `bookshelves` has no
folded column, and every other search in the codebase matches a stored generated
one.

**4. The administration dashboard.** A new `/admin` index route, its screen, and
the query behind it. `resources/js/layouts/admin-layout.tsx` **already ships** —
its nav lists four of the seven admin routes and has no dashboard entry, so 3a
adds that link rather than building a layout.

## Decisions taken

### D1. Widening is confined in NAMESPACE and in TIME, and both are pinned

**This decision was rewritten after independent review measured that the first
version did not contain what it claimed to contain.**

#### The leak, measured

`TenantContext` is bound `scoped` (`app/Providers/AppServiceProvider.php:48`) —
one instance per request. `actSystemWide()` (`TenantContext.php:44`) sets
`$systemWide = true` and nulls both `bookshelf` and `membership`. **Nothing
resets it.** `clear()` exists at `TenantContext.php:110` — line 71 as this
paragraph first shipped, before the `systemWide()` wrapper (now
`TenantContext.php:73`) was inserted above it — and has **zero callers**
anywhere in `app/` (re-grepped at the end of the branch: still zero).
`ResolveTenant` runs before the controller, so it cannot undo a widening the
controller performs.

Proven by probe rather than reasoned: with shelf A bound and one book on each of
two shelves, `Book::query()->count()` returns **1**; after a widening call inside
another object's method it returns **2**, with `bookshelf()` and `membership()`
both `null`.

#### Why that matters more than it first appears

**The spec's original Risk 2 described the wrong failure mode.** It said code
assuming a bound tenant "will fail — loudly, by design, since `BookshelfScope`
throws on an unset tenant". That is true of **unset**. It is false of
**system-wide**: `BookshelfScope::apply` returns early on `isSystemWide()`
(line 35) and adds **no predicate at all**. The mode this phase introduces is the
**silent over-read** — precisely the inversion `BookshelfScope`'s own docblock
says fail-closed exists to prevent.

Three concrete consequences, none of which bite in 3a but all of which bite in
3b and 3c:

1. **Inertia's closure props resolve after the controller.** `Inertia\Middleware`
   shares before `$next($request)`, so the `shelf` prop is snapshotted pre-widening
   — but `unreadNotifications` and `pendingDonations` in `HandleInertiaRequests`
   are **closures**, evaluated at response-build time. On any shelf-bound page
   whose controller touched a widened query, those badges would count every
   parish's rows into one shelf's number, silently.
2. **The role gates go dark.** `$roleGate` (`AppServiceProvider.php:167`) reads
   `TenantContext::membership()`, which widening nulls. Afterwards every
   `act-as-*` gate denies for an ordinary manager — and for a super admin
   `Gate::before` returns `true` regardless, so they retain access to a shelf page
   whose every scoped read now spans the network.
3. It is the §5.4 disclosure boundary crossed on an Inertia prop rather than on a
   route.

**3a itself is safe**: the `/admin` group carries only `super-admin` middleware,
no `tenant` (verified at `routes/web.php:521`), so nothing is bound to lose. But a
namespace fence says *who may widen* and says nothing about *for how long*, and
3b and 3c add manager-facing screens.

#### The decision

**Widening is scoped to a callback that restores the prior state.** Add to
`TenantContext`:

```php
/** @template T  @param callable(): T $fn  @return T */
public function systemWide(callable $fn): mixed
{
    $bookshelf = $this->bookshelf;
    $membership = $this->membership;
    $systemWide = $this->systemWide;

    $this->actSystemWide();

    try {
        return $fn();
    } finally {
        $this->bookshelf = $bookshelf;
        $this->membership = $membership;
        $this->systemWide = $systemWide;
    }
}
```

and call it from the admin query:

```php
return $this->context->systemWide(fn (): array => /* the cross-shelf read */);
```

The `finally` restores on the exception path too, which matters: a query that
throws mid-read must not leave the rest of the request unscoped.

**This lifts the original exclusion.** An earlier draft's "Explicitly not in
scope" forbade "any change to … `TenantContext` beyond *calling* the capability
that already exists". That exclusion is **retracted** — the review established
that calling the existing capability is exactly what cannot be contained.

#### The pins — three rules, all falsifiable

**Corrected after re-review: an earlier draft of this section had pin 1 guard
`actSystemWide()` alone. That guards the wrong door.** Once D1 lands, admin
queries call `systemWide()`, never `actSystemWide()` — so `app/Queries/Admin/`
would never have needed the allow-list, while `systemWide()` itself stayed
callable from anywhere with nothing pinning it. The fence would have been
unenforced against the very API this phase introduces.

The rule is about the **capability**, not one method name, and it takes two
halves plus a lifetime check:

1. **Raw widening is funnelled through the wrapper.** `actSystemWide()` may be
   called ONLY from `TenantContext::systemWide()` itself and from these two
   pre-existing callers, allow-listed here **by name, with their reason**:
   - `app/Console/Commands/SweepReminders.php` — the nightly cross-shelf sweep,
     shipped in Phase 2a and already allow-listed by `TenancyArchitectureTest`.
   - `database/seeders/DemoShelfSeeder.php` — a seeder, widening by design.
2. **The wrapper is confined to the admin namespace.** `systemWide()` may be
   called only from within `app/Queries/Admin/`.
3. **Lifetime.** After an admin query returns, a previously bound tenant is
   **still bound** and a scoped model read **still filters** — including when the
   callback threw. An untested `finally` is a comment.

**State the scan roots explicitly, and do not copy the neighbour's blind.**
`TenancyArchitectureTest` scans `[app_path(), database_path(), base_path('routes')]`
(line 156). `database_path()` is why rule 1 must allow-list the seeder: a pin that
copied those roots without it **reddens on day one**, which is the third time in
this document's history that a pin has been specified against an allow-list
narrower than reality. If the pin instead scans `app_path()` alone, say so and
say why, rather than leaving the roots to be discovered.

**All three must be watched failing.** Phase 2c shipped a pin whose first draft
was vacuous — a bare path compared against offender entries carrying a
`"(line N)"` suffix, so deleting what it guarded still reported 55 passed. Add a
violating call, watch it redden, remove it, prove `git status --porcelain` clean.

**Both must be watched failing.** Phase 2c shipped an architecture pin whose first
draft was vacuous — it compared a bare path against offender entries carrying a
`"(line N)"` suffix, so deleting what it guarded still reported 55 passed, and it
was caught only because falsification was mandatory. Add a call outside the
namespace, watch it redden, remove it, prove `git status --porcelain` clean; then
do the equivalent for the lifetime pin.

**Rejected: binding each shelf in turn.** Looping shelves with
`TenantContext::set()` never widens at all and reuses reviewed queries. Rejected
on statement count, but it remains the honest fallback: **a widening that cannot
be pinned must not ship.** Note for whoever takes it — it is a rewrite rather than
a drop-in, because `ManagerDashboardQuery`'s metric set is not D3's (no
donations, and its reader count uses `whereHas('user')`).

**Rejected: raw aggregate SQL grouped by `bookshelf_id`** as the *shape of the
widening*; see D7 for the query shape actually chosen.

### D2. The portal shows name, location and address

BR §16.1 says the portal shows "**name and address, nothing else**". The shipped
page sends `location`; the `bookshelves` table carries **both** a `location` and
an `address` column. Ruled by the product owner on 2026-08-31: **show both.**

BR's "nothing else" was written to exclude book counts, reader counts and shelf
contacts. **Corrected:** an earlier draft said BR's sentence "continues" with
"because a person with no membership has no business knowing them". It does not —
the next sentence is "A search box, because finding your own parish is the only
job this page has", and the quoted clause is a separate, later sentence in the
same paragraph. The substance holds (BR does scope "nothing else" to counts and
contacts) but the textual link was overstated.

**Both columns are nullable**, and the shipped page already guards `location`.
Render each only when present; a shelf with neither shows its name alone rather
than an empty line or a placeholder. The search matches **name, location and
address** — all three, since a parent may recall the street before the saint.

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

### D7. The dashboard aggregates by `GROUP BY`, not by correlated subquery

D1 rejects the per-shelf loop and raw grouped SQL as *ways of widening*. This
decision names the **query shape** inside the widening, because the obvious
choice does not compile.

The reference uses correlated subqueries — `(select count(*) from books where
bookshelf_id = b.id)` per metric. Ported to Eloquent that becomes
`whereColumn('books.bookshelf_id', 'bookshelves.id')`, which **matches
`TenancyArchitectureTest`'s first pattern**, `/where[A-Za-z]*\s*\([^;]*bookshelf_id/i`
(read at line 151), and `app/Queries/Admin/` is not on that test's allow-list. It
fails the build.

**The shape is therefore one grouped aggregate per metric plus one shelf list** —
a constant number of statements regardless of parish count, which also answers
D1's statement-count objection to the loop:

```php
$books = Book::query()->groupBy('bookshelf_id')
    ->selectRaw('bookshelf_id, count(*) as n')->pluck('n', 'bookshelf_id');
```

**THE CHAIN ORDER MATTERS, and the naive form fails.** The pattern is
`/where[A-Za-z]*\s*\([^;]*bookshelf_id/i` — `[^;]*` spans the rest of the
statement, so **any `where`-shaped call anywhere earlier in the chain, followed
by the literal `bookshelf_id` later in the same statement, matches.** Measured
against the real pattern:

| Chain | Result |
|---|---|
| `Book::query()->groupBy('bookshelf_id')->selectRaw(…)->pluck('n','bookshelf_id')` | clean |
| `Loan::query()->where('status','active')->groupBy('bookshelf_id')->selectRaw(…)->pluck('n','bookshelf_id')` | **MATCH — build fails** |
| `Loan::query()->groupBy('bookshelf_id')->selectRaw(…)->where('status','active')->get()` | clean |

**Five of the six metrics need a filter**, so the unfiltered `books` example above
is the only one that survives the naive ordering. Write every filtered aggregate
as: `groupBy` and `selectRaw` **first**, the `where` **last**, and terminate with
`->get()` rather than `->pluck('n', 'bookshelf_id')` — the second argument puts
the literal back into the statement after the `where`.

This is not a trick to defeat a linter; it is the same statement either way. But
it is a real constraint on how the code is written, it is invisible until the
build fails, and an earlier draft of this decision told the implementer no
allow-list entry was needed without saying any of it.

**If a metric genuinely cannot be expressed clean, that is a spec amendment plus
an allow-list entry with its reason — not an improvisation.**

**On "one aggregate per metric":** D3's `pending` is a sum of four counts, so it
is four statements, not one. The constant-statement-count claim survives — the
total does not grow with the number of parishes — but it is roughly nine
statements, not six. `overdue` decomposes cleanly (`status = active` and
`due_on < today`, no join), matching `ManagerDashboardQuery`'s own shape.

**Retracted from D1's original text:** it rejected raw SQL because it
"hand-writes the tenant column, which every phase of this project has forbidden".
That is false. Naming `bookshelf_id` is **allow-listed**, not forbidden —
`TenancyArchitectureTest` grants it to `AuditLogQuery.php` and
`SweepReminders.php` — and `TenantContext`'s own docblock instructs widened
callers to "name their own `bookshelf_id` explicitly", because under a widening
there is no scope left to do the narrowing. The objection to raw SQL is that it
bypasses Eloquent, not that it names the column.

### D8. The portal search folds, and `bookshelves` gains folded columns

BR §16.1 makes the search box the portal's only job, for Vietnamese parish names.
Every other search in this codebase folds diacritics and matches against a
**stored generated column**: `books.title_folded`, `books.author_folded`,
`users.full_name_folded`, consumed by `SearchQuery`, `BooksListQuery`,
`ReadersListQuery` and the three lending searches.

**`bookshelves` has no folded column** — verified against the live table: `id`,
`slug`, `name`, `description`, `location`, `address`, `cover_url`, `timezone`,
`locale`, `status`, `settings`, `established_on`, `created_by`, timestamps,
`deleted_at`, `slug_active`. So the portal is the one search in this codebase
matching raw columns, and the letter it cannot reach is the Vietnamese **`đ`**:
a parent looking for a parish in *Đồng Tháp* who types `dong thap` finds nothing.

**3a therefore ships a migration** adding generated folded columns over `name`,
`location` and `address`, built with the same `FoldExpression` every other folded
column uses, and the search matches those.

**Retracted from D8's original text, and this is the fourth false premise this
document carried:** it justified the migration by claiming "a naive `LIKE` finds
nothing for *Giáo xứ Hòa Bình* when a parent types `hoa binh`, which is the exact
case the box exists for". **That claim is false, and it was the stated reason for
the whole decision.** `bookshelves.name`, `location` and `address` are all
`utf8mb4_unicode_ci`, and that collation folds vowel diacritics by itself, with
no folded column anywhere in the query. Measured on this project's MariaDB
10.11, `SET NAMES utf8mb4`:

| Expression, `COLLATE utf8mb4_unicode_ci` | Result |
|---|---|
| `'Giáo xứ Hòa Bình' LIKE '%hoa binh%'` | `1` |
| `'Giáo xứ Hòa Bình' LIKE '%giao xu%'` | `1` |
| `'Đồng Tháp' LIKE '%dong thap%'` | `0` |

**The DECISION stands; only the reason is retracted.** What the collation does
*not* fold is `đ`/`Đ` (U+0111) — the third row — which `Fold::MAP` maps to `d`,
along with the other expansions (`ß`, `æ`, `œ`, `ĳ`) this collation would also
miss. That is likewise why `books.title` is `utf8mb4_unicode_ci` and *still*
carries a `title_folded` twin: the folded columns in this codebase exist for `đ`
and for `Fold::MAP`'s expansions, not for accented vowels in general. Add the
consistency argument below, and the migration is justified — for a reason the
spec did not identify.

**How it was caught, because the process matters more than the fact.** Not by
either of the two independent reviews of this spec, nor by either review of the
plan. It was caught by the Task 5 implementer's *mandatory* mutation: the fixture
searched `hoa binh`, the implementer replaced the folded-column match with a
plain `LIKE` on the source columns expecting red, and the block **stayed green**.
A test that cannot fail is the only instrument that found this. The fixture moved
to *Đồng Tháp* / `dong thap`, where four blocks now redden under that mutation
while a fifth — deliberately labelled as the collation's own case — stays green.

**Why generated columns rather than folding in the expression.** An unindexed
`FoldExpression::sql()` in the `WHERE` would be parity-safe — it is the same
expression — and at a few dozen parishes the index buys nothing. It is rejected
because it would make the portal *the one search in the codebase that works
differently*, and BR §12's store-equals-search invariant is enforced repo-wide by
`FoldParityTest`. Consistency is worth one small migration; divergence is how the
next person's search subtly disagrees with this one.

**Note for the plan:** `Fold::MAP` has a documented cascade hazard — adding a MAP
entry re-opens it — but this migration adds no entry, only new columns over the
existing expression.

### D9. Archived shelves are listed and marked, never hidden

The reference carries this in a docblock:

> "Archived shelves are listed and marked, not hidden. An administrator is the
> only person who can see one at all — `resolveShelfId` refuses its slug to
> everybody, including its own admin — so a listing that dropped it would make the
> shelf unreachable from every surface in the application at once."

Its predicate is `deleted_at is null` only, and it returns `status` as a column.

**Retracted from D9's original text, in the same form D8's retraction takes —
and this is the fifth false premise this document carried.** The clause quoted
above, *"an administrator is the only person who can see one at all —
`resolveShelfId` refuses its slug to everybody, including its own admin"*, was
reproduced here and into three shipping artefacts as the STATED REASON for the
decision. **That clause is false of this port.**

It is true of the reference, whose guard filters on status:
`old_next/src/auth/guards.ts:22` — `where slug = ${slug} and status = 'active'
and deleted_at is null`. **At HEAD the Laravel middleware does not.**
`app/Http/Middleware/ResolveTenant.php:36` resolves a shelf by slug under the
SoftDeletes global scope alone:

```php
$shelf = $parameter instanceof Bookshelf
    ? $parameter
    : Bookshelf::query()->where('slug', (string) $parameter)->first();
```

No `status` filter, and nothing anywhere in `app/` references
`BookshelfStatus::Archived` (grepped). Measured on an archived shelf with one
ordinary active member:

| Request, as that member | Status |
|---|---|
| `GET /shelves/{slug}` | **200** |
| `GET /shelves/{slug}/catalogue` | **200** |

**The DECISION stands; only the reason is retracted.** The ground it stands on
is what *is* true here: **the admin dashboard is the only surface in the whole
application that shows a shelf's archived state at all.** Nothing else renders
`bookshelves.status`. A dashboard that dropped archived shelves would therefore
leave no screen anywhere on which an administrator could see that a shelf had
been archived — which is reason enough, and does not depend on reachability.

**The behaviour gap is PRE-EXISTING, from Phase 0/1, and 3a does not close it.**
Changing `ResolveTenant` is shelf administration, which is Phase 3b's; a
middleware change made in passing here would be unreviewed and would alter every
tenant-bound route in the application. It is recorded in `docs/known-gaps.md`
under "Phase 3a — the network foundation" as 3b's to close.

**This is stated because the adjacent D2 establishes that the PORTAL filters to
active**, and an implementer reading both could reasonably carry that filter onto
the dashboard and strand every archived shelf from the only view of its status.

**The dashboard's row is:** name, status, books, active readers, current loans,
overdue, pending (D3), and the contacts-incomplete flag (D4).

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
- **Pin 1 reddens** when `actSystemWide()` is called from outside its allow-list
  (`TenantContext::systemWide()`, `SweepReminders.php`, `DemoShelfSeeder.php`).
- **Pin 2 reddens** when `systemWide()` is called from outside `app/Queries/Admin/`.
  These are two pins, not one: an earlier draft guarded only `actSystemWide()`,
  which after D1 no admin query calls — the fence would have been unenforced
  against the API this phase introduces.
- **The lifetime pin reddens** when the widening is not restored: bind a tenant,
  run an admin query, and assert the tenant is **still bound** and a scoped read
  **still filters**. Falsify it by replacing `systemWide()`'s body with a bare
  `actSystemWide()` and watching it fail. This is the pin the first draft of this
  spec had no equivalent of, and the one that matters for 3b and 3c.
- **The widening survives an exception.** A callback that throws must still
  restore — that is what the `finally` is for, and an untested `finally` is a
  comment.
- **The portal's search folds.** `hoa binh` finds *Giáo xứ Hòa Bình*; this is the
  case the box exists for and a naive `LIKE` fails it.
- **An archived shelf appears on the dashboard, marked, and NOT on the portal**
  (D9 against D2) — the one place those two surfaces deliberately disagree.
- **A shelf with no `bookshelf_contacts` row is flagged** (D4).
- **The `pending` sum is the whole of D3** — a shelf with one pending membership,
  one `approved` borrow request, one pending comment and one pending donation
  reports **4**. The `approved` half is the one a reader would not guess, so it
  gets its own arrangement rather than riding in a total.
- **Every figure is live** (D5): change an underlying row, re-read, see the new
  number. Cheap, and it is what forbids a materialised counter arriving later.
- **`AGENTS.md` names only components that exist** (D6) — a test asserting every
  component the guide names is present under `resources/js/components/`. This is
  the pin that stops the guide drifting back, and it is why D6 is a correction
  rather than a deletion.

## Explicitly not in scope

- Everything in 3b and 3c, listed under "The decomposition" above.
- **Building the fourteen components.** D6 corrects the guide; creating a design
  system is a separate piece of work and a separate decision.
- Any change to `BookshelfScope` or `BelongsToBookshelf`.
- **~~Any change to `TenantContext`.~~ RETRACTED.** This exclusion originally read
  "any change to … `TenantContext` beyond *calling* the capability that already
  exists". Independent review established that calling the existing capability is
  exactly what cannot be contained — the flag has no reset and `clear()` has zero
  callers — so D1 adds a scoped `systemWide(callable)` wrapper. That is the
  minimum change that makes the fence real; nothing else in `TenantContext` moves.

## Risks

1. **The capability spreads.** This is the phase's central risk and D1 is the
   whole answer to it. If the pin is vacuous, the fence is decorative, and every
   later phase widens a little further with nothing to notice. Hence: watch it
   fail, or take the loop instead.
2. **~~The dashboard is the first page with no tenant bound, and will fail
   loudly.~~ RETRACTED — the failure mode is the opposite.** This risk originally
   said code assuming a bound tenant "will fail — loudly, by design, since
   `BookshelfScope` throws on an unset tenant". That is true of **unset** and
   false of **system-wide**: `BookshelfScope::apply` returns early on
   `isSystemWide()` (line 35) and adds no predicate. The real risk is the
   **silent over-read**, which is why D1 contains widening in time as well as in
   namespace. Verified separately: an `/admin` page renders fine today with no
   tenant bound — `HandleInertiaRequests::share()` yields `shelf => null`,
   `role => null`, and both count closures short-circuit on a null shelf.
3. **`AGENTS.md`'s correction is judged against a moving target.** The components
   present today are what the correction must describe; anyone adding one later
   must update the guide. That is inherent, and better than a guide describing a
   design system nobody built.
