import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, Plus, Search } from "lucide-react";
import { ManagerShell } from "@/components/shell/manager-shell";
import { Input } from "@/components/ui/field";
import { BookCover, BookTitle } from "@/components/ui/book";
import { StatusBadge } from "@/components/ui/status-badge";
import { StepIndicator } from "@/components/ui/step-indicator";
import { bookBySlug, shelfBySlug, shelves } from "@/lib/fixtures";

export function generateStaticParams() {
  return shelves.map((s) => ({ shelf: s.slug }));
}

export default async function ChoMuonTimSachPage({
  params,
}: {
  params: Promise<{ shelf: string }>;
}) {
  const { shelf: slug } = await params;
  const shelf = shelfBySlug(slug);
  if (!shelf) notFound();

  const base = `/tu-sach/${shelf.slug}/quan-ly`;

  const deMen = bookBySlug("de-men-phieu-luu-ky")!;
  const datRung = bookBySlug("dat-rung-phuong-nam")!;
  const veTuoiTho = bookBySlug("cho-toi-xin-mot-ve-di-tuoi-tho")!;

  const results = [
    { book: deMen, blocked: false },
    { book: datRung, blocked: true, reason: "Cả 3 bản đang được mượn" },
    { book: veTuoiTho, blocked: false },
  ];

  return (
    <ManagerShell shelfName={shelf.name} shelfSlug={shelf.slug} active="cho-muon">
      <StepIndicator
        steps={["Tìm sách", "Chọn người đọc", "Xác nhận"]}
        current={1}
      />

      <h1 className="mt-6 text-[28px] leading-tight font-semibold">
        Tìm sách cần cho mượn
      </h1>

      <div className="mt-5 max-w-xl space-y-2">
        <Input
          icon={Search}
          defaultValue="de men"
          aria-label="Tìm sách cần cho mượn"
          className="h-14 text-[17px]"
        />
        <p className="text-[14px] text-meta">
          Không cần gõ dấu — gõ de men vẫn tìm ra Dế Mèn.
        </p>
      </div>

      <ul className="mt-8 max-w-2xl divide-y divide-hairline border-y border-hairline">
        {results.map(({ book, blocked, reason }) => {
          const content = (
            <>
              {/* Cover and text stay in one row even when the row stacks
                  below sm — `sm:contents` folds this wrapper away at sm and
                  up so its children rejoin the row as plain flex items. */}
              <div className="flex items-center gap-4 sm:contents">
                <BookCover title={book.title} className="w-12 text-[1rem]" />
                <div className="min-w-0 flex-1">
                  <BookTitle className="line-clamp-2 text-base leading-snug">
                    {book.title}
                  </BookTitle>
                  <p className="truncate text-[14px] text-meta">{book.author}</p>
                  {blocked && reason ? (
                    <p className="mt-1 text-[13px] text-meta">{reason}</p>
                  ) : null}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3 pl-16 sm:pl-0">
                <StatusBadge status={book.status} size="sm" />
                <span className="text-[14px] text-meta">
                  {book.copiesAvailable}/{book.copiesTotal} bản
                </span>
                {!blocked ? (
                  <ChevronRight
                    aria-hidden
                    className="size-5 text-meta"
                    strokeWidth={1.75}
                  />
                ) : null}
              </div>
            </>
          );

          if (blocked) {
            return (
              // No aria-disabled: the listitem role does not support it. The
              // row carries no control, and the inline reason states plainly
              // why it cannot be chosen, which is what a screen reader needs.
              <li
                key={book.slug}
                className="flex flex-col gap-2 bg-paper py-4 sm:flex-row sm:items-center sm:gap-4"
              >
                {content}
              </li>
            );
          }

          return (
            <li key={book.slug}>
              <Link
                href={`${base}/cho-muon/nguoi-doc`}
                className="flex flex-col gap-2 py-4 hover:bg-paper sm:flex-row sm:items-center sm:gap-4"
              >
                {content}
              </Link>
            </li>
          );
        })}
      </ul>

      <Link
        href={`${base}/sach/them`}
        className="mt-6 inline-flex min-h-11 items-center gap-1.5 text-[15px] font-medium text-sage hover:underline"
      >
        <Plus aria-hidden className="size-4" strokeWidth={2} />
        Không thấy sách? Thêm sách mới
      </Link>
    </ManagerShell>
  );
}
