# Phase 3a — Network Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the application a sanctioned, fenced way to read across bookshelves, and use it for the administration dashboard — plus a searchable public portal and an `AGENTS.md` that describes this repository.

**Architecture:** Every read in this codebase is bounded by `BookshelfScope`. Phase 3a adds the first request-path widening. It is contained twice: by a `TenantContext::systemWide(callable)` wrapper that restores the prior tenant in a `finally`, and by two architecture pins — one funnelling raw `actSystemWide()` through that wrapper, one confining the wrapper to `app/Queries/Admin/`.

**Tech Stack:** PHP 8.4, Laravel 13, MariaDB 10.11.19, Inertia v3, React, TypeScript, Pest, Larastan level 8, Pint, Biome. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-31-laravel-phase-3a-network-foundation-design.md`

## Global Constraints

Every task's requirements implicitly include this section.

- **Never write to `old_next/`.** It is a read-only behavioural reference. `git diff origin/main...HEAD -- old_next/` must stay empty; the wrap-up task asserts it.
- **Do not run `vendor/bin/pint` on the host** — the host PHP is broken. Run it in the container: `docker compose -f docker-compose.laravel.yml exec -T app ./vendor/bin/pint`.
- **Gates:** `make lint` (Pint + Biome + `bun run laravel:typecheck`), `make analyse` (Larastan level 8), `make test` (`make test FILTER=<File>` for one file). `make lint` carries **3 Biome warnings and 1 info** — the inherited baseline, not a regression.
- **Baseline at branch point:** suite **1,646 passing / 9,585 assertions** (measured at `eb1a58b`; an earlier draft of this plan said 1,645/9,581, which was Phase 2c's number carried across without being re-run — the exact habit the last line of this section forbids). Re-take it at the start of your task rather than trusting this line.
- **Tenancy is `BookshelfScope`'s.** No hand-written `where('bookshelf_id', …)` outside `TenancyArchitectureTest`'s existing allow-list. A foreign row is **not found** (404), never **refused** (403) — spec §5.4.
- **`actSystemWide()` is called only from `TenantContext::systemWide()`, `SweepReminders.php` and `DemoShelfSeeder.php`.** `systemWide()` is called only from `app/Queries/Admin/`. Task 2 builds both pins.
- **Every write transaction retries** (`ConcurrencyRetry::ATTEMPTS`) and records an audit entry. 3a adds no writes, so this constrains nothing here — but do not add one without them.
- **Vietnamese copy** lives in `resources/js/lib/copy.ts` (screens) and `lang/vi/*.php` (server). A namespace never reaches into another namespace's keys; add a second key instead.
- **Docblocks must be true.** Open what you cite; re-take measurements rather than copying them. This project has corrected many false claims, and several were introduced by fix rounds sent to remove an earlier one. **The spec this plan implements was itself rejected twice for exactly that** — three separate guards were specified against allow-lists nobody had grepped.

---

## File Structure

| File | Responsibility |
|---|---|
| `AGENTS.md` (modify) | Describes the components this repo actually has. |
| `tests/Feature/Architecture/StyleGuideTest.php` (create) | Pins that every component `AGENTS.md` names exists. |
| `app/Support/TenantContext.php` (modify) | Gains `systemWide(callable)` — widening scoped to a callback, restored in a `finally`. |
| `tests/Feature/Architecture/WideningArchitectureTest.php` (create) | The two pins: raw widening funnels through the wrapper; the wrapper is confined to `app/Queries/Admin/`. |
| `tests/Feature/Admin/TenantWideningTest.php` (create) | The lifetime behaviour: restores on return, on throw, and under nesting. |
| `app/Queries/Admin/AdminOverviewQuery.php` (create) | The cross-shelf dashboard read. The only member of its namespace in 3a. |
| `app/Http/Controllers/Admin/DashboardController.php` (create) | One GET. |
| `resources/js/pages/admin/dashboard.tsx` (create) | The dashboard screen. |
| `resources/js/layouts/admin-layout.tsx` (modify) | Gains the dashboard nav entry. |
| `database/migrations/2026_08_31_000001_add_bookshelves_folded_columns.php` (create) | Generated folded columns over `name`, `location`, `address`. |
| `app/Http/Controllers/ShellController.php` (modify) | `shelves()` gains the folded search and sends `address`. |
| `resources/js/pages/shelves/index.tsx` (modify) | The search box; renders address beside location. |
| `resources/js/lib/copy.ts` (modify) | `copy.admin.dashboard*` and the portal's search strings. |
| `routes/web.php` (modify) | One new route: `admin.dashboard`. |

---

## Task 1: `AGENTS.md` describes this repository

**Files:**
- Modify: `AGENTS.md`
- Test: `tests/Feature/Architecture/StyleGuideTest.php` (create)

**Interfaces:**
- Produces: nothing other tasks consume. This task exists first because Phase 3 has thirteen screens across its three slices and the guide currently misdirects every one of them.

**Why this is not cosmetic.** `AGENTS.md` prescribes **fourteen components this repository does not have** — `Pill`, `StatusBadge`, `StatusPanel`, `StepIndicator`, `ReadOnlyValue`, `BookTitle`, `Field`, `Textarea`, `BookCover`, `PhoneLink`, `ButtonLink`, `BigActionLink`, `QrScanner`, `CopyScanField` — its component table routes **twice** through a `field.tsx` that does not exist (the `Toggle` and `Checkbox` rows), and its numbered non-negotiable rules **1, 2 and 6** each cite one. It misdirected three tasks in Phase 2b, each needing its brief to override the house style guide, and cost a warning paragraph in every screen dispatch in 2c.

**Keep each rule's intent; change only its mechanism.** Rule 2's "status is never colour alone — an icon, a Vietnamese word and a colour together" is a good rule whether or not a `StatusBadge` exists to enforce it. Rewrite it to require the property and name `ui/badge.tsx` as the thing to build it from. Do the same for rules 1 and 6. **Do not delete a rule because its component is missing.**

- [ ] **Step 1: Establish the ground truth**

```bash
ls resources/js/components resources/js/components/ui
```

Write down what is actually there. At the time of writing: `components/` holds `appearance-tabs.tsx`, `book-card.tsx`, `book-fields.tsx`, `heading-small.tsx`, `heading.tsx`, `input-error.tsx`, `parish-unit-fields.tsx`, `registration-person-fields.tsx`, `text-link.tsx`; `components/ui/` holds `alert.tsx`, `avatar.tsx`, `badge.tsx`, `breadcrumb.tsx`, `button.tsx`, `card.tsx`, `checkbox.tsx`, `collapsible.tsx`, `dialog.tsx`, `dropdown-menu.tsx`, `icon.tsx`, `input.tsx`, `label.tsx`, `navigation-menu.tsx`, `placeholder-pattern.tsx`, `select.tsx`, `separator.tsx`, `sheet.tsx`, `sidebar.tsx`, `skeleton.tsx`, `toggle-group.tsx`, `toggle.tsx`, `tooltip.tsx`. **Re-run the command rather than trusting that list** — it is a measurement with a shelf life.

- [ ] **Step 2: Write the failing test**

Create `tests/Feature/Architecture/StyleGuideTest.php`:

```php
<?php

use Illuminate\Support\Facades\File;

/**
 * AGENTS.md is the house style guide, and until Phase 3a it named fourteen
 * components this repository has never had — plus a `field.tsx` its table
 * routed through twice. It misdirected three tasks in Phase 2b and cost a
 * warning paragraph in every screen dispatch in 2c.
 *
 * This block is what stops it drifting back. It is deliberately narrow: it
 * proves every component the guide NAMES exists, not that every component
 * that exists is named. A guide may be incomplete; it may not be wrong.
 */
it('every component AGENTS.md names exists in resources/js/components', function () {
    $guide = File::get(base_path('AGENTS.md'));

    // Backticked PascalCase identifiers are how the guide names a component.
    preg_match_all('/`([A-Z][A-Za-z]+)`/', $guide, $matches);
    $named = array_values(array_unique($matches[1]));

    // Words the guide backticks that are NOT components. Keep this list
    // short and justified — every entry is a hole in the pin.
    $notComponents = ['README', 'AGENTS', 'MariaDB', 'TypeScript', 'Vietnamese', 'Laravel', 'Inertia', 'Pest', 'Larastan', 'Pint', 'Biome'];

    $components = collect(File::allFiles(resource_path('js/components')))
        ->map(fn ($f) => $f->getFilenameWithoutExtension())
        // book-card.tsx exports BookCard; the guide names components in
        // PascalCase and the files are kebab-case.
        ->map(fn (string $n) => str_replace(' ', '', ucwords(str_replace('-', ' ', $n))))
        ->all();

    $missing = collect($named)
        ->reject(fn (string $n) => in_array($n, $notComponents, true))
        ->reject(fn (string $n) => in_array($n, $components, true))
        ->values()
        ->all();

    expect($missing)->toBe([]);
});
```

- [ ] **Step 3: Run it and watch it fail loudly**

Run: `make test FILTER=StyleGuideTest`
Expected: FAIL, listing the fourteen absent components.

**Record the exact list the test prints in your report.** It is the ground truth for Step 4, and it may differ from the fourteen this plan names — the plan's list is a measurement from 2026-08-31, and the test is the live one.

- [ ] **Step 4: Correct `AGENTS.md`**

Rewrite the component table to route to what exists (`ui/badge.tsx`, `ui/button.tsx`, `ui/checkbox.tsx`, `ui/input.tsx`, `ui/label.tsx`, `ui/select.tsx`, `ui/toggle.tsx`, `components/input-error.tsx`, `components/book-card.tsx`), and rewrite numbered rules 1, 2 and 6 so each states its requirement and names a real building block.

**Where a row has no real equivalent, say so plainly** rather than inventing one — "no component yet; compose from `ui/badge.tsx` and state the requirement" is honest and useful. **Add a sentence at the head of the table** recording that it describes what exists, and that adding a component means updating this table — the test enforces it.

**Watch out for your own pin while writing.** `StyleGuideTest` treats *every* backticked PascalCase word as a component claim. So writing `` `AdminLayout` `` or `` `AppShell` `` into the guide reddens the build. Any new backticked PascalCase word must either name a real file under `resources/js/components/` or go on `$notComponents` **with a justification beside it** — every entry there is a hole in the pin, so keep the list short and argued.

- [ ] **Step 5: Run it green, then the suite**

Run: `make test FILTER=StyleGuideTest` → PASS
Run: `make test` → baseline + 1

- [ ] **Step 6: Prove the pin is not vacuous**

```
add `NonExistentThing` in backticks to AGENTS.md
make test FILTER=StyleGuideTest   → RED, naming it
remove it; git status --porcelain → empty
```

Paste both runs into your report. A pin nobody has watched fail guards nothing — Phase 2c shipped one whose first draft was vacuous.

- [ ] **Step 7: Gates, then commit**

```bash
make analyse && make lint
git add AGENTS.md tests/Feature/Architecture/StyleGuideTest.php
git commit -m "docs: AGENTS.md describes the components this repo has, and a pin keeps it that way"
```

---
## Task 2: the widening capability, and the two pins that fence it

**Files:**
- Modify: `app/Support/TenantContext.php`
- Test: `tests/Feature/Admin/TenantWideningTest.php` (create) — the behaviour. (It exercises `app/Support/TenantContext.php` rather than anything under `Admin`, but it is the admin widening's contract and its only consumer is `app/Queries/Admin/`; if `tests/Feature/Support/` is the better home in your judgement, move it and say so.)
- Test: `tests/Feature/Architecture/WideningArchitectureTest.php` (create) — the pins

**Interfaces:**
- Produces: `TenantContext::systemWide(callable $fn): mixed` — runs `$fn` with tenancy removed and **restores the prior tenant state in a `finally`**, on the exception path too. Task 3 is its only caller.

**This is the task the whole phase exists for. Read the spec's D1 before starting.**

`TenantContext` is bound `scoped` (`app/Providers/AppServiceProvider.php:48`) — one instance per request. `actSystemWide()` sets a flag and nulls the tenant; **nothing resets it.** `clear()` exists at `TenantContext.php:71` with **zero callers** anywhere in `app/`. So a widening today is permanent for the rest of the request.

That is not a loud failure. `BookshelfScope::apply` **returns early** on `isSystemWide()` (line 35) and adds no predicate at all — so the failure mode is the **silent over-read**, the exact inversion `BookshelfScope`'s fail-closed design exists to prevent. It does not bite in 3a (the `/admin` group carries no `tenant` middleware) but it bites in 3b and 3c, where Inertia's closure props resolve *after* the controller and would count every parish into one shelf's badge.

- [ ] **Step 1: Write the failing behaviour test**

Create `tests/Feature/Admin/TenantWideningTest.php`:

```php
<?php

use App\Models\Book;
use App\Models\Bookshelf;
use App\Support\TenantContext;

/**
 * One book on each of two shelves, with shelf A bound.
 *
 * Grep first: `grep -rn "^function wideFix" tests/` — top-level helpers are
 * process-global (AGENTS.md).
 *
 * @return array{Bookshelf, Bookshelf}
 */
function wideFix(): array
{
    app(TenantContext::class)->actSystemWide();
    $a = Bookshelf::factory()->create(['slug' => 'shelf-a-wide', 'settings' => []]);
    $b = Bookshelf::factory()->create(['slug' => 'shelf-b-wide', 'settings' => []]);
    Book::factory()->for($a)->create();
    Book::factory()->for($b)->create();

    app(TenantContext::class)->set($a, null);

    return [$a, $b];
}

it('reads every shelf inside the callback and only one outside it', function () {
    wideFix();
    $context = app(TenantContext::class);

    expect(Book::query()->count())->toBe(1);

    $inside = $context->systemWide(fn (): int => Book::query()->count());

    expect($inside)->toBe(2);
});

it('RESTORES the bound tenant after the callback returns', function () {
    // The block this task exists for. Without the finally, every later read
    // in the request spans the network — silently, because BookshelfScope
    // adds no predicate under a widening rather than throwing.
    [$a] = wideFix();
    $context = app(TenantContext::class);

    $context->systemWide(fn (): int => Book::query()->count());

    expect($context->isSystemWide())->toBeFalse();
    expect($context->bookshelfId())->toBe($a->id);
    expect(Book::query()->count())->toBe(1);
});

it('restores even when the callback throws', function () {
    // An untested finally is a comment. A query that throws mid-read must
    // not leave the rest of the request unscoped.
    [$a] = wideFix();
    $context = app(TenantContext::class);

    expect(fn () => $context->systemWide(function (): never {
        throw new RuntimeException('boom');
    }))->toThrow(RuntimeException::class, 'boom');

    expect($context->isSystemWide())->toBeFalse();
    expect($context->bookshelfId())->toBe($a->id);
    expect(Book::query()->count())->toBe(1);
});

it('restores correctly when nested', function () {
    [$a] = wideFix();
    $context = app(TenantContext::class);

    $context->systemWide(function () use ($context): void {
        $context->systemWide(fn (): int => Book::query()->count());
        // The INNER call must restore to system-wide, not to the outer
        // caller's bound shelf — it restores what it found, not a default.
        expect($context->isSystemWide())->toBeTrue();
    });

    expect($context->isSystemWide())->toBeFalse();
    expect($context->bookshelfId())->toBe($a->id);
});

it('restores an unset tenant as unset, not as a bound one', function () {
    // The third state. BookshelfScope THROWS on unset, so restoring wrongly
    // here would turn a loud failure into a silent one.
    app(TenantContext::class)->clear();
    $context = app(TenantContext::class);

    $context->systemWide(fn (): int => Bookshelf::query()->count());

    expect($context->isSystemWide())->toBeFalse();
    expect($context->bookshelfId())->toBeNull();
    // Name a fragment: BookshelfScope throws a distinctive message, and a
    // bare class assertion would pass on any RuntimeException at all —
    // including one from a broken fixture.
    expect(fn () => Book::query()->count())
        ->toThrow(RuntimeException::class, 'actSystemWide');
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `make test FILTER=TenantWideningTest`
Expected: FAIL — `Call to undefined method App\Support\TenantContext::systemWide()`.

- [ ] **Step 3: Add the wrapper**

In `app/Support/TenantContext.php`, after `actSystemWide()`:

```php
    /**
     * Run $fn with tenancy removed, then put the tenant back.
     *
     * THE RESTORE IS THE POINT. actSystemWide() alone has no reset — clear()
     * exists on this class and has zero callers in app/ — and this object is
     * bound `scoped` (AppServiceProvider), one instance per request. So a
     * bare widening leaks for the rest of the request, and it leaks SILENTLY:
     * BookshelfScope::apply returns early on isSystemWide() and adds no
     * predicate, rather than throwing the way it does on an unset tenant.
     *
     * The finally covers the exception path too. A cross-shelf query that
     * throws mid-read must not leave the rest of the request unscoped.
     *
     * It restores what it FOUND, not a default — nesting restores to
     * system-wide, and an unset tenant restores to unset, so a caller that
     * was going to fail loudly still does.
     *
     * @template T
     *
     * @param  callable(): T  $fn
     * @return T
     */
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

- [ ] **Step 4: Run it green**

Run: `make test FILTER=TenantWideningTest` → PASS, 5 blocks.

- [ ] **Step 5: Write the two pins**

Create `tests/Feature/Architecture/WideningArchitectureTest.php`. Copy the shape of `tests/Feature/Architecture/TenancyArchitectureTest.php` — a pattern list, `$roots`, an allow-list of path suffixes matched with `str_ends_with`, and `expect($offenders)->toBe([])`.

```php
<?php

use Illuminate\Support\Facades\File;

/**
 * Two pins, because the capability has two doors.
 *
 * WHY BOTH. An earlier draft of the spec pinned actSystemWide() alone. After
 * TenantContext::systemWide() exists, no admin query calls actSystemWide() —
 * so that pin would have guarded a method the new code never uses, while
 * systemWide() stayed callable from anywhere with nothing pinning it. The
 * fence has to name the capability, not one method.
 *
 * ROOTS ARE STATED, NOT COPIED. TenancyArchitectureTest scans
 * [app_path(), database_path(), base_path('routes')] — and database_path()
 * is why DemoShelfSeeder is allow-listed below. A pin that copied those
 * roots without it reddens on day one, which is precisely how this phase's
 * spec was wrong three times before review caught it.
 */
it('raw widening is funnelled through TenantContext::systemWide()', function () {
    // The `->` anchor matters: a bare /systemWide\(/ would also match inside
    // actSystemWide(, and /actSystemWide\(/ unanchored matches this file's
    // own prose. Anchoring on the call site is what makes the pattern mean
    // "someone called it".
    $pattern = '/->\s*actSystemWide\s*\(/';

    $allowed = [
        // The wrapper itself — the one sanctioned raw caller.
        'app/Support/TenantContext.php',
        // Phase 2a's nightly cross-shelf sweep, already allow-listed by
        // TenancyArchitectureTest for the same reason.
        'app/Console/Commands/SweepReminders.php',
        // A seeder, widening by design. database_path() is in $roots.
        'database/seeders/DemoShelfSeeder.php',
    ];

    expect(offendersFor($pattern, $allowed))->toBe([]);
});

it('the widening wrapper is confined to app/Queries/Admin', function () {
    $pattern = '/->\s*systemWide\s*\(/';

    $allowed = [
        // Every cross-shelf read lives here. 3a ships one; 3b and 3c add more.
        // A new entry outside this directory is a spec amendment, not a fix.
    ];

    $offenders = collect(offendersFor($pattern, $allowed))
        ->reject(fn (string $path) => str_starts_with($path, 'app/Queries/Admin/'))
        ->values()
        ->all();

    expect($offenders)->toBe([]);
});
```

Write `offendersFor(string $pattern, array $allowed): array` as a top-level helper in this file (grep first: `grep -rn "^function offendersFor" tests/`). It walks `[app_path(), database_path(), base_path('routes')]`, skips non-`.php`, skips allow-listed suffixes via `str_ends_with`, and returns repo-relative paths — exactly `TenancyArchitectureTest`'s loop.

- [ ] **Step 6: Run the pins, and FALSIFY BOTH**

Run: `make test FILTER=WideningArchitectureTest` → PASS.

Then prove each one guards something. **Both, separately:**

```
# Pin 1
add `app(TenantContext::class)->actSystemWide();` to any app/ file outside the allow-list
make test FILTER=WideningArchitectureTest   → RED, naming that file
revert; git status --porcelain              → empty

# Pin 2
add `app(TenantContext::class)->systemWide(fn () => 1);` to any app/ file outside app/Queries/Admin/
make test FILTER=WideningArchitectureTest   → RED, naming that file
revert; git status --porcelain              → empty
```

**Then falsify the lifetime test too** — replace `systemWide()`'s body with a bare `$this->actSystemWide(); return $fn();`, confirm the restore blocks redden, and restore. Paste all three runs into your report.

- [ ] **Step 7: Full suite, gates, commit**

`make test` — expect **baseline + 7** (`TenantWideningTest` has 5 blocks, `WideningArchitectureTest` has 2). Then `make analyse` and `make lint`.

```bash
git add app/Support/TenantContext.php tests/Feature/Admin/TenantWideningTest.php tests/Feature/Architecture/WideningArchitectureTest.php
git commit -m "feat: widening that restores what it found, and two pins that fence it"
```

---
## Task 3: `AdminOverviewQuery` — the cross-shelf read

**Files:**
- Create: `app/Queries/Admin/AdminOverviewQuery.php`
- Test: `tests/Feature/Admin/AdminOverviewQueryTest.php` (create)

**Interfaces:**
- Consumes: `TenantContext::systemWide(callable)` (Task 2). **This is its only caller in 3a.**
- Produces: `AdminOverviewQuery::run(): array` shaped
  `list<array{shelfId: string, slug: string, name: string, status: string, books: int, readers: int, loans: int, overdue: int, pending: int, contactsMissing: bool}>`, ordered by `name`.

### The chain ordering is a hard constraint, and it is invisible until the build fails

`TenancyArchitectureTest`'s first pattern is `/where[A-Za-z]*\s*\([^;]*bookshelf_id/i`. **`[^;]*` runs to the end of the statement**, so any `where`-shaped call followed by the literal `bookshelf_id` *anywhere later in the same statement* matches. Measured against the real pattern:

| Form | Result |
|---|---|
| `->groupBy('bookshelf_id')->selectRaw(…)->where('status','active')->get()->pluck('n','bookshelf_id');` | **MATCH — build fails** |
| `$rows = …->where('status','active')->get();` then `$rows->pluck('n','bookshelf_id')` on the next line | clean |
| `->groupBy('bookshelf_id')->selectRaw(…)->where(…)->where(…)->get();` | clean |

**So: `groupBy` and `selectRaw` first, every `where` last, terminate with `->get()`, and do the `pluck` in a SEPARATE STATEMENT.** This is not a trick to defeat a linter — it is the same SQL either way — but it is how the code must be written, and `app/Queries/Admin/` is not on that test's allow-list.

- [ ] **Step 1: Write the failing test**

Create `tests/Feature/Admin/AdminOverviewQueryTest.php`:

```php
<?php

use App\Enums\BookshelfStatus;
use App\Enums\CommentStatus;
use App\Enums\DonationStatus;
use App\Enums\LoanStatus;
use App\Enums\MembershipStatus;
use App\Enums\RequestStatus;
use App\Models\Book;
use App\Models\BookCopy;
use App\Models\BookDonation;
use App\Models\Bookshelf;
use App\Models\BookshelfContact;
use App\Models\BorrowRequest;
use App\Models\Comment;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\User;
use App\Queries\Admin\AdminOverviewQuery;
use App\Support\TenantContext;
use Carbon\CarbonImmutable;

/**
 * Two shelves, so every count can be checked for leakage in both directions —
 * and THE TENANT IS LEFT BOUND TO SHELF A.
 *
 * THAT BINDING IS THE POINT OF THIS FILE, and an earlier draft of this plan
 * omitted it. Without it, every block below runs from an already-widened
 * context, and `Bookshelf` is not shelf-scoped anyway (`app/Models/Bookshelf.php`
 * uses HasFactory, HasUuids, SoftDeletes — no BelongsToBookshelf), so an
 * AdminOverviewQuery that FORGOT TO WIDEN AT ALL would pass every assertion.
 * The test that proves the phase would have proved nothing.
 *
 * Widen only to build fixtures; bind before returning.
 *
 * Grep first: `grep -rn "^function adminFix" tests/`.
 *
 * @return array{Bookshelf, Bookshelf}
 */
function adminFix(): array
{
    $context = app(TenantContext::class);
    $context->actSystemWide();

    $a = Bookshelf::factory()->create(['slug' => 'shelf-a-admin', 'name' => 'Aó Dài', 'settings' => []]);
    $b = Bookshelf::factory()->create(['slug' => 'shelf-b-admin', 'name' => 'Zzz', 'settings' => []]);

    // Bound, not widened. Every block below therefore reads as an ordinary
    // request would, and only the query's own widening can see shelf B.
    $context->set($a, null);

    return [$a, $b];
}

afterEach(fn () => CarbonImmutable::setTestNow());

it('lists every shelf, ordered by name', function () {
    [$a, $b] = adminFix();

    $rows = app(AdminOverviewQuery::class)->run();

    expect(collect($rows)->pluck('slug')->all())->toBe([$a->slug, $b->slug]);
});

it('SEES THE SHELF IT IS NOT BOUND TO — the block that fails if the widening is forgotten', function () {
    // The phase's central proof. The tenant is bound to shelf A (see
    // adminFix), so shelf B's row and its count are visible ONLY because
    // AdminOverviewQuery widens. Titled assertion first: a wrong `books`
    // count for shelf A must not hide a missing shelf B.
    [$a, $b] = adminFix();

    $context = app(TenantContext::class);
    $context->systemWide(function () use ($a, $b): void {
        Book::factory()->for($a)->count(3)->create();
        Book::factory()->for($b)->count(1)->create();
    });

    $rows = collect(app(AdminOverviewQuery::class)->run())->keyBy('slug');

    expect($rows)->toHaveKey($b->slug);
    expect($rows[$b->slug]['books'])->toBe(1);
    expect($rows[$a->slug]['books'])->toBe(3);
});

it('counts active memberships as readers, managers included', function () {
    // ManagerDashboardQuery:50 defines it: "readers counts every ACTIVE
    // membership, managers included". The pending membership below is what
    // catches a predicate that counts every row regardless of status.
    [$a] = adminFix();

    app(TenantContext::class)->systemWide(function () use ($a): void {
        foreach ([MembershipStatus::Active, MembershipStatus::Active, MembershipStatus::Pending] as $i => $status) {
            Membership::factory()->for($a)->create([
                'user_id' => User::factory()->create()->id, 'role' => 'reader', 'status' => $status,
            ]);
        }
    });

    $rows = collect(app(AdminOverviewQuery::class)->run())->keyBy('slug');

    expect($rows[$a->slug]['readers'])->toBe(2);
});

it('reads every figure live — no materialised counter can creep in', function () {
    // Spec D5, and OPS §3.4's "all live". Two reads, one row changed
    // between them. Cheap, and it is what a cached count would fail.
    [$a] = adminFix();

    $before = collect(app(AdminOverviewQuery::class)->run())->keyBy('slug');
    expect($before[$a->slug]['books'])->toBe(0);

    app(TenantContext::class)->systemWide(fn () => Book::factory()->for($a)->create());

    $after = collect(app(AdminOverviewQuery::class)->run())->keyBy('slug');
    expect($after[$a->slug]['books'])->toBe(1);
});

it('counts overdue as active loans past their due date, per shelf', function () {
    [$a] = adminFix();
    CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-09-02 02:00:00', 'UTC'));

    $book = Book::factory()->for($a)->create();
    $user = User::factory()->create();

    foreach ([['2026-08-01', 'DT-0001'], ['2026-12-01', 'DT-0002']] as [$due, $code]) {
        $copy = BookCopy::factory()->for($a)->for($book)->create(['code' => $code]);
        Loan::query()->create([
            'bookshelf_id' => $a->id, 'copy_id' => $copy->id, 'book_id' => $book->id,
            'borrower_id' => $user->id, 'lent_by' => $user->id,
            'due_on' => $due, 'status' => LoanStatus::Active,
        ]);
    }

    $rows = collect(app(AdminOverviewQuery::class)->run())->keyBy('slug');

    expect($rows[$a->slug]['overdue'])->toBe(1);
    expect($rows[$a->slug]['loans'])->toBe(2);
});

it('sums pending from all four sources — D3, including APPROVED requests', function () {
    // The `approved` half is the one a reader would not guess: an approved
    // hold nobody has collected is still waiting on a person. Four distinct
    // sources, one each, so a dropped source shows as 3 rather than passing.
    [$a] = adminFix();

    $book = Book::factory()->for($a)->create();
    $user = User::factory()->create();
    $member = Membership::factory()->for($a)->create([
        'user_id' => $user->id, 'role' => 'reader', 'status' => MembershipStatus::Active,
    ]);

    $pendingUser = User::factory()->create();
    Membership::factory()->for($a)->create([
        'user_id' => $pendingUser->id, 'role' => 'reader', 'status' => MembershipStatus::Pending,
    ]);
    BorrowRequest::query()->create([
        'bookshelf_id' => $a->id, 'book_id' => $book->id,
        'member_id' => $user->id, 'status' => RequestStatus::Approved,
    ]);
    Comment::query()->create([
        // author_id is a users(id), NOT a memberships(id) — the FK is
        // comments_author_id_foreign → users(id), and App\Models\Comment's
        // own docblock says so. book_donations.donor_membership_id below is
        // the reverse. An earlier draft of this plan passed $member->id here
        // and would have died on the foreign key.
        'bookshelf_id' => $a->id, 'book_id' => $book->id, 'author_id' => $user->id,
        'body' => 'Hay lắm', 'status' => CommentStatus::Pending,
    ]);
    BookDonation::query()->create([
        'bookshelf_id' => $a->id, 'donor_membership_id' => $member->id,
        'description' => 'Một túi sách', 'status' => DonationStatus::Pending,
    ]);

    $rows = collect(app(AdminOverviewQuery::class)->run())->keyBy('slug');

    expect($rows[$a->slug]['pending'])->toBe(4);
});

it('flags a shelf with no contacts, and does not flag one with a contact', function () {
    [$a, $b] = adminFix();
    // Widened to SEED, because the tenant is bound to shelf A and this row
    // belongs to B. BookshelfContact carries BelongsToBookshelf, so a bound
    // write would be refused.
    app(TenantContext::class)->systemWide(fn () => BookshelfContact::query()->create([
        'bookshelf_id' => $b->id, 'position' => 1, 'name' => 'Maria Nguyễn Lan',
    ]));

    $rows = collect(app(AdminOverviewQuery::class)->run())->keyBy('slug');

    expect($rows[$a->slug]['contactsMissing'])->toBeTrue();
    expect($rows[$b->slug]['contactsMissing'])->toBeFalse();
});

it('LISTS an archived shelf and marks it — D9', function () {
    // The one place the dashboard and the portal deliberately disagree. An
    // administrator is the only person who can reach an archived shelf at
    // all, so a listing that dropped it would make the shelf unreachable
    // from every surface at once.
    [$a] = adminFix();
    $a->update(['status' => BookshelfStatus::Archived]);

    $rows = collect(app(AdminOverviewQuery::class)->run())->keyBy('slug');

    expect($rows)->toHaveKey($a->slug);
    expect($rows[$a->slug]['status'])->toBe(BookshelfStatus::Archived->value);
});

it('leaves the caller\'s tenant exactly as it found it', function () {
    // Task 2's guarantee, asserted from the consumer's side: after the one
    // query in this namespace runs, an ordinary scoped read still filters.
    [$a] = adminFix();
    Book::factory()->for($a)->create();
    $context = app(TenantContext::class);
    $context->set($a, null);

    app(AdminOverviewQuery::class)->run();

    expect($context->isSystemWide())->toBeFalse();
    expect($context->bookshelfId())->toBe($a->id);
    expect(Book::query()->count())->toBe(1);
});
```

- [ ] **Step 2: Run it red**

Run: `make test FILTER=AdminOverviewQueryTest`
Expected: FAIL — `App\Queries\Admin\AdminOverviewQuery` does not exist.

**Check the factories and enum cases first.** Open `database/factories/BookshelfFactory.php` and confirm `BookshelfContact`, `BorrowRequest`, `Comment` and `BookDonation` accept the attributes above — Phase 2c found `Loan` has no factory at all and its column is `borrower_id`, not what a plan assumed. If a model needs a column these blocks omit, add it to the block rather than changing the factory.

- [ ] **Step 3: Implement**

Create `app/Queries/Admin/AdminOverviewQuery.php`. Structure it as one `run()` that opens `return $this->context->systemWide(function (): array { … });` and, inside, builds one `Bookshelf` list plus one grouped aggregate per metric, each obeying the chain rule above. Sketch, to be repeated per metric:

```php
$bookRows = Book::query()
    ->groupBy('bookshelf_id')
    ->selectRaw('bookshelf_id, count(*) as n')
    ->get();
$books = $bookRows->pluck('n', 'bookshelf_id');   // SEPARATE statement — see the table above
```

`pending` is four such aggregates summed per shelf; `contactsMissing` is one more (shelves with a contact row) inverted. `overdue` filters `status = active` and `due_on < $clock->today()`, matching `ManagerDashboardQuery`'s own shape. Shelves with no rows for a metric must read **0**, not be absent — map over the shelf list, not over the aggregate.

Filter the shelf list on `deleted_at` only (soft deletes give that for free); **do not filter on status** — D9.

The docblock carries: OPS §3.4's `GetAdminOverview` row, D3's four sources with `approved` named, D9's reason quoted from the reference, D5's "all live", and the chain-ordering constraint with its measured table so the next editor does not undo it.

- [ ] **Step 4: Run it green, then the suite**

`make test FILTER=AdminOverviewQueryTest` → 7 blocks. Then `make test`.

- [ ] **Step 5: Prove three blocks discriminate — the first is the phase**

```
# THE WIDENING ITSELF. Without this, the whole file can pass against a query
# that never widens, which is what an earlier draft of this plan shipped.
remove the $this->context->systemWide(...) wrapper from run(), leaving the body
make test FILTER=AdminOverviewQueryTest   → 'SEES THE SHELF IT IS NOT BOUND TO' RED
restore; git status --porcelain            → empty

# D3's `approved` half
change the borrow-request predicate to Pending only
make test FILTER=AdminOverviewQueryTest   → the pending block RED (3, not 4)
restore; git status --porcelain            → empty

# D9
add ->where('status', BookshelfStatus::Active) to the shelf list
make test FILTER=AdminOverviewQueryTest   → the archived block RED
restore; git status --porcelain            → empty
```

**If the first mutation leaves the file green, stop and report it** — the
query is reading across shelves for some reason other than its own widening,
and the fence around it means nothing.

- [ ] **Step 6: Gates, then commit**

```bash
make analyse && make lint
git add app/Queries/Admin/AdminOverviewQuery.php tests/Feature/Admin/AdminOverviewQueryTest.php
git commit -m "feat: the cross-shelf overview, inside the fence and out again"
```

---

## Task 4: the dashboard — route, controller, screen, nav

**Files:**
- Create: `app/Http/Controllers/Admin/DashboardController.php`, `resources/js/pages/admin/dashboard.tsx`
- Modify: `routes/web.php` (the `admin` group), `resources/js/layouts/admin-layout.tsx`, `resources/js/lib/copy.ts`
- Test: `tests/Feature/Admin/AdminDashboardScreenTest.php` (create)

**Interfaces:**
- Consumes: `AdminOverviewQuery::run()` (Task 3).
- Produces: route `admin.dashboard` at `GET /admin`; Inertia page `admin/dashboard` with prop `shelves` (the query's array).

**This is the one genuinely new route in 3a.** The `admin` group has seven routes and no index — verified with `artisan route:list --path=admin`. Add it **inside** the existing `Route::prefix('admin')->name('admin.')->middleware('super-admin')` group. Everything else in Phase 3 replaces a placeholder; this does not.

**`admin-layout.tsx` already ships.** It lists four of the seven admin routes (`shelves`, `managers`, `categories`, `settings`) via `copy.admin.*` and `route("admin.*")`, and has no dashboard entry. Add one; do not build a layout.

- [ ] **Step 1: Write the failing test**

```php
<?php

use App\Models\Bookshelf;
use App\Models\User;
use App\Support\TenantContext;
use Inertia\Testing\AssertableInertia;

/** Grep first: `grep -rn "^function adminScreenFix" tests/`. */
function adminScreenFix(): User
{
    app(TenantContext::class)->actSystemWide();
    Bookshelf::factory()->create(['slug' => 'shelf-a-dash', 'name' => 'Aó Dài', 'settings' => []]);

    return User::factory()->create(['is_super_admin' => true]);
}

it('renders the dashboard with a row per shelf', function () {
    $admin = adminScreenFix();

    $this->actingAs($admin)
        ->get('/admin')
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('admin/dashboard')
            ->has('shelves', 1)
            ->has('shelves.0.books')
            ->has('shelves.0.pending')
            ->has('shelves.0.contactsMissing'));
});

it('a signed-in non-super-admin meets 404, never 403', function () {
    // Spec §5.4: a refusal must not confirm which URLs exist. NOT vacuous —
    // /admin is claimed by this task's own route, so this asserts
    // EnsureSuperAdmin's refusal rather than the router's absence. Re-check
    // it after the route lands.
    adminScreenFix();
    $ordinary = User::factory()->create(['is_super_admin' => false]);

    $this->actingAs($ordinary)->get('/admin')->assertNotFound();
});

it('a guest is redirected to login rather than 404d', function () {
    // Name the target: a bare assertRedirect() passes on ANY 3xx, including
    // a redirect somewhere wrong.
    adminScreenFix();

    $this->get('/admin')->assertRedirect(route('login'));
});
```

- [ ] **Step 2: Run it red**

Run: `make test FILTER=AdminDashboardScreenTest`
Expected: the two positive blocks fail. **`GET /admin` returns 404 today** (verified), so the non-super-admin block passes for the WRONG reason before the route exists — that is the vacuous-404 trap this project has measured. Re-run it after Step 3 and confirm it still passes once the path is claimed.

- [ ] **Step 3: Add the route and controller**

```php
        // BR §16.4's admin dashboard: "One row per bookshelf: name, books,
        // active readers, current loans, overdue count, pending items.
        // Anything needing attention is flagged." OPS §3.4's GetAdminOverview.
        // The one route in Phase 3 that is new rather than a placeholder.
        Route::get('/', [DashboardController::class, 'index'])->name('dashboard');
```

`DashboardController::index(AdminOverviewQuery $overview): Response` renders `admin/dashboard` with `['shelves' => $overview->run()]`. No writes, nothing to refuse.

- [ ] **Step 4: Build the screen and the nav entry**

Add a `copy.admin.dashboard*` group in `copy.ts` — its own keys, no reaching into `copy.manage`. Build `resources/js/pages/admin/dashboard.tsx` using `AdminLayout`, one row per shelf, the attention flag visible, and an empty state.

**Use what exists** — `ui/badge.tsx`, `ui/card.tsx`, `ui/label.tsx`. Task 1 has by now corrected `AGENTS.md`; read it rather than this paragraph for the component table.

**Nothing here can be tested.** This repo has no frontend renderer, and `assertInertia` sees props only. **Read the markup and check each label sits above the value it names** — Phase 1d measured that swapping two dashboard stat cards' values leaves every gate green. Say in your report that you did.

- [ ] **Step 5: Run, gates, commit**

`make test`, `make analyse`, `make lint`, then commit.

---
## Task 5: the portal — folded search, and address

**Files:**
- Create: `database/migrations/2026_08_31_000001_add_bookshelves_folded_columns.php`
- Modify: `app/Http/Controllers/ShellController.php` (`shelves()`), `resources/js/pages/shelves/index.tsx`, `resources/js/lib/copy.ts`
- Test: `tests/Feature/Shell/PortalSearchTest.php` (create) — `tests/Feature/Shell/` already exists and `ShellController` is what this task modifies.

**Interfaces:**
- Produces: `GET /shelves?q=…` filtering on folded `name`, `location` and `address`; the page prop gains `address`.

**What is already there.** `ShellController::shelves()` renders `shelves/index` with active shelves ordered by name, sending `slug`, `name`, `location` (verified). `resources/js/pages/shelves/index.tsx` types `location: string | null` and already guards it before rendering.

**Why a migration.** BR §16.1 makes the search box the portal's only job, for Vietnamese parish names. Every other search in this codebase folds diacritics and matches a **stored generated column** — `books.title_folded`, `books.author_folded`, `users.full_name_folded`. **`bookshelves` has none** (verified against the live table). So a naive `LIKE` finds nothing for *Giáo xứ Hòa Bình* when a parent types `hoa binh`, which is the exact case the box exists for.

**Copy the shipped pattern exactly** — `database/migrations/2026_08_28_000001_add_users_full_name_folded.php` is the model, and its comments explain the two non-obvious choices:

- **`TEXT`, not `VARCHAR`.** `Fold::MAP` expands `ß→ss`, `æ→ae`, `œ→oe`, `ĳ→ij`, so a fold can exceed its source's length and a `VARCHAR(255)` fold of a 255-char name raises errno 1406 on insert.
- **No `NOT NULL`.** MariaDB's generated-column grammar accepts only `STORED`/`VIRTUAL`/`UNIQUE`/`COMMENT` after the expression. `location` and `address` are nullable anyway; a null folds to null, harmlessly.

- [ ] **Step 1: Write the failing test**

```php
<?php

use App\Models\Bookshelf;
use App\Support\TenantContext;

/** Grep first: `grep -rn "^function portalFix" tests/`. */
function portalFix(): void
{
    app(TenantContext::class)->actSystemWide();
    Bookshelf::factory()->create([
        'slug' => 'hoa-binh', 'name' => 'Giáo xứ Hòa Bình',
        'location' => 'Đồng Tháp', 'address' => '12 Nguyễn Huệ', 'settings' => [],
    ]);
    Bookshelf::factory()->create([
        'slug' => 'an-giang', 'name' => 'Giáo xứ An Giang',
        'location' => 'An Giang', 'address' => null, 'settings' => [],
    ]);
}

it('finds a shelf by unaccented name — the case the box exists for', function () {
    portalFix();

    $this->get('/shelves?q=hoa binh')
        ->assertOk()
        ->assertInertia(fn ($page) => $page->has('shelves', 1)
            ->where('shelves.0.slug', 'hoa-binh'));
});

it('finds a shelf by its address', function () {
    portalFix();

    $this->get('/shelves?q=nguyen hue')
        ->assertInertia(fn ($page) => $page->has('shelves', 1)
            ->where('shelves.0.slug', 'hoa-binh'));
});

it('finds a shelf by location', function () {
    portalFix();

    $this->get('/shelves?q=dong thap')
        ->assertInertia(fn ($page) => $page->has('shelves', 1));
});

it('sends address alongside location, and null where absent', function () {
    portalFix();

    $this->get('/shelves')
        ->assertInertia(fn ($page) => $page->has('shelves', 2)
            ->where('shelves.1.address', '12 Nguyễn Huệ')
            ->where('shelves.0.address', null));
});

it('an empty query lists every active shelf', function () {
    portalFix();

    $this->get('/shelves?q=')->assertInertia(fn ($page) => $page->has('shelves', 2));
});

it('the portal does NOT list an archived shelf — the one place it differs from the dashboard', function () {
    // D2 against D9. The dashboard lists archived shelves because an
    // administrator is their only route to them; the portal is public and
    // shows shelves a person can join.
    portalFix();
    Bookshelf::query()->where('slug', 'hoa-binh')->update(['status' => 'archived']);

    $this->get('/shelves')->assertInertia(fn ($page) => $page->has('shelves', 1));
});
```

- [ ] **Step 2: Run it red**, then write the migration

Create `database/migrations/2026_08_31_000001_add_bookshelves_folded_columns.php`:

```php
DB::statement(sprintf(
    'ALTER TABLE bookshelves ADD COLUMN name_folded TEXT
        CHARACTER SET utf8mb4 COLLATE utf8mb4_bin
        GENERATED ALWAYS AS (%s) STORED',
    FoldExpression::sql('`name`'),
));
DB::statement('ALTER TABLE bookshelves ADD INDEX bookshelves_name_folded_index (name_folded(191))');
```

and the same for `location_folded` and `address_folded` — **but wrap those two in `COALESCE`**, because they are nullable and the shipped precedent for a nullable source does:
`database/migrations/2026_08_28_000002_fix_fold_expression_capital_sharp_s.php:66` uses `FoldExpression::sql("COALESCE(\`author\`, '')")`, while the bare form is used only for NOT NULL sources like `full_name` and `title`. A bare fold of a null is harmless in practice (null folds to null and simply never matches), but this plan claims to copy the shipped pattern, so copy it.

`down()` **drops the index first, then the column**, mirroring the shipped migration's own teardown order.

**This migration adds no `Fold::MAP` entry**, so it does not re-open the documented cascade hazard — it renders the existing expression over three new columns. Say so in the migration's docblock.

- [ ] **Step 3: Fold the query**

In `ShellController::shelves()`, read `q` from the request and filter on the three folded columns with `Fold::fold($q)`, matching how `BooksListQuery` does it. Add `address` to the selected columns and to the mapped array. Keep the `status = active` filter — D2.

**Carry `BooksListQuery`'s punctuation guard** (`app/Queries/BooksListQuery.php:35-39`, opened): a query that is non-empty but folds to the empty string — `?q=...` — would otherwise degenerate to `LIKE '%%'` and match **every** shelf. Guard on the FOLDED value being non-empty, not on the raw input. Add a block:

```php
it('a query that folds to nothing lists nothing, not everything', function () {
    portalFix();

    $this->get('/shelves?q=...')->assertInertia(fn ($page) => $page->has('shelves', 0));
});
```

- [ ] **Step 4: Update the page**

`resources/js/pages/shelves/index.tsx`: add `address: string | null` to `Props`, render it beside location (each guarded — both are nullable), and add a search input that submits `?q=`. New copy keys in their own namespace.

- [ ] **Step 5: Run green, then prove the fold discriminates**

```
replace the folded-column match with a plain LIKE on `name`
make test FILTER=PortalSearchTest   → the unaccented block RED
restore; git status --porcelain      → empty
```

That block is the whole reason for the migration; a test that passes without folding proves nothing.

- [ ] **Step 6: Gates, then commit**

```bash
make test && make analyse && make lint
git add -A
git commit -m "feat: the portal finds a parish by its unaccented name"
```

---

## Task 6: the guarantee sweep

**Files:**
- Modify: `docs/known-gaps.md`, `docs/superpowers/HANDOFF.md`
- Test: as below

- [ ] **Step 1: Re-take every number and paste it**

`make test`, `make analyse`, `make lint`, Pint inside `laravel-app-1`, `git diff origin/main...HEAD -- old_next/` (must be empty), the commit count and diffstat against `origin/main`. **Paste the output rather than asserting the result** — a measurement true when written can be falsified by a later commit, and this project has shipped a diffstat matching no single base twice.

- [ ] **Step 2: Confirm every pin still falsifies at HEAD**

Task 1's style-guide pin, Task 2's two widening pins, and Task 2's lifetime blocks were each falsified when written. **Re-falsify them at HEAD**, because later tasks moved the code underneath them. Paste each red run.

- [ ] **Step 3: Record in `docs/known-gaps.md`**

In the file's own voice, prose not bullets:

- **The widening capability now exists on a request path.** `TenantContext::systemWide()` is fenced by two pins, but the fence is a grep and greps have known limits — the same limits `TenancyArchitectureTest` documents for its own tripwire (a method name held in a variable slips it). Say so.
- **`clear()` still has no callers**, and `actSystemWide()` remains callable directly by the three allow-listed files. The wrapper is the sanctioned path, not the only possible one.
- **The dashboard's screen is unverified by any test**, as every screen in this repo is — no frontend runner exists.
- **The three new folded columns** are generated over the existing `Fold` expression; adding a `Fold::MAP` entry later re-opens the documented cascade hazard for them as it does for `books` and `users`.
- Any deferred minor the task reviews produced.

- [ ] **Step 4: Update `docs/superpowers/HANDOFF.md`**

Add the Phase 3a row and section: what shipped, the decisions (D1's two-pin fence, D2/D8's portal, D3's pending sum, D7's chain ordering, D9's archived shelves), the carries, and **gate numbers naming the commit they were taken at**.

Record the phase's most reusable lesson: **the spec was reviewed twice before any code, and three times specified a guard against an allow-list nobody had grepped** — `SweepReminders`, then `systemWide()` versus `actSystemWide()`, then `DemoShelfSeeder` under `database_path()`. The same mistake three times, in the document arguing for care. The countermeasure that worked was stating scan roots and allow-lists explicitly in the spec rather than leaving them to be discovered.

- [ ] **Step 5: Open the PR and hand the merge decision to Kien**

Push, open the PR, then run a **whole-branch review** with a fresh agent on the most capable model, and a scoped re-review of any fix wave it produces. **Do not merge.**

---

## Self-Review

**This plan was rejected once and reworked.** An independent Opus review returned **NEEDS REWORK** with two
Criticals, seven Mediums and four Lows. What follows reviews the reworked version.

**The two Criticals, and what they were.**

1. **`comments.author_id` is a `users(id)`, not a `memberships(id)`.** The pending-sum fixture passed a
   membership id and would have died on `comments_author_id_foreign`. The repo documents this exact trap in
   `App\Models\Comment`'s own docblock, and `book_donations.donor_membership_id` is the reverse — the plan
   got four other id columns right and slipped on the one the codebase warns about.
2. **The phase's central test proved nothing.** `adminFix()` called `actSystemWide()` and never bound a
   shelf; `Bookshelf` is not tenant-scoped (`HasFactory, HasUuids, SoftDeletes` — no `BelongsToBookshelf`).
   So an `AdminOverviewQuery` that **forgot to widen entirely** would have passed every block. The spec asked
   in as many words for "the test that would fail if `actSystemWide()` were forgotten"; the plan did not
   deliver it. `adminFix()` now widens only to seed and **leaves the tenant bound to shelf A**, one block is
   named for the property, and Step 5's first mutation strips the widening and requires that block to redden.

**Corrections applied, each recorded rather than silently fixed:**

| Was | Is |
|---|---|
| `author_id => $member->id` | `$user->id`, with the FK and the model's own docblock cited |
| Fixture widened and never bound | Widens to seed, binds shelf A, and one block is the widening's proof |
| Baseline 1,645 / 9,581 | **1,646 / 9,585**, measured at `eb1a58b` — the old number was Phase 2c's, carried without re-running |
| "expect baseline + 10" | **+7** (5 blocks + 2 pins) |
| `readers` in the contract, undefined and untested | Defined as active memberships including managers (`ManagerDashboardQuery:50`), with a block whose pending fixture catches a status-blind predicate |
| D5 mapped to "a docblock" | A two-read block: change a row between reads, see the number move |
| Search guarded on non-blank raw input | Guarded on the **folded** value, carrying `BooksListQuery`'s punctuation guard, plus a `?q=...` block — otherwise it degenerates to `LIKE '%%'` and lists every shelf |
| `setTestNow()` never reset | `afterEach(fn () => CarbonImmutable::setTestNow())` |
| Bare fold over nullable columns | `COALESCE`, matching the shipped precedent for nullable sources |
| `down()` "drops the three columns" | Drops the index first, then the column |
| Bare `assertRedirect()` / bare `toThrow(class)` | Named target; named message fragment |

**What the review confirmed sound, and it is the part worth keeping:** the fourth instance of this
document's recurring mistake — a guard specified against an un-grepped allow-list — **was not present**. The
reviewer executed both pin patterns against `app_path()`, `database_path()` and `base_path('routes')` and
found exactly the two allow-listed callers and no others, and confirmed neither pattern matches
`->isSystemWide()`, `$this->systemWide = true`, or the `TenantContext::actSystemWide()` prose form used
throughout the codebase. It also re-derived the chain-ordering table, ran the migration's DDL on a scratch
database, and verified every factory, enum case and unique constraint the fixtures touch. Stating the scan
roots and allow-lists explicitly in the spec is what closed that hole.

**Spec coverage.** D1 → Task 2 (both pins, the lifetime blocks, and now the consumer-side restore assertion in
Task 3). D2 → Task 5. D3 → Task 3, with `approved` isolated. D4 → Task 3. D5 → Task 3's live-figures block.
D6 → Task 1. D7 → Task 3's measured chain-ordering table. D8 → Task 5's migration. D9 → Task 3 *and* Task 5,
deliberately split so a reviewer sees the dashboard and the portal disagree on purpose.

**Placeholder scan.** No "TBD", no "similar to Task N", no "add appropriate error handling". Task 4's screen
and Task 5's page carry prose steps rather than component code — deliberate, because this repo has no
frontend test runner and code written blind into a plan is a false promise of verification.

**Type consistency.** `TenantContext::systemWide(callable): mixed` (Task 2) is called by Task 3 alone.
`AdminOverviewQuery::run(): array` (Task 3) is consumed by Task 4 under that name, and the row keys asserted
in Task 3 — `books`, `readers`, `loans`, `overdue`, `pending`, `contactsMissing`, `status` — are the keys
Task 4's screen reads.

**Known risk carried into execution.** Task 2 is the phase. If either pin cannot be made to falsify, the
spec's own fallback applies — bind each shelf in turn rather than ship an unpinned widening — and that is a
spec amendment, not an implementer's call.
