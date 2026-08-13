import type { ErrorCode } from "../../kernel/errors";
import type { TenantContext } from "../../kernel/tenant";
import type { Tx } from "../../kernel/unit-of-work";
import { escapeLikePattern, requireManager } from "../policy";

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
 * The quick-lend search a manager types a title, an author or a copy code
 * into (OPS §3.3). Like `getBooksList`, drafts are included — a manager may
 * still want to lend a title that has not been announced yet — and unlike
 * the reader-facing `searchCatalogue`, `copiesAvailable` is folded into a
 * `blocked` flag naming the same reason `LendCopy` (C1) would throw, so the
 * quick-lend screen can refuse *before* the confirm step (BR §16.3) rather
 * than let the volunteer pick a title only to have the command reject it.
 *
 * **The copy code branch (QA remediation T27).** `/quan-ly/cho-muon`'s
 * search box now reads "Tên sách hoặc mã bản" — a volunteer standing at the
 * shelf with a book in hand is as likely to read the code off its spine
 * (`DT-0215`) as to type the title, and until this task the query answered
 * that with zero results, silently, which would have made the new
 * placeholder a promise this function did not keep. `code` needs no
 * `olibra_fold`: it is plain ASCII assigned by `copy-codes.ts`, never
 * Vietnamese text, so `ilike` alone (case-insensitive, nothing to fold) is
 * the whole of what matching it needs. It is an `exists` against its own
 * `book_copies` alias (`cpx`) rather than a condition added to the `cp`
 * alias the aggregates below already join on: `cp` is fanned out one row per
 * copy so `count(cp.id) filter (...)` can total every state a title has,
 * and narrowing that same joined row with `cpx.code ilike …` in the `where`
 * would have filtered *out* the book's other copies before the aggregates
 * ever saw them — a book matched by one copy's code would have reported
 * `copiesTotal` as 1 no matter how many copies it actually has. A separate
 * `exists` decides only whether the book row survives at all; it never
 * touches which of `cp`'s rows the aggregates count.
 *
 * `escapeLikePattern` — the same helper `copy-codes.ts`'s own allocator
 * uses on a shelf's `copy_code_prefix` override, for the identical reason:
 * unescaped, a `%` or `_` typed into this box would be a wildcard instead of
 * a literal character.
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
      -- The count the management screens show. Post-review fix wave, item 7
      -- (round 2): now excludes lost copies too, alongside retired, so this
      -- number agrees with get-books-list.ts's and never disagrees with a
      -- title's own detail page one click away — see that file's comment for
      -- the failure this closes. The filter is on this aggregate rather than
      -- the join below (unlike the other four queries) because copies_total
      -- is not the only thing counted here: copies_returnable and
      -- copies_recorded need to see every state, including retired and lost,
      -- to tell "some copies are out" from "all copies are lost or retired".
      count(cp.id) filter (where cp.state <> 'retired' and cp.state <> 'lost') as copies_total,
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
        or exists (
          select 1
            from book_copies cpx
           where cpx.book_id = b.id
             and cpx.bookshelf_id = b.bookshelf_id
             and cpx.deleted_at is null
             and cpx.code ilike ${"%" + escapeLikePattern(input.q.trim()) + "%"}
               escape ${"\\"}
        )
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
