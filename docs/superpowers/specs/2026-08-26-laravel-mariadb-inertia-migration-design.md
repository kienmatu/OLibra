# Migration to Laravel, MariaDB and Inertia — design

**Status:** Approved.
**Date:** 2026-08-26
**Scope:** Rebuild the entire OLibra application — currently Next.js 16 on PostgreSQL, deployed by Docker Compose to a VPS — as Laravel + Inertia (React) on MariaDB 10.11, deployed to shared cPanel hosting on CloudLinux. Feature parity with `v0.1.0`, no new features, no data to migrate.

[BUSINESS-REQUIREMENTS.md](../../BUSINESS-REQUIREMENTS.md) remains the authority on what the product does and why. It names no framework and does not change in this migration. Where this document and that one disagree, that one wins.

**A path note for later readers.** Every bare `src/...` path below (`src/app/`,
`src/domain/`, `src/components/ui`, etc.) describes the Next.js reference
codebase as it stood at `v0.1.0`, at the repo root. After Phase 0 landed, that
tree moved to `old_next/` to resolve a collision with Laravel's own `app/`
directory (see `docs/known-gaps.md`) — so read every `src/...` reference here
as `old_next/src/...` against the current tree. `app/...` references below
were already, and remain, root-relative.

---

## 1. What is being migrated, and why

The system at `v0.1.0` is complete and working: 418 commits, 54 route pages under `src/app/`, 116 files across the domain groups in `src/domain/`, 35 SQL migrations, 180 test files carrying 1,638 tests, and an operations catalogue ([OPERATIONS.md](../../OPERATIONS.md)) defining 48 queries and 66 commands — 114 operations in all. That catalogue is transport-neutral by design, which is precisely what makes this migration definable: an operation is a name, a set of inputs and a contract, and the contract does not change when the stack does.

What changes is the hosting target. The user's chosen home for this system is **shared cPanel hosting on CloudLinux**, with **MariaDB 10.11.13-cll-lve-log** — both confirmed against the real host, not assumed. Shared hosting offers no Docker, no long-running daemon, no Redis, no PostgreSQL, one MySQL user, and LVE process limits. Next.js needs a Node server; Laravel is at home behind Apache with PHP-FPM. So the application is rewritten on the stack the hosting actually supports, rather than the hosting being fought into supporting the current stack.

### 1.1 This repository has been here before, in the other direction

This repository already migrated *off* a Laravel design once. Tags `v0.1.0-laravel-blueprint`, `v0.2.0-laravel-phase1-plan` and `v0.3.0-laravel-master-spec` preserve that work, and README.md records why it was abandoned: what was dropped was Laravel-specific scaffolding, while everything of lasting value — the domain model, the business rules, the state machines, the UX — carried forward into BUSINESS-REQUIREMENTS.md. Two things are different this time. First, shared cPanel hosting is now the chosen target rather than the constraint being escaped. Second, the business requirements are settled rather than in flux: the fourteen rules of BR §6, the state machines of BR §7, and the 114 operations exist, each covered by a named test, so the rewrite has a specification instead of a moving target.

### 1.2 Decisions already made (not to be re-opened)

These were decided by the product owner in the design conversation and are settled:

- **Hosting:** shared cPanel hosting on CloudLinux. Not Docker, not a VPS.
- **Database:** MariaDB 10.11.13-cll-lve-log, as found on the real host.
- **Row Level Security:** dropped — MariaDB has none. Guarantees that can live in the schema must (§5).
- **Repository:** rewrite in place on a long-lived `laravel` branch off `main`. The Next.js tree stays untouched as the reference implementation until a single deletion commit (§3).
- **Sequencing:** phased by the business requirements' own delivery phases (BR §1.4) (§11).
- **Front end:** port the existing Tailwind v4 markup; adopt shadcn/ui only where the app has no primitive or hand-rolls an accessible one (§7).
- **Object storage:** local disk now, the S3 driver kept swappable — moving to R2 later is a `.env` change (§8).
- **Existing data:** none to migrate. This is a greenfield deployment; seeders and factories only.
- **Routes:** no Vietnamese in URIs. UI copy stays Vietnamese (§6).
- **Architecture:** Laravel-idiomatic, with a carve-out for pure functions (§1.3).

### 1.3 Architecture: Laravel-idiomatic, with a pure-function carve-out

Three architectures were weighed.

**Approach A — chosen.** Laravel-idiomatic: Eloquent models, single-purpose Action classes, Form Requests, Policies, thin controllers, Inertia pages. The carve-out: pure functions with no I/O — folding, date rules, copy-code generation, condition logic, permission predicates — port as plain PHP in `app/Support` and `app/Policies`, tested without booting the framework.

**Approach B — rejected.** A framework-free domain layer behind repositories and a unit of work, mirroring today's `src/domain/`. It fights Laravel and doubles the mapping code. BR §21's separability requirement (business logic separable from the delivery mechanism, so a public API can be added later without duplicating a rule; SDD §10 point 4 restates it) is about where the rules live, not about whether they use the ORM. An Action class that takes typed inputs and returns typed results satisfies it.

**Approach C — rejected.** Query builder throughout, no Eloquent. It loses policies, observers and casts — the very machinery that makes tenancy scoping (§5.2) and enum casting (§4) cheap and uniform.

### 1.4 The reference project

**The reference project is `~/Documents/dreamtube`** (redirected by the product owner on 2026-08-27; an earlier revision of this spec named `~/Documents/priest-liturgy`). Conventions come from it: Laravel 13 + Inertia v3 + React 19 + Tailwind v4 with shadcn/ui, Pint, Larastan level 8, Pest, Biome, single-purpose Action classes, thin controllers, UI copy in `resources/js/lib/copy.ts` and `lang/vi/`, a committed `docs/known-gaps.md` kept current, and spec → plan → implementation with plans carrying checkbox tasks and a `Status:` header.

What makes it the better reference is not taste: it runs the same stack **and is already deployed to OLibra's exact target profile** — CloudLinux/cPanel shared hosting, MariaDB 10.11.13, PHP 8.4.24 — with a `DEPLOYMENT.md` written from a real first deployment, every command actually run. It independently corroborates two things this branch discovered by execution: the errno 1901 refusal of `CHAR(36)` operands in generated-column expressions (our VARCHAR(36) rule), and PHP 8.4 as a hard floor (its `config/database.php` imports `Pdo\Mysql`, which does not exist on 8.3, so a MultiPHP downgrade breaks every database connection).

Deliberate divergences from it, kept on purpose: **Pest 5 / PHPUnit 13**, not dreamtube's Pest 4 / PHPUnit 12 (that would be a downgrade); **no monorepo** — dreamtube's `apps/web` layout exists for its extension and shared package, and OLibra has neither, so Laravel lives at the repository root; and this project uses English URIs where dreamtube-style Vietnamese URIs were already ruled out (§6). What changed *because* of the redirect: Inertia moved v2 → v3 before any page was written, the vite/React build tooling aligned to dreamtube's, and two traps recorded in dreamtube's `known-gaps.md` were closed here pre-emptively — the SSR gateway POSTing every render to the vite dev server, and Inertia v3's devtools serving recorded props to unauthenticated requests under `APP_ENV=local`. Both are recorded in this repo's `docs/known-gaps.md`. The implementation plan carries the full constraint list and names dreamtube as the version of record, divergences included.

---

## 2. Out of scope

- **No data migration.** There is no production data. The new system starts from migrations, seeders and factories.
- **No new features.** Parity with `v0.1.0` is the whole goal; the roadmap in BR §19 stays a roadmap.
- **No change to the business requirements.** BUSINESS-REQUIREMENTS.md is untouched by this migration.
- **No visual redesign.** DESIGN.md stands; the JSX and Tailwind markup port as they are (§7).

---

## 3. Repository and layout

Work happens on a long-lived `laravel` branch off `main`. Laravel lives at the repository root — the standard Laravel layout, the same shape as dreamtube's `apps/web` hoisted to the root, since OLibra has no second app to justify a monorepo (§1.4):

```
app/Actions/{Catalogue,Circulation,Members,Community,Admin,Notifications}/
app/Models/   app/Policies/   app/Enums/   app/Queries/   app/Support/
app/Http/{Controllers,Requests,Middleware}/
resources/js/{pages,components,layouts,lib}/     lang/vi/
database/migrations/   tests/{Feature,Unit}/     docs/superpowers/{specs,plans}/
```

The Next.js tree stays in place, untouched, for the whole migration. It is the reference implementation, and `v0.1.0` is the tag to diff against. It is deleted in **one** commit when parity lands (§11, phase 4), not incrementally — so at every intermediate point, "what does the current behaviour actually do" has a single answer in the working tree.

`docs/` carries over. BUSINESS-REQUIREMENTS.md names no framework and does not change. SDD.md, DATABASE.md and DEPLOYMENT.md are rewritten against the new stack at cutover. OPERATIONS.md's 114 operations (48 queries, 66 commands) become the checklist that says when a phase is done.

The domain groups map onto Action directories: `src/domain/circulation/commands/lend-copy.ts` becomes `app/Actions/Circulation/LendCopy.php`, and that command's existing TypeScript test is the specification for the class. The six command-bearing groups — catalogue, circulation, members, community, admin, notifications — map one-for-one to the six `app/Actions` subdirectories. The three remaining `src/domain` directories have homes of their own: `kernel/` (the pure functions — folding, clock, errors, audit actions, tenant predicates) becomes `app/Support` and `app/Policies` per §1.3's carve-out, and the query-only `portal/` and `shelf/` groups land in `app/Queries`.

---

## 4. The schema under MariaDB 10.11

Scope today: 20 tables, 11 Postgres enum types, 10 partial unique indexes, 10 partial non-unique indexes, 15 composite tenant foreign keys, 2 views. Every row of the translation below names the Postgres construct, its MariaDB replacement, and whether the guarantee survives — because DATABASE.md's whole point is which guarantees live in the database, and this migration must not lose any silently.

| Today (Postgres) | Under MariaDB | Guarantee |
|---|---|---|
| `uuid` PK, `gen_random_uuid()` | `CHAR(36)` with `ascii_bin` collation; UUIDv7 via Laravel's `HasVersion7Uuids` | Kept. v7 keeps clustered-index inserts sequential, which matters on InnoDB where the primary key is the clustered index. MariaDB's native `UUID` type has no Eloquent mapping and byte-swaps for v1 — not worth the friction. |
| 11 `create type … as enum` | `VARCHAR(20)` + `CHECK (col IN (…))` + PHP backed enums in `app/Enums`, cast on the model | Kept. Deliberately not MariaDB's `ENUM` type: adding a value there rewrites the table, whereas a `CHECK` is a one-line migration. |
| `timestamptz`, `now()` | `DATETIME(6)` storing UTC; rendered in `Asia/Ho_Chi_Minh` | Kept and improved. MariaDB `TIMESTAMP` is 32-bit and session-timezone-dependent, so it is not used. Carbon binds objects rather than strings, so the `DateStyle` trap that `compose.yaml` documents disappears. |
| `jsonb settings` | `LONGTEXT` + `json_valid()` CHECK, `AsArrayObject` cast | Weakened harmlessly — no GIN index, but the blob is read whole and never queried by key. |
| 10 partial UNIQUE indexes | `PERSISTENT` generated column that is NULL when the predicate is false, plus a plain unique index on it | Kept in full. Mechanism in §4.1. |
| 10 partial non-unique indexes | plain indexes on the same columns | Access-path only. No correctness loss; slightly larger indexes because the excluded rows are now included. |
| 15 composite tenant FKs + `UNIQUE (bookshelf_id, id)` on each parent | identical | Kept and promoted: with RLS gone this is the only *structural* tenant boundary (§5.1). |
| CHECK constraints (`users_credentials_paired` and the rest) | identical | Kept — MariaDB enforces CHECK constraints since 10.2. |
| Triggers refusing DELETE on `loans` and UPDATE/DELETE on `audit_log` | `BEFORE` triggers raising `SIGNAL SQLSTATE '45000'` | Kept. The paired `REVOKE` half is dropped: shared hosting gives one MySQL user and no way to split roles. |
| `olibra_now()` injectable DB clock | dropped | Replaced by `Carbon::setTestNow()` and a `Clock` binding. It existed because two database roles needed to agree on one clock; there are no longer two roles. |
| `loans_current`, `copies_borrowable` views | `app/Queries` classes | These encode read shapes, not invariants; nothing is lost by moving them into code. |
| RLS + the `olibra_app` / `olibra_admin` / `olibra_pool` roles | dropped | See §5 for what replaces it, and §10 for what it costs. |

### 4.1 Partial unique indexes as generated columns

The ten partial unique indexes to convert, by name: `users_username_key`; `parish_units_name_unique_in_scope`; `bookshelves_slug_unique`; `loans_one_active_per_copy`; `profile_change_requests_one_pending`; `memberships_one_per_shelf` (alive rows); `books (bookshelf_id, slug)` alive; `book_copies (bookshelf_id, code)` alive; `announcements (bookshelf_id, slug)` alive; `bookshelf_contacts (bookshelf_id, position)` alive.

The mechanism, concretely:

- **Single-column predicates:** a generated column such as `active_copy_id AS (IF(status = 'active', copy_id, NULL)) PERSISTENT` with `UNIQUE (active_copy_id)`. MariaDB treats NULLs as distinct in a unique index, so returned loans stop colliding, and two managers lending the same copy in the same second still produce one clean errno 1062 / SQLSTATE 23000, which the application turns into "Bản sách này vừa được mượn" — BR §2's requirement that one of them "must fail cleanly and see a plain message, never a silently corrupted record", the same translation `0009_invariant_constraints.sql` performs for Postgres's 23505 today.
- **Multi-column predicates:** collapse the key columns to `UNHEX(SHA2(CONCAT_WS(0x1f, …), 256))` stored as a `BINARY(32)` PERSISTENT column, NULL when the predicate is false. This also sidesteps InnoDB's 3072-byte index-key limit. `SHA2` and `CONCAT_WS` are built-ins, so they are legal inside a generated-column expression.
- **`parish_units_name_unique_in_scope`** additionally needs `IFNULL(parent_id, '')` inside the concat, to recover Postgres's `NULLS NOT DISTINCT`: every level-1 unit shares a null `parent_id` (the reasoning `20260808_03_soft_delete_aware_uniqueness.sql` carries forward from DATABASE.md §4.1), and without this a null parent is a wildcard that lets duplicate level-1 names through.
- **Collations** on generated key columns must be binary, so that 'Tổ 1' and 'To 1' remain distinct values rather than collation-equal ones.

The soft-delete-aware shape of these indexes is load-bearing, not stylistic. `20260808_03` and `20260808_09` record the bug class each one closes: a plain unique constraint blocks re-creating a live "Tổ 1" after soft-deleting one, blocks ever reusing a bookshelf slug, and so on — soft deletion exists to undo mistakes (BR §11), and a uniqueness rule that counts the undone rows makes every undo a landmine. The generated-column form must preserve the predicate exactly, and §9's DbGuarantees suite is what proves it did.

### 4.2 The one real loss in the schema: `olibra_fold()`

MariaDB has no `unaccent`, and it forbids stored functions inside generated-column expressions, so the folding function that backs diacritic-insensitive search (BR §12) has no direct port. Three options were weighed; option 1 is chosen.

1. **Chosen: a hand-expanded generated column.** Nested `REPLACE()` over the Vietnamese code points plus đ→d, emitted by a script, `PERSISTENT`. Deterministic, enforced by the database, no stored function. The expression is roughly 2 KB: ugly, but generated rather than maintained. `tests/db/folding.test.ts` already asserts that DB folding and application folding agree over a corpus; it ports directly and is what stops the two drifting.
2. **Documented fallback: app-maintained folded columns** written by a model observer. Cleaner to read; loses the guarantee the moment anything writes SQL directly. The implementation plan must name this as the fallback if option 1's expression proves unmanageable, rather than pretending that cannot happen.
3. **Rejected: an accent-insensitive collation** (`utf8mb4_uca1400_ai_ci`). It changes equality semantics for every comparison on the column, and its handling of đ is Unicode-version-dependent — precisely the trap `0002_folding.sql`'s comment warns about, since đ is a distinct Vietnamese letter, not a d with a mark.

Two facts about the folding rule must survive into the implementation. BR §12 requires that whatever normalisation is applied when storing a title is the *identical* normalisation applied to the search term, so DB folding and application folding can never drift. And `unaccent()` does not fold đ to d — which is why the current definition carries an explicit `translate(…, 'đĐ', 'dD')`, and why the generated `REPLACE()` chain must include đ→d and Đ→D explicitly.

---

## 5. Tenancy, now that RLS is gone

This is the part of the migration that actually removes safety, so it gets three replacement layers plus a dedicated test suite — not one replacement.

### 5.1 Structural

The 15 composite foreign keys, unchanged, each backed by `UNIQUE (bookshelf_id, id)` on the parent table. A membership whose `parish_unit_l1_id` names another shelf's unit is not merely hidden — it *cannot be stored*. This layer survives a bug in every other layer, which is why the FK work lands in the foundation phase (§11, phase 0) and not later.

The original migration `20260808_04_composite_tenant_fks.sql` documents the live demonstration of why this layer exists: under RLS alone, a Đồng Tháp session successfully inserted a membership pointing at a Cần Thơ parish unit, and the row then read back as a null parish line that nothing on that shelf could read, correct, or tell apart from an unassigned membership. RLS governed which *rows* a session saw; it never made a cross-tenant *reference* unrepresentable. The composite FKs did, and with RLS gone they do that job alone.

### 5.2 Routine

`{shelf}` is a route-model binding on `Bookshelf`, resolved by slug. A `BelongsToBookshelf` trait adds a global scope that reads the bound shelf from a request-scoped `TenantContext`, and a `booted` hook stamps `bookshelf_id` on create. Nothing in a controller writes `where('bookshelf_id', …)` by hand — the same discipline the RLS design imposed, moved from the database to the model layer.

### 5.3 Authorisation

Policies per model, gated on the caller's membership role and status in the bound shelf. `requireManager` and the rest of `src/domain/kernel/tenant.ts` become Gate definitions and policy methods; the middleware that resolves the membership is the only place a role is read. Roles: `membership_role` is `reader | manager | admin` (admin meaning shelf admin), plus the global `users.is_super_admin` flag. `membership_status` is `pending | active | suspended | left | rejected`. The hierarchy is BR §13's: within a shelf, `admin ⊃ manager ⊃ reader`.

### 5.4 The TenantIsolation suite

This suite replaces what the database used to give free, and it is non-negotiable rather than nice-to-have. It seeds two shelves with deliberately colliding data and, for every route in the map (§6), asserts:

- a member of shelf A gets **404, not 403**, on shelf B's URLs — 404 so the URL space does not confirm what exists;
- no Inertia prop carries a foreign `bookshelf_id`;
- every shelf-scoped model carries the `BelongsToBookshelf` trait — an architecture test, so a model added later without it fails the build rather than quietly serving every shelf's rows.

---

## 6. The URL map

English URIs; Vietnamese UI copy untouched (BR §18 governs language, and it is about what people read, not what URLs say). Route names mirror the URI. Ziggy exposes route names to React, so no path is written by hand in a component.

| Today | Under Laravel |
|---|---|
| `/dang-nhap`, `/dang-ky`, `/lien-he` | `/login`, `/register`, `/contact` |
| `/tu-sach` | `/shelves` |
| `/tu-sach/{shelf}` | `/shelves/{shelf}` |
| `…/danh-muc`, `/tim-kiem`, `/sach/{slug}` | `…/catalogue`, `/search`, `/books/{book}` |
| `…/ho-so`, `/ho-so/lich-su`, `/ho-so/thong-bao`, `/ho-so/tang-sach`, `/ho-so/tong-quan` | `…/profile`, `/profile/history`, `/profile/notifications`, `/profile/donations`, `/profile/overview` |
| `…/thong-bao`, `/gop-y`, `/tang-sach`, `/quet-ma` | `…/announcements`, `/feedback`, `/donate`, `/scan` |
| `…/quan-ly` | `…/manage` |
| `/cho-muon`, `/cho-muon/nguoi-doc`, `/cho-muon/xac-nhan` | `/lend`, `/lend/reader`, `/lend/confirm` |
| `/nhan-tra`, `/nhan-tra/bao-mat` | `/returns`, `/returns/lost` |
| `/nguoi-doc`, `/nguoi-doc/moi`, `/nguoi-doc/{id}` | `/readers`, `/readers/create`, `/readers/{reader}` |
| `/sach`, `/sach/moi`, `/sach/mat`, `/sach/{id}`, `/sach/{id}/sua` | `/books`, `/books/create`, `/books/lost`, `/books/{book}`, `/books/{book}/edit` |
| `/yeu-cau-muon`, `/qua-han`, `/dang-ky-cho-duyet` | `/borrow-requests`, `/overdue`, `/registrations` |
| `/binh-luan`, `/doi-thong-tin`, `/co-cau` | `/comments`, `/profile-changes`, `/units` |
| `/nhat-ky`, `/thong-ke`, `/cai-dat`, `/ma-qr` | `/audit`, `/statistics`, `/settings`, `/qr-labels` |
| `/xuat/{loai}`, `/xuat/ma-qr` | `/exports/{kind}`, `/exports/qr-labels` |
| `/quan-tri/*` | `/admin/*` — `/shelves`, `/managers`, `/categories`, `/settings`, `/audit`, `/feedback`, `/profile-changes` |

Two notes:

- `/books/create` and `/books/lost` **must** be declared before `/books/{book}`, or Laravel binds "lost" as a slug — an easy, silent bug, so §9's Architecture suite carries a route-order test.
- One small improvement is taken while porting: today the reader-facing detail page binds a book by slug and the manager-facing one by id. Under Laravel both bind by slug, scoped to the shelf, so a manager can paste a reader's URL and land on the same book.

---

## 7. The front end

Server components become controllers returning `Inertia::render`. The 11 server-action modules (the files carrying `"use server"`) become POST/PATCH/DELETE routes with Form Requests. `useActionState` becomes Inertia's `useForm`; `revalidatePath` becomes a partial reload. `loadPage`'s rule — 404 for a signed-in non-manager, redirect for a guest — moves into middleware plus an exception handler mapping `RuleViolated` to the right response, so it stays one decision in one place. Segment layouts become Inertia persistent layouts.

The JSX ports largely as-is. Tailwind v4 comes across unchanged via `@tailwindcss/vite`. The 13 hand-rolled components in `src/components/ui` port verbatim. shadcn/Radix comes in only where the app has no primitive or hand-rolls an accessible one: dialog, dropdown, select, tooltip.

Server-side library replacements — this is where the effort estimate has the most air in it, and the implementation plan should treat these rows as the ones most likely to surprise:

| Today | Under Laravel |
|---|---|
| `sharp` | Intervention Image v3 (GD; Imagick if the host offers it) |
| `qrcode` | `bacon/bacon-qr-code` (SVG output needs no PHP extension) |
| `pdf-lib` + `fontkit` | dompdf with an embedded Vietnamese TTF |
| `@node-rs/argon2` | PHP native argon2id (bcrypt is the documented fallback if the host's PHP lacks it) |
| `@aws-sdk/client-s3` | Flysystem: local `public` disk now, `s3` kept swappable |
| CSV export | streamed response, no library |

The QR scanner is `zxing-wasm` running in the browser and carries over untouched.

One convention change is taken during the port, not after it: Vietnamese strings are inline in TSX today. Client copy moves to `resources/js/lib/copy.ts` and server copy to `lang/vi/`, enforced by Biome's `noJsxLiterals`. Doing this as each page moves is nearly free; a later pass would mean touching all 54 pages twice.

---

## 8. Deployment on CloudLinux cPanel

The whole Docker story is dropped and replaced.

- **Build off-host.** No Node at deploy time: GitHub Actions runs `vite build` and `composer install --no-dev -o` and ships an artifact. Delivery is cPanel Git deploy with a `.cpanel.yml`, or rsync.
- **Docroot.** The app lives outside `public_html`, which becomes a symlink to `public/`. If the host forbids that, the fallback is an `index.php` shim — and which of the two applies is a day-one finding (see the host survey below), not a cutover surprise.
- **Drivers.** `database` for queue, cache and sessions. No Redis. No `queue:work` daemon under LVE — instead a cron-driven `queue:work --stop-when-empty --max-time=50`.
- **Cron.** `* * * * * php artisan schedule:run`, carrying the 07:00 Asia/Ho_Chi_Minh reminder sweep that the `sweep` compose service runs today (BR §15's nhắc trả sách: three days before due, and again once lapsed).
- **Files.** `storage:link` for the local disk; the `s3` driver stays configured so moving uploads to R2 later is a `.env` change.
- **Backups.** `mysqldump` on a cron, plus the `storage/` directory. This replaces "back up `./data` and you have backed up everything", which was genuinely one of the nicer properties of the current setup, and it does get worse here — §10 says so plainly.

**Task one of the implementation plan, before any schema work** — confirm on the real host: **PHP 8.4** selectable (pinned to match the reference project; there is no lower fallback, so its absence is a blocking finding rather than a downgrade); `pdo_mysql`; `gd` or `imagick`; `zip`; `fileinfo`; `sodium` (for argon2id); and whether `symlink()` and `exec()` are disabled. Several of these change the design (the docroot fallback, the image library, the hashing algorithm) and all are cheap to check.

---

## 9. Testing

Pest with `RefreshDatabase`, against a **separate** MariaDB schema. priest-liturgy's `docs/known-gaps.md` records the `env_file` / `phpunit.xml` interaction that once silently ran its suite against the development database; that guard is written into the foundation phase here rather than learned twice — and execution found the guard as recorded there is incomplete (`<env>` never reaches `$_SERVER`; a stray `DB_URL` bypasses it entirely). The complete mechanism, which dreamtube's `phpunit.xml` also carries, is recorded in this repo's `docs/known-gaps.md`.

Six suites:

- **Unit** — the pure functions: folding, date rules, copy codes, condition logic. No framework boot.
- **Feature** — per controller.
- **Policy** — per policy.
- **TenantIsolation** — §5.4.
- **Architecture** — `BelongsToBookshelf` present on every shelf-scoped model; no hand-written `where('bookshelf_id')`; route declaration order (§6); no inline Vietnamese JSX copy (§7).
- **DbGuarantees** — one test per invariant that provokes the violation and asserts the right SQLSTATE. This is how a wrongly-written generated column (§4.1) is caught: not by reading the 2 KB expression, but by inserting the row it is supposed to refuse.

The 1,638 existing tests are the specification. Every ported Action starts by reading its TypeScript test.

---

## 10. Risks, and what they cost

Four things get genuinely worse in this migration. Naming them here is the point of this section; each has a mitigation, and none has a hidden second half.

1. **RLS is gone.** Today a session variable plus row policies means a query that forgets its tenant filter returns nothing rather than everything. Under MariaDB that safety net does not exist. The replacement is three layers (§5) — composite FKs that make cross-tenant references unstorable, a model-level global scope, and policies — plus the TenantIsolation suite. The honest accounting: the structural layer is as strong as before (it is the same FKs), but the read-side protection moves from the database to the model layer, where a developer bypassing Eloquent bypasses it. The Architecture suite's ban on hand-written `bookshelf_id` filters exists because of exactly that gap.
2. **`unaccent` is gone.** The folding function becomes a generated 2 KB `REPLACE()` chain (§4.2) — enforced by the database, but no longer readable by a human. The corpus test is what keeps it honest, and the app-maintained fallback is documented in advance rather than improvised under pressure.
3. **The backup story degrades.** Today, backing up `./data` backs up everything — database, uploads, the lot, in one bind-mounted directory. Under shared hosting it is a `mysqldump` cron plus the `storage/` directory: two things, two schedules, two restore paths, and a dump is a logical copy rather than the files themselves. The rewrite of DEPLOYMENT.md at cutover must document the restore path end to end, tested, not asserted.
4. **Shared-hosting constraints.** No long-running daemon, so queue work rides a per-minute cron with `--stop-when-empty --max-time=50` — worst-case latency for a queued job is about a minute, which BR §15's notification model tolerates (readers get in-app notifications; managers get badge counts, nothing pushed). No Node at deploy time, so every asset is built in CI and shipped. LVE process limits cap concurrent PHP workers; at the scale BR §1 describes (a few hundred books, volunteers at a physical shelf) this is not a practical ceiling, but it is why nothing in this design assumes background concurrency.

---

## 11. Phases and deliverables

Phasing follows BR §1.4's own delivery phases, with a foundation phase before and a cutover phase after. Each phase ends in something that runs.

- **Phase 0 — Foundation.** The host survey (§8's task one), the Laravel scaffold, the full MariaDB schema — all ten generated-column uniques and all fifteen composite FKs land here, not later — models, enums, the tenancy trait and `TenantContext`, authentication, the app shell, CI, and the deploy pipeline. Nothing starts before this.
- **Phase 1 — Core loop.** Catalogue, copies, readers and registration approval, lend/return with condition assessment, the audit log, the manager dashboard, the member-facing catalogue and search, lost-copy handling, CSV export. Per BR §1.4, this phase is a genuinely useful product on its own.
- **Phase 2 — Community.** Borrow requests, holds and the waiting queue, comments and moderation, announcements, feedback, statistics, donations, notifications and the reminder sweep, QR labels.
- **Phase 3 — Network.** The portal directory, multi-shelf administration, cross-shelf audit and the profile-change queues.
- **Phase 4 — Cutover.** Delete the Next.js tree in one commit, rewrite SDD.md, DATABASE.md and DEPLOYMENT.md against the shipped stack, merge `laravel` to `main`, tag `v0.2.0`.

This spec is deliberately one document, but it is not one implementation plan. Each phase above should get its own plan in `docs/superpowers/plans/` with checkbox tasks and a `Status:` header, in the repository's usual spec → plan → implementation shape; phase 0 is the first plan to write, and its first task is the host survey.
