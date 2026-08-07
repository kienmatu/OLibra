import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { ManagerShell } from "@/components/shell/manager-shell";
import { PageHeading } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PhoneLink } from "@/components/ui/phone-link";
import { shelfBySlug, shelves } from "@/lib/fixtures";

export const metadata = { title: "Cài đặt — Quản lý tủ sách OLibra" };

export function generateStaticParams() {
  return shelves.map((s) => ({ shelf: s.slug }));
}

/** One label/value row with a hairline rule above it — read-only, since a
 * manager can see this information but only a quản trị viên can change it. */
function InfoRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-t border-hairline py-4 first:border-t-0">
      <dt className="text-[15px] text-meta">{label}</dt>
      <dd className="text-[16px] font-medium text-ink">{children}</dd>
    </div>
  );
}

/** A lending-policy row: name and explanation on the left, the value on the
 * right — plain text, never a control, because a manager cannot edit it. */
function PolicyRow({
  label,
  hint,
  value,
}: {
  label: string;
  hint: string;
  value: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-t border-hairline py-4 first:border-t-0">
      <div className="max-w-md min-w-0">
        <p className="text-[16px] font-medium">{label}</p>
        <p className="mt-0.5 text-[14px] text-meta">{hint}</p>
      </div>
      <p className="shrink-0 text-[16px] font-semibold text-ink/85">{value}</p>
    </div>
  );
}

export default async function ManagerSettingsPage({
  params,
}: {
  params: Promise<{ shelf: string }>;
}) {
  const { shelf: slug } = await params;
  const shelf = shelfBySlug(slug);
  if (!shelf) notFound();

  return (
    <ManagerShell shelfName={shelf.name} shelfSlug={shelf.slug} active="cai-dat">
      <PageHeading title="Cài đặt" subtitle={`Cài đặt của ${shelf.name}.`} />

      <div className="mt-8 max-w-2xl space-y-12">
        <section>
          <h2 className="text-xl font-semibold">Thông tin tủ sách</h2>
          <dl className="mt-4">
            <InfoRow label="Tên tủ sách">{shelf.name}</InfoRow>
            <InfoRow label="Địa chỉ">{shelf.location}</InfoRow>
            <InfoRow label="Giờ mở cửa">{shelf.hours}</InfoRow>
            <InfoRow label="Người giữ chìa khoá">
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {shelf.keeper}
                <PhoneLink phone={shelf.phone} size="sm" />
              </span>
            </InfoRow>
          </dl>
          <p className="mt-3 text-[14px] text-meta">
            Muốn đổi những thông tin này thì nhờ quản trị viên giúp.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">Quy định cho mượn</h2>
          <div className="mt-4">
            <PolicyRow
              label="Số ngày cho mượn"
              hint="Số ngày bạn đọc được giữ sách trong một lượt mượn."
              value="14 ngày"
            />
            <PolicyRow
              label="Số sách mượn cùng lúc"
              hint="Số cuốn tối đa một bạn đọc được giữ cùng lúc."
              value="3 cuốn"
            />
            <PolicyRow
              label="Số lần gia hạn"
              hint="Số lần bạn đọc được xin gia hạn cho một lượt mượn."
              value="1 lần"
            />
            <PolicyRow
              label="Số ngày mỗi lần gia hạn"
              hint="Số ngày được cộng thêm mỗi lần gia hạn."
              value="7 ngày"
            />
            <PolicyRow
              label="Số ngày giữ chỗ"
              hint="Số ngày tủ sách giữ sách cho bạn đọc đã đăng ký chờ mượn."
              value="3 ngày"
            />
            <PolicyRow
              label="Báo sắp đến hạn trước"
              hint="Số ngày trước hạn trả mà hệ thống nhắc bạn đọc."
              value="3 ngày"
            />
          </div>
          <p className="mt-3 text-[14px] text-meta">
            Chỉ quản trị viên mới đổi được các mục này.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">Xuất dữ liệu</h2>
          <p className="mt-2 text-[15px] text-meta">
            Tải toàn bộ dữ liệu về máy để phòng khi cần.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button variant="quiet" size="sm">
              <Download aria-hidden className="size-[18px]" strokeWidth={1.75} />
              Xuất danh sách sách
            </Button>
            <Button variant="quiet" size="sm">
              <Download aria-hidden className="size-[18px]" strokeWidth={1.75} />
              Xuất danh sách bạn đọc
            </Button>
            <Button variant="quiet" size="sm">
              <Download aria-hidden className="size-[18px]" strokeWidth={1.75} />
              Xuất lịch sử mượn
            </Button>
          </div>
        </section>
      </div>
    </ManagerShell>
  );
}
