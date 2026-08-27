import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { migrate } from "../../../src/db/migrate";
import { fixedClock } from "../../../src/domain/kernel/clock";
import {
  systemContext,
  type TenantContext,
} from "../../../src/domain/kernel/tenant";
import { runCommand, runQuery } from "../../../src/domain/kernel/unit-of-work";
import { createParishUnit } from "../../../src/domain/members/commands/create-parish-unit";
import { deleteParishUnit } from "../../../src/domain/members/commands/delete-parish-unit";
import { renameParishUnit } from "../../../src/domain/members/commands/rename-parish-unit";
import { reorderParishUnits } from "../../../src/domain/members/commands/reorder-parish-units";
import { updateParishTaxonomy } from "../../../src/domain/members/commands/update-parish-taxonomy";
import { loadParishContext } from "../../../src/domain/members/parish-context";
import {
  describeSelection,
  hasVisibleLevel2,
  unitOptions,
} from "../../../src/domain/members/parish-taxonomy";
import { closeAll, resetDatabase, sql } from "../../support/db";
import { makeMember, makeParishUnits, makeShelf } from "../../support/factories";

/**
 * OPS §4.5's five administration commands, against a real database.
 *
 * Two things are being guarded here that no amount of reading the schema would
 * tell you, and both are traps this slice's plan named in advance:
 *
 * 1. **`parish_units_l1_has_no_parent` is half a constraint.**
 *    `check (level = 2 or parent_id is null)` forbids a *level-1* unit having a
 *    parent and says nothing about what a level-2 unit's parent is. A level-2
 *    unit parented to another level-2 unit satisfies every constraint on the
 *    table, including the composite tenant foreign key, and then simply never
 *    appears in any picker. `CreateParishUnit` is the only thing that refuses
 *    it, so the test for it is the only thing that holds it.
 * 2. **A `super_admin` gate that ranks a role passes under `systemContext`,**
 *    which is `{ userId: null, role: "super_admin" }` — the exact defect
 *    `voidLoan` shipped. Every command here is driven under `systemContext` as
 *    well as under a real actor, and must refuse.
 */

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

const clock = fixedClock("2026-08-09T04:00:00Z");

async function shelf(over: { nested?: boolean; levels?: 1 | 2 } = {}) {
  const bookshelf = await makeShelf(sql);
  const admin = await makeMember(sql, bookshelf.id, { role: "admin" });
  await makeParishUnits(
    sql,
    bookshelf.id,
    {
      levels: over.levels ?? 2,
      nested: over.nested ?? true,
      level1Label: "Giáo họ",
      level2Label: "Tổ",
    },
    [],
  );
  const ctx: TenantContext = {
    bookshelfId: bookshelf.id,
    actor: {
      userId: admin.userId,
      membershipId: admin.id,
      // The role on a `TenantContext` is the kernel's `Role`, which knows
      // `super_admin`; `contextFor` produces it for a user with
      // `users.is_super_admin`, whatever their membership role at this shelf is.
      role: "super_admin",
    },
    clock,
  };
  return { bookshelf, admin, ctx };
}

const context = (bookshelfId: string) =>
  runQuery(
    sql,
    {
      bookshelfId,
      actor: { userId: null, membershipId: null, role: "guest" },
      clock,
    },
    (tx, c) => loadParishContext(tx, c),
  );

const rows = (bookshelfId: string) =>
  sql<
    {
      id: string;
      level: number;
      parent_id: string | null;
      name: string;
      sort_order: number;
      deleted_at: Date | null;
    }[]
  >`
    select id, level, parent_id, name, sort_order, deleted_at
      from parish_units where bookshelf_id = ${bookshelfId}
     order by level, sort_order, name
  `;

const actions = () =>
  sql<
    { action: string; entity_id: string; actor_id: string | null; after: unknown }[]
  >`
    select action, entity_id, actor_id, after from audit_log order by occurred_at
  `;

// — the gate —

test("every parish command refuses a rank with nobody behind it", async () => {
  // `systemContext` is `super_admin` with `userId: null`. A command gated on
  // rank alone passes it and commits an audit row naming no actor — the defect
  // `voidLoan` shipped and `requireIdentifiedActor` exists to record. Each of
  // the five is driven through it, because the gate is per command and a sixth
  // command written later would need its own line here.
  const { bookshelf } = await shelf();
  const system = systemContext(bookshelf.id, clock);

  await expect(
    runCommand(sql, system, createParishUnit, { level: 1, name: "Giáo họ A" }),
  ).rejects.toMatchObject({ code: "not_permitted" });
  await expect(
    runCommand(sql, system, renameParishUnit, {
      unitId: crypto.randomUUID(),
      name: "x",
    }),
  ).rejects.toMatchObject({ code: "not_permitted" });
  await expect(
    runCommand(sql, system, reorderParishUnits, { unitIds: [crypto.randomUUID()] }),
  ).rejects.toMatchObject({ code: "not_permitted" });
  await expect(
    runCommand(sql, system, deleteParishUnit, { unitId: crypto.randomUUID() }),
  ).rejects.toMatchObject({ code: "not_permitted" });
  await expect(
    runCommand(sql, system, updateParishTaxonomy, { levels: 1 }),
  ).rejects.toMatchObject({ code: "not_permitted" });

  expect(await actions()).toEqual([]);
});

test("a manager is not a super administrator", async () => {
  // OPS §4.5's whole section is `super_admin`. `requireManager` would pass a
  // shelf manager here, and BR §13.1's hierarchy makes that an easy mistake to
  // make — a manager can already register readers into these units.
  const bookshelf = await makeShelf(sql);
  const manager = await makeMember(sql, bookshelf.id, { role: "manager" });
  const ctx: TenantContext = {
    bookshelfId: bookshelf.id,
    actor: { userId: manager.userId, membershipId: manager.id, role: "manager" },
    clock,
  };

  await expect(
    runCommand(sql, ctx, createParishUnit, { level: 1, name: "Giáo họ A" }),
  ).rejects.toMatchObject({ code: "not_permitted" });
});

// — CreateParishUnit —

test("a level-1 unit is created, audited, and offered in a picker", async () => {
  const { bookshelf, ctx, admin } = await shelf();

  const { parishUnitId } = await runCommand(sql, ctx, createParishUnit, {
    level: 1,
    name: "  Giáo họ Thánh Tâm  ",
    sortOrder: 3,
  });

  const [row] = await rows(bookshelf.id);
  expect(row.id).toBe(parishUnitId);
  expect(row.level).toBe(1);
  expect(row.parent_id).toBeNull();
  // Trimmed at the edge, so the audit entry and the column cannot disagree.
  expect(row.name).toBe("Giáo họ Thánh Tâm");
  expect(row.sort_order).toBe(3);
  expect(row.deleted_at).toBeNull();

  const [entry] = await actions();
  expect(entry.action).toBe("parish_unit.created");
  expect(entry.entity_id).toBe(parishUnitId);
  expect(entry.actor_id).toBe(admin.userId);

  const { taxonomy, units } = await context(bookshelf.id);
  expect(unitOptions(units, 1).map((u) => u.name)).toEqual(["Giáo họ Thánh Tâm"]);
  expect(taxonomy.level1Label).toBe("Giáo họ");
});

test("a level-2 unit may not be parented to another level-2 unit", async () => {
  // THE TRAP. `parish_units_l1_has_no_parent` is `check (level = 2 or parent_id
  // is null)`: it forbids a level-1 unit having a parent and permits a level-2
  // unit having a level-2 parent. `20260808_04`'s composite foreign key gets the
  // *shelf* right and has no opinion about the level. Nothing in the database
  // refuses this row, and the consequence is silent — `unitOptions(units, 2,
  // <a level-1 id>)` never returns it, so the unit exists, is live, and is
  // offered nowhere.
  const { bookshelf, ctx } = await shelf();
  const { parishUnitId: l1 } = await runCommand(sql, ctx, createParishUnit, {
    level: 1,
    name: "Giáo họ Thánh Tâm",
  });
  const { parishUnitId: l2 } = await runCommand(sql, ctx, createParishUnit, {
    level: 2,
    parentId: l1,
    name: "Tổ 1",
  });

  await expect(
    runCommand(sql, ctx, createParishUnit, {
      level: 2,
      parentId: l2,
      name: "Tổ 1a",
    }),
  ).rejects.toMatchObject({ code: "parish_unit_l1_not_found" });

  // And the database really would have taken it, which is why the command has
  // to. Written with the superuser handle so it bypasses nothing the command
  // relies on except the command itself.
  const [taken] = await sql<{ id: string }[]>`
    insert into parish_units (bookshelf_id, level, parent_id, name)
    values (${bookshelf.id}, 2, ${l2}, 'Tổ 1b')
    returning id
  `;
  expect(taken.id).toBeTruthy();
  const { units } = await context(bookshelf.id);
  expect(unitOptions(units, 2, l1).map((u) => u.name)).toEqual(["Tổ 1"]);
});

test("a soft-deleted unit is not a parent", async () => {
  // `deleted_at is null` on the parent lookup. Without it a new tổ can be added
  // under a retired giáo họ, which is precisely the orphan `hasVisibleLevel2`
  // documents having to defend against.
  const { ctx } = await shelf();
  const { parishUnitId: l1 } = await runCommand(sql, ctx, createParishUnit, {
    level: 1,
    name: "Giáo họ Cũ",
  });
  await runCommand(sql, ctx, deleteParishUnit, { unitId: l1 });

  await expect(
    runCommand(sql, ctx, createParishUnit, {
      level: 2,
      parentId: l1,
      name: "Tổ 9",
    }),
  ).rejects.toMatchObject({ code: "parish_unit_l1_not_found" });
});

test("another shelf's unit is not a parent either", async () => {
  // RLS filtered the parent lookup to zero rows. Nobody compared two shelf ids,
  // and the refusal is the same one an id naming nothing gets.
  const a = await shelf();
  const b = await shelf();
  const { parishUnitId: theirs } = await runCommand(sql, a.ctx, createParishUnit, {
    level: 1,
    name: "Giáo họ A",
  });

  await expect(
    runCommand(sql, b.ctx, createParishUnit, {
      level: 2,
      parentId: theirs,
      name: "Tổ 1",
    }),
  ).rejects.toMatchObject({ code: "parish_unit_l1_not_found" });
});

test("a level-1 unit with a parent, an empty name and a bad level are all refused", async () => {
  const { bookshelf, ctx } = await shelf();
  const { parishUnitId: l1 } = await runCommand(sql, ctx, createParishUnit, {
    level: 1,
    name: "Giáo họ Thánh Tâm",
  });

  await expect(
    runCommand(sql, ctx, createParishUnit, {
      level: 1,
      parentId: l1,
      name: "Giáo họ B",
    }),
  ).rejects.toMatchObject({ code: "validation_failed" });
  await expect(
    runCommand(sql, ctx, createParishUnit, { level: 2, parentId: l1, name: "   " }),
  ).rejects.toMatchObject({ code: "validation_failed" });
  await expect(
    runCommand(sql, ctx, createParishUnit, {
      level: 3 as unknown as 1,
      name: "Bậc 3",
    }),
  ).rejects.toMatchObject({ code: "validation_failed" });

  expect((await rows(bookshelf.id)).length).toBe(1);
});

test("a nested shelf requires a parent for a level-2 unit; a flat one does not", async () => {
  // OPS §4.5: `parentId` is "required only when the shelf's taxonomy is nested
  // and `level` is 2". On a flat shelf every level-2 unit is a candidate
  // regardless of parent, which is what `unitOptions`' `undefined` parent means.
  const nested = await shelf({ nested: true });
  await expect(
    runCommand(sql, nested.ctx, createParishUnit, { level: 2, name: "Tổ 1" }),
  ).rejects.toMatchObject({ code: "validation_failed" });

  const flat = await shelf({ nested: false });
  const { parishUnitId } = await runCommand(sql, flat.ctx, createParishUnit, {
    level: 2,
    name: "Tổ 1",
  });
  expect(parishUnitId).toBeTruthy();
});

test("a duplicate live name is a sentence, not a 23505", async () => {
  // `parish_units_name_unique_in_scope` is a partial unique index, not the table
  // constraint the design document shows, and OPS §4.5 lists no failure mode for
  // the 23505 it raises. The interim (plan §8 item 4) is this command's own
  // `validation_failed`. What must not happen is a raw driver error, which OPS
  // §2 forbids and which B1 shipped once already.
  const { ctx } = await shelf();
  await runCommand(sql, ctx, createParishUnit, { level: 1, name: "Giáo họ A" });

  const refusal = await runCommand(sql, ctx, createParishUnit, {
    level: 1,
    name: "Giáo họ A",
  }).catch((e: unknown) => e);

  expect(refusal).toMatchObject({ code: "validation_failed" });
  expect((refusal as { code?: string }).code).not.toBe("23505");
});

test("a soft-deleted unit frees its name", async () => {
  // The other half of the partial index, and the reason it was made partial.
  const { ctx } = await shelf();
  const { parishUnitId } = await runCommand(sql, ctx, createParishUnit, {
    level: 1,
    name: "Giáo họ A",
  });
  await runCommand(sql, ctx, deleteParishUnit, { unitId: parishUnitId });

  const again = await runCommand(sql, ctx, createParishUnit, {
    level: 1,
    name: "Giáo họ A",
  });
  expect(again.parishUnitId).not.toBe(parishUnitId);
});

// — RenameParishUnit —

test("a rename changes the name and nothing else", async () => {
  // BR §5.6's whole argument for units-as-rows: renaming is cheap because
  // memberships reference an id. `sort_order` and `parent_id` are not in the
  // statement, so a concurrent reorder cannot be discarded by this write.
  const { bookshelf, ctx } = await shelf();
  const { parishUnitId: l1 } = await runCommand(sql, ctx, createParishUnit, {
    level: 1,
    name: "Giáo họ Thánh Tâm",
  });
  const { parishUnitId: l2 } = await runCommand(sql, ctx, createParishUnit, {
    level: 2,
    parentId: l1,
    name: "Tổ 1",
    sortOrder: 7,
  });

  await runCommand(sql, ctx, renameParishUnit, { unitId: l2, name: "Tổ Một" });

  const after = (await rows(bookshelf.id)).find((r) => r.id === l2)!;
  expect(after.name).toBe("Tổ Một");
  expect(after.sort_order).toBe(7);
  expect(after.parent_id).toBe(l1);

  const entry = (await actions()).at(-1)!;
  expect(entry.action).toBe("parish_unit.renamed");
  expect(entry.entity_id).toBe(l2);
});

test("renaming a unit that is gone, deleted, or another shelf's is refused by level", async () => {
  const a = await shelf();
  const b = await shelf();
  const { parishUnitId: l1 } = await runCommand(sql, a.ctx, createParishUnit, {
    level: 1,
    name: "Giáo họ A",
  });
  const { parishUnitId: l2 } = await runCommand(sql, a.ctx, createParishUnit, {
    level: 2,
    parentId: l1,
    name: "Tổ 1",
  });
  await runCommand(sql, a.ctx, deleteParishUnit, { unitId: l2 });

  // A soft-deleted level-2 unit gets level 2's sentence, because its level is
  // known.
  await expect(
    runCommand(sql, a.ctx, renameParishUnit, { unitId: l2, name: "Tổ Hai" }),
  ).rejects.toMatchObject({ code: "parish_unit_l2_not_found" });

  // An id naming nothing has no level: level 1's sentence is the documented
  // fallback, because OPS §4.5 names no third code.
  await expect(
    runCommand(sql, a.ctx, renameParishUnit, {
      unitId: crypto.randomUUID(),
      name: "x",
    }),
  ).rejects.toMatchObject({ code: "parish_unit_l1_not_found" });

  // Another shelf's unit is invisible, so it is the id-naming-nothing case —
  // because RLS filtered the select, not because anyone compared two shelf ids.
  await expect(
    runCommand(sql, b.ctx, renameParishUnit, { unitId: l1, name: "x" }),
  ).rejects.toMatchObject({ code: "parish_unit_l1_not_found" });
});

test("a rename to a name already in use is a sentence, not a 23505", async () => {
  const { ctx } = await shelf();
  await runCommand(sql, ctx, createParishUnit, { level: 1, name: "Giáo họ A" });
  const { parishUnitId } = await runCommand(sql, ctx, createParishUnit, {
    level: 1,
    name: "Giáo họ B",
  });

  await expect(
    runCommand(sql, ctx, renameParishUnit, {
      unitId: parishUnitId,
      name: "Giáo họ A",
    }),
  ).rejects.toMatchObject({ code: "validation_failed" });
});

// — ReorderParishUnits —

test("sort_order follows the array's order, not the names", async () => {
  // Taxonomy design §7: "the system never parses 'Tổ 3' to derive a number".
  // "Tổ 10" ahead of "Tổ 2" is the exact carelessness `sort_order` prevents,
  // and this is the only command that writes it.
  const { bookshelf, ctx } = await shelf({ nested: false, levels: 2 });
  const ten = await runCommand(sql, ctx, createParishUnit, {
    level: 2,
    name: "Tổ 10",
  });
  const two = await runCommand(sql, ctx, createParishUnit, {
    level: 2,
    name: "Tổ 2",
  });

  await runCommand(sql, ctx, reorderParishUnits, {
    unitIds: [two.parishUnitId, ten.parishUnitId],
  });

  const { units } = await context(bookshelf.id);
  expect(unitOptions(units, 2).map((u) => u.name)).toEqual(["Tổ 2", "Tổ 10"]);

  const entries = (await actions()).filter(
    (e) => e.action === "parish_unit.reordered",
  );
  expect(entries.map((e) => e.entity_id).sort()).toEqual(
    [two.parishUnitId, ten.parishUnitId].sort(),
  );
});

test("a reorder that moves nothing writes no audit entry", async () => {
  // OPS §4.5 lists no refusal for a no-op reorder — dragging a row and dropping
  // it back is not an error — and an entry claiming a change nobody made is what
  // `empty_proposal` exists to prevent elsewhere in this slice.
  const { ctx } = await shelf({ nested: false, levels: 2 });
  const a = await runCommand(sql, ctx, createParishUnit, {
    level: 2,
    name: "Tổ 1",
    sortOrder: 1,
  });
  const b = await runCommand(sql, ctx, createParishUnit, {
    level: 2,
    name: "Tổ 2",
    sortOrder: 2,
  });

  await runCommand(sql, ctx, reorderParishUnits, {
    unitIds: [a.parishUnitId, b.parishUnitId],
  });

  expect(
    (await actions()).filter((e) => e.action === "parish_unit.reordered"),
  ).toEqual([]);
});

test("a partial list is refused rather than left with duplicate sort_orders", async () => {
  // The evasion the other refusals missed. Three level-1 units at 1/2/3
  // reordered with `[C, A]` end at `C=1, A=2, B=2` — a tie — and `unitOptions`
  // breaks ties by name, so the shelf silently falls back to "Tổ 10 before
  // Tổ 2", which is the exact outcome this command's docstring exists to
  // prevent. Both commands reported success, so nothing anywhere raised.
  //
  // The assertion is on the stored `sort_order`s and not merely on the throw:
  // a refusal that had already written half the list would be worse than the
  // bug it replaced.
  const { bookshelf, ctx } = await shelf();
  const a = await runCommand(sql, ctx, createParishUnit, {
    level: 1,
    name: "Giáo họ A",
    sortOrder: 1,
  });
  const b = await runCommand(sql, ctx, createParishUnit, {
    level: 1,
    name: "Giáo họ B",
    sortOrder: 2,
  });
  const c = await runCommand(sql, ctx, createParishUnit, {
    level: 1,
    name: "Giáo họ C",
    sortOrder: 3,
  });

  await expect(
    runCommand(sql, ctx, reorderParishUnits, {
      unitIds: [c.parishUnitId, a.parishUnitId],
    }),
  ).rejects.toMatchObject({ code: "validation_failed" });

  const written = await rows(bookshelf.id);
  expect(written.map((r) => [r.name, Number(r.sort_order)]).sort()).toEqual([
    ["Giáo họ A", 1],
    ["Giáo họ B", 2],
    ["Giáo họ C", 3],
  ]);
  expect([a.parishUnitId, b.parishUnitId, c.parishUnitId]).toHaveLength(3);
});

test("a soft-deleted sibling does not make a complete list look partial", async () => {
  // The completeness count is over *live* units only. A screen that lists what
  // it can see is posting a complete list; counting retired units too would
  // refuse every reorder on a shelf that had ever deleted a unit, which is the
  // way a guard like this usually goes wrong.
  const { bookshelf, ctx } = await shelf();
  const a = await runCommand(sql, ctx, createParishUnit, {
    level: 1,
    name: "Giáo họ A",
    sortOrder: 1,
  });
  const b = await runCommand(sql, ctx, createParishUnit, {
    level: 1,
    name: "Giáo họ B",
    sortOrder: 2,
  });
  const retired = await runCommand(sql, ctx, createParishUnit, {
    level: 1,
    name: "Giáo họ Cũ",
    sortOrder: 3,
  });
  await runCommand(sql, ctx, deleteParishUnit, { unitId: retired.parishUnitId });

  await runCommand(sql, ctx, reorderParishUnits, {
    unitIds: [b.parishUnitId, a.parishUnitId],
  });

  const { units } = await context(bookshelf.id);
  expect(unitOptions(units, 1).map((u) => u.name)).toEqual([
    "Giáo họ B",
    "Giáo họ A",
  ]);
});

test("a mixed, duplicated, empty or unresolvable list is refused", async () => {
  const { bookshelf, ctx } = await shelf();
  const l1 = await runCommand(sql, ctx, createParishUnit, {
    level: 1,
    name: "Giáo họ A",
  });
  const other = await runCommand(sql, ctx, createParishUnit, {
    level: 1,
    name: "Giáo họ B",
  });
  const l2 = await runCommand(sql, ctx, createParishUnit, {
    level: 2,
    parentId: l1.parishUnitId,
    name: "Tổ 1",
  });
  const l2b = await runCommand(sql, ctx, createParishUnit, {
    level: 2,
    parentId: other.parishUnitId,
    name: "Tổ 1",
  });

  // Two levels in one list.
  await expect(
    runCommand(sql, ctx, reorderParishUnits, {
      unitIds: [l1.parishUnitId, l2.parishUnitId],
    }),
  ).rejects.toMatchObject({ code: "validation_failed" });

  // One level, two parents — the case a flat shelf can never produce and a
  // nested one produces the moment a screen posts the wrong group.
  await expect(
    runCommand(sql, ctx, reorderParishUnits, {
      unitIds: [l2.parishUnitId, l2b.parishUnitId],
    }),
  ).rejects.toMatchObject({ code: "validation_failed" });

  await expect(
    runCommand(sql, ctx, reorderParishUnits, {
      unitIds: [l1.parishUnitId, l1.parishUnitId],
    }),
  ).rejects.toMatchObject({ code: "validation_failed" });

  await expect(
    runCommand(sql, ctx, reorderParishUnits, { unitIds: [] }),
  ).rejects.toMatchObject({ code: "validation_failed" });

  await expect(
    runCommand(sql, ctx, reorderParishUnits, {
      unitIds: [l1.parishUnitId, crypto.randomUUID()],
    }),
  ).rejects.toMatchObject({ code: "parish_unit_l1_not_found" });

  // Nothing was written by any of the five.
  const written = await rows(bookshelf.id);
  expect(written.map((r) => r.sort_order)).toEqual([0, 0, 0, 0]);
});

// — DeleteParishUnit —

test("deleting a level-1 unit cascades to its live level-2 children", async () => {
  // OPS §4.5 and taxonomy design §7. `hasVisibleLevel2` documents what breaks
  // without it: orphaned children keep the level-2 field claiming it has
  // something to show while the grouped rendering finds no parent to hang them
  // under, so a reader sees a `<select>` with nothing in it.
  const { bookshelf, ctx } = await shelf();
  const l1 = await runCommand(sql, ctx, createParishUnit, {
    level: 1,
    name: "Giáo họ Thánh Tâm",
  });
  const first = await runCommand(sql, ctx, createParishUnit, {
    level: 2,
    parentId: l1.parishUnitId,
    name: "Tổ 1",
  });
  const second = await runCommand(sql, ctx, createParishUnit, {
    level: 2,
    parentId: l1.parishUnitId,
    name: "Tổ 2",
  });

  const { deletedUnitIds } = await runCommand(sql, ctx, deleteParishUnit, {
    unitId: l1.parishUnitId,
  });

  expect(deletedUnitIds.sort()).toEqual(
    [l1.parishUnitId, first.parishUnitId, second.parishUnitId].sort(),
  );
  const all = await rows(bookshelf.id);
  expect(all.every((r) => r.deleted_at !== null)).toBe(true);
  // From ctx.clock, never a column default — DATABASE.md §6.
  expect(all[0].deleted_at!.toISOString()).toBe("2026-08-09T04:00:00.000Z");

  // One entry per row, which is what OPS §4.5 asks for by name.
  const deletions = (await actions()).filter(
    (e) => e.action === "parish_unit.deleted",
  );
  expect(deletions.length).toBe(3);
  expect(deletions.map((e) => e.entity_id).sort()).toEqual(deletedUnitIds.sort());

  const { taxonomy, units } = await context(bookshelf.id);
  expect(hasVisibleLevel2(taxonomy, units)).toBe(false);
  expect(unitOptions(units, 1)).toEqual([]);
});

test("deleting a level-2 unit deletes that row and no other", async () => {
  const { bookshelf, ctx } = await shelf();
  const l1 = await runCommand(sql, ctx, createParishUnit, {
    level: 1,
    name: "Giáo họ Thánh Tâm",
  });
  const keep = await runCommand(sql, ctx, createParishUnit, {
    level: 2,
    parentId: l1.parishUnitId,
    name: "Tổ 1",
  });
  const drop = await runCommand(sql, ctx, createParishUnit, {
    level: 2,
    parentId: l1.parishUnitId,
    name: "Tổ 2",
  });

  const { deletedUnitIds } = await runCommand(sql, ctx, deleteParishUnit, {
    unitId: drop.parishUnitId,
  });
  expect(deletedUnitIds).toEqual([drop.parishUnitId]);

  const live = (await rows(bookshelf.id)).filter((r) => r.deleted_at === null);
  expect(live.map((r) => r.id).sort()).toEqual(
    [l1.parishUnitId, keep.parishUnitId].sort(),
  );
});

test("a retired unit leaves the pickers and keeps describing the members in it", async () => {
  // Taxonomy design §7, and the reason `validateSelection` treats a deleted unit
  // as existing: a membership pointing at a retired unit is history, not an
  // error, and `ApproveProfileChange` re-validates an unchanged selection.
  const { bookshelf, ctx } = await shelf({ nested: false, levels: 1 });
  const l1 = await runCommand(sql, ctx, createParishUnit, {
    level: 1,
    name: "Giáo họ Thánh Tâm",
  });
  const reader = await makeMember(sql, bookshelf.id);
  await sql`
    update memberships set parish_unit_l1_id = ${l1.parishUnitId}
     where id = ${reader.id}
  `;

  await runCommand(sql, ctx, deleteParishUnit, { unitId: l1.parishUnitId });

  const { taxonomy, units } = await context(bookshelf.id);
  expect(unitOptions(units, 1)).toEqual([]);
  expect(
    describeSelection(taxonomy, units, { l1: l1.parishUnitId, l2: null }),
  ).toBe("Giáo họ Thánh Tâm");
});

test("deleting a unit twice is refused rather than silently repeated", async () => {
  const { ctx } = await shelf();
  const l1 = await runCommand(sql, ctx, createParishUnit, {
    level: 1,
    name: "Giáo họ A",
  });
  await runCommand(sql, ctx, deleteParishUnit, { unitId: l1.parishUnitId });

  await expect(
    runCommand(sql, ctx, deleteParishUnit, { unitId: l1.parishUnitId }),
  ).rejects.toMatchObject({ code: "parish_unit_l1_not_found" });
});

// — UpdateParishTaxonomy —

test("nested survives a drop to one level and back", async () => {
  // OPS §4.5 states this as an invariant, and `validateSelection` depends on it:
  // its nesting rule is gated on `levels === 2 && nested` precisely because
  // `nested` can be true while `levels` is 1.
  const { bookshelf, ctx } = await shelf({ nested: true, levels: 2 });

  await runCommand(sql, ctx, updateParishTaxonomy, { levels: 1 });
  let stored = (await context(bookshelf.id)).taxonomy;
  expect(stored).toEqual({
    levels: 1,
    nested: true,
    level1Label: "Giáo họ",
    level2Label: "Tổ",
  });

  await runCommand(sql, ctx, updateParishTaxonomy, { levels: 2 });
  stored = (await context(bookshelf.id)).taxonomy;
  expect(stored.nested).toBe(true);
  expect(stored.level1Label).toBe("Giáo họ");
});

test("a shelf that was never configured merges onto the default taxonomy", async () => {
  const bookshelf = await makeShelf(sql);
  const admin = await makeMember(sql, bookshelf.id, { role: "admin" });
  const ctx: TenantContext = {
    bookshelfId: bookshelf.id,
    actor: {
      userId: admin.userId,
      membershipId: admin.id,
      role: "super_admin",
    },
    clock,
  };

  await runCommand(sql, ctx, updateParishTaxonomy, { level1Label: "Giáo khu" });

  expect((await context(bookshelf.id)).taxonomy).toEqual({
    levels: 1,
    nested: false,
    level1Label: "Giáo khu",
    level2Label: "Tổ",
  });
});

test("the taxonomy write leaves the rest of settings alone", async () => {
  // `settings` holds more than the taxonomy. A whole-column write is
  // `updateBook`'s lesson applied to jsonb.
  const { bookshelf, ctx } = await shelf();
  await sql`
    update bookshelves
       set settings = settings || ${sql.json({ loan_days: 21 })}
     where id = ${bookshelf.id}
  `;

  await runCommand(sql, ctx, updateParishTaxonomy, { level2Label: "Nhóm" });

  const [row] = await sql<{ settings: Record<string, unknown> }[]>`
    select settings from bookshelves where id = ${bookshelf.id}
  `;
  expect(row.settings.loan_days).toBe(21);
  expect((await context(bookshelf.id)).taxonomy.level2Label).toBe("Nhóm");
});

test("an empty label or a third level is refused", async () => {
  const { bookshelf, ctx } = await shelf();

  await expect(
    runCommand(sql, ctx, updateParishTaxonomy, { level1Label: "   " }),
  ).rejects.toMatchObject({ code: "validation_failed" });
  await expect(
    runCommand(sql, ctx, updateParishTaxonomy, { levels: 3 as unknown as 1 }),
  ).rejects.toMatchObject({ code: "validation_failed" });

  expect((await context(bookshelf.id)).taxonomy.level1Label).toBe("Giáo họ");
});

test("the taxonomy is audited with both sides", async () => {
  const { bookshelf, ctx, admin } = await shelf();
  await runCommand(sql, ctx, updateParishTaxonomy, { level1Label: "Giáo khu" });

  const entry = (await actions()).at(-1)!;
  expect(entry.action).toBe("parish_taxonomy.updated");
  expect(entry.entity_id).toBe(bookshelf.id);
  expect(entry.actor_id).toBe(admin.userId);
  expect(entry.after).toMatchObject({ level1Label: "Giáo khu" });
});
