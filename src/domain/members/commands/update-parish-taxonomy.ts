import { ValidationFailed } from "../../kernel/errors";
import { requireIdentifiedActor } from "../../kernel/tenant";
import type { Command } from "../../kernel/unit-of-work";
import { loadParishContext } from "../parish-context";
import type { ParishTaxonomy } from "../parish-taxonomy";
import { blank, requireSuperAdmin } from "../policy";

export interface UpdateParishTaxonomyInput {
  levels?: 1 | 2;
  nested?: boolean;
  level1Label?: string;
  level2Label?: string;
}

/**
 * Sets a shelf's level count, each level's labels, and whether the smaller level
 * nests inside the bigger (OPS §4.5; BR §5.6) — the *Phân chia giáo xứ* section
 * of the settings screen.
 *
 * ── It never resets a field it was not asked to change ───────────────────
 *
 * OPS §4.5 states this as an invariant, with `nested` as the example: "`nested`
 * is stored even when `levels` is 1 rather than cleared, so a shelf that drops
 * to one level and later returns to two finds its previous choice intact". Two
 * shipped functions depend on it being true rather than merely tidy —
 * `validateSelection` gates its nesting rule on `levels === 2 && nested`
 * precisely because `nested` can survive a drop to one level, and
 * `describeSelection` suppresses a leftover level-2 value's *display* while
 * leaving the value alone. Both would be wrong if this command cleared the flag.
 *
 * So every input is optional and the stored object is read, merged and written
 * back. The read goes through `loadParishContext` rather than reaching into
 * `settings` directly, which means a shelf that has never been configured merges
 * onto `defaultTaxonomy()` — one level, "Tổ", not nested — instead of onto a
 * `{}` that would leave a label undefined the moment a screen rendered it.
 *
 * ── snake_case in the column, camelCase in the type ──────────────────────
 *
 * `bookshelves.settings->'parish_taxonomy'` holds `level1_label` and
 * `level2_label`; `ParishTaxonomy` says `level1Label`. That translation happens
 * in `../parish-context.ts` and here, and nowhere else — the seed writes the
 * snake_case spelling too, verified live, and a third place doing the
 * translation is how the two spellings end up disagreeing.
 *
 * ── `settings || jsonb`, not a whole-column write ────────────────────────
 *
 * `settings` is a free-form object that holds more than the taxonomy. The write
 * merges at the top level so a key this command knows nothing about survives it,
 * which is `updateBook`'s lesson (B1) applied to a jsonb column: reading a
 * document into JavaScript and writing the whole thing back discards a
 * concurrent edit to a part this call never touched.
 */
export const updateParishTaxonomy: Command<
  UpdateParishTaxonomyInput,
  void
> = async (tx, ctx, input) => {
  requireSuperAdmin(ctx);
  requireIdentifiedActor(ctx);

  if (input.levels !== undefined && input.levels !== 1 && input.levels !== 2) {
    throw new ValidationFailed("validation_failed", "levels");
  }
  if (input.level1Label !== undefined && blank(input.level1Label)) {
    throw new ValidationFailed("validation_failed", "level1Label");
  }
  if (input.level2Label !== undefined && blank(input.level2Label)) {
    throw new ValidationFailed("validation_failed", "level2Label");
  }
  if (input.nested !== undefined && typeof input.nested !== "boolean") {
    throw new ValidationFailed("validation_failed", "nested");
  }

  const { taxonomy: before } = await loadParishContext(tx, ctx);
  const after: ParishTaxonomy = {
    levels: input.levels ?? before.levels,
    nested: input.nested ?? before.nested,
    level1Label: input.level1Label?.trim() ?? before.level1Label,
    level2Label: input.level2Label?.trim() ?? before.level2Label,
  };

  // `bookshelves_tenant` is `id = <the GUC>` for both `using` and
  // `with check`, so this updates this shelf's row and no other without a
  // hand-written `where id = ctx.bookshelfId` that would be a second copy of
  // the scoping. The kernel's zero-row guard turns a mis-scoped call into
  // `write_target_not_found` rather than a silent success.
  await tx`
      update bookshelves
         set settings = settings || ${tx.json({
           parish_taxonomy: {
             levels: after.levels,
             nested: after.nested,
             level1_label: after.level1Label,
             level2_label: after.level2Label,
           },
         })}
    `;

  return {
    result: undefined,
    audit: {
      action: "parish_taxonomy.updated",
      entityType: "bookshelf",
      entityId: ctx.bookshelfId,
      before: { ...before },
      after: { ...after },
    },
  };
};
