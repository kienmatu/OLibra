# Phase 2c — Statistics and QR Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the manager's statistics screen and the QR label system (printable sheet plus manager scanning) from `old_next/` onto Laravel + Inertia, closing Phase 2.

**Architecture:** Two slices in one branch. Slice A adds one query and one screen, with period boundaries rebuilt in MariaDB because Postgres `date_trunc` has no equivalent. Slice B adds four queries, one command, a pure payload codec, a server-side PDF writer built on `bacon/bacon-qr-code` + FPDF, one selection screen, and a camera scanner wired into the two shipped circulation flows. No migrations: Phase 0 already wrote every column this phase needs.

**Tech Stack:** PHP 8.4, Laravel 13, MariaDB 10.11.19, Inertia v3, React, TypeScript, Pest, Larastan level 8, Pint, Biome. New composer dependencies: `bacon/bacon-qr-code`, `setasign/fpdf`. New JS dependencies: none — `zxing-wasm` and `jsqr` are already in `package.json`.

**Spec:** `docs/superpowers/specs/2026-08-31-laravel-phase-2c-statistics-and-labels-design.md`

## Global Constraints

Every task's requirements implicitly include this section.

- **Never write to `old_next/`.** It is a read-only behavioural reference. `git diff origin/main...HEAD -- old_next/` must stay empty; the wrap-up task asserts it.
- **Do not run `vendor/bin/pint` on the host** — the host PHP is broken. Run it inside the container: `docker compose -f docker-compose.laravel.yml exec -T app ./vendor/bin/pint`.
- **Gates:** `make lint` (Pint + Biome + `bun run laravel:typecheck`), `make analyse` (Larastan level 8), `make test` (`make test FILTER=<File>` for one file). `make lint` carries **3 Biome warnings and 1 info** — that is the inherited baseline, not a regression.
- **Baseline at branch point:** suite **1,569 passing / 9,384 assertions**, Larastan `[OK]` on 256 files, Pint PASS on 436 files. Re-take the suite number at the start of your task rather than trusting this line — it is true at `7151a91` and every task moves it.
- **Storage is UTC. The civil timezone is `Asia/Ho_Chi_Minh`, named once** on `App\Support\Clock` (Task 1). No new string literal `'Asia/Ho_Chi_Minh'` may be added anywhere else in this phase.
- **Tenancy is `BookshelfScope`'s, never a hand-written `where('bookshelf_id', …)`** in a query or command. A foreign row must be *not found* (404), never *refused* (403).
- **Every write transaction retries:** `DB::transaction(fn () => …, ConcurrencyRetry::ATTEMPTS)`. Pinned by `tests/Feature/Architecture/CommunityArchitectureTest.php`.
- **Every command records an audit entry** in the same transaction as its write.
- **Vietnamese user-facing copy lives in `resources/js/lib/copy.ts`** (screens) and `lang/vi/*.php` (server sentences). A namespace never reaches into another namespace's key — add a second key instead, per `copy.ts`'s own header rule.
- **AGENTS.md's component table prescribes fourteen components this repo does not have** (`Pill`, `StatusBadge`, `StatusPanel`, `StepIndicator`, `ReadOnlyValue`, `BookTitle`, `Field`, `Textarea`, `BookCover`, `PhoneLink`, `ButtonLink`, `BigActionLink`, `QrScanner`, `CopyScanField`), and its numbered rules **1, 2 and 6** cite one. It also routes twice through `field.tsx`, which does not exist. **Use `components/ui/badge.tsx`, and `Label` + a raw control + `InputError`.** This misdirected three tasks in Phase 2b; do not let it misdirect a fourth.
- **This repo has no frontend rendering tests.** `assertInertia` checks server-side props only. A React component's behaviour cannot be asserted — design so that nothing depends solely on one.
- **Docblocks must be true.** If you write "(opened)" or "measured", you must have done it. Phase 2b found and corrected sixteen false claims; six of them were introduced by fix rounds sent to remove an earlier one. When you correct a claim, **retract it by name and say where it IS true** — a merely deleted false sentence has been measured reappearing three commits later.

---

## File Structure

**Slice A — statistics**

| File | Responsibility |
|---|---|
| `app/Enums/StatsPeriod.php` | The four periods as a backed enum, matching the existing `App\Enums` convention. |
| `app/Support/Clock.php` (modify) | Gains `ZONE` — the single named civil timezone — and `periodStart()`. |
| `app/Queries/StatisticsQuery.php` | Every figure on the statistics screen, computed at query time. |
| `resources/js/pages/manage/statistics.tsx` | The screen, with hand-rolled SVG charts. |
| `resources/js/lib/copy.ts` (modify) | `copy.manageStatistics` namespace. |
| `app/Http/Controllers/Manage/StatisticsController.php` | One GET. |

**Slice B — QR labels**

| File | Responsibility |
|---|---|
| `app/Support/Qr/LabelPayload.php` | Pure string arithmetic: UUID ↔ `OLB1:` payload. No database, no framework. |
| `app/Support/Qr/LabelSheet.php` | Geometry and PDF bytes. Knows nothing about tenancy or HTTP. |
| `app/Queries/Labels/TitlesForLabelsQuery.php` | The selection accordion, grouped in the query. |
| `app/Queries/Labels/CopiesForLabelsQuery.php` | `bookIds ∪ copyIds` expanded server-side. |
| `app/Queries/Labels/CopyByIdQuery.php` | A scanned UUID back to a copy. |
| `app/Actions/Catalogue/MarkCopiesPrinted.php` | Stamps and increments; one batch audit entry. |
| `app/Http/Controllers/Manage/LabelController.php` | The selection GET and the export POST. |
| `resources/js/pages/manage/labels.tsx` | The selection screen. |
| `resources/js/components/copy-scanner.tsx` | The camera scanner, with a typed-code fallback. |

---

## Slice A — Statistics

### Task 1: The period boundary, and one named civil timezone

**Files:**
- Create: `app/Enums/StatsPeriod.php`
- Modify: `app/Support/Clock.php`
- Test: `tests/Unit/Statistics/PeriodBoundaryTest.php`

**Interfaces:**
- Consumes: `App\Support\Clock` as it stands (`now()`, `today()`).
- Produces: `App\Enums\StatsPeriod` (backed string enum: `Week`=`'week'`, `Month`=`'month'`, `Year`=`'year'`, `All`=`'all'`); `Clock::ZONE` (string const); `Clock::periodStart(StatsPeriod $period): CarbonImmutable` returning a **UTC** instant.

**A refinement of the spec, and why it is an improvement rather than a deviation.** The design doc proposed rebuilding Postgres `date_trunc` as MariaDB expressions (`DATE_SUB(d, INTERVAL WEEKDAY(d) DAY)` and friends, which it verified do run on 10.11.19). This plan computes the boundary in **PHP** instead and passes it as a bound parameter. It is strictly simpler — the boundary becomes unit-testable without a database, `Carbon::setTestNow()` already controls it, and the `date_trunc` replacement problem disappears rather than being solved. The spec's measured SQL stands as evidence that either route works; this is the cheaper one. Record this choice in the task's commit message so the spec and the plan do not appear to disagree.

**Why `Clock` and not a new config file.** `Clock::today()` **already** hardcodes `'Asia/Ho_Chi_Minh'` and its docblock already argues the case ("'today' … is the parish's day, not the server's UTC day — at 01:30 Hồ Chí Minh time the server's UTC date is still yesterday"). `Clock` already owns this concept; naming the constant here replaces a literal instead of adding a fourth expression of the same idea.

- [ ] **Step 1: Write the failing test**

Create `tests/Unit/Statistics/PeriodBoundaryTest.php`:

```php
<?php

use App\Enums\StatsPeriod;
use App\Support\Clock;
use Carbon\CarbonImmutable;

/**
 * The boundary is a CIVIL day boundary expressed as a UTC instant, which
 * is the whole reason these blocks assert on UTC strings rather than on
 * local ones: a test that asserts "Monday 00:00" in the parish timezone
 * passes just as happily against a Clock that never converted anything.
 */
it('the week boundary is Monday 00:00 in the parish timezone, expressed in UTC', function () {
    // 2026-08-31 is a Monday — measured, not assumed:
    //   SELECT DAYNAME('2026-08-31') → Monday, on MariaDB 10.11.19.
    // "Now" is Wednesday 2026-09-02, 09:00 in Hồ Chí Minh = 02:00 UTC.
    CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-09-02 02:00:00', 'UTC'));

    $start = app(Clock::class)->periodStart(StatsPeriod::Week);

    // Monday 00:00 at +07:00 is the PREVIOUS Sunday at 17:00 UTC. If the
    // implementation forgets to convert, it returns ...T00:00:00Z and this
    // block fails on the seven-hour difference, which is the point.
    expect($start->toIso8601String())->toBe('2026-08-30T17:00:00+00:00');
});

it('the month boundary is the first of the civil month, not of the UTC month', function () {
    // 2026-09-01 00:30 Hồ Chí Minh is 2026-08-31 17:30 UTC — the hours in
    // which the two calendars disagree, which is the only interesting case.
    CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-08-31 17:30:00', 'UTC'));

    $start = app(Clock::class)->periodStart(StatsPeriod::Month);

    // Civil date is 1 September, so the month began at 1 Sep 00:00 +07:00
    // = 31 Aug 17:00 UTC. A UTC-only implementation answers 1 Aug, a month out.
    expect($start->toIso8601String())->toBe('2026-08-31T17:00:00+00:00');
});

it('the year boundary is the first of the civil year', function () {
    CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-06-15 12:00:00', 'UTC'));

    expect(app(Clock::class)->periodStart(StatsPeriod::Year)->toIso8601String())
        ->toBe('2025-12-31T17:00:00+00:00');
});

it('"all" is a floor early enough to precede any row this system can hold', function () {
    CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-06-15 12:00:00', 'UTC'));

    expect(app(Clock::class)->periodStart(StatsPeriod::All)->year)->toBeLessThan(1971);
});

it('the civil timezone is named once, on Clock, and today() reads that name', function () {
    // The guard for this phase's constraint: no new 'Asia/Ho_Chi_Minh'
    // literal. If someone re-inlines the string in today(), this stays green
    // — so the block asserts the CONSTANT exists and carries the value, and
    // the architecture block in Task 13 is what counts the literals.
    expect(Clock::ZONE)->toBe('Asia/Ho_Chi_Minh');
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `make test FILTER=PeriodBoundaryTest`
Expected: FAIL — `App\Enums\StatsPeriod` does not exist.

- [ ] **Step 3: Create the enum**

Create `app/Enums/StatsPeriod.php`:

```php
<?php

namespace App\Enums;

/**
 * OPS §3.3's GetStatistics takes `period` as one of exactly these four
 * (opened: "`bookshelfId`, `period` (`week` | `month` | `year` | `all`)").
 * A backed enum rather than a validated string so an unknown period is a
 * type error at the controller boundary rather than a silent full-history
 * read — the `all` case is the expensive one and must be asked for by name.
 */
enum StatsPeriod: string
{
    case Week = 'week';
    case Month = 'month';
    case Year = 'year';
    case All = 'all';
}
```

- [ ] **Step 4: Add the constant and the boundary to Clock**

Modify `app/Support/Clock.php`. Add the `use` lines for `App\Enums\StatsPeriod` and `Carbon\CarbonInterface`, then:

```php
    /**
     * The parish's civil timezone, named ONCE for the whole application.
     *
     * Storage is UTC (`config('app.timezone')` resolves to 'UTC'; `.env`
     * line 177 sets APP_TIMEZONE=UTC, confirmed with artisan tinker), and
     * this is the timezone every civil-day boundary is taken in. It is a
     * constant rather than a config key because it is not deployment
     * configuration: a parish does not move.
     *
     * KNOWN, AND DELIBERATELY NOT FIXED HERE: MyLoanHistoryQuery lines 39
     * and 42 still hardcode this string. That is shipped Phase 1c code and
     * changing it is scope creep into a merged phase; it is recorded in
     * docs/known-gaps.md instead. Nothing in Phase 2c adds a new literal.
     *
     * PER-SHELF TIMEZONE IS PHASE 3's. bookshelves.timezone exists as a
     * column and is deliberately not read: there is one parish today, and
     * a network of shelves is what makes the column mean anything.
     */
    public const string ZONE = 'Asia/Ho_Chi_Minh';

    /**
     * The instant a statistics period begins, as UTC.
     *
     * Computed here rather than in SQL. The reference does it with Postgres
     * `date_trunc(... at time zone 'Asia/Ho_Chi_Minh')`, which MariaDB has
     * no equivalent for; doing it in PHP removes the problem instead of
     * porting it, and makes the boundary testable with setTestNow() and no
     * database at all.
     *
     * startOfWeek is passed MONDAY explicitly. Carbon's default start of
     * week follows the locale, so an unqualified startOfWeek() would make
     * the week boundary a configuration accident — the same reason the
     * spec's SQL alternative chose WEEKDAY() over WEEK().
     */
    public function periodStart(StatsPeriod $period): CarbonImmutable
    {
        $civil = $this->now()->setTimezone(self::ZONE);

        $start = match ($period) {
            StatsPeriod::Week => $civil->startOfWeek(CarbonInterface::MONDAY),
            StatsPeriod::Month => $civil->startOfMonth(),
            StatsPeriod::Year => $civil->startOfYear(),
            // An epoch floor, not a real date. Every instant this system can
            // store is after it, which is all "since the shelf began" means.
            StatsPeriod::All => CarbonImmutable::parse('1970-01-01 00:00:00', 'UTC'),
        };

        return $start->setTimezone('UTC');
    }
```

Then replace the literal in `today()` so the constant is the only spelling:

```php
    /** `Y-m-d` in the application's civil timezone. */
    public function today(): string
    {
        return CarbonImmutable::now(self::ZONE)->toDateString();
    }
```

- [ ] **Step 5: Run the tests and make sure they pass**

Run: `make test FILTER=PeriodBoundaryTest`
Expected: PASS, 5 blocks.

Then run the whole suite — `today()` changed and is used by shipped catalogue and circulation code:

Run: `make test`
Expected: the branch baseline plus 5. Investigate any other movement; `today()`'s behaviour is unchanged by construction (same string, now named), so a red block elsewhere means the constant is wrong, not that the callers were.

- [ ] **Step 6: Gates**

Run: `make analyse` and `make lint`
Expected: Larastan `[OK]`, Pint PASS, Biome at 3 warnings + 1 info.

- [ ] **Step 7: Commit**

```bash
git add app/Enums/StatsPeriod.php app/Support/Clock.php tests/Unit/Statistics/PeriodBoundaryTest.php
git commit -m "feat: one named civil timezone, and the period boundary in PHP rather than SQL"
```

---

### Task 2: `StatisticsQuery`

**Files:**
- Create: `app/Queries/StatisticsQuery.php`
- Test: `tests/Feature/Statistics/StatisticsQueryTest.php`

**Interfaces:**
- Consumes: `App\Enums\StatsPeriod`, `Clock::periodStart()`, `Clock::ZONE` (Task 1).
- Produces: `StatisticsQuery::run(StatsPeriod $period): array` shaped exactly:
  `array{period: string, loans: int, borrowers: int, booksAdded: int, copiesLost: int, daily: list<array{day: string, count: int}>, byCategory: list<array{label: string, count: int}>, topBooks: list<array{bookId: string, slug: string, title: string, count: int}>, topReaders: list<array{name: string, count: int}>}`

**Two things this query does differently from the reference, both deliberate.**

**Divergence: lost copies are counted by `lost_reported_at`.** The reference (`old_next/src/domain/shelf/queries/get-statistics.ts`, opened) uses `where state = 'lost' and updated_at >= since`. `updated_at` moves on any write, so a copy reported lost years ago re-enters the period when someone edits its condition note. This schema carries `book_copies.lost_reported_at` and `App\Actions\Catalogue\ReportCopyLost` line 70 writes it (opened), so the honest predicate is available. Ruled by the product owner on 2026-08-31: correctness over parity. Design doc D2.

**Civil-day grouping uses the numeric offset `'+07:00'`, not the zone name.** `CONVERT_TZ(t, 'UTC', 'Asia/Ho_Chi_Minh')` requires MariaDB's `mysql.time_zone_name` table to be populated. It **is** populated on this development container — measured, `SELECT COUNT(*) FROM mysql.time_zone_name` returns 1793 — but the production cPanel host is unverified (`docs/HOSTING.md` records its survey as unrun), and a shared host with empty timezone tables answers `NULL` rather than erroring, which would silently empty the chart. `Asia/Ho_Chi_Minh` has been a fixed UTC+7 with no DST since 1975, so the numeric offset is exact and depends on nothing. Measured on 10.11.19: `DATE(CONVERT_TZ('2026-08-31 18:30:00','+00:00','+07:00'))` returns `2026-09-01` — the late-evening-UTC case that is the only one where the two calendars disagree.

- [ ] **Step 1: Write the failing test**

Create `tests/Feature/Statistics/StatisticsQueryTest.php`:

```php
<?php

use App\Enums\StatsPeriod;
use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\User;
use App\Queries\StatisticsQuery;
use App\Support\TenantContext;
use Carbon\CarbonImmutable;

/**
 * One shelf, one manager bound as the tenant, two readers.
 *
 * Grep first: `grep -rn "^function statFix" tests/` — top-level helpers are
 * process-global (AGENTS.md).
 *
 * @return array{Bookshelf, User, Membership, Membership}
 */
function statFix(string $slug = 'dong-thap-stat'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);

    $manager = User::factory()->create(['full_name' => 'Maria Nguyễn Lan']);
    $managerMembership = Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);

    $anh = User::factory()->create(['full_name' => 'Têrêsa Lê Ngọc Ánh']);
    $anhMembership = Membership::factory()->for($shelf)->create([
        'user_id' => $anh->id, 'role' => 'reader', 'status' => 'active',
    ]);

    app(TenantContext::class)->set($shelf, $managerMembership);
    test()->actingAs($manager);

    return [$shelf, $manager, $managerMembership, $anhMembership];
}

it('counts a loan inside the period and ignores one before it', function () {
    [$shelf, , , $reader] = statFix();
    CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-09-02 02:00:00', 'UTC'));

    $book = Book::factory()->for($shelf)->create();
    $copy = BookCopy::factory()->for($shelf)->for($book)->create();

    // Inside: Tuesday of the current civil week.
    Loan::factory()->for($shelf)->for($copy)->create([
        'borrower_membership_id' => $reader->id,
        'lent_at' => CarbonImmutable::parse('2026-09-01 03:00:00', 'UTC'),
        'status' => 'active',
    ]);
    // Outside: the Friday before, well clear of Monday 00:00 +07:00.
    Loan::factory()->for($shelf)->for($copy)->create([
        'borrower_membership_id' => $reader->id,
        'lent_at' => CarbonImmutable::parse('2026-08-28 03:00:00', 'UTC'),
        'status' => 'active',
    ]);

    expect(app(StatisticsQuery::class)->run(StatsPeriod::Week)['loans'])->toBe(1);
});

it('a voided loan is not a loan', function () {
    [$shelf, , , $reader] = statFix();
    CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-09-02 02:00:00', 'UTC'));

    $book = Book::factory()->for($shelf)->create();
    $copy = BookCopy::factory()->for($shelf)->for($book)->create();

    Loan::factory()->for($shelf)->for($copy)->create([
        'borrower_membership_id' => $reader->id,
        'lent_at' => CarbonImmutable::parse('2026-09-01 03:00:00', 'UTC'),
        'status' => 'voided',
    ]);

    expect(app(StatisticsQuery::class)->run(StatsPeriod::Week)['loans'])->toBe(0);
});

it('counts lost copies by lost_reported_at, not by updated_at — divergence D2', function () {
    [$shelf] = statFix();
    CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-09-02 02:00:00', 'UTC'));

    $book = Book::factory()->for($shelf)->create();

    // Reported lost LONG before the period, and touched inside it. Under
    // the reference's `updated_at >= since` this copy counts; under
    // lost_reported_at it does not. That difference IS this block.
    $old = BookCopy::factory()->for($shelf)->for($book)->create([
        'state' => 'lost',
        'lost_reported_at' => CarbonImmutable::parse('2025-01-05 03:00:00', 'UTC'),
    ]);
    $old->update(['condition_note' => 'tìm lại lần nữa']);

    // Reported lost inside the period.
    BookCopy::factory()->for($shelf)->for($book)->create([
        'state' => 'lost',
        'lost_reported_at' => CarbonImmutable::parse('2026-09-01 03:00:00', 'UTC'),
    ]);

    expect(app(StatisticsQuery::class)->run(StatsPeriod::Week)['copiesLost'])->toBe(1);
});

it('groups the daily chart by the PARISH day, not the UTC day', function () {
    [$shelf, , , $reader] = statFix();
    CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-09-03 02:00:00', 'UTC'));

    $book = Book::factory()->for($shelf)->create();
    $copy = BookCopy::factory()->for($shelf)->for($book)->create();

    // 18:30 UTC on 31 Aug is 01:30 on 1 Sep in Hồ Chí Minh. Grouped by the
    // UTC day this lands on 2026-08-31; grouped correctly it lands on
    // 2026-09-01. Measured on MariaDB 10.11.19:
    //   DATE(CONVERT_TZ('2026-08-31 18:30:00','+00:00','+07:00')) → 2026-09-01
    Loan::factory()->for($shelf)->for($copy)->create([
        'borrower_membership_id' => $reader->id,
        'lent_at' => CarbonImmutable::parse('2026-08-31 18:30:00', 'UTC'),
        'status' => 'active',
    ]);

    $daily = app(StatisticsQuery::class)->run(StatsPeriod::Week)['daily'];

    expect(collect($daily)->pluck('day')->all())->toContain('2026-09-01')
        ->and(collect($daily)->pluck('day')->all())->not->toContain('2026-08-31');
});

it('distinct borrowers counts people, not loans', function () {
    [$shelf, , , $reader] = statFix();
    CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-09-02 02:00:00', 'UTC'));

    $book = Book::factory()->for($shelf)->create();
    $copy = BookCopy::factory()->for($shelf)->for($book)->create();

    foreach ([1, 2, 3] as $n) {
        Loan::factory()->for($shelf)->for($copy)->create([
            'borrower_membership_id' => $reader->id,
            'lent_at' => CarbonImmutable::parse("2026-09-0{$n} 03:00:00", 'UTC'),
            'status' => 'active',
        ]);
    }

    $stats = app(StatisticsQuery::class)->run(StatsPeriod::Week);

    expect($stats['loans'])->toBe(3)->and($stats['borrowers'])->toBe(1);
});

it('another shelf\'s loans are invisible — tenancy, not a hand-written predicate', function () {
    [$shelf, , , $reader] = statFix();
    CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-09-02 02:00:00', 'UTC'));

    $book = Book::factory()->for($shelf)->create();
    $copy = BookCopy::factory()->for($shelf)->for($book)->create();
    Loan::factory()->for($shelf)->for($copy)->create([
        'borrower_membership_id' => $reader->id,
        'lent_at' => CarbonImmutable::parse('2026-09-01 03:00:00', 'UTC'),
        'status' => 'active',
    ]);

    // A whole second shelf with its own loan, seeded system-wide.
    app(TenantContext::class)->actSystemWide();
    $other = Bookshelf::factory()->create(['slug' => 'other-stat', 'settings' => []]);
    $otherUser = User::factory()->create();
    $otherMembership = Membership::factory()->for($other)->create([
        'user_id' => $otherUser->id, 'role' => 'reader', 'status' => 'active',
    ]);
    $otherBook = Book::factory()->for($other)->create();
    $otherCopy = BookCopy::factory()->for($other)->for($otherBook)->create();
    Loan::factory()->for($other)->for($otherCopy)->create([
        'borrower_membership_id' => $otherMembership->id,
        'lent_at' => CarbonImmutable::parse('2026-09-01 03:00:00', 'UTC'),
        'status' => 'active',
    ]);

    // Re-bind to the first shelf and read.
    app(TenantContext::class)->set($shelf, Membership::query()
        ->where('bookshelf_id', $shelf->id)->where('role', 'manager')->firstOrFail());

    expect(app(StatisticsQuery::class)->run(StatsPeriod::Week)['loans'])->toBe(1);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `make test FILTER=StatisticsQueryTest`
Expected: FAIL — `App\Queries\StatisticsQuery` does not exist.

**Before writing the implementation, check the factories.** `Loan::factory()` and `BookCopy::factory()` already exist (Phase 1c and 1a). Open `database/factories/LoanFactory.php` and `database/factories/BookCopyFactory.php` and confirm the attribute names used above (`borrower_membership_id`, `lent_at`, `status`, `state`, `lost_reported_at`). If a factory requires an attribute these blocks do not set, add it to the block rather than changing the factory — a factory default that other phases rely on is not this task's to move.

- [ ] **Step 3: Write the query**

Create `app/Queries/StatisticsQuery.php`. Structure it as one private `since()` plus one public `run()` that assembles the eight figures. Tenancy comes from `BookshelfScope` on each model — **write no `bookshelf_id` predicate**. Group the daily chart with:

```php
->selectRaw("DATE(CONVERT_TZ(lent_at, '+00:00', '+07:00')) as day, COUNT(*) as n")
```

Give the class a docblock carrying: the OPS §3.3 citation, divergence D2 with the reference's own predicate quoted, and the numeric-offset reasoning with the measured `2026-09-01` result. Do not write "measured" for anything you have not run.

Cast every count with `(int)` and return `list<...>` shapes through `array_values(...)` — Larastan level 8 rejects `array<int, ...>` where `list<...>` is declared. `DonationQueueQuery::run()` is the pattern to copy.

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `make test FILTER=StatisticsQueryTest`
Expected: PASS, 6 blocks.

- [ ] **Step 5: Prove the divergence block is not vacuous**

The D2 block is the one most easily written so that it passes either way. Prove it discriminates by temporarily reverting the predicate to the reference's:

```
change `lost_reported_at >= :since` to `updated_at >= :since`
make test FILTER=StatisticsQueryTest   → expect the D2 block RED (2 instead of 1)
restore
git status --porcelain                 → must be empty before continuing
```

A mutation that silently fails to apply is indistinguishable from one that changed nothing — prove the restore, and paste both runs into the commit message.

- [ ] **Step 6: Gates, then commit**

```bash
make analyse && make lint
git add app/Queries/StatisticsQuery.php tests/Feature/Statistics/StatisticsQueryTest.php
git commit -m "feat: the statistics query — and lost copies counted by the column that means it"
```

---
### Task 3: The *Thống kê* screen

**Files:**
- Create: `app/Http/Controllers/Manage/StatisticsController.php`
- Create: `resources/js/pages/manage/statistics.tsx`
- Modify: `routes/web.php` (the `manage` group), `resources/js/lib/copy.ts`, `resources/js/layouts/manage-layout.tsx`
- Test: `tests/Feature/Statistics/ManagerStatisticsScreenTest.php`

**Interfaces:**
- Consumes: `StatisticsQuery::run(StatsPeriod)` (Task 2), `App\Enums\StatsPeriod` (Task 1).
- Produces: route name `shelves.manage.statistics`; Inertia page `manage/statistics` with props `{ stats }` shaped as `StatisticsQuery::run()` returns; `copy.manageStatistics`.

**Charts are hand-rolled `<svg>`.** No chart library is added. The reference's own statistics page draws its charts as inline SVG (verified: its only chart-related import is the `<svg>` element itself). This satisfies AGENTS.md rule 8 — bar and line only, no pie charts, and **a plain-text summary above every chart** — by construction. The text summary is not decoration: it is the requirement, and it is also the only part of a chart this repo can test, since `assertInertia` sees props and never pixels.

**Period comes from the query string,** `?period=week|month|year|all`, defaulting to `month` (the reference's default). Validate by resolving `StatsPeriod::tryFrom()` and falling back to the default rather than 422-ing: a hand-edited URL should show a page, not an error.

- [ ] **Step 1: Write the failing test**

Create `tests/Feature/Statistics/ManagerStatisticsScreenTest.php`:

```php
<?php

use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Inertia\Testing\AssertableInertia;

/**
 * Grep first: `grep -rn "^function statScreenFix" tests/`.
 *
 * @return array{Bookshelf, User}
 */
function statScreenFix(string $slug = 'dong-thap-statscreen'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);
    $manager = User::factory()->create(['full_name' => 'Maria Nguyễn Lan']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);

    return [$shelf, $manager];
}

it('renders the statistics page with the four totals and the two charts', function () {
    [$shelf, $manager] = statScreenFix();

    $this->actingAs($manager)
        ->get("/tu-sach/{$shelf->slug}/quan-ly/thong-ke")
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('manage/statistics')
            ->has('stats.loans')
            ->has('stats.borrowers')
            ->has('stats.booksAdded')
            ->has('stats.copiesLost')
            ->has('stats.daily')
            ->has('stats.byCategory')
            ->has('stats.topBooks')
            ->has('stats.topReaders')
            ->where('stats.period', 'month'));
});

it('an unknown period falls back to the default rather than erroring', function () {
    [$shelf, $manager] = statScreenFix();

    $this->actingAs($manager)
        ->get("/tu-sach/{$shelf->slug}/quan-ly/thong-ke?period=fortnight")
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page->where('stats.period', 'month'));
});

it('a named period reaches the query', function () {
    [$shelf, $manager] = statScreenFix();

    $this->actingAs($manager)
        ->get("/tu-sach/{$shelf->slug}/quan-ly/thong-ke?period=year")
        ->assertInertia(fn (AssertableInertia $page) => $page->where('stats.period', 'year'));
});

it('a reader cannot reach the statistics screen, and meets 404 rather than 403', function () {
    [$shelf] = statScreenFix();
    $reader = User::factory()->create();
    Membership::factory()->for($shelf)->create([
        'user_id' => $reader->id, 'role' => 'reader', 'status' => 'active',
    ]);

    // 404, not 403: spec §5.4 forbids a refusal that confirms which shelf
    // URLs exist. EnsureShelfRole aborts 404 on the ability check.
    $this->actingAs($reader)
        ->get("/tu-sach/{$shelf->slug}/quan-ly/thong-ke")
        ->assertNotFound();
});

it('a guest is redirected to login rather than 404d', function () {
    [$shelf] = statScreenFix();

    $this->get("/tu-sach/{$shelf->slug}/quan-ly/thong-ke")->assertRedirect();
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `make test FILTER=ManagerStatisticsScreenTest`
Expected: FAIL — 404 on every block, because no route claims the URI.

**Note the trap this sits on.** A 404-only assertion is **vacuous when no route claims the URI** — it passes against a route that was never written, and against one later deleted. The reader block above is *not* vacuous only once the manager route exists, because then the path is claimed and the 404 is `EnsureShelfRole`'s rather than the router's. Run the reader block again after Step 4 and confirm it still passes for the right reason.

- [ ] **Step 3: Add the route**

Modify `routes/web.php`, inside the existing `Route::prefix('manage')->name('manage.')->middleware(['auth', 'role:manager'])` group. Place it beside the other single-GET manager screens:

```php
        // BR §16.3's Statistics paragraph, opened: "Period selector (week,
        // month, year, since the shelf began), showing loans, distinct
        // borrowers, books added, and books lost, with charts over time and
        // ranked lists of top books and top readers." OPS §3.3's
        // GetStatistics is the query behind it.
        Route::get('/thong-ke', [StatisticsController::class, 'index'])->name('statistics');
```

Add the `use App\Http\Controllers\Manage\StatisticsController;` import at the top of the file.

- [ ] **Step 4: Write the controller**

Create `app/Http/Controllers/Manage/StatisticsController.php`:

```php
<?php

namespace App\Http\Controllers\Manage;

use App\Enums\StatsPeriod;
use App\Http\Controllers\Controller;
use App\Models\Bookshelf;
use App\Queries\StatisticsQuery;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * BR §16.3's Statistics screen. One GET, no writes, nothing to refuse.
 *
 * The period is read from the query string rather than posted, so a
 * manager can bookmark "this year" and a link can carry a period. An
 * unknown value falls back to the default instead of 422-ing: a
 * hand-edited or stale URL should render the page, and there is no
 * destructive action here for a wrong period to trigger.
 *
 * MANAGER-FACING, AND THAT IS LOAD-BEARING. BR §16.2 records that the
 * leaderboard opt-in was withdrawn and *Bạn đọc chăm nhất* now counts
 * every borrower with no acknowledgement step; the stated mitigation is
 * precisely that this list stays manager-facing, since a manager can
 * already see every loan through the lending screens and the audit log.
 * BR §16.2 says that if this list ever becomes reader-facing the decision
 * has to be taken again. It is not taken here.
 */
class StatisticsController extends Controller
{
    public function index(Request $request, Bookshelf $shelf, StatisticsQuery $stats): Response
    {
        $period = StatsPeriod::tryFrom((string) $request->query('period')) ?? StatsPeriod::Month;

        return Inertia::render('manage/statistics', [
            'stats' => $stats->run($period),
        ]);
    }
}
```

- [ ] **Step 5: Run the tests and make sure they pass**

Run: `make test FILTER=ManagerStatisticsScreenTest`
Expected: PASS, 5 blocks — but the page component does not exist yet, so if the Inertia test resolves components you will see it here. Create the screen in Step 6 and re-run.

- [ ] **Step 6: Write the screen and its copy**

Add a `manageStatistics` namespace to `resources/js/lib/copy.ts` with, at minimum: `title`, the four total captions, the two chart headings, **a summary sentence template per chart** (AGENTS.md rule 8), the two ranked-list headings, the four period labels, and an empty state. Follow the file's header rule — its own keys, no reach into `copy.manage`.

Create `resources/js/pages/manage/statistics.tsx`. Requirements:
- Period selector as four links carrying `?period=`, current one marked.
- Four total cards. **Check each label sits above the value it names** — Phase 1d measured that swapping two dashboard stat cards' values leaves every gate green, so nothing catches this but reading it.
- Two charts as inline `<svg>`, bar or line only, **each with its text summary rendered above it**.
- Two ranked lists.
- Empty states for a shelf with no data — every array can be empty and `daily` will be for a brand-new shelf.

Add the nav entry to `resources/js/layouts/manage-layout.tsx` alongside the existing items, using `route("shelves.manage.statistics", { shelf: shelf.slug })`.

- [ ] **Step 7: Re-run, gates, commit**

```bash
make test FILTER=ManagerStatisticsScreenTest && make test
make analyse && make lint
git add -A
git commit -m "feat: the statistics screen — four totals, two charts, and a sentence above each"
```

---

## Slice B — QR labels

### Task 4: The payload codec, and the two new dependencies

**Files:**
- Modify: `composer.json` (add `bacon/bacon-qr-code`, `setasign/fpdf`)
- Create: `app/Support/Qr/LabelPayload.php`
- Test: `tests/Unit/Qr/LabelPayloadTest.php`

**Interfaces:**
- Produces: `LabelPayload::PREFIX` (`'OLB1:'`); `LabelPayload::encode(string $uuid): string`; `LabelPayload::uuidFrom(string $payload): ?string` returning `null` for anything it does not recognise.

**This class touches no database, no model and no framework** — it is pure string arithmetic, which is why it is unit-testable without a shelf. The reference makes the same split (`old_next/src/lib/qr.ts`'s own docblock: nothing there "touches the database, React or Node's filesystem"), and for the same reason: the browser-side scanner and the PDF writer must agree on one format, so that format lives in one place with no dependencies to drag along.

**The format is `OLB1:` + the UUID's sixteen raw bytes as base64url, unpadded — 22 characters, 27 bytes total.** Design doc D1 records that this was reopened (nothing is printed yet, so the original "protect the printed estate" argument does not apply) and re-closed on a new premise (the production domain is unsettled, and printing is what makes a hostname permanent). Do not re-litigate it in this task; D1 records what would reopen it.

- [ ] **Step 1: Add the dependencies**

```bash
docker compose -f docker-compose.laravel.yml exec -T app composer require bacon/bacon-qr-code setasign/fpdf
```

Then confirm what actually landed, because the plan must not assert a version it did not see:

```bash
docker compose -f docker-compose.laravel.yml exec -T app composer show bacon/bacon-qr-code setasign/fpdf | grep -E "^name|^versions"
```

**Check the extension question rather than assuming it.** `bacon/bacon-qr-code`'s PNG renderer needs `gd` or `imagick`; the module matrix needs neither, and this phase uses only the matrix. Confirm nothing in the install added a `ext-gd` requirement to `composer.json`'s `require` block. If it did, that is a finding for the review, not something to paper over — the production host is unverified and D4 chose this route specifically for extension-independence.

- [ ] **Step 2: Write the failing test**

Create `tests/Unit/Qr/LabelPayloadTest.php`:

```php
<?php

use App\Support\Qr\LabelPayload;
use Illuminate\Support\Str;

it('round-trips a uuid through the payload', function () {
    $uuid = (string) Str::uuid();

    expect(LabelPayload::uuidFrom(LabelPayload::encode($uuid)))->toBe($uuid);
});

it('encodes to the prefix plus exactly 22 unpadded base64url characters', function () {
    $payload = LabelPayload::encode('0191f1e3-0f7a-7c31-9b2e-6a4b1d2c3e4f');

    expect($payload)->toStartWith('OLB1:')
        ->and(strlen($payload))->toBe(27)
        ->and(substr($payload, 5))->toMatch('/^[A-Za-z0-9_-]{22}$/')
        ->and($payload)->not->toContain('=');
});

it('refuses a future format by name rather than decoding it into a wrong uuid', function () {
    // The whole reason the version prefix exists. An OLB2 payload must come
    // back as null, NOT as some uuid derived from bytes meant for another
    // format — a wrong copy is worse than an unreadable label.
    $olb1 = LabelPayload::encode('0191f1e3-0f7a-7c31-9b2e-6a4b1d2c3e4f');
    $olb2 = 'OLB2:'.substr($olb1, 5);

    expect(LabelPayload::uuidFrom($olb2))->toBeNull();
});

it('refuses rubbish, a bare uuid, an empty string and a truncated payload', function (string $input) {
    expect(LabelPayload::uuidFrom($input))->toBeNull();
})->with([
    'empty' => [''],
    'rubbish' => ['hello'],
    // A bare uuid is NOT a payload. Accepting one would mean a QR carrying
    // plain uuid text silently worked, and the format version would stop
    // being a guarantee.
    'bare uuid' => ['0191f1e3-0f7a-7c31-9b2e-6a4b1d2c3e4f'],
    'prefix only' => ['OLB1:'],
    'truncated body' => ['OLB1:njd5uYXrSmuisq41J9Tr'],
    'body with padding' => ['OLB1:njd5uYXrSmuisq41J9TrLw=='],
    'wrong alphabet' => ['OLB1:njd5uYXrSmuisq41J9Tr+w'],
]);

it('is case-sensitive about its prefix', function () {
    $olb1 = LabelPayload::encode('0191f1e3-0f7a-7c31-9b2e-6a4b1d2c3e4f');

    expect(LabelPayload::uuidFrom('olb1:'.substr($olb1, 5)))->toBeNull();
});
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `make test FILTER=LabelPayloadTest`
Expected: FAIL — `App\Support\Qr\LabelPayload` does not exist.

- [ ] **Step 4: Implement**

Create `app/Support/Qr/LabelPayload.php`. `encode()` strips the hyphens, `hex2bin`s to sixteen bytes, base64-encodes, translates `+/` to `-_` and rstrips `=`. `uuidFrom()` reverses it and must **validate before trusting**: check the exact prefix, check the body is exactly 22 characters of `[A-Za-z0-9_-]`, decode with strict base64, check sixteen bytes came back, and only then re-hyphenate. Anything else returns `null`.

Carry in the docblock: why the payload is the UUID and not the code (`DT-0142` is unique only within a shelf, and a sticker travels in a donated box of books); why base64url rather than the 36-character UUID text (**capacity buys error correction** — 27 bytes fits QR version 3 at ECC **Q**, where a quarter of the symbol may be damaged; 36 bytes does not fit Q's 32-byte ceiling and would force ECC M); and that `OLB1` is a format version, not decoration.

- [ ] **Step 5: Run the tests and make sure they pass**

Run: `make test FILTER=LabelPayloadTest`
Expected: PASS — 5 blocks, 11 cases (the dataset contributes 7).

- [ ] **Step 6: Gates, then commit**

```bash
make analyse && make lint
git add composer.json composer.lock app/Support/Qr/LabelPayload.php tests/Unit/Qr/LabelPayloadTest.php
git commit -m "feat: the OLB1 label payload, and the two dependencies the sheet needs"
```

---
### Task 5: `TitlesForLabelsQuery` — the selection accordion

**Files:**
- Create: `app/Queries/Labels/TitlesForLabelsQuery.php`
- Test: `tests/Feature/Labels/LabelQueriesTest.php`

**Interfaces:**
- Produces: `TitlesForLabelsQuery::run(bool $onlyUnprinted = false): array` shaped
  `list<array{bookId: string, title: string, copies: list<array{copyId: string, code: string, printCount: int}>}>`

**Grouping happens in the query, not on the page.** OPS §3.3, opened: *"Grouped in the query, not on the page, so the 'chưa in nhãn' filter can drop a title whose every copy is already printed rather than render a row that opens onto nothing."* That sentence is the requirement — a title all of whose copies are printed must **disappear** under the filter, not appear as an empty accordion row.

**What counts as selectable, read off the reference rather than guessed.** `old_next/src/domain/catalogue/queries/list-titles-for-labels.ts` lines 49–52 (opened) filter on `c.deleted_at is null` and `b.deleted_at is null` only, ordering `b.title, c.code`. **Retired copies are included**, and that is correct rather than an oversight: a retired copy is a physical object still on a shelf somewhere and may still want a sticker. Soft-deletion is the only exclusion, and in this port both `deleted_at` predicates come free from `SoftDeletes` global scopes — do not hand-write either.

**Eager-load the book; do not `join()` it.** `TenancyArchitectureTest`'s filter grep has a documented blind spot for "a join() condition naming the column" (`DonationQueueQuery`'s docblock records this and names the same trade). Two SELECTs instead of one statement is what staying out of that gap costs.

- [ ] **Step 1: Write the failing test**

Create `tests/Feature/Labels/LabelQueriesTest.php` (Tasks 6 and 7 add blocks to this same file):

```php
<?php

use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\User;
use App\Queries\Labels\TitlesForLabelsQuery;
use App\Support\TenantContext;

/**
 * Grep first: `grep -rn "^function lblFix" tests/`.
 *
 * @return array{Bookshelf, User}
 */
function lblFix(string $slug = 'dong-thap-lbl'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);
    $manager = User::factory()->create(['full_name' => 'Maria Nguyễn Lan']);
    $membership = Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);
    app(TenantContext::class)->set($shelf, $membership);
    test()->actingAs($manager);

    return [$shelf, $manager];
}

it('groups copies under their title, ordered by title then code', function () {
    [$shelf] = lblFix();

    $de = Book::factory()->for($shelf)->create(['title' => 'Dế Mèn Phiêu Lưu Ký']);
    $an = Book::factory()->for($shelf)->create(['title' => 'Aó Dài']);
    BookCopy::factory()->for($shelf)->for($de)->create(['code' => 'DT-0002']);
    BookCopy::factory()->for($shelf)->for($de)->create(['code' => 'DT-0001']);
    BookCopy::factory()->for($shelf)->for($an)->create(['code' => 'DT-0003']);

    $rows = app(TitlesForLabelsQuery::class)->run();

    expect(collect($rows)->pluck('title')->all())->toBe(['Aó Dài', 'Dế Mèn Phiêu Lưu Ký'])
        ->and(collect($rows)->firstWhere('title', 'Dế Mèn Phiêu Lưu Ký')['copies'])
        ->toHaveCount(2);
});

it('copies within a title are ordered by code', function () {
    [$shelf] = lblFix();

    $book = Book::factory()->for($shelf)->create(['title' => 'Dế Mèn Phiêu Lưu Ký']);
    BookCopy::factory()->for($shelf)->for($book)->create(['code' => 'DT-0002']);
    BookCopy::factory()->for($shelf)->for($book)->create(['code' => 'DT-0001']);

    $codes = collect(app(TitlesForLabelsQuery::class)->run()[0]['copies'])->pluck('code')->all();

    expect($codes)->toBe(['DT-0001', 'DT-0002']);
});

it('onlyUnprinted DROPS a title whose every copy is printed, rather than showing an empty row', function () {
    // This is OPS §3.3's stated reason for grouping in the query. A title
    // that survives with copies: [] is the exact failure it names.
    [$shelf] = lblFix();

    $allPrinted = Book::factory()->for($shelf)->create(['title' => 'Aó Dài']);
    BookCopy::factory()->for($shelf)->for($allPrinted)->create(['code' => 'DT-0001', 'qr_print_count' => 1]);
    BookCopy::factory()->for($shelf)->for($allPrinted)->create(['code' => 'DT-0002', 'qr_print_count' => 3]);

    $partly = Book::factory()->for($shelf)->create(['title' => 'Dế Mèn Phiêu Lưu Ký']);
    BookCopy::factory()->for($shelf)->for($partly)->create(['code' => 'DT-0003', 'qr_print_count' => 2]);
    BookCopy::factory()->for($shelf)->for($partly)->create(['code' => 'DT-0004', 'qr_print_count' => 0]);

    $rows = app(TitlesForLabelsQuery::class)->run(onlyUnprinted: true);

    expect(collect($rows)->pluck('title')->all())->toBe(['Dế Mèn Phiêu Lưu Ký'])
        ->and($rows[0]['copies'])->toHaveCount(1)
        ->and($rows[0]['copies'][0]['code'])->toBe('DT-0004');
});

it('a retired copy is still selectable — a retired book is still a physical object', function () {
    [$shelf] = lblFix();

    $book = Book::factory()->for($shelf)->create(['title' => 'Aó Dài']);
    BookCopy::factory()->for($shelf)->for($book)->create(['code' => 'DT-0001', 'state' => 'retired']);

    expect(app(TitlesForLabelsQuery::class)->run()[0]['copies'])->toHaveCount(1);
});

it('a soft-deleted copy is not selectable, and a soft-deleted book takes its copies with it', function () {
    [$shelf] = lblFix();

    $book = Book::factory()->for($shelf)->create(['title' => 'Aó Dài']);
    $gone = BookCopy::factory()->for($shelf)->for($book)->create(['code' => 'DT-0001']);
    BookCopy::factory()->for($shelf)->for($book)->create(['code' => 'DT-0002']);
    $gone->delete();

    expect(app(TitlesForLabelsQuery::class)->run()[0]['copies'])->toHaveCount(1);

    $book->delete();

    expect(app(TitlesForLabelsQuery::class)->run())->toBe([]);
});

it('another shelf\'s titles are invisible', function () {
    [$shelf] = lblFix();
    $book = Book::factory()->for($shelf)->create(['title' => 'Aó Dài']);
    BookCopy::factory()->for($shelf)->for($book)->create(['code' => 'DT-0001']);

    app(TenantContext::class)->actSystemWide();
    $other = Bookshelf::factory()->create(['slug' => 'other-lbl', 'settings' => []]);
    $otherBook = Book::factory()->for($other)->create(['title' => 'Zzz']);
    BookCopy::factory()->for($other)->for($otherBook)->create(['code' => 'DT-0001']);

    app(TenantContext::class)->set($shelf, Membership::query()
        ->where('bookshelf_id', $shelf->id)->firstOrFail());

    expect(app(TitlesForLabelsQuery::class)->run())->toHaveCount(1);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `make test FILTER=LabelQueriesTest`
Expected: FAIL — `App\Queries\Labels\TitlesForLabelsQuery` does not exist.

- [ ] **Step 3: Implement, then run**

Create the query. One `BookCopy::query()->with('book')` read ordered by the book's title then `code`, grouped in PHP, with empty titles dropped when `$onlyUnprinted` is true. Order **by the same collation the database uses** — do not re-sort in PHP on `strcmp`, which would put `Aó` and `Dế` in a different order than MariaDB's `utf8mb4_unicode_ci` does and make the first block's expectation depend on which layer sorted.

Run: `make test FILTER=LabelQueriesTest`
Expected: PASS, 6 blocks.

- [ ] **Step 4: Gates, then commit**

```bash
make analyse && make lint
git add app/Queries/Labels/TitlesForLabelsQuery.php tests/Feature/Labels/LabelQueriesTest.php
git commit -m "feat: the label selection accordion, grouped where the filter can drop an empty title"
```

---

### Task 6: `CopiesForLabelsQuery` — the union

**Files:**
- Create: `app/Queries/Labels/CopiesForLabelsQuery.php`
- Modify: `tests/Feature/Labels/LabelQueriesTest.php`

**Interfaces:**
- Consumes: nothing from Task 5 (both read `BookCopy` independently).
- Produces: `CopiesForLabelsQuery::run(array $bookIds, array $copyIds, bool $onlyUnprinted = false): array` shaped
  `list<array{copyId: string, code: string, title: string, printCount: int}>`, ordered by `code`.

**`bookIds` and `copyIds` are a UNION, not alternatives.** OPS §3.3, opened: *"so a manager may tick a whole title and individual copies of another; expansion happens here, not in the browser, where the answer would be whatever the page was rendered with."* A copy reachable through both must appear **once**. An empty selection returns `[]` — the refusal for that case belongs to `MarkCopiesPrinted` (Task 8), not here; a query that refuses is not a query.

- [ ] **Step 1: Write the failing test**

Append to `tests/Feature/Labels/LabelQueriesTest.php`:

```php
it('unions bookIds with copyIds and never repeats a copy reachable through both', function () {
    [$shelf] = lblFix();

    $de = Book::factory()->for($shelf)->create(['title' => 'Dế Mèn Phiêu Lưu Ký']);
    $a = BookCopy::factory()->for($shelf)->for($de)->create(['code' => 'DT-0001']);
    BookCopy::factory()->for($shelf)->for($de)->create(['code' => 'DT-0002']);

    $ao = Book::factory()->for($shelf)->create(['title' => 'Aó Dài']);
    $c = BookCopy::factory()->for($shelf)->for($ao)->create(['code' => 'DT-0003']);

    // The whole of Dế Mèn, plus one copy of Aó Dài, plus a copy of Dế Mèn
    // that the bookId already covers — the overlap is the point.
    $rows = app(CopiesForLabelsQuery::class)->run([$de->id], [$c->id, $a->id]);

    expect(collect($rows)->pluck('code')->all())->toBe(['DT-0001', 'DT-0002', 'DT-0003']);
});

it('an empty selection returns nothing and does not read the whole shelf', function () {
    [$shelf] = lblFix();
    $book = Book::factory()->for($shelf)->create(['title' => 'Aó Dài']);
    BookCopy::factory()->for($shelf)->for($book)->create(['code' => 'DT-0001']);

    expect(app(CopiesForLabelsQuery::class)->run([], []))->toBe([]);
});

it('onlyUnprinted narrows the union', function () {
    [$shelf] = lblFix();

    $book = Book::factory()->for($shelf)->create(['title' => 'Aó Dài']);
    BookCopy::factory()->for($shelf)->for($book)->create(['code' => 'DT-0001', 'qr_print_count' => 2]);
    BookCopy::factory()->for($shelf)->for($book)->create(['code' => 'DT-0002', 'qr_print_count' => 0]);

    $rows = app(CopiesForLabelsQuery::class)->run([$book->id], [], onlyUnprinted: true);

    expect(collect($rows)->pluck('code')->all())->toBe(['DT-0002']);
});

it('another shelf\'s ids expand to nothing rather than to its copies', function () {
    // The load-bearing tenancy block for this query: ids arrive from a FORM,
    // so a hand-made POST naming shelf B's book id must not print shelf B's
    // labels onto shelf A's sheet.
    [$shelf] = lblFix();

    app(TenantContext::class)->actSystemWide();
    $other = Bookshelf::factory()->create(['slug' => 'other-union', 'settings' => []]);
    $otherBook = Book::factory()->for($other)->create(['title' => 'Zzz']);
    $otherCopy = BookCopy::factory()->for($other)->for($otherBook)->create(['code' => 'ZZ-0001']);

    app(TenantContext::class)->set($shelf, Membership::query()
        ->where('bookshelf_id', $shelf->id)->firstOrFail());

    expect(app(CopiesForLabelsQuery::class)->run([$otherBook->id], [$otherCopy->id]))->toBe([]);
});
```

Add `use App\Queries\Labels\CopiesForLabelsQuery;` to the file's imports.

- [ ] **Step 2: Run it to make sure it fails**

Run: `make test FILTER=LabelQueriesTest`
Expected: FAIL on the four new blocks; the six from Task 5 stay green.

- [ ] **Step 3: Implement, then run**

One `BookCopy::query()->with('book')` with a grouped `where(fn ($q) => $q->whereIn('book_id', $bookIds)->orWhereIn('id', $copyIds))`. **The nesting matters**: an ungrouped `orWhereIn` next to the `onlyUnprinted` condition changes the boolean precedence and quietly returns printed copies. Return `[]` early when both arrays are empty rather than issuing a query with a false predicate.

Run: `make test FILTER=LabelQueriesTest`
Expected: PASS, 10 blocks.

- [ ] **Step 4: Prove the grouping matters**

```
remove the closure nesting, leaving ->whereIn(...)->orWhereIn(...) flat
make test FILTER=LabelQueriesTest   → expect 'onlyUnprinted narrows the union' RED
restore
git status --porcelain              → must be empty
```

- [ ] **Step 5: Gates, then commit**

```bash
make analyse && make lint
git add app/Queries/Labels/CopiesForLabelsQuery.php tests/Feature/Labels/LabelQueriesTest.php
git commit -m "feat: the label union, expanded on the server where the answer is the database's"
```

---

### Task 7: `CopyByIdQuery` — a scan back to a copy

**Files:**
- Create: `app/Queries/Labels/CopyByIdQuery.php`
- Modify: `tests/Feature/Labels/LabelQueriesTest.php`

**Interfaces:**
- Produces: `CopyByIdQuery::run(string $copyId): ?array` shaped
  `array{copyId: string, code: string, state: string, bookId: string, slug: string, title: string, author: string}` or `null`.

**It takes the copy's UUID, never the printed payload.** OPS §3.3, opened: *"Takes the copy's **UUID**, never the printed payload — decoding lives outside the domain, so the label format can change without a query changing."* `LabelPayload::uuidFrom()` (Task 4) is the decoder, and it is the caller's job.

**Deliberately NOT manager-only.** OPS §3.3 again: *"a reader scans a book on the shelf to ask for it (§16.1), and RLS is what keeps another parish's sticker unresolvable."* In this port, `BookshelfScope` is what RLS was — tenancy, not role, is what makes a foreign sticker resolve to nothing. Return `null` rather than throwing: a scan that finds nothing is an ordinary outcome, not an exception.

- [ ] **Step 1: Write the failing test**

Append to `tests/Feature/Labels/LabelQueriesTest.php` (add `use App\Queries\Labels\CopyByIdQuery;`):

```php
it('resolves a copy on this shelf to its book', function () {
    [$shelf] = lblFix();
    $book = Book::factory()->for($shelf)->create(['title' => 'Dế Mèn Phiêu Lưu Ký', 'author' => 'Tô Hoài']);
    $copy = BookCopy::factory()->for($shelf)->for($book)->create(['code' => 'DT-0001']);

    $row = app(CopyByIdQuery::class)->run($copy->id);

    expect($row)->not->toBeNull()
        ->and($row['code'])->toBe('DT-0001')
        ->and($row['title'])->toBe('Dế Mèn Phiêu Lưu Ký')
        ->and($row['bookId'])->toBe($book->id);
});

it('another parish\'s sticker resolves to nothing — tenancy, not role', function () {
    // The sticker is a physical object that travels in a donated box of
    // books. Scanning shelf B's label while bound to shelf A must answer
    // nothing rather than shelf B's copy.
    [$shelf] = lblFix();

    app(TenantContext::class)->actSystemWide();
    $other = Bookshelf::factory()->create(['slug' => 'other-scan', 'settings' => []]);
    $otherBook = Book::factory()->for($other)->create(['title' => 'Zzz']);
    $otherCopy = BookCopy::factory()->for($other)->for($otherBook)->create(['code' => 'ZZ-0001']);

    app(TenantContext::class)->set($shelf, Membership::query()
        ->where('bookshelf_id', $shelf->id)->firstOrFail());

    expect(app(CopyByIdQuery::class)->run($otherCopy->id))->toBeNull();
});

it('an unknown id, and a soft-deleted copy, both answer null rather than throwing', function () {
    [$shelf] = lblFix();
    $book = Book::factory()->for($shelf)->create(['title' => 'Aó Dài']);
    $copy = BookCopy::factory()->for($shelf)->for($book)->create(['code' => 'DT-0001']);
    $copy->delete();

    expect(app(CopyByIdQuery::class)->run($copy->id))->toBeNull()
        ->and(app(CopyByIdQuery::class)->run('0191f1e3-0f7a-7c31-9b2e-6a4b1d2c3e4f'))->toBeNull();
});

it('a malformed id answers null rather than raising a database error', function () {
    // The scanner hands this whatever came off the camera. `id` is
    // VARCHAR(36) ascii_bin in this schema, so a non-uuid string is a
    // perfectly legal comparison that matches nothing — but assert it,
    // because a future uuid-typed column would turn this into a 500.
    lblFix();

    expect(app(CopyByIdQuery::class)->run('not-a-uuid'))->toBeNull();
});
```

- [ ] **Step 2: Run it to make sure it fails, implement, and run again**

Run: `make test FILTER=LabelQueriesTest` — expect the four new blocks red, then implement (one `BookCopy::query()->with('book')->find($copyId)` mapped to the array, `null` when not found), then re-run and expect 14 blocks green.

- [ ] **Step 3: Gates, then commit**

```bash
make analyse && make lint
git add app/Queries/Labels/CopyByIdQuery.php tests/Feature/Labels/LabelQueriesTest.php
git commit -m "feat: a scanned label back to a copy, refused across shelves by tenancy"
```

---
### Task 8: `MarkCopiesPrinted`

**Files:**
- Create: `app/Actions/Catalogue/MarkCopiesPrinted.php`
- Modify: `app/Support/Audit/AuditSentences.php`, `lang/vi/audit.php`, `lang/vi/rules.php`
- Test: `tests/Feature/Labels/MarkCopiesPrintedTest.php`

**Interfaces:**
- Consumes: `App\Support\AuditRecorder`, `App\Support\Clock`, `App\Support\ConcurrencyRetry`.
- Produces: `MarkCopiesPrinted::execute(User $actor, array $copyIds): array{count: int}`.
- New audit action `copy.qr_printed` in group `books`; new lang keys `audit.copy_qr_printed`, `rules.copy_selection_empty`.

**It INCREMENTS, it does not set.** OPS §4.1, opened: *"Stamps `qr_printed_at` and **increments** `qr_print_count` — the count exists precisely so a reprint, after a sticker falls off, stays distinguishable from a first print, which a single boolean or a timestamp read as one cannot do."* An implementation that writes `qr_print_count = 1` passes a naive test and destroys the only thing the column is for.

**One audit entry for the batch, naming the count.** OPS §4.1: *"one entry for the batch, deliberately unlike `AddCopies` above. §5.4's 'the record affected is singular per entry' is about copies coming into existence separately; a print run is one volunteer at one printer in one moment, and four hundred rows saying so would bury the log §14 exists to keep readable."* `AuditRecorder::record()`'s `$entityId` is `?string` (verified in its signature), so the batch entry passes `null` there and carries the count in `$after`.

- [ ] **Step 1: Write the failing test**

Create `tests/Feature/Labels/MarkCopiesPrintedTest.php`:

```php
<?php

use App\Actions\Catalogue\MarkCopiesPrinted;
use App\Exceptions\RuleViolated;
use App\Models\AuditLog;
use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;

/**
 * Grep first: `grep -rn "^function mcpFix" tests/`.
 *
 * @return array{Bookshelf, User, Book}
 */
function mcpFix(string $slug = 'dong-thap-mcp'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);
    $manager = User::factory()->create(['full_name' => 'Maria Nguyễn Lan']);
    $membership = Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);
    app(TenantContext::class)->set($shelf, $membership);
    test()->actingAs($manager);

    return [$shelf, $manager, Book::factory()->for($shelf)->create(['title' => 'Dế Mèn Phiêu Lưu Ký'])];
}

it('increments the print count rather than setting it', function () {
    // The block the column exists for. An implementation writing
    // `qr_print_count => 1` passes every other block in this file.
    [, $manager, $book] = mcpFix();
    $shelf = $book->bookshelf;
    $copy = BookCopy::factory()->for($shelf)->for($book)->create(['code' => 'DT-0001', 'qr_print_count' => 2]);

    app(MarkCopiesPrinted::class)->execute($manager, [$copy->id]);

    expect($copy->fresh()->qr_print_count)->toBe(3);
});

it('stamps qr_printed_at with the clock', function () {
    [, $manager, $book] = mcpFix();
    $copy = BookCopy::factory()->for($book->bookshelf)->for($book)->create(['code' => 'DT-0001']);

    expect($copy->qr_printed_at)->toBeNull();

    app(MarkCopiesPrinted::class)->execute($manager, [$copy->id]);

    expect($copy->fresh()->qr_printed_at)->not->toBeNull();
});

it('an empty selection is refused by name', function () {
    [, $manager] = mcpFix();

    expect(fn () => app(MarkCopiesPrinted::class)->execute($manager, []))
        ->toThrow(RuleViolated::class, 'copy_selection_empty');
});

it('writes ONE audit entry for the batch, naming the count', function () {
    [, $manager, $book] = mcpFix();
    $shelf = $book->bookshelf;
    $ids = collect(['DT-0001', 'DT-0002', 'DT-0003'])
        ->map(fn (string $code) => BookCopy::factory()->for($shelf)->for($book)->create(['code' => $code])->id)
        ->all();

    app(MarkCopiesPrinted::class)->execute($manager, $ids);

    $entries = AuditLog::query()->where('action', 'copy.qr_printed')->get();

    expect($entries)->toHaveCount(1)
        ->and($entries->first()->after['count'])->toBe(3);
});

it('another shelf\'s copy is not printed and not counted', function () {
    [, $manager, $book] = mcpFix();
    $mine = BookCopy::factory()->for($book->bookshelf)->for($book)->create(['code' => 'DT-0001']);

    app(TenantContext::class)->actSystemWide();
    $other = Bookshelf::factory()->create(['slug' => 'other-mcp', 'settings' => []]);
    $otherBook = Book::factory()->for($other)->create();
    $otherCopy = BookCopy::factory()->for($other)->for($otherBook)->create(['code' => 'ZZ-0001']);

    app(TenantContext::class)->set($book->bookshelf, Membership::query()
        ->where('bookshelf_id', $book->bookshelf->id)->firstOrFail());

    $result = app(MarkCopiesPrinted::class)->execute($manager, [$mine->id, $otherCopy->id]);

    expect($result['count'])->toBe(1)
        ->and($otherCopy->fresh()->qr_print_count)->toBe(0)
        ->and($mine->fresh()->qr_print_count)->toBe(1);
});

it('a selection of only foreign ids is refused as empty rather than silently succeeding', function () {
    // The interesting consequence of the block above: after scoping, the
    // set can be empty even though the caller named ids. Refusing is right —
    // a sheet was not printed, so nothing should be stamped, and the manager
    // should be told rather than shown a success flash for zero labels.
    [, $manager, $book] = mcpFix();

    app(TenantContext::class)->actSystemWide();
    $other = Bookshelf::factory()->create(['slug' => 'other-mcp2', 'settings' => []]);
    $otherBook = Book::factory()->for($other)->create();
    $otherCopy = BookCopy::factory()->for($other)->for($otherBook)->create(['code' => 'ZZ-0001']);

    app(TenantContext::class)->set($book->bookshelf, Membership::query()
        ->where('bookshelf_id', $book->bookshelf->id)->firstOrFail());

    expect(fn () => app(MarkCopiesPrinted::class)->execute($manager, [$otherCopy->id]))
        ->toThrow(RuleViolated::class, 'copy_selection_empty');
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `make test FILTER=MarkCopiesPrintedTest`
Expected: FAIL — the Action does not exist.

- [ ] **Step 3: Add the audit action and the two sentences**

In `app/Support/Audit/AuditSentences.php`, add `'copy.qr_printed' => 'books',` to `ACTIONS` beside the other `copy.*` entries. `GROUPS` already contains `books`; do not add a group.

In `lang/vi/audit.php`, beside the other `copy_*` keys:

```php
    'copy_qr_printed' => 'in nhãn QR cho :count bản sách',
```

In `lang/vi/rules.php`:

```php
    // OPS §4.4's copy_selection_empty, quoted from that entry.
    'copy_selection_empty' => 'Bạn chưa chọn bản sách nào để in nhãn.',
```

**Then check the census still passes and that your sentence is actually covered.** `known-gaps.md` records that seventeen inherited audit sentences have no test behind them and that `AuditSentencesTest`'s census cannot see a wrong sentence — only its per-action wording blocks can. **Add a wording block for `copy.qr_printed`** so this phase does not add an eighteenth hole. Phase 2b's nineteen community keys all have one; match that.

- [ ] **Step 4: Write the Action, then run**

`DB::transaction(..., ConcurrencyRetry::ATTEMPTS)`, Gate authorization against the existing copy/catalogue policy, scoped `BookCopy::query()->whereIn('id', $copyIds)` (tenancy from the scope, **no `bookshelf_id` predicate**), refuse `copy_selection_empty` when the input is empty **or** when scoping leaves it empty, increment with `->increment('qr_print_count')` or an explicit `qr_print_count + 1` update, stamp `qr_printed_at` from the injected `Clock`, and record one audit entry.

Run: `make test FILTER=MarkCopiesPrintedTest`
Expected: PASS, 6 blocks.

- [ ] **Step 5: Prove the increment block discriminates**

```
change the write to `qr_print_count => 1`
make test FILTER=MarkCopiesPrintedTest  → 'increments … rather than setting it' RED, others green
restore; git status --porcelain          → empty
```

- [ ] **Step 6: Gates, then commit**

```bash
make analyse && make lint
git add -A
git commit -m "feat: MarkCopiesPrinted — one audit row for the batch, and a count that increments"
```

---

### Task 9: The label sheet

**Files:**
- Create: `app/Support/Qr/LabelSheet.php`
- Create: `resources/fonts/Lexend-Regular.ttf`, `resources/fonts/Lexend-SemiBold.ttf` (copied **out of** `old_next/src/lib/fonts/` — read from there, never write to it)
- Test: `tests/Feature/Labels/LabelSheetTest.php`

**Interfaces:**
- Consumes: `LabelPayload::encode()` (Task 4).
- Produces: `LabelSheet::render(array $rows): string` returning raw PDF bytes, where each row is `array{copyId: string, code: string, title: string}` — the shape `CopiesForLabelsQuery::run()` returns, minus `printCount`.

**Geometry is inherited verbatim and is not a free parameter.** 186 × 255.4mm safe area, 3 columns × 7 rows, 21 per page, 58 × 34mm labels. A4 is 210 × 297mm; US Letter is 215.9 × 279.4mm — **wider but 17.6mm shorter**. A sheet that must print correctly on either has 210 × 279.4mm to work with, and 12mm of margin leaves the box above. Portability costs a row: 21 per page rather than the 24 a Letter-blind layout would fit, so a 400-copy shelf is 20 pages instead of 17. That is the whole trade, and it is already made. The 2026-08-13 design also records that Avery L7159 pre-cut stock was measured and rejected, because its perforations sit outside the shared box and perforations do not move.

**The QR is drawn as vectors, from the module matrix.** Not as an embedded raster. `bacon/bacon-qr-code` gives the matrix without needing `gd` or `imagick`; only its PNG renderer needs those, and the production host is unverified. Use ECC **Q** — the payload is 27 bytes, which fits QR version 3 at Q's 32-byte ceiling, and Q means a quarter of the symbol may be scuffed, torn or jam-smeared and still decode. That is the correct budget for a label on a book a seven-year-old carries home in the rain.

**The human-readable code prints under every QR and is never decorative.** A cracked lens, a denied camera permission, a flat battery and a borrowed phone are all ordinary.

- [ ] **Step 1: Copy the fonts out of the reference**

```bash
mkdir -p resources/fonts
cp old_next/src/lib/fonts/Lexend-Regular.ttf resources/fonts/
cp old_next/src/lib/fonts/Lexend-SemiBold.ttf resources/fonts/
git status --porcelain old_next/   # MUST be empty — old_next is read-only
```

- [ ] **Step 2: Write the failing test**

Create `tests/Feature/Labels/LabelSheetTest.php`:

```php
<?php

use App\Support\Qr\LabelSheet;

/** Three rows with a title that exercises stacked Vietnamese diacritics. */
function sheetRows(int $n = 3): array
{
    return collect(range(1, $n))->map(fn (int $i) => [
        'copyId' => sprintf('0191f1e3-0f7a-7c31-9b2e-6a4b1d2c3e%02d', $i),
        'code' => sprintf('DT-%04d', $i),
        'title' => 'Dế Mèn Phiêu Lưu Ký',
    ])->all();
}

it('produces bytes that are a PDF', function () {
    expect(app(LabelSheet::class)->render(sheetRows()))->toStartWith('%PDF-');
});

it('THE DIACRITIC TEST — the title survives into the document text', function () {
    // The failure this exists for is not a crash. A font subset that drops
    // the stacked marks in "Dế Mèn Phiêu Lưu Ký" still produces a
    // structurally valid PDF; the defect is discovered on paper already
    // glued to books. So assert on extracted text, not on validity.
    //
    // If no text extractor is available in the container, the fallback is
    // to assert the glyphs appear in the embedded font subset — but say so
    // in the docblock rather than silently weakening the block.
    $pdf = app(LabelSheet::class)->render(sheetRows(1));

    expect(extractedText($pdf))->toContain('Dế Mèn Phiêu Lưu Ký')
        ->and(extractedText($pdf))->toContain('DT-0001');
});

it('lays 21 labels to a page and starts a 22nd on page two', function () {
    $one = app(LabelSheet::class)->render(sheetRows(21));
    $two = app(LabelSheet::class)->render(sheetRows(22));

    expect(pageCount($one))->toBe(1)->and(pageCount($two))->toBe(2);
});

it('an empty set still produces a valid single-page document rather than throwing', function () {
    // LabelSheet is a renderer, not a guard. The refusal for an empty
    // selection is MarkCopiesPrinted's (copy_selection_empty); a renderer
    // that also refuses would give the same rule two homes.
    expect(app(LabelSheet::class)->render([]))->toStartWith('%PDF-');
});
```

**Write `extractedText()` and `pageCount()` as helpers in this file** (grep first: `grep -rn "^function extractedText" tests/`). For page count, counting `/Type /Page` occurrences in the raw bytes is adequate and dependency-free. For text extraction, try `smalot/pdfparser` as a **dev** dependency:

```bash
docker compose -f docker-compose.laravel.yml exec -T app composer require --dev smalot/pdfparser
```

If it cannot extract text from FPDF's output, **say so in the block's docblock and fall back** to asserting the diacritic glyphs are present in the embedded subset — do not delete the block, and do not claim it tests something it does not.

- [ ] **Step 3: Run it to make sure it fails, implement, run again**

Run: `make test FILTER=LabelSheetTest` — expect red, implement `LabelSheet`, re-run and expect 4 blocks green.

The implementation: extend or wrap FPDF with `mm` units and A4 pages; add the Lexend TTF via FPDF's Unicode font support; for each row compute its cell from the grid; draw the QR modules as filled `Rect`s; print the code beneath in the regular face; truncate the title to the label width rather than letting it overflow into its neighbour.

- [ ] **Step 4: Print one real sheet before the phase closes**

Not a test step and not automatable — a note carried to the wrap-up task. The geometry claim is about physical paper, and nobody has put this file through a printer.

- [ ] **Step 5: Gates, then commit**

```bash
make analyse && make lint
git add -A
git commit -m "feat: the label sheet — 21 to a page inside the box A4 and Letter share"
```

---
### Task 10: The label routes and the export

**Files:**
- Create: `app/Http/Controllers/Manage/LabelController.php`, `app/Http/Requests/Labels/ExportLabelSheetRequest.php`
- Modify: `routes/web.php`
- Test: `tests/Feature/Labels/LabelExportTest.php`

**Interfaces:**
- Consumes: `TitlesForLabelsQuery` (5), `CopiesForLabelsQuery` (6), `MarkCopiesPrinted` (8), `LabelSheet` (9).
- Produces: routes `shelves.manage.labels` (GET) and `shelves.manage.labels.export` (POST); Inertia page `manage/labels` with props `{ titles, onlyUnprinted }`.

**The bytes come first, and the stamp second.** OPS §3.3, opened: `ExportLabelSheetPDF` *"Writes `MarkCopiesPrinted` (§4.1) only once the bytes exist."* So the order in the controller is: expand the selection → render the PDF → `MarkCopiesPrinted` → return the download. Rendering first means a renderer that throws leaves no copy stamped as printed, which is the right way round: a manager who sees an error and retries must not have their second sheet counted as a reprint of a sheet that never existed.

**This POST carries a body, so it gets a Form Request** — and therefore a second 404 producer via `abort_unless(Gate::allows(...), 404)` in `authorize()`, matching the five body-carrying community POSTs. (Phase 2a ruled that a **bodiless** POST does not acquire a Form Request solely to hold an `abort_unless`; this one has fields, so the ruling does not apply.)

- [ ] **Step 1: Write the failing test**

Create `tests/Feature/Labels/LabelExportTest.php`:

```php
<?php

use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Inertia\Testing\AssertableInertia;

/**
 * Grep first: `grep -rn "^function lblExpFix" tests/`.
 *
 * @return array{Bookshelf, User, Book, BookCopy}
 */
function lblExpFix(string $slug = 'dong-thap-lblexp'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);
    $manager = User::factory()->create(['full_name' => 'Maria Nguyễn Lan']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);
    $book = Book::factory()->for($shelf)->create(['title' => 'Dế Mèn Phiêu Lưu Ký']);
    $copy = BookCopy::factory()->for($shelf)->for($book)->create(['code' => 'DT-0001']);

    return [$shelf, $manager, $book, $copy];
}

it('renders the selection screen with its titles', function () {
    [$shelf, $manager] = lblExpFix();

    $this->actingAs($manager)
        ->get("/tu-sach/{$shelf->slug}/quan-ly/ma-qr")
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('manage/labels')
            ->has('titles', 1)
            ->where('onlyUnprinted', false));
});

it('exporting returns a PDF and stamps the copies', function () {
    [$shelf, $manager, , $copy] = lblExpFix();

    $response = $this->actingAs($manager)
        ->post("/tu-sach/{$shelf->slug}/quan-ly/ma-qr/xuat", ['copyIds' => [$copy->id]]);

    $response->assertOk();
    expect($response->headers->get('content-type'))->toContain('application/pdf')
        ->and($copy->fresh()->qr_print_count)->toBe(1)
        ->and($copy->fresh()->qr_printed_at)->not->toBeNull();
});

it('an empty selection is refused as a rule, not a 500', function () {
    [$shelf, $manager] = lblExpFix();

    $this->actingAs($manager)
        ->post("/tu-sach/{$shelf->slug}/quan-ly/ma-qr/xuat", ['copyIds' => [], 'bookIds' => []])
        ->assertRedirect();

    // bootstrap/app.php renders RuleViolated as back()->withErrors(['rule' => …]).
    $this->assertTrue(session()->hasOldInput() || session()->has('errors'));
});

it('another shelf\'s copy id stamps nothing', function () {
    [$shelf, $manager] = lblExpFix();

    app(TenantContext::class)->actSystemWide();
    $other = Bookshelf::factory()->create(['slug' => 'other-lblexp', 'settings' => []]);
    $otherBook = Book::factory()->for($other)->create();
    $otherCopy = BookCopy::factory()->for($other)->for($otherBook)->create(['code' => 'ZZ-0001']);

    $this->actingAs($manager)
        ->post("/tu-sach/{$shelf->slug}/quan-ly/ma-qr/xuat", ['copyIds' => [$otherCopy->id]]);

    expect($otherCopy->fresh()->qr_print_count)->toBe(0);
});

it('a reader meets 404 on both the screen and the export', function () {
    [$shelf, , , $copy] = lblExpFix();
    $reader = User::factory()->create();
    Membership::factory()->for($shelf)->create([
        'user_id' => $reader->id, 'role' => 'reader', 'status' => 'active',
    ]);

    // NOT a vacuous 404 pair: both URIs are claimed by the routes added in
    // this task, so these assert EnsureShelfRole's refusal rather than the
    // router's absence. Re-check after the routes land.
    $this->actingAs($reader)->get("/tu-sach/{$shelf->slug}/quan-ly/ma-qr")->assertNotFound();
    $this->actingAs($reader)
        ->post("/tu-sach/{$shelf->slug}/quan-ly/ma-qr/xuat", ['copyIds' => [$copy->id]])
        ->assertNotFound();
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `make test FILTER=LabelExportTest`
Expected: FAIL — no route claims either URI.

- [ ] **Step 3: Add the routes**

In `routes/web.php`'s `manage` group, **declare the literal segment before any parameterised sibling** — `CommunityArchitectureTest` pins that habit for two other route families and it is the same trap here:

```php
        // BR §19's "QR labels per copy", shipped in the reference on
        // 2026-08-13 and specified at docs/superpowers/specs/2026-08-13-qr-labels-design.md.
        // OPS §3.3's ListTitlesForLabels and ExportLabelSheetPDF.
        Route::get('/ma-qr', [LabelController::class, 'index'])->name('labels');
        Route::post('/ma-qr/xuat', [LabelController::class, 'export'])->name('labels.export');
```

- [ ] **Step 4: Write the Form Request and the controller**

`ExportLabelSheetRequest`: `authorize()` holds `abort_unless(Gate::allows('act-as-manager'), 404)`; rules allow `bookIds` and `copyIds` as optional arrays of uuid strings. Neither is `required` — the union may come from either, and the empty case is `MarkCopiesPrinted`'s refusal, not a field error.

`LabelController::index()` renders `manage/labels` with `titles` and the `onlyUnprinted` flag read from the query string. `LabelController::export()` expands via `CopiesForLabelsQuery`, renders via `LabelSheet`, calls `MarkCopiesPrinted` with the **expanded** copy ids, and returns the bytes as a download. Do not catch `RuleViolated` — `bootstrap/app.php` renders it once for the whole app.

- [ ] **Step 5: Run, gates, commit**

```bash
make test FILTER=LabelExportTest && make test
make analyse && make lint
git add -A
git commit -m "feat: the label export — bytes first, then the stamp"
```

---

### Task 11: The selection screen

**Files:**
- Create: `resources/js/pages/manage/labels.tsx`
- Modify: `resources/js/lib/copy.ts`, `resources/js/layouts/manage-layout.tsx`
- Test: extend `tests/Feature/Labels/LabelExportTest.php` with prop assertions only

**Interfaces:**
- Consumes: props `{ titles, onlyUnprinted }` from Task 10.

An accordion of titles, each expanding to its copies with a checkbox per copy and a "select the whole title" control; a *chưa in nhãn* filter toggling `?onlyUnprinted=1`; a print count shown per copy so a reprint is visible as one; and a submit that posts the union to `labels.export`.

**Remember what this repo cannot check.** There are no frontend tests, so the *only* verifiable part is the props. Assert those; then read the component yourself for the label/value pairing and the flash, because nothing else will. In particular: the success path here is a **file download**, not a redirect with a flash — so do not write a flash the screen never shows. Phase 2b shipped six such flashes and the whole-branch review found them.

- [ ] **Step 1:** Add a `manageLabels` namespace to `copy.ts` (its own keys — no reach into `copy.manage`).
- [ ] **Step 2:** Build the screen. Use `Label` + raw `<input type="checkbox">` + `InputError`, and `components/ui/badge.tsx` for the print count. **Do not** reach for `Pill`, `StatusBadge`, `Field`, `CopyScanField` or `QrScanner` — AGENTS.md names them and this repo does not have them.
- [ ] **Step 3:** Add the nav item with `route("shelves.manage.labels", { shelf: shelf.slug })`.
- [ ] **Step 4:** `make test && make analyse && make lint`, then commit.

---

### Task 12: The scanner, and the two circulation flows

**Files:**
- Create: `resources/js/components/copy-scanner.tsx`
- Create: `app/Http/Controllers/Manage/ScanController.php`
- Modify: `routes/web.php`, the lend and return screens, `resources/js/lib/copy.ts`
- Test: `tests/Feature/Labels/ScanResolveTest.php`

**Interfaces:**
- Consumes: `CopyByIdQuery` (7), `LabelPayload::uuidFrom()` (4).
- Produces: route `shelves.manage.scan` returning the resolved copy as JSON or a 404-shaped null.

**Decoding happens in the browser; resolution happens on the server.** The component reads the camera with `zxing-wasm` or `jsqr` — **both are already in `package.json`**, so no dependency is added — hands the decoded string to `LabelPayload::uuidFrom()` server-side, and resolves through `CopyByIdQuery`. A payload that is not `OLB1:` comes back null and the component says so by name rather than searching for a copy that cannot exist.

**Typing the code stays a complete path.** This is the mitigation for the whole untestable surface, and it is a requirement rather than a nicety: every flow the scanner appears in must remain fully operable by typing `DT-0142`. A cracked lens, a denied camera permission, a flat battery and a borrowed phone are all ordinary. Wire the scanner as an **additional** control beside the existing copy-selection input, never as a replacement for it.

- [ ] **Step 1: Write the server-side test**

`ScanResolveTest` covers, in Pest: a valid payload resolving to a copy; an `OLB2:` payload answering not-found **by name** rather than resolving; a foreign shelf's payload answering not-found; a bare uuid rejected; and a reader reaching the route (it is deliberately not manager-only per OPS §3.3, though the reader-facing *flow* is Phase 3 — the route's own permission is what is asserted here).

- [ ] **Step 2:** Run it red, add the route and `ScanController`, run it green.
- [ ] **Step 3:** Build `copy-scanner.tsx`. Camera permission denial, no camera present, and an undecodable frame must each produce a Vietnamese sentence and leave the typed-code input usable.
- [ ] **Step 4:** Wire it into the lend and return screens beside the existing input.
- [ ] **Step 5:** `make test && make analyse && make lint`, then commit.

**Record honestly in the commit message that the component itself is unverified by test**, and that only the resolution route is covered. Do not describe the scanner as tested.

---

### Task 13: The guarantee sweep

**Files:**
- Modify: `tests/Feature/Architecture/` (a new or extended architecture test), `docs/known-gaps.md`, `docs/superpowers/HANDOFF.md`
- Test: as below

- [ ] **Step 1: Architecture pins**

Add blocks that pin what this phase's prose claims:
- **No new `'Asia/Ho_Chi_Minh'` literal.** Grep `app/` and fail on any occurrence outside `Clock::ZONE`'s declaration, allow-listing `MyLoanHistoryQuery`'s two known ones by name. **Measure the falsification**: add a literal somewhere and confirm the block reddens, then remove it and prove the tree clean.
- **Every Slice B write transaction retries and opens with its lock**, matching `CommunityArchitectureTest`'s existing shape.
- **The label routes declare `/ma-qr` before `/ma-qr/xuat`**, matching the two route-ordering blocks already in `CommunityArchitectureTest`.

- [ ] **Step 2: Re-take every number this phase asserts**

Re-run the suite, Larastan, Pint, Biome and tsc, and **paste the output** rather than asserting the result. Confirm `git diff origin/main...HEAD -- old_next/` is empty. A measurement true when written can be falsified by a later commit — every number in `known-gaps.md` and `HANDOFF.md` that this phase touched gets re-taken here, not carried.

- [ ] **Step 3: Record the carries in `docs/known-gaps.md`**

At minimum:
- `MyLoanHistoryQuery`'s two hardcoded timezone literals, deliberately not fixed (D3).
- The per-shelf `bookshelves.timezone` column, deliberately not read (D3) — Phase 3.
- **The label sheet has never been through a printer.** The geometry claim is about physical paper; nothing in CI can check it.
- The scanner component is unverified by any test, and why (no frontend runner).
- Whether `smalot/pdfparser` actually extracted text from FPDF output, or whether the diacritic block fell back to a subset assertion. **State which**, because the two are different guarantees.

- [ ] **Step 4: Update `docs/superpowers/HANDOFF.md`**

Add the Phase 2c row and section: what shipped, the divergences (D2 lost-copy counting; the PHP-not-SQL boundary refinement), the carries, and re-measured gate numbers **with the commit they were taken at named**, since this file has now twice carried a diffstat that matched no single base.

- [ ] **Step 5: Open the PR and hand the merge decision to Kien**

Push, open the PR, then run a **whole-branch review** with a fresh agent — it has caught what per-task review structurally cannot, in every phase so far — and a separate re-review of any fix wave that review produces, because fix waves have introduced eight of this project's sixteen false claims. **Do not merge.** The merge decision is Kien's.

---

## Self-Review

**Spec coverage.** Every section of the design maps to a task: D1 → Task 4; D2 → Task 2 (with its own discriminating mutation); D3 → Task 1; D4 → Tasks 4 and 9; D5 → Task 9; D6 → Task 3. Slice A's `GetStatistics` and screen → Tasks 2–3. Slice B's five operations → Tasks 5–10, its screen → Task 11, its scanner → Task 12. Testing section → distributed, plus Task 13. Out-of-scope items are restated as carries in Task 13 rather than silently dropped.

**One spec refinement, recorded rather than hidden.** The spec proposed rebuilding `date_trunc` as MariaDB expressions and verified they run; Task 1 computes the boundary in PHP instead, which removes the problem rather than porting it. Both work; the plan takes the cheaper one and says so in Task 1 and in its commit message, so spec and plan do not appear to disagree.

**Placeholder scan.** No "TBD", no "similar to Task N", no "add appropriate error handling". Task 11 and Task 12 carry prose steps rather than full component code — deliberate, because this repo has no frontend tests and code written blind into a plan would be a false promise of verification; both name the exact files, props, components permitted, and the specific traps.

**Type consistency.** `StatsPeriod` (Task 1) is consumed by Tasks 2 and 3 under that name. `LabelPayload::encode`/`uuidFrom` (Task 4) are consumed by Tasks 9 and 12. `CopiesForLabelsQuery::run(array, array, bool)` (Task 6) is called by Task 10 with that arity. `LabelSheet::render()` takes the row shape Task 6 produces minus `printCount`, stated in both places. `MarkCopiesPrinted::execute(User, array): array{count: int}` (Task 8) is called by Task 10.

**Known risk carried into execution:** Task 9 is the only task whose central claim cannot be fully settled in CI, because it is about ink on paper. Task 13 Step 3 requires that to be written down rather than assumed away.
