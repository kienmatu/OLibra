import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { migrate } from "../../src/db/migrate";
import { makeShelf } from "../support/factories";
import { closeAll, resetDatabase, sql } from "../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

const insertUnit = (
  shelfId: string,
  level: 1 | 2,
  parentId: string | null,
  name: string,
) => sql`
  insert into parish_units (bookshelf_id, level, parent_id, name)
  values (${shelfId}, ${level}, ${parentId}, ${name})
`;

test("two level-1 units with the same name on the same shelf collide", async () => {
  // The case plain `unique` would miss silently: every level-1 unit has a
  // null parent_id by definition, so this is the common case, not an edge
  // one. If this test passes against a schema using plain `unique` instead
  // of `unique nulls not distinct`, the constraint is not doing its job —
  // Postgres treats the two nulls as distinct and lets both rows in.
  const shelf = await makeShelf(sql);
  await insertUnit(shelf.id, 1, null, "Tổ 1");
  await expect(insertUnit(shelf.id, 1, null, "Tổ 1")).rejects.toMatchObject({
    code: "23505",
  });
});

test("the same name under two different parents does not collide", async () => {
  // BR §5.6's worked example, repeated in DATABASE.md §4.1: "Tổ 1" appears
  // once under Giáo họ Thánh Tâm and again, a different unit, under Giáo họ
  // Mân Côi. Two different parent_id values, so two rows are correct, not a
  // duplicate.
  const shelf = await makeShelf(sql);
  const [ghA] = await sql<{ id: string }[]>`
    insert into parish_units (bookshelf_id, level, parent_id, name)
    values (${shelf.id}, 1, null, 'Giáo họ Thánh Tâm')
    returning id
  `;
  const [ghB] = await sql<{ id: string }[]>`
    insert into parish_units (bookshelf_id, level, parent_id, name)
    values (${shelf.id}, 1, null, 'Giáo họ Mân Côi')
    returning id
  `;
  await insertUnit(shelf.id, 2, ghA.id, "Tổ 1");
  await expect(insertUnit(shelf.id, 2, ghB.id, "Tổ 1")).resolves.toBeDefined();
});

test("a level-1 unit cannot be given a parent", async () => {
  // parish_units_l1_has_no_parent, the other constraint carried across in
  // Task 3. A level-1 unit is defined by having no parent.
  const shelf = await makeShelf(sql);
  const [parent] = await sql<{ id: string }[]>`
    insert into parish_units (bookshelf_id, level, parent_id, name)
    values (${shelf.id}, 1, null, 'Giáo họ Thánh Tâm')
    returning id
  `;
  await expect(
    insertUnit(shelf.id, 1, parent.id, "Giáo họ Mân Côi"),
  ).rejects.toMatchObject({ code: "23514" });
});
