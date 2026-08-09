import type { TenantContext } from "../../kernel/tenant";
import type { Tx } from "../../kernel/unit-of-work";
import { type CopyState, requireReader } from "../policy";

/**
 * The DB's own `copy_state` spelling, plus `"none"` — M8 (fix-report,
 * 2026-08-08-b1-catalogue). `CopyState` alone has no member for "this title
 * has no live copies at all", so every query below fell through its CASE's
 * final `else` to `"retired"` whenever a book had zero rows to count —
 * indistinguishable, on the wire, from a title whose copies are genuinely
 * all retired. `src/lib/status.ts`'s state-to-icon mapping is E's UI wiring,
 * not this domain's; adding a member here is this domain's own call.
 */
export type Availability = CopyState | "none";

/**
 * The one place BR §8's "available, then on_loan, then held, then lost,
 * then retired, then none" ladder is written — M8 (fix-report,
 * 2026-08-08-b1-catalogue). Previously copy-pasted as a SQL `CASE` into
 * five queries (`getCatalogue`, `getBooksList`, `searchCatalogue`,
 * `getBookDetail`, `getBookDetailManager`); C1 would have made that six.
 * Each of those queries now selects the raw counts this needs and calls
 * this instead, so the ladder has exactly one copy to keep in step.
 */
export function deriveAvailability(counts: {
  copiesAvailable: number;
  onLoan: number;
  held: number;
  lost: number;
  hasRetired: boolean;
}): Availability {
  if (counts.copiesAvailable > 0) return "available";
  if (counts.onLoan > 0) return "on_loan";
  if (counts.held > 0) return "held";
  if (counts.lost > 0) return "lost";
  if (counts.hasRetired) return "retired";
  return "none";
}

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
 * evaluated against `olibra_now()` — the injected clock, since
 * `20260808_14_olibra_now.sql`; SQL `now()` before that — so a hold that
 * lapsed a minute ago is already gone from the count with no job having run.
 * If a reviewer ever sees a `copies_available` column appear in a migration,
 * this is the rule it broke.
 *
 * `availability` is the title-level badge the card shows, aggregated from the
 * copy states rather than stored: available if anything is borrowable, then
 * whichever state the shelf's copies are actually in.
 *
 * **`sort: "title"` orders by the folded title, not by the title** (U2 Task 4).
 * This cluster's collation is `C` — `datcollate = 'C'`, `datlocprovider = 'c'`,
 * read off the running database — which orders by byte value. `Đ` is two bytes
 * beginning `0xC4`, so under a plain `order by title` "Đất Rừng Phương Nam"
 * sorts *after* "Tuổi Thơ Dữ Dội" and lands last on a shelf of twelve
 * Vietnamese titles: alphabetical to nobody who will ever read it. The portal
 * hit the identical defect on `order by name` and was fixed the same way
 * (`domain/portal/queries/list-public-shelves.ts`, whose docstring carries the
 * first telling); this is that fix on the two reader-facing catalogue queries,
 * which are the ones U2's sort control actually reaches.
 *
 * `olibra_fold` maps `Đ` to `d` and strips every diacritic, leaving
 * `[a-z0-9 ]`, on which byte order and alphabetical order are the same thing —
 * so the sort key is a rule this schema already owns (BR §12,
 * `0002_folding.sql`) rather than a collation every deployment would have to be
 * created with. `books.title_folded` is a generated column over that same
 * function, so what the catalogue sorts by cannot drift from what search
 * matches on.
 *
 * **`slug` is the last sort key, and without it this query loses rows**
 * (IMPORTANT 5, fix-report, 2026-08-09-u2-shelf-and-portal). The order used to
 * end at `created_at desc`, described here as breaking ties. It does not, and
 * the case where it does not is the ordinary one: `created_at` defaults to
 * `now()`, which is *transaction start* time, so every book written in one
 * transaction shares one instant — all twelve `src/db/seed.ts` writes to
 * `dong-thap`, and every bulk load a parish will ever do. Under
 * `sort: "recent"` the `case` expression above is null for every row, so
 * `created_at desc` is the entire sort key and every row is tied with every
 * other; under `sort: "title"` two titles that fold alike are tied as well.
 *
 * A tie is not a stable order. `limit`/`offset` asks Postgres for a different
 * top-N on each page, and a top-N selection over tied rows may order them
 * differently every time — so a page boundary can show a row twice and skip
 * another entirely. Measured over 300 rows sharing one `created_at`: 300 rows
 * collected across the pages, **231 unique** at pageSize 7. A child paging
 * through "Tên sách" sees some titles twice and never sees others. Latent at
 * twelve books only because twelve books fit on one page.
 *
 * `slug` is the fix and is the same key `search-catalogue.ts` already ends on:
 * unique per shelf (`0004_catalogue.sql`), immutable, and already selected. It
 * makes the order total, which is what pagination requires and what
 * "`created_at desc` breaks ties" was claiming.
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
      on_loan: number;
      held: number;
      lost: number;
      has_retired: boolean;
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
        count(cp.id) filter (where cp.state = 'lost')             as lost,
        -- M8: a separate join, deliberately not merged into the cp join
        -- above — cp excludes retired copies on purpose (copies_total must
        -- not count them), so whether a retired copy exists at all has to
        -- be tracked independently, purely to tell "all copies retired"
        -- apart from "no copies at all" in deriveAvailability below.
        bool_or(cpr.id is not null)                               as has_retired
      from books b
      left join categories c on c.id = b.category_id
      left join book_copies cp
             on cp.bookshelf_id = b.bookshelf_id
            and cp.book_id = b.id
            and cp.deleted_at is null
            and cp.state <> 'retired'
      -- The whole of BR §8, in one join.
      left join copies_borrowable av on av.id = cp.id
      left join book_copies cpr
             on cpr.bookshelf_id = b.bookshelf_id
            and cpr.book_id = b.id
            and cpr.deleted_at is null
            and cpr.state = 'retired'
      where b.deleted_at is null
        and b.is_published
        and (${input.category ?? null}::text is null or c.slug = ${input.category ?? null})
      group by b.id, c.name
    ),
    scoped as (
      select * from counted
      where not ${availableOnly} or copies_available > 0
    )
    select *, count(*) over ()::int as total_count
    from scoped
    -- olibra_fold(title), not title. See this function's docstring: the
    -- cluster's collation is C, and a plain sort by title puts Đ last.
    --
    -- slug last, and it is what makes this a total order rather than a
    -- decorative one — see the docstring. Without it, a shelf whose books
    -- share a created_at (every bulk load, and the seed) loses rows across
    -- page boundaries.
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
    })),
    page,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    total,
  };
}
