import type { AuditEntry } from "../../kernel/audit";
import { NotFound } from "../../kernel/errors";
import { requireIdentifiedActor } from "../../kernel/tenant";
import type { Command } from "../../kernel/unit-of-work";
import { readUnit, unitNotFound } from "../parish-units";
import { requireSuperAdmin } from "../policy";

export interface DeleteParishUnitInput {
  unitId: string;
}

/**
 * Soft-deletes a unit, and its live level-2 children when it is a level-1 unit
 * (OPS §4.5; taxonomy design §7).
 *
 * ── "Soft" is not a convention here, it is a privilege ───────────────────
 *
 * `0010_rls.sql:27` grants `olibra_app` `select, insert, update` and **no
 * delete** on these tables, so an implementer who writes `delete from
 * parish_units` gets a privilege error rather than a silent pass. The design
 * wanted the soft delete anyway (BR §5.6, §11): "a membership pointing at a
 * deleted unit is history, not an error" — the unit stops being *offered* and
 * keeps describing the people already in it. `unitOptions` filters on
 * `deletedAt`; `describeSelection`, `unitName` and `validateSelection`
 * deliberately do not, which is what keeps `ApproveProfileChange` working the
 * day a manager retires a unit somebody is still recorded in.
 *
 * ── The cascade, and what breaks without it ──────────────────────────────
 *
 * Deleting a level-1 unit soft-deletes its live level-2 children in the same
 * transaction. Taxonomy design §7 argues it as meaning — "a tổ inside a deleted
 * giáo họ is not a place anyone belongs" — and `hasVisibleLevel2`
 * (`../parish-taxonomy.ts`) documents the mechanical consequence of skipping it:
 * the orphaned children keep `unitOptions(units, 2)` non-empty, so the level-2
 * field claims it has something to show, while the grouped rendering hangs
 * options under live level-1 parents and finds none — a `<select>` containing
 * nothing but "— Không chọn —", which is BR §5.6's "zero, one or two" promise
 * broken by an implementation detail rather than by a real absence of units.
 *
 * A level-2 unit has no children and cascades to nothing.
 *
 * `deleted_at` comes from `ctx.clock`, not from a `now()` the database would
 * supply, for the reason DATABASE.md §6 gives: it is a timestamp the domain
 * means, and a test on a `fixedClock` must be able to place it.
 *
 * ── One audit entry per row ──────────────────────────────────────────────
 *
 * OPS §4.5 asks for exactly this: `parish_unit.deleted`, "one entry for the unit
 * itself, plus one per cascaded level-2 child". `Command`'s return type already
 * takes an `AuditEntry[]`, and `audit_log.entity_id` is a bare uuid — a single
 * entry would have to name one of the deleted units and stay silent about the
 * rest, which is precisely the history BR §11 wants kept.
 */
export const deleteParishUnit: Command<
  DeleteParishUnitInput,
  { deletedUnitIds: string[] }
> = async (tx, ctx, input) => {
  requireSuperAdmin(ctx);
  requireIdentifiedActor(ctx);

  const unit = await readUnit(tx, input.unitId);
  if (!unit || unit.deletedAt !== null) {
    // Already-deleted is refused rather than treated as idempotent. OPS §4.5
    // gives this command only the two not-found sentences, and a second "Xoá"
    // on a row that has already gone is a screen showing stale state — telling
    // the caller the unit is not there is the honest answer to that.
    throw new NotFound(unitNotFound(unit?.level ?? null));
  }

  const now = ctx.clock.now();

  await tx`
    update parish_units
       set deleted_at = ${now}
     where id = ${unit.id} and deleted_at is null
  `;

  const children =
    unit.level === 1
      ? await tx<{ id: string; name: string }[]>`
          update parish_units
             set deleted_at = ${now}
           where parent_id = ${unit.id} and level = 2 and deleted_at is null
          returning id, name
        `.allowZero()
      : [];

  const entry = (id: string, name: string, cascaded: boolean): AuditEntry => ({
    action: "parish_unit.deleted",
    entityType: "parish_unit",
    entityId: id,
    before: { name, deleted_at: null },
    // `cascaded` is on the entry rather than in a second action name, so BR
    // §13.2's oversight view can still filter every retirement of a unit with
    // one name while a reader of a single entry can see it was not clicked.
    after: { name, deleted_at: now.toISOString(), cascaded },
  });

  return {
    result: { deletedUnitIds: [unit.id, ...children.map((c) => c.id)] },
    audit: [
      entry(unit.id, unit.name, false),
      ...children.map((c) => entry(c.id, c.name, true)),
    ],
  };
};
