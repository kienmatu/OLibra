import { CheckCircle2, PenLine, Plus, type LucideIcon } from "lucide-react";
import { AdminShell } from "@/components/shell/manager-shell";
import { Button, ButtonLink } from "@/components/ui/button";
import { PageHeading } from "@/components/ui/card";
import { Chip } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";
import { posts } from "@/lib/fixtures";

export const metadata = { title: "Bài viết — Quản trị OLibra" };

type PostStatus = "published" | "draft";

const POST_STATUS: Record<
  PostStatus,
  { label: string; icon: LucideIcon; ink: string; fill: string }
> = {
  published: {
    label: "Đã đăng",
    icon: CheckCircle2,
    ink: "text-available",
    fill: "bg-available/10",
  },
  draft: {
    label: "Bản nháp",
    icon: PenLine,
    ink: "text-retired",
    fill: "bg-retired/10",
  },
};

function StatusPill({ status }: { status: PostStatus }) {
  const { label, icon: Icon, ink, fill } = POST_STATUS[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-control px-2.5 py-1 text-[14px] font-medium",
        ink,
        fill,
      )}
    >
      <Icon aria-hidden className="size-[18px]" strokeWidth={1.75} />
      {label}
    </span>
  );
}

type Row = {
  slug: string;
  title: string;
  excerpt: string;
  author: string;
  date: string;
  status: PostStatus;
};

const ROWS: Row[] = [
  ...posts.map((post) => ({ ...post, status: "published" as const })),
  {
    slug: "chuan-bi-cho-nam-hoc-moi",
    title: "Chuẩn bị cho năm học mới",
    excerpt: "Vài việc nên làm trước khi các em quay lại tủ sách sau kỳ nghỉ hè.",
    author: "Giuse Trần Quốc Anh",
    date: "Chưa đăng",
    status: "draft" as const,
  },
];

/** Row actions — the same two per row, but a draft offers to publish it
 * instead of linking out to a page that does not exist yet. */
function RowActions({ row, className }: { row: Row; className?: string }) {
  return (
    <div className={cn("flex gap-2", className)}>
      <Button
        variant="quiet"
        size="sm"
        className={className ? "flex-1" : undefined}
      >
        Sửa
      </Button>
      {row.status === "draft" ? (
        <Button
          variant="quiet"
          size="sm"
          className={className ? "flex-1" : undefined}
        >
          Đăng ngay
        </Button>
      ) : (
        <ButtonLink
          href={`/bai-viet/${row.slug}`}
          variant="quiet"
          size="sm"
          className={className ? "flex-1" : undefined}
        >
          Xem
        </ButtonLink>
      )}
    </div>
  );
}

function PostCard({ row }: { row: Row }) {
  return (
    <div className="rounded-card border border-hairline bg-surface p-4">
      <p className="text-[16px] font-medium">{row.title}</p>
      <p className="mt-0.5 line-clamp-1 text-[14px] text-meta">{row.excerpt}</p>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <StatusPill status={row.status} />
        <span className="text-[13px] text-meta">
          {row.author} · {row.date}
        </span>
      </div>
      <RowActions row={row} className="mt-3" />
    </div>
  );
}

export default function AdminPostsPage() {
  return (
    <AdminShell active="bai-viet">
      <PageHeading
        title="Bài viết"
        subtitle="6 bài · 1 bản nháp"
        action={
          <ButtonLink href="#" variant="primary" size="lg">
            <Plus aria-hidden className="size-5" strokeWidth={1.75} />
            Viết bài mới
          </ButtonLink>
        }
      />

      <div className="mt-6 flex flex-wrap gap-2">
        <Chip href="#" active>
          Tất cả (7)
        </Chip>
        <Chip href="#">Đã đăng (6)</Chip>
        <Chip href="#">Bản nháp (1)</Chip>
      </div>

      {/* Table on md and up — hairline rules, never a horizontal scroll. */}
      <div className="mt-6 hidden overflow-hidden rounded-card border border-hairline md:block">
        <table className="w-full text-left">
          <thead className="bg-paper">
            <tr>
              <th className="px-4 py-3 text-[14px] font-medium text-meta">
                Bài viết
              </th>
              <th className="px-4 py-3 text-[14px] font-medium text-meta">
                Tác giả
              </th>
              <th className="px-4 py-3 text-[14px] font-medium text-meta">
                Ngày đăng
              </th>
              <th className="px-4 py-3 text-[14px] font-medium text-meta">
                Trạng thái
              </th>
              <th className="px-4 py-3 text-[14px] font-medium text-meta">
                Thao tác
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {ROWS.map((row) => (
              <tr key={row.slug}>
                <td className="max-w-xs px-4 py-3">
                  <p className="truncate text-[16px] font-medium">{row.title}</p>
                  <p className="mt-0.5 line-clamp-1 text-[13px] text-meta">
                    {row.excerpt}
                  </p>
                </td>
                <td className="px-4 py-3 text-[15px] text-ink/85">{row.author}</td>
                <td className="px-4 py-3 text-[15px] text-ink/85">{row.date}</td>
                <td className="px-4 py-3">
                  <StatusPill status={row.status} />
                </td>
                <td className="px-4 py-3">
                  <RowActions row={row} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Stacked cards below md — the same data, never a scrolling table. */}
      <div className="mt-6 space-y-3 md:hidden">
        {ROWS.map((row) => (
          <PostCard key={row.slug} row={row} />
        ))}
      </div>
    </AdminShell>
  );
}
