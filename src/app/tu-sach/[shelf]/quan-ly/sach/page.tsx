import { ChevronLeft, ChevronRight, Plus, Search } from "lucide-react";
import { ButtonLink, Button } from "@/components/ui/button";
import { PageHeading } from "@/components/ui/card";
import { BookCover, BookTitle } from "@/components/ui/book";
import { Input } from "@/components/ui/field";
import { StatusBadge } from "@/components/ui/status-badge";
import { Chip } from "@/components/ui/segmented";
import { ManagerShell } from "@/components/shell/manager-shell";
import {
  type BooksListInput,
  getBooksList,
} from "@/domain/catalogue/queries/get-books-list";
import { getManagerBadgeCounts } from "@/domain/shelf/queries/get-manager-dashboard";
import { readCatalogueCategories } from "@/lib/catalogue";
import { loadPage } from "@/lib/page-data";
import { pageNumber, param, type SearchParams } from "@/lib/search-params";
import { readShelf } from "@/lib/shelf";
import { statusForAvailability } from "@/lib/status";

/** U1 §2. See `src/app/tu-sach/[shelf]/quan-ly/cho-muon/page.tsx` for the long version. */
export const dynamic = "force-dynamic";

const NUMBER = new Intl.NumberFormat("vi-VN");

/**
 * The parameters this page reads. `the-loai`, `sap-xep` and `trang` are the
 * spellings `danh-muc` already uses, so the two list screens in this app read
 * their URLs the same way; `q` is the one the three lending screens already
 * use for a search box.
 */
const CATEGORY = "the-loai";
const SORT = "sap-xep";
const PAGE = "trang";
const QUERY = "q";

/** `BooksListInput`'s "title" — `danh-muc`'s own value for the same choice. */
const SORT_BY_TITLE = "ten";

/**
 * BR §16.3's Sách list: "a responsive list with search and filters; a table on
 * desktop, stacked cards on mobile."
 *
 * **Every control is a link or a `GET` form**, as `danh-muc` established: these
 * are server components with no client JavaScript, so a `<Select>` could never
 * apply itself. The category and sort controls are `Chip`s, which is what that
 * component exists for ("filter chips — used where a dropdown would hide the
 * counts"), and the search box is a real `<form>` that navigates. The fixture
 * version's three `<Select>`s were inert, and its search box discarded whatever
 * a volunteer typed into it.
 *
 * **The "Mượn nhiều nhất" sort is gone**, because nothing counts loans per
 * title — the same gap `danh-muc` records for the same missing sort.
 *
 * **The "Đã mất (n)" chip is gone**, and that one is U3 §3.1 rather than a
 * missing sort. Its count was `lostCopies.length` from `src/lib/fixtures.ts`,
 * and no query in this codebase can answer it: nothing selects copies by state
 * across a shelf. BR:559 makes the count the reason that control exists at all
 * ("finding the one lost copy inside a shelf of a few hundred books… is not
 * realistic"), so a chip with the number removed would not be the same control
 * with less on it. The lost-copies view is a later wave of this slice, and the
 * chip comes back with a real count when the query behind it does.
 *
 * **The per-row "Sửa" button is gone** for a plainer reason: it was a `<button>`
 * with no form and no action, so it did nothing at all. "Xem bản" reaches
 * `quan-ly/sach/[id]`, which is wired and is where a copy is actually managed.
 *
 * **"Thêm sách" stays, and it points at a page that is still fixture.** That is
 * a deliberate exception to the rule U2 applied to the reader header, on the
 * narrow ground that this same link already ships from `quan-ly/cho-muon`
 * ("Không thấy sách? Thêm sách mới") — removing it here while leaving it there
 * would make the two screens disagree about whether the affordance exists —
 * and that BR §16.3 makes it this list's primary action. A later wave wires the
 * form. Recorded here rather than left to be discovered.
 */
export default async function ManagerBooksPage({
  params,
  searchParams,
}: {
  params: Promise<{ shelf: string }>;
  // Not `{ q?: string }`. `?q=de&q=men` arrives as an array — see
  // `src/lib/search-params.ts` for the four pages that shipped a 500 over it.
  searchParams: Promise<SearchParams>;
}) {
  const { shelf: slug } = await params;
  const search = await searchParams;

  const query = param(search, QUERY) ?? "";
  const sortByTitle = param(search, SORT) === SORT_BY_TITLE;
  // A category that names nothing is a filter that matches nothing, which is
  // what `getBooksList`'s own `c.slug = …` already does with it — an empty
  // table and an honest "0 đầu sách", never an error.
  const category = param(search, CATEGORY);

  const input: BooksListInput = {
    q: query,
    category,
    sort: sortByTitle ? "title" : "recent",
    page: pageNumber(param(search, PAGE)),
  };

  const { shelf, viewer, counts, categories, page } = await loadPage(
    slug,
    async (tx, ctx, viewer) => ({
      shelf: await readShelf(tx, ctx),
      viewer,
      counts: await getManagerBadgeCounts(tx, ctx),
      // `includeDrafts`, unlike the reader catalogue's filter bar: this list
      // shows drafts, so a bar that could not filter to them would be offering
      // a choice that contradicts the table under it.
      categories: await readCatalogueCategories(tx, ctx, { includeDrafts: true }),
      page: await getBooksList(tx, ctx, input),
    }),
  );

  const base = `/tu-sach/${slug}/quan-ly`;

  /**
   * This page's URL with one filter changed and the rest kept — built from the
   * *resolved* values rather than by copying the incoming query string, so a
   * duplicated or hostile parameter cannot ride along into a link the page
   * itself emits. Changing a filter drops `trang`, because page 4 of a
   * different filter is a page nobody asked for and usually does not exist.
   */
  const hrefWith = (over: {
    category?: string | null;
    sortByTitle?: boolean;
    page?: number;
  }): string => {
    const cat = over.category === undefined ? category : over.category;
    const byTitle = over.sortByTitle ?? sortByTitle;
    const trang = over.page ?? 1;

    const params = new URLSearchParams();
    if (query) params.set(QUERY, query);
    if (cat) params.set(CATEGORY, cat);
    if (byTitle) params.set(SORT, SORT_BY_TITLE);
    if (trang > 1) params.set(PAGE, String(trang));
    const string = params.toString();
    return string ? `${base}/sach?${string}` : `${base}/sach`;
  };

  return (
    <ManagerShell
      shelfName={shelf.name}
      shelfSlug={slug}
      active="sach"
      viewer={viewer}
      counts={counts}
    >
      {/* "đầu sách", not "cuốn": `getBooksList` returns one row per title, so
          this is a count of titles and not of copies. The fixture page read
          "214 đầu sách · 268 bản" over numbers that were neither. */}
      <PageHeading
        title="Sách"
        subtitle={`${NUMBER.format(page.total)} đầu sách`}
        action={
          <ButtonLink href={`${base}/sach/moi`} variant="primary" size="lg">
            <Plus aria-hidden className="size-5" strokeWidth={1.75} />
            Thêm sách
          </ButtonLink>
        }
      />

      {/* A GET form, so the search is in the URL and survives a refresh, a back
          button and a link pasted to another volunteer. The hidden fields carry
          the filters that are already on, so searching inside a category does
          not silently drop the category. */}
      <form action={`${base}/sach`} className="mt-6 flex flex-wrap gap-3">
        <div className="w-full flex-1 sm:min-w-64">
          <Input
            name={QUERY}
            icon={Search}
            className="h-11"
            defaultValue={query}
            placeholder="Tìm tên sách hoặc tác giả"
            aria-label="Tìm tên sách hoặc tác giả"
          />
        </div>
        {category ? <input type="hidden" name={CATEGORY} value={category} /> : null}
        {sortByTitle ? (
          <input type="hidden" name={SORT} value={SORT_BY_TITLE} />
        ) : null}
      </form>

      <div className="mt-4 space-y-3">
        {/* Only when the shelf stocks more than one category: one chip that
            cannot be turned off beside a "Tất cả" meaning the same thing is
            two controls for no choice. `danh-muc` makes the same call. */}
        {categories.length > 1 ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] text-meta">Thể loại</span>
            <Chip href={hrefWith({ category: null })} active={!category}>
              Tất cả
            </Chip>
            {categories.map((c) => (
              <Chip
                key={c.slug}
                href={hrefWith({ category: c.slug })}
                active={category === c.slug}
              >
                {c.name}
              </Chip>
            ))}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[14px] text-meta">Sắp xếp</span>
          <Chip href={hrefWith({ sortByTitle: false })} active={!sortByTitle}>
            Mới thêm
          </Chip>
          <Chip href={hrefWith({ sortByTitle: true })} active={sortByTitle}>
            Tên sách
          </Chip>
        </div>
      </div>

      {page.rows.length === 0 ? (
        <p className="mt-8 text-[15px] text-meta">Không tìm thấy sách nào</p>
      ) : (
        <>
          {/* Table on md and up — hairline rules, never a horizontal scroll. */}
          <div className="mt-6 hidden overflow-hidden rounded-card border border-hairline md:block">
            <table className="w-full text-left">
              <thead className="bg-paper">
                <tr>
                  <th className="px-4 py-3 text-[14px] font-medium text-meta">
                    Sách
                  </th>
                  <th className="px-4 py-3 text-[14px] font-medium text-meta">
                    Tác giả
                  </th>
                  <th className="px-4 py-3 text-[14px] font-medium text-meta">
                    Thể loại
                  </th>
                  <th className="px-4 py-3 text-[14px] font-medium text-meta">
                    Số bản
                  </th>
                  <th className="px-4 py-3 text-[14px] font-medium text-meta">
                    Tình trạng
                  </th>
                  <th className="px-4 py-3 text-[14px] font-medium text-meta">
                    Thao tác
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {page.rows.map((book) => {
                  const status = statusForAvailability(book.availability);
                  return (
                    <tr key={book.slug}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <BookCover
                            title={book.title}
                            className="w-10 text-[0.9rem]"
                          />
                          <div className="min-w-0">
                            <BookTitle className="block truncate text-[16px] leading-snug">
                              {book.title}
                            </BookTitle>
                            {/* The shelf-mark range, and the draft marker
                                beside it. A draft is what this list exists to
                                find (`getBooksList` has no `is_published`
                                filter), and nothing else on the row would say
                                so — the reader catalogue simply does not show
                                the title at all.

                                "Nháp" is not new copy: it is the word the
                                announcements list already labels an unpublished
                                announcement with (`quan-ly/thong-bao`), for the
                                same `published`/`draft` distinction. */}
                            <span className="mt-0.5 block text-[13px] text-meta">
                              {book.codes}
                              {book.isPublished ? "" : " · Nháp"}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-[15px] text-ink/85">
                        {book.author}
                      </td>
                      <td className="px-4 py-3 text-[15px] text-ink/85">
                        {book.category}
                      </td>
                      <td className="px-4 py-3 text-[15px] text-ink/85">
                        {NUMBER.format(book.copiesTotal)}
                      </td>
                      <td className="px-4 py-3">
                        {/* No badge for a title with no live copies at all:
                            `statusForAvailability` returns null for it
                            deliberately, because "Ngừng dùng" would be a claim
                            about copies that were withdrawn and this title has
                            none to withdraw. */}
                        {status ? <StatusBadge status={status} size="sm" /> : null}
                      </td>
                      <td className="px-4 py-3">
                        <ButtonLink
                          href={`${base}/sach/${book.slug}`}
                          variant="quiet"
                          size="sm"
                        >
                          Xem bản
                        </ButtonLink>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Stacked cards below md — the same data, never a scrolling table. */}
          <div className="mt-6 space-y-3 md:hidden">
            {page.rows.map((book) => {
              const status = statusForAvailability(book.availability);
              return (
                <div
                  key={book.slug}
                  className="rounded-card border border-hairline bg-surface p-4"
                >
                  <div className="flex items-start gap-3">
                    <BookCover title={book.title} className="w-14 text-[1.1rem]" />
                    <div className="min-w-0 flex-1">
                      <BookTitle className="block truncate text-[16px] leading-snug">
                        {book.title}
                      </BookTitle>
                      <p className="mt-0.5 truncate text-[14px] text-meta">
                        {book.author}
                      </p>
                      <p className="mt-0.5 text-[13px] text-meta">
                        {book.codes}
                        {book.isPublished ? "" : " · Nháp"}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {status ? <StatusBadge status={status} size="sm" /> : null}
                        <span className="text-[13px] text-meta">
                          {book.category} · {NUMBER.format(book.copiesTotal)} bản
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <ButtonLink
                      href={`${base}/sach/${book.slug}`}
                      variant="quiet"
                      size="sm"
                      className="flex-1"
                    >
                      Xem bản
                    </ButtonLink>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {page.pageCount > 1 ? (
        <nav className="mt-8 flex items-center justify-between gap-4">
          <p className="text-[15px] text-meta">
            Trang {NUMBER.format(page.page)} / {NUMBER.format(page.pageCount)}
          </p>
          <div className="flex gap-2">
            {/* A disabled <button> at the ends rather than a link to nowhere:
                it keeps the pair the same width on both edges, and globals.css
                withholds the pointer cursor from `:disabled` precisely so a
                control that will not respond does not claim it will. */}
            {page.page > 1 ? (
              <ButtonLink size="sm" href={hrefWith({ page: page.page - 1 })}>
                <ChevronLeft aria-hidden className="size-5" strokeWidth={1.75} />
                Trước
              </ButtonLink>
            ) : (
              <Button size="sm" disabled>
                <ChevronLeft aria-hidden className="size-5" strokeWidth={1.75} />
                Trước
              </Button>
            )}
            {page.page < page.pageCount ? (
              <ButtonLink size="sm" href={hrefWith({ page: page.page + 1 })}>
                Sau
                <ChevronRight aria-hidden className="size-5" strokeWidth={1.75} />
              </ButtonLink>
            ) : (
              <Button size="sm" disabled>
                Sau
                <ChevronRight aria-hidden className="size-5" strokeWidth={1.75} />
              </Button>
            )}
          </div>
        </nav>
      ) : null}
    </ManagerShell>
  );
}
