import { notFound } from "next/navigation";
import { Check, Clock, Image as ImageIcon } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, PageHeading } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { ManagerShell } from "@/components/shell/manager-shell";
import { describeSelection } from "@/domain/members/parish-taxonomy";
import { donationQueue, readerById, shelfBySlug, shelves } from "@/lib/fixtures";

export function generateStaticParams() {
  return shelves.map((s) => ({ shelf: s.slug }));
}

/**
 * The manager's donation queue (§3 of the refinements design; BR §16.3) —
 * reachable from the sidebar with a count badge, deliberately not a fifth
 * dashboard stat card (§16.3 already spends that decision on four).
 */
export default async function DonationQueuePage({
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
      active="tang-sach"
      viewer={null}
      counts={null}
    >
      <div className="space-y-8">
        <PageHeading
          title="Tặng sách"
          subtitle={`${donationQueue.length} lời đề nghị đang chờ · Duyệt sẽ mở form thêm sách với Người tặng đã điền sẵn.`}
        />

        <div className="space-y-6">
          {donationQueue.map((donation, i) => {
            const donor = readerById(donation.readerId);
            const donorName = donor?.fullName ?? "Bạn đọc";
            const initial = donorName.charAt(0).toUpperCase();
            const donorParish = donor
              ? describeSelection(shelf.parishTaxonomy, shelf.parishUnits, {
                  l1: donor.parishUnitL1Id,
                  l2: donor.parishUnitL2Id,
                })
              : "";
            // Only the first card carries the solid terracotta approve
            // action — two solid-terracotta buttons on one screen would both
            // be wrong (button.tsx: "if two things on a screen are
            // terracotta, one of them is wrong"). Same pattern as the
            // pending-profile-changes queue.
            const approveVariant = i === 0 ? "primary" : "outline";

            return (
              <Card key={donation.id} className="space-y-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <span
                      aria-hidden
                      className="flex size-14 shrink-0 items-center justify-center rounded-full bg-paper text-[20px] font-semibold text-leather"
                    >
                      {initial}
                    </span>
                    <div>
                      <p className="text-xl font-semibold">{donorName}</p>
                      <p className="mt-0.5 text-[14px] text-meta">
                        {donorParish ? `${donorParish} · ` : ""}Gửi ngày{" "}
                        {donation.submittedOn}
                      </p>
                    </div>
                  </div>
                  <Pill icon={Clock} label="Chờ duyệt" tone="held" />
                </div>

                <div className="grid gap-6 sm:grid-cols-[1fr_auto]">
                  <div className="space-y-4">
                    <div>
                      <p className="text-[14px] text-meta">Mô tả từ bạn đọc</p>
                      <p className="mt-1 text-[16px]">{donation.description}</p>
                    </div>
                    {donation.estimatedCount ? (
                      <div>
                        <p className="text-[14px] text-meta">Số lượng áng chừng</p>
                        <p className="mt-1 text-[16px]">
                          Khoảng {donation.estimatedCount} cuốn
                        </p>
                      </div>
                    ) : null}
                  </div>

                  {donation.hasPhoto ? (
                    <div className="flex aspect-video w-full max-w-40 shrink-0 flex-col items-center justify-center gap-1.5 rounded-card border border-hairline bg-paper text-center sm:w-40">
                      <ImageIcon
                        aria-hidden
                        className="size-6 text-leather"
                        strokeWidth={1.75}
                      />
                      <span className="px-2 text-[12px] text-meta">
                        Ảnh bạn đọc gửi kèm
                      </span>
                    </div>
                  ) : (
                    <p className="text-[14px] text-meta sm:max-w-40">
                      Không có ảnh đính kèm
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-4 border-t border-hairline pt-6">
                  <ButtonLink
                    href={`${base}/sach/moi?nguoi_tang_id=${donation.readerId}`}
                    variant={approveVariant}
                    size="lg"
                  >
                    <Check aria-hidden className="size-5" strokeWidth={1.75} />
                    Duyệt
                  </ButtonLink>
                  <Button variant="danger" size="md">
                    Từ chối
                  </Button>
                  <p className="text-[14px] text-meta">
                    Từ chối cần ghi lý do — bạn đọc sẽ thấy lý do này.
                  </p>
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    </ManagerShell>
  );
}
