import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, Bookmark, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BookCover, BookTitle } from "@/components/ui/book";
import { PageHeading, SectionHeading } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { PublicHeader } from "@/components/shell/public-header";
import { ReaderTabs } from "@/components/shell/reader-tabs";
import { shelfBySlug, shelves } from "@/lib/fixtures";

export function generateStaticParams() {
  return shelves.map((s) => ({ shelf: s.slug }));
}

const myLoans = [
  {
    slug: "de-men-phieu-luu-ky",
    title: "Dế Mèn Phiêu Lưu Ký",
    author: "Tô Hoài",
    tone: "available" as const,
    icon: Clock,
    pill: "Còn 14 ngày",
    due: "Hạn trả Chúa nhật 20/08",
    action: "Xin gia hạn",
    disabled: false,
  },
  {
    slug: "totto-chan-ben-cua-so",
    title: "Totto-chan Bên Cửa Sổ",
    author: "Kuroyanagi Tetsuko",
    tone: "onloan" as const,
    icon: Clock,
    pill: "Còn 2 ngày",
    due: "Hạn trả 18/08",
    action: "Xin gia hạn",
    disabled: false,
  },
  {
    slug: "kinh-van-hoa-tap-4",
    title: "Kính Vạn Hoa tập 4",
    author: "Nguyễn Nhật Ánh",
    tone: "overdue" as const,
    icon: AlertTriangle,
    pill: "Quá hạn 2 ngày",
    due: "Hạn trả 04/08",
    action: "Không gia hạn được",
    disabled: true,
    reason: "Có bạn khác đang chờ cuốn này.",
  },
];

const recentlyRead = [
  { title: "Hoàng Tử Bé", returned: "12/07", condition: "Nguyên vẹn" },
  { title: "Chiếc Lược Ngà", returned: "28/06", condition: "Nguyên vẹn" },
  { title: "Góc Sân Và Khoảng Trời", returned: "14/06", condition: "Nguyên vẹn" },
  { title: "Đất Rừng Phương Nam", returned: "02/06", condition: "Hơi cũ" },
];

export default async function ReaderDashboardPage({
  params,
}: {
  params: Promise<{ shelf: string }>;
}) {
  const { shelf: slug } = await params;
  const shelf = shelfBySlug(slug);
  if (!shelf) notFound();

  const base = `/tu-sach/${shelf.slug}`;

  return (
    <>
      <PublicHeader shelf={shelf} />
      <ReaderTabs shelfSlug={shelf.slug} active="trang-cua-toi" />

      <main className="mx-auto max-w-5xl px-6 py-10">
        <PageHeading
          title="Chào Minh"
          subtitle="Em đang giữ 3 cuốn · 1 cuốn đã quá hạn."
        />

        <section className="mt-10">
          <SectionHeading>Sách em đang mượn</SectionHeading>
          <div className="mt-5 grid gap-5 sm:grid-cols-3">
            {myLoans.map((loan) => (
              <div
                key={loan.slug}
                className="rounded-card border border-hairline bg-surface p-4"
              >
                <BookCover title={loan.title} className="w-full text-[1.5rem]" />
                <BookTitle className="mt-3 block text-base leading-snug">
                  {loan.title}
                </BookTitle>
                <p className="mt-0.5 text-[13px] text-meta">{loan.author}</p>

                <div className="mt-3">
                  <Pill icon={loan.icon} label={loan.pill} tone={loan.tone} />
                </div>
                <p className="mt-2 text-[14px] text-meta">{loan.due}</p>

                <Button
                  variant="outline"
                  size="sm"
                  disabled={loan.disabled}
                  className="mt-4 w-full"
                >
                  {loan.action}
                </Button>
                {loan.reason ? (
                  <p className="mt-2 text-[13px] text-meta">{loan.reason}</p>
                ) : null}
              </div>
            ))}
          </div>
        </section>

        <section className="mt-12">
          <SectionHeading>Em đang chờ mượn</SectionHeading>
          <div className="mt-5 space-y-4">
            <div className="flex flex-col gap-4 rounded-card border border-hairline bg-surface p-5 sm:flex-row sm:items-center">
              <BookCover title="Hoàng Tử Bé" className="w-16 shrink-0 text-lg" />
              <div className="min-w-0 flex-1">
                <BookTitle className="block text-base leading-snug">
                  Hoàng Tử Bé
                </BookTitle>
                <div className="mt-2">
                  <Pill icon={Bookmark} label="Em đứng thứ 2" tone="held" />
                </div>
                <p className="mt-2 text-[14px] text-meta">
                  Đăng ký 02/08 · quản lý sẽ báo khi tới lượt
                </p>
              </div>
              <Button variant="quiet" size="sm" className="sm:self-center">
                Huỷ đăng ký
              </Button>
            </div>

            <div className="flex flex-col gap-4 rounded-card border border-hairline bg-surface p-5 sm:flex-row sm:items-center">
              <BookCover
                title="Những Tấm Lòng Cao Cả"
                className="w-16 shrink-0 text-lg"
              />
              <div className="min-w-0 flex-1">
                <BookTitle className="block text-base leading-snug">
                  Những Tấm Lòng Cao Cả
                </BookTitle>
                <div className="mt-2">
                  <Pill
                    icon={Bookmark}
                    label="Đang giữ chỗ cho em"
                    tone="available"
                  />
                </div>
                <p className="mt-2 text-[14px] text-meta">
                  Đến nhận trước 09/08, quá hạn sẽ chuyển cho bạn khác
                </p>
              </div>
              <Button variant="primary" size="md" className="sm:self-center">
                Xem hướng dẫn nhận sách
              </Button>
            </div>
          </div>
        </section>

        <section className="mt-12">
          <SectionHeading>Em đã đọc gần đây</SectionHeading>
          <div className="mt-5 grid grid-cols-2 gap-5 sm:grid-cols-4">
            {recentlyRead.map((book) => (
              <div key={book.title}>
                <BookCover title={book.title} className="w-full text-[1.5rem]" />
                <BookTitle className="mt-2.5 line-clamp-2 block text-[15px] leading-snug">
                  {book.title}
                </BookTitle>
                <p className="mt-0.5 text-[13px] text-meta">
                  trả {book.returned} · {book.condition}
                </p>
              </div>
            ))}
          </div>
          <Link
            href={`${base}/toi/lich-su`}
            className="mt-5 inline-flex min-h-11 items-center text-[15px] font-medium text-sage hover:underline"
          >
            Xem toàn bộ lịch sử mượn
          </Link>
        </section>
      </main>
    </>
  );
}
