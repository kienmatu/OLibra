import Link from "next/link";
import { Search } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import type { Shelf } from "@/lib/fixtures";

/** Public top bar: shelf name, catalogue, announcements, search, login. */
export function PublicHeader({
  shelf,
  active,
}: {
  shelf: Shelf;
  active?: "danh-muc" | "thong-bao" | "tim-kiem";
}) {
  const base = `/tu-sach/${shelf.slug}`;
  const links = [
    { href: `${base}/danh-muc`, label: "Danh mục", key: "danh-muc", icon: false },
    {
      href: `${base}/thong-bao`,
      label: "Thông báo",
      key: "thong-bao",
      icon: false,
    },
    { href: `${base}/tim-kiem`, label: "Tìm kiếm", key: "tim-kiem", icon: true },
  ] as const;

  return (
    <header className="border-b border-hairline bg-paper">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-6">
        <Link href={base} className="text-xl font-semibold">
          {shelf.name}
        </Link>

        <nav className="flex items-center gap-1">
          {links.map((link) => (
            <Link
              key={link.key}
              href={link.href}
              className={
                "inline-flex min-h-11 items-center gap-1.5 rounded-control px-3 text-[16px] " +
                (active === link.key
                  ? "font-semibold text-terracotta-ink"
                  : "text-ink hover:text-terracotta-ink")
              }
            >
              {link.icon ? (
                <Search aria-hidden className="size-[18px]" strokeWidth={1.75} />
              ) : null}
              {link.label}
            </Link>
          ))}
          <ButtonLink href="/dang-nhap" size="sm" className="ml-2">
            Đăng nhập
          </ButtonLink>
        </nav>
      </div>
    </header>
  );
}

/** Marketing top bar — the OLibra project itself, not one shelf. */
export function MarketingHeader({
  active,
}: {
  active?: "gioi-thieu" | "bai-viet" | "lien-he";
}) {
  const links = [
    { href: "/gioi-thieu", label: "Giới thiệu", key: "gioi-thieu" },
    { href: "/bai-viet", label: "Bài viết", key: "bai-viet" },
    { href: "/lien-he", label: "Liên hệ", key: "lien-he" },
  ] as const;

  return (
    <header className="border-b border-hairline bg-paper">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-6 px-6">
        <Link href="/" className="text-xl font-semibold">
          OLibra
        </Link>
        <nav className="flex items-center gap-1">
          {links.map((link) => (
            <Link
              key={link.key}
              href={link.href}
              className={
                "inline-flex min-h-11 items-center rounded-control px-3 text-[16px] " +
                (active === link.key
                  ? "font-semibold text-terracotta-ink"
                  : "text-ink hover:text-terracotta-ink")
              }
            >
              {link.label}
            </Link>
          ))}
          <ButtonLink href="/tu-sach" size="sm" className="ml-2">
            Vào cổng tủ sách
          </ButtonLink>
        </nav>
      </div>
    </header>
  );
}

export function MarketingFooter() {
  return (
    <footer className="mt-24 border-t border-hairline bg-paper">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-8">
        <span className="text-lg font-semibold">OLibra</span>
        <nav className="flex flex-wrap gap-4 text-[15px] text-meta">
          <Link href="/gioi-thieu" className="hover:text-ink">
            Giới thiệu
          </Link>
          <Link href="/bai-viet" className="hover:text-ink">
            Bài viết
          </Link>
          <Link href="/lien-he" className="hover:text-ink">
            Liên hệ
          </Link>
          <Link href="/tu-sach" className="hover:text-ink">
            Cổng tủ sách
          </Link>
        </nav>
        <span className="text-[15px] text-meta">© 2026 OLibra</span>
      </div>
    </footer>
  );
}
