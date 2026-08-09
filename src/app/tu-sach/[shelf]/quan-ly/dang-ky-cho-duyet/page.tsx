import { notFound } from "next/navigation";
import { AlertTriangle, Check, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, PageHeading } from "@/components/ui/card";
import { PhoneLink } from "@/components/ui/phone-link";
import { ManagerShell } from "@/components/shell/manager-shell";
import { describeSelection } from "@/domain/members/parish-taxonomy";
import { readers, shelfBySlug, shelves } from "@/lib/fixtures";

export function generateStaticParams() {
  return shelves.map((s) => ({ shelf: s.slug }));
}

/** One field shown as a meta label above its value — used inside every group. */
function FieldValue({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[14px] text-meta">{label}</p>
      <p className="mt-0.5 text-[16px]">{value}</p>
    </div>
  );
}

function FieldGroup({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="text-[15px] font-semibold">{heading}</h3>
      <div className="mt-2 border-t border-hairline" />
      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4">{children}</div>
    </div>
  );
}

export default async function PendingApplicationsPage({
  params,
}: {
  params: Promise<{ shelf: string }>;
}) {
  const { shelf: slug } = await params;
  const shelf = shelfBySlug(slug);
  if (!shelf) notFound();

  // Stands in for the pending application: same name, birth date and login
  // as the existing member "lan" — this queue has no submission of its own
  // yet, so it borrows a reader who already carries a real parish selection
  // to render from.
  const applicant = readers.find((r) => r.id === "lan")!;
  const applicantParish =
    describeSelection(shelf.parishTaxonomy, shelf.parishUnits, {
      l1: applicant.parishUnitL1Id,
      l2: applicant.parishUnitL2Id,
    }) || "Chưa có";

  return (
    <ManagerShell
      shelfName={shelf.name}
      shelfSlug={shelf.slug}
      active="dang-ky-cho-duyet"
      viewer={null}
      counts={null}
    >
      <div className="space-y-8">
        <PageHeading
          title="Đăng ký chờ duyệt"
          subtitle="5 đơn đang chờ · Quản lý cần gặp mặt và xác nhận thông tin trước khi duyệt."
        />

        {/* A single actionable card on top; the sliver beneath reads as a
            stack of four more applications waiting behind it. */}
        <div className="relative pb-3">
          <div
            aria-hidden
            className="absolute inset-x-4 bottom-0 h-10 rounded-card border border-hairline bg-paper"
          />
          <Card className="relative space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-center gap-4">
                <span
                  aria-hidden
                  className="flex size-14 shrink-0 items-center justify-center rounded-full bg-paper text-[20px] font-semibold text-leather"
                >
                  M
                </span>
                <div>
                  <p className="text-xl font-semibold">Maria Nguyễn Thị Lan</p>
                  <p className="mt-0.5 text-[14px] text-meta">
                    Gửi lúc 09:12 ngày 04/08 · Chờ duyệt 2 ngày
                  </p>
                </div>
              </div>
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-control bg-held/10 px-2.5 py-1 text-[14px] font-medium text-held">
                <Clock aria-hidden className="size-[18px]" strokeWidth={1.75} />
                Chờ duyệt
              </span>
            </div>

            <div className="flex gap-3 rounded-card border border-onloan bg-onloan/10 p-4">
              <AlertTriangle
                aria-hidden
                className="size-5 shrink-0 text-onloan"
                strokeWidth={1.75}
              />
              <div>
                <p className="font-semibold text-onloan">Có thành viên trùng tên</p>
                <p className="mt-1 text-[15px] text-ink/90">
                  Tủ sách đã có Maria Nguyễn Thị Lan · sinh {applicant.born} ·{" "}
                  {applicantParish}. Kiểm tra xem có phải cùng một người không.
                </p>
                <button
                  type="button"
                  className="mt-2 min-h-11 text-[15px] font-medium text-sage hover:underline"
                >
                  Xem hồ sơ đã có
                </button>
              </div>
            </div>

            <div className="space-y-6">
              <FieldGroup heading="Bản thân">
                <FieldValue label="Tên thánh" value="Maria" />
                <FieldValue label="Họ và tên" value="Nguyễn Thị Lan" />
                <FieldValue label="Ngày sinh" value="12/05/2015 (11 tuổi)" />
              </FieldGroup>

              <FieldGroup heading="Gia đình">
                <FieldValue label="Tên cha" value="Giuse Nguyễn Văn Hoà" />
                <FieldValue label="Tên mẹ" value="Anna Trần Thị Mai" />
                <FieldValue
                  label="Số điện thoại"
                  value={<PhoneLink phone="0912 345 678" size="md" />}
                />
              </FieldGroup>

              <FieldGroup heading="Giáo xứ">
                <FieldValue label="Giáo xứ" value={applicantParish} />
                <FieldValue label="Tên đăng nhập" value="lan.nguyen" />
              </FieldGroup>
            </div>

            <div className="flex flex-wrap items-center gap-4 border-t border-hairline pt-6">
              <Button variant="primary" size="lg">
                <Check aria-hidden className="size-5" strokeWidth={1.75} />
                Duyệt đăng ký
              </Button>
              <Button variant="danger" size="md">
                Từ chối
              </Button>
              <p className="text-[14px] text-meta">Từ chối cần ghi lý do.</p>
            </div>
          </Card>
        </div>
      </div>
    </ManagerShell>
  );
}
