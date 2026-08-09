import Link from "next/link";
import { notFound } from "next/navigation";
import { Clock, CircleCheckBig, CircleX, Gift, ImageIcon } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { PageHeading } from "@/components/ui/card";
import { Pill, type PillTone } from "@/components/ui/pill";
import { ShelfHeader } from "@/components/shell/public-header";
import { ReaderTabs } from "@/components/shell/reader-tabs";
import {
  donationsByReader,
  fixtureViewerName,
  shelfBySlug,
  shelves,
} from "@/lib/fixtures";
import type { Donation } from "@/lib/fixtures";
import type { LucideIcon } from "lucide-react";

export function generateStaticParams() {
  return shelves.map((s) => ({ shelf: s.slug }));
}

const STATUS: Record<
  Donation["status"],
  { label: string; icon: LucideIcon; tone: PillTone }
> = {
  pending: { label: "Chờ duyệt", icon: Clock, tone: "held" },
  received: { label: "Đã nhận", icon: CircleCheckBig, tone: "available" },
  declined: { label: "Đã từ chối", icon: CircleX, tone: "overdue" },
};

/**
 * `GetMyDonations` (§16.2 of the requirements) — the reader's own offers and
 * where each stands, "the same way they already track any other request on
 * this page." Reached from `ReaderTabs`, the way every other reader page is
 * reached; previously the offer form at `/tang-sach` was linked only from
 * the shelf-home footer and nothing let a reader check back on what they'd
 * already sent.
 */
export default async function MyDonationsPage({
  params,
}: {
  params: Promise<{ shelf: string }>;
}) {
  const { shelf: slug } = await params;
  const shelf = shelfBySlug(slug);
  if (!shelf) notFound();

  const base = `/tu-sach/${shelf.slug}`;
  // Every reader-facing page under /toi is a fixture for reader "minh"
  // (Giuse Trần Minh) — same convention as /toi, /toi/lich-su, /toi/ho-so.
  const myDonations = donationsByReader("minh");

  return (
    <>
      <ShelfHeader
        shelfName={shelf.name}
        shelfSlug={shelf.slug}
        viewerName={fixtureViewerName}
      />
      <ReaderTabs shelfSlug={shelf.slug} active="tang-sach" />

      <main className="mx-auto max-w-3xl px-6 py-10">
        <PageHeading
          title="Tặng sách của em"
          subtitle="Những lời đề nghị tặng sách em đã gửi, và tình trạng từng lời."
          action={
            <ButtonLink href={`${base}/tang-sach`} variant="primary" size="md">
              <Gift aria-hidden className="size-5" strokeWidth={1.75} />
              Gửi lời đề nghị mới
            </ButtonLink>
          }
        />

        {myDonations.length > 0 ? (
          <ul className="mt-8 space-y-4">
            {myDonations.map((donation) => {
              const status = STATUS[donation.status];
              return (
                <li
                  key={donation.id}
                  className="rounded-card border border-hairline bg-surface p-5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <p className="text-[15px] text-meta">
                      Gửi ngày {donation.submittedOn}
                    </p>
                    <Pill
                      icon={status.icon}
                      label={status.label}
                      tone={status.tone}
                    />
                  </div>
                  <p className="mt-2 text-[16px]">{donation.description}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[14px] text-meta">
                    {donation.estimatedCount ? (
                      <span>Khoảng {donation.estimatedCount} cuốn</span>
                    ) : null}
                    {donation.hasPhoto ? (
                      <span className="inline-flex items-center gap-1">
                        <ImageIcon
                          aria-hidden
                          className="size-4"
                          strokeWidth={1.75}
                        />
                        Có ảnh đính kèm
                      </span>
                    ) : null}
                  </div>
                  {donation.status === "declined" && donation.decisionNote ? (
                    <p className="mt-3 rounded-control bg-paper p-3 text-[14px]">
                      Lý do từ chối: {donation.decisionNote}
                    </p>
                  ) : null}
                  {donation.status === "received" ? (
                    <p className="mt-3 text-[14px] text-meta">
                      Cảm ơn em! Sách đã được quản lý nhận vào tủ sách.
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="mt-8 rounded-card border border-hairline bg-paper p-6 text-center">
            <p className="text-[16px]">Em chưa gửi lời đề nghị tặng sách nào.</p>
            <Link
              href={`${base}/tang-sach`}
              className="mt-2 inline-flex min-h-11 items-center text-[15px] font-medium text-sage hover:underline"
            >
              Gửi lời đề nghị đầu tiên
            </Link>
          </div>
        )}
      </main>
    </>
  );
}
