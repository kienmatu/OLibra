import { isUniqueViolation, NotFound, ValidationFailed } from "../../kernel/errors";
import { requireIdentifiedActor } from "../../kernel/tenant";
import type { Command } from "../../kernel/unit-of-work";
import { readUnit, unitNotFound } from "../parish-units";
import { blank, requireSuperAdmin } from "../policy";

export interface RenameParishUnitInput {
  unitId: string;
  name: string;
}

/**
 * Changes a unit's name (OPS §4.5) — "Đổi tên" on its row.
 *
 * **`sort_order` and `parent_id` are not in the statement at all.** OPS is
 * explicit that a rename is a label change only, and BR §5.6's whole argument
 * for units-as-rows is that renaming stays cheap because every membership
 * references the unit by id rather than by its name. Writing the other two
 * columns back with values this command read a moment earlier is `updateBook`'s
 * lesson (B1, `65d46e1`): a whole-row rewrite silently discards a concurrent
 * reorder committed between the read and the write.
 *
 * **A duplicate name is `validation_failed`, and that is an interim.** See
 * `./create-parish-unit.ts` for the whole of it: the index is partial and
 * soft-delete-aware, a live duplicate raises `23505`, and OPS §4.5 names no
 * failure mode for it. Caught here rather than allowed to escape as a raw
 * driver error.
 *
 * **A rename to the same name is not a failure and writes an audit entry.**
 * There is no `empty_proposal` equivalent in OPS §4.5, and unlike a profile
 * correction — where BR §14's browser would carry an entry claiming a change
 * nobody made — the audit `before`/`after` here name the same string on both
 * sides, which reads as exactly what happened. Refusing it would need a
 * sentence nobody has written.
 */
export const renameParishUnit: Command<RenameParishUnitInput, void> = async (
  tx,
  ctx,
  input,
) => {
  requireSuperAdmin(ctx);
  requireIdentifiedActor(ctx);

  if (blank(input.name)) {
    throw new ValidationFailed("validation_failed", "name");
  }
  const name = input.name.trim();

  // Read first so the refusal can name the right level — see `unitNotFound`.
  // RLS has already scoped this to the shelf, so another shelf's unit is
  // indistinguishable from one that does not exist, which is the answer that
  // does not confirm it exists.
  const unit = await readUnit(tx, input.unitId);
  if (!unit || unit.deletedAt !== null) {
    throw new NotFound(unitNotFound(unit?.level ?? null));
  }

  try {
    await tx`
      update parish_units
         set name = ${name}
       where id = ${unit.id} and deleted_at is null
    `;
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw new ValidationFailed("validation_failed", "name");
    }
    throw e;
  }

  return {
    result: undefined,
    audit: {
      action: "parish_unit.renamed",
      entityType: "parish_unit",
      entityId: unit.id,
      before: { name: unit.name },
      after: { name },
    },
  };
};
