import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertCircle, ArrowLeft } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { ManagerShell } from "@/components/shell/manager-shell";
import { BookFields, PublishedToggle } from "@/components/book-fields";
import { messageFor } from "@/domain/kernel/errors";
import { getBookForEdit } from "@/domain/catalogue/queries/get-book-for-edit";
import { getManagerBadgeCounts } from "@/domain/shelf/queries/get-manager-dashboard";
import { readCategoryOptions } from "@/lib/catalogue";
import { loadPage } from "@/lib/page-data";
import { refusalFrom, type SearchParams } from "@/lib/search-params";
import { readShelf } from "@/lib/shelf";
import { updateBookAction } from "../../../actions";

/** U1 §2. See `../../../cho-muon/page.tsx` for what a cached manager screen leaks. */
export const dynamic = "force-dynamic";

/**
 * OPS §4.1's `UpdateBook`, Task 11's edit page (QA remediation) — where
 * "Sửa sách" on the book detail page now actually lands, instead of the book
 * *list* it linked to before this task.
 *
 * **`[id]` is the book's slug, exactly as its parent `sach/[id]` reads it**
 * (that page's own docstring has the reasoning: every book URL in this app
 * already carries one, and a slug naming nothing is a 404). This page
 * resolves it the same way `bookFromSlug` does — `select id from books where
 * slug = …` — rather than by calling `bookFromSlug` itself, which runs
 * `getBookDetailManager`'s four queries (copies, condition history, loan
 * history) this form never renders. `getBookForEdit` is the narrow read built
 * for exactly this shape; see its own docstring for why neither existing
 * single-book query could serve it — in particular, why it must *not* filter
 * `is_published` the way the reader-facing `getBookDetail` does, since a
 * draft is exactly the title a manager is most likely to be correcting.
 *
 * **Reuses `sach/moi`'s fields wholesale, through `<BookFields>` and
 * `<PublishedToggle>`** (`src/components/book-fields.tsx`), pre-filled from
 * `getBookForEdit` instead of starting blank. What that page keeps for
 * itself — the donor section, the copy-count field — has no place here;
 * `BookFields`'s own docstring gives the reason for each.
 *
 * **Two hidden fields name the book, not one.** `sach-id` is the uuid
 * `updateBook` needs to find the row; `sach` is the slug this page loaded
 * with, carried through so `updateBookAction` can send the manager back to
 * `sach/<slug>` — and back to `sach/<slug>/sua` on a refusal — without
 * depending on whatever title the manager just typed. `updateBook`'s own
 * docstring is why the slug is never derived from the title: rewriting it
 * when a manager fixes a typo would turn every link anyone has shared into a
 * 404.
 *
 * **No repopulation on a refusal**, the same cost `sach/moi/page.tsx`'s own
 * docstring already accepts and for the identical reason: a refusal reloads
 * this page, which re-fetches the book from the database and shows its
 * *last-saved* values — not what the manager just typed, if that differed —
 * because retyping a title or an author is quick and a query string carrying
 * a book's description is not a place to put one.
 */
export default async function EditBookPage({
  params,
  searchParams,
}: {
  params: Promise<{ shelf: string; id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { shelf: slug, id } = await params;
  const search = await searchParams;
  const refused = refusalFrom(search);

  const { shelf, viewer, counts, categories, book } = await loadPage(
    slug,
    async (tx, ctx, viewer) => {
      const [row] = await tx<{ id: string }[]>`
        select id from books where slug = ${id} and deleted_at is null
      `;
      return {
        shelf: await readShelf(tx, ctx),
        viewer,
        counts: await getManagerBadgeCounts(tx, ctx),
        categories: await readCategoryOptions(tx, ctx),
        book: row ? await getBookForEdit(tx, ctx, { bookId: row.id }) : null,
      };
    },
  );
  if (!book) notFound();

  const base = `/tu-sach/${slug}/quan-ly`;
  const backHref = `${base}/sach/${book.slug}`;

  return (
    <ManagerShell
      shelfName={shelf.name}
      shelfSlug={slug}
      active="sach"
      viewer={viewer}
      counts={counts}
    >
      <Link
        href={backHref}
        className="inline-flex min-h-11 items-center gap-1.5 text-[15px] text-meta hover:text-ink"
      >
        <ArrowLeft aria-hidden className="size-4" strokeWidth={1.75} />
        Quay lại {book.title}
      </Link>

      <h1 className="mt-3 text-[28px] leading-tight font-semibold">Sửa sách</h1>

      {refused ? (
        <p
          role="alert"
          className="mt-5 flex max-w-2xl items-center gap-2 rounded-card border border-brick bg-brick/8 px-4 py-3 text-[15px] text-brick"
        >
          <AlertCircle aria-hidden className="size-5 shrink-0" strokeWidth={1.75} />
          {messageFor(refused)}
        </p>
      ) : null}

      <form action={updateBookAction} className="mt-8 max-w-2xl space-y-10">
        <input type="hidden" name="tu-sach" value={slug} />
        <input type="hidden" name="sach-id" value={book.bookId} />
        <input type="hidden" name="sach" value={book.slug} />

        <BookFields
          categories={categories}
          defaultValues={{
            title: book.title,
            author: book.author,
            categorySlug: book.categorySlug,
            publisher: book.publisher,
            publishedYear: book.publishedYear,
            pageCount: book.pageCount,
            isbn: book.isbn,
            description: book.description,
          }}
        />

        <PublishedToggle defaultChecked={book.isPublished} />

        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton>Lưu thay đổi</SubmitButton>
          <ButtonLink href={backHref} variant="ghost" size="lg">
            Huỷ
          </ButtonLink>
        </div>
      </form>
    </ManagerShell>
  );
}
