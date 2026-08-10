import { NotFound } from "../../kernel/errors";
import type { TenantContext } from "../../kernel/tenant";
import type { Tx } from "../../kernel/unit-of-work";
import { requireManager } from "../policy";

export interface BookForEdit {
  bookId: string;
  slug: string;
  title: string;
  author: string | null;
  categorySlug: string | null;
  publisher: string | null;
  publishedYear: number | null;
  pageCount: number | null;
  isbn: string | null;
  description: string | null;
  isPublished: boolean;
}

/**
 * Task 11 (QA remediation): what `sach/[id]/sua` needs to pre-fill an edit
 * form, and the reason neither existing single-book read supplies it.
 *
 * **`getBookDetailManager` (`get-book-detail-manager.ts`) is the query this
 * page's own detail screen already runs, and it is the wrong query for a
 * form.** It carries `category` (a *name*, joined for display) and no
 * `publisher`/`publishedYear`/`pageCount`/`isbn`/`description` at all — it was
 * built to render a read-only page, not to round-trip through `UpdateBook`,
 * whose `categorySlug` input needs the *slug* a `<select>` can post back.
 *
 * **`getBookDetail` (`get-book-detail.ts`) has every metadata field this needs
 * and is still the wrong query, for a sharper reason than a missing column:
 * it filters `where … and b.is_published`.** That is correct for the page it
 * serves — BR §16.1's reader-facing detail has no business showing a draft —
 * and it is exactly wrong for a manager's edit form, which must reach a book
 * *before* "Hiện sách này cho bạn đọc" is ever checked. Reusing it here would
 * make a title uneditable for the entire time it is being prepared, which is
 * precisely when a manager is most likely to be correcting it. It is also
 * gated `requireReader`, one floor below `updateBook`'s own `requireManager`.
 *
 * So this is a third, narrow read: `requireManager` (matching `updateBook`
 * and the page around it exactly, the same "no gap between what the page
 * shows and what the command allows" shape Task 4's reader-detail screen
 * already established), no `is_published` filter, and only the columns a
 * `<BookFields>` form actually renders — not copy counts, not availability,
 * not a cover url nobody can currently upload (`sach/moi/page.tsx`'s own
 * docstring has that reasoning).
 */
export async function getBookForEdit(
  tx: Tx,
  ctx: TenantContext,
  input: { bookId: string },
): Promise<BookForEdit> {
  requireManager(ctx);

  const [book] = await tx<
    {
      id: string;
      slug: string;
      title: string;
      author: string | null;
      category_slug: string | null;
      publisher: string | null;
      published_year: number | null;
      page_count: number | null;
      isbn: string | null;
      description: string | null;
      is_published: boolean;
    }[]
  >`
    select
      b.id, b.slug, b.title, b.author, c.slug as category_slug,
      b.publisher, b.published_year, b.page_count, b.isbn, b.description,
      b.is_published
    from books b
    left join categories c on c.id = b.category_id
    where b.id = ${input.bookId} and b.deleted_at is null
  `;
  if (!book) throw new NotFound("book_not_found");

  return {
    bookId: book.id,
    slug: book.slug,
    title: book.title,
    author: book.author,
    categorySlug: book.category_slug,
    publisher: book.publisher,
    publishedYear: book.published_year,
    pageCount: book.page_count,
    isbn: book.isbn,
    description: book.description,
    isPublished: book.is_published,
  };
}
