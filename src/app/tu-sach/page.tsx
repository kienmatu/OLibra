import Link from "next/link";
import { ChevronRight, Library, MapPin, Search } from "lucide-react";
import { Input } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { FrontDoorHeader } from "@/components/shell/public-header";
import { SiteFooter } from "@/components/shell/site-footer";
import { listPublicShelves } from "@/domain/portal/queries/list-public-shelves";
import { loadFrontDoorViewer, loadPublicPage, siteContact } from "@/lib/page-data";
import { SHELF_PARAM } from "@/lib/return-path";
import { param, type SearchParams } from "@/lib/search-params";

export const metadata = { title: "Tìm tủ sách — OLibra" };

/**
 * U1 §2, and it applies here for a reason the manager screens do not have.
 *
 * Those pages are dynamic because a cached render would serve one shelf's rows
 * to another. This page's rows are the same for everybody, which is exactly
 * what makes it the page Next.js would happily render once at build time and
 * hand to every visitor from then on — with the directory frozen at whatever
 * the shelves were on the day of the build, and a search box that searches it.
 * A parish whose shelf was onboarded on Tuesday would be undiscoverable, which
 * is the one thing this page has to do (§1.2).
 *
 * `tests/architecture/pages-reading-the-database-are-dynamic.test.ts` is the
 * deliverable rather than this line: it walks imports and requires the marker
 * on every route that reaches Postgres, this one included.
 */
export const dynamic = "force-dynamic";

/**
 * The one public page about bookshelves, and it exists for one job: letting a
 * stranger find their parish's shelf so they can register for it (§1.2).
 *
 * Name and address only. Book counts, reader counts and the keeper's phone
 * number were here before and should not have been — a person with no
 * membership has no business knowing them (§16.1). Backed by a fixture array,
 * that was a layout decision; backed by `listPublicShelves` it is a live
 * disclosure boundary, and the column list in that query is the whole of what
 * enforces it — see its docstring, and
 * `tests/db/bookshelves-public-columns.test.ts`, which is the guard.
 *
 * **The search runs in Postgres, not here.** It used to be `matches()` from
 * `@/lib/search` over the whole fixture array in this component. Three reasons
 * it moved into the query, in the order they matter:
 *
 * 1. Filtering in the page means fetching every shelf in the deployment on
 *    every keystroke-shaped request and discarding most of them. Four shelves
 *    today; BR §1.4's Phase 3 is "the portal directory, multiple bookshelves",
 *    which is the phase where this page stops being a list and starts being a
 *    directory.
 * 2. `olibra_fold()` in SQL is the folding rule `tests/db/folding.test.ts`
 *    holds in agreement with `src/domain/kernel/fold.ts`. Folding in the page
 *    is a second implementation of BR §12 that agrees today because both call
 *    the same TypeScript function — and stops being obviously the same rule
 *    the moment the directory grows an index on a folded column, which is
 *    where the catalogue already is.
 * 3. OPS §3.1 defines `SearchBookshelves` as an operation with a `q` input,
 *    not as a client-side filter over `GetPortalDirectory`.
 *
 * `@/lib/search` keeps its other callers; nothing about `fold()` changed.
 */
export default async function PortalPage({
  searchParams,
}: {
  // Not `{ q?: string }`. `?q=de&q=men` arrives as an array, and a `.trim()`
  // on it is a `TypeError` from inside a render — see `src/lib/search-params.ts`.
  searchParams: Promise<SearchParams>;
}) {
  const query = (param(await searchParams, "q") ?? "").trim();
  const results = await loadPublicPage((tx) => listPublicShelves(tx, { q: query }));
  // Task 6 (2026-08-10 QA remediation): the header, not this page's own
  // content, is what needed to know who is asking — see
  // `loadFrontDoorViewer`'s docstring for why that is a second, separate
  // read from `listPublicShelves` above rather than one query doing both.
  //
  // U6 §4: and now the page's own content needs it too. Task 6 wired the
  // chrome and stopped there, so this page went on greeting a reader by name
  // in the header and offering them "Đăng nhập" for the shelf they were
  // already a member of, three centimetres below. Same read, no second query.
  const viewer = await loadFrontDoorViewer();
  const contact = await siteContact();
  const mine = new Set(viewer?.shelves.map((s) => s.slug) ?? []);

  return (
    <>
      <FrontDoorHeader
        viewerName={viewer?.name ?? null}
        isSuperAdmin={viewer?.isSuperAdmin ?? false}
        shelves={viewer?.shelves ?? []}
      />

      <main className="mx-auto max-w-2xl px-6 py-14">
        <h1 className="text-[28px] leading-tight font-semibold">Tìm tủ sách</h1>
        {/* Two sentences, because the page means two different things to the
            two people reading it. A stranger is here to find their parish and
            get an account; a member is here because the directory is the only
            cross-shelf page in the application, and telling *them* to sign in
            is telling somebody who is signed in to sign in. */}
        <p className="mt-1.5 text-meta">
          {viewer
            ? "Tủ sách của bạn ở đây. Bạn cũng có thể xem các tủ sách khác trong hệ thống."
            : "Chọn tủ sách của giáo xứ mình để đăng nhập, hoặc để đăng ký nếu bạn chưa có tài khoản."}
        </p>

        <form action="/tu-sach" className="mt-7">
          <Input
            name="q"
            icon={Search}
            defaultValue={query}
            className="h-14"
            placeholder="Tên giáo xứ hoặc địa phương"
            aria-label="Tìm tủ sách"
          />
          <p className="mt-2 text-[14px] text-meta">Không cần gõ dấu.</p>
        </form>

        {results.length > 0 ? (
          <ul className="mt-8 divide-y divide-hairline border-y border-hairline">
            {results.map((shelf) => {
              /**
               * U6 §4. Where this row goes depends on who is reading it, and
               * until now it went to `/dang-nhap` for everybody — including a
               * reader whose own shelf it was.
               *
               * Three cases, and the middle one is the one worth naming: a
               * signed-in visitor looking at a shelf they do *not* belong to
               * wants to register for it, not to sign in again. `/dang-ky`
               * reads the same `SHELF_PARAM` and renders that shelf's own
               * registration form.
               */
              const isMine = mine.has(shelf.slug);
              const href = isMine
                ? `/tu-sach/${shelf.slug}`
                : `/${viewer ? "dang-ky" : "dang-nhap"}?${SHELF_PARAM}=${encodeURIComponent(shelf.slug)}`;

              return (
                <li key={shelf.slug}>
                  {/* Nit 14 / IMPORTANT 3: `?tu-sach=` was on every one of these
                    links from the day the portal shipped and was read by
                    nothing, while the sign-in page it points at took its
                    heading from a fixture and named Đồng Tháp to everybody.
                    `SHELF_PARAM` is now the one spelling both ends share. */}
                  <Link
                    href={href}
                    className="group flex min-h-11 items-center gap-4 py-5"
                  >
                    <div className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2.5">
                        <span className="text-lg font-semibold group-hover:text-terracotta-ink">
                          {shelf.name}
                        </span>
                        {/* The row that behaves differently looks different.
                          `Pill` because this is a state — your membership —
                          and §17.2's rule that a state carries an icon and a
                          word applies to it as much as to a copy's. */}
                        {isMine ? (
                          <Pill
                            icon={Library}
                            label="Tủ sách của bạn"
                            tone="sage"
                          />
                        ) : null}
                      </span>
                      {/* A shelf onboarded without an address is a directory
                        entry with a name and no address — a thinner row, not
                        an error, and not a MapPin pointing at nothing. */}
                      {shelf.location ? (
                        <span className="mt-1 flex items-start gap-2 text-[15px] text-meta">
                          <MapPin
                            aria-hidden
                            className="mt-0.5 size-[18px] shrink-0"
                            strokeWidth={1.75}
                          />
                          {shelf.location}
                        </span>
                      ) : null}
                    </div>
                    {/* The action in words, for a signed-in reader only. A
                      stranger's every row does the same thing — sign in — so
                      naming it on each of them is five copies of one sentence
                      the paragraph above already carries. A member's rows do
                      two different things, which is exactly when the word
                      earns its place beside the chevron. */}
                    {viewer ? (
                      <span className="shrink-0 text-[15px] text-meta group-hover:text-terracotta-ink">
                        {isMine ? "Vào tủ sách" : "Đăng ký"}
                      </span>
                    ) : null}
                    <ChevronRight
                      aria-hidden
                      className="size-5 shrink-0 text-meta"
                      strokeWidth={1.75}
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : query === "" ? (
          // P3-1: a system with no shelves at all read the identical "no
          // results" copy a search that came up empty does — "Thử gõ tên
          // giáo xứ ngắn hơn" makes no sense to a visitor who has not typed
          // anything yet. Distinguished on `query` alone, not on the shelf
          // count: this is what nothing-searched-yet looks like precisely
          // because an empty query matches every shelf that exists
          // (`listPublicShelves`'s own `%' || '' || '%'`), so zero rows back
          // for an empty query means the installation itself has none.
          <div className="mt-8 rounded-card border border-hairline bg-paper p-8">
            <h2 className="text-lg font-semibold">
              Chưa có tủ sách nào trên OLibra.
            </h2>
            <p className="mt-1.5 text-[15px] text-meta">
              Giáo xứ của bạn muốn mở một tủ sách?{" "}
              <Link
                href="/lien-he"
                className="font-medium text-sage hover:underline"
              >
                Liên hệ với ban quản trị
              </Link>{" "}
              để bắt đầu.
            </p>
          </div>
        ) : (
          <div className="mt-8 rounded-card border border-hairline bg-paper p-8">
            <h2 className="text-lg font-semibold">Không tìm thấy tủ sách nào</h2>
            <p className="mt-1.5 text-[15px] text-meta">
              Thử gõ tên giáo xứ ngắn hơn. Nếu giáo xứ của bạn chưa có tủ sách trên
              OLibra,{" "}
              <Link
                href="/lien-he"
                className="font-medium text-sage hover:underline"
              >
                liên hệ với ban quản trị
              </Link>{" "}
              để mở một tủ mới.
            </p>
          </div>
        )}
      </main>

      <SiteFooter contact={contact} />
    </>
  );
}
