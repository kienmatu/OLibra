import { NotFound, RuleViolated } from "../../kernel/errors";
import type { Command } from "../../kernel/unit-of-work";
import { requireSuperAdmin } from "../../members/policy";

export interface ArchiveCategoryInput {
  id: string;
}

/**
 * QA remediation Task 2. A **soft** delete — `deleted_at`, not a status flag —
 * unlike `archiveBookshelf`, which is deliberately not a soft delete (see its
 * own docstring). A shelf's archive hides it from the portal and keeps every
 * loan and comment intact; a category has no history of its own to keep, only
 * books that point at it, and `books.category_id references categories(id) on
 * delete set null` (`0004_catalogue.sql`) already says what should happen to
 * those if the row ever truly went away. `deleted_at` is what lets
 * `getCategoriesAdmin` and `readCategoryOptions` (`src/lib/catalogue.ts`) stop
 * offering it without touching a single book.
 *
 * **The guard that actually protects referential sense.** `ON DELETE SET
 * NULL` only fires on a hard delete, which this command never performs, so it
 * cannot be the thing standing between an archived category and a book
 * silently losing its shelf label. That job belongs to the check below:
 * `select 1 from books where category_id = $1 and deleted_at is null limit 1`
 * — a book already soft-deleted does not count, because a category whose only
 * reference is a deleted book is not "in use" by anything a reader or a
 * manager can still see. Widening this to ignore `books.deleted_at` would
 * refuse an archive that has no live consequence; narrowing it to ignore soft
 * deletes on the category side is not a thing this query does at all, since it
 * is `archiveCategory` itself doing the deleting.
 */
export const archiveCategory: Command<ArchiveCategoryInput, void> = async (
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

  const [inUse] = await tx`
    select 1 from books
    where category_id = ${category.id} and deleted_at is null
    limit 1
  `;
  if (inUse) throw new RuleViolated("category_in_use");

  const now = ctx.clock.now();
  await tx`update categories set deleted_at = ${now} where id = ${category.id}`;

  return {
    result: undefined,
    audit: {
      action: "category.archived",
      entityType: "category",
      entityId: category.id,
      before: { name: category.name },
      after: { deletedAt: now.toISOString() },
      global: true,
    },
  };
};
