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
import { STATUS, statusForAvailability } from "@/lib/status";

/** U1 §2. See `src/app/tu-sach/[shelf]/page.tsx` for the long version. */
export const dynamic = "force-dynamic";

const NUMBER = new Intl.NumberFormat("vi-VN");

/**
 * Ties the sentence under the dead "Xin mượn" button to the button itself
 * (IMPORTANT 7). A module constant rather than a literal in two places, so the
 * `aria-describedby` and the `id` cannot drift apart into an attribute that
 * points at nothing — which is indistinguishable, to everyone who can see the
 * page, from one that points at something.
 */
const BORROW_NOTE_ID = "xin-muon-chua-dung-duoc";

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
  /**
   * Minor 9 (fix-report, 2026-08-09-u2-shelf-and-portal). A loan past its due
   * date is a state of its own, and this page is one of the few that can say so
   * honestly.
   *
   * `statusForAvailability` maps a *title's* aggregate copy state, and it
   * cannot reach `overdue` — `src/lib/status.ts` spells that out and says why:
   * "`overdue` is deliberately unreachable from here, because it is not a copy
   * state at all… a screen showing an overdue badge must have a *loan* in hand
   * — never a copy row alone." This page has the loan in hand. `daysRemaining`
   * comes off `loans_current`, which derives it against `olibra_now()` on every
   * read (BR §8), and it is negative exactly when the loan is late.
   *
   * So the badge becomes "Quá hạn" — red, `alert-triangle`, BR:628 — instead of
   * "Đang mượn", which is true but says nothing a child could act on. Live, a
   * book twenty-four days overdue carried the ordinary "Đang mượn" panel and a
   * "Hạn trả" date in the past, and nothing else.
   *
   * It replaces the badge rather than adding a second one, because BR §17.2's
   * whole point is that a copy has one state a reader is told about, and two
   * badges on one panel is a question rather than an answer.
   */
  const isOverdue = (book.currentLoan?.daysRemaining ?? 0) < 0;
  const status = isOverdue ? "overdue" : statusForAvailability(book.availability);
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

              **`daysRemaining` is signed, and past the due date it now says so**
              (Minor 9, fix-report, 2026-08-09-u2-shelf-and-portal). This used to
              read "this query returns no `is_overdue` to render the honest
              alternative with, so the clause is simply omitted past the due
              date" — and that was wrong twice over. `getBookDetail` returns
              `daysRemaining` straight off `loans_current`, where it is negative
              exactly when the loan is overdue, and the branch two lines below
              was already reading its sign. DB §4.5 forbids an `is_overdue`
              *column*; deriving overdue on read is what BR §8 asks for and what
              `loans_current` exists to do.

              Live, a book twenty-four days overdue showed only "Hạn trả Thứ Năm,
              16/07/2026." — a date in the past and no cue at all, on a page read
              by children who may have been reading fluently for only a few years
              (BR:601). Now the badge above the panel reads "Quá hạn" and this
              sentence carries the count.

              "Quá hạn" is `STATUS.overdue.label` and the count is the shape
              already used across the app ("Quá hạn 2 ngày"); no new wording. */}
          {book.currentLoan.holderName ? (
            <p className="text-[16px]">
              {book.currentLoan.holderName} đang giữ cuốn này
              {book.currentLoan.daysRemaining >= 0
                ? ` · còn ${NUMBER.format(book.currentLoan.daysRemaining)} ngày`
                : ` · ${STATUS.overdue.label.toLowerCase()} ${NUMBER.format(-book.currentLoan.daysRemaining)} ngày`}
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
        unreadNotifications={viewer.unreadNotifications}
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
                is a small lie"), and is not focusable or clickable at all.

                **And that is not enough on its own, which is IMPORTANT 7**
                (fix-report, 2026-08-09-u2-shelf-and-portal). This is the
                page's dominant action — full-width terracotta, `size="lg"`,
                `min-w-80`, exactly the "One primary action per screen, visually
                dominant" BR:603 asks for — and it is dead. The two comments
                that used to sit here contradicted each other inside one block:
                this one said the button was acceptable because "the sentence
                immediately under it is the one that tells them what actually
                works", and the one below said "No sentence under it." Neither
                matched the layout. The contact line is *above*, inside the
                `StatusPanel`, and it answers "how do I collect this", not "why
                did nothing happen when I pressed the big button".

                Being natively `disabled` also takes it out of the tab order, so
                a keyboard or switch user never lands on it and never hears why
                — the audience BR:601 describes as "children who may have been
                reading fluently for only a few years". The sentence below is in
                the reading order regardless, and `aria-describedby` ties it to
                the control for anyone who does reach it.

                Plan §6 says the button "must not pretend to work". That forbids
                submitting; it does not forbid explaining. The alternatives were
                both worse: a live-looking button that posts nowhere is the
                "told yes and then no" failure BR §16.3 is written against, and
                removing it entirely would hide the one thing BR:508 says this
                page is for. The label stays the specified one so that what C2
                wires is a `disabled` attribute coming off, not a button being
                invented.

                The `Bookmark` variant — "Đăng ký chờ mượn" — is the same
                situation: borrow requests are C2's. */}
            <div className="order-4 mt-6">
              <Button
                variant="primary"
                size="lg"
                className="min-w-80"
                disabled
                aria-describedby={BORROW_NOTE_ID}
              >
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
              {/* ### NEW COPY (IMPORTANT 7) — the only Vietnamese this fix
                  wave writes. Everything else on these pages is BR's wording,
                  `errors.ts`'s wording, or `status.ts`'s wording.

                  "Nút này chưa dùng được. Em nhắn cho quản lý tủ sách ở trên để
                  mượn sách."

                  Two short sentences, present tense, no jargon, for a reader
                  BR:601 describes as possibly "reading fluently for only a few
                  years". The first says what happened when they pressed it —
                  nothing, and that is the button's fault and not theirs. The
                  second points at the thing on this page that does work, by
                  position ("ở trên") rather than by repeating the keeper's name
                  and number, which BR:511's line inside the panel already
                  carries four centimetres up. "Em" is how BR §17 addresses a
                  child throughout.

                  It replaces the fixture's "Quản lý sẽ xác nhận khi bạn đến
                  nhận sách.", which described the C2 flow this button cannot
                  start — a promise, where this is a statement of fact.

                  `aria-describedby` on the button above, so a screen-reader
                  user who reaches the control hears it as its description; it
                  is in the reading order regardless, which is what covers the
                  case the `disabled` attribute creates by taking the button out
                  of the tab order entirely. C2 deletes this element and the
                  `disabled` attribute in one edit. */}
              <p
                id={BORROW_NOTE_ID}
                className="mt-2 max-w-80 text-[14px] text-meta"
              >
                Nút này chưa dùng được. Em nhắn cho quản lý tủ sách ở trên để mượn
                sách.
              </p>
            </div>

            {isManager ? (
              <div className="order-5 mt-6 rounded-card border border-hairline bg-paper p-5">
                <p className="text-[13px] font-semibold tracking-wide text-leather uppercase">
                  Dành cho quản lý
                </p>
                {/* OPS §5's "second, shorter entry point", and the whole of it
                    is these two query strings. Both flows are perfectly capable
                    of being told which book this is — `cho-muon/nguoi-doc` reads
                    `?sach=` and renders step 2 with the title already chosen,
                    `nhan-tra` reads `?q=` and arrives with the search run — and
                    for one wave these buttons linked the flow *roots* instead,
                    which handed a volunteer holding the book a search box and
                    asked them to type its title into it.

                    A sentence under the buttons used to promise the behaviour
                    the links did not have ("Mở sẵn với cuốn này đã chọn, rút quy
                    trình cho mượn ba bước xuống còn hai bước từ đây."). It is
                    gone rather than corrected: once the links carry the book,
                    the shortcut is a thing the buttons *do*, and a caption
                    narrating it is a caption nobody needs to read. The manager
                    twin (`quan-ly/sach/[id]`) has never had one. */}
                <div className="mt-3 flex flex-col gap-3 sm:flex-row">
                  {/* OPS §5: "When a copy of that title is available, the page
                      shows **Cho mượn**." Gated, not merely linked, and the
                      preloading is why. A bare link to the search step let the
                      volunteer meet `searchBooksForLending`'s `blocked` row and
                      its reason first; skipping that step would carry them past
                      the refusal into step 2 for a book with no lendable copy,
                      to be turned away at `xac-nhan` instead — the late "no"
                      BR §16.3 exists to prevent. `copiesAvailable > 0` is
                      exactly what that query calls not-blocked
                      (`deriveAvailability`), so this is the same answer one step
                      earlier, and the status panel above already says why. */}
                  {isAvailable ? (
                    <ButtonLink
                      href={`${base}/quan-ly/cho-muon/nguoi-doc?sach=${encodeURIComponent(
                        book.slug,
                      )}`}
                      variant="outline"
                      size="lg"
                      className="flex-1"
                    >
                      <BookCheck
                        aria-hidden
                        className="size-5"
                        strokeWidth={1.75}
                      />
                      Cho mượn
                    </ButtonLink>
                  ) : null}
                  {/* Its twin is not gated, and deliberately. OPS §5 pairs the
                      button with "when one is out", but this page cannot ask
                      that question honestly: `getBookDetail` returns no on-loan
                      count, and `currentLoan` — the one loan-shaped field it has
                      — is `null` on a shelf whose `public_show_current_borrower`
                      is off (BR §5.5), so gating on it would hide the manager's
                      return flow as a side effect of a *reader privacy* setting.
                      Landing on a search that finds nothing is the honest
                      failure of the two, and it is the same empty list the
                      manager would have reached by hand. Gating this properly is
                      a `copiesOnLoan` on `BookDetail` — the SQL already counts
                      it — which is a domain change, not a link fix. */}
                  <ButtonLink
                    href={`${base}/quan-ly/nhan-tra?q=${encodeURIComponent(
                      book.title,
                    )}`}
                    variant="outline"
                    size="lg"
                    className="flex-1"
                  >
                    <RotateCcw aria-hidden className="size-5" strokeWidth={1.75} />
                    Nhận trả
                  </ButtonLink>
                </div>

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
