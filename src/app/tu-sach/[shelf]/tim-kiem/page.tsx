import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, Search, SearchX } from "lucide-react";
import { BookCover, BookTitle } from "@/components/ui/book";
import { StatusBadge } from "@/components/ui/status-badge";
import { Input } from "@/components/ui/field";
import { ShelfHeader } from "@/components/shell/public-header";
import { books, shelfBySlug, shelves } from "@/lib/fixtures";
import { matches } from "@/lib/search";

export function generateStaticParams() {
  return shelves.map((s) => ({ shelf: s.slug }));
}

export default async function SearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ shelf: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { shelf: slug } = await params;
  const { q } = await searchParams;
  const shelf = shelfBySlug(slug);
  if (!shelf) notFound();

  const base = `/tu-sach/${shelf.slug}`;
  const query = q ?? "totto chan";
  const results = query.trim()
    ? books.filter((b) => matches(b.title, query) || matches(b.author, query))
    : [];

  return (
    <>
      <ShelfHeader shelf={shelf} active="tim-kiem" />

      <main className="mx-auto max-w-3xl px-6 py-10">
        {/* The search field is meant to be the dominant element, so the page
            heading is present for screen readers without competing visually. */}
        <h1 className="sr-only">Tìm sách</h1>

        <form action={`${base}/tim-kiem`} className="space-y-2">
          <Input
            name="q"
            icon={Search}
            defaultValue={query}
            className="h-16 text-lg"
            aria-label="Tìm sách"
          />
          <p className="text-[14px] text-meta">
            Không cần gõ dấu — kết quả hiện ngay khi bạn gõ.
          </p>
        </form>

        {results.length > 0 ? (
          <>
            <p className="mt-8 text-[14px] text-meta">
              {results.length} kết quả cho “{query}”
            </p>
            <ul className="mt-2 divide-y divide-hairline border-t border-hairline">
              {results.map((book) => (
                <li key={book.slug}>
                  <Link
                    href={`${base}/sach/${book.slug}`}
                    className="group flex items-center gap-4 py-4"
                  >
                    <BookCover title={book.title} className="w-13 text-[1.2rem]" />
                    <div className="min-w-0 flex-1">
                      <BookTitle className="block text-lg leading-snug group-hover:text-terracotta-ink">
                        {book.title}
                      </BookTitle>
                      <p className="mt-0.5 text-[14px] text-meta">{book.author}</p>
                    </div>
                    <StatusBadge status={book.status} />
                    <ChevronRight
                      aria-hidden
                      className="size-5 shrink-0 text-meta"
                      strokeWidth={1.75}
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </>
        ) : (
          /* The empty state suggests popular books rather than showing nothing. */
          <div className="mt-8 rounded-card border border-hairline bg-paper p-8">
            <SearchX
              aria-hidden
              className="size-8 text-leather"
              strokeWidth={1.5}
            />
            <h2 className="mt-3 text-lg font-semibold">Không tìm thấy sách nào</h2>
            <p className="mt-1.5 text-[15px] text-meta">
              Thử gõ ít chữ hơn, hoặc xem vài cuốn các bạn hay mượn.
            </p>

            <h3 className="mt-6 text-[16px] font-semibold">Các bạn hay mượn</h3>
            <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
              {books.slice(0, 4).map((book) => (
                <Link
                  key={book.slug}
                  href={`${base}/sach/${book.slug}`}
                  className="group"
                >
                  <BookCover title={book.title} className="w-full text-[1.4rem]" />
                  <BookTitle className="mt-2 line-clamp-2 block text-[14px] leading-snug group-hover:text-terracotta-ink">
                    {book.title}
                  </BookTitle>
                  <span className="text-[14px] text-meta">{book.author}</span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </main>
    </>
  );
}
