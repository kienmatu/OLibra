import { Download } from "lucide-react";
import { AdminShell } from "@/components/shell/manager-shell";
import { Button } from "@/components/ui/button";
import { PageHeading } from "@/components/ui/card";
import { Field, Input, ReadOnlyValue, Select, Toggle } from "@/components/ui/field";

export const metadata = { title: "Cài đặt hệ thống — Quản trị OLibra" };

function DefaultField({
  id,
  label,
  hint,
  defaultValue,
  suffix,
}: {
  id: string;
  label: string;
  hint: string;
  defaultValue: number;
  suffix: string;
}) {
  return (
    <Field label={label} required htmlFor={id} hint={hint}>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type="number"
          defaultValue={defaultValue}
          className="h-12 w-24 text-center"
        />
        <span className="text-[15px] text-meta">{suffix}</span>
      </div>
    </Field>
  );
}

export default function AdminSystemSettingsPage() {
  return (
    <AdminShell active="cai-dat">
      <PageHeading title="Cài đặt hệ thống" />

      <form className="mt-8 max-w-2xl space-y-12">
        <section className="space-y-6">
          <h2 className="text-xl font-semibold">Mặc định cho tủ sách mới</h2>

          <DefaultField
            id="mac-dinh-so-ngay-cho-muon"
            label="Số ngày cho mượn"
            hint="Chỉ là giá trị mặc định khi tạo tủ sách mới — mỗi tủ sách có thể tự đổi sau đó."
            defaultValue={14}
            suffix="ngày"
          />
          <DefaultField
            id="mac-dinh-so-sach-muon-cung-luc"
            label="Số sách mượn cùng lúc"
            hint="Chỉ là giá trị mặc định — mỗi tủ sách có thể tự đổi sau đó."
            defaultValue={3}
            suffix="cuốn"
          />
          <DefaultField
            id="mac-dinh-so-ngay-giu-cho"
            label="Số ngày giữ chỗ"
            hint="Chỉ là giá trị mặc định — mỗi tủ sách có thể tự đổi sau đó."
            defaultValue={3}
            suffix="ngày"
          />
        </section>

        <section className="space-y-6">
          <h2 className="text-xl font-semibold">Ngôn ngữ và múi giờ</h2>

          <Field label="Ngôn ngữ" htmlFor="ngon-ngu">
            <Select id="ngon-ngu" defaultValue="vi">
              <option value="vi">Tiếng Việt</option>
            </Select>
          </Field>

          <Field label="Múi giờ">
            <ReadOnlyValue note="Toàn hệ thống dùng một múi giờ. Ngày tháng luôn được hiểu theo giờ Việt Nam.">
              Asia/Ho_Chi_Minh
            </ReadOnlyValue>
          </Field>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">Thông báo</h2>

          <div className="rounded-card border border-hairline bg-paper p-5">
            <p className="text-[15px] text-ink">
              Phiên bản này chỉ báo tin trong ứng dụng. Không có email, không có tin
              nhắn.
            </p>
          </div>

          <div className="flex items-center justify-between gap-4 border-t border-hairline pt-4">
            <div>
              <p className="text-[16px] font-medium">Gửi email</p>
              <p className="mt-0.5 text-[14px] text-meta">Chưa dùng được.</p>
            </div>
            <Toggle on={false} disabled label="Gửi email" />
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">Sao lưu</h2>
          <p className="text-[14px] text-meta">
            Bản sao lưu gần nhất: 06/08/2026, 03:00
          </p>
          <Button type="button" variant="quiet" size="sm">
            <Download aria-hidden className="size-[18px]" strokeWidth={1.75} />
            Tải bản sao lưu
          </Button>
        </section>

        <div className="flex items-center gap-3 border-t border-hairline pt-8">
          <Button type="submit" variant="primary" size="lg">
            Lưu cài đặt
          </Button>
          <Button type="button" variant="ghost" size="lg">
            Huỷ
          </Button>
        </div>
      </form>
    </AdminShell>
  );
}
