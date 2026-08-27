import type { ErrorCode } from "../kernel/errors";
import type { Tx } from "../kernel/unit-of-work";

/**
 * What the four unit-editing commands share: how a unit row is read, and which
 * of OPS §4.5's two "not found" codes a missing one gets.
 *
 * Deliberately *not* in `./parish-taxonomy.ts`. That module is pure and runs in
 * the browser — it answers "which options should this picker offer" from a list
 * somebody already loaded. This one takes a `Tx` and answers "does this id name
 * a live unit of the shelf I am scoped to", which is a question only the server
 * can be trusted to ask. Same split as `./pending-proposal.ts` against
 * `./profile-proposals.ts`.
 */

/** A `parish_units` row, as the commands need it. */
export interface LiveUnit {
  id: string;
  level: 1 | 2;
  parentId: string | null;
  name: string;
  sortOrder: number;
}

/**
 * Which of OPS §4.5's two sentences a missing unit gets — "Đơn vị bậc 1 đã chọn
 * không tồn tại." or "Đơn vị bậc 2 đã chọn không tồn tại."
 *
 * OPS lists both codes for `RenameParishUnit`, `ReorderParishUnits` and
 * `DeleteParishUnit`, gloss "`unitId` does not resolve to a live unit at its
 * recorded level" — which presumes a level is known. **An id that names no row
 * at all has no level**, and that case is real: another shelf's unit id, a
 * hard-deleted row, a typed uuid. `null` is therefore level 1's sentence, and
 * that is a choice rather than a derivation.
 *
 * The alternative would be a third code — but OPS §4.5 names no failure mode for
 * "that id names nothing", and an `ErrorCode` may not be invented with a
 * Vietnamese sentence nobody wrote (the rule `../kernel/tenant.ts` states and B1
 * established). Level 1's sentence is the one that is right whenever the level
 * *is* known and the unit is a level-1 unit, and is merely imprecise otherwise;
 * a level-2 id that names nothing is reported as a missing level-1 unit, which
 * is a worse message than the truth and a better one than a raw 500.
 */
export function unitNotFound(level: 1 | 2 | null): ErrorCode {
  return level === 2 ? "parish_unit_l2_not_found" : "parish_unit_l1_not_found";
}

/**
 * A unit of this shelf by id, live or soft-deleted, or `null` for an id that
 * names nothing visible.
 *
 * Deleted rows are returned rather than filtered, because the callers need the
 * level of a unit they are about to *refuse*: `unitNotFound` above gives a
 * better sentence when the level is known, and a soft-deleted unit is exactly
 * the case where it is. Each caller applies its own liveness rule.
 *
 * RLS scopes this to `ctx.bookshelfId` — there is no `where bookshelf_id`
 * clause, and there must not be one. A hand-written copy of the tenant
 * predicate is correct only for as long as somebody keeps writing it, which is
 * the reasoning `./parish-context.ts` already records for the same table.
 */
export async function readUnit(
  tx: Tx,
  id: string,
): Promise<(LiveUnit & { deletedAt: Date | null }) | null> {
  const [row] = await tx<
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
      from parish_units
     where id = ${id}
  `;
  if (!row) return null;
  return {
    id: row.id,
    level: row.level === 2 ? 2 : 1,
    parentId: row.parent_id,
    name: row.name,
    sortOrder: Number(row.sort_order),
    deletedAt: row.deleted_at,
  };
}
