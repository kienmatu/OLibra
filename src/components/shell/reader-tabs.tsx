import Link from "next/link";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "trang-cua-toi", label: "Trang của tôi", path: "toi" },
  { key: "lich-su", label: "Lịch sử mượn", path: "toi/lich-su" },
  { key: "tang-sach", label: "Tặng sách", path: "toi/tang-sach" },
  { key: "ho-so", label: "Hồ sơ", path: "toi/ho-so" },
  { key: "thong-bao", label: "Thông báo", path: "toi/thong-bao" },
] as const;

export type ReaderTabKey = (typeof TABS)[number]["key"];

/**
 * Quiet secondary nav for the reader's own corner of the shelf — "Trang của
 * tôi", "Lịch sử mượn", "Hồ sơ", "Thông báo". Text only, no icons, no fills;
 * the active tab is marked with a 2px terracotta underline and nothing else.
 * Used only on the reader's own pages, never on manager or catalogue pages.
 */
export function ReaderTabs({
  shelfSlug,
  active,
}: {
  shelfSlug: string;
  active: ReaderTabKey;
}) {
  const base = `/tu-sach/${shelfSlug}`;

  return (
    <nav className="border-b border-hairline bg-surface">
      <div className="mx-auto flex max-w-5xl gap-6 px-6">
        {TABS.map((tab) => {
          const isActive = tab.key === active;
          return (
            <Link
              key={tab.key}
              href={`${base}/${tab.path}`}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "inline-flex h-12 items-center border-b-2 text-[15px]",
                isActive
                  ? "border-terracotta font-semibold text-ink"
                  : "border-transparent text-meta hover:text-ink",
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
