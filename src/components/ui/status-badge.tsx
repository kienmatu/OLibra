import { cn } from "@/lib/utils";
import { STATUS, type CopyStatus } from "@/lib/status";

/**
 * A soft tinted pill: 10% fill, status ink for icon and word, no border.
 * There is no prop that lets a caller drop the icon or the label — that is
 * the point.
 */
export function StatusBadge({
  status,
  className,
  size = "md",
}: {
  status: CopyStatus;
  className?: string;
  size?: "sm" | "md";
}) {
  const { label, icon: Icon, ink, fill } = STATUS[status];

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-control font-medium",
        fill,
        ink,
        size === "sm" ? "px-2 py-0.5 text-[15px]" : "px-2.5 py-1 text-[15px]",
        className,
      )}
    >
      <Icon aria-hidden className="size-[18px]" strokeWidth={1.75} />
      {label}
    </span>
  );
}

/**
 * The large availability panel on a book page. Same tint, plus a 1px border
 * in the status ink — never a saturated filled block.
 */
export function StatusPanel({
  status,
  children,
  className,
}: {
  status: CopyStatus;
  children?: React.ReactNode;
  className?: string;
}) {
  const { label, icon: Icon, ink, fill, border } = STATUS[status];

  return (
    <div className={cn("rounded-card border p-6", fill, border, className)}>
      <p className={cn("flex items-center gap-2.5 text-[22px] font-semibold", ink)}>
        <Icon aria-hidden className="size-6" strokeWidth={1.75} />
        {label}
      </p>
      {children ? <div className="mt-2 space-y-1">{children}</div> : null}
    </div>
  );
}
