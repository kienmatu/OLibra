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
 * the same reason `LendCopy` (C1) would throw, so the quick-lend screen can
 * refuse *before* the confirm step (BR §16.3) rather than let the volunteer
 * pick a title only to have the command reject it.
 *
 * **Which reason, and why this aggregate has to answer that.** `LendCopy`
 * judges one copy and has two refusals for it: `copy_lost_or_retired` ("Bản
 * sách này đã mất hoặc ngừng dùng.") and `copy_not_available` ("Bản sách này
 * đang được mượn hoặc đang giữ chỗ."). They send a volunteer to two different
 * places — the first to the manager, the second to wait for a book to come
 * back — and `inv-07-lost-or-retired-not-lendable.test.ts` asserts twice, at
 * length, that the distinction is what reaches them. This query used to derive
 * its reason from `copiesAvailable === 0` alone and so always said the second,
 * which told a volunteer searching a title whose only copy is lost to go and
 * wait for a book nobody has. It counts the states now.
 *
 * The mapping is the aggregate's honest translation of the per-copy rule: a
 * title is `copy_not_available` while it still has a copy that can come back
 * (`available`, `on_loan`, `held`), and `copy_lost_or_retired` only when every
 * copy it has is one or the other. A title with no copies recorded at all keeps
 * `copy_not_available`, because nothing about it is lost or retired and the
 * alternative sentence would name a copy that never existed — there is no third
 * code, and `ErrorCode` may not gain one whose Vietnamese sentence nobody
 * wrote.
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
      copies_returnable: number;
      copies_recorded: number;
    }[]
  >`
    select
      b.id as book_id, b.slug, b.title, b.author, b.cover_url,
      -- Unchanged: the count the management screens show, which has always
      -- excluded retired copies. The filter moved off the join and onto this
      -- aggregate so the two counts below can see every copy the title has.
      count(cp.id) filter (where cp.state <> 'retired') as copies_total,
      count(av.id)                                      as copies_available,
      -- The copies that can still come back to the shelf. Zero of these with
      -- at least one copy recorded is the only shape that means lost/retired
      -- rather than out — see the docstring.
      count(cp.id) filter (
        where cp.state in ('available', 'on_loan', 'held')
      )                                                 as copies_returnable,
      count(cp.id)                                      as copies_recorded
    from books b
    left join book_copies cp
           on cp.bookshelf_id = b.bookshelf_id
          and cp.book_id = b.id
          and cp.deleted_at is null
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
    const copiesReturnable = Number(r.copies_returnable);
    const copiesRecorded = Number(r.copies_recorded);
    // The same code LendCopy will throw (C1), so the screen and the command
    // can never tell a volunteer yes and then no — the failure BR §16.3 is
    // written to prevent.
    const reason: ErrorCode =
      copiesReturnable === 0 && copiesRecorded > 0
        ? "copy_lost_or_retired"
        : "copy_not_available";
    return {
      bookId: r.book_id,
      slug: r.slug,
      title: r.title,
      author: r.author,
      coverUrl: r.cover_url,
      copiesTotal: Number(r.copies_total),
      copiesAvailable,
      ...(copiesAvailable === 0 ? { blocked: true, reason } : { blocked: false }),
    };
  });
}
