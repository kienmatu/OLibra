import type { AuditEntry } from "../../kernel/audit";
import { RuleViolated, ValidationFailed } from "../../kernel/errors";
import type { Command } from "../../kernel/unit-of-work";
import { allocateCopyCodes } from "../copy-codes";
import { requireManager, slugifyTitle } from "../policy";

export interface DonorInput {
  /** A member of this shelf, chosen from a search (DB §4.4). */
  donorMembershipId?: string | null;
  /** A typed name, for a donor with no account. Both may be present. */
  donorName?: string | null;
  /** `YYYY-MM-DD`. Defaults to today in Asia/Ho_Chi_Minh (G6). */
  acquiredOn?: string | null;
}

export interface CreateBookInput extends DonorInput {
  title: string;
  author: string;
  /**
   * `categories.slug`, not a name and not an id. `categories` is a *global*
   * table (DB §4.3) with a plain `unique (slug)`, so the slug is the stable
   * handle a form can post.
   */
  categorySlug: string;
  publisher?: string | null;
  publishedYear?: number | null;
  pageCount?: number | null;
  isbn?: string | null;
  description?: string | null;
  coverUrl?: string | null;
  language?: string;
  published?: boolean;
  copyCount: number;
}

const blank = (v: string | null | undefined) => !v || v.trim() === "";

/**
 * Catalogues a title together with its first copies, in one transaction.
 *
 * OPS §1 is explicit that this is *one* business fact, not two commands
 * stitched together: "a book with zero copies is not yet meaningfully
 * catalogued". That is why there is one audit entry, `book.created`, with the
 * codes it produced in `after` — rather than one entry per copy, which is
 * what `AddCopies` does, because there the copies *are* the fact.
 */
export const createBook: Command<
  CreateBookInput,
  { bookId: string; copyIds: string[] }
> = async (tx, ctx, input) => {
  requireManager(ctx);

  if (blank(input.title) || blank(input.author) || blank(input.categorySlug)) {
    throw new ValidationFailed("required_fields_missing", "title");
  }
  if (!Number.isInteger(input.copyCount) || input.copyCount < 1) {
    throw new ValidationFailed("copy_count_invalid", "copyCount");
  }

  const [category] = await tx<{ id: string }[]>`
    select id from categories
    where slug = ${input.categorySlug} and deleted_at is null
  `;
  if (!category) throw new ValidationFailed("category_not_found", "categorySlug");

  if (!blank(input.isbn)) {
    // No unique index backs this — `duplicate_isbn` is a check-then-write.
    // The window is closed against another CreateBook on the same shelf by
    // the advisory lock `allocateCopyCodes` takes below, which serialises
    // this whole command per shelf. See the plan's "Known gaps" for why a
    // partial unique index would be the structural fix and why it is not
    // here.
    const clash = await tx`
      select 1 from books
      where bookshelf_id = ${ctx.bookshelfId}
        and isbn = ${input.isbn!}
        and deleted_at is null
    `;
    if (clash.length > 0) throw new RuleViolated("duplicate_isbn");
  }

  const codes = await allocateCopyCodes(tx, ctx, input.copyCount);

  const [book] = await tx<{ id: string; slug: string }[]>`
    insert into books (
      bookshelf_id, category_id, title, slug, author, publisher,
      published_year, page_count, isbn, description, cover_url,
      language, is_published, added_by
    ) values (
      ${ctx.bookshelfId}, ${category.id}, ${input.title.trim()},
      ${slugifyTitle(input.title)}, ${input.author.trim()},
      ${input.publisher ?? null}, ${input.publishedYear ?? null},
      ${input.pageCount ?? null}, ${input.isbn ?? null},
      ${input.description ?? null}, ${input.coverUrl ?? null},
      ${input.language ?? "vi"}, ${input.published ?? true},
      ${ctx.actor.userId}
    )
    returning id, slug
  `;

  const copies = await tx<{ id: string }[]>`
    insert into book_copies (
      bookshelf_id, book_id, code, state, condition,
      acquired_on, acquired_from, acquired_from_membership_id
    )
    select
      ${ctx.bookshelfId}, ${book.id}, c, 'available', 'perfect',
      ${input.acquiredOn ?? ctx.clock.today()}::date,
      ${input.donorName ?? null},
      ${input.donorMembershipId ?? null}
    from unnest(${codes}::text[]) as c
    returning id
  `;

  const audit: AuditEntry = {
    action: "book.created",
    entityType: "book",
    entityId: book.id,
    after: {
      title: input.title.trim(),
      slug: book.slug,
      author: input.author.trim(),
      category: input.categorySlug,
      isbn: input.isbn ?? null,
      isPublished: input.published ?? true,
      copyCodes: codes,
    },
  };

  return { result: { bookId: book.id, copyIds: copies.map((c) => c.id) }, audit };
};
