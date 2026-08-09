import Link from "next/link";
import {
  Archive,
  BarChart3,
  BookDown,
  BookUp,
  Library,
  Cog,
  KeyRound,
  LayoutDashboard,
  Menu,
  MessageSquare,
  Megaphone,
  ScrollText,
  ShieldCheck,
  TriangleAlert,
  UserPen,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { Role } from "@/domain/kernel/tenant";
import { roleLabel } from "@/lib/roles";
import { cn } from "@/lib/utils";

/**
 * SDD §6.6: numbers go through the locale, never a hand-written format. A
 * badge count is small today and is still a number.
 */
const NUMBER = new Intl.NumberFormat("vi-VN");

/**
 * Who the sidebar says is signed in, and `null` for **a page that does not yet
 * know**.
 *
 * **Structural, rather than `Viewer` imported from `src/lib/page-data.ts`.**
 * That module is on `pages-reading-the-database-are-dynamic.test.ts`'s
 * `DATABASE_REACHING_IMPORTS` list, and that check walks a route's imports
 * *transitively* through the components it renders — so importing the type
 * here, even as `import type`, would mark all twenty-two pages that render this
 * shell as database-backed, including the fixture ones, which would then have
 * to be `force-dynamic` and would have to drop `generateStaticParams` while
 * still rendering fixtures. The guard would be reporting something true of the
 * import graph and false of the pages. `public-header.tsx` takes a bare
 * `viewerName: string | null` for the same reason; this takes a shape rather
 * than a string because it needs two fields.
 *
 * A `Viewer` from the seam assigns to it structurally, so the two cannot drift
 * silently in the direction that matters: renaming a field in `Viewer` breaks
 * every page that passes it.
 */
export interface ShellViewer {
  name: string | null;
  role: Role;
}

/**
 * The three counts the sidebar can honestly show — `ManagerBadgeCounts` from
 * `src/domain/shelf/queries/get-manager-dashboard.ts`, restated structurally
 * for the reason `ShellViewer` above gives.
 */
export interface ShellCounts {
  pendingRegistrations: number;
  pendingProfileChanges: number;
  overdue: number;
}

/**
 * Which page is being rendered. **Wider than `NAV` below**, deliberately:
 * `yeu-cau-muon`, `tang-sach` and `binh-luan` no longer have a nav entry (see
 * `NAV`) but their routes still exist as fixture pages and still have to say
 * which page they are. Narrowing the union would be deleting three routes,
 * which is a different decision from removing three links.
 */
export type ManagerNavKey =
  | "trang-chinh"
  | "sach"
  | "cho-muon"
  | "nhan-tra"
  | "nguoi-doc"
  | "dang-ky-cho-duyet"
  | "doi-thong-tin"
  | "yeu-cau-muon"
  | "tang-sach"
  | "qua-han"
  | "binh-luan"
  | "thong-bao"
  | "thong-ke"
  | "cai-dat";

/**
 * The sidebar, and the three entries that left it (U3 §3.1).
 *
 * This shipped with six hard-coded badge counts — `Đăng ký chờ duyệt 5`,
 * `Đổi thông tin 2`, `Yêu cầu mượn 2`, `Tặng sách 3`, `Quá hạn 3`,
 * `Bình luận 1` — on manager pages six of which have shown real books, from a
 * real parish, since U1. Three of the six belong to slices that do not exist:
 * **Yêu cầu mượn** is C2's borrow-request queue, **Tặng sách** and
 * **Bình luận** are B3's donations and comments. No query in this codebase
 * could answer them and no page behind them does anything.
 *
 * **So the badge goes, and the nav entry with it.** Showing the fixture number
 * is a lie. Showing `0` is a different lie, and a worse-shaped one: a volunteer
 * reads "no comments waiting" and stops checking, which is a false statement
 * about a queue nothing is reading. This is U2's answer to the same question
 * one page earlier — it removed the header's links to unwired reader pages —
 * and it is the same reason: mixed into chrome whose other half is real, an
 * invented number is indistinguishable from data.
 *
 * **`badge` is a field of `ShellCounts`, not a number.** A nav entry cannot
 * carry a count that was written here, only the name of a count somebody
 * queried; the type is what makes a hard-coded `5` unwriteable.
 *
 * **Three entries carry no badge and stay: `Thông báo`, `Thống kê`,
 * `Cài đặt`.** Their queries do not exist either (OPS:95, :96, :97), so this is
 * worth stating rather than leaving to be noticed: §3.1's argument is about an
 * invented *number*, and a plain link to an unfinished page invents nothing.
 * The nav entries for the pages waves 2 and 3 of this slice wire —
 * `Người đọc`, `Đăng ký chờ duyệt`, `Đổi thông tin`, `Quá hạn` — stay for the
 * same reason and become real within the slice.
 */
const NAV: {
  key: ManagerNavKey;
  label: string;
  icon: LucideIcon;
  badge?: keyof ShellCounts;
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
    badge: "pendingRegistrations",
  },
  {
    key: "doi-thong-tin",
    label: "Đổi thông tin",
    icon: UserPen,
    badge: "pendingProfileChanges",
  },
  { key: "qua-han", label: "Quá hạn", icon: TriangleAlert, badge: "overdue" },
  { key: "thong-bao", label: "Thông báo", icon: Megaphone },
  { key: "thong-ke", label: "Thống kê", icon: BarChart3 },
  { key: "cai-dat", label: "Cài đặt", icon: Cog },
];

/**
 * The number to print beside a nav entry, or `null` for no badge at all.
 *
 * **`null` means three different things and only one of them is a claim.** An
 * entry with no `badge` field never had a count; a page that passed no `counts`
 * has not been wired yet; and a count of `0` is a real answer that renders as
 * *nothing*, which is the same visual this component always used for a falsy
 * count. The first two must not print a number, and the third need not: an
 * absent badge beside "Quá hạn" reads as "nothing waiting", and on a wired page
 * that is exactly what was measured. What §3.1 forbids is printing `0` for a
 * queue **nobody read** — which is the first two cases, and they print nothing.
 */
function badgeFor(
  entry: (typeof NAV)[number],
  counts: ShellCounts | null,
): number | null {
  if (!entry.badge || !counts) return null;
  const value = counts[entry.badge];
  return value > 0 ? value : null;
}

/**
 * Below 768px the sidebar is hidden, which previously left manager and admin
 * screens with no navigation, no brand and no shelf name at all. This is the
 * stand-in: a compact bar with a <details> menu, so it needs no client
 * JavaScript and these pages stay static server components.
 */
function MobileBar({
  title,
  subtitle,
  items,
}: {
  title: string;
  subtitle: string;
  items: {
    href: string;
    label: string;
    icon: LucideIcon;
    /** Already resolved by `badgeFor`: a real, positive count, or nothing. */
    count: number | null;
  }[];
}) {
  return (
    <div className="sticky top-0 z-20 border-b border-hairline bg-paper md:hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <Link href="/" className="block truncate text-lg font-semibold">
            {title}
          </Link>
          <p className="truncate text-[14px] text-meta">{subtitle}</p>
        </div>
        <details className="relative shrink-0">
          <summary className="flex size-11 cursor-pointer list-none items-center justify-center rounded-control hover:bg-surface [&::-webkit-details-marker]:hidden">
            <span className="sr-only">Mở menu</span>
            <Menu aria-hidden className="size-6" strokeWidth={1.75} />
          </summary>
          <div className="absolute right-0 z-20 mt-2 max-h-[70vh] w-60 overflow-y-auto rounded-card border border-hairline bg-surface p-2">
            {items.map(({ href, label, icon: Icon, count }) => (
              <Link
                key={href}
                href={href}
                className="flex min-h-11 items-center gap-2.5 rounded-control px-3 text-[16px] hover:bg-paper"
              >
                <Icon aria-hidden className="size-5 shrink-0" strokeWidth={1.75} />
                <span className="flex-1 truncate">{label}</span>
                {count === null ? null : (
                  <span className="rounded-control bg-paper px-1.5 text-[13px] font-semibold text-leather">
                    {NUMBER.format(count)}
                  </span>
                )}
              </Link>
            ))}
          </div>
        </details>
      </div>
    </div>
  );
}

/**
 * Manager chrome: a sidebar on desktop. Below 768px the sidebar becomes a
 * horizontal scroll strip; the five-item bottom tab bar belongs to the mobile
 * work, which is out of scope here (web only).
 *
 * **`viewer` and `counts` are required and nullable, rather than optional**
 * (U3 wave 1). Twenty-two pages render this shell and only some of them are
 * wired, so there has to be a way to say "this page does not know" — but it has
 * to be *said*. An optional prop lets a page that reads the database forget,
 * and then the sidebar quietly renders no name on a screen full of real
 * children's records, which is the failure U2 spent a slice on in the opposite
 * direction. `viewer={null}` is a sentence each unwired page writes about
 * itself, and it is what waves 2 and 3 replace one page at a time.
 */
export function ManagerShell({
  shelfName,
  shelfSlug,
  active,
  viewer,
  counts,
  children,
}: {
  shelfName: string;
  shelfSlug: string;
  active: ManagerNavKey;
  /** `null` on a page that has not been wired to `loadPage` yet. */
  viewer: ShellViewer | null;
  /** `null` on a page that has not queried them. Never a written-in number. */
  counts: ShellCounts | null;
  children: React.ReactNode;
}) {
  const base = `/tu-sach/${shelfSlug}/quan-ly`;
  // The last word of a Vietnamese name is the given name — "Maria Nguyễn Thị
  // Lan" initials as L, not M. The same line `public-header.tsx` carries, and
  // the same one the fixture era had right; what was wrong was that the letter
  // was written out as a constant `L` beside a constant name.
  const initial = viewer?.name?.split(" ").at(-1)?.charAt(0) ?? null;
  const label = viewer ? roleLabel(viewer.role) : null;

  return (
    // The sidebar is sticky and the document scrolls normally. The previous
    // shell locked the wrapper to the viewport and let main scroll inside it,
    // which broke as soon as anything added a stray pixel: html measured 914px
    // against a 900px body, so the page scrolled 14px, dragging the fixed-height
    // sidebar up and leaving a band of empty paper beneath it.
    <div className="flex min-h-dvh flex-col md:flex-row">
      <MobileBar
        title={shelfName}
        subtitle="Quản lý tủ sách"
        items={NAV.map((entry) => ({
          href: entry.key === "trang-chinh" ? base : `${base}/${entry.key}`,
          label: entry.label,
          icon: entry.icon,
          count: badgeFor(entry, counts),
        }))}
      />
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col self-start border-r border-hairline bg-paper md:flex">
        <div className="px-5 py-5">
          <Link href="/" className="block text-xl font-semibold">
            OLibra
          </Link>
          <p className="mt-0.5 text-[14px] text-meta">{shelfName}</p>
        </div>

        <nav className="flex-1 overflow-y-auto px-2">
          {NAV.map((entry) => {
            const { key, label, icon: Icon } = entry;
            const count = badgeFor(entry, counts);
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
                {count === null ? null : (
                  <span className="rounded-control bg-surface px-1.5 text-[13px] font-semibold text-leather">
                    {NUMBER.format(count)}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* The person actually signed in, from the `Viewer` the seam resolved
            once (U3 §3.3). This block used to be the constants "L", "Maria
            Nguyễn Thị Lan" and "Quản lý", printed over six wired manager pages
            since U1 — real books, real parish, one invented volunteer's name.

            The whole block is absent when there is no viewer, rather than
            degrading to an empty circle: a nameless avatar beside a blank line
            reads as a bug, and on an unwired page the honest statement is that
            this chrome knows nothing about who is looking. */}
        {viewer?.name ? (
          <div className="mt-auto flex shrink-0 items-center gap-2.5 border-t border-hairline px-5 py-4">
            <span
              aria-hidden
              className="flex size-9 items-center justify-center rounded-full bg-surface text-[15px] font-semibold text-leather"
            >
              {initial}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[15px] font-medium">
                {viewer.name}
              </span>
              {/* `roleLabel` returns null for `reader` and `guest`, neither of
                  which can reach a page that renders this shell — see
                  `src/lib/roles.ts`. Nothing rather than an invented word. */}
              {label ? (
                <span className="block text-[13px] text-meta">{label}</span>
              ) : null}
            </span>
          </div>
        ) : null}
      </aside>

      <main className="min-w-0 flex-1 px-6 py-8 md:px-10 md:py-10">
        {/* Constrain the measure. Without a max-width, lines on a wide
            monitor run past 130 characters and a row's action drifts half
            a screen from the text it belongs to. */}
        <div className="mx-auto w-full max-w-5xl">{children}</div>
      </main>
    </div>
  );
}

export type AdminNavKey =
  "tong-quan" | "tu-sach" | "quan-ly-vien" | "nhat-ky" | "gop-y" | "cai-dat";

const ADMIN_NAV: { key: AdminNavKey; label: string; icon: LucideIcon }[] = [
  { key: "tong-quan", label: "Tổng quan", icon: LayoutDashboard },
  { key: "tu-sach", label: "Tủ sách", icon: Archive },
  { key: "quan-ly-vien", label: "Quản lý viên", icon: KeyRound },
  { key: "nhat-ky", label: "Nhật ký", icon: ScrollText },
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
    // The sidebar is sticky and the document scrolls normally. The previous
    // shell locked the wrapper to the viewport and let main scroll inside it,
    // which broke as soon as anything added a stray pixel: html measured 914px
    // against a 900px body, so the page scrolled 14px, dragging the fixed-height
    // sidebar up and leaving a band of empty paper beneath it.
    <div className="flex min-h-dvh flex-col md:flex-row">
      <MobileBar
        title="OLibra"
        subtitle="Quản trị hệ thống"
        items={ADMIN_NAV.map(({ key, label, icon }) => ({
          href: key === "tong-quan" ? "/quan-tri" : `/quan-tri/${key}`,
          label,
          icon,
          // No badge anywhere in the super-admin nav, and never one written
          // here: `/quan-tri/*` is Phase 3 and every one of its pages still
          // renders fixtures.
          count: null,
        }))}
      />
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col self-start border-r border-hairline bg-paper md:flex">
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

      <main className="min-w-0 flex-1 px-6 py-8 md:px-10 md:py-10">
        {/* Constrain the measure. Without a max-width, lines on a wide
            monitor run past 130 characters and a row's action drifts half
            a screen from the text it belongs to. */}
        <div className="mx-auto w-full max-w-5xl">{children}</div>
      </main>
    </div>
  );
}
