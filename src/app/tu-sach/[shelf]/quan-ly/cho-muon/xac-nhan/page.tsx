import Link from "next/link";
import { AlertCircle, Calendar, Check } from "lucide-react";
import { ManagerShell } from "@/components/shell/manager-shell";
import { SubmitButton } from "@/components/ui/submit-button";
import { BookCover, BookTitle } from "@/components/ui/book";
import { StatusBadge } from "@/components/ui/status-badge";
import { StepIndicator } from "@/components/ui/step-indicator";
import { requireManager } from "@/domain/catalogue/policy";
import { dueDateFor, memberMayBorrow } from "@/domain/circulation/policy";
import type { Block } from "@/domain/kernel/block";
import { type ErrorCode, messageFor } from "@/domain/kernel/errors";
import { bookFromSlug, chooseCopyToLend, readerFromParam } from "@/lib/lending";
import { formatDate, formatDueDate } from "@/lib/dates";
import { getManagerBadgeCounts } from "@/domain/shelf/queries/get-manager-dashboard";
import { loadPage } from "@/lib/page-data";
import { param, refusalFrom, type SearchParams } from "@/lib/search-params";
import { readShelf } from "@/lib/shelf";
import { lendCopyAction } from "../../actions";

/** U1 §2. See `../page.tsx` for what a cached manager screen actually leaks. */
export const dynamic = "force-dynamic";

/** SDD §6.6, the same formatter step 1 uses for its copy counts. */
const NUMBER = new Intl.NumberFormat("vi-VN");

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-hairline px-6 py-4 last:border-b-0">
      <dt className="text-[14px] text-meta">{label}</dt>
      <dd className="mt-2">{children}</dd>
    </div>
  );
}

/**
 * Step 3 of BR §16.3's quick-lend: everything chosen, nothing yet written.
 *
 * **Why this page re-reads everything.** Steps 1 and 2 already looked the book
 * and the reader up, and the URL carries both. It re-reads them anyway, through
 * the same manager-gated queries, because a URL is not evidence: `?sach=` and
 * `?nguoi-doc=` are two strings a volunteer could have edited, a colleague
 * could have sent them, or a bookmark could have preserved from last Sunday.
 * What the re-read buys is that this screen describes rows that exist *now* —
 * and `lendCopy` then checks the same facts a third time inside the transaction
 * that writes (OPS §5), because even this read is seconds old by the time
 * anybody taps.
 *
 * **Why the blocking check happens here at all.** BR §16.3 wants blocking
 * conditions to "surface as a clear message *before* the confirm step, never as
 * an error afterwards". The predicates are the domain's own — `copyLendable`
 * via `chooseCopyToLend`, and `memberMayBorrow` called directly, the two
 * `lendCopy` applies in the order OPS §5 fixes — so the button disables for
 * exactly the reasons the command would refuse for, and says so in exactly the
 * command's own sentence.
 *
 * **`requireManager` is called, not restated.** This is the one page in the
 * seam whose reads are all conditional: with no `?sach=` and no `?nguoi-doc=`
 * there is no query left to run, and a page that ran none would render its
 * chrome to a guest — confirming both that the route exists and that this shelf
 * has a manager screen, which U1 §3.4 says a 404 must not do. So the domain's
 * single definition of the rule is *invoked* here (the same import `lendCopy`
 * and `searchLoansForReturn` take), and `loadPage` turns its
 * `RuleViolated("not_permitted")` into that 404. It is not a second definition,
 * and it is not the guarantee either: `lendCopy` runs it again regardless of
 * what this page decided to draw.
 */
export default async function ChoMuonXacNhanPage({
  params,
  searchParams,
}: {
  params: Promise<{ shelf: string }>;
  /**
   * `?sach=`, `?nguoi-doc=` and `?loi=`, read through `param` and
   * `refusalFrom` rather than destructured.
   *
   * The shape this used to declare — three optional `string`s, with `loi`
   * spelled through `ACTION_ERROR_PARAM` — was a claim about the input rather
   * than a description of it: Next delivers `string[]` for a repeated key, and
   * a type that says otherwise only moves the failure from the compiler to a
   * volunteer's screen. `src/lib/search-params.ts` carries the reasoning.
   */
  searchParams: Promise<SearchParams>;
}) {
  const { shelf: slug } = await params;
  const query = await searchParams;
  const sach = param(query, "sach");
  const nguoiDoc = param(query, "nguoi-doc");

  const { shelf, viewer, counts, book, copy, copyBlock, reader, lentOn, dueOn } =
    await loadPage(slug, async (tx, ctx, viewer) => {
      requireManager(ctx);

      const shelf = await readShelf(tx, ctx);
      const book = await bookFromSlug(tx, ctx, sach);
      const chosen = book ? chooseCopyToLend(book) : null;

      return {
        shelf,
        viewer,
        counts: await getManagerBadgeCounts(tx, ctx),
        book,
        copy: chosen?.copy ?? null,
        copyBlock: chosen?.block ?? null,
        reader: await readerFromParam(tx, ctx, nguoiDoc),
        // Both dates come from `ctx.clock` through the domain's own
        // `dueDateFor`, never from `new Date()` on the page: BR §5.4 counts the
        // loan in `Asia/Ho_Chi_Minh` because `due_on` is a date, and a lend
        // recorded at half past eleven at night must not be a day short.
        // `lendCopy` computes the same value from the same clock and the same
        // `loan_days`, so this is a preview rather than a second opinion.
        lentOn: ctx.clock.today(),
        dueOn: dueDateFor(ctx.clock, shelf.loanDays),
      };
    });

  const base = `/tu-sach/${slug}/quan-ly`;
  const backToReaders = `${base}/cho-muon/nguoi-doc?${new URLSearchParams(
    sach ? { sach } : {},
  ).toString()}`;

  // The reader half of BR §16.3's check, from the predicate `lendCopy` applies
  // — INV-4 then INV-5, in that order, so a suspended reader who is also at the
  // limit hears the sentence they can act on.
  const readerBlock: Block | null = reader
    ? memberMayBorrow(
        { status: reader.status, activeLoans: reader.holdingCount },
        shelf.maxConcurrentLoans,
      )
    : null;

  // OPS §5's order: the copy-side refusal is the one a manager hears first,
  // "because a manager who searched for a book that's already gone needs to
  // know that immediately, not after they've also picked a reader."
  const blocking: ErrorCode | null = !book
    ? "book_not_found"
    : copyBlock?.blocked
      ? copyBlock.reason
      : !reader
        ? "membership_not_found"
        : readerBlock?.blocked
          ? readerBlock.reason
          : null;

  // What `lendCopyAction` sent back, if the command refused after all. Distinct
  // from `blocking` above and shown even when that is null, because the whole
  // point of the command re-checking is that it can disagree with a read taken
  // seconds earlier.
  const refused = refusalFrom(query);

  return (
    <ManagerShell
      shelfName={shelf.name}
      shelfSlug={slug}
      active="cho-muon"
      viewer={viewer}
      counts={counts}
    >
      {/* The step actually reached, not the step this route is named after.
          Fixed at 3, the indicator drew ticks over "Tìm sách" and "Chọn người
          đọc" on a URL where neither had resolved — telling a volunteer who
          arrived on a stale link that they had already chosen a book and a
          reader, on the one screen whose whole job is to show them what they
          chose. A tick is a claim about the past, and it has to be true. */}
      <StepIndicator
        steps={["Tìm sách", "Chọn người đọc", "Xác nhận"]}
        current={!book ? 1 : !reader ? 2 : 3}
      />

      <h1 className="mt-6 text-[28px] leading-tight font-semibold">
        Xác nhận cho mượn
      </h1>

      {refused ? (
        <p
          role="alert"
          className="mt-5 flex max-w-xl items-center gap-2 rounded-card border border-brick bg-brick/8 px-4 py-3 text-[15px] text-brick"
        >
          <AlertCircle aria-hidden className="size-5 shrink-0" strokeWidth={1.75} />
          {messageFor(refused)}
        </p>
      ) : null}

      <dl className="mt-6 max-w-xl rounded-card border border-hairline bg-surface">
        <Row label="Sách">
          {book ? (
            <div className="flex items-center gap-3">
              <BookCover
                title={book.book.title}
                coverUrl={book.book.coverUrl}
                className="w-12 text-[1rem]"
              />
              <div className="min-w-0">
                <BookTitle className="block truncate text-base leading-snug">
                  {book.book.title}
                </BookTitle>
                <p className="truncate text-[14px] text-meta">{book.book.author}</p>
              </div>
            </div>
          ) : (
            <p className="text-[15px] text-meta">{messageFor("book_not_found")}</p>
          )}
        </Row>
        <Row label="Mã bản sách">
          {copy ? (
            <span className="inline-flex rounded-control bg-terracotta/10 px-2.5 py-1 text-[14px] font-medium text-terracotta-ink">
              {copy.code}
            </span>
          ) : (
            // No shelf-mark rather than an empty pill: there is no copy to hand
            // over, and the blocking message below says which of the two reasons
            // BR §7.1 distinguishes applies.
            <p className="text-[15px] text-meta">
              {messageFor(copyBlock?.blocked ? copyBlock.reason : "copy_not_found")}
            </p>
          )}
        </Row>
        <Row label="Người đọc">
          {reader ? (
            <>
              <p className="text-[16px] font-medium">{reader.fullName}</p>
              <p className="mt-0.5 text-[14px] text-meta">
                {reader.parishLine || "Chưa có"}
              </p>
            </>
          ) : (
            <p className="text-[15px] text-meta">
              {messageFor("membership_not_found")}
            </p>
          )}
        </Row>
        <Row label="Ngày mượn">
          <p className="text-[16px]">{formatDate(lentOn)}</p>
        </Row>
      </dl>

      <div className="mt-6 max-w-xl rounded-card border border-hairline bg-paper p-6">
        <p className="flex items-center gap-2 text-[14px] text-meta">
          <Calendar aria-hidden className="size-[18px]" strokeWidth={1.75} />
          Hạn trả
        </p>
        <p className="mt-1.5 text-[26px] leading-tight font-semibold">
          {formatDueDate(dueOn)}
        </p>
        <p className="mt-1 text-[15px] text-meta">
          {NUMBER.format(shelf.loanDays)} ngày
        </p>
      </div>

      {blocking ? (
        // BR §16.3's "clear message before the confirm step". The button below
        // is disabled by the same condition that produced this sentence, so the
        // screen and the tap cannot disagree with each other — and `lendCopy`
        // would refuse with this very code if either were bypassed.
        <p
          role="alert"
          className="mt-6 flex max-w-xl items-center gap-2 text-[15px] text-brick"
        >
          <AlertCircle aria-hidden className="size-5 shrink-0" strokeWidth={1.75} />
          {messageFor(blocking)}
        </p>
      ) : (
        <p className="mt-6 max-w-xl text-[15px] text-ink">
          Sau khi xác nhận, bản {copy?.code} sẽ chuyển sang trạng thái{" "}
          <StatusBadge status="onloan" size="sm" className="align-middle" />
        </p>
      )}

      <form action={lendCopyAction} className="mt-8 max-w-xl">
        {/* The shelf the action resolves its `TenantContext` from. A tampered
            value only picks a different shelf to be refused on: `contextFor`
            looks up the caller's membership of *that* shelf, and
            `requireManager` inside `lendCopy` decides the rest. */}
        <input type="hidden" name="tu-sach" value={slug} />
        <input type="hidden" name="ban" value={copy?.copyId ?? ""} />
        <input type="hidden" name="nguoi-doc" value={reader?.membershipId ?? ""} />
        {/* Carried only so a refusal can come back to this same screen with the
            book still chosen. */}
        <input type="hidden" name="sach" value={sach ?? ""} />
        {/* QA remediation Task 16: the shelf-mark this screen already shows in
            the "Mã bản sách" row above, carried so `lendCopyAction` can name
            it in the confirmation notice on the dashboard it redirects to
            without a second lookup. A shelf-mark, not a person's name — see
            that action's own docstring for the line drawn here. */}
        <input type="hidden" name="ma-ban" value={copy?.code ?? ""} />
        {/* `disabled` composes with the pending state rather than being
            replaced by it: a rule that already closed this button must not
            reopen when a submit settles. */}
        <SubmitButton
          icon={<Check aria-hidden className="size-5" strokeWidth={1.75} />}
          className="w-full"
          disabled={blocking !== null}
        >
          Xác nhận cho mượn
        </SubmitButton>
      </form>

      <div className="mt-3 max-w-xl text-center">
        <Link
          href={backToReaders}
          className="inline-flex min-h-11 items-center text-[14px] text-meta hover:text-ink"
        >
          Quay lại chọn người đọc
        </Link>
      </div>
    </ManagerShell>
  );
}
