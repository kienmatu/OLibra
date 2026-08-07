import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Archive,
  Check,
  CheckCircle2,
  Clock3,
  FileX,
  HelpCircle,
  PenLine,
  Scissors,
  Search,
  Users,
} from "lucide-react";
import { ManagerShell } from "@/components/shell/manager-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Card } from "@/components/ui/card";
import { BookCover, BookTitle } from "@/components/ui/book";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import { CONDITIONS } from "@/lib/status";
import { bookBySlug, shelfBySlug, shelves } from "@/lib/fixtures";

export function generateStaticParams() {
  return shelves.map((s) => ({ shelf: s.slug }));
}

const CONDITION_ICONS: Record<(typeof CONDITIONS)[number], typeof CheckCircle2> = {
  "Nguyên vẹn": CheckCircle2,
  "Hơi cũ": Clock3,
  Cũ: Archive,
  Rách: Scissors,
  "Mất trang": FileX,
  "Bị vẽ vào": PenLine,
};

export default async function NhanTraPage({
  params,
}: {
  params: Promise<{ shelf: string }>;
}) {
  const { shelf: slug } = await params;
  const shelf = shelfBySlug(slug);
  if (!shelf) notFound();

  const base = `/tu-sach/${shelf.slug}/quan-ly`;
  const book = bookBySlug("hoang-tu-be")!;
  const selected: (typeof CONDITIONS)[number] = "Nguyên vẹn";

  return (
    <ManagerShell shelfName={shelf.name} shelfSlug={shelf.slug} active="nhan-tra">
      <h1 className="text-[28px] leading-tight font-semibold">Nhận trả sách</h1>

      <div className="mt-5 max-w-xl">
        <Input
          icon={Search}
          defaultValue="hoang tu be"
          aria-label="Tìm sách đang mượn"
          className="h-14 text-[17px]"
        />
      </div>

      <Card className="mt-6 max-w-2xl">
        <div className="flex items-start gap-4">
          <BookCover title={book.title} className="w-16 text-[1.2rem]" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <BookTitle className="block truncate text-lg leading-snug">
                  {book.title}
                </BookTitle>
                <p className="truncate text-[14px] text-meta">{book.author}</p>
              </div>
              <StatusBadge status="onloan" />
            </div>
            <p className="mt-3 text-[15px]">
              Người mượn: <span className="font-medium">Têrêsa Lê Ngọc Ánh</span>
            </p>
            <p className="mt-1 text-[14px] text-meta">
              Mượn ngày 23/07 · Hạn trả Chúa nhật 06/08 · Bản DT-0087
            </p>
          </div>
        </div>
      </Card>

      <section className="mt-8 max-w-2xl">
        <h2 className="text-xl font-semibold">Tình trạng sách khi trả</h2>

        <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
          {CONDITIONS.map((condition) => {
            const Icon = CONDITION_ICONS[condition];
            const isSelected = condition === selected;
            return (
              <button
                key={condition}
                type="button"
                className={cn(
                  "relative flex min-h-24 flex-col items-center justify-center gap-2 rounded-card px-2 py-3 text-center text-[13px] font-medium",
                  isSelected
                    ? "border-2 border-terracotta bg-terracotta/10 text-terracotta-ink"
                    : "border border-hairline bg-surface text-ink",
                )}
              >
                {isSelected ? (
                  <span
                    aria-hidden
                    className="absolute top-1.5 right-1.5 flex size-4 items-center justify-center rounded-full bg-terracotta text-white"
                  >
                    <Check className="size-2.5" strokeWidth={3} />
                  </span>
                ) : null}
                <Icon aria-hidden className="size-6" strokeWidth={1.75} />
                {condition}
              </button>
            );
          })}
        </div>

        <p className="mt-4 text-[14px] text-meta">
          Ghi chú và ảnh chỉ cần khi sách hư hỏng.
        </p>

        <div className="mt-2 rounded-control border border-dashed border-hairline px-4 py-3 text-[14px] text-meta opacity-60">
          Ghi chú và ảnh · hiện khi chọn tình trạng xấu hơn
        </div>

        {/* Not a seventh condition — condition is how damaged a book is,
            loss is a state that removes it from circulation entirely. This
            is a branch to a different command (ReportCopyLost), so it reads
            as a link out rather than another tile in the row above. */}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-5">
          <p className="text-[14px] text-meta">
            Không đánh giá được tình trạng vì bạn đọc báo đã làm mất sách?
          </p>
          <Link
            href={`${base}/nhan-tra/bao-mat`}
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-control px-1 text-[14px] font-semibold text-lost hover:underline"
          >
            <HelpCircle aria-hidden className="size-4" strokeWidth={1.75} />
            Bạn đọc báo làm mất
          </Link>
        </div>
      </section>

      <section className="mt-8 max-w-2xl rounded-card border border-hairline bg-paper p-6">
        <p className="flex items-center gap-2 text-[16px] font-semibold">
          <Users aria-hidden className="size-5" strokeWidth={1.75} />
          Có người đang chờ cuốn này
        </p>
        <p className="mt-2 text-[15px]">
          Giuse Trần Minh đã đăng ký chờ mượn <BookTitle>Hoàng Tử Bé</BookTitle> từ
          ngày 02/08
        </p>
        <p className="mt-1 text-[14px] text-meta">
          Còn 2 người khác trong hàng chờ
        </p>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Button variant="outline" size="md" className="w-full">
            Giữ chỗ cho Giuse Trần Minh
          </Button>
          <Button variant="outline" size="md" className="w-full">
            Không giữ chỗ, trả về kệ
          </Button>
        </div>

        <p className="mt-3 text-[13px] text-meta">
          Bạn quyết định — hệ thống không tự giữ chỗ.
        </p>
      </section>

      <div className="mt-8 max-w-2xl">
        <Button variant="primary" size="lg" className="w-full">
          Xác nhận nhận trả
        </Button>
      </div>
    </ManagerShell>
  );
}
