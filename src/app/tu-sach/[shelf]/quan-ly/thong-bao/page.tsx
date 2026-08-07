import { notFound } from "next/navigation";
import { Archive, Eye, FileEdit, Pin, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, PageHeading } from "@/components/ui/card";
import { Chip } from "@/components/ui/segmented";
import { ManagerShell } from "@/components/shell/manager-shell";
import { announcements, shelfBySlug, shelves } from "@/lib/fixtures";

export function generateStaticParams() {
  return shelves.map((s) => ({ shelf: s.slug }));
}

type PubState = "showing" | "draft" | "expired";

const STATE_STYLE: Record<
  PubState,
  { label: string; icon: typeof Eye; ink: string; fill: string }
> = {
  showing: {
    label: "Đang hiện",
    icon: Eye,
    ink: "text-available",
    fill: "bg-available/10",
  },
  draft: {
    label: "Nháp",
    icon: FileEdit,
    ink: "text-retired",
    fill: "bg-retired/10",
  },
  expired: {
    label: "Hết hạn",
    icon: Archive,
    ink: "text-retired",
    fill: "bg-retired/10",
  },
};

function StatePill({ state }: { state: PubState }) {
  const { label, icon: Icon, ink, fill } = STATE_STYLE[state];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-control px-2.5 py-1 text-[14px] font-medium ${fill} ${ink}`}
    >
      <Icon aria-hidden className="size-[18px]" strokeWidth={1.75} />
      {label}
    </span>
  );
}

export default async function AnnouncementsManagePage({
  params,
}: {
  params: Promise<{ shelf: string }>;
}) {
  const { shelf: slug } = await params;
  const shelf = shelfBySlug(slug);
  if (!shelf) notFound();

  const pinned = announcements[0];
  const showing = announcements[1];
  const draft = announcements[2];
  const expired = announcements[3];

  return (
    <ManagerShell shelfName={shelf.name} shelfSlug={shelf.slug} active="thong-bao">
      <div className="space-y-8">
        <PageHeading
          title="Thông báo"
          subtitle="4 thông báo · 1 đang ghim"
          action={
            <Button variant="primary" size="lg">
              <Plus aria-hidden className="size-5" strokeWidth={1.75} />
              Viết thông báo
            </Button>
          }
        />

        <div className="flex flex-wrap gap-2.5">
          <Chip href="#" active>
            Tất cả (4)
          </Chip>
          <Chip href="#">Đang hiện (2)</Chip>
          <Chip href="#">Nháp (1)</Chip>
          <Chip href="#">Hết hạn (1)</Chip>
        </div>

        <div className="space-y-4">
          {/* Pinned */}
          <Card className="space-y-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <Pin
                aria-hidden
                className="size-[18px] text-terracotta-ink"
                strokeWidth={1.75}
              />
              <span className="inline-flex items-center rounded-control bg-terracotta/10 px-2.5 py-1 text-[14px] font-medium text-terracotta-ink">
                Đang ghim
              </span>
            </div>
            <h3 className="text-[19px] leading-snug font-semibold">
              {pinned.title}
            </h3>
            <p className="line-clamp-2 text-[15px] text-meta">{pinned.excerpt}</p>
            <p className="text-[14px] text-meta">
              Đăng {pinned.date} · {pinned.author} · hết hạn 14/08
            </p>
            <div className="flex flex-wrap items-center justify-between gap-4 border-t border-hairline pt-4">
              <StatePill state="showing" />
              <div className="flex flex-wrap gap-2">
                <Button variant="ghost" size="sm">
                  Sửa
                </Button>
                <Button variant="ghost" size="sm">
                  Bỏ ghim
                </Button>
                <Button variant="ghost" size="sm">
                  Ẩn
                </Button>
              </div>
            </div>
          </Card>

          {/* Showing, not pinned */}
          <Card className="space-y-3">
            <h3 className="text-[19px] leading-snug font-semibold">
              {showing.title}
            </h3>
            <p className="line-clamp-2 text-[15px] text-meta">{showing.excerpt}</p>
            <p className="text-[14px] text-meta">
              Đăng {showing.date} · {showing.author} · hết hạn 30/08
            </p>
            <div className="flex flex-wrap items-center justify-between gap-4 border-t border-hairline pt-4">
              <StatePill state="showing" />
              <div className="flex flex-wrap gap-2">
                <Button variant="ghost" size="sm">
                  Sửa
                </Button>
                <Button variant="ghost" size="sm">
                  Ẩn
                </Button>
              </div>
            </div>
          </Card>

          {/* Draft */}
          <Card className="space-y-3">
            <h3 className="text-[19px] leading-snug font-semibold">
              {draft.title}
            </h3>
            <p className="line-clamp-2 text-[15px] text-meta">{draft.excerpt}</p>
            <p className="text-[14px] text-meta">Chưa đăng · {draft.author}</p>
            <div className="flex flex-wrap items-center justify-between gap-4 border-t border-hairline pt-4">
              <StatePill state="draft" />
              <div className="flex flex-wrap gap-2">
                <Button variant="ghost" size="sm">
                  Sửa
                </Button>
                <Button variant="ghost" size="sm">
                  Đăng ngay
                </Button>
              </div>
            </div>
          </Card>

          {/* Expired, visibly dimmed */}
          <Card className="space-y-3 opacity-60">
            <h3 className="text-[19px] leading-snug font-semibold">
              {expired.title}
            </h3>
            <p className="line-clamp-2 text-[15px] text-meta">{expired.excerpt}</p>
            <p className="text-[14px] text-meta">
              Đăng {expired.date} · {expired.author} · hết hạn 05/07
            </p>
            <div className="flex flex-wrap items-center justify-between gap-4 border-t border-hairline pt-4">
              <StatePill state="expired" />
              <div className="flex flex-wrap gap-2">
                <Button variant="ghost" size="sm">
                  Sửa
                </Button>
                <Button variant="ghost" size="sm">
                  Đăng lại
                </Button>
              </div>
            </div>
          </Card>
        </div>

        <p className="text-[14px] text-meta">
          Thông báo được ghim sẽ hiện đầu trang tủ sách công khai.
        </p>
      </div>
    </ManagerShell>
  );
}
