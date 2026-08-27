import { Check, Clock, Image as ImageIcon } from "lucide-react";
import { Card, PageHeading } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { SubmitButton } from "@/components/ui/submit-button";
import { ManagerShell } from "@/components/shell/manager-shell";
import { messageFor } from "@/domain/kernel/errors";
import { getDonationQueue } from "@/domain/community/queries/get-my-donations";
import { getManagerBadgeCounts } from "@/domain/shelf/queries/get-manager-dashboard";
import { formatInstant } from "@/lib/dates";
import { loadPage } from "@/lib/page-data";
import { refusalFrom, type SearchParams } from "@/lib/search-params";
import { readShelf } from "@/lib/shelf";
import { declineDonationAction, receiveDonationAction } from "../actions";

/**
 * The manager's donation queue (BR §16.3) — reachable from the sidebar with a
 * count badge, deliberately not a fifth dashboard stat card (BR:571 already
 * spends that decision on four).
 *
 * **Duyệt is a form, not a link, and that is the correction this wiring makes.**
 * The fixture version was a `ButtonLink` straight to `sach/moi?nguoi_tang_id=…`,
 * which opened the add-book form and left the offer sitting in the queue
 * forever — a manager could catalogue a donated book and the reader would still
 * be told "Đang chờ". `receiveDonation` runs first and the redirect happens
 * after it commits, so the two halves of BR §16.3's hand-off cannot come apart.
 *
 * `receiveDonation` still writes no book: OPS §4.4 keeps cataloguing a separate,
 * manager-typed `CreateBook` "because a bag of books is not a catalogue entry
 * and only a person holding them knows what they are". The redirect is what
 * carries the donor across.
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "Tặng sách — Quản lý tủ sách OLibra" };

const NUMBER = new Intl.NumberFormat("vi-VN");

export default async function DonationQueuePage({
  params,
  searchParams,
}: {
  params: Promise<{ shelf: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { shelf: slug } = await params;
  const refusal = refusalFrom(await searchParams);

  const { shelf, viewer, counts, queue } = await loadPage(
    slug,
    async (tx, ctx, v) => ({
      shelf: await readShelf(tx, ctx),
      viewer: v,
      counts: await getManagerBadgeCounts(tx, ctx),
      queue: await getDonationQueue(tx, ctx),
    }),
  );

  return (
    <ManagerShell
      shelfName={shelf.name}
      shelfSlug={slug}
      active="tang-sach"
      viewer={viewer}
      counts={counts}
    >
      <div className="space-y-8">
        <PageHeading
          title="Tặng sách"
          subtitle={
            queue.length === 0
              ? "Không có lời đề nghị nào đang chờ."
              : `${NUMBER.format(queue.length)} lời đề nghị đang chờ · Duyệt sẽ mở form thêm sách với Người tặng đã điền sẵn.`
          }
        />

        {refusal ? (
          <p className="rounded-card border border-hairline bg-surface px-4 py-3 text-[14px] text-ink">
            {messageFor(refusal)}
          </p>
        ) : null}

        <div className="space-y-6">
          {queue.map((donation) => (
            <Card key={donation.donationId} className="space-y-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex items-center gap-4">
                  <span
                    aria-hidden
                    className="flex size-14 shrink-0 items-center justify-center rounded-full bg-paper text-[20px] font-semibold text-leather"
                  >
                    {donation.donorName.split(" ").at(-1)?.charAt(0) ?? ""}
                  </span>
                  <div>
                    <p className="text-xl font-semibold">{donation.donorName}</p>
                    <p className="mt-0.5 text-[14px] text-meta">
                      Gửi {formatInstant(donation.offeredAt)}
                    </p>
                  </div>
                </div>
                <Pill icon={Clock} label="Chờ duyệt" tone="held" />
              </div>

              <div className="grid gap-6 sm:grid-cols-[1fr_auto]">
                <div className="space-y-4">
                  <div>
                    <p className="text-[14px] text-meta">Mô tả từ bạn đọc</p>
                    <p className="mt-1 text-[16px] whitespace-pre-line">
                      {donation.description}
                    </p>
                  </div>
                  {donation.estimatedCount !== null ? (
                    <div>
                      <p className="text-[14px] text-meta">Số lượng áng chừng</p>
                      <p className="mt-1 text-[16px]">
                        Khoảng {NUMBER.format(donation.estimatedCount)} cuốn
                      </p>
                    </div>
                  ) : null}
                </div>

                {donation.photoUrl ? (
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

              <div className="flex flex-wrap items-start gap-4 border-t border-hairline pt-6">
                <form action={receiveDonationAction}>
                  <input type="hidden" name="tu-sach" value={slug} />
                  <input
                    type="hidden"
                    name="loi-tang"
                    value={donation.donationId}
                  />
                  {/* A `memberships(id)` — `book_donations.donor_membership_id`,
                      the reverse of this codebase's usual actor column. */}
                  <input
                    type="hidden"
                    name="nguoi-tang"
                    value={donation.donorMembershipId}
                  />
                  <SubmitButton
                    icon={
                      <Check aria-hidden className="size-5" strokeWidth={1.75} />
                    }
                  >
                    Duyệt
                  </SubmitButton>
                </form>

                <details className="min-w-0">
                  <summary className="inline-flex h-12 cursor-pointer list-none items-center justify-center gap-2 rounded-control border border-brick px-5 text-[16px] font-semibold text-brick transition-colors hover:bg-brick/8 [&::-webkit-details-marker]:hidden">
                    Từ chối
                  </summary>
                  <form
                    action={declineDonationAction}
                    className="mt-3 w-full max-w-md space-y-3"
                  >
                    <input type="hidden" name="tu-sach" value={slug} />
                    <input
                      type="hidden"
                      name="loi-tang"
                      value={donation.donationId}
                    />
                    <Field
                      label="Lý do từ chối"
                      required
                      htmlFor={`ly-do-${donation.donationId}`}
                      hint="Bạn đọc sẽ thấy lý do này trên trang Tặng sách của mình."
                    >
                      <Input
                        id={`ly-do-${donation.donationId}`}
                        name="ly-do"
                        required
                      />
                    </Field>
                    <SubmitButton variant="danger" size="md">
                      Xác nhận từ chối
                    </SubmitButton>
                  </form>
                </details>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </ManagerShell>
  );
}
