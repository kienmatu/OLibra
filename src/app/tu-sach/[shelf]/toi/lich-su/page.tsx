import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { AlertTriangle, BookMarked, BookOpen, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BookCover, BookTitle } from "@/components/ui/book";
import { PageHeading, StatStrip } from "@/components/ui/card";
import { Pill as ConditionPill } from "@/components/ui/pill";
import { ShelfHeader } from "@/components/shell/public-header";
import { ReaderTabs } from "@/components/shell/reader-tabs";
import { shelfBySlug, shelves } from "@/lib/fixtures";

export function generateStaticParams() {
  return shelves.map((s) => ({ shelf: s.slug }));
}

const history = [
  {
    month: "Tháng 8/2026",
    rows: [
      {
        title: "Dế Mèn Phiêu Lưu Ký",
        author: "Tô Hoài",
        dates: "Mượn 06/08 · Trả 20/08",
        icon: BookMarked,
        condition: "Đang mượn",
        tone: "onloan" as const,
        note: "Còn 14 ngày",
      },
      {
        title: "Kính Vạn Hoa tập 4",
        author: "Nguyễn Nhật Ánh",
        dates: "Mượn 21/07 · Trả 04/08",
        icon: AlertTriangle,
        condition: "Quá hạn",
        tone: "overdue" as const,
        note: "Trễ 2 ngày",
      },
    ],
  },
  {
    month: "Tháng 7/2026",
    rows: [
      {
        title: "Hoàng Tử Bé",
        author: "Antoine de Saint-Exupéry",
        dates: "Mượn 04/07 · Trả 18/07",
        icon: CheckCircle2,
        condition: "Nguyên vẹn",
        tone: "available" as const,
        note: "Đúng hạn",
      },
      {
        title: "Đất Rừng Phương Nam",
        author: "Đoàn Giỏi",
        dates: "Mượn 12/06 · Trả 03/07",
        icon: BookOpen,
        condition: "Hơi cũ",
        tone: "onloan" as const,
        note: "Trễ 7 ngày",
      },
    ],
  },
  {
    month: "Tháng 6/2026",
    rows: [
      {
        title: "Chiếc Lược Ngà",
        author: "Nguyễn Quang Sáng",
        dates: "Mượn 28/05 · Trả 14/06",
        icon: CheckCircle2,
        condition: "Nguyên vẹn",
        tone: "available" as const,
        note: "Đúng hạn",
      },
      {
        title: "Góc Sân Và Khoảng Trời",
        author: "Trần Đăng Khoa",
        dates: "Mượn 30/05 · Trả 06/06",
        icon: CheckCircle2,
        condition: "Nguyên vẹn",
        tone: "available" as const,
        note: "Đúng hạn",
      },
    ],
  },
];

export default async function ReaderHistoryPage({
  params,
}: {
  params: Promise<{ shelf: string }>;
}) {
  const { shelf: slug } = await params;
  const shelf = shelfBySlug(slug);
  if (!shelf) notFound();

  return (
    <>
      <ShelfHeader shelf={shelf} />
      <ReaderTabs shelfSlug={shelf.slug} active="lich-su" />

      <main className="mx-auto max-w-5xl px-6 py-10">
        <PageHeading
          title="Lịch sử mượn"
          subtitle="Em đã mượn 24 cuốn từ tháng 3 năm 2026."
        />

        <div className="mt-6">
          <StatStrip
            items={[
              { label: "Tổng số lượt", value: "24" },
              { label: "Trả đúng hạn", value: "21" },
              { label: "Trả trễ", value: "3" },
            ]}
          />
        </div>

        <div className="mt-8 space-y-10">
          {history.map((group) => (
            <section key={group.month}>
              <h2 className="rounded-control bg-paper px-3 py-2 text-[14px] font-semibold text-leather">
                {group.month}
              </h2>
              <ul className="mt-2 divide-y divide-hairline border-b border-hairline">
                {group.rows.map((row) => (
                  <li
                    key={row.title}
                    className="flex flex-col gap-4 py-5 sm:flex-row sm:items-center"
                  >
                    <BookCover
                      title={row.title}
                      className="w-14 shrink-0 text-base"
                    />
                    <div className="min-w-0 flex-1">
                      <BookTitle className="block text-base leading-snug">
                        {row.title}
                      </BookTitle>
                      <p className="mt-0.5 text-[13px] text-meta">{row.author}</p>
                      <p className="mt-1 text-[14px] text-meta">{row.dates}</p>
                    </div>
                    <div className="flex flex-col items-start gap-1 sm:items-end">
                      <ConditionPill
                        icon={row.icon}
                        label={row.condition}
                        tone={row.tone}
                      />
                      <span className="text-[13px] text-meta">{row.note}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <nav className="mt-8 flex items-center justify-between gap-4">
          <p className="text-[15px] text-meta">Trang 1 / 4</p>
          <div className="flex gap-2">
            <Button size="sm" disabled>
              <ChevronLeft aria-hidden className="size-5" strokeWidth={1.75} />
              Trước
            </Button>
            <Button size="sm">
              Sau
              <ChevronRight aria-hidden className="size-5" strokeWidth={1.75} />
            </Button>
          </div>
        </nav>
      </main>
    </>
  );
}
