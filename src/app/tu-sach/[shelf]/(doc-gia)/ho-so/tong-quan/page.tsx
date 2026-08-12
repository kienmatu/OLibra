import Link from "next/link";
import { AlertTriangle, Bookmark, Clock } from "lucide-react";
import { BookCover, BookTitle } from "@/components/ui/book";
import { PageHeading, SectionHeading } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { SubmitButton } from "@/components/ui/submit-button";
import { ShelfHeader } from "@/components/shell/public-header";
import { ReaderTabs } from "@/components/shell/reader-tabs";
import { NotAReaderNotice } from "@/components/shell/reader-not-a-member";
import { messageFor } from "@/domain/kernel/errors";
import {
  getMyDashboard,
  getMyLoanHistory,
} from "@/domain/circulation/queries/get-my-dashboard";
import { isMemberlessSuperAdmin } from "@/lib/reader-area";
import { readShelf } from "@/lib/shelf";
import { loadPage } from "@/lib/page-data";
import { formatDueDate, formatInstant } from "@/lib/dates";
import { refusalFrom, type SearchParams } from "@/lib/search-params";
import { cancelRequestAction, renewLoanAction } from "../reader-actions";

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

// Static rather than the viewer's own name, matching how the manager's
// `quan-ly/page.tsx` dashboard titles its tab "Trang chính — Quản lý tủ sách
// OLibra" rather than something that varies per session — this is the reader
// side of the identical decision, one route with one tab identity regardless
// of who is signed in. The page's own `<h1>` still greets the reader by name
// (`Chào {viewer.name}`); only the browser tab stays put.
export const metadata = { title: "Trang của tôi — OLibra" };

export default async function ReaderDashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ shelf: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { shelf: slug } = await params;
  const refusal = refusalFrom(await searchParams);

  const base = `/tu-sach/${slug}`;

  const result = await loadPage(slug, async (tx, ctx, viewer) => {
    const shelf = await readShelf(tx, ctx);
    // A super admin holds no membership anywhere by design (`src/lib
    // /reader-area.ts`'s `isMemberlessSuperAdmin` carries the full story —
    // task 10, 2026-08-10 QA remediation). `getMyDashboard` and
    // `getMyLoanHistory` scope by `ctx.actor.userId`, which a super admin
    // always has, so this branch is not here to stop a crash — it is here so
    // this page agrees with the other four about what this viewer is, rather
    // than rendering "Bạn chưa mượn cuốn nào." as if they were simply a reader
    // with no loans yet.
    if (isMemberlessSuperAdmin(ctx)) {
      return { shelf, viewer, member: false as const };
    }
    return {
      shelf,
      viewer,
      member: true as const,
      dashboard: await getMyDashboard(tx, ctx),
      history: await getMyLoanHistory(tx, ctx, { limit: 6 }),
    };
  });

  const { shelf, viewer } = result;
  const chrome = (
    <>
      <ShelfHeader
        shelfName={shelf.name}
        shelfSlug={slug}
        active="toi"
        viewerName={viewer.name}
        unreadNotifications={viewer.unreadNotifications}
      />
      <ReaderTabs shelfSlug={slug} pathname={`${base}/ho-so/tong-quan`} />
    </>
  );

  if (!result.member) {
    return (
      <>
        {chrome}
        <NotAReaderNotice />
      </>
    );
  }

  const { dashboard, history } = result;
  const overdue = dashboard.loans.filter((l) => l.isOverdue).length;
  const returned = history.filter((h) => h.status === "returned");

  return (
    <>
      {chrome}

      <main className="mx-auto max-w-5xl px-6 py-10">
        <PageHeading
          title={viewer.name ? `Chào ${viewer.name}` : "Trang của tôi"}
          subtitle={
            dashboard.loans.length === 0
              ? "Bạn chưa mượn cuốn nào."
              : overdue > 0
                ? `Bạn đang giữ ${dashboard.loans.length} cuốn · ${overdue} cuốn đã quá hạn.`
                : `Bạn đang giữ ${dashboard.loans.length} cuốn.`
          }
        />

        {refusal ? (
          <p className="mt-6 rounded-card border border-hairline bg-surface px-4 py-3 text-[14px] text-ink">
            {messageFor(refusal)}
          </p>
        ) : null}

        <section className="mt-10">
          <SectionHeading>Sách bạn đang mượn</SectionHeading>
          {dashboard.loans.length === 0 ? (
            <p className="mt-4 text-[14px] text-meta">
              Bạn chưa mượn cuốn nào. Ghé{" "}
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
                    coverUrl={loan.coverUrl}
                    className="w-20 shrink-0 text-lg sm:mx-auto sm:w-32 sm:text-[1.5rem]"
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
            <SectionHeading>Sách bạn đang chờ</SectionHeading>
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
                      ? `Bạn ở vị trí ${r.queuePosition}`
                      : r.holdExpiresAt
                        ? `Đã sẵn sàng, nhận trước ${formatInstant(r.holdExpiresAt)}`
                        : "Đã sẵn sàng"}
                  </span>
                  {/* **Huỷ yêu cầu** — `cancelOwnRequest`, which had no caller
                      until U8. This list has shown a queue position since U4
                      with no way to leave the queue: a child who changed their
                      mind stayed in it, and if their turn came the copy was
                      held for them, off the shelf, until the hold expired.
                      No `sach` field, so `cancelRequestAction` comes back to
                      this page rather than to the book's. */}
                  <form action={cancelRequestAction} className="shrink-0">
                    <input type="hidden" name="tu-sach" value={slug} />
                    <input type="hidden" name="yeu-cau" value={r.requestId} />
                    <SubmitButton variant="quiet" size="sm">
                      Huỷ
                    </SubmitButton>
                  </form>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {returned.length > 0 ? (
          <section className="mt-12">
            <SectionHeading>Bạn đã đọc gần đây</SectionHeading>
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
