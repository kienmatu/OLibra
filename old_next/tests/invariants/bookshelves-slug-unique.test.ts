import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { migrate } from "../../src/db/migrate";
import { closeAll, resetDatabase, sql } from "../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

// IMPORTANT 5's "same class of issue" note: DATABASE.md §4.1 names the
// soft-delete trap for `parish_units_name_unique_in_scope` — a plain
// `unique` blocks reusing a name once the row holding it is soft-deleted,
// which is the wrong trade for data that is retained as history rather
// than reserved as a name. `bookshelves.slug` was the same one-line shape:
// `slug text not null unique` with a `deleted_at` column right there.
// 20260808_03_soft_delete_aware_uniqueness.sql converts both.

test("a soft-deleted bookshelf's slug returns to circulation", async () => {
  const [shelf] = await sql<{ id: string }[]>`
    insert into bookshelves (slug, name, address, status)
    values ('dong-thap', 'Tủ sách Đồng Tháp', 'Đồng Tháp', 'active')
    returning id
  `;
  await sql`update bookshelves set deleted_at = now() where id = ${shelf.id}`;

  await expect(
    sql`
      insert into bookshelves (slug, name, address, status)
      values ('dong-thap', 'Tủ sách Đồng Tháp (mới)', 'Đồng Tháp', 'active')
    `,
  ).resolves.toBeDefined();
});

test("two live bookshelves still cannot share a slug", async () => {
  await sql`
    insert into bookshelves (slug, name, address, status)
    values ('an-giang', 'Tủ sách An Giang', 'An Giang', 'active')
  `;

  await expect(
    sql`
      insert into bookshelves (slug, name, address, status)
      values ('an-giang', 'Một tủ sách khác', 'An Giang', 'active')
    `,
  ).rejects.toMatchObject({ code: "23505" });
});
