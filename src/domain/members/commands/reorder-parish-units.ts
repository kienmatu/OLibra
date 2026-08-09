import { NotFound, ValidationFailed } from "../../kernel/errors";
import type { AuditEntry } from "../../kernel/audit";
import { requireIdentifiedActor } from "../../kernel/tenant";
import type { Command } from "../../kernel/unit-of-work";
import { unitNotFound } from "../parish-units";
import { requireSuperAdmin } from "../policy";

export interface ReorderParishUnitsInput {
  /** The units, in the order they should appear. All at one level, under one parent. */
  unitIds: string[];
}

/**
 * Sets `sort_order` for a set of units sharing one level and one parent (OPS
 * §4.5).
 *
 * **Why this command exists at all**, since a list of names could be sorted:
 * taxonomy design §7 refuses to parse a number out of a name. "Tổ 10" sorting
 * ahead of "Tổ 2" is "exactly the kind of detail that makes software feel
 * careless", and the fix is not to parse more cleverly but never to parse.
 * `unitOptions` orders by `sort_order` then by name, and this is the only thing
 * that writes the first of those.
 *
 * ── One statement, and the position comes from the array ─────────────────
 *
 * `unnest(...) with ordinality` turns the array into `(id, ord)` pairs, so the
 * whole reorder is one `UPDATE` whose ordering is the caller's array rather than
 * anything derived from the rows. A loop of N updates would be N statements
 * inside the transaction, each individually guarded, and would let a partial
 * failure leave a half-ordered list; it would also make "position" a number this
 * command computed rather than a position the caller expressed.
 *
 * `sort_order` starts at 1 rather than 0, because `ordinality` does. Nothing
 * depends on the base — `unitOptions` compares, it does not index — and a
 * command that subtracted one to make the numbers start at zero would be doing
 * arithmetic for cosmetics.
 *
 * There is no `where bookshelf_id` clause. RLS's `using` already restricts this
 * to `ctx.bookshelfId`, and a hand-written second copy of the tenant predicate
 * is correct only for as long as somebody keeps writing it —
 * `../parish-context.ts` records the same reasoning for the same table.
 *
 * ── Every id must resolve, and they must share a level and a parent ──────
 *
 * OPS §4.5 gives both failure modes: the not-found codes "for any id in the list
 * that does not resolve", and `validation_failed` when "the ids do not all share
 * one level and one parent". The second is checked even on a flat shelf, where
 * every level-2 unit's parent is null and the check therefore passes trivially —
 * gating it on `taxonomy.nested` would make the rule depend on a setting a
 * different command can change between two reorders, and the honest reading of
 * "share one parent" needs no such qualification when the shared parent is null.
 *
 * ── One audit entry per unit that actually moved ─────────────────────────
 *
 * `Command`'s return type already takes an `AuditEntry[]`, and `audit_log
 * .entity_id` is a bare uuid — so a single entry for a reorder would have to
 * name one arbitrary unit as its subject. Per-unit entries each name a real
 * subject and carry the two numbers BR §14's browser can render.
 *
 * Units whose position did not change contribute no entry, and a reorder that
 * changes nothing therefore writes none at all. That is deliberate: an audit
 * entry claiming a change nobody made is the thing `empty_proposal` exists to
 * prevent elsewhere in this slice, and OPS §4.5 lists no refusal for a no-op
 * reorder — dragging a row and dropping it back where it was is not an error.
 */
export const reorderParishUnits: Command<ReorderParishUnitsInput, void> = async (
  tx,
  ctx,
  input,
) => {
  requireSuperAdmin(ctx);
  requireIdentifiedActor(ctx);

  const unitIds = input.unitIds ?? [];
  if (unitIds.length === 0) {
    throw new ValidationFailed("validation_failed", "unitIds");
  }
  if (new Set(unitIds).size !== unitIds.length) {
    // A repeated id would make `unnest` produce two positions for one row and
    // leave which one wins to the planner.
    throw new ValidationFailed("validation_failed", "unitIds");
  }

  const rows = await tx<
    { id: string; level: number; parent_id: string | null; sort_order: number }[]
  >`
    select id, level, parent_id, sort_order
      from parish_units
     where id = any(${unitIds}::uuid[]) and deleted_at is null
  `;

  const byId = new Map(rows.map((r) => [r.id, r]));
  const missing = unitIds.find((id) => !byId.has(id));
  if (missing !== undefined) {
    // The level of an id that resolved to nothing is unknown; every id that
    // *did* resolve shares one level by the check below, so that level is the
    // best available guess at what the missing one was meant to be.
    throw new NotFound(unitNotFound(rows[0]?.level === 2 ? 2 : null));
  }

  const level = rows[0].level;
  const parentId = rows[0].parent_id;
  const mixed = rows.some((r) => r.level !== level || r.parent_id !== parentId);
  if (mixed) {
    throw new ValidationFailed("validation_failed", "unitIds");
  }

  // ── The list must be the *whole* group ───────────────────────────────────
  //
  // Mixed, duplicated, empty and unresolvable lists were all refused; a
  // **partial** one was not, and it is the one that produces the outcome this
  // command's docstring exists to prevent. Three level-1 units at 1/2/3
  // reordered with `[C, A]` end at `C=1, A=2, B=2` — a tie — and `unitOptions`
  // breaks ties by name, so the shelf silently falls back to "Tổ 10 before
  // Tổ 2": exactly the ordering somebody added `sort_order` to escape, arrived
  // at by a command that reported success.
  //
  // Refused rather than repaired, and the choice is deliberate. Appending the
  // omitted units after the named ones would be inventing a placement nobody
  // expressed — this command's whole argument is that position comes from the
  // caller's array and is never computed here — and a caller that omitted a
  // unit did not decide it should go last; it more likely never knew about it,
  // because somebody else created one while the screen was open. That is a
  // stale-list problem, and the honest answer to a stale list is to say so.
  // `validation_failed` is OPS §4.5's own sentence for this command, "Vui lòng
  // kiểm tra lại thông tin.", and a screen that re-reads and re-renders is the
  // right recovery.
  //
  // Counted in the database rather than from the caller's array, and scoped by
  // RLS to this shelf. `is not distinct from` because the shared parent is null
  // for every level-1 unit and for every level-2 unit on a flat shelf, and
  // `= null` is never true.
  const [siblings] = await tx<{ n: number }[]>`
    select count(*)::int as n
      from parish_units
     where level = ${level}
       and parent_id is not distinct from ${parentId}
       and deleted_at is null
  `;
  if (Number(siblings.n) !== unitIds.length) {
    throw new ValidationFailed("validation_failed", "unitIds");
  }

  await tx`
    with ordered as (
      select id, ord from unnest(${unitIds}::uuid[]) with ordinality as t(id, ord)
    )
    update parish_units p
       set sort_order = o.ord::int
      from ordered o
     where p.id = o.id and p.deleted_at is null
  `;

  const audit: AuditEntry[] = unitIds.flatMap((id, index) => {
    const before = byId.get(id)!.sort_order;
    const after = index + 1;
    if (Number(before) === after) return [];
    return [
      {
        action: "parish_unit.reordered",
        entityType: "parish_unit",
        entityId: id,
        before: { sort_order: Number(before) },
        after: { sort_order: after },
      },
    ];
  });

  return { result: undefined, audit };
};
