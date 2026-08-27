# Known gaps

Things that are deliberately unfinished, unverified, or deferred. Written down so
they are inherited rather than rediscovered. Each entry says why it was left.

This file is the durable record of the Laravel migration's foundation phase
(`docs/superpowers/plans/2026-08-26-laravel-migration-phase-0-foundation.md`).
The working ledger that produced it lives in `.superpowers/` and is gitignored —
it dies with the plan; this file does not. Written after Task 16 and the
Inertia v2→v3 interlude, with Tasks 17–21 still ahead. The format and the
practice come from the reference project, `~/Documents/dreamtube`, whose
`docs/known-gaps.md` is the model.

## The test-database guard had two holes, and one of them is upstream too

**`force="true"` on a `<env>` line in `phpunit.xml` cannot protect the test
database, because it never reaches `$_SERVER`.** Laravel's `env()` resolves
through vlucas/phpdotenv's repository, whose default adapters are
`[ServerConstAdapter, EnvConstAdapter]` — `$_SERVER` is consulted *before*
`$_ENV` (`RepositoryBuilder.php:25-28`, `Env.php:79`). PHPUnit's
`handleEnvVariables()` writes `putenv()` and `$_ENV` but never `$_SERVER`
(`PhpHandler.php:147-168`), while PHP's CLI SAPI copies every real container
environment variable into `$_SERVER` at process start. So a stray
`DB_DATABASE` in the container's real environment keeps winning through
`$_SERVER` no matter how the `<env>` line is forced. The fix is PHPUnit's
separate `<server>` element — `handleServerVariables()` is an unconditional
`$_SERVER` overwrite — with a matching `<server>` line for every `<env>` entry.
Both are in `phpunit.xml` now, and `EnvironmentTest` was hand-checked red/green
against a live `DB_DATABASE` injection.

The guard as originally planned was copied from `~/Documents/priest-liturgy`,
whose own `known-gaps.md` (lines 103–114) records the same incomplete fix. It
was deliberately **not** propagated upstream — different repo, out of scope for
this branch — so that project may still be running a guard that is weaker than
it reads.

**Residual in the same file:** `ARGON_MEMORY`/`ARGON_TIME` are forced via
`<env>` only, with no `<server>` twin — contradicting the principle the same
file documents. Inert today (neither variable is set anywhere), latent if
either ever appears in the container environment. Two-line fix, deferred.

## The second hole: `DB_URL` repoints the suite while `config()` stays green

**A stray `DB_URL` sends the test suite to any database while every
config-level assertion still reports the right one.** `config/database.php`
sets `'url' => env('DB_URL')` on the `mariadb` connection, and Laravel's
`ConfigurationUrlParser::parseConfiguration()` merges the url's
`database`/`host`/`user` *over* the connection array at connect time —
`config('database.connections.mariadb.database')` still reads the raw array
value untouched. Proven live: with
`DB_URL="mysql://olibra:secret@mariadb:3306/olibra"` injected, the original
`EnvironmentTest` passed — broken and green at the same time. Adding
`DB::connection()->getDatabaseName()` to the assertion turned it red
(`'olibra'` vs `'olibra_testing'`); neutralising `DB_URL` to empty via both
`<env>` and `<server>` turned it green again under the same injection. The
live-connection assertion stays in `tests/Feature/EnvironmentTest.php` — a
config-only check on this property is worth nothing.

## `strtr()` is simultaneous; a nested `REPLACE()` chain is sequential

**Rendering `Fold::MAP` as nested MariaDB `REPLACE()` calls manufactured
matches PHP would never produce.** PHP's `strtr()` walks the input once and
never re-reads its own output; a `REPLACE(REPLACE(...))` chain applies each
entry to the *previous entry's output*. One fold-map key is `i`+U+0307 (two
code points starting with ASCII `i`), and ASCII `i` is the replacement target
of twelve earlier entries — so rendered naively it sat innermost-last and fired
on text earlier replacements had produced. Concretely: `"xı̇x"` folded to
`"xi x"` in PHP and `"xix"` in MariaDB. Store≠search, and Task 7 was one step
from freezing that expression into generated-column DDL.

Fixed by sorting `Fold::MAP` with `uksort` by descending key length so
multi-code-point keys render innermost. The cascade class is closed for the
current table, not just the known case: all 143 other keys are single code
points (relative order preserved; `uksort` is stable on PHP 8.4), and no
single-character `REPLACE` target — the plain ASCII letters and the digraphs
`ae`/`oe`/`ij`/`ss`/`th` — is itself a MAP key. `Fold::fold()` was untouched:
`strtr` already prefers longest matches, so PHP behaviour is unchanged by
construction. **Adding a new MAP entry re-opens the question** — a new
multi-code-point key, or a new key that equals an existing replacement target,
must survive `FoldParityTest` (700 assertions against live MariaDB) and the
NFD-derived oracle that pins all 144 entries independently of the table. The
parity test alone proves PHP↔SQL agree *as functions of the shared MAP*; it
cannot catch a wrong entry both sides inherit — that is the oracle's job, and
the oracle immediately earned its keep by surfacing `ł` and `ſ` as
non-decomposing letters the hand-pinned review list had missed.

One more edge of the same expression: `LOWER()` is a no-op on true binary
types, so the fold's source columns must stay `utf8mb4_unicode_ci` (verified in
Task 7's review: declaring one as BLOB/VARBINARY silently stops the
lowercasing, and the parity probe would not have caught it).

## Three MariaDB 10.11 DDL refusals, all found by executing, not reading

- **A `CHAR(n)` operand inside a generated-column expression is errno 1901.**
  MariaDB wraps the `CHAR` reference in an implicit conversion when used as a
  function argument, then refuses the whole expression. `VARCHAR(36)` works,
  with identical storage for fixed-length values — hence the repo-wide rule
  that uuid keys and refs are `VARCHAR(36) ascii_bin`, never `CHAR(36)`. Eight
  of the ten generated-column uniques, **INV-1 included**, are built from
  exactly such expressions. Reproduced on 10.11.19; independently corroborated
  from the host side by dreamtube's `DEPLOYMENT.md`, which hit the same 1901
  on the real CloudLinux/cPanel target.
- **`GENERATED ALWAYS AS (…) STORED NOT NULL` is an ERROR 1064 syntax error.**
  The `NOT NULL` has to go; nullability of a stored generated column is
  whatever the expression yields.
- **Under the table default `utf8mb4_unicode_ci`, `CHECK (status IN
  ('active', …))` accepts `'ACTIVE'`** — verified on 10.11.19 — where the
  Postgres enum it replaces refused it, and the bad row would then explode as a
  `ValueError` in the enum cast. Enum-backed columns therefore carry
  `ascii_bin`, and the schema tests prove the collation does real work by
  asserting `'ACTIVE'`/`'PENDING'`/`'PERFECT'` are refused with errno 4025
  rather than merely asserting the constraint exists.

## `withoutGlobalScopes()` with no argument strips the soft-delete scope too

**`ResolveTenant` used bare `withoutGlobalScopes()` to skip the tenancy scope
and thereby also skipped `SoftDeletingScope` — so a soft-deleted membership
still resolved, and a revoked admin kept admin.** `TenantContext` is the sole
input to the Task 17 gates, which makes this the worst kind of quiet: the
revocation *looked* complete (row soft-deleted, status untouched) while every
downstream authorization decision still saw `role: admin`. Fixed to
`->withoutGlobalScope(BookshelfScope::class)` — the one named scope the
architecture suite permits skipping — leaving `SoftDeletingScope` and any
future global scope intact, with a test that soft-deletes an active-status
membership and asserts it no longer resolves. The rule to inherit: **never
call the plural form without arguments in this codebase.**

## `$middleware->priority([...])` replaces Laravel's list; it does not extend it

**The literal-array form assigns `Middleware::$priority` outright, silently
discarding five framework entries — including the one ordering `Authenticate`
before route-model binding.** Reproduced by dumping
`Router::gatherRouteMiddleware()` from a booted kernel: `Authenticate` sorted
*after* `ResolveTenant` and `SubstituteBindings`, so an anonymous request to a
shelf URL would 404 on the scoped binding instead of 302-ing to login — an
unauthenticated existence oracle over the shelf and book URL space. Fixed with
two `prependToPriorityList()` calls, which insert into Laravel's own default
list. **Their order matters:** the anchor must already be in the list, so
`ResolveTenant` is anchored before `SubstituteBindings` first, and
`EnsureAuthenticatedUserExists` before `ResolveTenant` second — reversed, the
second entry is silently dropped at the tail, which is exactly the failure
shape this entry exists to prevent.

## The login timing equaliser inverted its own oracle — twice

**Two consecutive shapes of `LoginRequest`'s dummy-hash equaliser each created
the username-enumeration oracle they existed to close, in opposite
directions, and each carried an explanation of the property it claimed to
establish.** Version one memoised `Hash::make(Str::random(32))` in a `static`
property — which does not survive a request under PHP-FPM — so an unknown
username paid a derivation *plus* a check against a wrong password's single
check: measured 254.3 ms vs 120.7 ms (2.11×), slow meaning no-such-user. The
first fix removed the `Hash::make` but restructured the boolean so a wrong
password paid **two** derivations against an unknown username's one: 251.7 ms
vs 139.8 ms (1.80×), fast now meaning no-such-user — if anything an easier
signal. Only measuring both paths caught either; reading the code and its
comment did not.

The final shape (`app/Http/Requests/Auth/LoginRequest.php`) is structural, not
measured-into-submission: **exactly one `Hash::check` is reachable on every
path** (user with credentials, credential-less user, no user), at the same call
site, with `$stored` falling back to a fixed, precomputed per-driver dummy
literal — never derived at request time — and the `&&` chain gating only the
*result*, never whether the check runs. Isolated ratio 1.006. The per-driver
literals also close a second failure mode: `BcryptHasher::check()` throws on a
non-bcrypt-format hash under `HASH_VERIFY`, so a single argon2id literal would
have turned every failed login under a bcrypt fallback into a 500. Touch this
method only with the timing measurement in hand.

## PSR-4 is case-sensitive where CI runs, and nowhere you develop

**A helper at `tests/support/TenantHarness.php` (lowercase `s`) loaded fine on
APFS and inside the Docker bind mount, and would have failed on CI's Linux
runner** — composer maps the `Tests` namespace to `tests/`, so the autoloader
needs `tests/Support/` exactly. Both local filesystems are case-insensitive,
which means this class of defect is invisible until the first `ubuntu-latest`
run, where it would have taken `TenantIsolationTest` and every downstream
route test with it. The rename was verified **in git's index** (`git ls-files`
shows only `tests/Support/TenantHarness.php`, as a 100%-similarity rename) —
checking the filesystem alone proves nothing on a case-insensitive disk.

## Inertia's SSR gateway POSTs every render to the vite dev server

**With `INERTIA_SSR_ENABLED` at its shipped default of `true`,
`Inertia\Ssr\HttpGateway::dispatch()` skips SSR only when there is no bundle
*and* `Vite::isRunningHot()` is false.** This repo runs a continuous vite
service in `docker-compose.laravel.yml`, so `public/hot` exists,
`isRunningHot()` is true, and every Inertia render would have POSTed to
`localhost:5173/__inertia_ssr` — a latent bug carried since scaffolding,
inherited from dreamtube's record before Task 18 rendered a single page. The
pin is `<server name="INERTIA_SSR_ENABLED" value="false"/>` in `phpunit.xml`
(`<server>`, not `<env>`, so a developer who later sets it `true` in `.env` to
work on SSR cannot silently reintroduce it into the suite), plus SSR off in
`.env.example`. The test proves the pin survives a leaked
`INERTIA_SSR_ENABLED=true`.

## Inertia v3's devtools serve recorded props to unauthenticated requests

**v3 ships `devtools.enabled` as `null`, which resolves to
`app()->environment('local')`, and its `Authorize::allows()` short-circuits to
true for local *before* looking at a user or a gate.** In dreamtube,
`GET /_inertia/devtools/entries` returned 200 to a request with **no cookies**,
carrying recorded prop values — the admin user list with ids, names, emails,
roles and tiers included. This repo ships `APP_ENV=local` in `.env` and
`.env.example`, so the hazard arrived with our v3 upgrade and was closed
pre-emptively: `config/inertia.php` is published with devtools hard `false`,
so the routes are never registered. Verified independently: no
`_inertia/devtools` route in the real route table under `APP_ENV=local`, the
endpoint 404s, and with devtools force-enabled 3 of the 4 guarding tests go
red — they are falsifiable, not decorative. The general lesson dreamtube
draws, inherited here: **a dependency that auto-enables on `APP_ENV=local` is
a production-shaped risk** the moment anyone deploys a checkout without
editing `.env`, and `artisan route:list` is worth reading rather than assuming
the app serves only what `routes/` declares.

## A test that asserts on a gitignored generated file passes only by luck

**The SSR test originally asserted `file_exists(public_path('hot'))` — but
`public/hot` is gitignored and existed only because the vite container had
just written it.** A fresh clone, or the first Laravel CI job, would have
failed the test for a reason that has nothing to do with what it tests. It now
constructs its own precondition (`tempnam` + `Vite::useHotFile()` with
`try/finally` cleanup) and was verified passing with `public/hot` genuinely
deleted. The rule: a test's preconditions must come from the test, never from
whatever a dev container happened to leave on disk.

## Tests that passed while guarding nothing

Two shapes of green-but-worthless, both from Task 11, both fixed, recorded so
the shapes are recognised next time:

- **A violation test that fires on the wrong constraint.** The
  `loans_request_fk` test's fixture also crossed the copy boundary, so it
  passed on `loans_copy_fk` — dropping `loans_request_fk` entirely left it
  green. Fixed by giving shelf B its own book *and* copy, and proven by
  temporarily dropping the FK and watching the test fail naming the right
  constraint. Since Task 13, `dbgExpectViolation` makes the constraint name a
  non-optional argument, so this defect is structurally impossible in new
  probes rather than merely discouraged.
- **Structural assertions that check the name and nothing else.** The FK
  queries checked constraint names but neither the second column nor the
  parent table — a repointed FK passed. Now all fifteen composite tenant FKs
  are pinned by parent table plus both column positions.

## Co-located test files in the page glob take down every page

**Inherited from dreamtube, binding Task 18:** an eager `import.meta.glob`
runs every matched module's top-level code at startup, so a co-located
`pages/**/*.test.tsx` caught by the page glob throws on its `vi.mock()` before
anything renders — every page down, every test suite still green (dreamtube's
`app.tsx` hit this live). `resources/js/app.tsx` carries the exclusion
(`["./pages/**/*.tsx", "!./pages/**/*.test.tsx"]`) — deliberately *without*
dreamtube's `{eager: true}`, which would have bundled every page into the
entry chunk; the exclusion is what matters, the eagerness was incidental, and
the guarding comment in `app.tsx` says exactly this so nobody trims either
half. Task 18's pages must keep any co-located tests inside that exclusion.

## Deliberately unfinished

- **No absolute session lifetime.** Laravel's session shape offers only idle
  timeout via `last_activity`; the old `src/auth/session.ts` enforced a 30-day
  absolute cap independent of activity. Decided and argued in the permanent
  comment beside `'lifetime'` in `config/session.php` — accepted for v1, not
  closed, and no task reinstates it.
- **No session rotation on credential reset.** Nothing invalidates a user's
  *other* sessions when their credentials change. Named as a second open item
  in the same `config/session.php` comment; assigned to no task.
- **`docs/HOSTING.md` rows 2–14 have never been run against the real host.**
  Only row 1 (PHP 8.4 selectable) is answered — by the product owner's
  instruction, not by a probe, though dreamtube's live deployment on the same
  host profile (PHP 8.4.24, MariaDB 10.11.13) now corroborates it. Every
  unanswered row carries its exact probe command and its consequence; Task 21's
  deploy pipeline is authored against documented defaults with each assumption
  marked in the file, and re-opens when the survey returns.
- **The hand-written-`bookshelf_id` architecture check is a tripwire, not a
  proof.** It catches a literal `where('bookshelf_id', …)` and — since Task
  15's fix round — raw SQL containing a `where` keyword, but its own
  disclaimer names the two shapes it still misses: a variable column name, and
  a join. Treat a clean run as absence of the *common* mistake, nothing more.
- **The tenancy architecture expectation enumerates Eloquent models**, with
  the exemption list schema-derived and nullability-guarded — so a future
  `NOT NULL bookshelf_id` table that has no model is invisible to it. Adding a
  table without a model bypasses the census entirely.
- **`$guarded = []` leaves `Membership::role`, `Comment::moderated_by` and the
  `BorrowRequest`/`Loan` status columns mass-assignable.** Brief-mandated,
  with Task 17/18 form requests as the intended gate. Until those land, any
  code path that feeds request input into `fill()`/`create()` on these models
  is writing authorization state.
- **`database/factories/UserFactory.php` is dead.** It still populates
  `name`/`email_verified_at`/`password`/`remember_token` — columns `users` has
  not had since Task 6 — so `User::factory()` cannot insert until Task 19
  rewrites it. (It silently killed `make fresh` for two tasks before the
  seeder was repaired out-of-band in Task 8.)
- **Five placeholder factories exist only to satisfy Larastan level 8** — the
  Task 14 briefs' `@use HasFactory<…Factory>` annotations reference classes
  that do not exist until Task 19. Their `definition()` bodies must not be
  trusted; Task 19 replaces them.
- **`phpstan.neon` analyses `app/`, `database/` and `routes/` only.** "Larastan
  clean" in any report on this branch never covered `tests/`.

## Smaller deferred items, by task

Each of these was seen, judged real, and deliberately left for the final
review or a later task rather than fixed in place:

- **Task 2:** `composer.json` is still named `laravel/react-starter-kit`, with
  an npx/npm `dev` script in a Bun repo. Biome's `"preset": "recommended"` is
  weaker than `"recommended": true` (hides 3 findings). The vite toolchain
  (`vite`, `@vitejs/plugin-react`, `laravel-vite-plugin`) sits in
  `dependencies` rather than `devDependencies`. `.gitattributes` arrived as
  rsync fallout rather than a decision; the `.gitignore` Laravel block
  duplicates five Next entries. `HandleInertiaRequests::share()` calls
  `parent::share()` twice. Seven `@var User` Larastan silencers in
  controllers. `components.json` carries a `"_hazard"` key that is not in
  shadcn's schema — smoke-test `shadcn add` before Task 18 relies on it.
- **Task 3:** agreement of the fold with live Postgres `unaccent()` on the
  non-decomposing Latin set was never verified (no Postgres in this checkout).
  Moot while there is no data migration; becomes real the day an import is
  added.
- **Task 6:** `resources/js/components/appearance-tabs.tsx` has no importer —
  orphaned by the settings deletion, left for a future settings rebuild.
  `DashboardTest`'s schema-independent guest-redirect coverage was over-deleted
  (accepted: Task 18 replaces the dashboard route wholesale).
- **Task 7:** no assertion covers the `books_public`/`copies_by_book`/
  `copies_by_state` indexes, so their removal goes unnoticed; the collation
  hazard is proven only indirectly (a `collation_name NOT LIKE '%_bin'`
  assertion on `books.title` would fail loudly where the fold tests might
  not); three `LIMIT 1` selects with no `ORDER BY`; `makeCatalogueShelf()` is
  a top-level Pest helper later suites must not redeclare; varchar width caps
  on `isbn`/`code`/`acquired_from` that Postgres's `text` never imposed.
- **Task 8:** `loans_by_borrower` silently drops `0012_indexes.sql`'s
  `lent_at desc` — MariaDB 10.11 supports descending index parts, so this is a
  fidelity loss, not a platform limit, and the comment does not say so. Four
  CHECK tests assert only `toThrow(QueryException::class)`, so they cannot
  tell which constraint fired (the stricter helpers exist from Task 9 on).
- **Task 9:** migrations use bare `restrictOnDelete()` on nullable FK columns
  (`announcements.author_id`, `feedback.handled_by`) where the Postgres ground
  truth left `ON DELETE` unspecified (NO ACTION). Established by earlier tasks
  — an audit-consistency item across all migrations, not a Task 9 defect.
- **Task 10:** `$table->id()` gives `BIGINT UNSIGNED` where Postgres is signed
  — brief-mandated, cosmetic parity note (audit ids are never negative).
- **Task 11 (accepted, knowing):** `down()` leaves MariaDB's auto-created
  FK-supporting indexes behind as plain indexes, so post-`down()` is not
  byte-identical to pre-`up()`. Re-`up()` succeeds.
- **Task 14:** the unset-context test pins only `RuntimeException::class`, not
  the message.

## Decisions taken on the product owner's behalf

Each of these was ruled during execution rather than escalated, and each names
what it costs if the ruling is wrong.

- **Task 7's migration may call `FoldExpression::sql()`**, against the stated
  rule that a migration never calls application code. The expression is
  materialised into the table as DDL *text* at migrate time, so later drift in
  `Fold::MAP` cannot retroactively change stored rows — the opposite of the
  drift the rule guards against — and `FoldParityTest` fails loudly if the two
  ever disagree. *Cost if wrong:* a `Fold::MAP` change needs a data migration
  to re-fold existing rows; zero on a greenfield database.
- **`AppServiceProvider.php` and `bootstrap/app.php` are each edited by three
  tasks.** Inherent to Laravel's single-registration-point design; tasks run
  strictly sequentially, and each implementer must add, never rewrite. *Cost
  if wrong:* a later task drops an earlier registration; the earlier task's
  tests stay in the suite and catch it.
- **The host survey was not run** (no cPanel credentials available to an
  agent) **and was not invented.** `docs/HOSTING.md` ships the full table with
  probe commands; only the PHP-8.4 row is recorded as answered, by
  instruction. *Cost if wrong:* Task 21's pipeline needs edits after the real
  survey — bounded to one file, no schema or application impact.
- **The branch is `worktree-laravel`, not the plan's `laravel`.** The harness's
  worktree tool owns branch naming. *Cost if wrong:* cosmetic; rename at merge.
- **The Next.js baseline suite is not re-run in this worktree.** It was green
  on `main` at session start (1,613 passing; the 2 failing files need MinIO),
  this branch never touches `src/`, and CI runs it on every push. *Cost if
  wrong:* a regression is caught by CI before merge instead of locally.
- **`HASH_DRIVER` stays `argon2id`** in `.env`, `.env.example` and
  `phpunit.xml` regardless of the unanswered host row — dev and CI control
  their runtime, the database is greenfield so no hash migrates, and
  `password_verify()` detects the algorithm from the hash prefix. *Cost if
  wrong:* a one-line production `.env` change at deploy.
- **`Fold::fold()` keeps its divergence from `src/domain/kernel/fold.ts`** for
  the non-decomposing Latin set (ß ø æ œ þ ð ħ ŋ ŧ ı ĳ ŀ ŉ ł ſ): TS erases
  them to spaces ("Straße" → "stra e"), PHP folds them to ASCII ("strasse").
  The PHP fold is better for search, and with no data migration nothing is
  ever folded twice, so cutover parity is not at stake — the invariant that
  matters is PHP↔SQL agreement, which holds by construction. *Cost if wrong:*
  if an import is ever added, ß/ø-bearing titles need one re-fold pass.
- **The starter kit's settings surface was deleted by Task 6** rather than
  left orphaned: `routes/settings.php`, its controllers, requests and pages —
  because `DELETE settings/profile` hard-deleted a user row in a soft-delete
  product whose real flow is a manager-approved proposal (BR §2). The six dead
  auth routes waited for Task 16, which owned them. *Cost if wrong:* a
  settings screen is rebuilt from a starter kit we still have — cheap; the
  alternative was a live hard-delete endpoint behind a broken schema.
- **The dead seeder was repaired out-of-band by Task 8** instead of a Task 7
  fix round: `DatabaseSeeder` passed `'name'` to `User::factory()`, a column
  gone since Task 6, so `make fresh` had been dead for a task already and the
  plan did not repair it until Task 19. `make test` was unaffected
  (`RefreshDatabase` never seeds), so nothing went silently unverified. *Cost
  if wrong:* a throwaway line Task 19 rewrites anyway.
- **The five placeholder factories were accepted** (see "Deliberately
  unfinished") because the Task 14 brief could not satisfy its own Larastan
  gate without them, and deleting the annotations would have been the larger
  deviation. *Cost if wrong:* Task 19 edits five files instead of creating
  them, and must not trust the placeholder bodies.
- **The redirect itself** (product owner, 2026-08-27): the reference project is
  `~/Documents/dreamtube`, not priest-liturgy. Code built under the old
  reference was *kept* — schema, models and tenancy are verified and
  version-independent — while Inertia moved v2→v3 before any page was written,
  the vite/React tooling aligned, and the two dreamtube traps above (SSR
  gateway, devtools) were closed. Deliberately not adopted: dreamtube's Pest 4
  / PHPUnit 12 (a downgrade from this repo's Pest 5 / PHPUnit 13) and its
  `apps/web` monorepo layout (OLibra has no second app or shared package to
  justify one). *Cost if wrong:* the divergences are exactly the places where
  a habit learned in dreamtube does not transfer here; they are named in the
  plan's Global Constraints so nobody "fixes" them back.
