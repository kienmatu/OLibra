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
