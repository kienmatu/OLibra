import type { AuditEntry } from "../../kernel/audit";
import { RuleViolated, ValidationFailed } from "../../kernel/errors";
import type { Command } from "../../kernel/unit-of-work";
import { allocateCopyCodes } from "../copy-codes";
import {
  assertSingleDonor,
  nextAvailableSlug,
  requireManager,
  slugifyTitle,
} from "../policy";

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
  // QA remediation Task 19: see `assertSingleDonor`'s own docstring.
  assertSingleDonor(input.donorMembershipId, input.donorName);

  const [category] = await tx<{ id: string }[]>`
    select id from categories
    where slug = ${input.categorySlug} and deleted_at is null
  `;
  if (!category) throw new ValidationFailed("category_not_found", "categorySlug");

  // `allocateCopyCodes` below takes a per-shelf advisory lock that
  // serialises the rest of this command per shelf. IMPORTANT 2 (fix-report,
  // 2026-08-08-b1-catalogue): both the ISBN check and the slug
  // disambiguation just below must run *after* that lock is taken, not
  // before — a check-then-write ahead of the lock only looks serialised.
  // The second transaction's snapshot is already taken by the time it
  // blocks on the lock, so two concurrent `CreateBook` calls with the same
  // ISBN could both pass a pre-lock check and both commit (verified live:
  // `select count(*) from books where isbn = ...` returned 2 with the check
  // ordered this way). Ordered as it is here, the lock has already been
  // acquired by the time either check runs, so the window really is closed.
  // See the plan's "Known gaps" for why a partial unique index would still
  // be the structural fix for the ISBN case.
  const codes = await allocateCopyCodes(tx, ctx, input.copyCount);

  if (!blank(input.isbn)) {
    // No unique index backs this — `duplicate_isbn` is a check-then-write,
    // safe here only because it runs after the advisory lock above.
    const clash = await tx`
      select 1 from books
      where bookshelf_id = ${ctx.bookshelfId}
        and isbn = ${input.isbn!}
        and deleted_at is null
    `;
    if (clash.length > 0) throw new RuleViolated("duplicate_isbn");
  }

  // CRITICAL 1 (fix-report, 2026-08-08-b1-catalogue): `books_bookshelf_id_
  // slug_key` is a live partial unique index, so a second, different
  // edition of a title already on this shelf collides on the identical slug
  // the first edition claimed — verified live, a raw 23505. Disambiguating
  // here, rather than rejecting the title, is the decision this plan makes
  // (see `nextAvailableSlug`'s docstring). Safe as a plain select-then-use,
  // with no race, because the advisory lock above already serialises this
  // whole command per shelf — the same guarantee the copy codes get.
  const baseSlug = slugifyTitle(input.title);
  const existingSlugs = await tx<{ slug: string }[]>`
    select slug from books
    where bookshelf_id = ${ctx.bookshelfId}
      and deleted_at is null
      and (slug = ${baseSlug} or slug ~ ${`^${baseSlug}-[0-9]+$`})
  `;
  const slug = nextAvailableSlug(
    baseSlug,
    existingSlugs.map((r) => r.slug),
  );

  const [book] = await tx<{ id: string; slug: string }[]>`
    insert into books (
      bookshelf_id, category_id, title, slug, author, publisher,
      published_year, page_count, isbn, description, cover_url,
      language, is_published, added_by
    ) values (
      ${ctx.bookshelfId}, ${category.id}, ${input.title.trim()},
      ${slug}, ${input.author.trim()},
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
