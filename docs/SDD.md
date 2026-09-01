# OLibra — Software Design Document

**Status:** Describes the system that shipped. Written 2026-09-01, after
Phase 3 closed the last placeholder route and during the Phase 4 cutover.
It is a description, not a proposal: where this document and the code
disagree, the code is right and this document is stale.

Derived from [BUSINESS-REQUIREMENTS.md](BUSINESS-REQUIREMENTS.md), which is the
authority on *what* and *why*. This document covers *how*.

**Companion documents:** [DATABASE.md](DATABASE.md) for the schema,
[OPERATIONS.md](OPERATIONS.md) for the operation catalogue,
[DESIGN.md](DESIGN.md) for the visual language,
[known-gaps.md](known-gaps.md) for what is deliberately unfinished.

---

## 1. What this is

OLibra is a lending-library system for a Vietnamese parish bookshelf: books and
copies, readers and their registration, lending and returning, holds and a
queue, comments, announcements, donations, feedback, an audit log, and a
super-admin surface over several shelves at once.

**The stack that ships:** Laravel 13 on PHP 8.4, Inertia v3 with React 19 and
TypeScript, Vite 8, MariaDB 10.11, targeting shared cPanel hosting. Sessions,
cache and the queue all live in the database; there is no Redis, no object
store and no long-lived worker process, because the host does not offer them.

**How it got here, in one paragraph.** The application was first built as a
Next.js 16 + PostgreSQL app, and an earlier version of this document argued at
length that the backend should live inside Next.js. That decision was reversed:
over Phases 0–3 (2026-08 to 2026-09) the whole application was ported to
Laravel, Inertia and MariaDB. The reasoning for the port lives in
[`superpowers/specs/2026-08-26-laravel-mariadb-inertia-migration-design.md`](superpowers/specs/2026-08-26-laravel-mariadb-inertia-migration-design.md)
and the phase specs and plans beside it, not here. The Next.js tree was the
read-only behavioural reference for every phase and was deleted in Phase 4;
`AGENTS.md` carries the recipe for resolving a comment that still cites it.

---

## 2. The four surfaces

§1.2 of the requirements defines four surfaces. They share a domain and differ
in authorisation and routing.

| Surface | Audience | Route shape | Tenant |
|---|---|---|---|
| Public | Anyone | `/`, `/contact`, `/register`, `/login` | None |
| Portal | Anyone | `/shelves` | None |
| A bookshelf | Members of that shelf | `/shelves/{shelf}/…`, and `/shelves/{shelf}/manage/…` | **The `{shelf}` slug is the tenant key** |
| Administration | Super admin | `/admin/…` | **None, deliberately** — cross-shelf by design |

`php artisan route:list` reports **138** registered routes: 71 under
`shelves/{shelf}/manage`, 26 elsewhere under `shelves/{shelf}`, 29 under
`admin/`, one `shelves` index and 11 public or framework routes (including
Laravel's `/up` health check and the local storage-serving routes).

**URIs are English, and that is pinned.** The reference's URLs were Vietnamese
(`/tu-sach/dong-thap/danh-muc`); the port's are not. `RouteOrderTest`'s last
block asserts that every registered URI is pure ASCII and contains none of
`tu-sach`, `cho-muon`, `nhan-tra`, `nguoi-doc`, `quan-ly`, `quan-tri`,
`dang-nhap`. Vietnamese remains the only language in the *interface*; it is no
longer in the address bar. (`AGENTS.md`'s Language section still says URLs are
Vietnamese. The test is what runs.)

Middleware carries the surface distinction, aliased in `bootstrap/app.php`:
`tenant` → `ResolveTenant`, `role` → `EnsureShelfRole`, `super-admin` →
`EnsureSuperAdmin`. `RouteOrderTest` asserts every `{shelf}` route carries
`tenant`, every route with a path segment `manage` carries some `role:` gate,
every reader-area shelf route does too (except the deliberately guest-reachable
`feedback` one), and every `admin/`-prefixed route carries `super-admin`.

`bootstrap/app.php` also fixes the middleware *priority* rather than the list:
`prependToPriorityList` inserts `ResolveTenant` before `SubstituteBindings` and
`EnsureAuthenticatedUserExists` before `ResolveTenant`. The array form of
`priority()` replaces Laravel's default list wholesale and dropped
`Authenticate` from ahead of route-model binding, which turned an anonymous
request into a 404 from the tenant resolver instead of a redirect to login — an
unauthenticated existence oracle over the shelf URL space. The comment in that
file records the incident.

---

## 3. Actions and Queries

The application layer is two directories, and the split is the spine of the
codebase.

| | `app/Actions/` | `app/Queries/` |
|---|---|---|
| Does | Writes. One class per operation in [OPERATIONS.md](OPERATIONS.md) | Reads. One class per screen or panel |
| Shape | `final class X { public function execute(...) }` | `final class XQuery { public function run(...) }` |
| Owns | The transaction, the authorisation check, the audit row | Nothing; it returns arrays for Inertia to serialise |
| Files | **75** (73 classes plus two traits under `Admin/Concerns/`) | **48** (45 classes plus three traits under `Concerns/`) |

Counted with `find app/Actions -name '*.php' | wc -l` and the same for
`app/Queries`. By directory: Actions — Admin 23, Members 15, Community 14,
Circulation 10, Catalogue 10, Notifications 1, Admin/Concerns 2. Queries —
the root 31, Admin 8, Labels 3, Exports 3, Concerns 3.

A controller's job is to resolve the request into arguments, call one Action or
one Query, and render or redirect. It contains no business decisions.

**The separation is close to clean, and where it is not, it is worth knowing.**
Two Actions inject a Query: `App\Actions\Members\Registration` and
`App\Actions\Members\CreateParishUnit` both `use App\Queries\ParishContextQuery`
to read the shelf's parish taxonomy before writing a membership. No Query
imports an Action — the five files under `app/Queries/` that name
`App\Actions\…` name them only in comments. No Query touches `AuditRecorder`.
One Query opens a transaction: `App\Queries\Admin\FeedbackInboxQuery::run()`
wraps its list, its detail pane and its unread count in a single
`DB::transaction` so the three cannot disagree about what is unread — a
read-consistency device, not a write.

**An Action's own shape**, using `App\Actions\Circulation\LendCopy` as the
worked example, because it is the most important command in the system:

1. `Gate::forUser($actor)->authorize(...)` — authorisation first, outside the
   transaction.
2. `DB::transaction(function () { … }, ConcurrencyRetry::ATTEMPTS)` — the
   attempts argument is the retry, and it is pinned (§8.3).
3. Locked re-reads in a fixed order (copy first, then membership) followed by
   pure predicates from `app/Support/Circulation/`, which raise `RuleViolated`
   with a named code for the ordinary refusals.
4. The write, with the losing race translated rather than prevented:
   `UniqueViolation::translate()` maps MariaDB errno 1062 **by constraint name**
   onto a `RuleViolated` code, so `loans_one_active_per_copy` is what actually
   guarantees INV-1.
5. `$this->audit->record('loan.lent', …)` inside the same transaction.

`app/Support/` holds what neither layer owns: the clock, the tenant context, the
audit recorder, the fold, and per-slice pure logic (`Circulation/LoanRules`,
`Catalogue/CopyStateMachine`, `Members/Phone`, and the rest). Those files are
where the domain rules live in testable form; `tests/Unit/` exercises them with
no database.

---

## 4. Tenancy

A shelf's rows never leak to another shelf, and that guarantee has three layers.

**The trait and the scope.** Every model whose table carries `bookshelf_id`
uses `App\Models\Concerns\BelongsToBookshelf`, which applies
`App\Models\Scopes\BookshelfScope` globally. The scope reads the request-scoped
`App\Support\TenantContext` and adds `where <table>.bookshelf_id = ?`.

**It fails closed.** With no tenant bound and no explicit widening,
`BookshelfScope::apply()` **throws** a `RuntimeException` naming the model. This
is the inversion that matters and the reason it is written this way: under the
old PostgreSQL Row Level Security, forgetting the tenant returned *nothing*; a
scope that silently no-opped would return *everything* the first time a route
group shipped without its middleware. `RouteOrderTest` makes that a build
failure rather than a runtime one, but the throw is the backstop.

**Widening is a named capability.** `TenantContext::actSystemWide()` drops
filtering altogether — something the reference's TypeScript context could not
express at all, since its `bookshelfId` was non-nullable and even its system
context still named a shelf. The safe form is `TenantContext::systemWide(fn)`,
which widens, runs the callback and restores in a `finally` — restoring *what it
found*, so nesting restores to system-wide and an unset tenant restores to
unset. The bare `actSystemWide()` has no reset, and the object is bound
`scoped`, so a bare widening leaks for the rest of the request and leaks
silently. `WideningArchitectureTest` fences both.

**Who binds a tenant.** `ResolveTenant` (`app/Http/Middleware/ResolveTenant.php`)
is the middleware, and it is the only caller of `TenantContext::set()` that runs
for a `{shelf}` route. It is *not* the only caller in the codebase:
`App\Http\Controllers\RegistrationController` calls `$context->set($shelf, null)`
twice, at lines 43 and 91, because `/register` sits outside every route group
and takes its shelf from a `?shelf=` query parameter rather than a path segment.
(`TenantContext`'s own docblock says "Nothing else may call `set()`". Those two
call sites are the exception it does not mention.)

**`/admin` binds no tenant at all.** It is cross-shelf by nature, which is why
administration reads go through `TenantContext::systemWide()` from
`app/Queries/Admin/`, and why administration writes configure the audit recorder
explicitly (§5) instead of relying on a bound shelf.

**Two models are exempt from the trait**, and the exemption is machine-checked:
`Feedback` and `AuditLog` carry a *nullable* `bookshelf_id`, because a message
sent from the public contact page and a cross-shelf administration act belong to
no shelf. `TenancyArchitectureTest` asserts both that they do not carry the
trait and that their column is still `IS_NULLABLE = 'YES'` — a later migration
making it `NOT NULL` breaks the build.

The schema adds a fourth layer this document does not own: composite foreign
keys carrying `bookshelf_id`, so a child row cannot reference a parent belonging
to another shelf even if application code tried. See [DATABASE.md](DATABASE.md).

---

## 5. The audit log

INV-8 — every state transition writes an audit record — is enforced by
convention plus three pins rather than by a constraint.

`App\Support\AuditRecorder::record($action, $entityType, $entityId, $before,
$after)` writes one `audit_log` row. The caller owns the transaction; the
recorder only writes the row, so "the audit and the change commit or roll back
together" is a property of the Action's `DB::transaction`, not of this class.
Shelf and actor come from the bound context and `Auth::id()`, never from
parameters, so a command cannot audit itself onto another shelf or as another
user. With no tenant bound, `record()` throws.

**The configurator is the exception that proves it.** Administration commands
run with no tenant, so they call `$this->audit->global()` (the row carries a
null `bookshelf_id` and appears on no shelf's audit screen) or
`$this->audit->forShelf($id)`. Each returns a configured *clone*; only a
configured recorder may write without a bound tenant. It is a configurator
rather than a `recordGlobal()` sibling for a mechanical reason: the census
below hard-codes the literal `->record(`, and a differently named write method
would be invisible to it.

**The action name is a stable machine-readable string** — `loan.lent`,
`membership.approved` — and the Vietnamese sentence is rendered from it at read
time by `App\Support\Audit\AuditSentences`, so rewording history is a
translation change. `AuditSentences::ACTIONS` holds **66** entries
(`count(App\Support\Audit\AuditSentences::ACTIONS)`, run in the container).

**`App\Support\Audit\AuditSecrets::assertNoSecrets()`** runs on every
`before`/`after` pair before the row is written; passwords and session tokens
never reach the log.

`audit_log` rows cannot be updated or deleted: the database carries
`audit_log_no_update` and `audit_log_no_delete` triggers (INV-12), alongside
`loans_no_delete` (INV-11), `bookshelves_slug_immutable` and
`feedback_bookshelf_immutable`. Five triggers, listed from
`information_schema.TRIGGERS`.

---

## 6. Where the invariants live

[DATABASE.md](DATABASE.md) §7 has the full table of the fourteen rules; the
summary that matters for application design has not changed with the port, only
its mechanisms have.

- **The structural ones are still structural**, but the mechanisms are MariaDB
  now: a generated column plus an ordinary unique index where Postgres had a
  partial unique index (`loans_one_active_per_copy` for INV-1), a `before
  update` / `before delete` trigger for INV-11 and INV-12, a check constraint
  for INV-14.
- **INV-10 — every query scoped to one bookshelf — moved layers.** It was Row
  Level Security in the database; it is now `BookshelfScope` in Eloquent, plus
  the composite foreign keys. That is a real weakening of *where* the guarantee
  sits and the reason `TenancyArchitectureTest` exists.
- **Six still need application discipline inside a transaction** — INV-3,
  INV-4, INV-5, INV-6, INV-7, INV-8 — plus the second half of INV-13.

For those, the requirement is unchanged and non-negotiable: **the check and the
write happen in the same transaction, in an Action, never in a controller.** A
check in a controller is a check the console command and the next surface will
not perform.

---

## 7. Cross-cutting concerns

### 7.1 Authentication and authorisation

Sessions, not tokens. `SESSION_DRIVER=hashed-database`:
`App\Support\HashedDatabaseSessionHandler` extends Laravel's database session
store with one change — the table is keyed on `sha256(session id)`, never the
raw id, so a database dump (or a dump plus `.env`, which on cPanel live in the
same home directory) is not a stack of usable sessions.

Password reset is manager-issued; there is no outbound email in v1 and no reset
token by mail.

Authorisation is Laravel policies. There are **13** classes in `app/Policies/`.
`PolicyRegistrationTest` walks the directory and asserts a policy resolves for
each one's model, in both directions.

Roles are per membership, except `is_super_admin`, which is global — so
authorisation needs the shelf in scope before it can answer anything. Hiding an
action in the UI is never the control; `EnsureShelfRole` `abort(404)`s (not
403 — a 403 is an existence oracle over the URL space) and the policy check
happens again inside the Action.

### 7.2 Derived state

Overdue status, hold expiry and availability are never stored. `Quá hạn` is
computed from the loan's due date on read, which is why
`App\Enums\CopyState` has five cases (available, held, on_loan, lost, retired)
and the interface can show six badges. A migration adding an
`is_overdue`-shaped column is a defect; the answer to a slow list is an index.

### 7.3 Time

`App\Support\Clock`, injected. `now()` returns `CarbonImmutable::now('UTC')`,
which honours `Carbon::setTestNow()`. Storage is UTC.

`Clock::ZONE` is `'Asia/Ho_Chi_Minh'`, declared once
(`app/Support/Clock.php:39`), and `today()` is that civil day, not the server's
— at 01:30 in Hồ Chí Minh the server's UTC date is still yesterday, and
`due_on` means a day, never an instant. It is a constant rather than a config
key because a parish does not move. `bookshelves.timezone` exists as a column
and is deliberately unread; it starts meaning something when there is a network
of shelves.

The rule is greppable, not aspirational: no Action under
`app/Actions/Circulation/` or `app/Actions/Community/` may call the bare `now()`
helper or `Carbon::now()` (§8.3), and `LabelsArchitectureTest` holds a census of
every remaining `Asia/Ho_Chi_Minh` literal under `app/` — twelve occurrences
across eleven files — so a thirteenth cannot appear without an argument for it.

### 7.4 Errors

`App\Exceptions\RuleViolated` carries a stable code that doubles as the
`lang/vi/rules.php` key; that file holds **136** sentences. The render hook in
`bootstrap/app.php` is the *one* place a code becomes a sentence: it redirects
back with the sentence under the `errors.rule` key, which every Inertia page
reads. Business-rule refusals are never 500s and never field errors.

Two cases deserve naming because they are the ones users hit:

- **INV-1 lost race.** Two managers lend the same copy in the same second. One
  transaction fails on `loans_one_active_per_copy`;
  `UniqueViolation::translate()` matches errno 1062 *by constraint name* and
  raises the right named refusal, so an unrelated collision is never dressed up
  as the wrong sentence.
- **INV-5 loan limit.** Surfaced before the confirm step of the lending flow,
  with blocked readers shown with the reason inline.

A third case is the port's own: an InnoDB deadlock. `bootstrap/app.php` maps
`PDOException` through `ConcurrencyRetry::translate()`, so a concurrency error
that survives its retries becomes a Vietnamese sentence anywhere in the system
rather than a bare 500. `App\Support\DeadlockDetector` is bound over Laravel's
contract and deliberately leaves a lock-wait *timeout* out of both the retry and
the translation.

### 7.5 Internationalisation

Vietnamese is the only shipped locale, and no user-facing string is hard-coded
in a way that blocks a later one. `lang/vi/` holds `audit.php`, `auth.php`,
`exports.php`, `notifications.php`, `rules.php` and `validation.php`.

Notification and audit *content* is stored as a kind plus a payload, never as a
rendered sentence, so wording changes do not rewrite history. Dates and numbers
are formatted through the locale. The one bullet that has changed since the
pre-port version of this document is URLs: they are English now (§2).

### 7.6 Search

Diacritic-insensitive substring matching over title and author, and the
normalisation applied when storing must be **identical** to the one applied to
the search term (BR §12).

There are two renderings of one table, not two implementations:

- `App\Support\Fold::fold()` — PHP: `mb_strtolower` → `strtr(Fold::MAP)` →
  non-`[a-z0-9]` runs to one space → `trim`.
- `App\Support\FoldExpression::sql()` — MariaDB: `LOWER` → one `REPLACE` per
  `Fold::MAP` entry → `REGEXP_REPLACE` → `TRIM`, rendered into the generated
  columns (`title_folded`, `author_folded`, `full_name_folded`, and the shelf's).

`Fold::MAP` has **145** entries (`count(App\Support\Fold::MAP)`), and
`FoldExpression` renders multi-code-point keys innermost, because `strtr()` is a
single simultaneous pass while a `REPLACE` chain re-scans what it just produced.
`tests/Feature/FoldParityTest.php` proves the two renderings agree over every
map entry, a U+00C0–U+024F sweep and the real corpus;
`tests/Unit/FoldTest.php` closes the gap parity cannot — that a typo in `MAP`
would satisfy both sides identically — with an NFD-derived oracle.

No `Normalizer`, deliberately: MariaDB cannot NFD-decompose, so a decomposition
step in PHP would make the two halves different functions for every accented
letter outside the table. Anything unmapped degrades to a space on both sides
identically, which keeps store==search even where the fold is lossy.
`CatalogueArchitectureTest` bans `strtr(` outside `Fold` so a third copy cannot
appear.

### 7.7 File storage

**Local disk, not object storage.** This is a change from the pre-port design,
forced by the target host: shared cPanel has no S3 endpoint worth depending on
and no MinIO container. `config/filesystems.php` declares an `avatars` disk —
driver `local`, root `storage/app/public/avatars`, `visibility: public`,
`throw: true` — and `AvatarStorage::DISK` names it. The stock `s3` disk entry is
Laravel's own scaffolding and nothing under `app/` reads it.

`App\Support\Members\AvatarStorage` is the only place in the application that
decides whether an uploaded file is acceptable and the only place that writes or
deletes one. Its three refusals — `heic_not_supported`, `file_too_large`,
`invalid_image` — are three *literal* throws rather than a ternary, because the
`RuleViolated` code census reads the first argument as a quoted literal and is
blind to an expression.

**A guest or reader may never name a storage key.** Keys are a fresh UUID plus
the extension of what was actually encoded, never the uploaded filename — which
is attacker-controlled, frequently full of diacritics, and could otherwise end
`.html` on a disk served as static files.

The public path depends on `php artisan storage:link`, and whether the shim
docroot on the real host serves `public/storage` is one of the two things only a
first deploy can check. See [known-gaps.md](known-gaps.md) and
[DEPLOYMENT.md](DEPLOYMENT.md).

### 7.8 Background work

There is no daemon; shared hosting does not offer one. `routes/console.php`
schedules two things off a per-minute cron tick:

- `queue:work --stop-when-empty --max-time=50` every minute, with
  `withoutOverlapping(2)`. The two-minute lock is deliberate: the default expiry
  is 24 hours and `CACHE_STORE=database` makes the lock survive process death,
  which is exactly what happens when CloudLinux's LVE kills a worker mid-run.
- `reminders:sweep` daily at 07:00 `Asia/Ho_Chi_Minh` —
  `App\Console\Commands\SweepReminders`, the one scheduled job this system
  permits (BR §15).

The sweep's bound is the acceptance criterion: overdue status is derived on
read, so if the sweep does not run, nothing a reader *sees* is wrong — they are
only late to be *told*. It is idempotent by existence, not by cursor: "already
told" is the notification row itself, keyed on shelf, user, kind, due date and
title. The `bookshelf_id` in that key is a deliberate divergence from the
reference, whose predicate was safe under a role that still named one shelf; this
probe runs with the scope switched off and would otherwise tell a reader once
when the same title is due the same day on two shelves.

---

## 8. The architecture pins

`tests/Feature/Architecture/` holds **14 files and 72 `it()` blocks**
(`ls tests/Feature/Architecture/*.php | wc -l`, and `grep -c '^it('` per file).
They fail when a **rule** is broken rather than when a behaviour is, and they
are the part of this codebase a newcomer will not guess exists.

**Read this before reading the fourteen.** Most of these guards read source as
*text*. Three read it raw, comments included; two strip comments first. That
difference is not cosmetic and it cuts both ways:

- `AuditActionCensusTest` and `NotificationsAreReaderFacingTest` strip comment
  tokens with `token_get_all` before matching, so an example written in a
  docblock is not a call site. `LabelsArchitectureTest`'s timezone census strips
  too, because the literal appears in a dozen docblocks explaining the rule.
- `TenancyArchitectureTest`, `WideningArchitectureTest`,
  `CommunityArchitectureTest`'s clock grep and `MembersArchitectureTest`'s code
  census read **raw source**. Prose that *illustrates* the banned shape trips
  them. This has happened twice, and correct docblock prose was reworded to
  clear a tripwire; `AvatarStorage`'s docblock explains a refusal shape
  *without* an example for exactly this reason, having measured that an
  illustration minted a code of its own.

Nothing reads `docs/`. This document can be wrong without any of them noticing.

### 8.1 `AuditActionCensusTest` (2 blocks)

Every `->record('x.y', …)` literal found under `app/` must have a sentence in
`AuditSentences::ACTIONS`, and every sentence must have a writer — set-equality
in **both** directions, so a stale map that looks maintained fails too. A second
block asserts that every `->record(` call in a file is one of the literal ones,
because a computed action name fails *open*: it is invisible to the census, so
it is absent from both sides of the equality and renders the "undescribed system
action" fallback to a volunteer.

**Blind to:** anything not spelled `->record('literal.action'`. It never calls
`AuditSentences::phrase()` or `sentence()`, so a *deleted match arm* leaves it
green — measured twice. What catches a missing arm is `AuditSentencesTest`'s
"every action in the map renders a real sentence" sweep, not this file.

### 8.2 `CatalogueArchitectureTest` (5 blocks)

Every non-GET route under `shelves/{shelf}/manage` carries `auth`,
`role:manager` and `tenant`; `books/create` and `books/lost` precede
`books/{book}`; there is deliberately **no** delete-book route (the `DeleteBook`
Action exists and is tested, the UI entry point does not, and adding it is a
product decision); every Action under `app/Actions/Catalogue/` except the code
allocator constructor-injects an `AuditRecorder` **and calls `->record()` on the
property the constructor named**; and nothing under Catalogue, Queries or
Support/Catalogue calls `strtr(`.

**Blind to:** the audit tripwire is a single-level `glob`, so an Action at
`Actions/Catalogue/Sub/Foo.php` is invisible to it. The `strtr(` ban is one
spelling of one mistake — a `REPLACE` chain hand-written in a query would pass.
The write-route census asserts `>= 6` routes as its non-vacuity floor, which is
a floor, not a count.

### 8.3 `CirculationArchitectureTest` (9 blocks)

The largest pin, and the one whose helper the others borrow.
`actionTransactionCalls($root)` is a **token walk**, not a regex, because "does
this call have a second argument" is a nesting question and nesting is not a
regular language. It asserts every `DB::transaction(` under
`app/Actions/Circulation/` passes an attempts count — `Connection::transaction`'s
second parameter *is* the retry — that the walk actually saw the calls (derived
from the same read: any file whose comment-stripped text holds the literal
`DB::transaction(` must appear in the tally), and that the default root really
is `app/Actions/Circulation` by identity rather than by mutation. Then: eight
named Actions must contain `lockForUpdate`; the borrow-request, reader-request,
lend, return, void and renew routes exist with the right `role:` gate;
`returns/lost` precedes `returns/{loan}`; and no circulation Action calls the
bare `now()`.

**Blind to:** the closure spelling only. An Action written
`DB::beginTransaction(); … DB::commit();` opens a write transaction with no
callback for an attempts argument to be the second argument *of* — it would
retry nothing and offend nothing. (`grep -rn "beginTransaction" app/` is the
re-runnable check; nothing uses that shape today.) It keys on the method *name*,
so an unrelated `->transaction(` would be judged by the same rule. The
`lockForUpdate` list is **hand-maintained and has documented exemptions**
(`CreateBorrowRequest`, `HandoverRequest`), so it no longer catches a *new*
Action shipped without a lock merely by existing — it catches a lock *removed*
from one that must keep it. It checks presence, never position; position is each
command's own query-log test.

### 8.4 `CommunityArchitectureTest` (7 blocks)

The same properties for `app/Actions/Community/`: the attempts argument, the
walk's non-vacuity, no wall clock, and — with **no** allow-list — every Action
constructor-injects and calls an `AuditRecorder`, recursively. Plus a
hand-maintained `lockForUpdate` list of ten commands, and two route-order
blocks, one of which the file explicitly labels *habitual rather than
load-bearing* (`manage/donations` before `manage/donations/{donation}/…`: no
request can match more than one of those however they are declared, so the
assertion is there for the day someone adds a one-segment sibling).

**Blind to:** the clock grep reads raw source, so `Clock::now()` written in a
docblock reddens it. The lock list is a decision record, not a rule: adding a
community Action means arguing in that comment which side of the line it falls
on. And the file has **no `is_dir()` guard anywhere**, deliberately — a
directory-walking guard that passes when the directory is absent is exactly what
these exist to refuse. The measured behaviour is recorded in the file and dated,
because a total written into a comment goes stale: with the directory moved
away, 5 failed / 2 passed; present but empty, 4 failed / 3 passed.

### 8.5 `DesignSystemTest` (12 blocks)

Guards on the ported design system, all reading `resources/css/app.css`: both
font families self-hosted across all three subsets with 12 `@font-face` blocks
each pointing at the file its own weight and subset name; all 33 semantic
variables defined in `:root` and 32 in `.dark`, with `--radius` the one
deliberate difference; no stock `hsl(` starter colours; no cold grey left on
pseudo-element borders (which arrives through a `var()` and is invisible to the
`hsl(` marker); the reference base layer's two documented fixes; an AA contrast
sweep over the full ink-and-ground matrix; visible borders;
`--color-terracotta: #a4673b` declared exactly **once** (a later
`--color-terracotta: transparent` would satisfy a presence check while killing
the focus outline on every non-shadcn focusable); `--radius: 0.5rem` and
`--radius-md: calc(var(--radius) - 4px)` pinned as *both* expression and
operand; no font CDN in any of the 3 Blade files; and both error views actually
rendering.

**Blind to:** it reads CSS text, so it cannot see what a component actually
looks like. The Blade scan asserts `toHaveCount(3)` first on purpose — a scan
that silently matched zero files would pass green forever, a failure mode this
project has shipped before — but that count must be raised by hand when a Blade
is added.

### 8.6 `FreeTextEncodingGuardTest` (8 blocks)

The most defensive file in the suite. Every free-text field on every Form
Request must carry `encoding:UTF-8` (or `Rule::string()->ascii()`), unless it is
*provably* non-text or a named, reasoned exemption. The failure it prevents is
an unmapped MariaDB errno 1366 turning a legitimate request into a 500, because
`string`/`max` check length and PHP type, never byte validity — four confirmed
occurrences before the guard existed, and a fifth that forced its rewrite.

The rewrite inverted the design: instead of "if the ruleset contains the literal
`'string'`, require the guard", it is now "unless the field is provably
non-text, require the guard". `uuid`/`email` count as safe **only when guarded by
`bail`**, because a value guard is not an ordering guard. It discovers Form
Request classes by `require_once` plus a `get_declared_classes()` diff rather
than by deriving a class name from a path, so a filename that drifts from its
class name cannot silently vanish from the sweep. A second block fails when the
exemption list names a field that no longer has a rule.

**Blind to, and it says so in its own tests:** two of the ten probed evasions
are **stated as uncatchable**, not demonstrated as caught. A rule built
conditionally on `$this->input(...)` never executes, because the gate calls
`new $class` with no request bound. A field injected in
`prepareForValidation()` is not in `rules()` at all. Neither is fixable by any
static gate; both are covered, if at all, by hostile-input Feature tests.

### 8.7 `LabelsArchitectureTest` (4 blocks)

The `Asia/Ho_Chi_Minh` census (§7.3) — comment-stripped, and a census rather
than an allow-list of three, because the brief that asked for three was measured
wrong on the day it was written. `POST exports/qr-labels` before
`POST exports/{kind}` — load-bearing, since they share a prefix *and* a verb.
And `MarkCopiesPrinted`, the label slice's only write, opens a retrying
transaction, takes **no** lock, and increments in SQL with
`DB::raw('qr_print_count + 1')` — which is *why* it needs none.

**Blind to:** this file defines no helper of its own and calls
`actionTransactionCalls()` from the circulation file, so running it alone fails
on "Call to undefined function". Two of its blocks are worth reading as
cautionary tales rather than as coverage: the transaction check is narrowed to
one file because `app/Actions/Catalogue` holds nine `DB::transaction(` call
sites and eight pass no attempts argument, all predating the guard; and the
offender check was *vacuously green* in its first version, matching a bare path
against entries formatted `path (line N)` — found only by deliberately breaking
the thing it guards and watching 55 tests still pass.

### 8.8 `MembersArchitectureTest` (6 blocks)

`ManagerRegisterReader` — the quick-lend escape hatch that creates an *active*
membership with no approval record — is reachable from exactly one controller,
`LendController`, and its route is `role:manager`. The readers-list form still
reaches `RegisterMemberOnBehalf` and not that hatch. `readers/create` resolves
before `readers/{reader}`. **Only five sanctioned files write a credential or
profile column on `users`** (INV-13/INV-14), by exact set equality over a
recursive walk of all of `app/`. Every `RuleViolated` code thrown in the members
slice has a Vietnamese sentence. And ten named Action classes exist and are
`final`.

**Blind to:** the `users`-writer census matches three write shapes, and the
dynamic-property one is anchored to the variable name `$person` — the slice's
own convention — because the unanchored form flagged
`App\Actions\Catalogue\UpdateBook`'s `$book->{$field} = $value`. A profile write
that bound the user to a different variable name would slip through. The code
census reads **raw source** and matches `RuleViolated('literal')`, so a code
raised through a ternary or a variable registers with nothing, and prose
containing the shape mints a code. There is **no file named
`RuleViolatedCodesHaveSentencesTest.php` in this directory** — the members
census is this block, and the separate
`tests/Unit/Catalogue/RuleViolatedCodesHaveSentencesTest.php` is a different
file with the same job for a different slice.

### 8.9 `NotificationsAreReaderFacingTest` (4 blocks)

BR §15 and OPS §7: managers get **no** notifications, by design. "Never" is hard
to test, so this enumerates writers instead. Every use of a
`NotificationKind::` case under `app/` must match a hand transcription of OPS §7's
table (9 kinds, 10 rows — `request_approved` has two writers because a return
that holds for the next reader has the same effect as an approval); the table
must cover every case the enum has; nothing outside `Notifier` and the sweep may
call `Notification::create`; and **every `notify()` call sits inside its own
command's `DB::transaction` closure** — a token walk, because "inside the
closure" is a brace-range question.

That last block is the phase's headline guarantee made falsifiable: without it,
moving `$this->notifier->notify(...)` to *after* the transaction returned left
every behavioural test green. Its walk accepts `?->` beside `->` (a
`$this->notifier?->notify(...)` moved out would otherwise be invisible: zero
call sites, no offender) and counts interpolation braces, since `"bản {$code}"`
emits `T_CURLY_OPEN` as an array token but a plain `}` as a character, which
made a *compliant* call report as an offender.

**Blind to:** the hand transcription. Nothing mechanically ties
`OPS_SECTION_7` to `docs/OPERATIONS.md`, so a wrong transcription is invisible.
It matches the enum case only, never the raw string, because
`AuditSentences` carries `'membership_approved'` and `'membership_rejected'` as
live lang keys and the first draft was red on arrival.

### 8.10 `PolicyRegistrationTest` (2 blocks)

Every class in `app/Policies/` resolves for its model, and every model
`AppServiceProvider` registers a policy for resolves too — the second direction
read off the provider's source rather than a hand-kept list, so a policy moved
*out* of the directory cannot vanish from the walk and take its coverage with
it. The registrations look decorative (convention discovery finds all of them,
so deleting a line leaves the suite green — measured, 1071 passed) and are not:
with a policy class moved to a sub-namespace, the explicit registration is the
only thing wiring it.

**Blind to:** `Gate::getPolicyFor()` answers with whatever wired the two, and
either an explicit call or convention discovery satisfies it — neither is the
failure this catches. Deleting a `Gate::policy()` line while leaving the class
in place is still green here; only the *move* is caught.

### 8.11 `RouteOrderTest` (6 blocks)

The route-map pin (§2): static segments before bound ones; `tenant` on every
`{shelf}` route; `auth` on every `role:`-gated `{shelf}` route (`EnsureShelfRole`
runs *after* `ResolveTenant`, so `auth` is what makes the priority ordering
apply, and without it a guest on an unknown slug 404s while a guest on a known
slug redirects — an existence oracle); a `role:` gate on every `/manage` route;
a `role:` gate on every reader-area shelf route; `super-admin` on every `admin/`
route; and English URIs.

**Blind to:** the reader-area block excludes the segments `manage` and
`feedback` **anywhere in the URI, not by position**, so a future
`shelves/{shelf}/books/{book}/feedback` would be silently exempted. That is
recorded in known-gaps. Every block asserts its own filter is non-empty first, so
a refactor that renames `{shelf}` away fails loudly instead of emptying the test.

### 8.12 `StyleGuideTest` (2 blocks)

`AGENTS.md` is the house style guide, and until Phase 3a it named fourteen
components this repository has never had. This is what stops it drifting back:
every backticked `*.tsx` path in `AGENTS.md` must resolve under
`resources/js/` or `resources/js/components/`, and every backticked PascalCase
word must be a component file there (kebab-case mapped to PascalCase). It is
deliberately one-directional: a guide may be incomplete, it may not be wrong.

**Blind to:** it reads `AGENTS.md` and nothing else — **not this document**.
The PascalCase arm was near-vacuous by the time it shipped, checking 1 reference
out of 23 after the guide was rewritten to use backticked paths; appending a row
citing a nonexistent widget left the old test green. The path arm is where the
coverage is. Note the trap for anyone editing `AGENTS.md`: a backticked
PascalCase word anywhere in that file — including in prose — is read as a
component name.

### 8.13 `TenancyArchitectureTest` (2 blocks)

Every Eloquent model whose table has a `bookshelf_id` column uses
`BelongsToBookshelf`; the two exempt models do not, and their column is still
nullable. And `bookshelf_id` may only be *filtered* on in five named files —
`BookshelfScope`, `ResolveTenant`, `AuditLogQuery`, `Admin\AuditBrowserQuery`
and `SweepReminders` — everywhere else under `app/`, `database/` and `routes/`
is an offender.

**Blind to:** it enumerates **models, not tables** — a table with a `NOT NULL`
`bookshelf_id` and no Eloquent model is invisible to it. The filter grep is a
tripwire, not a proof: a column name held in a variable
(`$col = 'bookshelf_id'; ->where($col, $id)`) and a `join()` condition naming the
column both slip past, and the file says so. And the allow-list is **whole-file,
not per-clause** — each of those five files holds exactly one hand-written
filter today, and a second one added later is silent. That cost is stated in the
file's own comments at length, because it matters most in `SweepReminders`,
which runs system-wide with no scope underneath to make a rogue `where()`
harmless.

### 8.14 `WideningArchitectureTest` (3 blocks)

The three doors out of tenancy, fenced by name rather than by method:
`actSystemWide()` may only be called from `TenantContext` itself,
`SweepReminders` and `DemoShelfSeeder`; `systemWide()` only from
`app/Queries/Admin/` and `app/Actions/Admin/`; and the audit configurator
(`global()` / `forShelf()`) only from `app/Actions/Admin/` plus **one named
file**, `app/Actions/Community/SubmitFeedback.php`, because the public contact
page has no shelf and a site-wide message's audit row has to say so. The grant is
one file rather than the directory because `app/Actions/Community/` also holds
the announcement, comment and donation writes, which are exactly the
shelf-scoped commands the fence exists to hold inside tenancy.

**Blind to:** the patterns anchor on `->`, so they mean "someone called it" and
the declaring file needs no exemption — but they read raw source, so prose
containing the call shape is an offender. The allow-lists are whole-file: a
second, wrongly scoped configurator call added to `SubmitFeedback.php` later is
invisible here, and what stands behind it instead is identity —
`SubmitFeedbackTest` and `ReaderFeedbackScreenTest` pin both branches by the row
they write.

---

## 9. Testing

`tests/` holds **201** files (`find tests -name '*Test.php' | wc -l`), split
`tests/Unit/` (pure logic, no database) and `tests/Feature/` (Admin, Architecture,
Auth, Authz, Catalogue, Circulation, Community, DbGuarantees, Invariants, Labels,
Members, Notifications, Oversight, Schema, Shell, Statistics, Tenancy). Pest is
the runner.

Four levels, in the order they earn their keep:

| Level | Covers | Where |
|---|---|---|
| **Domain** | The rules, state machines, derived-state calculations, folding | `tests/Unit/` |
| **Operation** | Each command end to end: authorisation, transaction, audit row written | `tests/Feature/<slice>/` |
| **Constraint** | That the database actually rejects what it should | `tests/Feature/DbGuarantees/`, `tests/Feature/Schema/` |
| **Architecture** | That a rule cannot be broken silently | `tests/Feature/Architecture/` |

Two things about the runner are load-bearing and cost time when forgotten:

**Pest loads every test file into one PHP process**, so a top-level
`function foo()` in a test file is a *global* symbol and a second file
declaring the same name is a fatal redeclaration error, not a shadow. Grep
before adding one. This is also why `LabelsArchitectureTest` cannot be run alone.

**`expect($x)->not->toContain($needle, "message")` passes unconditionally.**
`toContain` is variadic over needles, so the message becomes a second needle and
the negation is satisfied by its absence. This has shipped a green test over a
real defect twice, in two different phases, both times on a source-read guard.
Write `expect(str_contains($source, $needle))->toBeFalse("message")` instead, and
prove any source-read guard by mutation: delete the thing, watch red, restore.

---

## 10. The six gates

CI (`.github/workflows/laravel.yml`, "Laravel CI") runs six checks. Running four
of them locally and pushing is how this repository gets red PRs.

```bash
docker exec laravel-app-1 vendor/bin/pint --test                    # 1. format
docker exec laravel-app-1 vendor/bin/phpstan analyse --no-progress  # 2. Larastan level 8
npm run lint                                                        # 3. Biome
npm run typecheck                                                   # 4. TypeScript
npm run build                                                       # 5. Vite
docker exec laravel-app-1 php artisan test                          # 6. Pest
```

`npm run laravel:lint`, `laravel:typecheck` and `laravel:build` still exist as
aliases and are what the two workflows invoke; the unprefixed names arrived in
Phase 4 and mean the same thing.

**Never run `php` or `vendor/bin/pint` on the host** — the host PHP is 7.4 and
aborts with a dyld error before running anything, so a host-side "pint failed" is
a toolchain artefact, not a code failure.

**The Vite build must run before Pest.** Every Inertia render goes through
`Vite::__invoke()`, which throws `ViteManifestNotFoundException` the moment
`public/build/manifest.json` is missing, and no test double softens it —
Inertia's response *is* the compiled HTML shell. Discovered by running the
workflow for real, with every page-rendering test 500ing.

---

## 11. What the stack must keep being able to do

Written before the stack was chosen; kept because these are the properties a
future change of framework, driver or data layer would have to preserve. Each
line traces to a requirement rather than a preference.

1. **Run several statements in one transaction, under application control.**
   All six application-enforced invariants need it, and so does INV-8's
   same-transaction audit write.
2. **Retry a transaction the engine aborted, without the caller re-deciding
   anything.** This one is *new* with MariaDB: InnoDB raises deadlocks where
   Postgres did not, which is why `Connection::transaction`'s attempts argument
   is a pinned rule rather than a nicety.
3. **Distinguish a unique-violation error from other database errors, by
   constraint name.** Needed to turn a lost INV-1 race into a friendly
   Vietnamese sentence instead of a 500, and to avoid dressing an unrelated
   collision up as the wrong refusal.
4. **Express a global read filter that fails closed.** `BookshelfScope` throws
   on an unbound tenant; a data layer that could only *narrow* a query, never
   refuse one, would be a downgrade.
5. **Express the domain without framework imports.** `app/Support/` is where
   that lives, and `tests/Unit/` is the proof.
6. **Format dates and numbers through a locale**, and resolve every user-facing
   string from a catalogue.
7. **Stream a CSV export** without buffering a whole table.
8. **Run without a daemon, a job server or an object store**, because the target
   host offers none of the three.

Points 1, 2, 3 and 4 are the disqualifying ones. Everything else is negotiable.

---

## 12. What is deliberately unfinished

[known-gaps.md](known-gaps.md) is the register and is required reading before
starting work. The largest entries as of this writing:

- **`DEPLOYMENT.md` is stale and knowingly so.** It describes the Next.js
  deployment. The Laravel pipeline exists
  (`.github/workflows/deploy-laravel.yml`, `.cpanel.yml`,
  `deploy/post-deploy.sh`) and has never run against the real host. It will be
  rewritten from the first real deploy, not before it.
- **No delete-book route**, by decision, with an Action that exists and is
  tested behind the absent entry point.
- **The whole-file allow-lists** in the tenancy and widening pins (§8.13,
  §8.14): each grants a file, not a clause.
- The per-file residuals each pin records in its own comments, which are the
  authority over this section.
