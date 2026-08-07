import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { BookCover, BookTitle } from "@/components/ui/book";
import { Card, PageHeading } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { PhoneLink } from "@/components/ui/phone-link";
import { StatusBadge } from "@/components/ui/status-badge";
import { ManagerShell } from "@/components/shell/manager-shell";
import { overdueLoans, shelfBySlug, shelves } from "@/lib/fixtures";

export function generateStaticParams() {
  return shelves.map((s) => ({ shelf: s.slug }));
}

export default async function OverdueLoansPage({
  params,
}: {
  params: Promise<{ shelf: string }>;
}) {
  const { shelf: slug } = await params;
  const shelf = shelfBySlug(slug);
  if (!shelf) notFound();

  return (
    <ManagerShell shelfName={shelf.name} shelfSlug={shelf.slug} active="qua-han">
      <div className="space-y-8">
        <PageHeading
          title="Quá hạn"
          subtitle="3 cuốn chưa được trả · Sắp xếp theo mức độ trễ."
          action={
            <Select
              aria-label="Sắp xếp"
              className="h-11 w-auto min-w-52"
              defaultValue="tre-nhieu"
            >
              <option value="tre-nhieu">Trễ nhiều nhất trước</option>
              <option value="tre-it">Trễ ít nhất trước</option>
              <option value="ten">Tên bạn đọc</option>
            </Select>
          }
        />

        <div className="space-y-4">
          {overdueLoans.map((loan) => (
            <Card key={loan.code}>
              <div className="flex items-start gap-4">
                <BookCover title={loan.title} className="w-16 shrink-0 text-lg" />
                <div className="min-w-0 flex-1">
                  <BookTitle as="p" className="text-[18px] leading-snug">
                    {loan.title}
                  </BookTitle>
                  <span className="mt-1.5 inline-block rounded-control bg-paper px-2 py-0.5 text-[13px] text-meta">
                    {loan.code}
                  </span>
                  <p className="mt-2 text-[16px] font-medium">{loan.borrower}</p>
                  <PhoneLink phone={loan.phone} size="md" className="mt-0.5" />
                </div>
                <div className="hidden shrink-0 flex-col items-end gap-1 text-right md:flex">
                  <StatusBadge status="overdue" />
                  <p className="text-[15px] font-semibold text-overdue">
                    Trễ {loan.lateDays} ngày
                  </p>
                  <p className="text-[14px] text-meta">Hạn trả {loan.due}</p>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2 md:hidden">
                <StatusBadge status="overdue" />
                <p className="text-[15px] font-semibold text-overdue">
                  Trễ {loan.lateDays} ngày
                </p>
                <p className="w-full text-[14px] text-meta">Hạn trả {loan.due}</p>
              </div>

              <div className="mt-4 flex flex-wrap gap-3 border-t border-hairline pt-4">
                <Button variant="quiet" size="sm">
                  Nhận trả
                </Button>
                <Button variant="quiet" size="sm">
                  Báo mất
                </Button>
              </div>
            </Card>
          ))}
        </div>

        <p className="text-[14px] text-meta">
          Gọi điện cho gia đình là cách sách quay về nhanh nhất.
        </p>
      </div>
    </ManagerShell>
  );
}
