import { AlertCircle, Bookmark, Check, Clock3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { BookCover, BookTitle } from "@/components/ui/book";
import { Card, PageHeading } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { ManagerShell } from "@/components/shell/manager-shell";
import { messageFor } from "@/domain/kernel/errors";
import {
  getBorrowRequestQueue,
  type BookQueue,
  type QueuedRequestRow,
} from "@/domain/circulation/queries/get-borrow-request-queue";
import { getManagerBadgeCounts } from "@/domain/shelf/queries/get-manager-dashboard";
import { formatInstant } from "@/lib/dates";
import { loadPage } from "@/lib/page-data";
import { refusalFrom, type SearchParams } from "@/lib/search-params";
import { readShelf } from "@/lib/shelf";
import { cn } from "@/lib/utils";
import {
  approveBorrowRequestAction,
  handoverRequestAction,
  rejectBorrowRequestAction,
} from "../actions";

/** U1 §2. See `../cho-muon/page.tsx` for what a cached manager screen leaks. */
export const dynamic = "force-dynamic";

export const metadata = { title: "Yêu cầu mượn — Quản lý tủ sách OLibra" };

/** SDD §6.6: every number on a screen goes through the locale. */
const NUMBER = new Intl.NumberFormat("vi-VN");

/**
 * One reader's place in one title's queue.
 *
 * The initial is the **last** word of a Vietnamese name — the given name — the
 * same rule `manager-shell.tsx` and `public-header.tsx` both carry, and the same
 * one the fixture version of this page got right by writing the letters out by
 * hand ("G", "T", "M", "A") beside names that no longer match them.
 */
function QueueRow({
  entry,
  children,
  note,
}: {
  entry: QueuedRequestRow;
  children: React.ReactNode;
  note: React.ReactNode;
}) {
  const initial = entry.readerName.split(" ").at(-1)?.charAt(0) ?? "";
  return (
    <li className="py-4">
      <div className="flex flex-wrap items-center gap-4">
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-paper text-[17px] font-semibold text-ink"
        >
          {NUMBER.format(entry.position)}
        </span>
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-terracotta/10 text-[15px] font-semibold text-terracotta-ink"
        >
          {initial}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[16px] font-medium">{entry.readerName}</p>
          {/* `requested_at`, through the locale — a `timestamptz`, so
              `formatInstant` renders it in the shelf's own timezone. The
              fixture version wrote "Đăng ký 02/08", a date invented for a row
              that did not exist. The parish line is the shelf's own wording,
              built by `describeSelection` inside the query; empty is a
              permanent, legitimate state (BR §5.6). */}
          <p className="text-[14px] text-meta">
            Đăng ký {formatInstant(entry.requestedAt)}
            {entry.parishLine ? ` · ${entry.parishLine}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">{children}</div>
      </div>
      <div className="mt-2 pl-14 text-[14px] text-meta">{note}</div>
    </li>
  );
}

/**
 * ***Bỏ qua* is gone, and this note is what remains of it.**
 *
 * OPS §4.2 called `SkipRequest` "the least well-specified command in the
 * catalogue": the queue screen showed *Bỏ qua* and *Từ chối* side by side and
 * neither BR §7.2 nor the UI said what different end state skip produced. The
 * three readings — record only, back of the queue, suppressed for one turn —
 * are materially different to a child who asked first and keeps being passed
 * over, and two of the three need an ordering column that BR §7.2's "no
 * separate reservation concept" argues against.
 *
 * **The product owner answered it by removing the button** (2026-08-09).
 * *Từ chối*, which takes a reason the reader sees, is the only decision a
 * manager makes about a queued request now. That is one concept for a
 * volunteer to hold rather than two that differ in a way nobody could state.
 *
 * Recorded here rather than only in the plan because this file is where
 * somebody will wonder where the button went.
 */

/**
 * What the held row says beneath itself: which copy is put aside, until when,
 * and — once the clock has passed it — that the hold has lapsed.
 *
 * **The expiry is `holdExpired`, never a comparison written here.** BR §8 makes
 * it derived on read and the query derives it against `olibra_now()`, which
 * follows the transaction's clock; a `new Date()` on this page would be a second
 * definition of "expired" in a second language, and one of the two would be the
 * server's wall clock rather than the shelf's.
 *
 * The fixture version wrote "Đang giữ chỗ cho bạn này · hết hạn giữ 09/08" with
 * both halves invented. The words are its own; the date is now the row's.
 */
function HoldNote({ entry }: { entry: QueuedRequestRow }) {
  const until = entry.holdExpiresAt ? formatInstant(entry.holdExpiresAt) : null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-control px-2.5 py-1.5 text-[15px] font-medium",
        entry.holdExpired ? "bg-overdue/10 text-overdue" : "bg-held/10 text-held",
      )}
    >
      {entry.holdExpired ? (
        <Clock3 aria-hidden className="size-[18px] shrink-0" strokeWidth={1.75} />
      ) : (
        <Bookmark aria-hidden className="size-[18px] shrink-0" strokeWidth={1.75} />
      )}
      {entry.holdExpired
        ? `Thời gian giữ chỗ đã hết${until ? ` lúc ${until}` : ""}`
        : `Đang giữ chỗ cho bạn này${until ? ` · hết hạn giữ ${until}` : ""}`}
      {entry.copyCode ? ` · bản ${entry.copyCode}` : ""}
    </span>
  );
}

/** The reject disclosure, one per row, with its optional reason. */
function RejectForm({ slug, requestId }: { slug: string; requestId: string }) {
  return (
    <details className="min-w-0">
      {/* `buttonClasses` would be the tidy spelling, but `<summary>` needs
          `cursor-pointer` explicitly — it is not a `<button>`, so DESIGN.md §5's
          global rule for buttons does not reach it. The same construction
          `dang-ky-cho-duyet/page.tsx` uses for its own reject disclosure. */}
      <summary className="inline-flex h-11 cursor-pointer list-none items-center justify-center gap-2 rounded-control border border-brick px-4 text-[15px] font-semibold text-brick transition-colors hover:bg-brick/8 [&::-webkit-details-marker]:hidden">
        Từ chối
      </summary>
      <form
        action={rejectBorrowRequestAction}
        className="mt-3 w-full max-w-md space-y-3"
      >
        <input type="hidden" name="tu-sach" value={slug} />
        <input type="hidden" name="yeu-cau" value={requestId} />
        {/* **Not `required`**, unlike the registration and profile-change
            rejections. Q2: those two screens say "Từ chối cần ghi lý do" and
            their commands enforce it; this button carries no such statement and
            OPS §4.2 lists no `reason_required` for `RejectBorrowRequest`. The
            hint says the reason is optional rather than leaving a volunteer to
            discover it by submitting an empty box. */}
        <Field
          label="Lý do từ chối"
          htmlFor={`ly-do-${requestId}`}
          hint="Không bắt buộc."
        >
          <Input id={`ly-do-${requestId}`} name="ly-do" />
        </Field>
        <SubmitButton variant="danger" size="md">
          Xác nhận từ chối
        </SubmitButton>
      </form>
    </details>
  );
}

/** *Duyệt & giữ chỗ*, with the copy the manager is putting aside. */
function ApproveForm({
  slug,
  queue,
  requestId,
}: {
  slug: string;
  queue: BookQueue;
  requestId: string;
}) {
  const free = queue.freeCopies;
  return (
    <form action={approveBorrowRequestAction} className="flex items-end gap-2">
      <input type="hidden" name="tu-sach" value={slug} />
      <input type="hidden" name="yeu-cau" value={requestId} />
      {/* One copy: a hidden field, because a select with one option is a
          decision the volunteer does not have. Several: a select, because BR
          §16.3 gives the manager the choice and a shelf's copies are in
          different conditions. None: an empty hidden field and a disabled
          button, so the refusal arrives before the confirm step rather than
          after it. */}
      {free.length === 1 ? (
        <input type="hidden" name="ban" value={free[0].copyId} />
      ) : free.length === 0 ? (
        <input type="hidden" name="ban" value="" />
      ) : (
        <label className="text-[14px] text-meta">
          Bản sách
          <Select name="ban" className="mt-1 h-11 text-[15px]">
            {free.map((copy) => (
              <option key={copy.copyId} value={copy.copyId}>
                {copy.code}
              </option>
            ))}
          </Select>
        </label>
      )}
      {/* Outline, not solid: the one dominant action on this triage page is
          confirming a handover whose hold is already running. */}
      <SubmitButton
        variant="outline"
        size="md"
        disabled={free.length === 0}
        icon={<Bookmark aria-hidden className="size-5" strokeWidth={1.75} />}
      >
        Duyệt &amp; giữ chỗ
      </SubmitButton>
    </form>
  );
}

/**
 * BR §16.3's borrow-request queue, and BR §7.2's ordering: "the queue is the set
 * of pending requests for that title, ordered by request time. There is no
 * separate reservation concept."
 *
 * **Every row here was queued by somebody.** The fixture version rendered four
 * invented children against two real books, with four hand-written registration
 * dates, a hand-written hold expiry ("hết hạn giữ 09/08") and the subtitle
 * "2 cuốn có người đang chờ" — a screen a volunteer could act on and that
 * described nobody. `getBorrowRequestQueue` returns the real queues, grouped by
 * title, and `waiting` is the length of the list beneath it rather than a
 * number written above it.
 *
 * **The approved row is not a fourth queue position, it is the top of the
 * card.** BR §7.2's `approved` means a copy is on the shelf with that child's
 * name on it, and OPS §4.2's `HandoverRequest` is the only command that ends it
 * well. So that row carries the one solid button on the page, its hold expiry,
 * and — when the clock has passed it — the fact that the hold has lapsed. It
 * stays on the screen after lapsing, because the copy is still in `held` with
 * nobody coming for it and a manager has to do something about that; hiding the
 * row would hide the only thing on this page that is going wrong.
 *
 * **Nothing on this page happens by itself.** The closing line is the fixture
 * version's own and is now true of the code beneath it: BR §16.3's "nothing
 * happens automatically: the manager decides, because the next reader may not be
 * standing there."
 */
export default async function BorrowRequestsPage({
  params,
  searchParams,
}: {
  params: Promise<{ shelf: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { shelf: slug } = await params;
  const search = await searchParams;
  const refused = refusalFrom(search);

  const { shelf, viewer, counts, queues } = await loadPage(
    slug,
    async (tx, ctx, viewer) => ({
      shelf: await readShelf(tx, ctx),
      viewer,
      counts: await getManagerBadgeCounts(tx, ctx),
      queues: await getBorrowRequestQueue(tx, ctx),
    }),
  );

  const waiting = queues.reduce((n, q) => n + q.waiting, 0);

  return (
    <ManagerShell
      shelfName={shelf.name}
      shelfSlug={slug}
      active="yeu-cau-muon"
      viewer={viewer}
      counts={counts}
    >
      <div className="space-y-8">
        <PageHeading
          title="Yêu cầu mượn"
          subtitle={
            queues.length === 0
              ? "Xếp theo thứ tự đăng ký."
              : `${NUMBER.format(queues.length)} cuốn có người đang chờ · Xếp theo thứ tự đăng ký.`
          }
        />

        {refused ? (
          <p
            role="alert"
            className="flex max-w-2xl items-center gap-2 rounded-card border border-brick bg-brick/8 px-4 py-3 text-[15px] text-brick"
          >
            <AlertCircle
              aria-hidden
              className="size-5 shrink-0"
              strokeWidth={1.75}
            />
            {messageFor(refused)}
          </p>
        ) : null}

        {queues.length === 0 ? (
          <p className="text-[15px] text-meta">
            Hiện không có bạn đọc nào đang chờ mượn sách.
          </p>
        ) : null}

        {queues.map((queue) => (
          <Card key={queue.bookId} className="space-y-1">
            <div className="flex flex-wrap items-center gap-4">
              <BookCover
                title={queue.title}
                coverUrl={queue.coverUrl}
                className="w-14 shrink-0"
              />
              <div className="min-w-0 flex-1">
                <BookTitle as="p" className="text-[19px] leading-snug">
                  {queue.title}
                </BookTitle>
                <p className="text-[14px] text-meta">{queue.author}</p>
              </div>
              <p className="text-[15px] text-meta">
                {NUMBER.format(queue.waiting)} người đang chờ
              </p>
            </div>

            <ul className="mt-2 divide-y divide-hairline border-t border-hairline">
              {queue.requests.map((entry, index) =>
                entry.status === "approved" ? (
                  <QueueRow
                    key={entry.requestId}
                    entry={entry}
                    note={<HoldNote entry={entry} />}
                  >
                    <form action={handoverRequestAction}>
                      <input type="hidden" name="tu-sach" value={slug} />
                      <input type="hidden" name="yeu-cau" value={entry.requestId} />
                      {/* The one solid terracotta on this screen. A lapsed hold
                          keeps its button rather than losing it: the command
                          refuses with "Thời gian giữ chỗ đã hết. Bạn đọc cần
                          đăng ký lại.", which tells the volunteer what to do,
                          where a missing button would tell them nothing. */}
                      <SubmitButton
                        size="md"
                        icon={
                          <Check
                            aria-hidden
                            className="size-5"
                            strokeWidth={1.75}
                          />
                        }
                      >
                        Xác nhận trao sách
                      </SubmitButton>
                    </form>
                  </QueueRow>
                ) : (
                  <QueueRow
                    key={entry.requestId}
                    entry={entry}
                    note={
                      // `index === 0` and not `position === 1`: what makes a
                      // request approvable is that nobody ahead of it is still
                      // being decided, and after an approval the held row is
                      // position 1 — so the first *pending* row is the one whose
                      // turn it is. The sentence is the fixture version's own.
                      index === 0
                        ? `Giữ chỗ ${NUMBER.format(shelf.holdDays)} ngày kể từ khi duyệt.`
                        : "Chỉ duyệt được khi tới lượt."
                    }
                  >
                    {index === 0 ? (
                      <ApproveForm
                        slug={slug}
                        queue={queue}
                        requestId={entry.requestId}
                      />
                    ) : null}
                    <RejectForm slug={slug} requestId={entry.requestId} />
                  </QueueRow>
                ),
              )}
            </ul>

            {queue.freeCopies.length === 0 ? (
              <p className="pt-2 text-[14px] text-meta">
                Chưa có bản nào rảnh để giữ chỗ.
              </p>
            ) : null}
          </Card>
        ))}

        {waiting > 0 ? (
          <p className="text-[14px] text-meta">
            Hệ thống không tự động giữ chỗ. Quản lý quyết định từng trường hợp.
          </p>
        ) : null}
      </div>
    </ManagerShell>
  );
}
