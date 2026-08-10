import { RuleViolated, ValidationFailed } from "../../kernel/errors";
import { fold } from "../../kernel/fold";
import type { Command } from "../../kernel/unit-of-work";
import { requireSuperAdmin } from "../../members/policy";

export interface CreateCategoryInput {
  name: string;
}

/**
 * QA remediation Task 2 — the command that did not exist.
 *
 * `categories` (`0004_catalogue.sql`) has always been a real table, and
 * `src/db/seed.ts:103` has always filled it on a developer's machine. What
 * never existed was a way to add a row anywhere else, so a fresh install that
 * never ran the seed script had zero categories and no way to make one — and
 * `createBook`'s "Thể loại" field is `required`, so no book could ever be
 * catalogued at all. This, `renameCategory` and `archiveCategory` are the fix;
 * `20260810_02_seed_default_categories.sql` is the other half, so nobody has
 * to find this screen before they can add their first book.
 *
 * **Global, like `createBookshelf`, and for the identical reason.**
 * `categories` carries no `bookshelf_id` (DATABASE.md §4.3) — it is reference
 * data every shelf shares — so this runs through `runGlobalCommand`, and the
 * check that stands in for the kernel escalation `runAdminCommand` would
 * otherwise supply is `requireSuperAdmin` below, the same call
 * `markFeedbackRead`/`resolveFeedback` make for the identical reason
 * (`../../community/commands/feedback.ts`).
 *
 * **The slug is folded once, from the name, with no override.** Unlike a
 * bookshelf's slug — which a founding administrator may want to hand-pick for
 * a printed address — a category's slug is purely an internal handle
 * (`create-book.ts`'s own docstring: "not a name and not an id... the stable
 * handle a form can post"), so there is nothing for a second input to add and
 * one less thing for two administrators to disagree about.
 *
 * **The duplicate check is by slug, against every row — archived included —
 * not only the live ones.** `categories_slug_key` is a plain `unique`, with no
 * `where deleted_at is null` the way (for example)
 * `parish_units_name_unique_in_scope` has one. `20260808_09_soft_delete_aware
 * _uniqueness_round_2.sql`'s own docstring left it that way on purpose, and
 * said why: "categories are global reference data ... and nothing in this
 * codebase soft-deletes one ... If categories ever become soft-deletable in
 * practice, the same one-line conversion applies." `archiveCategory` below is
 * exactly that eventuality, arriving in the same task that adds this command
 * — and the migration is deliberately *not* touched here, so the choice below
 * has to be made, not inherited from the schema.
 *
 * `createBookshelf` above already decided the identical question for
 * `bookshelves.slug`, which carries the same unpartitioned constraint: check
 * by name, unfiltered, so the *inevitable* `23505` (the raw constraint
 * enforces this regardless of `deleted_at`) becomes a named refusal instead of
 * a driver error leaking through OPS §2. Taken here, the consequence is
 * deliberate rather than merely inherited: once a category is archived, its
 * slug is held forever, and creating a new category with the same name is
 * refused as `duplicate_category` rather than quietly reviving the old row
 * under a new id. There is no "un-archive" command — OPS gives this slice
 * none — so the way back, if a shelf ever needs the same category again, is a
 * new name (and therefore a new slug) for it.
 */
export const createCategory: Command<
  CreateCategoryInput,
  { id: string; slug: string }
> = async (tx, ctx, input) => {
  requireSuperAdmin(ctx);

  const name = input.name.trim();
  if (!name) throw new ValidationFailed("validation_failed", "name");

  const slug = fold(name).replace(/\s+/g, "-").slice(0, 60);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    throw new ValidationFailed("validation_failed", "name");
  }

  const [taken] = await tx<{ id: string }[]>`
    select id from categories where slug = ${slug}
  `;
  if (taken) throw new RuleViolated("duplicate_category");

  const [{ max }] = await tx<{ max: number | null }[]>`
    select max(sort_order) as max from categories
  `;

  const [row] = await tx<{ id: string }[]>`
    insert into categories (name, slug, sort_order)
    values (${name}, ${slug}, ${(max ?? 0) + 1})
    returning id
  `;

  return {
    result: { id: row.id, slug },
    audit: {
      action: "category.created",
      entityType: "category",
      entityId: row.id,
      before: null,
      after: { name, slug },
      // The category did not exist when the decision was made, so the entry
      // belongs to the deployment rather than to any one shelf — the same
      // argument `createBookshelf` makes for `bookshelf.created`.
      global: true,
    },
  };
};
