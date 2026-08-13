import type { TenantContext } from "../../kernel/tenant";
import type { Tx } from "../../kernel/unit-of-work";
import { requireManager } from "../policy";

/** One printed label's worth of a copy. */
export interface LabelCopy {
  id: string;
  code: string;
  title: string;
  printCount: number;
}

export interface ListCopiesForLabelsInput {
  /** Every live copy of these titles. */
  bookIds?: string[];
  /** These copies specifically. */
  copyIds?: string[];
  /** Keep only copies whose label has never been printed. */
  onlyUnprinted?: boolean;
}

/**
 * The copies a label sheet is about to be printed for.
 *
 * **`bookIds` and `copyIds` are a union, not alternatives.** The selection
 * screen lets a manager tick a whole title *and* individual copies of another,
 * and asking the caller to flatten that into one list would mean expanding
 * "every copy of this title" in the browser — where the answer is whatever the
 * page happened to be rendered with, not what is true when the button is
 * pressed. One `or` in one query keeps the expansion on the side that can
 * still see the table, and a copy matched by both halves is still one row.
 *
 * **Soft-deleted copies are excluded, unlike `allocateCopyCodes`, which
 * deliberately scans them.** That is not an inconsistency between two
 * functions over the same table: the allocator must never *reissue* a retired
 * copy's code, because that code is already printed on a physical label,
 * whereas nobody wants a fresh sticker for a book that has left the shelf.
 *
 * Ordered by `code` so a printed sheet reads in shelf-mark order and a
 * volunteer can match it against the trolley without hunting.
 *
 * Tenancy is RLS's, not this function's: the query runs inside the scoped
 * transaction, so a copy id belonging to another parish simply is not here.
 */
export async function listCopiesForLabels(
  tx: Tx,
  ctx: TenantContext,
  input: ListCopiesForLabelsInput,
): Promise<LabelCopy[]> {
  requireManager(ctx);

  const bookIds = input.bookIds ?? [];
  const copyIds = input.copyIds ?? [];

  // Postgres would happily evaluate `= any('{}')` to false for every row, but
  // issuing a query whose answer is already known is a round trip spent to
  // learn nothing.
  if (bookIds.length === 0 && copyIds.length === 0) return [];

  const rows = await tx<
    { id: string; code: string; title: string; print_count: number }[]
  >`
    select c.id, c.code, b.title, c.qr_print_count as print_count
    from book_copies c
    join books b on b.id = c.book_id and b.deleted_at is null
    where c.deleted_at is null
      and (c.book_id = any(${bookIds}::uuid[]) or c.id = any(${copyIds}::uuid[]))
      and (${input.onlyUnprinted ?? false} = false or c.qr_print_count = 0)
    order by c.code
  `;

  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    title: r.title,
    printCount: r.print_count,
  }));
}
