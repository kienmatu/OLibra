import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { ManagerCopyRow } from "@/domain/catalogue/queries/get-book-detail-manager";
import {
  AlertCircle,
  Archive,
  BookDown,
  BookOpen,
  BookUp,
  Check,
  CircleCheckBig,
  ClipboardList,
  EyeOff,
  HelpCircle,
  Pencil,
  Plus,
} from "lucide-react";
import { ButtonLink, buttonClasses } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { BookCover, BookTitle } from "@/components/ui/book";
import { StatusBadge } from "@/components/ui/status-badge";
import { Card } from "@/components/ui/card";
import { ManagerShell } from "@/components/shell/manager-shell";
import { ConditionPicker } from "@/components/condition-picker";
import { DonorFields } from "@/components/donor-fields";
import { copyStateTransition, type CopyState } from "@/domain/catalogue/policy";
import { messageFor } from "@/domain/kernel/errors";
import {
  getPendingComments,
  getRecentComments,
} from "@/domain/community/queries/get-comments";
import { getReadersList } from "@/domain/members/queries/get-readers-list";
import { copyCountLine } from "@/lib/catalogue";
import { formatDate, formatInstant } from "@/lib/dates";
import { bookFromSlug, chooseCopyToLend } from "@/lib/lending";
import { getManagerBadgeCounts } from "@/domain/shelf/queries/get-manager-dashboard";
import { loadPage } from "@/lib/page-data";
import { refusalFrom, type SearchParams } from "@/lib/search-params";
import { readShelf } from "@/lib/shelf";
import { cn } from "@/lib/utils";
import { CONDITION_LABELS, COPY_STATE_STATUS, STATUS } from "@/lib/status";
import {
  addCopiesAction,
  approveCommentAction,
  assessConditionAction,
  hideCommentAction,
  markCopyFoundOnBookAction,
  rejectCommentAction,
  reportCopyLostOnBookAction,
  retireCopyOnBookAction,
} from "../../actions";

/**
 * How many members "Thêm bản"'s donor picker offers — the identical ceiling
 * `sach/moi/page.tsx` uses for the same picker, and for the same reason
 * (`getReadersList`'s own paging limit; see that page's docstring).
 */
const DONOR_PAGE_SIZE = 100;

/**
 * U1 §2, and this page had a `force-dynamic` before it read anything: the
 * "Thêm bản" form below needs today's date in `Asia/Ho_Chi_Minh`, which a
 * build-time render freezes forever. It now carries the marker for the reason
 * every page in this seam does as well — a cached render of a manager screen
 * is RLS never being consulted, with no SQL for any `tests/db/` test to see.
 */
export const dynamic = "force-dynamic";

/** SDD §6.6, the same formatter the other lending screens use. */
const NUMBER = new Intl.NumberFormat("vi-VN");

/**
 * How many approved comments this page shows under a book, passed to
 * `getRecentComments` rather than left to its own default.
 *
 * One constant so the number fetched and the number the caption names cannot
 * drift: the page says "Chỉ hiện N bình luận mới nhất" precisely when the list
 * came back full, and a hard-coded 10 beside a query default of 10 is two
 * places for that to stop being true.
 */
const RECENT_APPROVED_LIMIT = 5;

/**
 * A title's management page (OPS §3.3's `GetBookDetail` (manager)), and — per
 * BR §16.1 and OPS §5 — the shorter doorway into the two circulation flows.
 *
 * **The two entry points are per *title*, not per copy.** OPS §5: "When a copy
 * of that title is available, the page shows **Cho mượn**; when one is out, it
 * shows **Nhận trả**." Both open the identical flow with step 1 already done,
 * "because the book is the page the manager is already looking at" — so
 * `Cho mượn` lands on step 2 with `?sach=` set, and `Nhận trả` lands on the
 * return screen with the search already run. Neither adds a command; they are
 * "the same two flows with a shorter runway".
 *
 * Putting them on the copy rows was the tempting alternative and it is subtly
 * worse: `LendCopy`'s input is one `copyId`, `chooseCopyToLend` picks the
 * lowest available shelf-mark, and a button on the DT-0141 row that produced a
 * confirmation naming DT-0140 would be the screen contradicting itself for no
 * gain. The title is what OPS names, and the title is what a volunteer is
 * holding.
 *
 * **`[id]` is a slug.** Every book URL in this app already carries one, the
 * crawler's seed list names one, and `getBookDetailManager` takes a `bookId` —
 * so `bookFromSlug` resolves the one to the other. A slug naming nothing is a
 * 404, which is what a 404 is for; U1 §3.4's rule about not confirming a page
 * exists is unaffected, because this answer does not depend on who is asking.
 *
 * **Four of the five remaining controls were, until Task 11 (QA remediation),
 * plain `<button>`s that submitted nothing — no enclosing `<form>` at all —
 * and "Sửa sách" linked to the book *list* rather than to an edit form.**
 * U1 shipped them that way on purpose: "Đánh giá", "Báo mất", "Ngừng dùng",
 * "Đánh dấu tìm thấy" and "Sửa sách" drew from real copies instead of a
 * fixture array, but wiring their commands was not that slice — U1 is the six
 * lending screens and the seam, and "wire the rest of the catalogue's buttons
 * while I am here" is how a slice stops being reviewable. The QA sweep this
 * task's plan is named for found the visible cost of leaving that decision
 * unrevisited: twelve dead submit buttons on this one screen, the largest
 * single defect in that report. `assessCondition`, `reportCopyLost`,
 * `retireCopy`, `markCopyFound` and `updateBook` have all existed, fully
 * tested, since B1.
 *
 * **Every one of the five now renders behind a real `<form>`, and
 * state-gated.** `copyControls` below reads `copyStateTransition`
 * (`src/domain/catalogue/policy.ts`) — the same table `reportCopyLost`,
 * `retireCopy` and `markCopyFound` themselves consult — so a copy that is
 * `on_loan` never shows "Ngừng dùng" (BR §7.1 draws no `on_loan → retired`
 * arrow) and a copy that is not `lost` never shows "Đánh dấu tìm thấy". That
 * is Task 3's lesson, restated: a control a viewer's own role cannot use must
 * not render, and neither must one the copy's own *state* cannot use — a
 * control that renders and then always refuses is a dead button with extra
 * steps. `assessCondition` consults no transition table at all (BR §9: "a
 * condition is not a state"), so "Đánh giá" is withheld from `lost` and
 * `retired` copies on ordinary product grounds instead — nothing left to
 * inspect — not a rule the command enforces.
 *
 * **No per-viewer-role gate was added, and that is a checked fact, not an
 * oversight.** `getBookDetailManager` (this page's own read) and all six
 * commands this page now calls (five copy-state commands plus `addCopies`)
 * open with the identical `requireManager` — unlike `co-cau`'s five, which
 * are `super_admin`-only under a `manager`-readable page and needed a
 * `canEdit` split. Whoever can reach this page at all can use every control
 * that its *copy state* allows.
 *
 * **"Đánh giá" and "Báo mất" moved into `<details>` disclosures, matching
 * `sach/mat/page.tsx`'s own "Ngừng dùng"**, because both need a field beyond
 * the bare confirm `sach/mat`'s "Đánh dấu tìm thấy" gets away with —
 * `ConditionPicker` (extracted from `nhan-tra`, see that component's own
 * docstring) for the first, an optional note for the second.
 *
 * **"Thêm bản" is wired too, added in a review round rather than in this
 * task's first pass.** The brief named the other five commands and not
 * `addCopies`, and the first version of this page left "Thêm bản" exactly as
 * it always was — a `<form>` with no `action` at all. That reading of scope
 * was too narrow: a form that accepts input and silently discards it (the
 * browser's default GET, serialising every field into a query string nobody
 * reads) is a worse failure than the twelve buttons this task exists to fix,
 * not an unrelated one, because it sits on the same screen and looks like it
 * worked. `actions.ts`'s own section header has the fuller account, including
 * why the guard test below needed extending to see this shape at all — it
 * only checked that a submit control sat inside *some* `<form>`, not that the
 * form had anywhere to go.
 *
 * **The "Thêm bản" hint no longer names a code.** It read "ví dụ DT-0143", and
 * that was the sharpest surviving piece of the preview `sach/moi`'s docstring
 * says was removed: a specific *next sequence number*, on a page that renders
 * this title's actual copy codes a few lines below it, so the invented one sat
 * beside the real ones. `allocateCopyCodes` assigns under a per-shelf advisory
 * lock inside the command's transaction — the next number is not knowable here,
 * and another manager cataloguing at the same moment is exactly why. The prefix
 * was wrong independently: `copyCodePrefix`
 * (`src/domain/catalogue/policy.ts:183`) derives it from the shelf slug, so
 * `DT-` held on one of the four seeded shelves.
 */
/**
 * QA remediation Task 25. `bookFromSlug` — the exact resolver the page body
 * calls with the exact same `id` — rather than a lighter hand-written lookup:
 * it is already "the record this page would name itself with" (the
 * controller notes' own phrase), and inventing a narrower query here would be
 * a second definition of "does this slug name a book" alongside the page's.
 * It costs the same four extra reads (copies, condition history, loan
 * history) `getBookDetailManager` always does — heavier than the title alone
 * needs, and reusing the established resolver rather than growing a third one
 * beside it (`getBookDetail` for readers, `getBookForEdit` for the edit form)
 * is the trade this task makes.
 *
 * `notFound()` on the same `!book` check the page body uses, so a slug naming
 * nothing 404s here exactly as the render would a moment later.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ shelf: string; id: string }>;
}): Promise<Metadata> {
  const { shelf: slug, id } = await params;

  const { book } = await loadPage(slug, async (tx, ctx) => ({
    book: await bookFromSlug(tx, ctx, id),
  }));
  if (!book) notFound();

  return { title: `${book.book.title} — Quản lý tủ sách OLibra` };
}

export default async function ManagerBookDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ shelf: string; id: string }>;
  /** `?loi=` from a comment decision made on this page — read through
   *  `search-params.ts`, never destructured, because a repeated key arrives as
   *  an array. */
  searchParams: Promise<SearchParams>;
}) {
  const { shelf: slug, id } = await params;
  const refused = refusalFrom(await searchParams);

  const { shelf, viewer, counts, book, donors, waiting, published } =
    await loadPage(slug, async (tx, ctx, viewer) => {
      const book = await bookFromSlug(tx, ctx, id);
      const bookId = book?.book.bookId;
      return {
        shelf: await readShelf(tx, ctx),
        viewer,
        counts: await getManagerBadgeCounts(tx, ctx),
        book,
        // Only members who could plausibly be standing at the shelf handing
        // over a book — `DonorFields`' own docstring states the rule, and
        // `sach/moi/page.tsx` applies the identical filter for the identical
        // picker.
        donors: await getReadersList(tx, ctx, {
          status: "active",
          pageSize: DONOR_PAGE_SIZE,
        }),
        /**
         * This title's own comments — the two states that still have a
         * decision in them.
         *
         * `waiting` is what a manager reading this book came here to act on;
         * `published` is what a reader is looking at on the same book's
         * public page right now, and it is here so **Ẩn** has something to
         * name. Rejected and hidden comments are not read: neither has a
         * command that moves it anywhere, and `/quan-ly/binh-luan`'s own
         * chips already archive them.
         *
         * Both are skipped entirely when the slug named no book, because the
         * page 404s a line below and a query for `undefined` would be a
         * shelf-wide read whose rows this page would then throw away.
         */
        waiting: bookId ? await getPendingComments(tx, ctx, { bookId }) : [],
        published: bookId
          ? await getRecentComments(tx, ctx, {
              status: "approved",
              bookId,
              limit: RECENT_APPROVED_LIMIT,
            })
          : [],
      };
    });
  if (!book) notFound();

  const base = `/tu-sach/${slug}/quan-ly`;
  const lendable = chooseCopyToLend(book).copy;
  const anyOnLoan = book.copies.some((copy) => copy.state === "on_loan");

  return (
    <ManagerShell
      shelfName={shelf.name}
      shelfSlug={slug}
      active="sach"
      viewer={viewer}
      counts={counts}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex gap-4">
          <BookCover
            title={book.book.title}
            coverUrl={book.book.coverUrl}
            className="w-24 text-[1.6rem]"
          />
          <div>
            <BookTitle as="h1" className="block text-[28px] leading-tight">
              {book.book.title}
            </BookTitle>
            <p className="mt-1 text-[16px] text-meta">{book.book.author}</p>
            {/* Category and nothing else. `BooksListRow` — which OPS §3.3's
                manager book detail returns — carries no publisher, year or page
                count; the reader-facing `getBookDetail` does, and it is gated on
                `requireReader` and filters unpublished titles, so it is the
                wrong query for this page twice over. A heading that printed
                "undefined · undefined" instead would be worse than a shorter
                one. */}
            <p className="mt-1 text-[14px] text-meta">{book.book.category}</p>

            {/**
             * The way back to what a reader sees (U6 §8).
             *
             * `sach/[slug]/page.tsx` has linked *into* this page since it was
             * written — "Quản lý sách này — sửa thông tin, thêm bản, xem lịch
             * sử" — and nothing here linked back, so a volunteer who wanted to
             * check how a title reads to a child typed the URL. The same
             * one-way street `ManagerShell` had to the shelf itself, one page
             * further in.
             *
             * **Gated on `isPublished`, and that is not a nicety.**
             * `getBookDetail` ends its statement with `and b.is_published`, so
             * the reader page 404s for an unpublished title — the honest
             * behaviour there (a draft has no reader page) and a dead link
             * here. This page's own heading comment already records that the
             * two queries differ; `BooksListRow` carries `isPublished` for
             * exactly this kind of question, and an absent link is the same
             * answer the "Cho mượn" button above gives when there is nothing
             * lendable.
             *
             * A quiet text link rather than a fourth button: the action row
             * beside it is what a volunteer standing at the shelf came to do,
             * and this is a look, not a task. It mirrors the shape of the link
             * on the reader page that points here.
             */}
            {book.book.isPublished ? (
              <Link
                href={`/tu-sach/${slug}/sach/${book.book.slug}`}
                className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-[15px] font-medium text-sage hover:underline"
              >
                <BookOpen aria-hidden className="size-4" strokeWidth={1.75} />
                Xem chi tiết
              </Link>
            ) : null}
          </div>
        </div>

        {/* One primary per screen (`button.tsx`: "if two things on a screen are
            terracotta, one of them is wrong"). It is `Cho mượn` when there is a
            copy to lend, because that is what a volunteer standing at the shelf
            with a child in front of them came here to do — "Sửa sách" moves to
            `quiet` rather than disappearing. When nothing is lendable there is
            simply no terracotta on the page, which is honest: none of the
            remaining actions is the obvious next one. */}
        <div className="flex flex-wrap items-center gap-3">
          {lendable ? (
            <ButtonLink
              href={`${base}/cho-muon/nguoi-doc?sach=${encodeURIComponent(
                book.book.slug,
              )}`}
              variant="primary"
              size="lg"
            >
              <BookUp aria-hidden className="size-5" strokeWidth={1.75} />
              Cho mượn
            </ButtonLink>
          ) : null}
          {anyOnLoan ? (
            // The search key is the title, not a copy code: a title with three
            // copies out has three loans to choose between, and this lands on
            // the screen that lists exactly those. `searchLoansForReturn` folds
            // the title on both sides, so the diacritics survive the round trip.
            <ButtonLink
              href={`${base}/nhan-tra?q=${encodeURIComponent(book.book.title)}`}
              variant="outline"
              size="lg"
            >
              <BookDown aria-hidden className="size-5" strokeWidth={1.75} />
              Nhận trả
            </ButtonLink>
          ) : null}
          <ButtonLink
            href={`${base}/sach/${book.book.slug}/sua`}
            variant="quiet"
            size="lg"
          >
            <Pencil aria-hidden className="size-5" strokeWidth={1.75} />
            Sửa sách
          </ButtonLink>
        </div>
      </div>

      <section className="mt-10">
        {/* PO feedback round 1, Task 11 / SDD §10. The same sentence the
            reader's book page now shows, summarising the table beneath it —
            one function (`copyCountLine`) so the wording on the two pages
            cannot drift apart. `book.onLoan` is Task 11's own addition to
            `getBookDetailManager`'s return shape; the SQL had always counted
            it for `deriveAvailability` and no screen had ever seen the
            number.

            Post-review fix wave, item 7: `book.book.copiesTotal` now excludes
            both `retired` and `lost` copies (the query fix, above this
            page), so "N bản trong tủ" is true for a lost copy — it plainly is
            not in the cupboard — and the heading three lines down uses this
            exact number too, so the two no longer disagree. */}
        <p className="text-[15px] text-meta">
          {copyCountLine({
            copiesAvailable: book.book.copiesAvailable,
            onLoan: book.onLoan,
            copiesTotal: book.book.copiesTotal,
          })}
        </p>

        {/* A title receives more donated copies over time, so the copy count
            has to be able to grow after cataloguing. This is the only entry
            point for that — "Sửa sách" edits the title, not the shelf. */}
        {/* items-start, not items-center: the disclosure's body grows tall
            once opened, and centring against it left the heading floating
            in the middle of that height instead of sitting at the top. */}
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          {/* Post-review fix wave, item 7: this used to be
              `book.copies.length`, which counts every row the table below
              renders — retired and lost copies included, since a manager's
              page shows those with their reason (unlike a reader's). That
              made this heading disagree with the summary line above it: one
              retired copy read "3 bản trong tủ" here and "Các bản sách (4)"
              three lines down, over a four-row table. `book.book.copiesTotal`
              is the number the line above already uses, so the two now
              agree — the table itself is unchanged and still lists every
              copy, retired and lost ones included. */}
          <h2 className="pt-2.5 text-xl font-semibold">
            Các bản sách ({NUMBER.format(book.book.copiesTotal)})
          </h2>
          {/* A <details> disclosure, not a separate page: adding more copies
              to a title already catalogued is only two fields beyond the
              count, so a whole route and a "quay lại" trip back here would be
              more navigation than the task needs. It needs no client
              JavaScript, matching every other static page in this shell. */}
          <details className="group">
            {/* A `<summary>` cannot render as `<Button>` — it isn't a button
                or a link — so it reuses the exact same class builder instead
                of a hand-rolled copy that would drift from it (M1/M2).

                No `cursor-pointer`: `globals.css` already sets it for `summary`
                at the base layer, and DESIGN.md §5 is why it does — "a rule
                that has to be remembered on each new button is a rule that will
                be forgotten on the twentieth". Passing it here is the twentieth
                button remembering it, which is the habit the base rule exists to
                make unnecessary. */}
            <summary
              className={buttonClasses(
                "quiet",
                "sm",
                "list-none [&::-webkit-details-marker]:hidden",
              )}
            >
              <Plus aria-hidden className="size-4" strokeWidth={2} />
              Thêm bản
            </summary>

            <form
              action={addCopiesAction}
              className="mt-4 max-w-md space-y-5 rounded-card border border-hairline bg-paper p-5"
            >
              <input type="hidden" name="tu-sach" value={slug} />
              <input type="hidden" name="sach-id" value={book.book.bookId} />
              <input type="hidden" name="sach" value={book.book.slug} />
              <Field
                label="Số bản muốn thêm"
                required
                htmlFor="them-so-ban"
                hint="Tủ sách tự đặt mã cho bản mới, không cần điền."
              >
                <Input
                  id="them-so-ban"
                  name="so-ban"
                  type="number"
                  min={1}
                  defaultValue={1}
                  required
                  className="max-w-32"
                />
              </Field>

              {/* This shelf's own active members, read alongside the book —
                  the wave `donor-fields.tsx`'s own docstring said this list
                  was waiting for, now that the form has an action to post
                  the chosen id to. */}
              <DonorFields
                idPrefix="them-nguoi-tang"
                donors={donors.rows.map((r) => ({
                  id: r.membershipId,
                  fullName: r.fullName,
                }))}
              />

              {/* Outline, not solid: this screen's one primary action is
                  already spoken for above (AGENTS.md/button.tsx — "if two
                  things on a screen are terracotta, one of them is wrong").
                  This form only exists once the disclosure is open, at which
                  point both buttons are on screen at once. */}
              <SubmitButton variant="outline" size="md">
                Lưu bản mới
              </SubmitButton>
            </form>
          </details>
        </div>

        <div className="mt-4 hidden overflow-hidden rounded-card border border-hairline md:block">
          <table className="w-full text-left">
            <thead className="bg-paper">
              <tr>
                <th className="px-4 py-3 text-[14px] font-medium text-meta">
                  Mã bản
                </th>
                <th className="px-4 py-3 text-[14px] font-medium text-meta">
                  Tình trạng
                </th>
                <th className="px-4 py-3 text-[14px] font-medium text-meta">
                  Chất lượng
                </th>
                <th className="px-4 py-3 text-[14px] font-medium text-meta">
                  Đang ở đâu
                </th>
                <th className="px-4 py-3 text-[14px] font-medium text-meta">
                  Người tặng
                </th>
                <th className="px-4 py-3 text-[14px] font-medium text-meta">
                  Thao tác
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {book.copies.map((copy) => (
                <tr key={copy.copyId}>
                  <td className="px-4 py-3 text-[15px] font-medium">{copy.code}</td>
                  <td className="px-4 py-3">
                    <StatusBadge
                      // `overdue` is a property of a loan, never of a copy —
                      // `COPY_STATE_STATUS` deliberately cannot produce it. The
                      // loan is right here, so the badge can be honest about it.
                      status={
                        copy.state === "on_loan" && copy.isOverdue
                          ? "overdue"
                          : COPY_STATE_STATUS[copy.state]
                      }
                      size="sm"
                    />
                  </td>
                  <td className="px-4 py-3 text-[15px] text-ink/85">
                    {CONDITION_LABELS[copy.condition]}
                  </td>
                  <td className="px-4 py-3 text-[15px] text-ink/85">
                    <CopyLocation copy={copy} />
                  </td>
                  <td className="px-4 py-3 text-[15px] text-ink/85">
                    <DonorCell copy={copy} slug={slug} />
                  </td>
                  <td className="px-4 py-3">
                    <CopyActions
                      copy={copy}
                      slug={slug}
                      bookSlug={book.book.slug}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 space-y-3 md:hidden">
          {book.copies.map((copy) => (
            <div
              key={copy.copyId}
              className="rounded-card border border-hairline bg-surface p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-[15px] font-medium">{copy.code}</span>
                <StatusBadge
                  status={
                    copy.state === "on_loan" && copy.isOverdue
                      ? "overdue"
                      : COPY_STATE_STATUS[copy.state]
                  }
                  size="sm"
                />
              </div>
              <p className="mt-1.5 text-[14px] text-meta">
                {CONDITION_LABELS[copy.condition]} · <CopyLocation copy={copy} />
              </p>
              <p className="mt-1 text-[14px] text-meta">
                Người tặng: <DonorCell copy={copy} slug={slug} />
              </p>
              <div className="mt-3">
                <CopyActions
                  copy={copy}
                  slug={slug}
                  bookSlug={book.book.slug}
                  stretch
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Dropped entirely when there is nothing to show, rather than drawn as a
          heading over an empty bordered list. BR §11 keeps assessments forever,
          so a title with none has simply never been assessed — and the empty
          state that would say so in Vietnamese is a sentence neither
          OPERATIONS.md nor `ERROR_MESSAGES` contains, which is not a sentence
          this slice gets to invent. */}
      {book.conditionHistory.length > 0 ? (
        <section className="mt-10">
          <h2 className="text-xl font-semibold">Lịch sử đánh giá tình trạng</h2>
          <ul className="mt-4 divide-y divide-hairline border-y border-hairline">
            {book.conditionHistory.map((entry, i) => (
              <li
                // `condition_assessments` has no natural key a screen can reach —
                // the query returns no id — so the index joins the timestamp to
                // keep two assessments written in the same instant distinct.
                key={`${entry.assessedAt}-${i}`}
                className="flex flex-wrap items-center gap-2 py-3 text-[15px]"
              >
                <span className="text-meta">{formatInstant(entry.assessedAt)}</span>
                <span>Bản {entry.copyCode}</span>
                {entry.assessorName ? (
                  <span className="text-meta">{entry.assessorName}</span>
                ) : null}
                <span className="rounded-control bg-paper px-2 py-0.5 text-[13px] font-medium text-leather">
                  {CONDITION_LABELS[entry.condition]}
                </span>
                {entry.note ? (
                  <span className="text-meta">{entry.note}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-10">
        <h2 className="text-xl font-semibold">Lịch sử mượn</h2>

        {/* QA T27: an empty `book.loanHistory` used to still render this whole
            table shell — header row, empty `<tbody>`, nothing telling a
            manager whether that meant "never borrowed" or a page that failed
            to load. `/quan-ly/nguoi-doc` and `/quan-ly/sach` already guard
            their own tables behind a `rows.length === 0` check and a
            "Chưa có…" line instead of an empty grid; this section had none. */}
        {book.loanHistory.length === 0 ? (
          <p className="mt-4 text-[15px] text-meta">Chưa có lượt mượn nào.</p>
        ) : (
          <>
            <div className="mt-4 hidden overflow-hidden rounded-card border border-hairline md:block">
              <table className="w-full text-left">
                <thead className="bg-paper">
                  <tr>
                    <th className="px-4 py-3 text-[14px] font-medium text-meta">
                      Bản
                    </th>
                    <th className="px-4 py-3 text-[14px] font-medium text-meta">
                      Người mượn
                    </th>
                    <th className="px-4 py-3 text-[14px] font-medium text-meta">
                      Mượn ngày
                    </th>
                    <th className="px-4 py-3 text-[14px] font-medium text-meta">
                      Trả ngày
                    </th>
                    <th className="px-4 py-3 text-[14px] font-medium text-meta">
                      Tình trạng khi trả
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline">
                  {book.loanHistory.map((loan) => (
                    <tr key={loan.loanId}>
                      <td className="px-4 py-3 text-[15px] font-medium">
                        {loan.copyCode}
                      </td>
                      <td className="px-4 py-3 text-[15px] text-ink/85">
                        {loan.borrowerName}
                      </td>
                      <td className="px-4 py-3 text-[15px] text-ink/85">
                        {formatInstant(loan.lentAt)}
                      </td>
                      <td className="px-4 py-3 text-[15px] text-ink/85">
                        {loan.returnedAt ? formatInstant(loan.returnedAt) : "—"}
                      </td>
                      <td className="px-4 py-3 text-[15px] text-ink/85">
                        <LoanOutcome loan={loan} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 space-y-3 md:hidden">
              {book.loanHistory.map((loan) => (
                <div
                  key={loan.loanId}
                  className="rounded-card border border-hairline bg-surface p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[15px] font-medium">{loan.copyCode}</span>
                    <span className="text-[14px] text-meta">
                      <LoanOutcome loan={loan} />
                    </span>
                  </div>
                  <p className="mt-1 text-[15px]">{loan.borrowerName}</p>
                  <p className="mt-0.5 text-[14px] text-meta">
                    {formatInstant(loan.lentAt)} –{" "}
                    {loan.returnedAt ? formatInstant(loan.returnedAt) : "—"}
                  </p>
                </div>
              ))}
            </div>
          </>
        )}

        <p className="mt-3 text-[14px] text-meta">
          Lịch sử mượn không bao giờ bị xoá, kể cả khi bản sách đã ngừng dùng.
        </p>
      </section>

      {/**
       * This title's comments, and the decisions still open on them.
       *
       * **Why here and not only in `/quan-ly/binh-luan`.** That screen is a
       * queue — a stack of cards from every book on the shelf, worked through
       * in order. This is the page a manager is on when they are thinking
       * about *this book*, and until now a comment waiting on it was invisible
       * from here: they would have had to leave, open the queue, and find the
       * right card among every other title's. The queue is unchanged and is
       * still where a manager works a backlog; this is the same rows, reachable
       * from the one page that is about the book they name.
       *
       * INV-9 is not enforced here, exactly as `/quan-ly/binh-luan`'s docstring
       * says it must not be: "a comment is publicly visible only when approved"
       * lives in `getBookComments`' own predicate, and this is a screen where a
       * manager *changes* the status. A page that filtered would be a second
       * definition of visibility the book's public page could disagree with.
       */}
      <section className="mt-10">
        <h2 className="text-xl font-semibold">Bình luận</h2>

        {refused ? (
          <p
            role="alert"
            className="mt-4 flex max-w-2xl items-center gap-2 rounded-card border border-brick bg-brick/8 px-4 py-3 text-[15px] text-brick"
          >
            <AlertCircle
              aria-hidden
              className="size-5 shrink-0"
              strokeWidth={1.75}
            />
            {messageFor(refused)}
          </p>
        ) : null}

        {waiting.length === 0 && published.length === 0 ? (
          <p className="mt-3 text-[15px] text-meta">
            Chưa có bình luận nào cho cuốn này.
          </p>
        ) : null}

        {waiting.length > 0 ? (
          <div className="mt-4 max-w-2xl space-y-4">
            <p className="text-[15px] text-meta">
              {NUMBER.format(waiting.length)} bình luận đang chờ duyệt. Bình luận
              chỉ hiện trên trang sách sau khi được duyệt.
            </p>

            {waiting.map((comment) => (
              <Card key={comment.id}>
                <p className="text-[15px] font-medium">
                  {comment.authorName}
                  <span className="ml-2 text-[14px] font-normal text-meta">
                    gửi {formatInstant(comment.createdAt)}
                  </span>
                </p>
                {/* Plain text, escaped by React — BR §5.4, and what
                    `inv-09-comment-visibility.test.ts` pins with a `<script>`
                    body. Nothing about what a child wrote is interpreted. */}
                <p className="mt-2 text-[16px] whitespace-pre-line">
                  {comment.body}
                </p>

                <div className="mt-5 flex flex-wrap items-start gap-4 border-t border-hairline pt-5">
                  <form action={approveCommentAction}>
                    <input type="hidden" name="tu-sach" value={slug} />
                    <input type="hidden" name="binh-luan" value={comment.id} />
                    {/* The slug, so the decision comes back to *this* page
                        rather than to the queue. `afterCommentDecision` builds
                        the URL from it — a form never names a path. */}
                    <input type="hidden" name="sach" value={book.book.slug} />
                    <SubmitButton
                      icon={
                        <Check aria-hidden className="size-5" strokeWidth={1.75} />
                      }
                    >
                      Duyệt bình luận
                    </SubmitButton>
                  </form>

                  {/* The same `<details>` the queue uses, for the same reason:
                      the reason is required and asking for it in place keeps
                      the decision on the card being read. */}
                  <details className="min-w-0">
                    <summary className="inline-flex h-12 cursor-pointer list-none items-center justify-center gap-2 rounded-control border border-brick px-5 text-[16px] font-semibold text-brick transition-colors hover:bg-brick/8 [&::-webkit-details-marker]:hidden">
                      Từ chối
                    </summary>
                    <form
                      action={rejectCommentAction}
                      className="mt-3 w-full max-w-md space-y-3"
                    >
                      <input type="hidden" name="tu-sach" value={slug} />
                      <input type="hidden" name="binh-luan" value={comment.id} />
                      <input type="hidden" name="sach" value={book.book.slug} />
                      <Field
                        label="Lý do từ chối"
                        required
                        hint="Bạn đọc sẽ thấy lý do này."
                        htmlFor={`ly-do-${comment.id}`}
                      >
                        <Input id={`ly-do-${comment.id}`} name="ly-do" required />
                      </Field>
                      <SubmitButton variant="outline">
                        Từ chối bình luận
                      </SubmitButton>
                    </form>
                  </details>
                </div>
              </Card>
            ))}
          </div>
        ) : null}

        {published.length > 0 ? (
          <div className="mt-8 max-w-2xl">
            <h3 className="text-[16px] font-semibold">Đang hiện trên trang sách</h3>
            <ul className="mt-3 divide-y divide-hairline border-y border-hairline">
              {published.map((comment) => (
                <li
                  key={comment.id}
                  className="flex flex-wrap items-start justify-between gap-4 py-4"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-medium">
                      {comment.authorName}
                      <span className="ml-2 text-[14px] font-normal text-meta">
                        {formatInstant(comment.createdAt)}
                      </span>
                    </p>
                    <p className="mt-1 text-[16px] whitespace-pre-line">
                      {comment.body}
                    </p>
                  </div>
                  {/* BR §7.5 — pulling something already public. The reason is
                      optional here where a rejection's is required, and OPS
                      §4.4 draws that distinction: a rejection is a message to
                      an author who is waiting to hear, hiding is a manager
                      removing something published hours or months ago, often
                      with nobody to tell. */}
                  <form action={hideCommentAction} className="shrink-0">
                    <input type="hidden" name="tu-sach" value={slug} />
                    <input type="hidden" name="binh-luan" value={comment.id} />
                    <input type="hidden" name="sach" value={book.book.slug} />
                    <SubmitButton variant="quiet" size="sm">
                      <EyeOff aria-hidden className="size-4" strokeWidth={1.75} />
                      Ẩn
                    </SubmitButton>
                  </form>
                </li>
              ))}
            </ul>
            {/* `getRecentComments` is capped rather than paged, deliberately —
                see its docstring. Said out loud rather than left to be noticed,
                because a silently truncated list reads as a complete one. */}
            {published.length === RECENT_APPROVED_LIMIT ? (
              <p className="mt-3 text-[14px] text-meta">
                Chỉ hiện {NUMBER.format(RECENT_APPROVED_LIMIT)} bình luận mới nhất.
                Xem đầy đủ ở{" "}
                <Link
                  href={`${base}/binh-luan?trang-thai=approved`}
                  className="font-medium text-sage hover:underline"
                >
                  trang bình luận
                </Link>
                .
              </p>
            ) : null}
          </div>
        ) : null}
      </section>
    </ManagerShell>
  );
}

/**
 * Which write controls a copy's row offers, derived from
 * `copyStateTransition` — the single authority every one of these commands
 * itself consults — rather than a second, hand-written table that could drift
 * from it. See this page's own docstring for the Task 3 lesson this restates.
 *
 * `assess` is the one flag `copyStateTransition` cannot answer:
 * `assessCondition` consults no transition table at all (BR §9), so it is
 * withheld from `lost` and `retired` on ordinary product grounds — nothing
 * left to inspect — stated here rather than in the domain, because it is a
 * screen's judgement and not a rule any command enforces.
 *
 * `markFound` does not delegate to `copyStateTransition(state, "available")`:
 * that arrow also exists from `held` (BR §7.1's `held → available`, a
 * cancelled hold), which is a different event this page draws no control for
 * at all. `markCopyFound`'s own guard is narrower still — `copy.state !==
 * "lost"` throws regardless of what the transition table says — so this
 * mirrors the command's actual condition rather than the table's.
 */
function copyControls(state: CopyState): {
  assess: boolean;
  reportLost: boolean;
  retire: boolean;
  markFound: boolean;
} {
  return {
    assess: state !== "lost" && state !== "retired",
    reportLost: copyStateTransition(state, "lost").allowed,
    retire: copyStateTransition(state, "retired").allowed,
    markFound: state === "lost",
  };
}

/**
 * One copy row's write controls — shared between the desktop table's `<td>`
 * and the mobile card, so the state-gating in `copyControls` above and the
 * four forms below are written once rather than twice and drifting the way
 * the fixture-era buttons already show duplication can.
 *
 * Every form carries `sach` (the *book's* slug, hidden) so its action —
 * `assessConditionAction`, `reportCopyLostOnBookAction`,
 * `retireCopyOnBookAction`, `markCopyFoundOnBookAction`, all in `../../
 * actions.ts` — returns the manager to this book rather than to `sach/mat` or
 * `nhan-tra`, whose own action wrappers this page deliberately does not
 * reuse; see that file's own section header for why.
 */
function CopyActions({
  copy,
  slug,
  bookSlug,
  stretch,
}: {
  copy: ManagerCopyRow;
  /** The shelf's slug — `?tu-sach=` on every form here. */
  slug: string;
  /** The book's slug — `sach` on every form here, and `updateBookAction`'s
   *  own redirect target once "Sửa sách" is used. */
  bookSlug: string;
  /** Set on the mobile card, so its buttons share the card's width evenly —
   *  absent on the desktop table, where the cell sizes to content. */
  stretch?: boolean;
}) {
  const controls = copyControls(copy.state);
  const triggerClass = buttonClasses(
    "quiet",
    "sm",
    cn("list-none [&::-webkit-details-marker]:hidden", stretch && "flex-1"),
  );
  const boxClass =
    "mt-3 w-full max-w-md space-y-3 rounded-card border border-hairline bg-paper p-4";
  // Desktop table and mobile card both render this component for the same
  // copy, and both are in the DOM at once (`hidden md:block`/`md:hidden`
  // toggle visibility, not presence) — so every `id` below is scoped by
  // which one is calling, via `stretch` (true only on the mobile card),
  // rather than by `copy.copyId` alone. A duplicate `id` is not a cosmetic
  // problem: `<label htmlFor>` resolves to whichever element with that id
  // the browser finds first, so the *visible* one's label could silently
  // focus the *hidden* one's input.
  const idScope = `${stretch ? "mobile" : "desktop"}-${copy.copyId}`;

  if (
    !controls.assess &&
    !controls.reportLost &&
    !controls.retire &&
    !controls.markFound
  ) {
    // `retired` is the one state with nothing left to do — BR §7.1 draws no
    // arrow out of it, and `assessCondition` is withheld from it by the same
    // "the physical copy is gone" reasoning `copyControls` states above.
    // Stated rather than left blank, so the cell reads as "nothing to do"
    // instead of as a rendering bug.
    return <span className="text-[14px] text-meta">—</span>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {controls.markFound ? (
        <form action={markCopyFoundOnBookAction}>
          <input type="hidden" name="tu-sach" value={slug} />
          <input type="hidden" name="sach" value={bookSlug} />
          <input type="hidden" name="ban" value={copy.copyId} />
          <SubmitButton
            variant="quiet"
            size="sm"
            className={stretch ? "flex-1" : undefined}
            icon={
              <CircleCheckBig aria-hidden className="size-4" strokeWidth={1.75} />
            }
          >
            Đánh dấu tìm thấy
          </SubmitButton>
        </form>
      ) : null}

      {controls.assess ? (
        <details className="min-w-0">
          <summary className={triggerClass}>
            <ClipboardList aria-hidden className="size-4" strokeWidth={1.75} />
            Đánh giá
          </summary>
          <form action={assessConditionAction} className={boxClass}>
            <input type="hidden" name="tu-sach" value={slug} />
            <input type="hidden" name="sach" value={bookSlug} />
            <input type="hidden" name="ban" value={copy.copyId} />
            <ConditionPicker
              idPrefix={`danh-gia-${idScope}`}
              defaultCondition={copy.condition}
              noteHint="Không bắt buộc."
            />
            <SubmitButton variant="outline" size="md">
              Xác nhận đánh giá
            </SubmitButton>
          </form>
        </details>
      ) : null}

      {controls.reportLost ? (
        <details className="min-w-0">
          <summary className={triggerClass}>
            <HelpCircle aria-hidden className="size-4" strokeWidth={1.75} />
            Báo mất
          </summary>
          <form action={reportCopyLostOnBookAction} className={boxClass}>
            <input type="hidden" name="tu-sach" value={slug} />
            <input type="hidden" name="sach" value={bookSlug} />
            <input type="hidden" name="ban" value={copy.copyId} />
            <Field
              label="Ghi chú"
              htmlFor={`bao-mat-ghi-chu-${idScope}`}
              hint="Không bắt buộc."
            >
              <Textarea id={`bao-mat-ghi-chu-${idScope}`} name="ghi-chu" rows={2} />
            </Field>
            <SubmitButton variant="danger" size="md">
              Xác nhận báo mất
            </SubmitButton>
          </form>
        </details>
      ) : null}

      {controls.retire ? (
        <details className="min-w-0">
          <summary className={triggerClass}>
            <Archive aria-hidden className="size-4" strokeWidth={1.75} />
            Ngừng dùng
          </summary>
          <form action={retireCopyOnBookAction} className={boxClass}>
            <input type="hidden" name="tu-sach" value={slug} />
            <input type="hidden" name="sach" value={bookSlug} />
            <input type="hidden" name="ban" value={copy.copyId} />
            <Field
              label="Lý do ngừng dùng"
              required
              htmlFor={`ly-do-${idScope}`}
              hint="Dùng khi biết chắc sách sẽ không quay lại nữa."
            >
              <Input id={`ly-do-${idScope}`} name="ly-do" required />
            </Field>
            <SubmitButton variant="danger" size="md">
              Xác nhận ngừng dùng
            </SubmitButton>
          </form>
        </details>
      ) : null}
    </div>
  );
}

/** "Đang ở đâu" — on the shelf, or with whom and until when. */
function CopyLocation({ copy }: { copy: ManagerCopyRow }) {
  if (copy.holderName) {
    return (
      <>
        {copy.holderName}
        {copy.dueOn ? ` · hạn ${formatDate(copy.dueOn)}` : null}
      </>
    );
  }
  if (copy.state === "retired" && copy.retiredReason)
    return <>{copy.retiredReason}</>;
  if (copy.state === "available") return <>Trong tủ</>;
  return <>—</>;
}

/**
 * "Người tặng" — QA remediation Task 20. `acquiredFrom` and
 * `acquiredFromMembershipId` have been written by `CreateBook`/`AddCopies`
 * since B1 and read by `getBookDetailManager` since the same wave; this is
 * the first screen either has ever been rendered on.
 *
 * A member donor links to their reader profile — the same
 * `nguoi-doc/[id]` route the approval card and the readers list already
 * link to, keyed by the membership id `acquiredFromMembershipId` carries —
 * so a manager reading a copy's history years later can open an actual
 * person's record rather than stare at a name. A free-text donor has no
 * profile to link to and renders as typed. Neither present is the ordinary
 * case (BR §16.3: "most copies still arrive with no donor recorded at
 * all"), rendered as "—" rather than an empty cell so the column reads as
 * answered rather than broken.
 */
function DonorCell({ copy, slug }: { copy: ManagerCopyRow; slug: string }) {
  if (copy.acquiredFromMembershipId && copy.acquiredFromMembershipName) {
    return (
      <Link
        href={`/tu-sach/${slug}/quan-ly/nguoi-doc/${copy.acquiredFromMembershipId}`}
        className="text-sage hover:underline"
      >
        {copy.acquiredFromMembershipName}
      </Link>
    );
  }
  if (copy.acquiredFrom) return <>{copy.acquiredFrom}</>;
  return <>—</>;
}

/**
 * What became of a loan, in the words the badges already use.
 *
 * `loans.status` is the database's (`0005_circulation.sql`), and every value it
 * can hold is answered here from `STATUS` or `CONDITION_LABELS` rather than
 * from a sentence written on this page.
 */
function LoanOutcome({
  loan,
}: {
  loan: { status: string; returnCondition: string | null };
}) {
  if (loan.returnCondition) {
    return (
      <>{CONDITION_LABELS[loan.returnCondition as keyof typeof CONDITION_LABELS]}</>
    );
  }
  if (loan.status === "lost") return <>{STATUS.lost.label}</>;
  if (loan.status === "active") return <>{STATUS.onloan.label}</>;
  return <>—</>;
}
