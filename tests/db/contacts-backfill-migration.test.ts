import { mkdtempSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, expect, test } from "vitest";
import { migrate } from "../../src/db/migrate";
import { closeAll, sql } from "../support/db";

/**
 * Post-review fix wave, item 2: `20260812_01_contacts_profile_and_hours.sql`'s
 * backfill from `bookshelves.keeper_name`/`keeper_phone` into
 * `bookshelf_contacts` used to run `where keeper_name is not null and
 * keeper_name <> '' and deleted_at is null` — which silently dropped a
 * shelf's phone number whenever the name beside it was blank (both columns
 * were nullable, so that combination is representable data, not a typo to
 * ignore), and dropped every archived shelf's contact outright, unrecoverably,
 * since this migration also drops the two columns it reads from.
 *
 * This pins the widened predicate directly against the real migration SQL,
 * the same two-phase shape `tests/db/migrate.test.ts` established for
 * exercising `migrate()` against a partial history: apply every migration up
 * to (but not including) the one under test, hand-insert `bookshelves` rows
 * naming every combination the old predicate got wrong while the two
 * `keeper_*` columns still exist to insert into, then apply the remaining
 * migration and read back what it produced.
 */

const MIGRATIONS_DIR = join(import.meta.dirname, "../../src/db/migrations");
const TARGET = "20260812_01_contacts_profile_and_hours.sql";

let tempDir: string | null = null;

beforeEach(async () => {
  await sql`drop schema public cascade`;
  await sql`create schema public`;
});

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
});

afterAll(closeAll);

test("backfills a contact whenever either keeper column has a value, archived shelves included", async () => {
  const before = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql") && f < TARGET)
    .sort();
  expect(before.length).toBeGreaterThan(0);

  // Phase 1: every migration before the one under test, applied from a
  // directory holding only those files — `migrate()` reads a real directory
  // rather than taking a file list, so a subset of "everything before X"
  // needs one to point it at.
  tempDir = mkdtempSync(join(tmpdir(), "olibra-migrations-"));
  for (const name of before) {
    symlinkSync(join(MIGRATIONS_DIR, name), join(tempDir, name));
  }
  await migrate(sql, tempDir);

  // Dirty data, inserted while `keeper_name`/`keeper_phone` still exist —
  // this migration is the one that drops them, so this is the only window in
  // which a test can ever construct this shape directly.
  await sql`
    insert into bookshelves (slug, name, keeper_name, keeper_phone, deleted_at)
    values
      ('shelf-both',        'Both',        'Anna Nguyễn', '0912345678', null),
      ('shelf-phone-only',  'Phone only',  null,          '0987654321', null),
      ('shelf-blank-name',  'Blank name',  '',            '0911111111', null),
      ('shelf-name-only',   'Name only',   'Giuse Trần',  null,         null),
      ('shelf-archived',    'Archived',    'Maria Lê',    '0900000000', now()),
      ('shelf-neither',     'Neither',     null,          null,         null)
  `;

  // Phase 2: the migration under test, applied from the real directory —
  // by now it is the only pending file, since phase 1 already recorded
  // every one before it in `schema_migrations`.
  const { applied } = await migrate(sql, MIGRATIONS_DIR);
  expect(applied).toEqual([TARGET]);

  const rows = await sql<
    {
      slug: string;
      name: string;
      phone: string | null;
      role_label: string | null;
    }[]
  >`
    select b.slug, c.name, c.phone, c.role_label
      from bookshelves b
      join bookshelf_contacts c on c.bookshelf_id = b.id and c.position = 1
     order by b.slug
  `;

  expect(rows).toEqual([
    {
      slug: "shelf-archived",
      name: "Maria Lê",
      phone: "0900000000",
      role_label: "Người giữ chìa khoá",
    },
    {
      slug: "shelf-blank-name",
      name: "Chưa có tên",
      phone: "0911111111",
      role_label: "Người giữ chìa khoá",
    },
    {
      slug: "shelf-both",
      name: "Anna Nguyễn",
      phone: "0912345678",
      role_label: "Người giữ chìa khoá",
    },
    {
      slug: "shelf-name-only",
      name: "Giuse Trần",
      phone: null,
      role_label: "Người giữ chìa khoá",
    },
    {
      slug: "shelf-phone-only",
      name: "Chưa có tên",
      phone: "0987654321",
      role_label: "Người giữ chìa khoá",
    },
  ]);

  // `shelf-neither` gets no row at all — a shelf with no keeper on file
  // today is still flagged incomplete in `/quan-tri/tu-sach`, not invented.
  const neither = await sql<{ count: string }[]>`
    select count(*) as count
      from bookshelf_contacts c
      join bookshelves b on b.id = c.bookshelf_id
     where b.slug = 'shelf-neither'
  `;
  expect(Number(neither[0].count)).toBe(0);

  // And the two columns this migration exists to remove are actually gone.
  const columns = await sql<{ column_name: string }[]>`
    select column_name from information_schema.columns
     where table_name = 'bookshelves' and column_name in ('keeper_name', 'keeper_phone')
  `;
  expect(columns).toEqual([]);
});
