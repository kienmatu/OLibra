import { notFound } from "next/navigation";
import { AlertTriangle, ArrowRight, Check, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, PageHeading } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { ManagerShell } from "@/components/shell/manager-shell";
import { shelfBySlug, shelves } from "@/lib/fixtures";

export function generateStaticParams() {
  return shelves.map((s) => ({ shelf: s.slug }));
}

/**
 * The heart of the card (§16.3): current and proposed values sit side by
 * side, with the proposed one visually emphasised rather than merely listed
 * after the old one. Nothing here is struck through — the current value is
 * still the one in force until a manager approves.
 */
function CompareRow({
  label,
  current,
  proposed,
}: {
  label: string;
  current: React.ReactNode;
  proposed: React.ReactNode;
}) {
  return (
    <div className="py-4">
      <p className="text-[14px] font-medium text-meta">{label}</p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <span className="text-[16px] text-ink/60">{current}</span>
        <ArrowRight
          aria-hidden
          className="size-4 shrink-0 text-leather"
          strokeWidth={2}
        />
        <span className="rounded-control bg-terracotta/10 px-3 py-1.5 text-[16px] font-semibold text-terracotta-ink">
          {proposed}
        </span>
      </div>
    </div>
  );
}

/** Same current-versus-proposed shape, but for the one field that isn't text. */
function AvatarCompareRow({ label, initial }: { label: string; initial: string }) {
  return (
    <div className="py-4">
      <p className="text-[14px] font-medium text-meta">{label}</p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <span
          aria-hidden
          className="flex size-12 shrink-0 items-center justify-center rounded-full bg-paper text-[16px] font-semibold text-leather"
        >
          {initial}
        </span>
        <ArrowRight
          aria-hidden
          className="size-4 shrink-0 text-leather"
          strokeWidth={2}
        />
        <span
          aria-hidden
          className="flex size-12 shrink-0 items-center justify-center rounded-full border-2 border-terracotta bg-terracotta/10 text-[16px] font-semibold text-terracotta-ink"
        >
          {initial}
        </span>
      </div>
      <p className="mt-2 text-[14px] text-meta">Bạn đọc gửi kèm một ảnh mới.</p>
    </div>
  );
}

function RequestCard({
  initial,
  name,
  sentAt,
  approveVariant,
  verifyNote,
  children,
}: {
  initial: string;
  name: string;
  sentAt: string;
  approveVariant: "primary" | "outline";
  /** Only some proposals warrant this — a field the manager should confirm
      in person before approving, such as a date of birth. */
  verifyNote?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <span
            aria-hidden
            className="flex size-14 shrink-0 items-center justify-center rounded-full bg-paper text-[20px] font-semibold text-leather"
          >
            {initial}
          </span>
          <div>
            <p className="text-xl font-semibold">{name}</p>
            <p className="mt-0.5 text-[14px] text-meta">{sentAt}</p>
          </div>
        </div>
        <Pill icon={Clock} label="Chờ duyệt" tone="held" />
      </div>

      <div className="divide-y divide-hairline border-y border-hairline">
        {children}
      </div>

      {verifyNote ? (
        <div className="flex gap-3 rounded-card border border-onloan bg-onloan/10 p-4">
          <AlertTriangle
            aria-hidden
            className="size-5 shrink-0 text-onloan"
            strokeWidth={1.75}
          />
          <div>
            <p className="font-semibold text-onloan">Nên xác minh trực tiếp</p>
            <p className="mt-1 text-[15px] text-ink/90">{verifyNote}</p>
          </div>
        </div>
      ) : null}

      <p className="text-[14px] text-meta">
        Giá trị hiện tại vẫn dùng được cho tới khi duyệt.
      </p>

      <div className="flex flex-wrap items-center gap-4 border-t border-hairline pt-6">
        <Button variant={approveVariant} size="lg">
          <Check aria-hidden className="size-5" strokeWidth={1.75} />
          Duyệt thay đổi
        </Button>
        <Button variant="danger" size="md">
          Từ chối
        </Button>
        <p className="text-[14px] text-meta">
          Từ chối cần ghi lý do — bạn đọc sẽ thấy lý do này.
        </p>
      </div>
    </Card>
  );
}

export default async function PendingProfileChangesPage({
  params,
}: {
  params: Promise<{ shelf: string }>;
}) {
  const { shelf: slug } = await params;
  const shelf = shelfBySlug(slug);
  if (!shelf) notFound();

  return (
    <ManagerShell
      shelfName={shelf.name}
      shelfSlug={shelf.slug}
      active="doi-thong-tin"
    >
      <div className="space-y-8">
        <PageHeading
          title="Đổi thông tin"
          subtitle="2 đề nghị đang chờ · Thông tin cũ vẫn có hiệu lực cho tới khi bạn duyệt."
        />

        {/* Only the top card carries the solid terracotta approve action —
            two solid-terracotta buttons on one screen would both be wrong
            (AGENTS.md §"one primary action per screen"). The second card's
            approve button is an outline of the same colour, matching the
            pattern already used on the request-queue page. */}
        <RequestCard
          initial="G"
          name="Giuse Trần Minh"
          sentAt="Gửi lúc 08:40 ngày 06/08"
          approveVariant="primary"
        >
          <CompareRow
            label="Số điện thoại"
            current="0912 345 678"
            proposed="0912 345 999"
          />
          <AvatarCompareRow label="Ảnh đại diện" initial="G" />
        </RequestCard>

        <RequestCard
          initial="T"
          name="Têrêsa Lê Ngọc Ánh"
          sentAt="Gửi lúc 20:15 ngày 05/08"
          approveVariant="outline"
          verifyNote="Ngày sinh là một trong những thông tin giúp phân biệt hai em trùng tên. Đổi ngày sinh đáng để hỏi lại gia đình trước khi duyệt."
        >
          <CompareRow
            label="Ngày sinh"
            current="21/01/2016"
            proposed="21/03/2016"
          />
          <CompareRow
            label="Tên mẹ"
            current="Maria Ngô Thị Bích"
            proposed="Maria Ngô Thị Bích Hạnh"
          />
        </RequestCard>
      </div>
    </ManagerShell>
  );
}
