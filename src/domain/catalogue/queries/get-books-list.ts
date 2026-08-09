import type { TenantContext } from "../../kernel/tenant";
import type { Tx } from "../../kernel/unit-of-work";
import { requireManager } from "../policy";
import { deriveAvailability, type CatalogueRow } from "./get-catalogue";

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
 *
 * **`sort: "title"` orders by `olibra_fold(title)`**, for the reason
 * `get-catalogue.ts`'s docstring spells out: this cluster's collation is `C`,
 * so a plain `order by title` sorts every title beginning `Đ` after every
 * unaccented one. U2 Task 4 was scoped to the two reader-facing queries; this
 * third copy of the same expression is corrected with them because it is the
 * same live defect on the same column, and U3 wires the manager list that reads
 * it. Leaving one of three sorting differently is how a later reader concludes
 * the difference was deliberate.
 *
 * **And `slug` ends the order**, for the reason `get-catalogue.ts`'s docstring
 * now sets out at length (IMPORTANT 5, fix-report,
 * 2026-08-09-u2-shelf-and-portal): `created_at` defaults to `now()`, which is
 * transaction start time, so every book written in one transaction shares one
 * instant — and a `limit`/`offset` page over a sort that is not a *total*
 * order shows some rows twice and skips others. That is worse on this query
 * than on the reader's: a manager paging a bulk-loaded shelf looking for the
 * draft they just created can page past it without it ever appearing.
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
      on_loan: number;
      held: number;
      lost: number;
      has_retired: boolean;
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
        -- M8 (fix-report, 2026-08-08-b1-catalogue): see get-catalogue.ts's
        -- twin join and deriveAvailability, which this now calls.
        bool_or(cpr.id is not null)                               as has_retired,
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
      left join book_copies cpr
             on cpr.bookshelf_id = b.bookshelf_id
            and cpr.book_id = b.id
            and cpr.deleted_at is null
            and cpr.state = 'retired'
      where b.deleted_at is null
        and (${input.category ?? null}::text is null or c.slug = ${input.category ?? null})
        and (
          ${q} = ''
          -- M7 (fix-report, 2026-08-08-b1-catalogue): olibra_fold() strips a
          -- query made entirely of punctuation (a lone percent sign,
          -- underscores, ...) down to the empty string — verified live,
          -- olibra_fold of a lone percent sign is ''. Without the extra
          -- olibra_fold <> '' guard below, that degenerates the LIKE
          -- pattern to matching every row even though the raw query is not
          -- the empty string — a manager typing a lone percent sign would
          -- see the whole shelf, not the "no matches" a garbage query
          -- should give.
          or (
            olibra_fold(${q}) <> ''
            and (
              b.title_folded like '%' || olibra_fold(${q}) || '%'
              or b.author_folded like '%' || olibra_fold(${q}) || '%'
            )
          )
        )
      group by b.id, c.name
    )
    select *, count(*) over ()::int as total_count
    from counted
    -- olibra_fold(title), not title. See this function's docstring.
    --
    -- slug last, and it is what makes this a total order: without it a
    -- shelf whose books share a created_at loses rows across page
    -- boundaries. See get-catalogue.ts for the measurement.
    order by
      case when ${input.sort ?? "recent"} = 'title' then olibra_fold(title) end asc,
      created_at desc,
      slug
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
      availability: deriveAvailability({
        copiesAvailable: Number(r.copies_available),
        onLoan: Number(r.on_loan),
        held: Number(r.held),
        lost: Number(r.lost),
        hasRetired: r.has_retired,
      }),
      isPublished: r.is_published,
      codes: r.codes,
    })),
    page,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    total,
  };
}
