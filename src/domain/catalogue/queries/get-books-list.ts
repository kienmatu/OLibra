import type { TenantContext } from "../../kernel/tenant";
import type { Tx } from "../../kernel/unit-of-work";
import { requireManager } from "../policy";
import type { Availability, CatalogueRow } from "./get-catalogue";

export interface BooksListRow extends CatalogueRow {
  isPublished: boolean;
  /** The display range the list shows under the title, e.g. "DT-0215 – DT-0217". */
  codes: string;
}

export interface BooksListInput {
  q?: string;
  category?: string;
  sort?: "recent" | "title";
  page?: number;
  pageSize?: number;
}

export interface BooksListPage {
  rows: BooksListRow[];
  page: number;
  pageCount: number;
  total: number;
}

/**
 * `getCatalogue` with a manager's eyes: a draft is exactly what this list
 * exists to find, so unlike the reader catalogue there is no `is_published`
 * filter here — and each row carries the shelf-mark range (`codes`) a
 * volunteer reads off the spines, built from `min(code)`/`max(code)` over the
 * title's live copies.
 */
export async function getBooksList(
  tx: Tx,
  ctx: TenantContext,
  input: BooksListInput,
): Promise<BooksListPage> {
  requireManager(ctx);

  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 24));
  const q = (input.q ?? "").trim();

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
      is_published: boolean;
      codes: string;
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
        b.is_published,
        c.name          as category,
        count(cp.id)                                              as copies_total,
        count(av.id)                                              as copies_available,
        count(cp.id) filter (where cp.state = 'on_loan')          as on_loan,
        count(cp.id) filter (where cp.state = 'held')             as held,
        count(cp.id) filter (where cp.state = 'lost')             as lost,
        case
          when count(cp.id) = 0 then ''
          when min(cp.code) = max(cp.code) then min(cp.code)
          else min(cp.code) || ' – ' || max(cp.code)
        end as codes
      from books b
      left join categories c on c.id = b.category_id
      left join book_copies cp
             on cp.bookshelf_id = b.bookshelf_id
            and cp.book_id = b.id
            and cp.deleted_at is null
            and cp.state <> 'retired'
      left join copies_borrowable av on av.id = cp.id
      where b.deleted_at is null
        and (${input.category ?? null}::text is null or c.slug = ${input.category ?? null})
        and (
          ${q} = ''
          or b.title_folded like '%' || olibra_fold(${q}) || '%'
          or b.author_folded like '%' || olibra_fold(${q}) || '%'
        )
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
      isPublished: r.is_published,
      codes: r.codes,
    })),
    page,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    total,
  };
}
