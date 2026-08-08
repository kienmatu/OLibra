import Link from "next/link";
import { ChevronRight, Plus, Search } from "lucide-react";
import { ManagerShell } from "@/components/shell/manager-shell";
import { Input } from "@/components/ui/field";
import { BookCover, BookTitle } from "@/components/ui/book";
import { StatusBadge } from "@/components/ui/status-badge";
import { StepIndicator } from "@/components/ui/step-indicator";
import { messageFor } from "@/domain/kernel/errors";
import { searchBooksForLending } from "@/domain/catalogue/queries/search-books-for-lending";
import { loadPage } from "@/lib/page-data";

/**
 * U1 §2. Stated, not inherited.
 *
 * Every tenancy guarantee this project has is enforced in Postgres — the RLS
 * policies in `0010_rls.sql`, keyed on `olibra.bookshelf_id` — and all of it
 * is downstream of a query actually running. A page served from a cache never
 * runs one, so a cached manager screen is not RLS being defeated; it is RLS
 * never being consulted, with no SQL for any `tests/db/` test to observe. A
 * statically-rendered version of this page would have been rendered at build
 * time, with no session at all, and then handed to everyone who asked.
 *
 * Reading `cookies()` inside `loadPage` already opts this route out of static
 * rendering, but that is a side effect of an implementation detail, and it
 * disappears the day the cookie read moves or a `use cache` is added above it.
 * `tests/architecture/pages-reading-the-database-are-dynamic.test.ts` is the
 * actual deliverable: it fails if this line is deleted, and it covers every
 * page that reaches the database, not only this one.
 */
export const dynamic = "force-dynamic";

/**
 * Small integers, still through the locale. SDD §6.6: "Dates and numbers are
 * formatted through the locale, never with hand-written format strings" —
 * shelf sizes are not a special case, and the point of routing them through
 * one formatter is that adding a second locale stays a translation task.
 */
const NUMBER = new Intl.NumberFormat("vi-VN");

export default async function ChoMuonTimSachPage({
  params,
  searchParams,
}: {
  params: Promise<{ shelf: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { shelf: slug } = await params;
  const { q } = await searchParams;
  const query = q ?? "";

  const { shelfName, results } = await loadPage(slug, async (tx, ctx) => {
    // The shelf's own name, for the chrome. Read here rather than through a
    // query because there is no `GetShelfHeader` in OPS §3 and inventing one
    // for a page heading would be a domain change this slice is not making —
    // the same reasoning U1 §4 gives for a shelf's per-shelf lending policy
    // being read by the page rather than inside a query. It is a plain read
    // inside the same scoped transaction, so `bookshelves_tenant` applies to
    // it exactly as to everything else, and it names only the column it needs
    // — never one BR §16.1 withholds.
    //
    // `tests/db/bookshelves-public-columns.test.ts` is what enforces that, and
    // it reads this file as raw text with no comment stripping (it cannot strip
    // strings, because the column names it is looking for live inside a
    // template literal). So the withheld column names must not appear in this
    // prose either — which is why the sentence above describes one rather than
    // naming it.
    const [shelf] = await tx<{ name: string }[]>`
      select name from bookshelves where id = ${ctx.bookshelfId}
    `;
    return {
      shelfName: shelf.name,
      results: await searchBooksForLending(tx, ctx, { q: query }),
    };
  });

  const base = `/tu-sach/${slug}/quan-ly`;

  return (
    <ManagerShell shelfName={shelfName} shelfSlug={slug} active="cho-muon">
      <StepIndicator
        steps={["Tìm sách", "Chọn người đọc", "Xác nhận"]}
        current={1}
      />

      <h1 className="mt-6 text-[28px] leading-tight font-semibold">
        Tìm sách cần cho mượn
      </h1>

      <form action={`${base}/cho-muon`} className="mt-5 max-w-xl space-y-2">
        <Input
          name="q"
          icon={Search}
          defaultValue={query}
          aria-label="Tìm sách cần cho mượn"
          className="h-14 text-[17px]"
        />
        <p className="text-[14px] text-meta">
          Không cần gõ dấu — gõ de men vẫn tìm ra Dế Mèn.
        </p>
      </form>

      {results.length > 0 ? (
        <ul className="mt-8 max-w-2xl divide-y divide-hairline border-y border-hairline">
          {results.map((book) => {
            const content = (
              <>
                {/* Cover and text stay in one row even when the row stacks
                    below sm — `sm:contents` folds this wrapper away at sm and
                    up so its children rejoin the row as plain flex items. */}
                <div className="flex items-center gap-4 sm:contents">
                  <BookCover title={book.title} className="w-12 text-[1rem]" />
                  <div className="min-w-0 flex-1">
                    <BookTitle className="line-clamp-2 text-base leading-snug">
                      {book.title}
                    </BookTitle>
                    <p className="truncate text-[14px] text-meta">{book.author}</p>
                    {book.reason ? (
                      // The reason the query hands back is an `ErrorCode`, and
                      // it is the same code `LendCopy` would throw — BR §16.3,
                      // so the screen refuses before the confirm step for the
                      // reason the command would refuse for. The sentence is
                      // looked up rather than written here: errors.ts:11-16,
                      // "a screen calls ERROR_MESSAGES[code] rather than
                      // writing its own wording for a rule it did not define."
                      //
                      // Keyed on `reason` rather than on `blocked`, because
                      // `LendableBookRow` declares the two as independent
                      // fields (`blocked: boolean; reason?: ErrorCode`) even
                      // though the query only ever sets them together —
                      // narrowing on the optional field is the version that
                      // needs no non-null assertion, and no domain change.
                      <p className="mt-1 text-[13px] text-meta">
                        {messageFor(book.reason)}
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3 pl-16 sm:pl-0">
                  {/* A badge only where the aggregate has an unambiguous
                      state. `copiesAvailable > 0` is "Còn sách" and nothing
                      else. A blocked title has no honest badge: the query
                      folds lost and retired into one `copy_lost_or_retired`
                      deliberately — one code, one sentence — so choosing
                      between STATUS.lost ("Đã mất") and STATUS.retired
                      ("Ngừng dùng") here would be the screen inventing a
                      distinction the domain refused to make. The sentence
                      above carries the meaning instead. */}
                  {book.blocked ? null : (
                    <StatusBadge status="available" size="sm" />
                  )}
                  <span className="text-[14px] text-meta">
                    {NUMBER.format(book.copiesAvailable)}/
                    {NUMBER.format(book.copiesTotal)} bản
                  </span>
                  {book.blocked ? null : (
                    <ChevronRight
                      aria-hidden
                      className="size-5 text-meta"
                      strokeWidth={1.75}
                    />
                  )}
                </div>
              </>
            );

            if (book.blocked) {
              return (
                // No aria-disabled: the listitem role does not support it. The
                // row carries no control, and the inline reason states plainly
                // why it cannot be chosen, which is what a screen reader needs.
                <li
                  key={book.bookId}
                  className="flex flex-col gap-2 bg-paper py-4 sm:flex-row sm:items-center sm:gap-4"
                >
                  {content}
                </li>
              );
            }

            return (
              <li key={book.bookId}>
                <Link
                  href={`${base}/cho-muon/nguoi-doc`}
                  className="flex flex-col gap-2 py-4 hover:bg-paper sm:flex-row sm:items-center sm:gap-4"
                >
                  {content}
                </Link>
              </li>
            );
          })}
        </ul>
      ) : query.trim() ? (
        <p className="mt-8 max-w-2xl text-[15px] text-meta">
          Không tìm thấy sách nào
        </p>
      ) : null}

      <Link
        href={`${base}/sach/moi`}
        className="mt-6 inline-flex min-h-11 items-center gap-1.5 text-[15px] font-medium text-sage hover:underline"
      >
        <Plus aria-hidden className="size-4" strokeWidth={2} />
        Không thấy sách? Thêm sách mới
      </Link>
    </ManagerShell>
  );
}
