import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AlertTriangle,
  BookDown,
  BookUp,
  Hand,
  MessageSquare,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { ManagerShell } from "@/components/shell/manager-shell";
import { PageHeading, StatStrip } from "@/components/ui/card";
import { BigActionLink } from "@/components/ui/button";
import { BookTitle } from "@/components/ui/book";
import { cn } from "@/lib/utils";
import { activity, dashboardStats, shelfBySlug, shelves } from "@/lib/fixtures";

export function generateStaticParams() {
  return shelves.map((s) => ({ shelf: s.slug }));
}

const STAT_STYLE: Record<
  (typeof dashboardStats)[number]["key"],
  { icon: LucideIcon; ink: string; fill: string }
> = {
  "qua-han": { icon: AlertTriangle, ink: "text-overdue", fill: "bg-overdue/10" },
  "cho-duyet": { icon: UserPlus, ink: "text-held", fill: "bg-held/10" },
  "yeu-cau": { icon: Hand, ink: "text-terracotta-ink", fill: "bg-terracotta/10" },
  "binh-luan": { icon: MessageSquare, ink: "text-meta", fill: "bg-meta/10" },
};

function StatCard({
  statKey,
  href,
  label,
  value,
}: {
  statKey: keyof typeof STAT_STYLE;
  href: string;
  label: string;
  value: number;
}) {
  const style = STAT_STYLE[statKey];
  const Icon = style.icon;

  return (
    <Link
      href={href}
      className="min-w-[190px] flex-1 rounded-card border border-hairline bg-surface p-5 transition-colors hover:border-terracotta/40"
    >
      <span
        className={cn(
          "inline-flex size-10 items-center justify-center rounded-control",
          style.fill,
        )}
      >
        <Icon aria-hidden className={cn("size-5", style.ink)} strokeWidth={1.75} />
      </span>
      <p className="mt-3 text-[28px] leading-none font-semibold">{value}</p>
      <p className="mt-1.5 text-[15px] text-ink">{label}</p>
      <span className="mt-3 block text-[14px] font-medium text-sage">
        Xem danh sách
      </span>
    </Link>
  );
}

export default async function ManagerHomePage({
  params,
}: {
  params: Promise<{ shelf: string }>;
}) {
  const { shelf: slug } = await params;
  const shelf = shelfBySlug(slug);
  if (!shelf) notFound();

  const base = `/tu-sach/${shelf.slug}/quan-ly`;

  return (
    <ManagerShell
      shelfName={shelf.name}
      shelfSlug={shelf.slug}
      active="trang-chinh"
    >
      <PageHeading
        title="Trang chính"
        subtitle={`Chúa nhật, 06/08/2026 · ${shelf.name}`}
      />

      <div className="mt-6 flex flex-wrap gap-4">
        {dashboardStats.map((stat) => (
          <StatCard
            key={stat.key}
            statKey={stat.key}
            href={`${base}/${stat.href}`}
            label={stat.label}
            value={stat.value}
          />
        ))}
      </div>

      <div className="mt-8 flex flex-col gap-4 sm:flex-row">
        <BigActionLink
          href={`${base}/cho-muon`}
          icon={BookUp}
          label="Cho mượn"
          sublabel="Tìm sách · chọn người đọc · xác nhận"
          variant="primary"
        />
        <BigActionLink
          href={`${base}/nhan-tra`}
          icon={BookDown}
          label="Nhận trả"
          sublabel="Tìm sách đang mượn · kiểm tra tình trạng"
          variant="outline"
        />
      </div>

      <section className="mt-10">
        <h2 className="text-xl font-semibold">Tình hình tủ sách</h2>
        <div className="mt-4">
          <StatStrip
            items={[
              { label: "Đầu sách", value: String(shelf.titles) },
              { label: "Bản sách", value: String(shelf.copies) },
              { label: "Đang mượn", value: String(shelf.onLoan) },
              { label: "Người đọc", value: String(shelf.readers) },
            ]}
          />
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-semibold">Hoạt động gần đây</h2>
        <ul className="mt-4 divide-y divide-hairline border-y border-hairline">
          {activity.map((item) => (
            <li
              key={item.text + item.time}
              className="flex items-start justify-between gap-6 py-3.5"
            >
              <p className="text-[16px]">
                {item.text} {item.book ? <BookTitle>{item.book}</BookTitle> : null}
                {item.tail ? ` ${item.tail}` : ""}
              </p>
              <span className="shrink-0 text-[14px] text-meta">{item.time}</span>
            </li>
          ))}
        </ul>
        <Link
          href={`${base}/nhat-ky`}
          className="mt-4 inline-flex min-h-11 items-center text-[15px] font-medium text-sage hover:underline"
        >
          Xem toàn bộ nhật ký
        </Link>
      </section>
    </ManagerShell>
  );
}
