# Phase 4 — Cutover

**Status:** Draft, 2026-09-01.
**Supersedes for this phase:** §11 of
[`2026-08-26-laravel-mariadb-inertia-migration-design.md`](2026-08-26-laravel-mariadb-inertia-migration-design.md),
which defined Phase 4 in one sentence.

---

## 1. Context — what this repository currently is

OLibra is a lending-library system for a Vietnamese parish bookshelf. It was
first built as a Next.js application; over Phases 0–3 it has been ported to
**Laravel 13 + Inertia v3 + React + MariaDB 10.11**, targeting shared cPanel
hosting.

Today the repository holds **both applications at once**:

- The shipped Laravel app — `app/` (75 Actions, 48 Queries, 19 Models),
  `resources/js/`, `routes/web.php`, 30 migrations, 1966 tests.
- The Next.js original at **`old_next/`** — 2620 files, 231 MB — which has been
  the *read-only behavioural reference* for every phase. When a port had to
  decide what a screen does, the answer came from reading that tree.

Phase 3c-ii merged on 2026-09-01 and closed the last placeholder route. Every
screen the reference has, this application now has. **The reference has no
remaining job.**

## 2. The problem

Three things are wrong with the repository as it stands, and none of them is a
missing feature.

**The repository ships two applications.** `package.json`'s `dev`, `build`,
`test`, `lint` and `typecheck` scripts all `cd old_next`. A contributor who runs
`npm run build` builds the *reference*, not the app — a trap that has already
produced one red CI run during Phase 3b. The Laravel scripts are all prefixed
`laravel:` as though they were the guest in their own repository.

**The three architecture documents describe a system that was never built.**
Measured on `main` at `5b9e7e6`:

| Document | Lines | Mentions of Next/Drizzle/Postgres | Mentions of Laravel/Eloquent/MariaDB |
|---|---:|---:|---:|
| `docs/SDD.md` | 319 | 10 | **0** |
| `docs/DATABASE.md` | 1580 | 24 | **0** |
| `docs/DEPLOYMENT.md` | 279 | 7 | **0** |

`SDD.md` still carries `**Status:** Proposed` and a section called *"What is
already decided"* whose table says *"Backend inside Next.js — **Settled**"*.
`DATABASE.md`'s header reads *"**Engine:** PostgreSQL 16 or later"*. These are
not stale in the way a document drifts; they describe a different program.

**The reference is cited 360 times from code that will outlive it.** 130 of
those citations are comments inside shipped `app/`, `resources/` and `tests/`
files — for example `app/Http/Controllers/ContactController.php` explaining a
copy decision by pointing at `old_next/src/app/lien-he/page.tsx:83`. Deleting
the tree without an answer makes every one of them point at nothing.

---

## 3. Decisions

### D1 — The reference leaves git and stays on the product owner's disk

**Decided by the product owner, 2026-09-01: delete it from git, and move the
tree to `.artifacts/`.**

`.artifacts/` is gitignored (`.gitignore:2`, `/.artifacts/*` with a single
exception for its README), so the tree survives locally as a working reference
without being a thing the repository carries, ships, or asks CI to ignore.

Concretely, in the product owner's own checkout at
`/Users/kiendinh/Documents/Hilibra`:

```
before:  Hilibra/old_next/src/app/lien-he/page.tsx     tracked, 231 MB in git
after:   Hilibra/.artifacts/old_next/src/app/lien-he/page.tsx   on disk, untracked
```

**A decision taken on the product owner's behalf, and cheap to reverse:** the
deletion commit is also **tagged `v0.1.0-next-reference`**, and `AGENTS.md`
gains one line saying so. Without the tag, a citation like
`old_next/src/app/lien-he/page.tsx:83` is resolvable only by someone who first
finds the deletion commit; with it, the recipe is one command:

```bash
git show v0.1.0-next-reference:old_next/src/app/lien-he/page.tsx | sed -n '83p'
```

This costs one tag. It is what makes the 360 citations survive for anyone who is
not working from the product owner's laptop — a fresh clone, a CI job, a future
contributor. The existing `v0.1.0` tag does **not** serve: it predates the move
into `old_next/` and holds the same files under `src/`, so the cited paths do
not exist there.

**Not done:** the 360 citations are **not** rewritten. Rewriting a citation
means restating what it said, and restating what a reference said — from memory,
in bulk — is precisely the failure this project has hit in every phase. They
stay verbatim and stay verifiable through the tag.

### D2 — `package.json` becomes the Laravel app's, with no `laravel:` prefix

The scripts stop being a two-application menu. Worked example:

| before | after |
|---|---|
| `"dev": "cd old_next && next dev"` | `"dev": "vite"` |
| `"build": "cd old_next && next build"` | `"build": "vite build"` |
| `"test": "cd old_next && vitest run"` | *(removed — the suite is `php artisan test`)* |
| `"lint": "cd old_next && eslint ."` | `"lint": "biome check resources"` |
| `"typecheck": "cd old_next && tsc --noEmit"` | `"typecheck": "tsc -p tsconfig.laravel.json --noEmit"` |
| `"laravel:build": "vite build"` | *(removed — it is now `build`)* |

The `laravel:*` names are **kept as aliases** for exactly one reason: they are
what `.github/workflows/laravel.yml` and `deploy-laravel.yml` invoke, and what
`AGENTS.md`'s six-gates rule names. Renaming the scripts and the two workflows
and the rule in one commit is three chances to typo a gate into a no-op. The
aliases go in a follow-up once the primary names have run green.

Dependencies that exist only for the reference — `next`, `eslint-config-next`,
`eslint`, `postgres`, `vitest`, `@node-rs/argon2`, `dotenv` and the rest — are
removed only where **nothing in `resources/`, `scripts/`, `vite.config.ts` or a
workflow imports them.** Each removal is checked by grep, not by reading the
name and deciding it sounds Next-ish. `next-env.d.ts` at the repository root
goes with them.

### D3 — `SDD.md` is rewritten, not edited

The current document is a **pre-decision** document: it weighs options
(§3.4 compares "A. Inside Next.js / B. Separate service / C. Next plus a thin
API"), records a status of `Proposed`, and ends in `## 11. Open questions`. The
questions are answered; the options were not taken.

The rewrite describes the architecture that shipped. Its spine:

- The **Actions / Queries split** — 75 write commands under `app/Actions/`,
  48 reads under `app/Queries/`, and the rule that a controller calls one of
  each and neither calls the other.
- **Tenancy** — `BookshelfScope` fails *closed*: an unbound tenant throws rather
  than returning every shelf's rows. `/admin` binds no tenant, which is why
  admin Actions reach scoped rows through relations from the `Bookshelf`.
- **The audit log** — one `AuditRecorder`, a sentence census that fails if an
  action can be written but not read, and the fluent `global()` / `forShelf()`
  configurators.
- **The architecture pins** — 14 tests under `tests/Feature/Architecture/` that
  fail when a *rule* is broken rather than when a behaviour is. They are the
  part of this codebase a newcomer will not guess exists, and the SDD is where
  they get explained: what each one holds, and — stated, not implied — what it
  is blind to.
- **The six gates** — `pint`, `phpstan`, Biome, `tsc`, `vite build`,
  `php artisan test`.

Sections that are engine-neutral and still true (§5 where the invariants live,
§6.3 time, §6.6 internationalisation) are carried across rather than rewritten
for the sake of it.

### D4 — `DATABASE.md` is rewritten against the migrations

**Decided by the product owner: rewrite against the migrations**, treating the
30 files in `database/migrations/` as the authority.

The engine-shaped arguments go. Worked example, the document's own header:

```
before:  **Engine:** PostgreSQL 16 or later. The engine is the likely choice
         but not yet formally settled; the *hosting* and the *application
         stack* are both open. Deployment is expected to be Docker.

after:   **Engine:** MariaDB 10.11, shipped. The schema below is what
         `database/migrations/` creates; where this document and a migration
         disagree, the migration wins.
```

What the rewrite must carry, because it is where this schema is unusual and a
reader will otherwise get it wrong:

- the **18 generated columns**, **11 of which back a unique index**, and why a
  generated column rather than a partial index — MariaDB has no partial index,
  so Postgres's `WHERE` clause on a unique index is the thing that had to be
  replaced. Measured from the live schema, not from the plan: the migration
  spec's §11 said "ten", which was a plan-time figure and is now one short.
  The eleven are `users_username_key`, `bookshelves_slug_unique`,
  `parish_units_name_unique_in_scope`, `memberships_one_per_shelf`,
  `books_bookshelf_id_slug_key`, `book_copies_code_unique`,
  `loans_one_active_per_copy`,
  `borrow_requests_one_live_per_title_member`,
  `announcements_bookshelf_id_slug_key`, `bookshelf_contacts_position` and
  `profile_change_requests_one_pending`;
- the **fifteen composite foreign keys** and what each one prevents — counted in
  `2026_08_26_000019_add_composite_tenant_fks.php`, whose own comment says
  fifteen and whose array holds fifteen;
- **collation** — `ascii_bin` on the columns that hold identifiers, and the
  `COLLATE` guards in the audit joins that exist because a `?`-mangled non-ASCII
  byte matches nothing;
- **`feedback.bookshelf_id` is the schema's one nullable tenant column**, and
  what that nullability means.

Engine-neutral reasoning already in the document — why a table exists, what a
column means to the business — is preserved.

### D5 — `DEPLOYMENT.md` is deferred, and says so in its own header

**Decided by the product owner: defer it.**

The reasoning is sound and worth recording rather than leaving as a gap: the
document would be a runbook for a host **nobody has deployed to**.
`.github/workflows/deploy-laravel.yml` says so itself — *"Nothing in this file
has ever run against the real host"*. A runbook written from the shape of a
YAML file is a document that reads as tested and is not.

What Phase 4 does instead: **one honest header**, replacing the current
`**Status:** Current as of 2026-08-14`.

```
**Status:** STALE — describes the Next.js deployment (VPS, Docker, Caddy),
which is not what ships. The Laravel app targets shared cPanel hosting; its
pipeline exists (`.github/workflows/deploy-laravel.yml`, `.cpanel.yml`,
`deploy/post-deploy.sh`) and has never been run against the real host. This
document will be rewritten from the first real deploy, not before it.
```

**The cost, stated:** Phase 4 closes without its deployment half, and the one
document an operator would reach for on the day of the cutover is the one that
is knowingly wrong. The mitigation is that it now *says* it is wrong in its
first line, which the current version does not.

`docs/known-gaps.md` gets the matching entry, including the two things the first
deploy must check that no test can: that the shim docroot serves
`public/storage` (the product owner's host probe found `symlink()` allowed and
not in `disable_functions`, so the symlink path is available), and that
`imagick` being **absent** while `gd` is present matches what the avatar
pipeline actually calls.

---

## 4. Scope

**In:**

1. Delete `old_next/` from git; move it to `.artifacts/` in the product owner's
   checkout; tag `v0.1.0-next-reference`; one line in `AGENTS.md`.
2. `package.json`, `next-env.d.ts`, and any root config the reference owned.
3. Rewrite `docs/SDD.md`.
4. Rewrite `docs/DATABASE.md`.
5. Re-header `docs/DEPLOYMENT.md` + a `known-gaps.md` entry.
6. `README.md` — it is 9-vs-12 split between the two stacks and is the first
   thing anyone reads.
7. Tag `v0.2.0` once merged.

**Out:**

- Rewriting the 360 `old_next/…` citations (D1).
- `DESIGN.md`, beyond correcting its `src/app/globals.css` pointer to
  `resources/css/app.css` — the design system itself shipped and was verified in
  PR #68.
- `BUSINESS-REQUIREMENTS.md` and `OPERATIONS.md`. They are transport-neutral by
  construction and describe *what*, not *how*.
- Any deployment work (D5).

## 5. Definition of done

- `git ls-files | grep -c '^old_next/'` returns **0**; the tree exists at
  `~/Documents/Hilibra/.artifacts/old_next/`; `git show
  v0.1.0-next-reference:old_next/src/app/lien-he/page.tsx` prints a file.
- `npm run build` builds **the Laravel app**. `npm run dev` starts Vite.
- No document in `docs/` claims the backend is Next.js or the engine is
  PostgreSQL, except where it is explicitly labelled as history.
- The six gates are green, and the suite is still 1966 tests — this phase
  changes no behaviour, and a changed test count means it did.
