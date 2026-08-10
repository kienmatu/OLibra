import Link from "next/link";
import { AlertCircle, HelpCircle } from "lucide-react";
import { ManagerShell } from "@/components/shell/manager-shell";
import { SubmitButton } from "@/components/ui/submit-button";
import { BookCover, BookTitle } from "@/components/ui/book";
import { StatusBadge } from "@/components/ui/status-badge";
import { Field, Textarea } from "@/components/ui/field";
import { messageFor } from "@/domain/kernel/errors";
import { searchLoansForReturn } from "@/domain/circulation/queries/search-loans-for-return";
import { formatDueDate } from "@/lib/dates";
import { getManagerBadgeCounts } from "@/domain/shelf/queries/get-manager-dashboard";
import { loadPage } from "@/lib/page-data";
import { param, refusalFrom, type SearchParams } from "@/lib/search-params";
import { readShelf } from "@/lib/shelf";
import { reportCopyLostAction } from "../../actions";

/** U1 §2. See `../../cho-muon/page.tsx` for what a cached manager screen leaks. */
export const dynamic = "force-dynamic";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-hairline px-6 py-4 last:border-b-0">
      <dt className="text-[14px] text-meta">{label}</dt>
      <dd className="mt-2">{children}</dd>
    </div>
  );
}

/**
 * The "Bạn đọc báo làm mất" branch of step 2 of the return flow.
 *
 * **It calls `ReportCopyLost`, not `ReceiveReturn`.** OPS §4.2 is explicit
 * that this is "a second entry point out of this same screen, not a variant of
 * this command": choosing it "does not call `ReceiveReturn` at all — it
 * switches to `ReportCopyLost` with the loan's copy already identified, and the
 * loan closes as `lost` rather than `returned`." That is why the form below
 * posts a `copyId` and no condition: loss is a state that removes a copy from
 * circulation, not a seventh grade of damage, and `reportCopyLost` closes the
 * active loan itself (`loan.status = 'lost'`, its own audit entry).
 *
 * **The loan is re-found the same way `../page.tsx` finds it** — by running
 * `SearchLoansForReturn` again with the `?q=` that travelled here, and picking
 * the row `?muon=` names. See that page's docstring for why, and for what a
 * tampered parameter buys somebody (nothing: the search only ever returns this
 * manager's own shelf's active loans).
 */
export default async function NhanTraBaoMatPage({
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

  const { shelf, viewer, counts, loans } = await loadPage(
    slug,
    async (tx, ctx, viewer) => ({
      shelf: await readShelf(tx, ctx),
      viewer,
      counts: await getManagerBadgeCounts(tx, ctx),
      // Runs even with no `?q=`, and that is load-bearing rather than wasteful:
      // `searchLoansForReturn` opens with `requireManager`, so this is also what
      // makes a reader who typed this URL get U1 §3.4's 404 instead of the page.
      loans: await searchLoansForReturn(tx, ctx, { q: query }),
    }),
  );

  const loan = muon ? (loans.find((l) => l.loanId === muon) ?? null) : null;
  const refused = refusalFrom(search);

  const base = `/tu-sach/${slug}/quan-ly`;
  const backToReturn = `${base}/nhan-tra?${new URLSearchParams({
    ...(query ? { q: query } : {}),
    ...(muon ? { muon } : {}),
  }).toString()}`;

  return (
    <ManagerShell
      shelfName={shelf.name}
      shelfSlug={slug}
      active="nhan-tra"
      viewer={viewer}
      counts={counts}
    >
      <p className="flex items-center gap-2 text-[14px] font-semibold text-lost">
        <HelpCircle aria-hidden className="size-[18px]" strokeWidth={1.75} />
        Báo làm mất, không phải nhận trả
      </p>

      <h1 className="mt-2 text-[28px] leading-tight font-semibold">
        Xác nhận báo mất
      </h1>
      <p className="mt-2 max-w-xl text-[15px] text-ink/85">
        Khoản mượn này sẽ đóng lại là{" "}
        <strong className="font-semibold">Đã mất</strong>, không phải Đã trả. Nếu
        bạn đọc tìm lại được sách, bạn có thể đánh dấu tìm thấy sau, trong danh sách
        sách đã mất.
      </p>

      {refused ? (
        <p
          role="alert"
          className="mt-5 flex max-w-xl items-center gap-2 rounded-card border border-brick bg-brick/8 px-4 py-3 text-[15px] text-brick"
        >
          <AlertCircle aria-hidden className="size-5 shrink-0" strokeWidth={1.75} />
          {messageFor(refused)}
        </p>
      ) : null}

      {loan ? (
        <form action={reportCopyLostAction}>
          <input type="hidden" name="tu-sach" value={slug} />
          {/* The copy, because that is what `ReportCopyLost` takes. The loan
              travels too, but only so a refusal can come back to this screen
              still pointing at it — the command finds the active loan from the
              copy itself. */}
          <input type="hidden" name="ban" value={loan.copyId} />
          <input type="hidden" name="muon" value={loan.loanId} />
          <input type="hidden" name="q" value={query} />

          <dl className="mt-6 max-w-xl rounded-card border border-hairline bg-surface">
            <Row label="Sách">
              <div className="flex items-center gap-3">
                <BookCover
                  title={loan.title}
                  coverUrl={loan.coverUrl}
                  className="w-12 text-[1rem]"
                />
                <div className="min-w-0">
                  <BookTitle className="block truncate text-base leading-snug">
                    {loan.title}
                  </BookTitle>
                </div>
              </div>
            </Row>
            <Row label="Mã bản sách">
              <span className="inline-flex rounded-control bg-terracotta/10 px-2.5 py-1 text-[14px] font-medium text-terracotta-ink">
                {loan.copyCode}
              </span>
            </Row>
            <Row label="Bạn đọc báo mất">
              <p className="text-[16px] font-medium">{loan.borrowerName}</p>
              <p className="mt-0.5 text-[14px] text-meta">
                Hạn trả {formatDueDate(loan.dueOn)}
              </p>
            </Row>
          </dl>

          <div className="mt-6 max-w-xl">
            <Field
              label="Ghi chú"
              htmlFor="ghi-chu-bao-mat"
              hint="Không bắt buộc — ví dụ hoàn cảnh làm mất, hoặc đã tìm ở đâu."
            >
              <Textarea
                id="ghi-chu-bao-mat"
                name="ghi-chu"
                rows={3}
                placeholder="Gia đình báo đã tìm quanh nhà nhưng không thấy…"
              />
            </Field>
          </div>

          <p className="mt-6 max-w-xl text-[15px] text-ink">
            Sau khi xác nhận, bản {loan.copyCode} sẽ chuyển sang trạng thái{" "}
            <StatusBadge status="lost" size="sm" className="align-middle" />
          </p>

          <div className="mt-8 max-w-xl">
            <SubmitButton
              variant="danger"
              icon={
                <HelpCircle aria-hidden className="size-5" strokeWidth={1.75} />
              }
              className="w-full"
            >
              Xác nhận báo mất
            </SubmitButton>
          </div>
        </form>
      ) : (
        // No `?muon=`, or one that no longer names an active loan on this
        // shelf — somebody else received the book back between the two taps, or
        // the link is a day old. Nothing to confirm, so nothing to confirm
        // *with*: the button is not disabled, it is absent, and the sentence is
        // the one `ReceiveReturn` itself uses for a loan that has already been
        // dealt with.
        <p className="mt-6 max-w-xl text-[15px] text-meta">
          {messageFor("loan_not_active")}
        </p>
      )}

      <div className="mt-3 max-w-xl text-center">
        <Link
          href={backToReturn}
          className="inline-flex min-h-11 items-center text-[14px] text-meta hover:text-ink"
        >
          Quay lại nhận trả
        </Link>
      </div>
    </ManagerShell>
  );
}
