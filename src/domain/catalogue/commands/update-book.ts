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
 * **IMPORTANT 3 (fix-report, 2026-08-08-b1-catalogue): the first fix for
 * that question read `before` and bound it straight back on any omitted
 * field, which traded the crash for a worse bug.** Reading `publisher` (etc.)
 * into a JS variable at the top of the command and writing that same
 * variable back at the bottom makes the `UPDATE` a full-row write: a second
 * manager's edit to a field *this* call never touched, committed in the
 * window between this command's own read and its own write, was silently
 * discarded — verified live with two connections, one editing `title` and
 * the other `publisher`, the second manager's publisher reverted to the
 * first manager's stale snapshot the moment the first manager's command
 * finished. `title`, `author`, `language` and `published` never had this
 * problem: `coalesce(${x ?? null}, column)` reads `column`'s *current* value
 * inside the same `UPDATE` statement, atomically, rather than from a value
 * fetched earlier — which is exactly why they stay on `coalesce`. They are
 * also never legitimately cleared to `null` (a book always has a title), so
 * folding "omitted" and "explicitly null" together is safe for them and
 * would not be for the rest.
 *
 * Every other column — `categoryId` (derived from `categorySlug`),
 * `publisher`, `publishedYear`, `pageCount`, `isbn`, `description`,
 * `coverUrl` — can be legitimately cleared to `null`, so `coalesce` cannot
 * tell "omitted" from "explicitly null" for them. Each instead gets a
 * `has<Field>` flag (`input.x !== undefined`, computed once, before any
 * `await`) and a `case when ${hasX} then ${input.x ?? null} else column end`
 * in the `UPDATE`: when the caller did not name the field, the `else`
 * branch reads the column's own current value inside the same atomic
 * statement — never a value this command fetched earlier — so a concurrent
 * edit to a field this call never touched survives untouched. When the
 * caller *did* name the field, `${input.x ?? null}` writes exactly what was
 * asked for, `null` included.
 */
export const updateBook: Command<UpdateBookInput, void> = async (
  tx,
  ctx,
  input,
) => {
  requireManager(ctx);

  // IMPORTANT 3: only the columns this command still needs a snapshot of —
  // the existence check, the audit's `before`, and the ISBN clash check.
  // Every other column's *current* value is read live, inside the `UPDATE`
  // below, rather than through this snapshot — see this file's docstring.
  const [before] = await tx<
    {
      title: string;
      author: string | null;
      isbn: string | null;
      is_published: boolean;
    }[]
  >`
    select title, author, isbn, is_published
    from books where id = ${input.bookId} and deleted_at is null
  `;
  if (!before) throw new NotFound("book_not_found");

  // M5 (fix-report, 2026-08-08-b1-catalogue): trimmed once, reused for both
  // the write below and the audit entry, so the two can never disagree the
  // way a raw `input.title` in the write and a `.trim()`ed one in the audit
  // used to.
  const trimmedTitle = input.title?.trim();
  const trimmedAuthor = input.author?.trim();
  if (trimmedTitle === "") {
    throw new ValidationFailed("validation_failed", "title");
  }
  if (trimmedAuthor === "") {
    throw new ValidationFailed("validation_failed", "author");
  }

  // IMPORTANT 3: one `has<Field>` flag per nullable, independently-optional
  // column, computed before any further `await` — see this file's docstring
  // for why `coalesce` cannot stand in for these the way it does for
  // `title`/`author`/`language`/`published`.
  const hasCategory = input.categorySlug !== undefined;
  const hasPublisher = input.publisher !== undefined;
  const hasPublishedYear = input.publishedYear !== undefined;
  const hasPageCount = input.pageCount !== undefined;
  const hasIsbn = input.isbn !== undefined;
  const hasDescription = input.description !== undefined;
  const hasCoverUrl = input.coverUrl !== undefined;

  let categoryId: string | null = null;
  if (hasCategory) {
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

  const result = await tx`
    update books set
      category_id    = case when ${hasCategory} then ${categoryId} else category_id end,
      title          = coalesce(${trimmedTitle ?? null}, title),
      author         = coalesce(${trimmedAuthor ?? null}, author),
      publisher      = case when ${hasPublisher} then ${input.publisher ?? null} else publisher end,
      published_year = case when ${hasPublishedYear} then ${input.publishedYear ?? null} else published_year end,
      page_count     = case when ${hasPageCount} then ${input.pageCount ?? null} else page_count end,
      isbn           = case when ${hasIsbn} then ${input.isbn ?? null} else isbn end,
      description    = case when ${hasDescription} then ${input.description ?? null} else description end,
      cover_url      = case when ${hasCoverUrl} then ${input.coverUrl ?? null} else cover_url end,
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
        title: trimmedTitle ?? before.title,
        author: trimmedAuthor ?? before.author,
        isbn: hasIsbn ? (input.isbn ?? null) : before.isbn,
        isPublished: input.published ?? before.is_published,
      },
    },
  };
};
