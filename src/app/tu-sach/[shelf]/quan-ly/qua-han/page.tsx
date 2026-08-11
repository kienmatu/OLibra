import { ButtonLink } from "@/components/ui/button";
import { BookCover, BookTitle } from "@/components/ui/book";
import { Card, PageHeading } from "@/components/ui/card";
import { Chip } from "@/components/ui/segmented";
import { PhoneLink } from "@/components/ui/phone-link";
import { StatusBadge } from "@/components/ui/status-badge";
import { ManagerShell } from "@/components/shell/manager-shell";
import {
  getOverdueLoans,
  type OverdueSort,
} from "@/domain/circulation/queries/get-overdue-loans";
import { getManagerBadgeCounts } from "@/domain/shelf/queries/get-manager-dashboard";
import { formatDueDate } from "@/lib/dates";
import { loadPage } from "@/lib/page-data";
import { param, type SearchParams } from "@/lib/search-params";
import { readShelf } from "@/lib/shelf";

/** U1 §2. See `../cho-muon/page.tsx` for what a cached manager screen leaks. */
export const dynamic = "force-dynamic";

export const metadata = { title: "Quá hạn — Quản lý tủ sách OLibra" };

const NUMBER = new Intl.NumberFormat("vi-VN");

/** `?sap-xep=`, the spelling `danh-muc` and `quan-ly/sach` already use. */
const SORT = "sap-xep";

/**
 * The three orderings, keyed by the value that appears in the URL.
 *
 * The labels are the fixture page's own `<select>` options — "Trễ nhiều nhất
 * trước", "Trễ ít nhất trước", "Tên bạn đọc" — which were inert there and are
 * links here. No new Vietnamese: the words already described these three
 * choices, they simply did not do them.
 */
const SORTS: { value: string; sort: OverdueSort; label: string }[] = [
  { value: "tre-nhieu", sort: "most-late", label: "Trễ nhiều nhất trước" },
  { value: "tre-it", sort: "least-late", label: "Trễ ít nhất trước" },
  { value: "ten", sort: "borrower", label: "Tên bạn đọc" },
];

/**
 * BR §16.3's Quá hạn: "sorted by how overdue, showing borrower and contact
 * phone. **That phone number is the actual mechanism by which books come back,
 * so it must be tappable.**"
 *
 * That sentence is why this screen needed a query of its own rather than a wider
 * `searchLoansForReturn` — the closest shipped query requires a search term and
 * returns no phone at all. `getOverdueLoans` is that query, and
 * `PhoneLink` is the component that makes the number a 44px target rather than
 * a line of text.
 *
 * **Lateness is derived on read.** `daysLate` is `loans_current`'s own
 * `days_remaining`, negated — computed against `olibra_now()`, which
 * `unit-of-work.ts` sets from `ctx.clock` (BR §8, `20260808_14_olibra_now.sql`).
 * Nothing on this screen is a stored flag and no job writes one, which is what
 * makes the list correct the morning after a due date with nobody having done
 * anything.
 *
 * **The sort is a row of chips, not a `<select>`.** The fixture's dropdown could
 * never have applied itself: these are server components with no client
 * JavaScript, so a `<select>` with no form around it is a control that changes
 * nothing. `Chip` is what this project uses "where a dropdown would hide the
 * counts", and `danh-muc` and `quan-ly/sach` already sort this way.
 *
 * **The two per-card actions are links into the wired return flow**, carrying
 * the copy's own code as the search and the loan as the selection — so "Nhận
 * trả" lands on the condition picker for this exact loan, and "Báo mất" on its
 * confirm screen. They were `<button>`s with no form in the fixture version,
 * which is the shape U2 removed from the reader header. `searchLoansForReturn`
 * folds the code on both sides, so `DT-0203` finds `DT-0203`.
 */
export default async function OverdueLoansPage({
  params,
  searchParams,
}: {
  params: Promise<{ shelf: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { shelf: slug } = await params;
  const search = await searchParams;

  const sortParam = param(search, SORT);
  const chosen = SORTS.find((s) => s.value === sortParam) ?? SORTS[0];

  const { shelf, viewer, counts, loans } = await loadPage(
    slug,
    async (tx, ctx, viewer) => ({
      shelf: await readShelf(tx, ctx),
      viewer,
      counts: await getManagerBadgeCounts(tx, ctx),
      loans: await getOverdueLoans(tx, ctx, { sort: chosen.sort }),
    }),
  );

  const base = `/tu-sach/${slug}/quan-ly`;
  const sortHref = (value: string) =>
    value === SORTS[0].value
      ? `${base}/qua-han`
      : `${base}/qua-han?${SORT}=${value}`;

  /** Where a card's action opens the return flow, with this loan chosen. */
  const returnHref = (path: string, copyCode: string, loanId: string) =>
    `${base}/${path}?${new URLSearchParams({ q: copyCode, muon: loanId })}`;

  return (
    <ManagerShell
      shelfName={shelf.name}
      shelfSlug={slug}
      active="qua-han"
      viewer={viewer}
      counts={counts}
    >
      <div className="space-y-8">
        <PageHeading
          title="Quá hạn"
          subtitle={
            loans.length === 0
              ? "Không có cuốn nào quá hạn."
              : `${NUMBER.format(loans.length)} cuốn chưa được trả`
          }
        />

        {loans.length > 1 ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] text-meta">Sắp xếp</span>
            {SORTS.map((option) => (
              <Chip
                key={option.value}
                href={sortHref(option.value)}
                active={option.value === chosen.value}
              >
                {option.label}
              </Chip>
            ))}
          </div>
        ) : null}

        {loans.length === 0 ? (
          <p className="text-[15px] text-meta">
            Mọi cuốn đang mượn đều còn trong hạn.
          </p>
        ) : (
          <div className="space-y-4">
            {loans.map((loan) => (
              <Card key={loan.loanId}>
                <div className="flex items-start gap-4">
                  <BookCover
                    title={loan.title}
                    coverUrl={loan.coverUrl}
                    className="w-16 shrink-0 text-lg"
                  />
                  <div className="min-w-0 flex-1">
                    <BookTitle as="p" className="text-[18px] leading-snug">
                      {loan.title}
                    </BookTitle>
                    <span className="mt-1.5 inline-block rounded-control bg-paper px-2 py-0.5 text-[13px] text-meta">
                      {loan.copyCode}
                    </span>
                    <p className="mt-2 text-[16px] font-medium">
                      {loan.borrowerName}
                    </p>
                    {/* BR §16.3's whole reason this screen exists. A reader with
                        no number on file is a real row (`users.phone` is
                        nullable), and the honest answer there is to say so
                        rather than to render a `tel:` link that dials nothing. */}
                    {loan.borrowerPhone ? (
                      <PhoneLink
                        phone={loan.borrowerPhone}
                        size="md"
                        className="mt-0.5"
                      />
                    ) : (
                      <p className="mt-1 text-[14px] text-meta">
                        Chưa có số điện thoại
                      </p>
                    )}
                  </div>
                  <div className="hidden shrink-0 flex-col items-end gap-1 text-right md:flex">
                    <StatusBadge status="overdue" />
                    <p className="text-[15px] font-semibold text-overdue">
                      Trễ {NUMBER.format(loan.daysLate)} ngày
                    </p>
                    <p className="text-[14px] text-meta">
                      Hạn trả {formatDueDate(loan.dueOn)}
                    </p>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2 md:hidden">
                  <StatusBadge status="overdue" />
                  <p className="text-[15px] font-semibold text-overdue">
                    Trễ {NUMBER.format(loan.daysLate)} ngày
                  </p>
                  <p className="w-full text-[14px] text-meta">
                    Hạn trả {formatDueDate(loan.dueOn)}
                  </p>
                </div>

                <div className="mt-4 flex flex-wrap gap-3 border-t border-hairline pt-4">
                  <ButtonLink
                    size="sm"
                    href={returnHref("nhan-tra", loan.copyCode, loan.loanId)}
                  >
                    Nhận trả
                  </ButtonLink>
                  <ButtonLink
                    size="sm"
                    href={returnHref(
                      "nhan-tra/bao-mat",
                      loan.copyCode,
                      loan.loanId,
                    )}
                  >
                    Báo mất
                  </ButtonLink>
                </div>
              </Card>
            ))}
          </div>
        )}

        <p className="text-[14px] text-meta">
          Gọi điện cho gia đình là cách sách quay về nhanh nhất.
        </p>
      </div>
    </ManagerShell>
  );
}
