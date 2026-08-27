import type { TenantContext } from "../kernel/tenant";
import type { Tx } from "../kernel/unit-of-work";
import {
  defaultTaxonomy,
  type ParishTaxonomy,
  type ParishUnit,
} from "./parish-taxonomy";

/**
 * A shelf's taxonomy and its units, in the shapes `./parish-taxonomy.ts`
 * already defines — the one place in the codebase that knows how those shapes
 * are spelled in the database.
 *
 * Two translations happen here and nowhere else:
 *
 * 1. **snake_case to camelCase.** `bookshelves.settings.parish_taxonomy` holds
 *    `level1_label`/`level2_label` (design §3.2, and what `src/db/seed.ts`
 *    writes — verified live). `ParishTaxonomy` says `level1Label`. Doing this
 *    in each caller is how the two spellings end up disagreeing.
 * 2. **`deleted_at` timestamp to `deletedAt: string | null`.** The pure module
 *    only ever asks whether it is null, so the value is carried as an ISO
 *    string rather than a `Date` the domain would then have to compare.
 */
export interface ParishContext {
  taxonomy: ParishTaxonomy;
  /**
   * **Every** unit of this shelf, soft-deleted ones included.
   *
   * `validateSelection` and `describeSelection` both need the deleted ones
   * (design §7: a membership pointing at a retired unit is history, not an
   * error, and re-validating an unchanged selection must not start failing the
   * day a manager retires that unit). Filtering to what a picker may *offer*
   * is `unitOptions`' job, which `./queries/get-parish-units.ts` calls.
   */
  units: ParishUnit[];
}

type TaxonomyJson = {
  levels?: unknown;
  nested?: unknown;
  level1_label?: unknown;
  level2_label?: unknown;
} | null;

/**
 * Reads the stored object defensively rather than trusting `jsonb`.
 *
 * `settings` is free-form JSON with no check constraint behind it, and B2b's
 * `UpdateParishTaxonomy` is not the only thing that could ever write it (the
 * seed does, a future import might). A `levels` of `3` or a missing label
 * would otherwise propagate into `hasVisibleLevel2` and render a picker for a
 * level that does not exist. Anything unreadable falls back to that field's
 * default rather than throwing: a registration must not fail because a
 * settings blob is malformed (BR §5.6).
 */
function toTaxonomy(raw: TaxonomyJson): ParishTaxonomy {
  const fallback = defaultTaxonomy();
  if (!raw || typeof raw !== "object") return fallback;
  const levels = raw.levels === 2 ? 2 : 1;
  const label = (v: unknown, or: string) =>
    typeof v === "string" && v.trim() !== "" ? v : or;
  return {
    levels,
    nested: raw.nested === true,
    level1Label: label(raw.level1_label, fallback.level1Label),
    level2Label: label(raw.level2_label, fallback.level2Label),
  };
}

export async function loadParishContext(
  tx: Tx,
  ctx: TenantContext,
): Promise<ParishContext> {
  // **`where id` is required here, and this used to say the opposite.**
  //
  // The claim it carried was that `bookshelves_tenant` is `id = <the GUC>`, so
  // an unqualified select reads this shelf's row and no other, and a
  // hand-written predicate would be a second copy of the scoping. That was true
  // when it was written and is not true now:
  // `20260808_12_bookshelves_public_read.sql` added a second **permissive**
  // policy, `using (status = 'active' and deleted_at is null)`, and Postgres ORs
  // permissive policies covering the same command. So a plain
  // `select ... from bookshelves` as `olibra_app` returns **every active shelf
  // in the system**, and `[shelf]` was whichever row the planner happened to
  // return first.
  //
  // That is not a hypothetical: it was caught by a test in which two shelves,
  // one nested and one flat, disagreed about whether `CreateParishUnit` may omit
  // a parent — the flat shelf was refused on the nested one's taxonomy. Every
  // caller is affected the same way, `ApproveProfileChange`'s `validateSelection`
  // included, which would have been checking a reader's parish selection against
  // another parish's nesting rule.
  //
  // The units query below needs no such predicate: `parish_units` carries only
  // the tenant policy from `0010_rls.sql`, with no public read beside it.
  const [shelf] = await tx<{ parish_taxonomy: TaxonomyJson }[]>`
    select settings->'parish_taxonomy' as parish_taxonomy
      from bookshelves where id = ${ctx.bookshelfId}
  `;

  const rows = await tx<
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
    order by level, sort_order, name
  `;

  return {
    taxonomy: toTaxonomy(shelf?.parish_taxonomy ?? null),
    units: rows.map((r) => ({
      id: r.id,
      level: r.level === 2 ? 2 : 1,
      parentId: r.parent_id,
      name: r.name,
      sortOrder: Number(r.sort_order),
      deletedAt: r.deleted_at === null ? null : r.deleted_at.toISOString(),
    })),
  };
}
