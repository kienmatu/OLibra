import type { TenantContext } from "../../kernel/tenant";
import type { Tx } from "../../kernel/unit-of-work";
import { requireSuperAdmin } from "../../members/policy";

export interface CategoryAdminRow {
  id: string;
  name: string;
  slug: string;
  /** Live books only — `filter (where books.deleted_at is null)`. */
  bookCount: number;
}

/**
 * QA remediation Task 2. `/quan-tri/the-loai`'s own read — every live
 * category, with the count `archiveCategory`'s own guard is built around, so
 * the screen can explain a refusal before an administrator has to trigger one.
 *
 * Run through `runAdminQuery` in production (`loadAdminPage`), which already
 * refuses a non-`super_admin` caller in the kernel; `requireSuperAdmin` here
 * is the same belt-and-braces the neighbouring queries in
 * `../../admin/queries/get-admin-overview.ts` keep, for the reason that
 * file's own docstring gives — this query is safe whichever runner reaches
 * it, not only the one the shipped screen happens to use.
 */
export async function getCategoriesAdmin(
  tx: Tx,
  ctx: TenantContext,
): Promise<CategoryAdminRow[]> {
  requireSuperAdmin(ctx);

  const rows = await tx<
    { id: string; name: string; slug: string; book_count: number }[]
  >`
    select
      c.id, c.name, c.slug,
      count(b.id) filter (where b.deleted_at is null)::int as book_count
    from categories c
    left join books b on b.category_id = c.id
    where c.deleted_at is null
    group by c.id, c.name, c.slug
    order by c.sort_order, c.name
  `;

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    bookCount: r.book_count,
  }));
}
