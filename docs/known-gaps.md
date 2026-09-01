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
  **AMENDED at the Phase 2b wrap-up: the second half of that sentence has
  expired.** Phase 2b does not use the relation either — it deferred the
  whole feedback slice, form and inbox together, to Phase 3 (see the
  Phase 2b section below for the four reasons). Measured at the wrap-up:
  `grep -rn -- "->feedback()" app/ resources/ tests/` returns two hits,
  both inside docblocks (`app/Models/Feedback.php`,
  `app/Models/Bookshelf.php`) — no call site at all.
  So the *first real caller* is Phase 3's, not Phase 2's,
  and a reader sent looking for one in this phase's diff finds nothing.
  The coverage-debt half stands unchanged.
  **AMENDED AGAIN 2026-09-01, phase 3c-ii: there is no first real caller,
  and under the ruling this phase took there will not be one.** The feedback
  slice is now fully built and `/admin/feedback` is super-admin-only and
  cross-shelf, so it reads the table directly and never through a shelf; the
  same grep still returns docblock mentions only. The coverage debt is
  therefore not payable by a caller arriving later, which changes what it
  means — see "A relation kept for a caller that does not exist" in the
  Phase 3c-ii section at the end of this file.
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
  **AMENDED at the Phase 2b wrap-up, and the two halves must not be
  confused.** The STRUCTURAL half is *not* closed for `Comment`: opened at
  the wrap-up, `app/Models/Comment.php` still declares `protected $guarded
  = []`, so every column on that model — `moderated_by` included — remains
  mass-assignable. What Phase 2b closed is the EXPOSURE half on the comment
  surface, and only there. Every request-borne write reaching `Comment` now
  passes a Form Request whose `rules()` names one field and nothing else —
  `StoreCommentRequest` (`body`), `RejectCommentRequest` (`reason`,
  required), `HideCommentRequest` (`reason`, nullable), all three opened —
  and the controllers hand the Actions `validated()` output only
  (`CommentController::store`, `CommentModerationController`'s two
  decision methods, opened). `moderated_by` itself is written by exactly
  three statements in this repository, and each writes `$actor->id` rather
  than anything from the request: `grep -rn "moderated_by" app/` returns
  `ApproveComment.php`, `RejectComment.php` and `HideComment.php`. So no
  request input can reach that column today — but the model would still
  take it if some future caller passed one, which is what closing the
  structural half would prevent. The `Membership::role` and
  `BorrowRequest`/`Loan` halves of this entry are untouched by Phase 2b.
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
- **~~`donate` is a 308 redirect in the Next.js original, not a page.~~**
  ~~This Laravel branch renders it as an `under-construction` page like
  every other reader-area route … but Phase 1, which is where `donate`
  becomes a real screen, should model it as a redirect rather than
  continuing to treat it as a page of its own.~~
  **STRUCK at the Phase 2b wrap-up. It was wrong twice over, and the
  status code is the half nobody had checked.**
  1. **The reference's redirect is TEMPORARY, not a 308.** Opened at the
     wrap-up:
     `old_next/src/app/tu-sach/[shelf]/(doc-gia)/tang-sach/page.tsx`
     calls Next's `redirect()`, not `permanentRedirect()`, and its
     docblock argues the choice in its own words — "`permanent: false`.
     The path is a product decision rather than a fact about the
     resource, and a 308 is cached by browsers indefinitely — a later
     slice that wanted a public, non-reader-facing donation page would
     have to fight every visitor's cache to get this URL back." So this
     entry recorded, and this project then repeated, the exact status the
     reference deliberately refused.
  2. **That file contradicts itself, which is how the wrong number got
     copied.** Its `metadata` export carries a comment reading "a route
     that exists only to 308 elsewhere" — the same file, a few lines
     above the `redirect()` call it describes. Recorded here so the
     correction is not re-litigated from that comment. `old_next/` is
     read-only; nothing there is edited.
  3. **The advice has expired regardless.** Phase 2b's Task 18 turned
     `shelves.donate` into a real offer form
     (`App\Http\Controllers\Reader\DonationController::create`,
     rendering `shelves/donate`), with the reader's own list of past
     offers at `shelves.profile.donations`. That controller's docblock
     states the resulting divergence in its own words and it is the
     shape to carry forward: the reference has ONE screen holding both
     the form and the list, this port has TWO pages because it kept both
     placeholders' route names, and redirecting `donate` at
     `profile/donations` here would send a reader who came to offer books
     to a page that does not carry the form.

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
- **The donor member picker is deferred.** `donor_membership_id` is
  accepted, validated, stored, audited and rendered back (the manager detail
  resolves the member's name) — but the create form offers only the
  free-text donor until a member search exists.
  **AMENDED at the Phase 2b wrap-up, three ways.**
  1. **The citation was wrong.** This entry said "the **OPS** §16.3
     donation-queue pre-fill". `docs/OPERATIONS.md` has no §16 —
     `grep -cE "^#+ *16" docs/OPERATIONS.md` returns **0**, and that
     document's headings end at §9. The pre-fill is **BR** §16.3's, which
     is how every `§16` citation in this file spells it — grepped at the
     wrap-up, and every one of them names BR.
     (OPS does describe the same behaviour, but under `ReceiveDonation` in
     §4.4, quoting BR: "§16.3 describes **Duyệt** as opening the add-book
     form with **Người tặng** pre-filled with that member.")
  2. **The gap is narrower than written.** Only the
     MEMBERSHIP-LINKED pre-fill is missing. The free-text half already
     ships end to end: `resources/js/pages/manage/books/create.tsx`
     (opened) carries `donor_name` in its form type, its `useForm` seed,
     its `transform` and its markup.
  3. **Whoever builds the picker must CLEAR the name field, not sit
     beside it.** `app/Http/Requests/Catalogue/StoreBookRequest.php`
     (opened) validates `donor_membership_id` with `prohibits:donor_name`,
     so the two are mutually exclusive by rule: a form that pre-filled the
     membership while leaving a typed name in the box would be refused,
     and the refusal would read as a validation bug rather than a design
     one. What Phase 2b DID ship on this path is the courtesy half —
     `app/Http/Controllers/Manage/DonationController` sends the donor's
     name back in the success flash after *Duyệt*, so a volunteer can
     retype it — not the pre-fill.
- **~~The reader detail page ships without its "Xin mượn" button, comments,
  or the manager's lend/return shortcuts~~** — the availability panel,
  queue length and contact line are live.
  **AMENDED at the Phase 2b wrap-up: two of the three are now false.**
  Opened at the wrap-up, `resources/js/pages/shelves/book.tsx` posts a
  borrow request to `shelves.books.request` (2a) and renders the comments
  area — the approved list and, for a member of a shelf that takes
  comments, the form posting to `shelves.books.comments.store` (Phase 2b,
  Task 7). What is still absent from that page is the third item only: the
  manager's lend/return shortcuts. `LendCopy`/`ReceiveReturn` shipped in
  1c with their own screens (`manage/lend`, `manage/returns`); no shortcut
  to either sits on the reader's book page.
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
- **`GetShelfHome` (OPS §3.2) is deferred, and the reason has changed.**
  `ShellController::shelfHome()` still renders `shelves/show`, which Task
  18 gave a *Tặng sách* link but no props.
  **AMENDED at the Phase 2b wrap-up: the stated reason has expired.** It
  read "the page's centerpiece card is the pinned-or-latest announcement —
  a Phase 2 entity". That card is now computable:
  `app/Queries/AnnouncementsQuery.php` ships the reader-facing narrowing
  and orders `is_pinned` first. What still blocks the page is the OTHER
  secondary card BR §16.1 asks for — *Góp ý* — which belongs to the
  feedback slice this phase deferred whole to Phase 3 (below). So the
  shelf home waits on feedback, not on announcements, and whoever picks it
  up should read the deferral below before re-deriving the reason.
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
- **`ApproveMembership`/`RejectMembership` now write their notification
  rows; this entry records the shipped state, not a gap.** 1b left both
  writes to Phase 2 and both Actions carried a "Phase 2 must add…"
  docblock paragraph saying so. Phase 2a Task 2 added them and deleted
  both paragraphs: each Action writes `membership_approved` /
  `membership_rejected` through `App\Support\Notifications\Notifier`
  inside the transaction that already writes the status change and the
  audit row (OPS §7). The transactional half is not a comment — it is
  pinned by `NotificationsAreReaderFacingTest`'s "every notify() call sits
  inside its command's own DB::transaction closure", a token walk that
  reddens when a call is moved after the transaction returns, and by
  `NotificationWritePathTest`'s rollback test, which proves the row
  present inside the transaction before failing it. Nothing here is
  outstanding.
- **`POST /register` is throttled on two keys, both numbers invented here**
  — 30/minute per IP (burst) and 20/day per SHA-256 of the submitted phone,
  falling back to the IP when the phone is blank. A decision taken on the
  product owner's behalf: OPS §8 (`docs/OPERATIONS.md:1178`; an earlier draft
  cited `:1158`, which is twenty lines earlier and inside §7) lists
  `RegisterMembership` rate
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
- **Resolved by Phase 1d Task 2:** `app/Support/Audit/AuditSecrets.php`
  now ports the reference's walker (`assertNoSecrets`, wired into
  `AuditRecorder::record` as its first statement) and this entry no
  longer holds — see the three entries below for what the port
  deliberately still does not cover. Kept, struck through in spirit
  rather than deleted, so a reader who remembers this line finds the
  update rather than a silent disappearance: ~~There is no
  `assertNoSecrets` audit walker. The reference's kernel walked every
  audit bag for hash-shaped values; here the no-secret rule is held by
  `SetReaderCredentialsTest`'s row assertions only. If a later phase
  adds an audit helper, port the walker there.~~
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
  docblock names the exact 403-vs-404 hazard spec §5.4's anti-enumeration
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
  spec §5.4 anti-enumeration hazard "PR #61 fix round, Task 4" (see above)
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
  | `HandoverRequest` | ~~Phase 2 (holds); route absence pinned~~ — **shipped, Phase 2a Task 9**; the absence pin was replaced by a PRESENCE pin that names each borrow-request route by route NAME and requires `role:manager` on it (`CirculationArchitectureTest`, and it GREW at Task 18 — which is why it names rather than counts) |
  | `ReceiveReturn` | shipped narrowed (Task 4); hold branch re-widened by Phase 2a Task 10 — see the struck entry below |
  | `RenewLoan` | shipped (Task 5); Q4 = renewal is status-gated, closed and pinned by name |
  | `VoidLoan` | shipped (Task 6) + a button OPS never specified |
  | `CreateBorrowRequest` / `ApproveBorrowRequest` / `RejectBorrowRequest` / `CancelOwnRequest` | ~~Phase 2~~ — **all four shipped, Phase 2a Tasks 4–7** |
  | `SkipRequest` | ~~Phase 2 — and no reference implementation exists to port~~ — **closed WITHOUT implementation, Phase 2a**: the product owner removed *Bỏ qua* from the reference (the queue page's own comment block, 2026-08-09), leaving *Từ chối* as the manager's one decision on a pending row. OPS §4.2's entry and its open question stand as the record of what was NOT built |
  | `SearchBooksForLending`, `SearchReadersForLending`, `SearchLoansForReturn`, `GetOverdueLoans`, `GetMyDashboard` (loans half), `GetMyLoanHistory` | shipped — and `GetMyDashboard`'s **requests half** shipped in Phase 2a Task 13, so the parenthetical is history rather than a limit |
  | `GetBorrowRequestQueue` | ~~Phase 2~~ — **shipped, Phase 2a Task 11** (`BorrowRequestQueueQuery`) |
  | `GetManagerDashboard`, `ExportLoansCSV` | 1d |
  | `ResolveCopyById` | Phase 2 — **still open after 2a**, and now specifically 2c's: it is the scanner's query, and `CreateBorrowRequest`'s narrowed `copyId` (2a section below) waits on the same phase |
  | `ManagerRegisterReader` (§4.3) | Action shipped in 1b, surface shipped here — closes 1b's last "implemented, reachable from nowhere" entry (see below) |

  Every code path above was walked by opening the named file, not
  inferred from the table cell — `RenewLoan`'s Q4 disposition and
  `ReceiveReturn`'s narrowing are each their own entry below with the
  file and line evidence.

- **~~`ReceiveReturn`'s contract is deliberately narrower than the
  reference, and Phase 2 must restore four things in one pass~~ —
  CLOSED by Phase 2a Task 10.** All four are back, in one commit and one
  transaction: the `$holdForRequestId` parameter, the `queuedRequestId`
  return value (the signature changed from `void` to
  `array{loanId: string, queuedRequestId: ?string}`), the
  `request.approved` audit row beside `loan.returned`, and the
  `request_approved` notification. The entry is struck here rather than
  left for the phase's wrap-up task, for the reason the `LendCopy` entry
  below gives: a known-gap that has silently become false is worse than
  one that is merely missing. Two things about the port are worth
  keeping, because they are NOT what the reference does:

  - **A third lock the reference never took.** Its `resolveHold` was a
    plain read; ours is `BorrowRequest::query()->lockForUpdate()`, third
    in the order copy → loan → request, so a concurrent
    `CancelOwnRequest` cannot invalidate the row between the resolve and
    the hold write. That puts `ReceiveReturn` on the same side of
    divergence 1's recorded AB–BA edge as `ApproveBorrowRequest` and
    `LendCopy` (holding the copy, wanting the request), a third
    participant on an edge already recorded rather than a new direction
    — read off the `lockForUpdate` call sites under `app/Actions`, not
    reproduced, and no cycle-freedom claim is made either way.
  - **`request.approved`'s audit payload carries `userId` from this door
    too** (plan divergence 6). The reference writes it only from
    `ApproveBorrowRequest`, which leaves the second door's entry
    subject-less in the audit browser.

  The `queuedRequestId` read is still what the entry described: the
  pending queue for this title in `requested_at asc, id asc` order, read
  AFTER every write in the transaction, so a just-held request is no
  longer pending and the answer is the next person along.
  `tests/Feature/Circulation/ReceiveReturnHoldTest.php` pins all of it;
  1c's `ReceiveReturnTest` was not touched and stayed green, which is
  the evidence the plain-return path did not move.
- **~~`LendCopy`'s hold-collection branch is unported~~ — CLOSED by
  Phase 2a Task 8 (`6985690`, `9cea723`).** This entry said
  `LendCopy::execute` "always passes `null` for `$heldForUserId`" and
  that the collected-hold close was unported. Both statements became
  false the moment Task 8 landed: the real holder is wired through, and
  the close is a guarded `UPDATE ... WHERE status = 'approved'` inside
  the lend's own transaction, writing `request.fulfilled`. The entry is
  struck here rather than left for the phase's wrap-up task because a
  known-gap that has silently become false is worse than one that is
  merely missing — this document's whole failure mode is claims nobody
  re-ran. The port ended up STRICTER than the reference it names: the
  reference's close (`old_next/src/domain/circulation/commands/lend-copy.ts:328-332`)
  carries no status guard, so it can overwrite a request that lost a
  race; this one cannot.
- **INV-5's guarantee is a membership-row lock, not an index — stronger
  than the reference, but bypassable outside `LendCopy`.**
  `app/Actions/Circulation/LendCopy.php:81` (was `:75` before Phase 2a
  Task 8 re-widened the file) locks the reader's
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
  `app/Actions/Circulation/RenewLoan.php` takes exactly ONE lock — the
  loan row, its transaction's first statement, whose own comment says so —
  and then runs a plain, unlocked
  `BorrowRequest::query()->where('book_id', ...)->where('status',
  Pending)->exists()` — a request for the same title committing between
  that read and the renewal's own commit is invisible to it. Unreachable
  in 1c (nothing creates a `BorrowRequest` outside seed data, so nothing
  could race this check).
  **DECIDED in Phase 2a (Task 19's walk, against the shipped file rather
  than the plan): the plain read stays, and the check is now REACHABLE.**
  `CreateBorrowRequest` ships, so a reader really can create a pending
  request for a title while its borrower renews it. The lock was not
  added, on divergence 8's indistinguishability argument, spelled out:
  a lock would order the two writes, but it would not make the outcome
  *observably* different from what the plain read already gives. "The
  renewal read the queue and the request committed a moment later" and
  "the request committed a moment earlier and the renewal read it" are two
  orderings of two independent human actions seconds apart; nothing in the
  system, and neither person, can tell which one happened. The reader sees
  a queue position either way; the borrower sees a granted renewal or
  `title_has_queue` either way. So the racing-request case is benign **by
  argument, not by absence** — which is the whole change from the sentence
  this replaces, whose safety came entirely from nothing being able to
  reach the check.
  Two bounds, because an argument that does not state them is the shape
  this document keeps getting wrong: it holds because a renewal takes
  nothing away from the queued reader (BR §6's renewal extends one loan;
  it does not consume the copy the queue is waiting for), and it stops
  holding the day anything gives the queue check a WRITE side — a command
  that decremented a queue counter on renewal, say, would need the lock
  this one does not.
- **The `ReceiveReturn` / `ReportCopyLost` / `VoidLoan` lock order
  (copy, then loan) is a convention every command's source enforces by
  hand, not a database-level guarantee.** Verified by reading each
  file's first two statements: `ReceiveReturn.php:109-111` (was `:57-59`
  before Phase 2a Task 10 re-widened the file),
  `VoidLoan.php:56-57` both lock `BookCopy` before `Loan`;
  `LendCopy.php:79-81` locks `BookCopy` before `Membership` (a
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
- **~~Step 1's block flag is hold-aware; `ChooseCopy` is not — a Phase 2
  landmine~~ — DISPOSITIONED by Phase 2a (divergence 14), not left as a
  landmine.** The description stands as written:
  `SearchBooksForLendingQuery` derives its `blocked` flag from
  `CountsCopies::borrowable()`, which excludes an `available` copy
  carrying an unexpired approved hold; `ChooseCopy::lowestLendable` picks
  the lowest-coded copy by `book_copies.state` alone and knows nothing
  about holds. The entry offered two resolutions. **The one taken is the
  first: `ApproveBorrowRequest` keeps them in sync** — it flips the copy to
  `held` in the same transaction as the hold, so the state-only branch and
  the state-plus-no-live-hold branch select the same copies, and step 1
  and step 3 give the same answer about the same title.
  **`ChooseCopy` was deliberately NOT taught the predicate.** It is pure
  over a `Collection<BookCopy>` — no clock, no SQL — so learning "does a
  live hold name this copy" would mean every caller handing it hold data,
  or the function reaching for the database; the reference's own chooser
  is pure for the same reason.
  **The pin, so this row is not just a paragraph:**
  `tests/Feature/Circulation/ApproveBorrowRequestTest.php`'s "before an
  approval, step 1 and step 3 both offer the title's only copy" and "after
  an approval, step 1's blocked flag and ChooseCopy agree the title has
  nothing lendable". Proved by mutation rather than asserted: deleting the
  `$copy->update(['state' => CopyState::Held])` line turns the second one
  red on exactly the disagreement — the search says blocked because
  `borrowable()` sees the live hold, while `ChooseCopy` still offers the
  copy.
  **The one residual is divergence 13's row** — `available` under a live
  hold, where the two predicates DO still disagree and a walk-up lend
  wins. Its own entry in the 2a section below carries what is now known
  about reaching it, which is not what this branch believed for most of
  the phase.
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
- **~~Due-soon/overdue notifications do not exist yet~~ — CLOSED by
  Phase 2a Task 17.** `app/Console/Commands/SweepReminders.php` writes both
  kinds, scheduled at 07:00 `Asia/Ho_Chi_Minh` from `routes/console.php`.
  Struck here rather than left for the phase's wrap-up, for the reason the
  `ReceiveReturn` entry above gives: a known-gap that has silently become
  false is worse than one that is merely missing. The half of the entry
  that was never a gap still holds and is why the job is allowed to be
  late: the overdue SCREEN (`OverdueLoansQuery` + `OverdueController`) and
  the dashboard's overdue count are computed on read (BR §8), so they are
  correct whether or not the sweep has ever run —
  `SweepIsHousekeepingTest`'s first block is that assertion.

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
  an active loan now pointing at it that `ReceiveReturn.php:109` and
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
- **`AuditSecrets::assertNoSecrets` (Phase 1d Task 2) checks KEYS, not
  values, and is not retroactive.** A secret string pasted into an
  innocuous key (`['note' => 'mat-khau-123']`) is invisible to it and
  stays a code-review matter — pinned as a test
  (`tests/Unit/Audit/AuditSecretsTest.php`, "names the two things it
  deliberately does not check") rather than left implicit. It also
  governs writes from this commit forward only: existing `audit_log` rows
  are clean because all 21 shipped payload shapes were checked by hand at
  plan time (the same test's "every payload shape the 21 shipped writers
  produce passes" case), not because the guard walked them retroactively
  — there was no guard when they were written.
- **`AuditSecrets` does not walk `context`.** `AuditRecorder::record`
  writes `context` as `[]` on every path today, and `assertNoSecrets`
  takes `before`/`after` only — so the day a command puts anything real
  into `context`, this guard must grow a third argument, or that payload
  ships unchecked. Recorded here so that day is an addition to a known
  plan, not a rediscovery.
- **`Csv::neutralise`'s widened leading-whitespace strip (Phase 1d Task 8
  carry-over) guards against an UNVERIFIED fact about Excel.** The strip
  now also swallows U+00A0 (NBSP) and U+200B (ZWSP) ahead of a formula
  leader, on top of the ASCII whitespace the reference (`old_next/src/lib/csv.ts`)
  already stripped — see `app/Support/Exports/Csv.php`'s `LEADING_SPACE`
  docblock. The reference's own docblock records testing and dismissing
  only a fullwidth equals and a Unicode minus; NBSP/ZWSP were never
  considered in either codebase, and whether Excel's own CSV importer
  strips them before its formula detection has not been observed against
  a real Excel — the widening is done on the "strictly safer" argument
  (an unnecessary apostrophe costs nothing) alone, not on a confirmed
  fact. `CsvTest`'s NBSP/ZWSP case pins the current, safer behaviour;
  nobody should read that test as proof of what Excel does.
- **No `$this->post(...)` HTTP test in this suite can exercise
  `VerifyCsrfToken`/`PreventRequestForgery` end to end — softened from an
  earlier "ever," which overstated it (Task 9 fix round, 2026-08-29).**
  `vendor/laravel/framework/.../PreventRequestForgery.php`'s `handle()`
  passes every request through untouched when
  `$this->app->runningInConsole() && $this->app->runningUnitTests()` is
  true — which is always true for a Pest run's `$this->post(...)` calls,
  independent of any token. `tests/Feature/Oversight/ExportHttpTest.php`
  (Phase 1d Task 9) confirmed this by reading the vendor source rather
  than trusting a green suite. What "ever" got wrong: a unit test can
  still construct the middleware directly with a double whose
  `runningUnitTests()` returns `false`, which genuinely exercises
  `handle()`'s token check outside the short-circuit — nobody has written
  that test in this suite, but the mechanism does not rule it out, and
  "ever" is exactly the word the next person will cite when declining to
  write it. What Task 9's fix round DID newly pin, straight off a real
  Inertia response rather than by reading code: the `csrfToken` shared
  prop (`HandleInertiaRequests::share()`) is present and equals the live
  session token (`ExportHttpTest.php`, "shares a real, non-empty
  csrfToken prop"), mutation-proved by deleting the share line — the
  suite goes red where it previously stayed green. The hidden `_token`
  field on each of the audit page's three download forms is still
  checked by reading `audit.tsx`, not by a request that ever fails
  without a token. If a future change moves any manage-area route
  outside the default `web` middleware group, or edits
  `bootstrap/app.php`'s `append()` to drop CSRF, nothing here would go
  red for the route itself. This is a suite-wide gap, not specific to
  Task 9's route — recorded here because Task 9 is the first place a
  route's CSRF protection was actually load-bearing enough to go looking
  for it.

## Phase 1d — Oversight

The durable record of `docs/superpowers/plans/2026-08-29-laravel-phase-1d-oversight.md`
(the audit log surfaced as readable sentences, the manager dashboard,
CSV export). Written by Task 10 after walking the shipped branch —
every claim below was checked against the named file or a passing test,
not copied from the plan document, and one place where the plan's own
text turned out wrong is called out rather than repeated.

- **The OPS §3.3 walk, verified by opening each named file/route, not
  inferred from the plan:**

  | Row | Disposition, verified |
  |---|---|
  | `GetManagerDashboard` | shipped. ~~narrowed to two of BR §16.3's four stat cards~~ — **AMENDED at the Phase 2b wrap-up: it is now all four.** `app/Queries/ManagerDashboardQuery.php` (opened) returns `counts.overdue`, `counts.pendingRegistrations`, `counts.pendingRequests` (2a, delegating to `BorrowRequestQueueQuery::countWaiting()`) and `counts.pendingComments` (2b, delegating to `CommentModerationQuery::countPending()`); `totals` still carries titles/copies/onLoan/readers |
  | `GetAuditLog` (shelf-scoped) | shipped (`app/Queries/AuditLogQuery.php`), excludes null-`bookshelf_id` rows by its own `scoped()` filter |
  | `ExportBooksCSV` / `ExportReadersCSV` / `ExportLoansCSV` | shipped, one controller (`app/Http/Controllers/Manage/ExportController.php`), one `POST /shelves/{shelf}/manage/exports/{kind}` route (`routes/web.php:198`) |
  | `GetStatistics` | **Phase 2** — confirmed still absent from `app/Queries`; `/manage/statistics` route still resolves to `ShellController::underConstruction` |
  | ~~`GetBorrowRequestQueue`, `GetDonationQueue`, `GetCommentsList`, `GetAnnouncementsList` (manager)~~ | **STRUCK at the Phase 2b wrap-up — the row has nothing left in it.** All four are answered, and the row's "no matching class under `app/Queries`" was already false for the first one before this branch was cut: `GetBorrowRequestQueue` → `BorrowRequestQueueQuery` (2a); `GetCommentsList` → `CommentModerationQuery` (2b Task 6); `GetAnnouncementsList` → `AnnouncementsQuery` (2b Task 12); `GetDonationQueue` → `DonationQueueQuery` (2b Task 17). Each named class was opened at the wrap-up |
  | `GetPendingProfileChanges` | **Phase 3** — the propose/approve queue does not exist; `UpdateReaderProfile`'s direct correction (1b) is the only reader-profile write path today |
  | ~~`GetShelfSettings` (manager, read-only)~~ | **STRUCK at Phase 3b-ii Task 6** — `/manage/settings` is a real screen (`app/Http/Controllers/Manage/SettingsController.php`), read-only per spec D4: the eight lending/comment values through `LendingSettings` and `CommentSettings`, the shelf's contacts through the ordinary scoped relation, the taxonomy shape through `ParishTaxonomy`. No query class of its own — three settings reads off the bound row are not a query — and deliberately **no write route under the path at all**, asserted in `tests/Feature/Members/ManagerSettingsScreenTest.php` |
  | `ListTitlesForLabels`, `ListCopiesForLabels`, `ExportLabelSheetPDF`, `ResolveCopyById` | **Phase 2** — QR labels, per 1c's own census |
  | All of OPS §3.4 (`GetAdminOverview` … `DownloadSystemBackup`, 11 rows) | **Phase 3** — no `admin/`-prefixed manage query exists yet; `AuditLogQuery` deliberately excludes the null-`bookshelf_id` rows this cross-shelf browser will need |
  | ~~Notification commands, `GetMyNotifications`, the reminder sweep~~ | **STRUCK at the Phase 2b wrap-up — stale, and not named by the plan's own list of stale cells; found by the count-word sweep.** All three shipped in 2a and the 2a wrap-up table above already says so: `MyNotificationsQuery` under `app/Queries`, one `MarkNotificationRead` Action behind two routes, and `reminders:sweep` scheduled 07:00 `Asia/Ho_Chi_Minh` from `routes/console.php` (line re-read at this wrap-up) |

- **The audit-action census as shipped, counted independently rather than
  trusted from the plan:** `grep -rn -- "->record(" app/` finds **23**
  call sites across 22 files; the literal action-name strings at those
  call sites collapse to **21** distinct actions (`ReportCopyLost.php`
  alone writes two — `copy.lost_reported` and `loan.lost` — which is the
  whole of the 23-to-21 arithmetic). The census test itself is
  `tests/Feature/Architecture/AuditActionCensusTest.php`: it strips every
  `T_COMMENT`/`T_DOC_COMMENT` token before matching (so a call site
  mentioned only in a docblock, or commented out mid-refactor, cannot
  masquerade as live), then holds the writer set and `AuditSentences`'s
  map set-equal in both directions — a sentence with no writer and a
  writer with no sentence are both failures, not just one direction.
- **~~The dashboard narrowing:~~ `ManagerDashboardQuery::run()` ~~ships
  exactly two of BR §16.3's four stat cards~~.**
  **CLOSED at the Phase 2b wrap-up, and this bullet is amended rather than
  deleted because it is the second place the two-of-four claim was
  written — the §3.3 table row above is the first, and correcting one and
  not the other is how a struck claim reappears.** Opened at the wrap-up,
  `ManagerDashboardQuery::run()`'s declared return type names four counts:
  `overdue`, `pendingRegistrations`, `pendingRequests`, `pendingComments`.
  The instruction this entry carried was followed: `pendingRequests`
  delegates to `BorrowRequestQueueQuery::countWaiting()` and
  `pendingComments` to `CommentModerationQuery::countPending()`, so
  neither card can drift from the queue it counts. The subtlety it flagged
  survives inside `countWaiting()` — the borrow count spans **both**
  `pending` and `approved`, not `pending` alone. There is still no
  activity feed on this dashboard; the audit browser (`GetAuditLog`) is
  the feed, which is the reference's own final state.
- **The three narrowed payloads, confirmed against the Action source
  each writes from:**
  - `credentials.set` stores no payload (`SetReaderCredentials.php`
    calls `$this->audit->record(..., null, null)`) — by design, BR §14's
    "the field that changed must never be recorded." Its expansion shows
    nothing; that is correct, not a bug.
  - `membership.registered` stores five keys (`userId`, `fullName`,
    `status`, `parishUnitL1Id`, `parishUnitL2Id`) — no phone, no date of
    birth, no parent names — 1b's own privacy narrowing, unchanged by
    this phase.
  - `loan.returned`'s condition transition — **restored** this task
    (Step 1, product-owner ruling 2026-08-29): `before.condition` is now
    the copy's condition captured immediately after the copy lock, read
    into `$previousCondition` before `$copy->update()` overwrites the
    row three statements later (`app/Actions/Circulation/ReceiveReturn.php`).
    `ReceiveReturnTest.php`'s "1d amendment" test sends a copy out `worn`
    and back `torn`, and asserts `before.condition === 'worn'` **and**
    `after.condition === 'torn'` in one expectation — checked live by
    reverting the capture to `$copy->condition?->value` (reading the
    row post-update): both that test and the pre-existing INV-8 test
    turned red, both reporting `torn`/`slightly_worn` `before` values
    that never happened, confirming the expectation catches the exact
    defect shape the amendment exists to prevent, not just the key's
    presence.
- **`AuditLogQuery` is the third named exemption in
  `TenancyArchitectureTest`'s hand-written-`bookshelf_id`-filter
  allowlist** (`BookshelfScope`, `ResolveTenant`, `AuditLogQuery`) —
  because `AuditLog` carries no `BelongsToBookshelf` (its `bookshelf_id`
  is nullable; global administrative rows have none). The cross-shelf
  isolation property this exemption gives up structurally now lives in
  `tests/Feature/Oversight/AuditLogQueryTest.php`'s two-shelf-plus-
  global-row test, which proves the scoping by planting rows on two
  shelves and one with a null `bookshelf_id`, then asserting exactly the
  shelf's own rows come back — proof by identity, not by convention. A
  Phase 3 cross-shelf audit browser must NOT widen this class to serve
  both jobs — it needs its own query and its own super-admin gate, since
  `AuditLogQuery::scoped()` throws on a null bound tenant by design.
- **Exports are deliberately unaudited** (no `->record(` call anywhere
  in `ExportController.php`, confirmed by reading the file — an open
  question in OPS §3.3 the plan carried forward rather than closed),
  are **POST-only** — `GET /shelves/{shelf}/manage/exports/{kind}`
  answers **405**, pinned live by `ExportHttpTest.php`'s "GET is
  refused" test, because a GET is a bookmarkable, history-resident link
  to a file of children's records and Laravel's `VerifyCsrfToken` only
  guards a POST — and are **synchronous and streamed but explicitly NOT
  memory-bounded**: `ExportController::store` runs the whole query and
  builds the whole `ExportTables` grid *before* `response()->stream()`
  is even called, because the queries need the bound tenant and
  `TenantContext` is not guaranteed to survive into the streaming
  callback, which runs after the middleware stack has already returned.
  Only the byte concatenation into the output buffer is incremental —
  the reference's own ~100k-row horizon and this port's unbounded result
  set are carried forward as an open limit, not closed. The two
  candidate fixes if a shelf's export approaches that scale: a cursor
  paired with an explicit shelf id captured into the closure (so the
  tenant survives the callback without `TenantContext`), or a queued
  export with roughly the existing cron sweep's one-minute latency.
- **The subject join's collation guard, recorded with its measurement.**
  `app/Queries/AuditLogQuery.php`'s `payload_user` join reads
  `CONVERT(JSON_UNQUOTE(JSON_EXTRACT(audit_log.after, '$.borrower_id'))
  USING ascii) COLLATE ascii_bin` against `users.id` — measured on
  MariaDB 10.11.19 (the version this repo's container runs): a
  **non-ASCII constant or bind** compared directly against an
  `ascii_bin` column raises errno 1267 (this repo's own six-times-paid
  live 500, per the guard's own docblock); a non-ASCII value arriving
  through `JSON_UNQUOTE(JSON_EXTRACT(...))` does **not** raise it —
  MySQL/MariaDB's coercibility rules (coercibility 4 for a function
  result) let the column's own collation win, so the comparison
  degrades per row instead of raising, matching nothing rather than
  crashing. The `CONVERT ... COLLATE` is kept as defence in depth on top
  of that: it costs no index (`EXPLAIN` shows `eq_ref` on `PRIMARY`
  either way, with or without the cast) and changes no matching row for
  any ASCII `borrower_id` (every real one, since `users.id` is
  `ascii_bin`). The hostile-payload test this guard is pinned by asserts
  the OUTCOME (200, correct subject resolution, no 500) — not the SQL
  text of the guard itself, which a future refactor is free to change as
  long as the outcome holds. **Not yet added:** Phase 2's
  `request.rejected` sentence will need a `userId` payload branch joined
  the same way — one more `coalesce()` argument on the existing join,
  noted here so it is an addition to a known shape, not a rediscovery of
  the collation problem.
- **`AuditSecrets` matches the JSON serialiser by construction, and its
  two stated bounds.** `app/Support/Audit/AuditSecrets.php::toWalkable()`
  calls `json_encode()`/`json_decode()` on any object value rather than
  reimplementing PHP's serialisation rules — which is what closed the
  `ArrayObject`/`ArrayIterator` special case (json_encode hard-codes
  their internal storage as the serialised value; neither implements
  `JsonSerializable`, so an object-vars-based walk saw `[]` and passed a
  payload straight through) without that case ever being enumerated by
  name, and let a *second*, separate object-depth cap be deleted — the
  array-depth cap (6) is now the only depth boundary left in the file.
  Its two bounds, each pinned by its own test in
  `tests/Unit/Audit/AuditSecretsTest.php`: it checks **keys, not
  values** (a secret string pasted into an innocuous key like `note` is
  invisible to it), and it walks `before`/`after` only — `context`,
  which `AuditRecorder::record` writes as `[]` on every one of the 23
  call sites today, is entirely unchecked, so the first command that
  puts anything real into `context` must widen `assertNoSecrets` to a
  third argument in the same commit. It is **not retroactive**: it
  governs writes from its own commit forward only, and the 21 shipped
  payload shapes were confirmed clean by hand (and by the full suite),
  never by scanning the database.
- **Correction to the plan's own Step 4: the branch minted TWO new
  `RuleViolated` codes this phase, not one.** The plan's header states
  "exactly **one** new `RuleViolated` code is minted (`audit_forbidden_field`
  …)" and Step 4's verification command is written to expect exactly one
  matching line from `git diff 6661991 -- app/`. Run as written, that
  command returns **three** added lines, not one: `audit_forbidden_field`
  (once) and `audit_nesting_too_deep` (twice — the array-depth guard and
  the encode-failure guard in `AuditSecrets::walk()`/`toWalkable()`).
  Neither code nor its `lang/vi/rules.php` sentence existed at baseline
  `6661991` (`git show 6661991:lang/vi/rules.php` has no `audit_` entries
  at all) — both are genuinely new, and
  `tests/Unit/Catalogue/RuleViolatedCodesHaveSentencesTest.php`'s own
  canonical list already names both explicitly, so the shipped code and
  its test were correct throughout; only the plan's prose and its
  verification-command comment were wrong. This is exactly the failure
  shape this file exists to catch — a plausible count, never run — and is
  recorded here rather than silently corrected, per this task's own
  brief ("the file has been factually wrong six times, always the same
  way").
- **No test in this suite would catch a regression in three places, named
  plainly rather than assumed safe:**
  - **Swapping the two dashboard stat cards' values is invisible to
    every gate**, restated from Phase 1c's own frontend-rendering gap:
    `DashboardScreenTest.php` asserts on `dashboard.counts.overdue` /
    `dashboard.counts.pendingRegistrations` as server-side Inertia props
    only; nothing in this repo renders `dashboard.tsx` and reads back
    which number sits under which Vietnamese label, so a mis-wired
    `<StatCard>` prop ships green.
  - **A future command that writes real data into `context` ships
    unaudited by `AuditSecrets`** until `assertNoSecrets` is deliberately
    widened to a third argument — nothing today would fail if that
    widening were skipped, because no shipped writer exercises the gap.
  - **The CSV export's ~100k-row horizon has no test that would fail
    as a shelf approaches it** — `ExportHttpTest.php` exercises small
    fixtures only; the memory/time behaviour at scale is asserted in
    this document, not by any test that could go red.

---

## Phase 2a — Requests and holds

Recorded per task as it lands, not at the end of the phase.

- **`ApproveBorrowRequest` accepts an unvalidated `$copyId`, and a
  malformed one is a 1267, not a refusal.** The Action takes the copy id
  as a raw string because it comes from a form field, not a route
  binding; `find()` on a well-formed id that names nothing — including
  another shelf's copy and a soft-deleted one — is `copy_not_found`, as
  intended. A *malformed* id is a different outcome: `book_copies.id` is
  `ascii_bin`, so comparing it against a `utf8mb4` bind parameter raises
  errno 1267, "Illegal mix of collations", and the caller gets a
  `QueryException` rather than a named refusal. Measured, not inferred
  from the column type — `BookCopy::query()->find('🙂')` against the live
  MariaDB 10.11 container returns exactly that. This is the same shape as
  the `ascii_bin` 500s Phase 1c chased six times, and it is deliberately
  *not* fixed inside the Action: Task 14's Form Request is where the
  `uuid` rule belongs, so the emoji becomes a Vietnamese validation
  message on the way in. **CLOSED for the HTTP path by Task 14**, which
  wired the only route that reaches this Action
  (`POST .../manage/borrow-requests/{borrowRequest}/approve`) behind
  `ApproveBorrowRequestRequest`'s
  `copy_id => ['bail', 'required', 'string', 'uuid']`. Verified by
  mutation rather than by reading: deleting the `uuid` token and nothing
  else, then posting `copy_id='🙂'` over HTTP, produced exactly
  `SQLSTATE[HY000] 1267` from the `lockForUpdate()->find()` — a red test
  and a live 500 — and restoring it turned the same post into a
  `copy_id` field error. The Action itself still does not validate its
  argument, so **a future second caller must bring its own guard**; that
  is what stays open here.
- **…and the test that looked like it guarded that absence guarded less
  than its name suggested — now moot, and replaced.**
  `CirculationArchitectureTest`'s "HandoverRequest and the borrow-request
  commands have no route" asserted only that no registered URI contained
  one of three literal fragments — `handover`, `borrow-requests/{`,
  `requests/{`. A queue route spelled `…/manage/queue/{request}/approve`
  contained none of them and would have shipped green. Task 12 removed
  `requests/{` and Task 14 removed the loop entirely, replacing it with a
  PRESENCE pin that names each borrow-request route by route NAME and
  asserts `role:manager` on each — naming rather than counting, which is
  why Task 18 could add one to that list without falsifying anything (this
  sentence read "the four routes" until the whole-branch review, by which
  time there were five) — a check with no fragment-spelling hole in it,
  because a route registered under a different name simply is not the
  route the nav links and the controller redirect to. And the general
  case the old fragment loop could not reach IS covered, by a test in
  another file: `RouteOrderTest`'s "puts a role: middleware on every route
  under /manage" walks every route with a literal `manage` path segment
  and requires a `role:` gate on each, so a FURTHER circulation route added
  under `/manage` with any spelling at all goes red without a gate. What
  remains uncovered is a manager-ish route declared OUTSIDE `/manage`;
  nothing sweeps for that.
- **A same-instant tiebreak cannot be falsified by row order on MariaDB
  for this query's shape, at the row counts any fixture in this
  codebase currently uses — the mechanism is filesort behaviour, not
  the clustered primary key, and the earlier "unordered scan already
  returns creation order" entry above (Phase 1b) is necessary but not
  sufficient here.** That earlier entry's house rule — seed a tiebreak
  test in the WRONG order, force a genuine collision — is exactly what
  `BorrowRequestQueueQueryTest`'s 28-row fixture does (ported verbatim
  from the reference's `borrow-request-queue.test.ts:367-452`: four
  titles folding to three values, seven requests per book, ids
  decoupled from insertion order by construction). It still doesn't
  work: dropping `orderBy('borrow_requests.id')` — or, independently,
  `orderBy('books.id')`, the OTHER tiebreak, between two same-titled
  books — from both the ROW_NUMBER() window and the outer order leaves
  every assertion in that test green. The reference's own fixture is
  discriminating on POSTGRES only because it deliberately pushes past
  "the seven-tuple threshold below which Postgres sorts with a stable
  insertion sort" into an UNSTABLE sort that actively reorders ties (its
  own comment, `:370-390`); MariaDB's in-memory filesort does the
  opposite at this row count — it PRESERVES input order for a tied
  group — so a query with the tiebreak and the same query with it
  silently deleted produce the identical sequence. (A first pass at this
  explanation, in an earlier round of this task, blamed InnoDB's
  clustered primary key instead — that's only half right: it describes
  why a bare single-table scan's INPUT is already PK-ordered, not what a
  five-table join under a window function does with that input once
  MariaDB has to filesort it, which is the actual query under test.)
  BOUNDED, not absolute: this holds only while the filesort stays
  in-memory and order-preserving. Untested here: a row count large
  enough to spill the sort buffer into merge passes (not guaranteed
  stable), or a query-plan change that reorders the join before the sort
  runs. What a same-instant tiebreak test should do instead of scaling
  the fixture further to chase that: pin the tiebreak in the GENERATED
  SQL, not in the output — `DB::enableQueryLog()`/`getQueryLog()`
  (sound only for a statement that returns, per the entry above on that)
  around the call, asserting the captured query string contains the
  `ORDER BY … id ASC` clause verbatim.
  `BorrowRequestQueueQueryTest`'s "pins the tiebreak in the SQL itself"
  test is the worked example; `app/Queries/BorrowRequestQueueQuery.php`'s
  own docblock carries the short version.
- **`php artisan tinker` does not go through `phpunit.xml`'s
  `force="true"` DB overrides, so a diagnostic run there hits the real
  dev database (`olibra`), not `olibra_testing`.** Found running down
  the entry above: two `tinker --execute=...` sessions (a five-row
  single-table probe, then a query-log capture) both created and left
  real rows in `olibra` — three bookshelves (`diag-shelf`, `diag-sql`,
  `diag-sql2`) and their books/copies/memberships/borrow_requests/users
  — because tinker boots the ordinary `.env`-configured connection, and
  none of the `<env>`/`<server>` overrides this file's own `phpunit.xml`
  section documents (the ones that keep `php artisan test` off the dev
  database even when a stray `DB_DATABASE` sits in the shell) apply to
  it. Cleaned up by hand afterward (`DB::table(...)->delete()` in FK
  dependency order, verified gone with
  `Bookshelf::withTrashed()->where('slug', ...)->exists()`), but nothing
  stops the next agent from forgetting to, or from a tinker session that
  crashes mid-diagnostic and leaves rows behind with no error to notice
  by. `php artisan tinker --env=testing` does not fix it either — this
  project's protection is the `<server>` block's unconditional
  `$_SERVER` overwrite inside PHPUnit's own bootstrap, which tinker
  never runs. Whoever needs to run an ad hoc query against the test
  schema should migrate `olibra_testing` and point `DB_DATABASE` at it
  for that one shell session, or write the probe as a real (throwaway)
  Pest test instead of reaching for tinker.
- **Task 12's book-page request block is unverified by every gate in this
  repo, and the specific thing that ships green is the wrong Vietnamese
  label on the "Xin mượn" button.** `resources/js/pages/shelves/book.tsx`
  gained the request/cancel block, and nothing renders it: there is no
  `*.test.tsx` anywhere under `resources/js` (`find resources/js -name
  "*.test.ts*"` returns nothing), and `package.json`'s `test` /
  `test:watch` scripts both `cd old_next` first, so the only vitest in
  this repo runs against the frozen Next.js app. `assertInertia` in
  `ReaderRequestSurfaceTest` reads the server-side props
  (`detail.myRequest.*`, `errors.rule`) and stops there — it never sees
  which string the button renders or which id the cancel form posts.
  Measured rather than assumed, on this branch: swapping the two arms of
  the availability ternary — so a title with copies free offers *Đăng ký
  chờ mượn* and one with none offers *Xin mượn* — left **every gate this
  repo has green**: `make test` fully passing with no test reddened by the
  swap, `laravel:typecheck` clean, `laravel:lint` at its pre-existing
  warning set and `laravel:build` successful. Restored. (Stated as "no
  test reddened" rather than as a suite total on purpose: a count goes
  stale the next time anyone adds a test, and this entry's claim must not
  go stale with it — the point is that nothing in the suite can see the
  swap at all.) This is the same shape as the dashboard stat-card entry
  above, now with a second worked example; it is a gap in the toolchain,
  not in this task, and closing it means a frontend rendering test setup
  for `resources/js`, which no phase has scoped yet.
- **Task 16's notifications page and header bell are unverified by every
  gate in this repo, for the same toolchain reason as the two entries
  above.** `resources/js/pages/shelves/profile/notifications.tsx` and the
  bell link in `resources/js/layouts/app-layout.tsx` are structurally
  untested: `MyNotificationsTest`'s `assertInertia` reads `mine.unread` and
  `unreadNotifications` and stops there, so it never sees which string a
  row renders, whether the unread tint and the word *Mới* both appear, or
  which notification id a row's form posts. What IS pinned server-side —
  and was chosen deliberately for that reason — is *who gets a bell at
  all*: `unreadNotifications` is `null` for a guest, for a page with no
  shelf bound and for a signed-in non-member, and the layout renders the
  link on `!== null` rather than deciding membership itself. The first
  draft of that layout condition (`shelf && auth.user`, as the brief
  specified) put the link in front of a signed-in non-member on the
  shelf's ungated `feedback` page and 404'd them; that is now two test
  blocks, not a comment.
- **`unreadNotifications` is lazy, and "lazy" here means per-render, not
  per-session.** A callable shared prop is resolved by `Inertia\PropsResolver`
  only while an `Inertia\Response` is built, so no non-Inertia response —
  a `back()` redirect, a streamed CSV — runs the count. It DOES run one
  `count(*)` on every Inertia page render, measured by `MyNotificationsTest`
  in both directions (zero count statements on the mark-all POST; exactly
  one on the profile overview, whose controller never asks for
  notifications). Replacing the closure with its value reddens the first of
  those two blocks — verified by making that exact mutation, not inferred
  from the framework.
  **That count needed an index, which this task shipped rather than
  deferred — and the entry this replaces got the cost wrong in the
  reader's favour.** `read_at` was in no index at all (the postgres
  original's was partial, `where read_at is null`, and
  `2026_08_26_000014_create_notifications_table.php` dropped the predicate
  because MariaDB has no partial index), so EXPLAIN of the real statement
  over 400 rows spread across two shelves returned `type: ALL, key: null,
  rows: 400, Extra: Using where` — both existing indexes offered in
  `possible_keys` and both rejected. The first version of this entry called
  that "bounded by one shelf". **It was not, and that is the correction
  that mattered:** a `type: ALL` scan reads every physical row in
  `notifications` across every bookshelf sharing the database, and
  `BookshelfScope` contributes an ordinary WHERE clause applied *after* the
  scan, never a scan boundary. `rows: 400` is the whole table, not the
  ~200 belonging to the shelf under test. On a deliberately multi-tenant
  install (`docs/BUSINESS-REQUIREMENTS.md:57` and `docs/SDD.md:228`, both
  of which describe Phase 1 as "one tenant among many" — the point of the
  shared cPanel hosting target) that meant every shelf's readers paying for
  every other shelf's notification volume, on every page render, growing
  with the install rather than with the parish.
  `2026_08_30_000001_add_notifications_unread_by_user_index.php` adds
  `notifications_unread_by_user (user_id, read_at)`. Re-measured on the
  same 400-row fixture: `type: index_merge, key:
  notifications_unread_by_user,notifications_bookshelf_id_foreign, rows:
  66, Extra: Using intersect(…); Using where; Using index` — covering (no
  table rows read at all) and bounded by one user's unread rows, which does
  not grow with other tenants. **No residual worth recording:** a
  hypothetical three-column `(user_id, read_at, bookshelf_id)` was measured
  side by side and plans as a single `type: ref … rows: 67` seek — the same
  bound, for a wider index, so the two-column shape ships.
  The list query was re-measured after the migration too, because a new
  candidate index can move a plan nobody meant to move: unchanged at `type:
  range, key: notifications_unread, rows: 200`, with the new index in
  `possible_keys` and not chosen, and **still no `Using filesort`**.

- **The sweep is registered and the scheduler ticks; nobody has watched it
  fire at 07:00.** `php artisan schedule:list` in `laravel-app-1` prints
  `0 0 * * *  php artisan reminders:sweep` — `0 7 * * *` in
  `Asia/Ho_Chi_Minh` rendered in the app's own UTC — beside the per-minute
  queue tick, and `docker compose logs scheduler` shows that tick running
  each minute, so `schedule:work` is live and reading this file. What has
  NOT been observed is a real 07:00 boundary crossing with the command
  actually invoked: that was not waited for, and `schedule:test`
  or a hand-run would have written notification rows into the development
  database, which is not a thing to do casually. The reference's recorded
  failure was exactly this shape — a sweep "written, tested, callable, and
  never once invoked in any deployment" (OPS §7) — so it is written down
  rather than assumed closed. Related and pre-existing, not introduced
  here: `laravel-scheduler-1` reports `unhealthy` because it inherits the
  php image's healthcheck (a curl against Caddy's admin port 2019) while
  running `schedule:work` and no web server. The process is alive and
  ticking; the healthcheck is measuring the wrong thing.

- **The sweep's idempotence key includes the book's TITLE, so a corrected
  title re-tells the reader.** "Already told" is whatever
  `SweepReminders::tell`'s existence probe matches on — read that method's
  `where` clauses for today's key rather than a copy of them here; the
  clause this entry is about is `payload->title`. (An earlier draft did
  restate the key as a list and left `bookshelf_id` out of it, so this
  document described one probe two different ways: the shelf clause has
  its own entry below, as this phase's deliberate divergence from the
  reference.) The title clause is the reference's own predicate, ported
  deliberately — `sweep.ts`'s `not exists` keys on
  `b.title` too — and it is what lets the notification itself be the
  cursor instead of a `last_swept_at` that can drift or be rolled back by
  a restore. The consequence is real and untested in either codebase: fix
  a typo in a title between two runs and the borrower gets a second row of
  the same kind for the same loan. Not fixed here (changing the key is a
  behaviour change from the reference, not a port), recorded so the next
  person meets it as a known property rather than a bug report.

- **The sweep joins `books` through the query builder, which does not
  apply the model's soft-delete scope.** `SweepReminders` selects
  `loans.* , books.title` with `->join('books', …)`, the same shape as the
  reference's SQL, so a loan whose book row carries `deleted_at` is still
  swept and its notification still carries that title. There is no test
  for it. Reaching that state needs the already-recorded `DeleteBook`
  race (Phase 1c section, PR #62 finding 4) — the command's own
  `whereDoesntHave('loans')` refuses a title with loans otherwise — and in
  that state telling the borrower their book is overdue is arguably the
  right behaviour anyway, which is why it is a note and not a fix.

- **`MyDashboardQuery` joins `books` with no `deleted_at` guard where the
  manager's queue has one, so one soft-deleted title would be visible to
  the reader and invisible to the manager. A deliberate note, not a
  fix.** Every join in that query is a raw builder join — `->join('books',
  …)` and `->join('book_copies', …)` — and a builder join does not apply
  the joined model's `SoftDeletes` scope, the same mechanism the sweep
  entry above records. `BorrowRequestQueueQuery::waiting()` writes the
  guard by hand (`->whereNull('books.deleted_at')` inside the join
  condition, and the same for `users`), so the two surfaces would disagree
  about one row: a live request against a soft-deleted title drops out of
  the manager's queue and stays on the reader's dashboard, where its title
  links to a book page that 404s. **Unreachable today**, for the reason
  recorded in the Phase 1c section: `DeleteBook` is reachable from no
  screen, and its own `whereDoesntHave('loans')` refuses a title with
  loans anyway. **Left as it is, on purpose.** Making the dashboard match
  the queue would take the reader's own pending request off their screen
  and with it the only button that withdraws it, leaving a row nobody but
  a manager can clear; the reader keeping the ability to cancel is the
  behaviour this phase would choose if it were choosing. What was wrong is
  that it looked accidental — a hand-written guard on one side and silence
  on the other, with nothing saying which was intended. This is that
  statement. Whoever wires `DeleteBook` to a screen owns the decision
  again, and the dead LINK is the part to fix then: either the join grows
  the guard and the row goes with it, or the dashboard renders a deleted
  title as plain text instead of a link.

- **The idempotence probe's plan, measured on the statement the command
  actually emits, not on a probe shaped like it.** Captured with
  `DB::listen` during a real `Artisan::call('reminders:sweep')` over 2,401
  seeded notification rows spread across 12 shelves and 480 readers, then
  `EXPLAIN`ed with its own bindings:

  ```
  select exists(select * from `notifications` where `user_id` = ? and `kind` = ?
    and json_value(`payload`, '$."due_on"') = ? and json_value(`payload`, '$."title"') = ?) as `exists`
  → type: ref | key: notifications_unread | key_len: 38 | ref: const | rows: 6
    Extra: Using index condition; Using where
  ```

  A `user_id` ref seek, not a scan: the two JSON predicates are residual
  filters over one reader's own rows. `notifications_unread_by_user`
  (Task 16's) appears in `possible_keys` and is not chosen — the older
  `notifications_unread (user_id, created_at)` wins on the same leading
  column. No new index is warranted, and no claim is made here that any of
  this is bounded by one shelf: it is bounded by one USER, in a database
  shared by every tenant. One caveat worth stating: `rows: 6` is that
  fixture's per-reader notification count, so it is evidence about the
  ACCESS PATH, not a figure that transfers to a real install.
  The probe runs once per candidate loan — N seeks per sweep, not one.

- **The sweep's two candidate reads are full scans of every tenant's
  loans, measured and accepted rather than indexed.** An earlier version of
  the entry above said these were not EXPLAINed "because the sweep's
  candidate volume is a shelf's active loans". Both halves of that were
  wrong: the reads run under `actSystemWide()`, so the volume is EVERY
  shelf's active loans, and they cannot be seeks — `loans` carries
  `loans_active_by_shelf (bookshelf_id, due_on)` and `loans_by_borrower
  (borrower_id, lent_at)`, and a cross-shelf sweep filters on the leading
  column of neither. Measured with `DB::listen` during a real
  `Artisan::call('reminders:sweep')` over 600 active loans spread across 10
  shelves, then `EXPLAIN`ed with their own bindings:

  ```
  select `loans`.*, `books`.`title` from `loans`
    inner join `books` on `books`.`id` = `loans`.`book_id`
    where `status` = ? and `due_on` >= ? and `due_on` <= ?     -- due-soon
  select `loans`.*, `books`.`title` from `loans`
    inner join `books` on `books`.`id` = `loans`.`book_id`
    where `status` = ? and `due_on` < ?                        -- overdue

  loans → type: ALL  | possible_keys: NULL | key: NULL | rows: 600 | Extra: Using where
  books → type: eq_ref | key: PRIMARY | key_len: 38 | ref: loans.book_id | rows: 1
  ```

  `possible_keys: NULL` is the sharp part: neither index is so much as a
  candidate. **Not fixed, deliberately.** The cost is two scans per DAY, in
  a job nobody waits on, whose whole design premise is that being hours
  late is survivable — the opposite of the bell's unread count, which paid
  a scan on every page render and correctly earned an index in Task 16. A
  `(status, due_on)` index would turn both into range seeks and is the
  obvious move if a real install ever makes the nightly run slow enough to
  notice; nothing has measured that it does. `rows: 600` is the fixture's
  whole loans table, so it is evidence about the ACCESS PATH — a scan whose
  cost grows with the install rather than with a parish — not a figure that
  transfers.

- **The sweep's idempotence key includes `bookshelf_id`, and that is a
  deliberate divergence from the reference.** `sweep.ts`'s `not exists`
  keys on user, kind, `due_on` and title only, which is safe there because
  its `set local role` still names one shelf. This probe runs with
  `BookshelfScope` switched off. Since a person can hold memberships on
  more than one shelf (see "`User` is deliberately global" above), the
  reference's key applied cross-shelf means one reader with the same title
  due the same day on two shelves is told **once**, filed under whichever
  loan the sweep reached first — and `MyNotificationsQuery` being
  shelf-scoped, the other shelf's bell never shows it at all. Measured by
  removing the clause: `SweepIsHousekeepingTest`'s crossing block reports
  `Sweep complete: 0 due-soon, 1 overdue notification(s).` where it must
  report 2. Silent suppression of a real reminder is a worse trade than the
  duplicate row fidelity would have bought, so the divergence ships. It
  also puts a hand-written `bookshelf_id` filter in the file, which is why
  `TenancyArchitectureTest`'s allow-list now names it — the same situation
  `AuditLogQuery` is in, reached from the other direction (that model is
  unscoped; this caller is).

  **That exemption has a cost, and it is whole-file, not per-clause.**
  `SweepReminders.php` today holds exactly one hand-written `bookshelf_id`
  filter. Any *second* one a later edit adds is now silent — correct or
  mis-scoped alike — where before it would have failed the build and forced
  an explicit justification in the allow-list. This matters more here than
  it would in an ordinary shelf-scoped file: the sweep runs under
  `actSystemWide()`, so there is no `BookshelfScope` underneath to make a
  rogue `where()` redundant-but-harmless. It was one of the few automated
  backstops on manual-filter correctness in the file with the widest blast
  radius. Reviewing a change to that file now means reading its filters by
  hand. The whole-file shape was kept for consistency with `AuditLogQuery`
  rather than because a per-clause tripwire was weighed and rejected;
  per-clause is the fix if a second filter ever lands. The cost is written
  at the allow-list entry itself as well, so the next person to edit either
  file meets it there.

- **The sweep's fourth read, the per-shelf `due_soon_days` lookup, was
  never measured.** `Bookshelf::query()->get()` in `SweepReminders::handle`
  reads every shelf on every run — cross-tenant like the rest of the
  command, so its cost grows with the install rather than with a parish —
  and no `EXPLAIN` was captured for it. The judgement was that
  `bookshelves` is small and this runs once per sweep, not once per row;
  that is a judgement, not a measurement, and it is recorded rather than
  folded into the "the reads are measured" sentence in the command's own
  docblock (which an earlier draft of that docblock did do).

- **The transaction-placement guard is structurally vacuous for the sweep,
  in both directions.** `NotificationsAreReaderFacingTest`'s walk
  pre-filters on `str_contains($code, '->notify')`, which
  `SweepReminders.php` does not contain, and the per-file call-site floor
  exempts it by name. Moving its `Notification::query()->create` outside
  `DB::transaction` leaves the whole suite green — the guard's own docblock
  says "no silent pass is known", and this is one file that sentence cannot
  speak about. Tolerated rather than plugged: the sweep's writes are
  idempotent per shelf/user/kind/`due_on`/title, so a half-committed run
  self-heals on the next tick, which is precisely the property a command
  announcing a state change does not have. Noted at the exclusion itself so
  the next reader of that guard meets it there.

### The Phase 2a wrap-up — the OPS walk and what it contradicted

Written by Task 19 after the full suite ran green, and after the branch
was walked by **opening each named file**, which is the 1c precedent. Two
things the walk found are corrections to claims this branch was already
shipping; they are stated first, because a wrap-up that leads with its
disposition table buries them.

- **The reachability walk for divergence 13 does not work, and the shipped
  test comment that claimed it did is now corrected.**
  `tests/Feature/Circulation/LendCopyHoldTest.php` said the
  `available`-copy-under-a-live-hold row is "reachable with shipped 1a
  commands: approve onto this copy (held), `ReportCopyLost` (lost, the
  request still approved with a live hold), `MarkCopyFound` (available)".
  **It is not.** `CopyStateMachine::ALLOWED` draws no `held -> lost` arrow
  — BR §7.1 draws only `on_loan -> lost`, and Q3 is written into the class
  docblock — so `ReportCopyLost` on a held copy throws `copy_not_on_loan`
  and the walk stops at step two. RUN, not read: a throwaway Pest block
  against the real MariaDB executed
  `ApproveBorrowRequest` -> `ReportCopyLost` and printed
  `PROBE: ReportCopyLost REFUSED with code: copy_not_on_loan`.
  A neighbouring file had it right the whole time —
  `ApproveBorrowRequestTest`'s two-clause block says "No shipped command
  produces available+held-for … Constructed directly" — so the branch was
  carrying **two comments that contradicted each other**, and the walk's
  job was to find out which one had been run. See the divergence 13 entry
  below for what this changes and what it does not.
- **`request_not_held`'s OPS §4.2 status is not what the plan's divergence
  12 says, in both directions.** Divergence 12 states that the code "has
  **no** failure-mode entry under any OPS §4.2 command", and defends that
  by saying OPS "states `HandoverRequest`'s failure modes as the
  `/errors.ts` disjunction rather than enumerating them". Opening
  `docs/OPERATIONS.md`: (a) `ReleaseExpiredHold`'s §4.2 entry — added by
  Task 18's own permitted amendment, earlier on this same branch —
  **enumerates `request_not_held` with its Vietnamese sentence**, so the
  first half went false inside this phase; and (b) `HandoverRequest`'s
  entry is a **plain enumerated list** — transcribed from the file:
  `hold_expired`, `membership_not_active`, `loan_limit_reached`, with
  `request_not_held` absent from it — and the string `errors.ts` does not
  appear anywhere in `OPERATIONS.md`
  (`grep -n "errors.ts" docs/OPERATIONS.md` returns nothing), so the
  justification describes a document that does not exist.
  **What is actually true, and what stays open:** `HandoverRequest` throws
  `request_not_held` from several branches (`grep -n "request_not_held"
  app/Actions/Circulation/HandoverRequest.php`) and its OPS entry does not
  list it. That is an incomplete enumerated list, not a deliberate
  disjunction — a smaller gap than divergence 12 described but a real one.
  **It is a documentation lag, not a contract change.** The shipped command
  already throws the code, `lang/vi/rules.php` already carries its
  Vietnamese sentence, and `RuleViolatedCodesHaveSentencesTest` already
  censuses it: nothing about the command's behaviour would move. So closing
  it is **one row added to one table in `docs/OPERATIONS.md`**, not an
  amendment to a contract — which matters, because this plan's
  one-amendment budget was written for contract changes and Task 18 spent
  it on one. **Not fixed in this commit** only because a wrap-up commit is
  the wrong place to edit a shipped command's OPS entry unannounced; it
  belongs in the PR as a one-row edit.
- **`MarkNotificationRead` ships without the audit action OPS §4.6 names,
  and that divergence was not on the durable record.** OPS §4.6 lists
  `notification.read` as the audit action for both doors. The shipped
  Action writes none, and its docblock argues the case (the audit map is
  the type, so the action would need a Vietnamese sentence for something
  that is not a business fact about the shelf; one row per bell tap buries
  every real entry; `read_at` is recoverable from nothing and visible only
  to its owner). The argument is the reference's own and it is a good one.
  What was missing is that nothing outside that docblock said OPS had been
  diverged from — `grep -rn "notification.read" docs/` found it only in
  `OPERATIONS.md` and in plan files. Recorded here so the next OPS walk
  meets it as a decision rather than as a discrepancy.

**The disposition table.** Every row below was checked by opening the file
named in it, not by reading it off the plan.

| Entry | Disposition |
|---|---|
| `CreateBorrowRequest` / `ApproveBorrowRequest` / `RejectBorrowRequest` / `CancelOwnRequest` / `HandoverRequest` | shipped (Tasks 4–9); each opened, each under `app/Actions/Circulation/` |
| `ReceiveReturn` | RE-WIDENED to the reference's full shape (Task 10) — the 1c narrowing entry is struck above, with its own note |
| `SkipRequest` | closed WITHOUT implementation: the product owner removed *Bỏ qua* from the reference (queue page comment block, 2026-08-09); *Từ chối* is the one manager decision on a pending row. No Action, controller method or route implements it; the sole occurrence of the name under `app/` is `BorrowRequestController`'s comment recording its removal, and `php artisan route:list | grep -i skip` is empty |
| `ReleaseExpiredHold` | shipped (Task 18) on ruling 1, with its own OPS §4.2 entry written in that task's commit — the one amendment this plan permitted |
| `request_not_held` in OPS §4.2 | **stated, not covered over** — see the correction above; it IS enumerated (under `ReleaseExpiredHold`) and is NOT enumerated under `HandoverRequest`, which throws it. A documentation lag against a contract that already ships the code — one added table row, not an amendment |
| `ChooseCopy` vs `CountsCopies::borrowable()` | dispositioned (divergence 14) — the amended 1c entry above carries the resolution and the test that pins it |
| `GetBorrowRequestQueue`, `GetMyNotifications`, `GetMyDashboard` (requests half), `MarkNotificationRead`/`MarkAllNotificationsRead` | shipped. One shape note: OPS §4.6 names two commands and the code ships **one** Action with `one()` and `all()`, reached by two routes and two controller methods — the contract is met, the file count is not what OPS implied |
| the sweep | shipped as `reminders:sweep`, scheduled 07:00 `Asia/Ho_Chi_Minh` from `routes/console.php`; removing the `Schedule::command` line reddens exactly one test and nothing else (measured) |
| `CreateBorrowRequest`'s `copyId` | NARROWED — 2c restores it with the scan pages. The reference's exact behaviour to restore: a nullable copy of the same title, same shelf, not deleted; the `request.created` audit bag's `copy_id` fills instead of staying null |

- **`CreateBorrowRequest` takes no lock at all, and the record of why is
  worth more than the design.** The plan's first version had it take a
  `books` `FOR UPDATE`. That was withdrawn (design change C1) because
  `UpdateBook` exclusive-locks the shelf's `bookshelves` row as its
  transaction's first statement and then writes the book row, while every
  insert here wants a SHARED lock on that same `bookshelves` row through
  `borrow_requests_bookshelf_id_foreign` — an AB–BA the review found by
  reading `UpdateBook`'s transaction against the composite-FK migration,
  not by running it:

  ```
  T1 UpdateBook:            X bookshelves  ->  ... -> writes books row
  T2 CreateBorrowRequest:   X books (the withdrawn lock)  ->  insert
                            -> wants S bookshelves (the FK)
  ```

  The rejected alternative was "serialise on `bookshelves` instead", and
  it was rejected for ONE reason, stated so nobody re-proposes it: it
  joins the users-actor cycle already recorded in the Phase 1c section
  above (`UpdateReaderProfile`/`SetReaderCredentials` X `users` -> audit
  insert -> S `bookshelves`, against X `bookshelves` -> audit insert ->
  S `users`), which was **reproduced with two real OS processes** and a
  genuine InnoDB 1213. What replaced the lock is a constraint:
  `borrow_requests.live_request_key`, a STORED generated column under a
  unique index, whose 1062 goes through the shipped
  `UniqueViolation::translate` and comes out as the same
  `duplicate_request` sentence the friendly pre-read produces.

  **And the sentence that did NOT survive being run, recorded rather than
  deleted.** The justification originally offered for refusing the
  `bookshelves`-first design was "option 2 would serialise every *Xin
  mượn* behind a bulk `AddCopies`". That is **false**:
  `borrow_requests_bookshelf_id_foreign` makes the insert wait on that
  shelf row either way, which the "implicit FK shared locks" entry in the
  Phase 1c section above already records. Measured during the plan review
  with two live transactions: ~3 s behind a held `FOR UPDATE`, with the
  no-lock design in place. The design was right and one of its reasons was
  wrong; this file has been factually wrong the same way often enough that
  an entry naming which of its own sentences failed is worth more than one
  that states only the survivor.

  **No cycle-freedom claim is made anywhere on the 2a branch**, and the
  lock claim is stated as exactly what it is: `CreateBorrowRequest`
  contains no `lockForUpdate` (pinned by Task 4's source grep and its
  query-log filter), which is NOT the same as taking no exclusive lock.
  Its INSERT holds an implicit exclusive record lock on the unique index
  entry; a racing insert blocks on it until commit and then receives 1062
  — measured at Task 4, where the loser waited ~3 s before its verdict.
  Both outcomes resolve to the same Vietnamese sentence.

- **Divergence 13: an `available` copy under somebody else's live hold is
  lendable, ported faithfully — and no command walk to that state has been
  found, by this task or by its reviewer.** `LoanRules::copyLendable`'s
  `Available` branch returns `null` without looking at holds; the
  reference does the identical thing (`policy.ts:86-108`), so this is a
  ported hole, not an invented one. `ApproveBorrowRequest` refuses such a
  row (its own two-clause predicate, with a named test); `LendCopy` does
  not, and neither does the reference.
  **What changed at this task is the reachability half.** The claim that
  approve -> `ReportCopyLost` -> `MarkCopyFound` reaches it is false (see
  the correction at the head of this section). What blocks **that** path is
  BR §7.1's transition table — one path, demonstrably, and worth saying
  plainly because **nobody wrote that table as a guard for this**:
  `CopyStateMachine`'s own Q3 note calls widening the arrows into `lost`
  "one line here plus one test", and that one line would open that path for
  real. Whether any OTHER path exists is a search result, not a theorem:
  neither this task's walk nor its reviewer's independent one found one,
  and both are searches. The walk also read every command under `app/Actions` that
  writes `CopyState::Available` (`grep -rn "CopyState::Available"
  app/Actions/` is the check, re-runnable): each of them either ends the
  request in the same transaction as the release, or cannot be reached
  from a `held` copy at all. That is a property statement about what was
  read, not a proof that no path exists.
  **What IS guarded, regardless:** such a lend never closes the other
  reader's request. `LendCopyHoldTest`'s "…and that lend NEVER closes the
  other reader's request" pins it, against a row the fixture constructs
  directly — which is now the honest description of that fixture rather
  than a workaround for one.

- **Divergence 1: the cancel window's lock-order inversion is real,
  admitted, and now on the durable record** (held since Task 7 so that two
  writers would not produce two entries for one fact). Task 8 CREATED an
  AB–BA edge that did not exist in Phase 1: `LendCopy` holds the copy lock
  and then locks a `borrow_requests` row (the collected-hold close), while
  `CancelOwnRequest` locks the request FIRST and takes the copy's row lock
  second — its guarded release is an `UPDATE ... WHERE state = 'held'`,
  and an UPDATE takes an exclusive row lock — whenever the route-bound
  snapshot names no copy, because the pre-emptive `BookCopy` lock at the
  top of its transaction is guarded on `$snapshotCopyId !== null`. Same
  (copy C, request R) pair, opposite order.
  **Original ruling: accepted, not fixed** — "there is no better ordering
  inside one transaction without a retry loop", and the consequence if it
  fired was an InnoDB 1213 arriving as a `QueryException` that nothing
  translated (`UniqueViolation` handles 1062 only), rolling the whole
  transaction back so the caller saw a server error rather than a
  Vietnamese sentence. That last clause is what the owner asked to be
  changed, and it has been.

  **AMENDED 2026-08-30, post-plan, at the product owner's request — the
  edge is NOT gone; what is gone is the crash.** This entry is amended
  rather than deleted, because everything above it about the lock graph is
  still exactly true: the inversion still exists, the pairings named below
  are still the pairings, and nothing about the ordering changed. Two
  things were added instead, and they are the retry loop the ruling above
  named as the only alternative:

  1. **Every Action under `app/Actions/Circulation/` that opens a write
     transaction now passes an attempts argument** —
     `ConcurrencyRetry::ATTEMPTS`, three. Laravel's
     `Connection::transaction($callback, $attempts)` runs the callback in a
     loop and its `handleTransactionException` *returns* instead of
     rethrowing — after rolling the whole transaction back — exactly when
     the framework's `ConcurrencyErrorDetector` matches and attempts
     remain. A rolled-back transaction has persisted nothing, so the
     re-run starts from the committed state, re-takes its locks and
     re-reads its rows. **The rule is deliberately the whole directory, not
     the four commands the analysis above names as cycle participants** —
     the reachability argument for this edge has now been wrong twice (the
     plan's, and the whole-branch review's, corrected in this very entry),
     so the fix must not depend on a third being right, and a new Action
     must not be able to become a silent non-retrying participant.
     `CirculationArchitectureTest` pins the property by tokenising every
     `transaction(` call site under the directory and requiring a second
     argument; it was measured red by deleting one Action's argument, and
     its own non-vacuity check was measured red by breaking the walk.
  2. **A lock-wait timeout is deliberately NOT retried, and the narrowing
     is by error class rather than by directory.** Laravel's
     `ConcurrencyErrorDetector` matches `'Lock wait timeout exceeded; try
     restarting transaction'` (errno 1205) alongside the deadlock strings,
     and the retry loop consults that same detector — so passing an
     attempts argument retried 1205 too, which is a REGRESSION on what it
     replaced rather than an improvement. The two failures differ in the
     only way that matters here: a deadlock fails instantly, a lock-wait
     timeout fails only after the whole timeout is burned. This project's
     own MariaDB was measured at `innodb_lock_wait_timeout = 50`
     (`SELECT @@innodb_lock_wait_timeout` against the running 10.11.19
     container), so three attempts would bind a wedged row at roughly 150
     seconds of held request — on a shared-hosting target where the PHP or
     proxy limit likely kills it first, and where the honest answer is a
     loud 500 naming the statement so an operator can find the stuck row.
     `AppServiceProvider` therefore binds `App\Support\DeadlockDetector`
     over `Illuminate\Contracts\Database\ConcurrencyErrorDetector`;
     because `DetectsConcurrencyErrors` resolves that CONTRACT from the
     container, one binding narrows the retry loop and the translation
     together. Narrowing by DIRECTORY was rejected for the same reason the
     rule above is a property: it would scope the fix to the commands
     currently believed to be on the cycle. Measured on the running
     container: with the binding in place, a 1213 runs the callback three
     times and a 1205 runs it once.
  3. **The residual is a sentence.** When the attempts are spent Laravel
     rethrows the original exception, which is a 500. `bootstrap/app.php`
     now maps a `PDOException` through `App\Support\ConcurrencyRetry`,
     which asks the same bound detector that decided whether to retry and —
     only on a yes — hands back `RuleViolated('busy_try_again', $e)`, which
     the existing `RuleViolated` render hook turns into the 302 carrying
     "Có thao tác khác đang xử lý cùng lúc, vui lòng thử lại." Everything
     the detector rejects comes back as the same object, so an ordinary SQL
     fault is still a server error with its statement in the log.
     `PDOException` rather than `QueryException` because Laravel raises a
     bare `DeadlockException` when the cycle is hit inside a NESTED
     transaction, which is every Feature test in this suite. The driver
     exception is passed as `$previous` because an exception captures its
     trace where it is CONSTRUCTED — for a mapped translation, inside the
     exception handler — so without the chain the log would lose the SQL
     *and* the throwing Action's frames, leaving an exhausted deadlock
     undiagnosable as to command. `RuleViolated` gained an optional
     `$previous` for this one caller, and
     `RuleViolatedCodesHaveSentencesTest`'s regex was widened from `\s*\)`
     to `\s*[,)]` so a two-argument throw stays in the census; that
     widening was measured both ways, the same way the file's first
     widening was (deleting the `rules.php` line goes red under the widened
     regex and stayed GREEN under the old one). The code is authored with
     no `errors.ts` spelling on the `hold_not_expired` precedent — sentence
     in `lang/vi/rules.php`, entry in OPS §6, literal in the census.

  **Still true, and stated so it is not read away by the amendment:** no
  frequency is claimed for this edge and none has been measured — three
  attempts is chosen for the SHAPE of the failure (InnoDB kills exactly one
  participant per cycle while the other commits, so a re-run loses again
  only if a fresh contender arrives in the same milliseconds), not from a
  rate. No cycle-freedom claim is made in either direction; this phase
  still built no two-OS-process harness, and `ConcurrencyRetryTest` does
  not pretend to be one — it exercises the retry loop, the detector's
  decision and the translation against the exception shape the MariaDB
  driver raises for errno 1213, not a real interleaving. **The retry makes
  the edge survivable; it does not make it absent.** If it should be
  designed away rather than survived, that is still a product decision.

  **Two residual bounds, so neither is discovered later as a surprise.**
  (a) `QueryException::formatMessage` inlines BINDINGS into the message it
  builds, and the message half of the detector is a substring match over
  that string — so a row whose own data spells one of the deadlock phrases
  can make an unrelated failure on that row translate as
  `busy_try_again`. Measured on the running container: a 1062 whose bound
  value was the literal `deadlock detected` came back as a `RuleViolated`.
  The SQLSTATE branch is immune, narrowing the phrase list shrinks the
  surface, and closing it entirely would mean re-implementing the driver's
  formatting; for this application's data it was judged not worth that.
  (b) `CirculationArchitectureTest`'s guard pins the CLOSURE spelling only.
  An Action written as `DB::beginTransaction(); … DB::commit();` opens a
  write transaction with no callback for an attempts argument to be the
  second argument of, so it would retry nothing and offend nothing.
  Nothing under `app/` uses that spelling today (`grep -rn
  "beginTransaction" app/` exits 1); if one appears, the walk has to learn
  that shape rather than be read as having covered it.

  **A third bound, and the one nobody would go looking for: the detector
  binding is APPLICATION-WIDE, and the transaction retry loop is not its
  only consumer.** `Illuminate\Cache\DatabaseLock` uses the same
  `DetectsConcurrencyErrors` trait to decide whether a failure against the
  `cache_locks` table is harmless — someone else already deleted the row —
  or a real error to propagate. This is a live path, not a theoretical
  one: `CACHE_STORE=database`, `DatabaseStore` is a `LockProvider`, and
  `routes/console.php` puts `withoutOverlapping(2)` on the per-minute
  `queue:work` tick. Read at the commit that records this:
  `DatabaseLock::release()` returns TRUE — the lock counts as released —
  when the detector matches and rethrows otherwise, and
  `pruneExpiredLocks()` swallows a match and rethrows anything else. So
  **a 1205 on `cache_locks` was swallowed before this binding and
  propagates after it.** A 1213 there is still swallowed, since this
  detector matches deadlocks; the flip is precisely and only about a
  lock-wait timeout on that one table, which would itself mean something
  held a `cache_locks` row for the whole 50 seconds while only short
  single-row statements ever touch it.

  Two precisions the obvious reading gets wrong, written down because the
  wrong one is the one a reader will reach first. (a) The scheduler's
  TEARDOWN does not go through `release()`: `Event::removeMutex` calls
  `CacheEventMutex::forget`, which calls `forceRelease()`, and that method
  has no try/catch and consults no detector — it propagated a 1205 before
  this binding and still does, unchanged. What puts `release()` on the
  per-minute path instead is the SKIP FILTER — `withoutOverlapping`
  registers `skip(fn () => $this->mutex->exists($this))`, `exists()` calls
  `$store->lock(...)->get(fn () => true)`, and `Lock::get` releases in a
  `finally` after acquiring. Trace `forget()` and you would conclude this
  binding cannot reach the scheduler at all; it reaches it through
  `exists`. (b) `pruneExpiredLocks()` is not run on every acquire — it is
  behind `acquire()`'s lottery, `[2, 100]` for this store.

  **What it costs.** A scheduled run can now fail where it used to
  continue. The failure lands after `acquire()` has already written the
  mutex row, so the row survives with its `withoutOverlapping(2)` expiry
  and the following ticks are SKIPPED until it lapses — roughly two
  minutes of queue left undrained, then self-healing. (That two-minute
  expiry is this project's own deliberate choice over the framework's
  24-hour default, and `routes/console.php` carries the reasoning.) The
  binding is not being reverted: a lock-wait timeout on `cache_locks`
  should be loud, and the blast radius is bounded and self-clearing.
  **No test exercises this path in either direction**, because
  `phpunit.xml` forces `CACHE_STORE=array` and the array store's lock
  never touches a database — so this entry, and `DeadlockDetector`'s
  docblock, are the only record that the behaviour changed.

  **WHO ELSE IS ON THE COPY-FIRST SIDE, and which of those pairings a
  shipped schedule can actually reach.** The paragraph above names
  `LendCopy` because Task 8 is what created the edge; it is not the only
  command that takes these two rows copy-first, and the whole-branch
  review's derivation is reproduced here rather than left in four
  docblocks. Re-derived for this entry by reading every `lockForUpdate`
  call site and every guarded `UPDATE` against `book_copies` /
  `borrow_requests` under `app/Actions`, file by file:
  `ApproveBorrowRequest` (copy lock as the transaction's first statement,
  request second), `LendCopy` (copy lock, then the guarded `->update()`
  that closes the collected hold), `ReceiveReturn` (copy, loan, then the
  hold's request row) and `ReleaseExpiredHold` (copy, then request) all
  take them in that order. `ReceiveReturn`'s participation was already
  recorded — in the Phase 1c `ReceiveReturn` entry far above, under "A
  third lock the reference never took" — and `ReleaseExpiredHold`'s lived
  only in its own docblock until this entry.

  Everything below turns on ONE condition, because `CancelOwnRequest`
  inverts only under it: it locks the copy first WHEN its route-bound
  snapshot names one, so the request-then-copy order needs a snapshot
  whose `copy_id` was null and a locked row whose `copy_id` is not. Every
  writer of that column (`ApproveBorrowRequest`'s decision write and
  `ReceiveReturn`'s hold branch — grepped for `'copy_id' =>` under
  `app/Actions`, the rest of the matches being loans, condition
  assessments and audit payloads) sets it in the same `->update()` that
  moves a row it has already refused unless PENDING, and the only writer
  of `status = pending` is `CreateBorrowRequest`'s insert, which omits the
  column. So the flip is always null → an id, never copy A → copy B, and
  it has to land inside the milliseconds between the cancel's route
  binding and its first lock.

  - **`LendCopy` ↔ `CancelOwnRequest` — REACHABLE.** The edge this entry
    was written for, and nothing below changes it. `LendCopy` holds copy
    C and waits on the request row its collected-hold `UPDATE` names; the
    cancel holds that request and waits on C. It needs C `held` under a
    live hold, and the cancel bound while the row was still pending —
    a manager collecting the hold at the desk in the same seconds the
    reader's own *Hủy* tap is in flight.
  - **`ApproveBorrowRequest` ↔ `CancelOwnRequest` — REACHABLE, and the
    review that produced this list concluded it was not.** Its argument
    was that the cancel can only want a copy if the row it locked already
    names one: before the approval commits the row still reads
    `pending`/null, and once it has committed it has released the copy.
    That is sound about *the* approval that wrote `copy_id` — and the
    copy lock in the cycle need not be held by that transaction.
    `ApproveBorrowRequest` takes its copy from a FORM FIELD, not from the
    bound request, so a SECOND approve POST naming the same copy takes
    C's lock while waiting on the request row, and nothing refuses it
    before the transaction: `BorrowRequestPolicy::approve` reads no row
    (deliberately — the anti-enumeration rule its own docblock argues)
    and `ApproveBorrowRequestRequest` validates the field, not the
    status. The schedule, three transactions with the 2-cycle between the
    last two:

    1. Two managers POST approve(R, C) while R is pending — a double
       submit, or two volunteers on one queue page.
    2. The reader's cancel POST binds R while it is still pending, so its
       snapshot `copy_id` is null.
    3. M1 locks C, locks R, writes `approved` + `copy_id = C`, flips C to
       `held`, commits. M2, which has been waiting on C's lock, takes it
       and waits for R's.
    4. The cancel locks R, reads `copy_id = C` off the committed row, and
       issues its guarded `UPDATE book_copies … WHERE state = 'held'` —
       which now waits on M2.

    M2 holds C and wants R; the cancel holds R and wants C. M2 would have
    gone on to throw `request_not_pending`, but that check runs AFTER both
    locks, so it is a full participant in the wait-for graph. Note that
    the setup which makes the cancel want a copy at all — a committed
    approval — is the same setup the `LendCopy` case needs; the only step
    the review's argument skipped is that a THIRD transaction can hold the
    copy afterwards. Same edge, same ruling (accepted, not fixed): a
    second copy-first participant on an inversion already recorded, not a
    new direction and not a new cycle.
  - **`ReleaseExpiredHold` ↔ `CancelOwnRequest` — both orders exist over
    the same two rows; through the shipped screens no schedule realises
    them, and a crafted POST does.** Unlike the approve, this command
    reads its copy from `$request->copy_id` on its OWN route-bound
    snapshot, so its copy and its request always come from one row and it
    cannot hold C while waiting on some other request. That leaves a
    single shape: it holds C and waits on R while the cancel holds R and
    waits on C. Its snapshot must therefore be bound AFTER the approval
    committed (bound before, `copy_id` is null, it locks no copy at all —
    its own null branch) while the cancel's must be bound BEFORE it. The
    cancel's binding-to-first-lock gap is one HTTP request's worth of
    milliseconds; the queue page offers *Trả về kệ* only on a row whose
    `holdExpired` flag is set, which is the shelf's whole `hold_days`
    after that approval. Through the screen, the cancel's transaction
    would have to sit in that gap for days. What is NOT ruled out:
    `ReleaseExpiredHold` takes both locks BEFORE its `hold_not_expired`
    guard, so a release POST aimed by hand at a just-approved row joins
    the wait-for graph exactly as `LendCopy` does. Nobody but a manager on
    the shelf can send it, and the outcome is the same 1213 this entry
    already accepts.
  - **`ReceiveReturn` ↔ `CancelOwnRequest` — UNREACHABLE**, and the
    reason is copy STATE rather than timing. For `ReceiveReturn` to hold
    C's lock, C carries an ACTIVE loan (its bound loan's copy;
    `loan_not_active` is checked after the lock). For the cancel to want
    C, a pending-or-approved request must name C in a row it can read —
    and a pending row's `copy_id` is null, so it must be a COMMITTED
    approved row, since the cancel reads `copy_id` off the row it locked
    and an uncommitted write is invisible to it. So the question is
    whether any committed state has C on loan while an approved request
    names it. It does not, and **the two doors onto a hold need separate
    arguments — they do not share one**:

    - **`ApproveBorrowRequest`** consults `RequestRules::copyHoldable`,
      whose only allowing branch is `available` with no live holder, so
      `on_loan` comes back `no_copy_available`. That door cannot name a
      copy that is out.
    - **`ReceiveReturn`'s hold branch names precisely a copy that IS out**
      — the returning loan's, which is why it exists — and it never
      consults that predicate at all (`grep -rn copyHoldable app/` returns
      one call site, in `ApproveBorrowRequest`). Its guards are on the
      REQUEST: `request_not_queued` unless the row is pending and for this
      title. What rules it out is atomicity, not a predicate: the one
      transaction closes the loan (`status => Returned`) and writes the
      copy `held` alongside the request's approval, so the committed state
      it produces is (C `held`, R approved) — never (C `on_loan`, R
      approved). An earlier draft of this entry said `copyHoldable` covered
      "neither door", which is false for this one; the verdict holds on
      this argument instead.

    That leaves getting from (C `held`, R approved) to (C `on_loan`, R
    approved) afterwards, and nothing does: `LoanRules::copyLendable` lets
    a `held` copy go only to its own holder, and `LendCopy` closes that
    request to `fulfilled` in the same transaction — a status the cancel
    refuses before it ever wants a copy. Nor back the other way: every
    writer of `CopyState::Available` under `app/Actions` (the re-runnable
    check is `grep -rn "CopyState::Available" app/Actions/`) either ends
    the request in the same transaction as the release or cannot be
    reached from a `held` copy at all — `MarkCopyFound` needs `lost`, and
    `CopyStateMachine` answers `copy_not_on_loan` for held → lost. The
    review reached the same verdict by a different route (that a hold and
    a loan cannot coexist on one copy); what carries it is the STATE
    branch of `copyHoldable` for one door and same-transaction atomicity
    for the other, and nothing about hold expiry for either.

- **Divergence 15: `CancelOwnRequest` answers 404 for a missing-or-foreign
  request where the reference folded both into `not_own_request` — a
  within-shelf existence oracle the reference did not have.** `findOrFail`
  runs before the ownership check, so "no such request" and "another
  shelf's request" are one 404 (that IS the anti-enumeration guarantee
  spec §5.4 asks for), while "exists, and belongs to someone else on YOUR
  shelf" is a 302 carrying the Vietnamese sentence. A reader holding a
  well-formed id can therefore distinguish *exists on my shelf* from *does
  not exist*. **The split is correct** — OPS §4.2 lists `not_own_request`
  and the not-found case as different failure modes, and spec §5.4 demands
  only that a foreign SHELF's request be indistinguishable from a
  nonexistent one, which it is — but the leak is real, it was shipping as
  an inline comment only, and the phase records divergences as a numbered
  list. What it discloses is bounded: that some request id belongs to
  somebody on the caller's own shelf. Ids are UUIDv7 and not enumerable
  from outside.

- **The bell's *mark one read* route has divergence 15's shape too, and
  it was not recorded until the whole-branch review found it.** Nothing on
  the way to `POST …/profile/notifications/{notification}/read` scopes the
  row by PERSON: it binds through `Bookshelf::notifications()` and
  `BookshelfScope`, both of which scope by SHELF, and the refusal is one
  layer down in `MarkNotificationRead::one`, whose `where('user_id', …)`
  makes another reader's row a zero-row `UPDATE` — a silent success. So on
  one shelf an id that does not exist is a 404 while another reader's id
  is a 302 with nothing changed, which is exactly the within-shelf
  existence oracle divergence 15 records for `CancelOwnRequest`, reached
  from the other side (there, the ownership check has a sentence; here it
  has no answer at all). The disclosure is the same bounded one — that
  some notification id belongs to somebody on the caller's own shelf —
  and ids are UUIDv7 and not enumerable from outside. **Not fixed**, for
  divergence 15's reason: the alternative is a 404 for a foreign row,
  which is the answer the reader already gets for a foreign SHELF, and
  changing it is a behaviour change nobody asked for. Recorded so the two
  routes are known to share a shape. The route's own comment in
  `routes/web.php` already described the mechanism; what was missing is
  that it is the same divergence.

- **A suspended reader can reach neither `memberMayRequest` nor the cancel
  door, so their INV-4 branches are defence in depth, not live paths**
  (ported reading 1). `ResolveTenant`'s membership query filters on
  `status = Active`, so a suspended reader binds a NULL membership; the
  `act-as-reader` gate returns false for anyone who is not a super admin;
  `EnsureShelfRole` 404s them before any Action runs. The reference's own
  comment claims the opposite — that a suspended membership surfaces
  `membership_not_active_cannot_request` on the book page — and under this
  app's gating it cannot. Pinned by `ReaderRequestSurfaceTest`'s "an
  ordinary reader whose membership is suspended meets a 404, not a
  sentence". The one door that DOES reach `not_permitted` is a super
  admin's, because `Gate::before` returns true for any `act-as-*` when
  `is_super_admin`, which lets a null membership through.

- **~~Two notification kinds BR §15 names are still deliberately absent,
  and they have an owner~~ — CLOSED by Phase 3c-i Task 6.** The pair
  shipped the way the entry below says the rule requires: two
  `NotificationKind` cases (`profile_change_approved`,
  `profile_change_rejected`), their two Vietnamese sentences, their
  writers (`ApproveProfileChange` and `RejectProfileChange`), OPS §7's
  two new table rows and the census's two new entries, all in one commit.
  The rejection carries the manager's reason, which is the half BR:490
  states explicitly. There was no reference to port, so the Vietnamese is
  this port's own, written to the two shapes already in the file — the
  `membership_approved` fixed sentence and the `membership_rejected`
  `:because` clause. The original entry follows.

  This entry used to describe THREE, and the
  count it carried was of entries rather than of kinds — the wording is
  corrected here in both directions. `comment_approved` has since
  ARRIVED: 2b's Task 3 landed the kind, its sentence, its writer
  (`ApproveComment`) and its census row in one commit, which is the rule
  `NotificationsAreReaderFacingTest`'s table enforces, so it is no longer
  a gap. What remains is BR §15's profile-change PAIR — "profile change
  approved" and "profile change rejected (carrying the manager's
  reason)", two kinds, listed as two in §15's own reader list — which has
  **no reference implementation to port at all** and is **Phase 3's to
  decide** (divergence 7); it is not an omission this phase made. It is
  stated in the census table's own docblock so a future author meets it
  where they would add the rows.

- **`BorrowRequestQueueQuery`'s free-copy list filters on
  `state = available` alone, and that equals `borrowable()` only because
  every hold-creating command flips the copy in the same transaction.**
  The list a manager picks a copy from is not derived from
  `CountsCopies::borrowable()`; it is a plain state filter. It agrees with
  the command's own predicate because `ApproveBorrowRequest` and
  `ReceiveReturn` both write `held` inside the transaction that writes the
  hold — the same premise divergence 14 rests on, reached from the other
  side. And in the direction that matters for a child,
  `ApproveBorrowRequest`'s two-clause predicate still refuses the
  theoretical divergent row, so the screen cannot cause a copy to be
  promised twice. Recorded durably here because until now it lived only in
  a comment inside the query.

- **Ruling 1's gap is closed, and here is what closed it.** The reference
  strands a copy in `held` forever when a hold lapses and the reader never
  cancels: BR §7.2 draws an `approved -> expired` arrow that nothing in
  the reference ever writes. `ReleaseExpiredHold` (Task 18) writes it,
  together with `held -> available`, in one transaction, guarded on the
  clock's verdict against the LOCKED row — a manager may not yank a live
  hold. It carries audit action `request.expired` and its own OPS §4.2
  entry, written in the same commit. Its clock guard is exactly
  complementary to `HandoverRequest`'s boundary, so at
  `hold_expires_at == now` the handover refuses and the release succeeds:
  no hold with an expiry is both un-handoverable and un-releasable.

- **The frontend blind spot extends to every screen this phase shipped,
  and that is HANDOFF's open item restated rather than a new one.** This
  repo has no frontend rendering tests — the only vitest scripts point at
  `old_next`, and `find resources/js -name "*.test.ts*"` returns nothing —
  so `assertInertia` checking server-side props is the whole of the
  coverage on `shelves/book`, `manage/borrow-requests`,
  `shelves/profile/overview` and `shelves/profile/notifications`. Two
  worked examples are already recorded above (Task 12's swapped
  availability ternary, and Phase 1d Task 6's swapped dashboard stat
  cards, both of which left every gate green). The property those examples
  share is the whole finding: nothing renders these pages under test, so
  no test in this codebase can catch a mis-wired label/value pair on any
  of the new ones. Adopting component-level tests is a real
  decision and no phase has scoped it.

- **`make lint` is NOT pristine on this branch, and has not been for the
  whole phase.** `bun x biome check --write .` reports, on `main`'s
  content as much as on this branch's: `noImgElement` on
  `resources/js/components/book-card.tsx` and
  `resources/js/pages/shelves/book.tsx`, `noDocumentCookie` on
  `resources/js/components/ui/sidebar.tsx`. Tail of the run:
  `Checked 76 files … Found 3 warnings. Found 1 info.`
  **The one info is the schema skew, and the first draft of this entry got
  that wrong twice** — it attributed the info to the "Consider using the
  Cookie Store API" line (that is a note *inside* the `noDocumentCookie`
  warning, not a diagnostic of its own) and said the skew "produces no
  diagnostic and so goes unnoticed". It does produce one, and it is the
  counted info: `biome.json:2:16 deserialize` — "The configuration schema
  version does not match the CLI version 2.5.10 … Expected: 2.5.10, Found:
  2.5.8 … Run the command `biome migrate` to migrate the configuration
  file." Caught in this task's own fix round, by grepping the gate's output
  for the word the entry claims rather than trusting the sentence — which
  is the check this document keeps needing. All pre-existing and untouched
  by Phase 2a; **the gate was reported green through the phase while
  carrying them**, which is the part worth recording. Not fixed here (each is a real UI change, and one
  of them is Biome telling a Laravel app to use `next/image`); the
  baseline is written down so the next person can tell an inherited
  warning from one they added.

- **`AuditSecretsTest`'s payload-shape list had drifted out of the phase
  entirely, and its title was counting.** The block "every payload shape
  the 21 shipped writers produce passes" carried **no `request.*` shape at
  all** — pre-existing drift since Task 4 — so the guard that must never
  brick a shipped command was being re-proved against a catalogue that
  predated the phase's writers. Refreshed at this task with the after bags
  of `request.created`, `.approved`, `.rejected`, `.cancelled`, `.expired`
  and `.fulfilled` — the before bags need no row of their own, each being a
  subset of an after bag already listed and the guard judging keys rather
  than values — and the writer
  COUNT dropped from the test's own name, per this branch's ruling that a
  complete enumeration in a title is the thing that goes stale silently.

- **`DemoShelfSeeder` is now deterministic, and one demo reader can sign
  in.** `BookFactory` picked among AGENTS.md's four titles randomly WITH
  replacement and `BookCopyFactory` drew codes from a faker `unique()`
  pool, so `migrate:fresh --seed` produced a different shelf every run —
  a title seeded twice and another missing. That was awkward for design
  work and became load-bearing the moment the demo request block named two
  titles; `SeederTest`'s exact counts could only be asserted at all
  because of it, and the intermittency showed up as that assertion failing
  on some runs. The catalogue block now writes the four titles and eight
  codes. Separately and deliberately: `UserFactory` gives readers no
  credentials (most readers are children who never sign in, and
  `users_credentials_paired` is both-or-neither), which meant no reader on
  the demo shelf could sign in and every reader-side screen this phase
  shipped was unreachable by hand. Têrêsa — the holder of the demo hold
  and its notification — now gets username `bandoc`.
  **What actually keeps this out of production is one `if`, and until this
  commit nothing asserted it.** `deploy/post-deploy.sh` runs
  `artisan db:seed --force` **unconditionally on every deploy** — its own
  comment says that is safe because "DatabaseSeeder gates DemoShelfSeeder
  behind `app()->environment('local')` … production only ever gets
  CategorySeeder", and the unconditional call exists because a fresh
  install with no categories cannot satisfy the required *Thể loại* field.
  So the deploy script's stated safety premise is a single conditional in
  `DatabaseSeeder::run`, and **deleting it left the whole suite green**:
  no test anywhere asserted that `DatabaseSeeder` skips the demo seeder
  outside `local` (the two `environment('local')` hits under `tests/` are
  comment lines in `InertiaDevtoolsTest`, about a different subject). This
  commit adds `SeederTest`'s "DatabaseSeeder runs DemoShelfSeeder only in
  local — the gate the deploy relies on", which forces the environment to
  `production`, invokes the deploy's own `db:seed --force`, and asserts
  CategorySeeder ran while nothing DemoShelfSeeder writes exists. Measured:
  removing the `if` gives `1 failed, 1260 passed` — `Failed asserting that
  1 is identical to 0` on the `bookshelves` count — and nothing else in the
  suite reddens. It matters more since this commit than before it: a
  demo shelf reaching production used to mean fixture rows, and now means a
  third account with a working password.

## Phase 2b — Community voice

Comments and their moderation, announcements, and donation offers. Branch
`feat/phase-2b-community-voice`, cut from merged `main` = `fabfbd4`. The two
entries immediately below were written by Task 2 and predate this heading,
which the wrap-up added so that every entry from this phase sits under it.

- **The no-wall-clock grep is written twice, once per Actions namespace,
  and that is a choice rather than an oversight (Phase 2b Task 2).**
  `CommunityArchitectureTest`'s `wallClockOffenders()` carries the same
  four-token regex — `(?<![->])\bnow\(\)|Carbon::now|CarbonImmutable::now`
  — as the clock block inside `CirculationArchitectureTest`, which walks
  its own directory with a literal `RecursiveDirectoryIterator` rather
  than through a helper. The alternative was editing a shipped guard a
  second time this phase to extract a shared helper; Task 1 already made
  that exception once (the transaction walk, renamed to
  `actionTransactionCalls(?string $root = null)`), and a second edit to
  the same file for a rule that is four tokens long buys less than it
  risks. The cost is real and is stated here rather than left to be
  discovered: a correction to the regex has to be applied in both places,
  and nothing tells you so. Whichever task next needs a THIRD copy should
  extract the helper instead of adding one — three copies is where the
  duplication stops paying.
- **`Comment::author()`'s explicit foreign key is not pinnable, and the
  docblock that said otherwise has been corrected (Phase 2b Task 2).**
  Task 1's review found that reverting `belongsTo(User::class,
  'author_id')` to `belongsTo(User::class)` broke no test, and read that
  as a missing pin. Measured in the container: `BelongsTo`'s default
  foreign key is `Str::snake(<calling method name>).'_'.<owner key>`, so a
  method named `author()` guesses `author_id` — both spellings resolve the
  identical column and **no test can tell them apart**. The explicit key
  is worth keeping (it stops the column depending on the method's name),
  but it is documentation, not behaviour. What is pinnable is the
  relation's target, and `CreateCommentTest` now pins that: `author()`
  reaches the `users` row named by `author_id`, and the id written there
  is a `users(id)` and not a `memberships(id)` — the trap this phase
  carries end to end. **A second plan claim was corrected the same way in
  the same commit:** `CreateComment`'s docblock, as the plan wrote it,
  said a membership id in `author_id` "would insert a row referencing
  nothing and no FK would stop it". Measured: `comments_author_id_foreign`
  references `users(id)`, and the write is refused as SQLSTATE 23000 /
  errno 1452. The database is the backstop; the two ids are still
  indistinguishable by shape, which is why the Action takes a `User`.

### The Phase 2b wrap-up — the OPS §4.4 walk, and what this branch made false

Written by Task 20 after the full suite ran green at **1,569 passed / 9,373
assertions** on base `c6f423e`, and after `docs/OPERATIONS.md` §4.4 was walked
command by command **with the shipped file open beside it**, which is the 1c
and 2a precedent. Amendments to entries this branch falsified are recorded
where those entries stand, not here — this section holds what is new.

#### The OPS §4.4 walk — the disagreements, and the disposition

**All of it is documentation lag, and none of it is fixed in this commit.**
2a's precedent is that a wrap-up commit is the wrong place to edit a shipped
command's OPS entry unannounced, and that precedent is followed: **these go to
the PR as row edits**, not into `docs/OPERATIONS.md` here. Nothing about any
command's behaviour would move — every code below is already thrown by the
shipped Action, already has its Vietnamese sentence in `lang/vi/rules.php`,
and is already censused by `RuleViolatedCodesHaveSentencesTest`.

- **§4.4 abbreviates SEVEN failure-mode codes across five commands, one more
  spelling than the plan predicted.** The plan named three (`not_pending` /
  `not_approved` for comments, `not_pending` for donations, `validation_failed`
  for the announcement pair). The walk found a fourth spelling it had not
  named — `reason_required`, which §4.4 lists under **both** `RejectComment`
  and `DeclineDonation`. Transcribed from `docs/OPERATIONS.md` §4.4 and from
  the Actions, at the wrap-up:

  | §4.4 command | §4.4 spells | the shipped Action throws |
  |---|---|---|
  | `ApproveComment` | `not_pending` | `comment_not_pending` |
  | `RejectComment` | `reason_required`, `not_pending` | `reject_reason_required`, `comment_not_pending` |
  | `HideComment` | `not_approved` | `comment_not_approved` |
  | `CreateAnnouncement` / `UpdateAnnouncement` | `validation_failed` | `announcement_fields_required` |
  | `ReceiveDonation` | `not_pending` | `donation_not_pending` |
  | `DeclineDonation` | `reason_required`, `not_pending` | `reject_reason_required`, `donation_not_pending` |

  The long spellings are the reference's, not this port's invention:
  `old_next/src/domain/kernel/errors.ts` (opened) defines
  `comment_not_pending`, `comment_not_approved`, `announcement_fields_required`
  and `reject_reason_required` in its community block, and
  `donation_not_pending` and `empty_description` in the donations block below
  it — each with the Vietnamese sentence §4.4 gives the abbreviation. That is
  the two-ledger rule 1c established with `title_has_no_copies`: the catalogue
  abbreviates, `errors.ts` spells, and the command throws the spelling.

- **Two guard codes §4.4 lists under no command at all.** `CreateComment`
  throws `not_permitted` and `shelf_not_found`, and `OfferDonation` throws
  `not_permitted`, before either reaches the refusal §4.4 does list. Both are
  this port's fail-closed tenancy guards (divergence 4: the reference's
  caller-supplied `membershipId` is dropped, and `TenantContext::membership()`
  can legitimately be null for a memberless super admin admitted by
  `Gate::before`). They are preconditions rather than business refusals, so
  the PR edit should decide whether §4.4 wants them listed; this walk records
  them rather than assuming.

- **`OfferDonation`'s `photo?` input is absent, and §4.4 still lists it.**
  Divergence 11. `App\Actions\Community\OfferDonation::execute` (opened) takes
  `(User $actor, string $description, ?int $estimatedCount = null)` and no
  photo. See the entry below for what a later uploader adds.

- **`write_target_not_found`: there is no orphan, and the number the plan
  carried is stale.** Divergence 3's consequence, re-measured at the wrap-up
  rather than quoted: `require`ing `lang/vi/rules.php` in `laravel-app-1`
  returns **92** flat keys, and `array_key_exists('write_target_not_found', …)`
  is **false**. (The plan says 68, and a revision before it said 64; both were
  measured before this phase's own codes landed. Two stale numbers in a
  divergence about a claim nobody re-ran.) So nothing is added to `lang/`, and
  what goes on the record is the **substitution**: where the reference's
  announcement commands threw this code for a missing row, route-model binding
  answers **404** here — `{comment}`, `{announcement}` and `{donation}` bind
  through the shelf relation under `scopeBindings()` and through
  `BookshelfScope` on the model, so a nonexistent id and a foreign shelf's id
  are indistinguishable before the Action runs.

- **~~§4.4's four feedback commands describe commands nothing implements, and
  that is a deferral rather than a gap~~ CLOSED 2026-09-01, phase 3c-ii.**
  Three of the four are built — `App\Actions\Community\SubmitFeedback`
  (Task 1), `App\Actions\Admin\MarkFeedbackRead` and
  `App\Actions\Admin\ResolveFeedback` (Task 4). The fourth,
  `ArchiveFeedback`, is deliberately not ported and its OPS entry now says so
  in its own words (`docs/OPERATIONS.md:723`). See the feedback entry below,
  and the Phase 3c-ii section at the end of this file.

- **§4.4's pin-cap open question is settled at "no cap", matching the
  reference.** Divergence 8. `App\Actions\Community\PinAnnouncement::execute`
  (opened) writes `is_pinned => true` on the one locked row and touches no
  other; nothing anywhere unpins a sibling, and no partial unique index exists
  on the column. `AnnouncementsQuery` orders `is_pinned` desc first, then by
  recency, which is what OPS §4.4's "pinned first, most recent next"
  (`docs/OPERATIONS.md:688`) asks of a multi-pin list. **Retracted in this
  entry:** the phrase was written here as BR §16.1's. It is not — BR's only
  announcement sentence is §16.1 line 510, the shelf-home card, and the phrase
  appears nowhere in BR. Worse, `228ca76` had already retracted exactly this
  misattribution in `shelves/announcements/index.tsx`, and `503d9f2` then wrote
  it into this file fourteen commits later. That is the reappearance this
  document's own method notes predict; it is recorded rather than merely fixed.
  OPS §4.4 itself credits §16.1 for the phrase and is wrong to — a PR row-edit. A cap later is a partial unique index plus a refusal, not a
  change to these commands.

#### New entries

- **The existence oracle holds ACROSS shelves and not WITHIN one, and that is
  accepted rather than overlooked (divergence 3).** Spec §5.4 — the migration
  design spec's "The TenantIsolation suite", not `BUSINESS-REQUIREMENTS.md`
  §5.4, which is a field list — demands that a foreign shelf's row be
  indistinguishable from a nonexistent one. It holds in both directions here,
  and the 404 buys it. What it does not buy: a manager of *this* shelf can
  tell "no such comment here" from "a comment here I already decided", because
  the first answers 404 at binding and the second answers a `RuleViolated` 302
  carrying a Vietnamese sentence. The caller is a manager of the shelf whose
  row it is, so the leak is inside their own tenant. Named here so a later
  reader meets it as a decision.

- **BR §5.5 spells the comment setting `allow_comments`; every implementation
  spells it `comments_enabled` (divergence 2).** The reference's reader
  (`community/policy.ts`) and its writer (`admin/commands/bookshelves.ts`)
  both use `comments_enabled`, and so does this port
  (`App\Support\Community\CommentSettings::fromShelf`, opened). Re-measured at
  the wrap-up over the whole repository excluding `vendor/`, `node_modules/`,
  `.git/`, `old_next/.next/` and `.superpowers/`, and excluding the phase
  plan: no EXECUTABLE source on either side spells it BR's way — every
  occurrence is a comment or `docs/BUSINESS-REQUIREMENTS.md`'s settings table
  itself. **The key `/manage/settings` must write is `comments_enabled`**, and
  the same is true of `comments_require_approval`, which both documents
  already spell alike. **AMENDED at Phase 3b-ii Task 6: `/manage/settings` is
  built, and it WRITES NOTHING.** Spec D4 made it read-only — the eight values,
  the contacts and the taxonomy shape as text — so the writer this note was
  addressed to never came into being on the manager side. The only writer of
  either key is `App\Actions\Admin\UpdateBookshelfPolicy`, on the admin shelf
  editor, and it already spells both keys the implementation's way. The new
  screen READS them through `CommentSettings::fromShelf` for the same reason.
  So the divergence is unchanged and still unclosed, and closing the lag is
  still a one-cell edit to BR §5.5 — there is simply no longer a future author
  waiting on this note.

- **Announcement bodies are plain text, and the reference's `bodyText`
  parameter is dropped (divergence 5).** The reference accepts an optional
  plain derivation beside a rich body, with a fallback when the caller
  supplies none — a shape taken from the phase plan's divergence 5, not
  re-read here. What IS opened is this side: the port has no rich-text
  editor, so the create/update forms
  post ONE plain field which is written to **both** `announcements.body` and
  `announcements.body_text` (columns read off the migration: `text body` and
  `text body_text`, the second commented "plain derivation, for excerpts").
  Excerpts still come from `body_text`, so nothing downstream changes shape
  when an editor lands. **What a rich editor restores, exactly:** a second
  input on the two forms, a `bodyText` parameter on `CreateAnnouncement` and
  `UpdateAnnouncement` carrying the derivation, and the fallback rule — when
  the caller supplies no derivation, `body_text` takes the rich body. Nothing
  that reads `body_text` moves. Shipping the parameter now with no caller
  would be the "implemented, reachable from nowhere" shape 2a's divergence 3
  refused.

- **The manager comment queries ship without the reference's `bookId`
  narrowing (divergence 9).** Both of the reference's manager-side comment
  queries take an optional `bookId`, serving a comments panel on the manager's
  own book page. This port does not build that panel, so the parameter would
  be reachable from nowhere. `CommentModerationQuery` is by status only;
  `BookCommentsQuery` — the reader's, INV-9's home — takes a book and
  nothing else. **The shape to restore for whoever adds
  the panel:** an optional book id on the moderation query, narrowing the same
  status-ordered list, with the queue's own ordering untouched.

- **`comment_approved` carries no notification payload, matching the
  reference (divergence 10).** `ApproveComment` calls
  `notify($locked->author_id, NotificationKind::CommentApproved)` with nothing
  else, so the sentence names no book: a reader with two approved comments
  reads the same line twice. Ported rather than improved — adding a title is a
  product change, not a port. **The one-line shape an improvement takes:** a
  `['title' => $locked->book?->title]` payload at the `notify()` call and a
  `:title` slot in `NotificationSentences`' arm, with the existing titleless
  line kept as the fallback for rows already written.

- **`OfferDonation` ships without the reference's photo, and the input's name
  is not the column's (divergence 11).** The reference's input is
  `photo?: string | null`; the column it lands in is
  `book_donations.photo_url`. `OfferDonation::execute` (opened) takes no
  photo argument and writes no `photo_url`, so a row this port creates leaves
  the column null — 1a dropped the cover uploader for the same reason,
  recorded above, and the parameter is absent here rather than
  present-and-uncallable. The column IS
  still read and rendered where a row has one, so a later uploader adds a
  writer and no reader.

- **Comments and donations carry no rate limit and no duplicate rule, on
  either side of the port, and a reader can post unboundedly.** Opened at the
  wrap-up: the reference's `community/commands/comment-moderation.ts` (which
  holds `createComment`) and `community/commands/donations.ts` throw no
  `rate_limited` and run no recent-rows check; only `community/commands/
  feedback.ts` does, with its own `DAILY_LIMIT`. This port matches — the only
  `throttle:` middleware in `routes/web.php` is on `register.store`. The
  refusal that *does* exist on both paths is membership, not frequency. If a
  parish ever meets this, the fix is the shape `feedback.ts` already uses,
  and BR §8's own rate-limit section is where the numbers would come from.

- **~~The feedback slice is deferred WHOLE to Phase 3 — form and inbox
  together — and that is a decision with four reasons.~~ CLOSED 2026-09-01,
  phase 3c-ii.** The whole slice landed in one phase, form and inbox
  together, exactly as this entry asked: `SubmitFeedback` (Task 1), the
  shelf's own *Góp ý* at `routes/web.php:281-282` (Task 2), the public
  contact form at `:90` (Task 3) and `/admin/feedback` at `:940-942`
  (Task 4). All four of this entry's reasons expired the way it predicted —
  the `/admin` area and its cross-shelf read conventions were built in 3b-i
  and 3b-ii, and `AuditRecorder`'s global arm, which reason (3) named as the
  blocker for a site-wide row, is what `SubmitFeedback:161` now calls.
  **Both open questions this entry carried are answered**, and neither by
  default: the fourth "archive" status is not ported (spec D8), and the
  shelf-manager visibility question the phase plan could only *recommend* on
  was ruled by the product owner on 2026-09-01 — **super-admin only**,
  matching the reference. That ruling is what leaves `Bookshelf::feedback()`
  with no caller; see the Phase 3c-ii section at the end of this file.
  Kept struck rather than deleted, for this file's usual reason: a note that
  vanishes without saying it was answered comes back. **The original entry,
  unedited:**

  OPS §4.4 lists
  `SubmitFeedback`, `MarkFeedbackRead`, `ResolveFeedback` and
  `ArchiveFeedback`; `find app/Actions -iname '*Feedback*'` returns **0**
  files, and `grep -rn "Feedback" app/` reaches only four files — the model
  (`app/Models/Feedback.php`), the enum (`app/Enums/FeedbackStatus.php`),
  `Bookshelf::feedback()` with its two explanatory lines, and one comment in
  `AppServiceProvider`. No Action and no controller; the three feedback
  addresses in `php artisan route:list` — `shelves/{shelf}/feedback`,
  `/contact` and `admin/feedback` — all resolve to
  `ShellController::underConstruction`, which is where they stay. The reasons, from the phase plan:
  (1) the read half is `super_admin` and cross-shelf and lives in the
  reference's `src/domain/admin/`, and BR §1.4 assigns super-admin tooling to
  Phase 3; (2) this port's whole `/admin` area is still
  `ShellController::underConstruction`, so one super-admin screen means
  building the area's layout and cross-shelf read conventions for a feature
  Phase 3 rebuilds them for; (3) a site-wide message needs an audit row with a
  NULL `bookshelf_id` and `AuditRecorder::record()` throws
  `RuntimeException('AuditRecorder needs a bound tenant…')` on exactly that,
  its own docblock assigning global rows to Phase 3; (4) the reference
  records what half-shipping cost it — `submitFeedback` "has been writable
  since B3 and unreadable ever since… a parish's children could send a note
  to the people who keep their shelf and nobody could open it."
  **OPS §4.4's own two feedback open questions are untouched by this phase**
  (the fourth "archive" status BR §5.4 does not define, and whether a shelf's
  manager reads feedback addressed to their shelf) and both go to Phase 3
  with the slice. The phase plan's OQ1 recommends keeping it super-admin;
  **no answer from the product owner arrived during this phase**, so the
  recommendation stands as a recommendation.

- **AGENTS.md prescribes six components this repository does not have, and it
  has now misdirected three tasks.** Measured across `resources/js/**/*.tsx`
  at the wrap-up: `Pill`, `StatusBadge`, `StatusPanel`, `StepIndicator`,
  `ReadOnlyValue` and `BookTitle` have **zero implementations** — every hit
  for any of the six is inside a comment recording this same measurement.
  **`BookTitle` is cited by AGENTS.md's numbered rule 1, not merely by its
  component table** ("Literata appears solely on the title of a book, and only
  via the `BookTitle` component"), and `StatusBadge`/`StatusPanel` by numbered
  rule 2 — so the guide's non-negotiables name components that do not exist.
  Tasks 7, 18 and 19 each had to be told in their brief to use `badge.tsx` and
  `Label` + a raw control instead. **This is a decision for the product
  owner, not for a wrap-up: build the six, or correct the guide.** It is
  recorded rather than acted on because either answer changes AGENTS.md or
  `resources/js/components/`, and neither belongs in a commit that ships no
  feature.

- **`Announcement` is the model the tenancy isolation suite actually leans
  on, and dropping its trait reddens two and a half times as much as the
  other two.** Measured at the wrap-up, running
  `TenancyArchitectureTest` + `TenantIsolationTest` together (24 passed
  green) and removing `BelongsToBookshelf` from one model at a time:
  `Comment` → **2 failed, 22 passed**; `BookDonation` → **2 failed, 22
  passed**; `Announcement` → **5 failed, 19 passed**. The phase plan
  predicted 2/22 for all three, which is wrong for `Announcement`: beyond
  the two blocks the other models trip (the trait census, and "shows every
  trait-carrying model only its own colliding rows"), `TenantIsolationTest`
  uses `Announcement` as the subject of its stamping and cross-shelf
  refusal blocks, so those fail too — one of them as a raw `QueryException`
  and one as `MultipleRecordsFoundException`. That is the same fact this
  file already records from the other side: `Announcement` is a top-level
  scoped model with no scoped parent, so it has no composite-FK backstop
  and the trait is the whole of its confinement.

- **`DemoShelfSeeder` now seeds the community surface too, and `SeederTest`
  grew with it.** `make fresh` writes one pending and one approved comment
  on a seeded book, one pinned-and-published announcement and one draft, and
  one pending donation offer — so `/manage/comments`,
  `/manage/announcements`, `/manage/donations` and the book page's comment
  area demo with rows instead of empty states. Each of the three tables has
  its own `doesntExist()` guard, so a database seeded before this change
  picks up whichever set it lacks. **The rows are named in `SeederTest`'s
  production-gate block as well as its idempotency block**, which is the
  half that matters: `deploy/post-deploy.sh` runs `db:seed --force`
  unconditionally, and a reader's comment, a shelf notice or a donation
  offer written into a real parish's database would each be visible on a
  real screen.

#### Method findings — how this repository verifies itself

Not gaps in the product. Each was measured this phase, and each contradicts a
habit that was in use before it.

- **A 404-only test block is VACUOUS when no route claims the URI — and is
  not vacuous when a sibling route holds the path.** A block asserting 404
  passes just as well against a deleted route as against a guarded one. But
  where a sibling route already claims the path with another verb, an unrouted
  method answers **405**, not 404, so the block fails on deletion and the
  worry does not apply. Both cases were measured this phase; `routes/web.php`
  carries the measurement beside the `donate` GET/POST pair, where the GET
  claiming the URI is what makes the POST's 404 block honest.

- **A block can redden on the WRONG LINE, and that proves less than it
  looks.** A failed `expect()` aborts the whole Pest method, so a mutation
  that reddens a block whose *titled* probe sits behind an earlier assertion
  chain proves only that something in that method moved. The remedy —
  "titled assertion first" — is **unachievable** for a block whose failure
  mode is *the prop does not exist*, since the read that names the prop is
  what throws.

- **`toThrow($class, $message)` is a SUBSTRING match**
  (`assertStringContainsString`), not equality. Counted at the wrap-up:
  `grep -rnoE "toThrow\([^)]*,[^)]*\)" tests/` returns **130** two-argument
  uses. This schema has real refusal codes that are prefixes of longer ones,
  so a block can pass on the wrong code. Latent today — checked — and worth
  knowing before the next code is minted with a name that extends an existing
  one. (The brief for this task carried 126; re-run, it is 130. A count in a
  document is the same claim as a count in a comment.)

- **A measurement recorded in a comment has a SHELF LIFE, and only re-running
  can see it expire.** Two were caught this phase by the wrap-up's count-word
  grep. `CommunityArchitectureTest`'s directory-absence note said "4 failed
  … all four blocks" and "2 failed, 2 passed": true of the four blocks the
  file held when it was written, and falsified by three blocks added later in
  the same phase. Re-measured and corrected in that file — the numbers are now
  5 failed / 2 passed with the directory moved away and 4 failed / 3 passed
  with it present but empty. `App\Support\Community\CommentSettings`'s docblock
  said the BR spelling "occurs in no source tree at all" while sitting in a
  source tree and naming it; narrowed in place. **The general rule this
  yields: a total written into a comment is a claim about a file that grows.
  Re-run it or scope it to a date; never increment it.**

- **`AuditSentences::line()` has no `??`, and a deleted lang key fails
  differently depending on who is holding the error handler.** The method is
  `return (string) self::lines()[$key];` (opened) — an undefined key is a PHP
  warning, and Laravel's own
  `Illuminate\Foundation\Bootstrap\HandleExceptions::handleError` (opened in
  `vendor/`) converts any non-deprecation error inside `error_reporting()`
  into a thrown `ErrorException`. **Measured at the wrap-up rather than
  argued**, by deleting `comment_created` from `lang/vi/audit.php`:
  - `AuditSentencesTest` alone: **1 warning, 28 passed** — the file is GREEN.
    Its sweep block reports `Undefined array key "comment_created"` as a Pest
    warning, which is not a failure, so the census that renders every mapped
    action cannot fail on a missing sentence.
  - the whole suite: **1 failed, 1 warning, 1,567 passed** — and the single
    failure is not a census at all. It is
    `tests/Feature/Community/CreateCommentTest`, an `ErrorException`, because
    that test drives a real request through the audit renderer and meets
    Laravel's handler.
  So what actually protects a lang key today is an integration test that
  happens to render it, not the unit census whose name suggests it. A key
  used only by an action no feature test exercises would go out silently
  and throw for a volunteer.

- **`RuleViolatedCodesHaveSentencesTest` censuses LITERALS, and a code that
  is never written as one is invisible to it.** Its regex is
  `new RuleViolated\(\s*['"]([a-z0-9_-]+)['"]\s*[,)]` over `app/` — its own
  docblock says so and excludes variable throws by name. `copy_not_available`
  is minted by neither shape: `LendCopy` reaches it through
  `UniqueViolation::translate($e, ['loans_one_active_per_copy' =>
  'copy_not_available'])`, and its other producers (`LoanRules`,
  `ChooseCopy`, `CopyStateMachine`) return it as a string that
  `throw new RuleViolated($code)` then throws — a variable. `grep -rn
  "RuleViolated('copy_not_available')" app/` returns nothing. What has been
  keeping it honest for two phases is an unrelated file's hardcoded list:
  `tests/Unit/Catalogue/CopyStateMachineTest.php`'s "every refusal code the
  machine can produce has a Vietnamese sentence" block enumerates six codes
  and this is one of them. Not a defect today; a hole in what that census can
  promise, and the next map-only or variable-only code will have no such
  accident to fall back on.

### Added at the whole-branch review, after Task 20

- **Seventeen audit sentences have no test behind them, and they are all
  inherited.** `AuditSentences::line()` is `return (string) self::lines()[$key];`
  with no `??`, so a missing or wrong lang value renders whatever is there. The
  census BLOCK in `AuditSentencesTest` checks that every action HAS a sentence,
  not that the sentence is right. **Corrected here:** an earlier draft of this
  entry said that of `AuditSentencesTest` as a whole, which understates it — the
  file also carries per-action wording blocks, and NINE of them redden under the
  community mutation below (`announcement.created/.updated/.published/.pinned/
  .unpinned/.hidden`, `donation.offered/.received/.declined`). So that file does
  catch a wrong sentence for every Phase 2b announcement and donation key. What
  has no wording block is the seventeen, which is why deletion falls through to
  an **integration** test —
  `CreateCommentTest` raises the `ErrorException` when `comment_created` is deleted,
  while `AuditSentencesTest` alone stays green (1 warning, 28 passed).

  **Measured at the whole-branch review**, by mutating each value to a sentinel:
  seventeen keys change nothing. `make test` stayed **1569 passed / 9384
  assertions**, byte-identical to green:

  `book_updated`, `book_deleted`, `copy_added`, `copy_added_bare`,
  `copy_condition_assessed`, `copy_condition_assessed_bare`, `copy_retired`,
  `copy_found`, `loan_renewed`, `loan_lost`, `membership_registered`,
  `membership_registered_bare`, `membership_rejected`, `membership_suspended`,
  `membership_reactivated`, `membership_left`, `profile_corrected`.

  A volunteer would read "Maria Q đã ZMUTZ" in the audit log and CI would not
  notice. **Non-vacuity proven by the converse:** the same mutation over the
  nineteen community keys gives **15 failed / 1554 passed** across
  `AuditSentencesTest` (nine blocks) and **five** Feature files —
  `ApproveCommentTest`, `CommentDecisionsTest`, `CreateCommentTest`,
  `DonationDecisionsTest`, `OfferDonationTest`. **Corrected here:** an earlier
  draft said four; re-run at the whole-branch RE-review, with the mutation's
  restore proven by md5 against a clean `git diff` on `lang/vi/audit.php`. So the
  net is real, Phase 2b built it correctly for its own actions, and the hole is
  entirely Phases 1/2a's.

  The seventeen were also proven **complete**, which the original measurement did
  not claim: every one of the other twenty-two keys in `lang/vi/audit.php` was
  mutated individually, one full suite run each, and every one reddened at least
  one block. No key outside the seventeen is untested.

- **Five community POSTs answer 403 rather than 404 if `role:manager` is ever
  removed**, where spec §5.4 requires 404 so a refusal does not confirm which
  shelf URLs exist. Recorded once here with the right number rather than
  re-derived per task — Task 8 found one, Task 14 recorded four, and Slice C added
  a fifth that nobody re-counted.

  Measured with `EnsureShelfRole` removed and a reader acting:

  | 403 (the command's own `Gate::authorize`) | 404 (a Form Request's `abort_unless`) |
  |---|---|
  | `comments.approve`, `announcements.hide`, `announcements.pin`, `announcements.unpin`, `donations.receive` | `comments.reject`, `comments.hide`, `announcements.store`, `announcements.update`, `announcements.publish`, `donations.decline` |

  (`announcements.update` in the right-hand column is a `Route::patch`, not a
  POST; nothing the bullet claims turns on it, since all five 403s are genuinely
  POSTs.)

  All five are **bodiless POSTs**, and that is the whole of the pattern: this
  project ruled in Phase 2a that a bodiless POST does not acquire a Form Request
  solely to hold an `abort_unless`, so the five with nothing to validate have no
  second door. **Unreachable while the middleware is in place** — `EnsureShelfRole`
  aborts 404 on the same ability the policies delegate to — so this is
  defence-in-depth, not a live oracle. If it is ever closed, close it at the
  command layer for every caller rather than by minting five Form Requests that
  validate nothing.

### Found by the whole-branch RE-review, left unfixed by decision

Four defects the re-review measured after the fix wave. Kien's ruling was to record
them with their evidence rather than change shipped behaviour late in a reviewed
branch, so each carries what it would take to close it.

- **A 255-character title of expanding characters overflows `announcements.slug`
  and 500s.** `StoreAnnouncementRequest`'s `max:255` counts CHARACTERS, and
  `Fold::MAP` has four expanding entries — `ß`/`ẞ` → `ss`, `æ` → `ae`, `þ` → `th`,
  `œ` → `oe`. **Measured, not reasoned:** `Slugs::fromTitle(str_repeat('ß', 255))`
  returns a slug of **510 characters** against a `varchar(255)` column, under
  `'strict' => true`, so the INSERT raises errno **1406**. `UniqueViolation::translate`
  matches **1062 only** and rethrows, so a manager gets an uncaught 500 rather than a
  Vietnamese refusal.

  The rule's own docblock is the interesting half: it justifies `max:255` as
  *"Laravel's max counts characters for a string and so does a utf8mb4 varchar, so
  the two agree"*. That is **true of `title`, and false of the DERIVED `slug`** —
  a right instruction with a reason that does not cover the column that actually
  overflows, eleven lines above a comment warning about exactly that class.

  Manager-only and self-inflicted, which is why it is not urgent. **Pre-existing
  class, not 2b's:** `books.slug` is the same `varchar(255)` fed by the same
  `Slugs::fromTitle` via `CreateBook`, so a fix belongs in `Slugs` (cap the base at
  ~200 before `nextAvailable`, leaving room for the `-NN` suffix) or in
  `UniqueViolation` (translate 1406/1366 to a named refusal) and closes both.

- **`PublishAnnouncement` is the one of six locked-read guards that is not
  idempotent.** The other five (`ApproveComment`, `RejectComment`, `HideComment`,
  `ReceiveDonation`, `DeclineDonation`) refuse on a status enum, so a double-submit
  is refused. The sixth refuses on `published_at !== null && ! $supplied`, and
  `PublishDisclosure` always posts `expires_at` — which `ConvertEmptyStringsToNull`
  turns into a present-and-null key — so `$supplied` is true on both requests of a
  double-click. The lock serializes them; the second finds `published_at` non-null
  and the guard does not fire. `published_at` is re-stamped and a second
  `announcement.published` audit row is written.

  The file's sentence *"two managers pressing the button at once cannot both find it
  unpublished"* is true as written. What is not stated is that finding it published
  does not stop it. No block in `AnnouncementStateTest` (26 blocks) is concurrent or
  double-submit. Consequence is audit noise and a moved timestamp; no privilege is
  gained, since the same manager can reach the same state via Ẩn-then-Đăng.

- **A live notice can be republished over HTTP; only the client withholds the
  button.** POSTing `expires_at=` to `announcements.publish` against a *showing* row
  makes `$supplied` true, so `already_published` does not fire, `published_at` moves
  and `expires_at` is overwritten. The screen hides `PublishDisclosure` for
  `state === "showing"`, so no button reaches it, and the tests pin only the
  BODILESS post to a showing row (correctly refused). Not an authorization hole —
  the actor is a manager of that shelf who can reach the same state by hiding first
  — but it is a state-machine rule enforced client-side only.

- **The full announcement `body` ships to two list screens that render only the
  excerpt.** `AnnouncementsQuery::row()` emits both `body` and the 200-char
  `excerpt`; `published()` and `managed()` both return it and neither has a `limit`;
  neither list component declares `body` at all. `body` validates at `max:16000`
  characters, so a shelf with 200 notices ships megabytes of unread props on every
  visit, over a parish phone connection, growing without bound. `detail()` and the
  edit form genuinely need `body`, so the fix is a flag or a separate `listRow()`,
  not dropping the key. `AnnouncementController::edit` is the call site to watch: it
  loads every announcement via `managed()` and linear-scans for one id.

  Three props are shipped and read by nothing: `bookId` (`CommentModerationQuery`),
  `slug` (`AnnouncementsQuery`, manager list) and `donorMembershipId`
  (`DonationQueueQuery`). The last is an internal membership id on a page with no
  consumer for it; unlike `photoUrl`/`status`/`decisionNote`, it carries no note
  saying why it rides along.

## Phase 2c — Statistics and labels

Manager statistics screen and QR labels. Branch
`feat/phase-2c-statistics-and-labels`.

- **`App\Support\Clock::ZONE` now names the parish's civil timezone once, and
  `Clock::today()` reads it (Phase 2c Task 1).** `today()` previously spelled
  `'Asia/Ho_Chi_Minh'` inline; it now reads `self::ZONE`, and the new
  `Clock::periodStart(StatsPeriod $period)` — the boundary the statistics
  query (Task 2) and screen (Task 3) both use — is built on the same
  constant. `today()`'s returned value is unchanged: same
  `CarbonImmutable::now(...)->toDateString()` call, only the timezone
  argument's spelling moved from a literal to a constant reference.

  **`app/Queries/MyLoanHistoryQuery.php:39` and `:42` still hardcode
  `'Asia/Ho_Chi_Minh'`** (checked at the time of this entry — re-check the
  line numbers if the file has moved). That is shipped Phase 1c code, and
  editing it here would be scope creep into a merged phase; Phase 2c adds no
  new literal of its own, so leaving those two lines alone does not add to
  the count it inherited.

  The per-shelf `bookshelves.timezone` column exists and is deliberately not
  read by `Clock::ZONE` or `periodStart()` — there is one parish today, and a
  network of shelves with independently meaningful timezones is Phase 3's
  problem, not this one's.

- **No label sheet has ever been through a printer (Phase 2c Task 9).**
  `App\Support\Qr\LabelSheet` is verified as bytes — the diacritics survive
  into the text layer, the grid is 21 to a page, the symbol is vectors — and
  the geometry (186 × 255.4mm safe area inside the box A4 and US Letter
  share) is inherited verbatim from `old_next/src/lib/qr-labels.ts`, which was
  itself designed against measurements rather than a printed proof. Nobody has
  put a page on paper, cut a label out and scanned it with a phone. That is
  the one claim in this class no test can make.

  The related uncertainty is the symbol's quiet zone, and the sweep at the end
  of the phase re-measured it rather than repeating it. Each module is
  25 ÷ 29 = 0.862mm. Horizontally the symbol has `PAD` = 3mm to the label's
  border on its left and `TEXT_GAP` = 3mm to the code on its right — 3.48
  modules each side, against the four the QR specification asks for.
  Vertically it has (34 − 25) ÷ 2 = 4.5mm above and below, which is 5.22
  modules, comfortably over. So the shortfall is on two edges out of four and
  is about half a module. The reference sheet had exactly the same shortfall
  from exactly the same numbers (`old_next/src/lib/qr-labels.ts:44-45`,
  `QR_SIDE = 25`, `PAD = 3`), so this is inherited rather than introduced. The
  only ink inside the 3mm is the label's own 0.15mm cut-guide hairline.

  **This is to be settled by the physical print, not widened blind.** Adding a
  millimetre of quiet zone means taking it from the 24mm text column, which is
  already tight enough that Task 9's fix round existed because a space-free
  title overran it. Trading a measured text problem for an unmeasured scan
  problem, on the strength of a decimal, is the wrong direction. Print the
  sheet, scan a sticker with the phone a volunteer would actually use, and let
  that decide.

- **The TCPDF font definitions under `resources/fonts/tcpdf/` are generated
  artefacts that are committed, and `pint.json` now exists to keep Pint's
  hands off them (Phase 2c Task 9).** `TCPDF_FONTS::addTTFfont()` emits a
  `.php`, a `.z` and a `.ctg.z` per face. They live under `resources/` rather
  than `storage/app/fonts` as the task brief proposed, because
  `storage/app/.gitignore` is `*` — anything there is untracked, and
  `composer install --no-dev` on the host would ship without it. The
  regeneration command is in `LabelSheet`'s `FONT_REGULAR` docblock; its
  `$outpath` must be absolute, because TCPDF opens it through
  `TCPDF_STATIC::fopenLocal()`, which prefixes `file://`.

  Before `pint.json`, Pint reformatted the two generated `.php` files, so
  regenerating them produced a diff on the next lint. `pint.json` pins the
  preset Pint was already using by default (`laravel`) and excludes only
  `resources/fonts/tcpdf`, so no other file's formatting changes.

- **The diacritic proof is real text extraction, not a weakened substitute
  (Phase 2c Task 9).** This is recorded because the two possible outcomes are
  different guarantees and the difference is invisible from a green suite.
  `tests/Feature/Labels/LabelSheetTest.php:54` runs
  `(new Parser)->parseContent($pdf)->getText()` — `smalot/pdfparser` genuinely
  reading TCPDF's text layer — and line 92 asserts
  `toContain('Dế Mèn Phiêu Lưu Ký')`, the whole diacritic-bearing title. It is
  not a subset assertion, not a byte-count, not a "the PDF is non-empty"
  stand-in. The block was also shown to discriminate: with the title font
  mutated to `helvetica` this one expectation reddened while the file's other
  six stayed green, so it would catch a subsetted font that silently dropped
  the composed characters. What it does not and cannot prove is that those
  glyphs are legible once printed — that belongs to the paper entry above.

- **The camera scanner is unverified by any automated test, and cannot be with
  this toolchain (Phase 2c Task 12).** `resources/js/components/copy-scanner.tsx`
  owns the camera stream, the zxing-wasm decode and the Vietnamese sentence
  each failure turns into. None of it is exercised: `package.json`'s `test`
  script is `cd old_next && vitest run`, which runs the read-only reference
  app's suite, and this repository has no frontend test runner of its own.
  Adding one is not a line item inside a feature phase.

  The mitigation is structural rather than aspirational. Every place the
  scanner appears, the typed copy code beside it is a complete path to the
  same outcome — the volunteer who cannot get the camera to work types the
  code, and both routes are the same server call, which *is* tested
  (`tests/Feature/Labels/ScanResolveTest.php`). The scanner is an accelerant on
  a working path, never the only door.

  A consequence of that gap, found by review rather than by a test: after
  `notFoundHere` or `decodeError` the dialog stops the camera
  (`copy-scanner.tsx:130` and `:175`) but keeps the `<video>` element mounted
  over `bg-black`, so the volunteer sees a dead black frame with an error under
  it and no way to try again except closing the dialog and reopening it —
  which does reset cleanly, via the `onOpenChange` handler. Deferred, not
  fixed; the typed path is unaffected.

- **D4 was amended mid-phase, from FPDF to TCPDF, and the original reasoning
  was measured backwards (Phase 2c).** Recorded here as a retraction naming the
  original claim, because this project has watched a deleted false sentence
  return three commits later. The design doc's D4 originally chose
  `setasign/fpdf` and turned on the reason that it carried "no PHP extension
  dependency", which on a shared host nobody had logged into was worth more
  than convenience. From packagist metadata: `setasign/fpdf` 1.9.0 requires
  `ext-zlib` **and `ext-gd`** — the very extension the sentence said it avoided
  — while `tecnickcom/tcpdf` 6.11.4 requires `php >=7.1` and `ext-curl` and no
  gd. `composer install --no-dev` on a gd-less cPanel host would have refused
  FPDF's platform requirement outright. The retraction is deliberately narrow:
  D4's other two reasons, native millimetres and vector output, are true of
  FPDF; they simply do not discriminate, being equally true of TCPDF. Only the
  deciding reason was false, and it was false in the direction that reverses
  the ruling. The full amendment is in
  `docs/superpowers/specs/2026-08-31-laravel-phase-2c-statistics-and-labels-design.md`
  §D4.

- **`TenancyArchitectureTest`'s `bookshelf_id` tripwire is comment-blind, and
  it has now taught two implementers to edit correct prose.** This is a real
  finding for someone to rule on, not a note. The pattern at
  `tests/Feature/Architecture/TenancyArchitectureTest.php:151` is
  `/where[A-Za-z]*\s*\([^;]*bookshelf_id/i`, matched against
  `$file->getContents()` — raw source, comments included. Comments carry no
  semicolons, so `[^;]*` runs straight through a whole docblock: any file whose
  prose mentions a `where(...)` in one paragraph and `bookshelf_id` in a later
  one trips the guard, however correct both paragraphs are and whatever the
  code does.

  It fired on true prose **twice in this phase** — Task 2 and Task 7 — and both
  times the implementer's response was to reword correct documentation until
  the regex stopped matching. Both rewordings were reviewed and kept the
  guarantee they described, so nothing false shipped; but a tripwire whose
  observed effect is that people edit comments is training the opposite of what
  it exists for, and the next reword may not be reviewed as carefully. Two
  candidate fixes, neither applied here because narrowing a shipped tenancy
  guard is a ruling, not a sweep item: strip comments with `token_get_all()`
  before matching — which is exactly what this phase's own timezone census in
  `LabelsArchitectureTest` does, for this reason — or anchor `[^;]*` on a
  statement terminator so it cannot span a docblock. The related note that the
  grep is a tripwire and not a proof (a column name in a variable, a `join()`
  condition) is already recorded above and is unchanged.

- **The host must serve `.wasm` as `application/wasm`, and nobody has checked
  (Phase 2c Task 12).** The scanner's ~1.07 MB decoder is bundled and served
  from this app's own origin rather than from jsdelivr, so nothing depends on
  outbound CDN access at scan time. But emscripten's loader prefers
  `WebAssembly.instantiateStreaming()`, which requires the `application/wasm`
  content type; served as `application/octet-stream` it falls back to buffering
  the whole binary before compiling. Slower to the first scan, identical
  afterwards, correct either way — so this is a performance note, not a
  blocker. It is now row 15 of `docs/HOSTING.md`'s survey, which is where the
  unverified facts about that host belong, with the `curl -sI` probe and the
  one-line `.htaccess` fix.

- **Four deferred cosmetics from Phase 2c, left for the whole-branch review to
  triage.** None was fixed in the closing sweep, deliberately: a sweep that
  quietly edits shipped behaviour is how a documentation task becomes an
  unreviewed change.

  `resources/js/pages/manage/statistics.tsx:238` keys the top-readers `<ol>` on
  `reader.name`. Two readers with the same rendered name give React a duplicate
  key. The list still renders in query order; `topBooks` avoids it with
  `bookId`, and `topReaders`' prop shape carries no id, so a fix means widening
  the query's return shape.

  `resources/js/pages/manage/labels.tsx:151-157` renders
  `"{count} bản · Chọn cả đầu sách"` as static muted sub-text under each title.
  The second half reads like a control's label but names no control, and it
  repeats on every row. Fold it into the checkbox's `aria-label` or drop it.

  The expand/collapse button at `labels.tsx:159-167` has no `aria-expanded` or
  `aria-controls`. The `hidden` class does correctly remove the collapsed list
  from the accessibility tree, so nothing is announced that is not there; the
  button simply never announces its own state. One attribute.

  The scanner's dead black frame after a failed scan, described under the
  camera entry above.

## Phase 3a — the network foundation

The sanctioned cross-shelf capability and its fence, the public portal's search,
and the administration dashboard. Branch `feat/phase-3a-network-foundation`, cut
from `main` at `da93891`. This is the first phase in which a request-path query
deliberately reads outside its tenant, so most of what follows is about the
distance between what the fence proves and what it merely discourages.

- **The widening capability now exists on a request path, and the fence around
  it is two greps (Phase 3a Task 2).** `TenantContext::systemWide(callable)`
  widens, runs the callback, and restores what it found in a `finally` — the
  prior bookshelf, the prior membership and the prior flag, by object identity,
  on the exception path too. `tests/Feature/Architecture/WideningArchitectureTest
  .php` pins it twice: raw `->actSystemWide(` may appear only in
  `TenantContext` itself, `SweepReminders` and `DemoShelfSeeder`, and
  `->systemWide(` may appear only under `app/Queries/Admin/`. Both were
  re-falsified at the phase's final commit — a call planted in `ShellController`
  reddens pin 1 at line 73 and pin 2 at line 89 respectively, each with the
  other staying green, and pin 2 stays green with its one legitimate inhabitant
  (`AdminOverviewQuery`) present.

  **What that does not prove is anything about behaviour.** Both pins match raw
  file text with a regular expression, which is the same instrument
  `TenancyArchitectureTest` uses for `bookshelf_id` and the same limits apply —
  that test states them itself, at lines 143-146 and 181-182: a method or column
  name held in a variable slips the pattern, and so does a `join()` condition.
  `$m = 'systemWide'; $ctx->$m(...)` passes both pins. They are tripwires
  against the ordinary, legible way of writing the call — which is how the call
  will in fact be written — not a proof that no widening exists outside the
  allow-list.

- **`clear()` still has no caller in `app/`, and `actSystemWide()` is still
  directly callable by three files (Phase 3a Task 2).** The wrapper is the
  sanctioned path, not the only possible one. `TenantContext::clear()` has zero
  callers anywhere under `app/` — its callers are `DemoShelfSeeder` and a
  handful of test fixtures — so nothing in the request lifecycle ever resets a
  widening that was performed outside the wrapper; that is precisely why the
  wrapper's `finally` is load-bearing, and stripping it to a bare
  `actSystemWide(); return $fn();` reddens four of the five lifetime blocks in
  `tests/Feature/Admin/TenantWideningTest.php` plus the consumer-side restore
  block in `AdminOverviewQueryTest`. Meanwhile `actSystemWide()` remains public
  and remains reachable from the three allow-listed files without going through
  `systemWide()` at all. A future editor of `SweepReminders` or of
  `TenantContext` itself is inside the fence by construction.

  A related asymmetry, recorded rather than fixed: pin 2's allow-list is
  literally empty — it works by a `str_starts_with('app/Queries/Admin/')`
  rejection instead — so `TenantContext.php` is not exempted from its own
  pattern. It is protected only by never writing `->systemWide(` in its own
  body. A wrapper that one day delegates to itself would redden the pin that
  exists to protect it.

- **The three new folded columns inherit the `Fold::MAP` cascade hazard (Phase
  3a Task 5).** `bookshelves.name_folded`, `location_folded` and
  `address_folded` are STORED generated columns over the existing
  `FoldExpression`, identical in construction to `books.title_folded` and
  `users.full_name_folded`. The migration adds no `Fold::MAP` entry, so it does
  not re-open the sequential-`REPLACE()` question described above — but it
  widens the blast radius of the next person who does. Adding a MAP entry now
  rewrites five generated columns across three tables rather than two across
  two, and every one of them must survive `FoldParityTest` and the NFD-derived
  oracle before the DDL is regenerated.

- **The dashboard screen is unverified by any test, as every screen in this repo
  is (Phase 3a Task 4).** `resources/js/pages/admin/dashboard.tsx` has never
  been rendered by a test runner, because there is no runner for
  `resources/js`: `package.json`'s `test` script is `cd old_next && vitest run`,
  which exercises the read-only reference application. What
  `AdminDashboardScreenTest` asserts is the Inertia payload — the component
  name, the row count and the presence of the keys — plus the 404-not-403
  refusal and the guest redirect. That the columns render, that the two badges
  show the icons Task 4's fix round added, and that the Vietnamese copy is the
  copy intended, are read by eye and by nothing else.

- **Seven deferred minors, left for the whole-branch review to triage.** None
  was fixed in this sweep, on the same principle the Phase 2c sweep followed: a
  closing documentation task that quietly edits shipped behaviour is an
  unreviewed change wearing a sweep's clothes.

  `StyleGuideTest`'s `$notComponents` escape list is entirely vacuous. It names
  eleven words — `README`, `AGENTS`, `MariaDB`, `TypeScript`, `Vietnamese`,
  `Laravel`, `Inertia`, `Pest`, `Larastan`, `Pint`, `Biome` — and after Task 1's
  rewrite the only backticked PascalCase word left in `AGENTS.md` is
  `CopyScanner`. Every entry is therefore a hole in the pin doing no work, and
  it came verbatim from the task brief rather than from the file. Trim it to
  what the guide actually contains, or the first genuinely-missing component
  whose name happens to be on the list will pass unnoticed.

  `make test FILTER="A|B"` cannot work. The `Makefile` interpolates `FILTER`
  unquoted into `php artisan test --filter=$(FILTER)`, so `|` is read by the
  shell as a pipe. Pre-existing, not introduced here, and it affects any
  multi-file filtered run — this phase's own falsification passes were each run
  one filter at a time because of it. One pair of quotes.

  Two of `AdminOverviewQuery`'s contract clauses are unpinned by the fixtures
  that claim to test them. The `readers` block is named "managers included", but
  all three of its memberships are created with `'role' => 'reader'`, so an
  implementation that added `->where('role', 'reader')` would still pass — one
  extra fixture row closes it. The `loans` figure's `status = active` filter is
  likewise unpinned: both loans in the overdue block are `Active`, so dropping
  that `where()` still yields 2 — one returned loan closes it. Neither is a bug
  in the shipped query, which has no role filter and does filter on status;
  both are coverage gaps.

  `loans` and `overdue` inherit the `SoftDeletes` exclusion, where the reference
  SQL counted loans with no `deleted_at` predicate at all. Arguably the more
  correct behaviour, and silently divergent from the ported query either way.

  The Task 2 report places `clear()` at `TenantContext.php:71`, which was true
  at `2474c3f` and is line 110 after the wrapper was inserted. Report prose
  only; the shipped docblock carries no line numbers, which is why it did not
  rot.

- **`TenancyArchitectureTest`'s comment-blind grep fired for the third time in
  two phases, and this is now a pattern rather than an incident (Phase 3a Task
  3).** The Phase 2c section above records the first two occurrences, in that
  phase's Tasks 2 and 7, and proposes two fixes. The third occurrence is worse
  than the first two in a specific way worth stating: the implementer of
  `AdminOverviewQuery` could not quote its own chain-ordering regular
  expression inside its own docblock, because the quoted pattern tripped the
  guard — so the docblock explains in prose what it is forbidden from showing.
  The first two occurrences cost a reword. This one cost explanatory power: the
  documentation of a deliberate, easily-undone query ordering is now strictly
  less precise than it would be if the guard could read PHP.

  Three occurrences in two phases, every one of them on true prose, and every
  one resolved by editing correct documentation until a regex stopped matching,
  is enough evidence to stop calling it bad luck. Either fix already proposed —
  stripping comments with `token_get_all()` before matching, as
  `LabelsArchitectureTest` does, or anchoring `[^;]*` on a statement terminator
  — would close all three. Narrowing a shipped tenancy guard remains a ruling
  for the whole-branch review, not a sweep item.

- **D8's stated reason was false, and it survived four independent reviews
  (Phase 3a Task 5).** The design document argued for the folded-columns
  migration on the premise that "a naive `LIKE` finds nothing for *Giáo xứ Hòa
  Bình* when a parent types `hoa binh`". Measured on this project's MariaDB
  10.11 with `SET NAMES utf8mb4`, that expression under `utf8mb4_unicode_ci`
  returns `1`: the collation folds vowel diacritics by itself, and
  `bookshelves.name`, `location` and `address` all carry it. What it does not
  fold is the Vietnamese `đ`/`Đ` (U+0111) — `'Đồng Tháp' LIKE '%dong thap%'`
  returns `0` — which `Fold::MAP` maps to `d`. The migration is justified; the
  reason given for it was not. The spec's D8 now carries that retraction, and so
  do the migration's docblock, `ShellController::shelves` and
  `PortalSearchTest`.

  **Recorded here because of how it was caught, which is the transferable
  part.** Not by either review of the spec, nor by either review of the plan —
  four independent passes over prose. It was caught by the Task 5 implementer's
  *mandatory* mutation: with the fixture searching `hoa binh`, replacing the
  folded-column match with a plain `LIKE` on the source columns left the block
  **green**. The test could not fail, and being required to make it fail is what
  surfaced the false premise underneath it. The fixture moved to *Đồng Tháp* /
  `dong thap`, where that same mutation now reddens four blocks while a fifth,
  deliberately labelled as the collation's own case, stays green.

- **An archived bookshelf is still reachable by anybody who can reach an active
  one, and 3a did not close it.** `app/Http/Middleware/ResolveTenant.php:36`
  resolves `{shelf}` by slug under Eloquent's SoftDeletes global scope alone —
  `Bookshelf::query()->where('slug', $slug)->first()` — with no `status`
  condition, and nothing anywhere in `app/` references
  `BookshelfStatus::Archived` (grepped at the end of the branch). Measured: an
  ordinary active member of an archived shelf gets **200** on `GET
  /shelves/{slug}` and **200** on `GET /shelves/{slug}/catalogue`. The reference
  behaved differently — `old_next/src/auth/guards.ts:22` filters
  `status = 'active'` in the same resolution — so this is a divergence
  introduced when the middleware was ported, i.e. **pre-existing from Phase 0/1,
  not from 3a**.

  **Left open deliberately.** Adding a `status` filter to `ResolveTenant` alters
  the entry condition of every tenant-bound route in the application at once,
  and it is shelf administration, which is **Phase 3b's** — that phase owns
  archiving and un-archiving, so it owns what an archived shelf may still serve
  (and to whom: an archived shelf's own manager plausibly still needs its
  screens, which is a decision, not a bug fix). Doing it inside a fix wave for
  the admin dashboard would have been an unreviewed middleware change.

  **What 3a did fix is the paperwork, and that is the transferable part.** The
  reference's *reason* for D9 — "an administrator is the only person who can see
  one at all, `resolveShelfId` refuses its slug to everybody" — had been quoted
  verbatim, as settled fact about this codebase, into `AdminOverviewQuery`'s
  docblock, `ShellController::shelves`'s docblock, `PortalSearchTest` and
  `AdminOverviewQueryTest`. It was false in all four, and it was false because
  it was copied from the reference rather than measured against HEAD — the same
  failure mode as D8's retraction above, in the same phase. D9 now carries a
  named retraction, and the decision rests on a claim that IS true here: the
  admin dashboard is the only surface in the application that renders
  `bookshelves.status` at all, so a listing that dropped archived shelves would
  leave nowhere to see that a shelf had been archived.

## Phase 3b — the design system port

The warm palette and the two typefaces from `old_next`, ported onto shadcn's 33
semantic variables so the 42 existing screens change colour without a single
component being edited. Branch `feat/design-system-port`, cut from `main` at
`7704d10`. Nothing under `resources/js/pages` or `resources/js/components` was
touched, which is the property the whole change rests on — and also the reason
two of the entries below exist, since a token-only change cannot reach the places
where a token is not what is missing.

- **The six status inks are not ported, and the gap is two-thirds of a rule, not
  one-third (Phase 3b, spec D4).** The reference defines `available` `#457453`,
  `onloan` `#8e6231`, `held` `#4d6d8f`, `overdue` `#ad4c42`, `lost` `#94514a` and
  `retired` `#716962`. None of them exists in `resources/css/app.css` after this
  phase. `AGENTS.md:57` asks that every state carry **an icon, a Vietnamese word
  and a colour together**; the six copy-item states declared at
  `resources/js/lib/copy.ts:155` — "Có sẵn", "Đang cho mượn", "Đang giữ chỗ", "Đã
  mất", "Ngừng dùng", "Chưa có bản nào" — currently render as a bare word inside
  a stock shadcn badge at four call sites: `resources/js/components/book-card
  .tsx:48`, `resources/js/pages/shelves/book.tsx:157`,
  `resources/js/pages/manage/books/show.tsx:319` and
  `resources/js/pages/manage/books/index.tsx:132`. Read those four and the badge
  carries no `ui/icon.tsx` child and no per-state variant, so the deferral leaves
  **the icon and the colour** unmet and only the word satisfied.

  Porting them properly means twelve values rather than six (each ink needs a
  derived dark counterpart, on the same basis as every other ink here), a
  fill-vs-ink decision per state, and edits to those four screens — per-screen
  visual work, which spec D5 puts out of scope, on a palette that has not yet
  been seen on a real screen. Recorded rather than done. **Nothing becomes
  ambiguous in the interim:** the six states stay fully distinguishable by their
  Vietnamese word, so this is a loss of redundancy and of colour-blind-friendly
  reinforcement, not a loss of information.

- **`--primary` is pinned to the reference's *hover* colour, so every primary
  button now renders permanently in what the reference treats as the pressed
  state (Phase 3b Task 2).** `docs/DESIGN.md:205` specifies the primary button as
  `bg-terracotta` with `hover:bg-terracotta-ink` — two distinct values,
  `#a4673b` and `#965c33`, and `DESIGN.md:40` names the second one "pressed".
  shadcn has **one** variable for both jobs, and that variable must also survive
  being used as text: the fill `#a4673b` measures 4.44 against `page` and 3.87
  against `paper`, both below AA. So `resources/css/app.css:239` pins `--primary`
  to `#965c33` and the comment above it says why.

  This is not a free choice between two shades. `bg-primary` appears at **14**
  sites under `resources/js` and `text-primary` at **6**; a value that satisfies
  the fill sites fails the text sites, and there is no third value that is both
  the reference's fill and legible as body text. The visible cost is that the
  primary button has no hover travel left — it starts where the reference's hover
  ends. Splitting it back into two (a `--primary` fill plus a separate ink token
  for the six text sites) is component-level work and therefore D5's; **this is
  the first item the per-screen refinement pass should look at.**

- **Two vacuous-guard traps, both found by falsification rather than by review,
  both of which had already produced a green test over a real defect (Phase 3b
  Task 4 and Task 5).** The phase's house rule required every guard to be watched
  failing before it was accepted, and these are what that rule caught. They are
  recorded here because both are general to this repo, not to this phase.

  **Pest's `toContain` is variadic.** Written the natural way,
  `expect($src)->not->toContain($needle, $message)` reads the message string as a
  *second needle* and negates the conjunction — the assertion becomes "does not
  contain both", which the message text always satisfies on its own, so it passes
  unconditionally no matter what `$src` holds. Watched passing green over a live
  font-CDN link in a Blade view. The working form is
  `expect(str_contains($src, $needle))->toBeFalse($message)`, which is what
  `tests/Feature/Architecture/DesignSystemTest.php:346-352` now uses, with the
  trap written out in a comment beside it. Every other `->not->toContain(` in
  `tests/` was checked at the end of this phase and each passes a single
  argument, so no existing guard is currently vacuous this way — but nothing
  stops the next one, since the failure mode is the *obvious* way to attach a
  message.

  **Blade compiles its directives from inside CSS and HTML comments.** A comment
  in `resources/views/errors/419.blade.php` that named the asset directive
  literally, in order to explain why the error page deliberately does not use it,
  was compiled as a directive and threw `ArgumentCountError` — which took down
  four unrelated tests in `tests/Feature/Members/RegistrationScreenTest.php`,
  nowhere near the file that was edited. Describe such directives in prose inside
  Blade files; do not write their literal spelling even in a comment. This is the
  same class of failure as the comment-blind grep recorded under Phase 3a, from
  the opposite direction: there a tool that could not read comments matched prose
  it should have ignored, here a tool that *does* read comments executed prose it
  should have ignored. Both cost correct documentation.

- **The dark palette is invented, not ported, and the method has known limits
  (Phase 3b Task 2, spec D3).** `old_next` has **no dark mode at all** — zero
  matches under `old_next/src` for `.dark`, for `dark:` and for
  `prefers-color-scheme`. So there is no reference to be faithful to, and every
  value in the `.dark` block at `resources/css/app.css:268` is derived: each ink
  keeps its light counterpart's hue and saturation and is lightened until it
  reproduces that counterpart's contrast ratio against `paper` — the worst-case
  ground, since `--muted`, `--accent` and `--secondary` all map onto it.

  That is a heuristic for equal *legibility*, and it is being read as though it
  were a proof of equal *appearance*. Two limits worth stating plainly, because
  neither shows up in a passing contrast test: WCAG relative luminance is not
  perceptually uniform, so two pairs at the same ratio can look unequally
  emphatic; and HSL saturation is not chroma, so holding S constant across a
  large lightness change does not hold colourfulness constant — OKLCH would model
  both correctly and was not used. **The dark palette therefore expects a
  hand-tuning pass once it has been seen on screen**, and the numbers being green
  is not evidence that pass is unnecessary.

### Stock Tailwind colours still live on screen, and `--color-sage` has no consumers

The port re-points shadcn's semantic variables, so anything written against
those variables went warm automatically. Anything written against a **literal
Tailwind palette class** did not, and the design-system branch did not touch
components. These are the surfaces still rendering cold, listed here because
the D5 per-screen pass otherwise has no inventory to work from:

- `resources/js/components/input-error.tsx:10` — `text-red-600 dark:text-red-400`.
  This is the form-error component, imported by **11** files, so every validation
  message in the app renders in Tailwind red rather than the ported brick
  (`#af4c44` light / `#c87871` dark).
- **Ten flash-success banners** hardcoded `border-green-700/30 bg-green-700/10`:
  `pages/shelves/book.tsx:244` and `:513`, `shelves/donate.tsx:76`,
  `shelves/profile/overview.tsx:125`, `manage/donations.tsx:228`,
  `manage/borrow-requests.tsx:423`, `manage/comments.tsx:239`,
  `manage/lend/index.tsx:69`, `manage/announcements/index.tsx:240`,
  `manage/returns/index.tsx:134`.
- Two warning banners `border-amber-400/50 bg-amber-50 dark:bg-amber-950/30`:
  `manage/readers/show.tsx:114`, `manage/registrations/index.tsx:80`.
- `pages/auth/login.tsx:36,50` — `text-red-700`.
- `resources/js/app.tsx:34` — the Inertia progress bar pinned to `#4B5563`, a
  cold slate. This is global chrome on every navigation, and `app.tsx` sits
  outside the `pages/` + `components/` scope the plan froze, so it could have
  been changed without violating the plan. It was not, because the palette
  change was meant to be provably component-free.

The direct consequence: **`--color-sage` (`#477369`) ships with zero
consumers.** It was ported precisely for the positive/success role that those
ten green banners occupy, so the token is dead until they are converted. That
is the cheapest first item for the D5 pass.

### Three seams the whole-branch review found unguarded, now closed

Recorded because each was green-passing and invisible, and the pattern is worth
remembering rather than the individual fixes:

- **`--color-terracotta` had an asserted consumer and an unasserted producer.**
  A test pinned the `:focus-visible` outline that *reads* the token; nothing
  pinned the `@theme` line that *declares* it. Deleting the declaration left the
  outline invalid at computed-value time — no focus ring on any non-shadcn
  focusable — with a clean build and a green suite. The agent that wrote the
  assertion did not own the line it depended on, which is the general shape of a
  cross-task seam.
- **`--radius-md` carried 107 control call sites with no guard.**
- **`@font-face` `src` was entirely unasserted**, so a block could declare weight
  500 while pointing at the 400 file and pass every other font check.

### A documentation error worth more than the thing it documented

Mid-implementation this plan gained an environment note saying Prettier covers
`resources/css/app.css`. It does not: `.prettierignore:12` ignores `resources`
wholesale and `biome.json:4` scopes Biome to `resources/js/**`, so the file is
covered by **no formatter or linter at all**, and `npx prettier --check` on it
reports a false pass. The note came from an implementing agent's report and was
written into the plan without being verified — the same defect class this
project keeps hitting, arriving this time through a document rather than a spec.

## Phase 3b-i — shelf administration

The `/admin` area's four placeholders become real: a shelf can be opened, its
profile, policy and contacts corrected, archived and restored, and its managers
appointed, revoked and promoted. Branch `feat/phase-3b-i-shelf-administration`,
cut from `main` at `213d04f`. This is the first phase with a sanctioned
cross-shelf **write** capability, and most of what follows is either a sharp
edge the reference already had and we ported faithfully, or a half of the work
that 3b-ii owns and must not land out of order.

- **A shelf may be left with no manager, by decision (spec D6).** The
  reference's `revokeManager` counts nothing, so a super administrator can take
  the last grant on a shelf and leave it with nobody to approve a registration
  or lend a book. `app/Actions/Admin/RevokeManager.php:39-42` ports that
  faithfully rather than inventing a refusal — a refusal we invented would need
  its own wording and its own edge cases (what of a shelf whose only manager is
  suspended?), none of which the requirements decide.

  **What 3b-i adds is the visibility, and that is what makes the decision
  defensible.** `AdminOverviewQuery` now returns `managersMissing` beside the
  `contactsMissing` 3a already had (`app/Queries/Admin/AdminOverviewQuery.php:
  269-270`), and both the dashboard and `/admin/shelves` render it
  (`resources/js/pages/admin/dashboard.tsx:67-78`,
  `resources/js/pages/admin/shelves/index.tsx:78-89`). The predicate is
  deliberately narrower than "has a manager row" in **three** ways: a suspended
  manager cannot act, and a manager whose `users` row is gone is gone, so both
  read as missing; and an **archived** shelf is not flagged at all, because
  `BookshelfPolicy::assignManager()` 404s an archived shelf and
  `ManagerCandidatesQuery` excludes it — an alarm no control on the page can
  clear is noise, not a warning. The third narrowing was added in the fix wave
  after the whole-branch review; the spec's D6 and the plan's five-row table
  predate it and describe only the first two.
  A permitted sharp edge that nothing surfaces is just a hole.

- **There is no super-admin demotion anywhere in this port (spec D5), and the
  omission is ported as an omission.** The reference's own docstring
  (`old_next/src/domain/admin/commands/managers.ts:132-134`) is the entire
  reasoning: removing the last administrator's own grant would lock the
  installation out of its own administration surface, and nothing in the
  requirements says what should happen instead. So `/admin/managers` can grant
  the global role (`PromoteSuperAdmin`, refusing a target who already holds it
  as `already_super_admin`) and cannot take it back. `RevokeManager.php:44-48`
  states this at the one place somebody would look for it. Inventing the rule —
  "the last super admin may not be demoted", or "any super admin may demote any
  other" — would be this port deciding a requirements question on the product
  owner's behalf, which is what the omission is for.

- **Two live settings still have no editor anywhere, and this phase did not add
  one (spec D2).** `public_show_current_borrower`
  (`app/Queries/BookDetailQuery.php:127`) and `public_name_display` (`:141`) are
  both read by shipped code — they decide whether a public book page names the
  person currently holding a copy, and under which name — and nothing in the
  application writes them. The policy form deliberately carries the reference's
  eight (`loan_days`, `max_concurrent_loans`, `max_renewals`, `renewal_days`,
  `hold_days`, `due_soon_days`, `comments_enabled`,
  `comments_require_approval`), because its own docstring calls them *"the six
  lending-policy numbers and the two comment toggles"*
  (`old_next/src/app/quan-tri/admin-actions.ts:256`), and
  `app/Http/Requests/Admin/UpdateBookshelfPolicyRequest.php:21` records the two
  omissions where the form is defined. Quietly widening a form the reference
  kept at eight is a bigger change than it looks: these two govern disclosure of
  a reader's identity to the public, so they want a decision about defaults and
  wording, not a ninth and tenth input.

- **`leaderboard_enabled` and `leaderboard_size` are stale requirements text,
  and are recorded that way on purpose.** BR §5.5 lists them
  (`docs/BUSINESS-REQUIREMENTS.md:235-236`) and they are consumed **nowhere**:
  grepped across `app/`, `resources/`, `database/`, `lang/` and `routes/` at the
  end of this branch, the only hit for the word at all is a docblock line
  explaining that the opt-in is gone
  (`app/Http/Controllers/Manage/StatisticsController.php:23`). The leaderboard
  opt-in was withdrawn on 2026-08-12 (`docs/DATABASE.md:490`) and *Bạn đọc chăm
  nhất* now counts every borrower without reading a setting.

  **Recording them beside the two above, as "shipped but uneditable", would have
  been the defect and not the fix.** That sentence would assert a consumer that
  does not exist, and the next person to act on it builds an editor for two keys
  nothing reads — which is precisely the false-premise-copied-from-a-document
  failure `known-gaps.md:4331-4338` dissects (there, a premise copied from the
  reference into four docblocks and a test). The spec's D2 catches this; its own
  risk list at
  `docs/superpowers/specs/2026-08-31-laravel-phase-3b-i-shelf-administration-design.md:474`
  does not, and still says "four shipped settings remain uneditable". Two.

- **The contacts disclosure boundary has no direct test in this phase, and the
  proposed one was dropped rather than written.** Spec §5.2 asked for "no route
  added here reads `bookshelf_contacts` for a caller without a membership".
  3b-i adds no public route touching contacts at all — every contacts read is
  behind `EnsureSuperAdmin` — so the assertion is vacuously green against any
  implementation, including one that got it wrong, and a green test that cannot
  fail is worse than none because it reads as coverage. What actually holds the
  boundary is `BookshelfContact` carrying `BelongsToBookshelf` (so its global
  scope throws rather than leaks outside a bound tenant) and 3a's decision that
  the portal exposes no contacts. Both are real; neither is pinned *by this
  phase*, and the test that would pin them belongs to whichever phase first
  ships a public surface that could plausibly read the table.

- **Exporting an archived shelf's records is unbuilt and unscheduled, and that
  is a precondition on 3b-ii rather than a wish.** The reference's signed
  comment (`old_next/src/auth/guards.ts:27-37`) names *two* needs an explicit
  admin path must serve once archiving 404s the slug for everyone —
  "reactivating it, exporting its records". 3b-i builds only the first: archive
  and un-archive from `/admin/shelves`. Export has no home in 3b-ii's list
  either.

  **So the resolver filter must not land until export is scoped.** Today an
  archived shelf still serves its routes (next entry), which is a gap but also,
  accidentally, the only remaining way to read a parish's own register after it
  is archived. Close the resolver without an export path and archiving becomes
  the way to make a parish's records unreachable — by its readers, by its
  managers, and by the administrator who archived it — with the data all still
  there. That is a worse failure than the one being fixed, and it is one commit
  away from being shipped by somebody who reads only the previous entry.

- **The archived-shelf resolver filter is deferred to 3b-ii (spec D4), so an
  archived shelf still serves its routes today.** This is the pre-existing
  Phase 0/1 behaviour recorded at `docs/known-gaps.md:4306-4338`, unchanged by
  this phase: `app/Http/Middleware/ResolveTenant.php:36` still resolves `{shelf}`
  by slug with no `status` condition. D4 settles what the behaviour *should* be
  — archiving takes a shelf out of circulation entirely, 404 for readers,
  managers and the portal alike, with no "let the admin in anyway" carve-out —
  and then declines to ship it here, because changing the entry condition of
  every tenant-bound route in the application, in the same phase that first
  builds the repair path, would ship the blast radius and its remedy in one
  unreviewed breath. 3b-i builds the un-archive half; the filter follows against
  a phase where the repair route already exists — and, per the entry above,
  where export does too.

### Four divergences from the reference, decided during implementation

Each is argued at length in the code, so the reasoning survives where somebody
would look for it. They are collected here because a divergence recorded only
in the file that makes it is invisible to anyone reviewing the phase.

- **`bookshelf.created` and `bookshelf.archived` are filed against the shelf,
  not globally.** The reference sets `global: true` on both — for creation
  because "the shelf did not exist when the decision was made"
  (`app/Actions/Admin/CreateBookshelf.php:32-39`), for archiving because over
  there an archived shelf's slug stops resolving the moment the command commits,
  so a shelf-scoped row would be written into a log nobody could open
  (`app/Actions/Admin/ArchiveBookshelf.php:35-44`). This port files both against
  the shelf, so its audit screen tells the shelf's whole story from its first
  act; `bookshelf.unarchived` is filed the same way, which is what makes the
  archive/un-archive pair readable in sequence. Only `user.promoted_super_admin`
  is global.

  **The consequence is a dependency on the previous section.** The archiving
  argument holds *because* the resolver filter is not in yet. If 3b-ii lands it,
  these rows become unreachable from the shelf's own audit screen — the shelf
  whose story they tell is exactly the shelf whose URL no longer resolves. That
  argues for an admin-side audit view in 3b-ii, and is a second reason the
  resolver filter is not a self-contained change.

- **Creating a shelf does not collect contacts, so a new shelf is born flagged
  `contactsMissing`.** The reference's `createBookshelf` refuses a shelf with no
  position-1 contact. Here the create form takes profile fields only and
  redirects to the new shelf's own editor, where Task 5's contacts form lives
  (`app/Http/Controllers/Admin/ShelfController.php:105-107`, and the plan's Task
  5). The reasoning is that this port already has the mechanism the reference's
  refusal substitutes for — the incompleteness flag on the dashboard — and that
  a create form which refuses until three volunteers are named is a worse
  onboarding path than one that opens the shelf and says what is still missing.
  The cost is real and is the thing to watch: **every shelf created through this
  screen shows the flag until somebody returns to fill it in**, so the flag's
  signal is diluted by exactly the shelves that are simply new.

- **Task 7's two state refusals are `RuleViolated` codes with sentences, where
  Task 6's are policy 404s.** Revoking somebody who is already a reader throws
  `not_a_manager` (`app/Actions/Admin/RevokeManager.php:72`,
  `lang/vi/rules.php:353`) and promoting an existing super admin throws
  `already_super_admin` (`PromoteSuperAdmin.php:58`, `rules.php:359`) — both
  named sentences on screen. Archiving an already-archived shelf, the same shape
  of no-op, is instead refused by `BookshelfPolicy::archive()` as a 404 (spec
  D9). The reasoning is in `RevokeManager.php:27-37` and in
  `app/Policies/BookshelfPolicy.php:121-139`: the anti-enumeration argument that
  makes archive a 404 has nothing to protect on the managers screen, which lists
  the person by name one line above the control, so a 404 there would only be a
  blank answer about somebody the caller is already looking at. Defensible, but
  it does mean **two adjacent screens in the same area refuse the same shape of
  mistake in two different registers**, and a third screen's author will have to
  read both to know which applies.

- **Appointing on an archived shelf is refused; revoking on one is still
  allowed.** Stricter than the reference, which checks no status in either
  command. `BookshelfPolicy::assignManager()` requires
  `BookshelfStatus::Active` (`:98-118`) because `AssignManager` itself reads no
  status, so appointing to an archived shelf would silently mint a membership
  nobody can exercise, through a redirect that looks like every other success.
  `revokeManager()` deliberately does not mirror it (`:121-139`): a shelf
  archived while somebody still held its keys is precisely when taking them back
  matters, and the manager list exists so an administrator can undo what is
  already there.

### Three census-shaped pins this phase touched, and two greps that cannot read

Recorded because the census tests are the mechanism this repo relies on to keep
lookup tables honest, and because two of the greps around them have limits that
have now cost documentation twice in this phase alone.

- **The audit census** (`tests/Feature/Architecture/AuditActionCensusTest.php`)
  and the partition test (`tests/Unit/Audit/AuditSentencesTest.php:423-435`) both
  moved: `AuditSentences::ACTIONS` goes from 41 to **48**, and `GROUPS` gains a
  fifth, `administration`. The partition test spells the five group names out
  literally rather than reading them from `GROUPS`, which is what makes adding a
  group a deliberate act. Registering `bookshelf.created` also retired it as the
  suite's canonical unregistered probe at three sites; the replacement is a
  synthetic string no domain will claim, so the fallback census keeps biting.
- **The refusal-code census**
  (`tests/Unit/Catalogue/RuleViolatedCodesHaveSentencesTest.php`) now carries
  three more codes from this phase — `not_a_manager`, `already_super_admin` and
  the reused `membership_not_found`. Its own comments record that it has been
  widened twice already, each time because a real code had dropped silently out
  of its regex; a new code minted in `app/Actions/Admin/` with no
  `lang/vi/rules.php` line is what it exists to redden.
- **The widening fence** (`tests/Feature/Architecture/WideningArchitectureTest
  .php`) was amended by spec D0 to admit `app/Actions/Admin/` alongside 3a's
  `app/Queries/Admin/`, because cross-shelf **writes** cannot live in a Queries
  namespace. Everything Phase 3a recorded about what that pin does and does not
  prove still applies unchanged, and the blast radius is now two directories
  rather than one.

- **`WideningArchitectureTest::offendersFor` reads raw file contents with no
  comment stripping** (`:32`, `preg_match($pattern, $file->getContents())`).
  So a docblock that writes `->systemWide(` in prose, in a file outside the two
  sanctioned directories, reddens the fence — the pin cannot tell an explanation
  from a call. `AuditActionCensusTest` in the same phase does it the other way,
  stripping `T_COMMENT`/`T_DOC_COMMENT` with `token_get_all()` first (`:13-29`)
  and saying in its own comment why a regex for "a comment" is the wrong tool.
  The two guards, written for the same repo, disagree about whether comments are
  code.

- **`TenancyArchitectureTest`'s `[^;]*` spans out of a comment and into the code
  below it** (`:151`, `:153`), because a comment carries no semicolon to stop it.
  This bit Task 3: the `whereHas('user')` predicate that `AdminOverviewQuery`
  restates from `ManagerDashboardQuery` could not be written out in a comment
  near the grouped query, so `AdminOverviewQuery.php:227-233` explains in prose
  that it is explaining in prose, and the file's docblock declines to quote the
  pattern it is describing because quoting it would satisfy it (`:94-99`). This
  is the **fourth** occurrence in three phases — Phase 2c's Tasks 2 and 7 and
  Phase 3a's Task 3 are recorded above — and the fix proposed there twice over
  (strip comments with `token_get_all()`, as `LabelsArchitectureTest` and now
  `AuditActionCensusTest` both do, or anchor `[^;]*` on a statement terminator)
  would still close all four. Narrowing a shipped tenancy guard remains a ruling
  for the whole-branch review rather than a documentation task's to make.

## Phase 3b-ii — settings, taxonomy and the public contact page

The installation gets its own settings row and a public face: `/admin/settings`
writes the administration's contact block and the defaults a new shelf starts
with, `/contact` publishes that block to a parish with no bookshelf at all,
`/admin/categories` edits the book genres, the admin shelf editor gains the
parish taxonomy's *shape*, and `manage/units` gains the units themselves.
`/manage/settings` becomes a real, read-only screen. Branch
`feat/phase-3b-ii-settings-and-taxonomy`. Ten audit actions land, 48 → 58. Most
of what follows is a half of BR §16 this phase deliberately did not build, or a
place where the port's own arrangement diverges from the requirements' text.

- **~~The public contact form is deferred to 3c, to land with the inbox that
  reads it (spec D2).~~ CLOSED 2026-09-01, phase 3c-ii Task 3.** The form is
  built, on the `/contact` page this entry is about: `POST /contact`
  (`contact.feedback`) reaches `App\Http\Controllers\ContactController::store`,
  which calls `App\Actions\Community\SubmitFeedback` with `siteWide: true` —
  so the row's `bookshelf_id` is null and the message belongs to the
  installation rather than to any parish. Both conditions this entry named as
  the reason for deferring are met by the same phase: the write path exists
  (Task 1) and `/admin/feedback` reads it (Task 4). The three shipped
  statements that asserted the absence — `routes/web.php`'s "There is NO POST
  here", `ContactController`'s "NO FEEDBACK FORM" docblock and
  `tests/Feature/Shell/ContactPageTest.php`'s "has no write route at all" —
  are retracted in place in the same commit, each carrying its original text.
  `copy.contact.noContact` is retracted with them: its own comment named it
  the substitute for the form, and *"xin liên hệ trực tiếp với giáo xứ của
  bạn"* had become false advice, since the visitor being addressed IS the
  parish. It is replaced by the reference's own lead sentence above the form
  (`old_next/src/app/lien-he/page.tsx:104`).

  **The reference's shape is followed, not widened**, which is the one part of
  the original entry that still governs and is therefore repeated rather than
  struck: `hasContact = Boolean(contact.name || contact.phone)` and the
  ternary at `:83` mean the contact card **or** the form, never both, and
  contact hours alone do not count. An installation with a published name or
  number still shows only the card.

  **What is NOT bought, said plainly:** the route takes no `throttle:`
  middleware. The limit is spec D2's domain rule — three per phone number
  over a rolling 24 hours, inside the command — so a sender churning valid
  Vietnamese numbers is bounded by `Phone::assert()` and by nothing per-IP.
  That is the same footing `shelves.feedback.store` already ships on, and it
  is recorded here rather than left for someone to discover.

  Kept struck rather than deleted, for this file's usual reason: a note that
  vanishes without saying it was answered comes back. Original text below.

  > ~~`docs/BUSINESS-REQUIREMENTS.md:504` asks for the three
  > details *"plus a short form"*, and this phase ships only the details. The
  > reason is that the form has no reader: there is **no feedback write path in
  > this application at all** — no action, no controller, no POST route, and the
  > only registered rate limiter is `register`
  > (`app/Providers/AppServiceProvider.php:132`). `App\Models\Feedback` exists as
  > a model and a table and nothing writes to it. Its two inboxes are both
  > explicitly 3c's placeholders — `/admin/feedback` (`routes/web.php:755`) and
  > the shelf's own feedback page (`:217`), each still
  > `ShellController::underConstruction`. A form whose messages land in a table no
  > screen can read is worse than no form, because it promises a reply that cannot
  > come; `routes/web.php:55-58` says so at the one place a POST would be added.~~
  >
  > ~~**The reference does not "always render" the form either**, and getting that
  > wrong is what the spec's second draft did. `old_next/src/app/lien-he/page.tsx:62`
  > computes `hasContact = Boolean(contact.name || contact.phone)` and `:83` is a
  > **ternary** — the contact card *or* the form, never both — so over there the
  > form is the empty state for an unconfigured installation, not a companion to
  > the card. Note the gate is `name || phone`: contact hours alone do not count.
  > What this port ships instead of the form, when nothing is configured, is a
  > sentence telling the visitor to approach their parish directly.~~

- **Backup controls are not built, and that is a decision rather than an
  oversight (spec D1).** `docs/BUSINESS-REQUIREMENTS.md:598` lists backup among
  the System settings page's contents, and OPS goes further: `GetSystemSettings`
  is specified to return a **last backup time** and `DownloadSystemBackup` to
  retrieve the artifact (`docs/OPERATIONS.md:122-123`). Neither is built here.
  The reference's own settings page renders none of it, and a backup control is
  an operations feature — it needs somewhere for the artifact to live, a
  retention rule and a story about who may download a copy of every parish's
  register — not a settings field. Recorded here because §16.4 names it, so the
  absence would otherwise read as a task somebody forgot.

- **Unit CRUD lives on `manage/units`, not on the admin Bookshelves screen
  (spec D5).** `docs/BUSINESS-REQUIREMENTS.md:600` puts the taxonomy editor
  *and* "the unit lists themselves" under `/admin`'s shelf editor. This port
  splits them: the *shape* stays on the admin editor (Task 4), and the four unit
  writes are `shelves/{shelf}/manage/units` (`routes/web.php:561-565`).

  **We match the requirements on authority and diverge on location.** Authority
  is unchanged — all four writes are super-admin-only
  (`app/Policies/ParishUnitPolicy.php:86-88`, denying as a 404), and a manager
  reading the screen gets the same values as read-only text, gated by a single
  `canEdit` prop (`app/Http/Controllers/Manage/UnitController.php:94`). Location
  moves because `ParishUnit` carries `BelongsToBookshelf`
  (`app/Models/ParishUnit.php:16`) and `BookshelfScope` fails closed, while
  `/admin` binds no tenant by design: the same CRUD on the admin editor would
  force `TenantContext::systemWide()` on every read and every write, which is
  the capability `WideningArchitectureTest` exists to keep rare. The reasoning
  is at `routes/web.php:514-528`, where somebody looking for the units would
  land. The cost is that BR §16.4's sentence is now wrong about where two of
  its clauses live, and a reader following it finds only half of what it names.

- **~~Five of this phase's ten audit rows land where no screen can read
  them.~~ CLOSED 2026-09-01, phase 3c-ii Task 5.** `/admin/audit` is built —
  `App\Http\Controllers\Admin\AuditController` over
  `App\Queries\Admin\AuditBrowserQuery` — and it is exactly the cross-shelf
  browser this entry (and `AuditLogQuery`'s own comments, and the 3b-i entry
  above about the archived-shelf resolver) kept pointing at. All five rows
  named below are visible on it now, together with 3b-i's
  `user.promoted_super_admin`, which had the same problem for the same reason.
  The mechanism is the one this entry says is missing: the unfiltered case
  applies no tenant narrowing at all, so rows recording no parish come back
  beside every parish's, and the screen's shelf filter is what narrows —
  including to *Toàn hệ thống*, the installation's own rows alone, which no
  shelf-scoped read can express. Pinned by
  `tests/Feature/Admin/AdminAuditBrowserTest.php`'s first test, which fails
  the moment that case narrows again. **The original entry, unedited:**

  `system_settings.updated` and `site_contact.updated`
  (`app/Support/Audit/AuditSentences.php:161-162`) and the three `category.*`
  (`:179-181`) all belong to the installation rather than to any parish, so they
  are written through `AuditRecorder`'s cross-shelf arm with a null shelf
  column. `AuditLogQuery` excludes null rows by construction — its one
  hand-written filter is an equality on `bookshelf_id`
  (`app/Queries/AuditLogQuery.php:220`), and its own comment says the global
  rows are the cross-shelf browser's — and that browser is not built:
  `/admin/audit` is still `ShellController::underConstruction`
  (`routes/web.php:754`). The other five (`parish_taxonomy.updated` and the four
  `parish_unit.*`) belong to a shelf and do appear on its log.

  **Defensible, and written down anyway because of the entry above.** An audit
  row is a record, not a promise: it is written for whoever reads the log next,
  and the log gaining a reader in 3c makes today's rows retroactively useful,
  where a contact form gaining an inbox in 3c does nothing for a message
  silently swallowed today. The two cases genuinely differ. But they differ by a
  distinction thin enough that stating it is cheaper than re-deriving it, and
  the alternative — deferring the audit calls until the screen exists — would
  leave the first months of the installation's own history unrecorded.

- **The four `parish_unit.*` actions are grouped `administration` though the
  screen is the manager's** (`app/Support/Audit/AuditSentences.php:219-222`).
  This is the one place in the map where the group's usual reading — "which
  screen is this act from" — and its real question — "who could have done this"
  — part company, and the second wins. Task 5 argued it in the map itself
  (`:196-218`): `manage/units` sits in the manager area only because
  `ParishUnit` is shelf-scoped and that route group binds a tenant, while every
  one of the four acts is super-admin-only. Filing them under `readers` because
  the units describe readers would put four acts a manager cannot perform into
  the group a manager's own work lives in. Carried here because a divergence
  argued only in the file that makes it is invisible to whoever adds the sixth
  group.

- **The archived-shelf resolver filter and export remain deferred, unchanged
  from 3b-i.** `app/Http/Middleware/ResolveTenant.php:35-37` still resolves
  `{shelf}` by slug with no `status` condition, so an archived shelf still
  serves its routes. Export is still unbuilt and still **unscheduled** — 3b-ii
  did not give it a home either — and it is still a precondition on the filter,
  for the reason the 3b-i section argues at length: closing the resolver without
  an export path makes archiving the way to put a parish's own register beyond
  reach of its readers, its managers and the administrator who archived it, with
  the data all still there. Two things this phase adds sharpen it. The five
  global rows above are the beginning of a case for an admin-side audit view,
  which 3b-i already named as a second reason the filter is not self-contained;
  and `manage/units` adds four more writes behind the tenant resolver, so the
  filter's blast radius is larger than when it was deferred.

### Two guard traps this phase measured, both of which produced a green test over a real defect

- **Pest's `toContain` is variadic and takes no message argument, so
  `->not->toContain($needle, $message)` passes unconditionally** — the message
  becomes a second needle, and the negation is satisfied by that sentence being
  absent whatever the first needle does. Task 6 measured it: written that way,
  the guard asserting `/manage/settings` has no write control stayed green with
  a `useForm` and a `<form>` block both present in the screen. The correct shape
  is `expect(str_contains($source, $needle))->toBeFalse($message)`, one needle
  per call (`tests/Feature/Members/ManagerSettingsScreenTest.php:237-248`).

  **This is the second phase to ship it.** `known-gaps.md:260-285` records the
  first, in the positive form, where the effect was the opposite — a check that
  failed on every route rather than passing on all of them — which is why it was
  caught in minutes there and not here. The negated form is the dangerous one.
  It is now written into `AGENTS.md:170-190` rather than left in this file,
  because a trap recorded only in a phase's gap list is found by whoever is
  already reading about that phase.

- **A source-read guard whose needle also appears somewhere unrelated in the
  file is green forever.** Task 5 measured this on the units screen: the first
  version of the flat-list grouping assertion looked for
  `level2ByParent.get(unit.parentId)`, and the loop **three hundred lines above**
  that *builds* that map contains the same call — so the needle was satisfied
  with the branch under test rewritten to the wrong expression, and it stayed
  green under exactly the mutation it was written for
  (`tests/Feature/Members/ManagerUnitsScreenTest.php:370-377`). The fix was to
  name the prop as well as the expression, tying the value to the control that
  posts it. The general rule — pick a needle that exists only where the thing
  under test lives, and prove it by mutation — sits beside the `toContain` entry
  in `AGENTS.md`.

### One requirements-side divergence this phase touched but did not close

- **BR §5.5 still names `allow_comments` where the code uses
  `comments_enabled`** (`docs/BUSINESS-REQUIREMENTS.md:231`). This is a lag in
  the requirements text, not in the code: every implementation of the setting —
  the migration, the model, the admin policy form and now two read paths —
  spells it `comments_enabled`, and `comments_require_approval` is spelled alike
  in both documents. Task 6 amended the two places in this file that promised a
  future `/manage/settings` writer for the key (`known-gaps.md:3592-3612`) and
  `CommentSettings`' own docblock, because spec D4 made that screen read-only,
  so the author those notes were addressed to never came into being. The BR
  wording itself is untouched, deliberately: closing the lag is a one-cell edit
  to §5.5, and it is the product owner's document.

### Changing a shelf's taxonomy shape hides its level-2 units, silently

Found by the 3b-ii whole-branch review, in the seam between Task 4 (the shape,
on the admin shelf editor) and Task 5 (the units, on `manage/units`). Task 4's
brief owned the shape, Task 5's owned the units, and the transition between them
was owned by nobody.

`UpdateParishTaxonomy` never touches a unit row — correct, and its docblock says
so. But `manage/units` is the only screen that manages units, and it renders
level 2 conditionally:

- `resources/js/pages/manage/units.tsx:398` — `showLevel2 = taxonomy.levels === 2`.
  Drop a shelf from two levels to one and every existing level-2 row leaves the
  screen: no rename, no reorder, no delete control.
- `:490` — the nested branch renders only `level2ByParent.get(unit.id)`. Turn
  `nested` on for a shelf whose level-2 units are flat (`parent_id` null) and
  those rows key under `null` and render nowhere either.

**The rows stay live in the database, and no reader sees them** —
`ParishUnits::hasVisibleLevel2()` gates on `levels`/`nested`, so registration
does not offer them. It is fully recoverable by switching the shape back, which
is why it is recorded rather than fixed here: the fix is a decision (warn on the
shape form? refuse the change while units exist? cascade a soft delete?) and
none of those is in this phase's spec.

What is wrong today is only that **nothing says so on either screen**. A
super administrator who narrows a shelf's taxonomy has no way to learn that four
đơn vị just became unreachable.

## Phase 3c-i — the profile-change lifecycle

A reader can see their own record, propose a correction to any verified field
including their photograph, and withdraw the proposal; a manager or a super
administrator decides it from a queue, and the reader is told the outcome.
Branch `feat/phase-3c-oversight-and-feedback`. Four audit actions land —
`profile_change.proposed`, `.approved`, `.rejected`, `.cancelled`, all grouped
`readers` (`app/Support/Audit/AuditSentences.php:74,83-84,89`) — and two
reader-facing notifications BR §15 has always required but the reference never
had. What follows is the product question this phase answered on the product
owner's behalf, the one functional gap it knowingly leaves, and four traps that
cost time and will cost it again.

### The one question that is the product owner's to settle

- **A second proposal MERGES field-wise; the requirements say it "replaces".**
  `docs/BUSINESS-REQUIREMENTS.md:343-344` is plain: "Proposing a new change
  while one is outstanding replaces it, so a manager never faces two competing
  versions of the same fact." What ships is a merge —
  `ProfileProposals::merge()` (`app/Support/Members/ProfileProposals.php:141-156`)
  unions the incoming keys onto the pending bag, both the proposed values and
  the `previous` snapshot. Spec D1 ported the reference's behaviour rather than
  the requirements' sentence, and the reason is in the class header
  (`:20-35`): read strictly, a reader who corrects their phone number and then
  proposes a new photograph silently loses the phone correction, and nothing on
  a screen that shows *one* pending card would tell them.

  **This is a product reading, not a technical one, and it is isolated so it
  can be reversed in one line** — `merge()` returning `$incoming` outright. But
  reversing it is not that one line alone. `avatar_object` is an ordinary
  proposable key of the same jsonb bag, and it survives a later text-only
  proposal *only because* the merge carries it: the graft is
  `WritesProfileProposals::existingContents()`, whose docblock records the
  coupling from the other side (`app/Actions/Admin/Concerns/WritesProfileProposals.php:95-102`).
  Under a literal "replace", a phone-only proposal drops the pending
  photograph's storage key — and because the deletion of a superseded image is
  keyed off that same value (`app/Actions/Admin/ProposeAvatarChange.php:142-146`),
  the image is orphaned in a public-read location forever, with nothing left
  pointing at it. **Whoever flips D1 must restore an `avatar_object` graft in
  the same change.** The behaviour is pinned by
  `tests/Feature/Members/ProposeAvatarChangeTest.php:141`, which asserts the
  graft holds in both directions.

### The functional gap this phase leaves open

- **Both decision queues tell a manager that a photograph was proposed. Neither
  shows it to them.** OPS §4.3 is explicit that the image is stored at proposal
  time precisely "so the manager can look at it while deciding"
  (`docs/OPERATIONS.md:540`, restated at `:613`). Half of that is satisfied: the
  image is stored, and it is fetchable — the reader's own page renders it, since
  `MyProfileQuery` sends a `proposedAvatarUrl`
  (`resources/js/pages/shelves/profile/index.tsx:138,679`). The queues send a
  boolean instead. `ProfileChangeQueueQuery.php:145` and
  `Admin/ManagerProfileChangeQueueQuery.php:173` both emit
  `avatarProposed => array_key_exists('avatar_object', $proposed)`, and both
  screens render that flag as a line of prose
  (`resources/js/pages/manage/profile-changes.tsx:146-147`,
  `resources/js/pages/admin/profile-changes.tsx:122-123`).

  **Recorded plainly rather than softly, because it is arguably a real defect
  and not a deferral**: a manager is being asked to approve a photograph of a
  child on the strength of a sentence saying one exists. Nothing about the data
  is missing — the key is in the pending row and the `avatars` disk has a URL
  generator; only the query and the card were never wired. It fell through a
  seam in the plan: Task 8 sequenced the avatar last and named the earlier tasks
  it reopens as Tasks 1 through 4 (the page, the merge, and the two decision
  Actions), which is where the *storage* work landed. Tasks 5 and 6 built the
  queues and their screens, and were not on that list.

### Two things the deploy story now knows that it did not

- **The shim docroot does not serve `public/storage`, so `storage:link` is not
  the avatar's answer.** HOSTING row 6 confirmed `symlink()` is allowed on the
  host (`docs/HOSTING.md:29`), which reads like the question is closed — it is
  not. Under docroot option 3, the shim, `public/` and `public_html/` stay two
  separate directories (`docs/HOSTING.md:225-240`), and `deploy/post-deploy.sh`
  syncs exactly two things across: `public/build` and `public/.htaccess`
  (`deploy/post-deploy.sh:129-133`). A `public/storage` symlink therefore sits
  in a directory the web server never reaches, and every avatar 404s in
  production while working perfectly everywhere else. Task 8 took row 6's own
  documented fallback instead — a dedicated `avatars` disk reading
  `AVATAR_DISK_ROOT`/`AVATAR_DISK_URL`
  (`config/filesystems.php:76-79`, `.env.example:210-225`), pointed under the
  served docroot when the shim is in use and left on its `storage/app/public`
  defaults under options 1 and 2.

  **Written down because the trap is general, not about avatars.** Any future
  feature that serves a file the application wrote — the archived-shelf export
  below being the obvious one — meets the same wall, and meets it only in
  production, since local and CI both serve `public/` directly.

- **Whether the host's `gd` has WebP *encode* support is still unconfirmed.**
  Row 3 is otherwise answered (`docs/HOSTING.md:26`): `gd` present, `imagick`
  absent, `exif` present. The one capability nobody has measured is WebP
  encoding, so `AvatarImage::encode()` asks `gd_info()['WebP Support']` at
  runtime and encodes JPEG when the answer is no
  (`app/Support/Members/AvatarImage.php:265-270`). **It degrades rather than
  failing** — the failure mode is larger files, not a broken upload — which is
  why this is a note and not a blocker. One probe on the host closes it:
  `php -r 'print_r(gd_info());'`.

### The refusal census reads raw source, so an example in a comment mints a code

Task 8 hit this while writing `AvatarStorage`'s header. That class raises three
refusals as three literal `throw` statements and never as a ternary, because
`tests/Unit/Catalogue/RuleViolatedCodesHaveSentencesTest.php:55` matches a
refusal whose first argument is a **quoted literal** and is blind to one that is
an expression — so a ternary would register neither code with the census that
pins every code to its Vietnamese sentence. The header explains that rule. The
first draft explained it *with an example*, and because the census globs raw
file contents (`:33`, `file_get_contents`) with comments included, the
illustrative `new RuleViolated('literal')` minted a code named `literal` —
which has no `lang/vi/rules.php` entry and no census enumeration, so two tests
went red on a change that touched no behaviour at all. The header now describes
the shape in prose and says why it contains no example
(`app/Support/Members/AvatarStorage.php:40-49`).

**The trap is not the ternary; the trap is the example.** The ternary hazard was
already known — `ReorderParishUnits.php:123` carries the same warning from an
earlier phase, which is the second time this census has shaped how a comment is
written. Anything that looks like a `new RuleViolated('…')` call anywhere under
`app/`, including inside a docblock, a commented-out line, or a string, is a
code as far as the census is concerned. This has now bitten in two phases; the
general form — a source-reading guard cannot distinguish code from prose about
code — belongs with the other guard traps in `AGENTS.md`.

### Two smaller things

- **Post-commit image deletion is not transactional, and the alternative is
  worse.** Approve discards the superseded image, reject and cancel discard the
  proposed one, and in every case the delete happens *after* the transaction
  commits. A crash in that window orphans an image: storage cost, no
  correctness consequence, and recoverable by a sweep nobody has written yet.
  The reverse order deletes an image a rollback then restores a live reference
  to — a pending request pointing at bytes that are gone, which no sweep can
  repair. The reference chose the orphan and so do we. The pin is Task 8's
  forced-rollback test
  (`tests/Feature/Members/ProposeAvatarChangeTest.php:248-289`), which injects a
  failure on the last write inside `RejectProfileChange`'s transaction and
  asserts the request is still pending *and* the image still on disk; a
  successful reject passes under either ordering, so it could not be the test
  that pins this.

- **~~`docs/OPERATIONS.md:587` is stale, and only half corrected.~~ CLOSED
  2026-09-01, commit `88a03aa`.** The blockquote is retracted in place — struck
  through, with the retraction naming `BUSINESS-REQUIREMENTS.md:490` and the §7
  rows Task 6 added — so §4.3 no longer contradicts §7. The entry is kept struck
  rather than deleted for this file's usual reason: a note that vanishes without
  saying it was answered comes back. Original text below.

  > ~~That blockquote — an "Open question — notification gap" under
  > `CancelProfileChange` — asserts that BR §15's reader-facing list "does not
  > mention a profile-change decision at all". It does:
  > `docs/BUSINESS-REQUIREMENTS.md:490` names both ("profile change approved,
  > profile change rejected (carrying the manager's reason)") and BR:492 gives
  > the reason. Task 6 built both, and added them to OPS §7's notification table
  > with a note saying so (`docs/OPERATIONS.md:1147-1150`). **The §4.3 blockquote
  > at :587 was not retracted**, so the document now contradicts itself: a reader
  > who reaches §4.3 first is told the notifications do not exist and that the
  > silence is for the product owner to resolve. It is a one-paragraph edit and
  > it was left undone; this task's brief is `known-gaps.md` only.~~

### Still deferred, unchanged

- **The archived-shelf resolver filter and the export it depends on**, exactly
  as 3b-i and 3b-ii left them. `app/Http/Middleware/ResolveTenant.php:35-37`
  still resolves `{shelf}` by slug with no `status` condition, so an archived
  shelf still serves its routes. The export is still unbuilt and still
  **unscheduled** — 3c-i did not give it a home either — and it remains a
  precondition on the filter, for the reason 3b-i argues at length: closing the
  resolver without an export path makes archiving the way to put a parish's own
  register beyond reach of everyone, including the administrator who archived
  it, with the data all still there. This phase adds a little to the blast
  radius (three more manager routes behind the resolver,
  `routes/web.php:584-586`) and one new consideration to the export itself: it
  would now have to carry files, which is the docroot trap above.

### The whole-branch fix wave, and what it deliberately left alone

A review of `feat/phase-3c-oversight-and-feedback` found six things after the
phase's own tasks were done. Five were fixed on the branch and are recorded
where they now live; two were judged out of scope and are recorded here,
because a defect that is known and unfixed belongs in this file rather than in
a review that scrolls away.

**Fixed, and each pinned.** A lock-order inversion in
`ApproveProfileChange` (it held `users` while its `applyPlacement` UPDATE went
on to take the `memberships` lock, against `UpdateReaderProfile`'s and
`ChangeOwnPassword`'s memberships-then-users — an AB–BA cycle over exactly the
pair spec D3 exists to prevent, and neither of those two has a retry). The
reader's own page rendering an `<img>` for an object the decide path had
deleted. The avatars disk configured `throw => false`, so a failed write minted
a key for bytes that were never stored. Both decision queues sending
`avatarProposed` as a bare boolean, so a manager approved a photograph of a
child on the strength of a sentence. And four tests that guarded nothing — a
`json_encode` without `JSON_UNESCAPED_UNICODE` in the leak half of a leak test,
a `'Tổ '` grep whose trailing space missed the bare literal it names, a
"renders on a PENDING card only" test that never mentioned the guard, and three
lock-order pins that read only `$log[0]`'s table and would have passed a
command locking the wrong row entirely.

**Not fixed, deliberately.**

- **The audit-log screen prints the raw storage key.** A `profile_change.proposed`
  row's `after` bag carries `avatar_object`, and the audit screen renders the
  before/after payload verbatim. That is defensible under BR §14 — the audit
  record is the record of exactly what was written, and rewriting a value on
  the way to a super administrator's oversight screen is the wrong direction of
  fix — but it does mean a bucket path is on a screen. If it is ever changed, it
  should be changed by the audit renderer knowing the field, not by the Action
  writing something other than what it wrote.
- **A soft-deleted subject membership strands a pending request.** Both queues
  drop a card whose subject cannot be resolved (`ProfileChangeQueueQuery`
  continues past a null person; the cross-shelf queue's predicate needs a live
  Manager/Admin membership), so a request whose subject has left sits pending
  with nobody able to see it, let alone decide it. It is a real hole. It needs
  a decision about what SHOULD happen — auto-cancel on departure, a
  soft-deleted-subject queue, or a sweep — and that decision is the product
  owner's, not a fix wave's.

## Phase 3c-ii — oversight and feedback

The last three placeholder routes close. A reader or a passing guest can send a
message to the people who keep the shelf (`routes/web.php:281-282`), a parish
with no shelf at all can reach the administrator from the public contact page
(`:90`), and the administrator can finally open both — `/admin/feedback`
(`:940-942`), an inbox spanning every parish plus the installation's own
messages, and `/admin/audit` (`:910`), the cross-shelf log browser six audit
actions have been writing into with no reader. `/admin/managers` gains a link
per row carrying the actor, which is the whole of BR:608. Branch
`feat/phase-3c-ii-oversight-and-feedback`. Three audit actions land —
`feedback.submitted`, `feedback.read`, `feedback.resolved`, all grouped
`community` — taking the census from 63 to 66.

**This was the last phase of Phase 3.** Anything below has no later phase inside
Phase 3 to absorb it; Phase 4 deletes the Next.js tree and rewrites the
architecture documents. What follows is one guard this phase discovered it
cannot test, a product ruling that stranded a relation, two deliberate
divergences from the reference, the deferrals that outlived Phase 3, and the
dead code the last placeholder left behind.

### The collation guard is not falsifiable in this environment, and nothing in the suite would notice its removal

**Recorded first and at length because it is the one thing here that could be
deleted by somebody acting reasonably.** The audit browsers resolve a subject's
name partly out of the JSON payload, through two `leftJoin`s that each compare a
`JSON_UNQUOTE(JSON_EXTRACT(…))` result — utf8mb4 — against `users.id`, which is
`ascii_bin`. Both wrap the left side in `CONVERT(… USING ascii) COLLATE
ascii_bin` (`app/Queries/Concerns/ReadsAuditLog.php:129,158`) against errno 1267,
"Illegal mix of collations", which is this repo's *six-times-paid live 500*.

Task 5 tried to falsify that guard when it moved the joins into the shared trait
and could not: replacing the expression with a bare `JSON_UNQUOTE(JSON_EXTRACT(…))`
left **all six** tests in `tests/Feature/Admin/AdminAuditBrowserTest.php` green,
including the one written specifically to exercise the payload join. The
measurement is in that file's own docblock (`:37-48`). The MariaDB this suite
runs on **resolves** that pairing rather than refusing it, so whatever produced
those six production incidents is not reproducible here.

**The guard is KEPT** — six live incidents outweigh one environment that will
not reproduce them — **but it is protecting a six-times-paid production defect
with no test behind it.** It is not that the pin is weak; there is no pin. A
future reader who deletes the `CONVERT`/`COLLATE` on the strength of a green run
will get a green run.

**This is the second independent measurement of the same fact, which is why it
is stated this strongly rather than hedged.** The manager-side
`tests/Feature/Oversight/AuditLogQueryTest.php:224-246` already feeds the join a
hostile payload — Vietnamese text and an emoji where a uuid belongs — and its
comment records the same result on MariaDB 10.11.19: *"the raw JSON comparison
does not raise 1267 either … this test is green with the guard removed."* That
test pins the **outcome** (no subject resolved, the bare sentence, a page that
renders), which is worth having and is not the same thing. Two files now say, in
different phases, that the guard itself is unpinned.

**What would actually pin it** is a fixture whose collation differs from this
container's — a second connection, or a column deliberately built utf8mb4 — and
that is a test-infrastructure decision nobody has taken. The related guards that
*are* pinned are the bind-side ones (`App\Support\SafeId`, and the uuid-shape
checks the Form Requests carry), which catch the 1267 class before a parameter
reaches an `ascii_bin` column at all.

### A relation kept for a caller that does not exist

- **`Bookshelf::feedback()` (`app/Models/Bookshelf.php:167`) now has no call
  site anywhere, and is kept rather than deleted.** `grep -rn "feedback()" app
  resources tests database` returns four hits and every one is inside a
  docblock. The relation was built in Phase 2 as the mechanism a shelf-scoped
  feedback read would go through — instead of a hand-written
  `where('bookshelf_id', …)` needing a `TenancyArchitectureTest` allow-list
  entry — and the read that would have used it was never built.

  **Because the product owner ruled `/admin/feedback` super-admin-only on
  2026-09-01**, matching the reference, which gates every feedback read and both
  handling writes on `requireSuperAdmin`. BR §13.2 (`docs/BUSINESS-REQUIREMENTS.md:454`)
  files "view feedback, resolve feedback" under the general *Community*
  permission category without restricting it to `super_admin`, so it **can** be
  read as granting a shelf's own manager a shelf-level inbox — OPS §4.4 has
  carried that exact open question since the reference was written. The ruling
  settles it, and `FeedbackInboxQuery`'s docblock (`app/Queries/Admin/FeedbackInboxQuery.php:42-49`)
  and `routes/web.php:915-921` both record it at the point somebody would look.

  **Kept because the archived-shelf export will want it.** That export has to
  gather one parish's own rows, feedback included, from a context that is not
  the parish's — which is precisely a shelf-scoped read of a table with a
  nullable tenant column, the case this relation exists for. Deleting it now
  means re-deriving both the relation and the reason it is not a hand-written
  filter. The `known-gaps.md:570-596` coverage-debt entry is amended rather than
  closed: the test it asks for still does not exist, and now cannot arrive
  alongside a first real caller, because there is no longer a caller due.

### `feedback.archived` is not ported, and the OPS entry says so itself

- **The inbox ships with two writes and no third.** `docs/OPERATIONS.md:721`
  lists `ArchiveFeedback` **provisionally** — its own blockquote asks whether the
  domain needs a fourth status or whether "archive" is a filter over `resolved`,
  and notes the reference's built screen has a "Lưu trữ" button with no status
  behind it. BR:610 asks only that messages be *"markable read and resolved"*,
  and the reference's inbox records the product owner removing that button on
  2026-08-09 for the same reason the open question raises.

  **Task 4 annotated the OPS entry rather than leaving it to imply a gap**
  (`docs/OPERATIONS.md:723`): the entry stays for the record, and says in its own
  words that it is not ported and why. The phase's audit count is 66 **because**
  `feedback.archived` stays out — it is registered in `AuditSentences::ACTIONS`
  nowhere, and the census would redden if it were. Reopening it needs a
  migration either way (a fourth status value, or a `deleted_at`), which is the
  decision nothing has made.

### Two deliberate divergences from the reference, both in the rate limit

The limit is spec D2's domain rule and not route middleware: three messages per
phone number over a **rolling** 24 hours, counted off the injected clock inside
`App\Actions\Community\SubmitFeedback`, refused with a Vietnamese sentence in
the error bag rather than a bare 429. Two things about it are stricter than the
reference on purpose, and are recorded because a test written against either
would fail against `old_next`.

- **The key hashes a NORMALISED phone, not a whitespace-stripped one**
  (`SubmitFeedback::phoneHash`, `:193-196`). The reference hashes
  `phone.replace(/\s+/g, "")`, so `0912345678`, `0912 345 678`, `0912.345.678`,
  `0912-345-678` and `+84912345678` — five spellings of one subscriber number,
  every one accepted by `Phone::isValid()` — land in four separate buckets over
  there. That is a 12/day budget wearing a 3/day label. `Phone::normalise()`
  folds dots, hyphens and a leading `+84` to a leading `0`, so all five are one
  bucket here. **This port has already paid for this defect once**, in the
  registration limiter — its day key hashed the raw trimmed phone and gave the
  same five spellings five separate 20/day buckets, closed by that fix round's
  Task 13 (`app/Providers/AppServiceProvider.php:125-135`). Doing it the
  reference's way a second time would have been porting a known bug knowingly.

- **The 24-hour count is genuinely global here, where the reference's is
  shelf-blind by accident.** `SubmitFeedback:126-129` counts every row with that
  hash, full stop — `Feedback` deliberately does not carry `BelongsToBookshelf`,
  so no global scope narrows it. The reference's identical-looking query runs on
  an RLS-guarded connection whose `feedback_tenant` policy admits only *this
  session's shelf's rows plus every site-wide row*, and its own docblock
  (`old_next/src/domain/community/commands/feedback.ts:44-77`) records the
  consequence as a known gap left open by its Task 17: a number that has spent
  its three at shelf A is invisible from shelf B, and invisible again from
  `/lien-he`, so the same number sends three more. OPS §8 states the limit with
  no "per shelf" qualifier, so **this port matches the requirement and diverges
  from the reference's behaviour** — a gap the reference documents at length is
  silently closed here, which is the reason to write it down rather than let it
  read as an oversight.

### No per-IP ceiling on either feedback route

- **Neither `contact.feedback` nor `shelves.feedback.store` takes `throttle:`
  middleware, and that is stated rather than left to be noticed**
  (`routes/web.php:79-84`). The only route limiter in the whole application is
  still `throttle:register` on `register.store` (`:54`). What the domain rule
  buys is a per-*number* ceiling; what nothing buys is a per-*IP* one, so a
  sender churning valid Vietnamese numbers is bounded by `Phone::assert()` and
  by nothing else. Both routes are guest-reachable by design — a guest may leave
  feedback for a shelf they are not a member of, and a parish with no shelf has
  no other way to reach the administrator.

  Recorded because the two halves are easy to conflate: the message that reaches
  the inbox is rate-limited, the *requests* that reach the route are not. If a
  parish ever meets this, BR §8's own rate-limit section is where the numbers
  would come from, and `register.store` is the shape to copy.

### The index Task 1 added, and why

- **`feedback` gained a non-unique `(guest_hash, created_at)` index named
  `feedback_rate_limit`**
  (`database/migrations/2026_09_01_000001_add_feedback_rate_limit_index.php`).
  The plan asked for a decision either way; this is it, recorded here so the
  reasoning is not only in the migration.

  The count runs on **every** submission, before anything is written, and the
  table shipped in `2026_08_26_000012_create_feedback_table.php` with no index on
  `guest_hash` at all — so the limit's own query was a full scan of every
  message ever sent to the installation. It grows with the deployment rather
  than with the parish, and **this is the one table whose row volume an
  unauthenticated outsider chooses**, which is what tipped it from a
  nice-to-have to a decision worth making now.

  Composite rather than `guest_hash` alone because both predicates sit in the
  same `WHERE`: the equality leads, the range on `created_at` rides the same
  index instead of filtering rows after they are read, and the count touches no
  other column — so it is a covering index for that access path. Not unique, for
  the obvious reason that three rows a day per number is the rule being counted.

### Still deferred, and now out of Phase 3

- **The archived-shelf resolver filter and the export it depends on are now
  Phase 4's or later's.** Unchanged in substance from 3b-i, 3b-ii and 3c-i:
  `app/Http/Middleware/ResolveTenant.php:35-37` still resolves `{shelf}` by slug
  with no `status` condition, so an archived shelf still serves its routes; the
  export is still unbuilt, still unscheduled, and still a precondition on the
  filter, because closing the resolver without an export path makes archiving
  the way to put a parish's own register beyond reach of everyone including the
  administrator who archived it, with the data all still there.

  **What is new is only that the runway has run out.** This was the last phase
  of Phase 3 that could have scoped them, and it did not — its own spec is about
  feedback and audit — so they now belong to Phase 4 or to whatever follows it,
  and they will be picked up by somebody with no memory of the three phases that
  each added a little to the blast radius. This phase adds a little more of its
  own: the export would now have to carry a parish's feedback as well as its
  register, and 3c-i's docroot trap (a file the application wrote is not served
  under the shim) still stands in front of any export artifact.

### The last placeholder closed, and the dead code it left

- **`ShellController::underConstruction` (`app/Http/Controllers/ShellController.php:91`)
  and `resources/js/pages/under-construction.tsx` are now unreachable, and both
  are KEPT — the decision found and recorded, not deferred.** Every placeholder
  route is gone: `grep -n underConstruction routes/web.php` returns two hits
  (`:652`, `:708`) and both are prose explaining what a route *used* to be. No
  route resolves to the method, and nothing renders the page.

  **Kept for one reason and it is not sentiment**: Phase 4 rewrites the
  architecture documents and the §6 route map, and a route added there ahead of
  its screen has exactly one house-standard answer, which is this pair. Deleting
  them costs a controller method and a fifteen-line component; re-deriving them
  costs the convention — the route NAMES are final while the pages are not,
  which is the asymmetry the method's own docblock exists to state.

  **What is honest about the cost:** they are dead code today, no test covers
  either, and `copy.common.underConstruction` (`resources/js/lib/copy.ts:19`) is
  now an unreferenced string in a file that is otherwise fully used. If Phase 4
  reaches its cutover with no placeholder route added, delete all three
  together — this entry is the note saying they were left deliberately and what
  would make removing them right.

### A never-active manager's activity link is hidden, and that is not decoration

- **`/admin/audit` treats an unrecognised `?actor=` as NO FILTER, never as a
  filter matching nothing** (`app/Http/Controllers/Admin/AuditController.php:63-74`:
  the parameter must be uuid-shaped *and* appear in the list of people the log
  actually records, or it is dropped). That reading is deliberate and is not
  changed here — it is this file's own repeated lesson that *"an empty list that
  reads as 'no messages' is the shape of a bug this project has already shipped
  twice"*, and every one of the browser's five parameters is guarded the same
  way.

  **It does mean a per-manager activity link for somebody with no audit rows
  would open the entire system's log under the words "this person's activity"**
  — the one wrong answer available, and worse than no link, because the reader
  has no way to tell a busy manager from a broken filter.

  So Task 6 gates the link on `lastActiveAt`
  (`resources/js/pages/admin/managers/index.tsx:346-370`), which
  `ManagersListQuery::lastActiveByActor` (`:177`) reads from the same table by
  the same rule — making it exactly the predicate "the log names this actor".
  The link is present when the filter will resolve and absent when it will not,
  and the row already says *"Chưa làm việc gì trên hệ thống"* a line above, so
  nothing is silently missing.

  **Recorded because the asymmetry looks like an omission from either side.** A
  reader of the managers screen sees a control that is sometimes there; a reader
  of the audit controller sees a lenient parameter. Neither half explains the
  other on its own, and the fix somebody would reach for — making an
  unrecognised actor mean "no rows" — trades this narrow hole for the general
  one the browser is built to avoid.
