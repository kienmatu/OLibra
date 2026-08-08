import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { migrate } from "../../src/db/migrate";
import { makeBookWithCopies, makeShelf, makeUser } from "../support/factories";
import { closeAll, resetDatabase, sql } from "../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

/**
 * IMPORTANT 6: foreign keys between shelf-scoped tables used to check only
 * that the referenced id exists *somewhere*, not that it belongs to the
 * same shelf. Demonstrated live: as `olibra_app` scoped to Đồng Tháp,
 * inserting a membership whose `parish_unit_l1_id` named a Cần Thơ unit
 * succeeded, and reading it back from the same session showed a parish
 * line that resolves to null — RLS hides the Cần Thơ row, but the value
 * is not null, so the owning shelf can neither read nor repair it.
 *
 * 20260808_04_composite_tenant_fks.sql converts every foreign key where
 * both sides are shelf-scoped into a composite `(bookshelf_id, x_id)
 * references parent (bookshelf_id, id)`, so a mismatched pair is rejected
 * by the foreign key itself rather than merely hidden by RLS afterwards.
 */

test("a membership cannot reference another shelf's parish unit", async () => {
  const dongThap = await makeShelf(sql, { slug: "dong-thap-fk" });
  const canTho = await makeShelf(sql, { slug: "can-tho-fk" });
  const [canThoUnit] = await sql<{ id: string }[]>`
    insert into parish_units (bookshelf_id, level, parent_id, name)
    values (${canTho.id}, 1, null, 'Giáo họ Cần Thơ')
    returning id
  `;
  const user = await makeUser(sql);

  await expect(
    sql`
      insert into memberships (bookshelf_id, user_id, role, status, parish_unit_l1_id)
      values (${dongThap.id}, ${user.id}, 'reader', 'active', ${canThoUnit.id})
    `,
  ).rejects.toMatchObject({ code: "23503" });
});

test("a parish unit's parent must belong to the same shelf", async () => {
  const a = await makeShelf(sql, { slug: "shelf-fk-a" });
  const b = await makeShelf(sql, { slug: "shelf-fk-b" });
  const [parentOnB] = await sql<{ id: string }[]>`
    insert into parish_units (bookshelf_id, level, parent_id, name)
    values (${b.id}, 1, null, 'Giáo họ B')
    returning id
  `;

  await expect(
    sql`
      insert into parish_units (bookshelf_id, level, parent_id, name)
      values (${a.id}, 2, ${parentOnB.id}, 'Tổ lạc chỗ')
    `,
  ).rejects.toMatchObject({ code: "23503" });
});

test("a loan cannot reference another shelf's copy", async () => {
  const a = await makeShelf(sql, { slug: "shelf-fk-c" });
  const b = await makeShelf(sql, { slug: "shelf-fk-d" });
  const { bookId: bookA } = await makeBookWithCopies(sql, a.id, 1);
  const { copyIds: copiesB } = await makeBookWithCopies(sql, b.id, 1);
  const user = await makeUser(sql);

  await expect(
    sql`
      insert into loans (bookshelf_id, copy_id, book_id, borrower_id, lent_by, due_on, status)
      values (${a.id}, ${copiesB[0]}, ${bookA}, ${user.id}, ${user.id}, current_date + 14, 'active')
    `,
  ).rejects.toMatchObject({ code: "23503" });
});

test("a same-shelf membership-to-parish-unit reference still succeeds", async () => {
  // The fix must not be so strict it breaks the ordinary case.
  const shelf = await makeShelf(sql, { slug: "shelf-fk-e" });
  const [unit] = await sql<{ id: string }[]>`
    insert into parish_units (bookshelf_id, level, parent_id, name)
    values (${shelf.id}, 1, null, 'Giáo họ Thánh Tâm')
    returning id
  `;
  const user = await makeUser(sql);

  await expect(
    sql`
      insert into memberships (bookshelf_id, user_id, role, status, parish_unit_l1_id)
      values (${shelf.id}, ${user.id}, 'reader', 'active', ${unit.id})
    `,
  ).resolves.toBeDefined();
});

test("a null parish_unit_l1_id (no unit assigned yet) still succeeds", async () => {
  // MATCH SIMPLE: a composite FK is satisfied when any referencing column
  // is null, so "no unit configured yet" (DATABASE.md §4.1) still needs
  // nothing extra.
  const shelf = await makeShelf(sql, { slug: "shelf-fk-f" });
  const user = await makeUser(sql);

  await expect(
    sql`
      insert into memberships (bookshelf_id, user_id, role, status, parish_unit_l1_id)
      values (${shelf.id}, ${user.id}, 'reader', 'active', null)
    `,
  ).resolves.toBeDefined();
});
