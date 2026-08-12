# Product owner feedback round one — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the thirteen items in `docs/superpowers/specs/2026-08-12-po-feedback-design.md` — multi-person shelf contacts, a slimmer shelf home, mobile search and profile panel, mandatory saint name, routed profile-change approvals, copy counts, and pinned announcements.

**Architecture:** One forward-only SQL migration carries every schema change. The domain layer stays framework-free: contacts are read through `src/lib/shelf.ts` (the seam every reader page already uses) and written through `src/domain/admin/commands/bookshelves.ts`. Approval routing is derived from the subject's membership role at decision time, so no schema supports it. Pinning needs no new domain code at all — `pinAnnouncement`/`unpinAnnouncement` exist and the queries already sort `is_pinned desc`; only the surface is missing.

**Tech Stack:** Next.js 16 App Router, React 19 server components, TypeScript 5.9, Tailwind v4 (CSS-first `@theme`), PostgreSQL via `postgres` (postgres.js), Vitest, Bun as package manager and script runner.

## Global Constraints

Copied from `AGENTS.md` and the spec. Every task's requirements implicitly include this section.

- **Bun only.** `bun install`, `bun add`, `bun run test`. Never npm/pnpm/yarn.
- **Vietnamese with full diacritics in every user-facing string.** No English in the UI, no lorem ipsum. URLs are Vietnamese too.
- **Sans everywhere; serif only via `BookTitle`.** Nothing else reaches for `font-serif`.
- **Status is never colour alone** — icon + Vietnamese word + colour, via `StatusBadge`/`StatusPanel`/`Pill`. `Pill` requires both an icon and a label.
- **One primary action per screen.** Solid terracotta appears once per screen.
- **Touch targets ≥ 44px** (`size-11`), primary buttons 56px, nothing closer than 8px (`gap-2`).
- **Tables become stacked cards below 768px.** Never a horizontally scrolling table.
- **Forms are single-column.** Labels above inputs, required fields marked with the word *Bắt buộc*, never a bare asterisk. Use `Field` + `Input`/`Textarea`/`Select`.
- **No shadows, no gradients, no glassmorphism.** 1px hairline borders and flat tonal layers.
- **Check `src/components/ui` before writing any new component.**
- **Every button lives in a form** — `tests/architecture/no-button-without-a-form.test.ts`.
- **Pages that read the database declare `export const dynamic = "force-dynamic"`** — `tests/architecture/pages-reading-the-database-are-dynamic.test.ts`.
- **`src/components/shell/public-header.tsx` must not import from `@/lib/page-data`** — that architecture test walks import specifiers as text and would then require `force-dynamic` on `/dang-nhap` and `/loi`. Pass plain props.
- **Test database required:** `docker compose --profile test up -d db-test` once per session. `bun run test` needs it; so does `bun run check`.
- **Commit message subjects are Vietnamese**, matching the existing log (`fix: thu nhỏ ảnh bìa sách trên Trang của tôi`).
- **This plan assumes a development database that is dropped and reseeded.** The `saint_name` NOT NULL migration takes no backfill step.

**Two guard tests must pass unchanged.** If either needs editing, the contacts table has been exposed where it must not be:
- `tests/architecture/the-front-door-shows-no-keeper-contact.test.ts`
- `tests/db/bookshelves-public-columns.test.ts`

---

## File structure

**Created**

| File | Responsibility |
|---|---|
| `src/db/migrations/20260812_01_contacts_profile_and_hours.sql` | Every schema change in this plan, in one forward-only file |
| `src/domain/admin/queries/get-pending-manager-changes.ts` | Cross-shelf queue of pending profile changes whose subject is a manager or shelf admin |
| `src/app/quan-tri/doi-thong-tin/page.tsx` | Super admin's approval queue for manager profile changes |
| `src/components/ui/contact-list.tsx` | The reader-facing contacts accordion, shared by the shelf home and anywhere else contacts are shown |
| `src/components/phone-confirm-dialog.tsx` | Client `<dialog>` raising the danger confirmation when a phone field is left empty |
| `tests/components/contact-list.test.tsx` | Unit test for the accordion's disclosure behaviour |
| `tests/domain/admin/shelf-contacts.test.ts` | Domain tests for reading and writing contacts |
| `tests/domain/members/approval-routing.test.ts` | Domain tests for §9's routing rules |

**Modified** — grouped by the task that touches them; exact line references appear in each task.

---

## Task 1: Migration and schema guards

**Files:**
- Create: `src/db/migrations/20260812_01_contacts_profile_and_hours.sql`
- Modify: `tests/support/factories.ts:22-32` (`makeUser` must supply `saint_name`)
- Test: `tests/db/schema.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: table `bookshelf_contacts (id uuid, bookshelf_id uuid, position smallint 1..3, name text not null, phone text, role_label text, created_at, updated_at, deleted_at)`; column `users.phone_missing_reason text`; the removal of `bookshelves.keeper_name`, `bookshelves.keeper_phone`, `bookshelves.opening_hours` and `memberships.leaderboard_opt_in`; `users.saint_name` becomes `not null`.

- [ ] **Step 1: Write the failing schema test**

Append to `tests/db/schema.test.ts`:

```ts
test("bookshelf_contacts holds up to three ordered contacts per shelf", async () => {
  const shelf = await makeShelf(sql);

  await sql`
    insert into bookshelf_contacts (bookshelf_id, position, name, phone, role_label)
    values (${shelf.id}, 1, 'Maria Nguyễn Thị Lan', '0912345678', 'Người giữ chìa khoá')
  `;

  // position is unique per shelf among live rows
  await expect(
    sql`
      insert into bookshelf_contacts (bookshelf_id, position, name)
      values (${shelf.id}, 1, 'Giuse Trần Minh')
    `,
  ).rejects.toMatchObject({ code: "23505" });

  // position is constrained to 1..3
  await expect(
    sql`
      insert into bookshelf_contacts (bookshelf_id, position, name)
      values (${shelf.id}, 4, 'Têrêsa Lê Ngọc Ánh')
    `,
  ).rejects.toMatchObject({ code: "23514" });
});

test("the keeper columns and opening hours are gone from bookshelves", async () => {
  const columns = await sql<{ column_name: string }[]>`
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'bookshelves'
  `;
  const names = columns.map((c) => c.column_name);
  expect(names).not.toContain("keeper_name");
  expect(names).not.toContain("keeper_phone");
  expect(names).not.toContain("opening_hours");
});

test("leaderboard_opt_in is gone from memberships", async () => {
  const columns = await sql<{ column_name: string }[]>`
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'memberships'
  `;
  expect(columns.map((c) => c.column_name)).not.toContain("leaderboard_opt_in");
});

test("saint_name is required and a reason may be recorded for a missing phone", async () => {
  await expect(
    sql`
      insert into users (full_name, father_name, mother_name)
      values ('Anna Phạm Thu Hà', 'Giuse Phạm Văn C', 'Maria Trần Thị D')
    `,
  ).rejects.toMatchObject({ code: "23502" });

  const [row] = await sql<{ phone_missing_reason: string | null }[]>`
    insert into users (saint_name, full_name, father_name, mother_name, phone_missing_reason)
    values ('Anna', 'Anna Phạm Thu Hà', 'Giuse Phạm Văn C', 'Maria Trần Thị D',
            'Em bé chưa có điện thoại, gia đình sẽ bổ sung sau')
    returning phone_missing_reason
  `;
  expect(row.phone_missing_reason).toBe(
    "Em bé chưa có điện thoại, gia đình sẽ bổ sung sau",
  );
});
```

Check the top of the file for how `sql` and `makeShelf` are already imported and reuse those imports rather than adding new ones.

- [ ] **Step 2: Run the tests and watch them fail**

```bash
bun run test tests/db/schema.test.ts
```

Expected: FAIL — `relation "bookshelf_contacts" does not exist`, and the three column assertions fail because the columns are still present.

- [ ] **Step 3: Write the migration**

Create `src/db/migrations/20260812_01_contacts_profile_and_hours.sql`:

```sql
-- Product owner feedback, round one. Design:
-- docs/superpowers/specs/2026-08-12-po-feedback-design.md
--
-- Five changes, one file, because they are one product decision each and a
-- half-applied set would leave the application unable to render a shelf.

-- ── 1. Three contacts per shelf, replacing the single keeper ──────────────
--
-- `position` rather than a free `sort_order`: the product decision is one
-- mandatory contact and two optional ones, and a column constrained to 1..3
-- says so in the schema instead of leaving it to a form. Position 1 is the
-- mandatory one; that it *exists* is a domain rule, not a constraint, because
-- shelves onboarded before this migration may have no keeper at all and
-- inventing a volunteer for them is worse than an incomplete row.
create table bookshelf_contacts (
  id            uuid primary key default gen_random_uuid(),
  bookshelf_id  uuid not null references bookshelves(id) on delete restrict,
  position      smallint not null check (position between 1 and 3),
  name          text not null,
  phone         text,
  role_label    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

-- Soft-delete-aware, the shape 20260808_03 and _09 established for every
-- other uniqueness rule in this schema: a retired contact must not block the
-- position it used to hold.
create unique index bookshelf_contacts_position
  on bookshelf_contacts (bookshelf_id, position)
  where deleted_at is null;

create index bookshelf_contacts_by_shelf
  on bookshelf_contacts (bookshelf_id)
  where deleted_at is null;

-- The same tenant policy 0010_rls.sql applies to every shelf-scoped table.
-- `force`, so the table owner is subject to it too. `nullif(..., '')` because
-- a GUC set with `set_config(..., true)` reverts to '' rather than NULL once
-- its transaction ends — 0010_rls.sql carries the full account.
alter table bookshelf_contacts enable row level security;
alter table bookshelf_contacts force row level security;

create policy bookshelf_contacts_tenant on bookshelf_contacts
  using (bookshelf_id = nullif(current_setting('olibra.bookshelf_id', true), '')::uuid)
  with check (bookshelf_id = nullif(current_setting('olibra.bookshelf_id', true), '')::uuid);

grant select, insert, update on bookshelf_contacts to olibra_app;
grant all on bookshelf_contacts to olibra_admin;

-- **No grant to olibra_public.** BR §16.1: "a person with no membership has
-- no business knowing them." The portal and the two auth screens run as
-- olibra_public, and a role with no privilege fails closed with 42501 rather
-- than relying on a policy somebody remembers to write —
-- 20260809_01_public_role.sql is where that argument was made and won.

create trigger bookshelf_contacts_set_updated_at
  before update on bookshelf_contacts
  for each row execute function set_updated_at();

-- The keeper becomes contact 1. A shelf with no keeper name gets no row and
-- is flagged as incomplete in /quan-tri/tu-sach instead.
insert into bookshelf_contacts (bookshelf_id, position, name, phone, role_label)
select id, 1, keeper_name, keeper_phone, 'Người giữ chìa khoá'
  from bookshelves
 where keeper_name is not null and keeper_name <> '' and deleted_at is null;

alter table bookshelves drop column keeper_name;
alter table bookshelves drop column keeper_phone;

-- ── 2. Opening hours are gone ─────────────────────────────────────────────
alter table bookshelves drop column opening_hours;

-- ── 3. The leaderboard shows everyone ─────────────────────────────────────
alter table memberships drop column leaderboard_opt_in;

-- ── 4. Saint name is required ─────────────────────────────────────────────
--
-- No backfill: the development database is dropped and reseeded, and writing
-- a placeholder saint name into a real parish register is the outcome that
-- decision exists to avoid.
alter table users alter column saint_name set not null;

-- ── 5. Why a phone is missing, when one is ────────────────────────────────
--
-- `phone` stays nullable — some readers are children with no phone, and a
-- placeholder number is a tap that dials a stranger. The interface requires
-- one and takes a typed reason when it is left empty; this is where that
-- reason lives, so the next volunteer to open the record reads why instead of
-- assuming an oversight.
alter table users add column phone_missing_reason text;
```

- [ ] **Step 4: Fix the factory that the NOT NULL breaks**

`tests/support/factories.ts:23-30` inserts a user with no `saint_name`. Change the insert to:

```ts
  const [row] = await sql<{ id: string }[]>`
    insert into users (saint_name, full_name, father_name, mother_name, phone)
    values (
      'Maria',
      ${over.fullName ?? `Người đọc ${next()}`},
      'Giuse Trần Văn A', 'Maria Nguyễn Thị B', '0900000000'
    )
    returning id
  `;
```

- [ ] **Step 5: Run the schema tests**

```bash
bun run test tests/db/schema.test.ts tests/db/migrate.test.ts
```

Expected: PASS. `migrate.test.ts` rebuilds `public` from scratch and re-runs every migration, so it proves the new file is idempotent in the sense that matters — it applies cleanly to an empty schema.

- [ ] **Step 6: Run the schema-wide guards**

```bash
bun run test tests/invariants/rls-policy-completeness.test.ts tests/db/updated-at-trigger.test.ts tests/db/pool-role-privileges.test.ts tests/db/public-role-privileges.test.ts tests/db/bookshelves-public-columns.test.ts
```

Expected: PASS, with no edits to any of them. Both completeness tests derive their expectations from `information_schema`, so the new table is covered automatically — a failure here means the policy, the grant or the trigger above is missing, not that the test is wrong.

- [ ] **Step 7: Commit**

```bash
git add src/db/migrations/20260812_01_contacts_profile_and_hours.sql tests/db/schema.test.ts tests/support/factories.ts
git commit -m "feat: bảng liên hệ tủ sách, tên thánh bắt buộc, bỏ giờ mở cửa"
```

---

## Task 2: Reading and writing contacts in the domain

**Files:**
- Modify: `src/lib/shelf.ts:113-206` (`ShelfIdentity`, `readShelfIdentity`)
- Modify: `src/domain/shelf/queries/get-shelf-settings.ts:70,109,124,148`
- Modify: `src/domain/admin/commands/bookshelves.ts:33,95-100,143,253`
- Test: `tests/domain/admin/shelf-contacts.test.ts` (create)

**Interfaces:**
- Consumes: `bookshelf_contacts` from Task 1.
- Produces:
  ```ts
  // src/lib/shelf.ts
  export interface ShelfContact {
    position: number;      // 1, 2 or 3
    name: string;
    phone: string | null;
    roleLabel: string | null;
  }
  export interface ShelfIdentity {
    name: string;
    location: string | null;
    address: string | null;
    contacts: ShelfContact[];   // ordered by position, may be empty
  }
  export async function readShelfIdentity(tx: Tx, ctx: TenantContext): Promise<ShelfIdentity>;
  ```
  `openingHours`, `keeperName` and `keeperPhone` are **removed** from `ShelfIdentity`. `BookshelfProfile` in `get-shelf-settings.ts` and `bookshelves.ts` gains the same `contacts: ShelfContact[]` and loses the same three fields. `updateBookshelfSettings`'s input takes `contacts: ShelfContact[]`.

- [ ] **Step 1: Write the failing domain test**

Create `tests/domain/admin/shelf-contacts.test.ts`. Model the imports and the `sql`/context helpers on the neighbouring `tests/domain/admin/bookshelf-settings.test.ts` — read that file first and follow its setup exactly.

```ts
test("readShelfIdentity returns contacts in position order", async () => {
  const shelf = await makeShelf(sql);
  await sql`
    insert into bookshelf_contacts (bookshelf_id, position, name, phone, role_label)
    values
      (${shelf.id}, 2, 'Giuse Trần Minh', '0987654321', 'Quản lý tủ sách'),
      (${shelf.id}, 1, 'Maria Nguyễn Thị Lan', '0912345678', 'Người giữ chìa khoá')
  `;

  const identity = await readerTx(shelf, (tx, ctx) => readShelfIdentity(tx, ctx));

  expect(identity.contacts.map((c) => c.position)).toEqual([1, 2]);
  expect(identity.contacts[0].name).toBe("Maria Nguyễn Thị Lan");
  expect(identity.contacts[0].roleLabel).toBe("Người giữ chìa khoá");
  expect(identity.contacts[1].phone).toBe("0987654321");
});

test("a shelf with no contacts reads as an empty list, not a failure", async () => {
  const shelf = await makeShelf(sql);
  const identity = await readerTx(shelf, (tx, ctx) => readShelfIdentity(tx, ctx));
  expect(identity.contacts).toEqual([]);
});

test("a soft-deleted contact is not read", async () => {
  const shelf = await makeShelf(sql);
  await sql`
    insert into bookshelf_contacts (bookshelf_id, position, name, deleted_at)
    values (${shelf.id}, 1, 'Đã nghỉ', now())
  `;
  const identity = await readerTx(shelf, (tx, ctx) => readShelfIdentity(tx, ctx));
  expect(identity.contacts).toEqual([]);
});

test("updateBookshelfSettings replaces the contact list wholesale", async () => {
  const shelf = await makeShelf(sql);

  await adminTx(shelf, (tx, ctx) =>
    updateBookshelfSettings(tx, ctx, {
      bookshelfId: shelf.id,
      profile: {
        name: "Tủ sách Đồng Tháp",
        location: "Nhà xứ Đồng Tháp",
        address: "12 Nguyễn Huệ",
        contacts: [
          { position: 1, name: "Maria Nguyễn Thị Lan", phone: "0912345678", roleLabel: "Người giữ chìa khoá" },
          { position: 2, name: "Giuse Trần Minh", phone: null, roleLabel: null },
        ],
      },
    }),
  );

  // A second save with one contact retires the second, and position 2 is free
  // again — the soft-delete-aware index is what makes that possible.
  await adminTx(shelf, (tx, ctx) =>
    updateBookshelfSettings(tx, ctx, {
      bookshelfId: shelf.id,
      profile: {
        name: "Tủ sách Đồng Tháp",
        location: "Nhà xứ Đồng Tháp",
        address: "12 Nguyễn Huệ",
        contacts: [
          { position: 1, name: "Têrêsa Lê Ngọc Ánh", phone: "0900111222", roleLabel: "Quản lý tủ sách" },
        ],
      },
    }),
  );

  const identity = await readerTx(shelf, (tx, ctx) => readShelfIdentity(tx, ctx));
  expect(identity.contacts).toEqual([
    { position: 1, name: "Têrêsa Lê Ngọc Ánh", phone: "0900111222", roleLabel: "Quản lý tủ sách" },
  ]);
});

test("a contact with a phone and no name is refused", async () => {
  const shelf = await makeShelf(sql);
  await expect(
    adminTx(shelf, (tx, ctx) =>
      updateBookshelfSettings(tx, ctx, {
        bookshelfId: shelf.id,
        profile: {
          name: "Tủ sách Đồng Tháp",
          location: null,
          address: null,
          contacts: [{ position: 1, name: "", phone: "0912345678", roleLabel: null }],
        },
      }),
    ),
  ).rejects.toMatchObject({ code: "contact_name_required" });
});
```

`readerTx` and `adminTx` are whatever the neighbouring test file names its context helpers — use the existing ones rather than inventing these two.

- [ ] **Step 2: Run and watch it fail**

```bash
bun run test tests/domain/admin/shelf-contacts.test.ts
```

Expected: FAIL — `identity.contacts` is undefined, and `updateBookshelfSettings` rejects an unknown `contacts` property at the type level.

- [ ] **Step 3: Rewrite `readShelfIdentity`**

In `src/lib/shelf.ts`, replace the `ShelfIdentity` interface and function body. Keep the existing docstring's disclosure argument — `requireReader` is the whole reason this function exists in `src/lib/` — and update its wording from "keeper_name and keeper_phone" to "the shelf's contacts", noting that they now live in `bookshelf_contacts`, which carries no grant to `olibra_public` at all, so the guard is now a privilege as well as a call.

```ts
export interface ShelfContact {
  /** 1, 2 or 3. Position 1 is the mandatory contact. */
  position: number;
  name: string;
  phone: string | null;
  /** Free text — "Người giữ chìa khoá", "Quản lý tủ sách". A parish names its own jobs. */
  roleLabel: string | null;
}

export interface ShelfIdentity {
  name: string;
  location: string | null;
  address: string | null;
  /** Ordered by position. Empty for a shelf onboarded before anyone filled it in. */
  contacts: ShelfContact[];
}

export async function readShelfIdentity(
  tx: Tx,
  ctx: TenantContext,
): Promise<ShelfIdentity> {
  requireReader(ctx);

  const [row] = await tx<
    { name: string; location: string | null; address: string | null }[]
  >`
    select name, location, address
    from bookshelves
    where id = ${ctx.bookshelfId}
  `;
  if (!row) throw new NotFound("shelf_not_found");

  const contacts = await tx<
    {
      position: number;
      name: string;
      phone: string | null;
      role_label: string | null;
    }[]
  >`
    select position, name, phone, role_label
      from bookshelf_contacts
     where bookshelf_id = ${ctx.bookshelfId} and deleted_at is null
     order by position
  `;

  return {
    name: row.name,
    location: row.location,
    address: row.address,
    contacts: contacts.map((c) => ({
      position: Number(c.position),
      name: c.name,
      phone: c.phone,
      roleLabel: c.role_label,
    })),
  };
}
```

`Number(c.position)` because `smallint` arrives as a number from postgres.js but the cast documents the intent and costs nothing — the same defensive shape `getBookDetail` uses on its counts.

- [ ] **Step 4: Update `get-shelf-settings.ts`**

Drop `openingHours`, `keeperName` and `keeperPhone` from `BookshelfProfile` and from the `select`; add `contacts: ShelfContact[]` read the same way as above. Import the type from `@/lib/shelf` — or, if that direction of import is wrong for the domain layer (check `tests/architecture/boundaries.test.ts` first, which is the file that decides), declare `ShelfContact` in the domain and have `src/lib/shelf.ts` import it from there instead. **Read that boundary test before choosing.**

- [ ] **Step 5: Update `bookshelves.ts`**

- `CreateBookshelfInput` and `UpdateBookshelfSettingsInput`: replace `openingHours`/`keeperName`/`keeperPhone` with `contacts: ShelfContact[]`.
- The insert at line ~95 drops the three columns.
- `updateBookshelfSettings` (line ~253) drops `opening_hours = …` and, after the `bookshelves` update, replaces the contact set:

```ts
  // Wholesale replacement rather than a diff: the admin form posts all three
  // blocks every time, so "what the form said" is the complete truth about
  // this shelf's contacts. Soft-delete first, then insert, so the
  // `bookshelf_contacts_position` partial index sees the old rows as dead
  // before the new ones claim the same positions.
  await tx`
    update bookshelf_contacts set deleted_at = ${ctx.clock.now()}
     where bookshelf_id = ${input.bookshelfId} and deleted_at is null
  `;
  for (const contact of input.profile.contacts) {
    if (contact.name.trim() === "") {
      throw new ValidationFailed("contact_name_required", `contact_${contact.position}`);
    }
    await tx`
      insert into bookshelf_contacts (bookshelf_id, position, name, phone, role_label)
      values (${input.bookshelfId}, ${contact.position}, ${contact.name.trim()},
              ${contact.phone}, ${contact.roleLabel})
    `;
  }
```

Use `ctx.clock.now()`, never SQL `now()` — DATABASE.md §6, two clocks in one transaction, and the domain means this one. Check how `ValidationFailed` is constructed elsewhere in this file and match its argument order.

The audit entry this command already writes must carry the contacts in its `before`/`after` bags alongside the other profile fields — follow whatever shape the existing call uses.

- [ ] **Step 6: Run the tests**

```bash
bun run test tests/domain/admin/shelf-contacts.test.ts tests/domain/admin/bookshelf-settings.test.ts tests/domain/shelf/shelf-settings.test.ts
```

Expected: PASS. Existing tests that assert on `keeperName`/`openingHours` fail here — update them to the new shape; that is the point of this step, not collateral damage.

- [ ] **Step 7: Typecheck**

```bash
bun run typecheck
```

Expected: errors in every page still reading the removed fields. **Do not fix them here** — Tasks 3, 4 and 11 own those pages. Note the list; it is the work queue for the next three tasks.

- [ ] **Step 8: Commit**

```bash
git add src/lib/shelf.ts src/domain tests/domain
git commit -m "feat: đọc và ghi danh sách người liên hệ của tủ sách"
```

---

## Task 3: The admin and manager shelf screens

**Files:**
- Modify: `src/app/quan-tri/tu-sach/page.tsx:255-275, 360-380`
- Modify: `src/app/quan-tri/admin-actions.ts:155-200`
- Modify: `src/app/tu-sach/[shelf]/quan-ly/cai-dat/page.tsx:175-200`
- Test: `tests/lib/admin-actions.test.ts`

**Interfaces:**
- Consumes: `updateBookshelfSettings`'s `contacts: ShelfContact[]` from Task 2.
- Produces: form field names `lien-he-1-ten`, `lien-he-1-sdt`, `lien-he-1-vai-tro`, and the same triple for `2` and `3`; an exported helper `contactsFromForm(form: FormData): ShelfContact[]` in `admin-actions.ts` so both the create and the update action parse them the same way.

- [ ] **Step 1: Write the failing action test**

Add to `tests/lib/admin-actions.test.ts`, matching how that file already imports and exercises the module:

```ts
test("contactsFromForm reads three blocks and drops the empty ones", () => {
  const form = new FormData();
  form.set("lien-he-1-ten", "Maria Nguyễn Thị Lan");
  form.set("lien-he-1-sdt", "0912345678");
  form.set("lien-he-1-vai-tro", "Người giữ chìa khoá");
  form.set("lien-he-2-ten", "  ");
  form.set("lien-he-2-sdt", "");
  form.set("lien-he-3-ten", "Giuse Trần Minh");
  form.set("lien-he-3-sdt", "0987654321");

  expect(contactsFromForm(form)).toEqual([
    {
      position: 1,
      name: "Maria Nguyễn Thị Lan",
      phone: "0912345678",
      roleLabel: "Người giữ chìa khoá",
    },
    // Block 3's contact keeps position 3. Renumbering it to 2 would silently
    // move a volunteer a super admin deliberately left in the third slot.
    { position: 3, name: "Giuse Trần Minh", phone: "0987654321", roleLabel: null },
  ]);
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
bun run test tests/lib/admin-actions.test.ts
```

Expected: FAIL — `contactsFromForm is not exported`.

- [ ] **Step 3: Implement `contactsFromForm`**

In `src/app/quan-tri/admin-actions.ts`, beside the existing `optional(form, …)` helper:

```ts
/**
 * The three contact blocks both shelf forms post, as the domain's list.
 *
 * A block with no name is not a contact — an empty block is how a super admin
 * says "there is no third volunteer", and a phone with nobody attached to it
 * is a number nobody can be asked for. The domain refuses a whitespace-only
 * name (`contact_name_required`) for the case where a name *was* typed and is
 * blank; this filter is for the ordinary empty block, which is not an error.
 *
 * Positions are kept, not compacted: a contact left in block 3 stays at
 * position 3, because moving them would change what the reader's accordion
 * shows without anybody asking for it.
 */
export function contactsFromForm(form: FormData): ShelfContact[] {
  return [1, 2, 3].flatMap((position) => {
    const name = (optional(form, `lien-he-${position}-ten`) ?? "").trim();
    if (name === "") return [];
    return [
      {
        position,
        name,
        phone: optional(form, `lien-he-${position}-sdt`),
        roleLabel: optional(form, `lien-he-${position}-vai-tro`),
      },
    ];
  });
}
```

Check what `optional` returns for an empty field — if it returns `""` rather than `null`, normalise here so `phone` is `null` rather than an empty string; an empty string in that column becomes a `PhoneLink` to nothing.

Then replace `openingHours: optional(form, "gio-mo-cua")` at lines 160 and 191 with `contacts: contactsFromForm(form)`.

- [ ] **Step 4: Rewrite the two forms**

In `src/app/quan-tri/tu-sach/page.tsx`, delete both *Giờ mở cửa* fields (lines ~261 and ~367) and add three contact blocks to each form. Single-column, labels above inputs (AGENTS.md rule 6). For the create form:

```tsx
<fieldset className="mt-6 space-y-6 border-t border-hairline pt-6">
  <legend className="text-[16px] font-semibold">Người liên hệ</legend>
  <p className="text-[14px] text-meta">
    Người liên hệ thứ nhất là bắt buộc. Hai người sau có thể để trống.
  </p>

  <Field label="Họ tên người liên hệ 1" htmlFor="lien-he-1-ten" required>
    <Input id="lien-he-1-ten" name="lien-he-1-ten" required />
  </Field>
  <Field label="Số điện thoại người liên hệ 1" htmlFor="lien-he-1-sdt">
    <Input id="lien-he-1-sdt" name="lien-he-1-sdt" type="tel" inputMode="tel" />
  </Field>
  <Field label="Vai trò người liên hệ 1" htmlFor="lien-he-1-vai-tro">
    <Input
      id="lien-he-1-vai-tro"
      name="lien-he-1-vai-tro"
      placeholder="Người giữ chìa khoá"
    />
  </Field>
  {/* blocks 2 and 3 repeat, with no `required` and the label ending "2" / "3" */}
</fieldset>
```

Check how `Field` marks a required field before passing `required` — AGENTS.md rule 6 says the marker is the word *Bắt buộc*, and `Field` may take a different prop name for it. Read `src/components/ui/field.tsx` and use what is there.

The edit form is the same three blocks with `defaultValue` from `selected.profile.contacts.find((c) => c.position === n)`. Ids on the edit form must not collide with the create form's — follow whatever suffixing that page already does (the create form's ids end `-moi`).

Add an incomplete marker to the shelf list on that page: a shelf whose `contacts` is empty renders a `Pill` reading **Chưa có người liên hệ** with a warning icon, so the shelves the migration could not backfill are visible.

- [ ] **Step 5: Update the manager's read-only view**

In `src/app/tu-sach/[shelf]/quan-ly/cai-dat/page.tsx`, delete the *Giờ mở cửa* `InfoRow` (line ~180) and replace the *Người giữ chìa khoá* row (line ~183) with one row per contact:

```tsx
{profile.contacts.length === 0 ? (
  <InfoRow label="Người liên hệ">Chưa có</InfoRow>
) : (
  profile.contacts.map((contact) => (
    <InfoRow key={contact.position} label={contact.roleLabel ?? "Người liên hệ"}>
      <span className="flex flex-wrap items-center gap-x-2">
        {contact.name}
        {contact.phone ? <PhoneLink phone={contact.phone} size="sm" /> : null}
      </span>
    </InfoRow>
  ))
)}
```

- [ ] **Step 6: Run the tests and typecheck**

```bash
bun run test tests/lib/admin-actions.test.ts && bun run typecheck
```

Expected: the action test passes; typecheck still reports the reader pages, which Tasks 4 and 11 own.

- [ ] **Step 7: Commit**

```bash
git add src/app/quan-tri src/app/tu-sach/\[shelf\]/quan-ly/cai-dat tests/lib/admin-actions.test.ts
git commit -m "feat: quản trị viên nhập ba người liên hệ cho tủ sách"
```

---

## Task 4: The contacts accordion and the new shelf home

**Files:**
- Create: `src/components/ui/contact-list.tsx`
- Create: `tests/components/contact-list.test.tsx`
- Modify: `src/app/tu-sach/[shelf]/(doc-gia)/page.tsx` (substantially rewritten)

**Interfaces:**
- Consumes: `ShelfContact` and `ShelfIdentity.contacts` from Task 2; `getAnnouncements` from `src/domain/community/queries/get-announcements.ts`, which already returns `is_pinned` first in its ordering.
- Produces: `export function ContactList({ contacts }: { contacts: readonly ShelfContact[] })`.

- [ ] **Step 1: Write the failing component test**

Create `tests/components/contact-list.test.tsx`. Follow `tests/components/phone-link.test.tsx` for how this suite renders a server component — read it first and copy its harness exactly; do not introduce a new rendering approach.

```tsx
test("a single contact renders with no disclosure control", () => {
  const html = render(
    <ContactList
      contacts={[
        { position: 1, name: "Maria Nguyễn Thị Lan", phone: "0912345678", roleLabel: "Người giữ chìa khoá" },
      ]}
    />,
  );
  expect(html).toContain("Maria Nguyễn Thị Lan");
  expect(html).toContain("Người giữ chìa khoá");
  expect(html).not.toContain("<summary");
});

test("two extra contacts sit behind a summary that counts them", () => {
  const html = render(
    <ContactList
      contacts={[
        { position: 1, name: "Maria Nguyễn Thị Lan", phone: "0912345678", roleLabel: null },
        { position: 2, name: "Giuse Trần Minh", phone: null, roleLabel: "Quản lý tủ sách" },
        { position: 3, name: "Têrêsa Lê Ngọc Ánh", phone: "0900111222", roleLabel: null },
      ]}
    />,
  );
  expect(html).toContain("Xem thêm 2 người liên hệ");
  expect(html).toContain("Têrêsa Lê Ngọc Ánh");
});

test("one extra contact says one, not two", () => {
  const html = render(
    <ContactList
      contacts={[
        { position: 1, name: "Maria Nguyễn Thị Lan", phone: null, roleLabel: null },
        { position: 2, name: "Giuse Trần Minh", phone: null, roleLabel: null },
      ]}
    />,
  );
  expect(html).toContain("Xem thêm 1 người liên hệ");
});

test("no contacts renders nothing at all", () => {
  expect(render(<ContactList contacts={[]} />)).toBe("");
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
bun run test tests/components/contact-list.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write `ContactList`**

Create `src/components/ui/contact-list.tsx`. Import `PhoneLink` **relatively** (`../ui/phone-link` style, matching this file's own location) — `vitest.config.ts` declares no `@/` alias, and an alias import makes the component unimportable under Vitest. `public-header.tsx:9` carries the same note for the same reason.

```tsx
/**
 * A shelf's contacts, as a reader sees them.
 *
 * Contact 1 is always visible; the rest sit behind a `<details>` summary.
 * `<details>`/`<summary>` rather than a client component with state, because
 * every page rendering this is a server component with no JavaScript —
 * `MobileMenu` in `shell/public-header.tsx` is built the same way for the
 * same reason.
 *
 * Empty renders nothing. A shelf onboarded before anyone filled in a
 * volunteer has no contacts, and a panel headed "Người liên hệ" over the word
 * "Chưa có" is a row of chrome telling a reader they cannot be helped — the
 * shelf home's own rule that every row is conditional on the column behind it.
 */
export function ContactList({ contacts }: { contacts: readonly ShelfContact[] }) {
  if (contacts.length === 0) return null;
  const [first, ...rest] = [...contacts].sort((a, b) => a.position - b.position);

  return (
    <div>
      <ContactRow contact={first} />
      {rest.length > 0 ? (
        <details className="mt-3 [&_svg]:open:rotate-90">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-[15px] text-leather [&::-webkit-details-marker]:hidden">
            <ChevronRight aria-hidden className="size-5 transition-transform duration-150" strokeWidth={1.75} />
            Xem thêm {rest.length} người liên hệ
          </summary>
          <div className="mt-3 space-y-4 border-t border-hairline pt-3">
            {rest.map((contact) => (
              <ContactRow key={contact.position} contact={contact} />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function ContactRow({ contact }: { contact: ShelfContact }) {
  return (
    <div className="flex gap-3">
      <UserRound aria-hidden className="mt-1 size-5 shrink-0 text-leather" strokeWidth={1.75} />
      <div>
        <p className="text-[14px] text-meta">{contact.roleLabel ?? "Người liên hệ"}</p>
        <p className="text-[16px]">{contact.name}</p>
        {contact.phone ? (
          <p className="mt-0.5">
            <PhoneLink phone={contact.phone} size="md" />
          </p>
        ) : null}
      </div>
    </div>
  );
}
```

`UserRound` and `ChevronRight` from `lucide-react`, outline style. Check `src/lib/status.ts` first: if either icon is already one of the six copy-state icons, pick a different one — an icon that means a status elsewhere must not appear here meaning a person. `public-header.tsx`'s own note about `BookOpen`/`BookMarked` is the precedent.

- [ ] **Step 4: Run the component tests**

```bash
bun run test tests/components/contact-list.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Rewrite the shelf home**

In `src/app/tu-sach/[shelf]/(doc-gia)/page.tsx`:

- Add the announcement read to the existing `loadPage` call:
  ```ts
  announcements: await getAnnouncements(tx, ctx, { limit: 1 }),
  ```
  Read `get-announcements.ts:34` first for the real parameter shape — pass what it actually takes. It already orders `is_pinned desc, published_at desc`, so the first row *is* the pinned one when there is one and the newest otherwise. That is exactly §2's requirement and it needs no new query.
- Replace the identity `Card` (lines 158-233) with:
  ```tsx
  <Card className="p-6">
    <ContactList contacts={shelf.contacts} />
  </Card>
  ```
  and drop the `Card` entirely when `shelf.contacts.length === 0` — no empty panel. The `<h1>` goes: the shelf name is in the topbar three lines above, which is the defect being fixed. **Check `tests/architecture/every-page-has-a-title.test.ts` before removing the `<h1>`** — if it requires a visible heading per page, keep an `sr-only` `<h1>` carrying `shelf.name` so the document still announces itself.
- The announcement card, above the catalogue link, absent when there are none:
  ```tsx
  {announcement ? (
    <Card className="mt-8 p-6">
      <div className="flex items-center gap-2">
        {announcement.isPinned ? <Pill icon={Pin} label="Ghim" /> : null}
        <span className="text-[14px] text-meta">Bản tin</span>
      </div>
      <h2 className="mt-2 text-[20px] font-semibold">{announcement.title}</h2>
      <p className="mt-2 line-clamp-3 text-[16px]">{announcement.bodyText}</p>
      <Link href={`${base}/thong-bao/${announcement.slug}`} className="mt-3 inline-flex min-h-11 items-center text-[15px] text-leather">
        Đọc tiếp
      </Link>
    </Card>
  ) : null}
  ```
  Match the field names to what the query actually returns (`isPinned`/`is_pinned`, `bodyText`/`body_text`) — read `AnnouncementRow` at `get-announcements.ts:5`.
- Replace the two `BigActionLink`s with one:
  ```tsx
  <div className="mt-8">
    <BigActionLink
      href={`${base}/danh-muc`}
      icon={Library}
      label="Xem toàn bộ tủ sách"
      sublabel={`${NUMBER.format(all.total)} đầu sách · ${NUMBER.format(available.total)} có thể mượn hôm nay`}
      variant="primary"
    />
  </div>
  ```
  Both counts are already read — `available` and `recent` in the existing `loadPage` call; rename `recent` if the second read is now serving two purposes, or keep both reads as they are and use `recent.total`.
- Add the two secondary cards below it:
  ```tsx
  <div className="mt-4 flex flex-col gap-4 sm:flex-row">
    <BigActionLink href={`${base}/tang-sach`} icon={HeartHandshake} label="Tặng sách" sublabel="Góp sách cho tủ sách của giáo xứ" variant="outline" />
    <BigActionLink href={`${base}/gop-y`} icon={MessageSquare} label="Góp ý" sublabel="Gửi ý kiến cho ban quản trị" variant="outline" />
  </div>
  ```
  Both routes exist and are wired. Verify that before shipping the links — `tests/architecture/a-wired-page-renders-no-fixtures.test.ts` is the check, and the fixture-era version of this page shipped exactly these two links pointing at unwired pages.
- Keep the *Mới thêm* cover row unchanged.
- Delete the long docstring paragraphs about items 2, 4, 5 and 7 being absent, and replace them with a short note recording what this page now shows and why the identity block shrank. A docstring arguing for an arrangement the page no longer has is worse than none.

Exactly one solid terracotta on the page: the catalogue link. The two cards are `variant="outline"`.

- [ ] **Step 6: Verify in the browser**

Start the dev server through the preview tool (never `bun run dev` in Bash), then check the shelf home at 375px and at 1280px: the contact accordion opens and closes with no JavaScript errors, the page body does not scroll sideways, and the primary action is the only terracotta element.

- [ ] **Step 7: Run the full suite**

```bash
bun run test
```

Expected: PASS except for tests owned by later tasks (the header, the book pages). Note which, and do not paper over them.

- [ ] **Step 8: Commit**

```bash
git add src/components/ui/contact-list.tsx tests/components/contact-list.test.tsx "src/app/tu-sach/[shelf]/(doc-gia)/page.tsx"
git commit -m "feat: trang chủ tủ sách gọn lại, chỉ còn thông tin liên hệ"
```

---

## Task 5: The topbar — search, avatar panel, management links

**Files:**
- Modify: `src/components/shell/public-header.tsx`
- Modify: every page rendering `ShelfHeader` (pass the two new props)
- Test: `tests/components/public-header.test.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `ShelfHeader` gains `canManage: boolean` and `isSuperAdmin: boolean`, both **required**. The `active` union is unchanged. `MobileMenu` gains a `viewerName: string` prop and renders the profile block.

- [ ] **Step 1: Write the failing header tests**

Add to `tests/components/public-header.test.tsx`, following its existing render helper:

```tsx
test("Danh mục is no longer in the reader nav", () => {
  const html = renderShelfHeader({ viewerName: "Maria Nguyễn Thị Lan", canManage: false, isSuperAdmin: false });
  expect(html).not.toContain("Danh mục");
  expect(html).toContain("Bản tin");
  expect(html).toContain("Tìm kiếm");
});

test("a manager gets a link into the manager area", () => {
  const html = renderShelfHeader({ viewerName: "Giuse Trần Minh", canManage: true, isSuperAdmin: false });
  expect(html).toContain("Quản lý tủ sách");
  expect(html).toContain("/tu-sach/dong-thap/quan-ly");
  expect(html).not.toContain("Quản trị hệ thống");
});

test("a super admin also gets the system admin link", () => {
  const html = renderShelfHeader({ viewerName: "Quản trị viên", canManage: true, isSuperAdmin: true });
  expect(html).toContain("Quản trị hệ thống");
  expect(html).toContain('href="/quan-tri"');
});

test("an ordinary reader gets neither management link", () => {
  const html = renderShelfHeader({ viewerName: "Anna Phạm Thu Hà", canManage: false, isSuperAdmin: false });
  expect(html).not.toContain("Quản lý tủ sách");
  expect(html).not.toContain("Quản trị hệ thống");
});

test("the mobile search form posts into the search page", () => {
  const html = renderShelfHeader({ viewerName: "Maria Nguyễn Thị Lan", canManage: false, isSuperAdmin: false });
  expect(html).toContain('action="/tu-sach/dong-thap/tim-kiem"');
  expect(html).toContain('name="q"');
});

test("the mobile panel offers the profile page under the reader's name", () => {
  const html = renderShelfHeader({ viewerName: "Maria Nguyễn Thị Lan", canManage: false, isSuperAdmin: false });
  expect(html).toContain("/ho-so/tong-quan");
  expect(html).toContain("Trang của tôi");
});

test("a signed-out visitor gets no search box and no panel", () => {
  const html = renderShelfHeader({ viewerName: null, canManage: false, isSuperAdmin: false });
  expect(html).not.toContain('name="q"');
  expect(html).toContain("Đăng nhập");
});
```

`renderShelfHeader` is whatever helper that file already uses; extend its argument type rather than writing a second helper.

- [ ] **Step 2: Run and watch it fail**

```bash
bun run test tests/components/public-header.test.tsx
```

Expected: FAIL — `canManage` is not a prop, `Danh mục` is still present.

- [ ] **Step 3: Change `ShelfHeader`**

- Remove the `danh-muc` entry from `links`. Leave `"danh-muc"` in the `active` union — `/danh-muc` still passes it and removing it is a compile error for no gain.
- Add the two management links after the reader links, built the way `FrontDoorHeader` builds its conditional `/quan-tri` entry:
  ```ts
  const managementLinks = [
    ...(canManage
      ? [{ href: `${base}/quan-ly`, label: "Quản lý tủ sách", key: "quan-ly" }]
      : []),
    ...(isSuperAdmin
      ? [{ href: "/quan-tri", label: "Quản trị hệ thống", key: "quan-tri" }]
      : []),
  ];
  ```
  Render them in the desktop `<nav>` after a `<span aria-hidden className="mx-2 h-6 w-px bg-hairline" />` separator, as plain links — not `ButtonLink`s. `FrontDoorHeader`'s docstring already argues why.
- Add the mobile search row, below `md` only, inside the `<header>` and below the existing flex row:
  ```tsx
  {viewerName !== null ? (
    <form
      method="get"
      action={`${base}/tim-kiem`}
      className="mx-auto flex max-w-6xl items-center gap-2 px-6 pb-3 md:hidden"
    >
      <label htmlFor="tim-kiem-tren-thanh" className="sr-only">
        Tìm sách trong tủ
      </label>
      <input
        id="tim-kiem-tren-thanh"
        name="q"
        type="search"
        placeholder="Tìm sách trong tủ"
        className="min-h-11 flex-1 rounded-control border border-hairline bg-surface px-3 text-[16px]"
      />
      <button
        type="submit"
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-control text-leather hover:bg-surface"
      >
        <span className="sr-only">Tìm</span>
        <Search aria-hidden className="size-5" strokeWidth={1.75} />
      </button>
    </form>
  ) : null}
  ```
  `text-[16px]` on the input is deliberate: iOS Safari zooms the viewport on focus for anything smaller.

  Check `src/components/ui/field.tsx` for an existing `Input` first. If it fits a bare form like this, use it rather than a hand-rolled `<input>` — AGENTS.md's rule about looking in `src/components/ui` first applies here.

- [ ] **Step 4: Turn `MobileMenu` into the profile panel**

The `<summary>` becomes the avatar; the panel gains a heading block:

```tsx
<summary className="flex size-11 cursor-pointer list-none items-center justify-center rounded-control hover:bg-surface [&::-webkit-details-marker]:hidden">
  <span className="sr-only">Mở menu</span>
  <span
    aria-hidden
    className="flex size-8 items-center justify-center rounded-full bg-surface text-[14px] font-semibold text-leather"
  >
    {viewerName.split(" ").at(-1)?.charAt(0)}
  </span>
</summary>
```

and, first inside the panel:

```tsx
<Link
  href={profileHref}
  className="flex min-h-11 items-center gap-3 rounded-control px-3 py-2 hover:bg-paper"
>
  <span
    aria-hidden
    className="flex size-9 shrink-0 items-center justify-center rounded-full bg-paper text-[15px] font-semibold text-leather"
  >
    {viewerName.split(" ").at(-1)?.charAt(0)}
  </span>
  <span className="min-w-0">
    <span className="block truncate text-[15px] font-semibold">{viewerName}</span>
    <span className="block text-[14px] text-meta">Trang của tôi</span>
  </span>
</Link>
<span aria-hidden className="my-2 block h-px bg-hairline" />
```

The last word of a Vietnamese name is the given name — "Maria Nguyễn Thị Lan" initials as L. That rule is already written at `public-header.tsx:88`; do not re-derive it, and factor the initial into one small helper used by both `SignedInIdentity` and this panel rather than a third copy.

`MobileMenu` is shared with `FrontDoorHeader`, which renders it for a signed-in visitor with no shelf. Make `viewerName` and `profileHref` optional there — when either is absent, the panel keeps its current hamburger `<summary>` and no profile block. A front-door visitor has no shelf profile page to link to.

- [ ] **Step 5: Pass the new props from every caller**

`bun run typecheck` lists them. For each page, resolve the two booleans from the `Viewer` that page already has via `loadPage`. If `Viewer` carries no role today, add it in `src/lib/page-data.ts`'s `viewerFor` — that is the seam whose whole job is answering this, and `public-header.tsx` must not import from it.

`canManage` is `atLeast(role, "manager")`; `isSuperAdmin` is the super-admin flag the guards already resolve. Use the existing helpers in `src/domain/kernel/tenant.ts` and `src/auth/guards.ts`; do not compare role strings by hand.

- [ ] **Step 6: Run the tests and typecheck**

```bash
bun run test tests/components/public-header.test.tsx && bun run typecheck
```

Expected: PASS, and typecheck clean of header-related errors.

- [ ] **Step 7: Verify at 375px in the browser**

Confirm: the search row is present and usable, tapping the avatar opens the panel, the profile block links to `/ho-so/tong-quan`, and there is no horizontal scroll. Take a screenshot of the open panel.

- [ ] **Step 8: Commit**

```bash
git add src/components/shell/public-header.tsx src/lib/page-data.ts src/app tests/components/public-header.test.tsx
git commit -m "feat: ô tìm kiếm, ảnh đại diện và lối vào trang quản lý trên thanh trên cùng"
```

---

## Task 6: The leaderboard shows everyone

**Files:**
- Modify: `src/domain/shelf/queries/get-statistics.ts:160-190`
- Modify: `src/domain/members/commands/update-own-profile.ts:28,75-103`
- Modify: `src/domain/members/queries/get-my-profile.ts:95-124`
- Modify: `src/domain/members/queries/get-reader-detail.ts:121-211`
- Modify: `src/domain/kernel/audit-actions.ts:446`
- Modify: `src/app/tu-sach/[shelf]/quan-ly/thong-ke/page.tsx:375-380`
- Modify: `src/app/tu-sach/[shelf]/(doc-gia)/ho-so/page.tsx` (the toggle)
- Test: `tests/domain/shelf/statistics.test.ts:155`, `tests/domain/members/own-profile-and-queue.test.ts:56`

**Interfaces:**
- Consumes: the dropped column from Task 1.
- Produces: `leaderboardOptIn` is gone from `MyProfile`, `ReaderDetail` and `UpdateOwnProfileInput`.

- [ ] **Step 1: Rewrite the failing statistics test**

`tests/domain/shelf/statistics.test.ts:155` currently sets `leaderboard_opt_in = false` and asserts the reader is absent. Replace that test with its inverse:

```ts
test("every borrower appears in the leaderboard", async () => {
  // …the same setup the previous test used, minus the update that turned the
  // opt-in off…
  const stats = await managerTx(shelf, (tx, ctx) => getStatistics(tx, ctx, { period: "30" }));
  expect(stats.topReaders.map((r) => r.name)).toContain(shy.name);
});
```

Keep the surrounding setup exactly as it was — only the opt-out `update` and the negative assertion change.

- [ ] **Step 2: Run and watch it fail**

```bash
bun run test tests/domain/shelf/statistics.test.ts
```

Expected: FAIL — `column "leaderboard_opt_in" does not exist` from the test's own `update`, then from the query.

- [ ] **Step 3: Remove the column from the query and the domain**

- `get-statistics.ts:184`: delete `and m.leaderboard_opt_in`. Rewrite the long docstring at line 160 — it argues at length for a promise the product has withdrawn. Replace it with a short note saying the list counts every borrower, that the screen is manager-facing, and that a manager can already see every loan through the lending screens and the audit log, which is why nothing is disclosed here that was not already reachable. Cite the spec by path.
- `update-own-profile.ts`: remove `leaderboardOptIn` from the input, the read at line 75, the no-op comparison at line 82, the update at line 88 and the audit bags at 102-103. If the command has nothing left to do once it goes, **stop and report that** rather than deleting the command — check what else it writes first.
- `get-my-profile.ts` and `get-reader-detail.ts`: drop the column from the row types, the `select`s and the returned objects.
- `audit-actions.ts:446`: remove the `leaderboard_opt_in` flag formatter.

- [ ] **Step 4: Remove the two surfaces**

- `thong-ke/page.tsx:375-380`: delete the footnote about readers who turned the setting off.
- The reader's profile page: delete the toggle and its label *"Hiện tên bạn trong bảng bạn đọc chăm nhất…"*, and its form field.

- [ ] **Step 5: Fix `own-profile-and-queue.test.ts`**

Line 56 reads the column directly. Remove that helper and any assertion depending on it.

- [ ] **Step 6: Run the tests**

```bash
bun run test tests/domain/shelf tests/domain/members && bun run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/domain src/app tests/domain
git commit -m "feat: bảng bạn đọc chăm nhất hiện đủ mọi người"
```

---

## Task 7: Saint name required, and a reason for a missing phone

**Files:**
- Modify: `src/domain/members/profile-fields.ts:60-95, 230-250`
- Modify: `src/app/dang-ky/actions.ts:68`
- Modify: `src/app/dang-ky/page.tsx:229`
- Modify: `src/app/tu-sach/[shelf]/quan-ly/actions.ts:736, 1450`
- Modify: `src/app/tu-sach/[shelf]/quan-ly/nguoi-doc/moi/page.tsx:174`
- Modify: `src/app/tu-sach/[shelf]/quan-ly/nguoi-doc/[id]/page.tsx:416`
- Modify: `src/app/tu-sach/[shelf]/(doc-gia)/ho-so/page.tsx:218`
- Modify: `src/db/seed.ts`
- Test: `tests/domain/members/profile-fields.test.ts`

**Interfaces:**
- Consumes: the NOT NULL column and `phone_missing_reason` from Task 1.
- Produces: `REQUIRED_PROFILE_FIELDS` includes `"saint_name"`; `PROFILE_FIELDS` gains `"phone_missing_reason"` so it travels through proposals and audit bags like any other field; `profileLabels` gains **Lý do chưa có số điện thoại**.

- [ ] **Step 1: Write the failing domain test**

```ts
test("clearing a saint name is refused by name, not by the driver", async () => {
  const { membershipId } = await aReaderWithAProfile();
  await expect(
    managerTx((tx, ctx) =>
      updateReaderProfile(tx, ctx, { membershipId, fields: { saint_name: null } }),
    ),
  ).rejects.toMatchObject({ code: "required_fields_missing", detail: "saint_name" });
});

test("a reason may be recorded when the phone is left empty", async () => {
  const { membershipId, userId } = await aReaderWithAProfile();
  await managerTx((tx, ctx) =>
    updateReaderProfile(tx, ctx, {
      membershipId,
      fields: {
        phone: null,
        phone_missing_reason: "Em bé chưa có điện thoại, mẹ sẽ bổ sung sau",
      },
    }),
  );
  const [row] = await sql`select phone, phone_missing_reason from users where id = ${userId}`;
  expect(row.phone).toBeNull();
  expect(row.phone_missing_reason).toBe("Em bé chưa có điện thoại, mẹ sẽ bổ sung sau");
});

test("giving a phone clears the reason it was missing", async () => {
  const { membershipId, userId } = await aReaderWithAProfile();
  await managerTx((tx, ctx) =>
    updateReaderProfile(tx, ctx, {
      membershipId,
      fields: { phone: null, phone_missing_reason: "Chưa có" },
    }),
  );
  await managerTx((tx, ctx) =>
    updateReaderProfile(tx, ctx, { membershipId, fields: { phone: "0912345678" } }),
  );
  const [row] = await sql`select phone_missing_reason from users where id = ${userId}`;
  expect(row.phone_missing_reason).toBeNull();
});
```

`aReaderWithAProfile`, `managerTx` and the command's real name come from the existing tests in `tests/domain/members/` — read `profile-fields.test.ts` and `update-reader-profile.test.ts` and reuse their helpers.

- [ ] **Step 2: Run and watch it fail**

```bash
bun run test tests/domain/members/profile-fields.test.ts
```

Expected: FAIL — the first clears `saint_name` without complaint; the other two reject an unknown field.

- [ ] **Step 3: Change `profile-fields.ts`**

- Add `"phone_missing_reason"` to `PROFILE_FIELDS`.
- Add `"saint_name"` to `REQUIRED_PROFILE_FIELDS` and update that constant's docstring — it currently says the three are "the three that are `not null` on the table" and names `saint_name` among the nullable ones. Both halves are now wrong.
- In the update SQL (around line 362), clear the reason whenever a phone arrives non-null:
  ```sql
  phone_missing_reason = case
    when ${has("phone")} and ${val("phone")} is not null then null
    when ${has("phone_missing_reason")} then ${val("phone_missing_reason")}
    else prev.phone_missing_reason end,
  ```
  Match the exact `has`/`val` helper shapes already used in that statement rather than copying this verbatim — the surrounding lines are the authority on the spelling.
- Add the field to the `select` lists at lines ~350, ~382 and ~472 so the before/after audit bags carry it.

- [ ] **Step 4: Add the label**

`src/lib/profile-labels.ts:35` — add `phone_missing_reason: "Lý do chưa có số điện thoại"`. `tests/lib/profile-labels.test.ts` likely asserts every `ProfileField` has a label; if it does, it now passes for the new field automatically.

- [ ] **Step 5: Make the four forms require the two fields**

For each of `dang-ky/page.tsx:229`, `nguoi-doc/moi/page.tsx:174`, `nguoi-doc/[id]/page.tsx:416` and `ho-so/page.tsx:218`: mark *Tên thánh* required in the way `Field` expresses it (the word *Bắt buộc*, never an asterisk), and add `required` to its `Input`. Mark *Số điện thoại* the same way — the form requires it even though the column does not; Task 8 supplies what happens when it is left empty anyway.

In the corresponding actions (`dang-ky/actions.ts:68`, `quan-ly/actions.ts:736` and `:1450`), change `optional(form, "ten-thanh")` to the required reader — check what that helper is called in each file (`required`, `value`, or similar) and use it.

- [ ] **Step 6: Update the seed**

`src/db/seed.ts` must supply a saint name for every user it inserts, and contact rows for the shelf it creates instead of `keeper_name`/`keeper_phone`/`opening_hours`. Use the sample content AGENTS.md fixes: *Tủ sách Đồng Tháp*, and the five readers with their saint names (Maria, Giuse, Têrêsa, Anna, Phêrô).

- [ ] **Step 7: Run the tests, then reseed**

```bash
bun run test tests/domain/members tests/lib/profile-labels.test.ts tests/db/seed.test.ts
```

Expected: PASS. Then drop and recreate the development database and reseed:

```bash
bun run db:migrate && bun run db:seed
```

- [ ] **Step 8: Commit**

```bash
git add src tests
git commit -m "feat: tên thánh bắt buộc, ghi lý do khi chưa có số điện thoại"
```

---

## Task 8: The empty-phone confirmation

**Files:**
- Create: `src/components/phone-confirm-dialog.tsx`
- Modify: the four forms from Task 7 that write a phone
- Modify: `src/app/dang-ky/actions.ts`, `src/app/tu-sach/[shelf]/quan-ly/actions.ts`
- Test: `tests/lib/phone-confirmation.test.ts` (create)

**Interfaces:**
- Consumes: `phone_missing_reason` from Task 7.
- Produces: `export function PhoneConfirmDialog({ formId }: { formId: string })`, a client component; the hidden field `ly-do-thieu-sdt`; and the refusal code `thieu-so-dien-thoai` handled by `refusalFrom` in `src/lib/search-params.ts`.

- [ ] **Step 1: Write the failing server-side test**

The server refusal is the contract; the dialog is the convenience on top of it. Test the contract.

```ts
test("a form with no phone and no reason is refused", async () => {
  const form = new FormData();
  form.set("ten-thanh", "Anna");
  form.set("ho-ten", "Anna Phạm Thu Hà");
  form.set("so-dien-thoai", "");
  // …the rest of the fields the action requires…

  const outcome = await registerAction(form);
  expect(outcome).toMatchObject({ refusal: "thieu-so-dien-thoai" });
});

test("a form with no phone and a typed reason is accepted", async () => {
  const form = new FormData();
  // …the same fields…
  form.set("so-dien-thoai", "");
  form.set("ly-do-thieu-sdt", "Em bé chưa có điện thoại, mẹ sẽ bổ sung sau");

  await expect(registerAction(form)).resolves.not.toMatchObject({
    refusal: "thieu-so-dien-thoai",
  });
});
```

Match the action's real name and its real return/redirect shape — read `tests/lib/registration-over-http.test.ts` first, which already exercises this action end to end, and follow how it asserts a refusal.

- [ ] **Step 2: Run and watch it fail**

```bash
bun run test tests/lib/phone-confirmation.test.ts
```

Expected: FAIL — the action accepts an empty phone with no reason.

- [ ] **Step 3: Add the server-side refusal**

In each action that writes a phone, before calling the domain:

```ts
  const phone = optional(form, "so-dien-thoai");
  const reason = optional(form, "ly-do-thieu-sdt");
  // The interface requires a phone; the column does not, because some readers
  // are children with no phone of their own and a placeholder number is a tap
  // that dials a stranger. So an empty phone is allowed exactly once somebody
  // has said why — and this refusal, not the dialog, is what enforces it. The
  // dialog is the same question asked earlier and more pleasantly.
  if (!phone && !reason?.trim()) {
    return refuse("thieu-so-dien-thoai");
  }
```

Use whatever refusal mechanism each action already uses — `refuse(…)`, a redirect carrying `?loi=`, or a returned outcome. Do not introduce a fourth.

Register the Vietnamese sentence for `thieu-so-dien-thoai` wherever the other `?loi=` codes are worded, so the refused page says: **Bạn chưa nhập số điện thoại. Hãy nhập số, hoặc cho biết lý do chưa có.**

- [ ] **Step 4: Write the dialog**

`src/components/phone-confirm-dialog.tsx`, `"use client"` at the top — the fifth client component in the codebase, and it follows `src/components/ui/submit-button.tsx` for how a client component cooperates with a server-action form here. Read that file first.

```tsx
"use client";

/**
 * The danger confirmation raised when a phone field is left empty.
 *
 * The requirement lives on the server (`thieu-so-dien-thoai`), not here: with
 * JavaScript unavailable the form submits, the action refuses, and the page
 * re-renders with the same question and the same reason field. Nothing is
 * reachable only through this dialog. It exists so the question arrives before
 * the round trip, not so the rule is enforced in the browser.
 */
export function PhoneConfirmDialog({ formId }: { formId: string }) {
  // Intercept submit on the named form; if `so-dien-thoai` is empty and
  // `ly-do-thieu-sdt` is empty, preventDefault and showModal(). The confirm
  // button copies the typed reason into the hidden field and submits.
}
```

Copy, exactly:
- Heading: **Chưa có số điện thoại**
- Body: **Tủ sách sẽ không có cách nào liên lạc với người này. Hãy cho biết vì sao chưa có số điện thoại.**
- Reason label: **Lý do**, a `Textarea`, required — the confirm button stays disabled until it has non-whitespace content.
- Confirm: **Vẫn tiếp tục không có số điện thoại**
- Cancel: **Quay lại nhập số**

Danger styling comes from the existing token set in `src/app/globals.css` under `@theme`. Do not add a colour; use what `StatusPanel`'s lost/overdue state already uses. No shadow, no gradient.

- [ ] **Step 5: Mount it on the four forms**

Give each form an `id`, render `<PhoneConfirmDialog formId={…} />` beside it, and add the hidden `ly-do-thieu-sdt` input. On the approval screens (`dang-ky-cho-duyet`, `doi-thong-tin`), mount it on the approve form when the subject's phone is empty.

- [ ] **Step 6: Run the tests and verify both paths**

```bash
bun run test tests/lib/phone-confirmation.test.ts tests/lib/registration-over-http.test.ts
```

Then in the browser: submit with an empty phone and confirm the dialog appears; disable JavaScript and submit again, confirming the server refusal renders the same question.

- [ ] **Step 7: Commit**

```bash
git add src tests
git commit -m "feat: hỏi lại khi để trống số điện thoại"
```

---

## Task 9: Approval routing

**Files:**
- Modify: `src/domain/members/commands/approve-profile-change.ts:92`
- Modify: `src/domain/members/commands/reject-profile-change.ts`
- Modify: `src/domain/members/queries/` — the query behind `/quan-ly/doi-thong-tin`
- Test: `tests/domain/members/approval-routing.test.ts` (create)

**Interfaces:**
- Consumes: nothing new.
- Produces: `getPendingProfileChanges` filters to reader subjects; `approveProfileChange` and `rejectProfileChange` refuse `not_permitted` when the subject outranks the actor's authority or when actor and subject are the same person.

- [ ] **Step 1: Write the failing routing tests**

Create `tests/domain/members/approval-routing.test.ts`, following `tests/domain/members/profile-change-lifecycle.test.ts` for setup:

```ts
test("a manager approves a reader's change", async () => {
  const { shelf, reader, manager } = await aShelfWithAReaderAndAManager();
  const { profileChangeRequestId } = await propose(reader, { phone: "0912345678" });

  await expect(
    asActor(manager, (tx, ctx) => approveProfileChange(tx, ctx, { profileChangeRequestId })),
  ).resolves.toBeDefined();
});

test("a manager may not approve another manager's change", async () => {
  const { shelf, manager, otherManager } = await aShelfWithTwoManagers();
  const { profileChangeRequestId } = await propose(otherManager, { phone: "0912345678" });

  await expect(
    asActor(manager, (tx, ctx) => approveProfileChange(tx, ctx, { profileChangeRequestId })),
  ).rejects.toMatchObject({ code: "not_permitted" });
});

test("a super admin approves a manager's change", async () => {
  const { manager, superAdmin } = await aShelfWithTwoManagers();
  const { profileChangeRequestId } = await propose(manager, { phone: "0912345678" });

  await expect(
    asActor(superAdmin, (tx, ctx) => approveProfileChange(tx, ctx, { profileChangeRequestId })),
  ).resolves.toBeDefined();
});

test("nobody approves their own change, at any rank", async () => {
  const { superAdmin } = await aShelfWithTwoManagers();
  const { profileChangeRequestId } = await propose(superAdmin, { phone: "0912345678" });

  await expect(
    asActor(superAdmin, (tx, ctx) => approveProfileChange(tx, ctx, { profileChangeRequestId })),
  ).rejects.toMatchObject({ code: "not_permitted" });
});

test("a shelf admin approves a reader's change, like any manager", async () => {
  const { reader, shelfAdmin } = await aShelfWithAShelfAdmin();
  const { profileChangeRequestId } = await propose(reader, { phone: "0912345678" });

  await expect(
    asActor(shelfAdmin, (tx, ctx) => approveProfileChange(tx, ctx, { profileChangeRequestId })),
  ).resolves.toBeDefined();
});

test("the shelf queue lists only reader subjects", async () => {
  const { shelf, reader, manager, otherManager } = await aShelfWithTwoManagers();
  await propose(reader, { phone: "0912345678" });
  await propose(otherManager, { phone: "0987654321" });

  const queue = await asActor(manager, (tx, ctx) => getPendingProfileChanges(tx, ctx));
  expect(queue).toHaveLength(1);
  expect(queue[0].readerName).toBe(reader.name);
});
```

Match `readerName` to whatever the query's row type actually calls that field.

- [ ] **Step 2: Run and watch it fail**

```bash
bun run test tests/domain/members/approval-routing.test.ts
```

Expected: FAIL — a manager currently approves anybody's change, including their own.

- [ ] **Step 3: Add the routing rule**

In `approve-profile-change.ts`, after the existing `requireManager(ctx)` and the read that resolves the request:

```ts
  // §9 of docs/superpowers/specs/2026-08-12-po-feedback-design.md. Who may
  // decide follows from *whose* record it is, not from the queue the request
  // was found in — a rule derived at decision time needs no column and cannot
  // drift out of step with a membership that changed role since the proposal.
  //
  // A manager's own details are a manager's own power: the phone a shelf rings
  // and the name on every audit entry they write. A colleague of equal rank
  // approving that is the same person signing both halves in a parish with two
  // volunteers, which is most of them.
  const subjectIsManager = atLeast(request.subjectRole, "manager");
  if (subjectIsManager && ctx.actor.role !== "super_admin") {
    throw new RuleViolated("not_permitted");
  }
  // Self-approval is refused at every rank, super admin included. Rank is not
  // the question; being both parties to the decision is.
  if (request.subjectUserId === ctx.actor.userId) {
    throw new RuleViolated("not_permitted");
  }
```

The read must join `memberships` to get the subject's role and `profile_change_requests.user_id` for the subject. Follow the join the command already writes.

Apply the identical pair of checks in `reject-profile-change.ts` — a rejection is a decision too, and a rule enforced on only one of the two paths is not enforced.

- [ ] **Step 4: Filter the shelf queue**

In the query behind `/quan-ly/doi-thong-tin`, add `and m.role = 'reader'` to the `where`. Document it in the query's docstring: a manager's change is not missing, it is at `/quan-tri/doi-thong-tin`, and leaving it in a queue where nobody present can decide it is worse than not showing it.

- [ ] **Step 5: Run the tests**

```bash
bun run test tests/domain/members
```

Expected: PASS, including the existing `profile-change-lifecycle.test.ts` and `inv-13-one-pending-profile-change.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/domain tests/domain
git commit -m "feat: đổi thông tin của quản lý do quản trị viên duyệt"
```

---

## Task 10: The super admin's change queue

**Files:**
- Create: `src/domain/admin/queries/get-pending-manager-changes.ts`
- Create: `src/app/quan-tri/doi-thong-tin/page.tsx`
- Modify: `src/app/quan-tri/actions.ts` (approve/reject server actions)
- Modify: the admin shell's navigation, wherever `/quan-tri`'s sidebar links are defined
- Test: `tests/domain/admin/pending-manager-changes.test.ts` (create)

**Interfaces:**
- Consumes: Task 9's routing rules; `approveProfileChange`/`rejectProfileChange`.
- Produces:
  ```ts
  export interface PendingManagerChangeRow {
    id: string;
    shelfName: string;
    shelfSlug: string;
    subjectName: string;
    subjectRole: "manager" | "admin";
    requestedAt: Date;
    fields: { field: ProfileField; before: string | null; after: string | null }[];
  }
  export async function getPendingManagerChanges(tx: Tx, ctx: TenantContext): Promise<PendingManagerChangeRow[]>;
  ```

- [ ] **Step 1: Write the failing query test**

```ts
test("the admin queue lists manager changes across every shelf", async () => {
  const a = await aShelfWithAManager({ slug: "dong-thap" });
  const b = await aShelfWithAManager({ slug: "thanh-tam" });
  await propose(a.manager, { phone: "0912345678" });
  await propose(b.manager, { phone: "0987654321" });
  await propose(a.reader, { phone: "0900111222" });

  const rows = await asSuperAdmin((tx, ctx) => getPendingManagerChanges(tx, ctx));

  expect(rows).toHaveLength(2);
  expect(rows.map((r) => r.shelfSlug).sort()).toEqual(["dong-thap", "thanh-tam"]);
  expect(rows.every((r) => r.subjectRole !== "reader")).toBe(true);
});

test("a manager may not read the admin queue", async () => {
  const a = await aShelfWithAManager({ slug: "dong-thap" });
  await expect(
    asActor(a.manager, (tx, ctx) => getPendingManagerChanges(tx, ctx)),
  ).rejects.toMatchObject({ code: "not_permitted" });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
bun run test tests/domain/admin/pending-manager-changes.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the query**

Cross-shelf, so it runs under the super-admin path the other `/quan-tri` queries already use. Read `src/domain/admin/queries/get-admin-overview.ts` first and follow exactly how it opens (`requireSuperAdmin` or equivalent) and how it is dispatched — cross-shelf reads bypass RLS deliberately and visibly, and this query must use the same visible mechanism rather than a new one.

Select pending requests joined to `memberships` where `role in ('manager','admin')`, to `users` for the subject's name, and to `bookshelves` for the shelf name and slug. Order oldest first — a queue is worked front to back.

Decode `proposed_values`/`previous_values` into the `fields` array using `PROFILE_FIELDS` order, the same way `/quan-ly/doi-thong-tin` does (`proposedFields`). Reuse that helper rather than writing a second decoder.

- [ ] **Step 4: Write the page**

`src/app/quan-tri/doi-thong-tin/page.tsx`, with `export const dynamic = "force-dynamic"` and a `metadata` title (`Đổi thông tin quản lý — OLibra`), rendered in `AdminShell` with a new `active` key. Reuse the card layout from `/quan-ly/doi-thong-tin` — same before/after rows, same approve and reject-with-reason pair, each card carrying the same emphasis (that page's docstring explains why no card is "primary"). Each card additionally names the shelf, because this queue is cross-shelf.

Empty state: **Không có đề nghị nào đang chờ.**

Add the entry to the admin navigation with a badge count, matching how the other `/quan-tri` entries carry theirs.

- [ ] **Step 5: Wire the actions**

Approve and reject post to server actions in `src/app/quan-tri/actions.ts`, calling the same domain commands. Task 9's rules mean a super admin passes and anybody else is refused — the page's own guard is the second line, not the first.

- [ ] **Step 6: Run the tests and check the page**

```bash
bun run test tests/domain/admin && bun run typecheck
```

Then walk the queue in the browser as a super admin: propose a change as a manager, see it appear, approve it, see it applied.

- [ ] **Step 7: Commit**

```bash
git add src/domain/admin src/app/quan-tri tests/domain/admin
git commit -m "feat: hàng chờ duyệt đổi thông tin quản lý cho quản trị viên"
```

---

## Task 11: Copy counts, and hiding the contact line from managers

**Files:**
- Modify: `src/app/tu-sach/[shelf]/(doc-gia)/sach/[slug]/page.tsx:285-365`
- Modify: `src/app/tu-sach/[shelf]/quan-ly/sach/[id]/page.tsx:386`
- Test: `tests/lib/shelf-pages.test.ts` or the nearest existing page test

**Interfaces:**
- Consumes: `getBookDetail`'s `copiesAvailable`, `onLoan` and `copiesTotal` (`get-book-detail.ts:162-166`) — all three already returned; `canManage` from Task 5's `Viewer`.
- Produces: nothing consumed downstream.

- [ ] **Step 1: Write the failing page tests**

Follow the existing page-level test file's harness:

```ts
test("the copy line shows all three counts even for a single copy", () => {
  const line = copyCountLine({ copiesAvailable: 1, onLoan: 0, copiesTotal: 1 });
  expect(line).toBe("1 bản có sẵn · 0 đang cho mượn · 1 bản trong tủ");
});

test("lost and retired copies are counted in the total only", () => {
  const line = copyCountLine({ copiesAvailable: 3, onLoan: 2, copiesTotal: 6 });
  expect(line).toBe("3 bản có sẵn · 2 đang cho mượn · 6 bản trong tủ");
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
bun run test tests/lib/shelf-pages.test.ts
```

Expected: FAIL — `copyCountLine` does not exist.

- [ ] **Step 3: Write the shared helper**

One function, used by both pages, so the wording cannot drift. Put it beside the other small page helpers — `src/lib/catalogue.ts` is the closest fit; check it before creating a new module.

```ts
/**
 * The three counts, in the one wording both book pages use.
 *
 * `available + onLoan` need not equal `total`: a lost or retired copy is in
 * neither. That is why the third number is "bản trong tủ" and not presented as
 * a sum the first two add up to.
 */
export function copyCountLine(counts: {
  copiesAvailable: number;
  onLoan: number;
  copiesTotal: number;
}): string {
  const n = new Intl.NumberFormat("vi-VN");
  return `${n.format(counts.copiesAvailable)} bản có sẵn · ${n.format(counts.onLoan)} đang cho mượn · ${n.format(counts.copiesTotal)} bản trong tủ`;
}
```

- [ ] **Step 4: Use it on both pages**

- Reader page: replace the `copiesTotal > 1` conditional sentence at line ~290 with the line, unconditional, inside the availability panel.
- Manager page: render it directly above `Các bản sách ({n})` at line ~386, as `text-[15px] text-meta`.

- [ ] **Step 5: Hide the contact line from managers**

On the reader book page, the block at lines 345-363 becomes contacts-aware and manager-aware:

```tsx
{/* BR:511's sentence, narrowed to readers (spec §11). A manager reading this
    page is one of the people named in it; telling them to ring themselves is
    noise on the screen where they are about to lend the book. */}
{!canManage && primaryContact ? (
  <p className="flex flex-wrap items-center gap-x-1.5 text-[14px] text-meta">
    Liên hệ {primaryContact.name}
    {primaryContact.phone ? (
      <>
        {" · "}
        <PhoneLink phone={primaryContact.phone} size="sm" /> để nhận sách.
      </>
    ) : (
      " để nhận sách."
    )}
  </p>
) : null}
```

where `primaryContact` is `shelf.contacts.find((c) => c.position === 1) ?? shelf.contacts[0]`. `canManage` comes from the `Viewer` the page already loads (Task 5).

- [ ] **Step 6: Run the tests and typecheck**

```bash
bun run test && bun run typecheck
```

Expected: PASS across the whole suite now — this is the last task that owed the typecheck errors from Task 2.

- [ ] **Step 7: Commit**

```bash
git add src tests
git commit -m "feat: hiện số bản có sẵn và đang cho mượn trên trang sách"
```

---

## Task 12: Pinning announcements

**Files:**
- Modify: `src/app/tu-sach/[shelf]/quan-ly/thong-bao/page.tsx` (the manager's list)
- Modify: `src/app/tu-sach/[shelf]/(doc-gia)/thong-bao/page.tsx` and `.../thong-bao/[slug]/page.tsx`
- Modify: `src/app/tu-sach/[shelf]/quan-ly/actions.ts` (pin/unpin server actions)
- Modify: `tests/architecture/every-domain-command-has-a-caller.test.ts` (remove the exemption, if `pinAnnouncement` carries one)
- Test: `tests/domain/community/announcements-feedback-donations.test.ts`

**Interfaces:**
- Consumes: `pinAnnouncement` (`src/domain/community/commands/announcements.ts:226`) and `unpinAnnouncement` (`:250`), both already implemented and tested. `getAnnouncements` and `getAllAnnouncements` already order `is_pinned desc` first.
- Produces: server actions `pinAnnouncementAction` / `unpinAnnouncementAction`.

- [ ] **Step 1: Confirm what already exists**

```bash
bun run test tests/domain/community/announcements-feedback-donations.test.ts
grep -n "pinAnnouncement" tests/architecture/every-domain-command-has-a-caller.test.ts
```

Both commands are implemented and the ordering is in the queries. If the architecture test carries an exemption naming them, that exemption is what this task removes — it is the machine-readable record that the surface was missing.

- [ ] **Step 2: Write the failing action test**

In the nearest existing action test file (`tests/lib/manager-actions.test.ts`):

```ts
test("a manager pins an announcement, and pinning again unpins it", async () => {
  const { shelf, manager, announcementId } = await anAnnouncement();

  const form = new FormData();
  form.set("tu-sach", shelf.slug);
  form.set("thong-bao", announcementId);
  await asManager(manager, () => pinAnnouncementAction(form));

  expect(await isPinned(announcementId)).toBe(true);

  await asManager(manager, () => unpinAnnouncementAction(form));
  expect(await isPinned(announcementId)).toBe(false);
});

test("a reader may not pin an announcement", async () => {
  const { shelf, reader, announcementId } = await anAnnouncement();
  const form = new FormData();
  form.set("tu-sach", shelf.slug);
  form.set("thong-bao", announcementId);

  await expect(asReader(reader, () => pinAnnouncementAction(form))).rejects.toMatchObject({
    code: "not_permitted",
  });
});
```

Match the field names and the actor helpers to what `manager-actions.test.ts` already uses.

- [ ] **Step 3: Run and watch it fail**

```bash
bun run test tests/lib/manager-actions.test.ts
```

Expected: FAIL — the actions do not exist.

- [ ] **Step 4: Write the two actions**

In `src/app/tu-sach/[shelf]/quan-ly/actions.ts`, beside the other announcement actions. Follow their exact shape: the same `"use server"` context, the same shelf-slug resolution, the same `revalidatePath`/redirect ending. Call `pinAnnouncement` / `unpinAnnouncement`; the commands already carry their own permission checks, so the action adds no second rule.

- [ ] **Step 5: Add the controls**

On the manager's announcement list and on each announcement's detail page, one form per row:

```tsx
<form action={announcement.isPinned ? unpinAnnouncementAction : pinAnnouncementAction}>
  <input type="hidden" name="tu-sach" value={slug} />
  <input type="hidden" name="thong-bao" value={announcement.id} />
  <button
    type="submit"
    className="inline-flex min-h-11 items-center gap-2 rounded-control border border-hairline px-3 text-[15px] hover:bg-paper"
  >
    {announcement.isPinned ? (
      <>
        <PinOff aria-hidden className="size-5" strokeWidth={1.75} />
        Bỏ ghim
      </>
    ) : (
      <>
        <Pin aria-hidden className="size-5" strokeWidth={1.75} />
        Ghim lên đầu
      </>
    )}
  </button>
</form>
```

A form, never a bare button — `tests/architecture/no-button-without-a-form.test.ts`.

On the reader-facing Bản tin list and detail, a pinned announcement carries `<Pill icon={Pin} label="Ghim" />`. `Pill` requires both an icon and a label; check its signature before use.

The reader-facing pin marker is display only — the control renders only when the viewer can manage, which is the `canManage` prop Task 5 put on the header and which these pages resolve the same way.

- [ ] **Step 6: Remove the exemption and run the suite**

```bash
bun run test
```

Expected: PASS, including `every-domain-command-has-a-caller.test.ts` with the exemption removed.

- [ ] **Step 7: Commit**

```bash
git add src tests
git commit -m "feat: ghim bản tin lên đầu danh sách"
```

---

## Task 13: Requirements and database documentation

**Files:**
- Modify: `docs/BUSINESS-REQUIREMENTS.md` — §5.4, §16.2, §16.1, BR:511, BR:179, §2, §6
- Modify: `docs/DATABASE.md` — §4.2 and the schema listing at line ~536
- Modify: `docs/OPERATIONS.md` — §4.3, for the approval routing

- [ ] **Step 1: Update the requirements**

Each edit records what changed, when, and why — a requirement quietly rewritten to match the code is how the next reader loses the ability to tell a decision from a drift. Date them 2026-08-12 and cite `docs/superpowers/specs/2026-08-12-po-feedback-design.md`.

- **§5.4 and §16.2** — the leaderboard is no longer opt-in. Record that it was, that the toggle and its column are gone, and that the screen remains manager-facing, which is the mitigation.
- **§16.1 and BR:511** — a shelf has up to three contacts, not one keeper. The "Liên hệ … để nhận sách" line is shown **to readers**; a manager does not see it. The disclosure boundary is unchanged and now rests on a privilege as well as a call: `bookshelf_contacts` carries no grant to `olibra_public`.
- **BR:179** — `opening_hours` is removed from the shelf's fields.
- **§2 and §6** — saint name is mandatory. A phone is required by the interface and a reason is recorded when one is genuinely absent. Approval routing: a reader's change is decided by a manager or shelf admin of their shelf; a manager's or shelf admin's change by a super admin; nobody decides their own.

- [ ] **Step 2: Update the database document**

The `bookshelves` listing at `DATABASE.md:536` loses `keeper_name`, `keeper_phone` and `opening_hours`. Add `bookshelf_contacts` with its policy, its grants and the note about `olibra_public`. Add `users.phone_missing_reason` and the `saint_name` constraint. Remove `memberships.leaderboard_opt_in`.

- [ ] **Step 3: Run every check**

```bash
bun run check
```

Expected: PASS — typecheck, lint, format, and the full test suite.

```bash
bun run check:links && bun run check:diagrams
```

Expected: PASS — the docs edits must not break a cross-reference or a Mermaid diagram.

- [ ] **Step 4: Commit**

```bash
git add docs
git commit -m "docs: cập nhật yêu cầu và lược đồ theo vòng góp ý đầu tiên"
```

---

## Self-review

**Spec coverage.** §1 contacts → Tasks 1, 2, 3, 4. §2 shelf home → Task 4. §3 opening hours → Tasks 1, 3. §4 mobile search → Task 5. §5 catalogue out of the nav → Task 5. §6 management links → Task 5. §7 mobile profile panel → Task 5. §8 saint name and phone → Tasks 1, 7, 8. §9 approval routing → Task 9. §10 copy counts → Task 11. §11 keeper line hidden from managers → Task 11. §12 pinning → Task 12. §13 leaderboard → Tasks 1, 6. Requirements updates → Task 13. **No section is unclaimed.**

**Type consistency.** `ShelfContact` is defined once in Task 2 and consumed with the same four fields by Tasks 3, 4 and 11. `contactsFromForm` returns exactly that type. `canManage`/`isSuperAdmin` are introduced in Task 5 and reused in Tasks 11 and 12. `copyCountLine` takes the three field names `getBookDetail` actually returns. `phone_missing_reason` is added to `PROFILE_FIELDS` in Task 7 and labelled in the same task.

**Known dependencies between tasks.** Task 2 deliberately leaves `bun run typecheck` failing on reader pages; Tasks 3, 4, 5 and 11 clear them, and Task 11's step 6 is where the whole suite must be green again. A reviewer stopping between Tasks 2 and 11 will see a red typecheck — that is expected and recorded, not a regression.

**Two things every task must not do.** Do not edit `tests/architecture/the-front-door-shows-no-keeper-contact.test.ts` or `tests/db/bookshelves-public-columns.test.ts`. If either fails, contacts have been exposed to a caller with no membership, and the fix is in the code under test.
