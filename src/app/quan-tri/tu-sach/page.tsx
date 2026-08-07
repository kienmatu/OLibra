import Link from "next/link";
import { ArrowLeft, Lock } from "lucide-react";
import { AdminShell } from "@/components/shell/manager-shell";
import { Button } from "@/components/ui/button";
import {
  Field,
  Input,
  ReadOnlyValue,
  Textarea,
  Toggle,
} from "@/components/ui/field";
import { shelf } from "@/lib/fixtures";

export const metadata = { title: "Tủ sách Đồng Tháp — Quản trị OLibra" };

/** A settings row with a hairline rule above it — name and explanation on the
 * left, a compact control on the right. Used for every lending rule below. */
function SettingRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-t border-hairline py-4 first:border-t-0">
      <div className="max-w-md min-w-0">
        <p className="text-[16px] font-medium">{label}</p>
        <p className="mt-0.5 text-[14px] text-meta">{hint}</p>
      </div>
      <div className="flex shrink-0 items-center gap-3">{children}</div>
    </div>
  );
}

function NumberField({
  defaultValue,
  suffix,
  label,
}: {
  defaultValue: number;
  suffix: string;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        defaultValue={defaultValue}
        aria-label={label}
        className="h-11 w-20 text-center"
      />
      <span className="text-[14px] text-meta">{suffix}</span>
    </div>
  );
}

export default function AdminShelfSettingsPage() {
  return (
    <AdminShell active="tu-sach">
      <Link
        href="/quan-tri"
        className="inline-flex min-h-11 items-center gap-1.5 text-[15px] text-meta hover:text-ink"
      >
        <ArrowLeft aria-hidden className="size-4" strokeWidth={1.75} />
        Quay lại danh sách tủ sách
      </Link>

      <h1 className="mt-3 text-[28px] leading-tight font-semibold">
        Tủ sách Đồng Tháp
      </h1>

      <form className="mt-8 max-w-2xl space-y-12">
        <section className="space-y-6">
          <h2 className="text-xl font-semibold">Thông tin chung</h2>

          <Field label="Tên tủ sách" required htmlFor="ten-tu-sach">
            <Input id="ten-tu-sach" defaultValue={shelf.name} />
          </Field>

          <Field label="Đường dẫn">
            <ReadOnlyValue note="Đường dẫn không đổi được sau khi tạo, vì nó đã nằm trong các liên kết đã chia sẻ.">
              <Lock
                aria-hidden
                className="mr-2 size-4 shrink-0 text-leather"
                strokeWidth={1.75}
              />
              olibra.vn/dong-thap
            </ReadOnlyValue>
          </Field>

          <Field label="Giới thiệu" htmlFor="gioi-thieu">
            <Textarea
              id="gioi-thieu"
              rows={4}
              placeholder="Vài dòng giới thiệu về tủ sách này"
            />
          </Field>

          <Field label="Địa chỉ" required htmlFor="dia-chi">
            <Input id="dia-chi" defaultValue={shelf.location} />
          </Field>

          <Field
            label="Giờ mở cửa"
            required
            htmlFor="gio-mo-cua"
            hint="Viết tự do, bạn đọc sẽ đọc đúng như bạn gõ."
          >
            <Input id="gio-mo-cua" defaultValue={shelf.hours} />
          </Field>

          <Field label="Người giữ chìa khoá" required htmlFor="nguoi-giu-chia">
            <Input id="nguoi-giu-chia" defaultValue={shelf.keeper} />
          </Field>

          <Field
            label="Số điện thoại người giữ chìa"
            required
            htmlFor="dien-thoai-chia"
            hint="Số này hiển thị công khai để bạn đọc gọi khi cần."
          >
            <Input id="dien-thoai-chia" defaultValue={shelf.phone} />
          </Field>
        </section>

        <section>
          <h2 className="text-xl font-semibold">Quy định cho mượn</h2>

          <div className="mt-4">
            <SettingRow
              label="Số ngày cho mượn"
              hint="Số ngày bạn đọc được giữ sách trong một lượt mượn."
            >
              <NumberField
                label="Số ngày cho mượn"
                defaultValue={14}
                suffix="ngày"
              />
            </SettingRow>

            <SettingRow
              label="Số sách mượn cùng lúc"
              hint="Số cuốn tối đa một bạn đọc được giữ cùng lúc."
            >
              <NumberField
                label="Số sách mượn cùng lúc"
                defaultValue={3}
                suffix="cuốn"
              />
            </SettingRow>

            <SettingRow
              label="Số lần gia hạn"
              hint="Số lần bạn đọc được xin gia hạn cho một lượt mượn."
            >
              <NumberField label="Số lần gia hạn" defaultValue={1} suffix="lần" />
            </SettingRow>

            <SettingRow
              label="Số ngày mỗi lần gia hạn"
              hint="Số ngày được cộng thêm mỗi lần gia hạn."
            >
              <NumberField
                label="Số ngày mỗi lần gia hạn"
                defaultValue={7}
                suffix="ngày"
              />
            </SettingRow>

            <SettingRow
              label="Số ngày giữ chỗ"
              hint="Số ngày tủ sách giữ sách cho bạn đọc đã đăng ký chờ mượn."
            >
              <NumberField label="Số ngày giữ chỗ" defaultValue={3} suffix="ngày" />
            </SettingRow>

            <SettingRow
              label="Báo sắp đến hạn trước"
              hint="Số ngày trước hạn trả mà hệ thống nhắc bạn đọc."
            >
              <NumberField
                label="Báo sắp đến hạn trước"
                defaultValue={3}
                suffix="ngày"
              />
            </SettingRow>

            <SettingRow
              label="Cho bạn đọc bình luận"
              hint="Bạn đọc có thể để lại bình luận dưới mỗi cuốn sách."
            >
              <Toggle on label="Cho bạn đọc bình luận" />
            </SettingRow>

            <SettingRow
              label="Bình luận cần duyệt"
              hint="Bình luận chỉ hiển thị công khai sau khi quản lý duyệt."
            >
              <Toggle on label="Bình luận cần duyệt" />
            </SettingRow>

            <SettingRow
              label="Hiện tên người đang mượn"
              hint="Hiện tên bạn đọc đang giữ sách trên trang công khai của cuốn sách."
            >
              <Toggle on label="Hiện tên người đang mượn" />
            </SettingRow>

            <SettingRow
              label="Hiện bảng bạn đọc chăm nhất"
              hint="Hiện danh sách bạn đọc mượn nhiều sách nhất trong tháng."
            >
              <NumberField
                label="Số bạn đọc hiển thị"
                defaultValue={10}
                suffix="người"
              />
              <Toggle on label="Hiện bảng bạn đọc chăm nhất" />
            </SettingRow>
          </div>
        </section>

        <div className="flex flex-wrap items-start justify-between gap-8 border-t border-hairline pt-8">
          <div className="flex items-center gap-3">
            <Button type="submit" variant="primary" size="lg">
              Lưu cài đặt
            </Button>
            <Button type="button" variant="ghost" size="lg">
              Huỷ
            </Button>
          </div>

          <div className="max-w-64 border-l border-hairline pl-8 text-right">
            <Button type="button" variant="danger" size="sm">
              Lưu trữ tủ sách
            </Button>
            <p className="mt-2 text-[13px] text-meta">
              Lưu trữ sẽ ẩn tủ sách khỏi cổng, nhưng giữ lại toàn bộ dữ liệu và lịch
              sử.
            </p>
          </div>
        </div>
      </form>
    </AdminShell>
  );
}
