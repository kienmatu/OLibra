import { describe, expect, test } from "vitest";
import {
  defaultTaxonomy,
  describeSelection,
  hasVisibleLevel2,
  unitName,
  unitOptions,
  validateSelection,
  type ParishTaxonomy,
  type ParishUnit,
} from "../../../src/domain/members/parish-taxonomy";

function unit(overrides: Partial<ParishUnit> & Pick<ParishUnit, "id">): ParishUnit {
  return {
    level: 1,
    parentId: null,
    name: overrides.id,
    sortOrder: 0,
    deletedAt: null,
    ...overrides,
  };
}

const nestedTaxonomy: ParishTaxonomy = {
  levels: 2,
  nested: true,
  level1Label: "Giáo họ",
  level2Label: "Tổ",
};

const flatTaxonomy: ParishTaxonomy = {
  levels: 2,
  nested: false,
  level1Label: "Giáo họ",
  level2Label: "Tổ",
};

const oneLevelTaxonomy: ParishTaxonomy = {
  levels: 1,
  nested: false,
  level1Label: "Tổ",
  level2Label: "Tổ",
};

describe("defaultTaxonomy", () => {
  test("one level, Tổ, not nested — what a brand-new shelf gets", () => {
    expect(defaultTaxonomy()).toEqual({
      levels: 1,
      nested: false,
      level1Label: "Tổ",
      level2Label: "Tổ",
    });
  });
});

describe("unitOptions", () => {
  test("orders by sortOrder, not by insertion order or digits in the name", () => {
    // "Tổ 2" is inserted first and would sort before "Tổ 10" both by
    // insertion order and by any naive numeric read of the name — sortOrder
    // says the opposite, and sortOrder is the only thing that may win
    // (design §7).
    const units = [
      unit({ id: "u-2", name: "Tổ 2", sortOrder: 2 }),
      unit({ id: "u-10", name: "Tổ 10", sortOrder: 1 }),
    ];

    expect(unitOptions(units, 1).map((u) => u.id)).toEqual(["u-10", "u-2"]);
  });

  test("ties on sortOrder break by name, not by insertion order", () => {
    const units = [
      unit({ id: "u-b", name: "Tổ B", sortOrder: 5 }),
      unit({ id: "u-a", name: "Tổ A", sortOrder: 5 }),
    ];

    expect(unitOptions(units, 1).map((u) => u.id)).toEqual(["u-a", "u-b"]);
  });

  test("level filter excludes the other level", () => {
    const units = [
      unit({ id: "l1", level: 1 }),
      unit({ id: "l2", level: 2, parentId: "l1" }),
    ];

    expect(unitOptions(units, 1).map((u) => u.id)).toEqual(["l1"]);
    expect(unitOptions(units, 2).map((u) => u.id)).toEqual(["l2"]);
  });

  test("nested: level 2 filtered to the given parent's children only", () => {
    const units = [
      unit({ id: "gh1", level: 1, name: "Giáo họ Thánh Tâm" }),
      unit({ id: "gh2", level: 1, name: "Giáo họ Mân Côi" }),
      unit({ id: "t1", level: 2, parentId: "gh1", name: "Tổ 1" }),
      unit({ id: "t2", level: 2, parentId: "gh2", name: "Tổ 2" }),
    ];

    expect(unitOptions(units, 2, "gh1").map((u) => u.id)).toEqual(["t1"]);
  });

  test("nested but no parent chosen yet: parentId null yields no options, even though level-2 units exist", () => {
    const units = [
      unit({ id: "gh1", level: 1 }),
      unit({ id: "t1", level: 2, parentId: "gh1" }),
    ];

    // undefined ("not filtering") is a different question from null ("units
    // with no parent") — conflating them would wrongly return t1 here.
    expect(unitOptions(units, 2, null)).toEqual([]);
  });

  test("not nested: omitted parentId returns every level-2 unit regardless of its parentId", () => {
    const units = [
      unit({ id: "t1", level: 2, parentId: null, name: "Tổ 1" }),
      unit({ id: "t2", level: 2, parentId: "some-other-id", name: "Tổ 2" }),
    ];

    expect(
      unitOptions(units, 2)
        .map((u) => u.id)
        .sort(),
    ).toEqual(["t1", "t2"]);
  });

  test("soft-deleted units never appear in options", () => {
    const units = [
      unit({ id: "active", level: 1 }),
      unit({ id: "gone", level: 1, deletedAt: "2026-01-01T00:00:00Z" }),
    ];

    expect(unitOptions(units, 1).map((u) => u.id)).toEqual(["active"]);
  });
});

describe("validateSelection", () => {
  const units = [
    unit({ id: "gh1", level: 1, name: "Giáo họ Thánh Tâm" }),
    unit({ id: "gh2", level: 1, name: "Giáo họ Mân Côi" }),
    unit({ id: "t1", level: 2, parentId: "gh1", name: "Tổ 1" }),
    unit({ id: "t2", level: 2, parentId: "gh2", name: "Tổ 2" }),
    unit({
      id: "gone",
      level: 2,
      parentId: "gh1",
      name: "Tổ cũ",
      deletedAt: "2026-01-01T00:00:00Z",
    }),
  ];

  test("neither set is valid, permanently (design §5)", () => {
    expect(
      validateSelection(nestedTaxonomy, units, { l1: null, l2: null }),
    ).toEqual({ blocked: false });
  });

  test("only level 1 set is valid", () => {
    expect(
      validateSelection(nestedTaxonomy, units, { l1: "gh1", l2: null }),
    ).toEqual({ blocked: false });
  });

  test("only level 2 set is valid", () => {
    expect(
      validateSelection(nestedTaxonomy, units, { l1: null, l2: "t1" }),
    ).toEqual({ blocked: false });
  });

  test("nested: level 2 belonging to the chosen level 1 is valid", () => {
    expect(
      validateSelection(nestedTaxonomy, units, { l1: "gh1", l2: "t1" }),
    ).toEqual({ blocked: false });
  });

  test("nested: level 2 belonging to a different level 1 is rejected", () => {
    expect(
      validateSelection(nestedTaxonomy, units, { l1: "gh1", l2: "t2" }),
    ).toEqual({ blocked: true, reason: "parish_unit_l2_not_in_l1" });
  });

  test("not nested: no relationship is checked, even for a mismatched pair", () => {
    expect(validateSelection(flatTaxonomy, units, { l1: "gh1", l2: "t2" })).toEqual(
      { blocked: false },
    );
  });

  test("an id that does not exist at all is rejected", () => {
    expect(
      validateSelection(nestedTaxonomy, units, { l1: "no-such-id", l2: null }),
    ).toEqual({ blocked: true, reason: "parish_unit_l1_not_found" });
  });

  test("a level-2 id that is actually a level-1 unit is rejected", () => {
    expect(
      validateSelection(nestedTaxonomy, units, { l1: null, l2: "gh1" }),
    ).toEqual({ blocked: true, reason: "parish_unit_l2_not_found" });
  });

  test("a level-1 id that is actually a level-2 unit is rejected", () => {
    expect(
      validateSelection(nestedTaxonomy, units, { l1: "t1", l2: null }),
    ).toEqual({ blocked: true, reason: "parish_unit_l1_not_found" });
  });

  test("a soft-deleted unit is still a valid selection — history, not an error", () => {
    expect(
      validateSelection(nestedTaxonomy, units, { l1: "gh1", l2: "gone" }),
    ).toEqual({ blocked: false });
  });

  test("nested is ignored when levels is 1 (design §3.2), even for a mismatched pair", () => {
    // A shelf that dropped from two levels to one keeps its `nested` flag
    // intact (design §3.2) rather than clearing it, so `levels: 1, nested:
    // true` is a real combination this function must handle, not a state
    // that cannot occur. Without gating on `levels === 2`, this mismatched
    // pair would be rejected even though the level-2 field no longer renders
    // at all while the shelf is at one level.
    const droppedToOneLevel: ParishTaxonomy = {
      levels: 1,
      nested: true,
      level1Label: "Giáo họ",
      level2Label: "Tổ",
    };
    expect(
      validateSelection(droppedToOneLevel, units, { l1: "gh1", l2: "t2" }),
    ).toEqual({ blocked: false });
  });
});

describe("describeSelection", () => {
  const units = [
    unit({ id: "gh1", level: 1, name: "Giáo họ Thánh Tâm" }),
    unit({ id: "t3", level: 2, parentId: "gh1", name: "Tổ 3" }),
    unit({
      id: "gone",
      level: 2,
      parentId: "gh1",
      name: "Tổ cũ",
      deletedAt: "2026-01-01T00:00:00Z",
    }),
  ];

  test("both set: smaller unit first, joined by · ", () => {
    expect(describeSelection(nestedTaxonomy, units, { l1: "gh1", l2: "t3" })).toBe(
      "Tổ 3 · Giáo họ Thánh Tâm",
    );
  });

  test("only level 1 set", () => {
    expect(describeSelection(nestedTaxonomy, units, { l1: "gh1", l2: null })).toBe(
      "Giáo họ Thánh Tâm",
    );
  });

  test("only level 2 set", () => {
    expect(describeSelection(nestedTaxonomy, units, { l1: null, l2: "t3" })).toBe(
      "Tổ 3",
    );
  });

  test("neither set is the empty string", () => {
    expect(describeSelection(nestedTaxonomy, units, { l1: null, l2: null })).toBe(
      "",
    );
  });

  test("a soft-deleted unit is still named — a membership's history, not an error", () => {
    expect(
      describeSelection(nestedTaxonomy, units, { l1: "gh1", l2: "gone" }),
    ).toBe("Tổ cũ · Giáo họ Thánh Tâm");
  });

  test("a shelf turned down to one level stops printing a leftover level-2 value", () => {
    expect(
      describeSelection(oneLevelTaxonomy, units, { l1: "gh1", l2: "t3" }),
    ).toBe("Giáo họ Thánh Tâm");
  });
});

describe("unitName", () => {
  const units = [unit({ id: "gh1", level: 1, name: "Giáo họ Thánh Tâm" })];

  test("returns the unit's name", () => {
    expect(unitName(units, "gh1")).toBe("Giáo họ Thánh Tâm");
  });

  test("returns Chưa có when the id is null", () => {
    expect(unitName(units, null)).toBe("Chưa có");
  });

  test("returns Chưa có when the id does not resolve to any unit", () => {
    expect(unitName(units, "no-such-id")).toBe("Chưa có");
  });
});

describe("hasVisibleLevel2", () => {
  test("false when the shelf has only one level", () => {
    const units = [unit({ id: "t1", level: 2, name: "Tổ 1" })];
    expect(hasVisibleLevel2(oneLevelTaxonomy, units)).toBe(false);
  });

  test("not nested: true when any live level-2 unit exists", () => {
    const units = [unit({ id: "t1", level: 2, name: "Tổ 1" })];
    expect(hasVisibleLevel2(flatTaxonomy, units)).toBe(true);
  });

  test("not nested: false when every level-2 unit is soft-deleted", () => {
    const units = [
      unit({
        id: "t1",
        level: 2,
        name: "Tổ 1",
        deletedAt: "2026-01-01T00:00:00Z",
      }),
    ];
    expect(hasVisibleLevel2(flatTaxonomy, units)).toBe(false);
  });

  test("nested: true when a live level-1 parent has a live level-2 child", () => {
    const units = [
      unit({ id: "gh1", level: 1, name: "Giáo họ Thánh Tâm" }),
      unit({ id: "t1", level: 2, parentId: "gh1", name: "Tổ 1" }),
    ];
    expect(hasVisibleLevel2(nestedTaxonomy, units)).toBe(true);
  });

  test("nested: false when a level-1 unit is deleted but its level-2 children are not (IMPORTANT 6's orphan case)", () => {
    // Reproduces the bug directly: the parent is gone, but nothing has
    // (yet) cascaded the deletion to its children, so a naive
    // `unitOptions(units, 2).length > 0` would wrongly say yes.
    const units = [
      unit({
        id: "gh1",
        level: 1,
        name: "Giáo họ Thánh Tâm",
        deletedAt: "2026-01-01T00:00:00Z",
      }),
      unit({ id: "t1", level: 2, parentId: "gh1", name: "Tổ 1" }),
    ];
    expect(hasVisibleLevel2(nestedTaxonomy, units)).toBe(false);
  });

  test("nested: false when there are no level-1 units at all yet", () => {
    expect(hasVisibleLevel2(nestedTaxonomy, [])).toBe(false);
  });
});
