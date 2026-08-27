import Link from "next/link";
import { ChevronRight, Search, SearchX } from "lucide-react";
import { BookCover, BookTitle } from "@/components/ui/book";
import { StatusBadge } from "@/components/ui/status-badge";
import { Input } from "@/components/ui/field";
import { ShelfHeader } from "@/components/shell/public-header";
import { getCatalogue } from "@/domain/catalogue/queries/get-catalogue";
import { searchCatalogue } from "@/domain/catalogue/queries/search-catalogue";
import { atLeast } from "@/domain/kernel/tenant";
import { loadPage } from "@/lib/page-data";
import { param, type SearchParams } from "@/lib/search-params";
import { readShelfIdentity } from "@/lib/shelf";
import { statusForAvailability } from "@/lib/status";

/** U1 §2. See `src/app/tu-sach/[shelf]/page.tsx` for the long version. */
export const dynamic = "force-dynamic";

export const metadata = { title: "Tìm sách — OLibra" };

const NUMBER = new Intl.NumberFormat("vi-VN");

/** How many covers the empty state offers. */
const SUGGESTIONS = 4;

/**
 * BR:519's search: "matching title and author, diacritic-insensitive. The empty
 * state suggests popular books rather than showing nothing."
 *
 * **The folding happens in Postgres**, through `searchCatalogue` and
 * `olibra_fold()` — the same function `books.title_folded` and
 * `books.author_folded` are generated over, so both sides of the comparison go
 * through one implementation of BR §12. Nothing on this page folds anything;
 * the fixture version called `matches()` from `@/lib/search` over an array of
 * twelve books in the component body.
 *
 * **Two things BR:519 asks for that are not here, and neither is faked.**
 *
 * - *"Live results as the reader types."* This is a server component with no
 *   client JavaScript, so results arrive on submit. The hint under the box
 *   used to promise otherwise ("kết quả hiện ngay khi bạn gõ") and now says
 *   what the lending search already says, which is both true and the more
 *   useful fact: you do not need diacritics.
 * - *"Suggests popular books."* Nothing counts loans per title — see the shelf
 *   home for the same gap and the same reason it is not being closed here. The
 *   empty state offers the shelf's most recently added available titles
 *   instead, under the catalogue's own word for that ordering.
 */
export default async function SearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ shelf: string }>;
  // Not `{ q?: string }`. `?q=de&q=men` arrives as an array and `q.trim()`
  // inside the query is then a `TypeError` — see `src/lib/search-params.ts`.
  searchParams: Promise<SearchParams>;
}) {
  const { shelf: slug } = await params;
  const query = (param(await searchParams, "q") ?? "").trim();

  const { shelf, viewer, results, suggestions } = await loadPage(
    slug,
    async (tx, ctx, viewer) => {
      const results = await searchCatalogue(tx, ctx, { q: query });
      return {
        shelf: await readShelfIdentity(tx, ctx),
        viewer,
        results,
        // Only when there is nothing to show. Both the "no results" state and
        // the "has not typed anything yet" state land here — `searchCatalogue`
        // returns nothing for a blank term by design — so a member arriving
        // from the header link sees covers rather than an empty page.
        suggestions:
          results.length > 0
            ? []
            : (
                await getCatalogue(tx, ctx, {
                  scope: "available",
                  sort: "recent",
                  pageSize: SUGGESTIONS,
                })
              ).rows,
      };
    },
  );

  const base = `/tu-sach/${slug}`;

  return (
    <>
      <ShelfHeader
        shelfName={shelf.name}
        shelfSlug={slug}
        active="tim-kiem"
        viewerName={viewer.name}
        unreadNotifications={viewer.unreadNotifications}
        canManage={atLeast(viewer.role, "manager")}
        isSuperAdmin={atLeast(viewer.role, "super_admin")}
      />

      <main className="mx-auto max-w-3xl px-6 py-10">
        {/* The search field is meant to be the dominant element, so the page
            heading is present for screen readers without competing visually. */}
        <h1 className="sr-only">Tìm sách</h1>

        <form action={`${base}/tim-kiem`} className="space-y-2">
          <Input
            name="q"
            icon={Search}
            defaultValue={query}
            className="h-16 text-lg"
            aria-label="Tìm sách"
          />
          <p className="text-[14px] text-meta">
            Không cần gõ dấu — gõ de men vẫn tìm ra Dế Mèn.
          </p>
        </form>

        {results.length > 0 ? (
          <>
            <p className="mt-8 text-[14px] text-meta">
              {NUMBER.format(results.length)} kết quả cho “{query}”
            </p>
            <ul className="mt-2 divide-y divide-hairline border-t border-hairline">
              {results.map((book) => {
                const status = statusForAvailability(book.availability);
                return (
                  <li key={book.slug}>
                    <Link
                      href={`${base}/sach/${book.slug}`}
                      className="group flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:gap-4"
                    >
                      {/* The row stacks below `sm`, the same way the lending
                          search's rows do and for the same reason — measured at
                          375px, where a fixed-width badge and chevron beside the
                          text left "Cho Tôi Xin Một Vé Đi Tuổi Thơ" wrapping
                          onto four lines in a column about eight characters
                          wide. `sm:contents` folds this wrapper away at `sm` and
                          up, so its children rejoin the row as plain flex items
                          and the desktop layout is unchanged. */}
                      <div className="flex items-center gap-4 sm:contents">
                        <BookCover
                          title={book.title}
                          coverUrl={book.coverUrl}
                          className="w-13 text-[1.2rem]"
                        />
                        <div className="min-w-0 flex-1">
                          <BookTitle className="block text-lg leading-snug group-hover:text-terracotta-ink">
                            {book.title}
                          </BookTitle>
                          {book.author ? (
                            <p className="mt-0.5 text-[14px] text-meta">
                              {book.author}
                            </p>
                          ) : null}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-3 pl-17 sm:pl-0">
                        {/* No badge for a title with no live copies at all —
                            `statusForAvailability` returns null rather than
                            claiming "Ngừng dùng" about copies that do not
                            exist. */}
                        {status ? <StatusBadge status={status} /> : null}
                        <ChevronRight
                          aria-hidden
                          className="size-5 shrink-0 text-meta"
                          strokeWidth={1.75}
                        />
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        ) : query || suggestions.length > 0 ? (
          // Neither a searched-for term nor anything to suggest means an empty
          // shelf and a member who has typed nothing: an empty bordered box
          // with a heading about a search nobody ran would be the page
          // inventing a state.
          <div className="mt-8 rounded-card border border-hairline bg-paper p-8">
            {/* Only claim "not found" when something was actually searched for.
                A member who has just tapped "Tìm kiếm" in the header has typed
                nothing, and telling them their search failed is a small lie
                that the fixture page told on every first load. */}
            {query ? (
              <>
                <SearchX
                  aria-hidden
                  className="size-8 text-leather"
                  strokeWidth={1.5}
                />
                <h2 className="mt-3 text-lg font-semibold">
                  Không tìm thấy sách nào
                </h2>
                <p className="mt-1.5 text-[15px] text-meta">Thử gõ ít chữ hơn.</p>
              </>
            ) : null}

            {suggestions.length > 0 ? (
              <div className={query ? "mt-6" : undefined}>
                <h3 className="text-[16px] font-semibold">Mới thêm</h3>
                <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
                  {suggestions.map((book) => (
                    <Link
                      key={book.slug}
                      href={`${base}/sach/${book.slug}`}
                      className="group"
                    >
                      <BookCover
                        title={book.title}
                        coverUrl={book.coverUrl}
                        className="w-full text-[1.4rem]"
                      />
                      <BookTitle className="mt-2 line-clamp-2 block text-[14px] leading-snug group-hover:text-terracotta-ink">
                        {book.title}
                      </BookTitle>
                      {book.author ? (
                        <span className="text-[14px] text-meta">{book.author}</span>
                      ) : null}
                    </Link>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </main>
    </>
  );
}
