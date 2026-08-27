import type { TenantContext } from "../../kernel/tenant";
import type { Tx } from "../../kernel/unit-of-work";
import { requireReader } from "../policy";
import { deriveAvailability, type CatalogueRow } from "./get-catalogue";

/**
 * Diacritic- and case-insensitive substring search over title and author
 * (BR §12).
 *
 * **The term is folded by `olibra_fold()` in SQL, not by `fold()` in
 * TypeScript.** `books.title_folded` and `books.author_folded` are generated
 * columns over the same function, so both sides of the comparison go through
 * one implementation and BR §12's "the two can never drift" is structural
 * rather than a convention. `tests/db/folding.test.ts` is what keeps
 * `src/lib/search.ts`'s `fold()` — which the *UI* uses for its own client-side
 * filtering — in step with the SQL one.
 *
 * `like '%' || ... || '%'` rather than a trigram operator: DB §5 is explicit
 * that at a few hundred books per shelf "nothing more elaborate is warranted".
 * The `gin_trgm_ops` indexes on both folded columns are there if a shelf ever
 * outgrows that.
 *
 * **Results are ordered by the folded title, not the title** (U2 Task 4) —
 * `get-catalogue.ts`'s docstring carries the full argument. Short version: this
 * cluster's collation is `C`, `Đ` is two bytes beginning `0xC4`, and a plain
 * `order by b.title` sorted "Đất Rừng Phương Nam" after every unaccented title
 * on the shelf. `olibra_fold` maps it to `d`, and on `[a-z0-9 ]` byte order is
 * alphabetical order.
 *
 * `b.slug` breaks ties, which the previous `order by b.title` had nothing to
 * do: two titles can fold to the same string ("Dế Mèn" and "De Men"), and a
 * result list that reordered them between two renders of the same search is a
 * list nobody can scan. The portal's directory takes the same tiebreak for the
 * same reason.
 */
export async function searchCatalogue(
  tx: Tx,
  ctx: TenantContext,
  input: { q: string },
): Promise<CatalogueRow[]> {
  requireReader(ctx);

  if (input.q.trim() === "") return [];

  const rows = await tx<
    {
      book_id: string;
      slug: string;
      title: string;
      author: string | null;
      cover_url: string | null;
      category: string | null;
      copies_total: number;
      copies_available: number;
      on_loan: number;
      held: number;
      lost: number;
      has_retired: boolean;
    }[]
  >`
    select
      b.id as book_id, b.slug, b.title, b.author, b.cover_url,
      c.name as category,
      -- Post-review fix wave, item 7 (round 2): see get-books-list.ts's twin
      -- comment. copies_total excludes lost copies everywhere it is emitted
      -- under that name.
      count(cp.id) filter (where cp.state <> 'lost') as copies_total,
      count(av.id)  as copies_available,
      count(cp.id) filter (where cp.state = 'on_loan') as on_loan,
      count(cp.id) filter (where cp.state = 'held')    as held,
      count(cp.id) filter (where cp.state = 'lost')    as lost,
      -- M8 (fix-report, 2026-08-08-b1-catalogue): see get-catalogue.ts's
      -- twin join and deriveAvailability, which this now calls.
      bool_or(cpr.id is not null) as has_retired
    from books b
    left join categories c on c.id = b.category_id
    left join book_copies cp
           on cp.bookshelf_id = b.bookshelf_id
          and cp.book_id = b.id
          and cp.deleted_at is null
          and cp.state <> 'retired'
    left join copies_borrowable av on av.id = cp.id
    left join book_copies cpr
           on cpr.bookshelf_id = b.bookshelf_id
          and cpr.book_id = b.id
          and cpr.deleted_at is null
          and cpr.state = 'retired'
    where b.deleted_at is null
      and b.is_published
      -- M7 (fix-report, 2026-08-08-b1-catalogue): olibra_fold() replaces
      -- every non-[a-z0-9] run with a space, so a query made entirely of
      -- punctuation (a lone "%", "___", ...) folds to '' — verified live:
      -- olibra_fold('%') = ''. That degenerates the pattern below to '%%',
      -- which matches every row, revealing the whole shelf to a query the
      -- blank-string guard above never sees as blank (it is not the empty
      -- string, just punctuation). This extra guard makes a garbage query
      -- behave like a blank one: no rows.
      and olibra_fold(${input.q}) <> ''
      and (
        b.title_folded  like '%' || olibra_fold(${input.q}) || '%'
        or b.author_folded like '%' || olibra_fold(${input.q}) || '%'
      )
    group by b.id, c.name
    -- olibra_fold(b.title), not b.title, with b.slug breaking ties. See this
    -- function's docstring, and getCatalogue's, for why.
    order by olibra_fold(b.title), b.slug
  `;

  return rows.map((r) => ({
    bookId: r.book_id,
    slug: r.slug,
    title: r.title,
    author: r.author,
    coverUrl: r.cover_url,
    category: r.category,
    copiesTotal: Number(r.copies_total),
    copiesAvailable: Number(r.copies_available),
    availability: deriveAvailability({
      copiesAvailable: Number(r.copies_available),
      onLoan: Number(r.on_loan),
      held: Number(r.held),
      lost: Number(r.lost),
      hasRetired: r.has_retired,
    }),
  }));
}
