# Phase 4 — Cutover: implementation plan

**Status:** In progress.
**Spec:** [`2026-09-01-laravel-phase-4-cutover-design.md`](../specs/2026-09-01-laravel-phase-4-cutover-design.md)
**Branch:** `feat/phase-4-cutover`, cut from `main` at `5b9e7e6`.

---

## What a task-taker needs to know before starting

You are working in a repository that currently holds **two applications**: the
Laravel app that ships (`app/`, `resources/js/`, `routes/`, `database/`) and the
Next.js original at `old_next/`, which has been a read-only behavioural
reference and is being retired. Git tracks **521** of its files (5.4 MB); the
231 MB you see on disk is untracked build output. Phase 4 changes **no application behaviour**.
The suite is 1966 tests before this phase and must be 1966 after it; a different
number means a task did something it was not asked to.

**The gates.** Before you call any task done, run all six, from the repository
root:

```bash
docker exec laravel-app-1 vendor/bin/pint --test
docker exec laravel-app-1 vendor/bin/phpstan analyse --memory-limit=1G
npm run laravel:lint
npm run laravel:typecheck
npm run laravel:build
docker exec laravel-app-1 php artisan test
```

**Never run `php` or `vendor/bin/pint` on the host** — the host's PHP is broken.
Everything PHP goes through `docker exec laravel-app-1`.

**"Pre-existing" means pre-existing on `main`**, not on your branch. If you find
a failure and want to call it someone else's, check it out on `main` first.

---

## Task 1 — Retire the reference

**Files:** `old_next/` (deleted), `AGENTS.md`, `.gitignore` (verify only).

1. Confirm `.artifacts/` is ignored: `git check-ignore -v .artifacts` must
   print a rule. It does today (`.gitignore:2`).
2. `git rm -r --cached old_next` then remove the working copy, so the tree
   leaves git in one commit.
3. Add to `AGENTS.md`, in its own short section: the reference was deleted in
   this commit, the commit **before** it is tagged **`v0.1.0-next-reference`**
   (tagging the deletion commit itself resolves to nothing), and any
   `old_next/…` citation in this repository resolves with
   `git show v0.1.0-next-reference:<path>`. State that the existing `v0.1.0`
   tag does **not** serve, because it holds the same files under `src/`.

**Falsification.** Not a test — a check, and it must be run and its output
pasted into the commit message:

```bash
git ls-files | grep -c '^old_next/'          # must be 0
git grep -c 'old_next/' -- app resources tests | wc -l   # must still be non-zero:
                                             # the citations survive, by design
```

**Do not** rewrite the citations. That is spec D1's explicit "not done".

**Gates:** all six. The suite must still be 1966 — nothing in `tests/` imports
from `old_next/`, and if the count moves, something did.

---

## Task 2 — `package.json` stops being a two-application menu

**Files:** `package.json`, `next-env.d.ts` (deleted), possibly `.prettierignore`.

1. Repoint the five scripts that `cd old_next` — `dev`, `build`, `test`,
   `typecheck`, `lint` — per spec D2's table. `test` is **removed**, not
   repointed: the suite is `php artisan test` and a `npm test` that runs
   nothing is worse than none.
2. **Keep every `laravel:*` script exactly as it is.** The two workflows and
   `AGENTS.md` invoke them by those names. This task adds the unprefixed names;
   it does not rename anything.
3. Remove the `db:*` and `check:links` scripts, which run files under
   `old_next/` that no longer exist. `check:diagrams` runs
   `scripts/check-mermaid.mjs`, which does exist — keep it.
4. Remove dependencies **only after proving nothing reads them**. For each
   candidate, run and record:

   ```bash
   git grep -n "<pkg>" -- resources scripts vite.config.ts tsconfig*.json \
       .github package.json biome.json
   ```

   A hit anywhere but `package.json` means it stays. Known candidates:
   `next`, `eslint`, `eslint-config-next`, `postgres`, `vitest`, `@node-rs/argon2`,
   `dotenv`, `sharp`, `zxing-wasm`, `pdf-lib`, `@pdf-lib/fontkit`, `qrcode`,
   `jsqr`, `pngjs`. **Several of these are almost certainly still used** —
   QR labels and PDF generation shipped in Phase 2c. Prove each one.
5. Delete `next-env.d.ts`.

**Falsification.** `rm -rf node_modules && npm install` then all six gates. A
dependency removed in error shows up as a build or typecheck failure, and this
is the only way to see it. Record in the commit message which candidates were
**kept** and the grep hit that kept them — the kept list is the evidence this
task did not guess.

---

## Task 3 — Rewrite `docs/SDD.md`

**Files:** `docs/SDD.md`.

Read the spec's D3 before writing a line. Then read, in this order:
`routes/web.php` (the route map is the system's shape), `app/Actions/` and
`app/Queries/` (a sample, not all 123), `app/Models/Concerns/` and
`app/Support/`, and every file in `tests/Feature/Architecture/`.

The rewritten document must:

- **Drop `Status: Proposed`.** It ships. Date it, and say what it describes.
- **Delete §2 "What is already decided" and §3.4's A/B/C comparison.** Those are
  a decision record for a decision that was reversed. One sentence replaces
  them: the backend was going to live inside Next.js, the application was
  ported to Laravel in 2026-08/09, and the migration spec is where that
  reasoning lives.
- **Explain the 14 architecture pins one paragraph each**, and for each, state
  **what it is blind to**. This is the section a newcomer most needs and the one
  this project has most often got wrong. Concretely: `AuditActionCensusTest`
  strips comments but `RuleViolatedCodesHaveSentencesTest` and
  `TenancyArchitectureTest` read RAW source, so an example written inside a
  comment mints a code or an offender. That is not a defect to fix in this
  task — it is a fact to write down.

  **A correction to this plan, found during Task 3:**
  `RuleViolatedCodesHaveSentencesTest` is NOT a file in
  `tests/Feature/Architecture/`, as the sentence above implies. It lives at
  `tests/Unit/Catalogue/RuleViolatedCodesHaveSentencesTest.php` and covers the
  catalogue slice; the members-slice code census is an `it()` block inside
  `MembersArchitectureTest.php`. The underlying point — raw-source guards mint
  offenders from examples written in comments — is correct.
- **Carry across** §5 (where the invariants live), §6.3 (time), §6.6
  (internationalisation) where they are still true, editing only the parts that
  name a TypeScript file.
- **Correct §6.7's search paragraph**, which says there are two implementations
  of the fold, one in `src/lib/search.ts`. Check what is true now before
  writing what replaces it.

**Falsification.** A document has no test, so the check is adversarial reading:
after writing, grep your own output for every filename and line number you cited
and confirm each resolves — `git grep -n` for the symbol, not a memory of it.
Any claim of a count (of Actions, Queries, tests, pins) must be produced by a
command you ran, and the command goes in the commit message.

---

## Task 4 — Rewrite `docs/DATABASE.md`

**Files:** `docs/DATABASE.md`.

The authority is `database/migrations/` (30 files), not this plan and not the
old document. Read them all before writing.

- **Header:** replace the PostgreSQL 16 engine paragraph per spec D4's worked
  example. Add the sentence that the migration wins over this document.
- **The generated columns.** The live schema has **18**, of which **11** back a
  unique index. Verify both numbers yourself against a running database rather
  than trusting this plan:

  ```bash
  docker exec laravel-mariadb-1 mysql -uroot -psecret olibra -N -e \
    "SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA='olibra' AND EXTRA LIKE '%GENERATED%';"
  ```

  Explain the technique once — MariaDB has no partial index, so a
  `GENERATED ALWAYS AS (IF(deleted_at IS NULL, slug, NULL))` column plus an
  ordinary unique index is how a Postgres partial unique was ported — and then
  name the eleven and say what each one forbids.
- **The fifteen composite tenant FKs** from
  `2026_08_26_000019_add_composite_tenant_fks.php`. Say what the shape buys:
  a child row cannot point at a parent belonging to a different shelf, which is
  the guarantee `BookshelfScope` alone cannot make.
- **Collation.** `ascii_bin` appears 93 times in the migrations. Explain what it
  is on, why, and the `COLLATE` guards in the audit joins.
- **The nullable tenant columns — and this plan got the count wrong.** It said
  `feedback.bookshelf_id` was "the schema's one nullable tenant column". There
  are **two**: `feedback` and `audit_log`, which is exactly what
  `TenancyArchitectureTest::tenancyExemptModels()` returns. Say what each null
  means, not how many there are.
- **Preserve** the per-table reasoning that is about the business rather than
  the engine.

**Falsification.** Same as Task 3, plus: every column, index or constraint name
you write must be one the live schema actually has. Check with
`SHOW CREATE TABLE`, and say in the commit message that you did.

---

## Task 5 — `DEPLOYMENT.md`, `known-gaps.md`, `README.md`, `DESIGN.md`

**Files:** `docs/DEPLOYMENT.md`, `docs/known-gaps.md`, `README.md`,
`docs/DESIGN.md`.

1. **`DEPLOYMENT.md`:** replace the `Status:` line only, with spec D5's text.
   Do **not** rewrite the body — the product owner deferred it deliberately,
   and a body rewritten from YAML would read as tested.
2. **`known-gaps.md`:** one entry recording the deferral, its reason, and the
   two things only a real deploy can check. **The first draft of this line was
   wrong and is corrected here:** it said the check was "that the shim docroot
   serves `public/storage`", but `docs/HOSTING.md` row 6 and
   `deploy/post-deploy.sh` already answer that the other way — under the shim it
   does not, and the fallback is `AVATAR_DISK_ROOT`/`AVATAR_DISK_URL` pointed
   inside the served docroot. The real check is which of the three docroot
   wirings the host permits, and whether an uploaded avatar comes back over
   HTTP. The second is that `imagick` being absent while `gd` is present matches
   what the avatar pipeline calls — verify against the code before writing it.
3. **`README.md`:** it currently describes both stacks. Make it describe the one
   that ships, including how to run the app and the six gates.
4. **`DESIGN.md`:** it points at `src/app/globals.css` in 6 places. The tokens
   now live in `resources/css/app.css`. Repoint, and change nothing else — the
   design system shipped and was verified in PR #68.

**Gates:** all six.

---

## Definition of done

- `git ls-files | grep -c '^old_next/'` → 0.
- `git show v0.1.0-next-reference:old_next/src/app/lien-he/page.tsx` prints.
- `npm run build` builds the Laravel app; `npm run dev` starts Vite.
- `grep -rn 'PostgreSQL\|Next.js' docs/*.md` returns only hits that are
  explicitly labelled as history.
- Six gates green; **1966 tests**, unchanged.
- Tag `v0.2.0` after merge.
