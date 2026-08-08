import type { TenantContext } from "../../kernel/tenant";
import type { Tx } from "../../kernel/unit-of-work";
import { type CopyState, requireReader } from "../policy";

/**
 * The DB's own `copy_state` spelling. `src/lib/status.ts` calls the same thing
 * `onloan`; the mapping belongs to E's UI wiring, not here — the domain does
 * not import an icon library to name a state.
 */
export type Availability = CopyState;

export interface CatalogueRow {
  bookId: string;
  slug: string;
  title: string;
  author: string | null;
  coverUrl: string | null;
  category: string | null;
  copiesTotal: number;
  copiesAvailable: number;
  availability: Availability;
}

export interface CatalogueInput {
  scope: "available" | "all";
  /** `categories.slug`. */
  category?: string;
  sort?: "recent" | "title";
  page?: number;
  pageSize?: number;
}

export interface CataloguePage {
  rows: CatalogueRow[];
  page: number;
  pageCount: number;
  total: number;
}

/**
 * **`copies_available` is derived on every read, and there is no column
 * behind it.**
 *
 * BR §8 and DB §6 both name this as the load-bearing rule most likely to be
 * violated under delivery pressure, and this join is where it lives: a left
 * join from each live copy to `copies_borrowable`, counted. `copies_borrowable`
 * is itself the expression of "available and no unexpired hold references it",
 * evaluated against `now()` — so a hold that lapsed a minute ago is already
 * gone from the count with no job having run. If a reviewer ever sees a
 * `copies_available` column appear in a migration, this is the rule it broke.
 *
 * `availability` is the title-level badge the card shows, aggregated from the
 * copy states rather than stored: available if anything is borrowable, then
 * whichever state the shelf's copies are actually in.
 */
export async function getCatalogue(
  tx: Tx,
  ctx: TenantContext,
  input: CatalogueInput,
): Promise<CataloguePage> {
  requireReader(ctx);

  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 24));
  const availableOnly = input.scope === "available";

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
      total_count: number;
    }[]
  >`
    with counted as (
      select
        b.id            as book_id,
        b.slug,
        b.title,
        b.author,
        b.cover_url,
        b.created_at,
        c.name          as category,
        count(cp.id)                                              as copies_total,
        count(av.id)                                              as copies_available,
        count(cp.id) filter (where cp.state = 'on_loan')          as on_loan,
        count(cp.id) filter (where cp.state = 'held')             as held,
        count(cp.id) filter (where cp.state = 'lost')             as lost
      from books b
      left join categories c on c.id = b.category_id
      left join book_copies cp
             on cp.bookshelf_id = b.bookshelf_id
            and cp.book_id = b.id
            and cp.deleted_at is null
            and cp.state <> 'retired'
      -- The whole of BR §8, in one join.
      left join copies_borrowable av on av.id = cp.id
      where b.deleted_at is null
        and b.is_published
        and (${input.category ?? null}::text is null or c.slug = ${input.category ?? null})
      group by b.id, c.name
    ),
    scoped as (
      select *,
        case
          when copies_available > 0 then 'available'
          when on_loan > 0          then 'on_loan'
          when held > 0             then 'held'
          when lost > 0             then 'lost'
          else 'retired'
        end as availability
      from counted
      where not ${availableOnly} or copies_available > 0
    )
    select *, count(*) over ()::int as total_count
    from scoped
    order by
      case when ${input.sort ?? "recent"} = 'title' then title end asc,
      created_at desc
    limit ${pageSize} offset ${(page - 1) * pageSize}
  `;

  const total = rows[0]?.total_count ?? 0;
  return {
    rows: rows.map((r) => ({
      bookId: r.book_id,
      slug: r.slug,
      title: r.title,
      author: r.author,
      coverUrl: r.cover_url,
      category: r.category,
      copiesTotal: Number(r.copies_total),
      copiesAvailable: Number(r.copies_available),
      availability: r.availability as Availability,
    })),
    page,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    total,
  };
}
