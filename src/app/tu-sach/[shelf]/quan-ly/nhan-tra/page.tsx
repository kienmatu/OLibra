import Link from "next/link";
import {
  AlertCircle,
  Archive,
  Check,
  CheckCircle2,
  Clock3,
  FileX,
  HelpCircle,
  PenLine,
  Scissors,
  Search,
} from "lucide-react";
import { ManagerShell } from "@/components/shell/manager-shell";
import { SubmitButton } from "@/components/ui/submit-button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Card } from "@/components/ui/card";
import { BookCover, BookTitle } from "@/components/ui/book";
import { StatusBadge } from "@/components/ui/status-badge";
import { COPY_CONDITIONS, type CopyCondition } from "@/domain/catalogue/policy";
import { messageFor } from "@/domain/kernel/errors";
import { getBorrowRequestQueue } from "@/domain/circulation/queries/get-borrow-request-queue";
import { searchLoansForReturn } from "@/domain/circulation/queries/search-loans-for-return";
import { formatDueDate, formatInstant } from "@/lib/dates";
import { getManagerBadgeCounts } from "@/domain/shelf/queries/get-manager-dashboard";
import { loadPage } from "@/lib/page-data";
import { param, refusalFrom, type SearchParams } from "@/lib/search-params";
import { readShelf } from "@/lib/shelf";
import { cn } from "@/lib/utils";
import { CONDITION_LABELS } from "@/lib/status";
import { receiveReturnAction } from "../actions";

/** U1 §2. See `../cho-muon/page.tsx` for what a cached manager screen leaks. */
export const dynamic = "force-dynamic";

/** SDD §6.6: every number on a screen goes through the locale. */
const NUMBER = new Intl.NumberFormat("vi-VN");

/**
 * One icon per grade, keyed on the `copy_condition` enum rather than on the
 * Vietnamese word, so the picker and the value posted to `ReceiveReturn` cannot
 * come apart. `Record<CopyCondition, …>` makes a seventh grade a compile error
 * here rather than a tile with no icon.
 */
const CONDITION_ICONS: Record<CopyCondition, typeof CheckCircle2> = {
  perfect: CheckCircle2,
  slightly_worn: Clock3,
  worn: Archive,
  torn: Scissors,
  missing_pages: FileX,
  written_on: PenLine,
};

/** BR §16.3: "the common case is two taps", so the picker starts here. */
const DEFAULT_CONDITION: CopyCondition = "perfect";

/**
 * OPS §5's return flow, both of its steps on one screen: find the loan, then
 * assess the condition.
 *
 * **The selected loan is re-found, not carried.** `?muon=` names a loan, and
 * this page resolves it by running `SearchLoansForReturn` again with the same
 * `?q=` and picking the matching row. That is not a workaround for a lost
 * variable — OPS §3.3 defines no `GetLoan`, and inventing one would be a domain
 * change U1 is not making. It also has a property a bespoke lookup would not:
 * the query already filters to `status = 'active'`, so a loan somebody else
 * returned thirty seconds ago simply stops being in the list, and a `?muon=`
 * naming it selects nothing rather than offering a condition picker for a book
 * already back on the shelf. A tampered `?muon=` is refused the same way, by
 * never matching a row this manager's own search returned.
 *
 * The cost is that `?q=` has to travel with `?muon=` everywhere, which is why
 * every link out of here is built from `carrying()` below.
 *
 * **The queued-reader panel is back** (C2). It was absent from U1 until now,
 * and for a good reason: OPS §5 makes holding the returned copy for the next
 * reader a second, explicit decision — "the manager decides, because the next
 * reader may not be standing there" — and offering it needs
 * `GetBorrowRequestQueue` (OPS §3.3), which no slice had shipped.
 * `receiveReturn` has always taken `holdForRequestId`; this screen simply had
 * nothing honest to put in it, so the copy went back to `available` and nothing
 * was decided on the manager's behalf.
 *
 * Now the queue for *this title* is read alongside the loan, and the choice is
 * offered as a radio group whose default is **not** holding. That default is the
 * decision, not a shortcut: §5's whole point is that a queued reader who
 * registered from home might not be at the shelf that Sunday, and only a human
 * knows that. A pre-selected "hold for the first person" would make the common
 * case a choice nobody made.
 *
 * The queue is read at page load and acted on at submit, so a reader who
 * cancelled in between is a `request_not_queued` refusal from `resolveHold`
 * rather than a hold written for somebody who left — which is exactly why that
 * command re-reads rather than trusting the id.
 */
export default async function NhanTraPage({
  params,
  searchParams,
}: {
  params: Promise<{ shelf: string }>;
  /** `?q=`, `?muon=` and `?loi=` — read through `search-params.ts`, never
   *  destructured, because a repeated key arrives as an array. */
  searchParams: Promise<SearchParams>;
}) {
  const { shelf: slug } = await params;
  const search = await searchParams;
  const query = param(search, "q") ?? "";
  const muon = param(search, "muon");

  const { shelf, viewer, counts, loans, queues } = await loadPage(
    slug,
    async (tx, ctx, viewer) => {
      const loans = await searchLoansForReturn(tx, ctx, { q: query });
      const chosen = muon ? loans.find((l) => l.loanId === muon) : undefined;
      return {
        shelf: await readShelf(tx, ctx),
        viewer,
        counts: await getManagerBadgeCounts(tx, ctx),
        loans,
        // Only for the title actually being returned, and only once one has
        // been chosen — OPS §5 step 3 asks this question about *this* book, at
        // this point in the flow. Reading the whole shelf's queue to answer it
        // would put every other title's children on a screen that is about one.
        queues: chosen
          ? await getBorrowRequestQueue(tx, ctx, { bookId: chosen.bookId })
          : [],
      };
    },
  );

  const selected = muon ? (loans.find((l) => l.loanId === muon) ?? null) : null;
  // The people still waiting for this title, in queue order. `pending` only:
  // `receiveReturn`'s `resolveHold` will accept nothing else, because approving
  // a second copy for somebody who already holds one is not a choice this screen
  // is offering.
  const waiting = (queues[0]?.requests ?? []).filter((r) => r.status === "pending");
  const refused = refusalFrom(search);

  const base = `/tu-sach/${slug}/quan-ly`;
  const carrying = (extra: Record<string, string>) =>
    new URLSearchParams({ ...(query ? { q: query } : {}), ...extra }).toString();

  return (
    <ManagerShell
      shelfName={shelf.name}
      shelfSlug={slug}
      active="nhan-tra"
      viewer={viewer}
      counts={counts}
    >
      <h1 className="text-[28px] leading-tight font-semibold">Nhận trả sách</h1>

      {refused ? (
        <p
          role="alert"
          className="mt-5 flex max-w-2xl items-center gap-2 rounded-card border border-brick bg-brick/8 px-4 py-3 text-[15px] text-brick"
        >
          <AlertCircle aria-hidden className="size-5 shrink-0" strokeWidth={1.75} />
          {messageFor(refused)}
        </p>
      ) : null}

      {/* `searchLoansForReturn` searches title, borrower and — the key the
          shelf actually uses — the code printed on the copy in the volunteer's
          hand, folded on both sides so DT-0087, dt 0087 and dt-0087 all find
          it. */}
      <form action={`${base}/nhan-tra`} className="mt-5 max-w-xl">
        <Input
          name="q"
          icon={Search}
          defaultValue={query}
          aria-label="Tìm sách đang mượn"
          className="h-14 text-[17px]"
        />
      </form>

      {loans.length > 0 ? (
        <ul className="mt-6 max-w-2xl space-y-3">
          {loans.map((loan) => {
            const isSelected = loan.loanId === selected?.loanId;
            const card = (
              <div className="flex items-start gap-4">
                <BookCover title={loan.title} className="w-16 text-[1.2rem]" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <BookTitle className="block truncate text-lg leading-snug">
                        {loan.title}
                      </BookTitle>
                    </div>
                    {/* `isOverdue` is `loans_current`'s own derived column
                        (G5), following `ctx.clock` through the `olibra.now`
                        GUC — never recomputed here, which would be a second
                        definition of "overdue" in a second language. */}
                    <StatusBadge status={loan.isOverdue ? "overdue" : "onloan"} />
                  </div>
                  <p className="mt-3 text-[15px]">
                    Người mượn:{" "}
                    <span className="font-medium">{loan.borrowerName}</span>
                  </p>
                  <p className="mt-1 text-[14px] text-meta">
                    Hạn trả {formatDueDate(loan.dueOn)} · Bản {loan.copyCode}
                  </p>
                </div>
              </div>
            );

            if (isSelected) {
              return (
                <li key={loan.loanId}>
                  <Card className="border-terracotta">{card}</Card>
                </li>
              );
            }

            return (
              <li key={loan.loanId}>
                <Link
                  href={`${base}/nhan-tra?${carrying({ muon: loan.loanId })}`}
                  className="block rounded-card border border-hairline bg-surface p-6 hover:bg-paper"
                >
                  {card}
                </Link>
              </li>
            );
          })}
        </ul>
      ) : query.trim() ? (
        <p className="mt-6 max-w-2xl text-[15px] text-meta">
          Không tìm thấy lượt mượn nào
        </p>
      ) : null}

      {selected ? (
        <form
          action={receiveReturnAction}
          // `group`, for the disclosure below. See its own comment.
          className="group mt-8 max-w-2xl"
        >
          <input type="hidden" name="tu-sach" value={slug} />
          <input type="hidden" name="muon" value={selected.loanId} />
          {/* Carried so a refusal comes back to this same search and this same
              loan rather than to an empty box. */}
          <input type="hidden" name="q" value={query} />

          <h2 className="text-xl font-semibold">Tình trạng sách khi trả</h2>

          <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
            {COPY_CONDITIONS.map((condition) => {
              const Icon = CONDITION_ICONS[condition];
              const id = `tinh-trang-${condition}`;
              return (
                // A radio inside its own label, rather than a `<button>`: the
                // grade has to survive to the POST, and this page ships no
                // client JavaScript to hold it. `htmlFor` also brings the
                // pointer cursor with it — globals.css sets that for
                // `label[for]`, per DESIGN.md §5.
                <label
                  key={condition}
                  htmlFor={id}
                  className={cn(
                    "relative flex min-h-24 flex-col items-center justify-center gap-2 rounded-card px-2 py-3 text-center text-[13px] font-medium",
                    "border border-hairline bg-surface text-ink",
                    "has-checked:border-2 has-checked:border-terracotta has-checked:bg-terracotta/10 has-checked:text-terracotta-ink",
                  )}
                >
                  <input
                    type="radio"
                    id={id}
                    name="tinh-trang"
                    value={condition}
                    defaultChecked={condition === DEFAULT_CONDITION}
                    className="peer sr-only"
                  />
                  {/* BR §17.4:648, restored: "Selection is shown by a filled
                      background **and a check**, not by colour alone." `main`
                      drew this; the CSS-only radio rewrite kept the fill and
                      the border weight and dropped the check, which leaves
                      colour doing the work on its own for anyone who cannot
                      separate terracotta from paper.

                      `peer-checked:flex` beats the `hidden` beside it on
                      variant order, so this still needs no client JavaScript —
                      the input has to precede the badge in the DOM for `peer`
                      to reach it, which it does. */}
                  <span
                    aria-hidden
                    className="absolute top-1.5 right-1.5 hidden size-4 items-center justify-center rounded-full bg-terracotta text-white peer-checked:flex"
                  >
                    <Check className="size-2.5" strokeWidth={3} />
                  </span>
                  <Icon aria-hidden className="size-6" strokeWidth={1.75} />
                  {CONDITION_LABELS[condition]}
                </label>
              );
            })}
          </div>

          {/* BR §16.3:548 asks for "Ghi chú và ảnh" here and this is only the
              note. **The photo is deferred, not forgotten** — U1 §6.1 records
              what wiring it actually costs: `receiveReturn` already takes a
              `photo`, and B5 shipped the object store, but nothing in the
              application constructs one, the running app has never been given
              the seven `S3_*` variables, and a size limit, a content-type
              list, what a rejected upload says and what a failed `put` does to
              the rest of the return are four policies that exist nowhere. It
              belongs with B2b's avatar upload, which needs the same first
              three. `main` did not have it either: it drew a dashed box
              reading "Ghi chú và ảnh · hiện khi chọn tình trạng xấu hơn".

              BR §16.3: the note only appears once a worse grade is chosen, so
              the common case stays two taps. Done in CSS rather than in
              JavaScript — exactly one radio is ever checked, so "Nguyên vẹn is
              not the one" is the same condition as "something worse is".

              Written as hide-on-perfect rather than show-on-worse on purpose:
              if this selector ever stops matching, the field is *visible* when
              it need not be, instead of invisible when a volunteer needs it. */}
          <div className="mt-5 group-has-[#tinh-trang-perfect:checked]:hidden">
            <Field label="Ghi chú" htmlFor="ghi-chu">
              <Textarea id="ghi-chu" name="ghi-chu" rows={3} />
            </Field>
          </div>

          {waiting.length > 0 ? (
            <fieldset className="mt-6 rounded-card border border-hairline p-4">
              {/* BR §16.3's own wording for this moment, and the reason the
                  panel exists: "the confirmation says so immediately and offers
                  to approve the first person in the queue." */}
              <legend className="px-1 text-[15px] font-semibold">
                {NUMBER.format(waiting.length)} bạn đọc đang chờ cuốn này
              </legend>
              <div className="space-y-2">
                {/* First, and checked: not holding is the default, because
                    OPS §5 says "nothing happens automatically: the manager
                    decides, because the next reader may not be standing
                    there." The empty value posts as no choice at all. */}
                <label
                  htmlFor="giu-cho-khong"
                  className="flex min-h-11 items-center gap-2.5 text-[16px]"
                >
                  <input
                    type="radio"
                    id="giu-cho-khong"
                    name="giu-cho"
                    value=""
                    defaultChecked
                    className="size-5 accent-terracotta"
                  />
                  Không giữ chỗ, trả về kệ
                </label>
                {waiting.map((entry) => (
                  <label
                    key={entry.requestId}
                    htmlFor={`giu-cho-${entry.requestId}`}
                    className="flex min-h-11 items-center gap-2.5 text-[16px]"
                  >
                    <input
                      type="radio"
                      id={`giu-cho-${entry.requestId}`}
                      name="giu-cho"
                      value={entry.requestId}
                      className="size-5 accent-terracotta"
                    />
                    <span>
                      Giữ chỗ cho {entry.readerName}
                      <span className="text-meta">
                        {" "}
                        · đăng ký {formatInstant(entry.requestedAt)}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              <p className="mt-3 text-[14px] text-meta">
                Hệ thống không tự động giữ chỗ. Quản lý quyết định từng trường hợp.
              </p>
            </fieldset>
          ) : null}

          {/* The state the copy ends in depends on the choice above, so this
              sentence names the ordinary one and the panel names the other.
              Writing it as a single claim would have been wrong for whichever
              branch the manager took. */}
          <p className="mt-4 text-[15px] text-ink">
            Sau khi xác nhận, bản {selected.copyCode} sẽ chuyển sang trạng thái{" "}
            <StatusBadge status="available" size="sm" className="align-middle" />
            {waiting.length > 0 ? ", hoặc được giữ chỗ nếu bạn chọn ở trên." : null}
          </p>

          <SubmitButton className="mt-6 w-full">Xác nhận nhận trả</SubmitButton>

          {/* Not a seventh condition — condition is how damaged a book is, loss
              is a state that removes it from circulation entirely. Per OPS §4.2
              this branch calls `ReportCopyLost`, not `ReceiveReturn`, so it
              reads as a link out of this form rather than another tile in the
              row above. A `<Link>` inside a `<form>` submits nothing. */}
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-5">
            <p className="text-[14px] text-meta">
              Không đánh giá được tình trạng vì bạn đọc báo đã làm mất sách?
            </p>
            <Link
              href={`${base}/nhan-tra/bao-mat?${carrying({ muon: selected.loanId })}`}
              className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-control px-1 text-[14px] font-semibold text-lost hover:underline"
            >
              <HelpCircle aria-hidden className="size-4" strokeWidth={1.75} />
              Bạn đọc báo làm mất
            </Link>
          </div>
        </form>
      ) : null}
    </ManagerShell>
  );
}
