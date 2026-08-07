/**
 * How a parish subdivides its people, made configurable per bookshelf
 * instead of assumed (design: 2026-08-08-parish-taxonomy-design.md).
 *
 * Six screens read this shape and two write it. Without one module each
 * would re-derive "which pickers do I show", "which units belong under this
 * parent" and "how do I write a person's parish line" — and they would
 * drift, the way "Tổ 3 · Giáo họ Thánh Tâm" used to be written by hand into
 * five different pages. This module is the single place those rules live,
 * framework-free so the same logic runs in the browser (a picker) and on the
 * server (the command that must not trust the picker).
 */
import type { Block } from "../kernel/block";
import type { ErrorCode } from "../kernel/errors";

export type ParishTaxonomy = {
  levels: 1 | 2;
  nested: boolean;
  level1Label: string;
  level2Label: string;
};

export type ParishUnit = {
  id: string;
  level: 1 | 2;
  parentId: string | null;
  name: string;
  sortOrder: number;
  /**
   * Soft-delete marker (design §7: no hard delete of a unit a member
   * references). Not part of the illustrative shape in design §6.1, but
   * required by it in substance: §6.1 itself says a deleted unit "stops
   * being offered in pickers and keeps describing the people already in
   * it", and a function cannot honour that split without knowing which
   * units are deleted.
   */
  deletedAt: string | null;
};

/** One level, "Tổ", not nested. What a brand-new shelf gets (design §3.2). */
export function defaultTaxonomy(): ParishTaxonomy {
  return {
    levels: 1,
    nested: false,
    level1Label: "Tổ",
    // Inert while levels is 1 — no level-2 picker renders to show it — but
    // the type has no optional fields, so a default has to pick something
    // rather than leave the field to whatever the caller happens to supply.
    level2Label: "Tổ",
  };
}

/**
 * The options a picker should offer, ordered by sortOrder then name.
 *
 * `parentId` distinguishes two different questions a caller can be asking,
 * and conflating them is exactly the bug design §7 warns against elsewhere
 * ("no inference from a name"):
 *
 * - omitted (`undefined`): do not filter by parent at all. Used for level 1
 *   always, and for level 2 when the shelf is *not* nested — every level-2
 *   unit is a candidate regardless of what its `parentId` happens to hold.
 * - `null`: filter to units whose `parentId` is exactly `null`. Used for
 *   level 2 when the shelf *is* nested but no level-1 unit is chosen yet —
 *   since every nested level-2 unit has a real parent, this correctly
 *   yields no options until one is picked.
 * - a unit id: filter to that unit's children. Used for level 2 when nested
 *   and a level-1 unit is chosen.
 *
 * Deleted units never appear here (design §7): a unit that stopped being
 * offered must not still be offered.
 *
 * Order is `sortOrder` then name, never a number parsed out of the name
 * (design §7): "Tổ 10" sorting before "Tổ 2" because of the digits is the
 * exact carelessness `sort_order` exists to prevent, and the fix is not to
 * parse more cleverly but to never parse at all.
 */
export function unitOptions(
  units: ParishUnit[],
  level: 1 | 2,
  parentId?: string | null,
): ParishUnit[] {
  return units
    .filter((unit) => unit.deletedAt === null)
    .filter((unit) => unit.level === level)
    .filter((unit) => parentId === undefined || unit.parentId === parentId)
    .sort(
      (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "vi"),
    );
}

const ok: Block = { blocked: false };
const no = (reason: ErrorCode): Block => ({ blocked: true, reason });

/**
 * INV (design §4): when nested, l2 must belong to l1. Same `Block` shape
 * circulation's lending predicates use, so the picker and the command that
 * writes a membership share one implementation of the rule instead of two
 * that can disagree.
 *
 * Deleted units still count as "exists" here on purpose (design §7): a
 * membership already pointing at a since-deleted unit is history, not an
 * error, and re-validating an unchanged selection (e.g. on
 * `ApproveProfileChange`) must not start failing the day a manager retires
 * that unit.
 */
export function validateSelection(
  taxonomy: ParishTaxonomy,
  units: ParishUnit[],
  selection: { l1: string | null; l2: string | null },
): Block {
  const { l1, l2 } = selection;

  if (l1 !== null) {
    const unit = units.find((u) => u.id === l1);
    if (!unit || unit.level !== 1) return no("parish_unit_l1_not_found");
  }

  if (l2 !== null) {
    const unit = units.find((u) => u.id === l2);
    if (!unit || unit.level !== 2) return no("parish_unit_l2_not_found");
  }

  // Not nested: §4 says no relationship is checked at all, even if both
  // happen to be set. Either null: valid, permanently (design §5) — there is
  // nothing to relate.
  if (taxonomy.nested && l1 !== null && l2 !== null) {
    const l2Unit = units.find((u) => u.id === l2)!;
    if (l2Unit.parentId !== l1) return no("parish_unit_l2_not_in_l1");
  }

  return ok;
}

/**
 * "Tổ 3 · Giáo họ Thánh Tâm", or "" when nothing is set.
 *
 * Smaller unit first, matching how the existing screens read a reader's
 * parish line. Looks a selected id up regardless of `deletedAt`: a person's
 * recorded parish is history, and the unit only stopped being *offered*, not
 * stopped existing (design §7).
 *
 * `taxonomy.levels` gates whether the level-2 part is shown at all, so a
 * shelf that has been turned down to one level does not keep printing a
 * leftover level-2 value from before the change — the value itself is left
 * alone (design §3.2: dropping to one level and returning to two must find
 * the previous choice intact), only its display is suppressed.
 */
export function describeSelection(
  taxonomy: ParishTaxonomy,
  units: ParishUnit[],
  selection: { l1: string | null; l2: string | null },
): string {
  const parts: string[] = [];

  if (taxonomy.levels === 2 && selection.l2 !== null) {
    const unit = units.find((u) => u.id === selection.l2);
    if (unit) parts.push(unit.name);
  }

  if (selection.l1 !== null) {
    const unit = units.find((u) => u.id === selection.l1);
    if (unit) parts.push(unit.name);
  }

  return parts.join(" · ");
}
