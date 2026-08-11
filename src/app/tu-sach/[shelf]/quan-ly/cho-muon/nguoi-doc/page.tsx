import Link from "next/link";
import { ChevronRight, Info, Search, UserPlus } from "lucide-react";
import { ManagerShell } from "@/components/shell/manager-shell";
import { ButtonLink } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { BookCover, BookTitle } from "@/components/ui/book";
import { StepIndicator } from "@/components/ui/step-indicator";
import { messageFor } from "@/domain/kernel/errors";
import { searchReadersForLending } from "@/domain/members/queries/search-readers-for-lending";
import { bookFromSlug, chooseCopyToLend } from "@/lib/lending";
import { getManagerBadgeCounts } from "@/domain/shelf/queries/get-manager-dashboard";
import { loadPage } from "@/lib/page-data";
import { param, type SearchParams } from "@/lib/search-params";
import { readShelf } from "@/lib/shelf";

/**
 * U1 §2, the same marker every page in this seam carries. A cached render of a
 * manager screen is RLS never being consulted rather than RLS defeated, and no
 * `tests/db/` test can see it happen because no SQL is issued.
 * `tests/architecture/pages-reading-the-database-are-dynamic.test.ts` is the
 * guard; this line is what it looks for.
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "Chọn người đọc — Quản lý tủ sách OLibra" };

/**
 * Step 2 of BR §16.3's quick-lend: the reader.
 *
 * **Also step 1 of the two-step lend.** OPS §5's "second, shorter entry point"
 * arrives here directly from a book's detail page with `?sach=` already set,
 * because the manager is standing at the shelf with the book in their hand.
 * Nothing about this page is different in that case — the book was chosen
 * somewhere else either way, and the URL is the only place that fact lives.
 *
 * **Blocked readers are listed, never filtered out.** BR §16.3: a blocking
 * condition surfaces "as a clear message *before* the confirm step". A reader
 * silently missing from the results sends the volunteer searching again,
 * wondering whether they typed the name wrong; a row saying "Tài khoản đang
 * tạm khoá, không thể mượn thêm." tells them what to do instead. The sentence
 * is `messageFor`'s, and the code behind it is the very one `lendCopy` throws
 * — `searchReadersForLending` calls `memberMayBorrow`, the predicate the
 * command applies, rather than composing INV-4 and INV-5 for itself.
 *
 * **And that sentence is wrong for two of the four statuses it covers.**
 * `membershipAllowsNewLoan` (`src/domain/members/policy.ts`) answers
 * `membership_not_active` for everything that is not `active`, so a reader
 * whose registration has not been approved yet (`pending`) and one who has
 * left the shelf (`left`) are both told their account is temporarily locked.
 * U1 is the first slice to show any of them to a volunteer and U1 §7 records
 * it; the fix is the same one-code-one-sentence split `errors.ts` has already
 * made three times, and it belongs to B2's membership lifecycle rather than
 * here — this page must keep rendering whichever code the domain hands it, or
 * the screen and the command stop agreeing.
 */
export default async function ChoMuonNguoiDocPage({
  params,
  searchParams,
}: {
  params: Promise<{ shelf: string }>;
  /** Every parameter, at the shape Next actually delivers — `search-params.ts`. */
  searchParams: Promise<SearchParams>;
}) {
  const { shelf: slug } = await params;
  const search = await searchParams;
  const sach = param(search, "sach");
  const query = param(search, "q") ?? "";

  const { shelf, viewer, counts, book, copy, readers } = await loadPage(
    slug,
    async (tx, ctx, viewer) => {
      const shelf = await readShelf(tx, ctx);
      const book = await bookFromSlug(tx, ctx, sach);
      return {
        shelf,
        viewer,
        counts: await getManagerBadgeCounts(tx, ctx),
        book,
        // Shown beside the title, so the volunteer sees the shelf-mark they are
        // about to hand over one step before they are asked to confirm it. It is
        // the same copy `xac-nhan` resolves — `chooseCopyToLend` is deterministic
        // (the lowest code) precisely so the two screens agree.
        copy: book ? chooseCopyToLend(book).copy : null,
        readers: await searchReadersForLending(tx, ctx, {
          q: query,
          // BR §5.5, read from the shelf rather than defaulted to 3 here. A shelf
          // that raised its own limit would otherwise have this list refuse a
          // reader `lendCopy` would accept — the disagreement BR §16.3 exists to
          // prevent, in its worse direction.
          maxConcurrentLoans: shelf.maxConcurrentLoans,
        }),
      };
    },
  );

  const base = `/tu-sach/${slug}/quan-ly`;
  // Every link out of this page keeps the book. Written once: `?sach=` is the
  // whole of the state carried from step 1, and a link that dropped it would
  // silently restart the flow.
  const carrying = (extra?: Record<string, string>) =>
    new URLSearchParams({ ...(sach ? { sach } : {}), ...extra }).toString();

  return (
    <ManagerShell
      shelfName={shelf.name}
      shelfSlug={slug}
      active="cho-muon"
      viewer={viewer}
      counts={counts}
    >
      <StepIndicator
        steps={["Tìm sách", "Chọn người đọc", "Xác nhận"]}
        current={2}
      />

      <div className="mt-6 flex max-w-xl items-center gap-3 rounded-card border border-hairline bg-paper p-4">
        {book ? (
          <>
            <BookCover
              title={book.book.title}
              coverUrl={book.book.coverUrl}
              className="w-12 text-[1rem]"
            />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] text-meta">Sách đã chọn</p>
              <BookTitle className="block truncate text-base leading-snug">
                {book.book.title}
              </BookTitle>
              <p className="truncate text-[14px] text-meta">
                {book.book.author}
                {/* The shelf-mark only when there is a copy to name. A title
                    whose copies are all out has none, and inventing one here
                    would promise a physical object that is not on the shelf. */}
                {copy ? ` · Bản ${copy.code}` : null}
              </p>
            </div>
          </>
        ) : (
          // No `?sach=`, or one naming a book this shelf does not have. Not a
          // 404: the page itself is perfectly real and the volunteer is one tap
          // from fixing it, so it says which of the two things is missing and
          // points back at step 1. The sentence is the domain's own
          // (`book_not_found`), never wording invented here.
          <p className="min-w-0 flex-1 text-[15px] text-meta">
            {messageFor("book_not_found")}
          </p>
        )}
        <Link
          href={`${base}/cho-muon`}
          className="inline-flex min-h-11 shrink-0 items-center rounded-control px-3 text-[14px] font-medium text-sage hover:underline"
        >
          Đổi sách
        </Link>
      </div>

      <h1 className="mt-8 text-[28px] leading-tight font-semibold">
        Chọn người đọc
      </h1>

      <form action={`${base}/cho-muon/nguoi-doc`} className="mt-5 max-w-xl">
        {/* The chosen book rides through the search as a hidden field. A GET
            form replaces the whole query string, so without this, searching for
            a reader would quietly drop the book and send the volunteer back to
            an empty step 2. */}
        {sach ? <input type="hidden" name="sach" value={sach} /> : null}
        <Input
          name="q"
          icon={Search}
          defaultValue={query}
          placeholder="Tìm theo tên"
          aria-label="Tìm người đọc"
          className="h-14 text-[17px]"
        />
      </form>

      {readers.length > 0 ? (
        <ul className="mt-6 max-w-2xl divide-y divide-hairline border-y border-hairline">
          {readers.map((reader) => {
            const initial = reader.fullName.charAt(0).toUpperCase();

            const rowInner = (
              <>
                <span
                  aria-hidden
                  className="flex size-10 shrink-0 items-center justify-center rounded-full bg-paper text-[15px] font-semibold text-leather"
                >
                  {initial}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[16px] font-medium">
                    {reader.fullName}
                  </p>
                  <p className="truncate text-[14px] text-meta">
                    {reader.parishLine || "Chưa có"}
                  </p>
                  {reader.block.blocked ? (
                    <p className="mt-1 flex items-center gap-1.5 text-[13px] text-meta">
                      <Info aria-hidden className="size-3.5" strokeWidth={1.75} />
                      {messageFor(reader.block.reason)}
                    </p>
                  ) : null}
                </div>
                {!reader.block.blocked ? (
                  <ChevronRight
                    aria-hidden
                    className="size-5 shrink-0 text-meta"
                    strokeWidth={1.75}
                  />
                ) : null}
              </>
            );

            if (reader.block.blocked) {
              return (
                // No aria-disabled: the listitem role does not support it. The
                // row carries no control, and the inline reason states plainly
                // why this reader cannot be chosen.
                <li
                  key={reader.membershipId}
                  className="flex items-center gap-3 bg-paper py-3.5"
                >
                  {rowInner}
                </li>
              );
            }

            return (
              <li key={reader.membershipId}>
                <Link
                  href={`${base}/cho-muon/xac-nhan?${carrying({
                    "nguoi-doc": reader.membershipId,
                  })}`}
                  className="flex items-center gap-3 py-3.5 hover:bg-paper"
                >
                  {rowInner}
                </Link>
              </li>
            );
          })}
        </ul>
      ) : query.trim() ? (
        <p className="mt-6 max-w-2xl text-[15px] text-meta">
          {messageFor("membership_not_found")}
        </p>
      ) : (
        // QA remediation T27 (P3-9 of the 2026-08-10 sweep). Before a
        // volunteer has typed anything, this used to render nothing at all
        // below the search box — indistinguishable from a page that failed
        // to load its reader list, on the one step of quick-lend a manager
        // most often arrives at already knowing what to type (a child's
        // name, standing at the shelf with a book in hand). Step 1
        // (`../page.tsx`) has the identical `null` in its own query-less
        // branch and was not part of this finding — left alone here rather
        // than changed to match, since a second screen's copy is its own
        // decision and not this task's to make by inference.
        <p className="mt-6 max-w-2xl text-[15px] text-meta">
          Gõ tên bạn đọc để tìm.
        </p>
      )}

      <ButtonLink
        href={`${base}/nguoi-doc/moi`}
        variant="outline"
        size="lg"
        className="mt-8 w-full max-w-2xl"
      >
        <UserPlus aria-hidden className="size-5" strokeWidth={1.75} />
        Đăng ký người đọc mới
      </ButtonLink>
    </ManagerShell>
  );
}
