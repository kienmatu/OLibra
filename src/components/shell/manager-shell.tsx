import Link from "next/link";
import {
  Archive,
  BarChart3,
  BookDown,
  BookUp,
  Bookmark,
  Library,
  Cog,
  FileText,
  KeyRound,
  LayoutDashboard,
  MessageSquare,
  Megaphone,
  ScrollText,
  ShieldCheck,
  TriangleAlert,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type ManagerNavKey =
  | "trang-chinh"
  | "sach"
  | "cho-muon"
  | "nhan-tra"
  | "nguoi-doc"
  | "dang-ky-cho-duyet"
  | "yeu-cau-muon"
  | "qua-han"
  | "binh-luan"
  | "thong-bao"
  | "thong-ke"
  | "cai-dat";

const NAV: {
  key: ManagerNavKey;
  label: string;
  icon: LucideIcon;
  count?: number;
}[] = [
  { key: "trang-chinh", label: "Trang chính", icon: LayoutDashboard },
  { key: "sach", label: "Sách", icon: Library },
  { key: "cho-muon", label: "Cho mượn", icon: BookUp },
  { key: "nhan-tra", label: "Nhận trả", icon: BookDown },
  { key: "nguoi-doc", label: "Người đọc", icon: Users },
  {
    key: "dang-ky-cho-duyet",
    label: "Đăng ký chờ duyệt",
    icon: UserPlus,
    count: 5,
  },
  { key: "yeu-cau-muon", label: "Yêu cầu mượn", icon: Bookmark, count: 2 },
  { key: "qua-han", label: "Quá hạn", icon: TriangleAlert, count: 3 },
  { key: "binh-luan", label: "Bình luận", icon: MessageSquare, count: 1 },
  { key: "thong-bao", label: "Thông báo", icon: Megaphone },
  { key: "thong-ke", label: "Thống kê", icon: BarChart3 },
  { key: "cai-dat", label: "Cài đặt", icon: Cog },
];

/**
 * Manager chrome: a sidebar on desktop. Below 768px the sidebar becomes a
 * horizontal scroll strip; the five-item bottom tab bar belongs to the mobile
 * work, which is out of scope here (web only).
 */
export function ManagerShell({
  shelfName,
  shelfSlug,
  active,
  children,
}: {
  shelfName: string;
  shelfSlug: string;
  active: ManagerNavKey;
  children: React.ReactNode;
}) {
  const base = `/tu-sach/${shelfSlug}/quan-ly`;

  return (
    // h-screen + overflow-hidden so the sidebar and the content each own their
    // scroll, instead of the whole document scrolling as one and carrying the
    // sidebar away with it.
    <div className="flex h-screen overflow-hidden">
      <aside className="hidden h-full w-60 shrink-0 flex-col border-r border-hairline bg-paper md:flex">
        <div className="px-5 py-5">
          <Link href="/" className="block text-xl font-semibold">
            OLibra
          </Link>
          <p className="mt-0.5 text-[14px] text-meta">{shelfName}</p>
        </div>

        <nav className="flex-1 overflow-y-auto px-2">
          {NAV.map(({ key, label, icon: Icon, count }) => {
            const isActive = key === active;
            return (
              <Link
                key={key}
                href={key === "trang-chinh" ? base : `${base}/${key}`}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "relative flex min-h-11 items-center gap-2.5 rounded-control px-3 text-[16px]",
                  isActive
                    ? "font-semibold text-terracotta-ink"
                    : "text-ink hover:bg-surface",
                )}
              >
                {isActive ? (
                  <span
                    aria-hidden
                    className="absolute top-1.5 bottom-1.5 -left-2 w-[3px] rounded-full bg-terracotta"
                  />
                ) : null}
                <Icon aria-hidden className="size-5 shrink-0" strokeWidth={1.75} />
                <span className="flex-1 truncate">{label}</span>
                {count ? (
                  <span className="rounded-control bg-surface px-1.5 text-[13px] font-semibold text-leather">
                    {count}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto flex shrink-0 items-center gap-2.5 border-t border-hairline px-5 py-4">
          <span
            aria-hidden
            className="flex size-9 items-center justify-center rounded-full bg-surface text-[15px] font-semibold text-leather"
          >
            L
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[15px] font-medium">
              Maria Nguyễn Thị Lan
            </span>
            <span className="block text-[13px] text-meta">Quản lý</span>
          </span>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto px-6 py-8 md:px-10 md:py-10">
        {/* Constrain the measure. Without a max-width, lines on a wide
            monitor run past 130 characters and a row's action drifts half
            a screen from the text it belongs to. */}
        <div className="mx-auto w-full max-w-5xl">{children}</div>
      </main>
    </div>
  );
}

export type AdminNavKey =
  | "tong-quan"
  | "tu-sach"
  | "quan-ly-vien"
  | "nhat-ky"
  | "bai-viet"
  | "gop-y"
  | "cai-dat";

const ADMIN_NAV: { key: AdminNavKey; label: string; icon: LucideIcon }[] = [
  { key: "tong-quan", label: "Tổng quan", icon: LayoutDashboard },
  { key: "tu-sach", label: "Tủ sách", icon: Archive },
  { key: "quan-ly-vien", label: "Quản lý viên", icon: KeyRound },
  { key: "nhat-ky", label: "Nhật ký", icon: ScrollText },
  { key: "bai-viet", label: "Bài viết", icon: FileText },
  { key: "gop-y", label: "Góp ý", icon: MessageSquare },
  { key: "cai-dat", label: "Cài đặt", icon: Cog },
];

/** Super-admin chrome — the whole network, not one shelf. */
export function AdminShell({
  active,
  children,
}: {
  active: AdminNavKey;
  children: React.ReactNode;
}) {
  return (
    // h-screen + overflow-hidden so the sidebar and the content each own their
    // scroll, instead of the whole document scrolling as one and carrying the
    // sidebar away with it.
    <div className="flex h-screen overflow-hidden">
      <aside className="hidden h-full w-60 shrink-0 flex-col border-r border-hairline bg-paper md:flex">
        <div className="px-5 py-5">
          <Link href="/" className="flex items-center gap-2 text-xl font-semibold">
            <ShieldCheck aria-hidden className="size-5" strokeWidth={1.75} />
            OLibra
          </Link>
          <p className="mt-0.5 text-[14px] text-meta">Quản trị hệ thống</p>
        </div>

        <nav className="flex-1 overflow-y-auto px-2">
          {ADMIN_NAV.map(({ key, label, icon: Icon }) => {
            const isActive = key === active;
            return (
              <Link
                key={key}
                href={key === "tong-quan" ? "/quan-tri" : `/quan-tri/${key}`}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "relative flex min-h-11 items-center gap-2.5 rounded-control px-3 text-[16px]",
                  isActive
                    ? "font-semibold text-terracotta-ink"
                    : "text-ink hover:bg-surface",
                )}
              >
                {isActive ? (
                  <span
                    aria-hidden
                    className="absolute top-1.5 bottom-1.5 -left-2 w-[3px] rounded-full bg-terracotta"
                  />
                ) : null}
                <Icon aria-hidden className="size-5 shrink-0" strokeWidth={1.75} />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto flex shrink-0 items-center gap-2.5 border-t border-hairline px-5 py-4">
          <span
            aria-hidden
            className="flex size-9 items-center justify-center rounded-full bg-surface text-[15px] font-semibold text-leather"
          >
            A
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[15px] font-medium">
              Giuse Trần Quốc Anh
            </span>
            <span className="block text-[13px] text-meta">Quản trị viên</span>
          </span>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto px-6 py-8 md:px-10 md:py-10">
        {/* Constrain the measure. Without a max-width, lines on a wide
            monitor run past 130 characters and a row's action drifts half
            a screen from the text it belongs to. */}
        <div className="mx-auto w-full max-w-5xl">{children}</div>
      </main>
    </div>
  );
}
