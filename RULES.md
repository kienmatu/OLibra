# OLibra — RULES

Non-negotiable constraints for anyone working on this repository, human or AI.

The master design specification is `docs/superpowers/specs/2026-08-06-olibra-design.md`. It is the authority on *what* and *why*. This file is the authority on *what you may not do*. `AGENTS.md` covers conventions and guidance; a conflict between these files resolves in favour of RULES.md, and a conflict between RULES.md and the spec resolves in favour of the spec.

Breaking any rule below is a design change. It requires a revision of the spec, not a commit message.

---

## 1. Things AI must NEVER do

1. **Never bypass the `BelongsToBookshelf` global scope outside a named super-admin Query class.** `withoutGlobalScope` is permitted only inside `Domain/*/Queries/*` classes written for cross-shelf super-admin views — never in a controller, Action, model method, or blade/React layer. Tenant isolation is structural precisely so it does not depend on anyone remembering it.
2. Never hard-delete a `Loan`, and never add `SoftDeletes` to `loans`. A loan recorded in error becomes `status = 'voided'` with `voided_reason`, `voided_at`, and `voided_by_user_id` (INV-11).
3. Never update or delete an `audit_logs` row. The table is append-only: no `updated_at`, no soft delete, no model events that could rewrite it (INV-12).
4. **Never write overdue status, hold expiry, or copy availability from a scheduled job, an observer, or any background process.** These are computed at query time from stored data and the current clock. Production cron may only fire every 10–30 minutes, so any job-written status would be wrong for up to half an hour — a reader would see a book as available that was lent twenty minutes ago. `olibra:expire-holds` is a tidiness measure only; the system must remain correct if it never runs.
5. Never put business logic in a controller. A controller authorises, validates via a FormRequest, calls one Action or Query, and returns a response.
6. Never skip `authorize()` in a controller action. Not for "internal" routes, not for manager-only screens, not for anything.
7. Never rely on the UI hiding an action as a security control. The `can` object shipped to Inertia pages is presentation; the Policy is enforcement.
8. Never store unsanitised HTML. `body_html` on `announcements` and `posts` is sanitised on write in the Action against the strict allowlist, never on read.
9. Never render user comments as HTML. `comments.body` is plain text, stored plain and rendered escaped. Never add a rich-text editor to comments.
10. Never hard-code a user-facing string in PHP, Blade, or React. All strings live in `resources/lang/vi/` with an `en/` scaffold.
11. Never commit secrets, `.env`, credentials, database dumps, or API tokens. `.env.example` is committed and documents every variable; real values never are.
12. Never run npm, Node, Vite, or any JavaScript build step in production. The production host has no Node runtime.
13. Never configure SQLite for tests. The design depends on MySQL-specific behaviour — stored generated columns and NULL-distinctness in unique indexes — which SQLite does not reproduce.
14. Never introduce a Service class that accumulates multiple operations. One Action, one public `execute()`, one reason to change.
15. **Never introduce a repository layer.** Eloquent is already the data-access abstraction, there is no second implementation behind it, and a repository obscures eager loading — the main defence against N+1 queries — while pushing toward `findAll()`-style over-fetching. Complex reads go in Query classes.
16. Never add `spatie/laravel-permission` or any other permissions package. Three roles and one global flag are known at compile time; a `Permission` enum consulted by Policies is the model.
17. Never log, and never place in a URL, query string, or error message, any PII of a minor: date of birth, parents' names, phone number, tổ, or giáo họ.
18. Never change a `bookshelves.slug` after creation. It appears in shared links and must remain stable.
19. Never delete a user who has any audit history, any loan, or any audit trail. Offboarding revokes a role or sets membership `status`; identity and history survive.
20. Never add a mail channel, SMTP dependency, or email-based flow in v1. There is no outbound email; manager-issued password reset is the only recovery path.
21. Never dispatch an audit write to a queue, an event, or a listener. See §6.
22. Never edit a migration that has already run on production. See §4.
23. **Never write a temporary file anywhere but `.artifacts/`.** Not the repository root, not `/tmp`, not beside the file it describes. See §11.
24. **Never write real user data into `.artifacts/`** — no production database dumps, no exports containing real readers' names, dates of birth, parents' names, or phone numbers. The directory is untracked and easy to forget, archive, or share by accident, and the people in that data are mostly children.
25. **Never make anything read from `.artifacts/`.** No build step, test, migration, seeder, or deploy may take an input from it. If the build needs a file, that file belongs in the repository.
26. **Never commit or push directly to `main`.** Every change arrives through a pull request. See §12.
27. **Never create a git worktree outside the repository.** Worktrees go in `.worktrees/`, which is gitignored. See §12.
28. Never invent a technology, package, or pattern absent from the spec.

---

## 2. Things AI should ALWAYS do

1. Always wrap every Action mutation in a database transaction.
2. Always re-check the invariant *inside* the transaction, with row locking where a race is possible. A check performed before `beginTransaction` proves nothing.
3. Always write the audit entry through `AuditLogger` inside the same transaction as the change it describes, so a row and its audit can never diverge.
4. Always dispatch events after commit, never inside the transaction.
5. Always throw a domain exception on invariant violation (`CopyNotAvailableException`, `LoanLimitReachedException`). Actions never return `false` or `null` to signal failure.
6. Always eager load relations the view will touch. N+1 queries are a defect, not a performance nicety.
7. Always paginate list queries — 24 per page for grids, 50 for tables — and preserve filters across pages.
8. Always call `authorize()` before mutating anything.
9. Always validate writes through a dedicated FormRequest, one per write endpoint. Actions accept typed data objects or explicit scalars, never a raw `Request`.
10. Always model fixed value sets as backed PHP enums (`CopyState`, `CopyCondition`, `LoanStatus`, `BorrowRequestStatus`, `MembershipStatus`, `Role`, `Permission`, `AuditAction`). No magic strings.
11. Always add or extend a test for the invariant a change touches, named after the rule it protects, in `tests/Feature/Invariants/`.
12. Always keep controllers thin. A controller method longer than fifteen lines is a design smell and must be refactored, not merged.
13. Always respect the layer dependency rule: HTTP → Application → Domain → Infrastructure, downward only. A Model never references a Controller; an Action never returns an Inertia response.
14. Always interpret and format dates in `Asia/Ho_Chi_Minh`, regardless of server configuration.
15. Always write generated, captured, or scratch files to the matching `.artifacts/` subdirectory, and delete scratch files once they have served their purpose.

---

## 3. Database rules

1. Every tenant-scoped table carries `bookshelf_id` with a foreign key. No exceptions. `users` and `posts` are the only non-tenant-scoped domain tables; `feedback.bookshelf_id` and `audit_logs.bookshelf_id` are nullable for site-wide and global rows.
2. `loans.due_on` is a **DATE**, not a timestamp. A book is due at the end of a day. A timestamp would make books fall overdue mid-afternoon, which is wrong for a shelf only accessible after Sunday mass.
3. Event columns (`lent_at`, `returned_at`, `hold_expires_at`, `approved_at`, `assessed_at`, `retired_at`, `lost_at`) are timestamps. Calendar facts (`due_on`, `date_of_birth`, `acquired_at`, `established_at`) are dates.
4. **INV-1 is enforced physically, not in application code**, by a stored generated column plus a unique index on `loans`:
   ```sql
   active_copy_key BIGINT GENERATED ALWAYS AS (CASE WHEN status = 'active' THEN book_copy_id ELSE NULL END) STORED
   ```
   MySQL treats NULLs in a unique index as distinct, so any number of returned loans coexist while two simultaneous active loans on one copy are impossible. Two managers racing at the same shelf get a clean constraint violation rather than a corrupted record; `LendBookDirectlyAction` catches it and rethrows `CopyNotAvailableException`. Do not replace this with an application-level check, and do not remove `STORED`.
5. Soft deletes are allowed **only** on: `users`, `memberships`, `books`, `book_copies`, `categories`, `comments`, `announcements`, `posts`, `borrow_requests`, `bookshelves`.
6. Soft deletes are **forbidden** on: `loans` (use `voided`), `audit_logs` (append-only), `condition_assessments` (historical fact), `feedback`.
7. Soft deletion undoes mistakes. It is never a substitute for a domain state — `retired`, `lost`, `left`, `suspended`, `voided` describe things that actually happened and must not be modelled as deletion.
8. Foreign keys **restrict** deleting a book copy that has loan history and deleting a user with any audit trail. Only `books → book_copies` cascades. Do not add further cascades.
9. `books.title_normalized` and `books.author_normalized` are written on every write by the same `Support\TextNormalizer` used to normalise the search term. Search is `LIKE '%term%'` against these columns. If write-side and read-side normalisation ever differ, search silently breaks — so there is exactly one normaliser, used by both the model observer and the search Query.
10. The audit browser's indexes are mandatory, not optional: `INDEX(actor_user_id, created_at)`, `INDEX(bookshelf_id, created_at)`, `INDEX(auditable_type, auditable_id)`, `INDEX(action, created_at)`. Per-manager activity is a headline requirement and must stay fast.
11. `borrow_requests` must have either `user_id` or `guest_name` populated, enforced by a `CHECK` constraint as well as in the Action.
12. Bookshelf configuration goes in the `settings` JSON column read through the typed `BookshelfSettings` value object with defaults — never a new column per setting.
13. `loans.book_id` is denormalised deliberately so title-level statistics survive copy retirement. Do not "normalise it away".

---

## 4. Migration rules

1. Migrations are forward-only in production. Fix a mistake with a new migration.
2. Never edit, rename, or delete a migration that has already run on production or staging.
3. Every migration provides a working `down()` where feasible; state explicitly in the PR when it is not.
4. No migration destroys data without an explicit, documented backup step executed first.
5. Seeders never run automatically in production. `db:seed` is for local and staging only.
6. Production migrations run only as `php artisan migrate --force`, as part of the documented deploy sequence.
7. Never run `migrate:fresh`, `migrate:reset`, or `migrate:rollback` against production.
8. A migration that adds a column to a tenant-scoped table adds `bookshelf_id` handling with it.

---

## 5. React rules

1. Function components only. No class components.
2. No client state library — no Redux, Zustand, Jotai, TanStack Query, or equivalent. Server state is Inertia page props; shared state is Inertia shared props; local UI state is `useState`.
3. Forms use React Hook Form + Zod **through the `useInertiaForm` hook only**. Do not use Inertia's own `useForm` directly — two error-handling idioms in one codebase is the thing that hook exists to prevent.
4. Zod schemas live in `lib/validators` and mirror the PHP FormRequest rules.
5. No inline `style` attributes and no CSS-in-JS. Tailwind utility classes only, on the restricted spacing scale `2, 3, 4, 6, 8, 12, 16`.
6. Components stay under roughly 200 lines. Beyond that, extract.
7. Tiptap is lazy-loaded via dynamic import and never enters the public bundle.
8. No `fetch`, `axios`, or XHR calls. Inertia moves data; a manual request means the design was misunderstood.
9. No route table in JavaScript. Named Laravel routes reach TypeScript through Ziggy.
10. **Every button that triggers a mutation disables itself and shows a spinner while in flight.** A double-tap on "Cho mượn" would otherwise create a duplicate loan.
11. Tables become stacked cards below 768px. Never a horizontally scrolling table.
12. Every manager screen is designed at 375px first. Mobile is the primary manager experience, not a fallback.
13. Fonts are self-hosted with `font-display: swap`. Never load fonts from a third-party CDN.
14. Charts are bar or line only, via Recharts. No pie charts. Every chart carries a text summary above it.

---

## 6. Laravel rules

1. Every write operation is an Action class with a single public `execute()` method, following the fixed anatomy: typed input → transaction → invariant re-check with locking → mutate → audit → commit → dispatch events → return the model.
2. Complex reads are Query classes (`OverdueLoansQuery`, `RequestQueueQuery`, `ShelfStatisticsQuery`, `ManagerActivityQuery`). Derived-state logic (overdue, hold expiry, borrowability) lives in exactly one scope or Query each.
3. Authorisation is Laravel Policies, one per model, consulting the acting user's membership in the current bookshelf or short-circuiting on `is_super_admin`. No inline role checks scattered through controllers.
4. Observers do auditing and normalisation only — never business logic, never state transitions, never side effects a user waits on.
5. Events (`BookLent`, `BookReturned`, `MembershipApproved`, `BorrowRequestApproved`, `CommentPosted`) exist for cross-cutting reactions only: in-app notifications and cache invalidation.
6. **Events are never used for auditing.** Auditing is synchronous, inside the Action's transaction. An audit trail that can be lost to a failed queue job is not an audit trail.
7. The queue carries only deferrable work: cover image resizing, CSV export generation, statistics cache warming, database backups. Nothing a user waits on goes through a queue — it may not drain for thirty minutes.
8. Every scheduled command must be correct when run at irregular intervals and harmless when skipped entirely. If skipping it produces a wrong answer anywhere, the logic belongs in a query, not a schedule.
9. Tenancy uses all three mechanisms together: route model binding on `{bookshelf:slug}`, `ResolveBookshelf` middleware binding the `CurrentBookshelf` singleton and aborting 404 for archived or missing shelves, and the `BelongsToBookshelf` trait for the global scope and auto-fill.
10. Notifications are in-app only, via the `database` channel. No mail channel in v1. No push notifications to managers — they work from dashboard badge counts.
11. Sessions, cache, and queue use the database driver. There is no Redis on shared hosting.
12. Code passes Pint, Larastan level 6, and Pest with at least 80% coverage on `app/Domain`.

---

## 7. API rules

1. **No REST API ships in v1.** Do not add one, do not scaffold one, do not add API resource controllers.
2. Internal endpoints are conventional Inertia routes. GET returns an Inertia response.
3. Write endpoints redirect back with a flash message. They do not return JSON.
4. Query parameters use Vietnamese names matching the UI: `?trang_thai=`, `?sap_xep=`, `?tim=`. They are preserved across pagination.
5. Route names are dot-namespaced by area: `manager.books.store`, `reader.loans.renew`, `admin.bookshelves.index`.
6. When an API is eventually added it must: live under `/api/v1` with the version in the URL, authenticate with Laravel Sanctum tokens, authorise through the same Policies, and delegate to the **same Actions with zero duplicated business logic**. Any duplication of domain logic between web and API is a defect, not a shortcut.

---

## 8. Accessibility rules

1. WCAG AA is the minimum for all text and UI in both light and dark themes. Primary actions and status badges target AAA where achievable.
2. **Status is never conveyed by colour alone.** Every state carries an icon, a word, and a colour — Còn sách, Đang mượn, Đang giữ chỗ, Quá hạn, Đã mất, Ngừng dùng. This includes selection state in the condition picker (filled background plus a check, not colour).
3. Touch targets are minimum 44×44px; primary action buttons are 56px tall; inputs are 48px tall; interactive elements never sit closer than 8px apart.
4. Labels sit above inputs, always. A placeholder is never a label. Required fields are marked with a word, not only an asterisk.
5. The first validation error receives focus on submit, and errors render beneath the field with an icon.
6. Every interactive element is keyboard reachable and operable, with a visible focus ring. Never remove focus outlines without an equivalent replacement.
7. Every cover image has alt text. Missing covers use a generated placeholder, not a broken image.
8. Icons never appear without a text label in navigation or actions.
9. Copy is plain Vietnamese with no jargon — "Cho mượn", never "Giao dịch lưu thông".
10. Base font size is 16px on public pages, 17px in the manager interface. Body line height is 1.6.
11. One primary action per screen, visually dominant.

---

## 9. Security rules

1. Tenancy is structural, not disciplinary. Cross-tenant access must require deliberately calling `withoutGlobalScope` in a named super-admin Query class (see §1.1).
2. Policies are the authorisation control. UI visibility, route naming, and obscure URLs are not controls.
3. HTML from the rich text editor is sanitised **on write** against a strict allowlist: headings, paragraphs, bold, italic, lists, links, images, blockquote, horizontal rule. No scripts, no iframes, no inline styles, no event handlers. Stored data is always safe; never sanitise on read.
4. Comments are plain text, stored plain and rendered escaped. There is no HTML in user-generated content and therefore no XSS surface in it.
5. Every guest-accessible write endpoint — registration, guest borrow request, feedback — has rate limiting and a honeypot field.
6. IP addresses are stored hashed only, in `char(64)` `ip_hash` columns. Never store a raw IP.
7. Passwords are bcrypt. Password and `remember_token` are excluded from audit payloads by allowlist.
8. `must_change_password` is set by a manager-issued reset and enforced on the next login before any other route is reachable.
9. No PII of minors in logs, URLs, query strings, error messages, or client-side props beyond what the page must display. Date of birth, parents' names, phone, tổ, and giáo họ are manager-and-admin-only.
10. Public display of reader names is governed by the per-bookshelf `public_name_display` setting. Never hard-code the display choice.
11. CSRF protection applies to every write. Do not add routes to the CSRF exception list.
12. Mass assignment is guarded on every model. Never `$guarded = []` and never pass unfiltered request input to `fill()`, `create()`, or `update()`.

---

## 10. Deployment rules

1. Assets are built in CI and shipped as static files in `public/build`. Never build on the server.
2. There is no Node runtime in production. Nothing in the deploy or runtime path may invoke npm or node.
3. The domain's document root points at `/home/{user}/olibra/public`. Application code lives outside `public_html`.
4. Exactly one cron entry, running `php artisan schedule:run`. Every other periodic task is registered in the Laravel scheduler, never as a separate cron line.
5. Production migrations run as `php artisan migrate --force`, inside the documented deploy sequence, between `artisan down` and `artisan up`.
6. `config:cache`, `route:cache`, and `view:cache` run after every deploy. Consequently, never call `env()` outside `config/` — cached config would return null.
7. `composer install --no-dev --optimize-autoloader` in production. Dev dependencies are never installed there.
8. `.env` is never committed and never transferred as part of the build artifact. `.env.example` is committed and documents every variable.
9. Production requires PHP 8.4 with GD or Imagick for cover image processing.
10. If symlinks are disallowed by the host, point `FILESYSTEM_DISK` at a disk rooted inside the public directory rather than relying on `storage:link`. Do not assume `proc_open` or `symlink` are available.
11. Database backups run daily via the scheduler with seven-day retention. A deploy that could lose data does not proceed without a verified backup.

---

## 11. Temporary file rules

1. Every generated, captured, or scratch file goes in `.artifacts/`. Nowhere else — not the repository root, not `/tmp`, not beside the file it describes.
2. Use the subdirectory matching what the file **is**, not which tool produced it: `scratch/`, `logs/`, `coverage/`, `exports/`, `screenshots/`, `db/`, `reports/`.
3. A genuinely new kind of artefact gets a new subdirectory **and** a row in `.artifacts/README.md`. Undocumented directories are how a temporary directory turns into a junk drawer.
4. `.artifacts/` is gitignored except for its README. Never add a `.gitignore` exception to commit something from it — if it deserves committing, it was never a temporary file.
5. **`rm -rf .artifacts/*/` must always be safe**, at any moment, with no one reading the contents first. Every other rule in this section exists to keep that true.
6. Nothing may read from `.artifacts/`. It is write-only from the project's point of view.
7. No real user data, ever. See §1.24.
8. Date-prefix filenames once a directory accumulates: `logs/2026-08-06-deploy.log`, not `logs/deploy-final-2.log`.
9. Delete a scratch file when it has served its purpose. It should not outlive the question it was created to answer.

---

## 12. Git rules

### Branching and pull requests

1. **Never commit directly to `main`.** Every change reaches `main` through a pull request. The sole exception was the initial repository setup commit; there are no others, and none will be granted retroactively.
2. **Never push to `main`.** If you find yourself on `main` with uncommitted work, create a branch first — `git switch -c feat/...` carries the changes across.
3. Branch from an up-to-date `main`. Branch names are `type/short-kebab-description`, where `type` is one of `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, or `perf`. Examples: `feat/quick-lend-flow`, `fix/overdue-timezone`, `docs/deployment-guide`.
4. Keep branches short-lived. One Action plus its tests plus its screen is a good size for a pull request. A branch open longer than a few days is a merge conflict waiting to happen.
5. A pull request description states what changed, why, how it was verified, and **which invariants it touches**. Open it even when working solo — it is what makes CI run and what leaves a written rationale behind.
6. Never merge a pull request with failing CI. Never bypass a required check.
7. Never force-push to `main`. Force-pushing your own feature branch to tidy history before review is fine.
8. `main` is always deployable. If a merge breaks it, fixing or reverting takes priority over new work.

### Commit messages

9. **Conventional Commits, always**, with the domain area as the scope:
   ```
   feat(circulation): block renewal when the request queue is non-empty
   fix(catalog): normalise diacritics on book title update
   test(identity): cover the membership suspension invariant
   docs(architecture): correct the authentication sequence diagram
   ```
10. Valid types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `build`, `ci`. Valid scopes match the domain contexts — `catalog`, `circulation`, `identity`, `community`, `audit` — or the area touched, such as `deploy`, `ui`, or `architecture`.
11. The subject is imperative, lower-case, and under about seventy characters, with no trailing full stop. Explain *why* in the body when it is not obvious from the diff.
12. A commit that changes behaviour the spec describes updates the spec in the same commit. Design and documentation never drift apart across commits.

### Worktrees

13. **Worktrees live inside the project, never beside it.** Create them under `.worktrees/`, which is gitignored:
    ```
    git worktree add .worktrees/feat-quick-lend -b feat/quick-lend
    ```
    A worktree created outside the repository scatters the project across the filesystem, escapes the editor's workspace, and is easy to abandon and forget. Keeping it under `.worktrees/` means the whole project — including work in progress — is one directory that can be moved, archived, or deleted as a unit.
14. Never nest a worktree anywhere else inside the repository. Only `.worktrees/` is ignored, so a worktree elsewhere would appear as thousands of untracked files.
15. Remove a worktree when its branch merges: `git worktree remove .worktrees/<name>`. Run `git worktree prune` if a directory was deleted by hand.
16. `.artifacts/` is per-worktree and never shared between them. Do not symlink it across worktrees.
