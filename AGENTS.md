# AGENTS.md — Working on OLibra

This file tells an AI coding agent how to write code for OLibra. The authority on *what* to build and *why* is `docs/superpowers/specs/2026-08-06-olibra-design.md` (the "spec"). This file is the authority on *how* to write it. Where the two appear to conflict, the spec wins and you should say so rather than guessing.

Read the relevant section of the spec before implementing anything. Do not invent entities, states, settings, routes, or technologies that the spec does not name.

---

## 1. Project overview

OLibra is a management system for small community bookshelves — the kind kept in a church hall, run by a few volunteers who are often children, holding on the order of one hundred to a few hundred books. **It is explicitly not a public library system.** A library system optimises for catalogue scale, patron self-service, fines, and interoperability. OLibra optimises for a volunteer standing next to a physical shelf with a phone in one hand and a book in the other. Where those goals conflict, the volunteer wins.

Three audiences use it:

| Audience | What they need |
|---|---|
| **Readers** (mostly children) | What is on the shelf, and what they can take home today |
| **Managers** (volunteers, often teenagers) | Record lending and returning, approve new readers, keep the shelf honest |
| **Super administrator** | Oversee several bookshelves, delegate them to local managers, see what every manager has done |

The dominant real-world interaction is a child at the shelf holding a book while a volunteer holds a phone. The manager's primary screen is therefore a **quick-lend flow that takes three taps** — find the book, pick the reader, confirm — and quick-return defaults the condition selector to *Nguyên vẹn* so the common case is a single tap. **Any change that adds a step to quick-lend or quick-return needs an explicit justification in the PR description.** If that flow gets slow, volunteers revert to paper and every other feature becomes worthless.

### The three surfaces

One Laravel application serving three distinct surfaces on one domain:

| Surface | Path | Purpose |
|---|---|---|
| Marketing site | `/` | Landing, about, blog, contact. Public and SEO-relevant. |
| Portal | `/portal` | Directory of all bookshelves. The application's front door. |
| A bookshelf | `/portal/{slug}` | Everything functional: catalogue, borrowing, management. |
| Administration | `/quan-tri` | Super-admin oversight across all bookshelves. |

### Phase plan

The schema is multi-tenant from the first migration, so later phases add features rather than rewriting foundations. Build strictly in this order:

- **Phase 1 — the core loop.** Books and copies, readers and registration approval, lending and returning with condition assessment, the audit log, the manager dashboard, the public catalogue and search, CSV export. One bookshelf, stored as one tenant among many.
- **Phase 2 — community.** Borrow requests, holds, the waiting queue, comments and moderation, announcements, feedback, statistics.
- **Phase 3 — the network.** The portal directory, multiple bookshelves, super-admin tooling, cross-shelf statistics, the marketing landing page and blog, per-manager audit views.

Phase 1 is a useful product on its own. Do not pull Phase 2 or 3 work forward unless asked; do not build Phase 1 in a way that blocks them.

### Fixed assumptions

Changing any of these is a design change, not an implementation detail. Raise it, do not decide it.

1. Timezone is `Asia/Ho_Chi_Minh` everywhere, regardless of server configuration.
2. **There is no outbound email in v1.** Manager-issued password reset is the only recovery path. The nullable `email` column exists for later.
3. A manager approving a registration is the consent needed to hold a minor's data.
4. "Most borrowed" counts completed handovers at the **title** level, not requests and not copies.
5. Guest borrow requests create a lead, not an account.
6. Public pages display readers' full names, governed by the `public_name_display` setting. Date of birth, parents' names, phone, tổ, and giáo họ are manager-and-admin only.
7. Vietnamese is the only shipped locale. All strings live in language files from the first commit, with an `en/` scaffold.
8. A user has at most one role per bookshelf. Roles are hierarchical: `admin` ⊃ `manager` ⊃ `reader`.

---

## 2. Coding standards

### PHP

- **PSR-12, enforced by Laravel Pint.** `pint --test` runs in CI and must pass. Never hand-format around Pint; fix `pint.json` if the rule is genuinely wrong.
- **`declare(strict_types=1);` at the top of every PHP file**, without exception.
- **PHPStan / Larastan level 6** must pass. Do not add `@phpstan-ignore` to silence a real typing problem; fix the type.
- **Type everything.** Parameter types, return types, and property types are mandatory. Use `never` and `void` accurately. Prefer typed properties over docblock types.
- **PHP 8.4 features, used where they genuinely help and nowhere else:**
  - **Backed enums** for every closed set of values: `CopyState`, `CopyCondition`, `LoanStatus`, `BorrowRequestStatus`, `MembershipStatus`, `Role`, `Permission`, `AuditAction`. Back them with `string` and give them behaviour (label helpers, transition checks) rather than scattering `match` expressions across call sites.
  - **Property hooks** for derived or validated properties on value objects such as `BookshelfSettings`, where a hook replaces a trivial getter method. Do not use hooks on Eloquent models — Eloquent's attribute casting and accessors own that job.
  - **Asymmetric visibility** (`public private(set)`) on value objects and DTOs whose fields are read widely but written only by the constructor. Do not apply it mechanically; if a property is already `readonly`, leave it `readonly`.
  - `readonly` classes for DTOs and value objects. Constructor property promotion everywhere.
- **No facades inside Domain code.** Inject dependencies. Facades are acceptable in Controllers, Jobs, and Console commands.
- Prefer early returns over nested conditionals. A method with more than two levels of indentation usually wants extracting.
- Never use `env()` outside `config/`. Read configuration through `config()`.

### TypeScript

- **`strict: true`** in `tsconfig.json`, and `tsc --noEmit` must pass in CI.
- **`any` is forbidden.** Use `unknown` plus narrowing when a type is genuinely open. If a third-party type is wrong, write a local declaration rather than casting through `any`.
- **Explicit return types on every exported function, hook, and component.** Inference is fine for local closures only.
- Prefer `type` aliases for props and DTO shapes; use `interface` only when declaration merging is needed.
- Discriminated unions model state, not optional-field soup. A book's availability panel switches on a tagged union, not on three nullable booleans.
- Types mirroring PHP DTOs live in `resources/js/types/`. Shared Inertia props are typed once in `types/inertia.d.ts` and nowhere else.
- ESLint must pass with no warnings suppressed inline unless a comment explains why.

---

## 3. Architecture principles

**Layered architecture, organised feature-first, with DDD-lite tactical patterns. Single-purpose Action classes. No repository pattern. No third-party permissions package.**

### Layers and the dependency rule

```
HTTP            Controllers, FormRequests, Inertia responses, Resources/DTOs, Middleware
Application     Actions (write), Queries (read), Policies, Events, Listeners, Notifications
Domain          Models, Enums, State transitions, Domain exceptions, Value objects
Infrastructure  Migrations, Jobs, Storage, Console commands, External services
```

**Each layer may depend only on layers below it.** A Model never references a Controller. An Action never returns an Inertia response, never touches the `Request` object, and never redirects. A Query never mutates.

### Actions, not Services

There are no `*Service` classes in this codebase. A `LoanService` grows into a nine-hundred-line god object with twenty loosely related methods and a constructor injecting eight dependencies; every change touches the same file. Instead:

- One Action class per operation: `LendBookDirectlyAction`, `ReceiveReturnAction`, `ApproveMembershipAction`.
- **Exactly one public method, `execute()`.** One reason to change; injects only what it uses.
- This is the highest-leverage decision for AI-assisted development. An agent asked to change how lending works opens exactly one file and sees the whole operation: validation, state transition, audit write, event dispatch.

**Action anatomy** — every Action follows this shape, in this order:

1. Accept a typed data object or explicit scalar parameters — **never a raw `Request`**.
2. Open a database transaction.
3. Re-check invariants **inside** the transaction, with row locking where a race is possible.
4. Mutate models.
5. Write the audit entry through `AuditLogger`.
6. Commit.
7. Dispatch events **after** commit.
8. Return the created or modified model.

Invariant violations throw a domain exception (`CopyNotAvailableException`, `LoanLimitReachedException`), mapped by a handler to a friendly Vietnamese message. **Actions never return `false` or `null` to signal failure.** `LendBookDirectlyAction` additionally catches the unique-constraint violation on `active_copy_key` and rethrows it as `CopyNotAvailableException`, so the database race and the application check produce the same user-facing message.

The full Action inventory is in spec §5.2. Use those names; do not coin variants.

### No repository pattern

Eloquent is the data-access abstraction. A repository wrapping Eloquent adds a layer with no second implementation behind it, obscures eager loading (the main tool against N+1), and pushes toward `findAll()`-style methods that fetch too much. Tests run against a real database. **Complex read paths live in dedicated Query classes** — `OverdueLoansQuery`, `RequestQueueQuery`, `ShelfStatisticsQuery`, `ManagerActivityQuery` — which provide the readability repositories claim without the indirection.

### No permissions package

Do not install `spatie/laravel-permission` or any equivalent. OLibra has three per-shelf roles plus one global flag, all known at compile time. A `Permission` **enum** mapped to roles in a single `RolePermissions` class, consulted by Laravel Policies, is clearer, faster (no queries, no cache invalidation), and fully type-checked. The extensibility path — if per-user exceptions are ever needed — is a nullable `permissions` JSON column on `memberships` that the policy consults as an override. Additive, and still no package.

### Thin controllers

A controller action does four things: authorise, validate via a FormRequest, call **one** Action or Query, return a response. **A controller method longer than about fifteen lines is a design smell** and should be treated as a bug in review. No business logic, no conditionals over domain state, no query building in controllers.

### Tenancy is structural

Tenant isolation is the highest-consequence security property in the system and must not depend on developers remembering a `where` clause. Three mechanisms combine — route model binding on `{bookshelf:slug}`, the `ResolveBookshelf` middleware, and the `BelongsToBookshelf` trait. See §7 and §10.

### Events

Events are dispatched for genuinely cross-cutting reactions: `BookLent`, `BookReturned`, `MembershipApproved`, `BorrowRequestApproved`, `CommentPosted`. Listeners send in-app notifications and invalidate statistics caches. **Events are never used for auditing** — an audit trail that can be lost to a failed queue job is not an audit trail.

### Queues and schedule

The queue uses the database driver and carries only deferrable work: cover image resizing, CSV export generation, statistics cache warming, database backups. **Nothing a user waits on goes through a queue**, because the queue may not drain for thirty minutes on shared hosting. Every scheduled command must be correct when run at irregular intervals and harmless when skipped entirely.

---

## 4. Business rules

These are the specification of correctness. Each gets a named, dedicated test (see §9).

### The twelve invariants

| # | Rule |
|---|---|
| **INV-1** | A book copy has at most one active loan at any time. Enforced by a database unique index, not by application code. |
| **INV-2** | A copy cannot be simultaneously held and on loan. |
| **INV-3** | Only a copy in state `available` can be lent, or one in state `held` being collected by the reader who holds it. |
| **INV-4** | A reader whose membership status is not `active` cannot start a new loan. Existing loans are unaffected. |
| **INV-5** | A reader may hold at most `max_concurrent_loans` active loans per bookshelf. Default 3. |
| **INV-6** | A loan may be renewed only if renewals remain **and** no borrow request is queued for that book. A renewal extends `due_on` by `renewal_days` from the current due date, not from the day the renewal was requested. |
| **INV-7** | A copy in state `lost` or `retired` cannot be lent or held. |
| **INV-8** | Every state transition writes an audit row recording actor, timestamp, before, and after. |
| **INV-9** | A comment is publicly visible only when its status is `approved`. |
| **INV-10** | Every query is scoped to a single bookshelf, except explicit super-admin cross-shelf views. |
| **INV-11** | A loan is never deleted. Mistakes are recorded as `voided` with a reason. |
| **INV-12** | Audit log rows are never updated or deleted. |

INV-1 is enforced **physically** by a stored generated column on `loans`: `active_copy_key` is `book_copy_id` when `status = 'active'` and `NULL` otherwise, with a unique key over it. MySQL treats `NULL` as distinct in unique indexes, so any number of returned loans coexist while two simultaneous active loans on one copy are impossible. Two managers racing at the shelf get a clean constraint violation, not a corrupted record.

### State machines

**`BookCopy.state`** — permitted transitions, and only these:

| From | To | Trigger |
|---|---|---|
| `available` | `held` | Borrow request approved |
| `available` | `on_loan` | Direct lend (quick-lend, no prior request) |
| `available` | `retired` | Manager withdraws the copy |
| `held` | `available` | Hold cancelled, or hold expired |
| `held` | `on_loan` | Handover confirmed |
| `on_loan` | `available` | Return received |
| `on_loan` | `lost` | Reported lost |
| `on_loan` | `available` | Loan voided (recorded in error) |
| `lost` | `available` | Book found again |
| `lost` | `retired` | Written off permanently |

A copy that is `on_loan` **cannot** be retired directly; it must first be returned or reported lost.

**`BorrowRequest.status`**: `pending` → `approved` → `fulfilled`; `approved` → `expired` (hold lapsed); `pending` → `rejected` (manager declined) or `cancelled` (reader withdrew). Requests for a book whose copies are all out simply remain `pending`. **The queue is the set of pending requests for that book ordered by `requested_at`.** There is no separate reservation entity.

**`Loan.status`**: `active` → `returned` | `lost` | `voided`. Terminal in all three cases.

**`Membership.status`**: `pending` → `active` or `rejected`; `active` ⇄ `suspended`; `active` → `left`.

**`Comment.status`**: `pending` → `approved` | `rejected`; `approved` → `hidden`.

Enforce transitions in the enum or the Action, never by trusting the caller. An illegal transition throws a domain exception.

### Derived state — load-bearing

**Overdue status, hold expiry, and book availability are computed at query time from stored data and the current clock. They are NEVER written by a scheduled job.** The production host may run cron only every ten to thirty minutes; any status a job must *write* would be stale, and therefore wrong, for up to half an hour. Computing at query time makes the system correct even if cron is broken entirely.

- A loan is overdue when `status = 'active' AND due_on < today()` in the application timezone.
- A hold is expired when `status = 'approved' AND hold_expires_at < now()`.
- A copy is borrowable when `state = 'available'` and no unexpired hold references it.

**Each of these lives in exactly one query scope.** If you find yourself writing `due_on <` anywhere outside that scope, stop and reuse it. `olibra:expire-holds` exists only as a tidiness measure; correctness must never depend on it having run.

### Other domain rules

- **`due_on` is a DATE, not a timestamp.** A book is due at the end of a day. A timestamp would make books go overdue mid-afternoon, which is confusing for children and wrong for a shelf only accessible after Sunday mass.
- **Retirement is not deletion.** `retired` is a real-world event (destroyed, given away, shelf shrunk). Soft deletion exists to undo *mistakes*. Never conflate them.
- **`lost` is a copy state, not a condition grade**, and has a path back (`lost` → `available`) for when a book turns up.
- Condition is a single choice from a flat list: `perfect` · `slightly_worn` · `worn` · `torn` · `missing_pages` · `written_on`, plus an optional note and photograph. `lost` is deliberately absent.
- A reader who has ever borrowed a book must never be hard-deleted. Revoking a manager changes a role; it never deletes a user.
- Soft deletes apply to `users`, `memberships`, `books`, `book_copies`, `categories`, `comments`, `announcements`, `posts`, `borrow_requests`, `bookshelves`. They never apply to `loans` (use `voided`), `audit_logs`, `condition_assessments`, or `feedback`.
- Foreign keys restrict deleting a copy with loan history and a user with any audit trail. Only `books → book_copies` cascades.
- Per-shelf policy lives in the `settings` JSON column, read through the typed `BookshelfSettings` value object with defaults — `loan_days`, `max_concurrent_loans`, `max_renewals`, `renewal_days`, `hold_days`, `due_soon_days`, and the rest per spec §3.3. **Never hard-code these numbers.** Adding a setting must never require a migration.
- Vietnamese search uses the `title_normalized` / `author_normalized` columns, written on every write and matched with `LIKE '%term%'` against a query normalised the same way. Normalisation lives in **one** `TextNormalizer` class used by both the model observer and the search query, so they cannot drift.

---

## 5. Folder conventions

Single Laravel repository — **not** a monorepo, and never split into `apps/backend` and `apps/frontend`. The React code is part of the Laravel application.

### `app/Domain/` — feature-first, five contexts

```
app/Domain/
├── Catalog/       Models: Book, BookCopy, Category
│                  Actions/ Queries/ Enums (CopyState, CopyCondition)/ Policies/ Events/
├── Circulation/   Models: Loan, BorrowRequest, ConditionAssessment
│                  Actions/ Queries/ Enums (LoanStatus, BorrowRequestStatus)/
│                  Policies/ Events/ Exceptions/
├── Identity/      Models: User, Membership, Bookshelf
│                  Actions/ Queries/ Enums (Role, MembershipStatus, Permission)/
│                  Policies/ ValueObjects (BookshelfSettings)/
├── Community/     Models: Comment, Announcement, Post, Feedback
│                  Actions/ Queries/ Enums/ Policies/
└── Audit/         Models: AuditLog · AuditLogger.php
                   Concerns (Auditable trait)/ Observers (AuditObserver)/
                   Queries (ManagerActivityQuery, AuditTrailQuery)/ Enums (AuditAction)/
```

Put a class in the context that **owns** the concept, not the one that happens to call it. A `Loan` belongs to Circulation even though it references a `Book`. Cross-context references go through models and enums, never through another context's Actions.

### `app/Http/`

```
app/Http/
├── Controllers/
│   ├── Public/    Landing, Blog, Portal, ShelfHome, Catalog, BookDetail,
│   │              Search, Registration, Feedback
│   ├── Auth/      Login, Password
│   ├── Reader/    MyLoans, MyRequests, Profile, Comment
│   ├── Manager/   Dashboard, QuickLend, ReceiveReturn, Book, BookCopy, Reader,
│   │              RegistrationApproval, RequestQueue, Overdue, CommentModeration,
│   │              Announcement, Statistics, Export
│   └── Admin/     Bookshelf, ManagerAssignment, SuperAdmin, AuditLog,
│                  CrossShelfStatistics, Post, FeedbackInbox
├── Requests/      One FormRequest per write endpoint
├── Resources/     Inertia DTO shapers
└── Middleware/    ResolveBookshelf, EnsureMembershipActive, EnsureSuperAdmin,
                   ShareInertiaData
```

Alongside: `app/Support/` (`TextNormalizer`, `HtmlSanitizer`, `DateHelper`), `app/Jobs/`, `app/Notifications/`, `app/Console/Commands/`, `app/Providers/`.

Routes are split by audience into `routes/web.php`, `public.php`, `manager.php`, `admin.php`, `console.php`, registered from `bootstrap/app.php`. A single `web.php` would be unreadable.

### `resources/js/`

```
resources/js/
├── app.tsx                Inertia bootstrap
├── layouts/               PublicLayout, ShelfLayout, ReaderLayout,
│                          ManagerLayout, AdminLayout, AuthLayout
├── pages/                 public/ auth/ reader/ manager/ admin/
├── components/
│   ├── ui/                shadcn/ui primitives — nothing else lives here
│   ├── book/              BookCard, BookGrid, CoverImage, AvailabilityBadge,
│   │                      ConditionBadge, CopyList
│   ├── circulation/       LendForm, ReturnForm, ConditionPicker, DueDateBadge,
│   │                      LoanTimeline, QueueList
│   ├── reader/            ReaderPicker, ReaderCard, RegistrationReviewCard
│   ├── data/              DataTable, ResponsiveTable, EmptyState, Pagination,
│   │                      FilterBar, SearchInput
│   ├── feedback/          Toast, ConfirmDialog, ErrorState, LoadingSkeleton
│   ├── editor/            RichTextEditor (lazy-loaded Tiptap)
│   └── charts/            BarChart, LineChart, StatTile
├── hooks/                 useInertiaForm, useConfirm, useDebounce,
│                          usePermissions, useCurrentShelf
├── lib/                   ziggy, cn, formatters, validators (Zod schemas)
└── types/                 TypeScript types mirroring PHP DTOs
```

Page components mirror the route structure. A page under `pages/manager/` is reached only from `routes/manager.php`.

### `.artifacts/` — every temporary file, and nothing else

Anything you generate that is not source code goes in `.artifacts/`, never in the repository root, never in `/tmp`, and never beside the file it describes. It is gitignored except for its README.

```
.artifacts/
├── scratch/       Throwaway working files. Anything with no other home.
├── logs/          Captured command output, dev server logs, deploy transcripts
├── coverage/      Pest and Vitest coverage reports
├── exports/       Generated CSV and Excel files produced while testing export
├── screenshots/   UI screenshots and visual comparisons
├── db/            Local database dumps and seed snapshots
└── reports/       PHPStan baselines under review, profiling, dependency audits
```

Four rules govern it, and the first one is the reason for the other three:

1. **`rm -rf .artifacts/*/` must always be safe**, at any moment, without anyone reading what is inside first. If you would hesitate before running it, something was written to the wrong place.
2. **Nothing in `.artifacts/` is an input to anything.** No build step, test, migration, or deploy may read from it. A file the build needs belongs in the repository.
3. **Never write real user data there.** No production dumps, no exports containing real readers' names, dates of birth, parents' names, or phone numbers. The directory is untracked, easy to forget, and easy to archive or share by accident — and the people in that data are mostly children.
4. **Choose the subdirectory by what the file is**, not which tool made it. Date-prefix filenames once a directory accumulates (`logs/2026-08-06-deploy.log`). A genuinely new kind of artefact gets a new subdirectory *and* a row in `.artifacts/README.md`.

Clean up scratch files when you are done with them. A scratch file created to answer one question should not outlive the answer.

---

## 6. Naming rules

| Thing | Rule | Example |
|---|---|---|
| Action | `VerbNounAction`, one public `execute()` | `LendBookDirectlyAction`, `ApproveMembershipAction` |
| Query | `NounQuery` | `OverdueLoansQuery`, `ShelfStatisticsQuery` |
| Event | Past tense, no suffix | `BookLent`, `BookReturned`, `MembershipApproved` |
| Domain exception | `ProblemException` | `CopyNotAvailableException`, `LoanLimitReachedException` |
| Policy | `ModelPolicy` | `BookPolicy`, `LoanPolicy`, `MembershipPolicy` |
| Enum | Singular noun, string-backed | `CopyState`, `MembershipStatus`, `Permission` |
| Value object | Singular noun, no suffix | `BookshelfSettings` |
| FormRequest | `VerbNounRequest` | `StoreBookRequest`, `ApproveMembershipRequest` |
| Model | Singular PascalCase | `BookCopy`, `BorrowRequest` |
| Table | snake_case plural | `book_copies`, `borrow_requests`, `audit_logs` |
| Column | snake_case; `*_at` timestamps, `*_on` dates, `is_*` booleans, `*_id` FKs | `hold_expires_at`, `due_on`, `is_published`, `lent_by_user_id` |
| Migration | Laravel's timestamped `verb_noun_table` | `create_book_copies_table`, `add_active_copy_key_to_loans_table` |
| Route name | Dot-namespaced by area | `manager.books.store`, `reader.loans.renew`, `admin.bookshelves.index` |
| Route URL | Vietnamese, kebab-case | `/portal/{shelf}/quan-ly/nhan-tra` |
| Query parameter | Vietnamese, matching the UI | `?trang_thai=`, `?sap_xep=`, `?tim=` |
| Job | `VerbNoun` imperative | `ResizeCoverImage`, `GenerateCsvExport` |
| Console command | `olibra:verb-noun` | `olibra:expire-holds`, `olibra:refresh-statistics` |
| Audit action string | `subject.past_tense` | `loan.returned`, `membership.approved` |
| React component | PascalCase, file named for the component | `BookCard.tsx`, `ConditionPicker.tsx` |
| React page | PascalCase under the area folder | `pages/manager/QuickLend.tsx` |
| Hook | `useThing`, file named identically | `useInertiaForm.ts`, `useCurrentShelf.ts` |
| Zod schema | `thingSchema` in `lib/validators`, mirroring its FormRequest | `lendBookSchema`, `registrationSchema` |
| TypeScript type | PascalCase; props type is `ComponentNameProps` | `BookSummary`, `BookCardProps` |
| Translation key | Dot-namespaced by area | `manager.lend.confirm` |
| Test file | Mirrors the class under test | `tests/Feature/Circulation/LendBookDirectlyActionTest.php` |

An Action with two public methods is two Actions. A Query that writes is an Action. If a name does not fit the table, the design is probably wrong — ask before inventing a new suffix.

---

## 7. Laravel conventions

- **One FormRequest per write endpoint.** Validation never lives inline in a controller. FormRequest rules are the server-side source of truth that the Zod schema mirrors.
- **Every controller action calls `authorize()`**, including index and show. There are no exceptions for "obviously public" pages — public pages use a policy method that returns true for guests, so the check is still explicit and greppable.
- **Eloquent relationships carry return types** (`BelongsTo<Book, BookCopy>`-style generics where Larastan needs them). Relationship methods are declared in a consistent order: `belongsTo`, then `hasMany`, then `morphTo`.
- **Backed enums are cast on the model** via `casts()`. Never compare raw strings to enum-backed columns; compare enum cases.
- **No queries in Blade or React.** `resources/views/app.blade.php` is the only Blade file of consequence. React receives data through Inertia props shaped by `app/Http/Resources/`; it never triggers a fetch to compute page content.
- **Eager load always.** Every Query and every controller read path declares `with()` for what the view renders. Enable `Model::preventLazyLoading()` in non-production environments; a lazy-load exception in tests is a bug to fix, not to silence.
- **Transactions live in Actions**, never in controllers, jobs, or listeners. Invariant re-checks happen inside the transaction with row locking where a race is possible. Events dispatch after commit.
- **`$fillable` is declared explicitly on every model** — mass assignment is guarded, and `$guarded = []` is forbidden.
- **`BelongsToBookshelf` trait** goes on every tenant-scoped model. It adds a global scope filtering by the current bookshelf **and** auto-fills `bookshelf_id` on create. Never write `where('bookshelf_id', ...)` by hand in application code; the trait does it.
- **Tenancy rules:** `ResolveBookshelf` middleware binds a `CurrentBookshelf` singleton from the `{bookshelf:slug}` route binding and aborts 404 for archived or missing shelves. `withoutGlobalScope` is permitted **only** inside named super-admin Query classes, never in a controller, Action, or model method.
- **Auditing** has two mechanisms, both synchronous and both inside the change's transaction: the `Auditable` trait plus `AuditObserver` capture attribute-level diffs (with `password` and `remember_token` excluded by allowlist), and explicit `AuditLogger::log()` calls inside Actions record domain events that are not simple diffs, carrying a meaningful `action` string.
- **Write endpoints redirect back with a flash message**, not JSON. GET endpoints return Inertia responses.
- **Paginate at 24 for grids and 50 for tables**, preserving filter and sort query strings across pages.
- **Notifications are in-app only**, via Laravel's `database` channel. No mail channel is configured in v1. Notifications go to readers; managers work from dashboard badge counts and receive none.
- Session, cache, and queue all use the database driver. There is no Redis on shared hosting — do not reach for it.

---

## 8. React conventions

- **Function components only.** No class components. No `React.FC` — type the props parameter directly and declare the return type.
- **Forms use React Hook Form + Zod through the `useInertiaForm` hook**, always. Do not use Inertia's own `useForm` directly and do not hand-roll form state: two error-handling idioms in one codebase is exactly what the hook exists to prevent. The hook validates on the client, submits via `router.post`, and maps Laravel's 422 errors back into RHF error state so both sources render identically.
- **No client state library.** No Redux, Zustand, Jotai, TanStack Query, or React Router — Inertia replaces the last two, and there is no cache to invalidate because a successful mutation triggers a partial reload.
  - **Server state** arrives as Inertia page props.
  - **Shared state** — authenticated user, current bookshelf, flash messages, unread notification count, badge counts — comes through **Inertia shared props**, typed once in `types/inertia.d.ts`.
  - **Local UI state** uses `useState`. Dialogs, expanded rows, and filter drafts are local by definition.
- **Deferred props** (Inertia 2) load dashboard statistics after first paint, covered by skeleton components. The manager dashboard must paint immediately.
- **Tiptap is lazy-loaded via dynamic import** and must never enter the public bundle. It downloads only when a manager or admin opens an editing screen.
- **Components stay under about 200 lines.** Past that, extract a subcomponent or a hook.
- **Tailwind only. No inline `style` attributes**, no CSS-in-JS, no ad-hoc `.css` files beyond the theme tokens. Spacing is restricted to the `2, 3, 4, 6, 8, 12, 16` scale.
- **shadcn/ui primitives live in `components/ui/` and nothing else does.** Compose them into feature components elsewhere; do not fork a primitive to add a feature-specific prop.
- **No hard-coded user-facing strings.** Everything goes through the `t()` helper against `resources/lang/vi/`. Dates and numbers are formatted with `Intl` APIs using the active locale, never hand-written format strings.
- **Status is never carried by colour alone** — every state renders an icon, a word, and a colour. Icons come from Lucide and never appear without a text label in navigation or actions.
- **Every mutation button disables itself and shows a spinner while in flight.** This is not only polish: it prevents the double-submit that would otherwise create duplicate loans.
- Charts use Recharts, limited to bar and line, each with a text summary above it. No pie charts.
- Every manager screen is designed at 375px first. Tables become stacked cards below 768px — never horizontally scrolling tables. Touch targets are at least 44×44px; primary buttons are 56px tall; inputs are 48px.
- A React error boundary wraps each layout so a component crash degrades one region rather than blanking the page.

---

## 9. Testing rules

- **Pest, feature-test-first.** The pyramid is deliberately top-heavy: feature tests exercising real HTTP requests against a real database catch the bugs that matter and survive refactoring.
- **Feature tests for every Action and every endpoint.** This is the bulk of the suite, organised as `tests/Feature/{Catalog,Circulation,Identity,Community,Audit}/`.
- **Unit tests for pure logic only** — the permission map, due-date calculation, text normalisation, settings defaults. Do not unit-test Eloquent.
- **One named test per invariant in `tests/Feature/Invariants/`**, named so a failure states the rule it broke (`inv_1_a_copy_has_at_most_one_active_loan`). All twelve of INV-1..INV-12 are covered. INV-1 additionally gets a **concurrency test** asserting the database constraint — not application code — rejects a second active loan.
- **Tenancy isolation tests** asserting a manager of one shelf receives 404 for another shelf's resources. Every new tenant-scoped resource gets one.
- **Tests run against MySQL, never SQLite.** The design depends on MySQL-specific behaviour: the stored generated column `active_copy_key` and NULL semantics in unique indexes. A test suite passing on SQLite would be testing a different system.
- **A factory exists for every model**, with states matching the domain states (`->onLoan()`, `->retired()`, `->suspended()`) so a test reads as a scenario rather than a pile of attribute overrides.
- **Minimum 80% coverage on `app/Domain`**, enforced in CI. Coverage elsewhere is not a target; correctness of the domain is.
- Feature tests that assert the server rejects what the Zod schema would reject are how the client and server validation rules are kept aligned. Write one per form.
- No browser tests in v1. If quick-lend grows complex enough to need one, Laravel Dusk is added then — raise it rather than adding a different tool.

---

## 10. Security rules

- **Tenant scoping is structural, not disciplinary.** Route binding + `ResolveBookshelf` middleware + `BelongsToBookshelf` global scope. With all three in place, cross-tenant leakage requires deliberately calling `withoutGlobalScope`, which is permitted only in named super-admin Query classes. Treat any other use as a security defect.
- **Policies are the security control. UI hiding is not.** Every Inertia page receives a `can` object so the interface hides what the user cannot do, but that is a courtesy. Every controller action still calls `authorize()`, and every Action's caller is assumed hostile.
- **Comments are plain text, stored as plain text, rendered escaped.** There is no rich text and no HTML in user-generated content, which removes the entire XSS surface. Do not "improve" this by adding markdown or formatting.
- **Rich text (announcements, posts) is sanitised server-side on WRITE**, in the Action, against a strict allowlist: headings, paragraphs, bold, italic, lists, links, images, blockquote, horizontal rule. Nothing else — no inline styles, no scripts, no iframes. **Never sanitise on read**; stored data must always be safe. Sanitisation lives in `app/Support/HtmlSanitizer`.
- **No secrets in the repository.** `.env.example` is committed and documents every variable; `.env` is not. No API keys, passwords, or dumps in fixtures or seeders.
- **Rate limit every guest-accessible write endpoint** — guest borrow requests, feedback, registration — and add a honeypot field to public forms. An anonymous form collecting a name and phone number is an open door on the public internet.
- **Hash IPs.** `borrow_requests.ip_hash` and `feedback.ip_hash` are `char(64)` hashes used for rate limiting. Never store a raw IP address.
- **Never log PII of minors.** Names, dates of birth, parents' names, and phone numbers must not appear in application logs, exception context, or third-party error reporting. Audit `context` carries route name, user agent, and hashed IP — not profile fields.
- **Mass assignment is guarded** with explicit `$fillable` on every model. Never pass `$request->all()` into a model.
- Manager-issued password reset sets `must_change_password`; there is no email-based reset in v1. Passwords are bcrypt, and `password` and `remember_token` are excluded from audit diffs by allowlist.
- Fonts are self-hosted. Nothing loads from a third-party CDN at runtime.

---

## 11. Performance rules

- **No N+1 queries, ever.** Eager load in the Query or controller read path. `Model::preventLazyLoading()` is enabled outside production so violations fail loudly in development and tests.
- **Every list query is index-backed.** Before writing a filter or sort, check the indexes in spec §3.2 and add a migration if the access path is new. The `(actor_user_id, created_at)` index on `audit_logs` exists specifically to make the super admin's per-manager activity screen fast; that screen is a headline requirement, so its index is not optional.
- **Paginate everything.** 24 for grids, 50 for tables. No unbounded `all()` in a request path.
- **Cache statistics.** Aggregate counts are cached and warmed by `olibra:refresh-statistics`; cache invalidation is driven by event listeners. Dashboards read cached aggregates through deferred Inertia props.
- **Lazy-load the editor.** Tiptap enters the bundle only on manager and admin editing screens.
- **Image resizing happens on the queue** (`ResizeCoverImage`), never inline in a request. Requests never wait on GD or Imagick.
- **Keep the public bundle small.** The catalogue is browsed by children on cheap phones over poor connectivity. Before adding a dependency to the public surface, check whether Inertia, Tailwind, or an existing shadcn primitive already covers it. Manager-only and admin-only code splits away from the public entry point.
- Search runs `LIKE '%term%'` against the normalised columns. That is correct at a few hundred books per shelf; do not introduce an external search engine.

---

## 12. Documentation rules

- **The spec is the single source of truth.** If an implementation decision changes what the spec says — an invariant, a state machine, a fixed assumption, a technology choice — **update `docs/superpowers/specs/2026-08-06-olibra-design.md` in the same PR**. A design change belongs in a revision of that document, not in a commit message.
- **Keep `docs/ARCHITECTURE.md` current.** Any new context under `app/Domain/`, new middleware, new layer boundary, or new cross-cutting mechanism gets described there when it lands, not later. `docs/DEPLOYMENT.md` and `docs/DOMAIN.md` are maintained the same way.
- **PHPDoc only where it adds information beyond the signature** — array shapes, generic types Larastan needs, thrown exceptions. A `@param string $title` above `public function execute(string $title)` is noise and should be deleted.
- **Comments explain constraints, not mechanics.** "MySQL treats NULL as distinct in unique indexes, which is what enforces INV-1" is worth writing. "Loop over the copies" is not. When a piece of code exists because of a rule in the spec, name the rule (`INV-6`) in the comment.
- Every Action gets a one-line class-level docblock stating the operation and the invariants it enforces.
- README covers setup and the local environment. `.env.example` documents every variable.
- Commits follow **Conventional Commits** with the domain area as scope: `feat(circulation): add renewal blocking when queue is non-empty`.

---

## 12a. Git workflow

The full rules are in `RULES.md` §12. The three that catch people out:

**Never commit or push to `main`.** Every change reaches `main` through a pull request, including one-line documentation fixes and including work done solo. The only direct commit to `main` was the initial repository setup. Branch first — `git switch -c feat/...` carries uncommitted work across if you started in the wrong place.

**Branches are `type/short-kebab-description`** using the Conventional Commit types (`feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`). Keep them short-lived: one Action plus its tests plus its screen is a good pull request. The description says what changed, why, how it was verified, and which invariants it touches.

**Worktrees go inside the project, under `.worktrees/`**, which is gitignored:

```
git worktree add .worktrees/feat-quick-lend -b feat/quick-lend
```

Never create one outside the repository. A worktree beside the project scatters it across the filesystem, falls outside the editor's workspace, and is easy to abandon and forget. Under `.worktrees/`, the entire project — work in progress included — stays one directory that can be moved, archived, or deleted as a unit. Remove it when the branch merges: `git worktree remove .worktrees/<name>`.

Note that `.artifacts/` is per-worktree. Never symlink or share it between worktrees.

---

## 13. Definition of Done

A change is done when all of the following are true.

- [ ] The behaviour matches the spec; any deviation is either agreed or written into the spec in this same PR.
- [ ] `declare(strict_types=1);` on every new PHP file; all new code fully typed.
- [ ] `pint --test` passes.
- [ ] `phpstan analyse` passes at Larastan level 6 with no new ignores.
- [ ] `tsc --noEmit` and `eslint` pass; no `any` introduced.
- [ ] `npm run build` succeeds.
- [ ] Pest suite passes against **MySQL**; coverage on `app/Domain` is at or above 80%.
- [ ] Feature tests cover every new Action and endpoint; any invariant touched has its named test in `tests/Feature/Invariants/`.
- [ ] Any new tenant-scoped resource has a tenancy isolation test.
- [ ] Factories exist for any new model, with states for its domain states.
- [ ] Every write endpoint has a FormRequest; every controller action calls `authorize()`.
- [ ] All user-facing strings are in `resources/lang/vi/`, with `en/` scaffold keys added.
- [ ] The screen works at 375px; touch targets meet the minimums; status shows icon + word + colour.
- [ ] No N+1: the read path eager-loads and passes with `preventLazyLoading()` enabled.
- [ ] Audit rows are written for every state transition, inside the same transaction.
- [ ] `docs/ARCHITECTURE.md` updated if structure changed.
- [ ] No temporary file was left outside `.artifacts/`, and `git status` is clean of stray generated files.
- [ ] The work is on a `type/description` branch, not on `main`, and reaches `main` through a pull request.
- [ ] Conventional Commit message; PR description names the invariants touched.
- [ ] Quick-lend and quick-return are no slower and no longer than before, or the PR justifies why.

---

## 14. Review checklist

Work through this when reviewing a diff, yours or another agent's.

**Architecture**
- [ ] Business logic is in an Action, not a controller, model, listener, or React component.
- [ ] Each Action has exactly one public `execute()` and accepts typed data, not a `Request`.
- [ ] No controller method exceeds ~15 lines; it authorises, validates, calls one Action or Query, returns.
- [ ] No `*Service`, no repository, no permissions package, no client state library introduced.
- [ ] The dependency rule holds: nothing in Domain references HTTP; no Action returns an Inertia response.
- [ ] Complex reads live in a `NounQuery`, not inline in a controller.

**Domain correctness**
- [ ] State transitions are legal per §4 and enforced, not assumed.
- [ ] Derived state (overdue, hold expiry, availability) is computed at query time through the shared scope, and no job writes it.
- [ ] Policy values come from `BookshelfSettings`, not hard-coded numbers.
- [ ] Loans are voided, never deleted; audit rows are never updated or deleted.
- [ ] Soft delete is not used where a domain state (`retired`, `left`, `voided`) is meant.
- [ ] Normalised search columns are written on every relevant write, via `TextNormalizer`.
- [ ] No generated or scratch file was committed, and nothing in the diff reads from `.artifacts/`.

**Security**
- [ ] Every controller action calls `authorize()`; the policy, not the hidden button, is what enforces it.
- [ ] Tenant scoping comes from the trait; no manual `bookshelf_id` filtering and no `withoutGlobalScope` outside a named super-admin Query.
- [ ] `$fillable` declared; no `$request->all()` into a model.
- [ ] Rich text sanitised on write against the allowlist; comments remain plain text rendered escaped.
- [ ] Guest endpoints rate limited and honeypotted; IPs hashed; no minor PII in logs.
- [ ] No secrets, keys, or real personal data added to the repo, fixtures, or seeders.

**Performance**
- [ ] Eager loading present; no N+1 in any new read path.
- [ ] New filters and sorts are index-backed; a migration was added if not.
- [ ] Lists paginate; statistics come from cache; images resize on the queue.
- [ ] Nothing heavy was added to the public bundle; Tiptap stays lazy.

**Frontend**
- [ ] Function components, explicit return types, no `any`.
- [ ] Forms go through `useInertiaForm` with a Zod schema mirroring the FormRequest.
- [ ] Components under ~200 lines; shadcn primitives untouched in `components/ui/`.
- [ ] Tailwind only, restricted spacing scale, no inline styles.
- [ ] Mutation buttons disable while in flight; loading and empty states exist.
- [ ] No hard-coded strings; dates and numbers formatted with `Intl`.

**Tests and docs**
- [ ] Feature tests first, against MySQL, with factories.
- [ ] Named invariant tests for anything in INV-1..INV-12 that the change touches.
- [ ] Tenancy test for any new tenant-scoped resource.
- [ ] Spec updated if the design changed; `docs/ARCHITECTURE.md` updated if structure changed.
- [ ] Comments explain constraints and name invariants; no restating of the signature.
