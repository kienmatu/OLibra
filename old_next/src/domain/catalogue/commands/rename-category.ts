import { NotFound, ValidationFailed } from "../../kernel/errors";
import type { Command } from "../../kernel/unit-of-work";
import { requireSuperAdmin } from "../../members/policy";

export interface RenameCategoryInput {
  id: string;
  name: string;
}

/**
 * QA remediation Task 2. Renames a category; nothing else moves.
 *
 * **The slug never changes.** `create-category.ts`'s docstring already argues
 * this for the category the slug names — it is a stable handle a `<select>`
 * posts (`create-book.ts`'s own `categorySlug` field), and a rename that also
 * moved the slug would silently repoint every book already catalogued under
 * the old one, the same hazard `createBookshelf`'s docstring records for a
 * shelf's slug appearing "on printed notices and in a parish's own
 * bookmarks". So this command has no slug input and never writes the column.
 */
export const renameCategory: Command<RenameCategoryInput, void> = async (
  tx,
  ctx,
  input,
) => {
  requireSuperAdmin(ctx);

  const [category] = await tx<{ id: string; name: string }[]>`
    select id, name from categories
    where id = ${input.id} and deleted_at is null
  `;
  if (!category) throw new NotFound("category_not_found");

  const name = input.name.trim();
  if (!name) throw new ValidationFailed("validation_failed", "name");

  await tx`update categories set name = ${name} where id = ${category.id}`;

  return {
    result: undefined,
    audit: {
      action: "category.renamed",
      entityType: "category",
      entityId: category.id,
      before: { name: category.name },
      after: { name },
      global: true,
    },
  };
};
