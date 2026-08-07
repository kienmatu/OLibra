import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, ChevronRight, Plus, Search } from "lucide-react";
import { ManagerShell } from "@/components/shell/manager-shell";
import { Input } from "@/components/ui/field";
import { BookCover, BookTitle } from "@/components/ui/book";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import { bookBySlug, shelfBySlug, shelves } from "@/lib/fixtures";

export function generateStaticParams() {
  return shelves.map((s) => ({ shelf: s.slug }));
}

const STEPS = [
  { n: 1, label: "Tìm sách" },
  { n: 2, label: "Chọn người đọc" },
  { n: 3, label: "Xác nhận" },
] as const;

function StepIndicator({ current }: { current: 1 | 2 | 3 }) {
  return (
    <ol className="flex flex-wrap items-center gap-3">
      {STEPS.map((step, i) => {
        const state =
          step.n < current ? "done" : step.n === current ? "current" : "upcoming";
        return (
          <li key={step.n} className="flex items-center gap-3">
            <span
              className={cn(
                "flex items-center gap-2 text-[14px]",
                state === "current" && "font-semibold text-terracotta-ink",
                state === "done" && "text-sage",
                state === "upcoming" && "text-meta",
              )}
            >
              <span
                className={cn(
                  "flex size-6 items-center justify-center rounded-full border text-[12px] font-semibold",
                  state === "current" && "border-terracotta text-terracotta-ink",
                  state === "done" && "border-sage text-sage",
                  state === "upcoming" && "border-hairline text-meta",
                )}
              >
                {state === "done" ? (
                  <Check aria-hidden className="size-3.5" strokeWidth={2.25} />
                ) : (
                  step.n
                )}
              </span>
              {step.label}
            </span>
            {i < STEPS.length - 1 ? (
              <span aria-hidden className="h-px w-8 bg-hairline" />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
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
      <StepIndicator current={1} />

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
              <BookCover title={book.title} className="w-12 text-[1rem]" />
              <div className="min-w-0 flex-1">
                <BookTitle className="block truncate text-base leading-snug">
                  {book.title}
                </BookTitle>
                <p className="truncate text-[14px] text-meta">{book.author}</p>
                {blocked && reason ? (
                  <p className="mt-1 text-[13px] text-meta">{reason}</p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-3">
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
                className="flex items-center gap-4 py-4 opacity-50"
              >
                {content}
              </li>
            );
          }

          return (
            <li key={book.slug}>
              <Link
                href={`${base}/cho-muon/nguoi-doc`}
                className="flex items-center gap-4 py-4 hover:bg-paper"
              >
                {content}
              </Link>
            </li>
          );
        })}
      </ul>

      <Link
        href={`${base}/sach/them`}
        className="mt-6 inline-flex items-center gap-1.5 text-[15px] font-medium text-sage hover:underline"
      >
        <Plus aria-hidden className="size-4" strokeWidth={2} />
        Không thấy sách? Thêm sách mới
      </Link>
    </ManagerShell>
  );
}
