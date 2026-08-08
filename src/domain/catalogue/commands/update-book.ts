import { NotFound, RuleViolated, ValidationFailed } from "../../kernel/errors";
import type { Command } from "../../kernel/unit-of-work";
import { assertWritten } from "../../kernel/unit-of-work";
import { requireManager } from "../policy";

export interface UpdateBookInput {
  bookId: string;
  title?: string;
  author?: string;
  categorySlug?: string;
  publisher?: string | null;
  publishedYear?: number | null;
  pageCount?: number | null;
  isbn?: string | null;
  description?: string | null;
  coverUrl?: string | null;
  language?: string;
  /** BR §5.4's published flag, which hides a draft from the shelf's catalogue. */
  published?: boolean;
}

/**
 * Edits a title's metadata.
 *
 * **`slug` is not editable, deliberately.** It is what
 * `/tu-sach/[shelf]/sach/[slug]` resolves, and rewriting it when a manager
 * fixes a typo in a title turns every link anyone has shared into a 404.
 * BR §16.4 fixes a *bookshelf's* slug for the same reason and the database
 * enforces that one with a trigger; nothing says the same of a book, so this
 * is a decision recorded here rather than a rule being restated. If a
 * deliberate re-slug is ever wanted it should be its own command with its own
 * audit action, not a side effect of a metadata edit.
 *
 * **The `undefined`-binding question, resolved empirically against the live
 * `postgres` driver (`porsager/postgres`, the one this codebase uses) rather
 * than by reading its docs.** A two-line probe run against `olibra_test`
 * (port 5436) — `sql\`select ${undefined} as v\`` — does not silently bind
 * `null`. It throws `UNDEFINED_VALUE: Undefined values are not allowed`
 * before the query is even sent. So the naive `${x !== undefined ? x :
 * undefined}` idiom the brief flagged does not risk *silently clearing* a
 * column an update omitted — it risks crashing the whole command with a raw
 * driver exception the moment any nullable field is left out, which is the
 * "unstructured exception from inside the transaction" OPS §2 forbids just
 * as much as a silent data-loss bug would be.
 *
 * The fix either way is the same: never let a bare `undefined` reach a `tx`
 * call. Every nullable, independently-optional column (`publisher`,
 * `publishedYear`, `pageCount`, `isbn`, `description`, `coverUrl`) has its
 * current value read in the `select` below, and the update always binds
 * either the input's new value or that already-known current one — `null`
 * where the column already is `null`, never `undefined`. `title`, `author`,
 * `language` and `published` stay on `coalesce`, which needs no such
 * fallback: they are never legitimately cleared to `null` (a book always has
 * a title), so `input.x ?? null` folding "omitted" and "explicitly null"
 * together is exactly the read `coalesce(..., column)` wants.
 */
export const updateBook: Command<UpdateBookInput, void> = async (
  tx,
  ctx,
  input,
) => {
  requireManager(ctx);

  const [before] = await tx<
    {
      title: string;
      author: string | null;
      isbn: string | null;
      is_published: boolean;
      category_id: string | null;
      publisher: string | null;
      published_year: number | null;
      page_count: number | null;
      description: string | null;
      cover_url: string | null;
    }[]
  >`
    select title, author, isbn, is_published, category_id,
           publisher, published_year, page_count, description, cover_url
    from books where id = ${input.bookId} and deleted_at is null
  `;
  if (!before) throw new NotFound("book_not_found");

  if (input.title !== undefined && input.title.trim() === "") {
    throw new ValidationFailed("validation_failed", "title");
  }
  if (input.author !== undefined && input.author.trim() === "") {
    throw new ValidationFailed("validation_failed", "author");
  }

  let categoryId = before.category_id;
  if (input.categorySlug !== undefined) {
    const [category] = await tx<{ id: string }[]>`
      select id from categories where slug = ${input.categorySlug} and deleted_at is null
    `;
    if (!category) throw new ValidationFailed("category_not_found", "categorySlug");
    categoryId = category.id;
  }

  if (
    input.isbn !== undefined &&
    input.isbn !== null &&
    input.isbn !== before.isbn
  ) {
    const clash = await tx`
      select 1 from books
      where bookshelf_id = ${ctx.bookshelfId}
        and isbn = ${input.isbn}
        and id <> ${input.bookId}
        and deleted_at is null
    `;
    if (clash.length > 0) throw new RuleViolated("duplicate_isbn");
  }

  const publisher =
    input.publisher !== undefined ? input.publisher : before.publisher;
  const publishedYear =
    input.publishedYear !== undefined ? input.publishedYear : before.published_year;
  const pageCount =
    input.pageCount !== undefined ? input.pageCount : before.page_count;
  const isbn = input.isbn !== undefined ? input.isbn : before.isbn;
  const description =
    input.description !== undefined ? input.description : before.description;
  const coverUrl = input.coverUrl !== undefined ? input.coverUrl : before.cover_url;

  const result = await tx`
    update books set
      category_id    = ${categoryId},
      title          = coalesce(${input.title ?? null}, title),
      author         = coalesce(${input.author ?? null}, author),
      publisher      = ${publisher},
      published_year = ${publishedYear},
      page_count     = ${pageCount},
      isbn           = ${isbn},
      description    = ${description},
      cover_url      = ${coverUrl},
      language       = coalesce(${input.language ?? null}, language),
      is_published   = coalesce(${input.published ?? null}, is_published)
    where id = ${input.bookId} and deleted_at is null
  `.allowZero();
  assertWritten(result, "book_not_found");

  return {
    result: undefined,
    audit: {
      action: "book.updated",
      entityType: "book",
      entityId: input.bookId,
      before: {
        title: before.title,
        author: before.author,
        isbn: before.isbn,
        isPublished: before.is_published,
      },
      after: {
        title: input.title?.trim() ?? before.title,
        author: input.author?.trim() ?? before.author,
        isbn,
        isPublished: input.published ?? before.is_published,
      },
    },
  };
};
