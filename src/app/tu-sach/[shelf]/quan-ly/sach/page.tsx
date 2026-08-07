import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight, Plus, Search } from "lucide-react";
import { ButtonLink, Button } from "@/components/ui/button";
import { PageHeading } from "@/components/ui/card";
import { BookCover, BookTitle } from "@/components/ui/book";
import { Input, Select } from "@/components/ui/field";
import { StatusBadge } from "@/components/ui/status-badge";
import { Chip } from "@/components/ui/segmented";
import { ManagerShell } from "@/components/shell/manager-shell";
import { books, lostCopies, shelfBySlug, shelves } from "@/lib/fixtures";

export function generateStaticParams() {
  return shelves.map((s) => ({ shelf: s.slug }));
}

export default async function ManagerBooksPage({
  params,
}: {
  params: Promise<{ shelf: string }>;
}) {
  const { shelf: slug } = await params;
  const shelf = shelfBySlug(slug);
  if (!shelf) notFound();

  const base = `/tu-sach/${shelf.slug}/quan-ly`;

  return (
    <ManagerShell shelfName={shelf.name} shelfSlug={shelf.slug} active="sach">
      <PageHeading
        title="Sách"
        subtitle="214 đầu sách · 268 bản"
        action={
          <ButtonLink href={`${base}/sach/moi`} variant="primary" size="lg">
            <Plus aria-hidden className="size-5" strokeWidth={1.75} />
            Thêm sách
          </ButtonLink>
        }
      />

      {/* Quiet filter bar — search plus two 44px selects. */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="w-full flex-1 sm:min-w-64">
          <Input
            icon={Search}
            className="h-11"
            placeholder="Tìm tên sách hoặc tác giả"
            aria-label="Tìm tên sách hoặc tác giả"
          />
        </div>
        <Select aria-label="Thể loại" className="h-11 w-full min-w-40 sm:w-auto">
          <option>Thể loại</option>
          <option>Văn học thiếu nhi</option>
          <option>Văn học nước ngoài</option>
          <option>Văn học Việt Nam</option>
          <option>Thơ thiếu nhi</option>
        </Select>
        <Select aria-label="Sắp xếp" className="h-11 w-full min-w-40 sm:w-auto">
          <option>Sắp xếp</option>
          <option>Mới thêm</option>
          <option>Tên A–Z</option>
          <option>Mượn nhiều nhất</option>
        </Select>
      </div>

      {/* Đã mất is a copy state, not a genre or a sort order, so it sits apart
          as a status filter rather than a third Select — and it is real,
          not decorative: the count is the reason the row exists at all. */}
      <div className="mt-4 flex flex-wrap gap-2">
        <Chip href={`${base}/sach`} active>
          Tất cả trạng thái
        </Chip>
        <Chip href={`${base}/sach/mat`}>Đã mất ({lostCopies.length})</Chip>
      </div>

      {/* Table on md and up — hairline rules, never a horizontal scroll. */}
      <div className="mt-6 hidden overflow-hidden rounded-card border border-hairline md:block">
        <table className="w-full text-left">
          <thead className="bg-paper">
            <tr>
              <th className="px-4 py-3 text-[14px] font-medium text-meta">Sách</th>
              <th className="px-4 py-3 text-[14px] font-medium text-meta">
                Tác giả
              </th>
              <th className="px-4 py-3 text-[14px] font-medium text-meta">
                Thể loại
              </th>
              <th className="px-4 py-3 text-[14px] font-medium text-meta">
                Số bản
              </th>
              <th className="px-4 py-3 text-[14px] font-medium text-meta">
                Tình trạng
              </th>
              <th className="px-4 py-3 text-[14px] font-medium text-meta">
                Thao tác
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {books.map((book) => (
              <tr key={book.slug}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <BookCover title={book.title} className="w-10 text-[0.9rem]" />
                    <div className="min-w-0">
                      <BookTitle className="block truncate text-[16px] leading-snug">
                        {book.title}
                      </BookTitle>
                      <span className="mt-0.5 block text-[13px] text-meta">
                        {book.codes}
                      </span>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-[15px] text-ink/85">{book.author}</td>
                <td className="px-4 py-3 text-[15px] text-ink/85">
                  {book.category}
                </td>
                <td className="px-4 py-3 text-[15px] text-ink/85">
                  {book.copiesTotal}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={book.status} size="sm" />
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <Button variant="quiet" size="sm">
                      Sửa
                    </Button>
                    <ButtonLink
                      href={`${base}/sach/${book.slug}`}
                      variant="quiet"
                      size="sm"
                    >
                      Xem bản
                    </ButtonLink>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Stacked cards below md — the same data, never a scrolling table. */}
      <div className="mt-6 space-y-3 md:hidden">
        {books.map((book) => (
          <div
            key={book.slug}
            className="rounded-card border border-hairline bg-surface p-4"
          >
            <div className="flex items-start gap-3">
              <BookCover title={book.title} className="w-14 text-[1.1rem]" />
              <div className="min-w-0 flex-1">
                <BookTitle className="block truncate text-[16px] leading-snug">
                  {book.title}
                </BookTitle>
                <p className="mt-0.5 truncate text-[14px] text-meta">
                  {book.author}
                </p>
                <p className="mt-0.5 text-[13px] text-meta">{book.codes}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <StatusBadge status={book.status} size="sm" />
                  <span className="text-[13px] text-meta">
                    {book.category} · {book.copiesTotal} bản
                  </span>
                </div>
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <Button variant="quiet" size="sm" className="flex-1">
                Sửa
              </Button>
              <ButtonLink
                href={`${base}/sach/${book.slug}`}
                variant="quiet"
                size="sm"
                className="flex-1"
              >
                Xem bản
              </ButtonLink>
            </div>
          </div>
        ))}
      </div>

      <nav className="mt-8 flex items-center justify-between gap-4">
        <p className="text-[15px] text-meta">Trang 1 / 31</p>
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

      <p className="mt-3 text-[14px] text-meta">
        Trên điện thoại, bảng này hiển thị thành từng thẻ xếp dọc.
      </p>
    </ManagerShell>
  );
}
