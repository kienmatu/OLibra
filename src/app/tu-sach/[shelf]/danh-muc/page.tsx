import { notFound } from "next/navigation";
import { BookOpen, ChevronLeft, ChevronRight, Library, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BookCard } from "@/components/ui/book";
import { Input, Select } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { PublicHeader } from "@/components/shell/public-header";
import { books, shelfBySlug, shelves } from "@/lib/fixtures";

export function generateStaticParams() {
  return shelves.map((s) => ({ shelf: s.slug }));
}

export default async function CataloguePage({
  params,
  searchParams,
}: {
  params: Promise<{ shelf: string }>;
  searchParams: Promise<{ loc?: string }>;
}) {
  const { shelf: slug } = await params;
  const { loc } = await searchParams;
  const shelf = shelfBySlug(slug);
  if (!shelf) notFound();

  const base = `/tu-sach/${shelf.slug}`;
  const showingAll = loc === "tat-ca";
  const visible = showingAll
    ? books
    : books.filter((b) => b.status !== "retired" && b.status !== "lost");

  return (
    <>
      <PublicHeader shelf={shelf} active="danh-muc" />

      <main className="mx-auto max-w-6xl px-6 py-10">
        <h1 className="text-[28px] leading-tight font-semibold">Danh mục sách</h1>
        <p className="mt-1 text-meta">
          {shelf.titles} đầu sách · 183 cuốn có thể mượn hôm nay
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-4">
          {/* A segmented control, never a dropdown — the most-used control here. */}
          <Segmented
            options={[
              {
                href: `${base}/danh-muc`,
                label: "Sách đang có",
                icon: BookOpen,
                active: !showingAll,
              },
              {
                href: `${base}/danh-muc?loc=tat-ca`,
                label: "Toàn bộ tủ sách",
                icon: Library,
                active: showingAll,
              },
            ]}
          />

          <div className="flex flex-1 flex-wrap items-center gap-3 md:justify-end">
            <Select
              aria-label="Thể loại"
              className="h-11 w-full min-w-40 sm:w-auto"
            >
              <option>Thể loại</option>
              <option>Văn học thiếu nhi</option>
              <option>Văn học nước ngoài</option>
              <option>Văn học Việt Nam</option>
            </Select>
            <Select aria-label="Sắp xếp" className="h-11 w-full min-w-40 sm:w-auto">
              <option>Sắp xếp</option>
              <option>Mới thêm</option>
              <option>Mượn nhiều nhất</option>
            </Select>
            <div className="w-full sm:w-64">
              <Input
                icon={Search}
                className="h-11"
                placeholder="Tìm tên sách hoặc tác giả"
                aria-label="Tìm trong danh mục"
              />
            </div>
          </div>
        </div>

        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5 lg:gap-6 xl:grid-cols-6">
          {visible.map((book) => (
            <BookCard
              key={book.slug}
              href={`${base}/sach/${book.slug}`}
              title={book.title}
              author={book.author}
              status={book.status}
            />
          ))}
        </div>

        <nav className="mt-10 flex items-center justify-between gap-4">
          <p className="text-[15px] text-meta">Trang 1 / 18</p>
          <div className="flex gap-2">
            <Button size="sm" disabled>
              <ChevronLeft aria-hidden className="size-5" strokeWidth={1.75} />
              Trước
            </Button>
            <Button size="sm">
              Sau
              <ChevronRight aria-hidden className="size-5" strokeWidth={1.75} />
            </Button>
          </div>
        </nav>
      </main>
    </>
  );
}
