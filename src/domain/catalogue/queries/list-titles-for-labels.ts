import type { TenantContext } from "../../kernel/tenant";
import type { Tx } from "../../kernel/unit-of-work";
import { requireManager } from "../policy";

export interface LabelTitle {
  bookId: string;
  title: string;
  author: string | null;
  copies: { id: string; code: string; printCount: number }[];
}

/**
 * Every title with its live copies, for the label selection accordion.
 *
 * **Grouped here rather than on the page**, because the "Chưa in nhãn" filter
 * has to remove a *title* whose every copy is already printed, and that
 * decision needs the copies in hand. A page that filtered rows after receiving
 * them would render an accordion row that opens onto nothing — a control that
 * exists and does nothing, which is the shape this codebase keeps refusing.
 *
 * One query and a grouping pass, not a query per title: a shelf with four
 * hundred titles would otherwise be four hundred round trips to draw one
 * screen.
 *
 * Ordered by title, then by code, so the accordion reads alphabetically and
 * each title's copies read in shelf-mark order. `Map` preserves insertion
 * order, so the grouping keeps what the `order by` established.
 */
export async function listTitlesForLabels(
  tx: Tx,
  ctx: TenantContext,
  input: { onlyUnprinted: boolean },
): Promise<LabelTitle[]> {
  requireManager(ctx);

  const rows = await tx<
    {
      book_id: string;
      title: string;
      author: string | null;
      copy_id: string;
      code: string;
      print_count: number;
    }[]
  >`
    select b.id as book_id, b.title, b.author,
           c.id as copy_id, c.code, c.qr_print_count as print_count
    from book_copies c
    join books b on b.id = c.book_id and b.deleted_at is null
    where c.deleted_at is null
      and (${input.onlyUnprinted} = false or c.qr_print_count = 0)
    order by b.title, c.code
  `;

  const byBook = new Map<string, LabelTitle>();
  for (const row of rows) {
    let entry = byBook.get(row.book_id);
    if (!entry) {
      entry = {
        bookId: row.book_id,
        title: row.title,
        author: row.author,
        copies: [],
      };
      byBook.set(row.book_id, entry);
    }
    entry.copies.push({
      id: row.copy_id,
      code: row.code,
      printCount: row.print_count,
    });
  }
  return [...byBook.values()];
}
