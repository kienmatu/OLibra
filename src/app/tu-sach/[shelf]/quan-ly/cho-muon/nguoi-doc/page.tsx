import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, Info, Search, UserPlus } from "lucide-react";
import { ManagerShell } from "@/components/shell/manager-shell";
import { ButtonLink } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { BookCover, BookTitle } from "@/components/ui/book";
import { StepIndicator } from "@/components/ui/step-indicator";
import {
  bookBySlug,
  readers,
  shelfBySlug,
  shelves,
  type Reader,
} from "@/lib/fixtures";

export function generateStaticParams() {
  return shelves.map((s) => ({ shelf: s.slug }));
}

/** Derived, not hard-coded: a reader who cannot borrow right now, and why. */
function blockReason(reader: Reader): string | null {
  if (reader.membership === "suspended") return "Tài khoản đang tạm khoá";
  if (reader.holding >= 3) return "Đã mượn tối đa 3 cuốn";
  return null;
}

export default async function ChoMuonNguoiDocPage({
  params,
}: {
  params: Promise<{ shelf: string }>;
}) {
  const { shelf: slug } = await params;
  const shelf = shelfBySlug(slug);
  if (!shelf) notFound();

  const base = `/tu-sach/${shelf.slug}/quan-ly`;
  const book = bookBySlug("de-men-phieu-luu-ky")!;

  return (
    <ManagerShell shelfName={shelf.name} shelfSlug={shelf.slug} active="cho-muon">
      <StepIndicator
        steps={["Tìm sách", "Chọn người đọc", "Xác nhận"]}
        current={2}
      />

      <div className="mt-6 flex max-w-xl items-center gap-3 rounded-card border border-hairline bg-paper p-4">
        <BookCover title={book.title} className="w-12 text-[1rem]" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] text-meta">Sách đã chọn</p>
          <BookTitle className="block truncate text-base leading-snug">
            {book.title}
          </BookTitle>
          <p className="truncate text-[14px] text-meta">
            {book.author} · Bản DT-0142
          </p>
        </div>
        <Link
          href={`${base}/cho-muon`}
          className="inline-flex min-h-11 shrink-0 items-center rounded-control px-3 text-[14px] font-medium text-sage hover:underline"
        >
          Đổi sách
        </Link>
      </div>

      <h1 className="mt-8 text-[28px] leading-tight font-semibold">
        Chọn người đọc
      </h1>

      <div className="mt-5 max-w-xl">
        <Input
          icon={Search}
          placeholder="Tìm theo tên"
          aria-label="Tìm người đọc"
          className="h-14 text-[17px]"
        />
      </div>

      <ul className="mt-6 max-w-2xl divide-y divide-hairline border-y border-hairline">
        {readers.map((reader) => {
          const reason = blockReason(reader);
          const initial = reader.name.charAt(0).toUpperCase();

          const rowInner = (
            <>
              <span
                aria-hidden
                className="flex size-10 shrink-0 items-center justify-center rounded-full bg-paper text-[15px] font-semibold text-leather"
              >
                {initial}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[16px] font-medium">
                  {reader.fullName}
                </p>
                <p className="truncate text-[14px] text-meta">
                  {reader.group} · {reader.parish}
                </p>
                {reason ? (
                  <p className="mt-1 flex items-center gap-1.5 text-[13px] text-meta">
                    <Info aria-hidden className="size-3.5" strokeWidth={1.75} />
                    {reason}
                  </p>
                ) : null}
              </div>
              {!reason ? (
                <ChevronRight
                  aria-hidden
                  className="size-5 shrink-0 text-meta"
                  strokeWidth={1.75}
                />
              ) : null}
            </>
          );

          if (reason) {
            return (
              // No aria-disabled: the listitem role does not support it. The
              // row carries no control, and the inline reason states plainly
              // why this reader cannot be chosen.
              <li
                key={reader.id}
                className="flex items-center gap-3 py-3.5 opacity-50"
              >
                {rowInner}
              </li>
            );
          }

          return (
            <li key={reader.id}>
              <Link
                href={`${base}/cho-muon/xac-nhan`}
                className="flex items-center gap-3 py-3.5 hover:bg-paper"
              >
                {rowInner}
              </Link>
            </li>
          );
        })}
      </ul>

      <ButtonLink
        href={`${base}/nguoi-doc/moi`}
        variant="outline"
        size="lg"
        className="mt-8 w-full max-w-2xl"
      >
        <UserPlus aria-hidden className="size-5" strokeWidth={1.75} />
        Đăng ký người đọc mới
      </ButtonLink>
    </ManagerShell>
  );
}
