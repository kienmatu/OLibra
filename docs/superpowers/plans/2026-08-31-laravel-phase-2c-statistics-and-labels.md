# Phase 2c — Statistics and QR Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the manager's statistics screen and the QR label system (printable sheet plus manager scanning) from `old_next/` onto Laravel + Inertia, closing Phase 2.

**Architecture:** Two slices in one branch. Slice A adds one query and one screen, with period boundaries computed in PHP from an injected clock — Postgres `date_trunc` has no MariaDB equivalent, and computing them in the application removes the problem instead of porting it. Slice B adds four queries, one command, a pure payload codec, a server-side PDF writer built on `bacon/bacon-qr-code` + TCPDF, one selection screen, and a camera scanner wired into the two shipped circulation flows. **No migrations and no new routes**: Phase 0 already wrote every column this phase needs, and four of its five routes already exist as named placeholders to be replaced in place.

**Tech Stack:** PHP 8.4, Laravel 13, MariaDB 10.11.19, Inertia v3, React, TypeScript, Pest, Larastan level 8, Pint, Biome. New composer dependencies: `bacon/bacon-qr-code`, `tecnickcom/tcpdf` ^6.11 (**amended** — the first version of this plan said `setasign/fpdf`; see the amended D4). New JS dependencies: none, if the scanner uses `zxing-wasm` (already in `dependencies`). **`jsqr` is in `devDependencies`** and would have to be moved to be usable in production.

**Spec:** `docs/superpowers/specs/2026-08-31-laravel-phase-2c-statistics-and-labels-design.md`

## Global Constraints

Every task's requirements implicitly include this section.

- **Never write to `old_next/`.** It is a read-only behavioural reference. `git diff origin/main...HEAD -- old_next/` must stay empty; the wrap-up task asserts it.
- **Do not run `vendor/bin/pint` on the host** — the host PHP is broken. Run it inside the container: `docker compose -f docker-compose.laravel.yml exec -T app ./vendor/bin/pint`.
- **Gates:** `make lint` (Pint + Biome + `bun run laravel:typecheck`), `make analyse` (Larastan level 8), `make test` (`make test FILTER=<File>` for one file). `make lint` carries **3 Biome warnings and 1 info** — that is the inherited baseline, not a regression.
- **Baseline at branch point:** suite **1,569 passing / 9,384 assertions**, Larastan `[OK]` on 256 files, Pint PASS on 436 files. Re-take the suite number at the start of your task rather than trusting this line — it is true at `7151a91` and every task moves it.
- **URLs are `/shelves/{slug}/manage/…`.** `routes/web.php:63` is `Route::prefix('shelves/{shelf}')->name('shelves.')`. **The first version of this plan used `/tu-sach/{shelf}/quan-ly/…` throughout — that is `old_next`'s path and appears in this repo only inside docblocks.** It made every 404 assertion vacuous, since an unclaimed URI 404s from the router. `tests/Feature/Oversight/ExportHttpTest.php:41` is a real example to copy.
- **Four of this phase's routes already exist as named placeholders** pointing at `ShellController::underConstruction`, whose docblock says "The route NAMES are final today": `routes/web.php:490` `/statistics` (name `statistics`), `:492` `/qr-labels` (`qr-labels`), `:493` `/exports/qr-labels` (`exports.qr-labels`), and `:189` reader `/scan` (`scan`). **Replace them in place. Do not add new paths or names** — a second `->name('statistics')` in the same group silently wins or loses depending on registration order.
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

// RELEASE THE CLOCK. tests/Pest.php binds Laravel's TestCase with ->in('Feature')
// only, so a Unit test gets no framework tearDown and a frozen clock LEAKS into
// every later Unit test in the process. tests/Unit/ClockTest.php:7 opens with
// exactly this line for exactly this reason.
afterEach(fn () => CarbonImmutable::setTestNow());

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

**READ THIS BEFORE WRITING A FIXTURE — the first version of this plan got all of it wrong.**

- **There is no `LoanFactory`.** `database/factories/` holds Book, BookCopy, Bookshelf, Category, Membership, ParishUnit and User only, and `App\Models\Loan` does not use `HasFactory`. Build loans with `Loan::query()->create([...])`, the way `tests/support/TenantHarness.php:67` does.
- **The borrower column is `borrower_id` and it references `users`,** not `borrower_membership_id` and not memberships: `CONSTRAINT loans_borrower_id_foreign FOREIGN KEY (borrower_id) REFERENCES users (id)`, read off the live table. The reference agrees — `get-statistics.ts` counts `count(distinct borrower_id)` and joins `users`.
- **`copy_id`, `book_id`, `borrower_id`, `lent_by` and `due_on` are NOT NULL with no default.** Set all five on every loan.
- **`loans_one_active_per_copy` is a UNIQUE on a generated column** — `active_copy_id` is `IF(status = 'active', copy_id, NULL)`. **Two `active` loans on one copy is a duplicate-key error**, so every active loan in a fixture needs its own copy.
- **A `retired` copy needs a `retired_reason`** — `CHECK (state <> 'retired' or retired_reason is not null)`.

**Two things this query does differently from the reference, both deliberate.**

**Divergence: lost copies are counted by `lost_reported_at`.** The reference (`old_next/src/domain/shelf/queries/get-statistics.ts`, opened) uses `where state = 'lost' and deleted_at is null and updated_at >= since`. `updated_at` moves on any write, so a copy reported lost years ago re-enters the period when someone edits its condition note. This schema carries `book_copies.lost_reported_at` and `App\Actions\Catalogue\ReportCopyLost` line 70 writes it (opened), so the honest predicate is available. Ruled by the product owner on 2026-08-31: correctness over parity. Design doc D2.

**Civil-day grouping uses the numeric offset `'+07:00'`, not the zone name.** `CONVERT_TZ(t, 'UTC', 'Asia/Ho_Chi_Minh')` requires MariaDB's `mysql.time_zone_name` table to be populated. It **is** populated on this development container — measured, `SELECT COUNT(*)` returns 1793 — but the production cPanel host is unverified, and a host with empty timezone tables answers `NULL` rather than erroring, which would silently empty the chart. `Asia/Ho_Chi_Minh` has been a fixed UTC+7 with no DST since 1975, so the numeric offset is exact and depends on nothing. Measured on 10.11.19: `DATE(CONVERT_TZ('2026-08-31 18:30:00','+00:00','+07:00'))` returns `2026-09-01`.

**Divergence: the period parameter is `?period=`, not the reference's `?ky=`.** `get-statistics.ts`'s docblock and `thong-ke/page.tsx` read `ky`. This port's route paths are English throughout (`/manage/statistics`, not `/quan-ly/thong-ke`), so an English query parameter is the consistent choice. Numbered here because this project numbers divergences; it is cosmetic and reversible.

- [ ] **Step 1: Write the failing test**

Create `tests/Feature/Statistics/StatisticsQueryTest.php`:

```php
<?php

use App\Enums\StatsPeriod;
use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\Category;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\User;
use App\Queries\StatisticsQuery;
use App\Support\TenantContext;
use Carbon\CarbonImmutable;

/**
 * One shelf, one manager bound as the tenant, one reader.
 *
 * The reader is returned as a USER, not a membership: loans.borrower_id is a
 * users(id) (`loans_borrower_id_foreign`, read off the live table), and both
 * columns hold 36-char uuids, so passing the wrong one fails on the foreign
 * key rather than on anything readable.
 *
 * Grep first: `grep -rn "^function statFix" tests/` — top-level helpers are
 * process-global (AGENTS.md).
 *
 * @return array{Bookshelf, User, User}
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
    Membership::factory()->for($shelf)->create([
        'user_id' => $anh->id, 'role' => 'reader', 'status' => 'active',
    ]);

    app(TenantContext::class)->set($shelf, $managerMembership);
    test()->actingAs($manager);

    return [$shelf, $manager, $anh];
}

/**
 * One ACTIVE loan on its own copy.
 *
 * Its own copy, always: `loans_one_active_per_copy` is a UNIQUE over
 * `active_copy_id`, a generated column equal to `copy_id` while the status is
 * 'active'. Two active loans on one copy is errno 1062, not a fixture.
 *
 * Grep first: `grep -rn "^function statLoan" tests/`.
 */
function statLoan(Bookshelf $shelf, Book $book, User $borrower, User $lender, string $lentAt, string $code): Loan
{
    $copy = BookCopy::factory()->for($shelf)->for($book)->create(['code' => $code]);

    return Loan::query()->create([
        'bookshelf_id' => $shelf->id,
        'copy_id' => $copy->id,
        'book_id' => $book->id,
        'borrower_id' => $borrower->id,
        'lent_by' => $lender->id,
        'due_on' => CarbonImmutable::parse($lentAt)->addDays(14)->toDateString(),
        'lent_at' => CarbonImmutable::parse($lentAt),
        'status' => 'active',
    ]);
}

it('counts a loan inside the period and ignores one before it', function () {
    [$shelf, $manager, $anh] = statFix();
    CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-09-02 02:00:00', 'UTC'));

    $book = Book::factory()->for($shelf)->create();

    // Inside: Tuesday of the current civil week.
    statLoan($shelf, $book, $anh, $manager, '2026-09-01 03:00:00', 'DT-0001');
    // Outside: the Friday before, well clear of Monday 00:00 +07:00.
    statLoan($shelf, $book, $anh, $manager, '2026-08-28 03:00:00', 'DT-0002');

    expect(app(StatisticsQuery::class)->run(StatsPeriod::Week)['loans'])->toBe(1);
});

it('a voided loan is not a loan', function () {
    [$shelf, $manager, $anh] = statFix();
    CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-09-02 02:00:00', 'UTC'));

    $book = Book::factory()->for($shelf)->create();
    $loan = statLoan($shelf, $book, $anh, $manager, '2026-09-01 03:00:00', 'DT-0001');
    $loan->update(['status' => 'voided', 'voided_at' => now(), 'voided_by' => $manager->id, 'void_reason' => 'nhập nhầm']);

    expect(app(StatisticsQuery::class)->run(StatsPeriod::Week)['loans'])->toBe(0);
});

it('distinct borrowers counts people, not loans', function () {
    // TITLED ASSERTION FIRST. `expect()->and()` short-circuits and a failed
    // expect() aborts the whole METHOD, so putting `loans` first would make a
    // wrong `borrowers` invisible behind a wrong `loans`.
    [$shelf, $manager, $anh] = statFix();
    CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-09-02 02:00:00', 'UTC'));

    $book = Book::factory()->for($shelf)->create();
    // Three loans, three copies, all inside the week and all BEFORE "now" —
    // the predicate has no upper bound, so a future-dated fixture would make
    // the count a coincidence rather than a measurement.
    statLoan($shelf, $book, $anh, $manager, '2026-08-31 03:00:00', 'DT-0001');
    statLoan($shelf, $book, $anh, $manager, '2026-09-01 03:00:00', 'DT-0002');
    statLoan($shelf, $book, $anh, $manager, '2026-09-01 09:00:00', 'DT-0003');

    $stats = app(StatisticsQuery::class)->run(StatsPeriod::Week);

    expect($stats['borrowers'])->toBe(1);
    expect($stats['loans'])->toBe(3);
});

it('counts lost copies by lost_reported_at, not by updated_at — divergence D2', function () {
    [$shelf] = statFix();
    CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-09-02 02:00:00', 'UTC'));

    $book = Book::factory()->for($shelf)->create();

    // Reported lost LONG before the period, and touched inside it. Under the
    // reference's `updated_at >= since` this copy counts; under
    // lost_reported_at it does not. That difference IS this block.
    $old = BookCopy::factory()->for($shelf)->for($book)->create([
        'code' => 'DT-0001',
        'state' => 'lost',
        'lost_reported_at' => CarbonImmutable::parse('2025-01-05 03:00:00', 'UTC'),
    ]);
    $old->update(['condition_note' => 'tìm lại lần nữa']);

    BookCopy::factory()->for($shelf)->for($book)->create([
        'code' => 'DT-0002',
        'state' => 'lost',
        'lost_reported_at' => CarbonImmutable::parse('2026-09-01 03:00:00', 'UTC'),
    ]);

    expect(app(StatisticsQuery::class)->run(StatsPeriod::Week)['copiesLost'])->toBe(1);
});

it('groups the daily chart by the PARISH day, not the UTC day', function () {
    [$shelf, $manager, $anh] = statFix();
    CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-09-03 02:00:00', 'UTC'));

    $book = Book::factory()->for($shelf)->create();

    // 18:30 UTC on 31 Aug is 01:30 on 1 Sep in Hồ Chí Minh. Grouped by the UTC
    // day this lands on 2026-08-31; grouped correctly it lands on 2026-09-01.
    // Measured on MariaDB 10.11.19:
    //   DATE(CONVERT_TZ('2026-08-31 18:30:00','+00:00','+07:00')) → 2026-09-01
    statLoan($shelf, $book, $anh, $manager, '2026-08-31 18:30:00', 'DT-0001');

    $days = collect(app(StatisticsQuery::class)->run(StatsPeriod::Week)['daily'])->pluck('day')->all();

    expect($days)->toContain('2026-09-01');
    expect($days)->not->toContain('2026-08-31');
});

it('counts books added in the period', function () {
    [$shelf] = statFix();
    CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-09-02 02:00:00', 'UTC'));

    Book::factory()->for($shelf)->create(['created_at' => CarbonImmutable::parse('2026-09-01 03:00:00', 'UTC')]);
    Book::factory()->for($shelf)->create(['created_at' => CarbonImmutable::parse('2026-08-01 03:00:00', 'UTC')]);

    expect(app(StatisticsQuery::class)->run(StatsPeriod::Week)['booksAdded'])->toBe(1);
});

it('groups loans by the book\'s category, and names the uncategorised', function () {
    [$shelf, $manager, $anh] = statFix();
    CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-09-02 02:00:00', 'UTC'));

    // NO ->for($shelf). App\Models\Category is "Global, deliberately NOT
    // shelf-scoped — one taxonomy for every shelf" (its own docblock); it has
    // no bookshelf() relation and `categories` has no bookshelf_id. Every
    // existing call site in tests/ is a bare Category::factory()->create().
    $category = Category::factory()->create(['name' => 'Thiếu nhi']);
    $withCat = Book::factory()->for($shelf)->create(['category_id' => $category->id]);
    $without = Book::factory()->for($shelf)->create(['category_id' => null]);

    statLoan($shelf, $withCat, $anh, $manager, '2026-09-01 03:00:00', 'DT-0001');
    statLoan($shelf, $without, $anh, $manager, '2026-09-01 04:00:00', 'DT-0002');

    $labels = collect(app(StatisticsQuery::class)->run(StatsPeriod::Week)['byCategory'])->pluck('label')->all();

    // A book with no category must appear under a NAMED bucket rather than
    // vanish from the chart or appear as an empty label.
    expect($labels)->toContain('Thiếu nhi');
    expect($labels)->toContain('Chưa phân loại');
});

it('ranks top books by loan count within the period', function () {
    [$shelf, $manager, $anh] = statFix();
    CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-09-02 02:00:00', 'UTC'));

    $popular = Book::factory()->for($shelf)->create(['title' => 'Dế Mèn Phiêu Lưu Ký']);
    $quiet = Book::factory()->for($shelf)->create(['title' => 'Aó Dài']);

    statLoan($shelf, $popular, $anh, $manager, '2026-09-01 03:00:00', 'DT-0001');
    statLoan($shelf, $popular, $anh, $manager, '2026-09-01 04:00:00', 'DT-0002');
    statLoan($shelf, $quiet, $anh, $manager, '2026-09-01 05:00:00', 'DT-0003');

    $top = app(StatisticsQuery::class)->run(StatsPeriod::Week)['topBooks'];

    expect($top[0]['title'])->toBe('Dế Mèn Phiêu Lưu Ký');
    expect($top[0]['count'])->toBe(2);
});

it('ranks top readers by loan count, naming the borrower', function () {
    [$shelf, $manager, $anh] = statFix();
    CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-09-02 02:00:00', 'UTC'));

    $book = Book::factory()->for($shelf)->create();
    statLoan($shelf, $book, $anh, $manager, '2026-09-01 03:00:00', 'DT-0001');
    statLoan($shelf, $book, $anh, $manager, '2026-09-01 04:00:00', 'DT-0002');

    $top = app(StatisticsQuery::class)->run(StatsPeriod::Week)['topReaders'];

    expect($top[0]['name'])->toBe('Têrêsa Lê Ngọc Ánh');
    expect($top[0]['count'])->toBe(2);
});

it('another shelf\'s loans are invisible — tenancy, not a hand-written predicate', function () {
    [$shelf, $manager, $anh] = statFix();
    CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-09-02 02:00:00', 'UTC'));

    $book = Book::factory()->for($shelf)->create();
    statLoan($shelf, $book, $anh, $manager, '2026-09-01 03:00:00', 'DT-0001');

    app(TenantContext::class)->actSystemWide();
    $other = Bookshelf::factory()->create(['slug' => 'other-stat', 'settings' => []]);
    $otherUser = User::factory()->create();
    Membership::factory()->for($other)->create([
        'user_id' => $otherUser->id, 'role' => 'reader', 'status' => 'active',
    ]);
    $otherBook = Book::factory()->for($other)->create();
    statLoan($other, $otherBook, $otherUser, $otherUser, '2026-09-01 03:00:00', 'ZZ-0001');

    app(TenantContext::class)->set($shelf, Membership::query()
        ->where('bookshelf_id', $shelf->id)->where('role', 'manager')->firstOrFail());

    expect(app(StatisticsQuery::class)->run(StatsPeriod::Week)['loans'])->toBe(1);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `make test FILTER=StatisticsQueryTest`
Expected: FAIL — `App\Queries\StatisticsQuery` does not exist.

**Then check the factories before implementing.** Open `database/factories/BookFactory.php`, `BookCopyFactory.php`, `CategoryFactory.php` and `MembershipFactory.php` and confirm the attributes these blocks set exist and that nothing else is required. If a factory demands an attribute a block does not set, add it to the block — a factory default other phases rely on is not this task's to move.

- [ ] **Step 3: Write the query**

Create `app/Queries/StatisticsQuery.php`: one private `since()` plus one public `run()` assembling the nine figures. Tenancy comes from `BookshelfScope` on each model — **write no `bookshelf_id` predicate**. Group the daily chart with:

```php
->selectRaw("DATE(CONVERT_TZ(lent_at, '+00:00', '+07:00')) as day, COUNT(*) as n")
```

`byCategory` needs a left join to `categories` with `coalesce(name, 'Chưa phân loại')`; `topReaders` joins `users` through `borrower_id`.

**Divergence: `topReaders` does not join `memberships`.** The reference (`get-statistics.ts:167-172`) joins `memberships` on the way to `users`. This port goes straight from `loans.borrower_id` to `users.id`, which is what the foreign key actually is. Besides being simpler, it removes a fan-out: a user with memberships on two shelves would be counted twice through the reference's join. Numbered because this project numbers divergences, and because "it looked like a simplification" is how an unnoticed behaviour change gets shipped. Both `topBooks` and `topReaders` need a deterministic tie-break beside the count — add `id` — or their order is whatever the engine returns.

Give the class a docblock carrying the OPS §3.3 citation, divergence D2 with the reference's own predicate quoted **in full including `deleted_at is null`**, and the numeric-offset reasoning with the measured `2026-09-01` result. Do not write "measured" for anything you have not run.

Cast every count with `(int)` and return `list<...>` shapes through `array_values(...)` — Larastan level 8 rejects `array<int, ...>` where `list<...>` is declared. `DonationQueueQuery::run()` is the pattern to copy.

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `make test FILTER=StatisticsQueryTest`
Expected: PASS, 10 blocks.

- [ ] **Step 5: Prove the divergence block is not vacuous**

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
- Modify: `routes/web.php:490` (**replace the placeholder in place**), `resources/js/lib/copy.ts`, `resources/js/layouts/manage-layout.tsx`
- Test: `tests/Feature/Statistics/ManagerStatisticsScreenTest.php`

**Interfaces:**
- Consumes: `StatisticsQuery::run(StatsPeriod)` (Task 2), `App\Enums\StatsPeriod` (Task 1).
- Produces: Inertia page `manage/statistics` with props `{ stats }` shaped as `StatisticsQuery::run()` returns; `copy.manageStatistics`.
- **The route already exists.** `routes/web.php:490` is `Route::get('/statistics', [ShellController::class, 'underConstruction'])->name('statistics')`. Point it at the new controller; **do not add a second route and do not rename it.** `ShellController::underConstruction`'s docblock says "The route NAMES are final today", and a duplicate `->name('statistics')` in one group resolves to whichever registered last, silently. The URL is therefore `/shelves/{slug}/manage/statistics`.

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
        ->get("/shelves/{$shelf->slug}/manage/statistics")
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
        ->get("/shelves/{$shelf->slug}/manage/statistics?period=fortnight")
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page->where('stats.period', 'month'));
});

it('a named period reaches the query', function () {
    [$shelf, $manager] = statScreenFix();

    $this->actingAs($manager)
        ->get("/shelves/{$shelf->slug}/manage/statistics?period=year")
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
        ->get("/shelves/{$shelf->slug}/manage/statistics")
        ->assertNotFound();
});

it('a guest is redirected to login rather than 404d', function () {
    [$shelf] = statScreenFix();

    $this->get("/shelves/{$shelf->slug}/manage/statistics")->assertRedirect();
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `make test FILTER=ManagerStatisticsScreenTest`
Expected: FAIL on the three positive blocks — the placeholder renders `ShellController`'s under-construction page, not `manage/statistics`. **The reader 404 block and the guest redirect block should already pass**, because the placeholder route claims the URI today.

**That is the point, and it is why the first version of this plan was wrong.** A 404-only assertion is **vacuous when no route claims the URI** — it passes against a route never written. The first draft asserted `/tu-sach/{shelf}/quan-ly/thong-ke`, which is `old_next`'s path and is claimed by nothing here, so its reader block would have passed forever against the router's absence. Against the real URI the block is meaningful from the start, because the placeholder already sits behind `['auth', 'role:manager']`.

- [ ] **Step 3: Point the existing route at the new controller**

Modify `routes/web.php:490` **in place** — same path, same name, new destination:

```php
        // BR §16.3's Statistics paragraph, opened: "Period selector (week,
        // month, year, since the shelf began), showing loans, distinct
        // borrowers, books added, and books lost, with charts over time and
        // ranked lists of top books and top readers." OPS §3.3's
        // GetStatistics is the query behind it. The placeholder this replaces
        // held the name from Phase 0; ShellController::underConstruction's
        // docblock records that the route NAMES were final from that day.
        Route::get('/statistics', [StatisticsController::class, 'index'])->name('statistics');
```

Add the `use App\Http\Controllers\Manage\StatisticsController;` import at the top of the file. Check afterwards that `ShellController` is still imported and still used by the remaining placeholders — do not remove an import another route needs.

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
- Modify: `composer.json` (add `bacon/bacon-qr-code`, `tecnickcom/tcpdf`)
- Create: `app/Support/Qr/LabelPayload.php`
- Test: `tests/Unit/Qr/LabelPayloadTest.php`

**Interfaces:**
- Produces: `LabelPayload::PREFIX` (`'OLB1:'`); `LabelPayload::encode(string $uuid): string`; `LabelPayload::uuidFrom(string $payload): ?string` returning `null` for anything it does not recognise.

**This class touches no database, no model and no framework** — it is pure string arithmetic, which is why it is unit-testable without a shelf. The reference makes the same split (`old_next/src/lib/qr.ts`'s own docblock: nothing there "touches the database, React or Node's filesystem"), and for the same reason: the browser-side scanner and the PDF writer must agree on one format, so that format lives in one place with no dependencies to drag along.

**The format is `OLB1:` + the UUID's sixteen raw bytes as base64url, unpadded — 22 characters, 27 bytes total.** Design doc D1 records that this was reopened (nothing is printed yet, so the original "protect the printed estate" argument does not apply) and re-closed on a new premise (the production domain is unsettled, and printing is what makes a hostname permanent). Do not re-litigate it in this task; D1 records what would reopen it.

- [ ] **Step 1: Add the dependencies**

```bash
docker compose -f docker-compose.laravel.yml exec -T app composer require bacon/bacon-qr-code "tecnickcom/tcpdf:^6.11"
```

Then confirm what actually landed, because the plan must not assert a version it did not see:

```bash
docker compose -f docker-compose.laravel.yml exec -T app composer show bacon/bacon-qr-code tecnickcom/tcpdf | grep -E "^name|^versions"
```

**`setasign/fpdf` is NOT the dependency**, though the first version of this plan and the first version of D4 both said so. Measured from packagist metadata:

| Package | Declared `require` |
|---|---|
| `setasign/fpdf` 1.9.0 | `ext-zlib`, **`ext-gd`** |
| `tecnickcom/tcpdf` 6.11.4 | `php >=7.1.0`, **`ext-curl`** |
| `bacon/bacon-qr-code` | `php ^8.1`, `ext-iconv`, `dasprid/enum` |

FPDF requires the very extension D4 chose it to avoid, and it cannot load a TTF at runtime at all. See the amended D4 for the full retraction. **Pin TCPDF to `^6.11`**: version 8.x is a rewrite depending on `tecnickcom/tc-lib-pdf` with a different API, and this phase wants 6.x's direct-drawing surface.

**Verify the extension claim yourself rather than inheriting it**, and note that `gd` IS loaded in this container — so a successful install proves nothing about the production host:

```bash
docker compose -f docker-compose.laravel.yml exec -T app php -r '
$j = json_decode(file_get_contents("https://repo.packagist.org/p2/tecnickcom/tcpdf.json"), true);
foreach ($j["packages"]["tecnickcom/tcpdf"] as $v) {
  if ($v["version"] === "6.11.4") { echo json_encode($v["require"]), "\n"; }
}'
```

If TCPDF's requirements have changed since this plan was written, that is a finding for the review, not something to work around.

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
    // retired_reason is REQUIRED: book_copies carries
    //   CHECK (state <> 'retired' or retired_reason is not null)
    // read off the live table. Omitting it is a constraint violation, not a
    // retired copy — tests/Feature/Schema/CatalogueSchemaTest.php exists to
    // assert exactly that refusal.
    BookCopy::factory()->for($shelf)->for($book)->create([
        'code' => 'DT-0001', 'state' => 'retired', 'retired_reason' => 'rách nhiều',
    ]);

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

Create the query: one `BookCopy::query()->with('book')` read, grouped in PHP, with empty titles dropped when `$onlyUnprinted` is true.

**Ordering needs care, and the obvious approach is not available.** You cannot `orderBy` a column of an eager-loaded relation — `with('book')` issues a second SELECT, so `books.title` is not in scope for the parent query's ORDER BY. And you must not reach for `join('books', …)`: `TenancyArchitectureTest` (lines 145 and 182) documents a **join-condition blind spot** in its tenancy grep, which `DonationQueueQuery`'s docblock (lines 28–31) records deliberately staying out of. Use a correlated subquery instead:

```php
->orderBy(Book::query()->select('title')->whereColumn('books.id', 'book_copies.book_id'))
->orderBy('code')
```

That keeps the sort in the database, which matters: MariaDB's `utf8mb4_unicode_ci` orders `Aó` before `Dế`, and PHP's `strcmp` on raw bytes does not. Re-sorting in PHP would make the first block's expectation depend on which layer sorted.

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
    // TITLED ASSERTIONS FIRST: the tenancy facts, then the count. expect()->and()
    // short-circuits, so leading with $result['count'] would hide a foreign
    // copy that WAS stamped behind a count that happened to read 1.
    [, $manager, $book] = mcpFix();
    $mine = BookCopy::factory()->for($book->bookshelf)->for($book)->create(['code' => 'DT-0001']);

    app(TenantContext::class)->actSystemWide();
    $other = Bookshelf::factory()->create(['slug' => 'other-mcp', 'settings' => []]);
    $otherBook = Book::factory()->for($other)->create();
    $otherCopy = BookCopy::factory()->for($other)->for($otherBook)->create(['code' => 'ZZ-0001']);

    app(TenantContext::class)->set($book->bookshelf, Membership::query()
        ->where('bookshelf_id', $book->bookshelf->id)->firstOrFail());

    $result = app(MarkCopiesPrinted::class)->execute($manager, [$mine->id, $otherCopy->id]);

    expect($otherCopy->fresh()->qr_print_count)->toBe(0);
    expect($mine->fresh()->qr_print_count)->toBe(1);
    expect($result['count'])->toBe(1);
});

it('a selection that scopes down to nothing SUCCEEDS with a count of zero', function () {
    // DESIGN DOC D7, and the first version of this plan asserted the exact
    // opposite. OPS §4.1's MarkCopiesPrinted entry, opened and quoted:
    //
    //   "A zero-row update is not a failure here, and this is the one command
    //    in this document for which that is true. It is set-valued bookkeeping
    //    about a document that already exists — the route builds the PDF bytes
    //    BEFORE calling this — so an empty result is a fact to record, not a
    //    target that was missed. The reported count is what actually moved,
    //    not what was asked for."
    //
    // So copy_selection_empty refuses an EMPTY INPUT and nothing else. A
    // non-empty input that scopes to zero rows records zero and succeeds.
    [, $manager, $book] = mcpFix();

    app(TenantContext::class)->actSystemWide();
    $other = Bookshelf::factory()->create(['slug' => 'other-mcp2', 'settings' => []]);
    $otherBook = Book::factory()->for($other)->create();
    $otherCopy = BookCopy::factory()->for($other)->for($otherBook)->create(['code' => 'ZZ-0001']);

    app(TenantContext::class)->set($book->bookshelf, Membership::query()
        ->where('bookshelf_id', $book->bookshelf->id)->firstOrFail());

    $result = app(MarkCopiesPrinted::class)->execute($manager, [$otherCopy->id]);

    expect($result['count'])->toBe(0);
    expect($otherCopy->fresh()->qr_print_count)->toBe(0);
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
    // OPS §4.1's MarkCopiesPrinted entry (docs/OPERATIONS.md:181), quoted
    // from its Failure modes list. NOT §4.4 — that is Community, and an
    // earlier draft of this plan cited it here.
    'copy_selection_empty' => 'Bạn chưa chọn bản sách nào để in nhãn.',
```

**Then check the census still passes and that your sentence is actually covered.** `known-gaps.md` records that seventeen inherited audit sentences have no test behind them and that `AuditSentencesTest`'s census cannot see a wrong sentence — only its per-action wording blocks can. **Add a wording block for `copy.qr_printed`** so this phase does not add an eighteenth hole. Phase 2b's nineteen community keys all have one; match that.

- [ ] **Step 4: Write the Action, then run**

`DB::transaction(..., ConcurrencyRetry::ATTEMPTS)`, Gate authorization against the existing copy/catalogue policy, scoped `BookCopy::query()->whereIn('id', $copyIds)` (tenancy from the scope, **no `bookshelf_id` predicate**), increment with `->increment('qr_print_count')` or an explicit `qr_print_count + 1` update, stamp `qr_printed_at` from the injected `Clock`, and record one audit entry naming the count that actually moved.

**Refuse `copy_selection_empty` when the INPUT is empty, and only then.** Per D7 and OPS §4.1, a non-empty selection that scopes down to zero rows succeeds with a count of zero — it is bookkeeping about a PDF that already exists. An earlier draft of this plan instructed the opposite and had a test asserting it.

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

**THE LIBRARY CHANGED. Read the amended D4 before starting.** The first version of this plan and the first version of D4 both specified FPDF. That was wrong on the facts, and an independent review measured it:

- **FPDF requires `ext-gd`** (`setasign/fpdf` 1.9.0 declares `ext-zlib`, `ext-gd`) — the exact extension D4 said it avoided. TCPDF 6.11.4 declares `php >=7.1.0`, `ext-curl`.
- **FPDF cannot load a TTF at runtime.** `AddFont()` rejects any name containing a path separator and loads a pre-generated `.json` font-definition file; `Cell()` takes single-byte text through one of the `makefont/*.map` encodings. Vietnamese would mean running MakeFont against cp1258, committing generated `.json`/`.z` artefacts, and `iconv`-ing every string — a worse version of the "font-conversion build step" TCPDF was rejected for.
- **cp1258 encodes Vietnamese decomposed**, so an FPDF sheet's text layer is NFD (`ê` + U+0301) while every title in this database is NFC. The diacritic test below would have failed against a *correct* implementation.

TCPDF embeds a TTF subset directly and takes UTF-8, so none of that applies. **Do not reintroduce FPDF.**

**Geometry is inherited verbatim and is not a free parameter.** 186 × 255.4mm safe area, 3 columns × 7 rows, 21 per page, 58 × 34mm labels. A4 is 210 × 297mm; US Letter is 215.9 × 279.4mm — **wider but 17.6mm shorter**. A sheet that must print correctly on either has 210 × 279.4mm to work with, and 12mm of margin leaves the box above. Portability costs a row: 21 per page rather than the 24 a Letter-blind layout would fit, so a 400-copy shelf is 20 pages instead of 17. The 2026-08-13 design also records that Avery L7159 pre-cut stock was measured and rejected, because its perforations sit outside the shared box and perforations do not move.

**The QR is drawn as vectors, from the module matrix.** Not as an embedded raster. `bacon/bacon-qr-code` gives the matrix without needing `gd` or `imagick`; only its PNG renderer needs those. Use ECC **Q** — the payload is 27 bytes, which fits QR version 3 at Q's 32-byte ceiling, and Q means a quarter of the symbol may be scuffed, torn or jam-smeared and still decode. That is the correct budget for a label on a book a seven-year-old carries home in the rain.

**The human-readable code prints under every QR and is never decorative.** A cracked lens, a denied camera permission, a flat battery and a borrowed phone are all ordinary.

- [ ] **Step 1: Copy the fonts out of the reference**

```bash
mkdir -p resources/fonts
cp old_next/src/lib/fonts/Lexend-Regular.ttf resources/fonts/
cp old_next/src/lib/fonts/Lexend-SemiBold.ttf resources/fonts/
git status --porcelain old_next/   # MUST be empty — old_next is read-only
```

- [ ] **Step 2: Prove TCPDF can embed Lexend with Vietnamese diacritics, BEFORE building the sheet**

This is the phase's one genuinely unknown engineering fact, and it is cheap to settle. Do it as a throwaway script, not as a test:

```bash
docker compose -f docker-compose.laravel.yml exec -T app php -r '
require "vendor/autoload.php";
$f = TCPDF_FONTS::addTTFfont("resources/fonts/Lexend-Regular.ttf", "TrueTypeUnicode", "", 96);
var_dump($f);
$pdf = new TCPDF("P", "mm", "A4", true, "UTF-8");
$pdf->setPrintHeader(false); $pdf->setPrintFooter(false);
$pdf->AddPage(); $pdf->SetFont($f, "", 9);
$pdf->Text(10, 20, "Dế Mèn Phiêu Lưu Ký · DT-0142");
file_put_contents("/tmp/probe.pdf", $pdf->Output("", "S"));
echo filesize("/tmp/probe.pdf"), " bytes\n";'
```

`addTTFfont` returns the generated font name or `false`. **If it returns `false`, stop and report it** — that is a D4-level finding, not something to work around by falling back to a core font, which would silently drop every diacritic.

- [ ] **Step 3: Write the failing test**

Create `tests/Feature/Labels/LabelSheetTest.php`:

```php
<?php

use App\Support\Qr\LabelSheet;

/**
 * Three rows with a title that exercises stacked Vietnamese diacritics.
 *
 * Grep first: `grep -rn "^function sheetRows" tests/` — top-level helpers are
 * process-global (AGENTS.md).
 */
function sheetRows(int $n = 3): array
{
    return collect(range(1, $n))->map(fn (int $i) => [
        'copyId' => sprintf('0191f1e3-0f7a-7c31-9b2e-6a4b1d2c3e%02d', $i),
        'code' => sprintf('DT-%04d', $i),
        'title' => 'Dế Mèn Phiêu Lưu Ký',
    ])->all();
}

/**
 * Pages in a PDF, counted from the raw bytes.
 *
 * The negative lookahead is load-bearing: `/Type /Pages` is the page TREE
 * node and also matches a naive `/Type /Page` substring count, so a
 * one-page document counts as two without it. Measured on real output.
 *
 * Grep first: `grep -rn "^function pdfPageCount" tests/`.
 */
function pdfPageCount(string $pdf): int
{
    return preg_match_all('#/Type\s*/Page(?![s])#', $pdf);
}

it('produces bytes that are a PDF', function () {
    expect(app(LabelSheet::class)->render(sheetRows()))->toStartWith('%PDF-');
});

it('THE DIACRITIC TEST — the title survives into the document text', function () {
    // The failure this exists for is not a crash. A font subset that drops the
    // stacked marks in "Dế Mèn Phiêu Lưu Ký" still produces a structurally
    // valid PDF; the defect is discovered on paper already glued to books.
    //
    // NORMALISE BEFORE COMPARING. A PDF text layer may be NFD even when it
    // renders perfectly — "ế" as "ê" + U+0301 — and a raw toContain() against
    // this file's NFC literal would then fail against a CORRECT sheet and send
    // an implementer hunting a font bug that is not there. ext-intl is loaded
    // in this container (verified: class_exists('Normalizer') is true).
    $pdf = app(LabelSheet::class)->render(sheetRows(1));

    $text = Normalizer::normalize(extractedText($pdf), Normalizer::FORM_C);

    expect($text)->toContain('Dế Mèn Phiêu Lưu Ký');
    expect($text)->toContain('DT-0001');
});

it('lays 21 labels to a page and starts a 22nd on page two', function () {
    expect(pdfPageCount(app(LabelSheet::class)->render(sheetRows(21))))->toBe(1);
    expect(pdfPageCount(app(LabelSheet::class)->render(sheetRows(22))))->toBe(2);
});

it('an empty set still produces a valid document rather than throwing', function () {
    // LabelSheet is a renderer, not a guard. The refusal for an empty
    // selection is MarkCopiesPrinted's (copy_selection_empty); a renderer that
    // also refused would give one rule two homes.
    expect(app(LabelSheet::class)->render([]))->toStartWith('%PDF-');
});
```

**Write `extractedText()` in this file too** (grep first). Add `smalot/pdfparser` as a **dev** dependency:

```bash
docker compose -f docker-compose.laravel.yml exec -T app composer require --dev smalot/pdfparser
```

If it cannot extract text from TCPDF's output, **say so in the block's docblock and fall back** to asserting the diacritic glyphs are present in the embedded subset — do not delete the block, and do not claim it tests something it does not. Task 13 requires recording which of the two actually shipped.

- [ ] **Step 4: Run it red, implement, run green**

Run: `make test FILTER=LabelSheetTest` — expect red, implement `LabelSheet`, re-run and expect 4 blocks green.

The implementation: `new TCPDF('P', 'mm', 'A4', true, 'UTF-8')` with header, footer and auto page-break all off — auto page-break would silently reflow the grid.

**TCPDF stamps `Powered by TCPDF (www.tcpdf.org)` into the last page's CONTENT** even with `setPrintHeader(false)` and `setPrintFooter(false)` — measured in extracted text. `$tcpdflink` is `protected` in 6.11.4 with no setter, so removing it needs a subclass. It draws at 1pt at the sheet edge, so it is not a print defect, but it **is** in the text layer: do not write a diacritic assertion that depends on the extracted text containing nothing else. Register the font once via `TCPDF_FONTS::addTTFfont()` and cache the generated name. **Pass an explicit `$outpath`.** With the argument omitted it writes the generated `.php`, `.z` and `.ctg.z` into `K_PATH_FONTS` — i.e. `vendor/tecnickcom/tcpdf/fonts/` — which is gitignored, so `composer install --no-dev` on the host recreates the tree without them and TCPDF's own source documents that directory as one that "must be writeable by the web server". Generate into a path this repo controls (`storage/app/fonts`, created if absent) and either commit the three artefacts or generate them once at deploy. **Whichever you choose, say which in the commit message** — D4's whole premise is minimising what the unverified host must provide. for each row compute its cell from the grid; draw the QR modules as filled `Rect`s; print the code beneath in the regular face; truncate the title to the label width rather than letting it overflow into its neighbour. Return `$pdf->Output('', 'S')`.

- [ ] **Step 5: Print one real sheet before the phase closes**

Not a test step and not automatable — a note carried to Task 13. The geometry claim is about physical paper, and nobody has put this file through a printer.

- [ ] **Step 6: Gates, then commit**

```bash
make analyse && make lint
git add -A
git commit -m "feat: the label sheet — 21 to a page inside the box A4 and Letter share"
```

---

### Task 10: The label routes and the export

**Files:**
- Create: `app/Http/Controllers/Manage/LabelController.php`, `app/Http/Requests/Labels/ExportLabelSheetRequest.php`
- Modify: `routes/web.php:492-493` (**replace both placeholders in place**)
- Test: `tests/Feature/Labels/LabelExportTest.php`

**Interfaces:**
- Consumes: `TitlesForLabelsQuery` (5), `CopiesForLabelsQuery` (6), `MarkCopiesPrinted` (8), `LabelSheet` (9).
- Produces: Inertia page `manage/labels` with props `{ titles, onlyUnprinted }`.
- **Both routes already exist as placeholders and keep their settled names.** `routes/web.php:492` is `Route::get('/qr-labels', …)->name('qr-labels')` and `:493` is `Route::get('/exports/qr-labels', …)->name('exports.qr-labels')`. URLs are `/shelves/{slug}/manage/qr-labels` and `/shelves/{slug}/manage/exports/qr-labels`.
- **The export becomes a POST, and its DECLARATION ORDER is load-bearing.** `routes/web.php:494` is `Route::post('/exports/{kind}', [ExportController::class, 'store'])->name('exports.run')`. A `POST /exports/qr-labels` declared *after* it matches `{kind} = 'qr-labels'` and reaches `ExportController` instead. Declare the literal first — which is where the placeholder already sits. POST rather than GET matches this repo's export convention: `tests/Feature/Oversight/ExportHttpTest.php:41` posts to `/manage/exports/books`.

**The bytes come first, and the stamp second.** OPS §3.3, opened: `ExportLabelSheetPDF` *"Writes `MarkCopiesPrinted` (§4.1) only once the bytes exist."* So the order in the controller is: expand the selection → render the PDF → `MarkCopiesPrinted` → return the download. Rendering first means a renderer that throws leaves no copy stamped as printed, which is the right way round: a manager who sees an error and retries must not have their second sheet counted as a reprint of a sheet that never existed.

**What this means for D7, stated rather than glossed.** The controller hands `MarkCopiesPrinted` the **already-expanded** copy ids, and expansion is tenancy-scoped — so on this path the count almost always equals the input size, and a selection consisting only of foreign ids arrives as `[]` and is refused by `copy_selection_empty`, not recorded as a zero. **D7 is therefore a statement about the COMMAND's contract, not a description of the common HTTP path.** It is still reachable and still right: a copy soft-deleted between expansion and stamp, or any future caller that does not pre-scope, lands in it, and OPS §4.1 is explicit that a zero-row update is a fact to record rather than a failure. Task 8's block exercises it by calling the command directly. Do not "simplify" the command by assuming its input is pre-scoped.

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
        ->get("/shelves/{$shelf->slug}/manage/qr-labels")
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('manage/labels')
            ->has('titles', 1)
            ->where('onlyUnprinted', false));
});

it('exporting returns a PDF and stamps the copies', function () {
    [$shelf, $manager, , $copy] = lblExpFix();

    $response = $this->actingAs($manager)
        ->post("/shelves/{$shelf->slug}/manage/exports/qr-labels", ['copyIds' => [$copy->id]]);

    $response->assertOk();
    expect($response->headers->get('content-type'))->toContain('application/pdf')
        ->and($copy->fresh()->qr_print_count)->toBe(1)
        ->and($copy->fresh()->qr_printed_at)->not->toBeNull();
});

it('an empty selection is refused as a rule, not a 500', function () {
    [$shelf, $manager] = lblExpFix();

    $this->actingAs($manager)
        ->post("/shelves/{$shelf->slug}/manage/exports/qr-labels", ['copyIds' => [], 'bookIds' => []])
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
        ->post("/shelves/{$shelf->slug}/manage/exports/qr-labels", ['copyIds' => [$otherCopy->id]]);

    expect($otherCopy->fresh()->qr_print_count)->toBe(0);
});

it('a reader meets 404 on both the screen and the export', function () {
    [$shelf, , , $copy] = lblExpFix();
    $reader = User::factory()->create();
    Membership::factory()->for($shelf)->create([
        'user_id' => $reader->id, 'role' => 'reader', 'status' => 'active',
    ]);

    // NOT a vacuous 404 pair, and here is the proof rather than the claim:
    // /qr-labels is ALREADY claimed by the placeholder at routes/web.php:492,
    // inside ['auth','role:manager'], so the GET block is meaningful before
    // this task changes anything. The POST is the one to watch — until the
    // verb changes at :493 the path is claimed by a GET, and an unrouted
    // METHOD on a claimed path answers 405, not 404. If this block passes with
    // 404 before the route lands, it is passing on the router's absence; check
    // it again afterwards.
    $this->actingAs($reader)->get("/shelves/{$shelf->slug}/manage/qr-labels")->assertNotFound();
    $this->actingAs($reader)
        ->post("/shelves/{$shelf->slug}/manage/exports/qr-labels", ['copyIds' => [$copy->id]])
        ->assertNotFound();
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `make test FILTER=LabelExportTest`

**Expected, precisely — and read this before believing a green block.** Both URIs are ALREADY claimed:

```
GET  /shelves/{shelf}/manage/qr-labels          → shelves.manage.qr-labels   (placeholder, :492)
POST /shelves/{shelf}/manage/exports/qr-labels  → shelves.manage.exports.run (matches exports/{kind}!)
```

So the two positive blocks fail (the GET renders `ShellController`'s page, not `manage/labels`; the POST reaches `ExportController` with `{kind} = 'qr-labels'`), and **the reader-404 block may pass for the wrong reason** — against `ExportController`'s behaviour rather than against `EnsureShelfRole`. An earlier draft of this plan claimed "no route claims either URI" and then reasoned about a 405 that cannot occur, because `exports/{kind}` already answers POST on that path. Re-check the reader block after Step 3 and confirm it refuses for the right reason.

- [ ] **Step 3: Replace the two placeholders in place**

In `routes/web.php`, change lines 492–493 — same paths, same names, new destinations, and the export's verb changed to POST. **It must stay above `Route::post('/exports/{kind}', …)` at :494**, or `{kind}` swallows it:

```php
        // BR §19's "QR labels per copy", shipped in the reference on
        // 2026-08-13 and specified at docs/superpowers/specs/2026-08-13-qr-labels-design.md.
        // OPS §3.3's ListTitlesForLabels and ExportLabelSheetPDF.
        Route::get('/qr-labels', [LabelController::class, 'index'])->name('qr-labels');
        // POST, matching this repo's export convention, and DECLARED BEFORE
        // exports/{kind} on the next line — otherwise a POST to this path
        // matches {kind} = 'qr-labels' and reaches ExportController instead.
        Route::post('/exports/qr-labels', [LabelController::class, 'export'])->name('exports.qr-labels');
        Route::post('/exports/{kind}', [ExportController::class, 'store'])->name('exports.run');
```

**Then prove the ordering matters**, because a route-order claim nobody falsified is a claim nobody tested:

```
move the exports/qr-labels line BELOW exports/{kind}
make test FILTER=LabelExportTest   → expect the export block RED
restore; git status --porcelain    → empty
```

- [ ] **Step 4: Write the Form Request and the controller**

`ExportLabelSheetRequest`: `authorize()` holds `abort_unless(Gate::allows('act-as-manager'), 404)`; rules allow `bookIds` and `copyIds` as optional arrays of uuid strings. Neither is `required` — the union may come from either, and the empty case is `MarkCopiesPrinted`'s refusal, not a field error.

`LabelController::index()` renders `manage/labels` with `titles` and the `onlyUnprinted` flag read from the query string. `LabelController::export()` expands via `CopiesForLabelsQuery`, renders via `LabelSheet`, calls `MarkCopiesPrinted` with the **expanded** copy ids, and returns the bytes as a download. Do not catch `RuleViolated` — `bootstrap/app.php` renders it once for the whole app.

**The response is a binary download, which constrains the SCREEN.** An Inertia visit cannot consume one: `router.post()` expects an Inertia response and will not hand the user a file. Task 11 must therefore submit this with a **plain HTML `<form method="post">`**, not `useForm().post()`. That also means there is no flash and no redirect on success — the browser simply receives a file — so do not write a success flash that nothing renders. Phase 2b shipped six of those and the whole-branch review is what found them.

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

An accordion of titles, each expanding to its copies with a checkbox per copy and a "select the whole title" control; a *chưa in nhãn* filter toggling `?onlyUnprinted=1`; a print count shown per copy so a reprint is visible as one; and a submit that posts the union to `shelves.manage.exports.qr-labels`.

**Submit with a plain HTML `<form method="post">`, not `useForm().post()`.** The export returns binary PDF bytes, and an Inertia visit cannot consume a binary response — the user would get nothing. Include the CSRF token as a hidden field. There is consequently **no success flash and no redirect**: the browser receives a file. Do not write a flash that no screen shows.

**Remember what this repo cannot check.** There are no frontend tests, so the *only* verifiable part is the props. Assert those; then read the component yourself for the label/value pairing and the flash, because nothing else will. In particular: the success path here is a **file download**, not a redirect with a flash — so do not write a flash the screen never shows. Phase 2b shipped six such flashes and the whole-branch review found them.

- [ ] **Step 1:** Add a `manageLabels` namespace to `copy.ts` (its own keys — no reach into `copy.manage`).
- [ ] **Step 2:** Build the screen. `resources/js/components/ui/checkbox.tsx` **does exist** — use it. So do `ui/label.tsx` and `ui/badge.tsx` (the last for the print count), and `components/input-error.tsx` (**not** under `ui/`). **Do not** reach for `Pill`, `StatusBadge`, `Field`, `CopyScanField` or `QrScanner` — AGENTS.md names those and this repo does not have them.
- [ ] **Step 3:** Add the nav item with `route("shelves.manage.qr-labels", { shelf: shelf.slug })`. **Not `shelves.manage.labels`** — an earlier draft used that name; the route keeps the placeholder's settled name `qr-labels`, verified with `artisan route:list --name=qr-labels`. Ziggy throws on an unknown name and no frontend test here would catch it.
- [ ] **Step 4:** `make test && make analyse && make lint`, then commit.

---

### Task 12: The scanner, and the two circulation flows

**Files:**
- Create: `resources/js/components/copy-scanner.tsx`
- Create: `app/Http/Controllers/Manage/ScanController.php`
- Modify: `routes/web.php:189` (**replace the reader `/scan` placeholder in place**), the lend and return screens, `resources/js/lib/copy.ts`, `package.json`
- Test: `tests/Feature/Labels/ScanResolveTest.php`

**Interfaces:**
- Consumes: `CopyByIdQuery` (7), `LabelPayload::uuidFrom()` (4).
- Produces: the resolved copy as JSON, or a 404-shaped null, from the **existing** route.
- **The route already exists, and it is in the READER group, not the manager group.** `routes/web.php:189` is `Route::get('/scan', [ShellController::class, 'underConstruction'])->name('scan')`, inside the `role:reader` group — which is exactly where OPS §3.3 puts `ResolveCopyById` ("Deliberately **not** manager-only"). **Do not invent `shelves.manage.scan`**; an earlier draft of this plan did. Replace the placeholder in place, keeping path and name.

**Decoding happens in the browser; resolution happens on the server.** The component reads the camera, hands the decoded string to `LabelPayload::uuidFrom()` server-side, and resolves through `CopyByIdQuery`. A payload that is not `OLB1:` comes back null and the component says so by name rather than searching for a copy that cannot exist.

**Check the decoder dependency rather than assuming it.** `zxing-wasm` is in `dependencies` (`package.json:49`), but **`jsqr` is in `devDependencies` (`package.json:63`)** — an earlier draft of this plan claimed both were production dependencies and that no dependency was added. If you use `jsqr`, move it to `dependencies`, or it is absent from a production install and the scanner breaks only in production. Prefer `zxing-wasm`, which is already in the right section.

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
- **`POST /exports/qr-labels` is declared before `POST /exports/{kind}`.** This one is real and worth pinning: the literal and the parameter share a path prefix **and a verb**, so registering them the other way round sends every label export to `ExportController` with `{kind} = 'qr-labels'`. Falsify it by swapping the two lines and confirming `LabelExportTest` reddens, then restore and prove the tree clean.

  **An earlier draft of this plan pinned something else and was wrong about it**: it claimed `/ma-qr` before `/ma-qr/xuat` was "the same trap" as `CommunityArchitectureTest`'s two existing blocks. It is not — those pin a literal before a *parameter* (`announcements/create` before `announcements/{announcement}`), while those two were distinct literals on different verbs, where declaration order is irrelevant. The pin above is the version of that claim which is actually true.

- [ ] **Step 2: Re-take every number this phase asserts**

Re-run the suite, Larastan, Pint, Biome and tsc, and **paste the output** rather than asserting the result. Confirm `git diff origin/main...HEAD -- old_next/` is empty. A measurement true when written can be falsified by a later commit — every number in `known-gaps.md` and `HANDOFF.md` that this phase touched gets re-taken here, not carried.

- [ ] **Step 3: Record the carries in `docs/known-gaps.md`**

At minimum:
- `MyLoanHistoryQuery`'s two hardcoded timezone literals, deliberately not fixed (D3).
- The per-shelf `bookshelves.timezone` column, deliberately not read (D3) — Phase 3.
- **The label sheet has never been through a printer.** The geometry claim is about physical paper; nothing in CI can check it.
- The scanner component is unverified by any test, and why (no frontend runner).
- Whether `smalot/pdfparser` actually extracted text from TCPDF's output, or whether the diacritic block fell back to a subset assertion. **State which**, because the two are different guarantees.
- **That D4 was amended mid-plan**, from FPDF to TCPDF, and why — FPDF requires `ext-gd` (the extension it was chosen to avoid) and cannot load a TTF at runtime. Record it as a retraction naming the original claim, not as a quiet correction.

- [ ] **Step 4: Update `docs/superpowers/HANDOFF.md`**

Add the Phase 2c row and section: what shipped, the divergences (D2 lost-copy counting; the PHP-not-SQL boundary refinement), the carries, and re-measured gate numbers **with the commit they were taken at named**, since this file has now twice carried a diffstat that matched no single base.

- [ ] **Step 5: Open the PR and hand the merge decision to Kien**

Push, open the PR, then run a **whole-branch review** with a fresh agent — it has caught what per-task review structurally cannot, in every phase so far — and a separate re-review of any fix wave that review produces, because fix waves have introduced eight of this project's sixteen false claims. **Do not merge.** The merge decision is Kien's.

---

## Self-Review

**Two review rounds, and the second one earned its place.** The rework below was itself re-reviewed, and the re-review found **one Critical that the rework had introduced**: its new `byCategory` block called `Category::factory()->for($shelf)`, but `App\Models\Category` is "Global, deliberately NOT shelf-scoped" and has no `bookshelf()` relation — the block would have thrown. That is the ninth time this project has watched a fix round introduce a fresh defect, and it is the whole argument for re-reviewing fix waves rather than trusting them. Also corrected in that pass: a stale route name (`shelves.manage.labels`, which does not exist), a RED expectation that was false because `exports/{kind}` already claims the export path, a frozen clock never released in a Unit test that gets no framework tearDown, and an overstatement in the amended D4. The re-review independently **ran** the TCPDF probe and confirmed it works.

**This plan was rejected once and reworked.** An independent Opus review returned **NEEDS REWORK** with ten Criticals and eleven Importants against the first version. That review is why the rule exists — it caught, among others, a fixture written against a `LoanFactory` that does not exist, a borrower column that is not called what the plan called it, every HTTP URI in the phase pointing at `old_next`'s path scheme, four routes invented that already existed as named placeholders, a PDF library that cannot do the one thing it was chosen for, and a test asserting the exact behaviour OPS singles out as wrong. What follows is the review of the reworked version.

**Corrections applied, and what each was.** Recorded rather than silently fixed, because a deleted false sentence has been measured coming back in this repo:

| Was | Is |
|---|---|
| `Loan::factory()` "already exists" | No `LoanFactory` exists; loans are built with `Loan::query()->create()`, as `TenantHarness.php:67` does |
| `borrower_membership_id`, passed a membership id | `borrower_id`, referencing `users` |
| Loan fixtures setting three columns | Five NOT NULL columns set; one copy per active loan, because `loans_one_active_per_copy` is a UNIQUE over a generated column |
| `/tu-sach/{shelf}/quan-ly/…` | `/shelves/{slug}/manage/…` |
| Four new routes | Four existing placeholders replaced in place, names unchanged |
| `setasign/fpdf` | `tecnickcom/tcpdf` ^6.11 — FPDF requires `ext-gd` and cannot load a TTF at runtime |
| A retired copy with no `retired_reason` | `retired_reason` set, per `book_copies_retired_has_reason` |
| "Refuse when scoping leaves it empty" | Succeeds with a count of zero, per OPS §4.1 and the new D7 |
| `OPS §4.4's copy_selection_empty` | OPS **§4.1** — §4.4 is Community |
| A route-order pin that guarded nothing | `POST /exports/qr-labels` before `POST /exports/{kind}`, which genuinely collides |

**Spec coverage.** Every section of the design maps to a task: D1 → Task 4; D2 → Task 2; D3 → Task 1; D4 (amended) → Tasks 4 and 9; D5 → Task 9; D6 → Task 3; D7 → Task 8. Slice A → Tasks 1–3; Slice B's five operations → Tasks 5–10; its screen → Task 11; its scanner → Task 12. **The four statistics figures the first version left untested — `booksAdded`, `byCategory`, `topBooks`, `topReaders` — now have blocks**, which the first self-review claimed coverage of without checking.

**Two spec refinements, both recorded rather than hidden.** The spec proposed rebuilding `date_trunc` as MariaDB expressions and verified they run; Task 1 computes the boundary in PHP instead, which removes the problem. And the period parameter is `?period=` where the reference uses `?ky=` — numbered in Task 2, since this project numbers divergences.

**Placeholder scan.** No "TBD", no "similar to Task N", no "add appropriate error handling". Tasks 11 and 12 carry prose steps rather than component code — deliberate, because this repo has no frontend test runner and code written blind into a plan would be a false promise of verification. Both name exact files, props, permitted components and the specific traps.

**Type consistency.** `StatsPeriod` (1) → 2, 3. `LabelPayload::encode`/`uuidFrom` (4) → 9, 12. `CopiesForLabelsQuery::run(array, array, bool)` (6) → 10 at that arity. `LabelSheet::render()` takes Task 6's row shape minus `printCount`, stated in both places. `MarkCopiesPrinted::execute(User, array): array{count: int}` (8) → 10.

**`->and()` ordering.** A failed `expect()` aborts the whole Pest method and `->and()` short-circuits, so every block whose title names a specific fact now asserts that fact **first**, in separate `expect()` statements rather than one chain. Fixed in Task 2's borrowers block, Task 8's tenancy block and Task 10's export block.

**Known risks carried into execution.** Task 9 remains the only task whose central claim cannot be settled in CI, because it is about ink on paper — Task 13 Step 3 requires that written down rather than assumed away. And TCPDF's `addTTFfont()` returning `false` on Lexend would be a D4-level finding; Task 9 Step 2 settles it with a throwaway probe **before** any sheet code is written, rather than discovering it at the end.
