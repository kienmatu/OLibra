import { notFound } from "next/navigation";
import { Bookmark } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BookCover, BookTitle } from "@/components/ui/book";
import { Card, PageHeading } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { ManagerShell } from "@/components/shell/manager-shell";
import { describeSelection } from "@/domain/members/parish-taxonomy";
import {
  bookBySlug,
  readers,
  shelfBySlug,
  shelves,
  type Reader,
  type Shelf,
} from "@/lib/fixtures";

export function generateStaticParams() {
  return shelves.map((s) => ({ shelf: s.slug }));
}

type QueueEntry = {
  initial: string;
  reader: Reader;
  date: string;
};

function QueueRow({
  position,
  entry,
  shelf,
  children,
  note,
}: {
  position: number;
  entry: QueueEntry;
  shelf: Shelf;
  children: React.ReactNode;
  note: string;
}) {
  const parish =
    describeSelection(shelf.parishTaxonomy, shelf.parishUnits, {
      l1: entry.reader.parishUnitL1Id,
      l2: entry.reader.parishUnitL2Id,
    }) || "Chưa có";

  return (
    <li className="py-4">
      <div className="flex flex-wrap items-center gap-4">
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-paper text-[17px] font-semibold text-ink"
        >
          {position}
        </span>
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-terracotta/10 text-[15px] font-semibold text-terracotta-ink"
        >
          {entry.initial}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[16px] font-medium">{entry.reader.fullName}</p>
          <p className="text-[14px] text-meta">
            Đăng ký {entry.date} · {parish}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">{children}</div>
      </div>
      <p className="mt-2 pl-14 text-[14px] text-meta">{note}</p>
    </li>
  );
}

export default async function BorrowRequestsPage({
  params,
}: {
  params: Promise<{ shelf: string }>;
}) {
  const { shelf: slug } = await params;
  const shelf = shelfBySlug(slug);
  if (!shelf) notFound();

  const hoangTuBe = bookBySlug("hoang-tu-be")!;
  const nhungTamLong = bookBySlug("nhung-tam-long-cao-ca")!;
  const haReader = readers.find((r) => r.id === "ha")!;
  const haParish =
    describeSelection(shelf.parishTaxonomy, shelf.parishUnits, {
      l1: haReader.parishUnitL1Id,
      l2: haReader.parishUnitL2Id,
    }) || "Chưa có";

  return (
    <ManagerShell
      shelfName={shelf.name}
      shelfSlug={shelf.slug}
      active="yeu-cau-muon"
    >
      <div className="space-y-8">
        <PageHeading
          title="Yêu cầu mượn"
          subtitle="2 cuốn có người đang chờ · Xếp theo thứ tự đăng ký."
        />

        <Card className="space-y-1">
          <div className="flex flex-wrap items-center gap-4">
            <BookCover title={hoangTuBe.title} className="w-14 shrink-0" />
            <div className="min-w-0 flex-1">
              <BookTitle as="p" className="text-[19px] leading-snug">
                {hoangTuBe.title}
              </BookTitle>
              <p className="text-[14px] text-meta">{hoangTuBe.author}</p>
            </div>
            <StatusBadge status={hoangTuBe.status} />
            <p className="text-[15px] text-meta">3 người đang chờ</p>
          </div>

          <ul className="mt-2 divide-y divide-hairline border-t border-hairline">
            <QueueRow
              position={1}
              shelf={shelf}
              entry={{
                initial: "G",
                reader: readers.find((r) => r.id === "minh")!,
                date: "02/08",
              }}
              note="Giữ chỗ 3 ngày kể từ khi duyệt."
            >
              {/* Outline, not solid: the one dominant action on this triage
                  page is confirming the handover whose hold lapses on 09/08. */}
              <Button variant="outline" size="md">
                Duyệt &amp; giữ chỗ
              </Button>
              <Button variant="danger" size="sm">
                Từ chối
              </Button>
            </QueueRow>
            <QueueRow
              position={2}
              shelf={shelf}
              entry={{
                initial: "T",
                reader: readers.find((r) => r.id === "anh")!,
                date: "03/08",
              }}
              note="Chỉ duyệt được khi tới lượt."
            >
              <Button variant="outline" size="sm">
                Bỏ qua
              </Button>
              <Button variant="outline" size="sm">
                Từ chối
              </Button>
            </QueueRow>
            <QueueRow
              position={3}
              shelf={shelf}
              entry={{
                initial: "M",
                reader: readers.find((r) => r.id === "linh")!,
                date: "04/08",
              }}
              note="Chỉ duyệt được khi tới lượt."
            >
              <Button variant="outline" size="sm">
                Bỏ qua
              </Button>
              <Button variant="outline" size="sm">
                Từ chối
              </Button>
            </QueueRow>
          </ul>
        </Card>

        <Card className="space-y-1">
          <div className="flex flex-wrap items-center gap-4">
            <BookCover title={nhungTamLong.title} className="w-14 shrink-0" />
            <div className="min-w-0 flex-1">
              <BookTitle as="p" className="text-[19px] leading-snug">
                {nhungTamLong.title}
              </BookTitle>
              <p className="text-[14px] text-meta">{nhungTamLong.author}</p>
            </div>
            <StatusBadge status={nhungTamLong.status} />
            <p className="text-[15px] text-meta">1 người đang chờ</p>
          </div>

          <ul className="mt-2 divide-y divide-hairline border-t border-hairline">
            <li className="py-4">
              <div className="flex flex-wrap items-center gap-4">
                <span
                  aria-hidden
                  className="flex size-10 shrink-0 items-center justify-center rounded-full bg-paper text-[17px] font-semibold text-ink"
                >
                  1
                </span>
                <span
                  aria-hidden
                  className="flex size-10 shrink-0 items-center justify-center rounded-full bg-terracotta/10 text-[15px] font-semibold text-terracotta-ink"
                >
                  A
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[16px] font-medium">{haReader.fullName}</p>
                  <p className="text-[14px] text-meta">
                    Đăng ký 30/07 · {haParish}
                  </p>
                </div>
              </div>

              <div className="mt-3 flex items-center gap-2.5 rounded-control bg-held/10 p-3 pl-14 text-[15px] font-medium text-held">
                <Bookmark
                  aria-hidden
                  className="size-[18px] shrink-0"
                  strokeWidth={1.75}
                />
                Đang giữ chỗ cho bạn này · hết hạn giữ 09/08
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2 pl-14">
                <Button variant="primary" size="lg">
                  Xác nhận trao sách
                </Button>
                <Button variant="outline" size="sm">
                  Bỏ qua
                </Button>
              </div>
              <p className="mt-2 pl-14 text-[14px] text-meta">
                Nếu bạn đọc không đến, bỏ qua để chuyển cho người kế tiếp.
              </p>
            </li>
          </ul>
        </Card>

        <p className="text-[14px] text-meta">
          Hệ thống không tự động giữ chỗ. Quản lý quyết định từng trường hợp.
        </p>
      </div>
    </ManagerShell>
  );
}
