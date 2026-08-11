import Link from "next/link";
// Relative, not the `@/` alias: `Chip` below is exercised by
// `tests/components/filter-chips.test.tsx` through `filter-chips.tsx`, and
// `vitest.config.ts` has no `resolve.alias` for `@/` (deliberately, per the
// branch's QA-remediation constraints — `reader-tabs.tsx` and
// `public-header.tsx` carry the identical note for the identical reason).
import { cn } from "../../lib/utils";

/**
 * A segmented control, not a dropdown — the đang có / toàn bộ toggle is the
 * single most-used control on the catalogue, so it stays visible and one tap
 * away.
 */
export function Segmented({
  options,
  className,
}: {
  options: {
    href: string;
    label: string;
    icon?: React.ComponentType<{ className?: string; strokeWidth?: number }>;
    active?: boolean;
  }[];
  className?: string;
}) {
  return (
    <div
      className={cn(
        // flex-wrap + full width at base: four fixed-height pills overflowed a
        // 375px viewport and labels rendered outside their own pill.
        "flex w-full flex-wrap gap-1 rounded-card border border-hairline bg-paper p-1 sm:inline-flex sm:w-auto",
        className,
      )}
    >
      {options.map(({ href, label, icon: Icon, active }) => (
        <Link
          key={href}
          href={href}
          aria-current={active ? "true" : undefined}
          className={cn(
            "inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-control px-2 py-1 text-center text-[14px] font-semibold",
            active
              ? "border border-terracotta bg-surface text-terracotta-ink"
              : "border border-transparent text-meta hover:text-ink",
          )}
        >
          {Icon ? <Icon className="size-5" strokeWidth={1.75} /> : null}
          {label}
        </Link>
      ))}
    </div>
  );
}

/**
 * Filter chips — used where a dropdown would hide the counts.
 *
 * `aria-current="page"` on the active one (Task 14, 2026-08-10 QA remediation
 * — P3-4). `Segmented` above has carried the equivalent since it was written;
 * this sibling did not, on every one of its nine call sites at once, because
 * each renders its own chip row and none of them could have fixed it alone.
 * `"page"`, not `"true"`: an active chip *is* the current page for the filter
 * it names, in the same sense a nav link's current page is — `Segmented`
 * already uses `"true"` for a different reason (a segmented control is a
 * choice among views, not a location), and this control is closer to
 * `nguoi-doc/page.tsx`'s own `hrefWith`-built links than to that one.
 */
export function Chip({
  children,
  active,
  href,
}: {
  children: React.ReactNode;
  active?: boolean;
  href: string;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "inline-flex min-h-11 items-center rounded-control border px-4 text-[15px]",
        active
          ? "border-terracotta bg-surface font-semibold text-terracotta-ink"
          : "border-hairline bg-paper text-meta hover:text-ink",
      )}
    >
      {children}
    </Link>
  );
}
