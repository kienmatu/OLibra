import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { migrate } from "../../src/db/migrate";
import { makeShelf, makeUser } from "../support/factories";
import { closeAll, resetDatabase, sql } from "../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

// S1 re-review, item 2: the same soft-delete trap
// parish_units_name_unique_in_scope and bookshelves_slug_unique were fixed
// for (IMPORTANT 5, 20260808_03_soft_delete_aware_uniqueness.sql) had four
// more instances, all confirmed live before
// 20260808_09_soft_delete_aware_uniqueness_round_2.sql converted them:
//
//   memberships_one_per_shelf, books_bookshelf_id_slug_key,
//   book_copies_code_unique, announcements_bookshelf_id_slug_key
//
// memberships_one_per_shelf is the one with real consequences: it locks out
// a person, not a name.

test("a soft-deleted membership stops permanently blocking that person from rejoining", async () => {
  const shelf = await makeShelf(sql);
  const user = await makeUser(sql);

  await sql`
    insert into memberships (bookshelf_id, user_id, role, status)
    values (${shelf.id}, ${user.id}, 'reader', 'left')
  `;
  await sql`
    update memberships set deleted_at = now()
    where bookshelf_id = ${shelf.id} and user_id = ${user.id}
  `;

  await expect(
    sql`
      insert into memberships (bookshelf_id, user_id, role, status)
      values (${shelf.id}, ${user.id}, 'reader', 'pending')
    `,
  ).resolves.toBeDefined();
});

test("two live memberships for the same person on the same shelf still collide", async () => {
  const shelf = await makeShelf(sql);
  const user = await makeUser(sql);

  await sql`
    insert into memberships (bookshelf_id, user_id, role, status)
    values (${shelf.id}, ${user.id}, 'reader', 'active')
  `;

  await expect(
    sql`
      insert into memberships (bookshelf_id, user_id, role, status)
      values (${shelf.id}, ${user.id}, 'reader', 'pending')
    `,
  ).rejects.toMatchObject({ code: "23505" });
});

test("a soft-deleted book's slug returns to circulation on the same shelf", async () => {
  const shelf = await makeShelf(sql);

  const [book] = await sql<{ id: string }[]>`
    insert into books (bookshelf_id, title, slug)
    values (${shelf.id}, 'Dế Mèn Phiêu Lưu Ký', 'de-men-phieu-luu-ky')
    returning id
  `;
  await sql`update books set deleted_at = now() where id = ${book.id}`;

  await expect(
    sql`
      insert into books (bookshelf_id, title, slug)
      values (${shelf.id}, 'Dế Mèn Phiêu Lưu Ký (tái bản)', 'de-men-phieu-luu-ky')
    `,
  ).resolves.toBeDefined();
});

test("two live books on the same shelf still cannot share a slug", async () => {
  const shelf = await makeShelf(sql);
  await sql`
    insert into books (bookshelf_id, title, slug)
    values (${shelf.id}, 'Sách Một', 'sach-mot')
  `;

  await expect(
    sql`
      insert into books (bookshelf_id, title, slug)
      values (${shelf.id}, 'Một Cuốn Khác', 'sach-mot')
    `,
  ).rejects.toMatchObject({ code: "23505" });
});

test("a soft-deleted copy's code returns to circulation on the same shelf", async () => {
  const shelf = await makeShelf(sql);
  const [book] = await sql<{ id: string }[]>`
    insert into books (bookshelf_id, title, slug)
    values (${shelf.id}, 'Sách Có Bản Sao', 'sach-co-ban-sao')
    returning id
  `;
  const [copy] = await sql<{ id: string }[]>`
    insert into book_copies (bookshelf_id, book_id, code)
    values (${shelf.id}, ${book.id}, 'DT-9001')
    returning id
  `;
  await sql`update book_copies set deleted_at = now() where id = ${copy.id}`;

  await expect(
    sql`
      insert into book_copies (bookshelf_id, book_id, code)
      values (${shelf.id}, ${book.id}, 'DT-9001')
    `,
  ).resolves.toBeDefined();
});

test("two live copies on the same shelf still cannot share a code", async () => {
  const shelf = await makeShelf(sql);
  const [book] = await sql<{ id: string }[]>`
    insert into books (bookshelf_id, title, slug)
    values (${shelf.id}, 'Sách Có Bản Sao 2', 'sach-co-ban-sao-2')
    returning id
  `;
  await sql`
    insert into book_copies (bookshelf_id, book_id, code)
    values (${shelf.id}, ${book.id}, 'DT-9002')
  `;

  await expect(
    sql`
      insert into book_copies (bookshelf_id, book_id, code)
      values (${shelf.id}, ${book.id}, 'DT-9002')
    `,
  ).rejects.toMatchObject({ code: "23505" });
});

test("a soft-deleted announcement's slug returns to circulation on the same shelf", async () => {
  const shelf = await makeShelf(sql);
  const [ann] = await sql<{ id: string }[]>`
    insert into announcements (bookshelf_id, title, slug, body, body_text)
    values (${shelf.id}, 'Thông báo', 'thong-bao', '<p>Nội dung</p>', 'Nội dung')
    returning id
  `;
  await sql`update announcements set deleted_at = now() where id = ${ann.id}`;

  await expect(
    sql`
      insert into announcements (bookshelf_id, title, slug, body, body_text)
      values (${shelf.id}, 'Thông báo (mới)', 'thong-bao', '<p>Nội dung mới</p>', 'Nội dung mới')
    `,
  ).resolves.toBeDefined();
});

test("two live announcements on the same shelf still cannot share a slug", async () => {
  const shelf = await makeShelf(sql);
  await sql`
    insert into announcements (bookshelf_id, title, slug, body, body_text)
    values (${shelf.id}, 'Thông báo A', 'thong-bao-a', '<p>A</p>', 'A')
  `;

  await expect(
    sql`
      insert into announcements (bookshelf_id, title, slug, body, body_text)
      values (${shelf.id}, 'Thông báo B', 'thong-bao-a', '<p>B</p>', 'B')
    `,
  ).rejects.toMatchObject({ code: "23505" });
});
