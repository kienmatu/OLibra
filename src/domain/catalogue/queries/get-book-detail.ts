import { NotFound } from "../../kernel/errors";
import type { TenantContext } from "../../kernel/tenant";
import type { Tx } from "../../kernel/unit-of-work";
import { requireReader } from "../policy";
import { deriveAvailability, type CatalogueRow } from "./get-catalogue";

export interface BookDetail extends CatalogueRow {
  publisher: string | null;
  publishedYear: number | null;
  pageCount: number | null;
  isbn: string | null;
  description: string | null;
  language: string;
  currentLoan: {
    holderName: string | null;
    daysRemaining: number;
    dueOn: string;
  } | null;
  queueLength: number;
}

/**
 * BR §5.5's defaults, applied here because a shelf row "need only store what
 * it overrides" (DB §4.2). B4 owns shelf settings; these two are the only ones
 * this slice reads, and reading them with the documented default is cheaper
 * than blocking on B4.
 */
function showsCurrentBorrower(settings: Record<string, unknown> | null): boolean {
  return settings?.public_show_current_borrower !== false;
}
function nameDisplay(settings: Record<string, unknown> | null): string {
  const v = settings?.public_name_display;
  return typeof v === "string" ? v : "full_name";
}

/**
 * A book's reader-facing detail page.
 *
 * BR §16.1: "There is no guest path — only a member of this shelf can see this
 * page at all", which is what `requireReader` plus the kernel's tenant scoping
 * enforce between them.
 *
 * Everything derived is derived: `copiesAvailable` from `copies_borrowable`,
 * `daysRemaining` from `loans_current` (never a stored column — DB §4.5:
 * "There is no `is_overdue` column, and there must never be one"), and
 * `queueLength` from the count of pending requests, since BR §7.2 says
 * "There is no separate reservation concept."
 *
 * **Known gap, recorded rather than invented:** `src/lib/fixtures.ts`'s `Book`
 * type has a `translator` field and `books` has no such column. This query
 * does not return one. Adding it is a migration, which master §7.1 does not
 * put in this slice.
 */
export async function getBookDetail(
  tx: Tx,
  ctx: TenantContext,
  input: { bookSlug: string },
): Promise<BookDetail> {
  requireReader(ctx);

  const [book] = await tx<
    {
      book_id: string;
      slug: string;
      title: string;
      author: string | null;
      cover_url: string | null;
      category: string | null;
      publisher: string | null;
      published_year: number | null;
      page_count: number | null;
      isbn: string | null;
      description: string | null;
      language: string;
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
      c.name as category, b.publisher, b.published_year, b.page_count,
      b.isbn, b.description, b.language,
      count(cp.id) as copies_total,
      count(av.id) as copies_available,
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
    where b.slug = ${input.bookSlug} and b.deleted_at is null and b.is_published
    group by b.id, c.name
  `;
  if (!book) throw new NotFound("book_not_found");

  const [{ queue_length: queueLength }] = await tx<{ queue_length: number }[]>`
    select count(*)::int as queue_length
    from borrow_requests
    where book_id = ${book.book_id} and status = 'pending' and deleted_at is null
  `;

  const [shelf] = await tx<{ settings: Record<string, unknown> | null }[]>`
    select settings from bookshelves where id = ${ctx.bookshelfId}
  `;

  let currentLoan: BookDetail["currentLoan"] = null;
  if (showsCurrentBorrower(shelf?.settings ?? null)) {
    const [loan] = await tx<
      {
        full_name: string;
        display_name: string | null;
        due_on: string;
        days_remaining: number;
      }[]
    >`
      select u.full_name, u.display_name, l.due_on::text as due_on, l.days_remaining
      from loans_current l
      join users u on u.id = l.borrower_id
      where l.book_id = ${book.book_id} and l.status = 'active'
      order by l.due_on
      limit 1
    `;
    if (loan) {
      const display = nameDisplay(shelf?.settings ?? null);
      currentLoan = {
        holderName:
          display === "hidden"
            ? null
            : display === "display_name"
              ? (loan.display_name ?? loan.full_name)
              : loan.full_name,
        daysRemaining: Number(loan.days_remaining),
        dueOn: loan.due_on,
      };
    }
  }

  return {
    bookId: book.book_id,
    slug: book.slug,
    title: book.title,
    author: book.author,
    coverUrl: book.cover_url,
    category: book.category,
    copiesTotal: Number(book.copies_total),
    copiesAvailable: Number(book.copies_available),
    availability: deriveAvailability({
      copiesAvailable: Number(book.copies_available),
      onLoan: Number(book.on_loan),
      held: Number(book.held),
      lost: Number(book.lost),
      hasRetired: book.has_retired,
    }),
    publisher: book.publisher,
    publishedYear: book.published_year,
    pageCount: book.page_count,
    isbn: book.isbn,
    description: book.description,
    language: book.language,
    currentLoan,
    queueLength,
  };
}
