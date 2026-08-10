import Link from "next/link";
import { AlertTriangle, Bookmark, Clock } from "lucide-react";
import { BookCover, BookTitle } from "@/components/ui/book";
import { PageHeading, SectionHeading } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { SubmitButton } from "@/components/ui/submit-button";
import { ShelfHeader } from "@/components/shell/public-header";
import { ReaderTabs } from "@/components/shell/reader-tabs";
import { messageFor } from "@/domain/kernel/errors";
import {
  getMyDashboard,
  getMyLoanHistory,
} from "@/domain/circulation/queries/get-my-dashboard";
import { readShelf } from "@/lib/shelf";
import { loadPage } from "@/lib/page-data";
import { formatDueDate, formatInstant } from "@/lib/dates";
import { refusalFrom, type SearchParams } from "@/lib/search-params";
import { renewLoanAction } from "../reader-actions";

/**
 * BR §16.2's "My page": books currently held with days remaining and a renew
 * button where permitted, pending requests with their queue position, recent
 * history.
 *
 * **Nothing here recomputes days remaining.** `loans_current` derives it and
 * `is_overdue` from `olibra_now()`, which follows the injected clock, and
 * `getMyDashboard` passes both through untouched. This is the screen where a
 * second subtraction is most tempting — the due date is right there — and it
 * would be a second definition of overdue that moves independently of every
 * other surface (G5).
 *
 * **The renew button's refusal comes from the query, not from this page.**
 * `renewBlockedBy` is an `ErrorCode` produced by the same `loanRenewable`
 * predicate `renewLoan` throws from, rendered through `messageFor`. A page that
 * decided for itself when to disable the button would be the disagreement C1's
 * review already found once, in the direction that turns a child away.
 */
export const dynamic = "force-dynamic";

export default async function ReaderDashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ shelf: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { shelf: slug } = await params;
  const refusal = refusalFrom(await searchParams);

  const { shelf, viewer, dashboard, history } = await loadPage(
    slug,
    async (tx, ctx, viewer) => ({
      shelf: await readShelf(tx, ctx),
      viewer,
      dashboard: await getMyDashboard(tx, ctx),
      history: await getMyLoanHistory(tx, ctx, { limit: 6 }),
    }),
  );

  const base = `/tu-sach/${slug}`;
  const overdue = dashboard.loans.filter((l) => l.isOverdue).length;
  const returned = history.filter((h) => h.status === "returned");

  return (
    <>
      <ShelfHeader
        shelfName={shelf.name}
        shelfSlug={slug}
        active="toi"
        viewerName={viewer.name}
        unreadNotifications={viewer.unreadNotifications}
      />
      <ReaderTabs shelfSlug={slug} pathname={`${base}/ho-so/tong-quan`} />

      <main className="mx-auto max-w-5xl px-6 py-10">
        <PageHeading
          title={viewer.name ? `Chào ${viewer.name}` : "Trang của tôi"}
          subtitle={
            dashboard.loans.length === 0
              ? "Em chưa mượn cuốn nào."
              : overdue > 0
                ? `Em đang giữ ${dashboard.loans.length} cuốn · ${overdue} cuốn đã quá hạn.`
                : `Em đang giữ ${dashboard.loans.length} cuốn.`
          }
        />

        {refusal ? (
          <p className="mt-6 rounded-card border border-hairline bg-surface px-4 py-3 text-[14px] text-ink">
            {messageFor(refusal)}
          </p>
        ) : null}

        <section className="mt-10">
          <SectionHeading>Sách em đang mượn</SectionHeading>
          {dashboard.loans.length === 0 ? (
            <p className="mt-4 text-[14px] text-meta">
              Em chưa mượn cuốn nào. Ghé{" "}
              <Link href={`${base}/danh-muc`} className="underline">
                danh mục
              </Link>{" "}
              xem có gì hay nhé.
            </p>
          ) : (
            <div className="mt-5 grid gap-5 sm:grid-cols-3">
              {dashboard.loans.map((loan) => (
                <div
                  key={loan.loanId}
                  className="flex items-start gap-4 rounded-card border border-hairline bg-surface p-4 sm:block"
                >
                  <BookCover
                    title={loan.title}
                    className="w-20 shrink-0 text-lg sm:w-full sm:text-[1.5rem]"
                  />
                  <div className="min-w-0 flex-1 sm:mt-3">
                    <Link href={`${base}/sach/${loan.slug}`}>
                      <BookTitle className="block text-base leading-snug">
                        {loan.title}
                      </BookTitle>
                    </Link>
                    <p className="mt-0.5 text-[13px] text-meta">
                      Bản {loan.copyCode}
                    </p>

                    <div className="mt-3">
                      <Pill
                        icon={loan.isOverdue ? AlertTriangle : Clock}
                        label={
                          loan.isOverdue
                            ? `Quá hạn ${-loan.daysRemaining} ngày`
                            : `Còn ${loan.daysRemaining} ngày`
                        }
                        tone={
                          loan.isOverdue
                            ? "overdue"
                            : loan.daysRemaining <= 3
                              ? "onloan"
                              : "available"
                        }
                      />
                    </div>
                    <p className="mt-2 text-[14px] text-meta">
                      Hạn trả {formatDueDate(loan.dueOn)}
                    </p>

                    {loan.renewBlockedBy ? (
                      <>
                        <button
                          type="button"
                          disabled
                          aria-describedby={`vi-sao-${loan.loanId}`}
                          className="mt-4 w-full rounded-control border border-hairline px-3 py-2 text-[14px] text-meta opacity-45"
                        >
                          Không gia hạn được
                        </button>
                        {/* The sentence the domain owns, never a copy of it —
                            and the same code `renewLoan` would have thrown. */}
                        <p
                          id={`vi-sao-${loan.loanId}`}
                          className="mt-2 text-[13px] text-meta"
                        >
                          {messageFor(loan.renewBlockedBy)}
                        </p>
                      </>
                    ) : (
                      <form action={renewLoanAction} className="mt-4">
                        <input type="hidden" name="tu-sach" value={slug} />
                        <input type="hidden" name="muon" value={loan.loanId} />
                        <SubmitButton
                          variant="outline"
                          size="sm"
                          className="w-full"
                        >
                          Xin gia hạn
                        </SubmitButton>
                      </form>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {dashboard.requests.length > 0 ? (
          <section className="mt-12">
            <SectionHeading>Sách em đang chờ</SectionHeading>
            <ul className="mt-4 divide-y divide-hairline rounded-card border border-hairline bg-surface">
              {dashboard.requests.map((r) => (
                <li key={r.requestId} className="flex items-center gap-3 px-4 py-3">
                  <Bookmark className="size-4 shrink-0 text-meta" aria-hidden />
                  <Link
                    href={`${base}/sach/${r.slug}`}
                    className="min-w-0 flex-1 truncate text-[15px]"
                  >
                    {r.title}
                  </Link>
                  <span className="shrink-0 text-[13px] text-meta">
                    {r.queuePosition !== null
                      ? `Em ở vị trí ${r.queuePosition}`
                      : r.holdExpiresAt
                        ? `Đã sẵn sàng, nhận trước ${formatInstant(r.holdExpiresAt)}`
                        : "Đã sẵn sàng"}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {returned.length > 0 ? (
          <section className="mt-12">
            <SectionHeading>Em đã đọc gần đây</SectionHeading>
            <ul className="mt-4 divide-y divide-hairline rounded-card border border-hairline bg-surface">
              {returned.map((h) => (
                <li key={h.loanId} className="flex items-center gap-3 px-4 py-3">
                  <Link
                    href={`${base}/sach/${h.slug}`}
                    className="min-w-0 flex-1 truncate text-[15px]"
                  >
                    {h.title}
                  </Link>
                  {h.returnedOn ? (
                    <span className="shrink-0 text-[13px] text-meta">
                      Trả {formatInstant(h.returnedOn)}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
            <Link
              href={`${base}/ho-so/lich-su`}
              className="mt-4 inline-block text-[14px] underline"
            >
              Xem toàn bộ lịch sử
            </Link>
          </section>
        ) : null}
      </main>
    </>
  );
}
