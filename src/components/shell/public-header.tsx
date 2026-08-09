import Link from "next/link";
import { LogOut, Menu, Search } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { signOutAction } from "@/app/dang-nhap/actions";

/**
 * Below 768px the nav collapses to a hamburger (DESIGN.md §Navigation).
 * Built on <details>/<summary> so it works without client JavaScript — these
 * pages are otherwise entirely static server components.
 */
function MobileMenu({
  links,
  trailing,
}: {
  links: readonly { href: string; label: string; key: string }[];
  trailing?: { action: (formData: FormData) => Promise<void>; label: string };
}) {
  return (
    <details className="relative md:hidden [&_svg]:open:rotate-90">
      <summary className="flex size-11 cursor-pointer list-none items-center justify-center rounded-control hover:bg-surface [&::-webkit-details-marker]:hidden">
        <span className="sr-only">Mở menu</span>
        <Menu
          aria-hidden
          className="size-6 transition-transform duration-150"
          strokeWidth={1.75}
        />
      </summary>
      <div className="absolute right-0 z-20 mt-2 w-56 rounded-card border border-hairline bg-surface p-2">
        {links.map((link) => (
          <Link
            key={link.key}
            href={link.href}
            className="flex min-h-11 items-center rounded-control px-3 text-[15px] hover:bg-paper"
          >
            {link.label}
          </Link>
        ))}
        {trailing ? (
          <form action={trailing.action}>
            <button
              type="submit"
              className="mt-1 flex min-h-11 w-full items-center rounded-control border border-hairline px-3 text-left text-[15px] font-semibold hover:bg-paper"
            >
              {trailing.label}
            </button>
          </form>
        ) : null}
      </div>
    </details>
  );
}

/**
 * The header for a shelf.
 *
 * A bookshelf is no longer public (§1.2) — everything behind this header
 * requires a membership of *this* shelf — so on a shelf page it carries the
 * signed-in reader rather than a "Đăng nhập" button. There is no shelf
 * switcher: a reader belongs to one shelf, and seeing another parish's name
 * here would only raise a question the product does not answer.
 *
 * **`viewerName` is required and nullable, and both halves are deliberate.**
 *
 * This shipped with `reader = "Giuse Trần Minh"` — a default, imported
 * alongside a fixture `Shelf` — so every shelf page in the app rendered real
 * books under a stranger's name, which reads as working and is not. A *default*
 * is what made that survive: a page that never thought about identity got a
 * plausible one for free. With no default, wiring a page is a compile error
 * until somebody answers the question, which is the property worth having while
 * forty-one pages are still to be wired. `src/lib/page-data.ts`'s `Viewer`
 * carries the answer — see `viewerFor` there for why the name is resolved in
 * the seam and not here.
 *
 * The type is a plain `string | null` rather than that module's `Viewer`
 * *on purpose*: `tests/architecture/pages-reading-the-database-are-dynamic.ts`
 * walks import specifiers as text, so `import type { Viewer } from
 * "@/lib/page-data"` in this file would make every page that renders any header
 * in it — the landing page and the two auth forms included — count as reaching
 * Postgres, and the guard would then demand `force-dynamic` on pages that issue
 * no SQL at all.
 *
 * **Null is a real case, not a fallback.** This same header renders on
 * `/dang-nhap` and `/dang-ky`, where there is no member by definition. Those
 * get the front door's "Đăng nhập" button and *no member navigation*: Danh mục,
 * Thông báo, Tìm kiếm and Trang của tôi all require a membership (§1.2), so
 * offering them to somebody who is looking at a sign-in form is chrome that
 * cannot do what it says. The shelf's name stays, because a shelf's existence
 * is public — that is what `bookshelves_public_read` is for, and it is how a
 * visitor arriving from the portal knows which parish they are signing in to.
 */
export function ShelfHeader({
  shelfName,
  shelfSlug,
  active,
  viewerName,
}: {
  shelfName: string;
  shelfSlug: string;
  active?: "danh-muc" | "thong-bao" | "tim-kiem" | "toi";
  viewerName: string | null;
}) {
  const base = `/tu-sach/${shelfSlug}`;
  const links = [
    { href: `${base}/danh-muc`, label: "Danh mục", key: "danh-muc", icon: false },
    {
      href: `${base}/thong-bao`,
      label: "Thông báo",
      key: "thong-bao",
      icon: false,
    },
    { href: `${base}/tim-kiem`, label: "Tìm kiếm", key: "tim-kiem", icon: true },
    { href: `${base}/toi`, label: "Trang của tôi", key: "toi", icon: false },
  ] as const;

  // The shelf's own name links to the shelf home, which a signed-out visitor
  // cannot reach — `loadPage` would send them straight back to sign in. So for
  // them it is text, not a dead link that quietly bounces.
  const title = viewerName ? (
    <Link href={base} className="min-w-0 truncate text-lg font-semibold">
      {shelfName}
    </Link>
  ) : (
    <span className="min-w-0 truncate text-lg font-semibold">{shelfName}</span>
  );

  return (
    <header className="border-b border-hairline bg-paper">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-6">
        {title}

        {viewerName === null ? (
          <nav className="flex items-center gap-1">
            <ButtonLink href="/dang-nhap" size="sm">
              Đăng nhập
            </ButtonLink>
          </nav>
        ) : (
          <>
            <nav className="hidden items-center gap-1 md:flex">
              {links.map((link) => (
                <Link
                  key={link.key}
                  href={link.href}
                  className={
                    "inline-flex min-h-11 items-center gap-1.5 rounded-control px-3 text-[15px] " +
                    (active === link.key
                      ? "font-semibold text-terracotta-ink"
                      : "text-ink hover:text-terracotta-ink")
                  }
                >
                  {link.icon ? (
                    <Search
                      aria-hidden
                      className="size-[18px]"
                      strokeWidth={1.75}
                    />
                  ) : null}
                  {link.label}
                </Link>
              ))}

              <span aria-hidden className="mx-2 h-6 w-px bg-hairline" />

              <span className="flex items-center gap-2 text-[15px]">
                <span
                  aria-hidden
                  className="flex size-8 items-center justify-center rounded-full bg-surface text-[14px] font-semibold text-leather"
                >
                  {/* The last word of a Vietnamese name is the given name —
                      "Maria Nguyễn Thị Lan" initials as L, not M. Kept from the
                      fixture-era header, which had it right. */}
                  {viewerName.split(" ").at(-1)?.charAt(0)}
                </span>
                <span className="max-w-40 truncate">{viewerName}</span>
              </span>
              <form action={signOutAction} className="ml-1 flex">
                <button
                  type="submit"
                  aria-label="Đăng xuất"
                  className="inline-flex size-11 items-center justify-center rounded-control text-meta hover:text-ink"
                >
                  <LogOut aria-hidden className="size-5" strokeWidth={1.75} />
                </button>
              </form>
            </nav>

            <MobileMenu
              links={links}
              trailing={{ action: signOutAction, label: "Đăng xuất" }}
            />
          </>
        )}
      </div>
    </header>
  );
}

/**
 * The front door. Landing, portal, contact and the two auth screens — the
 * only pages a person with no account can reach (§1.2).
 */
export function FrontDoorHeader() {
  return (
    <header className="border-b border-hairline bg-paper">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-6 px-6">
        <Link href="/" className="text-xl font-semibold">
          OLibra
        </Link>
        <nav className="flex items-center gap-1">
          <Link
            href="/tu-sach"
            className="inline-flex min-h-11 items-center rounded-control px-3 text-[15px] hover:text-terracotta-ink"
          >
            Tìm tủ sách
          </Link>
          <ButtonLink href="/dang-nhap" size="sm" className="ml-1">
            Đăng nhập
          </ButtonLink>
        </nav>
      </div>
    </header>
  );
}

export function FrontDoorFooter() {
  return (
    <footer className="mt-24 border-t border-hairline bg-paper">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-8">
        <span className="text-lg font-semibold">OLibra</span>
        <nav className="flex flex-wrap gap-4 text-[14px] text-meta">
          <Link href="/tu-sach" className="hover:text-ink">
            Tìm tủ sách
          </Link>
          <Link href="/lien-he" className="hover:text-ink">
            Liên hệ
          </Link>
        </nav>
        <span className="text-[14px] text-meta">© 2026 OLibra</span>
      </div>
    </footer>
  );
}
