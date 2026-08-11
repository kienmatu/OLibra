import Link from "next/link";
import { cn } from "@/lib/utils";
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

/**
 * Cover placeholder at a 2:3 ratio carrying the title's first letter, or the
 * book's own photographed artwork when there is one.
 *
 * **`coverUrl` is `books.cover_url`, read by the caller's own query — never
 * looked up here.** This used to call `coverForTitle(title)` from
 * `src/lib/fixtures.ts`, which matched a book's *title* against eleven
 * invented fixture books and served that fixture's SVG on a match, on every
 * page this component rendered on, database-backed or not. A brand-new
 * parish, Giáo xứ Thánh Tâm, catalogued a book called "Dế Mèn Phiêu Lưu Ký" —
 * the same title one of the eleven fixtures carries — and its public book
 * page served `public/covers/de-men-phieu-luu-ky.svg`, whose caption line
 * read "Tủ sách Đồng Tháp": a different parish's name, printed on the
 * artwork, on a public page. `books.cover_url` had existed in the schema the
 * whole time; nothing read it. `tests/architecture/boundaries.test.ts`
 * ("no component reaches into the fixtures module") is what now forbids this
 * file — or any file under `src/components/` — reaching back into
 * `src/lib/fixtures.ts` for anything, cover art included.
 */
export function BookCover({
  title,
  coverUrl,
  className,
}: {
  title: string;
  /** `books.cover_url` — `null`/`undefined` for a title with no artwork on
   *  file, which today is essentially every book, since no manager screen
   *  writes this column yet. The kraft placeholder below is that case's
   *  honest rendering, not a broken image standing in for a missing one. */
  coverUrl?: string | null;
  className?: string;
}) {
  const letter = title.trim().charAt(0).toUpperCase();

  return (
    <div
      aria-hidden
      style={{
        backgroundColor: kraftFor(title),
        backgroundImage: coverUrl ? `url("${coverUrl}")` : undefined,
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
      {coverUrl ? null : (
        <span className="font-serif text-[2.5em] font-semibold text-ink/25">
          {letter}
        </span>
      )}
    </div>
  );
}

/**
 * Cover-dominant catalogue card: title clamped to two lines, author to one.
 *
 * `author` and `status` are both nullable now that the cards come from
 * `books`/`copies_borrowable` rather than from `src/lib/fixtures.ts`, and the
 * two nulls mean different things:
 *
 * - `books.author` is a nullable column. A title catalogued from a battered
 *   cover with no author on it renders as a card with no author line, which is
 *   what the shelf actually knows — never an empty grey strip holding the
 *   layout open for a fact nobody has.
 * - `status` is `null` for a title with no live copies at all, which
 *   `statusForAvailability` (`src/lib/status.ts`) refuses to give a badge.
 *   Reachable from `?loc=tat-ca`, where BR §16.1's "Toàn bộ tủ sách" is
 *   supposed to include exactly that title.
 */
export function BookCard({
  href,
  title,
  author,
  status,
  coverUrl,
}: {
  href: string;
  title: string;
  author: string | null;
  status: CopyStatus | null;
  /** `books.cover_url` — see `BookCover`'s own docstring for why this is a
   *  plain prop and never a lookup this component performs itself. */
  coverUrl?: string | null;
}) {
  return (
    <Link href={href} className="group block">
      <div className="relative">
        <BookCover
          title={title}
          coverUrl={coverUrl}
          className="w-full text-[1.5rem]"
        />
        {status ? (
          <StatusBadge
            status={status}
            size="sm"
            className="absolute bottom-2 left-2 bg-surface/90 backdrop-blur-none"
          />
        ) : null}
      </div>
      <BookTitle className="mt-2.5 line-clamp-2 block text-[16px] leading-snug group-hover:text-terracotta-ink">
        {title}
      </BookTitle>
      {author ? (
        <span className="mt-0.5 line-clamp-1 block text-[13px] text-meta">
          {author}
        </span>
      ) : null}
    </Link>
  );
}
