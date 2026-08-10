import Link from "next/link";
// Relative, not `@/lib/utils`: this component is exercised by
// `tests/components/reader-tabs.test.tsx`, and `vitest.config.ts` has no
// `resolve.alias` for `@/` (deliberately, per the branch's QA-remediation
// constraints) — an alias import here would make the component unimportable
// under Vitest, not just untested.
import { cn } from "../../lib/utils";

const TABS = [
  { key: "trang-cua-toi", label: "Trang của tôi", path: "ho-so/tong-quan" },
  { key: "lich-su", label: "Lịch sử mượn", path: "ho-so/lich-su" },
  { key: "tang-sach", label: "Tặng sách", path: "ho-so/tang-sach" },
  // The area index sits fourth, after the three sub-pages, deliberately: this
  // list mirrors the order readers already saw before the /toi -> /ho-so
  // rename (task 7), and reordering it here would move every tab on screen
  // for no functional reason.
  { key: "ho-so", label: "Hồ sơ", path: "ho-so" },
  { key: "thong-bao", label: "Thông báo", path: "ho-so/thong-bao" },
] as const;

/**
 * Quiet secondary nav for the reader's own corner of the shelf — "Trang của
 * tôi", "Lịch sử mượn", "Hồ sơ", "Thông báo". Text only, no icons, no fills;
 * the active tab is marked with a 2px terracotta underline and nothing else.
 * Used only on the reader's own pages, never on manager or catalogue pages.
 *
 * **Derives its own active tab from `pathname`; it used to take one as a
 * prop, and that was the bug.** An explicit `active` key is a fact every
 * caller must independently get right, and three of the five callers didn't:
 * `/toi/tang-sach`, `/toi/lich-su` and `/toi/thong-bao` all passed
 * `"trang-cua-toi"`, so "Trang của tôi" carried `aria-current="page"` and the
 * terracotta underline on every one of those pages while the tab for the page
 * actually being viewed sat inert (2026-08-10 QA remediation, task 8). A
 * value the component can compute from something it is already given —
 * the URL it is rendering into — has no business being a second input that
 * can disagree with the first.
 *
 * The five reader pages are server components, so `pathname` is the literal
 * the page already knows (e.g. `` `/tu-sach/${slug}/ho-so/lich-su` ``), not
 * `usePathname()` — reaching for that hook would make them client components
 * for no reason.
 *
 * Matching is exact equality against `pathname`, never `startsWith`:
 * `/ho-so` is a string-prefix of `/ho-so/lich-su`, so a prefix match would
 * light up "Hồ sơ" on every page in the area, which is this same bug shipped
 * from the other direction.
 */
export function ReaderTabs({
  shelfSlug,
  pathname,
}: {
  shelfSlug: string;
  pathname: string;
}) {
  const base = `/tu-sach/${shelfSlug}`;

  return (
    <nav className="border-b border-hairline bg-surface">
      <div className="mx-auto flex max-w-5xl gap-6 px-6">
        {TABS.map((tab) => {
          const isActive = `${base}/${tab.path}` === pathname;
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
