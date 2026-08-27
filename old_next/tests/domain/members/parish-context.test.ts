import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { fixedClock } from "../../../src/domain/kernel/clock";
import { RuleViolated } from "../../../src/domain/kernel/errors";
import type { TenantContext } from "../../../src/domain/kernel/tenant";
import { runQuery } from "../../../src/domain/kernel/unit-of-work";
import { loadParishContext } from "../../../src/domain/members/parish-context";
import { getParishUnits } from "../../../src/domain/members/queries/get-parish-units";
import {
  describeSelection,
  unitOptions,
  validateSelection,
} from "../../../src/domain/members/parish-taxonomy";
import { migrate } from "../../../src/db/migrate";
import { makeMember, makeParishUnits, makeShelf } from "../../support/factories";
import { closeAll, resetDatabase, sql } from "../../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

const clock = fixedClock("2026-08-08T03:00:00Z");

const NESTED = {
  levels: 2 as const,
  nested: true,
  level1Label: "Giáo họ",
  level2Label: "Tổ",
};

async function nestedShelf(slug = "dong-thap") {
  const shelf = await makeShelf(sql, { slug });
  const reader = await makeMember(sql, shelf.id);
  const ids = await makeParishUnits(sql, shelf.id, NESTED, [
    { level: 1, name: "Giáo họ Thánh Tâm", sortOrder: 1 },
    { level: 1, name: "Giáo họ Mân Côi", sortOrder: 2 },
    { level: 2, name: "Tổ 3", parentName: "Giáo họ Thánh Tâm", sortOrder: 3 },
    { level: 2, name: "Tổ 10", parentName: "Giáo họ Thánh Tâm", sortOrder: 10 },
    { level: 2, name: "Tổ 1", parentName: "Giáo họ Mân Côi", sortOrder: 1 },
  ]);
  const ctx: TenantContext = {
    bookshelfId: shelf.id,
    actor: { userId: reader.userId, membershipId: reader.id, role: "reader" },
    clock,
  };
  return { shelf, ctx, ids };
}

test("the taxonomy comes back camelCase from snake_case storage", async () => {
  // design §3.2 stores level1_label; parish-taxonomy.ts's type says
  // level1Label. This function is the one place that knows both.
  const { ctx } = await nestedShelf();
  const loaded = await runQuery(sql, ctx, (tx, c) => loadParishContext(tx, c));
  expect(loaded.taxonomy).toEqual(NESTED);
});

test("a shelf that has never been configured gets design §3.2's default", async () => {
  // settings defaults to '{}'. BR §5.6: a shelf with no units yet must still
  // accept registrations, so this cannot be an error.
  const shelf = await makeShelf(sql, { slug: "brand-new" });
  const reader = await makeMember(sql, shelf.id);
  const ctx: TenantContext = {
    bookshelfId: shelf.id,
    actor: { userId: reader.userId, membershipId: reader.id, role: "reader" },
    clock,
  };
  const loaded = await runQuery(sql, ctx, (tx, c) => loadParishContext(tx, c));
  expect(loaded.taxonomy).toEqual({
    levels: 1,
    nested: false,
    level1Label: "Tổ",
    level2Label: "Tổ",
  });
  expect(loaded.units).toEqual([]);
});

test("the loaded shape is what the pure module already knows how to read", async () => {
  const { ctx, ids } = await nestedShelf();
  const { taxonomy, units } = await runQuery(sql, ctx, (tx, c) =>
    loadParishContext(tx, c),
  );

  // sort_order, never digits parsed out of a name: "Tổ 10" after "Tổ 3".
  expect(
    unitOptions(units, 2, ids.get("Giáo họ Thánh Tâm")!).map((u) => u.name),
  ).toEqual(["Tổ 3", "Tổ 10"]);

  expect(
    validateSelection(taxonomy, units, {
      l1: ids.get("Giáo họ Thánh Tâm")!,
      l2: ids.get("Tổ 1")!,
    }),
  ).toEqual({ blocked: true, reason: "parish_unit_l2_not_in_l1" });

  expect(
    describeSelection(taxonomy, units, {
      l1: ids.get("Giáo họ Thánh Tâm")!,
      l2: ids.get("Tổ 3")!,
    }),
  ).toBe("Tổ 3 · Giáo họ Thánh Tâm");
});

test("a soft-deleted unit leaves the picker and keeps describing its members", async () => {
  // BR §5.6, design §7, and master §7.2's acceptance, in one assertion.
  const { ctx, ids } = await nestedShelf();
  const thanhTam = ids.get("Giáo họ Thánh Tâm")!;
  await sql`update parish_units set deleted_at = now() where id = ${thanhTam}`;

  const { taxonomy, units } = await runQuery(sql, ctx, (tx, c) =>
    loadParishContext(tx, c),
  );
  expect(unitOptions(units, 1).map((u) => u.name)).toEqual(["Giáo họ Mân Côi"]);
  expect(describeSelection(taxonomy, units, { l1: thanhTam, l2: null })).toBe(
    "Giáo họ Thánh Tâm",
  );

  const offered = await runQuery(sql, ctx, (tx, c) => getParishUnits(tx, c));
  expect(offered.units.some((u) => u.id === thanhTam)).toBe(false);
});

test("GetParishUnits offers live units only, in picker order, with the level-2 flag", async () => {
  const { ctx } = await nestedShelf();
  const result = await runQuery(sql, ctx, (tx, c) => getParishUnits(tx, c));
  expect(result.taxonomy).toEqual(NESTED);
  expect(result.units.filter((u) => u.level === 1).map((u) => u.name)).toEqual([
    "Giáo họ Thánh Tâm",
    "Giáo họ Mân Côi",
  ]);
  expect(result.showLevel2).toBe(true);
});

test("GetParishUnits refuses a guest — OPS §3.2 makes it reader-gated", async () => {
  const { shelf } = await nestedShelf();
  const guest: TenantContext = {
    bookshelfId: shelf.id,
    actor: { userId: null, membershipId: null, role: "guest" },
    clock,
  };
  await expect(
    runQuery(sql, guest, (tx, c) => getParishUnits(tx, c)),
  ).rejects.toBeInstanceOf(RuleViolated);
});

test("INV-10: the taxonomy is this shelf's, not whichever row came back first", async () => {
  // A defect this slice found and fixed. `loadParishContext` selected from
  // `bookshelves` with no `where`, on the reasoning that `bookshelves_tenant` is
  // `id = <the GUC>` and a hand-written predicate would be a second copy of the
  // scoping. `20260808_12_bookshelves_public_read.sql` then added a second
  // **permissive** policy — `using (status = 'active' and deleted_at is null)`
  // — and Postgres ORs permissive policies over the same command, so the
  // unqualified select returned every active shelf and `[shelf]` was whichever
  // one the planner listed first.
  //
  // Two shelves that disagree, and the assertion is that each sees its own.
  // Without the `where id`, one of the two directions returns the other's
  // taxonomy: `CreateParishUnit` refuses a flat shelf on a nested one's rule,
  // and `ApproveProfileChange` validates a reader's parish selection against
  // another parish's nesting.
  const nested = await nestedShelf("dong-thap");

  const flatShelf = await makeShelf(sql, { slug: "can-tho" });
  const flatReader = await makeMember(sql, flatShelf.id);
  await makeParishUnits(
    sql,
    flatShelf.id,
    { levels: 1, nested: false, level1Label: "Khu", level2Label: "Khu" },
    [],
  );
  const flatCtx: TenantContext = {
    bookshelfId: flatShelf.id,
    actor: {
      userId: flatReader.userId,
      membershipId: flatReader.id,
      role: "reader",
    },
    clock,
  };

  expect(
    (await runQuery(sql, nested.ctx, (tx, c) => loadParishContext(tx, c))).taxonomy,
  ).toEqual(NESTED);
  expect(
    (await runQuery(sql, flatCtx, (tx, c) => loadParishContext(tx, c))).taxonomy,
  ).toEqual({
    levels: 1,
    nested: false,
    level1Label: "Khu",
    level2Label: "Khu",
  });
});

test("INV-10: another shelf's units are invisible, not merely unfiltered", async () => {
  const a = await nestedShelf("dong-thap");
  const b = await nestedShelf("can-tho");
  const fromB = await runQuery(sql, b.ctx, (tx, c) => loadParishContext(tx, c));
  const aIds = new Set([...a.ids.values()]);
  expect(fromB.units.some((u) => aIds.has(u.id))).toBe(false);
  expect(fromB.units).toHaveLength(5);
});
