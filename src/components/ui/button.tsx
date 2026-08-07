import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * One primary action per screen. `primary` is solid terracotta and is meant to
 * appear exactly once — if two things on a screen are terracotta, one of them
 * is wrong.
 *
 * Every size clears the 44px minimum target; `lg` is the 56px primary height.
 */
type Variant = "primary" | "outline" | "quiet" | "danger" | "ghost";
type Size = "lg" | "md" | "sm";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-terracotta text-white hover:bg-terracotta-ink border border-transparent",
  outline:
    "border-2 border-terracotta text-terracotta-ink bg-transparent hover:bg-terracotta/8",
  quiet: "border border-hairline bg-surface text-ink hover:bg-paper",
  danger: "border border-brick text-brick bg-transparent hover:bg-brick/8",
  ghost: "text-meta hover:text-ink bg-transparent border border-transparent",
};

const SIZES: Record<Size, string> = {
  lg: "h-14 px-6 text-[17px]",
  md: "h-12 px-5 text-[16px]",
  sm: "h-11 px-4 text-[15px]",
};

type BaseProps = {
  variant?: Variant;
  size?: Size;
  className?: string;
  children: React.ReactNode;
};

function classes(variant: Variant, size: Size, className?: string) {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-control font-semibold",
    "transition-colors duration-150 ease-out",
    "disabled:pointer-events-none disabled:opacity-45",
    VARIANTS[variant],
    SIZES[size],
    className,
  );
}

export function Button({
  variant = "quiet",
  size = "md",
  className,
  children,
  ...props
}: BaseProps & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={classes(variant, size, className)} {...props}>
      {children}
    </button>
  );
}

export function ButtonLink({
  variant = "quiet",
  size = "md",
  className,
  children,
  href,
  ...props
}: BaseProps & { href: string } & Omit<
    React.ComponentProps<typeof Link>,
    "href" | "className" | "children"
  >) {
  return (
    <Link href={href} className={classes(variant, size, className)} {...props}>
      {children}
    </Link>
  );
}

/**
 * The oversized action pair on the dashboard and the shelf home — 96px tall,
 * sized for a thumb, with a sub-label explaining what happens next.
 */
export function BigActionLink({
  href,
  icon: Icon,
  label,
  sublabel,
  variant = "primary",
}: {
  href: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  sublabel: string;
  variant?: "primary" | "outline";
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex min-h-24 flex-1 items-center gap-4 rounded-card px-6 py-4",
        "transition-colors duration-150 ease-out",
        variant === "primary"
          ? "bg-terracotta text-white hover:bg-terracotta-ink"
          : "border-2 border-terracotta text-terracotta-ink hover:bg-terracotta/8",
      )}
    >
      <Icon className="size-7 shrink-0" strokeWidth={1.75} />
      <span className="min-w-0">
        <span className="block text-xl leading-tight font-semibold">{label}</span>
        <span
          className={cn(
            "mt-1 block text-[14px] leading-snug",
            variant === "primary" ? "text-white/75" : "text-meta",
          )}
        >
          {sublabel}
        </span>
      </span>
    </Link>
  );
}
