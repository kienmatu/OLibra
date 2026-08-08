import type { TenantContext } from "../../kernel/tenant";
import type { Tx } from "../../kernel/unit-of-work";
import { requireReader } from "../policy";
import type { CatalogueRow } from "./get-catalogue";

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
      availability: string;
    }[]
  >`
    select
      b.id as book_id, b.slug, b.title, b.author, b.cover_url,
      c.name as category,
      count(cp.id)  as copies_total,
      count(av.id)  as copies_available,
      case
        when count(av.id) > 0 then 'available'
        when count(cp.id) filter (where cp.state = 'on_loan') > 0 then 'on_loan'
        when count(cp.id) filter (where cp.state = 'held')    > 0 then 'held'
        when count(cp.id) filter (where cp.state = 'lost')    > 0 then 'lost'
        else 'retired'
      end as availability
    from books b
    left join categories c on c.id = b.category_id
    left join book_copies cp
           on cp.bookshelf_id = b.bookshelf_id
          and cp.book_id = b.id
          and cp.deleted_at is null
          and cp.state <> 'retired'
    left join copies_borrowable av on av.id = cp.id
    where b.deleted_at is null
      and b.is_published
      and (
        b.title_folded  like '%' || olibra_fold(${input.q}) || '%'
        or b.author_folded like '%' || olibra_fold(${input.q}) || '%'
      )
    group by b.id, c.name
    order by b.title
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
    availability: r.availability as CatalogueRow["availability"],
  }));
}
