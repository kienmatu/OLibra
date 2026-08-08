import type { ErrorCode } from "../../kernel/errors";
import type { TenantContext } from "../../kernel/tenant";
import type { Tx } from "../../kernel/unit-of-work";
import { requireManager } from "../policy";

export interface LendableBookRow {
  bookId: string;
  slug: string;
  title: string;
  author: string | null;
  coverUrl: string | null;
  copiesTotal: number;
  copiesAvailable: number;
  blocked: boolean;
  reason?: ErrorCode;
}

/**
 * The quick-lend search a manager types a title into (OPS §3.3). Like
 * `getBooksList`, drafts are included — a manager may still want to lend a
 * title that has not been announced yet — and unlike the reader-facing
 * `searchCatalogue`, `copiesAvailable` is folded into a `blocked` flag naming
 * the same `copy_not_available` reason `LendCopy` (C1) would throw, so the
 * quick-lend screen can refuse *before* the confirm step (BR §16.3) rather
 * than let the volunteer pick a title only to have the command reject it.
 */
export async function searchBooksForLending(
  tx: Tx,
  ctx: TenantContext,
  input: { q: string },
): Promise<LendableBookRow[]> {
  requireManager(ctx);

  if (input.q.trim() === "") return [];

  const rows = await tx<
    {
      book_id: string;
      slug: string;
      title: string;
      author: string | null;
      cover_url: string | null;
      copies_total: number;
      copies_available: number;
    }[]
  >`
    select
      b.id as book_id, b.slug, b.title, b.author, b.cover_url,
      count(cp.id)  as copies_total,
      count(av.id)  as copies_available
    from books b
    left join book_copies cp
           on cp.bookshelf_id = b.bookshelf_id
          and cp.book_id = b.id
          and cp.deleted_at is null
          and cp.state <> 'retired'
    left join copies_borrowable av on av.id = cp.id
    where b.deleted_at is null
      -- M7 (fix-report, 2026-08-08-b1-catalogue): see search-catalogue.ts's
      -- twin guard. A query made entirely of punctuation folds to '', which
      -- would otherwise degenerate the LIKE pattern below to '%%' and reveal
      -- the whole shelf to quick-lend's search.
      and olibra_fold(${input.q}) <> ''
      and (
        b.title_folded  like '%' || olibra_fold(${input.q}) || '%'
        or b.author_folded like '%' || olibra_fold(${input.q}) || '%'
      )
    group by b.id
    order by b.title
  `;

  return rows.map((r) => {
    const copiesAvailable = Number(r.copies_available);
    return {
      bookId: r.book_id,
      slug: r.slug,
      title: r.title,
      author: r.author,
      coverUrl: r.cover_url,
      copiesTotal: Number(r.copies_total),
      copiesAvailable,
      // The same code LendCopy will throw (C1), so the screen and the command
      // can never tell a volunteer yes and then no — the failure BR §16.3 is
      // written to prevent.
      ...(copiesAvailable === 0
        ? { blocked: true, reason: "copy_not_available" as const }
        : { blocked: false }),
    };
  });
}
