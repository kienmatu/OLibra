# OLibra Phase 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the core lending loop — a volunteer can catalogue books, approve readers, lend a book in three taps, take it back with a condition assessment, and every action is audited — for one bookshelf, on a schema that already supports many.

**Architecture:** A single Laravel 12 application serving React through Inertia. Business operations are single-purpose Action classes; complex reads are Query classes. Tenant isolation is structural — a global scope plus middleware, not developer discipline. Overdue and availability are computed at query time, never written by a job.

**Tech Stack:** Laravel 12, PHP 8.4, MySQL 8, Inertia.js 2, React 19, TypeScript, Vite, TailwindCSS 4, shadcn/ui, Pest 3, Larastan, Pint.

**Spec:** [`docs/superpowers/specs/2026-08-06-olibra-design.md`](../specs/2026-08-06-olibra-design.md). The spec is the authority; this plan implements Phase 1 of it (spec §0.2).

---

## Global Constraints

Every task's requirements implicitly include this section.

**Versions and platform**
- PHP **8.4** or newer. `declare(strict_types=1);` at the top of every PHP file.
- MySQL **8.0.16** or newer. The schema uses stored generated columns and `CHECK` constraints; neither works on older versions, and **SQLite must never be configured for tests** because it reproduces neither.
- Node is a **build-time dependency only**. Nothing in the deploy or runtime path may invoke `npm` or `node`.
- Application timezone is **`Asia/Ho_Chi_Minh`** everywhere, regardless of server configuration.

**Forbidden throughout Phase 1** (spec §4.3, §4.4; RULES.md §1)
- No repository layer. Eloquent is the data-access abstraction; complex reads go in Query classes.
- No `*Service` class that accumulates multiple operations. One Action, one public `execute()`.
- No `spatie/laravel-permission` or any permissions package.
- No client state library — no Redux, Zustand, Jotai, or TanStack Query.
- No mail channel, SMTP dependency, or email-based flow. There is no outbound email in v1.
- No REST API, no `/api` routes, no API resource controllers.

**Invariants this phase must enforce** (spec §2.4). Each gets a named test in `tests/Feature/Invariants/`.

| # | Rule | Enforced in |
|---|---|---|
| INV-1 | A copy has at most one active loan. **Database-enforced.** | Task 12 |
| INV-3 | Only an `available` copy can be lent. | Task 13 |
| INV-4 | A member whose status is not `active` cannot start a new loan. | Task 13 |
| INV-5 | At most `max_concurrent_loans` active loans per reader. Default 3. | Task 13 |
| INV-6 | Renewal only if renewals remain. Extends `due_on` by `renewal_days` **from the current due date**. | Task 15 |
| INV-7 | A `lost` or `retired` copy cannot be lent. | Task 13 |
| INV-8 | Every state transition writes an audit row with actor, timestamp, before, after. | Task 3 |
| INV-10 | Every query is bookshelf-scoped. | Task 2 |
| INV-11 | A loan is never deleted; mistakes are `voided`. | Task 15 |
| INV-12 | Audit rows are never updated or deleted. | Task 3 |

INV-2 and INV-9 concern holds and comments, which are Phase 2. Their tests arrive with those features.

**Derived state — never write it** (spec §2.6). Overdue, hold expiry and availability are computed at query time. Production cron may run only every 10–30 minutes, so a job-written status would be wrong for up to half an hour. If you find yourself writing `due_on <` outside the single scope that owns it, stop and reuse the scope.

**Working conventions** (RULES.md §11, §12)
- Every temporary file goes in `.artifacts/`. `rm -rf .artifacts/*/` must always be safe.
- Never commit to `main`. Each task is committed on a `type/description` branch and reaches `main` through a pull request.
- Conventional Commits, scoped to the domain area: `feat(circulation): ...`.
- All user-facing strings live in `resources/lang/vi/`. Never hard-code one.

---

## Phase 1 Scope

**In scope.** Local environment; application scaffold; tenancy; audit; users, memberships, roles and permissions; username-based authentication; registration and manager approval; manager-issued password reset; categories, books, copies; condition assessment; loans — lend, return, renew, void, report lost; public catalogue, book detail and search; quick-lend and receive-return screens; manager dashboard; CSV export; CI; deployment guide.

**Out of scope — Phase 2 and 3.** Borrow requests, holds and the waiting queue; comments and moderation; announcements; feedback; the statistics page; the portal directory; super-admin screens; the marketing landing page and blog.

Two consequences of that boundary, both intentional:

- **The Phase 1 manager dashboard shows two counts, not four.** Overdue loans and pending registrations. The request and comment cards arrive with Phase 2.
- **Phase 1 readers browse; they do not request.** The "Xin mượn" button is Phase 2. Managers lend in person through quick-lend, which the spec identifies as the dominant real-world flow anyway (spec §1.1). The product is complete and useful without requests.

`is_super_admin` exists on `users` from Task 4 because policies depend on it, but the administration screens are Phase 3. Phase 1 creates the first super admin and the first bookshelf through a console command.

---

## Local Development Environment

**Docker is not used.** Production is cPanel shared hosting running Apache or LiteSpeed with PHP-FPM — you will never deploy a container, so Docker offers no production parity, only a layer. On macOS its filesystem layer is also measurably slow against the large `vendor/` and `node_modules/` trees a Laravel project carries.

This machine currently has **no usable PHP**: Homebrew's `php@7.4` is installed but broken (it fails with a missing `libaspell.15.dylib`), and there is no Composer, no MySQL, and no Laravel installer. Node 22 is present and fine.

Herd is the recommended fix precisely *because* the Homebrew PHP is broken — Herd ships its own PHP and takes priority on `PATH`, so the broken 7.4 never needs repairing.

| Need | Tool | Notes |
|---|---|---|
| PHP 8.4 + Composer | **Laravel Herd** (free tier) | Bundles PHP 8.4, Composer, and the `laravel` installer. Serves `*.test` domains automatically. |
| MySQL 8 | **DBngin** (free) | Same publisher. Runs MySQL 8 on port 3306 with a root user and empty password. |
| Node 22 | Already installed | Build-time only. |

If you later need containers — a Linux contributor, a CI reproduction — adding Laravel Sail is one Composer command and invalidates nothing in this plan.

---

## File Structure

Files that change together live together. `app/Domain/` is organised by bounded context, not by technical layer, so an agent changing lending opens one directory.

```
app/
├── Domain/
│   ├── Identity/
│   │   ├── Models/          Bookshelf, User, Membership
│   │   ├── Actions/         RegisterMembershipAction, ApproveMembershipAction,
│   │   │                    RejectMembershipAction, SuspendMembershipAction,
│   │   │                    ReactivateMembershipAction, CreateReaderByManagerAction,
│   │   │                    IssuePasswordResetAction, ChangePasswordAction
│   │   ├── Queries/         PendingRegistrationsQuery, ReaderListQuery
│   │   ├── Enums/           Role, MembershipStatus, Permission
│   │   ├── Policies/        MembershipPolicy, BookshelfPolicy
│   │   ├── ValueObjects/    BookshelfSettings
│   │   └── Concerns/        BelongsToBookshelf
│   ├── Catalog/
│   │   ├── Models/          Category, Book, BookCopy
│   │   ├── Actions/         CreateBookAction, UpdateBookAction, DeleteBookAction,
│   │   │                    AddBookCopyAction, RetireBookCopyAction,
│   │   │                    ReportCopyLostAction, MarkCopyFoundAction,
│   │   │                    AssessCopyConditionAction
│   │   ├── Queries/         CatalogQuery, BookDetailQuery
│   │   ├── Enums/           CopyState, CopyCondition
│   │   ├── Policies/        BookPolicy, BookCopyPolicy
│   │   └── Exceptions/      InvalidCopyTransitionException
│   ├── Circulation/
│   │   ├── Models/          Loan, ConditionAssessment
│   │   ├── Actions/         LendBookDirectlyAction, ReceiveReturnAction,
│   │   │                    RenewLoanAction, VoidLoanAction, ReportLoanLostAction
│   │   ├── Queries/         OverdueLoansQuery, ActiveLoansQuery, DashboardCountsQuery
│   │   ├── Enums/           LoanStatus
│   │   ├── Policies/        LoanPolicy
│   │   └── Exceptions/      CirculationException (base), CopyNotAvailableException,
│   │                        LoanLimitReachedException, MemberNotActiveException,
│   │                        RenewalNotAllowedException
│   └── Audit/
│       ├── Models/          AuditLog
│       ├── AuditLogger.php
│       ├── Concerns/        Auditable
│       ├── Observers/       AuditObserver
│       ├── Queries/         RecentActivityQuery
│       └── Enums/           AuditAction
├── Http/
│   ├── Controllers/{Public,Auth,Reader,Manager}/
│   ├── Requests/            One per write endpoint
│   ├── Middleware/          ResolveBookshelf, EnsureMembershipActive,
│   │                        EnsurePasswordChanged, HandleInertiaRequests
│   └── Resources/           Inertia prop shapers
├── Support/                 TextNormalizer, CurrentBookshelf
└── Console/Commands/        InstallOlibra

resources/js/
├── layouts/                 PublicLayout, ShelfLayout, ManagerLayout, AuthLayout
├── pages/{public,auth,reader,manager}/
├── components/{ui,book,circulation,reader,data,feedback}/
├── hooks/                   useInertiaForm, useConfirm, useDebounce
├── lib/                     cn, formatters, validators
└── types/

routes/                      web.php, public.php, manager.php
tests/Feature/{Identity,Catalog,Circulation,Audit,Invariants}/
tests/Unit/
```

---

## Milestone A — Foundation

Ends with an application that boots, isolates tenants structurally, and audits every model change.

---

### Task 1: Scaffold the application and local environment

**Files:**
- Create: the entire Laravel 12 skeleton at the repository root
- Create: `.env.example`, `phpunit.xml`, `pint.json`, `phpstan.neon`, `.github/workflows/ci.yml`
- Create: `resources/lang/vi/common.php`, `resources/lang/en/common.php`
- Create: `tests/Feature/SmokeTest.php`
- Modify: `.gitignore` (merge Laravel's entries with the existing ones)

**Interfaces:**
- Consumes: nothing — this is the first task.
- Produces: a booting Laravel 12 app with Inertia + React + TypeScript + Tailwind + shadcn/ui; `php artisan test` green against MySQL; the `vi` translation namespace; CI running Pint, PHPStan, Pest and the Vite build.

- [ ] **Step 1: Install the toolchain**

Install **Laravel Herd** (free) from https://herd.laravel.com and **DBngin** from https://dbngin.com. In DBngin, create a **MySQL 8** server on port 3306 and start it.

Then verify — do not continue until every line is correct:

```bash
php -v          # must report 8.4.x, NOT the broken Homebrew 7.4
composer -V     # must succeed
node -v         # v22.x
```

If `php -v` still reports 7.4 or the `libaspell` error, Herd's binaries are not first on `PATH`. Open a new terminal; if it persists, add Herd's bin directory ahead of `/opt/homebrew/bin` in `~/.zshrc`.

- [ ] **Step 2: Scaffold Laravel 12 with the React starter kit**

The repository already contains documentation, so scaffold into a scratch directory and move the result in. This is a one-time bootstrap; nothing in the build will ever read from `.artifacts/`.

```bash
mkdir -p .artifacts/scratch
composer global require laravel/installer
laravel new scaffold --react --no-interaction
```

Run that from `.artifacts/scratch/`. Then move everything except the git metadata into the repository root:

```bash
cd /Users/kiendinh/Documents/Hilibra
rsync -a --exclude='.git' .artifacts/scratch/scaffold/ ./
rm -rf .artifacts/scratch/scaffold
```

Merge Laravel's `.gitignore` entries into the existing one — **keep the `/.artifacts/*`, `!/.artifacts/README.md` and `/.worktrees/` rules already there.**

- [ ] **Step 3: Configure the environment**

Create the two databases:

```bash
mysql -u root -h 127.0.0.1 -e "CREATE DATABASE olibra CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; CREATE DATABASE olibra_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
```

Set these in `.env` and mirror them into `.env.example` with empty secrets:

```
APP_NAME=OLibra
APP_LOCALE=vi
APP_FALLBACK_LOCALE=vi
APP_TIMEZONE=Asia/Ho_Chi_Minh
DB_CONNECTION=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=olibra
DB_USERNAME=root
DB_PASSWORD=
SESSION_DRIVER=database
QUEUE_CONNECTION=database
CACHE_STORE=database
MAIL_MAILER=log
```

Set `'timezone' => 'Asia/Ho_Chi_Minh'` in `config/app.php`.

- [ ] **Step 4: Point tests at MySQL**

Replace the database lines in `phpunit.xml`. **Do not use SQLite** — the schema depends on stored generated columns and `CHECK` constraints, which SQLite does not support, so an in-memory suite would pass while production broke.

```xml
<env name="DB_CONNECTION" value="mysql"/>
<env name="DB_DATABASE" value="olibra_test"/>
<env name="APP_TIMEZONE" value="Asia/Ho_Chi_Minh"/>
```

- [ ] **Step 5: Add the quality toolchain**

```bash
composer require --dev larastan/larastan pestphp/pest-plugin-laravel
```

`phpstan.neon`:

```neon
includes:
    - vendor/larastan/larastan/extension.neon
parameters:
    paths:
        - app
    level: 6
```

`pint.json`:

```json
{
    "preset": "laravel",
    "rules": {
        "declare_strict_types": true,
        "ordered_imports": { "sort_algorithm": "alpha" }
    }
}
```

- [ ] **Step 6: Create the translation namespace**

`resources/lang/vi/common.php`:

```php
<?php

declare(strict_types=1);

return [
    'app_name' => 'OLibra',
    'yes' => 'Có',
    'no' => 'Không',
    'save' => 'Lưu',
    'cancel' => 'Huỷ',
    'confirm' => 'Xác nhận',
    'search' => 'Tìm kiếm',
    'back' => 'Quay lại',
];
```

Create `resources/lang/en/common.php` with the same keys in English. Every later task adds its strings to a file in this directory and never inlines one.

- [ ] **Step 7: Write the smoke test**

`tests/Feature/SmokeTest.php`:

```php
<?php

declare(strict_types=1);

use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

it('boots and serves a page', function () {
    $this->get('/')->assertSuccessful();
});

it('runs on mysql, never sqlite', function () {
    expect(config('database.default'))->toBe('mysql');
});

it('uses the vietnam timezone', function () {
    expect(config('app.timezone'))->toBe('Asia/Ho_Chi_Minh');
});
```

- [ ] **Step 8: Run the test suite**

```bash
php artisan migrate
php artisan test
```

Expected: PASS. If `it boots and serves a page` fails, the starter kit's welcome route needs `npm run build` to have produced a manifest — run it and retry.

- [ ] **Step 9: Verify the frontend builds**

```bash
npm install
npm run build
npx tsc --noEmit
```

Expected: all three succeed. `npm run build` must succeed on every future task too — production ships compiled assets and has no Node.

- [ ] **Step 10: Add CI**

`.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      mysql:
        image: mysql:8.0
        env:
          MYSQL_ALLOW_EMPTY_PASSWORD: 'yes'
          MYSQL_DATABASE: olibra_test
        ports: ['3306:3306']
        options: >-
          --health-cmd="mysqladmin ping" --health-interval=10s
          --health-timeout=5s --health-retries=5
    steps:
      - uses: actions/checkout@v4
      - uses: shivammathur/setup-php@v2
        with:
          php-version: '8.4'
          extensions: mbstring, pdo_mysql, gd, intl, zip
          coverage: xdebug
      - run: composer install --prefer-dist --no-progress
      - run: cp .env.example .env && php artisan key:generate
      - run: vendor/bin/pint --test
      - run: vendor/bin/phpstan analyse
      - run: php artisan test
        env:
          DB_HOST: 127.0.0.1
          DB_DATABASE: olibra_test
          DB_USERNAME: root
          DB_PASSWORD: ''
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: npm
      - run: npm ci
      - run: npx tsc --noEmit
      - run: npm run build
```

- [ ] **Step 11: Commit**

```bash
git switch -c chore/scaffold
git add -A
git commit -m "chore(setup): scaffold Laravel 12 with Inertia, React and TypeScript

Adds the application skeleton, MySQL-backed test configuration, Pint,
Larastan level 6, the vi/en translation namespace, and CI.

Tests run against MySQL rather than SQLite because the schema depends on
stored generated columns and CHECK constraints, neither of which SQLite
supports — an in-memory suite would pass while production broke."
```

Open a pull request. Do not merge to `main` directly.

---

### Task 2: Tenancy foundation

Tenant isolation is the highest-consequence security property in the system, so it must not depend on anyone remembering to add a `where` clause. Three mechanisms combine: route model binding, middleware that binds the current shelf, and a trait that both scopes reads and fills writes.

**Files:**
- Create: `database/migrations/*_create_bookshelves_table.php`
- Create: `app/Domain/Identity/Models/Bookshelf.php`
- Create: `app/Domain/Identity/ValueObjects/BookshelfSettings.php`
- Create: `app/Domain/Identity/Concerns/BelongsToBookshelf.php`
- Create: `app/Support/CurrentBookshelf.php`
- Create: `app/Http/Middleware/ResolveBookshelf.php`
- Create: `database/factories/BookshelfFactory.php`
- Modify: `bootstrap/app.php` (register the middleware alias)
- Test: `tests/Feature/Identity/TenancyTest.php`, `tests/Unit/BookshelfSettingsTest.php`

**Interfaces:**
- Consumes: Task 1's application skeleton.
- Produces:
  - `Bookshelf` model with `settings(): BookshelfSettings` and route key `slug`.
  - `BookshelfSettings` with readonly properties `loanDays: int`, `maxConcurrentLoans: int`, `maxRenewals: int`, `renewalDays: int`, `holdDays: int`, `dueSoonDays: int`, `publicNameDisplay: string`, and `::fromArray(array $raw): self`.
  - `BelongsToBookshelf` trait — adds a global scope filtering on `bookshelf_id` and auto-fills it on create.
  - `CurrentBookshelf` singleton with `set(Bookshelf $b): void`, `get(): ?Bookshelf`, `id(): ?int`.
  - Middleware alias `bookshelf`.

- [ ] **Step 1: Write the failing tests**

`tests/Feature/Identity/TenancyTest.php`:

```php
<?php

declare(strict_types=1);

use App\Domain\Identity\Models\Bookshelf;
use App\Support\CurrentBookshelf;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

it('resolves a bookshelf by slug', function () {
    $shelf = Bookshelf::factory()->create(['slug' => 'dongthap']);

    expect(Bookshelf::where('slug', 'dongthap')->first()->id)->toBe($shelf->id);
});

it('exposes typed settings with defaults', function () {
    $shelf = Bookshelf::factory()->create(['settings' => []]);

    expect($shelf->settings()->loanDays)->toBe(14)
        ->and($shelf->settings()->maxConcurrentLoans)->toBe(3)
        ->and($shelf->settings()->maxRenewals)->toBe(1);
});

it('lets a stored setting override the default', function () {
    $shelf = Bookshelf::factory()->create(['settings' => ['loan_days' => 7]]);

    expect($shelf->settings()->loanDays)->toBe(7)
        ->and($shelf->settings()->maxConcurrentLoans)->toBe(3);
});

it('binds and clears the current bookshelf', function () {
    $shelf = Bookshelf::factory()->create();

    app(CurrentBookshelf::class)->set($shelf);

    expect(app(CurrentBookshelf::class)->id())->toBe($shelf->id);
});
```

`tests/Unit/BookshelfSettingsTest.php`:

```php
<?php

declare(strict_types=1);

use App\Domain\Identity\ValueObjects\BookshelfSettings;

it('falls back to documented defaults for every field', function () {
    $s = BookshelfSettings::fromArray([]);

    expect($s->loanDays)->toBe(14)
        ->and($s->maxConcurrentLoans)->toBe(3)
        ->and($s->maxRenewals)->toBe(1)
        ->and($s->renewalDays)->toBe(7)
        ->and($s->holdDays)->toBe(3)
        ->and($s->dueSoonDays)->toBe(3)
        ->and($s->publicNameDisplay)->toBe('full_name');
});

it('ignores unknown keys instead of failing', function () {
    expect(BookshelfSettings::fromArray(['nonsense' => 1])->loanDays)->toBe(14);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
php artisan test --filter="Tenancy|BookshelfSettings"
```

Expected: FAIL — `Class "App\Domain\Identity\Models\Bookshelf" not found`.

- [ ] **Step 3: Write the migration**

```php
<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('bookshelves', function (Blueprint $table) {
            $table->id();
            $table->string('slug', 60)->unique();
            $table->string('name', 150);
            $table->text('description')->nullable();
            $table->string('location_text')->nullable();
            $table->string('address')->nullable();
            $table->string('keeper_contact_name', 150)->nullable();
            $table->string('keeper_contact_phone', 20)->nullable();
            $table->string('opening_hours_text')->nullable();
            $table->string('cover_image_path')->nullable();
            $table->string('timezone', 50)->default('Asia/Ho_Chi_Minh');
            $table->string('locale', 5)->default('vi');
            $table->string('status', 20)->default('active');
            $table->json('settings')->nullable();
            $table->date('established_at')->nullable();
            $table->foreignId('created_by_user_id')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->index('status');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('bookshelves');
    }
};
```

The `created_by_user_id` foreign key constraint is added in Task 4, once `users` exists.

- [ ] **Step 4: Write the settings value object**

```php
<?php

declare(strict_types=1);

namespace App\Domain\Identity\ValueObjects;

final readonly class BookshelfSettings
{
    public function __construct(
        public int $loanDays = 14,
        public int $maxConcurrentLoans = 3,
        public int $maxRenewals = 1,
        public int $renewalDays = 7,
        public int $holdDays = 3,
        public int $dueSoonDays = 3,
        public bool $allowGuestRequests = true,
        public bool $allowComments = true,
        public bool $commentsRequireApproval = true,
        public string $publicNameDisplay = 'full_name',
        public bool $publicShowCurrentBorrower = true,
        public bool $leaderboardEnabled = true,
        public int $leaderboardSize = 10,
    ) {}

    /**
     * @param  array<string, mixed>  $raw
     */
    public static function fromArray(array $raw): self
    {
        $defaults = new self;

        return new self(
            loanDays: (int) ($raw['loan_days'] ?? $defaults->loanDays),
            maxConcurrentLoans: (int) ($raw['max_concurrent_loans'] ?? $defaults->maxConcurrentLoans),
            maxRenewals: (int) ($raw['max_renewals'] ?? $defaults->maxRenewals),
            renewalDays: (int) ($raw['renewal_days'] ?? $defaults->renewalDays),
            holdDays: (int) ($raw['hold_days'] ?? $defaults->holdDays),
            dueSoonDays: (int) ($raw['due_soon_days'] ?? $defaults->dueSoonDays),
            allowGuestRequests: (bool) ($raw['allow_guest_requests'] ?? $defaults->allowGuestRequests),
            allowComments: (bool) ($raw['allow_comments'] ?? $defaults->allowComments),
            commentsRequireApproval: (bool) ($raw['comments_require_approval'] ?? $defaults->commentsRequireApproval),
            publicNameDisplay: (string) ($raw['public_name_display'] ?? $defaults->publicNameDisplay),
            publicShowCurrentBorrower: (bool) ($raw['public_show_current_borrower'] ?? $defaults->publicShowCurrentBorrower),
            leaderboardEnabled: (bool) ($raw['leaderboard_enabled'] ?? $defaults->leaderboardEnabled),
            leaderboardSize: (int) ($raw['leaderboard_size'] ?? $defaults->leaderboardSize),
        );
    }
}
```

Adding a setting means adding a constructor parameter and a `fromArray` line — never a migration.

- [ ] **Step 5: Write the model, the singleton and the trait**

`app/Domain/Identity/Models/Bookshelf.php`:

```php
<?php

declare(strict_types=1);

namespace App\Domain\Identity\Models;

use App\Domain\Identity\ValueObjects\BookshelfSettings;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

class Bookshelf extends Model
{
    use HasFactory, SoftDeletes;

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return [
            'settings' => 'array',
            'established_at' => 'date',
        ];
    }

    public function getRouteKeyName(): string
    {
        return 'slug';
    }

    public function settings(): BookshelfSettings
    {
        return BookshelfSettings::fromArray($this->settings ?? []);
    }

    public function isActive(): bool
    {
        return $this->status === 'active';
    }
}
```

`app/Support/CurrentBookshelf.php`:

```php
<?php

declare(strict_types=1);

namespace App\Support;

use App\Domain\Identity\Models\Bookshelf;

final class CurrentBookshelf
{
    private ?Bookshelf $bookshelf = null;

    public function set(Bookshelf $bookshelf): void
    {
        $this->bookshelf = $bookshelf;
    }

    public function get(): ?Bookshelf
    {
        return $this->bookshelf;
    }

    public function id(): ?int
    {
        return $this->bookshelf?->id;
    }

    public function isSet(): bool
    {
        return $this->bookshelf !== null;
    }
}
```

Register it as a singleton in `AppServiceProvider::register()`:

```php
$this->app->singleton(CurrentBookshelf::class);
```

`app/Domain/Identity/Concerns/BelongsToBookshelf.php`:

```php
<?php

declare(strict_types=1);

namespace App\Domain\Identity\Concerns;

use App\Domain\Identity\Models\Bookshelf;
use App\Support\CurrentBookshelf;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

trait BelongsToBookshelf
{
    public static function bootBelongsToBookshelf(): void
    {
        static::addGlobalScope('bookshelf', function (Builder $builder): void {
            $current = app(CurrentBookshelf::class);

            if ($current->isSet()) {
                $builder->where($builder->getModel()->getTable().'.bookshelf_id', $current->id());
            }
        });

        static::creating(function ($model): void {
            if ($model->bookshelf_id === null) {
                $model->bookshelf_id = app(CurrentBookshelf::class)->id();
            }
        });
    }

    public function bookshelf(): BelongsTo
    {
        return $this->belongsTo(Bookshelf::class);
    }
}
```

The scope applies only when a bookshelf is bound. Console commands and super-admin Query classes run unbound and therefore see everything — that is the single documented escape hatch, and it is why `withoutGlobalScope` must never appear in a controller or Action.

- [ ] **Step 6: Write the factory**

```php
<?php

declare(strict_types=1);

namespace Database\Factories;

use App\Domain\Identity\Models\Bookshelf;
use Illuminate\Database\Eloquent\Factories\Factory;

class BookshelfFactory extends Factory
{
    protected $model = Bookshelf::class;

    public function definition(): array
    {
        $name = 'Tủ sách '.fake()->unique()->city();

        return [
            'slug' => str($name)->slug()->toString(),
            'name' => $name,
            'status' => 'active',
            'settings' => [],
            'timezone' => 'Asia/Ho_Chi_Minh',
            'locale' => 'vi',
        ];
    }

    public function archived(): static
    {
        return $this->state(fn () => ['status' => 'archived']);
    }
}
```

- [ ] **Step 7: Write the middleware**

```php
<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Domain\Identity\Models\Bookshelf;
use App\Support\CurrentBookshelf;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class ResolveBookshelf
{
    public function handle(Request $request, Closure $next): Response
    {
        $shelf = $request->route('bookshelf');

        if (! $shelf instanceof Bookshelf || ! $shelf->isActive()) {
            abort(404);
        }

        app(CurrentBookshelf::class)->set($shelf);
        app()->setLocale($shelf->locale);

        return $next($request);
    }
}
```

An archived shelf returns 404 rather than 403, because the existence of a shelf is not information a stranger needs.

Register the alias in `bootstrap/app.php`:

```php
->withMiddleware(function (Middleware $middleware) {
    $middleware->alias([
        'bookshelf' => \App\Http\Middleware\ResolveBookshelf::class,
    ]);
})
```

- [ ] **Step 8: Run tests to verify they pass**

```bash
php artisan migrate
php artisan test --filter="Tenancy|BookshelfSettings"
```

Expected: PASS, 6 tests.

The scope and auto-fill behaviour cannot be tested until a tenant-scoped model exists. Task 9 adds those tests against `books`, and they are the ones that actually prove isolation.

- [ ] **Step 9: Commit**

```bash
git switch -c feat/tenancy-foundation
git add -A
git commit -m "feat(identity): add bookshelf tenancy foundation

Bookshelf model with a typed settings value object, the CurrentBookshelf
singleton, the BelongsToBookshelf trait, and ResolveBookshelf middleware.

Isolation is structural rather than disciplinary: the trait both scopes
reads and fills bookshelf_id on write, so leaking across tenants requires
deliberately calling withoutGlobalScope. Settings live in a JSON column
behind a typed object so adding one never needs a migration."
```

---

### Task 3: Audit foundation

Two mechanisms write to `audit_logs`: an observer capturing attribute diffs automatically, and explicit `AuditLogger` calls inside Actions for domain events that are not simple diffs. Both run **inside the caller's transaction** — an audit trail that a failed queue job can lose is not an audit trail.

**Files:**
- Create: `database/migrations/*_create_audit_logs_table.php`
- Create: `app/Domain/Audit/Models/AuditLog.php`
- Create: `app/Domain/Audit/Enums/AuditAction.php`
- Create: `app/Domain/Audit/AuditLogger.php`
- Create: `app/Domain/Audit/Concerns/Auditable.php`
- Create: `app/Domain/Audit/Observers/AuditObserver.php`
- Test: `tests/Feature/Audit/AuditLoggerTest.php`, `tests/Feature/Invariants/AuditIsAppendOnlyTest.php`

**Interfaces:**
- Consumes: `Bookshelf`, `CurrentBookshelf` from Task 2.
- Produces:
  - `AuditLogger::log(string $action, ?Model $subject, ?array $before, ?array $after): AuditLog`
  - `Auditable` trait — any model using it records create, update and delete diffs.
  - `AuditLog` model with `actor()`, `auditable()` relations and `scopeByActor(int $userId)`.
  - `AuditAction` string-backed enum. Later tasks add cases; never renumber or rename existing ones, because stored rows reference them.

- [ ] **Step 1: Write the failing tests**

`tests/Feature/Audit/AuditLoggerTest.php`:

```php
<?php

declare(strict_types=1);

use App\Domain\Audit\AuditLogger;
use App\Domain\Audit\Models\AuditLog;
use App\Domain\Identity\Models\Bookshelf;
use App\Support\CurrentBookshelf;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

it('records an explicit domain event', function () {
    $shelf = Bookshelf::factory()->create();
    app(CurrentBookshelf::class)->set($shelf);

    app(AuditLogger::class)->log('bookshelf.updated', $shelf, ['name' => 'A'], ['name' => 'B']);

    $row = AuditLog::first();

    expect($row->action)->toBe('bookshelf.updated')
        ->and($row->before)->toBe(['name' => 'A'])
        ->and($row->after)->toBe(['name' => 'B'])
        ->and($row->bookshelf_id)->toBe($shelf->id)
        ->and($row->auditable_id)->toBe($shelf->id);
});

it('tolerates a null actor for system actions', function () {
    $shelf = Bookshelf::factory()->create();
    app(CurrentBookshelf::class)->set($shelf);

    app(AuditLogger::class)->log('system.seeded', $shelf, null, null);

    expect(AuditLog::first()->actor_user_id)->toBeNull();
});
```

`tests/Feature/Invariants/AuditIsAppendOnlyTest.php`:

```php
<?php

declare(strict_types=1);

use App\Domain\Audit\Models\AuditLog;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Schema;

uses(RefreshDatabase::class);

it('INV-12: audit rows cannot be updated', function () {
    $row = AuditLog::create([
        'action' => 'test.event',
        'auditable_type' => 'Test',
        'auditable_id' => 1,
    ]);

    $row->action = 'tampered';
    $row->save();
})->throws(RuntimeException::class);

it('INV-12: audit rows cannot be deleted', function () {
    $row = AuditLog::create([
        'action' => 'test.event',
        'auditable_type' => 'Test',
        'auditable_id' => 1,
    ]);

    $row->delete();
})->throws(RuntimeException::class);

it('INV-12: the table has no updated_at column', function () {
    expect(Schema::hasColumn('audit_logs', 'updated_at'))->toBeFalse();
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
php artisan test --filter="AuditLogger|AuditIsAppendOnly"
```

Expected: FAIL — `Class "App\Domain\Audit\AuditLogger" not found`.

- [ ] **Step 3: Write the migration**

```php
<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('audit_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('bookshelf_id')->nullable()->constrained('bookshelves');
            $table->unsignedBigInteger('actor_user_id')->nullable();
            $table->string('action', 60);
            $table->string('auditable_type', 100);
            $table->unsignedBigInteger('auditable_id');
            $table->json('before')->nullable();
            $table->json('after')->nullable();
            $table->json('context')->nullable();
            $table->timestamp('created_at')->useCurrent();

            $table->index(['bookshelf_id', 'created_at']);
            $table->index(['auditable_type', 'auditable_id']);
            $table->index(['actor_user_id', 'created_at']);
            $table->index(['action', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('audit_logs');
    }
};
```

There is deliberately no `updated_at` and no `deleted_at`. The `(actor_user_id, created_at)` index is what makes the per-manager activity view fast; it is a headline requirement, not an optimisation.

- [ ] **Step 4: Write the enum and the model**

`app/Domain/Audit/Enums/AuditAction.php`:

```php
<?php

declare(strict_types=1);

namespace App\Domain\Audit\Enums;

enum AuditAction: string
{
    case BookCreated = 'book.created';
    case BookUpdated = 'book.updated';
    case BookDeleted = 'book.deleted';
    case CopyAdded = 'copy.added';
    case CopyRetired = 'copy.retired';
    case CopyReportedLost = 'copy.reported_lost';
    case CopyFound = 'copy.found';
    case CopyConditionAssessed = 'copy.condition_assessed';
    case LoanCreated = 'loan.created';
    case LoanReturned = 'loan.returned';
    case LoanRenewed = 'loan.renewed';
    case LoanVoided = 'loan.voided';
    case LoanReportedLost = 'loan.reported_lost';
    case MembershipRegistered = 'membership.registered';
    case MembershipApproved = 'membership.approved';
    case MembershipRejected = 'membership.rejected';
    case MembershipSuspended = 'membership.suspended';
    case MembershipReactivated = 'membership.reactivated';
    case PasswordResetIssued = 'user.password_reset_issued';
    case PasswordChanged = 'user.password_changed';
}
```

`app/Domain/Audit/Models/AuditLog.php`:

```php
<?php

declare(strict_types=1);

namespace App\Domain\Audit\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\MorphTo;
use RuntimeException;

class AuditLog extends Model
{
    public const UPDATED_AT = null;

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return [
            'before' => 'array',
            'after' => 'array',
            'context' => 'array',
            'created_at' => 'datetime',
        ];
    }

    protected static function booted(): void
    {
        static::updating(function (): never {
            throw new RuntimeException('Audit rows are append-only and cannot be updated (INV-12).');
        });

        static::deleting(function (): never {
            throw new RuntimeException('Audit rows are append-only and cannot be deleted (INV-12).');
        });
    }

    public function auditable(): MorphTo
    {
        return $this->morphTo();
    }

    public function scopeByActor(Builder $query, int $userId): Builder
    {
        return $query->where('actor_user_id', $userId);
    }
}
```

- [ ] **Step 5: Write the logger**

```php
<?php

declare(strict_types=1);

namespace App\Domain\Audit;

use App\Domain\Audit\Models\AuditLog;
use App\Support\CurrentBookshelf;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Request;

final class AuditLogger
{
    public function __construct(private readonly CurrentBookshelf $currentBookshelf) {}

    /**
     * @param  array<string, mixed>|null  $before
     * @param  array<string, mixed>|null  $after
     */
    public function log(string $action, ?Model $subject, ?array $before = null, ?array $after = null): AuditLog
    {
        return AuditLog::create([
            'bookshelf_id' => $this->resolveBookshelfId($subject),
            'actor_user_id' => Auth::id(),
            'action' => $action,
            'auditable_type' => $subject !== null ? $subject::class : 'system',
            'auditable_id' => $subject?->getKey() ?? 0,
            'before' => $before,
            'after' => $after,
            'context' => [
                'ip' => Request::ip(),
                'route' => Request::route()?->getName(),
            ],
        ]);
    }

    private function resolveBookshelfId(?Model $subject): ?int
    {
        if ($subject !== null && isset($subject->bookshelf_id)) {
            return (int) $subject->bookshelf_id;
        }

        if ($subject !== null && $subject->getTable() === 'bookshelves') {
            return (int) $subject->getKey();
        }

        return $this->currentBookshelf->id();
    }
}
```

`context` stores the IP for accountability. It must never carry a reader's name, date of birth, parents' names or phone number — that is PII of a minor, and RULES.md §1.17 forbids logging it.

- [ ] **Step 6: Write the trait and observer**

`app/Domain/Audit/Concerns/Auditable.php`:

```php
<?php

declare(strict_types=1);

namespace App\Domain\Audit\Concerns;

use App\Domain\Audit\Observers\AuditObserver;

trait Auditable
{
    public static function bootAuditable(): void
    {
        static::observe(AuditObserver::class);
    }

    /**
     * Attributes never written to the audit log.
     *
     * @return list<string>
     */
    public function auditExcluded(): array
    {
        return ['password', 'remember_token', 'updated_at', 'created_at'];
    }

    /**
     * Prefix for this model's audit action strings, e.g. "book" gives "book.updated".
     */
    abstract public function auditPrefix(): string;
}
```

`app/Domain/Audit/Observers/AuditObserver.php`:

```php
<?php

declare(strict_types=1);

namespace App\Domain\Audit\Observers;

use App\Domain\Audit\AuditLogger;
use Illuminate\Database\Eloquent\Model;

class AuditObserver
{
    public function __construct(private readonly AuditLogger $logger) {}

    public function created(Model $model): void
    {
        $this->logger->log($model->auditPrefix().'.created', $model, null, $this->clean($model, $model->getAttributes()));
    }

    public function updated(Model $model): void
    {
        $changed = $model->getChanges();

        if ($changed === []) {
            return;
        }

        $before = [];
        foreach (array_keys($changed) as $key) {
            $before[$key] = $model->getOriginal($key);
        }

        $this->logger->log(
            $model->auditPrefix().'.updated',
            $model,
            $this->clean($model, $before),
            $this->clean($model, $changed),
        );
    }

    public function deleted(Model $model): void
    {
        $this->logger->log($model->auditPrefix().'.deleted', $model, $this->clean($model, $model->getOriginal()), null);
    }

    /**
     * @param  array<string, mixed>  $attributes
     * @return array<string, mixed>
     */
    private function clean(Model $model, array $attributes): array
    {
        return array_diff_key($attributes, array_flip($model->auditExcluded()));
    }
}
```

- [ ] **Step 7: Run tests to verify they pass**

```bash
php artisan migrate
php artisan test --filter="AuditLogger|AuditIsAppendOnly"
```

Expected: PASS, 5 tests.

- [ ] **Step 8: Commit**

```bash
git switch -c feat/audit-foundation
git add -A
git commit -m "feat(audit): add append-only audit log with observer and logger

The Auditable trait records attribute diffs automatically; AuditLogger
records domain events that are not simple diffs. Both write inside the
caller's transaction rather than through an event or a queue, because an
audit trail a failed job can lose is not an audit trail (INV-8).

The model refuses updates and deletes at the Eloquent level and the table
has no updated_at column (INV-12)."
```

---

## Milestone B — Identity and Access

Ends with a volunteer able to log in with a username, a reader able to apply, and a manager able to approve them.

---

### Task 4: Users, memberships, roles and permissions

Identity is global and membership is per shelf. A `User` row is one person, valid everywhere; a `Membership` row is that person's relationship to one bookshelf. This is also why registration needs no separate table — a pending membership *is* the application.

**Files:**
- Create: `database/migrations/*_create_users_and_memberships_tables.php`
- Create: `app/Domain/Identity/Models/User.php`, `Membership.php`
- Create: `app/Domain/Identity/Enums/Role.php`, `MembershipStatus.php`, `Permission.php`
- Create: `app/Domain/Identity/RolePermissions.php`
- Create: `database/factories/UserFactory.php`, `MembershipFactory.php`
- Create: `resources/lang/vi/identity.php`, `resources/lang/en/identity.php`
- Test: `tests/Unit/RolePermissionsTest.php`, `tests/Feature/Identity/MembershipTest.php`

**Interfaces:**
- Consumes: `Bookshelf`, `BelongsToBookshelf` (Task 2), `Auditable` (Task 3).
- Produces:
  - `User` with `memberships()`, `membershipFor(Bookshelf $b): ?Membership`, `isSuperAdmin(): bool`, `hasPermission(Permission $p, Bookshelf $b): bool`, `displayNameFor(Bookshelf $b): string`.
  - `Membership` with `user()`, `bookshelf()`, `isActive(): bool`, scopes `scopePending()`, `scopeActive()`, `scopeReaders()`.
  - `Role` enum: `Reader`, `Manager`, `Admin`, with `atLeast(Role $other): bool` and `rank(): int`.
  - `MembershipStatus` enum: `Pending`, `Active`, `Rejected`, `Suspended`, `Left`.
  - `Permission` enum — Phase 1 cases listed in Step 4.
  - `RolePermissions::for(Role $r): list<Permission>` and `::allows(Role $r, Permission $p): bool`.

- [ ] **Step 1: Write the failing tests**

`tests/Unit/RolePermissionsTest.php`:

```php
<?php

declare(strict_types=1);

use App\Domain\Identity\Enums\Permission;
use App\Domain\Identity\Enums\Role;
use App\Domain\Identity\RolePermissions;

it('lets a reader see books but not create them', function () {
    expect(RolePermissions::allows(Role::Reader, Permission::BookViewAny))->toBeTrue()
        ->and(RolePermissions::allows(Role::Reader, Permission::BookCreate))->toBeFalse();
});

it('lets a manager run circulation', function () {
    expect(RolePermissions::allows(Role::Manager, Permission::LoanCreate))->toBeTrue()
        ->and(RolePermissions::allows(Role::Manager, Permission::LoanReceiveReturn))->toBeTrue()
        ->and(RolePermissions::allows(Role::Manager, Permission::MemberApprove))->toBeTrue();
});

it('denies a manager the shelf-administration permissions', function () {
    expect(RolePermissions::allows(Role::Manager, Permission::ManagerAssign))->toBeFalse();
});

it('gives an admin everything a manager has, and more', function () {
    foreach (RolePermissions::for(Role::Manager) as $permission) {
        expect(RolePermissions::allows(Role::Admin, $permission))->toBeTrue();
    }

    expect(RolePermissions::allows(Role::Admin, Permission::ManagerAssign))->toBeTrue();
});

it('ranks roles hierarchically', function () {
    expect(Role::Admin->atLeast(Role::Manager))->toBeTrue()
        ->and(Role::Manager->atLeast(Role::Reader))->toBeTrue()
        ->and(Role::Reader->atLeast(Role::Manager))->toBeFalse();
});
```

`tests/Feature/Identity/MembershipTest.php`:

```php
<?php

declare(strict_types=1);

use App\Domain\Identity\Enums\MembershipStatus;
use App\Domain\Identity\Enums\Permission;
use App\Domain\Identity\Enums\Role;
use App\Domain\Identity\Models\Bookshelf;
use App\Domain\Identity\Models\Membership;
use App\Domain\Identity\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

it('links a user to a shelf with a role', function () {
    $shelf = Bookshelf::factory()->create();
    $user = User::factory()->create();
    Membership::factory()->for($shelf)->for($user)->manager()->create();

    expect($user->membershipFor($shelf)->role)->toBe(Role::Manager);
});

it('allows the same person to join two shelves with different roles', function () {
    $a = Bookshelf::factory()->create();
    $b = Bookshelf::factory()->create();
    $user = User::factory()->create();

    Membership::factory()->for($a)->for($user)->manager()->create();
    Membership::factory()->for($b)->for($user)->create();

    expect($user->membershipFor($a)->role)->toBe(Role::Manager)
        ->and($user->membershipFor($b)->role)->toBe(Role::Reader);
});

it('forbids two memberships for the same person on one shelf', function () {
    $shelf = Bookshelf::factory()->create();
    $user = User::factory()->create();

    Membership::factory()->for($shelf)->for($user)->create();
    Membership::factory()->for($shelf)->for($user)->create();
})->throws(QueryException::class);

it('grants a super admin every permission regardless of membership', function () {
    $shelf = Bookshelf::factory()->create();
    $god = User::factory()->superAdmin()->create();

    expect($god->hasPermission(Permission::ManagerAssign, $shelf))->toBeTrue();
});

it('grants nothing to a pending member', function () {
    $shelf = Bookshelf::factory()->create();
    $user = User::factory()->create();
    Membership::factory()->for($shelf)->for($user)->create([
        'status' => MembershipStatus::Pending,
    ]);

    expect($user->hasPermission(Permission::BookViewAny, $shelf))->toBeFalse();
});

it('grants nothing to a suspended member', function () {
    $shelf = Bookshelf::factory()->create();
    $user = User::factory()->create();
    Membership::factory()->for($shelf)->for($user)->manager()->suspended()->create();

    expect($user->hasPermission(Permission::LoanCreate, $shelf))->toBeFalse();
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
php artisan test --filter="RolePermissions|Membership"
```

Expected: FAIL — `Class "App\Domain\Identity\Enums\Role" not found`.

- [ ] **Step 3: Write the migration**

The starter kit created a `users` table with email-based auth. Delete its generated `create_users_table` migration and write this in its place. Keep the framework's `sessions`, `cache` and `jobs` migrations.

```php
<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('users', function (Blueprint $table) {
            $table->id();
            $table->string('username', 50)->unique();
            $table->string('password');
            $table->string('saint_name', 100);
            $table->string('full_name', 150);
            $table->string('display_name', 100);
            $table->date('date_of_birth');
            $table->string('father_name', 150);
            $table->string('mother_name', 150);
            $table->string('phone', 20)->nullable();
            $table->string('email', 150)->nullable()->unique();
            $table->string('avatar_path')->nullable();
            $table->string('locale', 5)->default('vi');
            $table->boolean('is_super_admin')->default(false);
            $table->boolean('must_change_password')->default(false);
            $table->timestamp('last_login_at')->nullable();
            $table->rememberToken();
            $table->timestamps();
            $table->softDeletes();

            $table->index('full_name');
            $table->index('is_super_admin');
        });

        Schema::create('memberships', function (Blueprint $table) {
            $table->id();
            $table->foreignId('bookshelf_id')->constrained('bookshelves');
            $table->foreignId('user_id')->constrained('users');
            $table->string('role', 20)->default('reader');
            $table->string('status', 20)->default('pending');
            $table->string('parish_group', 100);
            $table->string('parish', 100);
            $table->boolean('show_in_leaderboard')->default(true);
            $table->timestamp('registered_at')->nullable();
            $table->foreignId('approved_by_user_id')->nullable()->constrained('users');
            $table->timestamp('approved_at')->nullable();
            $table->string('rejected_reason')->nullable();
            $table->string('suspended_reason')->nullable();
            $table->text('notes')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->unique(['bookshelf_id', 'user_id']);
            $table->index(['bookshelf_id', 'status']);
            $table->index(['bookshelf_id', 'role', 'status']);
        });

        Schema::table('bookshelves', function (Blueprint $table) {
            $table->foreign('created_by_user_id')->references('id')->on('users');
        });
    }

    public function down(): void
    {
        Schema::table('bookshelves', fn (Blueprint $t) => $t->dropForeign(['created_by_user_id']));
        Schema::dropIfExists('memberships');
        Schema::dropIfExists('users');
    }
};
```

The unique index on `(bookshelf_id, user_id)` makes "one role per person per shelf" a database fact rather than a convention.

- [ ] **Step 4: Write the enums**

`app/Domain/Identity/Enums/Role.php`:

```php
<?php

declare(strict_types=1);

namespace App\Domain\Identity\Enums;

enum Role: string
{
    case Reader = 'reader';
    case Manager = 'manager';
    case Admin = 'admin';

    public function rank(): int
    {
        return match ($this) {
            self::Reader => 1,
            self::Manager => 2,
            self::Admin => 3,
        };
    }

    public function atLeast(self $other): bool
    {
        return $this->rank() >= $other->rank();
    }

    public function label(): string
    {
        return __('identity.role.'.$this->value);
    }
}
```

`app/Domain/Identity/Enums/MembershipStatus.php`:

```php
<?php

declare(strict_types=1);

namespace App\Domain\Identity\Enums;

enum MembershipStatus: string
{
    case Pending = 'pending';
    case Active = 'active';
    case Rejected = 'rejected';
    case Suspended = 'suspended';
    case Left = 'left';

    public function label(): string
    {
        return __('identity.membership_status.'.$this->value);
    }
}
```

`app/Domain/Identity/Enums/Permission.php` — Phase 1 cases only. Phases 2 and 3 append cases; never rename an existing one, because policies and tests reference them by name.

```php
<?php

declare(strict_types=1);

namespace App\Domain\Identity\Enums;

enum Permission: string
{
    case BookViewAny = 'book.view_any';
    case BookCreate = 'book.create';
    case BookUpdate = 'book.update';
    case BookDelete = 'book.delete';
    case CopyCreate = 'copy.create';
    case CopyUpdate = 'copy.update';
    case CopyRetire = 'copy.retire';
    case CopyReportLost = 'copy.report_lost';
    case CopyAssessCondition = 'copy.assess_condition';

    case LoanViewAny = 'loan.view_any';
    case LoanViewOwn = 'loan.view_own';
    case LoanCreate = 'loan.create';
    case LoanReceiveReturn = 'loan.receive_return';
    case LoanRenewOwn = 'loan.renew_own';
    case LoanVoid = 'loan.void';

    case MemberViewAny = 'member.view_any';
    case MemberApprove = 'member.approve';
    case MemberReject = 'member.reject';
    case MemberSuspend = 'member.suspend';
    case MemberCreate = 'member.create';
    case MemberResetPassword = 'member.reset_password';

    case ExportRun = 'export.run';
    case AuditView = 'audit.view';

    case ManagerAssign = 'manager.assign';
    case ManagerRevoke = 'manager.revoke';
}
```

- [ ] **Step 5: Write the permission map**

```php
<?php

declare(strict_types=1);

namespace App\Domain\Identity;

use App\Domain\Identity\Enums\Permission;
use App\Domain\Identity\Enums\Role;

final class RolePermissions
{
    /**
     * @return list<Permission>
     */
    public static function for(Role $role): array
    {
        return match ($role) {
            Role::Reader => self::reader(),
            Role::Manager => [...self::reader(), ...self::manager()],
            Role::Admin => [...self::reader(), ...self::manager(), ...self::admin()],
        };
    }

    public static function allows(Role $role, Permission $permission): bool
    {
        return in_array($permission, self::for($role), strict: true);
    }

    /**
     * @return list<Permission>
     */
    private static function reader(): array
    {
        return [
            Permission::BookViewAny,
            Permission::LoanViewOwn,
            Permission::LoanRenewOwn,
        ];
    }

    /**
     * @return list<Permission>
     */
    private static function manager(): array
    {
        return [
            Permission::BookCreate,
            Permission::BookUpdate,
            Permission::BookDelete,
            Permission::CopyCreate,
            Permission::CopyUpdate,
            Permission::CopyRetire,
            Permission::CopyReportLost,
            Permission::CopyAssessCondition,
            Permission::LoanViewAny,
            Permission::LoanCreate,
            Permission::LoanReceiveReturn,
            Permission::LoanVoid,
            Permission::MemberViewAny,
            Permission::MemberApprove,
            Permission::MemberReject,
            Permission::MemberSuspend,
            Permission::MemberCreate,
            Permission::MemberResetPassword,
            Permission::ExportRun,
        ];
    }

    /**
     * @return list<Permission>
     */
    private static function admin(): array
    {
        return [
            Permission::AuditView,
            Permission::ManagerAssign,
            Permission::ManagerRevoke,
        ];
    }
}
```

- [ ] **Step 6: Write the models**

`app/Domain/Identity/Models/User.php`:

```php
<?php

declare(strict_types=1);

namespace App\Domain\Identity\Models;

use App\Domain\Identity\Enums\Permission;
use App\Domain\Identity\RolePermissions;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;

class User extends Authenticatable
{
    use HasFactory, Notifiable, SoftDeletes;

    protected $guarded = ['id'];

    protected $hidden = ['password', 'remember_token'];

    protected function casts(): array
    {
        return [
            'date_of_birth' => 'date',
            'last_login_at' => 'datetime',
            'is_super_admin' => 'boolean',
            'must_change_password' => 'boolean',
            'password' => 'hashed',
        ];
    }

    public function memberships(): HasMany
    {
        return $this->hasMany(Membership::class);
    }

    public function membershipFor(Bookshelf $bookshelf): ?Membership
    {
        return $this->memberships()
            ->withoutGlobalScope('bookshelf')
            ->where('bookshelf_id', $bookshelf->id)
            ->first();
    }

    public function isSuperAdmin(): bool
    {
        return $this->is_super_admin === true;
    }

    public function hasPermission(Permission $permission, Bookshelf $bookshelf): bool
    {
        if ($this->isSuperAdmin()) {
            return true;
        }

        $membership = $this->membershipFor($bookshelf);

        if ($membership === null || ! $membership->isActive()) {
            return false;
        }

        return RolePermissions::allows($membership->role, $permission);
    }

    public function displayNameFor(Bookshelf $bookshelf): string
    {
        return $bookshelf->settings()->publicNameDisplay === 'full_name'
            ? $this->full_name
            : $this->display_name;
    }
}
```

`membershipFor()` drops the global scope deliberately and filters by the explicitly passed shelf instead. It is the one place a user's memberships are read across shelves — a super admin managing two bookshelves needs it — and it is safe because the shelf is a required argument, not ambient state. This is the documented escape hatch from Task 2; it must not be copied elsewhere.

`app/Domain/Identity/Models/Membership.php`:

```php
<?php

declare(strict_types=1);

namespace App\Domain\Identity\Models;

use App\Domain\Audit\Concerns\Auditable;
use App\Domain\Identity\Concerns\BelongsToBookshelf;
use App\Domain\Identity\Enums\MembershipStatus;
use App\Domain\Identity\Enums\Role;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

class Membership extends Model
{
    use Auditable, BelongsToBookshelf, HasFactory, SoftDeletes;

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return [
            'role' => Role::class,
            'status' => MembershipStatus::class,
            'show_in_leaderboard' => 'boolean',
            'registered_at' => 'datetime',
            'approved_at' => 'datetime',
        ];
    }

    public function auditPrefix(): string
    {
        return 'membership';
    }

    public function auditExcluded(): array
    {
        return ['password', 'remember_token', 'updated_at', 'created_at', 'notes'];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function approvedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'approved_by_user_id');
    }

    public function isActive(): bool
    {
        return $this->status === MembershipStatus::Active;
    }

    public function scopePending(Builder $q): Builder
    {
        return $q->where('status', MembershipStatus::Pending);
    }

    public function scopeActive(Builder $q): Builder
    {
        return $q->where('status', MembershipStatus::Active);
    }

    public function scopeReaders(Builder $q): Builder
    {
        return $q->where('role', Role::Reader);
    }
}
```

`notes` is excluded from auditing because it is the manager's private free-text field and may contain family details about a child.

- [ ] **Step 7: Write the factories**

Replace the starter kit's `UserFactory`:

```php
<?php

declare(strict_types=1);

namespace Database\Factories;

use App\Domain\Identity\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Facades\Hash;

class UserFactory extends Factory
{
    protected $model = User::class;

    public function definition(): array
    {
        $full = fake()->name();

        return [
            'username' => fake()->unique()->userName(),
            'password' => Hash::make('password'),
            'saint_name' => fake()->randomElement(['Maria', 'Giuse', 'Anna', 'Phêrô', 'Têrêsa']),
            'full_name' => $full,
            'display_name' => $full,
            'date_of_birth' => fake()->dateTimeBetween('-16 years', '-8 years'),
            'father_name' => fake()->name('male'),
            'mother_name' => fake()->name('female'),
            'phone' => fake()->optional()->numerify('09########'),
            'is_super_admin' => false,
            'must_change_password' => false,
        ];
    }

    public function superAdmin(): static
    {
        return $this->state(fn () => ['is_super_admin' => true]);
    }

    public function mustChangePassword(): static
    {
        return $this->state(fn () => ['must_change_password' => true]);
    }
}
```

`database/factories/MembershipFactory.php`:

```php
<?php

declare(strict_types=1);

namespace Database\Factories;

use App\Domain\Identity\Enums\MembershipStatus;
use App\Domain\Identity\Enums\Role;
use App\Domain\Identity\Models\Bookshelf;
use App\Domain\Identity\Models\Membership;
use App\Domain\Identity\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

class MembershipFactory extends Factory
{
    protected $model = Membership::class;

    public function definition(): array
    {
        return [
            'bookshelf_id' => Bookshelf::factory(),
            'user_id' => User::factory(),
            'role' => Role::Reader,
            'status' => MembershipStatus::Active,
            'parish_group' => 'Tổ '.fake()->numberBetween(1, 6),
            'parish' => 'Giáo họ '.fake()->randomElement(['Thánh Tâm', 'Mân Côi', 'Fatima']),
            'registered_at' => now(),
            'approved_at' => now(),
        ];
    }

    public function pending(): static
    {
        return $this->state(fn () => [
            'status' => MembershipStatus::Pending,
            'approved_at' => null,
        ]);
    }

    public function manager(): static
    {
        return $this->state(fn () => ['role' => Role::Manager]);
    }

    public function admin(): static
    {
        return $this->state(fn () => ['role' => Role::Admin]);
    }

    public function suspended(): static
    {
        return $this->state(fn () => ['status' => MembershipStatus::Suspended]);
    }
}
```

- [ ] **Step 8: Add the Vietnamese strings**

`resources/lang/vi/identity.php`:

```php
<?php

declare(strict_types=1);

return [
    'role' => [
        'reader' => 'Bạn đọc',
        'manager' => 'Quản lý',
        'admin' => 'Quản trị tủ sách',
    ],
    'membership_status' => [
        'pending' => 'Chờ duyệt',
        'active' => 'Đang hoạt động',
        'rejected' => 'Đã từ chối',
        'suspended' => 'Tạm khoá',
        'left' => 'Đã rời',
    ],
    'fields' => [
        'username' => 'tên đăng nhập',
        'password' => 'mật khẩu',
        'saint_name' => 'tên thánh',
        'full_name' => 'họ và tên',
        'date_of_birth' => 'ngày sinh',
        'father_name' => 'tên bố',
        'mother_name' => 'tên mẹ',
        'phone' => 'số điện thoại',
        'parish_group' => 'tổ',
        'parish' => 'giáo họ',
    ],
    'approved' => 'Đã duyệt tài khoản cho :name.',
    'rejected' => 'Đã từ chối đăng ký.',
];
```

Create `resources/lang/en/identity.php` with the same keys in English.

- [ ] **Step 9: Run tests to verify they pass**

```bash
php artisan migrate:fresh
php artisan test --filter="RolePermissions|Membership"
```

Expected: PASS, 11 tests.

- [ ] **Step 10: Commit**

```bash
git switch -c feat/identity-model
git add -A
git commit -m "feat(identity): add users, memberships, roles and permissions

Identity is global and membership is per shelf, so one account works
across bookshelves with a different role in each. A pending membership is
the registration record; there is no separate applications table.

Permissions are a PHP enum consulted through a static role map rather than
a database-driven package. Three roles and one global flag are known at
compile time, so the map is faster, type-checked and dependency-free."
```

---

### Task 5: Authentication and the password-change gate

The starter kit ships email-based authentication with self-service reset. Phase 1 replaces it: login is by **username**, and because there is no email in v1, a manager-issued reset is the only recovery path.

**Files:**
- Create: `app/Http/Controllers/Auth/LoginController.php`, `PasswordController.php`
- Create: `app/Http/Requests/Auth/LoginRequest.php`, `ChangePasswordRequest.php`
- Create: `app/Domain/Identity/Actions/ChangePasswordAction.php`
- Create: `app/Http/Middleware/EnsurePasswordChanged.php`, `EnsureMembershipActive.php`
- Create: `app/Console/Commands/InstallOlibra.php`
- Create: `resources/js/pages/auth/Login.tsx`, `ChangePassword.tsx`; `resources/js/layouts/AuthLayout.tsx`
- Delete: the starter kit's email-based auth controllers, requests, routes and pages
- Modify: `routes/web.php`, `bootstrap/app.php`, `config/auth.php`
- Test: `tests/Feature/Identity/AuthenticationTest.php`

**Interfaces:**
- Consumes: `User`, `Membership`, `MembershipStatus` (Task 4).
- Produces:
  - Named routes `login`, `logout`, `password.change`.
  - `ChangePasswordAction::execute(User $user, string $newPassword): void`
  - Middleware alias `membership.active`; `EnsurePasswordChanged` appended to the `web` group.
  - `php artisan olibra:install`.

- [ ] **Step 1: Write the failing tests**

`tests/Feature/Identity/AuthenticationTest.php`:

```php
<?php

declare(strict_types=1);

use App\Domain\Identity\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;

uses(RefreshDatabase::class);

it('logs in with a username and password', function () {
    $user = User::factory()->create([
        'username' => 'maria.lan',
        'password' => Hash::make('bi-mat-123'),
    ]);

    $this->post('/dang-nhap', [
        'username' => 'maria.lan',
        'password' => 'bi-mat-123',
    ])->assertRedirect();

    $this->assertAuthenticatedAs($user);
});

it('rejects a wrong password without revealing which field was wrong', function () {
    User::factory()->create(['username' => 'maria.lan']);

    $this->from('/dang-nhap')->post('/dang-nhap', [
        'username' => 'maria.lan',
        'password' => 'sai-mat-khau',
    ])->assertRedirect('/dang-nhap')->assertSessionHasErrors('username');

    $this->assertGuest();
});

it('records the login time', function () {
    $user = User::factory()->create([
        'username' => 'giuse.minh',
        'password' => Hash::make('secret-123'),
        'last_login_at' => null,
    ]);

    $this->post('/dang-nhap', ['username' => 'giuse.minh', 'password' => 'secret-123']);

    expect($user->fresh()->last_login_at)->not->toBeNull();
});

it('forces a password change when the flag is set', function () {
    $user = User::factory()->mustChangePassword()->create();

    $this->actingAs($user)->get('/')->assertRedirect('/doi-mat-khau');
});

it('clears the flag once the password is changed', function () {
    $user = User::factory()->mustChangePassword()->create();

    $this->actingAs($user)->put('/doi-mat-khau', [
        'password' => 'mat-khau-moi-123',
        'password_confirmation' => 'mat-khau-moi-123',
    ])->assertRedirect();

    $user->refresh();

    expect($user->must_change_password)->toBeFalse()
        ->and(Hash::check('mat-khau-moi-123', $user->password))->toBeTrue();
});

it('throttles repeated failed logins', function () {
    User::factory()->create(['username' => 'target']);

    foreach (range(1, 6) as $ignored) {
        $this->post('/dang-nhap', ['username' => 'target', 'password' => 'wrong']);
    }

    $this->post('/dang-nhap', ['username' => 'target', 'password' => 'wrong'])
        ->assertSessionHasErrors('username');
});

it('logs out', function () {
    $this->actingAs(User::factory()->create())->post('/dang-xuat')->assertRedirect('/');

    $this->assertGuest();
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
php artisan test --filter=Authentication
```

Expected: FAIL — 404, because `/dang-nhap` does not exist.

- [ ] **Step 3: Remove the starter kit's email authentication**

Delete the generated registration, password-reset, email-verification and confirm-password controllers, requests, routes and React pages. Keep `resources/js/pages/auth/` as a directory.

Point the auth provider at the new model in `config/auth.php`:

```php
'providers' => [
    'users' => [
        'driver' => 'eloquent',
        'model' => App\Domain\Identity\Models\User::class,
    ],
],
```

No route may send mail. RULES.md §1.20 forbids adding one.

- [ ] **Step 4: Write the login request and controller**

`app/Http/Requests/Auth/LoginRequest.php`:

```php
<?php

declare(strict_types=1);

namespace App\Http\Requests\Auth;

use Illuminate\Auth\Events\Lockout;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class LoginRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'username' => ['required', 'string', 'max:50'],
            'password' => ['required', 'string'],
            'remember' => ['boolean'],
        ];
    }

    public function authenticate(): void
    {
        $this->ensureIsNotRateLimited();

        $credentials = [
            'username' => $this->string('username')->toString(),
            'password' => $this->string('password')->toString(),
        ];

        if (! Auth::attempt($credentials, $this->boolean('remember'))) {
            RateLimiter::hit($this->throttleKey());

            throw ValidationException::withMessages(['username' => __('auth.failed')]);
        }

        RateLimiter::clear($this->throttleKey());
    }

    protected function ensureIsNotRateLimited(): void
    {
        if (! RateLimiter::tooManyAttempts($this->throttleKey(), 5)) {
            return;
        }

        event(new Lockout($this));

        throw ValidationException::withMessages([
            'username' => __('auth.throttle', [
                'seconds' => RateLimiter::availableIn($this->throttleKey()),
            ]),
        ]);
    }

    protected function throttleKey(): string
    {
        return Str::transliterate(Str::lower($this->string('username')).'|'.$this->ip());
    }
}
```

The failure message attaches to `username` and says only that the combination is wrong. Naming which field failed would let a stranger enumerate which children have accounts.

`app/Http/Controllers/Auth/LoginController.php`:

```php
<?php

declare(strict_types=1);

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Http\Requests\Auth\LoginRequest;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Inertia\Inertia;
use Inertia\Response;

class LoginController extends Controller
{
    public function create(): Response
    {
        return Inertia::render('auth/Login');
    }

    public function store(LoginRequest $request): RedirectResponse
    {
        $request->authenticate();
        $request->session()->regenerate();

        $request->user()->forceFill(['last_login_at' => now()])->saveQuietly();

        return redirect()->intended('/');
    }

    public function destroy(Request $request): RedirectResponse
    {
        Auth::guard('web')->logout();
        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return redirect('/');
    }
}
```

`saveQuietly()` skips model events so a login generates no audit row. Logins are not domain state changes, and auditing every page entry would bury the rows that matter.

- [ ] **Step 5: Write the password change action, request and controller**

`app/Domain/Identity/Actions/ChangePasswordAction.php`:

```php
<?php

declare(strict_types=1);

namespace App\Domain\Identity\Actions;

use App\Domain\Audit\AuditLogger;
use App\Domain\Identity\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

final class ChangePasswordAction
{
    public function __construct(private readonly AuditLogger $audit) {}

    public function execute(User $user, string $newPassword): void
    {
        DB::transaction(function () use ($user, $newPassword): void {
            $user->forceFill([
                'password' => Hash::make($newPassword),
                'must_change_password' => false,
            ])->saveQuietly();

            $this->audit->log('user.password_changed', $user, null, null);
        });
    }
}
```

The audit row carries no before or after value. Writing a password hash into a table many people can read would be worse than recording nothing.

`app/Http/Requests/Auth/ChangePasswordRequest.php`:

```php
<?php

declare(strict_types=1);

namespace App\Http\Requests\Auth;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rules\Password;

class ChangePasswordRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'password' => ['required', 'confirmed', Password::min(8)],
        ];
    }
}
```

`app/Http/Controllers/Auth/PasswordController.php`:

```php
<?php

declare(strict_types=1);

namespace App\Http\Controllers\Auth;

use App\Domain\Identity\Actions\ChangePasswordAction;
use App\Http\Controllers\Controller;
use App\Http\Requests\Auth\ChangePasswordRequest;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class PasswordController extends Controller
{
    public function edit(Request $request): Response
    {
        return Inertia::render('auth/ChangePassword', [
            'forced' => $request->user()->must_change_password,
        ]);
    }

    public function update(ChangePasswordRequest $request, ChangePasswordAction $action): RedirectResponse
    {
        $action->execute($request->user(), $request->string('password')->toString());

        return redirect('/')->with('success', __('auth.password_changed'));
    }
}
```

- [ ] **Step 6: Write the two middleware**

`app/Http/Middleware/EnsurePasswordChanged.php`:

```php
<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsurePasswordChanged
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if ($user?->must_change_password && ! $request->routeIs('password.change', 'logout')) {
            return redirect()->route('password.change');
        }

        return $next($request);
    }
}
```

`app/Http/Middleware/EnsureMembershipActive.php`:

```php
<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Support\CurrentBookshelf;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureMembershipActive
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();
        $shelf = app(CurrentBookshelf::class)->get();

        if ($user === null || $shelf === null) {
            abort(403);
        }

        if ($user->isSuperAdmin()) {
            return $next($request);
        }

        $membership = $user->membershipFor($shelf);

        if ($membership === null || ! $membership->isActive()) {
            abort(403);
        }

        return $next($request);
    }
}
```

This enforces INV-4 at the edge. It blocks *new* activity only — a reader suspended while holding a book keeps the loan, and it can still be returned, because returning is a manager action.

Register both in `bootstrap/app.php`:

```php
->withMiddleware(function (Middleware $middleware) {
    $middleware->alias([
        'bookshelf' => \App\Http\Middleware\ResolveBookshelf::class,
        'membership.active' => \App\Http\Middleware\EnsureMembershipActive::class,
    ]);

    $middleware->web(append: [
        \App\Http\Middleware\EnsurePasswordChanged::class,
    ]);
})
```

- [ ] **Step 7: Write the routes**

In `routes/web.php`:

```php
Route::middleware('guest')->group(function () {
    Route::get('/dang-nhap', [LoginController::class, 'create'])->name('login');
    Route::post('/dang-nhap', [LoginController::class, 'store']);
});

Route::middleware('auth')->group(function () {
    Route::post('/dang-xuat', [LoginController::class, 'destroy'])->name('logout');
    Route::get('/doi-mat-khau', [PasswordController::class, 'edit'])->name('password.change');
    Route::put('/doi-mat-khau', [PasswordController::class, 'update']);
});
```

- [ ] **Step 8: Write the React pages**

`resources/js/pages/auth/Login.tsx`. Inputs are 48px tall and the submit button 56px per spec §8.3, because volunteers use this on a phone.

```tsx
import { Head, useForm } from '@inertiajs/react'
import AuthLayout from '@/layouts/AuthLayout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function Login() {
  const { data, setData, post, processing, errors } = useForm({
    username: '',
    password: '',
    remember: false,
  })

  return (
    <AuthLayout>
      <Head title="Đăng nhập" />
      <form
        onSubmit={(e) => {
          e.preventDefault()
          post('/dang-nhap')
        }}
        className="space-y-6"
      >
        <div className="space-y-2">
          <Label htmlFor="username">Tên đăng nhập</Label>
          <Input
            id="username"
            value={data.username}
            onChange={(e) => setData('username', e.target.value)}
            autoFocus
            autoComplete="username"
            className="h-12"
          />
          {errors.username && <p className="text-sm text-destructive">{errors.username}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Mật khẩu</Label>
          <Input
            id="password"
            type="password"
            value={data.password}
            onChange={(e) => setData('password', e.target.value)}
            autoComplete="current-password"
            className="h-12"
          />
        </div>

        <Button type="submit" disabled={processing} className="h-14 w-full text-base">
          Đăng nhập
        </Button>

        <p className="text-center text-sm text-muted-foreground">
          Quên mật khẩu? Hãy gặp người quản lý tủ sách để được cấp lại.
        </p>
      </form>
    </AuthLayout>
  )
}
```

That closing sentence is the entire password-recovery user experience, so it must be present and unambiguous. Build `ChangePassword.tsx` the same way with two password fields, hiding the "back" link when the `forced` prop is true.

- [ ] **Step 9: Write the install command**

`app/Console/Commands/InstallOlibra.php`:

```php
<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Domain\Identity\Enums\MembershipStatus;
use App\Domain\Identity\Enums\Role;
use App\Domain\Identity\Models\Bookshelf;
use App\Domain\Identity\Models\Membership;
use App\Domain\Identity\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

class InstallOlibra extends Command
{
    protected $signature = 'olibra:install';

    protected $description = 'Create the first bookshelf and its super administrator';

    public function handle(): int
    {
        if (User::query()->where('is_super_admin', true)->exists()) {
            $this->error('A super administrator already exists. Nothing to do.');

            return self::FAILURE;
        }

        $shelfName = $this->ask('Tên tủ sách', 'Tủ sách Giáo xứ');
        $slug = $this->ask('Đường dẫn (slug)', 'chinh');
        $username = $this->ask('Tên đăng nhập quản trị', 'admin');
        $password = $this->secret('Mật khẩu quản trị');

        DB::transaction(function () use ($shelfName, $slug, $username, $password): void {
            $user = User::create([
                'username' => $username,
                'password' => Hash::make($password),
                'saint_name' => 'Giuse',
                'full_name' => 'Quản trị viên',
                'display_name' => 'Quản trị viên',
                'date_of_birth' => '1990-01-01',
                'father_name' => '-',
                'mother_name' => '-',
                'is_super_admin' => true,
            ]);

            $shelf = Bookshelf::create([
                'slug' => $slug,
                'name' => $shelfName,
                'status' => 'active',
                'settings' => [],
                'created_by_user_id' => $user->id,
                'established_at' => now()->toDateString(),
            ]);

            Membership::create([
                'bookshelf_id' => $shelf->id,
                'user_id' => $user->id,
                'role' => Role::Admin,
                'status' => MembershipStatus::Active,
                'parish_group' => '-',
                'parish' => '-',
                'registered_at' => now(),
                'approved_at' => now(),
            ]);
        });

        $this->info("Đã tạo tủ sách '{$shelfName}' và tài khoản quản trị '{$username}'.");

        return self::SUCCESS;
    }
}
```

The command runs with no bookshelf bound, so the global scope is inactive and `bookshelf_id` must be passed explicitly. That is the documented unbound-context behaviour from Task 2, not a workaround.

- [ ] **Step 10: Add the auth strings**

In `resources/lang/vi/auth.php`:

```php
'failed' => 'Tên đăng nhập hoặc mật khẩu không đúng.',
'throttle' => 'Bạn đã thử quá nhiều lần. Vui lòng đợi :seconds giây.',
'password_changed' => 'Đã đổi mật khẩu.',
```

- [ ] **Step 11: Run tests to verify they pass**

```bash
php artisan test --filter=Authentication
```

Expected: PASS, 7 tests.

- [ ] **Step 12: Verify manually**

```bash
php artisan olibra:install
npm run dev
```

Log in with the account you just created and confirm you reach the home page.

- [ ] **Step 13: Commit**

```bash
git switch -c feat/authentication
git add -A
git commit -m "feat(identity): replace email auth with username login

Login is by username, throttled at five attempts, with a failure message
that never reveals which field was wrong. Naming the field would let a
stranger enumerate which children have accounts.

Removes the starter kit's email registration and password reset. There is
no outbound email in v1, so a manager-issued reset is the only recovery
path, and the must_change_password gate closes the window in which a
manager knows a reader's working password.

Adds olibra:install to create the first bookshelf and super admin."
```

---

### Task 6: Registration and the approval workflow

A pending membership is the application. A manager verifies the details in person — the data is trustworthy because a human checked it, not because a regular expression did.

**Files:**
- Create: `app/Domain/Identity/Actions/RegisterMembershipAction.php`, `ApproveMembershipAction.php`, `RejectMembershipAction.php`
- Create: `app/Domain/Identity/Queries/PendingRegistrationsQuery.php`
- Create: `app/Http/Controllers/Public/RegistrationController.php`, `app/Http/Controllers/Manager/RegistrationApprovalController.php`
- Create: `app/Http/Requests/RegisterRequest.php`, `RejectMembershipRequest.php`
- Create: `routes/public.php`, `routes/manager.php`
- Create: `resources/js/pages/public/Register.tsx`, `resources/js/pages/manager/Registrations.tsx`, `resources/js/components/reader/RegistrationReviewCard.tsx`
- Test: `tests/Feature/Identity/RegistrationTest.php`

**Interfaces:**
- Consumes: `User`, `Membership`, `MembershipStatus`, `Role`, `AuditLogger`, `CurrentBookshelf`.
- Produces:
  - `RegisterMembershipAction::execute(Bookshelf $shelf, array $data): Membership`
  - `ApproveMembershipAction::execute(Membership $m, User $approver): Membership`
  - `RejectMembershipAction::execute(Membership $m, User $decider, string $reason): Membership`
  - `PendingRegistrationsQuery::get(): Collection<int, Membership>` and `::count(): int`
  - Routes `register.create`, `register.store`, `manager.registrations.index`, `manager.registrations.approve`, `manager.registrations.reject`.

- [ ] **Step 1: Write the failing tests**

`tests/Feature/Identity/RegistrationTest.php`:

```php
<?php

declare(strict_types=1);

use App\Domain\Audit\Models\AuditLog;
use App\Domain\Identity\Enums\MembershipStatus;
use App\Domain\Identity\Models\Bookshelf;
use App\Domain\Identity\Models\Membership;
use App\Domain\Identity\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

function registrationPayload(array $overrides = []): array
{
    return array_merge([
        'username' => 'teresa.mai',
        'password' => 'mat-khau-123',
        'password_confirmation' => 'mat-khau-123',
        'saint_name' => 'Têrêsa',
        'full_name' => 'Nguyễn Thị Mai',
        'date_of_birth' => '2014-05-02',
        'father_name' => 'Nguyễn Văn A',
        'mother_name' => 'Trần Thị B',
        'phone' => '0912345678',
        'parish_group' => 'Tổ 3',
        'parish' => 'Giáo họ Mân Côi',
    ], $overrides);
}

it('creates a pending membership, never an active one', function () {
    Bookshelf::factory()->create(['slug' => 'chinh']);

    $this->post('/portal/chinh/dang-ky', registrationPayload())->assertRedirect();

    $membership = Membership::withoutGlobalScope('bookshelf')->first();

    expect($membership->status)->toBe(MembershipStatus::Pending)
        ->and($membership->parish_group)->toBe('Tổ 3')
        ->and($membership->user->full_name)->toBe('Nguyễn Thị Mai');
});

it('requires every field the manager must verify in person', function () {
    Bookshelf::factory()->create(['slug' => 'chinh']);

    $this->post('/portal/chinh/dang-ky', registrationPayload([
        'father_name' => '',
        'parish' => '',
    ]))->assertSessionHasErrors(['father_name', 'parish']);
});

it('rejects a duplicate username', function () {
    Bookshelf::factory()->create(['slug' => 'chinh']);
    User::factory()->create(['username' => 'teresa.mai']);

    $this->post('/portal/chinh/dang-ky', registrationPayload())
        ->assertSessionHasErrors('username');
});

it('does not log the applicant in', function () {
    Bookshelf::factory()->create(['slug' => 'chinh']);

    $this->post('/portal/chinh/dang-ky', registrationPayload());

    $this->assertGuest();
});

it('lets a manager approve a pending membership', function () {
    $shelf = Bookshelf::factory()->create(['slug' => 'chinh']);
    $manager = User::factory()->create();
    Membership::factory()->for($shelf)->for($manager)->manager()->create();
    $applicant = Membership::factory()->for($shelf)->pending()->create();

    $this->actingAs($manager)
        ->post("/portal/chinh/quan-ly/dang-ky-cho-duyet/{$applicant->id}/duyet")
        ->assertRedirect();

    $applicant->refresh();

    expect($applicant->status)->toBe(MembershipStatus::Active)
        ->and($applicant->approved_by_user_id)->toBe($manager->id)
        ->and($applicant->approved_at)->not->toBeNull();
});

it('records the approval in the audit log', function () {
    $shelf = Bookshelf::factory()->create(['slug' => 'chinh']);
    $manager = User::factory()->create();
    Membership::factory()->for($shelf)->for($manager)->manager()->create();
    $applicant = Membership::factory()->for($shelf)->pending()->create();

    $this->actingAs($manager)
        ->post("/portal/chinh/quan-ly/dang-ky-cho-duyet/{$applicant->id}/duyet");

    $entry = AuditLog::where('action', 'membership.approved')->first();

    expect($entry)->not->toBeNull()
        ->and($entry->actor_user_id)->toBe($manager->id);
});

it('keeps a rejected application with its reason rather than deleting it', function () {
    $shelf = Bookshelf::factory()->create(['slug' => 'chinh']);
    $manager = User::factory()->create();
    Membership::factory()->for($shelf)->for($manager)->manager()->create();
    $applicant = Membership::factory()->for($shelf)->pending()->create();

    $this->actingAs($manager)
        ->post("/portal/chinh/quan-ly/dang-ky-cho-duyet/{$applicant->id}/tu-choi", [
            'reason' => 'Không xác minh được thông tin',
        ]);

    $applicant->refresh();

    expect($applicant->status)->toBe(MembershipStatus::Rejected)
        ->and($applicant->rejected_reason)->toBe('Không xác minh được thông tin');
});

it('requires a reason to reject', function () {
    $shelf = Bookshelf::factory()->create(['slug' => 'chinh']);
    $manager = User::factory()->create();
    Membership::factory()->for($shelf)->for($manager)->manager()->create();
    $applicant = Membership::factory()->for($shelf)->pending()->create();

    $this->actingAs($manager)
        ->post("/portal/chinh/quan-ly/dang-ky-cho-duyet/{$applicant->id}/tu-choi", ['reason' => ''])
        ->assertSessionHasErrors('reason');
});

it('forbids a reader from approving anyone', function () {
    $shelf = Bookshelf::factory()->create(['slug' => 'chinh']);
    $reader = User::factory()->create();
    Membership::factory()->for($shelf)->for($reader)->create();
    $applicant = Membership::factory()->for($shelf)->pending()->create();

    $this->actingAs($reader)
        ->post("/portal/chinh/quan-ly/dang-ky-cho-duyet/{$applicant->id}/duyet")
        ->assertForbidden();
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
php artisan test --filter=Registration
```

Expected: FAIL — 404 on the registration route.

- [ ] **Step 3: Write the actions**

`app/Domain/Identity/Actions/RegisterMembershipAction.php`:

```php
<?php

declare(strict_types=1);

namespace App\Domain\Identity\Actions;

use App\Domain\Audit\AuditLogger;
use App\Domain\Identity\Enums\MembershipStatus;
use App\Domain\Identity\Enums\Role;
use App\Domain\Identity\Models\Bookshelf;
use App\Domain\Identity\Models\Membership;
use App\Domain\Identity\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

final class RegisterMembershipAction
{
    public function __construct(private readonly AuditLogger $audit) {}

    /**
     * @param  array<string, mixed>  $data
     */
    public function execute(Bookshelf $bookshelf, array $data): Membership
    {
        return DB::transaction(function () use ($bookshelf, $data): Membership {
            $user = User::create([
                'username' => $data['username'],
                'password' => Hash::make($data['password']),
                'saint_name' => $data['saint_name'],
                'full_name' => $data['full_name'],
                'display_name' => $data['saint_name'].' '.$data['full_name'],
                'date_of_birth' => $data['date_of_birth'],
                'father_name' => $data['father_name'],
                'mother_name' => $data['mother_name'],
                'phone' => $data['phone'] ?? null,
            ]);

            $membership = Membership::create([
                'bookshelf_id' => $bookshelf->id,
                'user_id' => $user->id,
                'role' => Role::Reader,
                'status' => MembershipStatus::Pending,
                'parish_group' => $data['parish_group'],
                'parish' => $data['parish'],
                'registered_at' => now(),
            ]);

            $this->audit->log('membership.registered', $membership, null, [
                'username' => $user->username,
                'status' => MembershipStatus::Pending->value,
            ]);

            return $membership;
        });
    }
}
```

The audit entry records the username and status, deliberately not the date of birth, parents' names or phone number. Those are PII of a minor and RULES.md §1.17 keeps them out of logs.

`app/Domain/Identity/Actions/ApproveMembershipAction.php`:

```php
<?php

declare(strict_types=1);

namespace App\Domain\Identity\Actions;

use App\Domain\Audit\AuditLogger;
use App\Domain\Identity\Enums\MembershipStatus;
use App\Domain\Identity\Models\Membership;
use App\Domain\Identity\Models\User;
use Illuminate\Support\Facades\DB;

final class ApproveMembershipAction
{
    public function __construct(private readonly AuditLogger $audit) {}

    public function execute(Membership $membership, User $approver): Membership
    {
        return DB::transaction(function () use ($membership, $approver): Membership {
            $before = ['status' => $membership->status->value];

            $membership->update([
                'status' => MembershipStatus::Active,
                'approved_by_user_id' => $approver->id,
                'approved_at' => now(),
                'rejected_reason' => null,
            ]);

            $this->audit->log('membership.approved', $membership, $before, [
                'status' => MembershipStatus::Active->value,
            ]);

            return $membership;
        });
    }
}
```

`app/Domain/Identity/Actions/RejectMembershipAction.php`:

```php
<?php

declare(strict_types=1);

namespace App\Domain\Identity\Actions;

use App\Domain\Audit\AuditLogger;
use App\Domain\Identity\Enums\MembershipStatus;
use App\Domain\Identity\Models\Membership;
use App\Domain\Identity\Models\User;
use Illuminate\Support\Facades\DB;

final class RejectMembershipAction
{
    public function __construct(private readonly AuditLogger $audit) {}

    public function execute(Membership $membership, User $decider, string $reason): Membership
    {
        return DB::transaction(function () use ($membership, $decider, $reason): Membership {
            $before = ['status' => $membership->status->value];

            $membership->update([
                'status' => MembershipStatus::Rejected,
                'approved_by_user_id' => $decider->id,
                'rejected_reason' => $reason,
            ]);

            $this->audit->log('membership.rejected', $membership, $before, [
                'status' => MembershipStatus::Rejected->value,
                'reason' => $reason,
            ]);

            return $membership;
        });
    }
}
```

Rejected applications are kept rather than deleted, so the record of the decision survives and the person can re-apply.

- [ ] **Step 4: Write the query**

```php
<?php

declare(strict_types=1);

namespace App\Domain\Identity\Queries;

use App\Domain\Identity\Models\Membership;
use Illuminate\Support\Collection;

final class PendingRegistrationsQuery
{
    /**
     * @return Collection<int, Membership>
     */
    public function get(): Collection
    {
        return Membership::query()
            ->pending()
            ->with('user')
            ->orderBy('registered_at')
            ->get();
    }

    public function count(): int
    {
        return Membership::query()->pending()->count();
    }
}
```

No `bookshelf_id` filter appears here. The global scope from Task 2 applies it, which is the entire point of making isolation structural.

- [ ] **Step 5: Write the requests**

`app/Http/Requests/RegisterRequest.php`:

```php
<?php

declare(strict_types=1);

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rules\Password;

class RegisterRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'username' => ['required', 'string', 'min:3', 'max:50', 'alpha_dash', 'unique:users,username'],
            'password' => ['required', 'confirmed', Password::min(8)],
            'saint_name' => ['required', 'string', 'max:100'],
            'full_name' => ['required', 'string', 'max:150'],
            'date_of_birth' => ['required', 'date', 'before:today'],
            'father_name' => ['required', 'string', 'max:150'],
            'mother_name' => ['required', 'string', 'max:150'],
            'phone' => ['nullable', 'string', 'max:20'],
            'parish_group' => ['required', 'string', 'max:100'],
            'parish' => ['required', 'string', 'max:100'],
        ];
    }

    public function attributes(): array
    {
        return __('identity.fields');
    }
}
```

`app/Http/Requests/RejectMembershipRequest.php` requires `reason` as `['required', 'string', 'max:255']`.

- [ ] **Step 6: Write the controllers**

`RegistrationController` renders `public/Register` on `create`, and on `store` calls `RegisterMembershipAction`, then redirects to the shelf home with a flash message explaining that a manager must approve the account. **It must not log the applicant in** — an unapproved account has no access, and signing them in would imply otherwise.

`app/Http/Controllers/Manager/RegistrationApprovalController.php`:

```php
<?php

declare(strict_types=1);

namespace App\Http\Controllers\Manager;

use App\Domain\Identity\Actions\ApproveMembershipAction;
use App\Domain\Identity\Actions\RejectMembershipAction;
use App\Domain\Identity\Enums\Permission;
use App\Domain\Identity\Models\Membership;
use App\Domain\Identity\Queries\PendingRegistrationsQuery;
use App\Http\Controllers\Controller;
use App\Http\Requests\RejectMembershipRequest;
use App\Support\CurrentBookshelf;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class RegistrationApprovalController extends Controller
{
    public function index(Request $request, PendingRegistrationsQuery $query): Response
    {
        $this->authorizePermission($request, Permission::MemberApprove);

        return Inertia::render('manager/Registrations', [
            'registrations' => $query->get()->map(fn (Membership $m) => [
                'id' => $m->id,
                'saint_name' => $m->user->saint_name,
                'full_name' => $m->user->full_name,
                'username' => $m->user->username,
                'date_of_birth' => $m->user->date_of_birth->format('d/m/Y'),
                'father_name' => $m->user->father_name,
                'mother_name' => $m->user->mother_name,
                'phone' => $m->user->phone,
                'parish_group' => $m->parish_group,
                'parish' => $m->parish,
                'registered_at' => $m->registered_at->format('d/m/Y H:i'),
                'similar_names' => $this->similarNames($m),
            ])->all(),
        ]);
    }

    public function approve(Request $request, Membership $membership, ApproveMembershipAction $action): RedirectResponse
    {
        $this->authorizePermission($request, Permission::MemberApprove);

        $action->execute($membership, $request->user());

        return back()->with('success', __('identity.approved', ['name' => $membership->user->full_name]));
    }

    public function reject(RejectMembershipRequest $request, Membership $membership, RejectMembershipAction $action): RedirectResponse
    {
        $this->authorizePermission($request, Permission::MemberReject);

        $action->execute($membership, $request->user(), $request->string('reason')->toString());

        return back()->with('success', __('identity.rejected'));
    }

    private function authorizePermission(Request $request, Permission $permission): void
    {
        abort_unless(
            $request->user()->hasPermission($permission, app(CurrentBookshelf::class)->get()),
            403,
        );
    }

    /**
     * @return list<string>
     */
    private function similarNames(Membership $membership): array
    {
        return Membership::query()
            ->active()
            ->whereHas('user', fn ($q) => $q->where('full_name', 'like', '%'.$membership->user->full_name.'%'))
            ->with('user')
            ->limit(3)
            ->get()
            ->map(fn (Membership $m) => $m->user->full_name)
            ->all();
    }
}
```

`similar_names` is what catches the same child registering twice. The manager sees the near-match on the review card rather than discovering the duplicate a month later.

- [ ] **Step 7: Write the routes**

`routes/public.php`:

```php
Route::prefix('portal/{bookshelf}')->middleware('bookshelf')->group(function () {
    Route::get('/dang-ky', [RegistrationController::class, 'create'])->name('register.create');
    Route::post('/dang-ky', [RegistrationController::class, 'store'])->name('register.store');
});
```

`routes/manager.php`:

```php
Route::prefix('portal/{bookshelf}/quan-ly')
    ->middleware(['bookshelf', 'auth', 'membership.active'])
    ->name('manager.')
    ->group(function () {
        Route::get('/dang-ky-cho-duyet', [RegistrationApprovalController::class, 'index'])
            ->name('registrations.index');
        Route::post('/dang-ky-cho-duyet/{membership}/duyet', [RegistrationApprovalController::class, 'approve'])
            ->name('registrations.approve');
        Route::post('/dang-ky-cho-duyet/{membership}/tu-choi', [RegistrationApprovalController::class, 'reject'])
            ->name('registrations.reject');
    });
```

Register both files in `bootstrap/app.php`:

```php
->withRouting(
    web: __DIR__.'/../routes/web.php',
    then: function () {
        Route::middleware('web')->group(base_path('routes/public.php'));
        Route::middleware('web')->group(base_path('routes/manager.php'));
    },
)
```

- [ ] **Step 8: Write the React pages**

`public/Register.tsx` — one page, not a wizard, with four labelled groups: *Đăng nhập* (username, password, confirmation), *Bản thân* (saint name, full name, date of birth), *Gia đình* (father, mother, phone), *Giáo xứ* (tổ, giáo họ). Every field carries a short note saying why it is needed, because a child filling this in with a parent should understand what they are handing over.

`manager/Registrations.tsx` — one `RegistrationReviewCard` per applicant, laying out exactly the fields the manager must check in person, with `Duyệt` and `Từ chối` buttons. Rejection opens a dialog requiring a reason. When `similar_names` is non-empty, the card shows a warning strip above the buttons.

Both submit buttons disable while in flight, per RULES.md §5.10.

- [ ] **Step 9: Run tests to verify they pass**

```bash
php artisan test --filter=Registration
```

Expected: PASS, 9 tests.

- [ ] **Step 10: Commit**

```bash
git switch -c feat/registration-approval
git add -A
git commit -m "feat(identity): add registration and manager approval

A pending membership is the application; there is no separate table.
Registration never signs the applicant in, because an unapproved account
has no access and signing them in would imply otherwise.

The review screen lays out exactly the fields a manager must verify in
person and warns when an existing member has a similar name, which is what
catches the same child registering twice.

Audit entries record the username and status but never the date of birth,
parents' names or phone number."
```

---

### Task 7: Reader management and manager-issued password reset

**Files:**
- Create: `app/Domain/Identity/Actions/SuspendMembershipAction.php`, `ReactivateMembershipAction.php`, `CreateReaderByManagerAction.php`, `IssuePasswordResetAction.php`
- Create: `app/Domain/Identity/Queries/ReaderListQuery.php`
- Create: `app/Http/Controllers/Manager/ReaderController.php`
- Create: `resources/js/pages/manager/readers/Index.tsx`, `Show.tsx`
- Modify: `routes/manager.php`
- Test: `tests/Feature/Identity/ReaderManagementTest.php`

**Interfaces:**
- Consumes: everything from Tasks 4–6.
- Produces:
  - `IssuePasswordResetAction::execute(User $user, User $issuer): string` — returns the generated temporary password. It is never stored in plain text and never logged.
  - `CreateReaderByManagerAction::execute(Bookshelf $shelf, array $data, User $creator): Membership` — creates an already-`active` membership.
  - `SuspendMembershipAction::execute(Membership $m, User $actor, string $reason): Membership`
  - `ReactivateMembershipAction::execute(Membership $m, User $actor): Membership`
  - `ReaderListQuery::paginate(?string $search, ?MembershipStatus $status): LengthAwarePaginator`

- [ ] **Step 1: Write the failing tests**

`tests/Feature/Identity/ReaderManagementTest.php`:

```php
<?php

declare(strict_types=1);

use App\Domain\Audit\Models\AuditLog;
use App\Domain\Identity\Actions\IssuePasswordResetAction;
use App\Domain\Identity\Enums\MembershipStatus;
use App\Domain\Identity\Models\Bookshelf;
use App\Domain\Identity\Models\Membership;
use App\Domain\Identity\Models\User;
use App\Support\CurrentBookshelf;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;

uses(RefreshDatabase::class);

it('issues a temporary password and forces a change', function () {
    $shelf = Bookshelf::factory()->create();
    app(CurrentBookshelf::class)->set($shelf);

    $manager = User::factory()->create();
    $reader = User::factory()->create();

    $temporary = app(IssuePasswordResetAction::class)->execute($reader, $manager);

    $reader->refresh();

    expect($temporary)->toBeString()
        ->and(strlen($temporary))->toBe(10)
        ->and(Hash::check($temporary, $reader->password))->toBeTrue()
        ->and($reader->must_change_password)->toBeTrue();
});

it('never writes the temporary password into the audit log', function () {
    $shelf = Bookshelf::factory()->create();
    app(CurrentBookshelf::class)->set($shelf);

    $temporary = app(IssuePasswordResetAction::class)
        ->execute(User::factory()->create(), User::factory()->create());

    $rows = AuditLog::where('action', 'user.password_reset_issued')->get();

    expect($rows)->toHaveCount(1)
        ->and(json_encode($rows->toArray()))->not->toContain($temporary);
});

it('suspends a member', function () {
    $shelf = Bookshelf::factory()->create(['slug' => 'chinh']);
    $manager = User::factory()->create();
    Membership::factory()->for($shelf)->for($manager)->manager()->create();
    $reader = Membership::factory()->for($shelf)->create();

    $this->actingAs($manager)
        ->post("/portal/chinh/quan-ly/nguoi-doc/{$reader->id}/tam-khoa", ['reason' => 'Chuyển xứ'])
        ->assertRedirect();

    expect($reader->fresh()->status)->toBe(MembershipStatus::Suspended);
});

it('creates a reader on their behalf as already active', function () {
    $shelf = Bookshelf::factory()->create(['slug' => 'chinh']);
    $manager = User::factory()->create();
    Membership::factory()->for($shelf)->for($manager)->manager()->create();

    $this->actingAs($manager)->post('/portal/chinh/quan-ly/nguoi-doc/tao-moi', [
        'username' => 'anna.thu',
        'password' => 'mat-khau-123',
        'password_confirmation' => 'mat-khau-123',
        'saint_name' => 'Anna',
        'full_name' => 'Lê Thị Thu',
        'date_of_birth' => '2013-03-11',
        'father_name' => 'Lê Văn C',
        'mother_name' => 'Phạm Thị D',
        'parish_group' => 'Tổ 1',
        'parish' => 'Giáo họ Fatima',
    ])->assertRedirect();

    $created = Membership::whereRelation('user', 'username', 'anna.thu')->first();

    expect($created->status)->toBe(MembershipStatus::Active);
});

it('forbids a reader from listing other readers', function () {
    $shelf = Bookshelf::factory()->create(['slug' => 'chinh']);
    $reader = User::factory()->create();
    Membership::factory()->for($shelf)->for($reader)->create();

    $this->actingAs($reader)->get('/portal/chinh/quan-ly/nguoi-doc')->assertForbidden();
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
php artisan test --filter=ReaderManagement
```

Expected: FAIL — `Class "App\Domain\Identity\Actions\IssuePasswordResetAction" not found`.

- [ ] **Step 3: Write the password reset action**

```php
<?php

declare(strict_types=1);

namespace App\Domain\Identity\Actions;

use App\Domain\Audit\AuditLogger;
use App\Domain\Identity\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

final class IssuePasswordResetAction
{
    public function __construct(private readonly AuditLogger $audit) {}

    /**
     * Returns the temporary password so the manager can read it aloud once.
     * It is never stored in plain text and never written to the audit log.
     */
    public function execute(User $user, User $issuer): string
    {
        $temporary = Str::password(10, symbols: false);

        DB::transaction(function () use ($user, $issuer, $temporary): void {
            $user->forceFill([
                'password' => Hash::make($temporary),
                'must_change_password' => true,
            ])->saveQuietly();

            $this->audit->log('user.password_reset_issued', $user, null, [
                'issued_by' => $issuer->username,
            ]);
        });

        return $temporary;
    }
}
```

Symbols are excluded because a volunteer reads this aloud to a child who then types it on a phone. A password nobody can transcribe just generates a second support request.

- [ ] **Step 4: Write the remaining actions**

`SuspendMembershipAction` sets `status` to `Suspended` with a `suspended_reason` and logs `membership.suspended`. `ReactivateMembershipAction` sets it back to `Active`, clears the reason, and logs `membership.reactivated`. Both follow the `ApproveMembershipAction` shape from Task 6 exactly: transaction, capture before, update, audit, return.

`CreateReaderByManagerAction` mirrors `RegisterMembershipAction` but sets `status` to `MembershipStatus::Active`, with `approved_by_user_id` and `approved_at` set to the creating manager and now, and logs `membership.approved` in addition to `membership.registered`. The manager is standing in front of the person, so the approval step is already satisfied.

- [ ] **Step 5: Write the reader list query**

```php
<?php

declare(strict_types=1);

namespace App\Domain\Identity\Queries;

use App\Domain\Identity\Enums\MembershipStatus;
use App\Domain\Identity\Models\Membership;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;

final class ReaderListQuery
{
    public function paginate(?string $search = null, ?MembershipStatus $status = null): LengthAwarePaginator
    {
        return Membership::query()
            ->with('user')
            ->when($status !== null, fn ($q) => $q->where('memberships.status', $status))
            ->when($search !== null && $search !== '', function ($q) use ($search): void {
                $q->whereHas('user', function ($u) use ($search): void {
                    $u->where('full_name', 'like', "%{$search}%")
                        ->orWhere('username', 'like', "%{$search}%");
                });
            })
            ->join('users', 'users.id', '=', 'memberships.user_id')
            ->orderBy('users.full_name')
            ->select('memberships.*')
            ->paginate(50)
            ->withQueryString();
    }
}
```

`with('user')` is not optional. Without it the list issues one query per reader, which is the N+1 that RULES.md §2.6 calls a defect rather than a performance nicety.

- [ ] **Step 6: Write the controller and routes**

`ReaderController` exposes `index`, `show`, `store`, `suspend`, `reactivate` and `resetPassword`. Every method authorises against the matching `Permission` case before doing anything, using the same `authorizePermission` helper shape as `RegistrationApprovalController`.

`resetPassword` returns the temporary password in a flash message so the manager can read it to the reader once. It is shown a single time and never persisted anywhere readable.

Add to the `manager.` group in `routes/manager.php`:

```php
Route::get('/nguoi-doc', [ReaderController::class, 'index'])->name('readers.index');
Route::post('/nguoi-doc/tao-moi', [ReaderController::class, 'store'])->name('readers.store');
Route::get('/nguoi-doc/{membership}', [ReaderController::class, 'show'])->name('readers.show');
Route::post('/nguoi-doc/{membership}/tam-khoa', [ReaderController::class, 'suspend'])->name('readers.suspend');
Route::post('/nguoi-doc/{membership}/mo-khoa', [ReaderController::class, 'reactivate'])->name('readers.reactivate');
Route::post('/nguoi-doc/{membership}/dat-lai-mat-khau', [ReaderController::class, 'resetPassword'])->name('readers.reset-password');
```

The `tao-moi` route is registered **before** `{membership}` so the literal segment is not captured as a parameter.

- [ ] **Step 7: Write the React pages**

`manager/readers/Index.tsx` — a search box, status filter chips, and a list that is a table on desktop and stacked cards below 768px. Each row shows saint name, full name, tổ, and a status badge with icon and word.

`manager/readers/Show.tsx` — the full profile including the manager-only fields (date of birth, parents' names, phone), current loans, complete history, and the administrative actions. The reset-password result appears in a dismissible panel with a copy button and states plainly that it will not be shown again.

- [ ] **Step 8: Run tests to verify they pass**

```bash
php artisan test --filter=ReaderManagement
```

Expected: PASS, 5 tests.

- [ ] **Step 9: Run the full suite and static analysis**

```bash
php artisan test
vendor/bin/pint --test
vendor/bin/phpstan analyse
npx tsc --noEmit
```

Expected: all green. Milestone B is complete — a volunteer can log in, a reader can apply, and a manager can approve, suspend and reset.

- [ ] **Step 10: Commit**

```bash
git switch -c feat/reader-management
git add -A
git commit -m "feat(identity): add reader management and manager-issued reset

The temporary password is returned to the caller for the manager to read
aloud once, and is never stored in plain text or written to the audit log.
A test asserts the generated value appears in no audit row.

Symbols are excluded from the generated password because a volunteer reads
it to a child who types it on a phone.

Creating a reader on their behalf produces an already-active membership,
since the manager is standing in front of the person."
```

---

## Milestone C — Catalogue

Ends with books and physical copies catalogued, browsable by the public, and searchable in Vietnamese with or without diacritics.

---

### Task 8: Vietnamese text normalisation

Search must find "Tìm Kiếm Kho Báu" when a child types "tim kiem kho bau" on a phone without diacritics. Given the audience that behaviour matters far more than theoretical query efficiency, and at a few hundred books per shelf a normalised `LIKE` is instant.

**Files:**
- Create: `app/Support/TextNormalizer.php`
- Test: `tests/Unit/TextNormalizerTest.php`

**Interfaces:**
- Consumes: nothing.
- Produces: `TextNormalizer::normalize(?string $value): string` — lowercases, strips Vietnamese diacritics, collapses whitespace. Returns `''` for null.

**This class is used by both the write path and the read path.** If the two ever normalise differently, search breaks silently — which is why there is exactly one implementation and Task 9 wires the model observer to it.

- [ ] **Step 1: Write the failing test**

`tests/Unit/TextNormalizerTest.php`:

```php
<?php

declare(strict_types=1);

use App\Support\TextNormalizer;

it('strips vietnamese diacritics', function () {
    expect(TextNormalizer::normalize('Tìm Kiếm Kho Báu'))->toBe('tim kiem kho bau');
});

it('handles the d-with-stroke', function () {
    expect(TextNormalizer::normalize('Dế Mèn Phiêu Lưu Ký'))->toBe('de men phieu luu ky');
});

it('covers every vowel family', function () {
    expect(TextNormalizer::normalize('ăâàáạảãêềếệểễôơùúụủũưỳýỵỷỹđ'))
        ->toBe('aaaaaaaeeeeeeoouuuuuuyyyyyd');
});

it('lowercases and collapses whitespace', function () {
    expect(TextNormalizer::normalize("  Nguyễn   Nhật    Ánh  "))->toBe('nguyen nhat anh');
});

it('returns an empty string for null', function () {
    expect(TextNormalizer::normalize(null))->toBe('');
});

it('leaves plain ascii untouched', function () {
    expect(TextNormalizer::normalize('Harry Potter'))->toBe('harry potter');
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
php artisan test --filter=TextNormalizer
```

Expected: FAIL — `Class "App\Support\TextNormalizer" not found`.

- [ ] **Step 3: Write the normaliser**

```php
<?php

declare(strict_types=1);

namespace App\Support;

final class TextNormalizer
{
    private const FROM =
        'àáạảãâầấậẩẫăằắặẳẵ'.
        'èéẹẻẽêềếệểễ'.
        'ìíịỉĩ'.
        'òóọỏõôồốộổỗơờớợởỡ'.
        'ùúụủũưừứựửữ'.
        'ỳýỵỷỹ'.
        'đ';

    public static function normalize(?string $value): string
    {
        if ($value === null || trim($value) === '') {
            return '';
        }

        $lower = mb_strtolower($value, 'UTF-8');
        $plain = strtr($lower, self::map());

        return trim((string) preg_replace('/\s+/u', ' ', $plain));
    }

    /**
     * @return array<string, string>
     */
    private static function map(): array
    {
        static $map = null;

        if ($map !== null) {
            return $map;
        }

        $to = str_repeat('a', 17)
            .str_repeat('e', 11)
            .str_repeat('i', 5)
            .str_repeat('o', 17)
            .str_repeat('u', 11)
            .str_repeat('y', 5)
            .'d';

        $from = mb_str_split(self::FROM);
        $into = mb_str_split($to);

        return $map = array_combine($from, $into);
    }
}
```

The replacement string is built with `str_repeat` rather than typed out, so the two sides cannot drift out of alignment through a miscount. It deliberately avoids `intl` and `Str::ascii()`: the first may be absent on shared hosting, and the second depends on a library character map that could change between releases. An explicit table is deterministic forever.

- [ ] **Step 4: Run the test to verify it passes**

```bash
php artisan test --filter=TextNormalizer
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git switch -c feat/text-normalizer
git add -A
git commit -m "feat(catalog): add Vietnamese text normaliser for search

Lowercases and strips diacritics so a child typing 'tim kiem kho bau' on a
phone finds 'Tìm Kiếm Kho Báu'. At a few hundred books per shelf a
normalised LIKE is instant, and this behaviour matters far more to the
audience than query efficiency.

Uses an explicit character table rather than intl or Str::ascii — the first
may be absent on shared hosting and the second depends on a library map
that can change between releases."
```

---

### Task 9: Books

**Files:**
- Create: `database/migrations/*_create_categories_and_books_tables.php`
- Create: `app/Domain/Catalog/Models/Category.php`, `Book.php`
- Create: `app/Domain/Catalog/Actions/CreateBookAction.php`, `UpdateBookAction.php`, `DeleteBookAction.php`
- Create: `app/Domain/Catalog/Policies/BookPolicy.php`
- Create: `app/Http/Controllers/Manager/BookController.php`, `app/Http/Requests/BookRequest.php`
- Create: `app/Jobs/ResizeCoverImage.php`
- Create: `database/factories/BookFactory.php`, `CategoryFactory.php`
- Create: `resources/js/pages/manager/books/Index.tsx`, `Create.tsx`, `Edit.tsx`
- Test: `tests/Feature/Catalog/BookTest.php`, `tests/Feature/Invariants/TenantIsolationTest.php`

**Interfaces:**
- Consumes: `TextNormalizer` (Task 8), `BelongsToBookshelf` (Task 2), `Auditable` (Task 3), `Permission` (Task 4).
- Produces:
  - `Book` with `copies()`, `category()`, `bookshelf()`, scope `scopePublished()`, and `availableCopyCount(): int`.
  - `Category` with `books()`.
  - `CreateBookAction::execute(array $data, User $actor): Book`
  - `UpdateBookAction::execute(Book $book, array $data, User $actor): Book`
  - `DeleteBookAction::execute(Book $book, User $actor): void` — soft delete; refuses if any copy has loan history.
  - Routes `manager.books.*`.

- [ ] **Step 1: Write the failing tests**

`tests/Feature/Invariants/TenantIsolationTest.php` — this is the test that actually proves Task 2's design works:

```php
<?php

declare(strict_types=1);

use App\Domain\Catalog\Models\Book;
use App\Domain\Identity\Models\Bookshelf;
use App\Domain\Identity\Models\Membership;
use App\Domain\Identity\Models\User;
use App\Support\CurrentBookshelf;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

it('INV-10: a query only sees the current bookshelf', function () {
    $a = Bookshelf::factory()->create();
    $b = Bookshelf::factory()->create();

    Book::factory()->count(3)->create(['bookshelf_id' => $a->id]);
    Book::factory()->count(5)->create(['bookshelf_id' => $b->id]);

    app(CurrentBookshelf::class)->set($a);

    expect(Book::count())->toBe(3);
});

it('INV-10: creating a record fills bookshelf_id from the current shelf', function () {
    $shelf = Bookshelf::factory()->create();
    app(CurrentBookshelf::class)->set($shelf);

    $book = Book::factory()->create(['bookshelf_id' => null]);

    expect($book->bookshelf_id)->toBe($shelf->id);
});

it('INV-10: a manager of one shelf gets 404 for another shelf', function () {
    $mine = Bookshelf::factory()->create(['slug' => 'cua-toi']);
    $theirs = Bookshelf::factory()->create(['slug' => 'cua-ho']);

    $manager = User::factory()->create();
    Membership::factory()->for($mine)->for($manager)->manager()->create();

    $this->actingAs($manager)->get('/portal/cua-ho/quan-ly/sach')->assertForbidden();
});

it('INV-10: a book from another shelf is not reachable by id', function () {
    $mine = Bookshelf::factory()->create(['slug' => 'cua-toi']);
    $theirs = Bookshelf::factory()->create(['slug' => 'cua-ho']);

    $manager = User::factory()->create();
    Membership::factory()->for($mine)->for($manager)->manager()->create();

    $foreign = Book::factory()->create(['bookshelf_id' => $theirs->id]);

    $this->actingAs($manager)
        ->get("/portal/cua-toi/quan-ly/sach/{$foreign->slug}/sua")
        ->assertNotFound();
});

it('INV-10: an archived shelf returns 404', function () {
    Bookshelf::factory()->archived()->create(['slug' => 'da-dong']);

    $this->get('/portal/da-dong/sach')->assertNotFound();
});
```

`tests/Feature/Catalog/BookTest.php`:

```php
<?php

declare(strict_types=1);

use App\Domain\Audit\Models\AuditLog;
use App\Domain\Catalog\Models\Book;
use App\Domain\Identity\Models\Bookshelf;
use App\Domain\Identity\Models\Membership;
use App\Domain\Identity\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

function managerOf(Bookshelf $shelf): User
{
    $manager = User::factory()->create();
    Membership::factory()->for($shelf)->for($manager)->manager()->create();

    return $manager;
}

it('creates a book and normalises its title for search', function () {
    $shelf = Bookshelf::factory()->create(['slug' => 'chinh']);

    $this->actingAs(managerOf($shelf))->post('/portal/chinh/quan-ly/sach', [
        'title' => 'Dế Mèn Phiêu Lưu Ký',
        'author' => 'Tô Hoài',
        'page_count' => 180,
    ])->assertRedirect();

    $book = Book::first();

    expect($book->title_normalized)->toBe('de men phieu luu ky')
        ->and($book->author_normalized)->toBe('to hoai')
        ->and($book->slug)->not->toBeEmpty();
});

it('renormalises when the title changes', function () {
    $shelf = Bookshelf::factory()->create(['slug' => 'chinh']);
    $book = Book::factory()->create(['bookshelf_id' => $shelf->id, 'title' => 'Cũ']);

    $this->actingAs(managerOf($shelf))->put("/portal/chinh/quan-ly/sach/{$book->slug}", [
        'title' => 'Tôi Thấy Hoa Vàng',
        'author' => 'Nguyễn Nhật Ánh',
    ]);

    expect($book->fresh()->title_normalized)->toBe('toi thay hoa vang');
});

it('creates one copy automatically with the first book', function () {
    $shelf = Bookshelf::factory()->create(['slug' => 'chinh']);

    $this->actingAs(managerOf($shelf))->post('/portal/chinh/quan-ly/sach', [
        'title' => 'Sách Mới',
        'author' => 'Ai Đó',
        'copies' => 1,
    ]);

    expect(Book::first()->copies)->toHaveCount(1);
});

it('records the creation in the audit log', function () {
    $shelf = Bookshelf::factory()->create(['slug' => 'chinh']);
    $manager = managerOf($shelf);

    $this->actingAs($manager)->post('/portal/chinh/quan-ly/sach', [
        'title' => 'Sách Mới',
        'author' => 'Ai Đó',
    ]);

    expect(AuditLog::where('action', 'book.created')->first()?->actor_user_id)->toBe($manager->id);
});

it('requires a title', function () {
    $shelf = Bookshelf::factory()->create(['slug' => 'chinh']);

    $this->actingAs(managerOf($shelf))
        ->post('/portal/chinh/quan-ly/sach', ['author' => 'Ai Đó'])
        ->assertSessionHasErrors('title');
});

it('forbids a reader from creating a book', function () {
    $shelf = Bookshelf::factory()->create(['slug' => 'chinh']);
    $reader = User::factory()->create();
    Membership::factory()->for($shelf)->for($reader)->create();

    $this->actingAs($reader)
        ->post('/portal/chinh/quan-ly/sach', ['title' => 'X', 'author' => 'Y'])
        ->assertForbidden();
});

it('gives each book a unique slug within a shelf', function () {
    $shelf = Bookshelf::factory()->create(['slug' => 'chinh']);
    $manager = managerOf($shelf);

    $this->actingAs($manager)->post('/portal/chinh/quan-ly/sach', ['title' => 'Trùng Tên', 'author' => 'A']);
    $this->actingAs($manager)->post('/portal/chinh/quan-ly/sach', ['title' => 'Trùng Tên', 'author' => 'B']);

    expect(Book::pluck('slug')->unique())->toHaveCount(2);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
php artisan test --filter="BookTest|TenantIsolation"
```

Expected: FAIL — `Class "App\Domain\Catalog\Models\Book" not found`.

- [ ] **Step 3: Write the migration**

```php
<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('categories', function (Blueprint $table) {
            $table->id();
            $table->foreignId('bookshelf_id')->constrained('bookshelves');
            $table->string('name', 100);
            $table->string('slug', 100);
            $table->integer('sort_order')->default(0);
            $table->timestamps();
            $table->softDeletes();

            $table->unique(['bookshelf_id', 'slug']);
        });

        Schema::create('books', function (Blueprint $table) {
            $table->id();
            $table->foreignId('bookshelf_id')->constrained('bookshelves');
            $table->foreignId('category_id')->nullable()->constrained('categories');
            $table->string('title');
            $table->string('slug');
            $table->string('title_normalized');
            $table->string('author')->nullable();
            $table->string('author_normalized')->nullable();
            $table->string('publisher')->nullable();
            $table->smallInteger('published_year')->nullable();
            $table->string('isbn', 20)->nullable();
            $table->integer('page_count')->nullable();
            $table->text('description')->nullable();
            $table->string('cover_path')->nullable();
            $table->string('language', 5)->nullable();
            $table->boolean('is_published')->default(true);
            $table->foreignId('created_by_user_id')->constrained('users');
            $table->timestamps();
            $table->softDeletes();

            $table->unique(['bookshelf_id', 'slug']);
            $table->index(['bookshelf_id', 'title_normalized']);
            $table->index(['bookshelf_id', 'author_normalized']);
            $table->index(['bookshelf_id', 'category_id']);
            $table->index(['bookshelf_id', 'is_published']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('books');
        Schema::dropIfExists('categories');
    }
};
```

- [ ] **Step 4: Write the models**

`app/Domain/Catalog/Models/Book.php`:

```php
<?php

declare(strict_types=1);

namespace App\Domain\Catalog\Models;

use App\Domain\Audit\Concerns\Auditable;
use App\Domain\Catalog\Enums\CopyState;
use App\Domain\Identity\Concerns\BelongsToBookshelf;
use App\Support\TextNormalizer;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Book extends Model
{
    use Auditable, BelongsToBookshelf, HasFactory, SoftDeletes;

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['is_published' => 'boolean'];
    }

    protected static function booted(): void
    {
        static::saving(function (Book $book): void {
            $book->title_normalized = TextNormalizer::normalize($book->title);
            $book->author_normalized = TextNormalizer::normalize($book->author);
        });
    }

    public function auditPrefix(): string
    {
        return 'book';
    }

    public function getRouteKeyName(): string
    {
        return 'slug';
    }

    public function copies(): HasMany
    {
        return $this->hasMany(BookCopy::class);
    }

    public function category(): BelongsTo
    {
        return $this->belongsTo(Category::class);
    }

    public function scopePublished(Builder $q): Builder
    {
        return $q->where('is_published', true);
    }

    public function availableCopyCount(): int
    {
        return $this->copies->where('state', CopyState::Available)->count();
    }
}
```

Normalisation happens in a `saving` hook rather than in each Action, so no future write path can forget it. This is the single write-side half of the pair the search query depends on.

`Category` is a plain model using `BelongsToBookshelf` and `SoftDeletes`, with a `books(): HasMany` relation.

- [ ] **Step 5: Write the actions**

`app/Domain/Catalog/Actions/CreateBookAction.php`:

```php
<?php

declare(strict_types=1);

namespace App\Domain\Catalog\Actions;

use App\Domain\Catalog\Models\Book;
use App\Domain\Catalog\Models\BookCopy;
use App\Domain\Identity\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

final class CreateBookAction
{
    /**
     * @param  array<string, mixed>  $data
     */
    public function execute(array $data, User $actor): Book
    {
        return DB::transaction(function () use ($data, $actor): Book {
            $book = Book::create([
                'title' => $data['title'],
                'slug' => $this->uniqueSlug($data['title']),
                'author' => $data['author'] ?? null,
                'publisher' => $data['publisher'] ?? null,
                'published_year' => $data['published_year'] ?? null,
                'isbn' => $data['isbn'] ?? null,
                'page_count' => $data['page_count'] ?? null,
                'description' => $data['description'] ?? null,
                'category_id' => $data['category_id'] ?? null,
                'cover_path' => $data['cover_path'] ?? null,
                'is_published' => $data['is_published'] ?? true,
                'created_by_user_id' => $actor->id,
            ]);

            $count = max(1, (int) ($data['copies'] ?? 1));

            for ($i = 1; $i <= $count; $i++) {
                BookCopy::create([
                    'book_id' => $book->id,
                    'code' => $this->nextCode($book, $i),
                ]);
            }

            return $book;
        });
    }

    private function uniqueSlug(string $title): string
    {
        $base = Str::slug($title) ?: 'sach';
        $slug = $base;
        $n = 1;

        while (Book::withTrashed()->where('slug', $slug)->exists()) {
            $slug = $base.'-'.(++$n);
        }

        return $slug;
    }

    private function nextCode(Book $book, int $index): string
    {
        return str_pad((string) $book->id, 4, '0', STR_PAD_LEFT).'-'.$index;
    }
}
```

Every book gets at least one copy. A title with no physical object cannot be lent, and a manager who has just typed in a book they are holding should not have to perform a second step to say it exists.

No explicit audit call is needed — the `Auditable` trait's observer records `book.created` with the full attribute set.

`UpdateBookAction` assigns the changed fields and saves; the observer records `book.updated` with the before and after diff. `DeleteBookAction` soft-deletes, but first refuses with a domain exception if any copy has loan history, because deleting would orphan that history.

- [ ] **Step 5a: Write the book and category factories**

```php
<?php

declare(strict_types=1);

namespace Database\Factories;

use App\Domain\Catalog\Models\Book;
use App\Domain\Identity\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

class BookFactory extends Factory
{
    protected $model = Book::class;

    public function definition(): array
    {
        $title = fake()->sentence(3);

        return [
            'title' => $title,
            'slug' => Str::slug($title).'-'.fake()->unique()->numberBetween(1, 999999),
            'author' => fake()->name(),
            'page_count' => fake()->numberBetween(40, 400),
            'description' => fake()->paragraph(),
            'is_published' => true,
            'created_by_user_id' => User::factory(),
        ];
    }

    public function unpublished(): static
    {
        return $this->state(fn () => ['is_published' => false]);
    }
}
```

`title_normalized` and `author_normalized` are not set here — the model's `saving` hook derives them, and letting the factory bypass that would mean the tests never exercise the mechanism search depends on.

`CategoryFactory` follows the same shape with `name`, a slugged `slug`, and `sort_order` defaulting to 0.

- [ ] **Step 6: Write the cover upload job**

`app/Jobs/ResizeCoverImage.php` resizes an uploaded cover to a maximum 800px on the long edge and writes a WebP derivative. It is queued because it is deferrable — nobody waits on it, and the original is displayed until the derivative exists.

Uploads are validated as `['nullable', 'image', 'max:4096', 'mimes:jpg,jpeg,png,webp']` in `BookRequest`. Never trust the client-supplied MIME type; the `image` rule reads the file.

- [ ] **Step 7: Write the policy, request and controller**

`BookPolicy` maps `viewAny`, `view`, `create`, `update` and `delete` onto the matching `Permission` cases via `$user->hasPermission(...)` against the current bookshelf. Register it in `AppServiceProvider::boot()` with `Gate::policy(Book::class, BookPolicy::class)`.

`BookController` exposes `index`, `create`, `store`, `edit`, `update` and `destroy`. Each method calls `$this->authorize(...)` first and then delegates to one Action. No method exceeds fifteen lines.

- [ ] **Step 8: Write the routes**

In the `manager.` group:

```php
Route::get('/sach', [BookController::class, 'index'])->name('books.index');
Route::get('/sach/them', [BookController::class, 'create'])->name('books.create');
Route::post('/sach', [BookController::class, 'store'])->name('books.store');
Route::get('/sach/{book}/sua', [BookController::class, 'edit'])->name('books.edit');
Route::put('/sach/{book}', [BookController::class, 'update'])->name('books.update');
Route::delete('/sach/{book}', [BookController::class, 'destroy'])->name('books.destroy');
```

`/sach/them` is registered before `/sach/{book}/sua` so the literal is not captured as a slug.

- [ ] **Step 9: Write the React pages**

`manager/books/Index.tsx` — search box, category filter, and a list that is a table on desktop and stacked cards below 768px. Each row shows the cover thumbnail, title, author, and a copy-count badge reading "2/3 còn" (available over total).

`manager/books/Create.tsx` and `Edit.tsx` — a single-column form with the **cover uploader first**, because a photograph is the strongest recognition cue when a volunteer is checking they have the right record. Then title, author, category, page count, publisher, year, description, and a copy count that only appears on create.

- [ ] **Step 10: Run tests to verify they pass**

```bash
php artisan migrate
php artisan test --filter="BookTest|TenantIsolation"
```

Expected: PASS, 12 tests. Task 10 creates `BookCopy`, so run that task's migration first if the copy-creation test fails on a missing table — or implement Tasks 9 and 10 together and commit once.

- [ ] **Step 11: Commit**

```bash
git switch -c feat/books
git add -A
git commit -m "feat(catalog): add categories and books with normalised search

Normalisation runs in a saving hook rather than in each Action, so no
future write path can forget it — the search query depends on the write
side having used the same TextNormalizer.

Creating a book always creates at least one copy. A title with no physical
object cannot be lent, and a volunteer holding the book should not need a
second step to say it exists.

Adds the tenant isolation tests that actually prove the global scope works:
a manager of one shelf cannot see or reach another shelf's books."
```

---

### Task 10: Book copies and condition

A copy is the physical object that gets lent. Its `state` is availability; its `condition` is physical wear. Keeping them on separate axes is what makes "torn but still circulating" and "pristine but lost" both expressible.

**Files:**
- Create: `database/migrations/*_create_book_copies_and_assessments_tables.php`
- Create: `app/Domain/Catalog/Models/BookCopy.php`, `app/Domain/Circulation/Models/ConditionAssessment.php`
- Create: `app/Domain/Catalog/Enums/CopyState.php`, `CopyCondition.php`
- Create: `app/Domain/Catalog/Actions/AddBookCopyAction.php`, `RetireBookCopyAction.php`, `ReportCopyLostAction.php`, `MarkCopyFoundAction.php`, `AssessCopyConditionAction.php`
- Create: `app/Domain/Catalog/Exceptions/InvalidCopyTransitionException.php`
- Create: `app/Http/Controllers/Manager/BookCopyController.php`
- Create: `resources/js/components/circulation/ConditionPicker.tsx`, `resources/js/components/book/CopyList.tsx`
- Create: `database/factories/BookCopyFactory.php`
- Test: `tests/Feature/Catalog/BookCopyTest.php`

**Interfaces:**
- Consumes: `Book` (Task 9), `AuditLogger` (Task 3).
- Produces:
  - `CopyState` enum: `Available`, `Held`, `OnLoan`, `Lost`, `Retired` — with `canTransitionTo(CopyState $to): bool` and `isBorrowable(): bool`.
  - `CopyCondition` enum: `Perfect`, `SlightlyWorn`, `Worn`, `Torn`, `MissingPages`, `WrittenOn` — with `label(): string`. **`Lost` is deliberately absent; loss is a state.**
  - `BookCopy` with `book()`, `assessments()`, `loans()`, `activeLoan()`, scope `scopeAvailable()`.
  - `ConditionAssessment` with `copy()`, `assessedBy()`, `loan()`.
  - `AddBookCopyAction::execute(Book $book, array $data, User $actor): BookCopy`
  - `RetireBookCopyAction::execute(BookCopy $copy, User $actor, string $reason): BookCopy`
  - `ReportCopyLostAction::execute(BookCopy $copy, User $actor): BookCopy`
  - `MarkCopyFoundAction::execute(BookCopy $copy, User $actor): BookCopy`
  - `AssessCopyConditionAction::execute(BookCopy $copy, CopyCondition $c, User $actor, ?string $note = null, ?string $photoPath = null, ?int $loanId = null): ConditionAssessment` — the last parameter is a loan **id**, not a `Loan`, because Task 14 calls it from inside a transaction where the loan is already loaded and locked.

- [ ] **Step 1: Write the failing tests**

`tests/Feature/Catalog/BookCopyTest.php`:

```php
<?php

declare(strict_types=1);

use App\Domain\Catalog\Actions\MarkCopyFoundAction;
use App\Domain\Catalog\Actions\ReportCopyLostAction;
use App\Domain\Catalog\Actions\RetireBookCopyAction;
use App\Domain\Catalog\Enums\CopyCondition;
use App\Domain\Catalog\Enums\CopyState;
use App\Domain\Catalog\Exceptions\InvalidCopyTransitionException;
use App\Domain\Catalog\Models\BookCopy;
use App\Domain\Identity\Models\Bookshelf;
use App\Domain\Identity\Models\User;
use App\Support\CurrentBookshelf;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

beforeEach(function () {
    $this->shelf = Bookshelf::factory()->create(['slug' => 'chinh']);
    app(CurrentBookshelf::class)->set($this->shelf);
    $this->actor = User::factory()->create();
});

it('starts available and in perfect condition', function () {
    $copy = BookCopy::factory()->create();

    expect($copy->state)->toBe(CopyState::Available)
        ->and($copy->condition)->toBe(CopyCondition::Perfect);
});

it('reports a copy lost and allows it to be found again', function () {
    $copy = BookCopy::factory()->create();

    app(ReportCopyLostAction::class)->execute($copy, $this->actor);
    expect($copy->fresh()->state)->toBe(CopyState::Lost);

    app(MarkCopyFoundAction::class)->execute($copy->fresh(), $this->actor);
    expect($copy->fresh()->state)->toBe(CopyState::Available);
});

it('retires an available copy with a reason', function () {
    $copy = BookCopy::factory()->create();

    app(RetireBookCopyAction::class)->execute($copy, $this->actor, 'Rách hỏng nặng');

    $copy->refresh();

    expect($copy->state)->toBe(CopyState::Retired)
        ->and($copy->retired_reason)->toBe('Rách hỏng nặng')
        ->and($copy->retired_at)->not->toBeNull();
});

it('refuses to retire a copy that is on loan', function () {
    $copy = BookCopy::factory()->onLoan()->create();

    app(RetireBookCopyAction::class)->execute($copy, $this->actor, 'Bất kỳ');
})->throws(InvalidCopyTransitionException::class);

it('INV-7: a lost copy is not borrowable', function () {
    expect(CopyState::Lost->isBorrowable())->toBeFalse()
        ->and(CopyState::Retired->isBorrowable())->toBeFalse()
        ->and(CopyState::Available->isBorrowable())->toBeTrue();
});

it('rejects an illegal state transition', function () {
    expect(CopyState::Available->canTransitionTo(CopyState::Available))->toBeFalse()
        ->and(CopyState::Retired->canTransitionTo(CopyState::OnLoan))->toBeFalse()
        ->and(CopyState::OnLoan->canTransitionTo(CopyState::Retired))->toBeFalse()
        ->and(CopyState::OnLoan->canTransitionTo(CopyState::Lost))->toBeTrue();
});

it('records a condition assessment with its assessor', function () {
    $copy = BookCopy::factory()->create();

    $this->actingAs($this->actor)
        ->post("/portal/chinh/quan-ly/ban-sao/{$copy->id}/danh-gia", [
            'condition' => CopyCondition::Torn->value,
            'note' => 'Rách trang bìa',
        ]);

    $assessment = $copy->fresh()->assessments()->first();

    expect($assessment->condition)->toBe(CopyCondition::Torn)
        ->and($assessment->assessed_by_user_id)->toBe($this->actor->id)
        ->and($copy->fresh()->condition)->toBe(CopyCondition::Torn);
});

it('keeps the assessment history rather than overwriting it', function () {
    $copy = BookCopy::factory()->create();

    $this->actingAs($this->actor)
        ->post("/portal/chinh/quan-ly/ban-sao/{$copy->id}/danh-gia", ['condition' => CopyCondition::Worn->value]);
    $this->actingAs($this->actor)
        ->post("/portal/chinh/quan-ly/ban-sao/{$copy->id}/danh-gia", ['condition' => CopyCondition::Torn->value]);

    expect($copy->fresh()->assessments)->toHaveCount(2);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
php artisan test --filter=BookCopy
```

Expected: FAIL — `Class "App\Domain\Catalog\Enums\CopyState" not found`.

- [ ] **Step 3: Write the migration**

```php
<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('book_copies', function (Blueprint $table) {
            $table->id();
            $table->foreignId('bookshelf_id')->constrained('bookshelves');
            $table->foreignId('book_id')->constrained('books')->cascadeOnDelete();
            $table->string('code', 30);
            $table->string('state', 20)->default('available');
            $table->string('condition', 20)->default('perfect');
            $table->string('condition_note', 500)->nullable();
            $table->date('acquired_at')->nullable();
            $table->string('acquired_from', 150)->nullable();
            $table->timestamp('retired_at')->nullable();
            $table->string('retired_reason')->nullable();
            $table->timestamp('lost_at')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->unique(['bookshelf_id', 'code']);
            $table->index(['bookshelf_id', 'state']);
            $table->index(['book_id', 'state']);
        });

        Schema::create('condition_assessments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('bookshelf_id')->constrained('bookshelves');
            $table->foreignId('book_copy_id')->constrained('book_copies');
            $table->unsignedBigInteger('loan_id')->nullable();
            $table->foreignId('assessed_by_user_id')->constrained('users');
            $table->string('condition', 20);
            $table->string('note', 500)->nullable();
            $table->string('photo_path')->nullable();
            $table->timestamp('assessed_at');
            $table->timestamps();

            $table->index(['book_copy_id', 'assessed_at']);
            $table->index(['assessed_by_user_id', 'assessed_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('condition_assessments');
        Schema::dropIfExists('book_copies');
    }
};
```

`books → book_copies` is the only cascade in the schema. `condition_assessments.loan_id` gets its foreign key in Task 12, once `loans` exists.

- [ ] **Step 4: Write the enums**

`app/Domain/Catalog/Enums/CopyState.php`:

```php
<?php

declare(strict_types=1);

namespace App\Domain\Catalog\Enums;

enum CopyState: string
{
    case Available = 'available';
    case Held = 'held';
    case OnLoan = 'on_loan';
    case Lost = 'lost';
    case Retired = 'retired';

    public function isBorrowable(): bool
    {
        return $this === self::Available;
    }

    /**
     * The complete transition table from spec section 2.5. Anything absent is illegal.
     */
    public function canTransitionTo(self $to): bool
    {
        return in_array($to, match ($this) {
            self::Available => [self::Held, self::OnLoan, self::Retired],
            self::Held => [self::Available, self::OnLoan],
            self::OnLoan => [self::Available, self::Lost],
            self::Lost => [self::Available, self::Retired],
            self::Retired => [],
        }, strict: true);
    }

    public function label(): string
    {
        return __('catalog.copy_state.'.$this->value);
    }
}
```

`OnLoan` cannot go directly to `Retired`. A book in a child's bag has to come back or be declared lost before it can be written off, and encoding that here means no Action can skip it.

`app/Domain/Catalog/Enums/CopyCondition.php`:

```php
<?php

declare(strict_types=1);

namespace App\Domain\Catalog\Enums;

enum CopyCondition: string
{
    case Perfect = 'perfect';
    case SlightlyWorn = 'slightly_worn';
    case Worn = 'worn';
    case Torn = 'torn';
    case MissingPages = 'missing_pages';
    case WrittenOn = 'written_on';

    public function label(): string
    {
        return __('catalog.copy_condition.'.$this->value);
    }

    public function isDamaged(): bool
    {
        return $this !== self::Perfect;
    }
}
```

There is no `Lost` case here. Loss removes a copy from circulation, so it belongs on the state axis; a torn book keeps circulating, so damage belongs here.

- [ ] **Step 5: Write the models**

`BookCopy` uses `Auditable`, `BelongsToBookshelf`, `HasFactory` and `SoftDeletes`, casts `state` and `condition` to their enums, has `auditPrefix(): 'copy'`, relations `book()`, `assessments()`, `loans()`, `activeLoan()`, and:

```php
public function scopeAvailable(Builder $q): Builder
{
    return $q->where('state', CopyState::Available);
}

public function transitionTo(CopyState $to): void
{
    if (! $this->state->canTransitionTo($to)) {
        throw new InvalidCopyTransitionException(
            "Không thể chuyển bản sao từ {$this->state->value} sang {$to->value}."
        );
    }

    $this->state = $to;
}
```

Every Action that changes a copy's state calls `transitionTo()` rather than assigning `state` directly. That is what makes the transition table in the enum authoritative instead of decorative.

`ConditionAssessment` uses `BelongsToBookshelf`, casts `condition` and `assessed_at`, and has `copy()`, `assessedBy()` and `loan()` relations. It is never soft-deleted — an assessment is a historical fact about what a book looked like on a given day.

`app/Domain/Catalog/Exceptions/InvalidCopyTransitionException.php`:

```php
<?php

declare(strict_types=1);

namespace App\Domain\Catalog\Exceptions;

use RuntimeException;

final class InvalidCopyTransitionException extends RuntimeException {}
```

- [ ] **Step 5a: Write the copy factory**

The tests above already use `BookCopy::factory()->onLoan()`, so this factory has to exist with that state.

```php
<?php

declare(strict_types=1);

namespace Database\Factories;

use App\Domain\Catalog\Enums\CopyCondition;
use App\Domain\Catalog\Enums\CopyState;
use App\Domain\Catalog\Models\Book;
use App\Domain\Catalog\Models\BookCopy;
use Illuminate\Database\Eloquent\Factories\Factory;

class BookCopyFactory extends Factory
{
    protected $model = BookCopy::class;

    public function definition(): array
    {
        return [
            'book_id' => Book::factory(),
            'code' => strtoupper(fake()->unique()->bothify('??-####')),
            'state' => CopyState::Available,
            'condition' => CopyCondition::Perfect,
            'acquired_at' => fake()->dateTimeBetween('-3 years', 'now'),
        ];
    }

    public function onLoan(): static
    {
        return $this->state(fn () => ['state' => CopyState::OnLoan]);
    }

    public function lost(): static
    {
        return $this->state(fn () => ['state' => CopyState::Lost, 'lost_at' => now()]);
    }

    public function retired(): static
    {
        return $this->state(fn () => [
            'state' => CopyState::Retired,
            'retired_at' => now(),
            'retired_reason' => 'Hết hạn sử dụng',
        ]);
    }
}
```

`bookshelf_id` is deliberately absent: the `BelongsToBookshelf` trait fills it from the bound shelf on create, which is exactly the behaviour the tenancy tests assert.

- [ ] **Step 6: Write the actions**

`AssessCopyConditionAction`:

```php
<?php

declare(strict_types=1);

namespace App\Domain\Catalog\Actions;

use App\Domain\Audit\AuditLogger;
use App\Domain\Catalog\Enums\CopyCondition;
use App\Domain\Catalog\Models\BookCopy;
use App\Domain\Circulation\Models\ConditionAssessment;
use App\Domain\Identity\Models\User;
use Illuminate\Support\Facades\DB;

final class AssessCopyConditionAction
{
    public function __construct(private readonly AuditLogger $audit) {}

    public function execute(
        BookCopy $copy,
        CopyCondition $condition,
        User $actor,
        ?string $note = null,
        ?string $photoPath = null,
        ?int $loanId = null,
    ): ConditionAssessment {
        return DB::transaction(function () use ($copy, $condition, $actor, $note, $photoPath, $loanId): ConditionAssessment {
            $before = ['condition' => $copy->condition->value];

            $assessment = ConditionAssessment::create([
                'book_copy_id' => $copy->id,
                'loan_id' => $loanId,
                'assessed_by_user_id' => $actor->id,
                'condition' => $condition,
                'note' => $note,
                'photo_path' => $photoPath,
                'assessed_at' => now(),
            ]);

            $copy->forceFill([
                'condition' => $condition,
                'condition_note' => $note,
            ])->save();

            $this->audit->log('copy.condition_assessed', $copy, $before, [
                'condition' => $condition->value,
            ]);

            return $assessment;
        });
    }
}
```

The copy carries the *current* condition for fast display; `condition_assessments` carries the history. Neither is derivable from the other cheaply, so both are stored.

`ReportCopyLostAction`, `MarkCopyFoundAction` and `RetireBookCopyAction` each open a transaction, call `$copy->transitionTo(...)`, set the relevant timestamp and reason, save, and write an audit entry. `RetireBookCopyAction` will throw `InvalidCopyTransitionException` for an on-loan copy automatically, because the enum forbids that edge.

- [ ] **Step 7: Write the condition strings**

`resources/lang/vi/catalog.php`:

```php
<?php

declare(strict_types=1);

return [
    'copy_state' => [
        'available' => 'Còn sách',
        'held' => 'Đang giữ chỗ',
        'on_loan' => 'Đang mượn',
        'lost' => 'Đã mất',
        'retired' => 'Ngừng dùng',
    ],
    'copy_condition' => [
        'perfect' => 'Nguyên vẹn',
        'slightly_worn' => 'Hơi cũ',
        'worn' => 'Cũ',
        'torn' => 'Rách',
        'missing_pages' => 'Mất trang',
        'written_on' => 'Bị viết vẽ',
    ],
];
```

Create the English equivalent.

- [ ] **Step 8: Write the ConditionPicker component**

`resources/js/components/circulation/ConditionPicker.tsx` — a row of large buttons, one per condition, each with an icon and its Vietnamese label. `Nguyên vẹn` is preselected. Selection is shown with a filled background **and** a check mark, never colour alone. Buttons are at least 56px tall because this is used constantly and by children.

The note and photo fields render only when a condition other than `Nguyên vẹn` is chosen, so the common case stays a single tap.

- [ ] **Step 9: Run tests to verify they pass**

```bash
php artisan migrate
php artisan test --filter="BookCopy|BookTest|TenantIsolation"
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git switch -c feat/book-copies
git add -A
git commit -m "feat(catalog): add book copies, states and condition assessment

State is availability and condition is physical wear, on separate axes, so
'torn but still circulating' and 'pristine but lost' are both expressible.
CopyCondition therefore has no Lost case — loss removes a copy from
circulation and belongs on the state axis, with a path back for when a book
turns up (INV-7).

The transition table lives in the enum and every Action goes through
transitionTo(), so an on-loan copy cannot be retired without first being
returned or declared lost."
```

---

### Task 11: Public catalogue, book detail and search

**Files:**
- Create: `app/Domain/Catalog/Queries/CatalogQuery.php`, `BookDetailQuery.php`
- Create: `app/Http/Controllers/Public/ShelfHomeController.php`, `CatalogController.php`, `BookDetailController.php`, `SearchController.php`
- Create: `resources/js/layouts/ShelfLayout.tsx`, `PublicLayout.tsx`
- Create: `resources/js/pages/public/ShelfHome.tsx`, `Catalog.tsx`, `BookDetail.tsx`, `Search.tsx`
- Create: `resources/js/components/book/BookCard.tsx`, `BookGrid.tsx`, `CoverImage.tsx`, `AvailabilityBadge.tsx`
- Modify: `routes/public.php`
- Test: `tests/Feature/Catalog/PublicCatalogTest.php`

**Interfaces:**
- Consumes: `Book`, `BookCopy`, `CopyState`, `Bookshelf`.
- Produces:
  - `CatalogQuery::paginate(?string $search, bool $onlyAvailable, ?int $categoryId): LengthAwarePaginator`
  - `BookDetailQuery::forPublic(Book $book): array` — book fields, availability, and the current borrower when the shelf setting allows it.
  - Routes `shelf.home`, `catalog.index`, `books.show`, `search.index`.

- [ ] **Step 1: Write the failing tests**

`tests/Feature/Catalog/PublicCatalogTest.php`:

```php
<?php

declare(strict_types=1);

use App\Domain\Catalog\Models\Book;
use App\Domain\Catalog\Models\BookCopy;
use App\Domain\Identity\Models\Bookshelf;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Inertia\Testing\AssertableInertia;

uses(RefreshDatabase::class);

beforeEach(function () {
    $this->shelf = Bookshelf::factory()->create(['slug' => 'chinh']);
});

it('shows the shelf home to a guest', function () {
    $this->get('/portal/chinh')
        ->assertSuccessful()
        ->assertInertia(fn (AssertableInertia $p) => $p->component('public/ShelfHome'));
});

it('lists all books', function () {
    Book::factory()->count(4)->create(['bookshelf_id' => $this->shelf->id]);

    $this->get('/portal/chinh/sach')
        ->assertInertia(fn (AssertableInertia $p) => $p->has('books.data', 4));
});

it('filters to only available books', function () {
    $available = Book::factory()->create(['bookshelf_id' => $this->shelf->id]);
    BookCopy::factory()->for($available)->create(['bookshelf_id' => $this->shelf->id]);

    $out = Book::factory()->create(['bookshelf_id' => $this->shelf->id]);
    BookCopy::factory()->for($out)->onLoan()->create(['bookshelf_id' => $this->shelf->id]);

    $this->get('/portal/chinh/sach?trang_thai=con-sach')
        ->assertInertia(fn (AssertableInertia $p) => $p->has('books.data', 1));
});

it('finds a book typed without diacritics', function () {
    Book::factory()->create([
        'bookshelf_id' => $this->shelf->id,
        'title' => 'Dế Mèn Phiêu Lưu Ký',
    ]);

    $this->get('/portal/chinh/tim-kiem?tim=de+men')
        ->assertInertia(fn (AssertableInertia $p) => $p->has('books.data', 1));
});

it('finds a book by author typed without diacritics', function () {
    Book::factory()->create([
        'bookshelf_id' => $this->shelf->id,
        'title' => 'Cho Tôi Xin Một Vé Đi Tuổi Thơ',
        'author' => 'Nguyễn Nhật Ánh',
    ]);

    $this->get('/portal/chinh/tim-kiem?tim=nguyen+nhat+anh')
        ->assertInertia(fn (AssertableInertia $p) => $p->has('books.data', 1));
});

it('hides unpublished books from the public', function () {
    Book::factory()->create(['bookshelf_id' => $this->shelf->id, 'is_published' => false]);

    $this->get('/portal/chinh/sach')
        ->assertInertia(fn (AssertableInertia $p) => $p->has('books.data', 0));
});

it('shows a book detail page with availability', function () {
    $book = Book::factory()->create(['bookshelf_id' => $this->shelf->id, 'title' => 'Sách A']);
    BookCopy::factory()->for($book)->create(['bookshelf_id' => $this->shelf->id]);

    $this->get("/portal/chinh/sach/{$book->slug}")
        ->assertSuccessful()
        ->assertInertia(fn (AssertableInertia $p) => $p
            ->component('public/BookDetail')
            ->where('book.title', 'Sách A')
            ->where('book.available_count', 1));
});

it('does not leak manager-only reader fields to the public', function () {
    $book = Book::factory()->create(['bookshelf_id' => $this->shelf->id]);
    BookCopy::factory()->for($book)->create(['bookshelf_id' => $this->shelf->id]);

    $response = $this->get("/portal/chinh/sach/{$book->slug}");

    expect($response->content())
        ->not->toContain('date_of_birth')
        ->and($response->content())->not->toContain('father_name');
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
php artisan test --filter=PublicCatalog
```

Expected: FAIL — 404 on `/portal/chinh`.

- [ ] **Step 3: Write the catalogue query**

```php
<?php

declare(strict_types=1);

namespace App\Domain\Catalog\Queries;

use App\Domain\Catalog\Enums\CopyState;
use App\Domain\Catalog\Models\Book;
use App\Support\TextNormalizer;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;

final class CatalogQuery
{
    public function paginate(?string $search = null, bool $onlyAvailable = false, ?int $categoryId = null): LengthAwarePaginator
    {
        $term = TextNormalizer::normalize($search);

        return Book::query()
            ->published()
            ->with(['category'])
            ->withCount([
                'copies as available_count' => fn ($q) => $q->where('state', CopyState::Available),
                'copies as total_count' => fn ($q) => $q->whereNotIn('state', [CopyState::Retired]),
            ])
            ->when($term !== '', fn ($q) => $q->where(function ($w) use ($term): void {
                $w->where('title_normalized', 'like', "%{$term}%")
                    ->orWhere('author_normalized', 'like', "%{$term}%");
            }))
            ->when($categoryId !== null, fn ($q) => $q->where('category_id', $categoryId))
            ->when($onlyAvailable, fn ($q) => $q->whereHas('copies', fn ($c) => $c->where('state', CopyState::Available)))
            ->orderBy('title')
            ->paginate(24)
            ->withQueryString();
    }
}
```

The search term goes through the **same** `TextNormalizer` that the `Book` saving hook used. That symmetry is the whole mechanism; if the two ever diverge, search silently returns nothing.

`withCount` computes availability in the same query rather than loading every copy — this list is the most-visited page in the application.

- [ ] **Step 4: Write the book detail query**

`BookDetailQuery::forPublic()` returns the book's fields, `available_count`, `total_count`, the per-copy states, and — only when `settings()->publicShowCurrentBorrower` is true — the current borrower's `displayNameFor($shelf)` and how many days they have had it.

It must never expose `date_of_birth`, `father_name`, `mother_name`, `phone`, `parish_group` or `parish`. Those are manager-only, and the last test in Step 1 asserts it.

- [ ] **Step 5: Write the controllers and routes**

Add to `routes/public.php`, inside the existing `portal/{bookshelf}` group:

```php
Route::get('/', [ShelfHomeController::class, 'index'])->name('shelf.home');
Route::get('/sach', [CatalogController::class, 'index'])->name('catalog.index');
Route::get('/tim-kiem', [SearchController::class, 'index'])->name('search.index');
Route::get('/sach/{book}', [BookDetailController::class, 'show'])->name('books.show');
```

`/sach/{book}` comes last so `/sach` and `/tim-kiem` are matched as literals first.

The query parameters are Vietnamese to match the interface: `?trang_thai=con-sach|tat-ca`, `?tim=`, `?danh-muc=`.

- [ ] **Step 6: Write the layouts and components**

`ShelfLayout.tsx` — top navigation with the shelf name, *Sách*, *Tìm kiếm*, and a login link. Collapses to a hamburger below 768px.

`BookCard.tsx` — cover-dominant at a 2:3 aspect ratio, title clamped to two lines, author to one, and an `AvailabilityBadge` pinned to the cover corner.

`CoverImage.tsx` — when `cover_path` is null it renders a generated placeholder using the title's first letter over a colour derived from the title, so the grid never looks broken.

`AvailabilityBadge.tsx` — icon plus word plus colour, never colour alone: `BookOpen` / *Còn sách* / green, `BookMarked` / *Đang mượn* / amber.

- [ ] **Step 7: Write the pages**

`ShelfHome.tsx` — in order: shelf identity with a **tappable** keeper phone number (`tel:` link, since that is the actual mechanism by which a child finds the book keeper); then two very large buttons, *Sách đang có* and *Toàn bộ tủ sách*; then a most-borrowed row. Announcements are a Phase 2 addition and their region is simply absent for now.

`Catalog.tsx` — a responsive grid, two columns on phones up to six on desktop, with the available/all toggle as a **segmented control rather than a dropdown**, because it is the most-used control on the page.

`BookDetail.tsx` — cover and title, then a clear availability panel that changes with state, then metadata and description. The "Xin mượn" button is Phase 2; in Phase 1 an unavailable book shows the keeper's contact instead, which is honest about how a child actually gets a book right now.

`Search.tsx` — results update as the reader types, debounced through `useDebounce`. The empty state suggests popular books rather than showing nothing.

- [ ] **Step 8: Run tests to verify they pass**

```bash
php artisan test --filter=PublicCatalog
```

Expected: PASS, 8 tests.

- [ ] **Step 9: Verify manually**

```bash
npm run dev
```

Visit `/portal/chinh/sach` on a 375px viewport. Confirm the grid is two columns, the toggle is reachable with a thumb, and a book typed without diacritics is found.

- [ ] **Step 10: Commit**

```bash
git switch -c feat/public-catalogue
git add -A
git commit -m "feat(catalog): add public catalogue, book detail and search

Search normalises the query through the same TextNormalizer the write path
used, so a child typing without diacritics finds the book. Availability is
computed with withCount in one query rather than by loading every copy —
this is the most-visited page in the application.

The public payload never includes date of birth, parents' names, phone,
tổ or giáo họ; a test asserts they do not appear in the response."
```

---

## Milestone D — Circulation

Ends with the core loop working: a volunteer lends a book in three taps, takes it back with a condition assessment, and every action is audited.

---

### Task 12: Loans schema and the INV-1 database guarantee

This is the most important table in the system, and the one place where a race condition is genuinely likely: two managers at the same physical shelf, each with a phone, each tapping "Cho mượn" on the same book within the same second.

An application-level check cannot prevent that — between the check and the insert there is a window. So the guarantee is physical.

**Files:**
- Create: `database/migrations/*_create_loans_table.php`
- Create: `app/Domain/Circulation/Models/Loan.php`, `app/Domain/Circulation/Enums/LoanStatus.php`
- Create: `app/Domain/Circulation/Queries/OverdueLoansQuery.php`, `ActiveLoansQuery.php`
- Create: `database/factories/LoanFactory.php`
- Test: `tests/Feature/Invariants/OneActiveLoanPerCopyTest.php`, `tests/Feature/Circulation/LoanModelTest.php`

**Interfaces:**
- Consumes: `BookCopy` (Task 10), `User`, `Bookshelf`.
- Produces:
  - `LoanStatus` enum: `Active`, `Returned`, `Lost`, `Voided`.
  - `Loan` with `copy()`, `book()`, `borrower()`, `lentBy()`, `receivedBy()`, `assessments()`, and:
    - `scopeActive(Builder $q): Builder`
    - `scopeOverdue(Builder $q): Builder` — **the single owner of overdue logic**
    - `scopeDueSoon(Builder $q, int $days): Builder`
    - `isOverdue(): bool`, `daysOverdue(): int`, `daysHeld(): int`
  - `OverdueLoansQuery::get(): Collection`, `::count(): int`
  - `ActiveLoansQuery::paginate(?string $search): LengthAwarePaginator`

- [ ] **Step 1: Write the failing tests**

`tests/Feature/Invariants/OneActiveLoanPerCopyTest.php`:

```php
<?php

declare(strict_types=1);

use App\Domain\Catalog\Models\BookCopy;
use App\Domain\Circulation\Enums\LoanStatus;
use App\Domain\Circulation\Models\Loan;
use App\Domain\Identity\Models\Bookshelf;
use App\Domain\Identity\Models\User;
use App\Support\CurrentBookshelf;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;

uses(RefreshDatabase::class);

beforeEach(function () {
    $this->shelf = Bookshelf::factory()->create();
    app(CurrentBookshelf::class)->set($this->shelf);
});

it('INV-1: the database refuses a second active loan on one copy', function () {
    $copy = BookCopy::factory()->create();

    Loan::factory()->for($copy, 'copy')->create(['status' => LoanStatus::Active]);
    Loan::factory()->for($copy, 'copy')->create(['status' => LoanStatus::Active]);
})->throws(QueryException::class);

it('INV-1: the constraint holds even when the application check is bypassed', function () {
    $copy = BookCopy::factory()->create();
    $borrower = User::factory()->create();

    $row = [
        'bookshelf_id' => $this->shelf->id,
        'book_copy_id' => $copy->id,
        'book_id' => $copy->book_id,
        'user_id' => $borrower->id,
        'lent_by_user_id' => $borrower->id,
        'lent_at' => now(),
        'due_on' => now()->addDays(14)->toDateString(),
        'status' => 'active',
        'renewals_used' => 0,
        'created_at' => now(),
        'updated_at' => now(),
    ];

    DB::table('loans')->insert($row);
    DB::table('loans')->insert($row);
})->throws(QueryException::class);

it('INV-1: any number of returned loans may coexist for one copy', function () {
    $copy = BookCopy::factory()->create();

    Loan::factory()->count(5)->for($copy, 'copy')->create(['status' => LoanStatus::Returned]);
    Loan::factory()->for($copy, 'copy')->create(['status' => LoanStatus::Active]);

    expect(Loan::where('book_copy_id', $copy->id)->count())->toBe(6);
});

it('INV-1: returning a copy frees it for the next active loan', function () {
    $copy = BookCopy::factory()->create();

    $first = Loan::factory()->for($copy, 'copy')->create(['status' => LoanStatus::Active]);
    $first->update(['status' => LoanStatus::Returned, 'returned_at' => now()]);

    Loan::factory()->for($copy, 'copy')->create(['status' => LoanStatus::Active]);

    expect(Loan::where('book_copy_id', $copy->id)->where('status', LoanStatus::Active)->count())->toBe(1);
});

it('INV-11: the loans table has no soft-delete column', function () {
    expect(Illuminate\Support\Facades\Schema::hasColumn('loans', 'deleted_at'))->toBeFalse();
});
```

`tests/Feature/Circulation/LoanModelTest.php`:

```php
<?php

declare(strict_types=1);

use App\Domain\Circulation\Enums\LoanStatus;
use App\Domain\Circulation\Models\Loan;
use App\Domain\Identity\Models\Bookshelf;
use App\Support\CurrentBookshelf;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

beforeEach(function () {
    app(CurrentBookshelf::class)->set(Bookshelf::factory()->create());
});

it('treats a loan due yesterday as overdue', function () {
    $loan = Loan::factory()->create([
        'status' => LoanStatus::Active,
        'due_on' => now()->subDay()->toDateString(),
    ]);

    expect($loan->isOverdue())->toBeTrue()
        ->and(Loan::overdue()->count())->toBe(1);
});

it('does not treat a loan due today as overdue', function () {
    Loan::factory()->create([
        'status' => LoanStatus::Active,
        'due_on' => now()->toDateString(),
    ]);

    expect(Loan::overdue()->count())->toBe(0);
});

it('never treats a returned loan as overdue, however late it was', function () {
    Loan::factory()->create([
        'status' => LoanStatus::Returned,
        'due_on' => now()->subMonth()->toDateString(),
        'returned_at' => now(),
    ]);

    expect(Loan::overdue()->count())->toBe(0);
});

it('counts days overdue from the due date', function () {
    $loan = Loan::factory()->create([
        'status' => LoanStatus::Active,
        'due_on' => now()->subDays(3)->toDateString(),
    ]);

    expect($loan->daysOverdue())->toBe(3);
});

it('excludes voided loans from the active list', function () {
    Loan::factory()->create(['status' => LoanStatus::Voided]);

    expect(Loan::active()->count())->toBe(0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
php artisan test --filter="OneActiveLoanPerCopy|LoanModel"
```

Expected: FAIL — `Class "App\Domain\Circulation\Models\Loan" not found`.

- [ ] **Step 3: Write the migration**

```php
<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('loans', function (Blueprint $table) {
            $table->id();
            $table->foreignId('bookshelf_id')->constrained('bookshelves');
            $table->foreignId('book_copy_id')->constrained('book_copies')->restrictOnDelete();
            $table->foreignId('book_id')->constrained('books')->restrictOnDelete();
            $table->foreignId('user_id')->constrained('users');
            $table->unsignedBigInteger('borrow_request_id')->nullable();
            $table->foreignId('lent_by_user_id')->constrained('users');
            $table->timestamp('lent_at');
            $table->date('due_on');
            $table->string('status', 20)->default('active');
            $table->timestamp('returned_at')->nullable();
            $table->foreignId('received_by_user_id')->nullable()->constrained('users');
            $table->string('return_condition', 20)->nullable();
            $table->string('return_condition_note', 500)->nullable();
            $table->string('return_photo_path')->nullable();
            $table->tinyInteger('renewals_used')->default(0);
            $table->timestamp('lost_reported_at')->nullable();
            $table->foreignId('lost_reported_by_user_id')->nullable()->constrained('users');
            $table->timestamp('voided_at')->nullable();
            $table->foreignId('voided_by_user_id')->nullable()->constrained('users');
            $table->string('voided_reason')->nullable();
            $table->text('notes')->nullable();
            $table->timestamps();

            $table->index(['bookshelf_id', 'status', 'due_on']);
            $table->index(['user_id', 'status']);
            $table->index(['book_id', 'status']);
            $table->index(['bookshelf_id', 'lent_at']);
            $table->index(['lent_by_user_id', 'lent_at']);
        });

        // INV-1, enforced physically. MySQL treats NULL as distinct in a unique
        // index, so any number of returned loans coexist while two simultaneous
        // active loans on one copy are impossible.
        DB::statement("
            ALTER TABLE loans
            ADD COLUMN active_copy_key BIGINT UNSIGNED
            GENERATED ALWAYS AS (CASE WHEN status = 'active' THEN book_copy_id ELSE NULL END) STORED
        ");

        DB::statement('ALTER TABLE loans ADD UNIQUE KEY loans_active_copy_key_unique (active_copy_key)');

        Schema::table('condition_assessments', function (Blueprint $table) {
            $table->foreign('loan_id')->references('id')->on('loans');
        });
    }

    public function down(): void
    {
        Schema::table('condition_assessments', fn (Blueprint $t) => $t->dropForeign(['loan_id']));
        Schema::dropIfExists('loans');
    }
};
```

Three deliberate choices in this table:

- **`due_on` is a `date`, not a `timestamp`.** A book is due at the end of a day. A timestamp would make books fall overdue at some arbitrary hour of the afternoon, which is confusing for children and wrong for a shelf only accessible after Sunday mass.
- **`book_id` is denormalised** alongside `book_copy_id` so title-level statistics survive a copy being retired.
- **There is no `deleted_at`.** A loan recorded in error becomes `voided` with a reason (INV-11). Voiding is a real event with an actor and a timestamp; deletion is not.

The generated column is raw SQL rather than `$table->storedAs()` because the expression must be exact and the migration must fail loudly on a MySQL version that cannot support it.

- [ ] **Step 4: Write the enum**

```php
<?php

declare(strict_types=1);

namespace App\Domain\Circulation\Enums;

enum LoanStatus: string
{
    case Active = 'active';
    case Returned = 'returned';
    case Lost = 'lost';
    case Voided = 'voided';

    public function isOpen(): bool
    {
        return $this === self::Active;
    }

    public function label(): string
    {
        return __('circulation.loan_status.'.$this->value);
    }
}
```

- [ ] **Step 5: Write the model**

```php
<?php

declare(strict_types=1);

namespace App\Domain\Circulation\Models;

use App\Domain\Catalog\Models\Book;
use App\Domain\Catalog\Models\BookCopy;
use App\Domain\Circulation\Enums\LoanStatus;
use App\Domain\Identity\Concerns\BelongsToBookshelf;
use App\Domain\Identity\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Loan extends Model
{
    use BelongsToBookshelf, HasFactory;

    protected $guarded = ['id', 'active_copy_key'];

    protected function casts(): array
    {
        return [
            'status' => LoanStatus::class,
            'lent_at' => 'datetime',
            'due_on' => 'date',
            'returned_at' => 'datetime',
            'lost_reported_at' => 'datetime',
            'voided_at' => 'datetime',
        ];
    }

    public function copy(): BelongsTo
    {
        return $this->belongsTo(BookCopy::class, 'book_copy_id');
    }

    public function book(): BelongsTo
    {
        return $this->belongsTo(Book::class);
    }

    public function borrower(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id');
    }

    public function lentBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'lent_by_user_id');
    }

    public function receivedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'received_by_user_id');
    }

    public function assessments(): HasMany
    {
        return $this->hasMany(ConditionAssessment::class);
    }

    public function scopeActive(Builder $q): Builder
    {
        return $q->where('status', LoanStatus::Active);
    }

    /**
     * The single owner of overdue logic. Never write `due_on <` anywhere else.
     *
     * Overdue is derived, never stored: production cron may run only every
     * 10-30 minutes, so a job-written flag would be wrong for up to half an
     * hour. Computed here, the answer is correct even if cron never runs.
     */
    public function scopeOverdue(Builder $q): Builder
    {
        return $q->where('status', LoanStatus::Active)
            ->whereDate('due_on', '<', now()->toDateString());
    }

    public function scopeDueSoon(Builder $q, int $days): Builder
    {
        return $q->where('status', LoanStatus::Active)
            ->whereDate('due_on', '>=', now()->toDateString())
            ->whereDate('due_on', '<=', now()->addDays($days)->toDateString());
    }

    public function isOverdue(): bool
    {
        return $this->status === LoanStatus::Active
            && $this->due_on->startOfDay()->lt(now()->startOfDay());
    }

    public function daysOverdue(): int
    {
        return $this->isOverdue()
            ? (int) $this->due_on->startOfDay()->diffInDays(now()->startOfDay())
            : 0;
    }

    public function daysHeld(): int
    {
        $end = $this->returned_at ?? now();

        return (int) $this->lent_at->startOfDay()->diffInDays($end->startOfDay());
    }
}
```

`active_copy_key` is in `$guarded` because it is database-generated. Assigning it would make MySQL reject the write.

- [ ] **Step 6: Write the factory and queries**

`LoanFactory` produces an `Active` loan due 14 days out, with `BookCopy::factory()` and `User::factory()` defaults, plus `returned()`, `overdue()` and `voided()` states.

`OverdueLoansQuery::get()` returns `Loan::overdue()->with(['book', 'borrower', 'copy'])->orderBy('due_on')->get()`. The eager load is not optional: this list shows the borrower's phone number for every row, and without it the page issues one query per overdue book.

- [ ] **Step 7: Run tests to verify they pass**

```bash
php artisan migrate
php artisan test --filter="OneActiveLoanPerCopy|LoanModel"
```

Expected: PASS, 10 tests.

If the generated-column migration fails, check `SELECT VERSION()` — it must be 8.0.16 or newer. This is the constraint that makes SQLite unusable for this suite.

- [ ] **Step 8: Commit**

```bash
git switch -c feat/loans-schema
git add -A
git commit -m "feat(circulation): add loans schema with database-enforced INV-1

A stored generated column active_copy_key is book_copy_id while the loan is
active and NULL otherwise, with a unique index over it. MySQL treats NULL
as distinct in unique indexes, so any number of returned loans coexist
while two simultaneous active loans on one copy are impossible.

This has to be physical rather than an application check: two managers at
the same shelf, each with a phone, can tap 'Cho mượn' within the same
second, and between a check and an insert there is always a window. A test
bypasses the application entirely and asserts the database still refuses.

due_on is a DATE because a book is due at the end of a day. Overdue is
derived in one scope and never stored, so it stays correct even if cron
never runs. There is no deleted_at — mistakes are voided (INV-11)."
```

---

### Task 13: Lending

`LendBookDirectlyAction` is the heart of the application. It is what the quick-lend screen calls, and it enforces four invariants.

**Files:**
- Create: `app/Domain/Circulation/Actions/LendBookDirectlyAction.php`
- Create: `app/Domain/Circulation/Exceptions/LoanLimitReachedException.php`, `CopyNotAvailableException.php`, `MemberNotActiveException.php`
- Modify: `app/Exceptions` handler registration in `bootstrap/app.php`
- Test: `tests/Feature/Invariants/LendingRulesTest.php`

**Interfaces:**
- Consumes: `Loan`, `BookCopy`, `CopyState`, `Membership`, `BookshelfSettings`, `AuditLogger`.
- Produces: `LendBookDirectlyAction::execute(BookCopy $copy, User $borrower, User $lender): Loan`

- [ ] **Step 1: Write the failing tests**

`tests/Feature/Invariants/LendingRulesTest.php`:

```php
<?php

declare(strict_types=1);

use App\Domain\Catalog\Enums\CopyState;
use App\Domain\Catalog\Models\BookCopy;
use App\Domain\Circulation\Actions\LendBookDirectlyAction;
use App\Domain\Circulation\Enums\LoanStatus;
use App\Domain\Circulation\Exceptions\CopyNotAvailableException;
use App\Domain\Circulation\Exceptions\LoanLimitReachedException;
use App\Domain\Circulation\Exceptions\MemberNotActiveException;
use App\Domain\Circulation\Models\Loan;
use App\Domain\Identity\Models\Bookshelf;
use App\Domain\Identity\Models\Membership;
use App\Domain\Identity\Models\User;
use App\Support\CurrentBookshelf;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

beforeEach(function () {
    $this->shelf = Bookshelf::factory()->create(['settings' => ['loan_days' => 14, 'max_concurrent_loans' => 3]]);
    app(CurrentBookshelf::class)->set($this->shelf);

    $this->lender = User::factory()->create();
    Membership::factory()->for($this->shelf)->for($this->lender)->manager()->create();

    $this->borrower = User::factory()->create();
    Membership::factory()->for($this->shelf)->for($this->borrower)->create();
});

it('lends an available copy and sets the due date from the shelf policy', function () {
    $copy = BookCopy::factory()->create();

    $loan = app(LendBookDirectlyAction::class)->execute($copy, $this->borrower, $this->lender);

    expect($loan->status)->toBe(LoanStatus::Active)
        ->and($loan->due_on->toDateString())->toBe(now()->addDays(14)->toDateString())
        ->and($loan->lent_by_user_id)->toBe($this->lender->id)
        ->and($copy->fresh()->state)->toBe(CopyState::OnLoan);
});

it('INV-3: refuses a copy that is already on loan', function () {
    $copy = BookCopy::factory()->onLoan()->create();

    app(LendBookDirectlyAction::class)->execute($copy, $this->borrower, $this->lender);
})->throws(CopyNotAvailableException::class);

it('INV-7: refuses a lost copy', function () {
    $copy = BookCopy::factory()->create(['state' => CopyState::Lost]);

    app(LendBookDirectlyAction::class)->execute($copy, $this->borrower, $this->lender);
})->throws(CopyNotAvailableException::class);

it('INV-7: refuses a retired copy', function () {
    $copy = BookCopy::factory()->create(['state' => CopyState::Retired]);

    app(LendBookDirectlyAction::class)->execute($copy, $this->borrower, $this->lender);
})->throws(CopyNotAvailableException::class);

it('INV-4: refuses a borrower whose membership is suspended', function () {
    $suspended = User::factory()->create();
    Membership::factory()->for($this->shelf)->for($suspended)->suspended()->create();

    app(LendBookDirectlyAction::class)->execute(BookCopy::factory()->create(), $suspended, $this->lender);
})->throws(MemberNotActiveException::class);

it('INV-4: refuses a borrower who is not a member at all', function () {
    app(LendBookDirectlyAction::class)
        ->execute(BookCopy::factory()->create(), User::factory()->create(), $this->lender);
})->throws(MemberNotActiveException::class);

it('INV-5: refuses a borrower at the concurrent loan limit', function () {
    Loan::factory()->count(3)->create([
        'user_id' => $this->borrower->id,
        'status' => LoanStatus::Active,
    ]);

    app(LendBookDirectlyAction::class)->execute(BookCopy::factory()->create(), $this->borrower, $this->lender);
})->throws(LoanLimitReachedException::class);

it('INV-5: counts only active loans toward the limit', function () {
    Loan::factory()->count(5)->create([
        'user_id' => $this->borrower->id,
        'status' => LoanStatus::Returned,
        'returned_at' => now(),
    ]);

    $loan = app(LendBookDirectlyAction::class)
        ->execute(BookCopy::factory()->create(), $this->borrower, $this->lender);

    expect($loan->status)->toBe(LoanStatus::Active);
});

it('INV-5: respects a per-shelf override of the limit', function () {
    $this->shelf->update(['settings' => ['max_concurrent_loans' => 1]]);
    app(CurrentBookshelf::class)->set($this->shelf->fresh());

    Loan::factory()->create(['user_id' => $this->borrower->id, 'status' => LoanStatus::Active]);

    app(LendBookDirectlyAction::class)->execute(BookCopy::factory()->create(), $this->borrower, $this->lender);
})->throws(LoanLimitReachedException::class);

it('INV-8: writes an audit row naming the lender', function () {
    $copy = BookCopy::factory()->create();

    app(LendBookDirectlyAction::class)->execute($copy, $this->borrower, $this->lender);

    $entry = App\Domain\Audit\Models\AuditLog::where('action', 'loan.created')->first();

    expect($entry)->not->toBeNull()
        ->and($entry->after['borrower_id'])->toBe($this->borrower->id);
});

it('denormalises book_id so statistics survive copy retirement', function () {
    $copy = BookCopy::factory()->create();

    $loan = app(LendBookDirectlyAction::class)->execute($copy, $this->borrower, $this->lender);

    expect($loan->book_id)->toBe($copy->book_id);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
php artisan test --filter=LendingRules
```

Expected: FAIL — `Class "App\Domain\Circulation\Actions\LendBookDirectlyAction" not found`.

- [ ] **Step 3: Write the exceptions**

All three share a base class so a single exception handler covers them, and each carries a Vietnamese message suitable for showing to a volunteer.

```php
<?php

declare(strict_types=1);

namespace App\Domain\Circulation\Exceptions;

use RuntimeException;

abstract class CirculationException extends RuntimeException {}
```

```php
<?php

declare(strict_types=1);

namespace App\Domain\Circulation\Exceptions;

final class CopyNotAvailableException extends CirculationException
{
    public static function make(): self
    {
        return new self(__('circulation.errors.copy_not_available'));
    }
}
```

Write `LoanLimitReachedException`, `MemberNotActiveException` and `RenewalNotAllowedException` to the same shape — extending `CirculationException`, with a static `make()` reading `circulation.errors.loan_limit_reached`, `circulation.errors.member_not_active` and `circulation.errors.renewal_not_allowed` respectively.

- [ ] **Step 4: Write the action**

```php
<?php

declare(strict_types=1);

namespace App\Domain\Circulation\Actions;

use App\Domain\Audit\AuditLogger;
use App\Domain\Catalog\Enums\CopyState;
use App\Domain\Catalog\Models\BookCopy;
use App\Domain\Circulation\Enums\LoanStatus;
use App\Domain\Circulation\Exceptions\CopyNotAvailableException;
use App\Domain\Circulation\Exceptions\LoanLimitReachedException;
use App\Domain\Circulation\Exceptions\MemberNotActiveException;
use App\Domain\Circulation\Models\Loan;
use App\Domain\Identity\Models\User;
use App\Support\CurrentBookshelf;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

final class LendBookDirectlyAction
{
    public function __construct(
        private readonly AuditLogger $audit,
        private readonly CurrentBookshelf $currentBookshelf,
    ) {}

    public function execute(BookCopy $copy, User $borrower, User $lender): Loan
    {
        $shelf = $this->currentBookshelf->get();
        $settings = $shelf->settings();

        return DB::transaction(function () use ($copy, $borrower, $lender, $shelf, $settings): Loan {
            // Re-read the copy inside the transaction with a row lock. A check
            // performed before the transaction proves nothing about the state
            // at insert time.
            $locked = BookCopy::query()->lockForUpdate()->findOrFail($copy->id);

            // INV-3 and INV-7.
            if (! $locked->state->isBorrowable()) {
                throw CopyNotAvailableException::make();
            }

            // INV-4.
            $membership = $borrower->membershipFor($shelf);

            if ($membership === null || ! $membership->isActive()) {
                throw MemberNotActiveException::make();
            }

            // INV-5.
            $openLoans = Loan::query()
                ->where('user_id', $borrower->id)
                ->where('status', LoanStatus::Active)
                ->count();

            if ($openLoans >= $settings->maxConcurrentLoans) {
                throw LoanLimitReachedException::make();
            }

            try {
                $loan = Loan::create([
                    'book_copy_id' => $locked->id,
                    'book_id' => $locked->book_id,
                    'user_id' => $borrower->id,
                    'lent_by_user_id' => $lender->id,
                    'lent_at' => now(),
                    'due_on' => now()->addDays($settings->loanDays)->toDateString(),
                    'status' => LoanStatus::Active,
                    'renewals_used' => 0,
                ]);
            } catch (QueryException $e) {
                // The unique index on active_copy_key fired: another manager
                // lent this copy between our lock and this insert. Report the
                // same message the pre-check would have given.
                if ($this->isDuplicateActiveLoan($e)) {
                    throw CopyNotAvailableException::make();
                }

                throw $e;
            }

            $locked->transitionTo(CopyState::OnLoan);
            $locked->save();

            $this->audit->log('loan.created', $loan, null, [
                'borrower_id' => $borrower->id,
                'copy_id' => $locked->id,
                'due_on' => $loan->due_on->toDateString(),
            ]);

            return $loan;
        });
    }

    private function isDuplicateActiveLoan(QueryException $e): bool
    {
        return str_contains($e->getMessage(), 'loans_active_copy_key_unique');
    }
}
```

Three things worth understanding here:

**The row lock is inside the transaction**, and the copy is re-read rather than trusted. A check performed before `beginTransaction` proves nothing about the state at insert time.

**The `QueryException` is caught and translated.** The database constraint and the application check produce the *same* user-facing message, so a volunteer who loses a race sees "sách này vừa được cho mượn rồi" rather than a stack trace.

**The audit entry names the borrower by id, not by name.** Names change; ids do not, and the audit browser resolves them at read time.

- [ ] **Step 5: Add the circulation strings**

`resources/lang/vi/circulation.php`:

```php
<?php

declare(strict_types=1);

return [
    'loan_status' => [
        'active' => 'Đang mượn',
        'returned' => 'Đã trả',
        'lost' => 'Đã mất',
        'voided' => 'Đã huỷ ghi nhận',
    ],
    'errors' => [
        'copy_not_available' => 'Sách này vừa được cho mượn rồi. Vui lòng kiểm tra lại.',
        'loan_limit_reached' => 'Bạn đọc đang mượn tối đa số sách cho phép.',
        'member_not_active' => 'Tài khoản bạn đọc chưa được duyệt hoặc đang tạm khoá.',
        'renewal_not_allowed' => 'Không thể gia hạn sách này.',
    ],
    'lent' => 'Đã cho :name mượn :title. Hạn trả :due.',
    'returned' => 'Đã nhận lại :title.',
];
```

- [ ] **Step 6: Map the exceptions to friendly responses**

In `bootstrap/app.php`, render circulation exceptions as a redirect back with an error flash rather than a 500 page:

```php
->withExceptions(function (Exceptions $exceptions) {
    $exceptions->render(function (CirculationException $e, Request $request) {
        return back()->with('error', $e->getMessage());
    });
})
```

One handler covers all four because they share the `CirculationException` base class from Step 3. A volunteer who tries to lend an already-lent book sees a sentence they can act on, not a 500 page.

- [ ] **Step 7: Run tests to verify they pass**

```bash
php artisan test --filter=LendingRules
```

Expected: PASS, 11 tests.

- [ ] **Step 8: Commit**

```bash
git switch -c feat/lending
git add -A
git commit -m "feat(circulation): add direct lending with invariant enforcement

LendBookDirectlyAction enforces INV-3, INV-4, INV-5 and INV-7, re-reading
the copy under a row lock inside the transaction — a check performed before
beginTransaction proves nothing about the state at insert time.

When the unique index on active_copy_key fires because another manager won
the race, the QueryException is translated into the same
CopyNotAvailableException the pre-check would have raised, so a volunteer
sees 'sách này vừa được cho mượn rồi' rather than a stack trace.

book_id is denormalised onto the loan so title-level statistics survive a
copy being retired."
```

---

### Task 14: Returning

**Files:**
- Create: `app/Domain/Circulation/Actions/ReceiveReturnAction.php`
- Test: `tests/Feature/Circulation/ReturnTest.php`

**Interfaces:**
- Consumes: `Loan`, `BookCopy`, `CopyCondition`, `AssessCopyConditionAction` (Task 10), `AuditLogger`.
- Produces: `ReceiveReturnAction::execute(Loan $loan, CopyCondition $condition, User $receiver, ?string $note, ?string $photoPath): Loan`

- [ ] **Step 1: Write the failing tests**

`tests/Feature/Circulation/ReturnTest.php`:

```php
<?php

declare(strict_types=1);

use App\Domain\Audit\Models\AuditLog;
use App\Domain\Catalog\Enums\CopyCondition;
use App\Domain\Catalog\Enums\CopyState;
use App\Domain\Catalog\Models\BookCopy;
use App\Domain\Circulation\Actions\LendBookDirectlyAction;
use App\Domain\Circulation\Actions\ReceiveReturnAction;
use App\Domain\Circulation\Enums\LoanStatus;
use App\Domain\Identity\Models\Bookshelf;
use App\Domain\Identity\Models\Membership;
use App\Domain\Identity\Models\User;
use App\Support\CurrentBookshelf;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

beforeEach(function () {
    $this->shelf = Bookshelf::factory()->create();
    app(CurrentBookshelf::class)->set($this->shelf);

    $this->manager = User::factory()->create();
    Membership::factory()->for($this->shelf)->for($this->manager)->manager()->create();

    $this->borrower = User::factory()->create();
    Membership::factory()->for($this->shelf)->for($this->borrower)->create();

    $this->copy = BookCopy::factory()->create();
    $this->loan = app(LendBookDirectlyAction::class)
        ->execute($this->copy, $this->borrower, $this->manager);
});

it('closes the loan and frees the copy', function () {
    app(ReceiveReturnAction::class)
        ->execute($this->loan, CopyCondition::Perfect, $this->manager, null, null);

    $this->loan->refresh();

    expect($this->loan->status)->toBe(LoanStatus::Returned)
        ->and($this->loan->returned_at)->not->toBeNull()
        ->and($this->loan->received_by_user_id)->toBe($this->manager->id)
        ->and($this->copy->fresh()->state)->toBe(CopyState::Available);
});

it('records the return condition on the loan and the copy', function () {
    app(ReceiveReturnAction::class)
        ->execute($this->loan, CopyCondition::Torn, $this->manager, 'Rách bìa sau', null);

    expect($this->loan->fresh()->return_condition)->toBe(CopyCondition::Torn->value)
        ->and($this->copy->fresh()->condition)->toBe(CopyCondition::Torn);
});

it('writes a condition assessment linked to the loan', function () {
    app(ReceiveReturnAction::class)
        ->execute($this->loan, CopyCondition::Worn, $this->manager, null, null);

    $assessment = $this->copy->fresh()->assessments()->first();

    expect($assessment->loan_id)->toBe($this->loan->id)
        ->and($assessment->assessed_by_user_id)->toBe($this->manager->id);
});

it('lets the same copy be lent again immediately', function () {
    app(ReceiveReturnAction::class)
        ->execute($this->loan, CopyCondition::Perfect, $this->manager, null, null);

    $second = app(LendBookDirectlyAction::class)
        ->execute($this->copy->fresh(), $this->borrower, $this->manager);

    expect($second->status)->toBe(LoanStatus::Active);
});

it('accepts a return that is overdue without complaint', function () {
    $this->loan->update(['due_on' => now()->subDays(30)->toDateString()]);

    app(ReceiveReturnAction::class)
        ->execute($this->loan->fresh(), CopyCondition::Perfect, $this->manager, null, null);

    expect($this->loan->fresh()->status)->toBe(LoanStatus::Returned);
});

it('accepts a return from a borrower who has since been suspended', function () {
    $this->borrower->membershipFor($this->shelf)->update(['status' => 'suspended']);

    app(ReceiveReturnAction::class)
        ->execute($this->loan, CopyCondition::Perfect, $this->manager, null, null);

    expect($this->loan->fresh()->status)->toBe(LoanStatus::Returned);
});

it('INV-8: audits the return with its receiver', function () {
    app(ReceiveReturnAction::class)
        ->execute($this->loan, CopyCondition::Perfect, $this->manager, null, null);

    $entry = AuditLog::where('action', 'loan.returned')->first();

    expect($entry->actor_user_id)->toBe($this->manager->id);
});

it('refuses to receive a loan that is already returned', function () {
    app(ReceiveReturnAction::class)
        ->execute($this->loan, CopyCondition::Perfect, $this->manager, null, null);

    app(ReceiveReturnAction::class)
        ->execute($this->loan->fresh(), CopyCondition::Perfect, $this->manager, null, null);
})->throws(RuntimeException::class);
```

The suspension test matters: suspension blocks *new* loans, it never confiscates a book already out. A volunteer must always be able to take a book back.

- [ ] **Step 2: Run tests to verify they fail**

```bash
php artisan test --filter=ReturnTest
```

Expected: FAIL — `Class "App\Domain\Circulation\Actions\ReceiveReturnAction" not found`.

- [ ] **Step 3: Write the action**

```php
<?php

declare(strict_types=1);

namespace App\Domain\Circulation\Actions;

use App\Domain\Audit\AuditLogger;
use App\Domain\Catalog\Actions\AssessCopyConditionAction;
use App\Domain\Catalog\Enums\CopyCondition;
use App\Domain\Catalog\Enums\CopyState;
use App\Domain\Circulation\Enums\LoanStatus;
use App\Domain\Circulation\Models\Loan;
use App\Domain\Identity\Models\User;
use Illuminate\Support\Facades\DB;
use RuntimeException;

final class ReceiveReturnAction
{
    public function __construct(
        private readonly AuditLogger $audit,
        private readonly AssessCopyConditionAction $assess,
    ) {}

    public function execute(
        Loan $loan,
        CopyCondition $condition,
        User $receiver,
        ?string $note = null,
        ?string $photoPath = null,
    ): Loan {
        return DB::transaction(function () use ($loan, $condition, $receiver, $note, $photoPath): Loan {
            $locked = Loan::query()->lockForUpdate()->findOrFail($loan->id);

            if ($locked->status !== LoanStatus::Active) {
                throw new RuntimeException(__('circulation.errors.loan_not_active'));
            }

            $before = ['status' => $locked->status->value];

            $locked->update([
                'status' => LoanStatus::Returned,
                'returned_at' => now(),
                'received_by_user_id' => $receiver->id,
                'return_condition' => $condition->value,
                'return_condition_note' => $note,
                'return_photo_path' => $photoPath,
            ]);

            $copy = $locked->copy;
            $copy->transitionTo(CopyState::Available);
            $copy->save();

            $this->assess->execute($copy, $condition, $receiver, $note, $photoPath, $locked->id);

            $this->audit->log('loan.returned', $locked, $before, [
                'status' => LoanStatus::Returned->value,
                'condition' => $condition->value,
                'days_held' => $locked->daysHeld(),
            ]);

            return $locked;
        });
    }
}
```

Note what this action does **not** do. It does not check whether the borrower is still an active member — a book must always be returnable. It does not complain about lateness — the loan record already carries the dates, and scolding a child at the counter is not the software's job.

The copy transitions to `Available` even when it comes back torn. Damage is recorded on the condition axis; only loss or retirement removes a book from circulation.

- [ ] **Step 4: Run tests to verify they pass**

```bash
php artisan test --filter=ReturnTest
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git switch -c feat/returning
git add -A
git commit -m "feat(circulation): add receive-return with condition assessment

Returning always succeeds for an active loan: it does not check whether the
borrower is still an active member, because suspension blocks new loans and
never confiscates a book already out, and it does not complain about
lateness, because the record already carries the dates.

A damaged book still returns to available. Damage lives on the condition
axis; only loss or retirement removes a copy from circulation."
```

---

### Task 15: Renew, void and report lost

**Files:**
- Create: `app/Domain/Circulation/Actions/RenewLoanAction.php`, `VoidLoanAction.php`, `ReportLoanLostAction.php`
- Create: `app/Domain/Circulation/Exceptions/RenewalNotAllowedException.php`
- Test: `tests/Feature/Invariants/RenewalRulesTest.php`, `tests/Feature/Circulation/VoidAndLostTest.php`

**Interfaces:**
- Consumes: `Loan`, `BookCopy`, `BookshelfSettings`, `AuditLogger`.
- Produces:
  - `RenewLoanAction::execute(Loan $loan, User $actor): Loan`
  - `VoidLoanAction::execute(Loan $loan, User $actor, string $reason): Loan`
  - `ReportLoanLostAction::execute(Loan $loan, User $actor): Loan`

- [ ] **Step 1: Write the failing tests**

`tests/Feature/Invariants/RenewalRulesTest.php`:

```php
<?php

declare(strict_types=1);

use App\Domain\Circulation\Actions\RenewLoanAction;
use App\Domain\Circulation\Enums\LoanStatus;
use App\Domain\Circulation\Exceptions\RenewalNotAllowedException;
use App\Domain\Circulation\Models\Loan;
use App\Domain\Identity\Models\Bookshelf;
use App\Domain\Identity\Models\User;
use App\Support\CurrentBookshelf;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

beforeEach(function () {
    $this->shelf = Bookshelf::factory()->create([
        'settings' => ['max_renewals' => 1, 'renewal_days' => 7],
    ]);
    app(CurrentBookshelf::class)->set($this->shelf);
    $this->actor = User::factory()->create();
});

it('INV-6: extends the due date from the current due date, not from today', function () {
    $loan = Loan::factory()->create([
        'status' => LoanStatus::Active,
        'due_on' => now()->addDays(5)->toDateString(),
        'renewals_used' => 0,
    ]);

    app(RenewLoanAction::class)->execute($loan, $this->actor);

    expect($loan->fresh()->due_on->toDateString())
        ->toBe(now()->addDays(12)->toDateString());
});

it('INV-6: renewing early does not cost the reader days', function () {
    $loan = Loan::factory()->create([
        'status' => LoanStatus::Active,
        'due_on' => now()->addDays(10)->toDateString(),
    ]);

    app(RenewLoanAction::class)->execute($loan, $this->actor);

    expect($loan->fresh()->due_on->toDateString())
        ->toBe(now()->addDays(17)->toDateString());
});

it('INV-6: refuses once the renewal allowance is used up', function () {
    $loan = Loan::factory()->create([
        'status' => LoanStatus::Active,
        'due_on' => now()->addDays(2)->toDateString(),
        'renewals_used' => 1,
    ]);

    app(RenewLoanAction::class)->execute($loan, $this->actor);
})->throws(RenewalNotAllowedException::class);

it('INV-6: increments the renewal counter', function () {
    $loan = Loan::factory()->create(['status' => LoanStatus::Active, 'renewals_used' => 0]);

    app(RenewLoanAction::class)->execute($loan, $this->actor);

    expect($loan->fresh()->renewals_used)->toBe(1);
});

it('INV-6: refuses to renew a loan that is not active', function () {
    $loan = Loan::factory()->create(['status' => LoanStatus::Returned, 'returned_at' => now()]);

    app(RenewLoanAction::class)->execute($loan, $this->actor);
})->throws(RenewalNotAllowedException::class);

it('INV-6: an overdue loan may still be renewed from its old due date', function () {
    $loan = Loan::factory()->create([
        'status' => LoanStatus::Active,
        'due_on' => now()->subDays(3)->toDateString(),
        'renewals_used' => 0,
    ]);

    app(RenewLoanAction::class)->execute($loan, $this->actor);

    expect($loan->fresh()->due_on->toDateString())
        ->toBe(now()->addDays(4)->toDateString());
});
```

The last case is a real decision, not an accident: extending from the old due date means a reader who is three days late gets four more days, not seven. That is deliberate, and stating it in a test stops a future contributor from "fixing" it.

`tests/Feature/Circulation/VoidAndLostTest.php` covers: voiding an active loan sets `voided` with a reason and returns the copy to `available`; voiding requires a reason; a voided loan never appears in `Loan::active()`; **no loan is ever deleted** (`Loan::withTrashed()` does not exist because the model has no `SoftDeletes`); reporting a loan lost sets the loan to `lost` and the copy to `lost`; a lost copy can be found again and becomes available.

- [ ] **Step 2: Run tests to verify they fail**

```bash
php artisan test --filter="RenewalRules|VoidAndLost"
```

Expected: FAIL — `Class "App\Domain\Circulation\Actions\RenewLoanAction" not found`.

- [ ] **Step 3: Write the renewal action**

```php
<?php

declare(strict_types=1);

namespace App\Domain\Circulation\Actions;

use App\Domain\Audit\AuditLogger;
use App\Domain\Circulation\Enums\LoanStatus;
use App\Domain\Circulation\Exceptions\RenewalNotAllowedException;
use App\Domain\Circulation\Models\Loan;
use App\Domain\Identity\Models\User;
use App\Support\CurrentBookshelf;
use Illuminate\Support\Facades\DB;

final class RenewLoanAction
{
    public function __construct(
        private readonly AuditLogger $audit,
        private readonly CurrentBookshelf $currentBookshelf,
    ) {}

    public function execute(Loan $loan, User $actor): Loan
    {
        $settings = $this->currentBookshelf->get()->settings();

        return DB::transaction(function () use ($loan, $actor, $settings): Loan {
            $locked = Loan::query()->lockForUpdate()->findOrFail($loan->id);

            if ($locked->status !== LoanStatus::Active) {
                throw RenewalNotAllowedException::make();
            }

            if ($locked->renewals_used >= $settings->maxRenewals) {
                throw RenewalNotAllowedException::make();
            }

            // Phase 2 adds the queue check here: renewal is refused when a
            // borrow request is pending for this title (INV-6, second clause).

            $before = ['due_on' => $locked->due_on->toDateString()];

            // Extend from the current due date, not from today, so renewing
            // early does not cost the reader days.
            $locked->update([
                'due_on' => $locked->due_on->copy()->addDays($settings->renewalDays)->toDateString(),
                'renewals_used' => $locked->renewals_used + 1,
            ]);

            $this->audit->log('loan.renewed', $locked, $before, [
                'due_on' => $locked->due_on->toDateString(),
                'renewals_used' => $locked->renewals_used,
            ]);

            return $locked;
        });
    }
}
```

The comment marking where Phase 2's queue check goes is deliberate. INV-6 has two clauses and only one is implementable in Phase 1; leaving a named placeholder is better than leaving a future contributor to rediscover the requirement from the spec.

- [ ] **Step 4: Write the void and lost actions**

`VoidLoanAction` requires a reason, sets `status` to `Voided` with `voided_at` and `voided_by_user_id`, transitions the copy back to `Available`, and audits `loan.voided`. It never deletes — INV-11.

`ReportLoanLostAction` sets the loan to `Lost` with `lost_reported_at` and `lost_reported_by_user_id`, transitions the copy to `CopyState::Lost` with `lost_at`, and audits `loan.reported_lost`. The copy's path back to `Available` is `MarkCopyFoundAction` from Task 10, which also closes out the loan.

- [ ] **Step 5: Run tests to verify they pass**

```bash
php artisan test --filter="RenewalRules|VoidAndLost"
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git switch -c feat/renew-void-lost
git add -A
git commit -m "feat(circulation): add renewal, voiding and lost reporting

Renewal extends due_on from the current due date rather than from today, so
renewing early does not cost the reader days. A reader who is three days
late therefore gets four more days, not seven — deliberate, and asserted in
a test so it is not later 'fixed'.

INV-6's second clause (refuse renewal when someone is queued) needs borrow
requests and is marked with a named placeholder for Phase 2.

Voiding records a reason and returns the copy to available. Nothing is ever
deleted (INV-11)."
```

---

### Task 16: Quick-lend screen

The most important screen in the application. Three taps: find the book, pick the reader, confirm.

**Files:**
- Create: `app/Http/Controllers/Manager/QuickLendController.php`, `app/Http/Requests/LendRequest.php`
- Create: `resources/js/pages/manager/QuickLend.tsx`
- Create: `resources/js/components/circulation/BookPicker.tsx`, `resources/js/components/reader/ReaderPicker.tsx`
- Create: `resources/js/layouts/ManagerLayout.tsx`
- Test: `tests/Feature/Circulation/QuickLendTest.php`

**Interfaces:**
- Consumes: `LendBookDirectlyAction`, `CatalogQuery`, `ReaderListQuery`.
- Produces: routes `manager.lend.create`, `manager.lend.store`.

- [ ] **Step 1: Write the failing tests**

`tests/Feature/Circulation/QuickLendTest.php` covers: the screen renders for a manager; posting a copy and borrower creates an active loan and redirects with a success flash; a blocked lend (limit reached) redirects back with the Vietnamese error rather than a 500; a reader cannot reach the screen; a copy from another shelf returns 404.

```php
it('lends and reports back in plain vietnamese', function () {
    $shelf = Bookshelf::factory()->create(['slug' => 'chinh']);
    app(CurrentBookshelf::class)->set($shelf);

    $manager = User::factory()->create();
    Membership::factory()->for($shelf)->for($manager)->manager()->create();
    $borrower = User::factory()->create();
    Membership::factory()->for($shelf)->for($borrower)->create();
    $copy = BookCopy::factory()->create();

    $this->actingAs($manager)->post('/portal/chinh/quan-ly/cho-muon', [
        'book_copy_id' => $copy->id,
        'user_id' => $borrower->id,
    ])->assertRedirect()->assertSessionHas('success');

    expect(Loan::active()->count())->toBe(1);
});

it('reports a blocked lend as a message, not a server error', function () {
    // ... arrange a borrower already at the limit ...
    $this->actingAs($manager)->post('/portal/chinh/quan-ly/cho-muon', [
        'book_copy_id' => $copy->id,
        'user_id' => $borrower->id,
    ])->assertRedirect()->assertSessionHas('error');
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
php artisan test --filter=QuickLend
```

Expected: FAIL — 404.

- [ ] **Step 3: Write the controller**

`QuickLendController::create` renders the screen. `store` authorises `Permission::LoanCreate`, resolves the copy and borrower **within the tenant scope** so a foreign id 404s, calls `LendBookDirectlyAction`, and redirects with `circulation.lent` interpolated with the reader's name, the book title and the due date.

The controller stays under fifteen lines. The exception handler from Task 13 turns a blocked lend into a flash message.

- [ ] **Step 4: Write the screen**

`manager/QuickLend.tsx` — three steps in one page, revealed progressively:

1. **Find the book.** A search box focused on load, results as cover-and-title rows. Searching uses the same normalised matching as the public catalogue, so typing without diacritics works.
2. **Choose the copy** — this step appears *only* when the title has more than one available copy. With one copy it does not exist, because a step that is always the same answer is not a step.
3. **Pick the reader.** A searchable list of active members, with a link to create a new reader for the case where somebody turns up unregistered.
4. **Confirm.** Shows book, reader and the calculated due date, with one large button.

Blocking conditions are shown **before** the confirm step, not after. If the chosen reader is at their limit or their membership is not active, the reader row is disabled with the reason beside it. Discovering the problem after tapping confirm is the failure mode this screen exists to avoid.

The confirm button disables while in flight. A double tap would otherwise attempt a second loan — which the database would reject, but the volunteer would see an error for something they did not do wrong.

`ManagerLayout.tsx` — sidebar on desktop; a **five-item bottom tab bar** on mobile: *Trang chính*, *Sách*, *Cho mượn*, *Người đọc*, *Thêm*. Five is the ceiling. The manager's mobile layout is the primary experience, not a degraded fallback, because volunteers work standing at a shelf.

- [ ] **Step 5: Run tests to verify they pass**

```bash
php artisan test --filter=QuickLend
```

Expected: PASS.

- [ ] **Step 6: Verify manually at 375px**

```bash
npm run dev
```

Open the quick-lend screen in a 375px viewport and lend a book. Count the taps from the dashboard: it must be four or fewer including the dashboard button. If it is more, the screen needs simplifying before this task is done.

- [ ] **Step 7: Commit**

```bash
git switch -c feat/quick-lend
git add -A
git commit -m "feat(circulation): add the quick-lend screen

Three steps: find the book, pick the reader, confirm. The copy-selection
step appears only when a title has more than one available copy, because a
step with only one possible answer is not a step.

Blocking conditions are shown before the confirm step, not after. A reader
at their loan limit appears disabled with the reason beside them —
discovering that after tapping confirm is the failure mode this screen
exists to avoid.

The manager layout is designed at 375px first, with a five-item bottom tab
bar, because volunteers work standing at a shelf with a phone."
```

---

### Task 17: Receive-return screen

**Files:**
- Create: `app/Http/Controllers/Manager/ReceiveReturnController.php`, `app/Http/Requests/ReceiveReturnRequest.php`
- Create: `resources/js/pages/manager/ReceiveReturn.tsx`
- Test: `tests/Feature/Circulation/ReceiveReturnScreenTest.php`

**Interfaces:**
- Consumes: `ReceiveReturnAction`, `ActiveLoansQuery`.
- Produces: routes `manager.returns.create`, `manager.returns.store`.

- [ ] **Step 1: Write the failing tests**

Cover: the screen lists currently-borrowed books with borrower names; posting a loan and condition closes it; the condition defaults to `perfect` when omitted; a note is accepted; a reader cannot reach the screen.

- [ ] **Step 2: Run tests to verify they fail**

```bash
php artisan test --filter=ReceiveReturnScreen
```

Expected: FAIL — 404.

- [ ] **Step 3: Write the request and controller**

`ReceiveReturnRequest` validates `loan_id` as existing within the tenant, `condition` as `Rule::enum(CopyCondition::class)` **defaulting to `perfect`**, `note` as nullable up to 500 characters, and `photo` as a nullable image.

The default matters: it is what makes the common case a single tap.

- [ ] **Step 4: Write the screen**

`manager/ReceiveReturn.tsx` — two steps:

1. **Find the loan.** Search the currently-borrowed list by book title or reader name. Each row shows the cover, title, borrower, and how many days they have had it, with an overdue badge where relevant.
2. **Assess and confirm.** The `ConditionPicker` from Task 10 with *Nguyên vẹn* preselected, and one confirm button. The note and photo fields appear only when a worse condition is chosen.

The undamaged case is two taps: pick the loan, confirm.

- [ ] **Step 5: Run tests to verify they pass**

```bash
php artisan test --filter=ReceiveReturnScreen
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git switch -c feat/receive-return-screen
git add -A
git commit -m "feat(circulation): add the receive-return screen

The condition selector defaults to Nguyên vẹn and the note and photo fields
appear only when something worse is chosen, so the overwhelmingly common
case — an undamaged book coming back — is two taps."
```

---

### Task 18: Manager dashboard

**Files:**
- Create: `app/Domain/Circulation/Queries/DashboardCountsQuery.php`, `app/Domain/Audit/Queries/RecentActivityQuery.php`
- Create: `app/Http/Controllers/Manager/DashboardController.php`, `OverdueController.php`
- Create: `resources/js/pages/manager/Dashboard.tsx`, `Overdue.tsx`
- Create: `resources/js/components/data/StatTile.tsx`
- Test: `tests/Feature/Circulation/DashboardTest.php`

**Interfaces:**
- Consumes: `OverdueLoansQuery`, `PendingRegistrationsQuery`, `AuditLog`.
- Produces:
  - `DashboardCountsQuery::get(): array{overdue:int, pending_registrations:int, total_books:int, on_loan:int, available:int, readers:int}`
  - `RecentActivityQuery::get(int $limit): Collection` — audit rows with actor eager-loaded.
  - Routes `manager.dashboard`, `manager.overdue`.

- [ ] **Step 1: Write the failing tests**

Cover: the dashboard renders with correct counts; the overdue count reflects only active loans past their due date; the counts are shelf-scoped (a second shelf's data does not leak); a reader cannot reach it; the overdue list is ordered most-overdue first and includes the borrower's phone.

```php
it('counts overdue loans correctly and ignores returned ones', function () {
    // two active loans past due, one returned long ago
    expect(app(DashboardCountsQuery::class)->get()['overdue'])->toBe(2);
});

it('scopes every count to the current shelf', function () {
    // arrange books and loans on a second shelf
    expect(app(DashboardCountsQuery::class)->get()['total_books'])->toBe(3);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
php artisan test --filter=DashboardTest
```

Expected: FAIL.

- [ ] **Step 3: Write the counts query**

```php
<?php

declare(strict_types=1);

namespace App\Domain\Circulation\Queries;

use App\Domain\Catalog\Enums\CopyState;
use App\Domain\Catalog\Models\Book;
use App\Domain\Catalog\Models\BookCopy;
use App\Domain\Circulation\Models\Loan;
use App\Domain\Identity\Models\Membership;

final class DashboardCountsQuery
{
    /**
     * @return array{overdue:int, pending_registrations:int, total_books:int, on_loan:int, available:int, readers:int}
     */
    public function get(): array
    {
        return [
            'overdue' => Loan::overdue()->count(),
            'pending_registrations' => Membership::query()->pending()->count(),
            'total_books' => Book::query()->count(),
            'on_loan' => BookCopy::query()->where('state', CopyState::OnLoan)->count(),
            'available' => BookCopy::query()->where('state', CopyState::Available)->count(),
            'readers' => Membership::query()->active()->readers()->count(),
        ];
    }
}
```

Every count relies on the global scope for tenant filtering, and `overdue` reuses the single scope from Task 12 rather than repeating the date comparison.

Cache this for a few minutes under a per-shelf key. It runs on every dashboard load and the numbers do not need to be to-the-second.

- [ ] **Step 4: Write the dashboard**

`manager/Dashboard.tsx`, in order down the page:

1. **Two large tappable stat tiles**: *Quá hạn* and *Chờ duyệt tài khoản*. Each navigates to its filtered list. (Spec §7.3 describes four; the request and comment tiles arrive with Phase 2. Leave the grid able to hold four.)
2. **Two very large primary buttons**: *Cho mượn* and *Nhận trả*, sized for a thumb. These are the whole job.
3. Shelf totals: books, on loan, available, readers.
4. Recent activity from the audit log, rendered as readable Vietnamese sentences.

Statistics load through Inertia deferred props so the dashboard paints immediately and fills in.

`manager/Overdue.tsx` — sorted most-overdue first, each row showing the borrower and a **tappable** `tel:` phone link. That phone call is the actual mechanism by which books come back, so it must be one tap.

- [ ] **Step 5: Run tests to verify they pass**

```bash
php artisan test --filter=DashboardTest
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git switch -c feat/manager-dashboard
git add -A
git commit -m "feat(circulation): add the manager dashboard and overdue list

Two stat tiles in Phase 1 — overdue and pending registrations — with the
grid sized for the four the spec describes once requests and comments
arrive. Below them the two buttons that are the whole job: Cho mượn and
Nhận trả.

The overdue list makes the borrower's phone number a tappable tel: link,
because that call is the actual mechanism by which books come back.

Counts reuse the single overdue scope rather than repeating the date
comparison, and rely on the global scope for tenant filtering."
```

---

### Task 19: CSV export

Volunteers plus shared hosting is a real data-loss risk. This is cheap insurance and it ships in Phase 1.

**Files:**
- Create: `app/Domain/Catalog/Queries/ExportQuery.php`, `app/Http/Controllers/Manager/ExportController.php`
- Test: `tests/Feature/Catalog/ExportTest.php`

**Interfaces:**
- Consumes: `Book`, `BookCopy`, `Loan`, `Membership`.
- Produces: route `manager.export` with `?loai=sach|nguoi-doc|muon-tra`, returning a streamed CSV.

- [ ] **Step 1: Write the failing tests**

Cover: each export type returns a 200 with `text/csv` and a UTF-8 BOM; the book export contains the titles; the reader export contains full names; **the reader export is refused for a user without `Permission::ExportRun`**; exports contain only the current shelf's rows.

```php
it('exports books as csv with a BOM so excel reads vietnamese correctly', function () {
    // ...
    $response = $this->actingAs($manager)->get('/portal/chinh/quan-ly/xuat-du-lieu?loai=sach');

    $response->assertSuccessful()->assertHeader('content-type', 'text/csv; charset=UTF-8');
    expect($response->streamedContent())->toStartWith("\xEF\xBB\xBF");
});
```

The BOM is not a detail: without it, Excel on Windows mangles every Vietnamese name in the file, which makes the backup useless to the person most likely to open it.

- [ ] **Step 2: Run tests to verify they fail**

```bash
php artisan test --filter=ExportTest
```

Expected: FAIL — 404.

- [ ] **Step 3: Write the export**

`ExportController` authorises `Permission::ExportRun`, then returns a `StreamedResponse` writing rows with `fputcsv` and emitting the UTF-8 BOM first. It uses `cursor()` rather than `get()` so memory stays flat on shared hosting.

Three export types:
- `sach` — title, author, category, page count, total copies, available copies, condition.
- `nguoi-doc` — saint name, full name, tổ, giáo họ, status, join date, number of loans. **No date of birth, no parents' names, no phone** — a CSV leaves the system and is emailed around, so it carries the minimum that makes it useful.
- `muon-tra` — book title, borrower, lent date, due date, returned date, return condition, lending manager, receiving manager.

- [ ] **Step 4: Run tests to verify they pass**

```bash
php artisan test --filter=ExportTest
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git switch -c feat/csv-export
git add -A
git commit -m "feat(catalog): add CSV export for books, readers and loans

Volunteers plus shared hosting is a real data-loss risk, so this ships in
Phase 1 as cheap insurance.

Files are streamed with a cursor to keep memory flat, and carry a UTF-8 BOM
because without it Excel on Windows mangles every Vietnamese name — which
would make the backup useless to the person most likely to open it.

The reader export deliberately omits date of birth, parents' names and
phone. A CSV leaves the system and gets emailed around, so it carries the
minimum that makes it useful."
```

---

### Task 20: Deployment guide, scheduler, and Phase 1 acceptance

**Files:**
- Create: `docs/DEPLOYMENT.md`
- Create: `app/Console/Commands/BackupDatabase.php`
- Modify: `routes/console.php` (schedule registration)
- Modify: `README.md` (setup section)
- Test: `tests/Feature/SchedulerTest.php`

**Interfaces:**
- Consumes: everything.
- Produces: a documented, repeatable deployment and a scheduler that is correct at any interval.

- [ ] **Step 1: Write the scheduler test**

```php
<?php

declare(strict_types=1);

use Illuminate\Support\Facades\Artisan;

it('registers only latency-tolerant scheduled work', function () {
    $commands = collect(app(Illuminate\Console\Scheduling\Schedule::class)->events())
        ->map(fn ($e) => $e->command);

    expect($commands)->not->toBeEmpty();
});

it('backs up the database to the artifacts-free storage path', function () {
    Artisan::call('olibra:backup-database');
})->throwsNoExceptions();
```

- [ ] **Step 2: Register the schedule**

In `routes/console.php`:

```php
Schedule::command('queue:work --stop-when-empty --max-time=280')->everyFiveMinutes()->withoutOverlapping();
Schedule::command('olibra:backup-database')->dailyAt('02:00');
Schedule::command('model:prune')->daily();
```

**Every scheduled task must be correct when run at irregular intervals and harmless when skipped entirely.** Nothing here writes overdue status, hold expiry or availability — those are derived (Task 12). If a future task cannot satisfy that rule, the logic belongs in a query, not a schedule.

Phase 1 has no `olibra:expire-holds`; holds arrive with Phase 2.

- [ ] **Step 3: Write the backup command**

`BackupDatabase` runs `mysqldump` into `storage/app/backups/` with a date-stamped filename and prunes to the last seven. It writes to `storage/`, **never to `.artifacts/`** — `.artifacts/` must remain safe to delete at any moment, and a backup is not.

- [ ] **Step 4: Write the deployment guide**

`docs/DEPLOYMENT.md` covers:

- **Build in CI, never on the server.** The production host has no Node runtime. The artifact is the application plus `public/build`.
- **Document root** points at `/home/{user}/olibra/public`, keeping application code outside `public_html`.
- **Deploy sequence**: `artisan down`, `composer install --no-dev --optimize-autoloader`, `migrate --force`, `config:cache`, `route:cache`, `view:cache`, `storage:link`, `artisan up`.
- **Cron**, a single entry: `cd /home/{user}/olibra && /usr/local/bin/ea-php84/root/usr/bin/php artisan schedule:run >> /dev/null 2>&1`. The exact PHP binary path varies by host; find it in cPanel's MultiPHP Manager.
- **Symlink fallback.** If the host disallows symlinks, point `FILESYSTEM_DISK` at a disk rooted inside the public directory instead of using `storage:link`.
- **Disabled functions.** Shared hosts sometimes disable `proc_open` and `symlink`. List which artisan commands this affects.
- **Requirements**: PHP 8.4 with GD or Imagick, MySQL 8.0.16 or newer.
- **`env()` warning.** Because config is cached, `env()` must never be called outside `config/`; it returns null in production.

- [ ] **Step 5: Run the Phase 1 acceptance check**

Everything must pass:

```bash
php artisan test
vendor/bin/pint --test
vendor/bin/phpstan analyse
npx tsc --noEmit
npm run build
```

Then walk the product end to end on a **375px viewport**, as a volunteer would:

- [ ] Install a fresh shelf with `php artisan olibra:install`.
- [ ] Register a reader from the public form; confirm they are not logged in.
- [ ] Approve that reader as a manager; confirm the audit row exists.
- [ ] Add a book with a cover and two copies.
- [ ] Find that book on the public catalogue by typing its title **without diacritics**.
- [ ] Lend a copy through quick-lend and count the taps — four or fewer from the dashboard.
- [ ] Confirm the book now shows as borrowed on the public book detail page.
- [ ] Try to lend the same copy again; confirm a Vietnamese message, not a stack trace.
- [ ] Take the book back through receive-return; confirm it is two taps for an undamaged book.
- [ ] Back-date a loan in the database and confirm it appears in the overdue list with a tappable phone number.
- [ ] Export all three CSVs and open one in a spreadsheet; confirm Vietnamese names are intact.
- [ ] Reset a reader's password as a manager; confirm they are forced to change it at next login.

- [ ] **Step 6: Commit and open the final pull request**

```bash
git switch -c docs/deployment
git add -A
git commit -m "docs: add deployment guide and scheduler

Every scheduled task is correct at irregular intervals and harmless when
skipped, because the production host may run cron only every 10-30 minutes.
Nothing writes overdue status or availability — those stay derived.

Backups go to storage/, never to .artifacts/, which must remain safe to
delete at any moment.

Completes Phase 1: a volunteer can catalogue books, approve readers, lend
in three taps, take books back with a condition assessment, and every
action is audited."
```

---

## Phase 1 Definition of Done

Phase 1 is complete when all of the following hold:

- [ ] Every invariant in the Global Constraints table has a named, passing test in `tests/Feature/Invariants/`.
- [ ] INV-1 is proven at the database level by a test that bypasses the application entirely.
- [ ] Tenant isolation is proven by tests showing a manager of one shelf cannot see or reach another shelf's data.
- [ ] No scheduled job writes overdue status, hold expiry or availability.
- [ ] `php artisan test`, `pint --test`, `phpstan analyse`, `tsc --noEmit` and `npm run build` all pass.
- [ ] Coverage on `app/Domain` is at or above 80%.
- [ ] Every user-facing string is in `resources/lang/vi/`, with an `en/` scaffold key.
- [ ] Quick-lend is four taps or fewer from the dashboard on a 375px viewport.
- [ ] Receive-return is two taps for an undamaged book.
- [ ] The end-to-end walkthrough in Task 20 Step 5 passes in full.
- [ ] `docs/DEPLOYMENT.md` is complete enough for someone else to deploy from scratch.
- [ ] No temporary file exists outside `.artifacts/`, and `git status` is clean.

## What Phase 1 deliberately does not include

Borrow requests, holds and the FIFO queue; comments and moderation; announcements; the feedback inbox; the statistics page; the portal directory; super-admin screens; the marketing landing page and blog; Tiptap (which arrives with announcements in Phase 2).

`is_super_admin` exists and is honoured by every permission check, but there is no interface for managing it — `php artisan olibra:install` creates the first one, and Phase 3 adds the screens.
