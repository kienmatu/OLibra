# Known gaps

Things that are deliberately unfinished, unverified, or deferred. Written down so
they are inherited rather than rediscovered. Each entry says why it was left.

This file is the durable record of the Laravel migration's foundation phase
(`docs/superpowers/plans/2026-08-26-laravel-migration-phase-0-foundation.md`).
The working ledger that produced it lives in `.superpowers/` and is gitignored —
it dies with the plan; this file does not. Started after Task 16 and the
Inertia v2→v3 interlude; the file now documents Tasks 18, 20 and 21 as well,
carried forward and updated through the final whole-branch review rather
than rewritten from scratch. The format and the practice come from the
reference project, `~/Documents/dreamtube`, whose `docs/known-gaps.md` is the
model.

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

## Pest's `toContain($needle, $message)` silently treats the message as a second needle

**`Expectation::toContain(mixed ...$needles): self` has no `$message`
parameter — every argument is looped over and asserted as a needle.**
Task 18's brief shipped `expect($route->gatherMiddleware())->toContain('tenant',
"route without tenant middleware: {$route->uri()}")`, intending the second
argument as a failure message the way `toBeTrue()`/`toMatch()`/
`toMatchArray()` genuinely accept one. Instead it asserted the middleware
array *also* contained that literal sentence, which it never does — the
check failed unconditionally, on every route, regardless of whether tenant
middleware was actually present. Caught only by running it and noticing the
failure text named the message string as the missing needle, not `'tenant'`,
against a `route:list`/tinker dump that already proved `tenant` was there.
Fixed to `expect(in_array('tenant', $route->gatherMiddleware(), true))
->toBeTrue($message)`, and confirmed both ways: passes when the middleware
is present, fails with the intended message when it (or, extended by the
Task 18 review, `auth` alongside a `role:*` gate) is removed.

The general trap: Pest's variadic assertion methods
(`toContain`, `toContainEqual`, and presumably any future
`mixed ...$x` signature) cannot take a trailing message — reach for
`toBeTrue()`/`toBeFalse()`/`toMatch()`/`toMatchArray()`/`toMatchObject()`
(all genuinely `string $message = ''`) when a loop-based architecture test
needs to name which iteration failed, or wrap the check in `in_array()`/
`str_contains()` and assert the boolean instead of asserting containment
directly with a message tacked on.

## CI's first real run: every Inertia render 500s if Pest runs before the Vite build

**The Task 20 brief's own workflow draft ran `php artisan test` before
`bun run laravel:build`, and every Feature test that renders a page failed
with `Illuminate\Foundation\ViteManifestNotFoundException: Vite manifest not
found at: .../public/build/manifest.json`** — 44 of 254 tests, every one of
them a route that goes through an Inertia response. Nothing in the phpunit.xml
guard chain catches this class of failure: it is not an environment leak, it
is a missing build artifact, and Inertia's response *is* the compiled HTML
shell, so no test double or `RefreshDatabase`-style scaffolding softens it.
It could not have been caught by reading the workflow, only by running it —
which is exactly why this task's brief called for a real run rather than a
written-but-unexecuted file. Reproduced live on `ubuntu-latest` (run
33051369147, `ci-scratch-task20`): `Pest` failed with 5 explicit
`ViteManifestNotFoundException` traces before the harness stopped printing
individual causes, `Vite build` never got the chance to run (its own step
comes after in a job that stops at the first failing step by default), and
`ExampleTest`/`ShellTest`/`RouteIsolationTest`/`AuthenticationTest` all went
red the same way. Fixed by moving the `Vite build` step ahead of `Pest` in
`.github/workflows/laravel.yml` (with a comment at the swap explaining why);
confirmed green on a second run (33051541868) with the same commit, all
254 tests passing, 3141 assertions. The general lesson: **any CI step that
renders even one page needs the front-end build to have already happened in
that job** — there is no lazy-build path in production Vite manifests the way
there is a lazy dev-server path locally.

## An unanchored rsync `--exclude` matches its basename at any depth, and the failure is invisible until the artifact runs

**`--exclude='src'` on the Task 21 deploy artifact did not mean "the
top-level `src/` directory" — it meant "any path component literally named
`src` anywhere in the tree," which strips every `vendor/*/src/` directory
Composer packages ship their PHP in.** Reproduced: `vendor/laravel/framework/src`
alone holds thousands of files, and against the real repo the same shape hit
`--exclude='tests'`, `'docker'`, `'scripts'`, and `--exclude='storage/logs'`
(which also matched `vendor/*/storage/logs`, wherever any dependency happens
to ship a directory by that name). The artifact would have shipped
`vendor/autoload.php` with a classmap pointing at files that do not exist —
every request fatals at boot — and because the Ship step in
`.github/workflows/deploy-laravel.yml` is `rsync -az --delete`, a redeploy
onto a previously-working host would have *deleted* those files there too,
not merely failed to add them.

Caught only in review, by a `rsync --dry-run --itemize-changes` against the
real repo tree — not by reading the exclude list, and not by an `ls -la` of
the repo root, which was the check actually performed and is exactly the
kind of check that cannot surface this (it shows what's at the root, not
what an unanchored pattern matches three directories down). The rule: an
rsync `--exclude` pattern with no leading `/` matches its basename anywhere
in the transferred tree, not just at the transfer root — write `/src`,
`/tests`, `/storage/logs`, etc. whenever "the top-level thing named X" is
what's meant, which is nearly always the intent for a deploy-artifact
exclude list. Fixed by anchoring every pattern in both `rsync` invocations in
`.github/workflows/deploy-laravel.yml`; re-verified with a dry run showing
`vendor/laravel/framework/src/*` present in the transfer and the top-level
`src/`/`tests/` still absent.

## Laravel's `app/` directory silently shadowed Next's `src/app/`, and it will happen again with `public/`

**PR #57 scaffolded Laravel's PHP application at the repo root, alongside the
existing Next.js tree — and Laravel's own `app/` directory (Models, Http,
Providers) has the same name as the one directory Next.js's App Router looks
for first.** `node_modules/next/dist/lib/find-pages-dir.js`'s `findDir()` is
explicit about the order: `// prioritize ./${name} over ./src/${name}` — it
checks `<root>/app` before `<root>/src/app`, returns it the moment it
*exists*, and never looks at what's inside it. With Laravel's `app/` sitting
at the root, Next silently adopted it as its own App Router directory, found
zero `page.tsx` files in a tree of PHP classes, and built nothing but its two
built-in special pages (`_not-found`, `_global-error`). No warning, no error —
`next build` reported "Compiled successfully" and a route table with exactly
one entry, `/404`. Every real page 404'd; `next dev`'s health checks in
`tests/lib/avatar-over-http.test.ts` / `tests/lib/registration-over-http.test.ts`
timed out waiting for content that was never generated; `docker build
--target smoke .` looped on `ChunkLoadError` for `_not-found`'s chunk, because
that was the only page the build had ever produced; and CI's `links` job
failed the same way, for the same reason — not a separate, pre-existing
docs-link problem, just the same missing routes.

This was diagnosed, not guessed: `mv app /tmp && bun run build` producing the
full 54-route table, moving `app/` back and getting exactly one route again,
made it reproducible on demand, and the `find-pages-dir.js` source confirms
there is no config knob to change Next's preference — it is hardcoded.
**Nothing about this is a dependency-version problem.** The tailwindcss/vite
coexistence and the bumped transitive versions in `bun.lock` were the
suspects going in; both build clean and were not the cause.

Fixed by moving Laravel's application code out of the collision, not by
touching anything under `src/`: `app/` → `laravel_app/`, with
`composer.json`'s `"App\\": "app/"` psr-4 mapping updated to
`"laravel_app/"` and `bootstrap/app.php` calling
`$app->useAppPath($app->basePath('laravel_app'))` after `->create()` (the
namespace `App\` never changes, only where Laravel looks for it —
`useAppPath()` exists in `Illuminate\Foundation\Application` for exactly
this). `phpunit.xml`'s coverage `<source>` and `phpstan.neon`'s `paths` also
named `app` literally and needed the same rename. Verified both sides after:
Larastan level 8 clean, Pint clean, all 265 Pest tests still passing;
`bun run check` green across all 180 test files including the two over-HTTP
ones; `docker build --target smoke .` serving the real landing page;
`bun run check:links` crawling all 50 real pages with zero dead links.

**This will recur.** `public/` has the identical shape of problem today,
just not (yet) a fatal one: Laravel's `public/index.php` and Vite's
`public/build/` sit in the same directory Next.js serves as static assets at
the URL root. Next doesn't error on this either — it just serves
`index.php`'s raw source as a downloadable static file at `/index.php`,
silently, the same way it silently adopted the wrong `app/`. Nothing in
either CI job currently requests `/index.php`, so nothing is red — but the
mechanism is the same shared-root-directory collision, one layer down. There
is also a smaller, non-fatal one already living with it: PHP's `tests/` (Pest,
namespaced `Tests\`) and TypeScript's `tests/` (Vitest) are interleaved in one
directory today; that one is cosmetic because the two suites glob for
different file extensions, but it is the same instinct — two frameworks
independently assuming they own a root-level name — that broke `app/`.

**The actual fix for the family of problems, not just this one instance,**
is the one the redirect decision two sections below already named and
declined for a different reason: a proper workspace split with Laravel under
its own subtree (the way `~/Documents/dreamtube`'s `apps/web` keeps a second
stack from ever touching the first stack's root-level conventions). That
was reasonably out of scope for Phase 0 and is a bigger call than a CI-fix
task should make unilaterally — but the `app/` collision is evidence the
premise ("no second app... to justify one") is now false, not just for
`package.json`/`bun.lock` (which this task's brief already flagged) but for
the plain filesystem layout underneath it. Recorded here so the next
dependency — or the next root-level directory either framework introduces —
does not have to rediscover this by reading `find-pages-dir.js` again.

**Resolved, the other direction from the one predicted above.** The product
owner decided the Next.js tree is reference-only going forward — Phases 1–3
diff against it, but nothing edits it again — so instead of giving Laravel its
own subtree beside an equal Next.js, the Next.js tree moved wholesale to
`old_next/` (`git mv src old_next/src`, and everything else that was
Next-exclusive: `next.config.ts`, `vitest.config.ts`, the Next-side `tests/`,
`compose*.yaml`, `Dockerfile`, `Caddyfile`, `deploy.sh`, the VPS-deploy half of
`scripts/`, and the covers/favicon/logo/robots half of `public/`) and
`laravel_app/` moved back to the idiomatic `app/`. `composer.json`,
`phpstan.neon`, `phpunit.xml` and `bootstrap/app.php`'s `useAppPath()` override
all reverted to naming `app/` directly — the override is gone entirely, not
repointed, because there is nothing left at the root for `app/` to collide
with. `package.json`/`bun.lock`/`node_modules`, `.env`/`.env.example`, `docs/`
and `public/index.php`+`.htaccess` stayed shared at the root by deliberate
choice, not oversight; see the repo root's `AGENTS.md` for the full list and
`old_next/AGENTS.md` for how the reference app still runs from its new home.
The `public/` collision this section predicted never had to be resolved by
choosing one file over the other — Next's half of `public/` simply moved with
the rest of Next into `old_next/public/`, leaving Laravel's `index.php` and
`.htaccess` alone at the root with nothing left contesting the name. The CI
workflow that ran the Next.js suite (`ci.yml`) was retired rather than
retargeted at `old_next/`: nothing there is expected to change again, so a
permanently-green check on frozen code bought nothing, and two of its
architecture tests that asserted facts about `ci.yml` itself
(`ci-pins-the-storage-image.test.ts`, `ci-supplies-required-env.test.ts`) were
removed along with it rather than left failing against a file that no longer
exists. Verified after: all 265 Pest tests, Pint and Larastan level 8 still
pass; `old_next/`'s own full suite (178 files, 1635 tests, two fewer than
before for the reason above) still passes from its new home, and `bun run
build`/`bun run typecheck`/`bun run lint` all succeed against it too.

**One rough edge this move left behind: `.env` is no longer reachable by
default from `old_next/`.** `.env` stayed at the repo root, shared with
Laravel — deliberately, see above — but `old_next/` is now one directory
below it. `next dev`/`next build` load `.env` from their own project
directory and have no "look one level up" flag, so a bare `bun run dev`
there sees none of the shared secrets. `docker compose` is worse: it resolves
`.env` from the directory it's invoked in, several of `compose.yaml`'s
variables are hard-required (`${POSTGRES_PASSWORD:?…}`,
`${S3_ACCESS_KEY_ID:?…}`), and `docker compose config`/`up` from inside
`old_next/` with no further action fails immediately —
`POSTGRES_PASSWORD variable is not set` — rather than degrading gracefully.
The fix is `docker compose --env-file ../.env ...` (or
`COMPOSE_ENV_FILES=../.env` once per shell), written down in
`old_next/AGENTS.md`'s "Running the stack" and ".env reachability" sections;
there is no equivalently clean fix for `next dev`/`next build` beyond copying
or symlinking `.env` into `old_next/` by hand, also noted there. Not treated
as a blocker — the reference app's install/typecheck/lint/format/test/build
path (the thing actually verified after this move) never touches `.env` at
all, and the container/dev-server path is a local convenience, not something
anything else in the repo depends on.

**The Docker image was rebuilt and run, not just reasoned about.** The
`context: ..` / `dockerfile: old_next/Dockerfile` change, the new
`outputFileTracingRoot`, and the rewritten `COPY`/`CMD` paths in the
`runner` stage (`old_next/server.js`, `old_next/.next/standalone`) were all
verified with a real `docker compose --env-file ../.env build app` from
`old_next/`, followed by `docker run` against the resulting image: it served
the real landing page (`curl` returned 200 and the page body) exactly as the
pre-move image did. `docker build --target smoke .` was previously CI's own
guard for this and is no longer run anywhere (`ci.yml` is gone) — running
the equivalent by hand, as above, is now how that gets checked, on demand.

## Deliberately unfinished

- **No absolute session lifetime.** Laravel's session shape offers only idle
  timeout via `last_activity`; the old `src/auth/session.ts` enforced a 30-day
  absolute cap independent of activity. Decided and argued in the permanent
  comment beside `'lifetime'` in `config/session.php` — accepted for v1, not
  closed, and no task reinstates it.
- **No session rotation on credential reset.** Nothing invalidates a user's
  *other* sessions when their credentials change. Named as a second open item
  in the same `config/session.php` comment; assigned to no task.
- **No `validation.php` language file exists, in any locale, so a
  `FormRequest`'s automatic rule messages render as raw translation keys.**
  `find . -iname validation.php` outside `vendor/` finds nothing — Laravel
  11+ ships no default language files at all; they only exist once
  published via `php artisan lang:publish`, which this app never ran.
  `lang/vi/` holds only `auth.php` (Task 16's deliberate messages for
  `LoginRequest::authenticate()`'s own `ValidationException` —
  `auth.failed` and `auth.throttle`, both reached via `__()` directly and
  unaffected by this gap). What *is* affected is `LoginRequest`'s automatic
  rule validation (`rules()`, `LoginRequest.php:24-27`): submitting the
  login form with an empty `password` fails Laravel's own `required` rule
  before `authenticate()` ever runs, and with no `validation.php` to
  translate the message key, `resources/js/pages/auth/login.tsx`'s
  `errors.password` renders the literal string `validation.required`
  rather than real text. It is not merely missing an English fallback:
  `.env` and `.env.example` both set `APP_LOCALE=vi` *and*
  `APP_FALLBACK_LOCALE=vi`, and Laravel's `Translator::localeArray()`
  dedupes `[locale, fallback]` into a single-entry chain when the two
  match — so the vendor's own English `validation.php`
  (`vendor/laravel/framework/.../lang/en/validation.php`) is never
  consulted as a rescue either; it would only be reached with
  `APP_FALLBACK_LOCALE=en`. Any other `FormRequest`'s default rule
  messages would show the same way — this is not specific to the login
  screen, just the first place Task 18 rendered one. Left for Phase 1,
  which is expected to publish and translate `lang/vi/validation.php`
  alongside the real forms that need field-level messages, rather than a
  one-off fix to this one request.
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
- **`User` is deliberately global and nothing structural scopes it.** The
  shelf's person-boundary is `memberships`, not `users` — a person can hold
  memberships on more than one shelf, so `User` correctly carries no
  `bookshelf_id` and no `BelongsToBookshelf`. But the
  `TenancyArchitectureTest` hand-written-`bookshelf_id`-filter tripwire only
  watches for that literal column name, and `User` has no such column to
  watch — so a Phase 1 `User::query()` on a manage screen (a readers list,
  say) sees every user in the system, shelf boundary or not, with no test
  firing anywhere. Nothing in this phase scopes user reads by membership;
  Phase 1 must do it explicitly (typically by joining through
  `memberships`), and cannot lean on the trait/scope/architecture-test
  combination that protects every shelf-scoped model, because `User` sits
  outside that combination by design.
- **Four `Feature` test files use the plural `withoutGlobalScopes()` with no
  arguments** (17 call sites: 4 in `ResolveTenantMiddlewareTest`, 2 in
  `RouteIsolationTest`, 10 in `EnsureShelfRoleTest`, 1 in `GateTest` — not
  `tests/Support/TenantHarness.php`, which has zero occurrences) to insert a
  `Membership` row directly, bypassing the tenancy scope's own bookkeeping
  so the test can build fixtures the scope would otherwise interfere with.
  This is the exact call shape the `ResolveTenant` known-gaps entry above
  declares forbidden — bare `withoutGlobalScopes()` strips every current and
  future global scope, not just the named tenancy one — but every one of
  these 17 call sites is on `->create()`, where global scopes constrain
  reads/updates/deletes, not inserts, so today they are harmless. The rule
  now has seventeen counterexamples in the test suite and no test enforcing
  it: the next person who copies this idiom into a *read* (`Membership::query()
  ->withoutGlobalScopes()->get()`, say) reopens the exact revoked-admin bug
  that entry documents, and nothing in the suite would catch it. Left as-is
  rather than mass-renamed to `withoutGlobalScope(BookshelfScope::class)`
  because every occurrence here is a create, not a read — but a future pass
  should either rename them for hygiene or add a static/architecture check
  that treats bare `withoutGlobalScopes()` outside a `->create()`/`->save()`
  chain as a violation.
- **`BelongsToBookshelf`'s creating/updating hooks close the mass-assignment
  hole, not every write path.** Eloquent model events don't fire for
  query-builder writes, so `Announcement::query()->update(['bookshelf_id' =>
  $other->id])` under a bound shelf still moves the row: the global scope
  constrains the query's `WHERE`, not the values in its `SET`, and neither
  hook runs. `Model::insert()` bypasses the `creating` hook the same way.
  The composite FKs (Task 11) catch this for a *child* row referencing a
  scoped parent, but there is no structural backstop for a top-level scoped
  model with no such parent, e.g. `Announcement`. Nothing in this codebase
  currently writes through either bypass; Phase 1 should not introduce a
  bulk `update()`/`insert()` against a shelf-scoped model without this in
  mind.
- **`Bookshelf::feedback()` has no test of its own.** It is the entire
  mechanism the final review's I2 finding was resolved with — Phase 2's
  shelf-scoped feedback reads are meant to go through it instead of a
  hand-written `where('bookshelf_id', …)` — but nothing in this phase
  exercises it, because nothing in this phase reads feedback by shelf yet.
  It is an ordinary `hasMany` on an already-tested FK, so this is coverage
  debt rather than a suspected bug; Phase 2, which is where the relation
  gets used for real, is the natural place to add the test alongside the
  first real caller.
- **Factory `->create()` under a bound tenant now throws for any factory
  whose `definition()` names its own `bookshelf_id`.** `BelongsToBookshelf`'s
  `creating` hook validates an explicit `bookshelf_id` against the bound
  shelf; `MembershipFactory`'s `'bookshelf_id' => Bookshelf::factory()` (and
  any similarly-shaped factory) satisfies that by inventing a fresh,
  unrelated shelf, which the hook then correctly refuses under a bound
  context. This is the fix working as intended — silently writing into a
  freshly-invented shelf instead of the bound one was the bug I1 closed —
  but it will read as a regression to a Phase 1 author who hits it without
  knowing the hook is new: call such a factory with `->for($boundShelf)` (or
  run it with no tenant bound / under `TenantContext::actSystemWide()`)
  rather than bare.
- **The tenancy architecture expectation enumerates Eloquent models**, with
  the exemption list schema-derived and nullability-guarded — so a future
  `NOT NULL bookshelf_id` table that has no model is invisible to it. Adding a
  table without a model bypasses the census entirely.
- **`$guarded = []` leaves `Membership::role`, `Comment::moderated_by` and the
  `BorrowRequest`/`Loan` status columns mass-assignable.** Brief-mandated.
  Task 17/18 landed without adding the form requests that were meant to gate
  these fields, so the gap is real and open, not merely pending: any Phase 1
  code path that feeds request input into `fill()`/`create()` on these models
  is writing authorization state, and closing it is Phase 1's job, not a
  dependency that already resolved itself.
- **`phpstan.neon` analyses `app/`, `database/` and `routes/` only.** "Larastan
  clean" in any report on this branch never covered `tests/`.
- **Archived-shelf routing is an open question, not a decision.** Nothing in
  this phase specifies what happens when a shelf's `status` is `archived`
  and a request still names its slug — whether every route 404s, whether
  reads stay open while writes close, or whether only the public-facing
  routes stay reachable. The final review flagged this and deliberately did
  not decide it here; it is Phase 1's call, informed by BR, not something to
  infer from `BookshelfStatus::Archived` existing as a case.
- **PR #57's review follow-up 3 first miscounted the `updated_at` parity
  fix as thirteen tables; it is fourteen, `bookshelf_contacts` included.**
  The first pass read only `src/db/migrations/20260808_06_updated_at_
  triggers.sql`'s own `array[...]` literal and concluded `bookshelf_
  contacts` — added afterward, in Task 1's PO-feedback contacts rework —
  "never carried this guarantee on either side", and left it un-fixed with
  that claim recorded here. It was wrong: `src/db/migrations/20260812_01_
  contacts_profile_and_hours.sql:58-60` creates `bookshelf_contacts_set_
  updated_at` explicitly, its own trigger attached at the same table's
  creation. A second review round caught the false claim and closed it —
  `bookshelf_contacts.updated_at` now carries `->useCurrentOnUpdate()`
  alongside the other thirteen, and `DbGuaranteesTest`'s probe covers all
  fourteen. Recorded here anyway, past tense, as the concrete case for a
  process point: "checked the migration's own list" is not the same claim
  as "checked every migration that could touch this table", and the first
  is not enough when a later migration can extend what an earlier one
  named.

- **`RouteOrderTest`'s reader-area `role:` assertion excludes a segment
  anywhere in the URI, not by position.** `$excludedSegments = ['manage',
  'feedback']` is checked with `explode('/', $route->uri())` against the
  whole path, so a future `shelves/{shelf}/books/{book}/feedback` (a
  per-book feedback thread, say) would be silently exempted from the
  role:reader assertion even though it is not the top-level, deliberately
  guest-reachable `feedback` route the exclusion exists for. Flagged by the
  coordinator's review of PR #57's follow-up 2; not fixed here because no
  such route exists yet to prove the fix against — a future author adding a
  nested route that happens to share a segment name with `manage` or
  `feedback` should re-check this filter's shape before trusting it.
- **`donate` is a 308 redirect in the Next.js original, not a page.** This
  Laravel branch renders it as an `under-construction` page like every
  other reader-area route, and gating it behind `role:reader` produces the
  same end state a gated redirect would (a non-member still can't reach
  whatever `donate` points at), but Phase 1, which is where `donate`
  becomes a real screen, should model it as a redirect rather than
  continuing to treat it as a page of its own.

## Smaller deferred items, by task

Each of these was seen, judged real, and deliberately left for the final
review or a later task rather than fixed in place:

- **Task 2:** `composer.json` is still named `laravel/react-starter-kit`, with
  an npx/npm `dev` script in a Bun repo. Biome's `"preset": "recommended"` is
  weaker than `"recommended": true` (hides 3 findings). `.gitattributes`
  arrived as rsync fallout rather than a decision; the `.gitignore` Laravel
  block duplicates five Next entries. Seven `@var User` Larastan silencers in
  controllers. `components.json` carries a `"_hazard"` key that is not in
  shadcn's schema — smoke-test `shadcn add` before Task 18 relies on it. (The
  vite toolchain sitting in `dependencies` instead of `devDependencies` was
  fixed in the final review pass; `HandleInertiaRequests::share()` calling
  `parent::share()` twice was already fixed by the time of that review — the
  method now calls it once. Neither needs tracking here any longer.)
- **Task 3:** agreement of the fold with live Postgres `unaccent()` on the
  non-decomposing Latin set was never verified (no Postgres in this checkout).
  Moot while there is no data migration; becomes real the day an import is
  added.
- **Task 6:** `resources/js/components/appearance-tabs.tsx` has no importer —
  orphaned by the settings deletion, left for a future settings rebuild.
  `DashboardTest`'s schema-independent guest-redirect coverage was over-deleted
  (accepted: Task 18 replaces the dashboard route wholesale).
- **Task 6, fix round:** `Registration::findExistingPerson()`'s no-username
  triple (full_name + date_of_birth + phone) is check-then-write with NO
  structural backstop — unlike the username path (`users_username_key`) and
  the walk-back (`memberships_one_per_shelf`, now also lock-guarded), a
  concurrent registration of the same identity with no username can still
  create two `users` rows racing this read. The approval queue's
  similar-name warning (BR §5.3) is the product's accepted mitigation, not a
  structural fix; a real fix would need either a unique index over
  (full_name_ci, date_of_birth, phone) — which would then have to define
  what "no phone" means for uniqueness (NULLs are already distinct, so a
  reason-only registration is naturally exempt) — or an application-level
  advisory lock. Left for whichever task does the phase's final guarantee
  sweep. Separately: `Registration.php`'s own docblock previously (wrongly)
  claimed this gap was already recorded here; that line has been corrected
  to say it wasn't, rather than making it true retroactively — this bullet
  is what makes it true now. Also unresolved from the same fix round:
  unmapped `QueryException`s thrown from `Registration::register()` reach
  Laravel's default exception logging with the child's full name, DOB,
  parents' names and phone inlined in the message (Laravel logs the bound
  SQL by default). Not fixed in the fix round — the correct fix is an
  app-wide redaction of logged exception messages/contexts, not a
  one-command patch that leaves every other Action with the identical
  exposure while looking addressed; that redaction mechanism belongs with
  whichever task owns the phase's logging/PII policy (Task 16, per its
  ownership of the hashed-session-at-rest decision elsewhere in this file).
- **Task 7:** no assertion covers the `books_public`/`copies_by_book`/
  `copies_by_state` indexes, so their removal goes unnoticed; the collation
  hazard is proven only indirectly (a `collation_name NOT LIKE '%_bin'`
  assertion on `books.title` would fail loudly where the fold tests might
  not); three `LIMIT 1` selects with no `ORDER BY`; `makeCatalogueShelf()` is
  a top-level Pest helper later suites must not redeclare; varchar width caps
  on `isbn`/`code`/`acquired_from` that Postgres's `text` never imposed.
- **Task 8:** `loans_by_borrower` silently drops `0012_indexes.sql`'s
  `lent_at desc` — MariaDB 10.11 supports descending index parts, so this is a
  fidelity loss, not a platform limit, and the comment does not say so.
  Corrected count (the final review found the original "four" understated
  it): there are **17** CHECK tests across five schema test files
  (`AdminSchemaTest`, `CatalogueSchemaTest`, `CommunitySchemaTest`,
  `CirculationSchemaTest`, `IdentitySchemaTest`) that assert only
  `toThrow(QueryException::class)`, so on their own they cannot tell which
  constraint fired. This is not a coverage gap in practice: every one of
  those 17 is duplicate-covered by `DbGuaranteesTest`'s
  `dbgExpectViolation()` helper, which pins the exact errno (4025 for a
  CHECK) *and* the constraint name (via a `CONSTRAINT` plus the name
  substring match) — so the name-blind assertion is redundant with a
  name-pinned one elsewhere, not a hole.
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
- **Task 9 (members plan), fix round:** `SetReaderCredentials.php`'s
  `$person->save()` sits inside a plain `try`/`catch (QueryException $e)`
  whose only handled case is `UniqueViolation::translate()` for
  `users_username_key`; every other `QueryException` — the `not null`
  columns, a truncated value, a lock-wait timeout — falls through untouched
  and reaches Laravel's default exception logging. `QueryException::
  formatMessage()` defaults `maskBindings` to `false`, so the logged message
  inlines the query's bound parameters verbatim. This is the identical class
  of gap already recorded above under "Task 6, fix round" for
  `Registration::register()` (which leaks a child's full name, date of
  birth, parents' names and phone) — `bootstrap/app.php`'s `withExceptions()`
  registers no redaction hook, so nothing between the driver and the log
  file strips a bound value either place. This instance is strictly worse:
  the bound value that leaks is `Hash::make($password)`, a freshly generated
  **password hash**, not merely personal data about a child. Not fixed here,
  for the same reason the Task 6 instance was not fixed in place — the
  correct fix is one app-wide redaction mechanism for logged exception
  messages/contexts, not a second one-command patch that leaves every other
  Action with the identical exposure while looking addressed. Belongs with
  the same owner named above: whichever task owns the phase's logging/PII
  policy (Task 16, per its ownership of the hashed-session-at-rest decision
  elsewhere in this file). `SetReaderCredentials.php` now carries an inline
  comment naming this gap, mirroring `Registration.php`'s own.
- **Task 13, fix round:** `RegisterMembershipRequest::rules()` accepts NUL
  bytes, control characters (`\r\n\t\x07`) and the RTL-override mark
  U+202E into `full_name` (and every other free-text field on the form) —
  `'string', 'max:255'` checks length and PHP string type, nothing about
  which code points are in it. Corrected in the PR #61 fix round: a
  LEADING (or trailing) BOM (U+FEFF) is NOT one of these — verified live,
  a leading BOM does not survive to storage. The global `TrimStrings`
  middleware runs on every request before validation, and
  `Illuminate\Support\Str::trim()` (which it calls) strips
  `Str::INVISIBLE_CHARACTERS` — a list that includes `\x{FEFF}` — from
  both ends of every string field, not merely ASCII whitespace; the other
  four (NUL, control characters, U+202E) are not in that list and remain
  verbatim exactly as this entry originally said. A BOM placed
  MID-STRING, not at either edge, is unaffected by `TrimStrings` and is
  still stored verbatim — confirmed live alongside the other four. These
  are stored verbatim on `users.full_name` and reach the manager's approval queue
  (`GetPendingRegistrations`) and later exports unfiltered: a name
  containing U+202E can visually reverse everything after it in a
  manager's UI, and embedded control characters can corrupt a CSV/TSV
  export or a terminal that renders one. Not fixed in this round — the
  correct fix is a shared sanitisation step (strip C0/C1 controls and the
  Unicode bidi-override/format characters, likely alongside `trim()`) that
  every free-text write path applies identically, which means
  `ProfileFields::normalisePatch()` (Task 9) and `Registration::register()`
  (Task 6) would need the identical treatment `RegisterMembershipRequest`
  got — those are two other tasks' files, and patching only this task's
  entry point would leave the manager's own reader-creation and
  profile-correction forms with the identical hole while looking
  addressed. Left for whichever task does the phase's input-sanitisation
  sweep, the same shape of deferral as the logged-PII gaps above.

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

## Phase 1a — Catalogue

This section is the durable record of
`docs/superpowers/plans/2026-08-27-laravel-phase-1a-catalogue.md` (books,
copies, the manager and reader catalogue screens). Written by Task 14, the
plan's guarantee sweep, after re-breaking and re-fixing each item below live
rather than accepting it on the strength of the code alone.

- **The `actingAs()` guard cache is real, and it bit this phase twice before
  being pinned.** `Illuminate\Auth\SessionGuard` resolves and caches
  `$this->user` on first use and never re-derives it from the request for
  the rest of that PHP process — so a guest or non-member assertion appended
  after any `actingAs(...)` call earlier in the same test method (including
  one buried inside a fixture helper) silently re-runs as that cached user,
  not as a guest. Reproduced live for this record: a manager write posted
  with no `actingAs()` call in the same test, immediately after an earlier
  `actingAs($manager)->get(...)` in that method, redirected back to the
  manage/books form (a validation redirect) rather than to `/login` —
  proving the "guest" request was still authenticated as the manager. This
  hit Tasks 12 and 13 in this phase, the second time one task after the
  first was already recorded, which is itself the lesson: recording a trap
  once is not the same as everyone downstream having read it.
  `tests/Feature/Catalogue/ManageBookScreensTest.php` and
  `tests/Feature/Tenancy/RouteIsolationTest.php` are the convention going
  forward — guest/non-member coverage is always its own `it()` block, never
  appended to a block that already called `actingAs()`.
- **UUID v7 primary keys make an unordered scan return rows in creation
  order, which defeats a sort-tiebreak test seeded in already-sorted
  order.** `ReaderQueriesTest`'s slug-tiebreak test survived two hardening
  rounds before landing on 11 colliding titles inserted in creation order
  `de-men, de-men-2, ..., de-men-11` and asserting the lexicographic slug
  order `de-men, de-men-10, de-men-11, de-men-2, ..., de-men-9` — a
  genuinely different sequence from creation order only once there are ten
  or more collisions (`de-men-10`'s `'1'` sorts before `de-men-2`'s `'2'`
  as a byte). Verified live for this record: deleting `SearchQuery`'s
  `orderBy('slug')` tiebreak makes the test fail with the un-tiebroken
  creation order, confirming the assertion is falsifiable. A two- or
  three-row version of this test would pass whether or not the tiebreak
  exists, because with few rows creation order and slug order coincide —
  it would guard nothing while looking like it guards the tiebreak.
- **A repeated query key (`?category[]=a&category[]=b`) arrives as an array
  and raw-500s any controller that hands it straight to a query expecting a
  string.** `CatalogueController` and `SearchController` both threw on this
  before the fix; `Manage\BookController` read `q` and `category` the
  identical way and carried the identical hole. `old_next/src/lib/search-
  params.ts`'s `param()` had already solved this and documented, in its own
  comment, that four of the reference's own pages shipped a 500 over
  exactly this shape — the fix was known and simply never ported until this
  phase built `app/Support/QueryParam.php`. Verified live for this record:
  reverting `Manage\BookController::index()`'s `category` read to
  `$request->query('category')` reproduces the exact documented failure,
  `TypeError: Argument #2 ($slug) must be of type string, array given`, and
  `ManageBookScreensTest`'s `'a repeated ?category[]= takes its first value
  rather than 500ing'` catches it. The lesson generalises past this one
  helper: a guard the reference already documents solving is not optional
  scaffolding to skip when porting a page.
- **The copy-code race probes did not port; the serialisation moved to a
  shelf-row lock whose POSITION is the guarantee.** The reference proved its
  allocator with two live connections racing to commit; under
  `RefreshDatabase` a second connection cannot see uncommitted fixtures, so
  `AllocateCopyCodesTest` and `CreateBookTest` pin the *mechanism* instead —
  and specifically that the `FOR UPDATE` on the `bookshelves` row is the
  **first query of the transaction**, because under InnoDB's REPEATABLE READ
  the read view is pinned at the first consistent read and a lock taken
  after any earlier SELECT still reads a stale snapshot (reproduced live on
  10.11 during this plan's review: duplicate copy code, silently-committed
  ISBN duplicate, missed slug — Postgres's per-statement READ COMMITTED is
  why the reference could afford reads before its lock and this port
  cannot). The real rule for every future phase: **nothing may read before
  the lock.** `book_copies_code_unique`'s errno 1062 remains the structural
  backstop for codes and slugs; ISBN has no such backstop — see the next
  entry.
- **`AllocateCopyCodes`'s `DB::transactionLevel() === 0` guard has no test
  that can throw it.** The guard defends against a caller invoking
  `execute()` outside `DB::transaction()`, where the `FOR UPDATE` above
  would autocommit and its row lock would release before the `MAX` scan
  even ran — silently providing none of the serialisation the class exists
  to provide, while looking like it does. But every test in the suite runs
  under `RefreshDatabase`, which wraps the whole run in its own outer
  transaction, so `DB::transactionLevel()` is never 0 from inside a test —
  there is no way, from this harness, to observe the class running with no
  transaction open. Disclosed honestly at
  `tests/Feature/Catalogue/AllocateCopyCodesTest.php:111-118` rather than
  faked with a mock; recorded here because a guarantee a test can't reach
  is exactly the kind of thing this file exists to keep visible.
- **`duplicate_isbn` is a check-then-write with no structural backstop, and
  the failure mode of getting the ordering wrong is SILENT corruption, not
  an error.** No unique index backs ISBN (a partial per-shelf ISBN unique
  was named as the structural fix in the B1 plan's known gaps and was not
  built there either), so a stale read here does not raise 1062 — the
  duplicate simply commits. The check is safe only because it reads *under*
  a lock that is the transaction's first statement; "after the allocator"
  alone is necessary but not sufficient. `CreateBookTest`'s lock-first
  query-log pin is the tripwire; no single-connection test can show the
  corruption itself.
- **`DeleteBook` is implemented, tested, and reachable from no screen** (the
  reference's Q7, OPS §4.1's open question). `CatalogueArchitectureTest`
  pins the *absence* of the route so adding it is a decision, not an
  accident. The retention rule (`copy_has_history` retains, never throws) is
  pinned by `BookLifecycleTest` either way.
- **`AssessConditionRequest` carries no `photo` rule, and
  `condition_assessments.photo_url` stays unpopulated** —
  `app/Http/Requests/Catalogue/AssessConditionRequest.php` validates only
  `condition` and `note`; `AssessCondition::execute()` still accepts a
  `?string $photoUrl` parameter (for parity with the Action's own
  signature), but nothing in the request or controller ever supplies one.
  Deliberate, not an oversight: the reference dropped both the cover and
  return-photo uploaders per its own docblock, and this phase matched that
  scope rather than building an uploader the reference itself chose not to
  ship.
- **The donor member picker is deferred to 1b.** `donor_membership_id` is
  accepted, validated, stored, audited and rendered back (the manager detail
  resolves the member's name) — but the create form offers only the
  free-text donor until `GetReadersList` exists to search members. The OPS
  §16.3 donation-queue pre-fill (Duyệt → form with Người tặng pre-filled) is
  Phase 2's, and lands on this same field.
- **The reader detail page ships without its "Xin mượn" button, comments, or
  the manager's lend/return shortcuts** — `CreateBorrowRequest` and comments
  are Phase 2, `LendCopy`/`ReceiveReturn` are 1c. The availability panel,
  queue length and contact line are live.
- **`lang/vi/validation.php`'s `attributes` array only names this phase's
  fields; a field validated by a later phase without an entry there falls
  back to Laravel's default attribute display** — `getDisplayableAttribute()`
  (`vendor/laravel/framework/.../Validation/Concerns/FormatsMessages.php:308`)
  renders an unlisted attribute as `str_replace('_', ' ', Str::snake($attribute))`,
  e.g. `donor_membership_id` unlisted would read "donor membership id" inside
  an otherwise-Vietnamese message. The rule *messages* are not at risk of
  this: diffed against `vendor/laravel/framework/.../lang/en/validation.php`,
  all 138 of the vendor file's own message keys are translated — the only
  absent key is `custom.attribute-name.rule-name`, the vendor file's own
  placeholder example, not a real rule. The Task 1 test pins `required`; it
  does not census the file.
- **The manager index reuses `copyCountLine` with its middle figure computed
  as `total - available`** (which counts held copies as "đang cho mượn") —
  the per-row true on-loan count was deliberately not added to the list
  query for one label. The detail pages show the true count. Revisit if a
  manager reports the number as wrong rather than approximate.
- **`GetShelfHome` (OPS §3.2) is deferred to Phase 2, whole.**
  `ShellController::shelfHome()` still renders the propless `shelves/show`.
  The page's centerpiece card is the pinned-or-latest announcement — a
  Phase 2 entity — while its catalogue-count link and *Mới thêm* cover row
  become computable with this phase's queries; building the page now would
  mean rebuilding it in Phase 2 when the announcement card and the Tặng
  sách/Góp ý cards land. Deferred so the shelf home is built once, against
  its full OPS §3.2 shape.
- **The catalogue queries pay ~8 correlated aggregate subqueries per row,
  and `books_public` goes unused** (the sort is on unindexed
  `title_folded`), where the reference did one grouped join. Honestly fine
  at BR §1's few hundred books per shelf — the paging tests run against real
  MariaDB — but if a shelf ever grows past that, the fix is a single
  grouped-join query shape, not a stored counter (BR §8).
- **One reference-parity regression a product owner should decide on, not a
  defect.** `resources/js/pages/manage/books/index.tsx` renders a single
  `<ul>` (line 106) and drops two things the reference had:
  the "In mã QR" action button (its `qr-labels` route is still
  `under-construction`, so a live button would point nowhere today) and the
  reference's desktop-table / mobile-card responsive split. The plan
  specified the single-`<ul>` markup, so this is a deliberate
  simplification — but the lost responsive split is a real, visible UI
  difference from the reference that a product owner, not this sweep,
  should sign off on before Phase 2 either restores it or formally drops
  it.

## Phase 1b — Members

The durable record of `docs/superpowers/plans/2026-08-28-laravel-phase-1b-members.md`
(registration, approval, reader administration). Written by Task 16 after
the full suite ran green.

- **The no-username identity match has no structural backstop, by design.**
  Two concurrent registrations of the same child (same name/DOB/phone, no
  username) can create two `users` rows: the triple-match in
  `app/Actions/Members/Registration.php` is a plain read with no unique
  index behind it, exactly as the reference shipped. The product's answer
  to duplicate PEOPLE is BR §3's similar-name warning on the approval
  queue, decided by a human who knows the family. The username and
  membership collisions ARE structural (`users_username_key`,
  `memberships_one_per_shelf`, errno 1062 translated by
  `App\Support\UniqueViolation`).
- **`ManagerRegisterReader` is implemented, tested, and reachable from no
  screen.** `MembersArchitectureTest` pins the absence. 1c's quick-lend
  escape hatch is the intended surface — and the plan-header's open
  question 1 (active vs pending) should be re-confirmed with the product
  owner before 1c wires it.
- **`ApproveMembership`/`RejectMembership` write NO notification rows yet.**
  The reference writes `membership_approved`/`membership_rejected` inside
  the command transaction (OPS §7). Phase 2 must add both writes when the
  notification system lands — the Actions carry the same note.
- **`POST /register` is throttled on two keys, both numbers invented here**
  — 30/minute per IP (burst) and 20/day per SHA-256 of the submitted phone,
  falling back to the IP when the phone is blank. A decision taken on the
  product owner's behalf: OPS §8 (:1158) lists `RegisterMembership` rate
  limiting as unaddressed in both source documents. The per-day/hashed key
  is modelled on OPS §8's only stated limit (`SubmitFeedback`, 3 per phone
  per day, hashed); a per-IP-only limiter was rejected because BR §16.1's
  scenario is a room of people behind one parish connection. The limiter is
  named `register` in `AppServiceProvider`; loosening the burst limit is the
  first thing to try if a real registration event trips it.
- **`already_registered_here` is an existence oracle on the public form.**
  A stranger who knows a child's exact name, date of birth and phone learns
  whether that child is registered at this shelf. It reveals membership but
  never status (suspended, pending and active all answer identically — a
  consequence of CRITICAL 1's walk-back fix). Inherited from the reference,
  which addresses the *username* probe channel only. Closing it would mean
  dropping the no-username triple-match, which is how BR §5.3's cross-shelf
  identity reuse works for the majority of readers who have no username.
- **Public registration answers `GetParishUnits` to guests**, a query OPS
  §3.2 lists as `reader`-gated and flags with its own open question (:75).
  Live units only, and a parish's list of `Giáo họ` is not personal data —
  but it is a documented gate this plan chose to open.
- **`ReactivateMembership` has a button that the reference never had**
  (OPS:443: "no visible 'Kích hoạt lại' button anywhere in the 47 screens").
  Added on the reader detail because BR §7.5 draws the suspend arrow both
  ways and a suspension with no way back is a trap.
- **`member_has_active_loans`' Vietnamese sentence is authored by this
  plan.** OPS:453 names the code in prose and supplies no sentence, and
  `has_active_loans` was unavailable — 1a already holds that key for a
  sentence about a book. Five other refusal codes follow the reference's
  `errors.ts` spelling rather than OPS §4.3's abbreviations; the mapping
  table is in the plan header's divergence 6.
- **The reader profile page, `GetMyProfile` and `ChangeOwnPassword` are
  deferred to Phase 3 whole**, with the profile-change lifecycle they
  share a screen with (the 1a GetShelfHome precedent). A reader's only
  password path until then is the volunteer (`SetReaderCredentials`),
  which is BR §2's model anyway.
- **`ReaderDetailQuery` derives days-remaining/overdue locally.** 1c must
  move the due-date math to `app/Support/Circulation/` and point this
  query at it — two definitions of "overdue" is the drift BR §8 exists to
  prevent, and this one is temporary by declared intent.
- **There is no `assertNoSecrets` audit walker.** The reference's kernel
  walked every audit bag for hash-shaped values; here the no-secret rule
  is held by `SetReaderCredentialsTest`'s row assertions only. If a later
  phase adds an audit helper, port the walker there.
- **The reader-detail edit form does not offer parish-unit placement.**
  OPS §4.3's UpdateReaderProfile inputs are person fields only; placement
  is set at registration (on-behalf form) and by Phase 3's
  ApproveProfileChange (which carries the two unit ids for exactly this).
  If the product owner wants direct placement editing, it is a two-field
  addition to `UpdateReaderProfileRequest` + `ParishUnitFields` on the
  form — but it would need its own OPS entry, since no command currently
  sanctions it.
- **The concurrency variants of the reference's tests did not port**
  (two-connection probes cannot see `RefreshDatabase` fixtures — 1a
  divergence 2's reasoning). The mechanism is pinned instead: every
  lifecycle command's first statement is `lockForUpdate()` on the
  membership row (divergence 1), and `ReaderQueriesTest` pins the roster's
  ORDER BY clause because the UUIDv7 id tiebreak cannot be falsified by
  data seeded in creation order.
- **`currentLoans` ties on `(due_on, id)` where the reference ties on
  `(due_on, copy_code)`** — `app/Queries/ReaderDetailQuery.php:75`. A
  spec-vs-reference drift flagged during Task 12's review and deliberately
  left as-is rather than guessed at; untested either way, since no fixture
  puts two loans on the same due date. If a manager ever reports the
  "which book is due first" ordering on the reader detail page looking
  wrong when two loans tie on `due_on`, this is where to look.
- **Real trigram similarity pads per WORD, not once over the whole
  string** — verified by standing up a real PostgreSQL 16.14 with `pg_trgm`
  1.6 and calling `show_trgm()` directly (`app/Support/Members/
  NameSimilarity.php`'s docblock has the full transcript). A reviewer
  derived the opposite by hand mid-phase — reasoning that real `pg_trgm`
  pads the whole string once, making `similarity()` order-SENSITIVE — and
  a "fix" along those lines nearly shipped on that theory; the extension's
  actual, measured behaviour is order-INVARIANT for two strings built from
  the same multiset of words (`similarity('tran van an', 'an van tran')`
  measures **1.0** live, not the ~0.4 the whole-string theory predicts). A
  19,898-pair property sweep against the live extension found zero
  threshold flips and zero numeric disagreements beyond float32/float64
  rounding. **The threshold is 0.6.** The `0.714` that reached the plan
  document is a worked example in the reference's comment above the real
  predicate (`similarity(tran minh, tran minh duc) -> 0.714`), not the
  parameter — both numbers are recorded here because both were repeated
  confidently by more than one party before the source was actually read.
- **Three inert assertion shapes, all caught on the same class of
  anti-enumeration/privacy property, across three different test files**
  (`tests/Feature/Members/ReaderQueriesTest.php`,
  `tests/Feature/Members/ManageReaderScreensTest.php`,
  `tests/Feature/Members/PendingRegistrationsQueryTest.php` all carry the
  same docblock warning verbatim): (1) `expect($row)->not->toHaveKeys([$a,
  $b, $c])` means "has ALL of these keys" negated, so it is satisfied the
  moment even ONE of several forbidden keys is absent — a leaked field
  beside an absent one still passes; (2) `not->toHaveKey($key, "message")`
  puts the string in `toHaveKey`'s `$value` parameter, not `$message` —
  Pest's `not` then catches the resulting exception (from either the
  missing-key check or the value-mismatch check) and treats it as the
  negation succeeding, so the assertion passes UNCONDITIONALLY regardless
  of what leaked; (3) in Task 13's public-registration status-oracle test,
  an early draft gave all three status fixtures (pending/active/suspended)
  the identical identity triple, so the query's unordered `->first()`
  lookup silently collapsed all three iterations onto ONE row, and would
  have masked a mutation leaking the real status. The rule the fixes
  converged on: prove an absence by checking `array_key_exists()` per key,
  one key per assertion, and give every fixture row seeded for a
  same-shape sweep a distinct identity.
- **`DB::disableQueryLog()` does not clear the buffer.** Found in Task 9's
  own dispatch: a lock-position test exercising multiple commands
  (`ApproveMembership` then `RejectMembership`) in one method read STALE
  entries left over from the first command's `enableQueryLog()` call, and
  passed regardless of whether the second command's lock was actually
  positioned first — reproduced live by removing the `flushQueryLog()`
  call and re-breaking `RejectMembership`'s lock ordering: the test stayed
  green. `DB::flushQueryLog()` between commands is the fix, and the
  ensuing repo-wide audit (mutating every query-log pin individually,
  Phase 1a's included) found every other lock-position/query-log pin in
  the codebase genuine — this was an isolated risk, not a systemic one,
  because every other such test calls `enableQueryLog()`/`getQueryLog()`
  exactly once per method.
- **UUID v7 primary keys are chronologically monotonic, so an unordered
  scan already returns creation order** — a sort-tiebreak test seeded in
  already-correct order proves nothing, because the untested code path
  (delete the tiebreak) would return the identical sequence by accident.
  This has now fired across both plans in this codebase: Phase 1a's
  `tests/Feature/Catalogue/ReaderQueriesTest.php` (the `SearchQuery` slug
  tiebreak, 11 rows needed before insertion order and slug order actually
  diverge); Phase 1b's `tests/Feature/Members/ReaderQueriesTest.php` (the
  roster's folded-name order, seeded Vũ/Đặng/An — creation order — against
  An/Đặng/Vũ — folded order); and
  `tests/Feature/Members/PendingRegistrationsQueryTest.php` (the queue's
  `created_at, id` order, seeded newest-row-inserted-first specifically so
  physical insertion order cannot coincidentally satisfy the assertion).
  The house rule going forward: a tiebreak test must seed rows in the
  WRONG order and force `created_at`/name collisions explicitly, or it
  guards nothing.
- **Fixtures that collide with seeded randomness, found twice this
  phase.** Corrected in the PR #61 fix round: the super-admin does NOT
  hold two memberships, and the manager/active row belongs to a different
  user entirely — verified live against a fresh seed run.
  `DemoShelfSeeder`'s manager fixture (`:37-40`) is a user named `'Trần
  Minh'` (username `quanly`); its super-admin fixture (`:46-49`) is a
  DIFFERENT user named `'Nguyễn Văn Bình'` (username `admin`). The trap is
  in the five-person demo-readers loop (`:92-104`), which looks up each
  person by `full_name` alone before deciding whether to create one:
  `:93` reuses `'Trần Minh'` — already seeded as the MANAGER at `:39` — so
  the loop's `User::where('full_name', ...)` finds that row instead of
  creating a new reader, and the following `Membership::firstOrCreate`
  keyed on `(shelf, user)` then matches the manager's own membership row
  exactly, adding nothing — the shelf ends up with **four** reader
  memberships, not five. Separately, `:95` reuses `'Nguyễn Văn Bình'` —
  already seeded as the SUPER ADMIN at `:48` — so that iteration's lookup
  resolves to the super-admin's user row, and this time
  `Membership::firstOrCreate` finds no existing row for that
  (shelf, user) pair (the super-admin fixture never created one) and
  inserts a real `role: reader, status: pending` membership. That is the
  entire mechanism: the super-admin ends up holding exactly one
  membership, a pending reader row, purely because its name was reused
  three lines below its own creation — not because of any manager/active
  row it never held. A test or fixture written against "the super-admin
  holds two memberships" or "the manager and super-admin share one" would
  be wrong on both counts. Separately, `UserFactory`'s default five-name
  pool contains `'Trần Minh'` verbatim (accented, matching
  `DemoShelfSeeder`'s own spelling — not the unaccented `'Tran Minh'` an
  earlier draft of this entry said), which collided with Task 14's
  deliberately-crafted similar-name fixture in the pending registrations
  queue tests until the manager's name was pinned explicitly. Both are the
  same shape of trap: a factory default or seeded fixture silently
  supplying a value a later test's fixture also uses literally.
- **The plan's own "second shelf" fixture template trips
  `BelongsToBookshelf`'s creating-hook guard.** Instantiating a second
  `Bookshelf`/tenant-scoped model directly in a test, the way the brief's
  own boilerplate does, fails against `app/Models/Concerns/
  BelongsToBookshelf.php:73`'s guard unless the fixture is built under
  `TenantContext::actSystemWide()` — the same pattern
  `RegisterMembershipTest` already used. Hit identically in Tasks 6 and 7
  in this phase (the second occurrence after the first was already fixed
  and known), which is itself the lesson: recording a trap once is not the
  same as every downstream task having read it.
- **Errno 1170 is folklore on this build, not a reproduced refusal.** The
  `(191)` prefix on `users.full_name_folded`'s index
  (`database/migrations/2026_08_28_000001_add_users_full_name_folded.php`)
  matches `books_public`'s convention, but MariaDB 10.11.19 does NOT throw
  errno 1170 on an unlengthed index over a `TEXT` column — verified live by
  running the unlengthed `ALTER TABLE` directly: it succeeds, MariaDB
  silently applying an implicit 768-character prefix (`innodb_large_prefix`
  is unconditionally on for this build and is not even a settable
  variable). No migration in this codebase, including Phase 0's, actually
  reproduced 1170; the `(191)` prefix is worth keeping as an explicit,
  intentional, four-times-smaller choice than the 768-byte fallback — but
  as a convention, not a workaround for a refusal that was never observed.
- **PII and credentials in logs: an unmapped `QueryException` inlines its
  bound parameters.** Both instances of this gap are recorded and both
  are cross-referenced from the offending files' own comments:
  `app/Actions/Members/Registration.php` ("Task 6, fix round" above) can
  log a child's full name, date of birth, parents' names and phone;
  `app/Actions/Members/SetReaderCredentials.php` ("Task 9, fix round"
  above) is strictly worse — it can log a freshly generated **password
  hash**. Both confirmed against the vendored framework source
  (`QueryException::formatMessage()` defaults `maskBindings` to `false`)
  and against `bootstrap/app.php`, which registers `withExceptions()` with
  no redaction hook of any kind — nothing between the driver and the log
  file strips a bound value on either path. Not fixed per-command,
  deliberately: the correct fix is one app-wide redaction mechanism, not a
  second one-off patch leaving every other Action with the identical hole
  while looking addressed.

  **PR #61 fix round, Task 2:** the `Registration.php` instance's
  REACHABILITY, not the redaction gap itself, is fixed. This entry used to
  frame it as hypothetical ("Task 6, fix round" above still calls out that
  no known caller supplies an unmapped errno); it was not — an
  unauthenticated `curl` against `POST /register` with
  `saint_name=\xC3\x28` (or the same in `full_name`/`father_name`/
  `mother_name`) reached `Registration::createPerson()`'s INSERT, tripped
  MariaDB errno 1366 (invalid UTF-8 for the column's `utf8mb4` charset),
  unmapped by `UniqueViolation::translate()`, and 500'd while logging the
  child's date of birth, both parents' names and phone — reproduced live
  and confirmed in `storage/logs/laravel.log`. Fixed by adding an
  `encoding:UTF-8` rule to the four name fields on
  `RegisterMembershipRequest`, `RegisterReaderOnBehalfRequest` and
  `UpdateReaderProfileRequest` (all three feed the same columns) —
  `mb_check_encoding()` never throws, so invalid UTF-8 now fails cleanly as
  a `ValidationException` before any query runs. Reassessed: the
  app-wide-redaction deferral above is still the right call for the
  REDACTION gap in general (a second one-off patch there would leave every
  other Action's identical hole looking addressed when it is not) — but
  this specific route no longer NEEDS that mechanism to stop leaking PII,
  because the byte sequence that used to reach the unmapped exception
  handler is refused earlier now. The deferred redaction gap remains real
  for every other Action that can still reach an unmapped `QueryException`
  with sensitive bindings (`SetReaderCredentials.php` among them) — this
  fix narrows the set of inputs that can trigger it on this one route, it
  does not replace the general fix.
- **Control characters and bidi overrides pass into `full_name` (and every
  other free-text field) and are stored verbatim.**
  `RegisterMembershipRequest::rules()` ("Task 13, fix round" above) accepts
  NUL bytes, control characters and the RTL-override mark U+202E —
  `'string', 'max:255'` checks length and PHP type only. (A LEADING or
  trailing BOM is not among them — see the correction on the "Task 13, fix
  round" entry above; a global `TrimStrings` middleware strips it via
  `Str::INVISIBLE_CHARACTERS`, verified live. A mid-string BOM is
  unaffected by that and is stored verbatim like the other four.) These
  reach the manager's approval queue (`GetPendingRegistrations`) and
  any future export unfiltered: a name containing U+202E can visually
  reverse everything after it in a manager's UI. Not fixed in this round —
  the correct fix is a shared sanitisation step every free-text write path
  applies identically (`ProfileFields::normalisePatch()` and
  `Registration::register()` included), left for whichever task does the
  phase's input-sanitisation sweep.
- **PR #61 fix round, Task 1: a validation rule added to close one hole
  opened another on the same route.** `RegisterMembershipRequest`'s
  `date_of_birth` rule gained `before_or_equal:today`/
  `after_or_equal:1900-01-01` in the Task 13 fix round to refuse a
  9999-born reader. Both rules delegate to
  `Illuminate\Validation\Concerns\ValidatesAttributes::
  getDateTimeWithOptionalFormat()`, which calls
  `DateTime::createFromFormat()` with NO `try`/`catch` around it — unlike
  `validateDateFormat()` (the `date_format` rule itself), which explicitly
  catches `ValueError`. Laravel runs every rule for an attribute
  regardless of an earlier failure unless told to stop, so a
  `date_of_birth` containing a NUL byte failed `date_format` and then
  still reached `before_or_equal`, which threw an uncaught `ValueError`
  and 500'd `POST /register` — reproduced live with
  `date_of_birth=09123\x0045678`, confirmed by deleting the two bound
  rules and getting a clean `ValidationException` instead. Fixed by
  adding `bail` to the front of `date_of_birth`'s rule list, so a value
  that fails `date_format` never reaches the bound checks. The general
  lesson, swept across every field on this route and the phase's other
  Form Requests with hostile values (NUL bytes, invalid UTF-8, control
  characters): any validation rule that parses raw input via a
  driver/stdlib call can throw on bytes the rule was never written to
  expect, and per-task review will not catch it when the throwing rule and
  the rule it depends on were added in different commits.
- **PR #61 fix round, Task 3: the public re-application walk-back used to
  erase the manager's rejection/suspension reason.**
  `Registration::upsertMembership()`'s walk-back branch (any `rejected`/
  `left` row re-applying via `POST /register`) unconditionally set
  `rejection_reason` and `suspension_reason` to `null` alongside flipping
  `status` back to `pending`. BR §2 sanctions the re-application itself,
  and the product owner separately accepted that
  `already_registered_here` vs. a silent success is an existence oracle
  distinguishing `{pending, active, suspended}` from `{left, rejected}` —
  but neither sanctions an unauthenticated stranger who knows a child's
  name/date of birth/phone permanently destroying the manager's recorded
  reason for the last refusal in the same request. The reference
  (`old_next/src/domain/members/registration.ts`) does the identical
  unconditional null-out — this is a deliberate departure from the
  reference, not a port of a fix it already had, because the reference
  never addressed this case either. Fixed by leaving both columns out of
  the walk-back `update()` call, so whichever one is set survives; nothing
  else in the state graph writes `pending` onto a row that already carries
  a non-null reason from an inconsistent place (`rejected` requires
  `rejection_reason` via `memberships_rejected_has_reason`, and
  `suspended → left → pending` can carry a stale `suspension_reason` the
  same way). The reader detail screen already renders both fields
  whenever non-null regardless of current status, so this now reads
  correctly as "the last refusal on file" next to the current `pending`
  status badge, rather than silently vanishing. Verified live over real
  HTTP: rejected a demo applicant with a reason via `tinker`, re-submitted
  the identical public form, and confirmed both the status flip to
  `pending` and the surviving `rejection_reason` in the database
  afterwards. The oracle this does NOT remove, recorded rather than
  hidden: `already_registered_here` still distinguishes
  `{pending, active, suspended}` from `{left, rejected}` to anyone who
  submits the exact triple, because BR §2 requires re-application to stay
  possible for both — that asymmetry is a known, accepted trade, not an
  oversight.
- **PR #61 fix round, Task 4: six `FormRequest::authorize()` methods would
  403, not 404, if middleware ordering ever changed.**
  `RegisterReaderOnBehalfRequest`, `RejectMembershipRequest`,
  `SetReaderCredentialsRequest`, `SuspendMembershipRequest` and
  `UpdateReaderProfileRequest` (five, not six as first reported — the
  sixth Members Form Request, `RegisterMembershipRequest`, always returns
  `true` and is not part of this pattern) returned the bare `bool` from
  `Gate::allows(...)`, which Laravel's default
  `FormRequest::failedAuthorization()` renders as a 403. Every route that
  reaches these is `role:manager`-gated, and `EnsureShelfRole` 404s a
  non-manager before any controller or Form Request runs — its own
  docblock names the exact 403-vs-404 hazard BR §5.4's anti-enumeration
  rule cares about — so today these branches are provably unreachable
  (`MembershipPolicy`'s methods are all literally `act-as-manager`, the
  identical check the middleware already made). Fixed anyway, as a
  backstop against a future middleware-ordering change: each now calls
  `abort_unless(..., 404)` directly rather than returning the gate's bool.
  Pinned by `tests/Feature/Members/FormRequestAuthorize404Test.php`, which
  instantiates each Form Request directly (bypassing routing entirely,
  since the failing branch cannot be reached over HTTP today) and asserts
  a denied `authorize()` throws `NotFoundHttpException`, not the default
  `AuthorizationException`.
- **Phase 1c, Task 5 fix round: a suspended reader cannot renew a loan
  already in their hands.**
  BR/OPS §4.2's open question ("Q4") asked whether INV-4 (suspension
  blocks new loans, existing ones survive) should still let a suspended
  reader renew. This phase's answer, 2026-08-29: no — a suspended reader
  cannot renew, matching the reference, and closing the question rather
  than leaving it open. `App\Http\Middleware\ResolveTenant::handle()`
  (`app/Http/Middleware/ResolveTenant.php:67`) is the ONLY place a
  membership is ever resolved into `TenantContext`, and its query is
  filtered `->where('status', Active)` — so a suspended reader's
  `TenantContext::membership()` is null on every real route, renew
  included, and `App\Policies\LoanPolicy::renew()`'s `act-as-reader`
  delegation (`Gate::forUser($actor)->authorize('renew', $loan)` in
  `App\Actions\Circulation\RenewLoan::execute`) refuses before the
  action's own logic ever runs. The reference is not authority for the
  other reading either: `requireReader`
  (`old_next/src/domain/catalogue/policy.ts:269`) never reads membership
  status, but only because the reference applies that filter one layer
  up, in `membershipFor` (`old_next/src/auth/guards.ts:56-65`) —
  `and m.status = 'active'`, with the comment "A suspended member is not
  a reader of this shelf, though their existing loans survive (INV-4)."
  `ResolveTenant`'s filter is the faithful port of that exact line, so
  the "allowed" reading is equally unreachable in the reference itself.
  Delivering the "allowed" reading here for real would mean changing how
  suspension resolves for EVERY reader route (not adding a carve-out
  inside `RenewLoan` alone), since `ResolveTenant` is the single
  membership-resolution point every reader ability shares — a change out
  of scope for this task. Pinned by
  `tests/Feature/Circulation/RenewLoanTest.php`'s "Q4" test, which
  exercises the real refusal (an `AuthorizationException` from the
  `act-as-reader` gate, via a fixture that mirrors `ResolveTenant`'s own
  status filter rather than binding a suspended membership straight into
  `TenantContext`, a shape no controller produces).
- **Phase 1c, Task 12 carry-over: `CopyNoteRequest`'s `note` reached the
  database as invalid UTF-8 and 500'd — the fourth confirmed occurrence of
  the class of bug PR #61 first named.** Task 11's reviewer proved by
  execution that a manager posting invalid UTF-8 to
  `shelves.manage.copies.report-lost` got a real HTTP 500:
  `app/Http/Requests/Catalogue/CopyNoteRequest.php` validated `note` as
  `['nullable', 'string', 'max:1000']` — no `encoding:UTF-8` — so the value
  reached `ReportCopyLost`/`MarkCopyFound`'s write to `book_copies` (a
  utf8mb4 column), tripped MariaDB errno 1366, unmapped, and crashed a
  legitimate workflow reachable from both Task 11's new lost screen and the
  pre-existing catalogue UI. Fixed by adding `bail` + `encoding:UTF-8`, the
  identical shape `ReceiveReturnRequest` (Task 11) and the new
  `VoidLoanRequest` (Task 12) already carry. Reproduced live and proved by
  `tests/Feature/Catalogue/CatalogueHostileInputTest.php`'s first test
  (500 before the fix, `assertSessionHasErrors('note')` after).

  **The sweep, not just the instance:** every Form Request under
  `app/Http/Requests/` was read and every free-text field inventoried.
  Four more live, reachable instances of the identical class turned up and
  were fixed the same way — `AssessConditionRequest::note`,
  `RetireCopyRequest::reason`, `StoreBookRequest`/`UpdateBookRequest`'s
  `title`/`author`/`publisher`/`isbn`/`description`/`language`,
  `AddCopiesRequest::donor_name`, `RejectMembershipRequest::reason`,
  `SuspendMembershipRequest::reason` (this is "the void reason predicted
  by Task 6's review" the Task 12 brief named), `SetReaderCredentialsRequest
  ::username`, `RegisterMembershipRequest::username`/`phone_missing_reason`,
  `RegisterReaderOnBehalfRequest::phone_missing_reason` and
  `UpdateReaderProfileRequest::phone_missing_reason` — thirteen fields
  across nine files, each confirmed to write straight to a utf8mb4 column
  with no encoding check by reading its Action's write path (not assumed).
  Fields left WITHOUT the rule, and why each is safe without it: `phone`
  everywhere (gated by `Phone::assert()`'s strict `\d{9,11}` regex before
  any write), `category_slug` (a `Category::query()->where('slug', ...)`
  lookup only — proved live that a WHERE bind on invalid UTF-8 returns no
  match rather than throwing on this column, so an unmatched slug refuses
  as `category_not_found` before any write. **Fix round correction: this
  is collation-dependent, not a general truth about WHERE binds.**
  `categories.slug` and `users.username` are `utf8mb4`, the same charset
  family PDO sends the bind as, so MariaDB just compares bytes and finds
  no match. A column declared `ascii_bin` — `memberships.id`, and every
  other id/role/status column in this schema — throws instead: MariaDB
  refuses to compare `ascii_bin` against an incoming `utf8mb4_unicode_ci`
  bind at all, with errno 1267 ("Illegal mix of collations"), regardless
  of whether the bytes would have matched. This was proved the hard way:
  `StoreBookRequest`/`AddCopiesRequest`'s `donor_membership_id` ran
  exactly this WHERE-lookup shape against `memberships.id` (`ascii_bin`)
  with no `bail` ahead of the `uuid` format check, and invalid UTF-8 that
  failed `uuid` still reached the lookup and 500'd live — the fifth
  confirmed occurrence of the class of bug this section otherwise
  describes, fixed by adding `bail` (see
  `tests/Feature/Catalogue/CatalogueHostileInputTest.php`). The correct
  rule: a WHERE bind on invalid UTF-8 is safe-by-refusal only against a
  column whose collation is in the same charset family as the bind
  (utf8mb4-family columns here); against an ascii-family column it throws
  just as a write would, and that path needs the identical `bail` /
  `encoding:UTF-8` discipline as a write path, not a free pass because
  it is "only a lookup".) `shelf` on the public register
  form (the identical WHERE-only shape, also a utf8mb4 column), `parish_unit_l1_id`/
  `parish_unit_l2_id` (validated by `ParishUnits::validateSelection()`
  against a Collection already loaded into PHP memory — a string compare,
  not a DB bind), `QuickLendRegisterReaderRequest::book` (a lookup key
  stripped via `Arr::except()` before the domain write ever sees it),
  `password` fields (hashed via `Hash::make()`, never stored raw), `uuid`-
  and `email`-format fields (their own charset guards), and
  `ReceiveReturnRequest::condition`/`AssessConditionRequest::condition`
  (`Rule::enum(...)`, which already rejects anything but a fixed ASCII
  set). `date_of_birth` on `UpdateReaderProfileRequest` is exempt too —
  `ProfileFields::normalisePatch()` regex-validates the `Y-m-d` shape
  before storage.

  **Pinned by a class-level gate, not per-instance smoke tests:**
  `tests/Feature/Architecture/FreeTextEncodingGuardTest.php` scans every
  class under `app/Http/Requests/`, calls its `rules()`, and requires
  `encoding:UTF-8` on every field whose ruleset contains the bare `string`
  rule UNLESS the field is named in that test's own documented exemption
  list (the same reasons as above, written once and checked for
  staleness by its own second test). Mutation-proved twice: reverting
  `RetireCopyRequest::reason`'s fix turned the gate red, by name,
  restored to green; a scaffolded sixth Form Request with an unguarded
  `note` field (`FakeFifthOccurrenceRequest`, deleted immediately after)
  also turned it red, by name — proving a future occurrence fails this
  gate without anyone having to rediscover the class of bug by hand.

  **One adjacent, DIFFERENT class of gap found during the same file-by-
  file read, left unfixed as out of this task's scope:** five Catalogue
  Form Requests — `AddCopiesRequest`, `AssessConditionRequest`,
  `RetireCopyRequest`, `StoreBookRequest`, `UpdateBookRequest` — still
  return the bare `bool` from `Gate::allows(...)`/`$model instanceof X &&
  Gate::allows(...)` in `authorize()`, which Laravel's default
  `failedAuthorization()` renders as a 403, not a 404 — the exact
  BR §5.4 anti-enumeration hazard "PR #61 fix round, Task 4" (see above)
  already fixed on the five Members Form Requests by switching to
  `abort_unless(..., 404)`. Every route reaching these five sits inside
  `['auth', 'role:manager']` (`routes/web.php`), so — identically to the
  Members case — `EnsureShelfRole` 404s a non-manager before any of these
  ever runs, making the branch provably unreachable over HTTP today; this
  is a backstop-only gap against a future middleware-ordering change, not
  a live hole. Not fixed here because it is a different class of bug from
  the free-text encoding sweep this task's carry-over was scoped to (an
  authorization-response-code shape, not a validation-guard shape), and
  fixing five files' `authorize()` methods was not exercised by any
  red/green mutation run in this task. Left for whichever task next
  touches these five files, or a dedicated backstop sweep mirroring PR
  #61 Task 4's own — the fix shape (`abort_unless(Gate::allows(...), 404)`)
  is already established and copy-pasteable.

- **Fix round: `encoding:UTF-8` guards byte VALIDITY, not byte
  CONTENT — the framing that it keeps "hostile bytes" out of the database
  overstates what the rule buys.** `encoding:UTF-8` is `mb_check_encoding($value,
  'UTF-8')`, which answers exactly one question — is this a well-formed
  UTF-8 byte sequence — and NUL (`\x00`) and the other C0 control bytes
  are all well-formed single-byte UTF-8 code points, so the rule accepts
  them. Proved live:
  `Validator::make(['reason' => "khoa \x00 \x01 that"], ['reason' =>
  ['bail','required','string','max:1000','encoding:UTF-8']])->fails()`
  returns `false`. In practice this means a manager can void a loan with
  a NUL byte embedded in `loans.void_reason`, or create a book whose
  title carries control characters, and every guard this fix round added
  or hardened waves it through — not a 500 (MariaDB's utf8mb4 columns
  store NUL/control bytes without complaint) and not a member of the
  class of bug this task swept (an unmapped `QueryException`), just
  content the UI and any future export never expected to render.
  **Decision: not given its own guard in this fix round.** Two reasons.
  First, scope: this task's brief was the encoding-validity class of bug
  and the gate that catches it, not general free-text sanitisation —
  the entry above (Task 1c, control characters/RTL override chars: "left
  for whichever task does the phase's input-sanitisation sweep") already
  named the correct home for this, a single shared sanitisation step
  every free-text write path applies identically, not a second one-off
  rule bolted onto `encoding:UTF-8`'s exemption table. Second, severity:
  nothing observed renders these bytes unsafely today (no raw HTML
  output of free-text fields found in this sweep), so this is a
  data-hygiene concern, not a live injection or crash vector. Recorded
  here, not silently accepted, so whoever does that sanitisation sweep
  has this as a confirmed, reproduced input rather than a rediscovery.

## Phase 1c — Circulation

The durable record of `docs/superpowers/plans/2026-08-29-laravel-phase-1c-circulation.md`
(lending, returns, renewal, voiding, overdue, the reader's own loan
pages). Written by Task 14 after the full suite ran green.

- **The OPS §4.2/§4.3 walk, verified against the shipped branch, not
  read off the plan document:**

  | Entry | Disposition |
  |---|---|
  | `LendCopy` | shipped (Task 3), both entry points (dashboard flow + book detail); §4.2's failure-mode list amended in Task 1 with `title_has_no_copies` |
  | `HandoverRequest` | Phase 2 (holds); route absence pinned (`CirculationArchitectureTest`) |
  | `ReceiveReturn` | shipped narrowed (Task 4); hold branch Phase 2 |
  | `RenewLoan` | shipped (Task 5); Q4 = renewal is status-gated, closed and pinned by name |
  | `VoidLoan` | shipped (Task 6) + a button OPS never specified |
  | `CreateBorrowRequest` / `ApproveBorrowRequest` / `RejectBorrowRequest` / `CancelOwnRequest` | Phase 2 |
  | `SkipRequest` | Phase 2 — and no reference implementation exists to port |
  | `SearchBooksForLending`, `SearchReadersForLending`, `SearchLoansForReturn`, `GetOverdueLoans`, `GetMyDashboard` (loans half), `GetMyLoanHistory` | shipped |
  | `GetBorrowRequestQueue` | Phase 2 |
  | `GetManagerDashboard`, `ExportLoansCSV` | 1d |
  | `ResolveCopyById` | Phase 2 |
  | `ManagerRegisterReader` (§4.3) | Action shipped in 1b, surface shipped here — closes 1b's last "implemented, reachable from nowhere" entry (see below) |

  Every code path above was walked by opening the named file, not
  inferred from the table cell — `RenewLoan`'s Q4 disposition and
  `ReceiveReturn`'s narrowing are each their own entry below with the
  file and line evidence.

- **`ReceiveReturn`'s contract is deliberately narrower than the
  reference, and Phase 2 must restore four things in one pass.**
  `app/Actions/Circulation/ReceiveReturn.php`'s own docblock names the
  gap: no `holdForRequestId` parameter, no `queuedRequestId` return
  value, no `request.approved` second audit row, no notification. The
  reference (`old_next/src/domain/circulation/commands/
  receive-return.ts`) does all four inside the SAME transaction as the
  return itself: it resolves a hold via `holdForRequestId`, stamps
  `hold_expires_at` from the injected clock (not a bare `now()`) when
  approving one, writes a `request.approved` audit row alongside
  `loan.returned`, and — separately — always computes `queuedRequestId`
  by reading the pending-request queue in `requested_at asc, id asc`
  order AFTER every write in the transaction has landed, so the answer
  reflects the state the return itself just produced. None of this is
  reachable in 1c (nothing creates a `BorrowRequest` outside the seed
  data), so nothing tests it either — Phase 2 re-widens the signature
  to the reference's exact shape when holds exist, not before.
- **`LendCopy`'s hold-collection branch is unported, and the predicate
  it depends on is already live and waiting.** The reference closes a
  collected hold inside the SAME transaction as the lend
  (`request.fulfilled`, `old_next/src/domain/circulation/commands/
  lend-copy.ts:220`); this port's `LendCopy::execute` always passes
  `null` for `$heldForUserId` (`app/Actions/Circulation/LendCopy.php`'s
  class docblock says so explicitly). `LoanRules::copyLendable`'s
  held-for-me clause (`$state === CopyState::Held && $heldForUserId ===
  $forUserId`, `app/Support/Circulation/LoanRules.php:54`) is already
  unit-tested and correct — Phase 2 only has to wire the real holder
  through and add the collected-hold close, not invent the predicate.
- **INV-5's guarantee is a membership-row lock, not an index — stronger
  than the reference, but bypassable outside `LendCopy`.**
  `app/Actions/Circulation/LendCopy.php:75` locks the reader's
  `Membership` row as the SECOND statement in the transaction (copy
  first, per the lock-order entry below), so a rival lend for the same
  reader waits behind that lock before counting active loans — the
  reference has no such serialisation and its own count can race past
  the limit (plan divergence 3). The only INDEX-backed circulation
  invariant remains INV-1 (`loans_one_active_per_copy`,
  `2026_08_26_000007_create_loans_table.php:76-81`); a future caller
  that mutates `loans`/`memberships` without going through `LendCopy`
  bypasses INV-5 entirely, because nothing in the schema enforces it.
- **`RenewLoan`'s queue check has no structural backstop.**
  `app/Actions/Circulation/RenewLoan.php:70` takes exactly ONE lock (the
  loan row) and then runs a plain, unlocked
  `BorrowRequest::query()->where('book_id', ...)->where('status',
  Pending)->exists()` — a request for the same title committing between
  that read and the renewal's own commit is invisible to it. Unreachable
  in 1c (nothing creates a `BorrowRequest` outside seed data, so nothing
  can race this check); Phase 2 decides whether the queue check needs a
  lock once requests are live.
- **The `ReceiveReturn` / `ReportCopyLost` / `VoidLoan` lock order
  (copy, then loan) is a convention every command's source enforces by
  hand, not a database-level guarantee.** Verified by reading each
  file's first two statements: `ReceiveReturn.php:57-59`,
  `VoidLoan.php:56-57` both lock `BookCopy` before `Loan`;
  `LendCopy.php:73-75` locks `BookCopy` before `Membership` (a
  different second party, same "copy first" rule). Nothing in the
  schema stops a future circulation command from taking the loan lock
  first — it would simply re-open the AB-BA deadlock this phase closed
  (Task 4's divergence 2, reproduced with two real OS processes, not
  simulated). Any new circulation write must follow copy-first or prove
  its own ordering is deadlock-free.
- **The implicit FK shared locks, and the shelf-row contention they
  create, are real and unavoidable with today's schema.** Every
  circulation command's audit insert takes a shared lock on the
  shelf's own `bookshelves` row (MySQL/MariaDB InnoDB locks the parent
  row of a `RESTRICT`-on-delete foreign key on every child insert);
  `LendCopy`'s own loan insert additionally takes shared locks on
  `bookshelves`/`books`/`book_copies`/`users` through their own foreign
  keys. Separately, `AllocateCopyCodes` — 1a's copy-numbering
  allocator, still used by `CreateBook`/`AddCopies` — takes an
  EXCLUSIVE lock on that same `bookshelves` row for the whole of its
  transaction (`app/Actions/Catalogue/AllocateCopyCodes.php:80-83`,
  `DB::table('bookshelves')->where('id', $bookshelfId)
  ->lockForUpdate()`), confirmed by reading the file directly. Between
  the FOUR CIRCULATION commands (`LendCopy`, `ReceiveReturn`,
  `RenewLoan`, `VoidLoan`) and `AllocateCopyCodes`, the wait really is
  one-directional — a circulation command never takes an exclusive lock
  `AllocateCopyCodes` would need — so a slow lend, return, renewal or
  void never deadlocks against a bulk copy-add on the same shelf; it
  only ever waits behind it (BR §2's plain error stays about the unique
  index, not this lock).
  **CORRECTED (whole-branch review, PR #62): that sentence used to read
  as a system-wide guarantee ("no deadlock cycle exists ... never the
  reverse"). It does not hold system-wide — it holds only for the four
  circulation commands above, and one PHASE 1B EDGE reopens the exact
  reverse this note used to rule out.** `audit_log.actor_id` is a
  single-column FK straight to `users.id`
  (`2026_08_26_000015_create_audit_log_table.php:28`), so EVERY audit
  insert also takes a shared lock on the ACTING user's own `users` row —
  a second FK edge this note did not name, independent of the
  `bookshelves` one above. `UpdateReaderProfile.php:69` and
  `SetReaderCredentials.php:59` each take an EXCLUSIVE lock
  (`lockForUpdate()`) on the SUBJECT reader's `users` row before their
  own audit insert runs. The reverse edge exists the moment that same
  person is, in a concurrent transaction, the ACTOR of a command that
  already holds `bookshelves` X and then wants that person's `users` S —
  exactly `AllocateCopyCodes`/`AddCopies`, run by a manager adding
  copies to their own shelf while a super admin corrects that same
  manager's profile:
  - T1 (`UpdateReaderProfile`/`SetReaderCredentials`): X `memberships` →
    X `users` (the manager being corrected) → audit insert → wants
    S `bookshelves` (the audit row's `bookshelf_id` FK).
  - T2 (`AllocateCopyCodes` inside `AddCopies`, run BY that manager):
    X `bookshelves` → ... → audit insert naming that manager as
    `actor_id` → wants S `users` (the same row T1 already holds X on).
  **Reproduced, not asserted: two real OS processes (`pcntl_fork()`,
  one PDO connection each against the real `mariadb` container),
  replaying exactly these two lock sequences with a deliberate
  interleaving delay, produced a genuine `SQLSTATE[40001]: ... 1213
  Deadlock found when trying to get lock; try restarting transaction`
  — InnoDB's own detector, not a simulation.** This is a Phase 1a
  (`AllocateCopyCodes`) × Phase 1b (`UpdateReaderProfile`,
  `SetReaderCredentials`) cycle, not something Phase 1c introduced, but
  it sat behind a sentence THIS phase's own document had written as a
  system-wide guarantee — corrected here so Phase 2 does not build the
  borrow-request commands trusting a claim already false today. **What a
  future author must check before adding any new write path that (a)
  exclusive-locks a `users` row before its own audit insert, or (b)
  holds an exclusive lock across an audit insert naming a DIFFERENT
  actor than the row already locked: does the acting user of your new
  command's audit insert ever coincide with a row some OTHER in-flight
  command might already hold exclusively (or vice versa)?** Only a
  matching row on both sides creates the cycle — an unrelated actor
  never collides — but "the actor happens to be the same person as the
  subject of a concurrent unrelated write" is exactly the shape that
  looks impossible until named, which is what happened here.
  Recorded so Phase 2 does not rediscover it by a slow lend during a
  large `AddCopies` call, and so a future command that reverses the
  direction (locks `bookshelves` X, then waits on something circulation
  already holds S on) is recognised as the cycle it would create.
- **The near-miss that makes the OBVIOUS `book_copies` ↔ `memberships`
  cycle not exist, recorded because it is design luck, not a guarantee
  — verified live, not assumed.** `book_copies.acquired_from_membership_id`
  is a donated copy's donor, and `book_copies_acquired_from_membership_fk`
  is a COMPOSITE foreign key, `(bookshelf_id,
  acquired_from_membership_id)` → `memberships (bookshelf_id, id)`
  (`2026_08_26_000019_add_composite_tenant_fks.php:19,30`) — pointing at
  the SECONDARY unique index `memberships_bookshelf_id_id_key`, not the
  primary key. `LendCopy.php:74`'s `Membership::query()->lockForUpdate()
  ->findOrFail($membership->id)` looks the row up by `id` alone, which
  InnoDB serves from the CLUSTERED (primary-key) record. A composite-FK
  insert on `book_copies` naming that same membership as its donor takes
  its shared lock via the secondary index record instead — a different
  physical lock than the one `LendCopy`'s exclusive lock holds, on the
  same logical row. The two simply never contend, not because a rule
  forbids it but because MariaDB happens to lock a unique secondary
  index and a clustered primary key as separate structures. Worth
  naming for the same reason as the corrected entry above: a future
  schema change that pointed a new FK at `memberships`'s PRIMARY KEY
  instead of the secondary `(bookshelf_id, id)` unique — a plausible
  simplification, since the two are trivially equivalent VALUES — would
  turn this near-miss into a real collision with `LendCopy`'s lock,
  silently, with no test in this suite positioned to notice until it
  deadlocks under real concurrent load.
- **Step 1's block flag is hold-aware; `ChooseCopy` is not — a Phase 2
  landmine, not a bug today.** `SearchBooksForLendingQuery` derives its
  `blocked` flag from `CountsCopies::borrowable()`, which excludes an
  `available` copy carrying an unexpired approved hold from the
  available count; `ChooseCopy::lowestLendable` picks the lowest-coded
  copy by `book_copies.state` alone and knows nothing about holds. The
  two agree today only because nothing in 1c can create a hold. The
  moment `ApproveBorrowRequest` exists and flips a copy to `held`, step
  1 (search) and step 3 (confirm) will disagree unless `ApproveBorrowRequest`
  keeps them in sync or `ChooseCopy` is taught the same predicate —
  exactly the failure mode plan divergence 9 exists to flag in advance.
- **The copyless-title refusal is a deliberate, ruled divergence from
  the reference — `title_has_no_copies` replaces `copy_not_available`
  for a title with zero recorded copies.** The reference folds a
  copyless title into the same `copy_not_available` sentence a title
  with only lost/retired copies gets; the product owner ruled that
  false for a shelf where no copy was ever entered (plan settled
  decision 4). Verified: the Vietnamese sentence
  ("Cuốn này chưa có bản sách nào trong tủ.") is asserted directly in
  `tests/Feature/Circulation/LendingQueriesTest.php`'s copyless-title
  test, `docs/OPERATIONS.md` §4.2's `LendCopy` entry carries the code,
  and `SearchBooksForLendingQuery`/`ChooseCopy::lowestLendable` both
  branch on the identical three-way reason
  (recorded-count-zero / none-returnable / otherwise) — change one
  without the other and step 1 and step 3 disagree on a title with no
  copies. Its own census lives in `ChooseCopyTest`
  (`title_has_no_copies` is data returned by a query, never a literal
  `new RuleViolated('title_has_no_copies')`, so
  `RuleViolatedCodesHaveSentencesTest`'s glob correctly does not see
  it — do not add it there). The no-copy-selector divergence from BR
  §16.3 (divergence 9) is unrelated and unchanged.
- **1b's `ManagerRegisterReader` route-absence pin is discharged, not
  deleted.** Confirmed by reading both files directly:
  `app/Actions/Members/ManagerRegisterReader.php:44` registers at
  `MembershipStatus::Active`; `app/Actions/Members/
  RegisterMemberOnBehalf.php:38` registers at `MembershipStatus::Pending`
  — the whole of BR §16.1 (on-behalf, pending, needs approval) versus
  §16.3 (quick-lend escape hatch, active immediately) rides on that one
  parameter. `tests/Feature/Architecture/MembersArchitectureTest.php`
  now pins PRESENCE the same way 1b pinned absence: exactly one
  controller (`LendController`) reaches `ManagerRegisterReader`, and
  `ReaderController` reaches only `RegisterMemberOnBehalf`. 1b's open
  question 1 (whether OPS §4.3's inferred `active` disposition is what
  the product owner actually wants) is still formally open — a live
  surface now depends on the answer, where before it was theoretical.
- **The `VoidLoan` button and all three flash sentences
  (`lend_success_flash`, `return_success_flash`, `renew_success_flash`)
  are authored by this plan, not specified by OPS** — the same
  `member_has_active_loans` precedent 1b recorded for an invented
  sentence. Verified present in `lang/vi/rules.php:62-64` and referenced
  from `LendController::store`, `ReturnController::store` and
  `MyLoansController::renew` respectively.
- **Due-soon/overdue notifications do not exist yet.** Nothing in this
  phase writes a `notifications` row for an approaching or passed due
  date — grepped `app/Actions/Circulation` and found no `Notification::`
  reference anywhere in it. Phase 2's sweep; the overdue SCREEN itself
  (`OverdueLoansQuery` + `OverdueController`) is live, correct, and
  reachable from the manager nav today (BR §8) — only the proactive
  notification is missing, not the read surface.

- **Carry-over from Task 13's review, closed this task: no test proved
  the reader's own-loans READS exclude another reader's loan on the
  SAME shelf, and the fixture shape was the reason.** Every fixture in
  `tests/Feature/Circulation/ReaderDashboardScreenTest.php`,
  `ReaderDashboardHostileInputTest.php` and
  `ReaderDashboardAuthorizationTest.php` seeded exactly one reader with
  one loan per shelf, so a bare `count()`/`total` assertion could not
  distinguish "scoped to THIS borrower" from "scoped to the whole
  shelf" — dropping `MyDashboardQuery`/`MyLoanHistoryQuery`'s
  `where('borrower_id', ...)` and replacing it with a vacuous
  `whereNotNull('borrower_id')` left the entire suite green except for
  two new tests added this task
  (`tests/Feature/Circulation/ReaderDashboardScreenTest.php`, "the
  overview excludes another reader's active loan on the same shelf" and
  "the history excludes another reader's loan on the same shelf"),
  which went red exactly as expected and were restored afterward. (The
  unit-level `MyDashboardQueryTest.php` already carried an equivalent
  two-reader fixture and DID catch this at the query layer — the gap
  was specifically at the HTTP/screen layer, which is what the two new
  tests close.)
- **The fixture-shape sweep found the identical gap one phase earlier,
  fixed here as "cheap": `ReaderDetailQuery`'s `currentLoans` and
  `pendingProfileChange`.** `app/Queries/ReaderDetailQuery.php:72-76`
  filters loans by `where('borrower_id', $person->id)`, and every test
  exercising it in `tests/Feature/Members/ReaderQueriesTest.php` seeded
  exactly one reader with one active loan on the shelf — the same
  fixture-shape gap as above, one phase upstream of it. Two tests added
  ("currentLoans excludes another reader's active loan on the same
  shelf", "pendingProfileChange never picks up another reader's pending
  change on the same shelf"), each proved by mutation (replacing the
  `borrower_id`/`user_id` filter with a vacuous `whereNotNull` turned
  the new test red and nothing else in the file; restored after). The
  rest of this phase's read queries
  (`SearchBooksForLendingQuery`/`SearchReadersForLendingQuery`/
  `SearchLoansForReturnQuery` in `LendingQueriesTest.php`,
  `OverdueLoansQuery` in `OverdueLoansQueryTest.php`) were also walked
  and found already fixture-rich enough to distinguish their scoping —
  multiple readers with different active-loan counts, multiple copies
  in different states, multiple loans across active/returned/lost
  status — so no further fixture changes were made there.

### PR #62 review, fix round

- **The sixth confirmed occurrence of the ascii_bin free-text 500, this
  time one layer outside the Form Request gate the last sweep swept.**
  `ReaderController::index`'s `?unit=` reaches
  `ReadersListQuery::run()`'s `parishUnitId` filter
  (`app/Queries/ReadersListQuery.php:50-55`), bound straight into
  `memberships.parish_unit_l1_id`/`parish_unit_l2_id` — both ascii_bin.
  Reproduced live over real HTTP, logged in, as the shelf's own manager:
  `GET /shelves/{shelf}/manage/readers?unit=Giáo họ Đức Mẹ` and
  `?unit=📚` both 500'd with `SQLSTATE[HY000]: 1267 Illegal mix of
  collations (ascii_bin,IMPLICIT) and (utf8mb4_unicode_ci,COERCIBLE)` —
  ordinary Vietnamese text, not hostile bytes. Fixed by refusing a
  non-UUID-shaped `unit` the same way M7's garbage-fold branch refuses a
  garbage `q`: `whereRaw('1 = 0')`, matching nothing rather than
  crashing. Pinned by
  `tests/Feature/Members/ReaderQueriesTest.php`'s "a non-UUID-shaped
  parish-unit filter matches nothing instead of 500ing" — mutation
  verified: reverting the guard reproduces the identical live 1267
  error inside the test, and nothing else in the file breaks.
- **`LendController::confirm`'s `?reader=` was the highest-value
  UNPINNED line in the whole diff.** Its hand-rolled
  `preg_match('/^[0-9a-f-]{36}$/', $membershipId)` was the only thing
  between that query value and `Membership::find()`'s ascii_bin bind —
  and nothing in the suite pinned it: deleting the check left the full
  suite green while the live route 500'd on both invalid bytes and on
  an ordinary 36-character Vietnamese string. Replaced with
  `App\Support\SafeId::isUuid()` — a thin wrapper over
  `Illuminate\Support\Str::isUuid()`, the SAME check Laravel's own
  route-model-binding layer already performs for every model using
  `HasUuids` (`Illuminate\Database\Eloquent\Concerns
  \HasUniqueStringIds::resolveRouteBindingQuery()`) before a query ever
  runs — rather than a second, weaker, hand-rolled definition of "looks
  like a UUID." `ReadersListQuery`'s fix above shares the same class.
  Pinned by `tests/Feature/Circulation/QuickLendScreensTest.php`'s "a
  non-UUID-shaped ?reader= never reaches the membership bind" —
  mutation verified the same way (reverting to an unconditional `find()`
  reproduces the live 1267 error inside the test).
- **The controller-layer inventory the last sweep's gate does not cover
  (a THIRD blind spot, alongside the two `FreeTextEncodingGuardTest`
  already names): raw query parameters and route segments read by
  controllers, outside any Form Request, are invisible to a gate that
  only scans `app/Http/Requests/`.** Every `QueryParam::first()`/
  `QueryParam::input()` call site in `app/Http/Controllers` was walked:
  - `ReaderController::index` `?unit=` → ascii_bin (`memberships
    .parish_unit_l1_id`/`l2_id`) — **was vulnerable, fixed above.**
  - `LendController::confirm` `?reader=` → ascii_bin
    (`memberships.id`) — **was guarded by a weak regex, replaced with
    `SafeId::isUuid()` above.**
  - `LendController::index`/`reader`/`newReader` `?book=` →
    `Book::where('slug', ...)` — `books.slug` is `utf8mb4_bin`, not
    ascii_bin; confirmed live safe by posting `?book=%FF%FE` (invalid
    UTF-8 bytes), which returned `200`, not a 500.
  - `Manage\BookController::index` `?category=` and
    `Reader\CatalogueController::index` `?category=` →
    `whereHas('category', ... where('slug', ...))` — `categories.slug`
    is also `utf8mb4_bin`; same reasoning, not re-tested live since the
    column-charset argument is identical to `books.slug` above.
  - `Manage\ReturnController::index`/`lost` `?loan=` → resolved against
    an in-memory `collect($rows)->firstWhere('loanId', $chosen)` — never
    reaches a database bind at all.
  - `RegistrationController::create` `?shelf=` →
    `Bookshelf::where('slug', ...)` — `bookshelves.slug` is
    `utf8mb4_bin` — safe, same reasoning.
  - Every `?q=` (`ReaderController`, `Manage\BookController`,
    `Reader\SearchController`, `Manage\LendController`) → folded via
    `Fold::fold()` before a `LIKE` on a `utf8mb4` `*_folded` column, and
    the M7 branch already turns a garbage fold into `1 = 0` — safe.
  - Every remaining `QueryParam` call (`?status=`, `?sort=`, `?page=`)
    is either compared against a fixed enum-backed column or cast to
    `int` — provably non-text.
  - Implicit ROUTE-SEGMENT bindings (`{reader}` → `Membership`,
    `{loan}` → `Loan`, `{bookCopy}` → `BookCopy`, all ascii_bin `id`
    columns) turned out to be a false alarm, confirmed live: every one
    of those models uses `HasUuids`, and Laravel's own
    `HasUniqueStringIds::resolveRouteBindingQuery()` already rejects a
    non-UUID-shaped route value with a clean 404 BEFORE the query runs
    — `GET /shelves/{shelf}/manage/readers/Giáo` 404s cleanly with zero
    additional database queries (verified with `DB::listen` recording
    nothing beyond the tenant-resolution queries, and the response's
    bound exception confirmed as `ModelNotFoundException`, not a
    `QueryException`). `{shelf}` and `{book}` use their own
    `getRouteKeyName()` override (`slug`, `utf8mb4_bin`) and were never
    at risk.
  Recorded here as the third blind spot the encoding gate does not
  cover, alongside the two `FreeTextEncodingGuardTest`'s own docblock
  already names (a rule built conditionally on `$this->input(...)`, and
  a field injected in `prepareForValidation()`) — all three share the
  same root cause: the gate can only see what `rules()` returns on an
  unbound `FormRequest` instance, and none of these three shapes is
  reachable that way. A future hostile-input sweep of a NEW controller
  should walk every `QueryParam::first()`/`QueryParam::input()` call
  site the same way this one did, not assume the Form Request gate
  already covers it.
- **The lock-order document's "never the reverse" claim did not hold —
  corrected, with the reverse edge reproduced live.** See the corrected
  entry above, under "The implicit FK shared locks..." — the original
  sentence was scoped to circulation-vs-`AllocateCopyCodes` only in the
  reviewer's re-reading, not as originally written. A `users`-row FK
  edge (`audit_log.actor_id`) that the original note never named creates
  a genuine AB-BA cycle between `UpdateReaderProfile`/
  `SetReaderCredentials` (Phase 1b) and `AllocateCopyCodes` (Phase 1a)
  when the same person is simultaneously the SUBJECT of one and the
  ACTOR of the other. Reproduced with two real OS processes
  (`pcntl_fork()`, two independent PDO connections against the real
  `mariadb` container replaying each command's exact lock sequence with
  a deliberate interleaving delay): a genuine `SQLSTATE[40001]: ... 1213
  Deadlock found when trying to get lock` from InnoDB's own detector,
  not simulated. The near-miss that keeps the more OBVIOUS
  `book_copies`↔`memberships` pair from also cycling (a composite FK
  pointing at a secondary unique index vs. `LendCopy`'s primary-key
  `lockForUpdate()`) is recorded alongside it, as design luck rather
  than a guarantee.
- **`DeleteBook`'s "no lock needed" argument was stale the moment
  `LendCopy` shipped — docblock corrected, interaction recorded rather
  than fixed.** See `app/Actions/Catalogue/DeleteBook.php`'s corrected
  docblock: a `LendCopy` committing a new loan against one of a book's
  copies after `DeleteBook`'s REPEATABLE READ snapshot was pinned, but
  before `DeleteBook`'s own `whereDoesntHave('loans')` fetch runs, is
  invisible to that snapshot — the copy gets soft-deleted anyway, with
  an active loan now pointing at it that `ReceiveReturn.php:57` and
  `VoidLoan.php:56` can never resolve (`findOrFail`, no
  `withTrashed()`). Not fixed in this round: `DeleteBook` is unrouted
  (zero live exposure today), and the honest fix is a real design
  choice between two nontrivial options (lock the book's copies inside
  `DeleteBook`, or teach `ReceiveReturn`/`VoidLoan` to resolve a
  soft-deleted copy) that belongs with whoever routes this command, not
  a fix-round patch.
- **`FreeTextEncodingGuardTest`'s `QuickLendRegisterReaderRequest::book`
  exemption cited the wrong command.** It read "before
  `RegisterMemberOnBehalf::execute()` ever sees the array"; the actual
  call site is `LendController::storeReader`, which calls
  `ManagerRegisterReader::execute()` — a different Action entirely. The
  reasoning was still correct (the field is stripped via `Arr::except()`
  before either Action would see it), only the citation was wrong, in a
  test whose entire value is that every exemption cites the exact code
  proving it safe. Corrected in
  `tests/Feature/Architecture/FreeTextEncodingGuardTest.php`.
