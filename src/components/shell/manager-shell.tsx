import Link from "next/link";
import {
  Archive,
  BarChart3,
  BookDown,
  BookUp,
  Bookmark,
  Library,
  Cog,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  Gift,
  MessageSquare,
  Megaphone,
  ScrollText,
  ShieldCheck,
  Tags,
  TriangleAlert,
  UserPen,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";
import { signOutAction } from "@/app/dang-nhap/actions";
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
 * The counts the sidebar can honestly show — `ManagerBadgeCounts` from
 * `src/domain/shelf/queries/get-manager-dashboard.ts`, restated structurally
 * for the reason `ShellViewer` above gives.
 *
 * Three when U3 wrote this, and `pendingRequests` since C2 shipped the query
 * behind it. Adding a field here is safe in exactly one direction: a page still
 * passing the three-field shape stops compiling, which is what forces the count
 * to be *queried* rather than defaulted to zero.
 */
export interface ShellCounts {
  pendingRegistrations: number;
  pendingProfileChanges: number;
  pendingRequests: number;
  overdue: number;
  pendingDonations: number;
  pendingComments: number;
}

/**
 * Which page is being rendered. **Wider than `NAV` below**, deliberately:
 * `tang-sach` and `binh-luan` no longer have a nav entry (see `NAV`) but their
 * routes still exist as fixture pages and still have to say which page they
 * are. Narrowing the union would be deleting two routes, which is a different
 * decision from removing two links. `yeu-cau-muon` was the third until C2
 * shipped the query behind it and put its entry back.
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
  | "nhat-ky"
  | "thong-bao"
  | "thong-ke"
  | "cai-dat";

/**
 * The sidebar, the three entries that left it (U3 §3.1), and the one that came
 * back (C2).
 *
 * This shipped with six hard-coded badge counts — `Đăng ký chờ duyệt 5`,
 * `Đổi thông tin 2`, `Yêu cầu mượn 2`, `Tặng sách 3`, `Quá hạn 3`,
 * `Bình luận 1` — on manager pages six of which have shown real books, from a
 * real parish, since U1. Three of the six belonged to slices that did not
 * exist: **Yêu cầu mượn** was C2's borrow-request queue, **Tặng sách** and
 * **Bình luận** are B3's donations and comments. No query in this codebase
 * could answer them and no page behind them did anything.
 *
 * **So the badge went, and the nav entry with it.** Showing the fixture number
 * is a lie. Showing `0` is a different lie, and a worse-shaped one: a volunteer
 * reads "no comments waiting" and stops checking, which is a false statement
 * about a queue nothing is reading. This is U2's answer to the same question
 * one page earlier — it removed the header's links to unwired reader pages —
 * and it is the same reason: mixed into chrome whose other half is real, an
 * invented number is indistinguishable from data.
 *
 * **And so the entry comes back when the query does.** C2 shipped
 * `GetBorrowRequestQueue` and `countQueuedRequests`, so **Yêu cầu mượn** is a
 * number somebody measured and a page that reads the database — which is the
 * whole of what U3 §3.1 asked for. The removal was never about the link; it was
 * about the number beside it.
 *
 * **All three are now back.** B3 shipped the donations and comments queries and
 * U5 wired the two screens, so `Tặng sách` and `Bình luận` carry counts somebody
 * measured. Every badge in this nav is now a field of `ShellCounts` filled by
 * `getManagerBadgeCounts`, and no entry in it is a link to a fixture page.
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
  {
    key: "yeu-cau-muon",
    label: "Yêu cầu mượn",
    icon: Bookmark,
    badge: "pendingRequests",
  },
  {
    key: "tang-sach",
    label: "Tặng sách",
    icon: Gift,
    badge: "pendingDonations",
  },
  {
    key: "binh-luan",
    label: "Bình luận",
    icon: MessageSquare,
    badge: "pendingComments",
  },
  { key: "qua-han", label: "Quá hạn", icon: TriangleAlert, badge: "overdue" },
  // P1. No badge: an audit log has no queue waiting on anybody, so there is no
  // number to show and §3.1's rule about invented counts does not arise. The
  // icon is `ScrollText`, the same one the super-admin nav already uses for its
  // own (cross-shelf, Phase 3) Nhật ký, so the two read as the same thing at
  // two scopes.
  { key: "nhat-ky", label: "Nhật ký", icon: ScrollText },
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
  signOut,
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
  /**
   * Whether to close the menu with **Đăng xuất**.
   *
   * `false` on a shell with no viewer — an unwired page has no session to end
   * and offering to end one would be the same invention `viewer={null}` exists
   * to refuse. Below 768px the sidebar is hidden entirely, so this menu is the
   * *only* place a sign-out can live on a phone, which is the device the
   * argument for having one is about.
   */
  signOut: boolean;
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
            {signOut ? (
              // The same mechanism and the same word as `public-header.tsx`'s
              // `MobileMenu`: a `<form>` posting the shipped `signOutAction`,
              // which ends the row in `sessions` rather than only clearing the
              // cookie. No new Vietnamese — "Đăng xuất" is already the label
              // there.
              <form action={signOutAction}>
                <button
                  type="submit"
                  className="mt-1 flex min-h-11 w-full items-center rounded-control border border-hairline px-3 text-left text-[16px] font-semibold hover:bg-paper"
                >
                  Đăng xuất
                </button>
              </form>
            ) : null}
          </div>
        </details>
      </div>
    </div>
  );
}

/**
 * Manager chrome: a sidebar on desktop. Below 768px the sidebar is hidden and
 * `MobileBar` above takes over — a compact bar whose nav is a `<details>`
 * hamburger, which is what it has actually been since that component was
 * written. This paragraph said "the sidebar becomes a horizontal scroll strip",
 * which was inherited and was never true of this file. The five-item bottom tab
 * bar belongs to the mobile work, which is out of scope here (web only).
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
        signOut={Boolean(viewer?.name)}
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
            {/* **The way out.** Until this, there was no sign-out anywhere in
                the manager chrome — across eleven pages that put a named
                volunteer, a child's date of birth, both parents' names and a
                family telephone number on screen, on what
                `nguoi-doc/moi/page.tsx` and `actions.ts` both argue at length is
                "the address bar of a shared parish phone". `public-header.tsx`
                has had one since it was written; this side of the app did not,
                and a session a volunteer cannot end is the whole threat those
                two files describe, left standing.

                Same mechanism, same copy: a `<form>` posting `signOutAction`,
                an icon button with the `aria-label` the public header uses. It
                sits inside the `viewer?.name` block on purpose — the button is
                only correct when there is a session to end, and that condition
                is already this block's condition. */}
            <form action={signOutAction} className="ml-auto flex shrink-0">
              <button
                type="submit"
                aria-label="Đăng xuất"
                className="inline-flex size-11 items-center justify-center rounded-control text-meta hover:text-ink"
              >
                <LogOut aria-hidden className="size-5" strokeWidth={1.75} />
              </button>
            </form>
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
  | "tong-quan"
  | "tu-sach"
  | "the-loai"
  | "quan-ly-vien"
  | "nhat-ky"
  | "gop-y"
  | "cai-dat";

const ADMIN_NAV: { key: AdminNavKey; label: string; icon: LucideIcon }[] = [
  { key: "tong-quan", label: "Tổng quan", icon: LayoutDashboard },
  { key: "tu-sach", label: "Tủ sách", icon: Archive },
  // Task 2 (QA remediation). Global reference data, so it sits with the other
  // cross-shelf administration screens rather than under any one shelf.
  { key: "the-loai", label: "Thể loại", icon: Tags },
  { key: "quan-ly-vien", label: "Quản lý viên", icon: KeyRound },
  { key: "nhat-ky", label: "Nhật ký", icon: ScrollText },
  { key: "gop-y", label: "Góp ý", icon: MessageSquare },
  { key: "cai-dat", label: "Cài đặt", icon: Cog },
];

/**
 * Super-admin chrome — the whole network, not one shelf.
 *
 * **`viewer` and `unreadFeedback` are `null` on a page that has not been wired**,
 * exactly as `ManagerShell`'s two are, and for the reason its `ShellViewer`
 * docstring gives: an unwired page must not be able to invent either. B4a wires
 * `gop-y` and leaves the other six as they are, so both shapes have to admit
 * "this page knows nothing" as a value rather than as a default.
 *
 * The badge is `unreadFeedback` alone rather than a `ShellCounts`-shaped bag.
 * `ADMIN_NAV` has six entries and exactly one of them has a queue that can be
 * behind — every other administration page is a list of things that exist, not
 * of things waiting. A record keyed by nav key would be five nulls and a number.
 */
export function AdminShell({
  active,
  viewer,
  unreadFeedback,
  children,
}: {
  active: AdminNavKey;
  /** `null` on a page that has not been wired to `loadAdminPage` yet. */
  viewer: ShellViewer | null;
  /** `null` on a page that has not counted them. Never a written-in number. */
  unreadFeedback: number | null;
  children: React.ReactNode;
}) {
  // Same rule as `ManagerShell`: the last word of a Vietnamese name is the
  // given name, and a badge is absent rather than `0` when the queue is empty.
  const initial = viewer?.name?.split(" ").at(-1)?.charAt(0) ?? null;
  const badge = unreadFeedback && unreadFeedback > 0 ? unreadFeedback : null;

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
          count: key === "gop-y" ? badge : null,
        }))}
        // Only where there is a session to end — the same condition the
        // manager shell uses, and the reason it is a condition rather than a
        // constant: six of these seven pages are still unwired and resolve no
        // viewer at all.
        signOut={Boolean(viewer?.name)}
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
                <span className="flex-1 truncate">{label}</span>
                {key === "gop-y" && badge !== null ? (
                  <span className="rounded-control bg-surface px-1.5 text-[13px] font-semibold text-leather">
                    {NUMBER.format(badge)}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>

        {/* The person actually signed in, and until B4a this was the constants
            "A", "Giuse Trần Quốc Anh" and "Quản trị viên" — the same defect
            `ManagerShell` carried above, one shell over, on the seven pages
            with the widest reach in the application. `roleLabel` is not used
            here: every viewer who can render this shell is a `super_admin` by
            construction (`loadAdminPage` refuses everyone else), so the word
            is a fact about the surface rather than a lookup. */}
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
              <span className="block text-[13px] text-meta">Quản trị viên</span>
            </span>
            <form action={signOutAction} className="ml-auto flex shrink-0">
              <button
                type="submit"
                aria-label="Đăng xuất"
                className="inline-flex size-11 items-center justify-center rounded-control text-meta hover:text-ink"
              >
                <LogOut aria-hidden className="size-5" strokeWidth={1.75} />
              </button>
            </form>
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
