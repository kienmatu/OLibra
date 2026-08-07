import Link from "next/link";
import { cn } from "@/lib/utils";
import { coverForTitle } from "@/lib/fixtures";
import { StatusBadge } from "./status-badge";
import type { CopyStatus } from "@/lib/status";

/**
 * The ONLY serif in the product. If you are about to set a serif on anything
 * that is not the name of a book, use Lexend instead — so book titles go
 * through this component and nothing else reaches for `font-serif`.
 */
export function BookTitle({
  children,
  className,
  as: Tag = "span",
}: {
  children: React.ReactNode;
  className?: string;
  as?: "span" | "h1" | "h2" | "h3" | "p";
}) {
  return (
    <Tag className={cn("font-serif font-semibold", className)}>{children}</Tag>
  );
}

/* A small set of sun-faded kraft tones. The colour is derived from the title
   so the same book always gets the same cover and the grid never looks broken. */
const KRAFT = [
  "#E4D7C3",
  "#DFD3C8",
  "#E6D9CC",
  "#DCD2BE",
  "#E2D5CB",
  "#D9CFC0",
] as const;

function kraftFor(title: string) {
  let hash = 0;
  for (let i = 0; i < title.length; i += 1) {
    hash = (hash * 31 + title.charCodeAt(i)) >>> 0;
  }
  return KRAFT[hash % KRAFT.length];
}

/** Cover placeholder at a 2:3 ratio carrying the title's first letter. */
export function BookCover({
  title,
  className,
}: {
  title: string;
  className?: string;
}) {
  const letter = title.trim().charAt(0).toUpperCase();
  const art = coverForTitle(title);

  return (
    <div
      aria-hidden
      style={{
        backgroundColor: kraftFor(title),
        backgroundImage: art ? `url("${art}")` : undefined,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
      className={cn(
        "flex aspect-2/3 shrink-0 items-center justify-center overflow-hidden rounded-control border border-hairline",
        className,
      )}
    >
      {/* The generated letter shows only when there is no artwork, so the grid
          never looks broken for a book nobody has photographed yet. */}
      {art ? null : (
        <span className="font-serif text-[2.5em] font-semibold text-ink/25">
          {letter}
        </span>
      )}
    </div>
  );
}

/** Cover-dominant catalogue card: title clamped to two lines, author to one. */
export function BookCard({
  href,
  title,
  author,
  status,
}: {
  href: string;
  title: string;
  author: string;
  status: CopyStatus;
}) {
  return (
    <Link href={href} className="group block">
      <div className="relative">
        <BookCover title={title} className="w-full text-[1.5rem]" />
        <StatusBadge
          status={status}
          size="sm"
          className="absolute bottom-2 left-2 bg-surface/90 backdrop-blur-none"
        />
      </div>
      <BookTitle className="mt-2.5 line-clamp-2 block text-[16px] leading-snug group-hover:text-terracotta-ink">
        {title}
      </BookTitle>
      <span className="mt-0.5 line-clamp-1 block text-[13px] text-meta">
        {author}
      </span>
    </Link>
  );
}
