import { notFound } from "next/navigation";
import {
  AlertTriangle,
  BookUp,
  Bookmark,
  Clock,
  Info,
  MessageSquare,
  UserCheck,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { BookTitle } from "@/components/ui/book";
import { PageHeading } from "@/components/ui/card";
import { ShelfHeader } from "@/components/shell/public-header";
import { ReaderTabs } from "@/components/shell/reader-tabs";
import { shelfBySlug, shelves } from "@/lib/fixtures";
import { cn } from "@/lib/utils";

export function generateStaticParams() {
  return shelves.map((s) => ({ shelf: s.slug }));
}

type Tone = "overdue" | "available" | "onloan" | "sage";

const TONE_FILL: Record<Tone, string> = {
  overdue: "bg-overdue/10 text-overdue",
  available: "bg-available/10 text-available",
  onloan: "bg-onloan/10 text-onloan",
  sage: "bg-sage/10 text-sage",
};

const notifications: {
  icon: LucideIcon;
  tone: Tone;
  text: React.ReactNode;
  time: string;
  read: boolean;
}[] = [
  {
    icon: AlertTriangle,
    tone: "overdue",
    text: (
      <>
        Cuốn <BookTitle>Kính Vạn Hoa tập 4</BookTitle> đã quá hạn 2 ngày. Em mang
        trả giúp tủ sách nhé.
      </>
    ),
    time: "2 giờ trước",
    read: false,
  },
  {
    icon: Bookmark,
    tone: "available",
    text: (
      <>
        Cuốn <BookTitle>Những Tấm Lòng Cao Cả</BookTitle> đang được giữ chỗ cho em.
        Em đến nhận trước ngày 09/08.
      </>
    ),
    time: "5 giờ trước",
    read: false,
  },
  {
    icon: Clock,
    tone: "onloan",
    text: (
      <>
        Cuốn <BookTitle>Totto-chan Bên Cửa Sổ</BookTitle> sắp đến hạn trả, còn 2
        ngày.
      </>
    ),
    time: "hôm qua",
    read: false,
  },
  {
    icon: MessageSquare,
    tone: "sage",
    text: (
      <>
        Bình luận của em về <BookTitle>Hoàng Tử Bé</BookTitle> đã được duyệt.
      </>
    ),
    time: "3 ngày trước",
    read: true,
  },
  {
    icon: BookUp,
    tone: "sage",
    text: (
      <>
        Quản lý đã cho em mượn <BookTitle>Dế Mèn Phiêu Lưu Ký</BookTitle>. Hạn trả
        Chúa nhật 20/08.
      </>
    ),
    time: "06/08",
    read: true,
  },
  {
    icon: UserCheck,
    tone: "sage",
    text: "Tài khoản của em đã được duyệt. Chào mừng em đến với tủ sách.",
    time: "14/03",
    read: true,
  },
];

export default async function ReaderNotificationsPage({
  params,
}: {
  params: Promise<{ shelf: string }>;
}) {
  const { shelf: slug } = await params;
  const shelf = shelfBySlug(slug);
  if (!shelf) notFound();

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <>
      <ShelfHeader shelf={shelf} />
      <ReaderTabs shelfSlug={shelf.slug} active="thong-bao" />

      <main className="mx-auto max-w-3xl px-6 py-10">
        <PageHeading
          title="Thông báo"
          subtitle={`${unreadCount} thông báo chưa đọc`}
          action={
            <Button variant="quiet" size="sm">
              Đánh dấu đã đọc tất cả
            </Button>
          }
        />

        <ul className="mt-8 space-y-2">
          {notifications.map((item, i) => (
            <li
              key={i}
              className={cn(
                "relative flex gap-3 rounded-card p-4",
                item.read ? "opacity-70" : "bg-paper",
              )}
            >
              {!item.read ? (
                <span
                  aria-hidden
                  className="absolute top-4 left-1.5 size-2 rounded-full bg-terracotta"
                />
              ) : null}
              <span
                className={cn(
                  "flex size-10 shrink-0 items-center justify-center rounded-full",
                  TONE_FILL[item.tone],
                )}
              >
                <item.icon aria-hidden className="size-5" strokeWidth={1.75} />
              </span>
              <div className="min-w-0">
                <p className="text-[15px] leading-snug">{item.text}</p>
                <p className="mt-1 text-[13px] text-meta">{item.time}</p>
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-8 flex gap-3 rounded-card border border-hairline bg-paper p-4">
          <Info
            aria-hidden
            className="mt-0.5 size-5 shrink-0 text-leather"
            strokeWidth={1.75}
          />
          <p className="text-[14px] text-meta">
            Tủ sách chỉ báo tin trong ứng dụng, không gửi email hay tin nhắn.
          </p>
        </div>
      </main>
    </>
  );
}
