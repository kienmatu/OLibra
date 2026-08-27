import { requireManager, requireReader } from "../domain/catalogue/policy";
import type { TenantContext } from "../domain/kernel/tenant";
import type { Tx } from "../domain/kernel/unit-of-work";

const NUMBER = new Intl.NumberFormat("vi-VN");

/**
 * The three copy counts, in the one wording both book pages use — the
 * reader's `sach/[slug]` and the manager's `quan-ly/sach/[id]` (SDD §10, PO
 * feedback round 1 Task 11).
 *
 * One function rather than the sentence written out twice, so the wording
 * cannot drift the way `getBookDetail`/`getBookDetailManager`'s near-identical
 * SQL already shows a copy-pasted shape can.
 *
 * **`copiesAvailable + onLoan` need not equal `copiesTotal`, and that is not a
 * bug to fix here.** `held` copies are counted in neither `copiesAvailable`
 * nor `onLoan`, so the two can undercount the total by however many copies are
 * currently held for a waiting reader. Do not "correct" the arithmetic by
 * deriving `copiesTotal` from the other two, or one of the other two from
 * `copiesTotal` minus the rest — each is its own count off its own
 * `book_copies` rows, and a title with a copy held for someone is the ordinary
 * case this sentence has to stay honest about.
 *
 * **`copiesTotal` excludes `lost` and `retired` copies, both of them, and
 * this holds everywhere the name `copies_total`/`copiesTotal` is emitted** —
 * `get-book-detail.ts`, `get-book-detail-manager.ts`, `get-books-list.ts`,
 * `get-catalogue.ts`, `search-catalogue.ts` and `search-books-for-lending.ts`
 * all compute it the same way (post-review fix wave, item 7, and its round 2
 * that closed the same gap on the four queries that fix wave missed). That is
 * what makes "bản trong tủ" (copies in the shelf's records) a true sentence: a
 * lost copy is, by definition, not in the cupboard, and neither is a retired
 * one — and it is what lets a manager's list, search result and detail page
 * show the same title's copy count without one disagreeing with the others a
 * click away. Before item 7, every one of those queries excluded only
 * `retired`, so a single lost copy inflated the number by one wherever it was
 * read. Callers pass a query's own `copies_total`/`copiesTotal` straight
 * through; this function does not re-derive or re-filter it, so the guarantee
 * lives at the queries that compute it, not here.
 */
export function copyCountLine(counts: {
  copiesAvailable: number;
  onLoan: number;
  copiesTotal: number;
}): string {
  return `${NUMBER.format(counts.copiesAvailable)} bản có sẵn · ${NUMBER.format(
    counts.onLoan,
  )} đang cho mượn · ${NUMBER.format(counts.copiesTotal)} bản trong tủ`;
}

/**
 * What the catalogue's filter bar needs and no query provides: the categories
 * *this shelf actually stocks*.
 *
 * **Why this is not a query in `src/domain/`.** OPS §3 defines no
 * `ListCategories`, and `getCatalogue` already takes the answer as an input
 * (`CatalogueInput.category`, a `categories.slug`) rather than producing it.
 * Inventing a domain operation so one screen can populate a filter would be a
 * domain change U2 is not making — the same call `src/lib/shelf.ts` records for
 * `readShelf`, and this file is that decision applied to the catalogue's own
 * chrome. It runs on the `Tx` `loadPage` hands the page, inside the same
 * read-only, tenant-scoped transaction.
 *
 * **The shelf's own categories, not the global twelve.** `categories` is
 * reference data shared by every deployment (DATABASE.md §4.3's fixed list) and
 * carries no `bookshelf_id`, so selecting it directly would offer a parish
 * eleven filters that return nothing and one that works. Joining through
 * `books` makes the list a fact about this shelf, and RLS on `books` is what
 * makes it *this* shelf's — the join, not a `where` clause anybody has to
 * remember.
 *
 * `is_published` matches `getCatalogue`'s own filter, so the bar cannot offer a
 * category whose only titles are drafts the grid then refuses to show. That
 * agreement is the point; it is also why this does not take the caller's
 * current `scope`, which would make the filters flicker in and out as somebody
 * toggles "Sách có sẵn".
 *
 * **`includeDrafts` exists because that agreement runs the other way on the
 * manager's list** (U3 wave 1). `getBooksList` has no `is_published` filter at
 * all — "a draft is exactly what this list exists to find" — so on
 * `quan-ly/sach` the published-only default is the same defect in mirror image:
 * a shelf part-way through cataloguing a new category would have a filter bar
 * that cannot reach the very books the list is showing. One parameter rather
 * than a second function, because the two callers differ in exactly this one
 * predicate and a near-identical second `select` is how the two later disagree
 * about something else.
 *
 * `requireReader` first, as `readShelfIdentity` does and for the same reason:
 * which categories a parish stocks is a fact about that parish's shelf, and
 * this helper must not be the one read on a member page that a guest can reach.
 * Nothing in `src/domain/` changed to allow it — this is an added check on the
 * surface, not a moved one.
 *
 * Ordered by `sort_order`, the column DATABASE.md §4.3's list exists to fix,
 * with `olibra_fold(name)` breaking ties rather than `name`: this cluster's
 * collation is `C`, so a plain `order by name` would sort "Đời sống đức tin"
 * after every unaccented category. Same defect, same fix, as the two catalogue
 * queries' `order by`.
 */
export interface CatalogueCategory {
  slug: string;
  name: string;
}

export async function readCatalogueCategories(
  tx: Tx,
  ctx: TenantContext,
  options: { includeDrafts?: boolean } = {},
): Promise<CatalogueCategory[]> {
  requireReader(ctx);

  const rows = await tx<
    { slug: string; name: string; sort_order: number; folded: string }[]
  >`
    select distinct c.slug, c.name, c.sort_order, olibra_fold(c.name) as folded
    from categories c
    join books b on b.category_id = c.id
    where b.deleted_at is null
      and (${options.includeDrafts ?? false} or b.is_published)
      and c.deleted_at is null
    order by c.sort_order, folded
  `;
  // Mapped down to the two fields the filter bar renders. `sort_order` and
  // `folded` are in the `select` because `select distinct` may only order by
  // expressions it projects; they are sort keys, not data, and a returned row
  // carrying them would invite a caller to sort by them again somewhere else
  // and reach a different answer.
  return rows.map((row) => ({ slug: row.slug, name: row.name }));
}

/**
 * Every category a book may be catalogued *into* — DATABASE.md §4.3's fixed
 * global list, not the subset this shelf already stocks.
 *
 * **The opposite question from `readCatalogueCategories` above, and mixing the
 * two would be a real defect rather than an inefficiency.** That function joins
 * through `books` on purpose, so a filter bar cannot offer a parish eleven
 * choices that return nothing. A *create* form asking the same question can
 * never offer the category a shelf has no book in yet — which is precisely the
 * category the first book of a new kind belongs to, and the volunteer would
 * have no way to reach it. Two callers, two questions, and the near-identical
 * `select` is the reason they are in one file where the difference can be read.
 *
 * `categories` carries no `bookshelf_id` and no RLS policy at all (`0010_rls
 * .sql`'s loop excludes it, with `users` and site-wide `feedback`), so there is
 * nothing tenant-scoped here to get wrong — and nothing about a parish
 * disclosed by the answer, which is the same twelve rows in every deployment.
 * `requireManager` anyway, because the one screen that needs it is the
 * manager's own create form (`quan-ly/sach/moi`) and a `select` reachable by a
 * weaker caller than its only caller needs is a gate nobody chose.
 *
 * Ordered by `sort_order` then `olibra_fold(name)`, the same way and for the
 * same reason as the filter bar's list: under this cluster's `C` collation a
 * plain `order by name` sorts "Đời sống đức tin" after every unaccented
 * category.
 */
export async function readCategoryOptions(
  tx: Tx,
  ctx: TenantContext,
): Promise<CatalogueCategory[]> {
  requireManager(ctx);

  const rows = await tx<{ slug: string; name: string }[]>`
    select slug, name
    from categories
    where deleted_at is null
    order by sort_order, olibra_fold(name)
  `;
  return rows.map((row) => ({ slug: row.slug, name: row.name }));
}
