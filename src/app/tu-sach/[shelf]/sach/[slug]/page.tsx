import Link from "next/link";
import {
  BookCheck,
  Bookmark,
  Hand,
  RotateCcw,
  Settings2,
  Users,
} from "lucide-react";
import { ButtonLink, Button } from "@/components/ui/button";
import { BookCover, BookTitle } from "@/components/ui/book";
import { StatusPanel } from "@/components/ui/status-badge";
import { PhoneLink } from "@/components/ui/phone-link";
import { ShelfHeader } from "@/components/shell/public-header";
import { getBookDetail } from "@/domain/catalogue/queries/get-book-detail";
import { atLeast } from "@/domain/kernel/tenant";
import { formatDueDate, formatYear } from "@/lib/dates";
import { loadPage } from "@/lib/page-data";
import { readShelfIdentity } from "@/lib/shelf";
import { statusForAvailability } from "@/lib/status";

/** U1 §2. See `src/app/tu-sach/[shelf]/page.tsx` for the long version. */
export const dynamic = "force-dynamic";

const NUMBER = new Intl.NumberFormat("vi-VN");

/**
 * `books.description` is one `text` column; the seed writes paragraphs joined
 * by a blank line and the manager's form does the same. Split on blank lines
 * rather than on every newline, so a wrapped line inside a paragraph does not
 * become a paragraph of its own.
 */
function paragraphsOf(description: string | null): string[] {
  if (!description) return [];
  return description
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * BR:507's book detail, and BR:515's rule about who may see it: "There is no
 * guest path — only a member of this shelf can see this page at all."
 * `getBookDetail`'s `requireReader` is what enforces that; `loadPage` turns its
 * refusal into a redirect for a guest and a 404 for a signed-in non-member.
 *
 * A slug naming no published book is also a 404 now, rather than the HTTP 500
 * it was: `getBookDetail` throws `NotFound("book_not_found")` and `loadPage`
 * translates it — see that function for why the seam and not this page.
 *
 * **Comments are not here**, though BR:513 puts them on this page. They are
 * B3's, and U2's scope note excludes them; the fixture version rendered two
 * invented comments and a box that posted nowhere.
 */
export default async function BookDetailPage({
  params,
}: {
  params: Promise<{ shelf: string; slug: string }>;
}) {
  const { shelf: shelfSlug, slug } = await params;

  const { shelf, viewer, book, isManager } = await loadPage(
    shelfSlug,
    async (tx, ctx, viewer) => ({
      shelf: await readShelfIdentity(tx, ctx),
      viewer,
      book: await getBookDetail(tx, ctx, { bookSlug: slug }),
      // BR:517 — a manager standing at the shelf with the book in hand gets the
      // two flows they would otherwise navigate away for. The fixture version
      // rendered this panel for everyone and labelled it "Dành cho quản lý",
      // with a comment saying "this whole panel is role-gated once sessions
      // exist". Sessions exist. `ctx.actor.role` is the shelf-scoped role
      // `contextFor` resolved, and `atLeast` is the kernel's own ranking, so
      // `admin` and `super_admin` see it too without this page listing roles.
      //
      // This is visibility, not permission (BR §13.3): every page the panel
      // links to runs `requireManager` for itself, and hiding the links is not
      // what stops a reader following them.
      isManager: atLeast(ctx.actor.role, "manager"),
    }),
  );

  const base = `/tu-sach/${shelfSlug}`;
  const status = statusForAvailability(book.availability);
  const isAvailable = book.availability === "available";

  /* Author sits under the title and the category is already in the breadcrumb,
     so both are carried in the main column. Everything else is reference
     detail: it moves beside the cover on a wide screen rather than pushing the
     description further down the page.

     BR:513 names four — author, page count, category, publisher. Each row is
     dropped when the column behind it is null rather than rendered with a
     blank value: a shelf catalogues what it has in hand, and a paperback with
     no year printed in it is the ordinary case, not missing data.

     There is no "Người dịch" row. `src/lib/fixtures.ts`'s `Book` type has a
     `translator` field and `books` has no such column — `get-book-detail.ts`
     records the gap and says adding it is a migration. */
  const detail: [string, string][] = [
    ...(book.publisher
      ? ([["Nhà xuất bản", book.publisher]] as [string, string][])
      : []),
    ...(book.publishedYear
      ? ([["Năm xuất bản", formatYear(book.publishedYear)]] as [string, string][])
      : []),
    ...(book.pageCount
      ? ([["Số trang", NUMBER.format(book.pageCount)]] as [string, string][])
      : []),
    ...(book.category ? ([["Thể loại", book.category]] as [string, string][]) : []),
  ];

  const description = paragraphsOf(book.description);

  /* The availability panel's body, assembled once because it is the same three
     shapes under both the badged panel and the un-badged fallback. */
  const availabilityBody = (
    <>
      {isAvailable ? (
        // BR:508: "copy count if more than one". One copy on the shelf needs no
        // sentence — the badge above already says it is here — and "Có 1 trên 1
        // bản" is arithmetic a child should not have to read.
        book.copiesTotal > 1 ? (
          <p className="text-[16px]">
            Có {NUMBER.format(book.copiesAvailable)} trên{" "}
            {NUMBER.format(book.copiesTotal)} bản đang ở trong tủ.
          </p>
        ) : null
      ) : book.currentLoan ? (
        <>
          {/* The holder's name is `null` when the shelf sets
              `public_name_display: "hidden"` (BR §5.5) — in which case the page
              still says the book is out and when it is due, just not with whom.
              The panel's own heading already reads "Đang mượn", so the sentence
              is dropped rather than reworded around the missing name.

              `daysRemaining` comes from `loans_current` and goes negative once a
              loan is overdue. "còn -3 ngày" is not a sentence, and this query
              returns no `is_overdue` to render the honest alternative with, so
              the clause is simply omitted past the due date; "Hạn trả" below
              still carries the fact. */}
          {book.currentLoan.holderName ? (
            <p className="text-[16px]">
              {book.currentLoan.holderName} đang giữ cuốn này
              {book.currentLoan.daysRemaining >= 0
                ? ` · còn ${NUMBER.format(book.currentLoan.daysRemaining)} ngày`
                : ""}
              .
            </p>
          ) : null}
          <p className="text-[14px] text-meta">
            Hạn trả {formatDueDate(book.currentLoan.dueOn)}.
          </p>
          {book.queueLength > 0 ? (
            <p className="flex items-center gap-2 pt-1 text-[15px]">
              <Users aria-hidden className="size-5" strokeWidth={1.75} />
              Đang có {NUMBER.format(book.queueLength)} người chờ mượn
            </p>
          ) : null}
        </>
      ) : (
        <p className="text-[16px]">Cuốn này hiện không có trong tủ.</p>
      )}
      {/* BR:511, word for word: "Liên hệ {keeper} · {phone} để nhận sách."
          Shown in every state, not only when available (M4 of the refinements
          review): the state where a reader most wants to ring someone — the
          book is nowhere to be found on this page — is exactly the state that
          used to say nothing. Both halves are nullable columns, so the line
          appears only when there is somebody to ring. */}
      {shelf.keeperName ? (
        <p className="flex flex-wrap items-center gap-x-1.5 text-[14px] text-meta">
          Liên hệ {shelf.keeperName}
          {shelf.keeperPhone ? (
            <>
              {" · "}
              <PhoneLink phone={shelf.keeperPhone} size="sm" /> để nhận sách.
            </>
          ) : (
            " để nhận sách."
          )}
        </p>
      ) : null}
    </>
  );

  return (
    <>
      <ShelfHeader
        shelfName={shelf.name}
        shelfSlug={shelfSlug}
        viewerName={viewer.name}
      />

      <main className="mx-auto max-w-5xl px-6 py-10">
        {/* Mobile reads top to bottom as one ordered flex column: cover,
            title, status, primary action, manager shortcuts, description, and
            the reference metadata last. `md:grid` restores the two-column
            arrangement, at which point each wrapper below turns back into a
            plain block (`md:block`) and normal source order takes over, so
            desktop is unaffected by the mobile `order-*` values. */}
        <div className="flex flex-col md:grid md:grid-cols-[300px_1fr] md:gap-10">
          <div className="contents md:block">
            <BookCover title={book.title} className="order-1 w-full text-[3rem]" />

            {detail.length > 0 ? (
              <dl className="order-8 mt-6 divide-y divide-hairline border-y border-hairline">
                {detail.map(([label, value]) => (
                  <div key={label} className="py-2.5">
                    <dt className="text-[14px] text-meta">{label}</dt>
                    <dd className="mt-0.5 text-[15px]">{value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </div>

          <div className="contents md:block">
            <div className="order-2 mt-6 md:mt-0">
              <p className="text-[14px] text-meta">
                <Link href={`${base}/danh-muc`} className="hover:text-ink">
                  Danh mục
                </Link>
                {book.category ? ` › ${book.category}` : null}
              </p>

              <BookTitle as="h1" className="mt-2 block text-[30px] leading-tight">
                {book.title}
              </BookTitle>
              {book.author ? (
                <p className="mt-1 text-base text-meta">{book.author}</p>
              ) : null}
            </div>

            {/* The availability panel changes with state. A title with no live
                copies at all has no honest badge — `statusForAvailability`
                returns null rather than claiming "Ngừng dùng" about copies that
                do not exist — so it gets the same card without one. */}
            <div className="order-3 mt-6">
              {status ? (
                <StatusPanel status={status}>{availabilityBody}</StatusPanel>
              ) : (
                <div className="space-y-1 rounded-card border border-hairline bg-paper p-6">
                  {availabilityBody}
                </div>
              )}
            </div>

            {/* **"Xin mượn" belongs to C2 and does not exist yet**, so this
                button is rendered `disabled` and does nothing at all — no
                form, no action, no href.

                What a child who taps it experiences: nothing moves. The button
                is drawn at 45% opacity (`disabled:opacity-45`), takes no
                pointer cursor (globals.css excludes `:disabled` from that rule
                deliberately — "a pointer over a control that will not respond
                is a small lie"), and is not focusable or clickable at all. It
                reads as "not now", and the sentence immediately under it is the
                one that tells them what actually works: ring the keeper, which
                is what the availability panel above already says and what
                every child at this shelf does today.

                The alternatives were both worse. A live-looking button that
                posts nowhere is the "told yes and then no" failure BR §16.3 is
                written against. Removing it entirely would hide the one thing
                BR:508 says this page is for, and would have to be re-designed
                back in when C2 lands. The label stays the specified one so that
                what C2 wires is a `disabled` attribute coming off, not a
                button being invented.

                The `Bookmark` variant — "Đăng ký chờ mượn" — is the same
                situation: borrow requests are C2's. */}
            <div className="order-4 mt-6">
              <Button variant="primary" size="lg" className="min-w-80" disabled>
                {isAvailable ? (
                  <>
                    <Hand aria-hidden className="size-5" strokeWidth={1.75} />
                    Xin mượn
                  </>
                ) : (
                  <>
                    <Bookmark aria-hidden className="size-5" strokeWidth={1.75} />
                    Đăng ký chờ mượn
                  </>
                )}
              </Button>
              {/* No sentence under it. The fixture's — "Quản lý sẽ xác nhận khi
                  bạn đến nhận sách." — describes the C2 flow this button cannot
                  start, and BR:511's contact line is already directly above,
                  inside the panel where that section puts it. Repeating it here
                  would be the same instruction twice in four centimetres. */}
            </div>

            {isManager ? (
              <div className="order-5 mt-6 rounded-card border border-hairline bg-paper p-5">
                <p className="text-[13px] font-semibold tracking-wide text-leather uppercase">
                  Dành cho quản lý
                </p>
                <div className="mt-3 flex flex-col gap-3 sm:flex-row">
                  <ButtonLink
                    href={`${base}/quan-ly/cho-muon`}
                    variant="outline"
                    size="lg"
                    className="flex-1"
                  >
                    <BookCheck aria-hidden className="size-5" strokeWidth={1.75} />
                    Cho mượn
                  </ButtonLink>
                  <ButtonLink
                    href={`${base}/quan-ly/nhan-tra`}
                    variant="outline"
                    size="lg"
                    className="flex-1"
                  >
                    <RotateCcw aria-hidden className="size-5" strokeWidth={1.75} />
                    Nhận trả
                  </ButtonLink>
                </div>
                <p className="mt-3 text-[14px] text-meta">
                  Mở sẵn với cuốn này đã chọn, rút quy trình cho mượn ba bước xuống
                  còn hai bước từ đây.
                </p>

                {/* Everything else a manager might want on this title — sửa
                    thông tin, thêm bản, tình trạng từng bản, lịch sử mượn —
                    lives on one page. A link rather than four more buttons:
                    those are occasional actions, and repeating them here would
                    leave two pages to keep in step. */}
                <Link
                  href={`${base}/quan-ly/sach/${book.slug}`}
                  className="mt-4 inline-flex min-h-11 items-center gap-1.5 text-[15px] font-medium text-sage hover:underline"
                >
                  <Settings2 aria-hidden className="size-4" strokeWidth={1.75} />
                  Quản lý sách này — sửa thông tin, thêm bản, xem lịch sử
                </Link>
              </div>
            ) : null}

            {description.length > 0 ? (
              <section className="order-6 mt-10">
                <h2 className="text-lg font-semibold">Giới thiệu</h2>
                <div className="mt-3 space-y-4 text-[16px]">
                  {description.map((para) => (
                    <p key={para.slice(0, 24)}>{para}</p>
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        </div>
      </main>
    </>
  );
}
