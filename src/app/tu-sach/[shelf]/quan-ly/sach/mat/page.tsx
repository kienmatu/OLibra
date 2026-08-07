import { notFound } from "next/navigation";
import { Archive, CircleCheckBig } from "lucide-react";
import { ManagerShell } from "@/components/shell/manager-shell";
import { Button } from "@/components/ui/button";
import { BookCover, BookTitle } from "@/components/ui/book";
import { Card, PageHeading } from "@/components/ui/card";
import { Chip } from "@/components/ui/segmented";
import { StatusBadge } from "@/components/ui/status-badge";
import { bookBySlug, lostCopies, shelfBySlug, shelves } from "@/lib/fixtures";

export function generateStaticParams() {
  return shelves.map((s) => ({ shelf: s.slug }));
}

/**
 * The other half of §7.1's `lost` state. "Báo mất" appears three times in
 * the built interface; until this page, nothing gave `lost → available` or
 * `lost → retired` anywhere to happen. Reached from the Sách list as a
 * status filter — the filter genuinely changes what a row is (a copy, not a
 * title: code, borrower and the date it was reported lost, not author and
 * copy count), so it is its own route rather than a re-filtered version of
 * the same table.
 */
export default async function LostCopiesPage({
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
      <div className="space-y-8">
        <PageHeading
          title="Sách đã mất"
          subtitle={`${lostCopies.length} bản đang ở trạng thái Đã mất.`}
        />

        <div className="flex flex-wrap gap-2">
          <Chip href={`${base}/sach`}>Tất cả trạng thái</Chip>
          <Chip href={`${base}/sach/mat`} active>
            Đã mất ({lostCopies.length})
          </Chip>
        </div>

        {lostCopies.length > 0 ? (
          <div className="space-y-4">
            {lostCopies.map((copy) => {
              const book = bookBySlug(copy.bookSlug)!;
              return (
                <Card key={copy.code}>
                  <div className="flex items-start gap-4">
                    <BookCover
                      title={book.title}
                      className="w-16 shrink-0 text-lg"
                    />
                    <div className="min-w-0 flex-1">
                      <BookTitle as="p" className="text-[18px] leading-snug">
                        {book.title}
                      </BookTitle>
                      <span className="mt-1.5 inline-block rounded-control bg-paper px-2 py-0.5 text-[13px] text-meta">
                        {copy.code}
                      </span>
                      <p className="mt-2 text-[16px] font-medium">
                        {copy.borrower}
                      </p>
                      <p className="mt-0.5 text-[14px] text-meta">
                        Người đang giữ khi báo mất
                      </p>
                    </div>
                    <div className="hidden shrink-0 flex-col items-end gap-1 text-right md:flex">
                      <StatusBadge status="lost" />
                      <p className="text-[14px] text-meta">
                        Báo mất ngày {copy.reportedOn}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2 md:hidden">
                    <StatusBadge status="lost" />
                    <p className="w-full text-[14px] text-meta">
                      Báo mất ngày {copy.reportedOn}
                    </p>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-3 border-t border-hairline pt-4">
                    <Button variant="quiet" size="sm">
                      <CircleCheckBig
                        aria-hidden
                        className="size-4"
                        strokeWidth={1.75}
                      />
                      Đánh dấu tìm thấy
                    </Button>
                    <Button variant="quiet" size="sm">
                      <Archive aria-hidden className="size-4" strokeWidth={1.75} />
                      Ngừng dùng
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        ) : (
          <p className="text-[15px] text-meta">
            Hiện không có bản sách nào ở trạng thái đã mất.
          </p>
        )}

        <p className="text-[14px] text-meta">
          Đánh dấu tìm thấy trả bản sách về Còn sách. Ngừng dùng đưa bản sách ra
          khỏi tủ sách hẳn, dùng khi biết chắc sách sẽ không quay lại nữa.
        </p>
      </div>
    </ManagerShell>
  );
}
