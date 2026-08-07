import Link from "next/link";
import { cn } from "@/lib/utils";

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
        "inline-flex gap-1 rounded-card border border-hairline bg-paper p-1",
        className,
      )}
    >
      {options.map(({ href, label, icon: Icon, active }) => (
        <Link
          key={href}
          href={href}
          aria-current={active ? "true" : undefined}
          className={cn(
            "inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-control px-5 text-[17px] font-semibold",
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

/** Filter chips — used where a dropdown would hide the counts. */
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
      className={cn(
        "inline-flex min-h-11 items-center rounded-control border px-4 text-[16px]",
        active
          ? "border-terracotta bg-surface font-semibold text-terracotta-ink"
          : "border-hairline bg-paper text-meta hover:text-ink",
      )}
    >
      {children}
    </Link>
  );
}
