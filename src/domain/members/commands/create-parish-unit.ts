import { isUniqueViolation, NotFound, ValidationFailed } from "../../kernel/errors";
import { requireIdentifiedActor } from "../../kernel/tenant";
import type { Command } from "../../kernel/unit-of-work";
import { loadParishContext } from "../parish-context";
import { blank, requireSuperAdmin } from "../policy";

export interface CreateParishUnitInput {
  level: 1 | 2;
  /** An existing **live level-1** unit of this shelf. Required only when nested and level 2. */
  parentId?: string | null;
  name: string;
  sortOrder?: number;
}

/**
 * Adds one parish unit (OPS §4.5; BR §5.6) — the "Thêm" row at the foot of each
 * unit list on the settings screen.
 *
 * ── The check the database looks like it makes and does not ──────────────
 *
 * `parish_units_l1_has_no_parent` is `check (level = 2 or parent_id is null)`.
 * Read quickly it looks like the hierarchy's integrity constraint; it is half of
 * one. It forbids a **level-1** unit having a parent, and says nothing whatever
 * about what a level-2 unit's parent is — so `parent_id` pointing at another
 * level-2 unit satisfies every constraint on the table. The composite foreign
 * key added by `20260808_04_composite_tenant_fks.sql` gets the *shelf* right and
 * has no opinion about the *level* either.
 *
 * A level-2 unit parented to a level-2 unit is not a loud failure. `unitOptions`
 * filters level-2 units by `parentId`, so the malformed child simply never
 * appears under any level-1 parent and `hasVisibleLevel2` reports the shelf has
 * no level-2 field to show — a unit that exists, is live, is offered nowhere,
 * and looks in the database exactly like one that should be. So the level is
 * checked here, in the command, in the same transaction as the insert, which is
 * the same split DATABASE.md §7 already documents for the nesting rule: enforced
 * by the application, and labelled as such rather than assumed structural.
 *
 * ── The duplicate name, which has no failure mode in the catalogue ───────
 *
 * `parish_units_name_unique_in_scope` is not the table constraint the taxonomy
 * design shows. `20260808_03_soft_delete_aware_uniqueness.sql` dropped that and
 * created a **partial unique index** on `(bookshelf_id, level, parent_id, name)
 * nulls not distinct where deleted_at is null` — so a live duplicate raises
 * `23505`, and a soft-deleted unit frees its name for reuse, which is the whole
 * point of the change.
 *
 * **OPS §4.5 lists no failure mode for that `23505`.** Its `validation_failed`
 * covers "empty `name`, `parentId` supplied for a level-1 unit, or `level`
 * outside `{1, 2}`". The interim, per B2b's plan §8 item 4, is to catch the
 * unique violation and raise this command's own `validation_failed` — "Vui lòng
 * kiểm tra lại thông tin.", vague but honest — rather than let a raw driver
 * error out, which OPS §2 forbids and which B1 shipped once already. The
 * specific sentence is the product owner's to write.
 *
 * ── `sortOrder` defaults to 0, not to "the end of the list" ──────────────
 *
 * The column's own default, and deliberately not a `max(sort_order) + 1` this
 * command derives. Taxonomy design §7 is explicit that ordering is *explicit*
 * — "the system never parses 'Tổ 3' to derive a number or an ordering" — and
 * `ReorderParishUnits` is the command that owns it. A clever default here would
 * be a second, invisible source of order for `unitOptions` to sort by, and
 * `unitOptions` breaks ties on the name, so two units at 0 order predictably.
 */
export const createParishUnit: Command<
  CreateParishUnitInput,
  { parishUnitId: string }
> = async (tx, ctx, input) => {
  requireSuperAdmin(ctx);
  // Both, always. `requireSuperAdmin` ranks a role, and `systemContext` holds
  // the top rank with a null `userId` — see that gate's docstring.
  requireIdentifiedActor(ctx);

  if (input.level !== 1 && input.level !== 2) {
    throw new ValidationFailed("validation_failed", "level");
  }
  if (blank(input.name)) {
    throw new ValidationFailed("validation_failed", "name");
  }
  const name = input.name.trim();
  const parentId = input.parentId ?? null;

  if (input.level === 1 && parentId !== null) {
    // OPS §4.5 lists this among `validation_failed`'s cases by name. It is also
    // the one the table itself would catch (`parish_units_l1_has_no_parent`),
    // and it is checked here anyway so the answer is a sentence rather than a
    // `23514` from inside the transaction.
    throw new ValidationFailed("validation_failed", "parentId");
  }

  if (input.level === 2) {
    const { taxonomy } = await loadParishContext(tx, ctx);
    if (taxonomy.nested && parentId === null) {
      // OPS §4.5: `parentId` is "required only when the shelf's taxonomy is
      // nested and `level` is 2". On a flat shelf a level-2 unit legitimately
      // has no parent — `unitOptions` is called without a parent filter there.
      throw new ValidationFailed("validation_failed", "parentId");
    }
  }

  if (parentId !== null) {
    // `level = 1` is the clause this whole command exists for. RLS supplies the
    // shelf; `deleted_at is null` refuses a retired parent, because adding a
    // child to a unit that has stopped being offered creates precisely the
    // orphan `hasVisibleLevel2` documents having to defend against.
    const [parent] = await tx<{ id: string }[]>`
      select id from parish_units
       where id = ${parentId} and level = 1 and deleted_at is null
    `;
    if (!parent) throw new NotFound("parish_unit_l1_not_found");
  }

  try {
    const [row] = await tx<{ id: string }[]>`
      insert into parish_units (bookshelf_id, level, parent_id, name, sort_order)
      values (${ctx.bookshelfId}, ${input.level}, ${parentId}, ${name},
              ${input.sortOrder ?? 0})
      returning id
    `;

    return {
      result: { parishUnitId: row.id },
      audit: {
        action: "parish_unit.created",
        entityType: "parish_unit",
        entityId: row.id,
        after: {
          level: input.level,
          parent_id: parentId,
          name,
          sort_order: input.sortOrder ?? 0,
        },
      },
    };
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw new ValidationFailed("validation_failed", "name");
    }
    throw e;
  }
};
