# QA Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a freshly installed OLibra usable end-to-end by one administrator, and fix every defect found in the 10/08/2026 QA sweep (`.artifacts/reports/2026-08-10-qa-fresh-install.md`).

**Architecture:** Four waves, each a separate PR. Wave 1 removes the five blockers that make a fresh install unusable — it changes how the domain receives its password hasher, and it adds the three missing management surfaces (categories, parish taxonomy, reader credentials/manager assignment). Wave 2 renames the reader area from `toi` to `ho-so` and makes every navigation component derive its active state from the current path instead of a hand-passed prop. Wave 3 fixes visible defects on existing screens. Wave 4 fixes data-integrity, operations and polish.

**Tech Stack:** Next.js 16 (App Router, Turbopack, server actions), TypeScript 5.9, PostgreSQL 17 with RLS, Tailwind v4, Vitest, Bun.

## Global Constraints

- **Bun only.** `bun install`, `bun add`, `bun run <script>`. Never npm/pnpm/yarn.
- **Version pins are deliberate.** `typescript@^5.9` (not 7), `eslint@^9` (not 10). Do not upgrade.
- **The domain layer stays framework-free.** Nothing under `src/domain/` may import from `src/storage/`, `src/auth/password`, `next/*`, or `src/lib/fixtures`. Enforced by `tests/architecture/boundaries.test.ts`.
- **No Bun-specific APIs anywhere in the app** (`Bun.file`, `bun:sqlite`). The build runs under Node.
- **Every user-visible string is Vietnamese**, in the register the existing copy uses (a volunteer or a child reads it). New error codes get a sentence in `src/domain/kernel/errors.ts`.
- **Design tokens live in `src/app/globals.css` under `@theme`.** No `tailwind.config.js`. Colours by token name (`terracotta`, `sage`, `brick`, `hairline`, `surface`, `paper`, `ink`, `meta`), never raw hex.
- **Icons:** `lucide-react`, outline, `strokeWidth={1.75}`.
- **One terracotta primary per screen** (`src/components/ui/button.tsx`: "if two things on a screen are terracotta, one of them is wrong").
- **Every write goes through a domain command** invoked by `submitCommand` / `submitAdminCommand` (`src/lib/page-data.ts`), never raw SQL in a page or action.
- **Every command writes an audit entry** with an action registered in `src/domain/kernel/audit-actions.ts`.
- **Test database required:** `docker compose --profile test up -d db-test` before `bun run test`.
- **Definition of done for every task:** `bun run check` passes (typecheck + lint + format:check + test).

---

## File Structure

**Wave 1 — new files**

| File | Responsibility |
|---|---|
| `src/domain/kernel/crypto.ts` | The `PasswordHasher`/`PasswordVerifier` port, and the *only* module-level state holding them. Imported directly by every caller, so there is one instance per bundler layer and each layer wires itself. |
| `src/domain/catalogue/commands/create-category.ts` | `CreateCategory` — name → slug, global scope, audited. |
| `src/domain/catalogue/commands/rename-category.ts` | `RenameCategory` — name only; slug is immutable. |
| `src/domain/catalogue/commands/archive-category.ts` | `ArchiveCategory` — soft delete, refused while books reference it. |
| `src/domain/catalogue/queries/get-categories-admin.ts` | Category list with per-category book counts. |
| `src/app/quan-tri/the-loai/page.tsx` | Admin screen: list + create + rename + archive. |
| `src/app/tu-sach/[shelf]/quan-ly/co-cau/page.tsx` | Manager screen: taxonomy levels + labels, and the unit tree. |
| `src/db/migrations/20260810_02_seed_default_categories.sql` | Six starter categories so a fresh install is never empty. |

**Wave 1 — modified files**

| File | Change |
|---|---|
| `src/domain/members/registration.ts` | Delete `hasher`/`verifier` locals and their setters; re-export from `crypto.ts`. |
| `src/instrumentation.ts` | Keep as a defence-in-depth wiring call; no longer the only one. |
| `src/lib/page-data.ts` | Wire crypto at the top of `submitCommand`/`submitAdminCommand`/`loadPage`. |
| `src/app/tu-sach/[shelf]/quan-ly/nguoi-doc/[id]/page.tsx` | Add the five reader actions. |
| `src/app/tu-sach/[shelf]/quan-ly/actions.ts` | Add reader admin actions. |
| `src/app/quan-tri/quan-ly-vien/page.tsx` | Render `assignManagerAction`. |
| `src/components/shell/public-header.tsx` | Signed-in state on `FrontDoorHeader`. |
| `tests/architecture/the-password-hasher-is-wired.test.ts` | Replace source-grepping with a real request-path assertion. |

**Wave 2 — moved files** (`git mv`, so history follows)

| From | To |
|---|---|
| `src/app/tu-sach/[shelf]/toi/ho-so/page.tsx` | `src/app/tu-sach/[shelf]/ho-so/page.tsx` |
| `src/app/tu-sach/[shelf]/toi/ho-so/actions.ts` | `src/app/tu-sach/[shelf]/ho-so/profile-actions.ts` |
| `src/app/tu-sach/[shelf]/toi/actions.ts` | `src/app/tu-sach/[shelf]/ho-so/reader-actions.ts` |
| `src/app/tu-sach/[shelf]/toi/page.tsx` | `src/app/tu-sach/[shelf]/ho-so/tong-quan/page.tsx` |
| `src/app/tu-sach/[shelf]/toi/lich-su/page.tsx` | `src/app/tu-sach/[shelf]/ho-so/lich-su/page.tsx` |
| `src/app/tu-sach/[shelf]/toi/tang-sach/page.tsx` | `src/app/tu-sach/[shelf]/ho-so/tang-sach/page.tsx` |
| `src/app/tu-sach/[shelf]/toi/thong-bao/page.tsx` | `src/app/tu-sach/[shelf]/ho-so/thong-bao/page.tsx` |

Two action files rather than one `actions.ts` in `ho-so/`: after the move, `ho-so/thong-bao/page.tsx` would import `../actions`, which used to mean the loan/notification actions and would now mean the profile actions. Naming them by content makes that collision impossible.

---

# WAVE 1 — unblock a fresh install

### Task 1: The password hasher reaches the request path

**Why:** Confirmed live. `src/instrumentation.ts` runs (`NEXT_RUNTIME=nodejs`) and, inside its own module graph, `hashFor("probe")` resolves. The same call from `registerMembershipAction` throws `NotWired`. Two instances of `src/domain/members/registration.ts` exist — one in the instrumentation bundle, one in the server-action bundle — so a module-level `let` set in the first is invisible to the second. `POST /dang-ky` returns 500 for every reader who chooses a username and password. `SetReaderCredentials` and `ChangeOwnPassword` fail identically.

**Files:**
- Create: `src/domain/kernel/crypto.ts`
- Modify: `src/domain/members/registration.ts:78-160` (remove the two locals and their setters)
- Modify: `src/lib/page-data.ts` (wire at every entry point)
- Modify: `src/instrumentation.ts`
- Test: `tests/architecture/the-password-hasher-is-wired.test.ts` (rewrite)
- Test: `tests/lib/registration-over-http.test.ts` (create)

**Interfaces:**
- Produces: `ensureCryptoWired(): void`, `hashFor(plain: string): Promise<string>`, `verifyFor(plain: string, hash: string): Promise<boolean>`, `setPasswordHasher(fn)`, `setPasswordVerifier(fn)` — all from `@/domain/kernel/crypto`.
- Consumes: `hashPassword`, `verifyPassword` from `src/auth/password`.

- [ ] **Step 1: Write the failing test — the request path, not the source text**

Create `tests/lib/registration-over-http.test.ts`. This goes through Next's own handler, the way `tests/lib/avatar-over-http.test.ts` already does — that is the only shape that would have caught this.

```ts
import { afterAll, beforeAll, expect, test } from "vitest";
import { startTestServer, type TestServer } from "../support/http";

/**
 * The defect this file exists for: `setPasswordHasher` was called by
 * `src/instrumentation.ts` and the value never reached the server action,
 * because Turbopack bundles `registration.ts` once per layer and a
 * module-level `let` is per-instance. Every unit test was green — the suite
 * wires the setters in its own setup, so no test could observe the unwired
 * state. Only a request can.
 */
let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
}, 120_000);

afterAll(async () => {
  await server?.close();
});

test("registering with a username and password does not 500", async () => {
  const res = await server.postRegistration({
    shelf: "dong-thap",
    username: "qa.http.probe",
    password: "matkhau123",
    fullName: "QA Probe",
    dateOfBirth: "2014-01-01",
    fatherName: "QA Cha",
    motherName: "QA Me",
    phone: "0900000000",
  });

  expect(res.status, await res.text()).not.toBe(500);
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
docker compose --profile test up -d db-test
bun run test tests/lib/registration-over-http.test.ts
```

Expected: FAIL. Either `startTestServer` is not defined yet (write it next, modelled on `tests/lib/avatar-over-http.test.ts`'s existing harness) or, once it is, a 500 whose log line reads `NotWired: … at hasher (src/domain/members/registration.ts:94:9)`.

- [ ] **Step 3: Create the crypto port**

`src/domain/kernel/crypto.ts`:

```ts
import { NotWired } from "./errors";

export type PasswordHasher = (plain: string) => Promise<string>;
export type PasswordVerifier = (plain: string, hash: string) => Promise<boolean>;

/**
 * The domain's crypto port, and the one module allowed to hold it.
 *
 * **Why this module exists rather than a `let` in `registration.ts`.** Next
 * builds the server twice — once for `instrumentation.ts` (the `node` layer)
 * and once for React Server Components and server actions (the `react-server`
 * layer) — and a module imported by both is bundled into both, as two
 * instances with two copies of every module-level binding. Wiring performed in
 * one is invisible to the other. Measured on 10/08/2026: instrumentation
 * reported `hashFor` wired while `registerMembershipAction` threw `NotWired` in
 * the same process.
 *
 * The fix is not a different place to put the `let` — it is that **every
 * request path wires itself** before it needs the port, via
 * `ensureCryptoWired()` called from `src/lib/page-data.ts`. That call is
 * idempotent and costs one boolean check after the first request in each layer.
 */
let hasher: PasswordHasher = () => {
  throw new NotWired("password_hasher_not_wired");
};

let verifier: PasswordVerifier = async () => {
  throw new NotWired("password_verifier_not_wired");
};

let wired = false;

export function setPasswordHasher(next: PasswordHasher): void {
  hasher = next;
}

export function setPasswordVerifier(next: PasswordVerifier): void {
  verifier = next;
}

/** Read at call time, so a later wiring call sticks. */
export function hashFor(plain: string): Promise<string> {
  return hasher(plain);
}

export function verifyFor(plain: string, hash: string): Promise<boolean> {
  return verifier(plain, hash);
}

/** Test-only: lets a suite assert the unwired default still throws. */
export function resetCryptoForTests(): void {
  wired = false;
  hasher = () => {
    throw new NotWired("password_hasher_not_wired");
  };
  verifier = async () => {
    throw new NotWired("password_verifier_not_wired");
  };
}

/**
 * Wires this layer's instance from `src/auth/password`, once.
 *
 * `import()` rather than a static import because `boundaries.test.ts` forbids
 * `src/domain/` importing `src/auth/password` statically — Argon2id is a native
 * addon and the domain must stay runnable under a plain test runner. A dynamic
 * import inside a function the domain never calls on its own keeps that true:
 * the caller is `src/lib/page-data.ts`, which is application code.
 */
export async function ensureCryptoWired(): Promise<void> {
  if (wired) return;
  const { hashPassword, verifyPassword } = await import("../../auth/password");
  setPasswordHasher(hashPassword);
  setPasswordVerifier(verifyPassword);
  wired = true;
}
```

- [ ] **Step 4: Check the boundary test still allows this**

Read `tests/architecture/boundaries.test.ts`. If it forbids the string `auth/password` anywhere under `src/domain/`, add `src/domain/kernel/crypto.ts` to its allow-list with a comment naming this task, or move `ensureCryptoWired` to `src/lib/crypto-wiring.ts` and have it call the setters. Prefer the second if the boundary test greps rather than parses — it keeps the rule absolute.

```bash
bun run test tests/architecture/boundaries.test.ts
```

- [ ] **Step 5: Point `registration.ts` at the port**

In `src/domain/members/registration.ts`, delete the `hasher` local, `setPasswordHasher`, `hashFor`, the `verifier` local, `setPasswordVerifier` and `verifyFor` (roughly lines 78-160 — keep every surrounding docstring that still applies and move the "why it throws" paragraphs into `crypto.ts`). Replace with:

```ts
import { hashFor, verifyFor } from "../kernel/crypto";
export { hashFor, verifyFor } from "../kernel/crypto";
```

`credentialsFrom` changes `await hasher(password)` to `await hashFor(password)`.

- [ ] **Step 6: Wire at every application entry point**

In `src/lib/page-data.ts`, `await ensureCryptoWired();` as the first statement of `loadPage`, `loadPublicPage`, `submitCommand` and `submitAdminCommand`. Import it from `@/domain/kernel/crypto`.

- [ ] **Step 7: Keep instrumentation as belt-and-braces**

`src/instrumentation.ts` keeps `register()` but now calls the port:

```ts
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { ensureCryptoWired } = await import("./domain/kernel/crypto");
  await ensureCryptoWired();
}
```

Replace the docstring's claim that this is "the one place the domain's injected setters are actually set" — it is no longer true, and the paragraph explaining why the old wiring silently failed belongs in `crypto.ts`. Say instead that this warms the `node` layer and that `page-data.ts` is what guarantees the request path.

- [ ] **Step 8: Rewrite the architecture test**

`tests/architecture/the-password-hasher-is-wired.test.ts` currently reads `src/instrumentation.ts` as text and asserts it contains `setPasswordHasher(`. That assertion was true the whole time the product was broken; delete it. Replace with:

```ts
import { expect, test } from "vitest";
import { NotWired } from "../../src/domain/kernel/errors";
import {
  ensureCryptoWired,
  hashFor,
  resetCryptoForTests,
  verifyFor,
} from "../../src/domain/kernel/crypto";

test("the unwired default throws, so wiring is not decoration", async () => {
  resetCryptoForTests();
  await expect(hashFor("bất kỳ")).rejects.toBeInstanceOf(NotWired);
  await expect(verifyFor("a", "b")).rejects.toBeInstanceOf(NotWired);
});

test("ensureCryptoWired produces a hash the verifier accepts", async () => {
  resetCryptoForTests();
  await ensureCryptoWired();
  const hash = await hashFor("matkhau123");
  expect(hash).toMatch(/^\$argon2/);
  expect(await verifyFor("matkhau123", hash)).toBe(true);
  expect(await verifyFor("sai", hash)).toBe(false);
});

test("every application entry point wires before it can need the port", () => {
  const { execSync } =
    require("node:child_process") as typeof import("node:child_process");
  const src = execSync("cat src/lib/page-data.ts", { encoding: "utf8" });
  for (const fn of [
    "loadPage",
    "loadPublicPage",
    "submitCommand",
    "submitAdminCommand",
  ]) {
    expect(src, `${fn} calls ensureCryptoWired`).toMatch(
      new RegExp(`function ${fn}[\\s\\S]{0,600}?ensureCryptoWired\\(`),
    );
  }
});
```

- [ ] **Step 9: Run the HTTP test and the suite**

```bash
bun run test tests/lib/registration-over-http.test.ts tests/architecture/the-password-hasher-is-wired.test.ts
bun run check
```

Expected: PASS.

- [ ] **Step 10: Verify in the browser**

```bash
bun run dev
```

Register at `/dang-ky?tu-sach=dong-thap` with a username and an 8+ character password. Expected: no error page; the account appears in `/tu-sach/dong-thap/quan-ly/dang-ky-cho-duyet`. Then delete the probe row:

```bash
docker exec olibra-db-1 psql -U olibra -d olibra -c "delete from memberships where user_id in (select id from users where username like 'qa.%'); delete from users where username like 'qa.%';"
```

- [ ] **Step 11: Commit**

```bash
git add src/domain/kernel/crypto.ts src/domain/members/registration.ts src/lib/page-data.ts src/instrumentation.ts tests/
git commit -m "fix(auth): wire the password hasher on the request path, not only in instrumentation"
```

---

### Task 2: Categories can be created

**Why:** `categories` is written only by `src/db/seed.ts:103`. On a fresh install the "Thể loại" `<select>` at `/quan-ly/sach/moi` has one option — the empty placeholder — and the field is `required`, so no book can ever be added.

**Files:**
- Create: `src/domain/catalogue/commands/create-category.ts`, `rename-category.ts`, `archive-category.ts`
- Create: `src/domain/catalogue/queries/get-categories-admin.ts`
- Create: `src/app/quan-tri/the-loai/page.tsx`
- Create: `src/db/migrations/20260810_02_seed_default_categories.sql`
- Modify: `src/app/quan-tri/admin-actions.ts` (three actions)
- Modify: `src/components/shell/manager-shell.tsx` (admin nav entry)
- Modify: `src/domain/kernel/audit-actions.ts` (three action names)
- Test: `tests/domain/catalogue/categories.test.ts`

**Interfaces:**
- Produces: `createCategory(tx, ctx, { name }): Promise<{ id: string; slug: string }>`, `renameCategory(tx, ctx, { id, name })`, `archiveCategory(tx, ctx, { id })`, `getCategoriesAdmin(tx, ctx): Promise<{ id, name, slug, bookCount, archived }[]>`.
- Consumes: `submitAdminCommand` from `@/lib/page-data`; `fold` (the existing diacritic folder used for slugs — reuse whatever `createBookshelf` uses for its slug, do not write a second one).

- [ ] **Step 1: Write the failing tests**

`tests/domain/catalogue/categories.test.ts`:

```ts
test("creates a category with a folded slug", async () => {
  const { id, slug } = await runGlobalCommand(sql, admin, createCategory, {
    name: "Truyện thiếu nhi",
  });
  expect(slug).toBe("truyen-thieu-nhi");
  const [row] = await sql`select name, slug from categories where id = ${id}`;
  expect(row.name).toBe("Truyện thiếu nhi");
});

test("refuses a duplicate slug", async () => {
  await runGlobalCommand(sql, admin, createCategory, { name: "Giáo lý" });
  await expect(
    runGlobalCommand(sql, admin, createCategory, { name: "giao ly" }),
  ).rejects.toMatchObject({ code: "duplicate_category" });
});

test("refuses a blank name", async () => {
  await expect(
    runGlobalCommand(sql, admin, createCategory, { name: "   " }),
  ).rejects.toMatchObject({ code: "validation_failed" });
});

test("archiving is refused while a book still uses the category", async () => {
  // …create a category, create a book in it, then:
  await expect(
    runGlobalCommand(sql, admin, archiveCategory, { id }),
  ).rejects.toMatchObject({ code: "category_in_use" });
});

test("slug never changes on rename", async () => {
  const { id, slug } = await runGlobalCommand(sql, admin, createCategory, {
    name: "Kỹ năng",
  });
  await runGlobalCommand(sql, admin, renameCategory, { id, name: "Kỹ năng sống" });
  const [row] = await sql`select name, slug from categories where id = ${id}`;
  expect(row).toEqual({ name: "Kỹ năng sống", slug });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
bun run test tests/domain/catalogue/categories.test.ts
```

Expected: FAIL — `createCategory` is not exported.

- [ ] **Step 3: Add the three error sentences**

In `src/domain/kernel/errors.ts` add, in the register's existing style:

- `duplicate_category` → `"Thể loại này đã có rồi."`
- `category_in_use` → `"Còn sách thuộc thể loại này, không xoá được. Đổi thể loại cho những cuốn đó trước."`
- `category_not_found` → `"Không tìm thấy thể loại này."`

In `src/domain/kernel/audit-actions.ts` register `category.created`, `category.renamed`, `category.archived`, each with the Vietnamese sentence the log renders (follow the shape of the neighbouring `bookshelf.*` entries).

- [ ] **Step 4: Write the commands**

Each runs as `olibra_admin` (categories are global — no `bookshelf_id`), the same escalation `createBookshelf` uses. `createCategory` folds the name to a slug, checks `categories_slug_key` by select-then-insert **inside the transaction**, sets `sort_order` to `max + 1`, and audits. `archiveCategory` sets `deleted_at = ctx.clock.now()` after `select 1 from books where category_id = $1 and deleted_at is null limit 1` returns nothing.

- [ ] **Step 5: Write the query**

`getCategoriesAdmin` returns every non-archived category ordered by `sort_order, name`, left-joined to a `count(books.id) filter (where books.deleted_at is null)`.

- [ ] **Step 6: Run the domain tests**

```bash
bun run test tests/domain/catalogue/categories.test.ts
```

Expected: PASS.

- [ ] **Step 7: Add the migration for starter categories**

`src/db/migrations/20260810_02_seed_default_categories.sql`. `on conflict (slug) do nothing`, so it is a no-op on any database the seed already touched:

```sql
-- A fresh install had no categories and no way to make one, so the "Thể loại"
-- field on "Thêm sách mới" — which is `required` — could never be satisfied and
-- the catalogue could never be started. Task 2 adds the management screen; this
-- makes sure nobody has to use it before they can add their first book.
insert into categories (name, slug, sort_order) values
  ('Truyện thiếu nhi', 'truyen-thieu-nhi', 1),
  ('Giáo lý',          'giao-ly',          2),
  ('Kỹ năng sống',     'ky-nang-song',     3),
  ('Sách tham khảo',   'sach-tham-khao',   4),
  ('Lịch sử',          'lich-su',          5),
  ('Khác',             'khac',             6)
on conflict (slug) do nothing;
```

- [ ] **Step 8: Build the admin screen**

`src/app/quan-tri/the-loai/page.tsx`, following `src/app/quan-tri/tu-sach/page.tsx` exactly — `export const dynamic = "force-dynamic"`, `loadPage`, a `<details>` disclosure holding the create form, and per-row `<details>` for rename and archive. Add `{ key: "the-loai", label: "Thể loại", icon: Tags }` to the admin nav array in `src/components/shell/manager-shell.tsx` (the array at line ~196 for the manager shell has the shape to copy; the admin nav is the other array in the same file).

- [ ] **Step 9: Verify in the browser**

```bash
bun run db:migrate
bun run dev
```

At `/quan-tri/the-loai`: create "Sách song ngữ", rename it, then try to archive a category that has books (expect the Vietnamese refusal). Then at `/tu-sach/dong-thap/quan-ly/sach/moi` confirm the new category appears in the `<select>`.

- [ ] **Step 10: Commit**

```bash
git add src/domain/catalogue src/app/quan-tri/the-loai src/db/migrations src/components/shell/manager-shell.tsx src/domain/kernel tests/domain/catalogue src/app/quan-tri/admin-actions.ts
git commit -m "feat(b1): categories can be created, renamed and archived"
```

---

### Task 3: Parish taxonomy and units get a screen

**Why:** `create-parish-unit`, `rename-parish-unit`, `delete-parish-unit`, `reorder-parish-units` and `update-parish-taxonomy` all exist and are tested; **no file under `src/app` calls any of them**. Visible consequence: the "Giáo xứ" section on `/quan-ly/nguoi-doc/moi` renders a heading and helper text with no field, the `Tổ` column is permanently "Chưa có", and `?don-vi=` matches nothing.

**Files:**
- Create: `src/app/tu-sach/[shelf]/quan-ly/co-cau/page.tsx`
- Modify: `src/app/tu-sach/[shelf]/quan-ly/actions.ts` (five actions)
- Modify: `src/components/shell/manager-shell.tsx` (nav entry `co-cau`, label "Cơ cấu giáo xứ", icon `Network`)
- Modify: `src/components/parish-unit-fields.tsx` (empty state)
- Test: `tests/architecture/every-domain-command-has-a-caller.test.ts` (create)

**Interfaces:**
- Consumes: `updateParishTaxonomy(tx, ctx, { levels?, nested?, level1Label?, level2Label? })`, `createParishUnit(tx, ctx, { level, parentId, name })`, `renameParishUnit(tx, ctx, { id, name })`, `deleteParishUnit(tx, ctx, { id })`, `reorderParishUnits(tx, ctx, { level, parentId, orderedIds })` — read each file for the exact parameter names before writing the actions.
- Produces: `updateTaxonomyAction`, `createUnitAction`, `renameUnitAction`, `deleteUnitAction`, `reorderUnitsAction` in `quan-ly/actions.ts`.

- [ ] **Step 1: Write the failing architecture test**

This is the test that would have caught all of P0-2 through P0-5 at once.

```ts
import { execSync } from "node:child_process";
import { expect, test } from "vitest";

/**
 * A command nothing calls is a feature nobody has.
 *
 * On 10/08/2026 a QA pass on a fresh install found five command families
 * fully implemented, fully tested, and unreachable from any screen: parish
 * units, parish taxonomy, reader credentials, membership suspension, and
 * manager assignment. Every domain test was green. This closes the seam.
 */
const EXEMPT = new Set<string>([
  // Commands invoked by a CLI or the seed rather than by a screen. Add a row
  // here only with the caller named.
  // "src/domain/notifications/sweep.ts", // src/db/sweep-cli.ts
]);

test("every domain command is reachable from src/app", () => {
  const files = execSync("ls src/domain/*/commands/*.ts", { encoding: "utf8" })
    .split("\n")
    .filter(Boolean)
    .filter((f) => !EXEMPT.has(f));

  const unreachable = files.filter((file) => {
    const [name] = execSync(
      `grep -oE 'export (async )?function [A-Za-z0-9_]+' ${file} | head -1`,
      { encoding: "utf8" },
    )
      .trim()
      .split(/\s+/)
      .slice(-1);
    if (!name) return false;
    const hits = execSync(`grep -rl '\\b${name}\\b' src/app || true`, {
      encoding: "utf8",
    }).trim();
    return hits === "";
  });

  expect(unreachable, "commands with no caller in src/app").toEqual([]);
});
```

- [ ] **Step 2: Run it and read the list**

```bash
bun run test tests/architecture/every-domain-command-has-a-caller.test.ts
```

Expected: FAIL, listing the parish-unit commands plus the reader and manager commands Tasks 4 and 5 will wire. Record the list — it is this wave's checklist.

- [ ] **Step 3: Add the five server actions**

In `src/app/tu-sach/[shelf]/quan-ly/actions.ts`, following the shape of the existing `approveMembershipAction` exactly: `submitCommand`, `field`/`optional` for form parsing, `ACTION_ERROR_PARAM` on failure, `revalidatePath` on success.

- [ ] **Step 4: Build the screen**

`src/app/tu-sach/[shelf]/quan-ly/co-cau/page.tsx`, two sections:

1. **"Cách gọi các đơn vị"** — a radio pair for one or two levels, a checkbox for `nested`, and two text inputs for `level1Label` / `level2Label`, defaulted from `loadParishContext`. Copy already exists in `src/domain/members/parish-taxonomy.ts`'s `defaultTaxonomy()` — use those as placeholders.
2. **"Danh sách đơn vị"** — the tree from `getParishUnits`, each row with rename and delete disclosures, level-2 rows nested under their parent when `nested`, and an "Thêm đơn vị" disclosure per level.

Reordering: two `<form>` buttons per row ("Lên" / "Xuống") posting `orderedIds` computed on the server, so it works without JavaScript like the rest of the app.

- [ ] **Step 5: Fix the empty section on the reader form**

`src/components/parish-unit-fields.tsx`: when `units.length === 0`, render one sentence instead of a bare heading —

```tsx
<p className="text-[14px] text-meta">
  Tủ sách chưa khai báo giáo họ nào. Quản lý thêm ở mục{" "}
  <Link href={`${base}/quan-ly/co-cau`} className="underline">
    Cơ cấu giáo xứ
  </Link>
  .
</p>
```

For a reader (not a manager) drop the link and end the sentence after "giáo họ nào."

- [ ] **Step 6: Verify in the browser**

At `/tu-sach/dong-thap/quan-ly/co-cau`: switch to two levels, rename level 1 to "Giáo khu", add two units, add a child unit, reorder, delete one. Then open `/quan-ly/nguoi-doc/moi` and confirm the "Giáo xứ" section now shows two `<select>`s labelled "Giáo khu" and the level-2 label, and that choosing a parent narrows the child list.

- [ ] **Step 7: Commit**

```bash
git add "src/app/tu-sach/[shelf]/quan-ly/co-cau" "src/app/tu-sach/[shelf]/quan-ly/actions.ts" src/components/parish-unit-fields.tsx src/components/shell/manager-shell.tsx tests/architecture
git commit -m "feat(b2b): parish taxonomy and units get a management screen"
```

---

### Task 4: A reader can be given a login, suspended, reinstated and corrected

**Why:** `/quan-ly/nguoi-doc/<id>` shows "Chưa có tài khoản đăng nhập" and offers no action at all. The five commands exist. The page's own comment blames an unwired `setPasswordHasher`; Task 1 removes that excuse, and the comment is already stale (`src/instrumentation.ts:45`).

**Files:**
- Modify: `src/app/tu-sach/[shelf]/quan-ly/nguoi-doc/[id]/page.tsx` (add an actions section; delete the stale comment at lines 54-71)
- Modify: `src/app/tu-sach/[shelf]/quan-ly/actions.ts`
- Test: `tests/domain/members/reader-admin.test.ts` (extend if present, else create)

**Interfaces:**
- Consumes: `setReaderCredentials`, `suspendMembership`, `reactivateMembership`, `markMembershipLeft`, `updateReaderProfile` — read each for its exact input shape.
- Produces: `setReaderCredentialsAction`, `suspendMembershipAction`, `reactivateMembershipAction`, `markMembershipLeftAction`, `updateReaderProfileAction`.

- [ ] **Step 1: Add the actions**, same shape as Task 3 Step 3.

- [ ] **Step 2: Render them, conditioned on current state**

Under the existing "Thông tin" block. Exactly one terracotta primary — "Cấp tài khoản đăng nhập" when there is none, otherwise none of them is primary.

- When `!reader.hasCredentials`: a `<details>` "Cấp tài khoản đăng nhập" with `ten-dang-nhap` and `mat-khau` (`minLength={8}`) and the sentence *"Ghi lại giúp em rồi đưa tận tay. Hệ thống không gửi tin nhắn."*
- When `reader.hasCredentials`: a `<details>` "Đặt lại mật khẩu" with `mat-khau` only.
- When `status === "active"`: `<details>` "Tạm khoá" (reason `textarea`, required) and `<details>` "Đánh dấu đã rời".
- When `status === "suspended"`: `<details>` "Mở khoá lại".
- Always: `<details>` "Sửa hồ sơ" wrapping the same field set the reader's own profile form uses, via `updateReaderProfileAction`.

- [ ] **Step 3: Delete the stale comment** at `nguoi-doc/[id]/page.tsx:54-71` and replace it with one sentence recording that the actions are wired as of this task.

- [ ] **Step 4: Verify in the browser**

Create a reader with no credentials, give them a login, sign out, sign in as that reader, confirm they land on their own shelf. Then suspend them and confirm sign-in is refused with a Vietnamese sentence.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(b2): wire the five reader administration commands"
```

---

### Task 5: A manager can be appointed

**Why:** `assignManagerAction` is exported at `src/app/quan-tri/admin-actions.ts:138` and rendered nowhere. `/quan-tri/quan-ly-vien` can revoke and promote, but on a fresh install the list holds only the super admin, so nothing on the page is actionable and no parish can ever be delegated.

**Files:**
- Modify: `src/app/quan-tri/quan-ly-vien/page.tsx`
- Modify: `src/domain/admin/queries/get-admin-overview.ts` (or a new query) to list candidate readers per shelf

- [ ] **Step 1: Add the candidate query** — active memberships with `role = 'reader'`, grouped by shelf, name and id only.

- [ ] **Step 2: Render the appoint form** at the top of the page, above the manager list: a shelf `<select>`, a reader `<select>` filtered by the chosen shelf (server-rendered via `?tu-sach=` on the form's `GET` companion, so it needs no JavaScript), and a terracotta "Giao quyền quản lý". Empty states: *"Chưa có tủ sách nào."* / *"Tủ sách này chưa có bạn đọc nào để giao quyền."*

- [ ] **Step 3: Verify** — appoint a Đồng Tháp reader as manager, sign in as them, confirm `/tu-sach/dong-thap/quan-ly` is reachable and `/tu-sach/can-tho/quan-ly` is not.

- [ ] **Step 4: Commit**

```bash
git commit -am "feat(b4): appoint a shelf manager from the admin surface"
```

---

### Task 6: A signed-in visitor sees that they are signed in

**Why:** After a successful sign-in the admin lands on `/tu-sach`, whose header still shows the **"Đăng nhập"** button — no name, no sign-out, no route into `/quan-tri`. On a fresh install the only way in is typing the URL. Same on `/lien-he` and `/`.

**Files:**
- Modify: `src/components/shell/public-header.tsx` (`FrontDoorHeader`)
- Modify: `src/app/tu-sach/page.tsx`, `src/app/page.tsx`, `src/app/lien-he/page.tsx` (pass the viewer)
- Modify: `src/app/dang-nhap/actions.ts` (redirect a super admin to `/quan-tri`)

- [ ] **Step 1:** Give `FrontDoorHeader` the props `viewerName: string | null` and `isSuperAdmin: boolean`. When `viewerName` is set, replace the "Đăng nhập" button with the name, a "Quản trị hệ thống" link when `isSuperAdmin`, and the same sign-out form `ManagerShell` already uses.

- [ ] **Step 2:** In `src/app/dang-nhap/actions.ts`, when `landingShelfFor` returns `null` **and** the user is a super admin, redirect to `/quan-tri` instead of `/tu-sach`. Keep the `?tiep=` return path winning over both.

- [ ] **Step 3: Verify** — sign in as `admin`, land on `/quan-tri`; navigate to `/tu-sach` and confirm the header shows the name and a sign-out control.

- [ ] **Step 4: Commit**

```bash
git commit -am "fix(u2): the front door shows the signed-in viewer and the way into /quan-tri"
```

---

# WAVE 2 — the reader area moves to `/ho-so`, and active state stops lying

### Task 7: Rename the reader area `toi` → `ho-so`

**Why:** `toi` reads as a pronoun and does not say what the page holds; `ho-so` does. The current child route `toi/ho-so` would collide, so the profile becomes the area index and the dashboard moves down one level.

**Final shape:**

| Path | Screen |
|---|---|
| `/tu-sach/<shelf>/ho-so` | Hồ sơ (was `/toi/ho-so`) |
| `/tu-sach/<shelf>/ho-so/tong-quan` | Trang của tôi (was `/toi`) |
| `/tu-sach/<shelf>/ho-so/lich-su` | Lịch sử mượn |
| `/tu-sach/<shelf>/ho-so/tang-sach` | Tặng sách |
| `/tu-sach/<shelf>/ho-so/thong-bao` | Thông báo |

**Files:** the seven moves in the File Structure table, plus every reference below.

- [ ] **Step 1: Move the files with `git mv`** so history follows

```bash
cd "src/app/tu-sach/[shelf]"
mkdir -p ho-so/tong-quan
git mv toi/ho-so/page.tsx        ho-so/page.tsx
git mv toi/ho-so/actions.ts      ho-so/profile-actions.ts
git mv toi/actions.ts            ho-so/reader-actions.ts
git mv toi/page.tsx              ho-so/tong-quan/page.tsx
git mv toi/lich-su               ho-so/lich-su
git mv toi/tang-sach             ho-so/tang-sach
git mv toi/thong-bao             ho-so/thong-bao
rmdir toi/ho-so toi
```

- [ ] **Step 2: Fix the three action imports**

- `ho-so/page.tsx:22` — `from "./actions"` → `from "./profile-actions"`
- `ho-so/tong-quan/page.tsx:18` — `from "./actions"` → `from "../reader-actions"`
- `ho-so/thong-bao/page.tsx:13` — `from "../actions"` → `from "../reader-actions"`

- [ ] **Step 3: Update every remaining reference**

Exact list, verified by `grep -rn -- "/toi" src tests scripts docs`:

| File:line | Change |
|---|---|
| `src/app/tu-sach/[shelf]/community-actions.ts:70` | `/toi/tang-sach` → `/ho-so/tang-sach` |
| `src/app/tu-sach/[shelf]/tang-sach/page.tsx:29` | redirect target → `/ho-so/tang-sach` |
| `src/app/tu-sach/[shelf]/tang-sach/page.tsx:7` | comment |
| `src/components/shell/public-header.tsx:164` | `href: \`${base}/ho-so/tong-quan\`` |
| `src/components/shell/public-header.tsx:166` | `href: \`${base}/ho-so/thong-bao\`` |
| `src/components/shell/public-header.tsx:119` | stale comment about unwired pages — delete |
| `src/components/shell/reader-tabs.tsx:5-9` | paths `ho-so`, `ho-so/tong-quan`, `ho-so/lich-su`, `ho-so/tang-sach`, `ho-so/thong-bao` |
| `src/lib/profile-labels.ts:21` | comment |
| `src/lib/object-store.ts:13` | comment |
| `tests/architecture/a-wired-page-renders-no-fixtures.test.ts:558,560` | both path strings |
| `tests/lib/avatar-actions.test.ts:52` | import path → `ho-so/profile-actions` |
| `tests/lib/avatar-over-http.test.ts:75` | `/tu-sach/dong-thap/ho-so` |
| `scripts/check-links.mjs:79-83` | five paths |
| `scripts/check-links.mjs:379` | redirect pair → `[${S}/tang-sach, ${S}/ho-so/tang-sach]` |
| `scripts/export-pdf.mjs:106,111,116,121,311` | five paths and the caption |
| `docs/OPERATIONS.md:487` | path in prose |
| `docs/superpowers/plans/2026-08-09-b2b-profile-and-units.md:49` | historical — leave, it describes what was true then |

- [ ] **Step 4: Add permanent redirects for the old URLs**

Readers bookmark these. In `next.config.ts`, alongside `experimental`:

```ts
async redirects() {
  // The reader area moved from `toi` to `ho-so` (QA remediation, 10/08/2026).
  // Permanent, because these are the URLs a child saved on a phone.
  return [
    {
      source: "/tu-sach/:shelf/toi",
      destination: "/tu-sach/:shelf/ho-so/tong-quan",
      permanent: true,
    },
    {
      source: "/tu-sach/:shelf/toi/ho-so",
      destination: "/tu-sach/:shelf/ho-so",
      permanent: true,
    },
    {
      source: "/tu-sach/:shelf/toi/:rest*",
      destination: "/tu-sach/:shelf/ho-so/:rest*",
      permanent: true,
    },
  ];
},
```

Order matters — `/toi/ho-so` must be listed before the catch-all, or it lands on `/ho-so/ho-so`.

- [ ] **Step 5: Prove the redirects**

Add to `tests/architecture/` a test that asserts the three entries exist and that the `/toi/ho-so` rule precedes the wildcard. Then, with `bun run dev` running:

```bash
for p in /toi /toi/ho-so /toi/lich-su /toi/tang-sach /toi/thong-bao; do
  curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" "http://localhost:3000/tu-sach/dong-thap$p"
done
```

Expected: five `308`s, landing on `/ho-so/tong-quan`, `/ho-so`, `/ho-so/lich-su`, `/ho-so/tang-sach`, `/ho-so/thong-bao`.

- [ ] **Step 6: Run the link crawler and the suite**

```bash
bun run check:links
bun run check
```

- [ ] **Step 7: Commit**

```bash
git commit -am "refactor(u4): the reader area moves from /toi to /ho-so"
```

---

### Task 8: `ReaderTabs` derives its own active tab

**Why:** Three pages passed the wrong `active` key — `/toi/tang-sach`, `/toi/lich-su` and `/toi/thong-bao` all said `"trang-cua-toi"`, so "Trang của tôi" carried `aria-current="page"` and the terracotta underline while the real page's tab sat inert. A prop that every caller must remember to set correctly is the bug; remove the prop.

**Files:**
- Modify: `src/components/shell/reader-tabs.tsx`
- Modify: the five pages under `src/app/tu-sach/[shelf]/ho-so/`
- Test: `tests/components/reader-tabs.test.tsx` (create)

**Interfaces:**
- Produces: `<ReaderTabs shelfSlug={string} pathname={string} />` — the `active` prop and the `ReaderTabKey` type are deleted.

- [ ] **Step 1: Write the failing test**

```tsx
const CASES = [
  ["/tu-sach/x/ho-so", "Hồ sơ"],
  ["/tu-sach/x/ho-so/tong-quan", "Trang của tôi"],
  ["/tu-sach/x/ho-so/lich-su", "Lịch sử mượn"],
  ["/tu-sach/x/ho-so/tang-sach", "Tặng sách"],
  ["/tu-sach/x/ho-so/thong-bao", "Thông báo"],
] as const;

test.each(CASES)("%s marks exactly %s active", (pathname, label) => {
  const html = renderToStaticMarkup(
    <ReaderTabs shelfSlug="x" pathname={pathname} />,
  );
  const active = [...html.matchAll(/aria-current="page"[^>]*>([^<]+)</g)].map(
    (m) => m[1],
  );
  expect(active).toEqual([label]);
});
```

The `toEqual([label])` — not `toContain` — is the point: it fails both when the wrong tab is marked and when two are.

- [ ] **Step 2: Run and watch it fail.** Expected: the component does not accept `pathname`.

- [ ] **Step 3: Implement exact matching**

```tsx
const isActive = `${base}/${tab.path}` === pathname;
```

Exact equality, never `startsWith` — `startsWith` is what makes `/ho-so` match `/ho-so/lich-su` and reintroduces this bug from the other direction.

- [ ] **Step 4: Update the five callers** to `<ReaderTabs shelfSlug={slug} pathname={pathname} />`, where `pathname` is built from the route's own params — these are server components, so pass the literal the page already knows (e.g. `` `/tu-sach/${slug}/ho-so/lich-su` ``) rather than reaching for `usePathname`.

- [ ] **Step 5: Run the test, then verify in the browser.** Walk all five tabs and confirm the underline follows.

- [ ] **Step 6: Commit**

```bash
git commit -am "fix(u4): ReaderTabs marks the tab you are actually on"
```

---

### Task 9: The reader header stops colliding on `thong-bao`

**Why:** `src/components/shell/public-header.tsx:161` and `:174` both use `key: "thong-bao"` — "Bản tin" (`/thong-bao`) and the personal bell (`/ho-so/thong-bao`). React logs *"Encountered two children with the same key"* on every reader page (2 issues in the dev overlay). The `active` union at line 100 already declares `"thong-bao-cua-toi"`, which no link uses, so the bell can never be highlighted — on `/ho-so/thong-bao` no top-nav item is active at all.

**Files:**
- Modify: `src/components/shell/public-header.tsx:100,174`
- Test: `tests/components/public-header.test.tsx` (create)

- [ ] **Step 1: Write the failing test** — assert the keys are unique, and that each of the five paths marks exactly one nav item active:

```tsx
test("nav keys are unique", () => {
  const keys = navKeysFor("/tu-sach/x/ho-so/thong-bao");
  expect(new Set(keys).size).toBe(keys.length);
});

test.each([
  ["/tu-sach/x/danh-muc", "Danh mục"],
  ["/tu-sach/x/thong-bao", "Bản tin"],
  ["/tu-sach/x/ho-so/tong-quan", "Trang của tôi"],
  ["/tu-sach/x/ho-so/thong-bao", "Thông báo"],
  ["/tu-sach/x/tim-kiem", "Tìm kiếm"],
])("%s marks exactly %s", (pathname, label) => { /* as in Task 8 */ });
```

- [ ] **Step 2: Change line 174** to `key: "thong-bao-cua-toi"` and update every `active="…"` caller that meant the bell.

- [ ] **Step 3: Verify** — load `/tu-sach/dong-thap/ho-so/thong-bao`, confirm the dev overlay shows no issues and "Thông báo" is terracotta while "Bản tin" is not.

- [ ] **Step 4: Commit**

```bash
git commit -am "fix(u2): unique nav keys so the notification bell can be active"
```

---

### Task 10: The profile page survives a viewer with no membership

**Why:** `src/app/tu-sach/[shelf]/ho-so/page.tsx:84` reads `membershipId: ctx.actor.membershipId ?? ""`. A super admin deliberately has no membership, so `""` reaches `get-my-profile.ts:88`'s `where m.id = ${...}` and Postgres raises `22P02 invalid input syntax for type uuid: ""`. Reproduced twice; the four sibling `/ho-so/*` pages render fine.

**Files:**
- Modify: `src/app/tu-sach/[shelf]/ho-so/page.tsx:80-90`
- Test: `tests/lib/profile-page-without-membership.test.ts` (create)

- [ ] **Step 1: Write the failing test** — call the page's loader with a context whose `actor.membershipId` is `null`; expect a `NotFound`, not a `PostgresError`.

- [ ] **Step 2: Replace the coercion**

```tsx
// A super admin has no membership anywhere by design (`guards.ts`), so this is
// reachable in normal use, not only by a hand-typed URL. `?? ""` sent an empty
// string into a `uuid` parameter and Postgres answered 22P02 — a 500 on a page
// reached from the nav.
if (ctx.actor.membershipId === null) notFound();
```

`notFound()` from `next/navigation`, so the viewer gets the app's own 404 rather than the red error page. If a friendlier answer is wanted, render a card reading *"Bạn không phải bạn đọc của tủ sách này."* with a link back to `/quan-tri` — decide once and apply the same treatment to `/ho-so/tong-quan`, `/ho-so/lich-su`, `/ho-so/tang-sach` and `/ho-so/thong-bao`, which currently render an empty page for the same viewer.

- [ ] **Step 3: Sweep for the same shape**

```bash
grep -rn "membershipId ?? \"\"\|Id ?? \"\"" src
```

Fix every hit the same way.

- [ ] **Step 4: Verify** — signed in as `admin`, open `/tu-sach/dong-thap/ho-so`. Expected: 404 or the explanatory card, never the red page.

- [ ] **Step 5: Commit**

```bash
git commit -am "fix(u4): the profile page no longer 500s for a viewer with no membership"
```

---

# WAVE 3 — visible defects

### Task 11: No dead buttons on the book detail page

**Why:** `/quan-ly/sach/<slug>` renders twelve `<button type="submit">` with no enclosing `<form>` — "Đánh giá", "Báo mất", "Ngừng dùng" for each copy. Clicking does nothing, silently. "Sửa sách" links to the book *list*. `assessCondition`, `reportCopyLost`, `retireCopy`, `markCopyFound` and `updateBook` all exist.

**Files:**
- Modify: `src/app/tu-sach/[shelf]/quan-ly/sach/[id]/page.tsx`
- Modify: `src/app/tu-sach/[shelf]/quan-ly/actions.ts`
- Create: `src/app/tu-sach/[shelf]/quan-ly/sach/[id]/sua/page.tsx`
- Test: `tests/architecture/no-button-without-a-form.test.ts` (create)

- [ ] **Step 1: Write the guard test** — parse every `.tsx` under `src/app` and fail on any `<button type="submit">` (or `<SubmitButton>`) that is not lexically inside a `<form>`. A crude but sufficient check: for each file, walk the JSX text and assert every `SubmitButton`/`type="submit"` occurrence has an unclosed `<form` before it. Run it; it should list the twelve.

- [ ] **Step 2: Wrap each control in a real form** posting to the matching action, with `copy-id` hidden. "Đánh giá" opens the same six-way condition selector `/quan-ly/nhan-tra` uses — extract that block into `src/components/condition-picker.tsx` and use it in both places rather than copying it.

- [ ] **Step 3: Build the edit page** at `sach/[id]/sua`, reusing the field set from `sach/moi` (extract to `src/components/book-fields.tsx`), calling `updateBookAction`. Point "Sửa sách" at it.

- [ ] **Step 4: Verify** — assess a copy as "Rách", report one lost, retire one, mark one found, edit the title. Confirm each shows in `/quan-ly/nhat-ky`.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(b1): wire the copy actions and add a book edit page"
```

---

### Task 12: Book covers come from the database, not from fixtures

**Why:** `src/components/ui/book.tsx:54` calls `coverForTitle(title)` from `@/lib/fixtures` on every page, including database-backed ones. A book titled "Dế Mèn Phiêu Lưu Ký" created for *Giáo xứ Thánh Tâm* renders `public/covers/de-men-phieu-luu-ky.svg`, whose line 9 reads `<text …>Tủ sách Đồng Tháp</text>` — another parish's name, publicly, on a new parish's book. `books.cover_url` is ignored.

**Files:**
- Modify: `src/components/ui/book.tsx`
- Modify: every `BookCover` call site (pass `coverUrl`)
- Modify: `public/covers/*.svg` (10 files)
- Test: `tests/architecture/boundaries.test.ts` (extend)

- [ ] **Step 1: Extend the boundary test** — no file under `src/components/` may import `@/lib/fixtures`. Run it; expect it to fail on `book.tsx`.

- [ ] **Step 2: Give `BookCover` a `coverUrl?: string | null` prop**, delete the `coverForTitle` import, and keep the kraft placeholder as the fallback.

- [ ] **Step 3: Thread `book.coverUrl` from each query** through every call site. Where a query does not select `cover_url` yet, add it.

- [ ] **Step 4: Strip the parish name from the artwork** — delete line 9 from each of the ten SVGs in `public/covers/`, so a fixture cover that does get served carries no other parish's name.

- [ ] **Step 5: Verify** — the QA book still renders the kraft placeholder (its `cover_url` is empty); a seeded Đồng Tháp book still renders its artwork, now without the caption.

- [ ] **Step 6: Commit**

```bash
git commit -am "fix(u1): book covers read cover_url instead of the fixtures module"
```

---

### Task 13: A rejected registration keeps what was typed

**Why:** Submitting `/dang-ky` with a short password redirects to `?loi=password_too_short` with all nine fields cleared. A parent on a phone retypes everything.

**Files:**
- Modify: `src/app/dang-ky/actions.ts`, `src/app/dang-ky/page.tsx`

- [ ] **Step 1:** On failure, carry every non-secret field back in the query string (the action already carries `ten` for sign-in — same mechanism, more fields). Never the two password fields.
- [ ] **Step 2:** `defaultValue={param(search, "…")}` on each input.
- [ ] **Step 3:** Apply the same treatment to `/quan-ly/nguoi-doc/moi` and `/quan-ly/sach/moi`.
- [ ] **Step 4: Verify** — submit with a 3-character password; expect the Vietnamese message and eight fields still filled.
- [ ] **Step 5: Commit**

```bash
git commit -am "fix(s3): keep the form's values when a registration is rejected"
```

---

### Task 14: Filter chips are links or they are not chips

**Why:** `/quan-ly/thong-bao` ("Tất cả / Đang hiện / Nháp / Hết hạn") and `/quan-ly/binh-luan` ("Chờ duyệt / Đã duyệt / Đã từ chối / Đã ẩn") render `<span class="rounded-control bg-surface px-3 py-1.5">` — visually identical to the working filter chips on `/quan-ly/nguoi-doc`, but inert, with no active state.

**Files:**
- Modify: `src/app/tu-sach/[shelf]/quan-ly/thong-bao/page.tsx`, `src/app/tu-sach/[shelf]/quan-ly/binh-luan/page.tsx`
- Modify: the reader-list chip component (extract it if it is still inline) into `src/components/ui/filter-chips.tsx`

- [ ] **Step 1:** Extract the working chip from `nguoi-doc/page.tsx` into `FilterChips`, taking `{ label, href, active, count? }[]`, and add `aria-current="page"` on the active one (fixes P3-4 in the same move).
- [ ] **Step 2:** Use it on both pages with real `?trang-thai=` filtering behind it, and the same unknown-value-falls-back-to-all behaviour the reader list already has.
- [ ] **Step 3: Verify** — click through every chip on both pages; the list narrows and exactly one chip is terracotta.
- [ ] **Step 4: Commit**

```bash
git commit -am "fix(b3): announcement and comment filters actually filter"
```

---

### Task 15: Lending policy refuses nonsense

**Why:** "Số ngày cho mượn" accepted `0` and stored `settings.loan_days = 0` with no error — every loan then falls due the day it is made. `max_concurrent_loans = 0` stops all borrowing. The inputs carry `min="0"` and no `max`; the domain does not narrow it.

**Files:**
- Modify: `src/domain/admin/commands/bookshelves.ts`, `src/domain/admin/commands/system-settings.ts`
- Modify: `src/app/quan-tri/tu-sach/page.tsx`, `src/app/quan-tri/cai-dat/page.tsx`
- Test: `tests/domain/admin/bookshelf-settings.test.ts`

- [ ] **Step 1: Write the failing tests** — each of `loan_days`, `max_concurrent_loans`, `max_renewals`, `renewal_days`, `hold_days`, `due_soon_days` rejected at `0` (except `max_renewals`, where `0` legitimately means "no renewals") and above its ceiling.
- [ ] **Step 2: Add the bounds** in the domain, with a Vietnamese sentence per code: `loan_days` 1-365, `max_concurrent_loans` 1-50, `max_renewals` 0-10, `renewal_days` 1-365, `hold_days` 1-30, `due_soon_days` 0-30.
- [ ] **Step 3: Mirror them as `min`/`max` on the inputs** so the browser refuses first and the domain is the backstop.
- [ ] **Step 4: Verify** — set 0, expect a Vietnamese refusal, not a silent save.
- [ ] **Step 5: Commit**

```bash
git commit -am "fix(b4): lending policy values are bounded"
```

---

### Task 16: Every save says so

**Why:** "Lưu cài đặt", "Xác nhận cho mượn" and "Xác nhận nhận trả" all complete silently; the settings form re-renders identically. `/gop-y` already does this right (*"Đã gửi rồi, cảm ơn em nhé."*) — the pattern exists, it is just not applied.

**Files:**
- Create: `src/components/ui/saved-notice.tsx`
- Modify: `src/lib/search-params.ts` (add `ACTION_DONE_PARAM = "da-luu"`)
- Modify: every action that currently redirects on success without a marker

- [ ] **Step 1:** `SavedNotice` renders a sage-toned strip when `?da-luu` is present, with the sentence passed in.
- [ ] **Step 2:** Add `?da-luu=1` to the success redirect of each action and render the notice on the matching page. Sentences: shelf settings *"Đã lưu cài đặt."*; lending *"Đã cho {tên} mượn {mã bản}, hạn trả {ngày}."*; return *"Đã nhận lại {mã bản}."*
- [ ] **Step 3: Verify** each of the three.
- [ ] **Step 4: Commit**

```bash
git commit -am "feat(u3): confirm every save the way /gop-y already does"
```

---

### Task 17: The onboarding loop closes

**Why:** `/tu-sach` with no shelves says *"liên hệ với ban quản trị để mở một tủ mới"*; `/lien-he` answers *"Ban quản trị chưa điền thông tin liên hệ."* and offers no form. A parish that wants a shelf has no way to reach anyone, and nothing tells the admin to fill it in.

**Files:**
- Modify: `src/app/lien-he/page.tsx`, `src/app/quan-tri/page.tsx`, `src/app/tu-sach/page.tsx`

- [ ] **Step 1:** When `site_contact` is empty, `/lien-he` renders the site-wide feedback form (`feedback` already accepts `bookshelf_id is null` — see `20260808_01_feedback_rls.sql`) instead of the dead-end sentence. It lands in `/quan-tri/gop-y`.
- [ ] **Step 2:** On `/quan-tri`, when `site_contact` is empty show a card: *"Chưa có thông tin liên hệ — giáo xứ muốn mở tủ sách sẽ không biết hỏi ai."* with a link to `/quan-tri/cai-dat`.
- [ ] **Step 3:** Give `/tu-sach` a distinct empty-system state (fixes P3-1): *"Chưa có tủ sách nào trên OLibra."* when nothing was searched, keeping the "no results" copy for a search that returned nothing.
- [ ] **Step 4: Verify** on the QA database, which has no `site_contact`.
- [ ] **Step 5: Commit**

```bash
git commit -am "fix(b4): a parish with no shelf can reach the administrators"
```

---

# WAVE 4 — data integrity, operations, polish

### Task 18: Phone numbers are phone numbers

**Why:** `khong-phai-so` was accepted into the required "Số điện thoại" field, stored, and rendered as `tel:khong-phai-so` on the approval card, the reader profile and the overdue list. `/gop-y` already uses `type="tel"` — the knowledge exists, it just was not applied.

- [ ] **Step 1:** Add `assertPhone` to `src/domain/members/policy.ts` — 9-11 digits after stripping spaces, dots and dashes, optionally `+84`-prefixed; error code `phone_invalid` → *"Số điện thoại chưa đúng. Ghi 10 số, ví dụ 0912345678."*
- [ ] **Step 2:** Call it from `registerMembership`, `registerMemberOnBehalf`, `updateReaderProfile`, `proposeProfileChange`, `updateSiteContact`, `createBookshelf`, `updateBookshelfSettings`.
- [ ] **Step 3:** `type="tel"` + `inputMode="numeric"` + `pattern` on every phone input.
- [ ] **Step 4:** `PhoneLink` renders plain text, not a `tel:` anchor, when the value does not parse.
- [ ] **Step 5: Verify** with `khong-phai-so`; expect the Vietnamese refusal. **Commit.**

### Task 19: One donor, not two

**Why:** The add-book form says *"chọn đúng MỘT trong hai cách"* and then accepts both. Filling the donor `<select>` **and** the free-text box wrote `acquired_from = 'bác Hoà'` **and** `acquired_from_membership_id = <Ngọc>` on every copy — two contradicting attributions on one row, with the CSV export reporting the free text.

- [ ] **Step 1:** Failing test — `createBook` with both `donorMembershipId` and `donorName` rejects with `donor_ambiguous` → *"Chọn bạn đọc hoặc gõ tên người tặng, không chọn cả hai."*
- [ ] **Step 2:** Add the guard. **Step 3:** Mirror it in the form (a two-radio "Cách chọn" that shows one control at a time). **Step 4: Verify. Commit.**

### Task 20: The donor is visible somewhere

**Why:** `book_donations` stayed empty; the add-book donor fields write only to `book_copies`, and no screen renders them.

- [ ] **Step 1:** Add a "Người tặng" row to the copies table on `/quan-ly/sach/<slug>`, showing the membership's name as a link when set, else the free text, else "—".
- [ ] **Step 2:** Decide and record in `docs/DATABASE.md` whether `book_donations` is for *offers* only (`/quan-ly/tang-sach`) while `book_copies.acquired_from*` is for *accessioned* copies. If so, say it in both files' docstrings; if not, make the add-book path write a donation row too. **Step 3: Verify. Commit.**

### Task 21: The feedback inbox shows who wrote it

**Why:** A feedback submitted with "Tên của em" = *Chị Hạnh* is stored correctly (`guest_name = 'Chị Hạnh'`) but displayed in `/quan-tri/gop-y` as *"Quản trị viên"* — the signed-in account's name. The admin calls the wrong person.

- [ ] **Step 1:** Failing test on `getFeedbackInbox`: with both `member_id` and `guest_name` set, the returned `displayName` is the guest name.
- [ ] **Step 2:** Prefer `guest_name`; fall back to the member's name; show the account name as a secondary line (*"gửi khi đang đăng nhập bằng …"*) so nothing is hidden. **Step 3: Verify. Commit.**

### Task 22: "Địa chỉ" means one thing

**Why:** `src/app/quan-tri/tu-sach/page.tsx:204` admits *"No screen in this application renders `address`"*, and `/quan-ly/cai-dat` labels the **`location`** value "Địa chỉ" — so the manager reads "Nhà xứ Thánh Tâm" under a label whose real value is invisible.

- [ ] **Step 1:** Render `address` on the public shelf page under "Địa chỉ", below "Địa điểm" (`location`), omitted when empty.
- [ ] **Step 2:** Relabel the `/quan-ly/cai-dat` row to "Địa điểm" and add a second row for the real address.
- [ ] **Step 3:** Delete the now-false comment at line 204. **Step 4: Verify. Commit.**

### Task 23: Every policy shown is a policy editable

**Why:** `/quan-ly/cai-dat` lists "Báo sắp đến hạn trước — 3 ngày" as an active rule; no admin form has that field. `/quan-tri/cai-dat` carries only 3 of the 5 per-shelf parameters.

- [ ] **Step 1:** Add `due_soon_days` to both admin forms, and `max_renewals` + `renewal_days` to `/quan-tri/cai-dat`, with the bounds from Task 15.
- [ ] **Step 2:** Add a test asserting that the set of keys rendered on `/quan-ly/cai-dat` equals the set editable at `/quan-tri/tu-sach`. **Step 3: Verify. Commit.**

### Task 24: The reminder sweep runs

**Why:** `bun run db:sweep` works — run live on 10/08/2026 it printed *"Sweep complete: 0 due-soon, 1 overdue notification(s)."* — but nothing schedules it. No cron service in `compose.yaml`, no workflow, no runbook entry. After a full borrow → overdue cycle the database held exactly one notification (`membership_approved`). Task 23's "Báo sắp đến hạn trước" is words until this lands.

- [ ] **Step 1:** Add a `sweep` service to `compose.yaml` — same image as `app`, `entrypoint` a small loop or a `crond`, running `bun run db:sweep` once a day at 07:00 `Asia/Ho_Chi_Minh`, `restart: unless-stopped`, `depends_on: db`, and `MIGRATION_DATABASE_URL` from the environment (not `DATABASE_URL` — `sweep-cli.ts` explains why).
- [ ] **Step 2:** Document it in `docs/OPERATIONS.md` beside §7's existing paragraph: how to run it by hand, what "0 nhắc nhở" means, and how to check it ran.
- [ ] **Step 3:** Extend `tests/architecture/the-scheduled-job-has-a-caller.test.ts` to also require a *scheduler*, not only a CLI — assert `compose.yaml` names `db:sweep`.
- [ ] **Step 4: Verify** — `docker compose up -d sweep && docker compose logs sweep`. **Commit.**

### Task 25: Every page has a title

**Why:** 38 of 47 `page.tsx` files export no `metadata`, so every tab reads "OLibra — Tủ sách cộng đồng" — including the public book page `/tu-sach/[shelf]/sach/[slug]`, which is the one page search engines index.

- [ ] **Step 1:** Write the guard test first: every `src/app/**/page.tsx` exports `metadata` or `generateMetadata`. Run it; expect 38 failures listed by path.
- [ ] **Step 2:** Add them. Dynamic routes use `generateMetadata` and the real record (book title, shelf name, announcement title). Static ones use `export const metadata = { title: "… — OLibra" }`.
- [ ] **Step 3:** Re-run the guard. **Commit.**

### Task 26: `.env.example` cannot hand out a comment as a password

**Why:** Line 9 is `POSTGRES_PASSWORD=          # required, no default — compose refuses to start without it`. Compose keeps everything after `=`, so the superuser password becomes that comment — verified on the running container. The comment's own claim is false: compose started. Line 26 has the same shape. `MIGRATION_DATABASE_URL` then cannot be written by hand, which is why `bun run db:migrate` fails from the host on a fresh clone.

- [ ] **Step 1:** Move every inline comment onto its own line above the variable, in `.env.example` and in any `.env` the team shares.
- [ ] **Step 2:** Add a startup check in `src/instrumentation.ts`: if `DATABASE_URL` or `MIGRATION_DATABASE_URL` contains `%23` or a literal `#`, throw with *"Có vẻ mật khẩu trong .env đang là dòng chú thích — xem .env.example."*
- [ ] **Step 3:** Add a test asserting no line in `.env.example` matches `/^[A-Z_]+=\s*#/`. **Commit.**

### Task 27: Polish batch (P3)

One PR, one commit per bullet:

- [ ] `/dang-nhap` — remove the `<a href="#">` "Quên mật khẩu?", or point it at a real page. Removing is correct until there is a reset flow; the copy already says *"Nếu quên, quản lý sẽ đặt lại giúp."*
- [ ] Empty tables render a single "Chưa có…" row instead of a bare header (`/quan-tri` shelf table, "Lịch sử mượn" on the book page).
- [ ] Replace browser-default validation messages with inline Vietnamese ones on the required fields of `/dang-ky`, `/quan-ly/sach/moi`, `/quan-ly/nguoi-doc/moi` — `lang="vi"` does not change them; the browser's UI language does.
- [ ] `/quan-ly/cho-muon` search box: `placeholder="Tên sách hoặc mã bản"`, plus a visible submit button.
- [ ] `/quan-ly/cho-muon/nguoi-doc` step 2 with no query: *"Gõ tên bạn đọc để tìm."* instead of a bare box.
- [ ] `/quan-tri/tu-sach` shows the full path `/tu-sach/<slug>` and links by slug, not UUID.
- [ ] `/quan-ly/thong-ke` chart: integer y-ticks with no duplicates when the maximum is small (`1, 1, 0` → `0, 1`).
- [ ] Decide whether a copy returned as `torn` / `missing_pages` should go back to `available` immediately. If not, add a `needs_repair` state; if so, record the decision in `docs/OPERATIONS.md` §5 so it stops looking like an oversight.

---

## Self-Review

**Spec coverage.** Every finding in `.artifacts/reports/2026-08-10-qa-fresh-install.md` maps to a task: P0-1→T1, P0-2→T4, P0-3→T2, P0-4→T3, P0-5→T5, P1-1→T10, P1-2→T8, P1-3→T9, P1-4→T11, P1-5→T12, P1-6→T13, P1-7→T14, P1-8→T6, P1-9→T17, P1-10→T15, P1-11→T16, P1-12→T24, P2-1→T18, P2-2→T19, P2-3→T20, P2-4→T21, P2-5→T22, P2-6→T23, P2-7→T25, P2-8→T26, P3-1→T17, P3-2..P3-10→T27. The route rename the product owner asked for is T7.

**Type consistency.** `hashFor`/`verifyFor`/`ensureCryptoWired`/`setPasswordHasher`/`setPasswordVerifier` keep the names `registration.ts` already exported, so no call site outside T1 changes. `ReaderTabs` loses `active: ReaderTabKey` and gains `pathname: string` in T8, and T7 is the only other task touching those five pages — T7 lands first, so its callers are rewritten once.

**Known ordering constraints.** T1 before T4 (credentials need the hasher). T2 before any book creation on a fresh install. T7 before T8 and T10 (both touch moved files). T15 before T23 (bounds before new fields). T3 before the `every-domain-command-has-a-caller` test can pass, so keep that test failing-but-committed only if the wave lands as one PR; otherwise add T4's and T5's commands to `EXEMPT` with a TODO naming the task, and remove them there.
