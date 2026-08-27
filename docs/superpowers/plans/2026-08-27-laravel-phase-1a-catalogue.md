# Laravel Migration — Phase 1a: Catalogue — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Draft

**Goal:** The catalogue slice of BR §1.4's core loop, running end to end: categories readable, books and copies created, edited, soft-deleted, assessed, retired, reported lost and marked found by a manager — every write audited in its own transaction (INV-8) — plus the reader's browse, folded search and book detail, and the manager's book list, create, detail, edit and lost-copies screens, all filling routes Phase 0 left as `under-construction`.

**What this plan is not.** Phase 1 (BR §1.4's core loop) is too large for one plan and is split into four, each producing working software:

- **1a Catalogue** — this plan. Categories, books, copies. Manager CRUD plus the reader's browse, search and book detail.
- **1b Members** — readers, registration approval. Independent of 1a.
- **1c Circulation** — quick-lend, return with condition, renewals, overdue, void, lost-copy entry from returns. Needs 1a and 1b.
- **1d Oversight** — audit-log surfacing, manager dashboard, CSV export.

Catalogue operations that belong to a later phase and are **deliberately absent here**: `MarkCopiesPrinted`, `ListTitlesForLabels`, `ListCopiesForLabels`, `ExportLabelSheetPDF`, `ResolveCopyById` (QR labels — Phase 2), `SearchBooksForLending` (1c), `ExportBooksCSV` (1d), `GetShelfHome` (Phase 2 — its centerpiece card is the pinned-or-latest announcement, a Phase 2 entity; its catalogue-count link and *Mới thêm* row become computable with this phase's queries, but the page is deferred whole so it is built once against its full OPS §3.2 shape rather than rebuilt when announcements land), and the super-admin category CRUD behind `/admin/categories` (`CreateCategory`/`RenameCategory`/`ArchiveCategory` — Phase 3's admin tooling; the six default categories are already seeded by Phase 0's `CategorySeeder`, so cataloguing never blocks on it).

**Architecture:** Per the spec's §1.3 carve-out: Eloquent models (Phase 0), single-purpose Action classes in `app/Actions/Catalogue/`, Form Requests in `app/Http/Requests/Catalogue/`, Policies in `app/Policies/`, thin controllers, Inertia pages. Pure functions with no I/O in `app/Support/Catalogue/`; read shapes in `app/Queries/`. Every command writes its audit rows in the same `DB::transaction` as its state change (OPS §1).

**Tech Stack:** unchanged from Phase 0 — PHP 8.4, Laravel 13, Inertia v3, React 19, Tailwind v4, MariaDB 10.11, Pest 5, Larastan level 8, Pint, Biome 2, Bun.

**Spec:** docs/superpowers/specs/2026-08-26-laravel-mariadb-inertia-migration-design.md

**The reference implementation is the specification.** `old_next/src/domain/catalogue/` (commands, queries, `policy.ts`, `copy-codes.ts`) and `old_next/tests/domain/catalogue/` encode rules that took eleven fix-waves to get right. Every Action task below starts by reading the TypeScript test it ports. Where this plan diverges from the reference, the divergence is named inline with its reason — the same practice the Phase 0 plan followed. The divergences, collected:

1. **`pg_advisory_xact_lock` → `SELECT … FOR UPDATE` on the shelf's own `bookshelves` row, taken as the transaction's FIRST statement.** MariaDB's `GET_LOCK()` is connection-scoped, not transaction-scoped — a thrown exception between acquire and release would leak the lock for the life of the pooled connection. An InnoDB row lock on the shelf row serialises `CreateBook`/`AddCopies` per shelf exactly as the advisory lock did, releases on commit or rollback with nothing to remember, and two parishes never queue behind each other because they lock different rows. The first-statement requirement is this port's own, and it is stricter than the reference's ordering: InnoDB's REPEATABLE READ pins the transaction's read view at its first consistent read, so any read ahead of the lock still sees a stale snapshot after the lock is granted — reproduced live on 10.11 during review (duplicate code, silently-committed ISBN duplicate, missed slug); Postgres's per-statement READ COMMITTED is why the reference could afford reads before its lock. `book_copies_code_unique` (errno 1062) remains the structural backstop for codes and slugs either way.
2. **The reference's live two-connection race probes do not port.** `create-book.test.ts`'s "two concurrent CreateBook calls…" tests open a second database connection against committed fixture data; under Pest's `RefreshDatabase` every fixture lives inside an uncommitted transaction invisible to a second connection. The serialisation mechanism is therefore covered by (a) the behavioural tests that do port (sequential codes, gap preservation, LIKE-escape), (b) `DbGuaranteesTest`'s existing errno-1062 pin on `book_copies_code_unique`, and (c) a test that the allocator's generated SQL actually requests the row lock. Recorded in `docs/known-gaps.md` by Task 14 rather than papered over with a probe that proves nothing.
3. **`copies_borrowable` (a Postgres view) becomes a shared Eloquent predicate** — spec §4's own row: views "encode read shapes, not invariants". One closure, `App\Queries\Concerns\CountsCopies::borrowable()`, used by every query that answers "can this be borrowed", so BR §8's rule keeps a single home the way `deriveAvailability` already gives the badge ladder one.
4. **`duplicate_isbn`'s Vietnamese sentence and every other refusal sentence move to `lang/vi/rules.php`** (server copy — spec §7's convention), not a TS `ERROR_MESSAGES` map.
5. **Query-string parameters are English** (`?scope=all&category=…&sort=title&page=2&q=…`) where the reference used Vietnamese (`?loc=tat-ca&the-loai=…`). Spec §6: no Vietnamese in URIs — and a query string is part of the URI. Nothing bookmarkable exists yet on this branch to break.
6. **No cover uploader on the create/edit forms, matching the reference exactly** — `old_next`'s `sach/moi/page.tsx` ships none ("a cover url nobody can currently upload", its own docstring); `cover_url` stays a nullable column the queries carry. Cover upload is a later, separate slice (the avatar-upload plan is the model).
7. **The donor *member picker* control is deferred to 1b; the free-text donor ships now.** `CreateBook`/`AddCopies` accept `donor_membership_id` from day one (the Actions, requests and tests all cover it — BR §1.4 lands provenance in phase 1 "so provenance is recorded from the first row of data"), but the search-a-member `<select>` needs `GetReadersList`, which is 1b's. The form ships **Người tặng** as free text plus **Ngày nhận**; 1b adds the picker beside it.

## Global Constraints

Phase 0's Global Constraints all still bind — branch, MariaDB 10.11 via the `mariadb` driver, PHP 8.4, UUIDv7 `VARCHAR(36) ascii_bin`, `DATETIME(6)` UTC, enums as `VARCHAR(20) ascii_bin` + CHECK, English URIs, Bun/Composer, Pint + Larastan level 8 clean at every commit, commit per task in lowercase `type: sentence` style. Additionally, for this plan:

- **`old_next/` is read-only.** Nothing under it is edited, moved or deleted.
- **No hand-written `where('bookshelf_id', …)`** outside `app/Models/Scopes/BookshelfScope.php` — `TenancyArchitectureTest` greps for it. Queries reach shelf-scoped rows through scoped models (the tenant is bound by the `tenant` middleware in requests, by `TenantHarness::actAs()` in tests) or through `Bookshelf`'s own relations.
- **Never call `withoutGlobalScopes()` with no argument** (known-gaps: it strips `SoftDeletingScope` too). The one named skip is `withoutGlobalScope(BookshelfScope::class)`.
- **Every command writes audit in the same transaction** (INV-8, OPS §1). No Action returns before its `AuditRecorder` call has run inside `DB::transaction`.
- **Retirement is not deletion** (BR §11): `retired` is a domain state with a required reason; `deleted_at` undoes mistakes. No task conflates them.
- **Search folds through `App\Support\Fold::fold()` only.** The stored side is the `title_folded`/`author_folded` `STORED` generated columns frozen in Phase 0; the query side is `Fold::fold($term)`. Nothing re-implements folding, ever — `FoldParityTest` is the treaty between the two.
- **Derived state is computed on read** (BR §8): availability, borrowability and days-remaining come from state plus the clock at query time. If a task seems to need a `copies_available` or `is_overdue` column, the task is wrong.
- **Domain time goes through `App\Support\Clock`** (Task 1) — injectable, moved in tests with `Carbon::setTestNow()`. `now()` is UTC; `today()` is the date in `Asia/Ho_Chi_Minh`, because "today" is a fact about the parish, not about the server.
- **Test conventions this suite has already paid for:** pin errno **and** constraint name on any database refusal (`dbgExpectViolation`'s shape); assert the exact status you mean — 404 (foreign shelf / hidden existence) vs 403 (never used on shelf routes) vs 302 (guest redirect) are three different deliberate answers; no `limit 1`/`first()` on an ambiguous set without an `ORDER BY`; Pest's variadic `toContain()` takes **no** trailing message — wrap the check in `in_array()` and assert with `toBeTrue($message)`; top-level Pest helpers are process-global, so every helper this plan adds is prefix-namespaced (`cat…`, `mgr…`, `rdr…`, `scr…`) and was checked against `grep -rn "^function " tests/` (existing names: `dbFold`, `enumValues`, `dbgShelf`, `dbgUser`, `dbgBook`, `dbgCopy`, `dbgMembership`, `dbgExpectViolation`, `authUser`, `tenancyShelf`, `isolationManager`, `makeCatalogueShelf`, `circulationFixture`, `insertLoan`, `assertUniqueViolation`, `triggerFixture`, `expectSignal`, `adminShelf`, `adminUser`, `assertAdminCheckViolation`, `adminIndexColumns`, `twoShelves`, `assertFkRefusal`, `compositeTenantFkShapes`, `communityShelf`, `communityUser`, `communityBook`, `communityMembership`, `assertCheckViolation`, `communityIndexColumns`, `tenancyExemptModels`, `tenancyModelClasses`, `authzUser`, `authzBind`, `authzMiddlewareUser`).
- **Factories under a bound tenant:** `BelongsToBookshelf`'s creating hook refuses a factory whose definition invents its own shelf. Call `Book::factory()->for($shelf)` / pass `bookshelf_id` explicitly, or build fixtures before binding the tenant — known-gaps documents the trap.
- **No inline Vietnamese in TSX** — client copy in `resources/js/lib/copy.ts` (interpolation via its `t()`), server copy in `lang/vi/`, enforced by Biome's `noJsxLiterals`. String *props* are on you: review them by hand.
- **Mass-assignment discipline:** every write path that feeds request input into a model goes through a Form Request's `validated()` — never `$request->all()`. (Known-gaps: `$guarded = []` left status columns assignable; the Form Requests are the gate.)
- **`make test FILTER=…`** runs a filtered suite inside the compose `app` container; `make lint` is Pint; `make analyse` is Larastan. Use them as written.
- **Scratch output** goes to `.artifacts/` (gitignored), never the repo root or `/tmp`.

---

### Task 1: Phase-1 groundwork — `Clock`, `RuleViolated`, `AuditRecorder`, and the Vietnamese validation messages

**Files:**
- Create: `app/Support/Clock.php`
- Create: `app/Exceptions/RuleViolated.php`
- Create: `app/Support/AuditRecorder.php`
- Create: `lang/vi/rules.php`
- Create: `lang/vi/validation.php`
- Edit: `bootstrap/app.php` (the `withExceptions` block only — add, never rewrite; two earlier tasks' registrations live in this file)
- Test: `tests/Unit/ClockTest.php`
- Test: `tests/Feature/Catalogue/AuditRecorderTest.php`
- Test: `tests/Feature/Catalogue/RuleViolatedRenderingTest.php`

**Interfaces:**
- Consumes: `App\Support\TenantContext` (Phase 0 — `bookshelfId(): ?string`), `App\Models\AuditLog` (Phase 0 — `$guarded = []`, `$timestamps = false`, array casts on `before`/`after`/`context`).
- Produces:
  - `App\Support\Clock` — `now(): CarbonImmutable` (UTC), `today(): string` (`Y-m-d` in `Asia/Ho_Chi_Minh`). The "application-side `Clock` binding" Phase 0's Global Constraints promised would arrive "with the first Action class in Phase 1". Plain instantiable class, no interface — `Carbon::setTestNow()` moves it in tests, so a swappable binding would be machinery without a second implementation.
  - `App\Exceptions\RuleViolated` — `__construct(public readonly string $code)`; rendered as a redirect back with the `rule` error bag key carrying `__('rules.'.$code)`. The Laravel form of `src/domain/kernel/errors.ts`'s `RuleViolated`, and spec §7's "exception handler mapping `RuleViolated` to the right response, so it stays one decision in one place".
  - `App\Support\AuditRecorder` — `record(string $action, string $entityType, ?string $entityId, ?array $before, ?array $after): void`. Writes one `audit_log` row using the bound shelf and the authenticated user; INV-8's pen. (A `global: true` variant is not built — nothing in 1a writes a global audit row; the admin category commands that would need it are Phase 3's.)
  - `lang/vi/rules.php` — every stable failure code this plan throws, keyed by code, sentence verbatim from OPS §4.1 (or from the reference where OPS has none).
  - `lang/vi/validation.php` — closes the known-gaps item "no `validation.php` language file exists, in any locale": with `APP_LOCALE=vi` **and** `APP_FALLBACK_LOCALE=vi`, an untranslated rule renders its raw key (`validation.required`) to the user. Phase 1's forms are where that would first be seen in production.

- [ ] **Step 1: Write the failing tests**

Create `tests/Unit/ClockTest.php`:

```php
<?php

use App\Support\Clock;
use Carbon\Carbon;
use Carbon\CarbonImmutable;

afterEach(fn () => Carbon::setTestNow());

it('reads now in utc and honours setTestNow', function () {
    Carbon::setTestNow(Carbon::parse('2026-08-27 10:00:00', 'UTC'));

    $now = (new Clock)->now();

    expect($now)->toBeInstanceOf(CarbonImmutable::class)
        ->and($now->timezoneName)->toBe('UTC')
        ->and($now->toDateTimeString())->toBe('2026-08-27 10:00:00');
});

it('computes today in Asia/Ho_Chi_Minh, not the server timezone', function () {
    // 18:30 UTC on the 27th is already 01:30 on the 28th in Hồ Chí Minh —
    // the exact off-by-one a naive now()->toDateString() would produce for
    // acquired_on and, in 1c, for due dates.
    Carbon::setTestNow(Carbon::parse('2026-08-27 18:30:00', 'UTC'));

    expect((new Clock)->today())->toBe('2026-08-28');
});
```

Create `tests/Feature/Catalogue/AuditRecorderTest.php`:

```php
<?php

use App\Models\AuditLog;
use App\Models\User;
use App\Support\AuditRecorder;
use Carbon\Carbon;
use Tests\Support\TenantHarness;

afterEach(fn () => Carbon::setTestNow());

it('writes one audit row naming actor, shelf, entity, before and after', function () {
    ['a' => $shelf] = TenantHarness::twoCollidingShelves();
    $user = TenantHarness::readerFor($shelf);
    TenantHarness::actAs($shelf);
    $this->actingAs($user);
    Carbon::setTestNow(Carbon::parse('2026-08-27 03:00:00', 'UTC'));

    app(AuditRecorder::class)->record(
        'book.created', 'book', 'b0000000-0000-7000-8000-000000000001',
        null, ['title' => 'Dế Mèn Phiêu Lưu Ký'],
    );

    $row = AuditLog::query()->where('action', 'book.created')->orderByDesc('id')->first();
    expect($row)->not->toBeNull()
        ->and($row->bookshelf_id)->toBe($shelf->id)
        ->and($row->actor_id)->toBe($user->id)
        ->and($row->entity_type)->toBe('book')
        ->and($row->entity_id)->toBe('b0000000-0000-7000-8000-000000000001')
        ->and($row->before)->toBeNull()
        ->and($row->after)->toBe(['title' => 'Dế Mèn Phiêu Lưu Ký'])
        ->and($row->occurred_at->toDateTimeString())->toBe('2026-08-27 03:00:00');
});

it('refuses to record with no tenant bound rather than writing a shelfless row', function () {
    // A shelf-scoped command's audit row missing its shelf would be
    // invisible to that shelf's own audit screen — fail loudly instead,
    // matching BookshelfScope's fail-closed shape.
    $user = User::factory()->create();
    $this->actingAs($user);

    expect(fn () => app(AuditRecorder::class)->record('book.created', 'book', null, null, []))
        ->toThrow(RuntimeException::class);
});
```

Create `tests/Feature/Catalogue/RuleViolatedRenderingTest.php`:

```php
<?php

use App\Exceptions\RuleViolated;
use Illuminate\Support\Facades\Route;

it('renders a RuleViolated as a redirect back with the translated sentence', function () {
    Route::middleware('web')->post('/_test/rule-violated', function () {
        throw new RuleViolated('duplicate_isbn');
    });

    $response = $this->from('/shelves')->post('/_test/rule-violated');

    $response->assertRedirect('/shelves');
    $response->assertSessionHasErrors(['rule' => 'Mã ISBN này đã tồn tại trong tủ sách.']);
});

it('renders required-field validation in Vietnamese, not as a raw key', function () {
    // The known-gaps entry this task closes: with APP_LOCALE=vi and
    // APP_FALLBACK_LOCALE=vi, a missing lang/vi/validation.php renders the
    // literal string "validation.required". This test fails while that
    // file is absent and passes once it exists — delete the file to see it
    // red.
    expect(__('validation.required', ['attribute' => 'tiêu đề']))
        ->not->toBe('validation.required')
        ->toBe('Vui lòng nhập tiêu đề.');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `make test FILTER=ClockTest` — Expected: FAIL (`Class "App\Support\Clock" not found`)
Run: `make test FILTER=AuditRecorderTest` — Expected: FAIL
Run: `make test FILTER=RuleViolatedRenderingTest` — Expected: FAIL

- [ ] **Step 3: Write `app/Support/Clock.php`**

```php
<?php

namespace App\Support;

use Carbon\CarbonImmutable;

/**
 * The application clock — the Laravel form of src/domain/kernel/clock.ts's
 * injected clock, replacing the olibra_now() DB function the spec dropped
 * (§4). Immutable Carbon so a caller cannot mutate a shared instant, and
 * always through CarbonImmutable::now(), which honours Carbon::setTestNow().
 *
 * today() is deliberately in Asia/Ho_Chi_Minh: "today" for acquired_on
 * (this phase) and due_on (1c) is the parish's day, not the server's UTC
 * day — at 01:30 Hồ Chí Minh time the server's UTC date is still yesterday.
 */
final class Clock
{
    public function now(): CarbonImmutable
    {
        return CarbonImmutable::now('UTC');
    }

    /** `Y-m-d` in the application's civil timezone. */
    public function today(): string
    {
        return CarbonImmutable::now('Asia/Ho_Chi_Minh')->toDateString();
    }
}
```

- [ ] **Step 4: Write `app/Exceptions/RuleViolated.php`**

```php
<?php

namespace App\Exceptions;

use RuntimeException;

/**
 * A business-rule refusal with a stable, machine-readable code (OPS §2:
 * "Errors are named, not generic"). The code doubles as the lang/vi/rules.php
 * key; the render hook in bootstrap/app.php is the one place a code becomes
 * a sentence, so a rule refused in an Action and a rule refused in a later
 * phase's console command read identically.
 */
final class RuleViolated extends RuntimeException
{
    public function __construct(public readonly string $code)
    {
        parent::__construct($code);
    }
}
```

- [ ] **Step 5: Write `app/Support/AuditRecorder.php`**

```php
<?php

namespace App\Support;

use App\Models\AuditLog;
use Illuminate\Support\Facades\Auth;
use RuntimeException;

/**
 * INV-8's pen: one row per state transition, written by the command inside
 * its own DB::transaction — the caller owns the transaction, this class
 * only writes the row, so "audit and change commit or roll back together"
 * (OPS §1) is the transaction's property, not this class's.
 *
 * Shelf and actor come from the bound context, never from parameters — a
 * command cannot audit itself onto another shelf or as another user. No
 * tenant bound is an error, not a null shelf: a shelf-scoped command's
 * audit row with a null bookshelf_id would vanish from that shelf's own
 * audit screen (global rows are the cross-shelf admin acts of Phase 3).
 */
final class AuditRecorder
{
    public function __construct(
        private TenantContext $context,
        private Clock $clock,
    ) {}

    /**
     * @param  array<string, mixed>|null  $before
     * @param  array<string, mixed>|null  $after
     */
    public function record(string $action, string $entityType, ?string $entityId, ?array $before, ?array $after): void
    {
        $bookshelfId = $this->context->bookshelfId();

        if ($bookshelfId === null) {
            throw new RuntimeException(
                'AuditRecorder needs a bound tenant. Bind one via the tenant middleware '
                .'(or TenantHarness::actAs() in tests) before running a shelf-scoped command.',
            );
        }

        AuditLog::query()->create([
            'bookshelf_id' => $bookshelfId,
            'actor_id' => Auth::id(),
            'action' => $action,
            'entity_type' => $entityType,
            'entity_id' => $entityId,
            'before' => $before,
            'after' => $after,
            'context' => [],
            'occurred_at' => $this->clock->now(),
        ]);
    }
}
```

- [ ] **Step 6: Register the `RuleViolated` render hook in `bootstrap/app.php`**

In the currently empty `->withExceptions(function (Exceptions $exceptions) { … })` block, add (and add the two `use` lines at the top of the file: `use App\Exceptions\RuleViolated;` and `use Illuminate\Http\Request;`):

```php
    ->withExceptions(function (Exceptions $exceptions) {
        // Spec §7: RuleViolated maps to "the right response" in ONE place.
        // For the Inertia forms this phase ships, the right response is a
        // redirect back carrying the Vietnamese sentence under the `rule`
        // key — pages read it from the shared `errors` prop. Business-rule
        // refusals are never 500s (OPS §2) and never field errors (those
        // are ValidationException's, rendered per-field).
        $exceptions->render(function (RuleViolated $e, Request $request) {
            return back()->withErrors(['rule' => __('rules.'.$e->code)]);
        });
    })->create();
```

- [ ] **Step 7: Write `lang/vi/rules.php`**

Every code any task in this plan throws, sentence verbatim from OPS §4.1 where OPS names one, from the reference's reasoning where it does not (`retire_reason_required` — the reference's own docstring explains why the shipped `reason_required` sentence, "Vui lòng ghi lý do huỷ.", is wrong here: *huỷ* is cancelling, not withdrawing a book for good):

```php
<?php

/**
 * Business-rule refusal sentences, keyed by RuleViolated code — OPS §2's
 * "stable, machine-readable code paired with the plain Vietnamese sentence
 * the UI shows". Sentences are OPS §4.1's verbatim where it names one, and
 * the reference's ERROR_MESSAGES (old_next/src/domain/kernel/errors.ts)
 * verbatim for the codes OPS does not tabulate.
 */
return [
    'duplicate_isbn' => 'Mã ISBN này đã tồn tại trong tủ sách.',
    'has_active_loans' => 'Không thể xoá sách đang có bản được mượn.',
    'already_lost' => 'Bản sách này đã được báo mất.',
    'already_retired' => 'Bản sách đã ngừng dùng, không thể báo mất.',
    'not_lost' => 'Bản sách này hiện không ở trạng thái đã mất.',
    'copy_on_loan' => 'Không thể ngừng dùng bản sách đang được mượn. Hãy nhận trả hoặc báo mất trước.',
    'copy_not_available' => 'Bản sách này đang được mượn hoặc đang giữ chỗ.',
    'copy_not_on_loan' => 'Chỉ có thể báo mất bản sách đang được mượn.',
    'retire_reason_required' => 'Vui lòng ghi lý do ngừng dùng bản sách này.',
    'donor_ambiguous' => 'Chọn bạn đọc hoặc gõ tên người tặng, không chọn cả hai.',
    'copy_count_invalid' => 'Số bản phải lớn hơn 0.',
];
```

- [ ] **Step 8: Write `lang/vi/validation.php`**

Publish Laravel's stock file (`php artisan lang:publish` writes `lang/en/validation.php`; translate the rules this phase's Form Requests actually reach, keep the full file so later phases inherit it). The file must at minimum carry these keys translated — the ones Tasks 6–9 and 12–13 exercise — with the standard `attributes` map naming every field this plan validates:

```php
<?php

return [
    'required' => 'Vui lòng nhập :attribute.',
    'string' => ':attribute phải là chữ.',
    'integer' => ':attribute phải là số nguyên.',
    'boolean' => ':attribute phải là đúng hoặc sai.',
    'date' => ':attribute không phải là ngày hợp lệ.',
    'date_format' => ':attribute không đúng định dạng :format.',
    'min' => ['numeric' => ':attribute phải ít nhất là :min.', 'string' => ':attribute phải có ít nhất :min ký tự.'],
    'max' => ['numeric' => ':attribute không được lớn hơn :max.', 'string' => ':attribute không được dài quá :max ký tự.'],
    'in' => ':attribute không hợp lệ.',
    'exists' => ':attribute không tồn tại.',
    'uuid' => ':attribute không hợp lệ.',
    'prohibits' => 'Không thể điền :attribute cùng lúc với :other.',

    'attributes' => [
        'title' => 'tiêu đề',
        'author' => 'tác giả',
        'category_slug' => 'thể loại',
        'publisher' => 'nhà xuất bản',
        'published_year' => 'năm xuất bản',
        'page_count' => 'số trang',
        'isbn' => 'mã ISBN',
        'description' => 'mô tả',
        'language' => 'ngôn ngữ',
        'is_published' => 'trạng thái hiển thị',
        'copy_count' => 'số bản sách',
        'count' => 'số bản sách',
        'donor_membership_id' => 'thành viên tặng sách',
        'donor_name' => 'tên người tặng',
        'acquired_on' => 'ngày nhận',
        'condition' => 'tình trạng',
        'note' => 'ghi chú',
        'reason' => 'lý do',
        'q' => 'từ khoá',
    ],
];
```

(Copy the remaining untranslated rule keys from `vendor/laravel/framework/src/Illuminate/Translation/lang/en/validation.php` and translate them as encountered; a rule key present in English is still a defect this file exists to remove, so prefer translating the whole file in one sitting — it is ~100 short strings.)

- [ ] **Step 9: Run the tests to verify they pass**

Run: `make test FILTER=ClockTest` — Expected: PASS
Run: `make test FILTER=AuditRecorderTest` — Expected: PASS
Run: `make test FILTER=RuleViolatedRenderingTest` — Expected: PASS
Run: `make lint && make analyse` — Expected: clean

- [ ] **Step 10: Commit**

```bash
git add app/Support app/Exceptions bootstrap/app.php lang/vi tests
git commit -m "feat: phase-1 groundwork — clock, rule-violated rendering, audit recorder, vietnamese validation"
```

---

### Task 2: The catalogue's pure rules — state machine, copy codes, slugs, availability

**Files:**
- Create: `app/Support/Catalogue/CopyStateMachine.php`
- Create: `app/Support/Catalogue/CopyCodes.php`
- Create: `app/Support/Catalogue/Slugs.php`
- Create: `app/Support/Catalogue/Availability.php`
- Create: `app/Support/Catalogue/Donor.php`
- Test: `tests/Unit/Catalogue/CopyStateMachineTest.php`
- Test: `tests/Unit/Catalogue/CopyCodesTest.php`
- Test: `tests/Unit/Catalogue/SlugsTest.php`
- Test: `tests/Unit/Catalogue/AvailabilityTest.php`

**Read first:** `old_next/src/domain/catalogue/policy.ts` (the whole file), `old_next/tests/domain/catalogue/policy.test.ts`, `old_next/tests/domain/catalogue/slug-derives-from-fold.test.ts`. These are the specification for this task; the transition table below is BR §7.1's, arrow for arrow.

**Interfaces:**
- Consumes: `App\Enums\CopyState`, `App\Enums\CopyCondition`, `App\Support\Fold::fold(string): string`, `App\Exceptions\RuleViolated` (Task 1).
- Produces (all pure, no I/O, tested without booting the framework):
  - `CopyStateMachine::check(CopyState $from, CopyState $to): ?string` — `null` when the transition is allowed, otherwise the refusal code (a `lang/vi/rules.php` key). `CopyStateMachine::assert(CopyState $from, CopyState $to): void` — throws `RuleViolated(check(...))`.
  - `CopyCodes::prefix(string $slug, ?array $settings): string` · `CopyCodes::format(string $prefix, int $sequence): string` · `CopyCodes::escapeLike(string $value): string`.
  - `Slugs::fromTitle(string $title): string` · `Slugs::nextAvailable(string $base, array $existing): string`.
  - `Availability::derive(int $available, int $onLoan, int $held, int $lost, bool $hasRetired): string` — one of `available|on_loan|held|lost|retired|none`.
  - `Donor::assertSingle(?string $donorMembershipId, ?string $donorName): void` — throws `RuleViolated('donor_ambiguous')`.

- [ ] **Step 1: Write the failing unit tests**

Create `tests/Unit/Catalogue/CopyStateMachineTest.php` — ported from `policy.test.ts`, table-driven so the BR §7.1 table and this file can be compared by eye:

```php
<?php

use App\Enums\CopyState;
use App\Exceptions\RuleViolated;
use App\Support\Catalogue\CopyStateMachine;

it('is BR §7.1\'s table, arrow for arrow', function () {
    $allowed = [
        [CopyState::Available, CopyState::Held],
        [CopyState::Available, CopyState::OnLoan],
        [CopyState::Available, CopyState::Retired],
        [CopyState::Held, CopyState::Available],
        [CopyState::Held, CopyState::OnLoan],
        [CopyState::OnLoan, CopyState::Available],
        [CopyState::OnLoan, CopyState::Lost],
        [CopyState::Lost, CopyState::Available],
        [CopyState::Lost, CopyState::Retired],
    ];

    $states = CopyState::cases();
    foreach ($states as $from) {
        foreach ($states as $to) {
            $isDrawn = collect($allowed)->contains(fn ($arrow) => $arrow === [$from, $to]);
            $verdict = CopyStateMachine::check($from, $to);
            expect($verdict === null)->toBe($isDrawn, "{$from->value} -> {$to->value}");
        }
    }
});

it('Q3: an available copy cannot be reported lost, and says why', function () {
    expect(CopyStateMachine::check(CopyState::Available, CopyState::Lost))->toBe('copy_not_on_loan')
        ->and(CopyStateMachine::check(CopyState::Held, CopyState::Lost))->toBe('copy_not_on_loan');
});

it('a copy on loan cannot be retired, and names the way out', function () {
    expect(CopyStateMachine::check(CopyState::OnLoan, CopyState::Retired))->toBe('copy_on_loan');
});

it('a held copy cannot be retired either, with the generic refusal', function () {
    expect(CopyStateMachine::check(CopyState::Held, CopyState::Retired))->toBe('copy_not_available');
});

it('the terminal and repeated states each get their own reason', function () {
    expect(CopyStateMachine::check(CopyState::Retired, CopyState::Available))->toBe('already_retired')
        ->and(CopyStateMachine::check(CopyState::Retired, CopyState::Lost))->toBe('already_retired')
        ->and(CopyStateMachine::check(CopyState::Lost, CopyState::OnLoan))->toBe('already_lost')
        ->and(CopyStateMachine::check(CopyState::Lost, CopyState::Held))->toBe('already_lost');
});

it('INV-7: a lost or retired copy cannot be lent or held', function () {
    foreach ([CopyState::Lost, CopyState::Retired] as $from) {
        foreach ([CopyState::OnLoan, CopyState::Held] as $to) {
            expect(CopyStateMachine::check($from, $to))->not->toBeNull("{$from->value} -> {$to->value}");
        }
    }
});

it('marking found when the copy is not lost refuses with not_lost', function () {
    expect(CopyStateMachine::check(CopyState::OnLoan, CopyState::Available))->toBeNull() // return path — allowed
        ->and(CopyStateMachine::check(CopyState::Available, CopyState::Available))->toBe('not_lost');
});

it('assert throws RuleViolated carrying the refusal code', function () {
    expect(fn () => CopyStateMachine::assert(CopyState::OnLoan, CopyState::Retired))
        ->toThrow(RuleViolated::class, 'copy_on_loan');
});

it('every refusal code the machine can produce has a Vietnamese sentence', function () {
    // A code with no rules.php entry renders as the literal "rules.<code>".
    $codes = ['already_retired', 'already_lost', 'copy_not_on_loan', 'copy_on_loan', 'copy_not_available', 'not_lost'];
    $rules = require __DIR__.'/../../../lang/vi/rules.php';
    foreach ($codes as $code) {
        expect(array_key_exists($code, $rules))->toBeTrue("missing rules.{$code}");
    }
});
```

Create `tests/Unit/Catalogue/CopyCodesTest.php`:

```php
<?php

use App\Support\Catalogue\CopyCodes;

it('derives DT from dong-thap, and every other fixture shelf', function () {
    // The reference's own fixture table (copyCodePrefix's docstring).
    expect(CopyCodes::prefix('dong-thap', null))->toBe('DT')
        ->and(CopyCodes::prefix('can-tho', null))->toBe('CT')
        ->and(CopyCodes::prefix('ben-tre', null))->toBe('BT')
        ->and(CopyCodes::prefix('vinh-long', null))->toBe('VL');
});

it('caps a many-word slug at three initials', function () {
    expect(CopyCodes::prefix('nha-tho-duc-ba-sai-gon', null))->toBe('NTD');
});

it('a one-word slug still yields two characters, and settings can override', function () {
    expect(CopyCodes::prefix('emmaus', null))->toBe('EM')
        ->and(CopyCodes::prefix('dong-thap', ['copy_code_prefix' => 'kho1']))->toBe('KHO1')
        ->and(CopyCodes::prefix('dong-thap', ['copy_code_prefix' => '  ']))->toBe('DT');
});

it('formats to four digits and never truncates', function () {
    expect(CopyCodes::format('DT', 215))->toBe('DT-0215')
        ->and(CopyCodes::format('DT', 1))->toBe('DT-0001')
        // lpad('10000', 4) would truncate to '1000' and collide with the
        // thousandth copy — the reference's own docstring case.
        ->and(CopyCodes::format('DT', 10000))->toBe('DT-10000');
});

it('escapes %, _ and backslash for a LIKE pattern', function () {
    expect(CopyCodes::escapeLike('KHO_1'))->toBe('KHO\_1')
        ->and(CopyCodes::escapeLike('100%'))->toBe('100\%')
        ->and(CopyCodes::escapeLike('a\b'))->toBe('a\\\\b');
});
```

Create `tests/Unit/Catalogue/SlugsTest.php` — ported from `slug-derives-from-fold.test.ts` plus `nextAvailableSlug`'s cases:

```php
<?php

use App\Support\Catalogue\Slugs;
use App\Support\Fold;

it('every fixture title\'s slug is its folded title with hyphens', function () {
    $titles = [
        'Dế Mèn Phiêu Lưu Ký' => 'de-men-phieu-luu-ky',
        'Hoàng Tử Bé' => 'hoang-tu-be',
        'Totto-chan Bên Cửa Sổ' => 'totto-chan-ben-cua-so',
        'Đất Rừng Phương Nam' => 'dat-rung-phuong-nam',
        'Tuổi Thơ Dữ Dội' => 'tuoi-tho-du-doi',
    ];
    foreach ($titles as $title => $slug) {
        expect(Slugs::fromTitle($title))->toBe($slug);
    }
});

it('is fold with hyphens — the derivation cannot drift from search', function () {
    $title = 'Kính Vạn Hoa';
    expect(Slugs::fromTitle($title))->toBe(str_replace(' ', '-', Fold::fold($title)));
});

it('đ folds to d in a slug, not just in search', function () {
    expect(Slugs::fromTitle('Đường'))->toBe('duong');
});

it('a title that folds to nothing still yields a routable slug', function () {
    expect(Slugs::fromTitle('!!!'))->toBe('sach');
});

it('CRITICAL 1: disambiguates a taken base rather than rejecting the title', function () {
    expect(Slugs::nextAvailable('de-men', []))->toBe('de-men')
        ->and(Slugs::nextAvailable('de-men', ['de-men']))->toBe('de-men-2')
        ->and(Slugs::nextAvailable('de-men', ['de-men', 'de-men-2', 'de-men-3']))->toBe('de-men-4')
        // a gap is reused — the sequence scans, it does not max()+1
        ->and(Slugs::nextAvailable('de-men', ['de-men', 'de-men-3']))->toBe('de-men-2');
});
```

Create `tests/Unit/Catalogue/AvailabilityTest.php` — the M8 ladder, including the "none vs retired" distinction the fix-wave existed for:

```php
<?php

use App\Support\Catalogue\Availability;

it('walks BR §8\'s ladder: available, on_loan, held, lost, retired, none', function () {
    expect(Availability::derive(1, 2, 1, 1, true))->toBe('available')
        ->and(Availability::derive(0, 2, 1, 1, true))->toBe('on_loan')
        ->and(Availability::derive(0, 0, 1, 1, true))->toBe('held')
        ->and(Availability::derive(0, 0, 0, 1, true))->toBe('lost')
        ->and(Availability::derive(0, 0, 0, 0, true))->toBe('retired');
});

it('M8: zero live copies is none, not retired', function () {
    expect(Availability::derive(0, 0, 0, 0, false))->toBe('none');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `make test FILTER=Catalogue` — Expected: FAIL, class-not-found for each of the four.

- [ ] **Step 3: Write `app/Support/Catalogue/CopyStateMachine.php`**

```php
<?php

namespace App\Support\Catalogue;

use App\Enums\CopyState;
use App\Exceptions\RuleViolated;

/**
 * BR §7.1's transition table, arrow for arrow — the PHP form of
 * old_next/src/domain/catalogue/policy.ts's ALLOWED set and refusalFor().
 * Data, not a chain of ifs, so the table in the requirements and the table
 * here can be compared by eye.
 *
 * Q3 — `available → lost` is deliberately absent. BR §7.1 draws only
 * `on_loan → lost`, and OPS §4.1 flags the broader screen affordance as an
 * open question rather than a decision. Widening later is one line here
 * plus one test; retracting a transition that has written rows is not.
 */
final class CopyStateMachine
{
    private const ALLOWED = [
        'available->held',
        'available->on_loan',
        'available->retired',
        'held->available',
        'held->on_loan',
        'on_loan->available',
        'on_loan->lost',
        'lost->available',
        'lost->retired',
    ];

    /** `null` when allowed; otherwise the refusal code (a lang/vi/rules.php key). */
    public static function check(CopyState $from, CopyState $to): ?string
    {
        if (in_array($from->value.'->'.$to->value, self::ALLOWED, true)) {
            return null;
        }

        return self::refusalFor($from, $to);
    }

    public static function assert(CopyState $from, CopyState $to): void
    {
        $reason = self::check($from, $to);

        if ($reason !== null) {
            throw new RuleViolated($reason);
        }
    }

    /**
     * Why a particular refusal, in the words the volunteer will read —
     * ordered most-specific first: the state the copy is IN usually
     * explains the refusal better than the transition attempted does.
     */
    private static function refusalFor(CopyState $from, CopyState $to): string
    {
        if ($from === CopyState::Retired) {
            return 'already_retired';
        }
        if ($from === CopyState::Lost && $to !== CopyState::Available && $to !== CopyState::Retired) {
            return 'already_lost';
        }
        if ($to === CopyState::Lost) {
            // Q3: reached from available and from held — both mean "this
            // copy is not out with anybody".
            return 'copy_not_on_loan';
        }
        if ($to === CopyState::Retired) {
            return $from === CopyState::OnLoan ? 'copy_on_loan' : 'copy_not_available';
        }
        if ($to === CopyState::Available) {
            // MarkCopyFound's failure mode (OPS §4.1): the copy is not lost.
            return 'not_lost';
        }

        return 'copy_not_available';
    }
}
```

- [ ] **Step 4: Write `app/Support/Catalogue/CopyCodes.php`**

```php
<?php

namespace App\Support\Catalogue;

/**
 * The copy-code derivation, verbatim from
 * old_next/src/domain/catalogue/policy.ts (copyCodePrefix, formatCopyCode,
 * escapeLikePattern). Do not invent a scheme — 'DT-0215' is printed on
 * physical labels.
 */
final class CopyCodes
{
    /**
     * The letters in front of a code — 'DT' in 'DT-0215'. A shelf's
     * settings blob may override via copy_code_prefix; the default derives
     * the initials of the slug's hyphen-separated words (dong-thap → DT),
     * capped at three; a single-word slug falls back to its first two
     * letters, since one initial is too thin for a label read off a book.
     *
     * @param  array<string, mixed>|null  $settings
     */
    public static function prefix(string $slug, ?array $settings): string
    {
        $override = $settings['copy_code_prefix'] ?? null;

        if (is_string($override) && trim($override) !== '') {
            return mb_strtoupper(trim($override));
        }

        $initials = implode('', array_map(
            fn (string $word): string => mb_substr($word, 0, 1),
            array_values(array_filter(explode('-', $slug))),
        ));
        $initials = mb_strtoupper($initials);

        return mb_strlen($initials) >= 2
            ? mb_substr($initials, 0, 3)
            : mb_strtoupper(mb_substr($slug, 0, 2));
    }

    /**
     * 'DT' + 215 → 'DT-0215'. Padded here, never with SQL's LPAD, which
     * truncates on the right: LPAD('10000', 4, '0') is '1000', so the
     * ten-thousandth copy would collide with the thousandth. str_pad with
     * STR_PAD_LEFT never shortens a string.
     */
    public static function format(string $prefix, int $sequence): string
    {
        return $prefix.'-'.str_pad((string) $sequence, 4, '0', STR_PAD_LEFT);
    }

    /**
     * Escapes %, _ and the escape character itself for a LIKE pattern (M7):
     * a copy_code_prefix override containing '_' — LIKE's single-character
     * wildcard — would widen the allocator's max-code scan across codes
     * that were never in this prefix's sequence. Call on the prefix only;
     * the trailing '-%' the allocator appends is the intended wildcard.
     * MariaDB's default LIKE escape character is backslash (this codebase
     * never sets NO_BACKSLASH_ESCAPES), so no ESCAPE clause is needed.
     */
    public static function escapeLike(string $value): string
    {
        return addcslashes($value, '\\%_');
    }
}
```

- [ ] **Step 5: Write `app/Support/Catalogue/Slugs.php`**

```php
<?php

namespace App\Support\Catalogue;

use App\Support\Fold;

/**
 * books.slug derivation — old_next/src/domain/catalogue/policy.ts's
 * slugifyTitle and nextAvailableSlug, over App\Support\Fold so the slug
 * and the search index share one normalisation (BR §12: two copies of a
 * normalisation drift, and drift between the slug and the search index is
 * exactly the failure DATABASE.md §5 is written about).
 */
final class Slugs
{
    /**
     * Fold with hyphens instead of spaces. A punctuation-only title folds
     * to nothing, which is not a routable URL segment — it falls back to
     * 'sach' and nextAvailable() disambiguates from there.
     */
    public static function fromTitle(string $title): string
    {
        $slug = str_replace(' ', '-', Fold::fold($title));

        return $slug === '' ? 'sach' : $slug;
    }

    /**
     * CRITICAL 1 (fix-report, 2026-08-08-b1-catalogue): a second, different
     * edition of a title this shelf already holds collides on the identical
     * slug under books_bookshelf_id_slug_key. Disambiguate — base, base-2,
     * base-3, … — rather than reject: a volunteer holding a second edition
     * should not have to invent a different title to get past a uniqueness
     * rule they cannot see. Pure: the caller supplies the live slugs.
     *
     * @param  list<string>  $existing
     */
    public static function nextAvailable(string $base, array $existing): string
    {
        if (! in_array($base, $existing, true)) {
            return $base;
        }

        $n = 2;
        while (in_array("{$base}-{$n}", $existing, true)) {
            $n++;
        }

        return "{$base}-{$n}";
    }
}
```

- [ ] **Step 6: Write `app/Support/Catalogue/Availability.php`**

```php
<?php

namespace App\Support\Catalogue;

/**
 * The ONE place BR §8's badge ladder is written (M8, fix-report,
 * 2026-08-08-b1-catalogue — previously copy-pasted as a SQL CASE into five
 * queries). Every catalogue query selects the raw counts and calls this.
 *
 * 'none' has no CopyState member on purpose: it means "this title has no
 * live copies at all", which is different on the wire from "every copy is
 * genuinely retired".
 */
final class Availability
{
    /** @return 'available'|'on_loan'|'held'|'lost'|'retired'|'none' */
    public static function derive(int $available, int $onLoan, int $held, int $lost, bool $hasRetired): string
    {
        return match (true) {
            $available > 0 => 'available',
            $onLoan > 0 => 'on_loan',
            $held > 0 => 'held',
            $lost > 0 => 'lost',
            $hasRetired => 'retired',
            default => 'none',
        };
    }
}
```

- [ ] **Step 7: Write `app/Support/Catalogue/Donor.php`**

```php
<?php

namespace App\Support\Catalogue;

use App\Exceptions\RuleViolated;

/**
 * QA remediation Task 19's rule, ported: a copy is attributed to a member's
 * profile OR to a typed name, never both meaning different things on one
 * row. Both blank is the ordinary case (a purchased book has no donor) and
 * must keep working — this only fires when BOTH are non-blank. Shared by
 * CreateBook and AddCopies so the one rule reads identically in both.
 */
final class Donor
{
    public static function assertSingle(?string $donorMembershipId, ?string $donorName): void
    {
        $blank = fn (?string $v): bool => $v === null || trim($v) === '';

        if (! $blank($donorMembershipId) && ! $blank($donorName)) {
            throw new RuleViolated('donor_ambiguous');
        }
    }
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `make test FILTER=Catalogue` — Expected: PASS (all four unit files plus Task 1's).
Run: `make lint && make analyse` — Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add app/Support/Catalogue tests/Unit/Catalogue
git commit -m "feat: catalogue pure rules — copy state machine, codes, slugs, availability, donor"
```

---

### Task 3: `BookPolicy` and `BookCopyPolicy`

Phase 0 deliberately deferred per-model policies ("a Policy for a model no screen touches would be speculation"). The screens arrive in this plan, so the policies arrive here — before the Actions that call them.

**Files:**
- Create: `app/Policies/BookPolicy.php`
- Create: `app/Policies/BookCopyPolicy.php`
- Edit: `app/Providers/AppServiceProvider.php` (add `Gate::policy(...)` lines to `boot()` — add, never rewrite; three earlier tasks' registrations live in this method)
- Test: `tests/Feature/Authz/BookPolicyTest.php`

**Interfaces:**
- Consumes: the Phase 0 gates `act-as-reader` / `act-as-manager` (defined in `AppServiceProvider::boot()`, reading `TenantContext` and nothing else; `Gate::before` grants `act-as-*` to super admins), `App\Models\{Book, BookCopy, User}`.
- Produces:
  - `BookPolicy` — `viewAny(User): bool`, `view(User, Book): bool` (both `act-as-reader`); `create(User): bool`, `update(User, Book): bool`, `delete(User, Book): bool`, `manage(User, Book): bool` (all `act-as-manager`). `manage` is the manager-detail/edit read — BR §13.2's catalogue permission set split along its own lines: "view any book, view a book" are reader verbs, everything else is manager's.
  - `BookCopyPolicy` — `addCopies(User, Book): bool`, `assessCondition(User, BookCopy): bool`, `retire(User, BookCopy): bool`, `reportLost(User, BookCopy): bool`, `markFound(User, BookCopy): bool` (all `act-as-manager`).
  - Later tasks call `Gate::authorize('create', Book::class)` etc.; controllers call `$this->authorize(...)` equivalents through the same Gate.

The policy methods delegate to the `act-as-*` gates rather than re-reading `TenantContext` themselves — the gates are already the single place role, status and shelf-binding are combined (and already fail closed on a missing or non-active membership), so a policy that re-derived any of it would be a second copy that drifts. The model parameter is still real: the global `BookshelfScope` guarantees a bound request can only ever have *resolved* a same-shelf model, so the policy's job is the role question alone. BR §13.3: the interface hiding an action is never the security control — these methods are.

- [ ] **Step 1: Write the failing policy test**

Create `tests/Feature/Authz/BookPolicyTest.php`:

```php
<?php

use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Illuminate\Support\Facades\Gate;
use Tests\Support\TenantHarness;

function bookPolicyActor(string $role): array
{
    ['a' => $shelf] = TenantHarness::twoCollidingShelves();
    $user = User::factory()->create();
    $membership = Membership::factory()->for($shelf)->create([
        'user_id' => $user->id, 'role' => $role, 'status' => 'active',
    ]);
    app(TenantContext::class)->set($shelf, $membership);

    $book = Book::query()->firstOrFail();
    $copy = BookCopy::query()->firstOrFail();

    return [$user, $book, $copy];
}

it('lets a reader view and only view', function () {
    [$user, $book, $copy] = bookPolicyActor('reader');

    expect(Gate::forUser($user)->allows('viewAny', Book::class))->toBeTrue()
        ->and(Gate::forUser($user)->allows('view', $book))->toBeTrue()
        ->and(Gate::forUser($user)->allows('create', Book::class))->toBeFalse()
        ->and(Gate::forUser($user)->allows('update', $book))->toBeFalse()
        ->and(Gate::forUser($user)->allows('delete', $book))->toBeFalse()
        ->and(Gate::forUser($user)->allows('manage', $book))->toBeFalse()
        ->and(Gate::forUser($user)->allows('addCopies', [BookCopy::class, $book]))->toBeFalse()
        ->and(Gate::forUser($user)->allows('assessCondition', $copy))->toBeFalse()
        ->and(Gate::forUser($user)->allows('retire', $copy))->toBeFalse()
        ->and(Gate::forUser($user)->allows('reportLost', $copy))->toBeFalse()
        ->and(Gate::forUser($user)->allows('markFound', $copy))->toBeFalse();
});

it('lets a manager do all of it', function () {
    [$user, $book, $copy] = bookPolicyActor('manager');

    foreach (['create' => Book::class, 'update' => $book, 'delete' => $book, 'manage' => $book] as $ability => $target) {
        expect(Gate::forUser($user)->allows($ability, $target))->toBeTrue($ability);
    }
    expect(Gate::forUser($user)->allows('addCopies', [BookCopy::class, $book]))->toBeTrue()
        ->and(Gate::forUser($user)->allows('assessCondition', $copy))->toBeTrue()
        ->and(Gate::forUser($user)->allows('retire', $copy))->toBeTrue()
        ->and(Gate::forUser($user)->allows('reportLost', $copy))->toBeTrue()
        ->and(Gate::forUser($user)->allows('markFound', $copy))->toBeTrue();
});

it('a suspended manager is refused — the gate\'s status check flows through', function () {
    ['a' => $shelf] = TenantHarness::twoCollidingShelves();
    $user = User::factory()->create();
    $membership = Membership::factory()->for($shelf)->create([
        'user_id' => $user->id, 'role' => 'manager', 'status' => 'suspended',
    ]);
    app(TenantContext::class)->set($shelf, $membership);

    expect(Gate::forUser($user)->allows('create', Book::class))->toBeFalse();
});

it('a memberless super admin passes every manager ability', function () {
    ['a' => $shelf] = TenantHarness::twoCollidingShelves();
    $admin = User::factory()->create(['is_super_admin' => true]);
    app(TenantContext::class)->set($shelf, null);

    $book = Book::query()->firstOrFail();

    expect(Gate::forUser($admin)->allows('update', $book))->toBeTrue()
        ->and(Gate::forUser($admin)->allows('view', $book))->toBeTrue();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `make test FILTER=BookPolicyTest` — Expected: FAIL — with no policy registered, `Gate::allows('view', $book)` is false for the reader case.

- [ ] **Step 3: Write `app/Policies/BookPolicy.php`**

```php
<?php

namespace App\Policies;

use App\Models\Book;
use App\Models\User;
use Illuminate\Support\Facades\Gate;

/**
 * BR §13.2's catalogue permission set, split along its own lines: "view any
 * book, view a book" are reader verbs; create/update/delete are manager's.
 * Every method delegates to the Task 17 act-as gates — the ONE place role,
 * membership status and shelf-binding combine (and the place Gate::before
 * grants super admins) — so this policy can never disagree with the
 * middleware about who a manager is. The $book parameter carries no shelf
 * re-check on purpose: under a bound tenant, BookshelfScope means a
 * foreign shelf's book cannot have been resolved at all.
 */
class BookPolicy
{
    public function viewAny(User $user): bool
    {
        return Gate::forUser($user)->allows('act-as-reader');
    }

    public function view(User $user, Book $book): bool
    {
        return Gate::forUser($user)->allows('act-as-reader');
    }

    public function create(User $user): bool
    {
        return Gate::forUser($user)->allows('act-as-manager');
    }

    public function update(User $user, Book $book): bool
    {
        return Gate::forUser($user)->allows('act-as-manager');
    }

    public function delete(User $user, Book $book): bool
    {
        return Gate::forUser($user)->allows('act-as-manager');
    }

    /** The manager-facing detail/edit read — a floor above view(). */
    public function manage(User $user, Book $book): bool
    {
        return Gate::forUser($user)->allows('act-as-manager');
    }
}
```

- [ ] **Step 4: Write `app/Policies/BookCopyPolicy.php`**

```php
<?php

namespace App\Policies;

use App\Models\Book;
use App\Models\BookCopy;
use App\Models\User;
use Illuminate\Support\Facades\Gate;

/**
 * The copy verbs of BR §13.2 — create copy, retire copy, report copy lost,
 * mark copy found, assess condition — all manager's. addCopies takes the
 * Book because the new copies do not exist yet; the rest take the copy
 * they act on. Same delegation shape as BookPolicy, same reason.
 */
class BookCopyPolicy
{
    public function addCopies(User $user, Book $book): bool
    {
        return Gate::forUser($user)->allows('act-as-manager');
    }

    public function assessCondition(User $user, BookCopy $copy): bool
    {
        return Gate::forUser($user)->allows('act-as-manager');
    }

    public function retire(User $user, BookCopy $copy): bool
    {
        return Gate::forUser($user)->allows('act-as-manager');
    }

    public function reportLost(User $user, BookCopy $copy): bool
    {
        return Gate::forUser($user)->allows('act-as-manager');
    }

    public function markFound(User $user, BookCopy $copy): bool
    {
        return Gate::forUser($user)->allows('act-as-manager');
    }
}
```

- [ ] **Step 5: Register both policies**

In `app/Providers/AppServiceProvider.php`'s `boot()`, after the three `Gate::define('act-as-…')` lines, add (with the matching `use App\Models\Book; use App\Models\BookCopy; use App\Policies\BookPolicy; use App\Policies\BookCopyPolicy;` imports):

```php
        // Phase 1a: policies arrive with the Actions they gate. They
        // delegate to the act-as-* gates above — registered here, after
        // those definitions, so the file reads in dependency order.
        Gate::policy(Book::class, BookPolicy::class);
        Gate::policy(BookCopy::class, BookCopyPolicy::class);
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `make test FILTER=BookPolicyTest` — Expected: PASS
Run: `make test FILTER=GateTest` — Expected: still PASS (the act-as gates are untouched)
Run: `make lint && make analyse` — Expected: clean

- [ ] **Step 7: Commit**

```bash
git add app/Policies app/Providers/AppServiceProvider.php tests/Feature/Authz/BookPolicyTest.php
git commit -m "feat: book and book-copy policies over the act-as gates"
```

---

### Task 4: `CategoryQuery` — the two category lists

**Files:**
- Create: `app/Queries/CategoryQuery.php`
- Test: `tests/Feature/Catalogue/CategoryQueryTest.php`

**Read first:** `old_next/src/lib/catalogue.ts` (`readCatalogueCategories`, `readCategoryOptions`) — the reference deliberately keeps these two near-identical reads in one file so the difference between them stays readable. This task is that file, made a Query class.

**Interfaces:**
- Consumes: `App\Models\Category` (global, **not** shelf-scoped, `SoftDeletes`; its slug unique is plain, not soft-delete-aware — the Phase 0 migration's comment records that as deliberate), `App\Models\Book` (shelf-scoped), `App\Support\Fold`.
- Produces: `App\Queries\CategoryQuery` with
  - `stockedByShelf(bool $includeDrafts = false): array` — `list<array{slug: string, name: string}>` — the categories *this shelf actually stocks*, joined through `books`, for the catalogue filter bar. `$includeDrafts = true` is the manager list's variant (its list has no `is_published` filter, so its filter bar must reach drafts too).
  - `allOptions(): array` — same shape — every live category, for the create/edit form: a create form offering only stocked categories could never reach the category a shelf's *first* book of a kind belongs to.
- Ordering for both: `sort_order`, then folded name — `Fold::fold(name)` computed in PHP after fetch (categories are a six-row global list; folding six strings in PHP keeps the fold in one implementation rather than adding a SQL expression that could drift).

- [ ] **Step 1: Write the failing test**

Create `tests/Feature/Catalogue/CategoryQueryTest.php`:

```php
<?php

use App\Models\Book;
use App\Models\Category;
use App\Queries\CategoryQuery;
use Tests\Support\TenantHarness;

function catqFixture(): array
{
    ['a' => $a, 'b' => $b] = TenantHarness::twoCollidingShelves();

    $stocked = Category::factory()->create(['name' => 'Truyện thiếu nhi', 'slug' => 'truyen-thieu-nhi', 'sort_order' => 1]);
    $draftOnly = Category::factory()->create(['name' => 'Giáo lý', 'slug' => 'giao-ly', 'sort_order' => 2]);
    $unstocked = Category::factory()->create(['name' => 'Khác', 'slug' => 'khac', 'sort_order' => 6]);
    $foreignOnly = Category::factory()->create(['name' => 'Lịch sử', 'slug' => 'lich-su', 'sort_order' => 5]);

    Book::factory()->for($a)->create(['category_id' => $stocked->id]);
    Book::factory()->for($a)->create(['category_id' => $draftOnly->id, 'is_published' => false]);
    Book::factory()->for($b)->create(['category_id' => $foreignOnly->id]);

    TenantHarness::actAs($a);

    return [$a, $b];
}

it('stockedByShelf lists only categories with a live, published book on THIS shelf', function () {
    catqFixture();

    $slugs = array_column(app(CategoryQuery::class)->stockedByShelf(), 'slug');

    expect($slugs)->toBe(['truyen-thieu-nhi']);
});

it('includeDrafts reaches the category whose only titles are drafts', function () {
    catqFixture();

    $slugs = array_column(app(CategoryQuery::class)->stockedByShelf(includeDrafts: true), 'slug');

    expect($slugs)->toBe(['truyen-thieu-nhi', 'giao-ly']);
});

it('a soft-deleted book stops carrying its category into the filter bar', function () {
    [$a] = catqFixture();

    Book::query()->whereHas('category', fn ($q) => $q->where('slug', 'truyen-thieu-nhi'))
        ->get()->each->delete();

    expect(app(CategoryQuery::class)->stockedByShelf())->toBe([]);
});

it('allOptions lists every live category regardless of stock, in sort order', function () {
    catqFixture();

    $slugs = array_column(app(CategoryQuery::class)->allOptions(), 'slug');

    expect($slugs)->toBe(['truyen-thieu-nhi', 'giao-ly', 'lich-su', 'khac']);
});

it('a soft-deleted category disappears from both lists', function () {
    catqFixture();
    Category::query()->where('slug', 'khac')->get()->each->delete();

    expect(array_column(app(CategoryQuery::class)->allOptions(), 'slug'))->not->toContain('khac');
});

it('sort_order ties break on the folded name, not byte order', function () {
    // Byte order puts 'Đời sống' (Đ = 0xC4 90) after 'Van hoa'; folded
    // order puts d before v. Same defect, same fix, as the catalogue sort.
    Category::factory()->create(['name' => 'Đời sống đức tin', 'slug' => 'doi-song-duc-tin', 'sort_order' => 9]);
    Category::factory()->create(['name' => 'Văn hoá', 'slug' => 'van-hoa', 'sort_order' => 9]);
    ['a' => $a] = TenantHarness::twoCollidingShelves();
    TenantHarness::actAs($a);

    $names = array_column(app(CategoryQuery::class)->allOptions(), 'slug');
    $doi = array_search('doi-song-duc-tin', $names, true);
    $van = array_search('van-hoa', $names, true);

    expect($doi)->toBeLessThan($van);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `make test FILTER=CategoryQueryTest` — Expected: FAIL (`Class "App\Queries\CategoryQuery" not found`)

- [ ] **Step 3: Write `app/Queries/CategoryQuery.php`**

```php
<?php

namespace App\Queries;

use App\Models\Book;
use App\Models\Category;
use App\Support\Fold;
use Illuminate\Database\Eloquent\Builder;

/**
 * The two category lists, ported from old_next/src/lib/catalogue.ts —
 * kept in one class so the difference between them stays readable:
 *
 * stockedByShelf() answers the FILTER question — which categories does
 * this shelf actually stock — by going through Book (shelf-scoped by the
 * global scope, so the join is what makes the list this shelf's, not a
 * where clause anybody has to remember). Offering a parish eleven filters
 * that return nothing and one that works is the defect it exists to avoid.
 *
 * allOptions() answers the CREATE-FORM question — every category a book
 * may be catalogued INTO. Mixing the two would be a real defect: a create
 * form restricted to stocked categories can never reach the category a
 * shelf's first book of a new kind belongs to.
 */
final class CategoryQuery
{
    /** @return list<array{slug: string, name: string}> */
    public function stockedByShelf(bool $includeDrafts = false): array
    {
        $categoryIds = Book::query()
            ->when(! $includeDrafts, fn (Builder $q) => $q->where('is_published', true))
            ->whereNotNull('category_id')
            ->distinct()
            ->pluck('category_id');

        $categories = Category::query()
            ->whereIn('id', $categoryIds)
            ->get(['slug', 'name', 'sort_order']);

        return $this->sorted($categories->all());
    }

    /** @return list<array{slug: string, name: string}> */
    public function allOptions(): array
    {
        return $this->sorted(Category::query()->get(['slug', 'name', 'sort_order'])->all());
    }

    /**
     * sort_order, then FOLDED name: under any byte-ordered collation a
     * plain name sort puts 'Đời sống đức tin' after every unaccented
     * category (Đ begins 0xC4). Folding in PHP keeps BR §12's one-fold
     * rule — six rows do not need a SQL expression that could drift.
     *
     * @param  list<Category>  $categories
     * @return list<array{slug: string, name: string}>
     */
    private function sorted(array $categories): array
    {
        usort($categories, fn (Category $x, Category $y) => [$x->sort_order, Fold::fold($x->name)]
            <=> [$y->sort_order, Fold::fold($y->name)]);

        return array_values(array_map(
            fn (Category $c) => ['slug' => $c->slug, 'name' => $c->name],
            $categories,
        ));
    }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `make test FILTER=CategoryQueryTest` — Expected: PASS
Run: `make lint && make analyse` — Expected: clean

- [ ] **Step 5: Commit**

```bash
git add app/Queries/CategoryQuery.php tests/Feature/Catalogue/CategoryQueryTest.php
git commit -m "feat: category query — stocked-by-shelf filter list and full option list"
```

---

### Task 5: `AllocateCopyCodes` — the sequence, serialised per shelf

**Files:**
- Create: `app/Actions/Catalogue/AllocateCopyCodes.php`
- Test: `tests/Feature/Catalogue/AllocateCopyCodesTest.php`

**Read first:** `old_next/src/domain/catalogue/copy-codes.ts` — its docstring is the specification for both the mechanism and the deliberate non-filter on `deleted_at`. Divergence 1 (header) replaces `pg_advisory_xact_lock` with `SELECT … FOR UPDATE` on the shelf's `bookshelves` row; divergence 2 explains why the two-connection race probes do not port.

**Interfaces:**
- Consumes: `App\Support\TenantContext` (`bookshelfId()`), `App\Support\Catalogue\CopyCodes` (Task 2), `App\Models\BookCopy` (scoped; `withTrashed()` for the scan).
- Produces: `App\Actions\Catalogue\AllocateCopyCodes` with `execute(int $count): array` returning `list<string>` — the next `$count` codes on the bound shelf, in order. **Must be called inside the caller's `DB::transaction`, as its first statement — no read may precede it.** The row lock serialises `CreateBook`/`AddCopies` per shelf, and under InnoDB's REPEATABLE READ the transaction's read view is pinned at its *first consistent read*, so a lock taken after any earlier SELECT still reads a stale snapshot (reproduced live on 10.11 in this plan's review — duplicate code, silently-missed ISBN clash). The class docblock carries the full contract; `CreateBook` (Task 6) and `AddCopies` (Task 8) are the only callers.

- [ ] **Step 1: Write the failing test**

Create `tests/Feature/Catalogue/AllocateCopyCodesTest.php`:

```php
<?php

use App\Actions\Catalogue\AllocateCopyCodes;
use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use Illuminate\Support\Facades\DB;
use Tests\Support\TenantHarness;

function catCodesShelf(array $attributes = []): Bookshelf
{
    $shelf = Bookshelf::factory()->create(array_merge(['slug' => 'dong-thap', 'settings' => []], $attributes));
    TenantHarness::actAs($shelf);

    return $shelf;
}

function catCodesBookWithCopies(Bookshelf $shelf, array $codes): Book
{
    $book = Book::factory()->for($shelf)->create();
    foreach ($codes as $code) {
        BookCopy::factory()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => $code]);
    }

    return $book;
}

it('starts at 0001 on an empty shelf and continues the sequence', function () {
    $shelf = catCodesShelf();

    expect(app(AllocateCopyCodes::class)->execute(2))->toBe(['DT-0001', 'DT-0002']);

    catCodesBookWithCopies($shelf, ['DT-0001', 'DT-0002']);

    expect(app(AllocateCopyCodes::class)->execute(3))->toBe(['DT-0003', 'DT-0004', 'DT-0005']);
});

it('a soft-deleted code is never handed out again', function () {
    // BR §5.4: a code is printed on a label stuck to a physical book —
    // handing it out twice is worse than a gap. The scan deliberately does
    // NOT filter deleted_at, even though the unique index does.
    $shelf = catCodesShelf();
    $book = catCodesBookWithCopies($shelf, ['DT-0001', 'DT-0002']);
    BookCopy::query()->where('code', 'DT-0002')->get()->each->delete();

    expect(app(AllocateCopyCodes::class)->execute(1))->toBe(['DT-0003']);
});

it('a hand-imported code that does not end in digits does not break the sequence', function () {
    $shelf = catCodesShelf();
    catCodesBookWithCopies($shelf, ['DT-0007', 'DT-CU']);

    expect(app(AllocateCopyCodes::class)->execute(1))->toBe(['DT-0008']);
});

it('M7: a copy_code_prefix override containing an underscore is not a LIKE wildcard', function () {
    // Unescaped, 'KHO_1' matches 'KHOX1-9000' and inflates max past the
    // prefix's own sequence.
    $shelf = catCodesShelf(['slug' => 'kho-sach', 'settings' => ['copy_code_prefix' => 'KHO_1']]);
    catCodesBookWithCopies($shelf, ['KHOX1-9000', 'KHO_1-0002']);

    expect(app(AllocateCopyCodes::class)->execute(1))->toBe(['KHO_1-0003']);
});

it('another shelf\'s codes never enter this shelf\'s scan', function () {
    ['a' => $a, 'b' => $b] = TenantHarness::twoCollidingShelves();   // both hold DT-0142
    TenantHarness::actAs($a);

    // 0142 exists on BOTH shelves; the next code counts only this shelf's.
    expect(app(AllocateCopyCodes::class)->execute(1))->toBe(['DT-0143']);
});

it('takes the shelf-row lock as the FIRST statement of the transaction', function () {
    // Divergence 2 (plan header): a real two-connection race cannot run
    // under RefreshDatabase — and no single-connection test ever could,
    // because the suite's own outer transaction has already established a
    // read view. So pin the mechanism, position included: under
    // REPEATABLE READ the first consistent read pins the snapshot, and a
    // lock taken after ANY read cannot un-pin it (reproduced live on
    // 10.11 in this plan's review). The FOR UPDATE on bookshelves must
    // therefore be query index 0 — a lock that merely EXISTS somewhere in
    // the log certifies nothing. Dropping lockForUpdate(), or reading
    // anything first, turns this red; the errno-1062 backstop lives in
    // DbGuaranteesTest.
    $shelf = catCodesShelf();
    DB::enableQueryLog();

    DB::transaction(fn () => app(AllocateCopyCodes::class)->execute(1));

    $log = DB::getQueryLog();
    DB::disableQueryLog();

    expect($log)->not->toBe([])
        ->and(str_contains($log[0]['query'], 'bookshelves'))->toBeTrue('first query is not on bookshelves: '.$log[0]['query'])
        ->and(str_contains(strtolower($log[0]['query']), 'for update'))->toBeTrue('first query is not FOR UPDATE: '.$log[0]['query']);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `make test FILTER=AllocateCopyCodesTest` — Expected: FAIL (class not found)

- [ ] **Step 3: Write `app/Actions/Catalogue/AllocateCopyCodes.php`**

```php
<?php

namespace App\Actions\Catalogue;

use App\Models\BookCopy;
use App\Support\Catalogue\CopyCodes;
use App\Support\TenantContext;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * Reserves the next $count copy codes on the bound shelf, in order — the
 * port of old_next/src/domain/catalogue/copy-codes.ts.
 *
 * MUST run inside the caller's DB::transaction, AS ITS FIRST STATEMENT —
 * no read may precede this call. The SELECT ... FOR UPDATE on the shelf's
 * own bookshelves row is what serialises CreateBook and AddCopies per
 * shelf (the reference used pg_advisory_xact_lock; MariaDB's GET_LOCK is
 * connection-scoped and would leak on a thrown exception, an InnoDB row
 * lock releases on commit or rollback with nothing to remember). The
 * first-statement requirement is MariaDB-specific and non-negotiable:
 * InnoDB's REPEATABLE READ pins the transaction's read view at its first
 * consistent read, so a lock acquired after any earlier SELECT still
 * reads the pinned, stale snapshot — reproduced live on 10.11 during this
 * plan's review (duplicate code, silently-missed ISBN clash, missed
 * slug). Postgres's READ COMMITTED refreshed per statement, which is why
 * the reference could afford reads before its lock and this port cannot.
 * The second transaction waits at the lock, then — its view established
 * under the lock — reads a max that already includes the first one's
 * codes. Keyed on the shelf row, so two parishes never queue behind each
 * other. book_copies_code_unique (errno 1062) stays the guarantee; this
 * lock only stops the guarantee being experienced as an error message
 * (BR §2: "must fail cleanly and see a plain message").
 *
 * The scan deliberately does not filter deleted_at, even though the unique
 * index does: a soft-deleted DT-0215 is a code already printed on a label
 * stuck to a physical book (BR §5.4), and handing it out again is worse
 * than a gap in the sequence. withTrashed() removes ONLY the soft-delete
 * scope; BookshelfScope still applies, which is what keeps the scan on
 * this shelf without a hand-written filter.
 */
final class AllocateCopyCodes
{
    public function __construct(private TenantContext $context) {}

    /** @return list<string> */
    public function execute(int $count): array
    {
        $bookshelfId = $this->context->bookshelfId()
            ?? throw new RuntimeException('AllocateCopyCodes needs a bound tenant.');

        // The per-shelf serialisation point. DB::table (not the Bookshelf
        // model) so no global scope machinery runs mid-transaction; the id
        // is the bound tenant's own, so this is not a tenant filter the
        // architecture suite needs to know about.
        $shelf = DB::table('bookshelves')
            ->where('id', $bookshelfId)
            ->lockForUpdate()
            ->first(['slug', 'settings']);

        if ($shelf === null) {
            throw new RuntimeException('Bound shelf vanished mid-transaction.');
        }

        $settings = $shelf->settings === null ? null : json_decode($shelf->settings, true);
        $prefix = CopyCodes::prefix($shelf->slug, is_array($settings) ? $settings : null);

        // REGEXP_SUBSTR(code, '[0-9]+$') returns '' (not NULL — NULL only
        // for NULL input) for a code that does not end in digits;
        // CAST('' AS UNSIGNED) is 0, which never wins MAX against a real
        // sequence, so hand-imported codes leave the sequence intact.
        // CAST AS UNSIGNED because REGEXP_SUBSTR returns text. MariaDB's
        // default LIKE escape is backslash — CopyCodes::escapeLike's
        // contract.
        $last = (int) BookCopy::query()
            ->withTrashed()
            ->where('code', 'like', CopyCodes::escapeLike($prefix).'-%')
            ->selectRaw("MAX(CAST(REGEXP_SUBSTR(code, '[0-9]+$') AS UNSIGNED)) AS last")
            ->value('last');

        return array_map(
            fn (int $i): string => CopyCodes::format($prefix, $last + $i),
            range(1, $count),
        );
    }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `make test FILTER=AllocateCopyCodesTest` — Expected: PASS
Run: `make lint && make analyse` — Expected: clean

- [ ] **Step 5: Commit**

```bash
git add app/Actions/Catalogue/AllocateCopyCodes.php tests/Feature/Catalogue/AllocateCopyCodesTest.php
git commit -m "feat: copy-code allocator — per-shelf row lock, gap-preserving scan"
```

---

### Task 6: `CreateBook` — one cataloguing event, one transaction

**Files:**
- Create: `app/Actions/Catalogue/CreateBook.php`
- Create: `app/Http/Requests/Catalogue/StoreBookRequest.php`
- Test: `tests/Feature/Catalogue/CreateBookTest.php`

**Read first:** `old_next/tests/domain/catalogue/create-book.test.ts` — the specification — then `old_next/src/domain/catalogue/commands/create-book.ts`. OPS §4.1 `CreateBook`.

**Interfaces:**
- Consumes: `AllocateCopyCodes::execute(int $count): array` (list of codes; must be called inside the caller's transaction — Task 5), `Slugs::fromTitle(string): string`, `Slugs::nextAvailable(string, array): string`, `Donor::assertSingle(?string, ?string): void` (Task 2), `Clock::today(): string`, `AuditRecorder::record(string $action, string $entityType, ?string $entityId, ?array $before, ?array $after): void`, `RuleViolated(string $code)` (Task 1), the `create` ability of `BookPolicy` (Task 3), models `Book`, `BookCopy`, `Category`.
- Produces:
  - `App\Actions\Catalogue\CreateBook` — `execute(User $actor, array $input): Book` — the allocator's shelf-row `FOR UPDATE` is the **first statement** of its transaction, with the category, ISBN and slug reads all below it (see the Action's docblock for the MariaDB REPEATABLE READ reproduction that makes this non-negotiable) — where `$input` is `array{title: string, author: string, category_slug: string, publisher?: ?string, published_year?: ?int, page_count?: ?int, isbn?: ?string, description?: ?string, language?: ?string, is_published?: ?bool, copy_count: int, donor_membership_id?: ?string, donor_name?: ?string, acquired_on?: ?string}` — the returned `Book` has its `copies` relation loaded. Throws `AuthorizationException` (not a manager), `ValidationException` (`category_slug` names nothing live), `RuleViolated('duplicate_isbn' | 'donor_ambiguous')`.
  - `StoreBookRequest` — authorizes via `Gate::allows('create', Book::class)`; rules below. Used by Task 12's controller; the Action is also called directly by tests.
- One audit entry, `book.created`, with the codes in `after` — the copies *are part of* the one cataloguing event (OPS §1: "a book with zero copies is not yet meaningfully catalogued"). `AddCopies` (Task 8) audits per copy; the asymmetry is OPS §4.1's own.

- [ ] **Step 1: Write the failing test**

Create `tests/Feature/Catalogue/CreateBookTest.php`:

```php
<?php

use App\Actions\Catalogue\CreateBook;
use App\Exceptions\RuleViolated;
use App\Models\AuditLog;
use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\Category;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Carbon\Carbon;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

afterEach(fn () => Carbon::setTestNow());

function catCreateFixture(string $role = 'manager'): array
{
    $shelf = Bookshelf::factory()->create(['slug' => 'dong-thap', 'settings' => []]);
    $user = User::factory()->create();
    $membership = Membership::factory()->for($shelf)->create([
        'user_id' => $user->id, 'role' => $role, 'status' => 'active',
    ]);
    Category::factory()->create(['name' => 'Truyện thiếu nhi', 'slug' => 'truyen-thieu-nhi']);
    app(TenantContext::class)->set($shelf, $membership);
    test()->actingAs($user);

    return [$shelf, $user];
}

function catCreateInput(array $over = []): array
{
    return array_merge([
        'title' => 'Dế Mèn Phiêu Lưu Ký',
        'author' => 'Tô Hoài',
        'category_slug' => 'truyen-thieu-nhi',
        'copy_count' => 3,
    ], $over);
}

it('creates the book and its first copies in one transaction, with sequential codes', function () {
    [, $user] = catCreateFixture();

    $book = app(CreateBook::class)->execute($user, catCreateInput());

    expect($book->slug)->toBe('de-men-phieu-luu-ky')
        ->and($book->copies)->toHaveCount(3)
        ->and($book->copies->pluck('code')->all())->toBe(['DT-0001', 'DT-0002', 'DT-0003']);
});

it('every generated copy starts available and perfect', function () {
    [, $user] = catCreateFixture();

    $book = app(CreateBook::class)->execute($user, catCreateInput());

    foreach ($book->copies as $copy) {
        expect($copy->state->value)->toBe('available')
            ->and($copy->condition->value)->toBe('perfect');
    }
});

it('defaults acquired_on to today in Asia/Ho_Chi_Minh', function () {
    // 18:30 UTC on the 27th is the 28th in Hồ Chí Minh — the off-by-one
    // Clock::today() exists for.
    Carbon::setTestNow(Carbon::parse('2026-08-27 18:30:00', 'UTC'));
    [, $user] = catCreateFixture();

    $book = app(CreateBook::class)->execute($user, catCreateInput());

    expect($book->copies->first()->acquired_on->toDateString())->toBe('2026-08-28');
});

it('the free-text donor lands on every copy the call creates', function () {
    [, $user] = catCreateFixture();

    $book = app(CreateBook::class)->execute($user, catCreateInput([
        'donor_name' => 'bác Hoà', 'acquired_on' => '2026-07-01',
    ]));

    foreach ($book->copies as $copy) {
        expect($copy->acquired_from)->toBe('bác Hoà')
            ->and($copy->acquired_from_membership_id)->toBeNull()
            ->and($copy->acquired_on->toDateString())->toBe('2026-07-01');
    }
});

it('the member donor lands on every copy the call creates', function () {
    [$shelf, $user] = catCreateFixture();
    $donorUser = User::factory()->create();
    $donor = Membership::factory()->for($shelf)->create([
        'user_id' => $donorUser->id, 'role' => 'reader', 'status' => 'active',
    ]);

    $book = app(CreateBook::class)->execute($user, catCreateInput([
        'donor_membership_id' => $donor->id,
    ]));

    foreach ($book->copies as $copy) {
        expect($copy->acquired_from_membership_id)->toBe($donor->id)
            ->and($copy->acquired_from)->toBeNull();
    }
});

it('filling both donor controls is refused', function () {
    [, $user] = catCreateFixture();

    expect(fn () => app(CreateBook::class)->execute($user, catCreateInput([
        'donor_membership_id' => 'm0000000-0000-7000-8000-000000000001',
        'donor_name' => 'bác Hoà',
    ])))->toThrow(RuleViolated::class, 'donor_ambiguous');

    expect(Book::query()->count())->toBe(0);
});

it('one audit entry per cataloguing event, naming the codes it produced', function () {
    [, $user] = catCreateFixture();

    $book = app(CreateBook::class)->execute($user, catCreateInput());

    $entries = AuditLog::query()->where('action', 'book.created')->get();
    expect($entries)->toHaveCount(1)
        ->and($entries->first()->entity_id)->toBe($book->id)
        ->and($entries->first()->actor_id)->toBe($user->id)
        ->and($entries->first()->after['copyCodes'])->toBe(['DT-0001', 'DT-0002', 'DT-0003'])
        ->and(AuditLog::query()->where('action', 'copy.added')->count())->toBe(0);
});

it('a category slug naming nothing live is a field error, not a driver error', function () {
    [, $user] = catCreateFixture();
    Category::query()->where('slug', 'truyen-thieu-nhi')->get()->each->delete();

    expect(fn () => app(CreateBook::class)->execute($user, catCreateInput()))
        ->toThrow(ValidationException::class);
});

it('a duplicate ISBN on the same shelf is refused; the same ISBN elsewhere is not', function () {
    [$shelf, $user] = catCreateFixture();
    app(CreateBook::class)->execute($user, catCreateInput(['isbn' => '9786041000001']));

    expect(fn () => app(CreateBook::class)->execute($user, catCreateInput([
        'title' => 'Dế Mèn, bản mới', 'isbn' => '9786041000001',
    ])))->toThrow(RuleViolated::class, 'duplicate_isbn');

    // The same ISBN on ANOTHER shelf is fine — the check is per shelf.
    // Unbind first: creating a membership for shelf B while shelf A is
    // bound trips BelongsToBookshelf's foreign-shelf refusal (known-gaps).
    app(TenantContext::class)->clear();
    $other = Bookshelf::factory()->create(['slug' => 'can-tho', 'settings' => []]);
    $otherUser = User::factory()->create();
    $otherMembership = Membership::factory()->for($other)->create([
        'user_id' => $otherUser->id, 'role' => 'manager', 'status' => 'active',
    ]);
    app(TenantContext::class)->set($other, $otherMembership);
    test()->actingAs($otherUser);

    $book = app(CreateBook::class)->execute($otherUser, catCreateInput(['isbn' => '9786041000001']));
    expect($book->exists)->toBeTrue();
});

it('a soft-deleted book frees its ISBN', function () {
    [, $user] = catCreateFixture();
    $first = app(CreateBook::class)->execute($user, catCreateInput(['isbn' => '9786041000001']));
    $first->delete();

    $second = app(CreateBook::class)->execute($user, catCreateInput([
        'title' => 'Dế Mèn, bản mới', 'isbn' => '9786041000001',
    ]));

    expect($second->exists)->toBeTrue();
});

it('CRITICAL 1: a second edition of a held title gets a disambiguated slug, not errno 1062', function () {
    [, $user] = catCreateFixture();
    app(CreateBook::class)->execute($user, catCreateInput());

    $second = app(CreateBook::class)->execute($user, catCreateInput(['copy_count' => 1]));
    $third = app(CreateBook::class)->execute($user, catCreateInput(['copy_count' => 1]));

    expect($second->slug)->toBe('de-men-phieu-luu-ky-2')
        ->and($third->slug)->toBe('de-men-phieu-luu-ky-3');
});

it('a soft-deleted book frees its slug for exact reuse', function () {
    [, $user] = catCreateFixture();
    $first = app(CreateBook::class)->execute($user, catCreateInput());
    $first->delete();

    $second = app(CreateBook::class)->execute($user, catCreateInput(['copy_count' => 1]));

    expect($second->slug)->toBe('de-men-phieu-luu-ky');
});

it('takes the shelf-row lock BEFORE any read — the first query of the transaction', function () {
    // The load-bearing ordering, pinned by position: under REPEATABLE
    // READ the transaction's read view is fixed at its first consistent
    // read, so a category lookup ahead of the allocator's FOR UPDATE
    // reintroduces the silent-ISBN-duplicate window even though the lock
    // is still "in" the transaction (reproduced live on 10.11). No
    // single-connection test can show the corruption itself — this pins
    // the mechanism that prevents it.
    [, $user] = catCreateFixture();
    DB::enableQueryLog();

    app(CreateBook::class)->execute($user, catCreateInput());

    $log = DB::getQueryLog();
    DB::disableQueryLog();

    expect($log)->not->toBe([])
        ->and(str_contains($log[0]['query'], 'bookshelves'))->toBeTrue('first query is not on bookshelves: '.$log[0]['query'])
        ->and(str_contains(strtolower($log[0]['query']), 'for update'))->toBeTrue('first query is not FOR UPDATE: '.$log[0]['query']);
});

it('a copy count below one is refused in the domain, and nothing is written', function () {
    // range(1, 0) is [1, 0] in PHP — unguarded, a zero would allocate two
    // codes. The Form Request guards HTTP; this guards every caller.
    [, $user] = catCreateFixture();

    expect(fn () => app(CreateBook::class)->execute($user, catCreateInput(['copy_count' => 0])))
        ->toThrow(RuleViolated::class, 'copy_count_invalid');

    expect(Book::query()->count())->toBe(0)
        ->and(BookCopy::query()->count())->toBe(0);
});

it('a blank title or author is refused in the domain', function () {
    [, $user] = catCreateFixture();

    expect(fn () => app(CreateBook::class)->execute($user, catCreateInput(['title' => '   '])))
        ->toThrow(Illuminate\Validation\ValidationException::class);
    expect(fn () => app(CreateBook::class)->execute($user, catCreateInput(['author' => ''])))
        ->toThrow(Illuminate\Validation\ValidationException::class);

    expect(Book::query()->count())->toBe(0);
});

it('a reader cannot catalogue a book, and nothing is written', function () {
    [, $user] = catCreateFixture(role: 'reader');

    expect(fn () => app(CreateBook::class)->execute($user, catCreateInput()))
        ->toThrow(AuthorizationException::class);

    expect(Book::query()->count())->toBe(0)
        ->and(BookCopy::query()->count())->toBe(0)
        ->and(AuditLog::query()->count())->toBe(0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `make test FILTER=CreateBookTest` — Expected: FAIL (class not found)

- [ ] **Step 3: Write `app/Actions/Catalogue/CreateBook.php`**

```php
<?php

namespace App\Actions\Catalogue;

use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Category;
use App\Models\User;
use App\Exceptions\RuleViolated;
use App\Support\AuditRecorder;
use App\Support\Catalogue\Donor;
use App\Support\Catalogue\Slugs;
use App\Support\Clock;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\ValidationException;

/**
 * Catalogues a title together with its first copies, in one transaction —
 * OPS §1: one business fact, one audit entry (book.created, codes in
 * `after`), because "a book with zero copies is not yet meaningfully
 * catalogued". Port of old_next/src/domain/catalogue/commands/create-book.ts.
 *
 * ORDERING IS LOAD-BEARING, and stricter here than in the reference
 * (IMPORTANT 2, fix-report, 2026-08-08-b1-catalogue): the allocator's
 * SELECT ... FOR UPDATE must be the FIRST statement inside this
 * transaction — nothing may read before it. Postgres's READ COMMITTED
 * gave the reference a fresh snapshot per statement, so "checks after the
 * lock" sufficed there; InnoDB's REPEATABLE READ pins the transaction's
 * read view at its first consistent read, and a lock acquired afterwards
 * cannot un-pin it. Reproduced live on MariaDB 10.11 (review of this
 * plan): with the category lookup first, T2 took the shelf lock AFTER T1
 * committed and still read stale — duplicate copy code (raw errno 1062),
 * missed ISBN clash (SILENT duplicate — no unique index backs isbn),
 * missed slug (raw 1062). With the lock as the first statement, all
 * three windows closed. So: lock, then category, ISBN, slug — every read
 * below the lock, none above it.
 */
final class CreateBook
{
    public function __construct(
        private AllocateCopyCodes $codes,
        private Clock $clock,
        private AuditRecorder $audit,
    ) {}

    /**
     * @param  array{title: string, author: string, category_slug: string, publisher?: ?string, published_year?: ?int, page_count?: ?int, isbn?: ?string, description?: ?string, language?: ?string, is_published?: ?bool, copy_count: int, donor_membership_id?: ?string, donor_name?: ?string, acquired_on?: ?string}  $input
     */
    public function execute(User $actor, array $input): Book
    {
        Gate::forUser($actor)->authorize('create', Book::class);
        Donor::assertSingle($input['donor_membership_id'] ?? null, $input['donor_name'] ?? null);

        // The domain does not trust a transport (OPS §2) — the Form
        // Request guards the HTTP path, these guard every path. Without
        // the count check, execute(..., 0) would reach range(1, 0), which
        // is [1, 0] in PHP — two codes allocated for a zero-copy request.
        if ($input['copy_count'] < 1) {
            throw new RuleViolated('copy_count_invalid');
        }

        foreach (['title', 'author'] as $required) {
            if (trim($input[$required]) === '') {
                throw ValidationException::withMessages([
                    $required => __('validation.required', [
                        'attribute' => __('validation.attributes.'.$required),
                    ]),
                ]);
            }
        }

        return DB::transaction(function () use ($actor, $input): Book {
            // FIRST statement, before ANY read — the allocator's
            // FOR UPDATE both serialises this command per shelf and, under
            // REPEATABLE READ, keeps the transaction's read view from
            // being pinned by an earlier stale snapshot (see the class
            // docblock; reproduced live). Every read below happens under
            // the lock and therefore sees every committed writer.
            $codes = $this->codes->execute($input['copy_count']);

            $category = Category::query()->where('slug', $input['category_slug'])->first();

            if ($category === null) {
                throw ValidationException::withMessages([
                    'category_slug' => __('validation.exists', ['attribute' => __('validation.attributes.category_slug')]),
                ]);
            }

            $isbn = isset($input['isbn']) && trim((string) $input['isbn']) !== '' ? trim((string) $input['isbn']) : null;

            if ($isbn !== null && Book::query()->where('isbn', $isbn)->exists()) {
                // No unique index backs this — safe as check-then-write
                // only because the row lock above was this transaction's
                // FIRST statement. A read anywhere above the lock would
                // reintroduce the silent-duplicate window (class docblock).
                throw new RuleViolated('duplicate_isbn');
            }

            // Live slugs only (soft-deleted rows free theirs); base plus its
            // numbered variants. Slugs::fromTitle emits [a-z0-9-] only, so
            // the interpolation into REGEXP is literal-safe by construction.
            $base = Slugs::fromTitle($input['title']);
            $existing = Book::query()
                ->where(fn ($q) => $q->where('slug', $base)
                    ->orWhere('slug', 'regexp', '^'.$base.'-[0-9]+$'))
                ->pluck('slug')
                ->all();
            $slug = Slugs::nextAvailable($base, $existing);

            $book = Book::query()->create([
                'category_id' => $category->id,
                'title' => trim($input['title']),
                'slug' => $slug,
                'author' => trim($input['author']),
                'publisher' => $input['publisher'] ?? null,
                'published_year' => $input['published_year'] ?? null,
                'page_count' => $input['page_count'] ?? null,
                'isbn' => $isbn,
                'description' => $input['description'] ?? null,
                'language' => $input['language'] ?? 'vi',
                'is_published' => $input['is_published'] ?? true,
                'added_by' => $actor->id,
            ]);

            $acquiredOn = $input['acquired_on'] ?? $this->clock->today();
            $donorName = isset($input['donor_name']) && trim((string) $input['donor_name']) !== ''
                ? trim((string) $input['donor_name']) : null;

            foreach ($codes as $code) {
                BookCopy::query()->create([
                    'book_id' => $book->id,
                    'code' => $code,
                    'state' => 'available',
                    'condition' => 'perfect',
                    'acquired_on' => $acquiredOn,
                    'acquired_from' => $donorName,
                    'acquired_from_membership_id' => $input['donor_membership_id'] ?? null,
                ]);
            }

            $this->audit->record('book.created', 'book', $book->id, null, [
                'title' => trim($input['title']),
                'slug' => $slug,
                'author' => trim($input['author']),
                'category' => $input['category_slug'],
                'isbn' => $isbn,
                'isPublished' => $input['is_published'] ?? true,
                'copyCodes' => $codes,
            ]);

            return $book->load('copies');
        });
    }
}
```

- [ ] **Step 4: Write `app/Http/Requests/Catalogue/StoreBookRequest.php`**

```php
<?php

namespace App\Http\Requests\Catalogue;

use App\Models\Book;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

/**
 * The create-book form's gate and shape. The donor prohibits pair
 * (`prohibits:` — Laravel has no `prohibited_with` rule; the misnamed
 * variant raises BadMethodCallException at runtime) mirrors
 * Donor::assertSingle so the ordinary submit path gets a FIELD
 * error the form can render inline; the Action still asserts the same rule
 * itself, because the domain does not trust a transport (OPS §2). The
 * category existence check stays in the Action for the same reason — and
 * because `exists:` with a deleted_at IS NULL clause would duplicate a
 * predicate the Category model already owns.
 */
class StoreBookRequest extends FormRequest
{
    public function authorize(): bool
    {
        return Gate::allows('create', Book::class);
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'title' => ['required', 'string', 'max:500'],
            'author' => ['required', 'string', 'max:255'],
            'category_slug' => ['required', 'string', 'max:255'],
            'publisher' => ['nullable', 'string', 'max:255'],
            'published_year' => ['nullable', 'integer', 'min:1000', 'max:2100'],
            'page_count' => ['nullable', 'integer', 'min:1'],
            'isbn' => ['nullable', 'string', 'max:32'],
            'description' => ['nullable', 'string', 'max:5000'],
            'language' => ['nullable', 'string', 'max:8'],
            'is_published' => ['nullable', 'boolean'],
            'copy_count' => ['required', 'integer', 'min:1', 'max:200'],
            'donor_membership_id' => ['nullable', 'uuid', 'prohibits:donor_name'],
            'donor_name' => ['nullable', 'string', 'max:255'],
            'acquired_on' => ['nullable', 'date_format:Y-m-d'],
        ];
    }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `make test FILTER=CreateBookTest` — Expected: PASS
Run: `make lint && make analyse` — Expected: clean

- [ ] **Step 6: Commit**

```bash
git add app/Actions/Catalogue/CreateBook.php app/Http/Requests/Catalogue/StoreBookRequest.php tests/Feature/Catalogue/CreateBookTest.php
git commit -m "feat: create-book action — one cataloguing event, slug disambiguation, donor provenance"
```

---

### Task 7: `UpdateBook` and `DeleteBook` — partial edits, and the retention rule

**Files:**
- Create: `app/Actions/Catalogue/UpdateBook.php`
- Create: `app/Actions/Catalogue/DeleteBook.php`
- Create: `app/Http/Requests/Catalogue/UpdateBookRequest.php`
- Test: `tests/Feature/Catalogue/BookLifecycleTest.php`

**Read first:** `old_next/tests/domain/catalogue/book-lifecycle.test.ts`, then `old_next/src/domain/catalogue/commands/update-book.ts` and `delete-book.ts`. The reference's IMPORTANT 3 (a concurrent edit to a field this call never named must not be silently reverted) is satisfied here **by construction**: the Action fills only the keys the caller supplied, and Eloquent's `UPDATE` sets only dirty columns — there is no full-row write to revert anything with. The `case when/coalesce` machinery does not port because the defect it fixed cannot occur.

**Interfaces:**
- Consumes: Tasks 1–3, 6's `RuleViolated` codes; models.
- Produces:
  - `UpdateBook::execute(User $actor, Book $book, array $changes): Book` — `$changes` carries **only the keys the caller supplied** (a Form Request's `validated()` has exactly this property: an omitted field is absent, an explicitly-cleared one is present as `null`). Recognised keys: `title, author, category_slug, publisher, published_year, page_count, isbn, description, language, is_published`. **`slug` is not a key** — never editable; rewriting it turns every shared link into a 404 (the reference's own decision, recorded, not restated from BR). Throws `RuleViolated('duplicate_isbn')`, `ValidationException` (dead category slug). Audit `book.updated` with `before`/`after` limited to `title, author, isbn, isPublished` (the reference's own audited subset).
  - `DeleteBook::execute(User $actor, Book $book): array{copiesDeleted: int, copiesRetained: int}` — soft-deletes the book; soft-deletes its copies that have **no loan row at all** (returned/voided ones count as history — INV-11 makes loans the permanent record); retains copies with history exactly where they are (BR §11: "A copy with loan history cannot be removed" — a retention rule, **not a throw**; no `copy_has_history` error code exists because nothing would ever throw it). Refuses with `RuleViolated('has_active_loans')` while any live copy is `on_loan` or `held`. Audit `book.deleted` naming both counts. `deleted_at` is written through `Clock`, one instant for book and copies (the reference's M6).
  - `UpdateBookRequest` — authorize `Gate::allows('update', $this->route('book'))`; same field rules as `StoreBookRequest` minus `copy_count`/donor/acquired fields, everything `sometimes`.

- [ ] **Step 1: Write the failing test**

Create `tests/Feature/Catalogue/BookLifecycleTest.php`:

```php
<?php

use App\Actions\Catalogue\CreateBook;
use App\Actions\Catalogue\DeleteBook;
use App\Actions\Catalogue\UpdateBook;
use App\Exceptions\RuleViolated;
use App\Models\AuditLog;
use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\Category;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Carbon\Carbon;
use Illuminate\Auth\Access\AuthorizationException;

afterEach(fn () => Carbon::setTestNow());

function lifecycleFixture(string $role = 'manager'): array
{
    $shelf = Bookshelf::factory()->create(['slug' => 'dong-thap', 'settings' => []]);
    $user = User::factory()->create();
    $membership = Membership::factory()->for($shelf)->create([
        'user_id' => $user->id, 'role' => $role, 'status' => 'active',
    ]);
    Category::factory()->create(['name' => 'Truyện thiếu nhi', 'slug' => 'truyen-thieu-nhi']);
    Category::factory()->create(['name' => 'Giáo lý', 'slug' => 'giao-ly']);
    app(TenantContext::class)->set($shelf, $membership);
    test()->actingAs($user);

    $book = app(CreateBook::class)->execute($user, [
        'title' => 'Dế Mèn Phiêu Lưu Ký', 'author' => 'Tô Hoài',
        'category_slug' => 'truyen-thieu-nhi', 'copy_count' => 2,
        'publisher' => 'NXB Kim Đồng', 'isbn' => '9786041000001',
    ]);

    return [$shelf, $user, $book];
}

it('writes only the fields it was given, and audits before and after', function () {
    [, $user, $book] = lifecycleFixture();

    app(UpdateBook::class)->execute($user, $book, ['title' => 'Dế Mèn Phiêu Lưu Ký (tái bản)', 'is_published' => false]);

    $fresh = $book->fresh();
    expect($fresh->title)->toBe('Dế Mèn Phiêu Lưu Ký (tái bản)')
        ->and($fresh->is_published)->toBeFalse()
        ->and($fresh->publisher)->toBe('NXB Kim Đồng')   // untouched
        ->and($fresh->author)->toBe('Tô Hoài');

    $entry = AuditLog::query()->where('action', 'book.updated')->firstOrFail();
    expect($entry->before['title'])->toBe('Dế Mèn Phiêu Lưu Ký')
        ->and($entry->after['title'])->toBe('Dế Mèn Phiêu Lưu Ký (tái bản)')
        ->and($entry->before['isPublished'])->toBeTrue()
        ->and($entry->after['isPublished'])->toBeFalse();
});

it('an explicit null clears a nullable field; an omitted field never does', function () {
    [, $user, $book] = lifecycleFixture();

    app(UpdateBook::class)->execute($user, $book, ['publisher' => null]);
    expect($book->fresh()->publisher)->toBeNull();

    app(UpdateBook::class)->execute($user, $book, ['title' => 'Dế Mèn']);
    expect($book->fresh()->publisher)->toBeNull()
        ->and($book->fresh()->isbn)->toBe('9786041000001');
});

it('an explicitly blank title or author is refused, never written', function () {
    [, $user, $book] = lifecycleFixture();

    expect(fn () => app(UpdateBook::class)->execute($user, $book, ['title' => '  ']))
        ->toThrow(Illuminate\Validation\ValidationException::class);

    expect($book->fresh()->title)->toBe('Dế Mèn Phiêu Lưu Ký');
});

it('re-categorises by slug', function () {
    [, $user, $book] = lifecycleFixture();

    app(UpdateBook::class)->execute($user, $book, ['category_slug' => 'giao-ly']);

    expect($book->fresh()->category->slug)->toBe('giao-ly');
});

it('does not move the slug out from under an existing link', function () {
    [, $user, $book] = lifecycleFixture();

    app(UpdateBook::class)->execute($user, $book, ['title' => 'Một Tựa Hoàn Toàn Khác']);

    expect($book->fresh()->slug)->toBe('de-men-phieu-luu-ky');
});

it('refuses an ISBN already used on this shelf, ignoring soft-deleted holders', function () {
    [, $user, $book] = lifecycleFixture();
    $other = app(CreateBook::class)->execute($user, [
        'title' => 'Hoàng Tử Bé', 'author' => 'Antoine de Saint-Exupéry',
        'category_slug' => 'truyen-thieu-nhi', 'copy_count' => 1, 'isbn' => '9786041000002',
    ]);

    expect(fn () => app(UpdateBook::class)->execute($user, $book, ['isbn' => '9786041000002']))
        ->toThrow(RuleViolated::class, 'duplicate_isbn');

    $other->delete();
    app(UpdateBook::class)->execute($user, $book, ['isbn' => '9786041000002']);
    expect($book->fresh()->isbn)->toBe('9786041000002');
});

it('keeping the same isbn on the same book is not a clash with itself', function () {
    [, $user, $book] = lifecycleFixture();

    app(UpdateBook::class)->execute($user, $book, ['isbn' => '9786041000001', 'title' => 'Dế Mèn']);

    expect($book->fresh()->title)->toBe('Dế Mèn');
});

it('Q7: DeleteBook soft-deletes the book and the copies that have no history', function () {
    [, $user, $book] = lifecycleFixture();

    $result = app(DeleteBook::class)->execute($user, $book);

    expect($result)->toBe(['copiesDeleted' => 2, 'copiesRetained' => 0])
        ->and(Book::query()->count())->toBe(0)
        ->and(Book::withTrashed()->count())->toBe(1)
        ->and(BookCopy::query()->count())->toBe(0)
        ->and(BookCopy::withTrashed()->count())->toBe(2);
});

it('a copy with loan history is retained, not deleted, and the count says so', function () {
    [$shelf, $user, $book] = lifecycleFixture();
    $withHistory = $book->copies->first();
    Loan::query()->create([
        'copy_id' => $withHistory->id, 'book_id' => $book->id,
        'borrower_id' => $user->id, 'lent_by' => $user->id,
        'due_on' => '2026-08-01', 'status' => 'returned',
        'return_condition' => 'perfect', 'returned_at' => now(),
    ]);

    $result = app(DeleteBook::class)->execute($user, $book);

    expect($result)->toBe(['copiesDeleted' => 1, 'copiesRetained' => 1])
        ->and(BookCopy::query()->whereKey($withHistory->id)->exists())->toBeTrue();

    $entry = AuditLog::query()->where('action', 'book.deleted')->firstOrFail();
    expect($entry->after['copiesDeleted'])->toBe(1)
        ->and($entry->after['copiesRetained'])->toBe(1);
});

it('refuses while a copy is out or held', function () {
    [, $user, $book] = lifecycleFixture();
    $book->copies->first()->update(['state' => 'on_loan']);

    expect(fn () => app(DeleteBook::class)->execute($user, $book))
        ->toThrow(RuleViolated::class, 'has_active_loans');

    expect(Book::query()->whereKey($book->id)->exists())->toBeTrue();
});

it('M6: deleted_at comes from the injected clock, one instant for book and copies', function () {
    [, $user, $book] = lifecycleFixture();
    Carbon::setTestNow(Carbon::parse('2026-08-27 05:00:00', 'UTC'));

    app(DeleteBook::class)->execute($user, $book);

    $deletedBook = Book::withTrashed()->findOrFail($book->id);
    expect($deletedBook->deleted_at->toDateTimeString())->toBe('2026-08-27 05:00:00');
    foreach (BookCopy::withTrashed()->get() as $copy) {
        expect($copy->deleted_at->toDateTimeString())->toBe('2026-08-27 05:00:00');
    }
});

it('a reader can neither edit nor delete', function () {
    [$shelf, $manager, $book] = lifecycleFixture();
    app(TenantContext::class)->clear();
    $reader = User::factory()->create();
    $readerMembership = Membership::factory()->for($shelf)->create([
        'user_id' => $reader->id, 'role' => 'reader', 'status' => 'active',
    ]);
    app(TenantContext::class)->set($shelf, $readerMembership);
    test()->actingAs($reader);

    expect(fn () => app(UpdateBook::class)->execute($reader, $book, ['title' => 'X']))
        ->toThrow(AuthorizationException::class);
    expect(fn () => app(DeleteBook::class)->execute($reader, $book))
        ->toThrow(AuthorizationException::class);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `make test FILTER=BookLifecycleTest` — Expected: FAIL (class not found)

- [ ] **Step 3: Write `app/Actions/Catalogue/UpdateBook.php`**

```php
<?php

namespace App\Actions\Catalogue;

use App\Exceptions\RuleViolated;
use App\Models\Book;
use App\Models\Category;
use App\Models\User;
use App\Support\AuditRecorder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\ValidationException;

/**
 * Edits a title's metadata. Port of update-book.ts, with its IMPORTANT 3
 * satisfied by construction: $changes carries only the keys the caller
 * supplied (a FormRequest's validated() already has that shape), fill()
 * touches only those attributes, and Eloquent's UPDATE writes only dirty
 * columns — so a concurrent edit to a field this call never named is never
 * part of this statement at all. Omitted ≠ null: an omitted key leaves the
 * column alone; a present null clears it.
 *
 * `slug` is not an accepted key, deliberately: it is what
 * /shelves/{shelf}/books/{book} resolves, and rewriting it when a manager
 * fixes a typo turns every link anyone has shared into a 404. A deliberate
 * re-slug would be its own command with its own audit action.
 */
final class UpdateBook
{
    private const FIELDS = [
        'title', 'author', 'publisher', 'published_year', 'page_count',
        'isbn', 'description', 'language', 'is_published',
    ];

    public function __construct(private AuditRecorder $audit) {}

    /** @param array<string, mixed> $changes — only the keys the caller supplied */
    public function execute(User $actor, Book $book, array $changes): Book
    {
        Gate::forUser($actor)->authorize('update', $book);

        return DB::transaction(function () use ($book, $changes): Book {
            $before = [
                'title' => $book->title,
                'author' => $book->author,
                'isbn' => $book->isbn,
                'isPublished' => $book->is_published,
            ];

            if (array_key_exists('category_slug', $changes)) {
                $category = Category::query()->where('slug', $changes['category_slug'])->first();

                if ($category === null) {
                    throw ValidationException::withMessages([
                        'category_slug' => __('validation.exists', ['attribute' => __('validation.attributes.category_slug')]),
                    ]);
                }

                $book->category_id = $category->id;
            }

            if (array_key_exists('isbn', $changes) && $changes['isbn'] !== null && $changes['isbn'] !== $book->isbn) {
                $clash = Book::query()
                    ->where('isbn', $changes['isbn'])
                    ->whereKeyNot($book->id)
                    ->exists();

                if ($clash) {
                    throw new RuleViolated('duplicate_isbn');
                }
            }

            // A book always has a title and an author — an explicit blank
            // is a refusal, not a clear (the reference's own guard; the
            // Form Request covers HTTP, this covers every caller).
            foreach (['title', 'author'] as $required) {
                if (array_key_exists($required, $changes)
                    && (! is_string($changes[$required]) || trim($changes[$required]) === '')) {
                    throw ValidationException::withMessages([
                        $required => __('validation.required', [
                            'attribute' => __('validation.attributes.'.$required),
                        ]),
                    ]);
                }
            }

            foreach (self::FIELDS as $field) {
                if (array_key_exists($field, $changes)) {
                    $value = $changes[$field];
                    $book->{$field} = in_array($field, ['title', 'author'], true) && is_string($value)
                        ? trim($value)
                        : $value;
                }
            }

            $book->save();

            $this->audit->record('book.updated', 'book', $book->id, $before, [
                'title' => $book->title,
                'author' => $book->author,
                'isbn' => $book->isbn,
                'isPublished' => $book->is_published,
            ]);

            return $book;
        });
    }
}
```

- [ ] **Step 4: Write `app/Actions/Catalogue/DeleteBook.php`**

```php
<?php

namespace App\Actions\Catalogue;

use App\Enums\CopyState;
use App\Exceptions\RuleViolated;
use App\Models\Book;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\Clock;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * Soft-deletes a title and the copies that may follow it. Port of
 * delete-book.ts, Q7 decision included: implemented now, unexposed until a
 * confirmation flow is designed — leaving it unwritten means the next
 * person re-derives the copy-retention rule with no test to check them.
 *
 * copy_has_history is a RETENTION RULE, not a throw: the book goes, the
 * copies with no loan row go with it (BR §11: "Only a book's copies follow
 * it when the book itself goes"), and the ones with history — returned and
 * voided loans included, INV-11 makes loans the permanent record — stay
 * exactly where they are. The counts are returned and audited so a screen
 * can say what happened rather than implying a clean sweep.
 */
final class DeleteBook
{
    public function __construct(
        private Clock $clock,
        private AuditRecorder $audit,
    ) {}

    /** @return array{copiesDeleted: int, copiesRetained: int} */
    public function execute(User $actor, Book $book): array
    {
        Gate::forUser($actor)->authorize('delete', $book);

        return DB::transaction(function () use ($book): array {
            $busy = $book->copies()
                ->whereIn('state', [CopyState::OnLoan, CopyState::Held])
                ->exists();

            if ($busy) {
                throw new RuleViolated('has_active_loans');
            }

            // One instant for every row this command touches (M6) — the
            // injected clock, never a per-row now().
            $deletedAt = $this->clock->now();

            $deletable = $book->copies()
                ->whereDoesntHave('loans')
                ->get();

            foreach ($deletable as $copy) {
                $copy->deleted_at = $deletedAt;
                $copy->save();
            }

            $retained = $book->copies()->count();

            $book->deleted_at = $deletedAt;
            $book->save();

            $result = ['copiesDeleted' => $deletable->count(), 'copiesRetained' => $retained];

            $this->audit->record('book.deleted', 'book', $book->id,
                ['title' => $book->title, 'deletedAt' => null],
                [
                    'deletedAt' => $deletedAt->toIso8601String(),
                    'copiesDeleted' => $result['copiesDeleted'],
                    'copiesRetained' => $result['copiesRetained'],
                ],
            );

            return $result;
        });
    }
}
```

`whereDoesntHave('loans')` needs a `loans()` relation on `BookCopy`. Add it to `app/Models/BookCopy.php` (three lines — a `HasMany` to `Loan` on `copy_id`; the model already imports nothing extra):

```php
    /** @return \Illuminate\Database\Eloquent\Relations\HasMany<Loan, $this> */
    public function loans(): HasMany
    {
        return $this->hasMany(Loan::class, 'copy_id');
    }
```

(with `use Illuminate\Database\Eloquent\Relations\HasMany;` and `Loan` imported — `Loan` carries `BelongsToBookshelf`, so under the bound tenant the relation subquery is scoped as well as FK-tied.)

- [ ] **Step 5: Write `app/Http/Requests/Catalogue/UpdateBookRequest.php`**

```php
<?php

namespace App\Http\Requests\Catalogue;

use App\Models\Book;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

/**
 * StoreBookRequest's field rules, everything `sometimes` — validated()
 * then carries exactly the keys the form submitted, which is the contract
 * UpdateBook::execute's $changes parameter is built on: omitted means
 * untouched, present-null means cleared.
 */
class UpdateBookRequest extends FormRequest
{
    public function authorize(): bool
    {
        $book = $this->route('book');

        return $book instanceof Book && Gate::allows('update', $book);
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'title' => ['sometimes', 'required', 'string', 'max:500'],
            'author' => ['sometimes', 'required', 'string', 'max:255'],
            'category_slug' => ['sometimes', 'required', 'string', 'max:255'],
            'publisher' => ['sometimes', 'nullable', 'string', 'max:255'],
            'published_year' => ['sometimes', 'nullable', 'integer', 'min:1000', 'max:2100'],
            'page_count' => ['sometimes', 'nullable', 'integer', 'min:1'],
            'isbn' => ['sometimes', 'nullable', 'string', 'max:32'],
            'description' => ['sometimes', 'nullable', 'string', 'max:5000'],
            'language' => ['sometimes', 'nullable', 'string', 'max:8'],
            'is_published' => ['sometimes', 'boolean'],
        ];
    }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `make test FILTER=BookLifecycleTest` — Expected: PASS
Run: `make lint && make analyse` — Expected: clean

- [ ] **Step 7: Commit**

```bash
git add app/Actions/Catalogue app/Http/Requests/Catalogue/UpdateBookRequest.php app/Models/BookCopy.php tests/Feature/Catalogue/BookLifecycleTest.php
git commit -m "feat: update-book and delete-book — key-presence partial edits, copy retention rule"
```

---

### Task 8: `AddCopies` — more physical objects for an existing title

**Files:**
- Create: `app/Actions/Catalogue/AddCopies.php`
- Create: `app/Http/Requests/Catalogue/AddCopiesRequest.php`
- Test: `tests/Feature/Catalogue/AddCopiesTest.php`

**Read first:** `old_next/src/domain/catalogue/commands/add-copies.ts` and the `AddCopies` cases in `create-book.test.ts` (lines 410–520). OPS §4.1 `AddCopies` — note the audit asymmetry: **one entry per generated copy** ("the record affected is singular per entry, so a batch of five new copies is five audit rows"), unlike `CreateBook`'s single `book.created`.

**Interfaces:**
- Consumes: `AllocateCopyCodes::execute(int $count): array` (Task 5), `Donor::assertSingle(?string, ?string): void`, `Clock::today(): string`, `AuditRecorder::record(string $action, string $entityType, ?string $entityId, ?array $before, ?array $after): void` (Task 1), the `addCopies` ability of `BookCopyPolicy` (Task 3).
- Produces: `AddCopies::execute(User $actor, Book $book, array $input): \Illuminate\Support\Collection` — `$input` is `array{count: int, donor_membership_id?: ?string, donor_name?: ?string, acquired_on?: ?string}`; returns the created `BookCopy` collection in code order. The book arrives as a bound model (route binding already 404'd a foreign shelf's id — the reference's "a book on another shelf is simply not here" is the scoped binding's job now). `AddCopiesRequest` authorizes `Gate::allows('addCopies', [BookCopy::class, $book])`, rules: `count` required integer min 1 max 200, donor trio as in `StoreBookRequest`.

- [ ] **Step 1: Write the failing test**

Create `tests/Feature/Catalogue/AddCopiesTest.php`:

```php
<?php

use App\Actions\Catalogue\AddCopies;
use App\Actions\Catalogue\CreateBook;
use App\Exceptions\RuleViolated;
use App\Models\AuditLog;
use App\Models\Book;
use App\Models\Bookshelf;
use App\Models\Category;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Illuminate\Auth\Access\AuthorizationException;

function addCopiesFixture(string $role = 'manager'): array
{
    $shelf = Bookshelf::factory()->create(['slug' => 'dong-thap', 'settings' => []]);
    $user = User::factory()->create();
    $membership = Membership::factory()->for($shelf)->create([
        'user_id' => $user->id, 'role' => $role, 'status' => 'active',
    ]);
    Category::factory()->create(['name' => 'Truyện thiếu nhi', 'slug' => 'truyen-thieu-nhi']);
    app(TenantContext::class)->set($shelf, $membership);
    test()->actingAs($user);

    $book = app(CreateBook::class)->execute($user, [
        'title' => 'Dế Mèn Phiêu Lưu Ký', 'author' => 'Tô Hoài',
        'category_slug' => 'truyen-thieu-nhi', 'copy_count' => 2,
    ]);

    return [$shelf, $user, $book];
}

it('continues the same sequence and writes one audit row per copy', function () {
    [, $user, $book] = addCopiesFixture();

    $copies = app(AddCopies::class)->execute($user, $book, ['count' => 2, 'donor_name' => 'bác Hoà']);

    expect($copies->pluck('code')->all())->toBe(['DT-0003', 'DT-0004']);
    foreach ($copies as $copy) {
        expect($copy->state->value)->toBe('available')
            ->and($copy->condition->value)->toBe('perfect')
            ->and($copy->acquired_from)->toBe('bác Hoà');
    }

    $entries = AuditLog::query()->where('action', 'copy.added')->get();
    expect($entries)->toHaveCount(2)
        ->and($entries->pluck('entity_id')->sort()->values()->all())
        ->toBe($copies->pluck('id')->sort()->values()->all())
        ->and($entries->first()->after['bookId'])->toBe($book->id);
});

it('its donor fields are its own, not the title\'s', function () {
    // The second copy's giver is frequently not the first copy's — the
    // command's whole reason to exist separately from CreateBook.
    [, $user, $book] = addCopiesFixture();

    $copies = app(AddCopies::class)->execute($user, $book, ['count' => 1]);

    expect($copies->first()->acquired_from)->toBeNull()
        ->and($copies->first()->acquired_from_membership_id)->toBeNull();
});

it('refuses both donor controls at once, writing nothing', function () {
    [, $user, $book] = addCopiesFixture();

    expect(fn () => app(AddCopies::class)->execute($user, $book, [
        'count' => 1,
        'donor_membership_id' => 'm0000000-0000-7000-8000-000000000001',
        'donor_name' => 'bác Hoà',
    ]))->toThrow(RuleViolated::class, 'donor_ambiguous');

    expect($book->copies()->count())->toBe(2);
});

it('a count below one is refused in the domain, and nothing is written', function () {
    [, $user, $book] = addCopiesFixture();

    expect(fn () => app(AddCopies::class)->execute($user, $book, ['count' => 0]))
        ->toThrow(RuleViolated::class, 'copy_count_invalid');

    expect($book->copies()->count())->toBe(2);
});

it('a reader may not add copies', function () {
    [$shelf, $manager, $book] = addCopiesFixture();
    app(TenantContext::class)->clear();
    $reader = User::factory()->create();
    $readerMembership = Membership::factory()->for($shelf)->create([
        'user_id' => $reader->id, 'role' => 'reader', 'status' => 'active',
    ]);
    app(TenantContext::class)->set($shelf, $readerMembership);
    test()->actingAs($reader);

    expect(fn () => app(AddCopies::class)->execute($reader, $book, ['count' => 1]))
        ->toThrow(AuthorizationException::class);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `make test FILTER=AddCopiesTest` — Expected: FAIL (class not found)

- [ ] **Step 3: Write `app/Actions/Catalogue/AddCopies.php`**

```php
<?php

namespace App\Actions\Catalogue;

use App\Exceptions\RuleViolated;
use App\Models\Book;
use App\Models\BookCopy;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\Catalogue\Donor;
use App\Support\Clock;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * Adds physical copies to an already-catalogued title — port of
 * add-copies.ts. Separate from CreateBook for BR §16.3's reason: "a second
 * donated copy of a popular book arrives months after the first, and
 * editing the title is not where a volunteer would look for that." Its
 * donor fields are its own, not the title's.
 *
 * One audit entry PER COPY (OPS §4.1: "the record affected is singular per
 * entry, so a batch of five new copies is five audit rows"), deliberately
 * unlike CreateBook's single book.created — there the copies are part of
 * the one cataloguing event; here the copies ARE the fact.
 */
final class AddCopies
{
    public function __construct(
        private AllocateCopyCodes $codes,
        private Clock $clock,
        private AuditRecorder $audit,
    ) {}

    /**
     * @param  array{count: int, donor_membership_id?: ?string, donor_name?: ?string, acquired_on?: ?string}  $input
     * @return Collection<int, BookCopy>
     */
    public function execute(User $actor, Book $book, array $input): Collection
    {
        Gate::forUser($actor)->authorize('addCopies', [BookCopy::class, $book]);
        Donor::assertSingle($input['donor_membership_id'] ?? null, $input['donor_name'] ?? null);

        // OPS §4.1's copy_count_invalid, guarded in the domain as the
        // reference does — range(1, 0) is [1, 0] in PHP, so an unguarded
        // zero would allocate two codes.
        if ($input['count'] < 1) {
            throw new RuleViolated('copy_count_invalid');
        }

        return DB::transaction(function () use ($book, $input): Collection {
            $codes = $this->codes->execute($input['count']);
            $acquiredOn = $input['acquired_on'] ?? $this->clock->today();
            $donorName = isset($input['donor_name']) && trim((string) $input['donor_name']) !== ''
                ? trim((string) $input['donor_name']) : null;

            $copies = collect();

            foreach ($codes as $code) {
                $copy = BookCopy::query()->create([
                    'book_id' => $book->id,
                    'code' => $code,
                    'state' => 'available',
                    'condition' => 'perfect',
                    'acquired_on' => $acquiredOn,
                    'acquired_from' => $donorName,
                    'acquired_from_membership_id' => $input['donor_membership_id'] ?? null,
                ]);

                $this->audit->record('copy.added', 'copy', $copy->id, null, [
                    'code' => $code,
                    'bookId' => $book->id,
                    'state' => 'available',
                    'acquiredOn' => $acquiredOn,
                    'acquiredFrom' => $donorName,
                    'acquiredFromMembershipId' => $input['donor_membership_id'] ?? null,
                ]);

                $copies->push($copy);
            }

            return $copies;
        });
    }
}
```

- [ ] **Step 4: Write `app/Http/Requests/Catalogue/AddCopiesRequest.php`**

```php
<?php

namespace App\Http\Requests\Catalogue;

use App\Models\Book;
use App\Models\BookCopy;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

class AddCopiesRequest extends FormRequest
{
    public function authorize(): bool
    {
        $book = $this->route('book');

        return $book instanceof Book && Gate::allows('addCopies', [BookCopy::class, $book]);
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'count' => ['required', 'integer', 'min:1', 'max:200'],
            'donor_membership_id' => ['nullable', 'uuid', 'prohibits:donor_name'],
            'donor_name' => ['nullable', 'string', 'max:255'],
            'acquired_on' => ['nullable', 'date_format:Y-m-d'],
        ];
    }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `make test FILTER=AddCopiesTest` — Expected: PASS
Run: `make lint && make analyse` — Expected: clean

- [ ] **Step 6: Commit**

```bash
git add app/Actions/Catalogue/AddCopies.php app/Http/Requests/Catalogue/AddCopiesRequest.php tests/Feature/Catalogue/AddCopiesTest.php
git commit -m "feat: add-copies action — continued sequence, per-copy audit rows"
```

---

### Task 9: The copy-state commands — `AssessCondition`, `RetireCopy`, `ReportCopyLost`, `MarkCopyFound`

**Files:**
- Create: `app/Actions/Catalogue/AssessCondition.php`
- Create: `app/Actions/Catalogue/RetireCopy.php`
- Create: `app/Actions/Catalogue/ReportCopyLost.php`
- Create: `app/Actions/Catalogue/MarkCopyFound.php`
- Create: `app/Http/Requests/Catalogue/AssessConditionRequest.php`
- Create: `app/Http/Requests/Catalogue/RetireCopyRequest.php`
- Create: `app/Http/Requests/Catalogue/CopyNoteRequest.php`
- Test: `tests/Feature/Catalogue/CopyStateTest.php`

**Read first:** `old_next/tests/domain/catalogue/copy-state.test.ts` — the specification — then the four command files under `old_next/src/domain/catalogue/commands/`. Every transition refusal comes from `CopyStateMachine` (Task 2), never an inline `if`, so the rule lives in one table.

**Interfaces:**
- Consumes: `CopyStateMachine::check(CopyState, CopyState): ?string` / `::assert(CopyState, CopyState): void` (Task 2), the `CopyCondition` enum, `Clock::now(): CarbonImmutable`, `AuditRecorder::record(string $action, string $entityType, ?string $entityId, ?array $before, ?array $after): void` (Task 1), `RuleViolated(string $code)`, the `assessCondition`/`retire`/`reportLost`/`markFound` abilities of `BookCopyPolicy` (Task 3), models `BookCopy`, `ConditionAssessment`, `Loan` (and `BookCopy::loans()` from Task 7).
- Produces, each `execute` gated by its policy ability and transactional:
  - `AssessCondition::execute(User $actor, BookCopy $copy, CopyCondition $condition, ?string $note = null, ?string $photoUrl = null): ConditionAssessment` — inserts the history row (`loan_id` null — BR §5.4: "a manager may assess a copy at any time, not only at return"; 1c's `ReceiveReturn` writes the loan-carrying ones) **and** updates `book_copies.condition`/`condition_note` (the column is "the current judgement", the table is the history — BR §11 lists assessments among the never-deleted). Consults **no** transition table and moves **no** copy: a condition is not a state (BR §9). Audit `copy.condition_assessed` with before/after condition + note.
  - `RetireCopy::execute(User $actor, BookCopy $copy, string $reason): void` — `RuleViolated('retire_reason_required')` on a blank reason **before** the state machine (turning the `book_copies_retired_has_reason` CHECK's errno 4025 into a named refusal — OPS §2); `CopyStateMachine::assert($copy->state, Retired)`; writes `state`, `retired_at` (Clock), `retired_reason` (trimmed); audit `copy.retired`.
  - `ReportCopyLost::execute(User $actor, BookCopy $copy, ?string $note = null): void` — `CopyStateMachine::assert($copy->state, Lost)` (Q3: only `on_loan`); writes `state = lost`, `lost_reported_at`; closes the copy's `active` loan in the same transaction (`status = lost`, `lost_reported_at`, `lost_reported_by`) — **two audit entries when a loan closes** (`copy.lost_reported` + `loan.lost`), because two things changed state (INV-8). The note has no column (BR §5.4 gives BookCopy no lost note) — it lives in the audit `after`.
  - `MarkCopyFound::execute(User $actor, BookCopy $copy, ?string $note = null): void` — `CopyStateMachine::assert($copy->state, Available)` refuses any non-lost copy with `not_lost` (the machine's `on_loan → available` arrow is real but the *command* additionally requires `state === lost`, exactly as the reference does — a return path is 1c's, not this command's); writes `state = available`, `lost_reported_at = null`. **The loan is not reopened** — BR §7.3 draws no arrow out of `lost` for a loan. Audit `copy.found`.
- The three Form Requests authorize their abilities (`assessCondition`, `retire`, and `CopyNoteRequest` — shared by report-lost and mark-found — checks nothing but shape; the controller authorizes per route since the two differ only in ability name). Rules: `condition` required + `in:` the six enum values; `reason` required string max 1000; `note` nullable string max 1000.

- [ ] **Step 1: Write the failing test**

Create `tests/Feature/Catalogue/CopyStateTest.php`:

```php
<?php

use App\Actions\Catalogue\AssessCondition;
use App\Actions\Catalogue\CreateBook;
use App\Actions\Catalogue\MarkCopyFound;
use App\Actions\Catalogue\ReportCopyLost;
use App\Actions\Catalogue\RetireCopy;
use App\Enums\CopyCondition;
use App\Exceptions\RuleViolated;
use App\Models\AuditLog;
use App\Models\Bookshelf;
use App\Models\Category;
use App\Models\ConditionAssessment;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Carbon\Carbon;
use Illuminate\Auth\Access\AuthorizationException;

afterEach(fn () => Carbon::setTestNow());

function copyStateFixture(string $role = 'manager'): array
{
    // Built to be callable twice in one test ('a lost copy may be written
    // off' does): unbind any earlier tenant first (a bound shelf refuses a
    // foreign membership create), take the factory's own random slug (a
    // fixed one trips bookshelves_slug_unique on the second build), and
    // firstOrCreate the category (its slug unique is plain).
    app(TenantContext::class)->clear();
    $shelf = Bookshelf::factory()->create(['settings' => []]);
    $user = User::factory()->create();
    $membership = Membership::factory()->for($shelf)->create([
        'user_id' => $user->id, 'role' => $role, 'status' => 'active',
    ]);
    Category::query()->firstOrCreate(['slug' => 'truyen-thieu-nhi'], ['name' => 'Truyện thiếu nhi']);
    app(TenantContext::class)->set($shelf, $membership);
    test()->actingAs($user);

    $book = app(CreateBook::class)->execute($user, [
        'title' => 'Dế Mèn Phiêu Lưu Ký', 'author' => 'Tô Hoài',
        'category_slug' => 'truyen-thieu-nhi', 'copy_count' => 1,
    ]);

    return [$shelf, $user, $book, $book->copies->first()];
}

function copyStateLoanFor($copy, User $borrower): Loan
{
    return Loan::query()->create([
        'copy_id' => $copy->id, 'book_id' => $copy->book_id,
        'borrower_id' => $borrower->id, 'lent_by' => $borrower->id,
        'due_on' => '2026-09-10', 'status' => 'active',
    ]);
}

it('a manager may assess a copy at any time, and history plus current judgement both move', function () {
    [, $user, , $copy] = copyStateFixture();

    $assessment = app(AssessCondition::class)->execute($user, $copy, CopyCondition::Torn, 'rách gáy');

    expect($assessment->loan_id)->toBeNull()
        ->and($assessment->assessed_by)->toBe($user->id)
        ->and($copy->fresh()->condition)->toBe(CopyCondition::Torn)
        ->and($copy->fresh()->condition_note)->toBe('rách gáy')
        ->and($copy->fresh()->state->value)->toBe('available');   // a condition is not a state

    $entry = AuditLog::query()->where('action', 'copy.condition_assessed')->firstOrFail();
    expect($entry->before['condition'])->toBe('perfect')
        ->and($entry->after['condition'])->toBe('torn');
});

it('assessments accumulate — BR §11: never deleted, a table not a column', function () {
    [, $user, , $copy] = copyStateFixture();

    app(AssessCondition::class)->execute($user, $copy, CopyCondition::Worn);
    app(AssessCondition::class)->execute($user, $copy, CopyCondition::Torn);

    expect(ConditionAssessment::query()->where('copy_id', $copy->id)->count())->toBe(2);
});

it('retiring records the reason the CHECK constraint requires', function () {
    [, $user, , $copy] = copyStateFixture();
    Carbon::setTestNow(Carbon::parse('2026-08-27 07:00:00', 'UTC'));

    app(RetireCopy::class)->execute($user, $copy, '  mất trang quá nhiều  ');

    $fresh = $copy->fresh();
    expect($fresh->state->value)->toBe('retired')
        ->and($fresh->retired_reason)->toBe('mất trang quá nhiều')
        ->and($fresh->retired_at->toDateTimeString())->toBe('2026-08-27 07:00:00');

    $entry = AuditLog::query()->where('action', 'copy.retired')->firstOrFail();
    expect($entry->before['state'])->toBe('available')
        ->and($entry->after['reason'])->toBe('mất trang quá nhiều');
});

it('retiring with no reason is a named failure, not a check-constraint violation', function () {
    [, $user, , $copy] = copyStateFixture();

    expect(fn () => app(RetireCopy::class)->execute($user, $copy, '   '))
        ->toThrow(RuleViolated::class, 'retire_reason_required');

    expect($copy->fresh()->state->value)->toBe('available');
});

it('a copy on loan cannot be retired, and is told what to do instead', function () {
    [, $user, , $copy] = copyStateFixture();
    $copy->update(['state' => 'on_loan']);

    expect(fn () => app(RetireCopy::class)->execute($user, $copy, 'hỏng'))
        ->toThrow(RuleViolated::class, 'copy_on_loan');
});

it('a lost copy may be written off; a held one may not', function () {
    [, $user, , $copy] = copyStateFixture();

    $copy->update(['state' => 'lost']);
    app(RetireCopy::class)->execute($user, $copy, 'không tìm lại được');
    expect($copy->fresh()->state->value)->toBe('retired');

    [, $user2, , $copy2] = copyStateFixture();
    $copy2->update(['state' => 'held']);
    expect(fn () => app(RetireCopy::class)->execute($user2, $copy2, 'x'))
        ->toThrow(RuleViolated::class, 'copy_not_available');
});

it('reporting an on-loan copy lost closes its loan in the same transaction, with two audit entries', function () {
    [, $user, , $copy] = copyStateFixture();
    $copy->update(['state' => 'on_loan']);
    $loan = copyStateLoanFor($copy, $user);
    Carbon::setTestNow(Carbon::parse('2026-08-27 08:00:00', 'UTC'));

    app(ReportCopyLost::class)->execute($user, $copy, 'em bảo để quên trên xe buýt');

    $freshCopy = $copy->fresh();
    $freshLoan = $loan->fresh();
    expect($freshCopy->state->value)->toBe('lost')
        ->and($freshCopy->lost_reported_at->toDateTimeString())->toBe('2026-08-27 08:00:00')
        ->and($freshLoan->status->value)->toBe('lost')
        ->and($freshLoan->lost_reported_by)->toBe($user->id);

    expect(AuditLog::query()->where('action', 'copy.lost_reported')->count())->toBe(1)
        ->and(AuditLog::query()->where('action', 'loan.lost')->count())->toBe(1);

    $copyEntry = AuditLog::query()->where('action', 'copy.lost_reported')->firstOrFail();
    expect($copyEntry->after['note'])->toBe('em bảo để quên trên xe buýt');
});

it('Q3: an available copy cannot be reported lost', function () {
    [, $user, , $copy] = copyStateFixture();

    expect(fn () => app(ReportCopyLost::class)->execute($user, $copy))
        ->toThrow(RuleViolated::class, 'copy_not_on_loan');
});

it('an already-lost or already-retired copy says which, not just no', function () {
    [, $user, , $copy] = copyStateFixture();

    $copy->update(['state' => 'lost']);
    expect(fn () => app(ReportCopyLost::class)->execute($user, $copy))
        ->toThrow(RuleViolated::class, 'already_lost');

    $copy->update(['state' => 'retired', 'retired_reason' => 'x']);
    expect(fn () => app(ReportCopyLost::class)->execute($user, $copy))
        ->toThrow(RuleViolated::class, 'already_retired');
});

it('a lost copy that turns up goes back to available, and its loan is not reopened', function () {
    [, $user, , $copy] = copyStateFixture();
    $copy->update(['state' => 'on_loan']);
    $loan = copyStateLoanFor($copy, $user);
    app(ReportCopyLost::class)->execute($user, $copy);

    app(MarkCopyFound::class)->execute($user, $copy, 'tìm thấy sau ghế nhà thờ');

    $freshCopy = $copy->fresh();
    expect($freshCopy->state->value)->toBe('available')
        ->and($freshCopy->lost_reported_at)->toBeNull()
        ->and($loan->fresh()->status->value)->toBe('lost');   // history stays

    $entry = AuditLog::query()->where('action', 'copy.found')->firstOrFail();
    expect($entry->before['state'])->toBe('lost')
        ->and($entry->after['note'])->toBe('tìm thấy sau ghế nhà thờ');
});

it('marking a copy found when it is not lost says so', function () {
    [, $user, , $copy] = copyStateFixture();

    expect(fn () => app(MarkCopyFound::class)->execute($user, $copy))
        ->toThrow(RuleViolated::class, 'not_lost');

    $copy->update(['state' => 'on_loan']);
    expect(fn () => app(MarkCopyFound::class)->execute($user, $copy))
        ->toThrow(RuleViolated::class, 'not_lost');
});

it('a reader may not touch any of the four', function () {
    [$shelf, $manager, , $copy] = copyStateFixture();
    app(TenantContext::class)->clear();
    $reader = User::factory()->create();
    $readerMembership = Membership::factory()->for($shelf)->create([
        'user_id' => $reader->id, 'role' => 'reader', 'status' => 'active',
    ]);
    app(TenantContext::class)->set($shelf, $readerMembership);
    test()->actingAs($reader);

    expect(fn () => app(AssessCondition::class)->execute($reader, $copy, CopyCondition::Worn))
        ->toThrow(AuthorizationException::class);
    expect(fn () => app(RetireCopy::class)->execute($reader, $copy, 'x'))
        ->toThrow(AuthorizationException::class);
    expect(fn () => app(ReportCopyLost::class)->execute($reader, $copy))
        ->toThrow(AuthorizationException::class);
    expect(fn () => app(MarkCopyFound::class)->execute($reader, $copy))
        ->toThrow(AuthorizationException::class);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `make test FILTER=CopyStateTest` — Expected: FAIL (class not found)

- [ ] **Step 3: Write the four Actions**

`app/Actions/Catalogue/AssessCondition.php`:

```php
<?php

namespace App\Actions\Catalogue;

use App\Enums\CopyCondition;
use App\Models\BookCopy;
use App\Models\ConditionAssessment;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\Clock;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * Records a manager's judgement of a copy's physical state at a point in
 * time — port of assess-condition.ts. loan_id is null here; 1c's
 * ReceiveReturn writes the loan-carrying assessments. Consults no
 * transition table and moves no copy: a condition is not a state (BR §9 —
 * "`lost` is deliberately absent, because it is a copy *state*"). It does
 * update book_copies.condition, because that column is the current
 * judgement while condition_assessments is the history — and BR §11 lists
 * assessments among the never-deleted, which is why the history is a
 * table and not a column.
 */
final class AssessCondition
{
    public function __construct(
        private Clock $clock,
        private AuditRecorder $audit,
    ) {}

    public function execute(User $actor, BookCopy $copy, CopyCondition $condition, ?string $note = null, ?string $photoUrl = null): ConditionAssessment
    {
        Gate::forUser($actor)->authorize('assessCondition', $copy);

        return DB::transaction(function () use ($actor, $copy, $condition, $note, $photoUrl): ConditionAssessment {
            $before = ['condition' => $copy->condition->value, 'conditionNote' => $copy->condition_note];

            $assessment = ConditionAssessment::query()->create([
                'copy_id' => $copy->id,
                'loan_id' => null,
                'assessed_by' => $actor->id,
                'condition' => $condition,
                'note' => $note,
                'photo_url' => $photoUrl,
                'assessed_at' => $this->clock->now(),
            ]);

            $copy->update(['condition' => $condition, 'condition_note' => $note]);

            $this->audit->record('copy.condition_assessed', 'copy', $copy->id, $before, [
                'condition' => $condition->value,
                'conditionNote' => $note,
            ]);

            return $assessment;
        });
    }
}
```

`app/Actions/Catalogue/RetireCopy.php`:

```php
<?php

namespace App\Actions\Catalogue;

use App\Enums\CopyState;
use App\Exceptions\RuleViolated;
use App\Models\BookCopy;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\Catalogue\CopyStateMachine;
use App\Support\Clock;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * Permanently withdraws a copy (BR §7.1: available → retired, lost →
 * retired) — port of retire-copy.ts. RETIREMENT IS NOT DELETION (BR §11):
 * this is a domain state with a required reason, recording something that
 * actually happened; deleted_at undoes mistakes. The blank-reason check
 * runs before the state machine so book_copies_retired_has_reason's errno
 * 4025 becomes a named refusal instead of a driver error (OPS §2). The
 * on_loan refusal comes from the transition table, which names it
 * copy_on_loan specifically — a copy someone is still holding would be a
 * book the system lost track of if this succeeded.
 */
final class RetireCopy
{
    public function __construct(
        private Clock $clock,
        private AuditRecorder $audit,
    ) {}

    public function execute(User $actor, BookCopy $copy, string $reason): void
    {
        Gate::forUser($actor)->authorize('retire', $copy);

        if (trim($reason) === '') {
            throw new RuleViolated('retire_reason_required');
        }

        DB::transaction(function () use ($copy, $reason): void {
            CopyStateMachine::assert($copy->state, CopyState::Retired);

            $before = ['state' => $copy->state->value];

            $copy->update([
                'state' => CopyState::Retired,
                'retired_at' => $this->clock->now(),
                'retired_reason' => trim($reason),
            ]);

            $this->audit->record('copy.retired', 'copy', $copy->id, $before, [
                'state' => 'retired',
                'reason' => trim($reason),
            ]);
        });
    }
}
```

`app/Actions/Catalogue/ReportCopyLost.php`:

```php
<?php

namespace App\Actions\Catalogue;

use App\Enums\CopyState;
use App\Models\BookCopy;
use App\Models\Loan;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\Catalogue\CopyStateMachine;
use App\Support\Clock;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * Marks a copy lost and closes the loan it was out on — port of
 * report-copy-lost.ts. Q3, decided in the reference and kept: only an
 * on_loan copy (BR §7.1 draws exactly one arrow into lost); the refusal
 * comes from the transition table, so widening it later is a line there
 * plus a test, nothing here. OPS §4.1: the active loan is closed as lost,
 * "not left dangling as active" — a second state transition, so INV-8
 * earns it a second audit entry. The note has no column (BR §5.4 gives
 * BookCopy a time reported lost and no lost note); it lives in the audit
 * entry, where a manager reading the history will look anyway.
 *
 * In 1c this command gains a second UI entry point — "Bạn đọc báo làm
 * mất" inside receive-return — with this contract unchanged.
 */
final class ReportCopyLost
{
    public function __construct(
        private Clock $clock,
        private AuditRecorder $audit,
    ) {}

    public function execute(User $actor, BookCopy $copy, ?string $note = null): void
    {
        Gate::forUser($actor)->authorize('reportLost', $copy);

        DB::transaction(function () use ($actor, $copy, $note): void {
            CopyStateMachine::assert($copy->state, CopyState::Lost);

            $before = ['state' => $copy->state->value];
            $now = $this->clock->now();

            $copy->update(['state' => CopyState::Lost, 'lost_reported_at' => $now]);

            $this->audit->record('copy.lost_reported', 'copy', $copy->id, $before, [
                'state' => 'lost',
                'note' => $note,
            ]);

            $loan = $copy->loans()->where('status', 'active')->first();

            if ($loan instanceof Loan) {
                $loan->update([
                    'status' => 'lost',
                    'lost_reported_at' => $now,
                    'lost_reported_by' => $actor->id,
                ]);

                $this->audit->record('loan.lost', 'loan', $loan->id,
                    ['status' => 'active'], ['status' => 'lost']);
            }
        });
    }
}
```

(`$copy->loans()->where('status', 'active')->first()` needs no `ORDER BY` defence: `loans_one_active_per_copy` makes at most one active loan per copy a database guarantee, so the set is zero-or-one by construction.)

`app/Actions/Catalogue/MarkCopyFound.php`:

```php
<?php

namespace App\Actions\Catalogue;

use App\Enums\CopyState;
use App\Exceptions\RuleViolated;
use App\Models\BookCopy;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\Catalogue\CopyStateMachine;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * A lost copy turns up again (BR §7.1: lost → available; BR §3's "a book
 * reported lost is found months later") — port of mark-copy-found.ts.
 * The machine also allows on_loan → available (the return path), so this
 * command additionally requires the copy actually BE lost — a return is
 * 1c's ReceiveReturn, not this. THE LOAN IS NOT REOPENED: BR §7.3 draws
 * no arrow out of lost for a loan, and INV-11 forbids deleting one. The
 * copy comes back; what happened to it stays on the record.
 */
final class MarkCopyFound
{
    public function __construct(private AuditRecorder $audit) {}

    public function execute(User $actor, BookCopy $copy, ?string $note = null): void
    {
        Gate::forUser($actor)->authorize('markFound', $copy);

        DB::transaction(function () use ($copy, $note): void {
            if ($copy->state !== CopyState::Lost) {
                throw new RuleViolated('not_lost');
            }

            CopyStateMachine::assert($copy->state, CopyState::Available);

            $copy->update(['state' => CopyState::Available, 'lost_reported_at' => null]);

            $this->audit->record('copy.found', 'copy', $copy->id,
                ['state' => 'lost'],
                ['state' => 'available', 'note' => $note],
            );
        });
    }
}
```

- [ ] **Step 4: Write the three Form Requests**

`app/Http/Requests/Catalogue/AssessConditionRequest.php`:

```php
<?php

namespace App\Http\Requests\Catalogue;

use App\Enums\CopyCondition;
use App\Models\BookCopy;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;

class AssessConditionRequest extends FormRequest
{
    public function authorize(): bool
    {
        $copy = $this->route('bookCopy');

        return $copy instanceof BookCopy && Gate::allows('assessCondition', $copy);
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'condition' => ['required', Rule::enum(CopyCondition::class)],
            'note' => ['nullable', 'string', 'max:1000'],
        ];
    }
}
```

`app/Http/Requests/Catalogue/RetireCopyRequest.php`:

```php
<?php

namespace App\Http\Requests\Catalogue;

use App\Models\BookCopy;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

class RetireCopyRequest extends FormRequest
{
    public function authorize(): bool
    {
        $copy = $this->route('bookCopy');

        return $copy instanceof BookCopy && Gate::allows('retire', $copy);
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'reason' => ['required', 'string', 'max:1000'],
        ];
    }
}
```

`app/Http/Requests/Catalogue/CopyNoteRequest.php`:

```php
<?php

namespace App\Http\Requests\Catalogue;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Shared by report-lost and mark-found, which differ only in the policy
 * ability — the controller authorizes each route by name (Task 12), so
 * this request validates shape only.
 */
class CopyNoteRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;   // the controller's Gate::authorize is the gate
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'note' => ['nullable', 'string', 'max:1000'],
        ];
    }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `make test FILTER=CopyStateTest` — Expected: PASS
Run: `make lint && make analyse` — Expected: clean

- [ ] **Step 6: Commit**

```bash
git add app/Actions/Catalogue app/Http/Requests/Catalogue tests/Feature/Catalogue/CopyStateTest.php
git commit -m "feat: copy-state commands — assess, retire, report lost with loan closure, mark found"
```

---

### Task 10: The manager's queries — books list, book detail, book-for-edit, lost copies

**Files:**
- Create: `app/Queries/Concerns/CountsCopies.php`
- Create: `app/Queries/BooksListQuery.php`
- Create: `app/Queries/ManagerBookDetailQuery.php`
- Create: `app/Queries/BookForEditQuery.php`
- Create: `app/Queries/LostCopiesQuery.php`
- Test: `tests/Feature/Catalogue/ManagerQueriesTest.php`
- Test: `tests/Feature/Catalogue/LostCopiesTest.php`

**Read first:** `old_next/tests/domain/catalogue/manager-queries.test.ts` and `lost-copies.test.ts` (the specifications), then `get-books-list.ts`, `get-book-detail-manager.ts`, `get-book-for-edit.ts`, `get-lost-copies.ts`.

**Interfaces:**
- Consumes: `Availability::derive(int $available, int $onLoan, int $held, int $lost, bool $hasRetired): string` (Task 2), `Fold::fold(string): string`, `Clock::now(): CarbonImmutable` / `::today(): string`, models. Queries take the bound tenant for granted (the `tenant` middleware in requests, `TenantHarness::actAs()` in tests) — authorization is the **route's** job (`role:manager` + policies in Task 12); a query class holds no gate, because under this architecture a query reached without its route's gate is already a bug the route tests catch. (The reference embedded `requireManager` in each query because its queries *were* the transport surface; here the controller is.)
- Produces:
  - `CountsCopies` (trait) — `borrowable(): \Closure` — BR §8's "available and no unexpired hold references it", the `copies_borrowable` view as a predicate (divergence 3) — and `withCopyCounts(Builder $query): Builder` adding `copies_total` (live, not retired, **not lost** — the fix-wave's "copies_total must mean the same thing everywhere it is emitted"), `available_count` (borrowable), `on_loan_count`, `held_count`, `lost_count`, `retired_count`, `code_min`, `code_max`; plus `availabilityFor(Book $book): string` and `codesFor(Book $book): string` (the `DT-0215 – DT-0217` display range) mapping those aggregates.
  - `BooksListQuery::run(array $input): array` — `$input` = `array{q?: ?string, category?: ?string, sort?: ?string, page?: int, per_page?: int}`; returns `array{rows: list<array<string, mixed>>, page: int, pageCount: int, total: int}`. **No `is_published` filter** — a draft is exactly what this list exists to find. Folded substring match over `title_folded`/`author_folded`; a query that folds to nothing returns nothing, not the whole shelf (M7). Sort `title` → `title_folded`; default `recent` → `created_at` desc; **`slug` always ends the order** — `created_at` is one instant for every book of a bulk load, and a `LIMIT`/`OFFSET` page over a non-total order shows some rows twice and skips others (IMPORTANT 5; the reference measured 231 unique of 300).
  - `ManagerBookDetailQuery::run(Book $book): array` — `array{book: array, onLoan: int, copies: list<array>, conditionHistory: list<array>, loanHistory: list<array>}`. Copies include retired ones with their reason (a manager's page shows them; a reader's hides them), each with holder name + due date + computed `isOverdue` when out, and the donor resolved: a member donor's **name** (via membership → user), a free-text donor as typed. Loan history keyed by `loans.book_id`, not through the copy — it survives the copy being retired (DB §4.5's reason, restated in the reference).
  - `BookForEditQuery::run(Book $book): array` — exactly the fields the edit form round-trips (`category_slug`, not the joined name; no counts, no availability), **no `is_published` filter** — a manager must reach a draft *before* publishing it, which is when they are most likely to be correcting it.
  - `LostCopiesQuery::rows(): list<array>` and `count(): int` — state `lost`, live copy, live book; `lastBorrowerName` from the most recent `lost` loan (a copy can be lost, found, lent and lost again — `ORDER BY lost_reported_at DESC` inside the subquery, never a bare `LIMIT 1`), **name and no phone** (BR:574 asks for neither; the way back is `MarkCopyFound`, not a call); ordered newest-report-first, nulls last, `code` ending the order (unique per shelf — total). `count()` uses the same predicate; the test asserts the two agree.

- [ ] **Step 1: Write the failing tests**

Create `tests/Feature/Catalogue/ManagerQueriesTest.php`:

```php
<?php

use App\Actions\Catalogue\CreateBook;
use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\BorrowRequest;
use App\Models\Category;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\User;
use App\Queries\BookForEditQuery;
use App\Queries\BooksListQuery;
use App\Queries\ManagerBookDetailQuery;
use App\Support\TenantContext;
use Carbon\Carbon;

afterEach(fn () => Carbon::setTestNow());

function mgrFixture(): array
{
    $shelf = Bookshelf::factory()->create(['slug' => 'dong-thap', 'settings' => []]);
    $user = User::factory()->create();
    $membership = Membership::factory()->for($shelf)->create([
        'user_id' => $user->id, 'role' => 'manager', 'status' => 'active',
    ]);
    Category::factory()->create(['name' => 'Truyện thiếu nhi', 'slug' => 'truyen-thieu-nhi']);
    Category::factory()->create(['name' => 'Giáo lý', 'slug' => 'giao-ly']);
    app(TenantContext::class)->set($shelf, $membership);
    test()->actingAs($user);

    return [$shelf, $user];
}

function mgrBook(User $user, string $title, array $over = []): Book
{
    return app(CreateBook::class)->execute($user, array_merge([
        'title' => $title, 'author' => 'Tô Hoài',
        'category_slug' => 'truyen-thieu-nhi', 'copy_count' => 1,
    ], $over));
}

it('sorts by title alphabetically in Vietnamese, not in byte order', function () {
    [, $user] = mgrFixture();
    mgrBook($user, 'Tuổi Thơ Dữ Dội');
    mgrBook($user, 'Đất Rừng Phương Nam');   // Đ begins 0xC4 — byte order puts it last
    mgrBook($user, 'Anh Em Nhà Bồ Câu');

    $rows = app(BooksListQuery::class)->run(['sort' => 'title'])['rows'];

    expect(array_column($rows, 'title'))
        ->toBe(['Anh Em Nhà Bồ Câu', 'Đất Rừng Phương Nam', 'Tuổi Thơ Dữ Dội']);
});

it('shows a draft the reader catalogue hides, flagged as such', function () {
    [, $user] = mgrFixture();
    mgrBook($user, 'Bản Nháp', ['is_published' => false]);

    $rows = app(BooksListQuery::class)->run([])['rows'];

    expect($rows)->toHaveCount(1)
        ->and($rows[0]['isPublished'])->toBeFalse();
});

it('filters by folded query and by category slug', function () {
    [, $user] = mgrFixture();
    mgrBook($user, 'Dế Mèn Phiêu Lưu Ký');
    mgrBook($user, 'Hoàng Tử Bé', ['category_slug' => 'giao-ly']);

    expect(array_column(app(BooksListQuery::class)->run(['q' => 'de men'])['rows'], 'title'))
        ->toBe(['Dế Mèn Phiêu Lưu Ký'])
        ->and(array_column(app(BooksListQuery::class)->run(['category' => 'giao-ly'])['rows'], 'title'))
        ->toBe(['Hoàng Tử Bé']);
});

it('M7: a garbage query returns nothing, not the whole shelf', function () {
    [, $user] = mgrFixture();
    mgrBook($user, 'Dế Mèn Phiêu Lưu Ký');

    $page = app(BooksListQuery::class)->run(['q' => '%%%']);

    expect($page['rows'])->toBe([])
        ->and($page['total'])->toBe(0);
});

it('M8: reports none, not retired, for a title with zero live copies', function () {
    [, $user] = mgrFixture();
    $book = mgrBook($user, 'Sách Không Bản');
    $book->copies->first()->delete();   // soft-delete the only copy

    $rows = app(BooksListQuery::class)->run([])['rows'];

    expect($rows[0]['availability'])->toBe('none');
});

it('shows the code range under the title', function () {
    [, $user] = mgrFixture();
    mgrBook($user, 'Dế Mèn Phiêu Lưu Ký', ['copy_count' => 3]);

    $rows = app(BooksListQuery::class)->run([])['rows'];

    expect($rows[0]['codes'])->toBe('DT-0001 – DT-0003');
});

it('copiesTotal excludes lost and retired, list and detail agreeing', function () {
    [, $user] = mgrFixture();
    $book = mgrBook($user, 'Dế Mèn Phiêu Lưu Ký', ['copy_count' => 3]);
    $copies = $book->copies;
    $copies[0]->update(['state' => 'lost']);
    $copies[1]->update(['state' => 'retired', 'retired_reason' => 'hỏng']);

    $listRow = app(BooksListQuery::class)->run([])['rows'][0];
    $detail = app(ManagerBookDetailQuery::class)->run($book);

    expect($listRow['copiesTotal'])->toBe(1)
        ->and($detail['book']['copiesTotal'])->toBe(1)
        // …but the copies table still lists every one, retired included,
        // with its reason — a manager's page, unlike a reader's.
        ->and($detail['copies'])->toHaveCount(3)
        ->and(collect($detail['copies'])->firstWhere('state', 'retired')['retiredReason'])->toBe('hỏng');
});

it('manager detail carries per-copy holder and computed overdue', function () {
    [, $user] = mgrFixture();
    $borrower = User::factory()->create(['full_name' => 'Nguyễn Văn Bình']);
    $book = mgrBook($user, 'Dế Mèn Phiêu Lưu Ký');
    $copy = $book->copies->first();
    $copy->update(['state' => 'on_loan']);
    Loan::query()->create([
        'copy_id' => $copy->id, 'book_id' => $book->id,
        'borrower_id' => $borrower->id, 'lent_by' => $user->id,
        'due_on' => '2026-08-20', 'status' => 'active',
    ]);
    Carbon::setTestNow(Carbon::parse('2026-08-27 03:00:00', 'UTC'));   // past due — computed, never stored

    $detail = app(ManagerBookDetailQuery::class)->run($book);

    expect($detail['copies'][0]['holderName'])->toBe('Nguyễn Văn Bình')
        ->and($detail['copies'][0]['dueOn'])->toBe('2026-08-20')
        ->and($detail['copies'][0]['isOverdue'])->toBeTrue()
        ->and($detail['onLoan'])->toBe(1);
});

it('a member donor resolves to their name; a free-text one renders as typed', function () {
    [$shelf, $user] = mgrFixture();
    $managerMembership = app(TenantContext::class)->membership();
    $donorUser = User::factory()->create(['full_name' => 'Phạm Thị Cúc']);
    app(TenantContext::class)->clear();
    $donor = Membership::factory()->for($shelf)->create([
        'user_id' => $donorUser->id, 'role' => 'reader', 'status' => 'active',
    ]);
    app(TenantContext::class)->set($shelf, $managerMembership);

    $memberDonated = mgrBook($user, 'Sách Được Tặng', ['donor_membership_id' => $donor->id]);
    $textDonated = mgrBook($user, 'Sách Tặng Tay', ['donor_name' => 'bác Hoà']);

    $first = app(ManagerBookDetailQuery::class)->run($memberDonated)['copies'][0];
    $second = app(ManagerBookDetailQuery::class)->run($textDonated)['copies'][0];

    expect($first['acquiredFromMembershipName'])->toBe('Phạm Thị Cúc')
        ->and($first['acquiredFrom'])->toBeNull()
        ->and($second['acquiredFrom'])->toBe('bác Hoà')
        ->and($second['acquiredFromMembershipName'])->toBeNull();
});

it('loan history survives the copy being retired', function () {
    [, $user] = mgrFixture();
    $borrower = User::factory()->create(['full_name' => 'Nguyễn Văn Bình']);
    $book = mgrBook($user, 'Dế Mèn Phiêu Lưu Ký');
    $copy = $book->copies->first();
    Loan::query()->create([
        'copy_id' => $copy->id, 'book_id' => $book->id,
        'borrower_id' => $borrower->id, 'lent_by' => $user->id,
        'due_on' => '2026-08-01', 'status' => 'returned',
        'return_condition' => 'perfect', 'returned_at' => now(),
    ]);
    $copy->update(['state' => 'retired', 'retired_reason' => 'cũ nát']);

    $history = app(ManagerBookDetailQuery::class)->run($book)['loanHistory'];

    expect($history)->toHaveCount(1)
        ->and($history[0]['borrowerName'])->toBe('Nguyễn Văn Bình')
        ->and($history[0]['copyCode'])->toBe('DT-0001')
        ->and($history[0]['returnCondition'])->toBe('perfect');
});

it('book-for-edit reaches a draft and round-trips the category slug', function () {
    [, $user] = mgrFixture();
    $draft = mgrBook($user, 'Bản Nháp', ['is_published' => false, 'publisher' => 'NXB Trẻ']);

    $form = app(BookForEditQuery::class)->run($draft);

    expect($form['categorySlug'])->toBe('truyen-thieu-nhi')
        ->and($form['isPublished'])->toBeFalse()
        ->and($form['publisher'])->toBe('NXB Trẻ')
        ->and(array_key_exists('copiesTotal', $form))->toBeFalse();
});

it('paging the manager list loses no book and repeats none', function () {
    // IMPORTANT 5: every book of a bulk load shares one created_at (a fixed
    // test clock reproduces the ordinary case), so the order must be total
    // or LIMIT/OFFSET pages drop and duplicate rows. 9 books, pageSize 4.
    Carbon::setTestNow(Carbon::parse('2026-08-27 03:00:00', 'UTC'));
    [, $user] = mgrFixture();
    foreach (range(1, 9) as $i) {
        mgrBook($user, "Sách Số {$i}");
    }

    foreach (['recent', 'title'] as $sort) {
        $seen = [];
        foreach ([1, 2, 3] as $page) {
            $result = app(BooksListQuery::class)->run(['sort' => $sort, 'page' => $page, 'per_page' => 4]);
            foreach ($result['rows'] as $row) {
                $seen[] = $row['slug'];
            }
        }
        expect(count($seen))->toBe(9, "sort {$sort}: lost or repeated a row across pages")
            ->and(count(array_unique($seen)))->toBe(9, "sort {$sort}: repeated a row");
    }
});

it('one shelf\'s list never contains another\'s', function () {
    [$shelf, $user] = mgrFixture();
    mgrBook($user, 'Dế Mèn Phiêu Lưu Ký');

    app(TenantContext::class)->clear();
    $other = Bookshelf::factory()->create(['slug' => 'can-tho', 'settings' => []]);
    $otherUser = User::factory()->create();
    $otherMembership = Membership::factory()->for($other)->create([
        'user_id' => $otherUser->id, 'role' => 'manager', 'status' => 'active',
    ]);
    app(TenantContext::class)->set($other, $otherMembership);

    expect(app(BooksListQuery::class)->run([])['total'])->toBe(0);
});
```

Create `tests/Feature/Catalogue/LostCopiesTest.php`:

```php
<?php

use App\Actions\Catalogue\CreateBook;
use App\Actions\Catalogue\MarkCopyFound;
use App\Actions\Catalogue\ReportCopyLost;
use App\Actions\Catalogue\RetireCopy;
use App\Models\Book;
use App\Models\Bookshelf;
use App\Models\Category;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\User;
use App\Queries\LostCopiesQuery;
use App\Support\TenantContext;
use Carbon\Carbon;

afterEach(fn () => Carbon::setTestNow());

function lostFixture(): array
{
    $shelf = Bookshelf::factory()->create(['slug' => 'dong-thap', 'settings' => []]);
    $user = User::factory()->create();
    $membership = Membership::factory()->for($shelf)->create([
        'user_id' => $user->id, 'role' => 'manager', 'status' => 'active',
    ]);
    Category::factory()->create(['name' => 'Truyện thiếu nhi', 'slug' => 'truyen-thieu-nhi']);
    app(TenantContext::class)->set($shelf, $membership);
    test()->actingAs($user);

    return [$shelf, $user];
}

function lostBook(User $user, string $title, int $copies = 1): Book
{
    return app(CreateBook::class)->execute($user, [
        'title' => $title, 'author' => 'Tô Hoài',
        'category_slug' => 'truyen-thieu-nhi', 'copy_count' => $copies,
    ]);
}

it('a copy reported lost appears with its book and the holder the command closed out', function () {
    [, $user] = lostFixture();
    $borrower = User::factory()->create(['full_name' => 'Nguyễn Văn Bình']);
    $book = lostBook($user, 'Dế Mèn Phiêu Lưu Ký');
    $copy = $book->copies->first();
    $copy->update(['state' => 'on_loan']);
    Loan::query()->create([
        'copy_id' => $copy->id, 'book_id' => $book->id,
        'borrower_id' => $borrower->id, 'lent_by' => $user->id,
        'due_on' => '2026-09-10', 'status' => 'active',
    ]);

    app(ReportCopyLost::class)->execute($user, $copy);

    $rows = app(LostCopiesQuery::class)->rows();
    expect($rows)->toHaveCount(1)
        ->and($rows[0]['code'])->toBe('DT-0001')
        ->and($rows[0]['title'])->toBe('Dế Mèn Phiêu Lưu Ký')
        ->and($rows[0]['bookSlug'])->toBe('de-men-phieu-luu-ky')
        ->and($rows[0]['lastBorrowerName'])->toBe('Nguyễn Văn Bình')
        ->and(array_key_exists('phone', $rows[0]))->toBeFalse();   // name, no phone — BR:574
});

it('a copy lost with no loan behind it is listed with no name, not dropped', function () {
    [, $user] = lostFixture();
    $book = lostBook($user, 'Hoàng Tử Bé');
    $book->copies->first()->update(['state' => 'lost']);   // import shape: no loan, no report time

    $rows = app(LostCopiesQuery::class)->rows();
    expect($rows)->toHaveCount(1)
        ->and($rows[0]['lastBorrowerName'])->toBeNull()
        ->and($rows[0]['reportedAt'])->toBeNull();
});

it('only lost copies — never available, on loan or retired ones', function () {
    [, $user] = lostFixture();
    $book = lostBook($user, 'Dế Mèn Phiêu Lưu Ký', 4);
    [$available, $out, $retired, $lost] = $book->copies->all();
    $out->update(['state' => 'on_loan']);
    $retired->update(['state' => 'retired', 'retired_reason' => 'x']);
    $lost->update(['state' => 'lost']);

    $rows = app(LostCopiesQuery::class)->rows();
    expect(array_column($rows, 'copyId'))->toBe([$lost->id]);
});

it('the two exits BR §7.1 draws out of lost both empty this screen', function () {
    [, $user] = lostFixture();
    $book = lostBook($user, 'Dế Mèn Phiêu Lưu Ký', 2);
    [$first, $second] = $book->copies->all();
    $first->update(['state' => 'lost']);
    $second->update(['state' => 'lost']);

    app(MarkCopyFound::class)->execute($user, $first);
    app(RetireCopy::class)->execute($user, $second, 'không tìm lại được');

    expect(app(LostCopiesQuery::class)->rows())->toBe([])
        ->and(app(LostCopiesQuery::class)->count())->toBe(0);
});

it('the newest report is first, order total, missing report time last', function () {
    [, $user] = lostFixture();
    $book = lostBook($user, 'Dế Mèn Phiêu Lưu Ký', 3);
    [$a, $b, $c] = $book->copies->all();   // DT-0001..3
    $a->update(['state' => 'lost', 'lost_reported_at' => '2026-08-01 00:00:00']);
    $b->update(['state' => 'lost', 'lost_reported_at' => '2026-08-20 00:00:00']);
    $c->update(['state' => 'lost', 'lost_reported_at' => null]);

    $codes = array_column(app(LostCopiesQuery::class)->rows(), 'code');

    expect($codes)->toBe(['DT-0002', 'DT-0001', 'DT-0003']);
});

it('the count is the number of rows the list it labels shows', function () {
    [, $user] = lostFixture();
    $book = lostBook($user, 'Dế Mèn Phiêu Lưu Ký', 3);
    $book->copies[0]->update(['state' => 'lost']);
    $book->copies[1]->update(['state' => 'lost']);

    $query = app(LostCopiesQuery::class);
    expect($query->count())->toBe(count($query->rows()))->toBe(2);
});

it('a soft-deleted copy, and a soft-deleted book, leave both the count and the list', function () {
    [, $user] = lostFixture();
    $first = lostBook($user, 'Dế Mèn Phiêu Lưu Ký');
    $second = lostBook($user, 'Hoàng Tử Bé');
    $first->copies->first()->update(['state' => 'lost']);
    $second->copies->first()->update(['state' => 'lost']);

    $first->copies->first()->delete();
    $second->delete();

    expect(app(LostCopiesQuery::class)->rows())->toBe([])
        ->and(app(LostCopiesQuery::class)->count())->toBe(0);
});

it('the scoping is the global scope, not a where clause', function () {
    [$shelf, $user] = lostFixture();
    $book = lostBook($user, 'Dế Mèn Phiêu Lưu Ký');
    $book->copies->first()->update(['state' => 'lost']);

    app(TenantContext::class)->clear();
    $other = Bookshelf::factory()->create(['slug' => 'can-tho', 'settings' => []]);
    $otherUser = User::factory()->create();
    $otherMembership = Membership::factory()->for($other)->create([
        'user_id' => $otherUser->id, 'role' => 'manager', 'status' => 'active',
    ]);
    app(TenantContext::class)->set($other, $otherMembership);

    expect(app(LostCopiesQuery::class)->rows())->toBe([]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `make test FILTER=ManagerQueriesTest` — Expected: FAIL (class not found)
Run: `make test FILTER=LostCopiesTest` — Expected: FAIL

- [ ] **Step 3: Write `app/Queries/Concerns/CountsCopies.php`**

```php
<?php

namespace App\Queries\Concerns;

use App\Enums\CopyState;
use App\Models\Book;
use App\Support\Catalogue\Availability;
use App\Support\Clock;
use Closure;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Query\Builder as QueryBuilder;
use Illuminate\Support\Facades\DB;

/**
 * The copy aggregates every catalogue query shares. borrowable() is the
 * copies_borrowable view as a predicate (spec §4: views "encode read
 * shapes, not invariants"; divergence 3 in the plan header) — BR §8's "a
 * copy is borrowable when it is available and no unexpired hold references
 * it", evaluated against the injected clock at read time, so a hold that
 * lapsed a minute ago is already gone from the count with no job having
 * run. If a copies_available column ever appears in a migration, this is
 * the rule it broke.
 *
 * copies_total excludes BOTH retired and lost copies (post-review fix
 * wave item 7): "N bản trong tủ" must not claim a location for a book
 * that is, definitionally, not there — and it must mean the same thing on
 * the list, the reader detail and the manager detail.
 */
trait CountsCopies
{
    /** @return Closure(Builder<\App\Models\BookCopy>|QueryBuilder): void */
    protected function borrowable(): Closure
    {
        $now = app(Clock::class)->now();

        return function ($q) use ($now): void {
            $q->where('state', CopyState::Available)
                ->whereNotExists(function (QueryBuilder $sub) use ($now): void {
                    $sub->select(DB::raw(1))
                        ->from('borrow_requests')
                        ->whereColumn('borrow_requests.copy_id', 'book_copies.id')
                        ->where('borrow_requests.status', 'approved')
                        ->whereNull('borrow_requests.deleted_at')
                        ->where('borrow_requests.hold_expires_at', '>', $now);
                });
        };
    }

    /**
     * @param  Builder<Book>  $query
     * @return Builder<Book>
     */
    protected function withCopyCounts(Builder $query): Builder
    {
        return $query
            ->withCount([
                'copies as copies_total' => fn (Builder $q) => $q->whereNotIn('state', [CopyState::Retired, CopyState::Lost]),
                'copies as available_count' => fn (Builder $q) => tap($q, $this->borrowable()),
                'copies as on_loan_count' => fn (Builder $q) => $q->where('state', CopyState::OnLoan),
                'copies as held_count' => fn (Builder $q) => $q->where('state', CopyState::Held),
                'copies as lost_count' => fn (Builder $q) => $q->where('state', CopyState::Lost),
                'copies as retired_count' => fn (Builder $q) => $q->where('state', CopyState::Retired),
            ])
            ->withMin(['copies as code_min' => fn (Builder $q) => $q->where('state', '!=', CopyState::Retired)], 'code')
            ->withMax(['copies as code_max' => fn (Builder $q) => $q->where('state', '!=', CopyState::Retired)], 'code');
    }

    /**
     * The M8 ladder over the aggregates withCopyCounts() loaded.
     * getAttribute(), not magic property reads, for every aggregate alias
     * throughout this plan's queries: Larastan level 8 rejects the magic
     * form on columns no @property declares (verified in review — five
     * errors), and annotating the MODELS with query-shape aliases would
     * be worse than the explicit accessor.
     */
    protected function availabilityFor(Book $book): string
    {
        return Availability::derive(
            (int) $book->getAttribute('available_count'),
            (int) $book->getAttribute('on_loan_count'),
            (int) $book->getAttribute('held_count'),
            (int) $book->getAttribute('lost_count'),
            (int) $book->getAttribute('retired_count') > 0,
        );
    }

    /** 'DT-0215 – DT-0217', a single code plain, '' when copyless. */
    protected function codesFor(Book $book): string
    {
        $min = $book->getAttribute('code_min');
        $max = $book->getAttribute('code_max');

        return match (true) {
            $min === null => '',
            $min === $max => (string) $min,
            default => $min.' – '.$max,
        };
    }
}
```

- [ ] **Step 4: Write `app/Queries/BooksListQuery.php`**

```php
<?php

namespace App\Queries;

use App\Models\Book;
use App\Queries\Concerns\CountsCopies;
use App\Support\Fold;
use Illuminate\Database\Eloquent\Builder;

/**
 * GetBooksList (OPS §3.3) — getCatalogue with a manager's eyes: NO
 * is_published filter (a draft is exactly what this list exists to find),
 * and each row carries the shelf-mark range a volunteer reads off the
 * spines. Port of get-books-list.ts.
 *
 * Sort ends on slug, ALWAYS: created_at is one instant for every book of
 * a bulk load, LIMIT/OFFSET over a non-total order pages rows in and out
 * of existence (IMPORTANT 5 — measured 231 unique of 300 in the
 * reference), and a manager paging for the draft they just created can
 * page past it without it ever appearing.
 */
final class BooksListQuery
{
    use CountsCopies;

    /**
     * @param  array{q?: ?string, category?: ?string, sort?: ?string, page?: int, per_page?: int}  $input
     * @return array{rows: list<array<string, mixed>>, page: int, pageCount: int, total: int}
     */
    public function run(array $input): array
    {
        $q = trim((string) ($input['q'] ?? ''));
        $folded = Fold::fold($q);

        if ($q !== '' && $folded === '') {
            // M7: a punctuation-only query folds to '' — the LIKE pattern
            // would degenerate to '%%' and match the whole shelf. A
            // garbage query behaves like a blank one that matched nothing.
            return ['rows' => [], 'page' => 1, 'pageCount' => 1, 'total' => 0];
        }

        $query = $this->withCopyCounts(Book::query())
            ->with('category:id,name,slug')
            ->when($input['category'] ?? null, fn (Builder $b, string $slug) => $b
                ->whereHas('category', fn (Builder $c) => $c->where('slug', $slug)))
            ->when($q !== '', fn (Builder $b) => $b->where(fn (Builder $w) => $w
                ->where('title_folded', 'like', '%'.$folded.'%')
                ->orWhere('author_folded', 'like', '%'.$folded.'%')));

        // The reference's three-key order, kept whole under BOTH sorts:
        // fold(title) leads only under sort=title, created_at desc and
        // slug always follow — slug is what makes the order total
        // (IMPORTANT 5); never remove it.
        if (($input['sort'] ?? 'recent') === 'title') {
            $query->orderBy('title_folded');
        }
        $query->orderByDesc('created_at')->orderBy('slug');

        $paginator = $query->paginate(
            perPage: min(100, max(1, (int) ($input['per_page'] ?? 24))),
            page: max(1, (int) ($input['page'] ?? 1)),
        );

        return [
            'rows' => collect($paginator->items())->map(fn (Book $book) => [
                'bookId' => $book->id,
                'slug' => $book->slug,
                'title' => $book->title,
                'author' => $book->author,
                'coverUrl' => $book->cover_url,
                'category' => $book->category?->name,
                'copiesTotal' => (int) $book->getAttribute('copies_total'),
                'copiesAvailable' => (int) $book->getAttribute('available_count'),
                'availability' => $this->availabilityFor($book),
                'isPublished' => $book->is_published,
                'codes' => $this->codesFor($book),
            ])->values()->all(),
            'page' => $paginator->currentPage(),
            'pageCount' => max(1, $paginator->lastPage()),
            'total' => $paginator->total(),
        ];
    }
}
```

- [ ] **Step 5: Write `app/Queries/ManagerBookDetailQuery.php`**

```php
<?php

namespace App\Queries;

use App\Enums\CopyState;
use App\Models\Book;
use App\Models\ConditionAssessment;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\User;
use App\Queries\Concerns\CountsCopies;
use App\Support\Clock;
use Illuminate\Support\Collection;

/**
 * GetBookDetail, manager flavour (OPS §3.3) — port of
 * get-book-detail-manager.ts: the list row for one book, EVERY copy
 * (retired included, with reason — a reader's page hides those, a
 * manager's shows them), the condition-assessment history (BR §11: never
 * deleted) and the loan history — keyed by loans.book_id rather than
 * through the copy, precisely so it survives the copy being retired.
 *
 * The donor resolves through membership → user (a membership carries no
 * name of its own), straight to users rather than requiring a live
 * membership: a donor who has since left the shelf still gave the book.
 */
final class ManagerBookDetailQuery
{
    use CountsCopies;

    public function __construct(private Clock $clock) {}

    /** @return array{book: array<string, mixed>, onLoan: int, copies: list<array<string, mixed>>, conditionHistory: list<array<string, mixed>>, loanHistory: list<array<string, mixed>>} */
    public function run(Book $book): array
    {
        $withCounts = $this->withCopyCounts(Book::query())
            ->with('category:id,name,slug')
            ->findOrFail($book->id);

        $copies = $book->copies()->orderBy('code')->get();

        // The active loan per copy — at most one, by loans_one_active_per_copy.
        $activeLoans = Loan::query()
            ->whereIn('copy_id', $copies->pluck('id'))
            ->where('status', 'active')
            ->get()
            ->keyBy('copy_id');

        $borrowers = User::query()
            ->whereIn('id', $activeLoans->pluck('borrower_id'))
            ->get(['id', 'full_name'])
            ->keyBy('id');

        // Donor memberships → users, one query each. withTrashed on the
        // membership: BR §11 lets a membership be soft-deleted, and a
        // donor who left is still the donor.
        $donorMemberships = Membership::query()
            ->withTrashed()
            ->whereIn('id', $copies->pluck('acquired_from_membership_id')->filter())
            ->get()
            ->keyBy('id');
        $donorUsers = User::query()
            ->whereIn('id', $donorMemberships->pluck('user_id'))
            ->get(['id', 'full_name'])
            ->keyBy('id');

        $today = $this->clock->today();

        $copyRows = $copies->map(function ($copy) use ($activeLoans, $borrowers, $donorMemberships, $donorUsers, $today) {
            $loan = $activeLoans->get($copy->id);
            $donorMembership = $copy->acquired_from_membership_id !== null
                ? $donorMemberships->get($copy->acquired_from_membership_id)
                : null;

            return [
                'copyId' => $copy->id,
                'code' => $copy->code,
                'state' => $copy->state->value,
                'condition' => $copy->condition->value,
                'conditionNote' => $copy->condition_note,
                'acquiredOn' => $copy->acquired_on?->toDateString(),
                'acquiredFrom' => $copy->acquired_from,
                'acquiredFromMembershipId' => $copy->acquired_from_membership_id,
                'acquiredFromMembershipName' => $donorMembership !== null
                    ? $donorUsers->get($donorMembership->user_id)?->full_name
                    : null,
                'holderName' => $loan !== null ? $borrowers->get($loan->borrower_id)?->full_name : null,
                // due_on is NOT NULL — a nullsafe on it is itself a level-8
                // error; only the loan may be absent.
                'dueOn' => $loan !== null ? $loan->due_on->toDateString() : null,
                'isOverdue' => $loan !== null && $loan->due_on->toDateString() < $today,
                'lostReportedAt' => $copy->lost_reported_at?->toIso8601String(),
                'retiredAt' => $copy->retired_at?->toIso8601String(),
                'retiredReason' => $copy->retired_reason,
            ];
        });

        // withTrashed: BR §11 lists assessments under NEVER deleted, and a
        // soft-deleted copy's assessments are still this title's history —
        // the same reach $historyCodes below already makes for loan rows.
        $conditionHistory = ConditionAssessment::query()
            ->whereIn('copy_id', $book->copies()->withTrashed()->pluck('id'))
            ->orderByDesc('assessed_at')
            ->get();
        $assessors = User::query()
            ->whereIn('id', $conditionHistory->pluck('assessed_by'))
            ->get(['id', 'full_name'])
            ->keyBy('id');
        $codesById = $book->copies()->withTrashed()->pluck('code', 'id');

        $loanHistory = Loan::query()
            ->where('book_id', $book->id)
            ->orderByDesc('lent_at')
            ->get();
        $historyBorrowers = User::query()
            ->whereIn('id', $loanHistory->pluck('borrower_id'))
            ->get(['id', 'full_name'])
            ->keyBy('id');
        // History may reference a soft-deleted copy — read codes withTrashed.
        $historyCodes = $book->copies()->withTrashed()->pluck('code', 'id');

        return [
            'book' => [
                'bookId' => $withCounts->id,
                'slug' => $withCounts->slug,
                'title' => $withCounts->title,
                'author' => $withCounts->author,
                'coverUrl' => $withCounts->cover_url,
                'category' => $withCounts->category?->name,
                'copiesTotal' => (int) $withCounts->getAttribute('copies_total'),
                'copiesAvailable' => (int) $withCounts->getAttribute('available_count'),
                'availability' => $this->availabilityFor($withCounts),
                'isPublished' => $withCounts->is_published,
                'codes' => $this->codesFor($withCounts),
            ],
            'onLoan' => $copies->filter(fn ($c) => $c->state === CopyState::OnLoan)->count(),
            'copies' => $copyRows->values()->all(),
            'conditionHistory' => $conditionHistory->map(fn (ConditionAssessment $row) => [
                'assessedAt' => $row->assessed_at->toIso8601String(),
                'copyCode' => $codesById->get($row->copy_id),
                'assessorName' => $assessors->get($row->assessed_by)?->full_name,
                'condition' => $row->condition->value,
                'note' => $row->note,
            ])->values()->all(),
            'loanHistory' => $loanHistory->map(fn (Loan $row) => [
                'loanId' => $row->id,
                'copyCode' => $historyCodes->get($row->copy_id),
                'borrowerName' => $historyBorrowers->get($row->borrower_id)?->full_name,
                'lentAt' => $row->lent_at->toIso8601String(),
                'returnedAt' => $row->returned_at?->toIso8601String(),
                'status' => $row->status->value,
                'returnCondition' => $row->return_condition?->value,
            ])->values()->all(),
        ];
    }
}
```

- [ ] **Step 6: Write `app/Queries/BookForEditQuery.php`**

```php
<?php

namespace App\Queries;

use App\Models\Book;

/**
 * What the edit form needs to pre-fill, and nothing else — port of
 * get-book-for-edit.ts, whose docstring explains why neither single-book
 * read can serve a form: the manager detail carries the category NAME
 * (display) where UpdateBook's category_slug input needs the SLUG a
 * <select> posts back, and the reader detail filters is_published — which
 * would make a title uneditable for exactly the time it is being
 * prepared. No counts, no availability, no cover: only what <BookFields>
 * renders and UpdateBook round-trips.
 */
final class BookForEditQuery
{
    /** @return array<string, mixed> */
    public function run(Book $book): array
    {
        $book->loadMissing('category:id,slug');

        return [
            'bookId' => $book->id,
            'slug' => $book->slug,
            'title' => $book->title,
            'author' => $book->author,
            'categorySlug' => $book->category?->slug,
            'publisher' => $book->publisher,
            'publishedYear' => $book->published_year,
            'pageCount' => $book->page_count,
            'isbn' => $book->isbn,
            'description' => $book->description,
            'isPublished' => $book->is_published,
        ];
    }
}
```

- [ ] **Step 7: Write `app/Queries/LostCopiesQuery.php`**

```php
<?php

namespace App\Queries;

use App\Enums\CopyState;
use App\Models\BookCopy;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

/**
 * BR §16.3's Sách đã mất — the shelf-wide lost list that gives
 * lost → available a screen to happen on ("Báo mất appears in three places
 * in the built interface, and marking a copy found appears in none of
 * them"). Port of get-lost-copies.ts.
 *
 * OPS §3.3 tabulates no GetLostCopies; OPS §4.1 names this exact view as
 * MarkCopyFound's UI trigger — the read is implied by the catalogue even
 * though the catalogue forgot to tabulate it (the reference makes the same
 * point of order).
 *
 * lastBorrowerName comes from the most recent lost loan — a copy can be
 * lost, found, lent and lost again, so the subquery orders by
 * lost_reported_at desc; never a bare first(). Straight to users, not
 * through memberships: a borrower who has since left the shelf is exactly
 * the person a lost copy is most likely to be with. A name and NO phone:
 * BR:574 asks for neither — a lost copy's way back is MarkCopyFound, not
 * a call — so the most identifying field on the shelf is not carried here.
 *
 * Ordered newest-report-first; a copy with no report time (import shape)
 * is the LEAST recent thing on the screen, so nulls sort last — which IS
 * MariaDB's own behaviour under DESC (NULLs last; first under ASC —
 * verified live, and the opposite of Postgres's default), but it is
 * stated as an explicit IS NULL key so the intent survives a reader's
 * doubt and any future port. The lastBorrowerName subquery's
 * orderByDesc(lost_reported_at) leans on the same NULLs-last behaviour.
 * code ends the order: unique per shelf, so the order is total.
 *
 * Not paged, knowingly: this set grows until somebody acts, but nothing
 * breaks at a few hundred rows, the order is already total, and adding a
 * paginate() later is two lines. The reference's docstring carries the
 * full accounting.
 */
final class LostCopiesQuery
{
    /** @return list<array<string, mixed>> */
    public function rows(): array
    {
        return $this->base()
            ->with('book:id,slug,title,author,cover_url')
            ->addSelect(['last_borrower_name' => DB::table('loans')
                ->join('users', 'users.id', '=', 'loans.borrower_id')
                ->whereColumn('loans.copy_id', 'book_copies.id')
                ->where('loans.status', 'lost')
                ->orderByDesc('loans.lost_reported_at')
                ->limit(1)
                ->select('users.full_name'),
            ])
            ->orderByRaw('book_copies.lost_reported_at IS NULL ASC, book_copies.lost_reported_at DESC')
            ->orderBy('code')
            ->get()
            ->map(fn (BookCopy $copy) => [
                'copyId' => $copy->id,
                'code' => $copy->code,
                'bookId' => $copy->book_id,
                // Nullsafe for the analyser only — whereHas('book') makes
                // the relation non-null at runtime.
                'bookSlug' => $copy->book?->slug,
                'title' => $copy->book?->title,
                'coverUrl' => $copy->book?->cover_url,
                'author' => $copy->book?->author,
                'condition' => $copy->condition->value,
                'reportedAt' => $copy->lost_reported_at?->toIso8601String(),
                'lastBorrowerName' => $copy->getAttribute('last_borrower_name'),
            ])
            ->values()
            ->all();
    }

    /**
     * The Đã mất (n) chip's number — the SAME predicate as rows(), and
     * LostCopiesTest asserts the two agree rather than trusting that they
     * look alike: a chip whose count disagrees with the screen it opens is
     * the defect the reference spent a paragraph on.
     */
    public function count(): int
    {
        return $this->base()->count();
    }

    /** @return Builder<BookCopy> */
    private function base(): Builder
    {
        return BookCopy::query()
            ->where('state', CopyState::Lost)
            ->whereHas('book');   // a soft-deleted book takes its lost copies off both
    }
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `make test FILTER=ManagerQueriesTest` — Expected: PASS
Run: `make test FILTER=LostCopiesTest` — Expected: PASS
Run: `make lint && make analyse` — Expected: clean

- [ ] **Step 9: Commit**

```bash
git add app/Queries tests/Feature/Catalogue/ManagerQueriesTest.php tests/Feature/Catalogue/LostCopiesTest.php
git commit -m "feat: manager catalogue queries — list, detail, edit form, lost copies"
```

---

### Task 11: The reader's queries — catalogue, search, book detail

**Files:**
- Create: `app/Queries/CatalogueQuery.php`
- Create: `app/Queries/SearchQuery.php`
- Create: `app/Queries/BookDetailQuery.php`
- Test: `tests/Feature/Catalogue/ReaderQueriesTest.php`

**Read first:** `old_next/tests/domain/catalogue/reader-queries.test.ts` — the specification, its parameterised paging property included — then `get-catalogue.ts`, `search-catalogue.ts`, `get-book-detail.ts`.

**Interfaces:**
- Consumes: the `CountsCopies` trait (Task 10 — `borrowable(): Closure`, `withCopyCounts(Builder): Builder`, `availabilityFor(Book): string`, `codesFor(Book): string`), `Fold::fold(string): string`, `Clock::today(): string`, `TenantContext::bookshelf(): ?Bookshelf` (for the shelf's settings in `BookDetailQuery`), models.
- Produces:
  - `CatalogueQuery::run(array $input): array` — `$input` = `array{scope?: 'available'|'all', category?: ?string, sort?: 'recent'|'title', page?: int, per_page?: int}`; same page shape as `BooksListQuery::run`. Published, live books only; `scope: available` keeps only titles with a borrowable copy; sort exactly as the manager list (folded title / recent, `slug` closing the order).
  - `SearchQuery::run(string $q): array` — `list<array<string, mixed>>` (`CatalogueRow` shape). Blank → `[]`; folds-to-nothing → `[]` (M7); substring over `title_folded` **and** `author_folded` with the term folded by `Fold::fold` (BR §12: identical normalisation both sides — the generated columns hold the stored fold, `FoldParityTest` holds the treaty); published only; ordered folded-title then `slug` (two titles can fold alike — "Dế Mèn" and "De Men" — and a result list that reorders them between renders is a list nobody can scan).
  - `BookDetailQuery::run(Book $book): array` — the `CatalogueRow` fields plus `publisher, publishedYear, pageCount, isbn, description, language, onLoan, queueLength, currentLoan`. `queueLength` = pending, live borrow requests for the title (BR §7.2: the queue *is* the pending set; no separate reservation concept). `currentLoan` — `{holderName, daysRemaining, dueOn}` from the earliest-due active loan (`ORDER BY due_on`, never a bare first) — is `null` entirely when the shelf's `public_show_current_borrower` setting is `false`; `holderName` respects `public_name_display` (`full_name` default / `display_name` falling back to full / `hidden` → null holder, loan facts kept). `daysRemaining` = due date minus `Clock::today()` in days (negative when overdue). The **controller** enforces `is_published` (404 for a draft) before calling — the binding has already resolved the model; the query trusts its caller the way every query in this plan does.

- [ ] **Step 1: Write the failing test**

Create `tests/Feature/Catalogue/ReaderQueriesTest.php`:

```php
<?php

use App\Actions\Catalogue\CreateBook;
use App\Models\Book;
use App\Models\Bookshelf;
use App\Models\BorrowRequest;
use App\Models\Category;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\User;
use App\Queries\BookDetailQuery;
use App\Queries\CatalogueQuery;
use App\Queries\SearchQuery;
use App\Support\TenantContext;
use Carbon\Carbon;

afterEach(fn () => Carbon::setTestNow());

function rdrFixture(array $settings = []): array
{
    $shelf = Bookshelf::factory()->create(['slug' => 'dong-thap', 'settings' => $settings]);
    $manager = User::factory()->create();
    $membership = Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);
    Category::factory()->create(['name' => 'Truyện thiếu nhi', 'slug' => 'truyen-thieu-nhi']);
    Category::factory()->create(['name' => 'Giáo lý', 'slug' => 'giao-ly']);
    app(TenantContext::class)->set($shelf, $membership);
    test()->actingAs($manager);

    return [$shelf, $manager];
}

function rdrBook(User $user, string $title, array $over = []): Book
{
    return app(CreateBook::class)->execute($user, array_merge([
        'title' => $title, 'author' => 'Tô Hoài',
        'category_slug' => 'truyen-thieu-nhi', 'copy_count' => 1,
    ], $over));
}

function rdrHold(Book $book, string $copyId, string $expiresAt): BorrowRequest
{
    $requester = User::factory()->create();

    return BorrowRequest::query()->create([
        'book_id' => $book->id, 'copy_id' => $copyId, 'member_id' => $requester->id,
        'status' => 'approved', 'hold_expires_at' => $expiresAt,
    ]);
}

it('availability is derived from borrowability, never a stored count', function () {
    [, $user] = rdrFixture();
    $book = rdrBook($user, 'Dế Mèn Phiêu Lưu Ký');
    $book->copies->first()->update(['state' => 'on_loan']);

    $rows = app(CatalogueQuery::class)->run(['scope' => 'all'])['rows'];

    expect($rows[0]['availability'])->toBe('on_loan')
        ->and($rows[0]['copiesAvailable'])->toBe(0);
});

it('an unexpired hold makes a copy unavailable without changing its state', function () {
    // Two copies, as the reference's own fixture: the badge ladder counts
    // copies by STATE, and a held-by-request copy is still state
    // 'available' — so for a one-copy title under a hold the ladder lands
    // on 'none', faithfully to the reference's deriveAvailability. What
    // this pins is the count: the held copy leaves copiesAvailable with
    // its state untouched.
    Carbon::setTestNow(Carbon::parse('2026-08-27 03:00:00', 'UTC'));
    [, $user] = rdrFixture();
    $book = rdrBook($user, 'Dế Mèn Phiêu Lưu Ký', ['copy_count' => 2]);
    $copy = $book->copies->first();
    rdrHold($book, $copy->id, '2026-08-28 03:00:00');

    $rows = app(CatalogueQuery::class)->run(['scope' => 'all'])['rows'];

    expect($copy->fresh()->state->value)->toBe('available')   // the state did not move
        ->and($rows[0]['copiesTotal'])->toBe(2)
        ->and($rows[0]['copiesAvailable'])->toBe(1);
});

it('a lapsed hold frees the copy on read, no job having run — BR §8', function () {
    Carbon::setTestNow(Carbon::parse('2026-08-27 03:00:00', 'UTC'));
    [, $user] = rdrFixture();
    $book = rdrBook($user, 'Dế Mèn Phiêu Lưu Ký');
    rdrHold($book, $book->copies->first()->id, '2026-08-26 03:00:00');   // already lapsed

    $rows = app(CatalogueQuery::class)->run(['scope' => 'all'])['rows'];

    expect($rows[0]['copiesAvailable'])->toBe(1)
        ->and($rows[0]['availability'])->toBe('available');
});

it('scope=available hides a title with nothing on the shelf; scope=all does not', function () {
    [, $user] = rdrFixture();
    rdrBook($user, 'Dế Mèn Phiêu Lưu Ký');
    $allOut = rdrBook($user, 'Hoàng Tử Bé');
    $allOut->copies->first()->update(['state' => 'on_loan']);

    expect(array_column(app(CatalogueQuery::class)->run(['scope' => 'available'])['rows'], 'title'))
        ->toBe(['Dế Mèn Phiêu Lưu Ký'])
        ->and(app(CatalogueQuery::class)->run(['scope' => 'all'])['total'])->toBe(2);
});

it('an unpublished draft is hidden from members, on both scopes', function () {
    [, $user] = rdrFixture();
    rdrBook($user, 'Bản Nháp', ['is_published' => false]);

    expect(app(CatalogueQuery::class)->run(['scope' => 'all'])['total'])->toBe(0)
        ->and(app(CatalogueQuery::class)->run(['scope' => 'available'])['total'])->toBe(0);
});

it('the catalogue is paginated and reports its own total', function () {
    [, $user] = rdrFixture();
    foreach (range(1, 5) as $i) {
        rdrBook($user, "Sách Số {$i}");
    }

    $page = app(CatalogueQuery::class)->run(['scope' => 'all', 'page' => 2, 'per_page' => 2]);

    expect($page['rows'])->toHaveCount(2)
        ->and($page['page'])->toBe(2)
        ->and($page['pageCount'])->toBe(3)
        ->and($page['total'])->toBe(5);
});

it('sort=title is alphabetical in Vietnamese, not in byte order', function () {
    [, $user] = rdrFixture();
    rdrBook($user, 'Tuổi Thơ Dữ Dội');
    rdrBook($user, 'Đất Rừng Phương Nam');
    rdrBook($user, 'Anh Em Nhà Bồ Câu');

    $rows = app(CatalogueQuery::class)->run(['scope' => 'all', 'sort' => 'title'])['rows'];

    expect(array_column($rows, 'title'))
        ->toBe(['Anh Em Nhà Bồ Câu', 'Đất Rừng Phương Nam', 'Tuổi Thơ Dữ Dội']);
});

it('a category filter narrows by slug, not by name', function () {
    [, $user] = rdrFixture();
    rdrBook($user, 'Dế Mèn Phiêu Lưu Ký');
    rdrBook($user, 'Sách Giáo Lý', ['category_slug' => 'giao-ly']);

    $rows = app(CatalogueQuery::class)->run(['scope' => 'all', 'category' => 'giao-ly'])['rows'];

    expect(array_column($rows, 'title'))->toBe(['Sách Giáo Lý']);
});

it('one shelf\'s catalogue never contains another\'s', function () {
    [$shelf, $user] = rdrFixture();
    rdrBook($user, 'Dế Mèn Phiêu Lưu Ký');

    app(TenantContext::class)->clear();
    $other = Bookshelf::factory()->create(['slug' => 'can-tho', 'settings' => []]);
    $otherUser = User::factory()->create();
    $otherMembership = Membership::factory()->for($other)->create([
        'user_id' => $otherUser->id, 'role' => 'reader', 'status' => 'active',
    ]);
    app(TenantContext::class)->set($other, $otherMembership);

    expect(app(CatalogueQuery::class)->run(['scope' => 'all'])['total'])->toBe(0);
});

it('search finds titles typed without diacritics, over title and author', function () {
    [, $user] = rdrFixture();
    rdrBook($user, 'Tìm Kiếm Kho Báu');
    rdrBook($user, 'Đất Rừng Phương Nam', ['author' => 'Đoàn Giỏi']);

    expect(array_column(app(SearchQuery::class)->run('tim kiem kho bau'), 'title'))
        ->toBe(['Tìm Kiếm Kho Báu'])
        ->and(array_column(app(SearchQuery::class)->run('doan gioi'), 'title'))
        ->toBe(['Đất Rừng Phương Nam']);
});

it('search results carry availability and stay alphabetical in Vietnamese', function () {
    [, $user] = rdrFixture();
    $out = rdrBook($user, 'Đất Rừng Phương Nam');
    $out->copies->first()->update(['state' => 'on_loan']);
    rdrBook($user, 'Anh Em Nhà Bồ Câu');

    // Both books share rdrBook's default author, so this one term returns
    // both — the reference's own device for its ordering assertion.
    $rows = app(SearchQuery::class)->run('to hoai');

    expect(array_column($rows, 'title'))->toBe(['Anh Em Nhà Bồ Câu', 'Đất Rừng Phương Nam'])
        ->and(collect($rows)->firstWhere('title', 'Đất Rừng Phương Nam')['availability'])->toBe('on_loan');
});

it('two titles that fold alike take the slug tiebreak, concretely', function () {
    [, $user] = rdrFixture();
    rdrBook($user, 'De Men');    // folds to 'de men' → slug de-men
    rdrBook($user, 'Dế Mèn');    // folds identically → disambiguated to de-men-2

    // Asserting the exact order is what actually exercises
    // orderBy('slug'): running the same query twice and comparing would
    // pass with the tiebreak deleted.
    expect(array_column(app(SearchQuery::class)->run('de men'), 'slug'))
        ->toBe(['de-men', 'de-men-2']);
});

it('an empty search term, and one that folds to nothing, return nothing', function () {
    [, $user] = rdrFixture();
    rdrBook($user, 'Dế Mèn Phiêu Lưu Ký');

    expect(app(SearchQuery::class)->run(''))->toBe([])
        ->and(app(SearchQuery::class)->run('   '))->toBe([])
        ->and(app(SearchQuery::class)->run('%%%'))->toBe([]);   // M7 — never the whole shelf
});

it('search does not surface drafts', function () {
    [, $user] = rdrFixture();
    rdrBook($user, 'Bản Nháp Bí Mật', ['is_published' => false]);

    expect(app(SearchQuery::class)->run('ban nhap'))->toBe([]);
});

it('book detail reports the queue and the earliest-due holder', function () {
    Carbon::setTestNow(Carbon::parse('2026-08-27 03:00:00', 'UTC'));
    [, $user] = rdrFixture();
    $holder = User::factory()->create(['full_name' => 'Nguyễn Văn Bình']);
    $book = rdrBook($user, 'Dế Mèn Phiêu Lưu Ký', ['copy_count' => 2]);
    $copy = $book->copies->first();
    $copy->update(['state' => 'on_loan']);
    Loan::query()->create([
        'copy_id' => $copy->id, 'book_id' => $book->id,
        'borrower_id' => $holder->id, 'lent_by' => $user->id,
        'due_on' => '2026-08-30', 'status' => 'active',
    ]);
    // Two pending requests — BR §7.2: the queue IS the pending set.
    foreach (range(1, 2) as $i) {
        BorrowRequest::query()->create([
            'book_id' => $book->id, 'member_id' => User::factory()->create()->id, 'status' => 'pending',
        ]);
    }

    $detail = app(BookDetailQuery::class)->run($book);

    expect($detail['queueLength'])->toBe(2)
        ->and($detail['onLoan'])->toBe(1)
        ->and($detail['copiesAvailable'])->toBe(1)
        ->and($detail['currentLoan']['holderName'])->toBe('Nguyễn Văn Bình')
        ->and($detail['currentLoan']['dueOn'])->toBe('2026-08-30')
        ->and($detail['currentLoan']['daysRemaining'])->toBe(3);
});

it('public_show_current_borrower off withholds the holder, keeps the availability', function () {
    [, $user] = rdrFixture(['public_show_current_borrower' => false]);
    $holder = User::factory()->create();
    $book = rdrBook($user, 'Dế Mèn Phiêu Lưu Ký');
    $copy = $book->copies->first();
    $copy->update(['state' => 'on_loan']);
    Loan::query()->create([
        'copy_id' => $copy->id, 'book_id' => $book->id,
        'borrower_id' => $holder->id, 'lent_by' => $user->id,
        'due_on' => '2026-08-30', 'status' => 'active',
    ]);

    $detail = app(BookDetailQuery::class)->run($book);

    expect($detail['currentLoan'])->toBeNull()
        ->and($detail['availability'])->toBe('on_loan');
});

it('public_name_display governs the holder\'s name — display_name, and hidden', function () {
    [, $user] = rdrFixture(['public_name_display' => 'display_name']);
    $holder = User::factory()->create(['full_name' => 'Nguyễn Văn Bình', 'display_name' => 'Bình']);
    $book = rdrBook($user, 'Dế Mèn Phiêu Lưu Ký');
    $copy = $book->copies->first();
    $copy->update(['state' => 'on_loan']);
    $loan = Loan::query()->create([
        'copy_id' => $copy->id, 'book_id' => $book->id,
        'borrower_id' => $holder->id, 'lent_by' => $user->id,
        'due_on' => '2026-08-30', 'status' => 'active',
    ]);

    expect(app(BookDetailQuery::class)->run($book)['currentLoan']['holderName'])->toBe('Bình');

    // hidden: the loan facts stay, the name goes.
    $shelf = app(TenantContext::class)->bookshelf();
    $shelf->update(['settings' => ['public_name_display' => 'hidden']]);
    app(TenantContext::class)->set($shelf->fresh(), app(TenantContext::class)->membership());

    $detail = app(BookDetailQuery::class)->run($book);
    expect($detail['currentLoan'])->not->toBeNull()
        ->and($detail['currentLoan']['holderName'])->toBeNull()
        ->and($detail['currentLoan']['dueOn'])->toBe('2026-08-30');
});

it('copiesTotal excludes a lost copy, the same way it excludes a retired one', function () {
    [, $user] = rdrFixture();
    $book = rdrBook($user, 'Dế Mèn Phiêu Lưu Ký', ['copy_count' => 3]);
    $book->copies[0]->update(['state' => 'lost']);
    $book->copies[1]->update(['state' => 'retired', 'retired_reason' => 'x']);

    expect(app(BookDetailQuery::class)->run($book)['copiesTotal'])->toBe(1);
});

it('paging the catalogue loses no book and repeats none, at both sorts and odd page sizes', function () {
    // The reference's parameterised paging property: every book of a bulk
    // load shares one created_at, so only a total order pages correctly.
    Carbon::setTestNow(Carbon::parse('2026-08-27 03:00:00', 'UTC'));
    [, $user] = rdrFixture();
    foreach (range(1, 11) as $i) {
        rdrBook($user, "Sách Số {$i}");
    }

    foreach (['recent', 'title'] as $sort) {
        foreach ([3, 4, 7] as $size) {
            $seen = [];
            for ($page = 1; $page <= (int) ceil(11 / $size); $page++) {
                $result = app(CatalogueQuery::class)->run([
                    'scope' => 'all', 'sort' => $sort, 'page' => $page, 'per_page' => $size,
                ]);
                foreach ($result['rows'] as $row) {
                    $seen[] = $row['slug'];
                }
            }
            expect(count($seen))->toBe(11, "sort {$sort} size {$size}: lost or repeated")
                ->and(count(array_unique($seen)))->toBe(11, "sort {$sort} size {$size}: repeated");
        }
    }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `make test FILTER=ReaderQueriesTest` — Expected: FAIL (class not found)

- [ ] **Step 3: Write `app/Queries/CatalogueQuery.php`**

```php
<?php

namespace App\Queries;

use App\Models\Book;
use App\Queries\Concerns\CountsCopies;
use Illuminate\Database\Eloquent\Builder;

/**
 * GetCatalogue (OPS §3.2) — the reader's browse. Port of get-catalogue.ts:
 * published, live titles; scope=available keeps only titles with a
 * borrowable copy (the same predicate the counts use, so the toggle and
 * the badge can never disagree); sort by folded title or recency, slug
 * closing the order into a total one (IMPORTANT 5 — see BooksListQuery).
 */
final class CatalogueQuery
{
    use CountsCopies;

    /**
     * @param  array{scope?: string, category?: ?string, sort?: ?string, page?: int, per_page?: int}  $input
     * @return array{rows: list<array<string, mixed>>, page: int, pageCount: int, total: int}
     */
    public function run(array $input): array
    {
        $query = $this->withCopyCounts(Book::query())
            ->where('is_published', true)
            ->with('category:id,name,slug')
            ->when($input['category'] ?? null, fn (Builder $b, string $slug) => $b
                ->whereHas('category', fn (Builder $c) => $c->where('slug', $slug)))
            ->when(($input['scope'] ?? 'available') === 'available', fn (Builder $b) => $b
                ->whereHas('copies', $this->borrowable()));

        // The reference's three-key order under both sorts — see
        // BooksListQuery's twin comment; slug makes it total.
        if (($input['sort'] ?? 'recent') === 'title') {
            $query->orderBy('title_folded');
        }
        $query->orderByDesc('created_at')->orderBy('slug');

        $paginator = $query->paginate(
            perPage: min(100, max(1, (int) ($input['per_page'] ?? 24))),
            page: max(1, (int) ($input['page'] ?? 1)),
        );

        return [
            'rows' => collect($paginator->items())->map(fn (Book $book) => $this->row($book))->values()->all(),
            'page' => $paginator->currentPage(),
            'pageCount' => max(1, $paginator->lastPage()),
            'total' => $paginator->total(),
        ];
    }

    /** The CatalogueRow shape SearchQuery shares. @return array<string, mixed> */
    public function row(Book $book): array
    {
        return [
            'bookId' => $book->id,
            'slug' => $book->slug,
            'title' => $book->title,
            'author' => $book->author,
            'coverUrl' => $book->cover_url,
            'category' => $book->category?->name,
            'copiesTotal' => (int) $book->getAttribute('copies_total'),
            'copiesAvailable' => (int) $book->getAttribute('available_count'),
            'availability' => $this->availabilityFor($book),
        ];
    }
}
```

- [ ] **Step 4: Write `app/Queries/SearchQuery.php`**

```php
<?php

namespace App\Queries;

use App\Models\Book;
use App\Queries\Concerns\CountsCopies;
use App\Support\Fold;
use Illuminate\Database\Eloquent\Builder;

/**
 * SearchCatalogue (OPS §3.2) — diacritic- and case-insensitive substring
 * search over title and author (BR §12). Port of search-catalogue.ts.
 *
 * The term is folded by Fold::fold — the SAME table the stored generated
 * columns were frozen from, with FoldParityTest holding the treaty — so
 * both sides of the comparison go through one implementation and BR §12's
 * "the two can never drift" stays structural. LIKE '%…%', not anything
 * cleverer: at a few hundred books per shelf nothing more is warranted
 * (DB §8's own accounting, restated by spec §4's index note).
 *
 * M7: a term that folds to '' (a lone %, underscores…) would degenerate
 * the pattern to '%%' and match every row — a garbage query behaves like
 * a blank one. Ordered folded-title then slug: two titles can fold alike
 * ("Dế Mèn" / "De Men"), and a list that reorders them between renders is
 * a list nobody can scan.
 */
final class SearchQuery
{
    use CountsCopies;

    public function __construct(private CatalogueQuery $catalogue) {}

    /** @return list<array<string, mixed>> */
    public function run(string $q): array
    {
        if (trim($q) === '') {
            return [];
        }

        $folded = Fold::fold($q);

        if ($folded === '') {
            return [];
        }

        return $this->withCopyCounts(Book::query())
            ->where('is_published', true)
            ->with('category:id,name,slug')
            ->where(fn (Builder $w) => $w
                ->where('title_folded', 'like', '%'.$folded.'%')
                ->orWhere('author_folded', 'like', '%'.$folded.'%'))
            ->orderBy('title_folded')
            ->orderBy('slug')
            ->get()
            ->map(fn (Book $book) => $this->catalogue->row($book))
            ->values()
            ->all();
    }
}
```

- [ ] **Step 5: Write `app/Queries/BookDetailQuery.php`**

```php
<?php

namespace App\Queries;

use App\Models\Book;
use App\Models\BorrowRequest;
use App\Models\Loan;
use App\Models\User;
use App\Queries\Concerns\CountsCopies;
use App\Support\Clock;
use App\Support\TenantContext;
use Carbon\CarbonImmutable;

/**
 * GetBookDetail, reader flavour (OPS §3.2) — port of get-book-detail.ts.
 * Everything derived is derived: copiesAvailable from the borrowable
 * predicate, daysRemaining from due_on against the clock (never a stored
 * column — "there is no is_overdue column, and there must never be one"),
 * queueLength from the count of pending requests (BR §7.2: the queue IS
 * the pending set; no separate reservation concept).
 *
 * The is_published gate is the CONTROLLER's (a draft 404s before this
 * runs) — this query serves an already-resolved model.
 *
 * currentLoan honours two shelf settings, defaults per BR §5.5 because a
 * shelf row need only store what it overrides: public_show_current_borrower
 * (default true) suppresses the whole block when false;
 * public_name_display (default full_name) picks the name — display_name
 * falls back to the full name, hidden keeps the loan facts and drops the
 * name. Manager-only fields (BR §5.3) are never returned regardless.
 */
final class BookDetailQuery
{
    use CountsCopies;

    public function __construct(
        private CatalogueQuery $catalogue,
        private TenantContext $context,
        private Clock $clock,
    ) {}

    /** @return array<string, mixed> */
    public function run(Book $book): array
    {
        $withCounts = $this->withCopyCounts(Book::query())
            ->with('category:id,name,slug')
            ->findOrFail($book->id);

        $queueLength = BorrowRequest::query()
            ->where('book_id', $book->id)
            ->where('status', 'pending')
            ->count();

        // Materialise the AsArrayObject (or a null shelf) into a plain
        // array first: `null['key']` is a PHP warning, and PHPUnit treats
        // warnings as failures.
        $settings = (array) ($this->context->bookshelf()?->settings ?? []);
        $showBorrower = ($settings['public_show_current_borrower'] ?? true) !== false;

        $currentLoan = null;

        if ($showBorrower) {
            // The earliest-due active loan — ordered, never a bare first().
            $loan = Loan::query()
                ->where('book_id', $book->id)
                ->where('status', 'active')
                ->orderBy('due_on')
                ->first();

            if ($loan instanceof Loan) {
                $holder = User::query()->find($loan->borrower_id);
                $display = $settings['public_name_display'] ?? 'full_name';

                $currentLoan = [
                    'holderName' => match ($display) {
                        'hidden' => null,
                        'display_name' => $holder?->display_name ?? $holder?->full_name,
                        default => $holder?->full_name,
                    },
                    'daysRemaining' => (int) CarbonImmutable::parse($this->clock->today())
                        ->diffInDays($loan->due_on->toDateString(), false),
                    'dueOn' => $loan->due_on->toDateString(),
                ];
            }
        }

        return array_merge($this->catalogue->row($withCounts), [
            'publisher' => $withCounts->publisher,
            'publishedYear' => $withCounts->published_year,
            'pageCount' => $withCounts->page_count,
            'isbn' => $withCounts->isbn,
            'description' => $withCounts->description,
            'language' => $withCounts->language,
            'onLoan' => (int) $withCounts->getAttribute('on_loan_count'),
            'queueLength' => $queueLength,
            'currentLoan' => $currentLoan,
        ]);
    }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `make test FILTER=ReaderQueriesTest` — Expected: PASS
Run: `make lint && make analyse` — Expected: clean. (The `settings` attribute is `AsArrayObject` — index reads like `$settings['public_name_display']` are how Phase 0's own code reads it; if Larastan objects to the nullsafe array access, read it into a local `$settings = … ?? []` first, which is what the code above does via the `?? true` / `?? 'full_name'` defaults.)

- [ ] **Step 7: Commit**

```bash
git add app/Queries tests/Feature/Catalogue/ReaderQueriesTest.php
git commit -m "feat: reader catalogue queries — browse with derived availability, folded search, book detail"
```

---

### Task 12: The manager's screens — routes, controllers, pages

**Files:**
- Edit: `routes/web.php` (the manage `books` block only — the GET names already exist and keep their names; the write routes are new)
- Create: `app/Http/Controllers/Manage/BookController.php`
- Create: `app/Http/Controllers/Manage/CopyController.php`
- Create: `app/Http/Controllers/Manage/LostCopiesController.php`
- Edit: `resources/js/lib/copy.ts` (add the `catalogue` and `manageBooks` namespaces; touch nothing existing)
- Create: `resources/js/pages/manage/books/index.tsx`
- Create: `resources/js/pages/manage/books/create.tsx`
- Create: `resources/js/pages/manage/books/show.tsx`
- Create: `resources/js/pages/manage/books/edit.tsx`
- Create: `resources/js/pages/manage/books/lost.tsx`
- Create: `resources/js/components/book-fields.tsx`
- Test: `tests/Feature/Catalogue/ManageBookScreensTest.php`

**Read first:** the built screens under `old_next/src/app/tu-sach/[shelf]/quan-ly/sach/` (`page.tsx`, `moi/page.tsx`, `[id]/page.tsx`, `[id]/sua/page.tsx`, `mat/page.tsx`) for layout, copy and control placement; `resources/js/pages/shelves/show.tsx` and `resources/js/layouts/manage-layout.tsx` for this branch's established page shape.

**Interfaces:**
- Consumes: `CreateBook::execute(User, array): Book`, `UpdateBook::execute(User, Book, array): Book`, `AddCopies::execute(User, Book, array): Collection`, `AssessCondition::execute(User, BookCopy, CopyCondition, ?string, ?string): ConditionAssessment`, `RetireCopy::execute(User, BookCopy, string): void`, `ReportCopyLost::execute(User, BookCopy, ?string): void`, `MarkCopyFound::execute(User, BookCopy, ?string): void` (Tasks 6–9); `BooksListQuery::run(array): array`, `ManagerBookDetailQuery::run(Book): array`, `BookForEditQuery::run(Book): array`, `LostCopiesQuery::rows(): array` / `::count(): int` (Task 10); `CategoryQuery::stockedByShelf(bool): array` / `::allOptions(): array` (Task 4); the Form Requests by name (Tasks 6–9); the `role:manager` middleware and scoped bindings (Phase 0); `copy.ts`'s `t(template, params)`.
- Produces the routes below. **`DeleteBook` stays route-less and screen-less, deliberately** — the reference's Q7: the command and its tests exist (Task 7) so the retention rule is pinned, but the built UI has no entry point and OPS flags the missing confirmation flow as an open question; inventing one here would be new product design. Recorded in known-gaps by Task 14.

| Method | URI (under `shelves/{shelf}/manage`) | Name (`shelves.manage.`) | Handler |
|---|---|---|---|
| GET | `/books` | `books.index` | `BookController@index` |
| GET | `/books/create` | `books.create` | `BookController@create` |
| POST | `/books` | `books.store` | `BookController@store` |
| GET | `/books/lost` | `books.lost` | `LostCopiesController@index` |
| GET | `/books/{book}` | `books.show` | `BookController@show` |
| GET | `/books/{book}/edit` | `books.edit` | `BookController@edit` |
| PATCH | `/books/{book}` | `books.update` | `BookController@update` |
| POST | `/books/{book}/copies` | `books.copies.store` | `CopyController@store` |
| POST | `/copies/{bookCopy}/assess` | `copies.assess` | `CopyController@assess` |
| POST | `/copies/{bookCopy}/retire` | `copies.retire` | `CopyController@retire` |
| POST | `/copies/{bookCopy}/report-lost` | `copies.report-lost` | `CopyController@reportLost` |
| POST | `/copies/{bookCopy}/mark-found` | `copies.mark-found` | `CopyController@markFound` |

The `{bookCopy}` parameter name is load-bearing: under the group's `scopeBindings()`, Laravel resolves a child binding through the parent's relationship guessed from the parameter name — `bookCopy` → `Bookshelf::bookCopies()`, which exists — so a foreign shelf's copy id is a 404, exactly as `{book}` already behaves. `BookCopy` has no `getRouteKeyName` override, so `{bookCopy}` binds by uuid, which is what every per-copy button posts.

- [ ] **Step 1: Write the failing screen test**

Create `tests/Feature/Catalogue/ManageBookScreensTest.php`:

```php
<?php

use App\Actions\Catalogue\CreateBook;
use App\Models\AuditLog;
use App\Models\Book;
use App\Models\Bookshelf;
use App\Models\Category;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Inertia\Testing\AssertableInertia as Assert;

function scrManager(): array
{
    $shelf = Bookshelf::factory()->create(['slug' => 'dong-thap', 'settings' => []]);
    $user = User::factory()->create();
    Membership::factory()->for($shelf)->create([
        'user_id' => $user->id, 'role' => 'manager', 'status' => 'active',
    ]);
    Category::factory()->create(['name' => 'Truyện thiếu nhi', 'slug' => 'truyen-thieu-nhi']);

    return [$shelf, $user];
}

function scrBook(Bookshelf $shelf, User $user, array $over = []): Book
{
    $membership = Membership::query()->withoutGlobalScope(\App\Models\Scopes\BookshelfScope::class)
        ->where('bookshelf_id', $shelf->id)->where('user_id', $user->id)->firstOrFail();
    app(TenantContext::class)->set($shelf, $membership);
    test()->actingAs($user);

    $book = app(CreateBook::class)->execute($user, array_merge([
        'title' => 'Dế Mèn Phiêu Lưu Ký', 'author' => 'Tô Hoài',
        'category_slug' => 'truyen-thieu-nhi', 'copy_count' => 2,
    ], $over));

    app(TenantContext::class)->clear();

    return $book;
}

it('renders the index with rows, categories and the lost-count chip', function () {
    [$shelf, $user] = scrManager();
    scrBook($shelf, $user);

    $this->actingAs($user)
        ->get("/shelves/{$shelf->slug}/manage/books")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('manage/books/index')
            ->has('books.rows', 1)
            ->where('books.rows.0.title', 'Dế Mèn Phiêu Lưu Ký')
            ->where('books.rows.0.codes', 'DT-0001 – DT-0002')
            ->has('categories')
            ->where('lostCount', 0));
});

it('the create screen carries every category as an option', function () {
    [$shelf, $user] = scrManager();

    $this->actingAs($user)
        ->get("/shelves/{$shelf->slug}/manage/books/create")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('manage/books/create')
            ->where('categories.0.slug', 'truyen-thieu-nhi'));
});

it('storing a book redirects to its detail page and writes the audit row', function () {
    [$shelf, $user] = scrManager();

    $response = $this->actingAs($user)->post("/shelves/{$shelf->slug}/manage/books", [
        'title' => 'Hoàng Tử Bé', 'author' => 'Antoine de Saint-Exupéry',
        'category_slug' => 'truyen-thieu-nhi', 'copy_count' => 1,
    ]);

    $response->assertRedirect("/shelves/{$shelf->slug}/manage/books/hoang-tu-be");
    expect(AuditLog::query()->where('action', 'book.created')->count())->toBe(1);
});

it('a validation failure returns field errors, not a 500', function () {
    [$shelf, $user] = scrManager();

    $this->actingAs($user)
        ->from("/shelves/{$shelf->slug}/manage/books/create")
        ->post("/shelves/{$shelf->slug}/manage/books", ['title' => '', 'copy_count' => 0])
        ->assertRedirect("/shelves/{$shelf->slug}/manage/books/create")
        ->assertSessionHasErrors(['title', 'author', 'category_slug', 'copy_count']);
});

it('the detail page shows copies with actions and real history rows', function () {
    [$shelf, $user] = scrManager();
    $book = scrBook($shelf, $user);
    $copy = $book->copies->first();
    // One assessment and one closed loan, so the history assertions guard
    // the mapping (assessorName, copyCode) rather than passing on two
    // empty arrays that would survive the queries being deleted.
    $membership = Membership::query()->withoutGlobalScope(\App\Models\Scopes\BookshelfScope::class)
        ->where('bookshelf_id', $shelf->id)->where('user_id', $user->id)->firstOrFail();
    app(TenantContext::class)->set($shelf, $membership);
    $this->actingAs($user);
    app(\App\Actions\Catalogue\AssessCondition::class)
        ->execute($user, $copy, \App\Enums\CopyCondition::Worn, 'gáy lỏng');
    \App\Models\Loan::query()->create([
        'copy_id' => $copy->id, 'book_id' => $book->id,
        'borrower_id' => $user->id, 'lent_by' => $user->id,
        'due_on' => '2026-08-01', 'status' => 'returned',
        'return_condition' => 'perfect', 'returned_at' => now(),
    ]);
    app(TenantContext::class)->clear();

    $this->actingAs($user)
        ->get("/shelves/{$shelf->slug}/manage/books/{$book->slug}")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('manage/books/show')
            ->where('detail.book.title', 'Dế Mèn Phiêu Lưu Ký')
            ->has('detail.copies', 2)
            ->has('detail.conditionHistory', 1)
            ->where('detail.conditionHistory.0.copyCode', 'DT-0001')
            ->where('detail.conditionHistory.0.condition', 'worn')
            ->has('detail.loanHistory', 1)
            ->where('detail.loanHistory.0.copyCode', 'DT-0001')
            ->where('detail.loanHistory.0.returnCondition', 'perfect'));
});

it('the edit page pre-fills the form and update round-trips', function () {
    [$shelf, $user] = scrManager();
    $book = scrBook($shelf, $user);

    $this->actingAs($user)
        ->get("/shelves/{$shelf->slug}/manage/books/{$book->slug}/edit")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('manage/books/edit')
            ->where('book.categorySlug', 'truyen-thieu-nhi'));

    $this->actingAs($user)
        ->patch("/shelves/{$shelf->slug}/manage/books/{$book->slug}", ['title' => 'Dế Mèn (tái bản)'])
        ->assertRedirect("/shelves/{$shelf->slug}/manage/books/{$book->slug}");

    expect($book->fresh()->title)->toBe('Dế Mèn (tái bản)');
});

it('adding copies from the detail page continues the sequence', function () {
    [$shelf, $user] = scrManager();
    $book = scrBook($shelf, $user);

    $this->actingAs($user)
        ->post("/shelves/{$shelf->slug}/manage/books/{$book->slug}/copies", ['count' => 1])
        ->assertRedirect("/shelves/{$shelf->slug}/manage/books/{$book->slug}");

    expect($book->copies()->withoutGlobalScopes([\App\Models\Scopes\BookshelfScope::class])->count())->toBe(3);
});

it('the per-copy commands round-trip: assess, report lost, found, retire', function () {
    [$shelf, $user] = scrManager();
    $book = scrBook($shelf, $user);
    $copy = $book->copies->first();
    $base = "/shelves/{$shelf->slug}/manage";

    // assertSessionHasNoErrors on every step: a RuleViolated refusal ALSO
    // redirects back, so a bare assertRedirect would pass on failure and
    // the final state check would catch it only by luck.
    $this->actingAs($user)->post("{$base}/copies/{$copy->id}/assess", ['condition' => 'torn'])
        ->assertRedirect()->assertSessionHasNoErrors();
    $copy->update(['state' => 'on_loan']);
    $this->actingAs($user)->post("{$base}/copies/{$copy->id}/report-lost", [])
        ->assertRedirect()->assertSessionHasNoErrors();
    $this->actingAs($user)->post("{$base}/copies/{$copy->id}/mark-found", [])
        ->assertRedirect()->assertSessionHasNoErrors();
    $this->actingAs($user)->post("{$base}/copies/{$copy->id}/retire", ['reason' => 'cũ nát'])
        ->assertRedirect()->assertSessionHasNoErrors();

    $fresh = $copy->withoutRelations()->fresh();
    expect($fresh->state->value)->toBe('retired')
        ->and($fresh->condition->value)->toBe('torn');
});

it('a business-rule refusal comes back as the rule error, translated', function () {
    [$shelf, $user] = scrManager();
    $book = scrBook($shelf, $user);
    $copy = $book->copies->first();

    $this->actingAs($user)
        ->from("/shelves/{$shelf->slug}/manage/books/{$book->slug}")
        ->post("/shelves/{$shelf->slug}/manage/copies/{$copy->id}/report-lost", [])
        ->assertRedirect("/shelves/{$shelf->slug}/manage/books/{$book->slug}")
        ->assertSessionHasErrors(['rule' => __('rules.copy_not_on_loan')]);
});

it('the lost screen lists lost copies', function () {
    [$shelf, $user] = scrManager();
    $book = scrBook($shelf, $user);
    $book->copies->first()->withoutRelations()->update(['state' => 'lost']);

    $this->actingAs($user)
        ->get("/shelves/{$shelf->slug}/manage/books/lost")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('manage/books/lost')
            ->has('copies', 1)
            ->where('copies.0.code', 'DT-0001'));
});

it('a reader gets 404 on every manager screen and write, a guest a login redirect', function () {
    [$shelf, $manager] = scrManager();
    $book = scrBook($shelf, $manager);
    $reader = User::factory()->create();
    Membership::factory()->for($shelf)->create([
        'user_id' => $reader->id, 'role' => 'reader', 'status' => 'active',
    ]);

    $urls = [
        ['get', "/shelves/{$shelf->slug}/manage/books"],
        ['get', "/shelves/{$shelf->slug}/manage/books/create"],
        ['get', "/shelves/{$shelf->slug}/manage/books/lost"],
        ['get', "/shelves/{$shelf->slug}/manage/books/{$book->slug}"],
        ['post', "/shelves/{$shelf->slug}/manage/books"],
    ];

    foreach ($urls as [$method, $url]) {
        $this->actingAs($reader)->{$method}($url)->assertNotFound();   // 404, never 403 — the URL space confirms nothing
    }

    $this->post("/shelves/{$shelf->slug}/manage/books")->assertRedirect('/login');
});

it('another shelf\'s book slug and copy id are 404 through the scoped bindings', function () {
    [$shelf, $user] = scrManager();
    // A title unique to shelf A: TenantHarness's shelves both carry
    // de-men-phieu-luu-ky by design, so probing with THAT slug would prove
    // nothing (shelf B's manager would legitimately see shelf B's own
    // colliding book). chi-co-o-dong-thap exists on shelf A alone, so the
    // foreign GET's 404 is unambiguous.
    $book = scrBook($shelf, $user, ['title' => 'Chỉ Có Ở Đồng Tháp']);
    $copy = $book->copies->first();

    // A plain factory shelf, NOT TenantHarness::twoCollidingShelves():
    // the harness creates slug dong-thap, which scrManager() already
    // claimed — bookshelves_slug_unique (1062) would kill the test in
    // setup, before it asserted anything.
    $foreign = Bookshelf::factory()->create(['settings' => []]);
    $foreignManager = User::factory()->create();
    Membership::factory()->for($foreign)->create([
        'user_id' => $foreignManager->id, 'role' => 'manager', 'status' => 'active',
    ]);

    $this->actingAs($foreignManager)
        ->get("/shelves/{$foreign->slug}/manage/books/{$book->slug}")
        ->assertNotFound();
    $this->actingAs($foreignManager)
        ->post("/shelves/{$foreign->slug}/manage/copies/{$copy->id}/assess", ['condition' => 'worn'])
        ->assertNotFound();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `make test FILTER=ManageBookScreensTest` — Expected: FAIL (the GET routes render `under-construction`, the POST routes do not exist → 405/404 and component-name mismatches)

- [ ] **Step 3: Rewrite the manage `books` block in `routes/web.php`**

Replace the five `ShellController`-bound `books` lines inside the `manage` group with (imports at top: `use App\Http\Controllers\Manage\BookController; use App\Http\Controllers\Manage\CopyController; use App\Http\Controllers\Manage\LostCopiesController;`):

```php
        // ORDER IS LOAD-BEARING (spec §6): create and lost BEFORE {book},
        // or Laravel binds "lost" as a slug. RouteOrderTest pins this.
        Route::get('/books', [BookController::class, 'index'])->name('books.index');
        Route::get('/books/create', [BookController::class, 'create'])->name('books.create');
        Route::post('/books', [BookController::class, 'store'])->name('books.store');
        Route::get('/books/lost', [LostCopiesController::class, 'index'])->name('books.lost');
        Route::get('/books/{book}', [BookController::class, 'show'])->name('books.show');
        Route::get('/books/{book}/edit', [BookController::class, 'edit'])->name('books.edit');
        Route::patch('/books/{book}', [BookController::class, 'update'])->name('books.update');
        Route::post('/books/{book}/copies', [CopyController::class, 'store'])->name('books.copies.store');

        // {bookCopy}, not {copy}: under scopeBindings() the child binding
        // resolves through the parent relation guessed from the parameter
        // name — bookCopy → Bookshelf::bookCopies() — which is what makes a
        // foreign shelf's copy id a 404 instead of a cross-tenant hit.
        Route::post('/copies/{bookCopy}/assess', [CopyController::class, 'assess'])->name('copies.assess');
        Route::post('/copies/{bookCopy}/retire', [CopyController::class, 'retire'])->name('copies.retire');
        Route::post('/copies/{bookCopy}/report-lost', [CopyController::class, 'reportLost'])->name('copies.report-lost');
        Route::post('/copies/{bookCopy}/mark-found', [CopyController::class, 'markFound'])->name('copies.mark-found');
```

There is deliberately **no** `DELETE /books/{book}` route — see this task's interface note.

- [ ] **Step 4: Write the three controllers**

`app/Http/Controllers/Manage/BookController.php`:

```php
<?php

namespace App\Http\Controllers\Manage;

use App\Actions\Catalogue\CreateBook;
use App\Actions\Catalogue\UpdateBook;
use App\Http\Controllers\Controller;
use App\Http\Requests\Catalogue\StoreBookRequest;
use App\Http\Requests\Catalogue\UpdateBookRequest;
use App\Models\Book;
use App\Models\Bookshelf;
use App\Queries\BookForEditQuery;
use App\Queries\BooksListQuery;
use App\Queries\CategoryQuery;
use App\Queries\LostCopiesQuery;
use App\Queries\ManagerBookDetailQuery;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Inertia\Inertia;
use Inertia\Response;

/**
 * Thin by design (spec §1.3): queries in, Inertia out; every write is an
 * Action. The role:manager middleware already gated the group; the
 * per-model policy check is the second lock BR §13.3 requires.
 */
class BookController extends Controller
{
    public function index(Request $request, Bookshelf $shelf, BooksListQuery $list, CategoryQuery $categories, LostCopiesQuery $lost): Response
    {
        Gate::authorize('viewAny', Book::class);

        return Inertia::render('manage/books/index', [
            'books' => $list->run([
                'q' => $request->query('q'),
                'category' => $request->query('category'),
                'sort' => $request->query('sort') === 'title' ? 'title' : 'recent',
                'page' => (int) $request->query('page', '1'),
            ]),
            // includeDrafts: this list HAS no is_published filter, so its
            // filter bar must reach the categories drafts live in.
            'categories' => $categories->stockedByShelf(includeDrafts: true),
            'lostCount' => $lost->count(),
            'filters' => [
                'q' => (string) $request->query('q', ''),
                'category' => $request->query('category'),
                // Normalised, not echoed — an arbitrary ?sort= must not
                // ride back into the page's own links.
                'sort' => $request->query('sort') === 'title' ? 'title' : 'recent',
            ],
        ]);
    }

    public function create(Bookshelf $shelf, CategoryQuery $categories): Response
    {
        Gate::authorize('create', Book::class);

        return Inertia::render('manage/books/create', [
            // allOptions, NOT stockedByShelf: the create form must reach
            // the category a shelf's first book of a kind belongs to.
            'categories' => $categories->allOptions(),
        ]);
    }

    public function store(StoreBookRequest $request, Bookshelf $shelf, CreateBook $createBook): RedirectResponse
    {
        $book = $createBook->execute($request->user(), $request->validated());

        return redirect()->route('shelves.manage.books.show', ['shelf' => $shelf->slug, 'book' => $book->slug]);
    }

    public function show(Bookshelf $shelf, Book $book, ManagerBookDetailQuery $detail): Response
    {
        Gate::authorize('manage', $book);

        return Inertia::render('manage/books/show', [
            'detail' => $detail->run($book),
        ]);
    }

    public function edit(Bookshelf $shelf, Book $book, BookForEditQuery $form, CategoryQuery $categories): Response
    {
        Gate::authorize('manage', $book);

        return Inertia::render('manage/books/edit', [
            'book' => $form->run($book),
            'categories' => $categories->allOptions(),
        ]);
    }

    public function update(UpdateBookRequest $request, Bookshelf $shelf, Book $book, UpdateBook $updateBook): RedirectResponse
    {
        $updateBook->execute($request->user(), $book, $request->validated());

        return redirect()->route('shelves.manage.books.show', ['shelf' => $shelf->slug, 'book' => $book->slug]);
    }
}
```

`app/Http/Controllers/Manage/CopyController.php`:

```php
<?php

namespace App\Http\Controllers\Manage;

use App\Actions\Catalogue\AddCopies;
use App\Actions\Catalogue\AssessCondition;
use App\Actions\Catalogue\MarkCopyFound;
use App\Actions\Catalogue\ReportCopyLost;
use App\Actions\Catalogue\RetireCopy;
use App\Enums\CopyCondition;
use App\Http\Controllers\Controller;
use App\Http\Requests\Catalogue\AddCopiesRequest;
use App\Http\Requests\Catalogue\AssessConditionRequest;
use App\Http\Requests\Catalogue\CopyNoteRequest;
use App\Http\Requests\Catalogue\RetireCopyRequest;
use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Facades\Gate;

class CopyController extends Controller
{
    public function store(AddCopiesRequest $request, Bookshelf $shelf, Book $book, AddCopies $addCopies): RedirectResponse
    {
        $addCopies->execute($request->user(), $book, $request->validated());

        return redirect()->route('shelves.manage.books.show', ['shelf' => $shelf->slug, 'book' => $book->slug]);
    }

    public function assess(AssessConditionRequest $request, Bookshelf $shelf, BookCopy $bookCopy, AssessCondition $assess): RedirectResponse
    {
        $validated = $request->validated();
        $assess->execute(
            $request->user(),
            $bookCopy,
            CopyCondition::from($validated['condition']),
            $validated['note'] ?? null,
        );

        return back();
    }

    public function retire(RetireCopyRequest $request, Bookshelf $shelf, BookCopy $bookCopy, RetireCopy $retire): RedirectResponse
    {
        $retire->execute($request->user(), $bookCopy, $request->validated()['reason']);

        return back();
    }

    public function reportLost(CopyNoteRequest $request, Bookshelf $shelf, BookCopy $bookCopy, ReportCopyLost $report): RedirectResponse
    {
        // CopyNoteRequest validates shape only; the ability differs between
        // this route and mark-found, so it is authorized here by name.
        Gate::authorize('reportLost', $bookCopy);
        $report->execute($request->user(), $bookCopy, $request->validated()['note'] ?? null);

        return back();
    }

    public function markFound(CopyNoteRequest $request, Bookshelf $shelf, BookCopy $bookCopy, MarkCopyFound $found): RedirectResponse
    {
        Gate::authorize('markFound', $bookCopy);
        $found->execute($request->user(), $bookCopy, $request->validated()['note'] ?? null);

        return back();
    }
}
```

`app/Http/Controllers/Manage/LostCopiesController.php`:

```php
<?php

namespace App\Http\Controllers\Manage;

use App\Http\Controllers\Controller;
use App\Models\Book;
use App\Models\Bookshelf;
use App\Queries\LostCopiesQuery;
use Illuminate\Support\Facades\Gate;
use Inertia\Inertia;
use Inertia\Response;

class LostCopiesController extends Controller
{
    public function index(Bookshelf $shelf, LostCopiesQuery $lost): Response
    {
        Gate::authorize('viewAny', Book::class);

        return Inertia::render('manage/books/lost', [
            'copies' => $lost->rows(),
        ]);
    }
}
```

- [ ] **Step 5: Add the client copy**

In `resources/js/lib/copy.ts`, add two namespaces to the `copy` object (touch nothing existing). Vietnamese verbatim from the reference screens and BR §16.3; `CONDITION_LABELS` and the state words are BR §9/§7.1's by way of `old_next/src/domain/catalogue/policy.ts` and `old_next/src/lib/status.ts`:

```ts
    catalogue: {
        title: "Danh mục sách",
        searchTitle: "Tìm kiếm",
        searchPlaceholder: "Tìm theo tên sách hoặc tác giả…",
        scopeAvailable: "Sách có sẵn",
        scopeAll: "Tất cả",
        sortRecent: "Mới thêm",
        sortTitle: "Tên sách",
        allCategories: "Mọi thể loại",
        emptyList: "Không có sách nào khớp với bộ lọc.",
        emptySearch: "Không tìm thấy sách nào.",
        totalCount: "{count} đầu sách",
        pagePrev: "Trang trước",
        pageNext: "Trang sau",
        pageOf: "Trang {page}/{pageCount}",
        copyCountLine: "{available} bản có sẵn · {onLoan} đang cho mượn · {total} bản trong tủ",
        queueLine: "{count} người đang chờ mượn",
        holderLine: "{name} đang mượn, còn {days} ngày",
        holderLineAnonymous: "Đang có người mượn, còn {days} ngày",
        holderLineOverdue: "{name} đang mượn, quá hạn {days} ngày",
        contactBefore: "Liên hệ {name} · ",
        contactAfter: " để nhận sách",
        author: "Tác giả",
        publisher: "Nhà xuất bản",
        publishedYear: "Năm xuất bản",
        pageCount: "Số trang",
        category: "Thể loại",
        isbn: "Mã ISBN",
        description: "Giới thiệu",
        state: {
            available: "Có sẵn",
            on_loan: "Đang cho mượn",
            held: "Đang giữ chỗ",
            lost: "Đã mất",
            retired: "Ngừng dùng",
            none: "Chưa có bản nào",
        },
        condition: {
            perfect: "Nguyên vẹn",
            slightly_worn: "Hơi cũ",
            worn: "Cũ",
            torn: "Rách",
            missing_pages: "Mất trang",
            written_on: "Bị vẽ vào",
        },
    },
    manageBooks: {
        title: "Sách",
        addBook: "Thêm sách mới",
        editBook: "Sửa sách",
        viewCopies: "Xem bản",
        lostChip: "Đã mất ({count})",
        draftBadge: "Bản nháp",
        fields: {
            title: "Tên sách",
            author: "Tác giả",
            category: "Thể loại",
            categoryEmpty: "— chọn thể loại —",
            publisher: "Nhà xuất bản",
            publishedYear: "Năm xuất bản",
            pageCount: "Số trang",
            isbn: "Mã ISBN",
            description: "Giới thiệu",
            copyCount: "Số bản sách",
            donorName: "Người tặng (nếu có)",
            acquiredOn: "Ngày nhận",
            isPublished: "Hiện sách này cho bạn đọc",
        },
        save: "Lưu",
        saving: "Đang lưu…",
        copiesHeading: "Các bản sách",
        addCopies: "Thêm bản",
        addCopiesCount: "Số bản thêm",
        copyCode: "Mã",
        copyState: "Trạng thái",
        copyCondition: "Tình trạng",
        copyWhere: "Đang ở đâu",
        onShelf: "Trên kệ",
        withReader: "{name} mượn, hẹn trả {date}",
        overdueBadge: "Quá hạn",
        donorColumn: "Người tặng",
        assess: "Đánh giá",
        assessNote: "Ghi chú",
        reportLost: "Báo mất",
        markFound: "Đánh dấu tìm thấy",
        retire: "Ngừng dùng",
        retireReason: "Lý do ngừng dùng",
        retiredWithReason: "Ngừng dùng: {reason}",
        confirm: "Xác nhận",
        cancel: "Huỷ",
        conditionHistory: "Lịch sử đánh giá",
        loanHistory: "Lịch sử mượn trả",
        historyEmpty: "Chưa có dữ liệu.",
        lostTitle: "Sách đã mất",
        lostEmpty: "Không có bản sách nào đang bị báo mất.",
        lostReportedAt: "Báo mất lúc {date}",
        lostLastBorrower: "Người mượn gần nhất: {name}",
        backToList: "Về danh sách sách",
    },
```

- [ ] **Step 6: Write the shared form component `resources/js/components/book-fields.tsx`**

```tsx
import type { ChangeEvent } from "react";
import InputError from "@/components/input-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { copy } from "@/lib/copy";

export interface BookFieldsData {
    title: string;
    author: string;
    category_slug: string;
    publisher: string;
    published_year: string;
    page_count: string;
    isbn: string;
    description: string;
    is_published: boolean;
}

/**
 * The create and edit forms' shared fields — single-column, per BR §16.3.
 * No cover uploader, matching the reference (plan divergence 6); the donor
 * fields are the CREATE form's own (a title's later copies have their own
 * donors), so they live in create.tsx, not here.
 */
export default function BookFields({
    data,
    errors,
    categories,
    onChange,
}: {
    data: BookFieldsData;
    errors: Partial<Record<string, string>>;
    categories: { slug: string; name: string }[];
    onChange: <K extends keyof BookFieldsData>(field: K, value: BookFieldsData[K]) => void;
}) {
    const text =
        (field: keyof BookFieldsData) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
            onChange(field, event.target.value as BookFieldsData[typeof field]);

    return (
        <div className="space-y-4">
            <div>
                <Label htmlFor="title">{copy.manageBooks.fields.title}</Label>
                <Input id="title" value={data.title} onChange={text("title")} required />
                <InputError message={errors.title} />
            </div>
            <div>
                <Label htmlFor="author">{copy.manageBooks.fields.author}</Label>
                <Input id="author" value={data.author} onChange={text("author")} required />
                <InputError message={errors.author} />
            </div>
            <div>
                <Label htmlFor="category_slug">{copy.manageBooks.fields.category}</Label>
                <select
                    id="category_slug"
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    value={data.category_slug}
                    onChange={(event) => onChange("category_slug", event.target.value)}
                    required
                >
                    <option value="">{copy.manageBooks.fields.categoryEmpty}</option>
                    {categories.map((category) => (
                        <option key={category.slug} value={category.slug}>
                            {category.name}
                        </option>
                    ))}
                </select>
                <InputError message={errors.category_slug} />
            </div>
            <div className="grid grid-cols-2 gap-4">
                <div>
                    <Label htmlFor="publisher">{copy.manageBooks.fields.publisher}</Label>
                    <Input id="publisher" value={data.publisher} onChange={text("publisher")} />
                    <InputError message={errors.publisher} />
                </div>
                <div>
                    <Label htmlFor="published_year">{copy.manageBooks.fields.publishedYear}</Label>
                    <Input
                        id="published_year"
                        type="number"
                        value={data.published_year}
                        onChange={text("published_year")}
                    />
                    <InputError message={errors.published_year} />
                </div>
                <div>
                    <Label htmlFor="page_count">{copy.manageBooks.fields.pageCount}</Label>
                    <Input id="page_count" type="number" value={data.page_count} onChange={text("page_count")} />
                    <InputError message={errors.page_count} />
                </div>
                <div>
                    <Label htmlFor="isbn">{copy.manageBooks.fields.isbn}</Label>
                    <Input id="isbn" value={data.isbn} onChange={text("isbn")} />
                    <InputError message={errors.isbn} />
                </div>
            </div>
            <div>
                <Label htmlFor="description">{copy.manageBooks.fields.description}</Label>
                <textarea
                    id="description"
                    className="min-h-24 w-full rounded-md border bg-background px-3 py-2 text-sm"
                    value={data.description}
                    onChange={text("description")}
                />
                <InputError message={errors.description} />
            </div>
            <label className="flex items-center gap-2 text-sm">
                <input
                    type="checkbox"
                    checked={data.is_published}
                    onChange={(event) => onChange("is_published", event.target.checked)}
                />
                {copy.manageBooks.fields.isPublished}
            </label>
        </div>
    );
}
```

- [ ] **Step 7: Write the five pages**

`resources/js/pages/manage/books/index.tsx`:

```tsx
import { Head, Link, router, usePage } from "@inertiajs/react";
import type { FormEvent } from "react";
import { useState } from "react";
import { route } from "ziggy-js";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ManageLayout from "@/layouts/manage-layout";
import { copy, t } from "@/lib/copy";
import type { SharedData } from "@/types";

interface BookRow {
    bookId: string;
    slug: string;
    title: string;
    author: string | null;
    category: string | null;
    copiesTotal: number;
    copiesAvailable: number;
    availability: keyof typeof copy.catalogue.state;
    isPublished: boolean;
    codes: string;
}

interface PageProps extends SharedData {
    books: { rows: BookRow[]; page: number; pageCount: number; total: number };
    categories: { slug: string; name: string }[];
    lostCount: number;
    filters: { q: string; category: string | null; sort: string };
}

export default function ManageBooksIndex() {
    const { shelf, books, categories, lostCount, filters } = usePage<PageProps>().props;
    const [q, setQ] = useState(filters.q);
    if (!shelf) return null;

    const indexRoute = (over: Record<string, string | number | null>) =>
        route("shelves.manage.books.index", {
            shelf: shelf.slug,
            q: filters.q || undefined,
            category: filters.category ?? undefined,
            sort: filters.sort !== "recent" ? filters.sort : undefined,
            ...over,
        });

    const submitSearch = (event: FormEvent) => {
        event.preventDefault();
        router.get(indexRoute({ q: q || null, page: null }), {}, { preserveState: true });
    };

    return (
        <ManageLayout>
            <Head title={copy.manageBooks.title} />
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h1 className="text-2xl font-semibold">{copy.manageBooks.title}</h1>
                <div className="flex gap-2">
                    <Button asChild variant="outline">
                        <Link href={route("shelves.manage.books.lost", { shelf: shelf.slug })}>
                            {t(copy.manageBooks.lostChip, { count: lostCount })}
                        </Link>
                    </Button>
                    <Button asChild>
                        <Link href={route("shelves.manage.books.create", { shelf: shelf.slug })}>
                            {copy.manageBooks.addBook}
                        </Link>
                    </Button>
                </div>
            </div>

            <form onSubmit={submitSearch} className="mb-4 flex flex-wrap gap-2">
                <Input
                    value={q}
                    onChange={(event) => setQ(event.target.value)}
                    placeholder={copy.catalogue.searchPlaceholder}
                    className="max-w-xs"
                />
                <select
                    className="rounded-md border bg-background px-3 py-2 text-sm"
                    value={filters.category ?? ""}
                    onChange={(event) =>
                        router.get(indexRoute({ category: event.target.value || null, page: null }))
                    }
                >
                    <option value="">{copy.catalogue.allCategories}</option>
                    {categories.map((category) => (
                        <option key={category.slug} value={category.slug}>
                            {category.name}
                        </option>
                    ))}
                </select>
                <select
                    className="rounded-md border bg-background px-3 py-2 text-sm"
                    value={filters.sort}
                    onChange={(event) => router.get(indexRoute({ sort: event.target.value, page: null }))}
                >
                    <option value="recent">{copy.catalogue.sortRecent}</option>
                    <option value="title">{copy.catalogue.sortTitle}</option>
                </select>
            </form>

            {books.rows.length === 0 ? (
                <p className="text-muted-foreground">{copy.catalogue.emptyList}</p>
            ) : (
                <ul className="divide-y rounded-md border">
                    {books.rows.map((book) => (
                        <li key={book.bookId} className="flex flex-wrap items-center justify-between gap-2 p-3">
                            <div>
                                <Link
                                    href={route("shelves.manage.books.show", { shelf: shelf.slug, book: book.slug })}
                                    className="font-medium"
                                >
                                    {book.title}
                                </Link>
                                <p className="text-sm text-muted-foreground">
                                    {[book.author, book.category, book.codes].filter(Boolean).join(" · ")}
                                </p>
                            </div>
                            <div className="flex items-center gap-2">
                                {!book.isPublished ? (
                                    <Badge variant="outline">{copy.manageBooks.draftBadge}</Badge>
                                ) : null}
                                <Badge>{copy.catalogue.state[book.availability]}</Badge>
                                <span className="text-sm text-muted-foreground">
                                    {t(copy.catalogue.copyCountLine, {
                                        available: book.copiesAvailable,
                                        onLoan: book.copiesTotal - book.copiesAvailable,
                                        total: book.copiesTotal,
                                    })}
                                </span>
                            </div>
                        </li>
                    ))}
                </ul>
            )}

            {books.pageCount > 1 ? (
                <nav className="mt-4 flex items-center gap-3">
                    {books.page > 1 ? (
                        <Link href={indexRoute({ page: books.page - 1 })}>{copy.catalogue.pagePrev}</Link>
                    ) : null}
                    <span className="text-sm text-muted-foreground">
                        {t(copy.catalogue.pageOf, { page: books.page, pageCount: books.pageCount })}
                    </span>
                    {books.page < books.pageCount ? (
                        <Link href={indexRoute({ page: books.page + 1 })}>{copy.catalogue.pageNext}</Link>
                    ) : null}
                </nav>
            ) : null}
        </ManageLayout>
    );
}
```

(A wording note on that summary line: the index reuses `copyCountLine` with `onLoan` computed as `copiesTotal - copiesAvailable` — on this list the middle figure means "not currently borrowable", which includes held copies. The detail pages pass the true `onLoan` count. This is the same approximation the reference list makes by showing only total/available on cards; if it reads wrongly in review, drop the middle clause from the list line rather than adding a per-row on-loan count to the query.)

`resources/js/pages/manage/books/create.tsx`:

```tsx
import { Head, useForm, usePage } from "@inertiajs/react";
import type { FormEvent } from "react";
import { route } from "ziggy-js";
import BookFields, { type BookFieldsData } from "@/components/book-fields";
import InputError from "@/components/input-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import ManageLayout from "@/layouts/manage-layout";
import { copy } from "@/lib/copy";
import type { SharedData } from "@/types";

interface PageProps extends SharedData {
    categories: { slug: string; name: string }[];
}

type CreateForm = BookFieldsData & {
    copy_count: string;
    donor_name: string;
    acquired_on: string;
};

export default function ManageBooksCreate() {
    // `rule` (a business refusal, e.g. donor_ambiguous) arrives through the
    // shared errors prop, not useForm's field errors — its key is no form
    // field, so read it from the page.
    const { shelf, categories, errors: pageErrors } = usePage<PageProps>().props;
    const form = useForm<CreateForm>({
        title: "",
        author: "",
        category_slug: "",
        publisher: "",
        published_year: "",
        page_count: "",
        isbn: "",
        description: "",
        is_published: true,
        copy_count: "1",
        donor_name: "",
        acquired_on: "",
    });
    if (!shelf) return null;

    const submit = (event: FormEvent) => {
        event.preventDefault();
        form.transform((data) => ({
            ...data,
            publisher: data.publisher || null,
            published_year: data.published_year === "" ? null : Number(data.published_year),
            page_count: data.page_count === "" ? null : Number(data.page_count),
            isbn: data.isbn || null,
            description: data.description || null,
            copy_count: Number(data.copy_count),
            donor_name: data.donor_name || null,
            acquired_on: data.acquired_on || null,
        }));
        form.post(route("shelves.manage.books.store", { shelf: shelf.slug }));
    };

    return (
        <ManageLayout>
            <Head title={copy.manageBooks.addBook} />
            <h1 className="mb-4 text-2xl font-semibold">{copy.manageBooks.addBook}</h1>
            <form onSubmit={submit} className="max-w-xl space-y-4">
                <BookFields
                    data={form.data}
                    errors={form.errors}
                    categories={categories}
                    onChange={(field, value) => form.setData(field, value)}
                />
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <Label htmlFor="copy_count">{copy.manageBooks.fields.copyCount}</Label>
                        <Input
                            id="copy_count"
                            type="number"
                            min={1}
                            value={form.data.copy_count}
                            onChange={(event) => form.setData("copy_count", event.target.value)}
                            required
                        />
                        <InputError message={form.errors.copy_count} />
                    </div>
                    <div>
                        <Label htmlFor="acquired_on">{copy.manageBooks.fields.acquiredOn}</Label>
                        <Input
                            id="acquired_on"
                            type="date"
                            value={form.data.acquired_on}
                            onChange={(event) => form.setData("acquired_on", event.target.value)}
                        />
                        <InputError message={form.errors.acquired_on} />
                    </div>
                </div>
                <div>
                    <Label htmlFor="donor_name">{copy.manageBooks.fields.donorName}</Label>
                    <Input
                        id="donor_name"
                        value={form.data.donor_name}
                        onChange={(event) => form.setData("donor_name", event.target.value)}
                    />
                    <InputError message={form.errors.donor_name} />
                </div>
                <InputError message={pageErrors.rule} />
                <Button type="submit" disabled={form.processing}>
                    {form.processing ? copy.manageBooks.saving : copy.manageBooks.save}
                </Button>
            </form>
        </ManageLayout>
    );
}
```

`resources/js/pages/manage/books/edit.tsx`:

```tsx
import { Head, useForm, usePage } from "@inertiajs/react";
import type { FormEvent } from "react";
import { route } from "ziggy-js";
import BookFields, { type BookFieldsData } from "@/components/book-fields";
import InputError from "@/components/input-error";
import { Button } from "@/components/ui/button";
import ManageLayout from "@/layouts/manage-layout";
import { copy } from "@/lib/copy";
import type { SharedData } from "@/types";

interface PageProps extends SharedData {
    book: {
        bookId: string;
        slug: string;
        title: string;
        author: string | null;
        categorySlug: string | null;
        publisher: string | null;
        publishedYear: number | null;
        pageCount: number | null;
        isbn: string | null;
        description: string | null;
        isPublished: boolean;
    };
    categories: { slug: string; name: string }[];
}

export default function ManageBooksEdit() {
    const { shelf, book, categories, errors: pageErrors } = usePage<PageProps>().props;
    const form = useForm<BookFieldsData>({
        title: book.title,
        author: book.author ?? "",
        category_slug: book.categorySlug ?? "",
        publisher: book.publisher ?? "",
        published_year: book.publishedYear?.toString() ?? "",
        page_count: book.pageCount?.toString() ?? "",
        isbn: book.isbn ?? "",
        description: book.description ?? "",
        is_published: book.isPublished,
    });
    if (!shelf) return null;

    const submit = (event: FormEvent) => {
        event.preventDefault();
        form.transform((data) => ({
            ...data,
            publisher: data.publisher || null,
            published_year: data.published_year === "" ? null : Number(data.published_year),
            page_count: data.page_count === "" ? null : Number(data.page_count),
            isbn: data.isbn || null,
            description: data.description || null,
        }));
        form.patch(route("shelves.manage.books.update", { shelf: shelf.slug, book: book.slug }));
    };

    return (
        <ManageLayout>
            <Head title={copy.manageBooks.editBook} />
            <h1 className="mb-4 text-2xl font-semibold">{copy.manageBooks.editBook}</h1>
            <form onSubmit={submit} className="max-w-xl space-y-4">
                <BookFields
                    data={form.data}
                    errors={form.errors}
                    categories={categories}
                    onChange={(field, value) => form.setData(field, value)}
                />
                <InputError message={pageErrors.rule} />
                <Button type="submit" disabled={form.processing}>
                    {form.processing ? copy.manageBooks.saving : copy.manageBooks.save}
                </Button>
            </form>
        </ManageLayout>
    );
}
```

`resources/js/pages/manage/books/show.tsx`:

```tsx
import { Head, Link, router, usePage } from "@inertiajs/react";
import { useState } from "react";
import { route } from "ziggy-js";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ManageLayout from "@/layouts/manage-layout";
import { copy, t } from "@/lib/copy";
import type { SharedData } from "@/types";

type ConditionKey = keyof typeof copy.catalogue.condition;

interface CopyRow {
    copyId: string;
    code: string;
    state: keyof typeof copy.catalogue.state;
    condition: ConditionKey;
    conditionNote: string | null;
    acquiredOn: string | null;
    acquiredFrom: string | null;
    acquiredFromMembershipName: string | null;
    holderName: string | null;
    dueOn: string | null;
    isOverdue: boolean;
    retiredReason: string | null;
}

interface PageProps extends SharedData {
    detail: {
        book: {
            bookId: string;
            slug: string;
            title: string;
            author: string | null;
            category: string | null;
            copiesTotal: number;
            copiesAvailable: number;
            availability: keyof typeof copy.catalogue.state;
            isPublished: boolean;
            codes: string;
        };
        onLoan: number;
        copies: CopyRow[];
        conditionHistory: {
            assessedAt: string;
            copyCode: string | null;
            assessorName: string | null;
            condition: ConditionKey;
            note: string | null;
        }[];
        loanHistory: {
            loanId: string;
            copyCode: string | null;
            borrowerName: string | null;
            lentAt: string;
            returnedAt: string | null;
            status: string;
            returnCondition: ConditionKey | null;
        }[];
    };
    errors: Record<string, string>;
}

const DATE = new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeZone: "Asia/Ho_Chi_Minh" });

function CopyActions({ copyRow, shelfSlug }: { copyRow: CopyRow; shelfSlug: string }) {
    const [assessing, setAssessing] = useState(false);
    const [condition, setCondition] = useState<ConditionKey>(copyRow.condition);
    const [note, setNote] = useState("");
    const [retiring, setRetiring] = useState(false);
    const [reason, setReason] = useState("");

    const post = (name: string, data: Record<string, string> = {}) =>
        router.post(route(name, { shelf: shelfSlug, bookCopy: copyRow.copyId }), data, {
            preserveScroll: true,
        });

    if (assessing) {
        return (
            <div className="flex flex-wrap items-center gap-2">
                <div className="flex flex-wrap gap-1">
                    {(Object.keys(copy.catalogue.condition) as ConditionKey[]).map((key) => (
                        <Button
                            key={key}
                            size="sm"
                            variant={condition === key ? "default" : "outline"}
                            onClick={() => setCondition(key)}
                        >
                            {copy.catalogue.condition[key]}
                        </Button>
                    ))}
                </div>
                <Input
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder={copy.manageBooks.assessNote}
                    className="max-w-40"
                />
                <Button
                    size="sm"
                    onClick={() => {
                        post("shelves.manage.copies.assess", { condition, note });
                        setAssessing(false);
                    }}
                >
                    {copy.manageBooks.confirm}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setAssessing(false)}>
                    {copy.manageBooks.cancel}
                </Button>
            </div>
        );
    }

    if (retiring) {
        return (
            <div className="flex flex-wrap items-center gap-2">
                <Input
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder={copy.manageBooks.retireReason}
                    className="max-w-56"
                />
                <Button
                    size="sm"
                    onClick={() => {
                        post("shelves.manage.copies.retire", { reason });
                        setRetiring(false);
                    }}
                    disabled={reason.trim() === ""}
                >
                    {copy.manageBooks.confirm}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setRetiring(false)}>
                    {copy.manageBooks.cancel}
                </Button>
            </div>
        );
    }

    return (
        <div className="flex flex-wrap gap-1">
            <Button size="sm" variant="outline" onClick={() => setAssessing(true)}>
                {copy.manageBooks.assess}
            </Button>
            {copyRow.state === "on_loan" ? (
                <Button size="sm" variant="outline" onClick={() => post("shelves.manage.copies.report-lost")}>
                    {copy.manageBooks.reportLost}
                </Button>
            ) : null}
            {copyRow.state === "lost" ? (
                <Button size="sm" variant="outline" onClick={() => post("shelves.manage.copies.mark-found")}>
                    {copy.manageBooks.markFound}
                </Button>
            ) : null}
            {copyRow.state === "available" || copyRow.state === "lost" ? (
                <Button size="sm" variant="outline" onClick={() => setRetiring(true)}>
                    {copy.manageBooks.retire}
                </Button>
            ) : null}
        </div>
    );
}

export default function ManageBooksShow() {
    const { shelf, detail, errors } = usePage<PageProps>().props;
    const [addCount, setAddCount] = useState("1");
    if (!shelf) return null;

    const { book } = detail;

    return (
        <ManageLayout>
            <Head title={book.title} />
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-semibold">{book.title}</h1>
                    <p className="text-muted-foreground">
                        {[book.author, book.category, book.codes].filter(Boolean).join(" · ")}
                    </p>
                    <p className="text-sm text-muted-foreground">
                        {t(copy.catalogue.copyCountLine, {
                            available: book.copiesAvailable,
                            onLoan: detail.onLoan,
                            total: book.copiesTotal,
                        })}
                    </p>
                </div>
                <div className="flex gap-2">
                    {!book.isPublished ? <Badge variant="outline">{copy.manageBooks.draftBadge}</Badge> : null}
                    <Button asChild variant="outline">
                        <Link href={route("shelves.manage.books.edit", { shelf: shelf.slug, book: book.slug })}>
                            {copy.manageBooks.editBook}
                        </Link>
                    </Button>
                </div>
            </div>

            {errors.rule ? <p className="mb-4 text-sm text-destructive">{errors.rule}</p> : null}

            <section className="mb-6">
                <div className="mb-2 flex items-center justify-between">
                    <h2 className="text-lg font-medium">{copy.manageBooks.copiesHeading}</h2>
                    <form
                        className="flex items-center gap-2"
                        onSubmit={(event) => {
                            event.preventDefault();
                            router.post(
                                route("shelves.manage.books.copies.store", { shelf: shelf.slug, book: book.slug }),
                                { count: Number(addCount) },
                                { preserveScroll: true },
                            );
                        }}
                    >
                        <Input
                            type="number"
                            min={1}
                            value={addCount}
                            onChange={(event) => setAddCount(event.target.value)}
                            className="w-20"
                            aria-label={copy.manageBooks.addCopiesCount}
                        />
                        <Button type="submit" size="sm">
                            {copy.manageBooks.addCopies}
                        </Button>
                    </form>
                </div>
                <ul className="divide-y rounded-md border">
                    {detail.copies.map((copyRow) => (
                        <li key={copyRow.copyId} className="space-y-1 p-3">
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="font-mono text-sm">{copyRow.code}</span>
                                <Badge>{copy.catalogue.state[copyRow.state]}</Badge>
                                <Badge variant="outline">{copy.catalogue.condition[copyRow.condition]}</Badge>
                                {copyRow.isOverdue ? (
                                    <Badge variant="destructive">{copy.manageBooks.overdueBadge}</Badge>
                                ) : null}
                                <span className="text-sm text-muted-foreground">
                                    {copyRow.state === "on_loan" && copyRow.holderName && copyRow.dueOn
                                        ? t(copy.manageBooks.withReader, {
                                              name: copyRow.holderName,
                                              date: DATE.format(new Date(copyRow.dueOn)),
                                          })
                                        : copyRow.state === "retired" && copyRow.retiredReason
                                          ? t(copy.manageBooks.retiredWithReason, { reason: copyRow.retiredReason })
                                          : copyRow.state === "available"
                                            ? copy.manageBooks.onShelf
                                            : ""}
                                </span>
                                {copyRow.acquiredFromMembershipName || copyRow.acquiredFrom ? (
                                    <span className="text-sm text-muted-foreground">
                                        {`${copy.manageBooks.donorColumn}: ${copyRow.acquiredFromMembershipName ?? copyRow.acquiredFrom}`}
                                    </span>
                                ) : null}
                            </div>
                            <CopyActions copyRow={copyRow} shelfSlug={shelf.slug} />
                        </li>
                    ))}
                </ul>
            </section>

            <section className="mb-6">
                <h2 className="mb-2 text-lg font-medium">{copy.manageBooks.conditionHistory}</h2>
                {detail.conditionHistory.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{copy.manageBooks.historyEmpty}</p>
                ) : (
                    <ul className="space-y-1 text-sm">
                        {detail.conditionHistory.map((row) => (
                            <li key={`${row.copyCode}-${row.assessedAt}`}>
                                {[
                                    DATE.format(new Date(row.assessedAt)),
                                    row.copyCode,
                                    copy.catalogue.condition[row.condition],
                                    row.assessorName,
                                    row.note,
                                ]
                                    .filter(Boolean)
                                    .join(" · ")}
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            <section>
                <h2 className="mb-2 text-lg font-medium">{copy.manageBooks.loanHistory}</h2>
                {detail.loanHistory.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{copy.manageBooks.historyEmpty}</p>
                ) : (
                    <ul className="space-y-1 text-sm">
                        {detail.loanHistory.map((row) => (
                            <li key={row.loanId}>
                                {[
                                    DATE.format(new Date(row.lentAt)),
                                    row.copyCode,
                                    row.borrowerName,
                                    row.returnCondition ? copy.catalogue.condition[row.returnCondition] : null,
                                ]
                                    .filter(Boolean)
                                    .join(" · ")}
                            </li>
                        ))}
                    </ul>
                )}
            </section>
        </ManageLayout>
    );
}
```

`resources/js/pages/manage/books/lost.tsx`:

```tsx
import { Head, Link, router, usePage } from "@inertiajs/react";
import { useState } from "react";
import { route } from "ziggy-js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ManageLayout from "@/layouts/manage-layout";
import { copy, t } from "@/lib/copy";
import type { SharedData } from "@/types";

interface LostRow {
    copyId: string;
    code: string;
    bookSlug: string;
    title: string;
    author: string | null;
    condition: keyof typeof copy.catalogue.condition;
    reportedAt: string | null;
    lastBorrowerName: string | null;
}

interface PageProps extends SharedData {
    copies: LostRow[];
    errors: Record<string, string>;
}

const DATE = new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Ho_Chi_Minh",
});

/**
 * BR §16.3's Sách đã mất: the shelf-wide lost view, with the same two
 * exits §7.1 draws out of `lost` — Đánh dấu tìm thấy and Ngừng dùng.
 */
function LostRowActions({ copyId, shelfSlug }: { copyId: string; shelfSlug: string }) {
    const [retiring, setRetiring] = useState(false);
    const [reason, setReason] = useState("");

    if (retiring) {
        return (
            <div className="flex items-center gap-2">
                <Input
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder={copy.manageBooks.retireReason}
                    className="max-w-56"
                />
                <Button
                    size="sm"
                    disabled={reason.trim() === ""}
                    onClick={() =>
                        router.post(
                            route("shelves.manage.copies.retire", { shelf: shelfSlug, bookCopy: copyId }),
                            { reason },
                            { preserveScroll: true },
                        )
                    }
                >
                    {copy.manageBooks.confirm}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setRetiring(false)}>
                    {copy.manageBooks.cancel}
                </Button>
            </div>
        );
    }

    return (
        <div className="flex gap-2">
            <Button
                size="sm"
                onClick={() =>
                    router.post(
                        route("shelves.manage.copies.mark-found", { shelf: shelfSlug, bookCopy: copyId }),
                        {},
                        { preserveScroll: true },
                    )
                }
            >
                {copy.manageBooks.markFound}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setRetiring(true)}>
                {copy.manageBooks.retire}
            </Button>
        </div>
    );
}

export default function ManageBooksLost() {
    const { shelf, copies, errors } = usePage<PageProps>().props;
    if (!shelf) return null;

    return (
        <ManageLayout>
            <Head title={copy.manageBooks.lostTitle} />
            <div className="mb-4 flex items-center justify-between">
                <h1 className="text-2xl font-semibold">{copy.manageBooks.lostTitle}</h1>
                <Link href={route("shelves.manage.books.index", { shelf: shelf.slug })} className="text-sm">
                    {copy.manageBooks.backToList}
                </Link>
            </div>

            {errors.rule ? <p className="mb-4 text-sm text-destructive">{errors.rule}</p> : null}

            {copies.length === 0 ? (
                <p className="text-muted-foreground">{copy.manageBooks.lostEmpty}</p>
            ) : (
                <ul className="divide-y rounded-md border">
                    {copies.map((row) => (
                        <li key={row.copyId} className="flex flex-wrap items-center justify-between gap-3 p-3">
                            <div>
                                <Link
                                    href={route("shelves.manage.books.show", { shelf: shelf.slug, book: row.bookSlug })}
                                    className="font-medium"
                                >
                                    {row.title}
                                </Link>
                                <p className="text-sm text-muted-foreground">
                                    {[
                                        row.code,
                                        row.author,
                                        row.reportedAt
                                            ? t(copy.manageBooks.lostReportedAt, {
                                                  date: DATE.format(new Date(row.reportedAt)),
                                              })
                                            : null,
                                        row.lastBorrowerName
                                            ? t(copy.manageBooks.lostLastBorrower, { name: row.lastBorrowerName })
                                            : null,
                                    ]
                                        .filter(Boolean)
                                        .join(" · ")}
                                </p>
                            </div>
                            <LostRowActions copyId={row.copyId} shelfSlug={shelf.slug} />
                        </li>
                    ))}
                </ul>
            )}
        </ManageLayout>
    );
}
```

- [ ] **Step 8: Run the tests and the JS checks**

Run: `make test FILTER=ManageBookScreensTest` — Expected: PASS
Run: `make test FILTER=RouteOrderTest` — Expected: still PASS (create/lost still precede `{book}`; the new write routes carry `auth` + `role:manager` through the group)
Run: `bun run laravel:typecheck && bun run laravel:lint && bun run laravel:build` — Expected: all three clean; `laravel:lint` is Biome over `resources/`, whose `noJsxLiterals` proves no inline Vietnamese slipped into the new TSX.

- [ ] **Step 9: Commit**

```bash
git add routes/web.php app/Http/Controllers/Manage resources/js tests/Feature/Catalogue/ManageBookScreensTest.php
git commit -m "feat: manager book screens — index, create, detail with copy actions, edit, lost"
```

---

### Task 13: The reader's screens — catalogue, search, book detail

**Files:**
- Edit: `routes/web.php` (the three reader lines only: `catalogue`, `search`, `books.show` swap from `ShellController` to the new controllers; names unchanged)
- Create: `app/Http/Controllers/Reader/CatalogueController.php`
- Create: `app/Http/Controllers/Reader/SearchController.php`
- Create: `app/Http/Controllers/Reader/BookController.php`
- Edit: `resources/js/lib/copy.ts` (add the `readerCatalogue` namespace)
- Create: `resources/js/components/book-card.tsx`
- Create: `resources/js/pages/shelves/catalogue.tsx`
- Create: `resources/js/pages/shelves/search.tsx`
- Create: `resources/js/pages/shelves/book.tsx`
- Test: `tests/Feature/Catalogue/ReaderScreensTest.php`

**Read first:** `old_next/src/app/tu-sach/[shelf]/(doc-gia)/danh-muc/page.tsx`, `.../tim-kiem/page.tsx`, `.../sach/[slug]/page.tsx` — layout, control choices (the available/all toggle is a segmented control, "the single most-used control on the page"), and the empty states.

**One scope note.** The book-detail page's **"Xin mượn" / "Đăng ký chờ mượn" button is not wired in 1a** — `CreateBorrowRequest` is a Phase 2 command (spec §11: borrow requests and holds are Phase 2), so the availability panel renders state, counts, queue length and the contact line, and the request button arrives with Phase 2's command. Shipping a button that posts nowhere would be worse than shipping the panel without it. Likewise the comments block (Phase 2) and the manager's **Cho mượn / Nhận trả** shortcuts on this page (1c, with `LendCopy`/`ReceiveReturn`).

**Interfaces:**
- Consumes: `CatalogueQuery::run(array): array`, `SearchQuery::run(string): array`, `BookDetailQuery::run(Book): array` (Task 11), `CategoryQuery::stockedByShelf(): array` (Task 4), the `role:reader` middleware, `TenantContext::membership(): ?Membership` (role for the contact line), `Bookshelf::contacts()` (Phase 0's `HasMany`).
- Produces: the three controllers below; `book-card.tsx` shared by catalogue and search; query-string parameters `scope=all|available`, `category`, `sort=recent|title`, `page`, `q` (divergence 5 — English). The search page's empty state carries BR §16.1's suggestions — a short row of recently added available titles, served through `CatalogueQuery` rather than a second read shape.
- The contact line (BR §16.1, narrowed 2026-08-12): "Liên hệ {tên} · {số} để nhận sách", built from the shelf's **position-1 contact**, shown **to readers only** — hidden when the viewer's role is `manager` or above (they are the person being named). Sent as a `firstContact` prop (`{name, phone}` or `null`); the controller derives the role from `TenantContext`, never the client.

- [ ] **Step 1: Write the failing test**

Create `tests/Feature/Catalogue/ReaderScreensTest.php`:

```php
<?php

use App\Actions\Catalogue\CreateBook;
use App\Models\Book;
use App\Models\Bookshelf;
use App\Models\BookshelfContact;
use App\Models\Category;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Inertia\Testing\AssertableInertia as Assert;

function rdrScreenShelf(): array
{
    $shelf = Bookshelf::factory()->create(['slug' => 'dong-thap', 'settings' => []]);
    BookshelfContact::query()->create([
        'bookshelf_id' => $shelf->id, 'position' => 1, 'name' => 'Anh Ba', 'phone' => '0900000001',
    ]);
    $manager = User::factory()->create();
    Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);
    $reader = User::factory()->create();
    Membership::factory()->for($shelf)->create([
        'user_id' => $reader->id, 'role' => 'reader', 'status' => 'active',
    ]);
    Category::factory()->create(['name' => 'Truyện thiếu nhi', 'slug' => 'truyen-thieu-nhi']);

    return [$shelf, $manager, $reader];
}

function rdrScreenBook(Bookshelf $shelf, User $manager, array $over = []): Book
{
    $membership = Membership::query()->withoutGlobalScope(\App\Models\Scopes\BookshelfScope::class)
        ->where('bookshelf_id', $shelf->id)->where('user_id', $manager->id)->firstOrFail();
    app(TenantContext::class)->set($shelf, $membership);
    test()->actingAs($manager);

    $book = app(CreateBook::class)->execute($manager, array_merge([
        'title' => 'Dế Mèn Phiêu Lưu Ký', 'author' => 'Tô Hoài',
        'category_slug' => 'truyen-thieu-nhi', 'copy_count' => 1,
    ], $over));

    app(TenantContext::class)->clear();

    return $book;
}

it('renders the catalogue grid with rows, categories and paging facts', function () {
    [$shelf, $manager, $reader] = rdrScreenShelf();
    rdrScreenBook($shelf, $manager);

    $this->actingAs($reader)
        ->get("/shelves/{$shelf->slug}/catalogue")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('shelves/catalogue')
            ->has('books.rows', 1)
            ->where('books.rows.0.title', 'Dế Mèn Phiêu Lưu Ký')
            ->where('books.rows.0.availability', 'available')
            ->has('categories')
            ->where('filters.scope', 'available'));
});

it('scope, category, sort and page ride the query string', function () {
    [$shelf, $manager, $reader] = rdrScreenShelf();
    $out = rdrScreenBook($shelf, $manager);
    $out->copies->first()->update(['state' => 'on_loan']);

    $this->actingAs($reader)
        ->get("/shelves/{$shelf->slug}/catalogue?scope=all&sort=title")
        ->assertInertia(fn (Assert $page) => $page
            ->has('books.rows', 1)
            ->where('filters.scope', 'all')
            ->where('filters.sort', 'title'));

    $this->actingAs($reader)
        ->get("/shelves/{$shelf->slug}/catalogue")   // default scope hides the all-out title
        ->assertInertia(fn (Assert $page) => $page->has('books.rows', 0));
});

it('search renders results for the folded term', function () {
    [$shelf, $manager, $reader] = rdrScreenShelf();
    rdrScreenBook($shelf, $manager, ['title' => 'Tìm Kiếm Kho Báu']);

    $this->actingAs($reader)
        ->get("/shelves/{$shelf->slug}/search?q=tim+kiem+kho+bau")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('shelves/search')
            ->has('results', 1)
            ->where('results.0.title', 'Tìm Kiếm Kho Báu')
            ->where('q', 'tim kiem kho bau'));
});

it('an empty search suggests recently added available titles — BR §16.1\'s empty state', function () {
    [$shelf, $manager, $reader] = rdrScreenShelf();
    rdrScreenBook($shelf, $manager);

    $this->actingAs($reader)
        ->get("/shelves/{$shelf->slug}/search")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('shelves/search')
            ->has('results', 0)
            ->has('suggestions', 1)
            ->where('suggestions.0.title', 'Dế Mèn Phiêu Lưu Ký'));
});

it('book detail renders for a reader, with the contact line', function () {
    [$shelf, $manager, $reader] = rdrScreenShelf();
    $book = rdrScreenBook($shelf, $manager);

    $this->actingAs($reader)
        ->get("/shelves/{$shelf->slug}/books/{$book->slug}")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('shelves/book')
            ->where('detail.title', 'Dế Mèn Phiêu Lưu Ký')
            ->where('detail.availability', 'available')
            ->where('firstContact.name', 'Anh Ba')
            ->where('firstContact.phone', '0900000001'));
});

it('a manager sees the same page without the contact line — they are the person named', function () {
    [$shelf, $manager] = rdrScreenShelf();
    $book = rdrScreenBook($shelf, $manager);

    $this->actingAs($manager)
        ->get("/shelves/{$shelf->slug}/books/{$book->slug}")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->where('firstContact', null));
});

it('a draft book 404s on the reader detail page', function () {
    [$shelf, $manager, $reader] = rdrScreenShelf();
    $draft = rdrScreenBook($shelf, $manager, ['title' => 'Bản Nháp', 'is_published' => false]);

    $this->actingAs($reader)
        ->get("/shelves/{$shelf->slug}/books/{$draft->slug}")
        ->assertNotFound();
});

it('a guest is redirected to login; a non-member gets 404', function () {
    [$shelf, $manager] = rdrScreenShelf();
    rdrScreenBook($shelf, $manager);

    $this->get("/shelves/{$shelf->slug}/catalogue")->assertRedirect('/login');

    $stranger = User::factory()->create();   // signed in somewhere, member nowhere
    $this->actingAs($stranger)->get("/shelves/{$shelf->slug}/catalogue")->assertNotFound();
    $this->actingAs($stranger)->get("/shelves/{$shelf->slug}/search")->assertNotFound();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `make test FILTER=ReaderScreensTest` — Expected: FAIL (component mismatch — the routes still render `under-construction`)

- [ ] **Step 3: Swap the three reader routes**

In `routes/web.php`'s reader group, replace the `catalogue`, `search` and `books.show` lines (imports: `use App\Http\Controllers\Reader\BookController as ReaderBookController; use App\Http\Controllers\Reader\CatalogueController; use App\Http\Controllers\Reader\SearchController;`):

```php
        Route::get('/catalogue', [CatalogueController::class, 'index'])->name('catalogue');
        Route::get('/search', [SearchController::class, 'index'])->name('search');
        Route::get('/books/{book}', [ReaderBookController::class, 'show'])->name('books.show');
```

- [ ] **Step 4: Write the three controllers**

`app/Http/Controllers/Reader/CatalogueController.php`:

```php
<?php

namespace App\Http\Controllers\Reader;

use App\Http\Controllers\Controller;
use App\Models\Book;
use App\Models\Bookshelf;
use App\Queries\CatalogueQuery;
use App\Queries\CategoryQuery;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Inertia\Inertia;
use Inertia\Response;

class CatalogueController extends Controller
{
    public function index(Request $request, Bookshelf $shelf, CatalogueQuery $catalogue, CategoryQuery $categories): Response
    {
        Gate::authorize('viewAny', Book::class);

        $scope = $request->query('scope') === 'all' ? 'all' : 'available';
        $sort = $request->query('sort') === 'title' ? 'title' : 'recent';

        return Inertia::render('shelves/catalogue', [
            'books' => $catalogue->run([
                'scope' => $scope,
                'category' => $request->query('category'),
                'sort' => $sort,
                'page' => (int) $request->query('page', '1'),
            ]),
            'categories' => $categories->stockedByShelf(),
            'filters' => [
                'scope' => $scope,
                'category' => $request->query('category'),
                'sort' => $sort,
            ],
        ]);
    }
}
```

`app/Http/Controllers/Reader/SearchController.php`:

```php
<?php

namespace App\Http\Controllers\Reader;

use App\Http\Controllers\Controller;
use App\Models\Book;
use App\Models\Bookshelf;
use App\Queries\CatalogueQuery;
use App\Queries\SearchQuery;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Inertia\Inertia;
use Inertia\Response;

class SearchController extends Controller
{
    public function index(Request $request, Bookshelf $shelf, SearchQuery $search, CatalogueQuery $catalogue): Response
    {
        Gate::authorize('viewAny', Book::class);

        $q = trim((string) $request->query('q', ''));

        return Inertia::render('shelves/search', [
            'q' => $q,
            'results' => $search->run($q),
            // BR §16.1: "The empty state suggests popular books rather
            // than showing nothing." The reference's device — a short row
            // of recently added, currently available titles — reused via
            // the catalogue query rather than a second read shape.
            'suggestions' => $q === ''
                ? $catalogue->run(['scope' => 'available', 'sort' => 'recent', 'per_page' => 6])['rows']
                : [],
        ]);
    }
}
```

`app/Http/Controllers/Reader/BookController.php`:

```php
<?php

namespace App\Http\Controllers\Reader;

use App\Enums\MembershipRole;
use App\Http\Controllers\Controller;
use App\Models\Book;
use App\Models\Bookshelf;
use App\Queries\BookDetailQuery;
use App\Support\TenantContext;
use Illuminate\Support\Facades\Gate;
use Inertia\Inertia;
use Inertia\Response;

class BookController extends Controller
{
    public function show(Bookshelf $shelf, Book $book, BookDetailQuery $detail, TenantContext $context): Response
    {
        Gate::authorize('view', $book);

        // The binding resolves drafts (the manager route shares the model);
        // the READER page must not show one (BR §16.1's page filters
        // is_published). 404, not 403 — hidden means absent.
        abort_unless($book->is_published, 404);

        // BR §16.1 (narrowed 2026-08-12): the contact line is shown to
        // readers only — a manager reading this page is the person being
        // named. Role from the bound membership; a memberless super admin
        // counts as manager-or-above here for the same reason.
        $role = $context->membership()?->role;
        $isManagerOrAbove = ($role !== null && $role->atLeast(MembershipRole::Manager))
            || $context->membership() === null;   // memberless viewer who passed role:reader = super admin
        $firstContact = null;

        if (! $isManagerOrAbove) {
            $contact = $shelf->contacts()->where('position', 1)->first();

            if ($contact !== null && $contact->phone !== null) {
                $firstContact = ['name' => $contact->name, 'phone' => $contact->phone];
            }
        }

        return Inertia::render('shelves/book', [
            'detail' => $detail->run($book),
            'firstContact' => $firstContact,
        ]);
    }
}
```

- [ ] **Step 5: Add the reader copy**

In `resources/js/lib/copy.ts`, add:

```ts
    readerCatalogue: {
        borrowSoon: "Chức năng xin mượn sẽ có trong giai đoạn sau.",
        availableWithCount: "Còn {count} bản có sẵn",
        searchLead: "Gõ không dấu cũng tìm được — thử \"tim kiem kho bau\".",
        searchEmptyPrompt: "Nhập từ khoá để tìm sách.",
        suggestionsHeading: "Sách mới thêm gần đây",
    },
```

- [ ] **Step 6: Write `resources/js/components/book-card.tsx`**

```tsx
import { Link, usePage } from "@inertiajs/react";
import { route } from "ziggy-js";
import { Badge } from "@/components/ui/badge";
import { copy } from "@/lib/copy";
import type { SharedData } from "@/types";

export interface CatalogueRowProps {
    bookId: string;
    slug: string;
    title: string;
    author: string | null;
    coverUrl: string | null;
    category: string | null;
    copiesTotal: number;
    copiesAvailable: number;
    availability: keyof typeof copy.catalogue.state;
}

/** BR §16.1's cover-forward card: cover, title, author, availability badge. */
export default function BookCard({ book }: { book: CatalogueRowProps }) {
    const { shelf } = usePage<SharedData>().props;
    if (!shelf) return null;

    return (
        <Link
            href={route("shelves.books.show", { shelf: shelf.slug, book: book.slug })}
            className="flex flex-col gap-2 rounded-md border p-3 hover:bg-accent"
        >
            <div className="aspect-[3/4] w-full overflow-hidden rounded bg-muted">
                {book.coverUrl ? (
                    <img src={book.coverUrl} alt={book.title} className="h-full w-full object-cover" />
                ) : null}
            </div>
            <div>
                <p className="line-clamp-2 font-medium">{book.title}</p>
                {book.author ? <p className="text-sm text-muted-foreground">{book.author}</p> : null}
            </div>
            <Badge variant={book.availability === "available" ? "default" : "outline"} className="self-start">
                {copy.catalogue.state[book.availability]}
            </Badge>
        </Link>
    );
}
```

- [ ] **Step 7: Write the three pages**

`resources/js/pages/shelves/catalogue.tsx` — the segmented available/all control is two buttons, not a dropdown (BR §16.1: "the single most-used control on the page"); every filter is a `router.get` so each combination has a shareable URL:

```tsx
import { Head, Link, router, usePage } from "@inertiajs/react";
import { route } from "ziggy-js";
import BookCard, { type CatalogueRowProps } from "@/components/book-card";
import { Button } from "@/components/ui/button";
import AppLayout from "@/layouts/app-layout";
import { copy, t } from "@/lib/copy";
import type { SharedData } from "@/types";

interface PageProps extends SharedData {
    books: { rows: CatalogueRowProps[]; page: number; pageCount: number; total: number };
    categories: { slug: string; name: string }[];
    filters: { scope: "available" | "all"; category: string | null; sort: "recent" | "title" };
}

export default function ShelfCatalogue() {
    const { shelf, books, categories, filters } = usePage<PageProps>().props;
    if (!shelf) return null;

    // Resolved values only, page dropped on any filter change — page 4 of
    // a different filter is a page nobody asked for.
    const catalogueRoute = (over: Partial<typeof filters> & { page?: number }) =>
        route("shelves.catalogue", {
            shelf: shelf.slug,
            scope: (over.scope ?? filters.scope) === "all" ? "all" : undefined,
            category: over.category === undefined ? (filters.category ?? undefined) : (over.category ?? undefined),
            sort: (over.sort ?? filters.sort) === "title" ? "title" : undefined,
            page: over.page && over.page > 1 ? over.page : undefined,
        });

    return (
        <AppLayout>
            <Head title={copy.catalogue.title} />
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h1 className="text-2xl font-semibold">{copy.catalogue.title}</h1>
                <span className="text-sm text-muted-foreground">
                    {t(copy.catalogue.totalCount, { count: books.total })}
                </span>
            </div>

            <div className="mb-4 flex flex-wrap items-center gap-2">
                <div className="flex rounded-md border p-0.5" role="group">
                    <Button
                        size="sm"
                        variant={filters.scope === "available" ? "default" : "ghost"}
                        onClick={() => router.get(catalogueRoute({ scope: "available" }))}
                    >
                        {copy.catalogue.scopeAvailable}
                    </Button>
                    <Button
                        size="sm"
                        variant={filters.scope === "all" ? "default" : "ghost"}
                        onClick={() => router.get(catalogueRoute({ scope: "all" }))}
                    >
                        {copy.catalogue.scopeAll}
                    </Button>
                </div>
                <select
                    className="rounded-md border bg-background px-3 py-2 text-sm"
                    value={filters.category ?? ""}
                    onChange={(event) => router.get(catalogueRoute({ category: event.target.value || null }))}
                >
                    <option value="">{copy.catalogue.allCategories}</option>
                    {categories.map((category) => (
                        <option key={category.slug} value={category.slug}>
                            {category.name}
                        </option>
                    ))}
                </select>
                <select
                    className="rounded-md border bg-background px-3 py-2 text-sm"
                    value={filters.sort}
                    onChange={(event) => router.get(catalogueRoute({ sort: event.target.value as "recent" | "title" }))}
                >
                    <option value="recent">{copy.catalogue.sortRecent}</option>
                    <option value="title">{copy.catalogue.sortTitle}</option>
                </select>
            </div>

            {books.rows.length === 0 ? (
                <p className="text-muted-foreground">{copy.catalogue.emptyList}</p>
            ) : (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
                    {books.rows.map((book) => (
                        <BookCard key={book.bookId} book={book} />
                    ))}
                </div>
            )}

            {books.pageCount > 1 ? (
                <nav className="mt-6 flex items-center gap-3">
                    {books.page > 1 ? (
                        <Link href={catalogueRoute({ page: books.page - 1 })}>{copy.catalogue.pagePrev}</Link>
                    ) : null}
                    <span className="text-sm text-muted-foreground">
                        {t(copy.catalogue.pageOf, { page: books.page, pageCount: books.pageCount })}
                    </span>
                    {books.page < books.pageCount ? (
                        <Link href={catalogueRoute({ page: books.page + 1 })}>{copy.catalogue.pageNext}</Link>
                    ) : null}
                </nav>
            ) : null}
        </AppLayout>
    );
}
```

`resources/js/pages/shelves/search.tsx` — live results: the input drives `router.get` with `preserveState` + `replace`, debounced, so typing re-queries without history spam; the folded matching itself is the server's:

```tsx
import { Head, router, usePage } from "@inertiajs/react";
import { useEffect, useRef, useState } from "react";
import { route } from "ziggy-js";
import BookCard, { type CatalogueRowProps } from "@/components/book-card";
import { Input } from "@/components/ui/input";
import AppLayout from "@/layouts/app-layout";
import { copy } from "@/lib/copy";
import type { SharedData } from "@/types";

interface PageProps extends SharedData {
    q: string;
    results: CatalogueRowProps[];
    suggestions: CatalogueRowProps[];
}

export default function ShelfSearch() {
    const { shelf, q, results, suggestions } = usePage<PageProps>().props;
    const [term, setTerm] = useState(q);
    const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

    useEffect(() => () => clearTimeout(timer.current), []);

    // After every hook — an early return above a hook is a hook-order
    // violation React flags at runtime.
    if (!shelf) return null;

    const search = (value: string) => {
        setTerm(value);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => {
            router.get(
                route("shelves.search", { shelf: shelf.slug, q: value || undefined }),
                {},
                { preserveState: true, replace: true },
            );
        }, 300);
    };

    return (
        <AppLayout>
            <Head title={copy.catalogue.searchTitle} />
            <h1 className="mb-4 text-2xl font-semibold">{copy.catalogue.searchTitle}</h1>
            <Input
                value={term}
                onChange={(event) => search(event.target.value)}
                placeholder={copy.catalogue.searchPlaceholder}
                className="mb-2 max-w-md"
                autoFocus
            />
            <p className="mb-4 text-sm text-muted-foreground">{copy.readerCatalogue.searchLead}</p>

            {q === "" ? (
                <div>
                    <p className="mb-4 text-muted-foreground">{copy.readerCatalogue.searchEmptyPrompt}</p>
                    {suggestions.length > 0 ? (
                        <section>
                            <h2 className="mb-2 text-lg font-medium">
                                {copy.readerCatalogue.suggestionsHeading}
                            </h2>
                            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
                                {suggestions.map((book) => (
                                    <BookCard key={book.bookId} book={book} />
                                ))}
                            </div>
                        </section>
                    ) : null}
                </div>
            ) : results.length === 0 ? (
                <p className="text-muted-foreground">{copy.catalogue.emptySearch}</p>
            ) : (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
                    {results.map((book) => (
                        <BookCard key={book.bookId} book={book} />
                    ))}
                </div>
            )}
        </AppLayout>
    );
}
```

`resources/js/pages/shelves/book.tsx`:

```tsx
import { Head, usePage } from "@inertiajs/react";
import { Badge } from "@/components/ui/badge";
import AppLayout from "@/layouts/app-layout";
import { copy, t } from "@/lib/copy";
import type { SharedData } from "@/types";

interface PageProps extends SharedData {
    detail: {
        bookId: string;
        slug: string;
        title: string;
        author: string | null;
        coverUrl: string | null;
        category: string | null;
        copiesTotal: number;
        copiesAvailable: number;
        availability: keyof typeof copy.catalogue.state;
        publisher: string | null;
        publishedYear: number | null;
        pageCount: number | null;
        isbn: string | null;
        description: string | null;
        onLoan: number;
        queueLength: number;
        currentLoan: { holderName: string | null; daysRemaining: number; dueOn: string } | null;
    };
    firstContact: { name: string; phone: string } | null;
}

export default function ShelfBook() {
    const { detail, firstContact } = usePage<PageProps>().props;

    const holderLine = detail.currentLoan
        ? detail.currentLoan.holderName === null
            ? t(copy.catalogue.holderLineAnonymous, { days: Math.abs(detail.currentLoan.daysRemaining) })
            : detail.currentLoan.daysRemaining >= 0
              ? t(copy.catalogue.holderLine, {
                    name: detail.currentLoan.holderName,
                    days: detail.currentLoan.daysRemaining,
                })
              : t(copy.catalogue.holderLineOverdue, {
                    name: detail.currentLoan.holderName,
                    days: Math.abs(detail.currentLoan.daysRemaining),
                })
        : null;

    const metadata: [string, string | null][] = [
        [copy.catalogue.author, detail.author],
        [copy.catalogue.category, detail.category],
        [copy.catalogue.publisher, detail.publisher],
        [copy.catalogue.publishedYear, detail.publishedYear?.toString() ?? null],
        [copy.catalogue.pageCount, detail.pageCount?.toString() ?? null],
        [copy.catalogue.isbn, detail.isbn],
    ];

    return (
        <AppLayout>
            <Head title={detail.title} />
            <div className="flex flex-col gap-6 md:flex-row">
                <div className="w-40 shrink-0">
                    <div className="aspect-[3/4] overflow-hidden rounded bg-muted">
                        {detail.coverUrl ? (
                            <img src={detail.coverUrl} alt={detail.title} className="h-full w-full object-cover" />
                        ) : null}
                    </div>
                </div>
                <div className="flex-1">
                    <h1 className="text-2xl font-semibold">{detail.title}</h1>
                    {detail.author ? <p className="text-muted-foreground">{detail.author}</p> : null}

                    <div className="mt-4 space-y-2 rounded-md border p-4">
                        <Badge variant={detail.availability === "available" ? "default" : "outline"}>
                            {copy.catalogue.state[detail.availability]}
                        </Badge>
                        <p className="text-sm text-muted-foreground">
                            {t(copy.catalogue.copyCountLine, {
                                available: detail.copiesAvailable,
                                onLoan: detail.onLoan,
                                total: detail.copiesTotal,
                            })}
                        </p>
                        {holderLine ? <p className="text-sm text-muted-foreground">{holderLine}</p> : null}
                        {detail.queueLength > 0 ? (
                            <p className="text-sm text-muted-foreground">
                                {t(copy.catalogue.queueLine, { count: detail.queueLength })}
                            </p>
                        ) : null}
                        <p className="text-sm text-muted-foreground">{copy.readerCatalogue.borrowSoon}</p>
                        {firstContact ? (
                            <p className="text-sm">
                                {t(copy.catalogue.contactBefore, { name: firstContact.name })}
                                <a href={`tel:${firstContact.phone}`} className="font-medium underline">
                                    {firstContact.phone}
                                </a>
                                {copy.catalogue.contactAfter}
                            </p>
                        ) : null}
                    </div>

                    <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                        {metadata
                            .filter(([, value]) => value !== null && value !== "")
                            .map(([label, value]) => (
                                <div key={label}>
                                    <dt className="text-muted-foreground">{label}</dt>
                                    <dd>{value}</dd>
                                </div>
                            ))}
                    </dl>

                    {detail.description ? (
                        <section className="mt-6">
                            <h2 className="mb-2 text-lg font-medium">{copy.catalogue.description}</h2>
                            <p className="whitespace-pre-line text-sm">{detail.description}</p>
                        </section>
                    ) : null}
                </div>
            </div>
        </AppLayout>
    );
}
```

(The contact line keeps the phone number a tappable `tel:` link — every reader-facing phone number is, BR §16.3. The sentence lives in `copy.ts` as two halves around the anchor so no Vietnamese is inlined in JSX.)

- [ ] **Step 8: Run the tests and the JS checks**

Run: `make test FILTER=ReaderScreensTest` — Expected: PASS
Run: `make test FILTER=ReaderQueriesTest` — Expected: still PASS
Run: `bun run laravel:typecheck && bun run laravel:lint && bun run laravel:build` — Expected: clean

- [ ] **Step 9: Commit**

```bash
git add routes/web.php app/Http/Controllers/Reader resources/js tests/Feature/Catalogue/ReaderScreensTest.php
git commit -m "feat: reader screens — catalogue grid, live folded search, book detail with contact line"
```

---

### Task 14: The guarantee sweep — architecture tests, the operations walk, known-gaps

**Files:**
- Create: `tests/Feature/Architecture/CatalogueArchitectureTest.php`
- Edit: `docs/known-gaps.md` (append a Phase 1a section; never rewrite earlier entries)
- Edit: `docs/superpowers/plans/2026-08-27-laravel-phase-1a-catalogue.md` (flip `Status: Draft` → `Status: Complete` as the last act)

**Interfaces:**
- Consumes: everything this plan built; Phase 0's `TenancyArchitectureTest`, `RouteOrderTest`, `RouteIsolationTest` (all must still pass untouched).
- Produces: the architecture pins for what this phase added, the coverage ledger, and the durable record of what was deliberately left.

- [ ] **Step 1: Write the architecture test**

Create `tests/Feature/Architecture/CatalogueArchitectureTest.php`:

```php
<?php

use Illuminate\Support\Facades\Route;

it('every manage write route carries auth and a role gate', function () {
    // The write surface this phase added must never ship open. Census, not
    // sample: every non-GET route under shelves/{shelf}/manage.
    $writes = collect(Route::getRoutes())->filter(fn ($route) => str_starts_with($route->uri(), 'shelves/{shelf}/manage')
        && ! in_array('GET', $route->methods(), true));

    expect($writes->count())->toBeGreaterThanOrEqual(6);   // store, update, copies.store, 4 copy commands

    foreach ($writes as $route) {
        $middleware = $route->gatherMiddleware();
        expect(in_array('auth', $middleware, true))
            ->toBeTrue("write route without auth: {$route->uri()}");
        expect(in_array('role:manager', $middleware, true))
            ->toBeTrue("write route without role:manager: {$route->uri()}");
        expect(in_array('tenant', $middleware, true))
            ->toBeTrue("write route without tenant: {$route->uri()}");
    }
});

it('books/create and books/lost still precede books/{book}', function () {
    // Spec §6's route-order hazard, re-pinned against THIS phase's route
    // file edits — RouteOrderTest guards the reader group; this guards the
    // manage books block the same way.
    $uris = collect(Route::getRoutes())
        ->filter(fn ($route) => in_array('GET', $route->methods(), true))
        ->map(fn ($route) => $route->uri())
        ->values();

    $create = $uris->search('shelves/{shelf}/manage/books/create');
    $lost = $uris->search('shelves/{shelf}/manage/books/lost');
    $show = $uris->search('shelves/{shelf}/manage/books/{book}');

    expect($create)->not->toBeFalse()
        ->and($lost)->not->toBeFalse()
        ->and($show)->not->toBeFalse()
        ->and($create < $show)->toBeTrue('books/create declared after books/{book}')
        ->and($lost < $show)->toBeTrue('books/lost declared after books/{book}');
});

it('there is deliberately no delete-book route', function () {
    // Q7: the DeleteBook Action exists and is tested; the UI entry point
    // does not, matching the reference and OPS §4.1's open question. If
    // this test surprises you, read the known-gaps entry before "fixing"
    // it — adding the route is a product decision, not a cleanup.
    $delete = collect(Route::getRoutes())->first(fn ($route) => $route->uri() === 'shelves/{shelf}/manage/books/{book}'
        && in_array('DELETE', $route->methods(), true));

    expect($delete)->toBeNull();
});

it('no Action skips the audit recorder', function () {
    // Tripwire, INV-8: every command class in app/Actions/Catalogue except
    // the code allocator (not a command — it writes nothing) must reference
    // AuditRecorder. Textual, so a new Action pasted without audit fails
    // the build rather than quietly shipping unaudited.
    $files = glob(app_path('Actions/Catalogue/*.php'));
    expect($files)->not->toBe([]);

    foreach ($files as $file) {
        if (str_ends_with($file, 'AllocateCopyCodes.php')) {
            continue;
        }
        expect(str_contains((string) file_get_contents($file), 'AuditRecorder'))
            ->toBeTrue(basename($file).' does not reference AuditRecorder');
    }
});

it('no catalogue query or action re-implements folding', function () {
    // BR §12: one normalisation. Fold::fold and the frozen generated
    // columns are the two halves; anything else matching diacritics by
    // hand (strtr over Vietnamese letters, a REPLACE chain in a query)
    // would be a third copy that drifts.
    $files = array_merge(
        glob(app_path('Actions/Catalogue/*.php')) ?: [],
        glob(app_path('Queries/*.php')) ?: [],
        glob(app_path('Support/Catalogue/*.php')) ?: [],
    );

    foreach ($files as $file) {
        $source = (string) file_get_contents($file);
        expect(str_contains($source, "strtr("))
            ->toBeFalse(basename($file).' contains a strtr( call — folding belongs to App\Support\Fold alone');
    }
});
```

- [ ] **Step 2: Run the whole suite, both stacks**

Run: `make test` — Expected: PASS, all suites — Phase 0's 265 plus everything this plan added. Pay attention to:
- `TenancyArchitectureTest` — the hand-written-`bookshelf_id` tripwire must be clean over all new code;
- `RouteOrderTest` and `RouteIsolationTest` — untouched and green;
- `DbGuaranteesTest` — untouched and green.

Run: `make lint && make analyse` — Expected: clean at level 8.
Run: `bun run laravel:typecheck && bun run laravel:lint && bun run laravel:build` — Expected: clean; `noJsxLiterals` proves no inline Vietnamese slipped into the eight new pages/components.

- [ ] **Step 3: Walk the operations ledger**

Verify each row by pointing at the test that pins it (this table is the self-review; it does not go into the plan's output, the known-gaps entry carries the deferrals):

| OPERATIONS.md entry | Where it landed | Pinned by |
|---|---|---|
| `CreateBook` (§4.1) | `App\Actions\Catalogue\CreateBook` (T6); screen T12 | `CreateBookTest`, `ManageBookScreensTest` |
| `UpdateBook` (§4.1) | `App\Actions\Catalogue\UpdateBook` (T7); screen T12 | `BookLifecycleTest`, `ManageBookScreensTest` |
| `DeleteBook` (§4.1) | `App\Actions\Catalogue\DeleteBook` (T7); **no route — Q7** | `BookLifecycleTest`, `CatalogueArchitectureTest` |
| `AddCopies` (§4.1) | `App\Actions\Catalogue\AddCopies` (T8); screen T12 | `AddCopiesTest`, `ManageBookScreensTest` |
| `AssessCondition` (§4.1) | `App\Actions\Catalogue\AssessCondition` (T9); screen T12 | `CopyStateTest`, `ManageBookScreensTest` |
| `ReportCopyLost` (§4.1) | `App\Actions\Catalogue\ReportCopyLost` (T9); screen T12 | `CopyStateTest`, `ManageBookScreensTest` |
| `MarkCopyFound` (§4.1) | `App\Actions\Catalogue\MarkCopyFound` (T9); screens T12 (detail + lost) | `CopyStateTest`, `ManageBookScreensTest` |
| `RetireCopy` (§4.1) | `App\Actions\Catalogue\RetireCopy` (T9); screens T12 | `CopyStateTest`, `ManageBookScreensTest` |
| `GetCatalogue` (§3.2) | `App\Queries\CatalogueQuery` (T11); screen T13 | `ReaderQueriesTest`, `ReaderScreensTest` |
| `SearchCatalogue` (§3.2) | `App\Queries\SearchQuery` (T11); screen T13 | `ReaderQueriesTest`, `ReaderScreensTest` |
| `GetBookDetail` reader (§3.2) | `App\Queries\BookDetailQuery` (T11); screen T13 | `ReaderQueriesTest`, `ReaderScreensTest` |
| `GetBooksList` (§3.3) | `App\Queries\BooksListQuery` (T10); screen T12 | `ManagerQueriesTest`, `ManageBookScreensTest` |
| `GetBookDetail` manager (§3.3) | `App\Queries\ManagerBookDetailQuery` (T10); screen T12 | `ManagerQueriesTest`, `ManageBookScreensTest` |
| *(untabulated — OPS §4.1 names it under `MarkCopyFound`)* lost-copies view | `App\Queries\LostCopiesQuery` (T10); screen T12 | `LostCopiesTest`, `ManageBookScreensTest` |
| `GetShelfHome` (§3.2) | **Phase 2** — its centerpiece is the announcement card; deferred whole so the page is built once | header scope note, known-gaps entry 8 |
| `MarkCopiesPrinted`, label/QR queries, `ResolveCopyById` (§4.1, §3.3) | **Phase 2** (QR labels) | header scope note |
| `SearchBooksForLending` (§3.3) | **Phase 1c** (quick-lend) | header scope note |
| `ExportBooksCSV` (§3.3) | **Phase 1d** (exports) | header scope note |

If any row's "Pinned by" cannot be pointed at a passing test, the plan is not done — go back to that task.

- [ ] **Step 4: Append to `docs/known-gaps.md`**

Add a `## Phase 1a — Catalogue` section recording, in this repository's established voice (each entry says *why it was left*):

1. **The copy-code race probes did not port; the serialisation moved to a shelf-row lock whose POSITION is the guarantee.** The reference proved its allocator with two live connections racing to commit; under `RefreshDatabase` a second connection cannot see uncommitted fixtures, so `AllocateCopyCodesTest` and `CreateBookTest` pin the *mechanism* instead — and specifically that the `FOR UPDATE` on the `bookshelves` row is the **first query of the transaction**, because under InnoDB's REPEATABLE READ the read view is pinned at the first consistent read and a lock taken after any earlier SELECT still reads a stale snapshot (reproduced live on 10.11 during this plan's review: duplicate copy code, silently-committed ISBN duplicate, missed slug — Postgres's per-statement READ COMMITTED is why the reference could afford reads before its lock and this port cannot). The real rule for every future phase: **nothing may read before the lock.** `book_copies_code_unique`'s errno 1062 remains the structural backstop for codes and slugs; ISBN has no such backstop — see the next entry.
2. **`duplicate_isbn` is a check-then-write with no structural backstop, and the failure mode of getting the ordering wrong is SILENT corruption, not an error.** No unique index backs ISBN (a partial per-shelf ISBN unique was named as the structural fix in the B1 plan's known gaps and was not built there either), so a stale read here does not raise 1062 — the duplicate simply commits. The check is safe only because it reads *under* a lock that is the transaction's first statement; "after the allocator" alone is necessary but not sufficient. `CreateBookTest`'s lock-first query-log pin is the tripwire; no single-connection test can show the corruption itself.
3. **`DeleteBook` is implemented, tested, and reachable from no screen** (the reference's Q7, OPS §4.1's open question). `CatalogueArchitectureTest` pins the *absence* of the route so adding it is a decision, not an accident. The retention rule (`copy_has_history` retains, never throws) is pinned by `BookLifecycleTest` either way.
4. **The donor member picker is deferred to 1b.** `donor_membership_id` is accepted, validated, stored, audited and rendered back (the manager detail resolves the member's name) — but the create form offers only the free-text donor until `GetReadersList` exists to search members. The OPS §16.3 donation-queue pre-fill (Duyệt → form with Người tặng pre-filled) is Phase 2's, and lands on this same field.
5. **The reader detail page ships without its "Xin mượn" button, comments, or the manager's lend/return shortcuts** — `CreateBorrowRequest` and comments are Phase 2, `LendCopy`/`ReceiveReturn` are 1c. The availability panel, queue length and contact line are live.
6. **`lang/vi/validation.php` is translated for the rules this phase reaches; untranslated stock rules may remain English-keyed** until the phase that first hits them. The Task 1 test pins `required`; it does not census the file.
7. **The manager index reuses `copyCountLine` with its middle figure computed as `total - available`** (which counts held copies as "đang cho mượn") — the per-row true on-loan count was deliberately not added to the list query for one label. The detail pages show the true count. Revisit if a manager reports the number as wrong rather than approximate.
8. **`GetShelfHome` (OPS §3.2) is deferred to Phase 2, whole.** `ShellController::shelfHome()` still renders the propless `shelves/show`. The page's centerpiece card is the pinned-or-latest announcement — a Phase 2 entity — while its catalogue-count link and *Mới thêm* cover row become computable with this phase's queries; building the page now would mean rebuilding it in Phase 2 when the announcement card and the Tặng sách/Góp ý cards land. Deferred so the shelf home is built once, against its full OPS §3.2 shape.
9. **The catalogue queries pay ~8 correlated aggregate subqueries per row, and `books_public` goes unused** (the sort is on unindexed `title_folded`), where the reference did one grouped join. Honestly fine at BR §1's few hundred books per shelf — the paging tests run against real MariaDB — but if a shelf ever grows past that, the fix is a single grouped-join query shape, not a stored counter (BR §8).

- [ ] **Step 5: Flip this plan's Status and commit**

Edit this plan's header: `**Status:** Draft` → `**Status:** Complete`.

```bash
git add tests/Feature/Architecture/CatalogueArchitectureTest.php docs/known-gaps.md docs/superpowers/plans/2026-08-27-laravel-phase-1a-catalogue.md
git commit -m "test: catalogue architecture pins, operations ledger walked, known-gaps for phase 1a"
```

---

## Coverage: OPERATIONS.md §4.1 / §3.2 / §3.3 → tasks

For the executor's orientation (the walk in Task 14 verifies it): every catalogue **command** of OPS §4.1 in this phase's scope lands in Tasks 6–9; the reader **queries** of §3.2 (`GetCatalogue`, `SearchCatalogue`, `GetBookDetail`) in Task 11; the manager **queries** of §3.3 (`GetBooksList`, manager `GetBookDetail`) plus the untabulated lost-copies read in Task 10; screens in Tasks 12–13. Out of scope, by phase: `GetShelfHome` (Phase 2 — deferred whole, known-gaps entry 8), `MarkCopiesPrinted` + all QR/label operations and `ResolveCopyById` (Phase 2), `SearchBooksForLending` (1c), `ExportBooksCSV` (1d), category administration (Phase 3).












