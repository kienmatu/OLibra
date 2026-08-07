import Link from "next/link";
import { notFound } from "next/navigation";
import { HelpCircle } from "lucide-react";
import { ManagerShell } from "@/components/shell/manager-shell";
import { ButtonLink } from "@/components/ui/button";
import { BookCover, BookTitle } from "@/components/ui/book";
import { StatusBadge } from "@/components/ui/status-badge";
import { Field, Textarea } from "@/components/ui/field";
import { bookBySlug, shelfBySlug, shelves } from "@/lib/fixtures";

export function generateStaticParams() {
  return shelves.map((s) => ({ shelf: s.slug }));
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-hairline px-6 py-4 last:border-b-0">
      <dt className="text-[14px] text-meta">{label}</dt>
      <dd className="mt-2">{children}</dd>
    </div>
  );
}

/**
 * The second entry point into `ReportCopyLost` — reached from step 2 of
 * Nhận trả instead of from the copy row on a book's detail page. Same
 * command, same invariants; only the route in is different (BR §16.3).
 */
export default async function NhanTraBaoMatPage({
  params,
}: {
  params: Promise<{ shelf: string }>;
}) {
  const { shelf: slug } = await params;
  const shelf = shelfBySlug(slug);
  if (!shelf) notFound();

  const base = `/tu-sach/${shelf.slug}/quan-ly`;
  const book = bookBySlug("hoang-tu-be")!;

  return (
    <ManagerShell shelfName={shelf.name} shelfSlug={shelf.slug} active="nhan-tra">
      <p className="flex items-center gap-2 text-[14px] font-semibold text-lost">
        <HelpCircle aria-hidden className="size-[18px]" strokeWidth={1.75} />
        Báo làm mất, không phải nhận trả
      </p>

      <h1 className="mt-2 text-[28px] leading-tight font-semibold">
        Xác nhận báo mất
      </h1>
      <p className="mt-2 max-w-xl text-[15px] text-ink/85">
        Khoản mượn này sẽ đóng lại là{" "}
        <strong className="font-semibold">Đã mất</strong>, không phải Đã trả. Nếu
        bạn đọc tìm lại được sách, bạn có thể đánh dấu tìm thấy sau, trong danh sách
        sách đã mất.
      </p>

      <dl className="mt-6 max-w-xl rounded-card border border-hairline bg-surface">
        <Row label="Sách">
          <div className="flex items-center gap-3">
            <BookCover title={book.title} className="w-12 text-[1rem]" />
            <div className="min-w-0">
              <BookTitle className="block truncate text-base leading-snug">
                {book.title}
              </BookTitle>
              <p className="truncate text-[14px] text-meta">{book.author}</p>
            </div>
          </div>
        </Row>
        <Row label="Mã bản sách">
          <span className="inline-flex rounded-control bg-terracotta/10 px-2.5 py-1 text-[14px] font-medium text-terracotta-ink">
            DT-0087
          </span>
        </Row>
        <Row label="Bạn đọc báo mất">
          <p className="text-[16px] font-medium">Têrêsa Lê Ngọc Ánh</p>
          <p className="mt-0.5 text-[14px] text-meta">
            Mượn ngày 23/07 · Hạn trả Chúa nhật 06/08
          </p>
        </Row>
      </dl>

      <div className="mt-6 max-w-xl">
        <Field
          label="Ghi chú"
          htmlFor="ghi-chu-bao-mat"
          hint="Không bắt buộc — ví dụ hoàn cảnh làm mất, hoặc đã tìm ở đâu."
        >
          <Textarea
            id="ghi-chu-bao-mat"
            rows={3}
            placeholder="Gia đình báo đã tìm quanh nhà nhưng không thấy…"
          />
        </Field>
      </div>

      <p className="mt-6 max-w-xl text-[15px] text-ink">
        Sau khi xác nhận, bản DT-0087 sẽ chuyển sang trạng thái{" "}
        <StatusBadge status="lost" size="sm" className="align-middle" />
      </p>

      <div className="mt-8 max-w-xl">
        <ButtonLink href={base} variant="danger" size="lg" className="w-full">
          <HelpCircle aria-hidden className="size-5" strokeWidth={1.75} />
          Xác nhận báo mất
        </ButtonLink>
        <div className="mt-3 text-center">
          <Link
            href={`${base}/nhan-tra`}
            className="inline-flex min-h-11 items-center text-[14px] text-meta hover:text-ink"
          >
            Quay lại nhận trả
          </Link>
        </div>
      </div>
    </ManagerShell>
  );
}
