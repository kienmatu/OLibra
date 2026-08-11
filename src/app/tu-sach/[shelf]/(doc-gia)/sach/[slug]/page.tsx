import Link from "next/link";
import type { Metadata } from "next";
import {
  AlertCircle,
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
import { Field, Textarea } from "@/components/ui/field";
import { SavedNotice } from "@/components/ui/saved-notice";
import { SubmitButton } from "@/components/ui/submit-button";
import { messageFor } from "@/domain/kernel/errors";
import { getBookComments } from "@/domain/community/queries/get-comments";
import { getMyDashboard } from "@/domain/circulation/queries/get-my-dashboard";
import {
  commentsEnabled,
  commentsRequireApproval,
} from "@/domain/community/policy";
import { formatDueDate, formatInstant, formatYear } from "@/lib/dates";
import { loadPage } from "@/lib/page-data";
import { param, refusalFrom, type SearchParams } from "@/lib/search-params";
import { readShelfIdentity } from "@/lib/shelf";
import { STATUS, statusForAvailability } from "@/lib/status";
import { postCommentAction } from "../../../community-actions";
import {
  cancelRequestAction,
  requestBorrowAction,
} from "../../ho-so/reader-actions";

/** U1 §2. See `src/app/tu-sach/[shelf]/page.tsx` for the long version. */
export const dynamic = "force-dynamic";

const NUMBER = new Intl.NumberFormat("vi-VN");

/**
 * The refusal codes the comment box can produce, so its alert and the borrow
 * button's alert do not both paint the same `?loi=`.
 *
 * Both forms on this page redirect back to this URL with the same parameter, and
 * one code rendering twice is the page telling a child the same thing in two
 * places. Listed rather than inferred: `createComment` raises exactly these two
 * (`comment-moderation.ts`), and a third would be a deliberate edit here rather
 * than a silent widening.
 */
const COMMENT_REFUSALS = ["comments_disabled", "empty_body"];

/**
 * QA remediation Task 25. The one page a search engine actually indexes
 * (`/tu-sach/[shelf]/sach/[slug]`), and until this task its tab read the
 * fallback "OLibra — Tủ sách cộng đồng" the same as every other unwritten page
 * — a search result for a specific title carried no more information than the
 * home page did.
 *
 * **Through `loadPage` and `getBookDetail`, the exact pair the page component
 * below calls with the exact same arguments** — a second query, not a
 * lighter invented one, because `getBookDetail` is already the narrowest read
 * that has the title on it, and Next.js calls `generateMetadata` and the page
 * component as two separate invocations with no shared cache over a raw SQL
 * read (there is no `fetch` here for the framework's request memoization to
 * dedupe). Reusing `loadPage` rather than open-coding a lookup is what keeps
 * this path's refusals identical to the page's own: a guest is redirected to
 * sign in, a signed-in non-member and a slug naming no published book both
 * 404, in `loadPage`'s own words, before a byte of the page's HTML — never a
 * different shape of failure than the body a moment later would have produced,
 * which is the leak this docstring's own review flagged as the risk worth
 * naming: a metadata path that threw *differently* than the page would tell a
 * prober the two disagree about whether a book exists.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ shelf: string; slug: string }>;
}): Promise<Metadata> {
  const { shelf: shelfSlug, slug } = await params;

  const { book } = await loadPage(shelfSlug, async (tx, ctx) => ({
    book: await getBookDetail(tx, ctx, { bookSlug: slug }),
  }));

  return { title: `${book.title} — OLibra` };
}

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
 * **Comments are here now** (U6 §1). This paragraph used to read "Comments are
 * not here, though BR:513 puts them on this page. They are B3's, and U2's scope
 * note excludes them; the fixture version rendered two invented comments and a
 * box that posted nowhere." B3 shipped the whole slice — `createComment`,
 * `getBookComments`, the moderation commands and `/quan-ly/binh-luan` — and
 * nothing ever called the first two, so the queue a manager works had no way to
 * receive anything and the reported symptom was that a manager could not
 * comment on a book. Neither could anybody else.
 *
 * The section below is a list and a form. Nothing invented: the list is
 * `getBookComments`, which returns approved rows only because that predicate is
 * INV-9 living in the access path, and the form posts `postCommentAction`,
 * which is `createComment` through the same `submitCommand` seam the two other
 * reader-facing community writes already use.
 */
export default async function BookDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ shelf: string; slug: string }>;
  /** `?da-gui=1` and `?loi=` — through `search-params.ts`, never destructured,
   *  because a repeated key arrives as an array. */
  searchParams: Promise<SearchParams>;
}) {
  const { shelf: shelfSlug, slug } = await params;
  const search = await searchParams;
  // **Which form landed, not merely that one did.** Two forms on this page
  // redirect back to it now — the comment box and "Xin mượn" — so a bare `1`
  // would confirm whichever sentence the page happened to render first. The
  // same reason `/quan-tri/cai-dat` distinguishes its two saves.
  const sent = param(search, "da-gui");
  const cancelled = param(search, "da-huy") === "1";
  const refused = refusalFrom(search);

  const {
    shelf,
    viewer,
    book,
    isManager,
    comments,
    commentsOn,
    needsApproval,
    membershipId,
    myRequest,
  } = await loadPage(shelfSlug, async (tx, ctx, viewer) => {
    const book = await getBookDetail(tx, ctx, { bookSlug: slug });
    return {
      shelf: await readShelfIdentity(tx, ctx),
      viewer,
      book,
      /**
       * The comment form's hidden field. **From `ctx.actor`, not from
       * `Viewer`** — that type carries a name, a bell count and a role for
       * the chrome to print, and deliberately not an id (see its own
       * docstring on `role` being a display of a resolution rather than a
       * second answer). `createComment` checks this against `ctx.actor
       * .membershipId` inside the command anyway, so what travels through the
       * form is a convenience; what makes it safe is that the command does
       * not trust it.
       *
       * Non-null for anybody who can render this page at all: `loadPage`
       * redirects a guest and 404s a signed-in non-member, so a reader here
       * holds an active membership of this shelf by construction.
       */
      membershipId: ctx.actor.membershipId,
      /**
       * This reader's own request for this title, if they have one.
       *
       * **Through `getMyDashboard`, rather than a new query.** That function is
       * OPS §3.2's specified read, it already derives `queuePosition` and
       * `holdExpiresAt` exactly as the reader's own dashboard shows them, and
       * it is reader-scoped by construction. A narrower `myRequestFor(bookId)`
       * would be a second, unspecified way to ask the same question, and the
       * two would eventually disagree about what "in flight" means — which is
       * the drift `loanRenewable`'s own docstring describes between a query and
       * a command. The cost is reading a reader's whole dashboard to answer one
       * question about one book; a member has a handful of rows.
       *
       * Skipped entirely for a viewer with no membership: `getMyDashboard`
       * calls `requireIdentifiedActor`, and a super admin browsing a shelf has
       * no dashboard here to read.
       */
      myRequest:
        ctx.actor.membershipId === null
          ? null
          : ((await getMyDashboard(tx, ctx)).requests.find(
              (r) => r.bookId === book.bookId,
            ) ?? null),
      // BR §5.5's two settings, and they are two decisions rather than one:
      // a shelf can moderate comments, or it can decline to take them at
      // all. The first picks the sentence under the form; the second removes
      // the section entirely.
      commentsOn: await commentsEnabled(tx, ctx.bookshelfId),
      needsApproval: await commentsRequireApproval(tx, ctx.bookshelfId),
      comments: await getBookComments(tx, ctx, { bookId: book.bookId }),
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
    };
  });

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
            {/* **60% of the column on a phone, the full 300px on desktop.**
                `w-full` at every width made the cover a full-bleed panel taller
                than the viewport: a book jacket is portrait, so on a 390px
                screen it ran past 500px tall and pushed the title, the
                availability panel and the borrow button entirely below the
                fold — a reader landing here saw a coloured rectangle and had to
                scroll to find out which book it was. The `md:` column is a
                fixed 300px track, so the cap only applies where the width is
                the viewport's. */}
            {/* `mx-auto` centres it in the mobile flex column, where the cover
                is narrower than the measure and left-aligning it leaves a
                lopsided gap down one side. `md:mx-0` because the desktop track
                is exactly 300px and the cover fills it — centring there would
                be a no-op today and a surprise the day the track changes. */}
            <BookCover
              title={book.title}
              coverUrl={book.coverUrl}
              className="order-1 mx-auto w-3/5 text-[3rem] md:mx-0 md:w-full"
            />

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

            {/**
             * **"Xin mượn", alive at last** (U8).
             *
             * This button was rendered `disabled` from the day the page was
             * drawn, with a paragraph underneath apologising for it — "Nút này
             * chưa dùng được. Em nhắn cho quản lý tủ sách ở trên để mượn
             * sách." `createBorrowRequest` had shipped in C2, fully
             * implemented and tested, and was called from nowhere;
             * `every-domain-command-has-a-caller.test.ts` carried a named
             * exemption saying so. The cost ran past this one control:
             * `/quan-ly/yeu-cau-muon` has approve, reject and handover all
             * wired, and no reader could put a row in it, so the manager's
             * **Yêu cầu mượn** badge could only ever read zero.
             *
             * The `disabled` attribute, the apology, `BORROW_NOTE_ID` and its
             * `aria-describedby` are all gone together. What that old comment
             * predicted is exactly what happened: "what C2 wires is a
             * `disabled` attribute coming off, not a button being invented."
             *
             * **Two labels, one command.** `createBorrowRequest` reads no
             * `book_copies` at all and says so at length — OPS §4.2 covers
             * both an empty shelf and a reader who wants to queue while copies
             * exist. So the call is identical either way and only the wording
             * moves, because "go and collect it" and "join the queue" are
             * different things to a child even when they are one write.
             *
             * **A request in flight replaces the button rather than sitting
             * beside it.** Pressing twice is `duplicate_request` — a refusal
             * the reader can do nothing with — and a button that is going to
             * say no is the shape this whole run of work has been removing.
             */}
            <div className="order-4 mt-6">
              {/* **The refusal belongs above the control, not below it.** Both
                  writes on this page redirect here with `?loi=`, and the codes
                  a reader can actually cause are the interesting ones:
                  `duplicate_request` when a stale page is tapped twice,
                  `membership_not_active_cannot_request` when their membership
                  was suspended between the render and the tap. Every sentence
                  is `errors.ts`'s own — nothing new is written here. */}
              {refused && !COMMENT_REFUSALS.includes(refused) ? (
                <p
                  role="alert"
                  className="mb-4 flex max-w-80 items-start gap-2 rounded-card border border-brick bg-brick/8 px-4 py-3 text-[15px] text-brick"
                >
                  <AlertCircle
                    aria-hidden
                    className="mt-0.5 size-5 shrink-0"
                    strokeWidth={1.75}
                  />
                  {messageFor(refused)}
                </p>
              ) : null}

              {sent === "xin-muon" ? (
                <div className="mb-4 max-w-80">
                  <SavedNotice>
                    Đã gửi. Quản lý tủ sách sẽ xem và báo lại cho em.
                  </SavedNotice>
                </div>
              ) : null}

              {cancelled ? (
                <div className="mb-4 max-w-80">
                  <SavedNotice>Đã huỷ yêu cầu mượn.</SavedNotice>
                </div>
              ) : null}

              {membershipId === null ? null : myRequest ? (
                <div className="max-w-80 rounded-card border border-hairline bg-paper p-5">
                  <p className="flex items-start gap-2 text-[16px] font-medium">
                    <Bookmark
                      aria-hidden
                      className="mt-0.5 size-5 shrink-0"
                      strokeWidth={1.75}
                    />
                    {/* The three states `getMyDashboard` can report, in its own
                        words: queueing behind somebody, holding a copy with a
                        deadline, or holding one with none recorded. */}
                    {myRequest.queuePosition !== null
                      ? `Em đang chờ cuốn này · vị trí ${NUMBER.format(
                          myRequest.queuePosition,
                        )}`
                      : myRequest.holdExpiresAt
                        ? `Sách đã để dành cho em · nhận trước ${formatInstant(
                            myRequest.holdExpiresAt,
                          )}`
                        : "Sách đã để dành cho em"}
                  </p>
                  <form action={cancelRequestAction} className="mt-4">
                    <input type="hidden" name="tu-sach" value={shelfSlug} />
                    {/* A slug, so the cancellation comes back to this page;
                        `cancelRequestAction` builds the URL itself, because a
                        form must never name a redirect target. */}
                    <input type="hidden" name="sach" value={book.slug} />
                    <input
                      type="hidden"
                      name="yeu-cau"
                      value={myRequest.requestId}
                    />
                    <SubmitButton variant="outline">Huỷ yêu cầu</SubmitButton>
                  </form>
                </div>
              ) : (
                <form action={requestBorrowAction}>
                  <input type="hidden" name="tu-sach" value={shelfSlug} />
                  <input type="hidden" name="sach" value={book.slug} />
                  <input type="hidden" name="sach-id" value={book.bookId} />
                  <input type="hidden" name="thanh-vien" value={membershipId} />
                  <SubmitButton
                    variant="primary"
                    size="lg"
                    className="min-w-80"
                    icon={
                      isAvailable ? (
                        <Hand aria-hidden className="size-5" strokeWidth={1.75} />
                      ) : (
                        <Bookmark
                          aria-hidden
                          className="size-5"
                          strokeWidth={1.75}
                        />
                      )
                    }
                  >
                    {isAvailable ? "Xin mượn" : "Đăng ký chờ mượn"}
                  </SubmitButton>
                </form>
              )}
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

            {/* BR:513's comments (U6 §1). Absent entirely when the shelf has
                turned them off — not a disabled textarea, and not a heading
                over an explanation. A shelf that does not take comments has no
                comments area, which is what `comments_enabled` means; OPS §4.4
                gives that case its own refusal precisely because it is the
                shelf's choice rather than anything the reader did. */}
            {commentsOn ? (
              <section className="order-7 mt-10">
                <h2 className="text-lg font-semibold">Bình luận</h2>

                {comments.length > 0 ? (
                  <ul className="mt-4 divide-y divide-hairline border-y border-hairline">
                    {comments.map((comment) => (
                      <li key={comment.id} className="py-4">
                        <p className="text-[15px] font-medium">
                          {comment.authorName}
                          <span className="ml-2 text-[14px] font-normal text-meta">
                            {formatInstant(comment.createdAt)}
                          </span>
                        </p>
                        {/* Plain text, escaped by React — BR §5.4, and what
                            `inv-09-comment-visibility.test.ts` pins with a
                            `<script>` body. `whitespace-pre-line` so the line
                            breaks a child typed survive; nothing else about
                            what they wrote is interpreted. */}
                        <p className="mt-1.5 text-[16px] whitespace-pre-line">
                          {comment.body}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 text-[15px] text-meta">
                    Chưa có bình luận nào. Em là người đầu tiên nhé.
                  </p>
                )}

                {/* **Only this section's own codes**, because the borrow
                    button above renders `refused` too and one `?loi=` painting
                    two alerts on one page is the page saying it twice. Outside
                    the form for the reason it always was: a shelf that turns
                    comments off between a page load and a submit redirects here
                    with `comments_disabled`, and an alert inside the form would
                    land where there is no longer one. */}
                {refused && COMMENT_REFUSALS.includes(refused) ? (
                  <p role="alert" className="mt-4 text-[15px] text-brick">
                    {messageFor(refused)}
                  </p>
                ) : null}

                {/**
                 * **No membership, no form**, and the viewer this is about is
                 * not hypothetical: `contextFor` resolves a super admin to
                 * `role: "super_admin"` with `membershipId: null`
                 * (`src/lib/reader-area.ts` exists for precisely this), and
                 * that role clears every `requireReader` on this page — so the
                 * page renders for them, and only the form cannot work.
                 *
                 * Posting `membershipId ?? ""` would fail `createComment`'s
                 * `input.membershipId !== ctx.actor.membershipId` (`""` against
                 * `null`) and come back "Bạn không có quyền thực hiện việc
                 * này." — a form that is guaranteed to refuse the person
                 * looking at it, which is the same defect this slice was
                 * written to fix one page over. QA task 10 is the same `?? ""`
                 * reaching past a null membership; there it was a 500.
                 */}
                {membershipId === null ? (
                  <p className="mt-6 text-[15px] text-meta">
                    Chỉ bạn đọc của tủ sách này mới viết bình luận được.
                  </p>
                ) : (
                  <form action={postCommentAction} className="mt-6">
                    <input type="hidden" name="tu-sach" value={shelfSlug} />
                    {/* The slug for the redirect, the id for the command: one
                        is a URL and the other is a key, and `?da-gui=1` has to
                        land back on the page the reader was reading. */}
                    <input type="hidden" name="sach" value={book.slug} />
                    <input type="hidden" name="sach-id" value={book.bookId} />
                    {/* Checked against the context inside `createComment`, so
                        this is a convenience and not a trust boundary — the
                        same shape `offerDonationAction`'s `thanh-vien` has.
                        A forged `sach-id` naming another shelf's book is
                        refused by the database rather than by this field: the
                        composite foreign key `(bookshelf_id, book_id)`
                        (`20260808_04_composite_tenant_fks.sql`) has no row to
                        point at. */}
                    <input type="hidden" name="thanh-vien" value={membershipId} />

                    {/* `required` on both halves — the word "Bắt buộc" rather
                        than an asterisk is `Field`'s own doing (AGENTS.md rule
                        6). `createComment` refuses an empty body anyway
                        (`empty_body`); marking it here is what saves a child a
                        round trip to be told so, and is what the sibling
                        `gop-y` form already does. */}
                    <Field label="Viết bình luận" required htmlFor="noi-dung">
                      <Textarea
                        id="noi-dung"
                        name="noi-dung"
                        rows={4}
                        required
                        placeholder="Em thấy cuốn này thế nào?"
                      />
                    </Field>

                    {/* **What happened, in a sentence, because the comment
                        itself will not appear.** `getBookComments` returns
                        approved rows only — that predicate is INV-9 living in
                        the access path, and its docstring is explicit that a
                        reader seeing their own pending comment would be a
                        different query and a product decision. So a child who
                        presses this button and is met with an unchanged page
                        would have no way to tell it worked. The wording
                        follows whichever setting the shelf actually has. */}
                    {sent === "binh-luan" ? (
                      <SavedNotice>
                        {needsApproval
                          ? "Đã gửi. Quản lý tủ sách sẽ duyệt trước khi bình luận hiện lên."
                          : "Đã gửi bình luận."}
                      </SavedNotice>
                    ) : null}

                    {/* **`variant="outline"`, and it has to be said explicitly**
                        — `SubmitButton` defaults to `variant="primary"`, which
                        is solid terracotta, and this page's one primary action
                        is "Xin mượn" above. Two terracotta buttons on one
                        screen is a defect by AGENTS.md rule 3, and nothing in
                        the suite guards that rule, so the only thing standing
                        between this line and a second one is this line. */}
                    <SubmitButton variant="outline" className="mt-4">
                      Gửi bình luận
                    </SubmitButton>
                  </form>
                )}
              </section>
            ) : null}
          </div>
        </div>
      </main>
    </>
  );
}
