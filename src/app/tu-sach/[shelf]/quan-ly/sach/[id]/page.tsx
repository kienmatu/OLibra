import { notFound } from "next/navigation";
import type { ManagerCopyRow } from "@/domain/catalogue/queries/get-book-detail-manager";
import {
  Archive,
  BookDown,
  BookUp,
  CircleCheckBig,
  ClipboardList,
  HelpCircle,
  Pencil,
  Plus,
} from "lucide-react";
import { ButtonLink, buttonClasses } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { BookCover, BookTitle } from "@/components/ui/book";
import { StatusBadge } from "@/components/ui/status-badge";
import { ManagerShell } from "@/components/shell/manager-shell";
import { ConditionPicker } from "@/components/condition-picker";
import { DonorFields } from "@/components/donor-fields";
import { copyStateTransition, type CopyState } from "@/domain/catalogue/policy";
import { getReadersList } from "@/domain/members/queries/get-readers-list";
import { formatDate, formatInstant } from "@/lib/dates";
import { bookFromSlug, chooseCopyToLend } from "@/lib/lending";
import { getManagerBadgeCounts } from "@/domain/shelf/queries/get-manager-dashboard";
import { loadPage } from "@/lib/page-data";
import { readShelf } from "@/lib/shelf";
import { cn } from "@/lib/utils";
import { CONDITION_LABELS, COPY_STATE_STATUS, STATUS } from "@/lib/status";
import {
  addCopiesAction,
  assessConditionAction,
  markCopyFoundOnBookAction,
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
export default async function ManagerBookDetailPage({
  params,
}: {
  params: Promise<{ shelf: string; id: string }>;
}) {
  const { shelf: slug, id } = await params;

  const { shelf, viewer, counts, book, donors } = await loadPage(
    slug,
    async (tx, ctx, viewer) => ({
      shelf: await readShelf(tx, ctx),
      viewer,
      counts: await getManagerBadgeCounts(tx, ctx),
      book: await bookFromSlug(tx, ctx, id),
      // Only members who could plausibly be standing at the shelf handing
      // over a book — `DonorFields`' own docstring states the rule, and
      // `sach/moi/page.tsx` applies the identical filter for the identical
      // picker.
      donors: await getReadersList(tx, ctx, {
        status: "active",
        pageSize: DONOR_PAGE_SIZE,
      }),
    }),
  );
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
          <BookCover title={book.book.title} className="w-24 text-[1.6rem]" />
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
        {/* A title receives more donated copies over time, so the copy count
            has to be able to grow after cataloguing. This is the only entry
            point for that — "Sửa sách" edits the title, not the shelf. */}
        {/* items-start, not items-center: the disclosure's body grows tall
            once opened, and centring against it left the heading floating
            in the middle of that height instead of sitting at the top. */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="pt-2.5 text-xl font-semibold">
            Các bản sách ({NUMBER.format(book.copies.length)})
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

        <div className="mt-4 hidden overflow-hidden rounded-card border border-hairline md:block">
          <table className="w-full text-left">
            <thead className="bg-paper">
              <tr>
                <th className="px-4 py-3 text-[14px] font-medium text-meta">Bản</th>
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

        <p className="mt-3 text-[14px] text-meta">
          Lịch sử mượn không bao giờ bị xoá, kể cả khi bản sách đã ngừng dùng.
        </p>
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
