import Link from "next/link";
import { notFound } from "next/navigation";
import { Calendar, Check } from "lucide-react";
import { ManagerShell } from "@/components/shell/manager-shell";
import { ButtonLink } from "@/components/ui/button";
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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-hairline px-6 py-4 last:border-b-0">
      <dt className="text-[14px] text-meta">{label}</dt>
      <dd className="mt-2">{children}</dd>
    </div>
  );
}

export default async function ChoMuonXacNhanPage({
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
      <StepIndicator current={3} />

      <h1 className="mt-6 text-[28px] leading-tight font-semibold">
        Xác nhận cho mượn
      </h1>

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
            DT-0142
          </span>
        </Row>
        <Row label="Người đọc">
          <p className="text-[16px] font-medium">Giuse Trần Minh</p>
          <p className="mt-0.5 text-[14px] text-meta">Tổ 3 · Giáo họ Thánh Tâm</p>
        </Row>
        <Row label="Ngày mượn">
          <p className="text-[16px]">Chúa nhật 06/08</p>
        </Row>
      </dl>

      <div className="mt-6 max-w-xl rounded-card border border-hairline bg-paper p-6">
        <p className="flex items-center gap-2 text-[14px] text-meta">
          <Calendar aria-hidden className="size-[18px]" strokeWidth={1.75} />
          Hạn trả
        </p>
        <p className="mt-1.5 text-[26px] leading-tight font-semibold">
          Chúa nhật 20/08
        </p>
        <p className="mt-1 text-[15px] text-meta">14 ngày</p>
      </div>

      <p className="mt-6 max-w-xl text-[15px] text-ink">
        Sau khi xác nhận, bản DT-0142 sẽ chuyển sang trạng thái{" "}
        <StatusBadge status="onloan" size="sm" className="align-middle" />
      </p>

      <div className="mt-8 max-w-xl">
        <ButtonLink href={base} variant="primary" size="lg" className="w-full">
          <Check aria-hidden className="size-5" strokeWidth={1.75} />
          Xác nhận cho mượn
        </ButtonLink>
        <div className="mt-3 text-center">
          <Link
            href={`${base}/cho-muon/nguoi-doc`}
            className="inline-flex min-h-11 items-center text-[14px] text-meta hover:text-ink"
          >
            Quay lại chọn người đọc
          </Link>
        </div>
      </div>
    </ManagerShell>
  );
}
