import { BookOpen, ChevronLeft, ChevronRight, Library } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { BookCard } from "@/components/ui/book";
import { Chip, Segmented } from "@/components/ui/segmented";
import { ShelfHeader } from "@/components/shell/public-header";
import {
  type CatalogueInput,
  getCatalogue,
} from "@/domain/catalogue/queries/get-catalogue";
import { readCatalogueCategories } from "@/lib/catalogue";
import { loadPage } from "@/lib/page-data";
import { param, type SearchParams } from "@/lib/search-params";
import { readShelfIdentity } from "@/lib/shelf";
import { statusForAvailability } from "@/lib/status";

/** U1 §2. See `src/app/tu-sach/[shelf]/page.tsx` for the long version. */
export const dynamic = "force-dynamic";

const NUMBER = new Intl.NumberFormat("vi-VN");

/**
 * The query parameters this page reads, all Vietnamese, as every other
 * parameter this app emits is (`?loc=`, `?loi=`, `?tiep=`, `?sach=`).
 *
 * `loc` predates this slice — it is the segmented control's own parameter and
 * the shelf home already links to `?loc=tat-ca` — so it keeps its spelling
 * rather than being renamed for tidiness, which would break a link a member may
 * have bookmarked.
 */
const SCOPE = "loc";
const CATEGORY = "the-loai";
const SORT = "sap-xep";
const PAGE = "trang";

/** The one `sap-xep` value that is not the default — `CatalogueInput`'s "title". */
const SORT_BY_TITLE = "ten";

/**
 * `?trang=` as a page number, or 1.
 *
 * A query parameter is a string somebody can type, so every way of getting it
 * wrong ends at page 1 rather than at an error: `?trang=abc` is `NaN`,
 * `?trang=0` and `?trang=-3` are not pages, and `?trang=99999999999999999999`
 * is not a safe integer and would otherwise be handed to Postgres as an
 * `offset` in exponential notation. `getCatalogue` clamps the low end too
 * (`Math.max(1, …)`), but `Math.max(1, NaN)` is `NaN`, so the guard has to be
 * here — this is exactly the class of defect `src/lib/search-params.ts` exists
 * for, one type further along.
 */
function pageFrom(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? "", 10);
  return Number.isSafeInteger(n) && n > 0 ? n : 1;
}

/**
 * BR:505's catalogue: "a cover-forward responsive grid — two columns on
 * phones, up to six on desktop… A filter bar offers availability, category, and
 * sort. The available/all toggle is a segmented control, not a dropdown,
 * because it is the single most-used control on the page."
 *
 * **Every control on this page is a link.** The fixture version used `<Select>`
 * for category and sort, which cannot apply itself without client JavaScript —
 * and these are server components with none. The alternatives were a `<form>`
 * with a submit button (which needs a Vietnamese word for "apply" that no
 * document in this project has written) or the `Chip` component that already
 * exists for exactly this, described in its own file as "filter chips — used
 * where a dropdown would hide the counts". Chips it is: no new copy, no
 * JavaScript, a shareable URL for every combination, and a back button that
 * behaves.
 *
 * **The search box is gone rather than left inert.** `CatalogueInput` has no
 * `q` — search is `searchCatalogue` and it has its own page (BR:519, and the
 * "Tìm kiếm" link in the header). An input on this page could only have been a
 * box that discards what a child types into it.
 */
export default async function CataloguePage({
  params,
  searchParams,
}: {
  params: Promise<{ shelf: string }>;
  // Not `{ loc?: string }`. `?loc=a&loc=b` arrives as an array — see
  // `src/lib/search-params.ts` for the four pages that shipped a 500 over it.
  searchParams: Promise<SearchParams>;
}) {
  const { shelf: slug } = await params;
  const search = await searchParams;

  const showingAll = param(search, SCOPE) === "tat-ca";
  const sortByTitle = param(search, SORT) === SORT_BY_TITLE;
  // A category that names nothing is a filter that matches nothing, which is
  // what `getCatalogue`'s `c.slug = …` already does with it — an empty grid and
  // an honest "0 đầu sách", never an error. The chips below simply will not
  // show it as selected.
  const category = param(search, CATEGORY);

  const input: CatalogueInput = {
    scope: showingAll ? "all" : "available",
    category,
    sort: sortByTitle ? "title" : "recent",
    page: pageFrom(param(search, PAGE)),
  };

  const { shelf, viewer, categories, page } = await loadPage(
    slug,
    async (tx, ctx, viewer) => ({
      shelf: await readShelfIdentity(tx, ctx),
      viewer,
      categories: await readCatalogueCategories(tx, ctx),
      page: await getCatalogue(tx, ctx, input),
    }),
  );

  const base = `/tu-sach/${slug}`;

  /**
   * This page's URL with one parameter changed and the rest kept.
   *
   * Built from the *resolved* values rather than by copying the incoming query
   * string, so a hostile or duplicated parameter cannot ride along into a link
   * the page itself emits — `?loc=tat-ca&loc=<script>` becomes `?loc=tat-ca`.
   * Changing any filter also drops `trang`, because page 4 of a different
   * filter is a page nobody asked for and usually does not exist.
   */
  const hrefWith = (over: {
    scope?: boolean;
    category?: string | null;
    sortByTitle?: boolean;
    page?: number;
  }): string => {
    const all = over.scope ?? showingAll;
    const cat = over.category === undefined ? category : over.category;
    const byTitle = over.sortByTitle ?? sortByTitle;
    const trang = over.page ?? 1;

    const query = new URLSearchParams();
    if (all) query.set(SCOPE, "tat-ca");
    if (cat) query.set(CATEGORY, cat);
    if (byTitle) query.set(SORT, SORT_BY_TITLE);
    if (trang > 1) query.set(PAGE, String(trang));
    const string = query.toString();
    return string ? `${base}/danh-muc?${string}` : `${base}/danh-muc`;
  };

  return (
    <>
      <ShelfHeader
        shelfName={shelf.name}
        shelfSlug={slug}
        active="danh-muc"
        viewerName={viewer.name}
      />

      <main className="mx-auto max-w-6xl px-6 py-10">
        <h1 className="text-[28px] leading-tight font-semibold">Danh mục sách</h1>
        {/* "đầu sách", not "cuốn": `getCatalogue` returns one row per title, so
            this is a count of titles. The fixture page said "cuốn" over a
            number that was never copies. */}
        <p className="mt-1 text-meta">{NUMBER.format(page.total)} đầu sách</p>

        <div className="mt-6 space-y-4">
          {/* Availability, as BR:505 specifies: a segmented control, never a
              dropdown. */}
          <Segmented
            options={[
              {
                href: hrefWith({ scope: false }),
                label: "Sách có sẵn",
                icon: BookOpen,
                active: !showingAll,
              },
              {
                href: hrefWith({ scope: true }),
                label: "Toàn bộ tủ sách",
                icon: Library,
                active: showingAll,
              },
            ]}
          />

          {/* Only when the shelf stocks more than one category. One chip that
              cannot be turned off beside a "Tất cả" that means the same thing
              is two controls for no choice. */}
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
            {/* "Mới thêm" is the catalogue's own existing wording for
                `sort: "recent"`. "Tên sách" is the other half of the search
                box's existing "Tìm tên sách hoặc tác giả" — the fixture's third
                option, "Mượn nhiều nhất", is gone because nothing counts loans
                per title (see the shelf home for the same gap). */}
            <Chip href={hrefWith({ sortByTitle: false })} active={!sortByTitle}>
              Mới thêm
            </Chip>
            <Chip href={hrefWith({ sortByTitle: true })} active={sortByTitle}>
              Tên sách
            </Chip>
          </div>
        </div>

        {page.rows.length > 0 ? (
          <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5 lg:gap-6 xl:grid-cols-6">
            {page.rows.map((book) => (
              <BookCard
                key={book.slug}
                href={`${base}/sach/${book.slug}`}
                title={book.title}
                author={book.author}
                status={statusForAvailability(book.availability)}
              />
            ))}
          </div>
        ) : (
          <p className="mt-8 text-[15px] text-meta">Không tìm thấy sách nào</p>
        )}

        {page.pageCount > 1 ? (
          <nav className="mt-10 flex items-center justify-between gap-4">
            <p className="text-[15px] text-meta">
              Trang {NUMBER.format(page.page)} / {NUMBER.format(page.pageCount)}
            </p>
            <div className="flex gap-2">
              {/* A disabled <button> at the ends rather than a link to nowhere:
                  it keeps the pair the same width on both edges, and
                  globals.css withholds the pointer cursor from `:disabled`
                  precisely so a control that will not respond does not claim it
                  will. */}
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
      </main>
    </>
  );
}
