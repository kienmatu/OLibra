import Link from "next/link";
import { ArrowLeft, Lock, Plus } from "lucide-react";
import { AdminShell } from "@/components/shell/manager-shell";
import { Button } from "@/components/ui/button";
import {
  Field,
  Input,
  ReadOnlyValue,
  Select,
  Textarea,
  Toggle,
} from "@/components/ui/field";
import { unitOptions, type ParishUnit } from "@/domain/members/parish-taxonomy";
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

/** One unit in a management list — its name plus rename/remove actions. */
function UnitRow({ unit }: { unit: ParishUnit }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-hairline bg-surface px-3.5 py-2.5">
      <span className="text-[15px]">{unit.name}</span>
      <div className="flex shrink-0 items-center gap-2">
        <Button type="button" variant="quiet" size="sm">
          Đổi tên
        </Button>
        <Button type="button" variant="danger" size="sm">
          Xoá
        </Button>
      </div>
    </li>
  );
}

/** The "add one more" row at the foot of every unit list. */
function AddUnitRow({ placeholder }: { placeholder: string }) {
  return (
    <li className="flex flex-wrap items-center gap-2 pt-1">
      <Input placeholder={placeholder} className="h-11 max-w-64" />
      <Button type="button" variant="outline" size="sm">
        <Plus aria-hidden className="size-4" strokeWidth={1.75} />
        Thêm
      </Button>
    </li>
  );
}

export default function AdminShelfSettingsPage() {
  const { parishTaxonomy, parishUnits } = shelf;
  const level1Units = unitOptions(parishUnits, 1);
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

        <section className="space-y-6">
          <h2 className="text-xl font-semibold">Phân chia giáo xứ</h2>
          <p className="text-[14px] text-meta">
            Tủ sách nào cũng khác nhau ở chỗ này — có xứ chỉ chia tổ, có xứ chỉ có
            giáo họ, có xứ chia cả hai. Chọn đúng cách giáo xứ mình vẫn gọi, đừng
            theo tủ sách khác. Cả hai trường đều không bắt buộc khi đăng ký, kể cả
            sau khi đã cài đặt xong ở đây — một bạn đọc chưa rõ tổ vẫn phải đăng ký
            được.
          </p>

          <Field
            label="Số bậc"
            htmlFor="so-bac"
            hint="Một bậc nếu giáo xứ chỉ chia theo một cách (chỉ tổ, hoặc chỉ giáo họ). Hai bậc nếu chia lồng nhau."
          >
            <Select id="so-bac" defaultValue={String(parishTaxonomy.levels)}>
              <option value="1">1 bậc</option>
              <option value="2">2 bậc</option>
            </Select>
          </Field>

          <Field
            label="Tên bậc 1"
            htmlFor="ten-bac-1"
            hint="Từ giáo xứ mình vẫn dùng — thường là Giáo họ hoặc Tổ."
          >
            <Input id="ten-bac-1" defaultValue={parishTaxonomy.level1Label} />
          </Field>

          {parishTaxonomy.levels === 2 ? (
            <>
              <Field
                label="Tên bậc 2"
                htmlFor="ten-bac-2"
                hint="Đơn vị nhỏ hơn, nằm trong bậc 1 — thường là Tổ."
              >
                <Input id="ten-bac-2" defaultValue={parishTaxonomy.level2Label} />
              </Field>

              <SettingRow
                label={`Đánh số ${parishTaxonomy.level2Label.toLowerCase()} theo từng ${parishTaxonomy.level1Label.toLowerCase()}`}
                hint={`Bật nếu ${parishTaxonomy.level2Label} 1 của ${parishTaxonomy.level1Label.toLowerCase()} này khác ${parishTaxonomy.level2Label} 1 của ${parishTaxonomy.level1Label.toLowerCase()} kia. Tắt nếu ${parishTaxonomy.level2Label.toLowerCase()} đánh số chung cho cả giáo xứ.`}
              >
                <Toggle
                  on={parishTaxonomy.nested}
                  label={`Đánh số ${parishTaxonomy.level2Label.toLowerCase()} theo từng ${parishTaxonomy.level1Label.toLowerCase()}`}
                />
              </SettingRow>
            </>
          ) : null}

          <div className="space-y-3 border-t border-hairline pt-6">
            <p className="text-[16px] font-medium">
              Danh sách {parishTaxonomy.level1Label.toLowerCase()}
            </p>
            <ul className="space-y-2">
              {level1Units.map((unit) => (
                <UnitRow key={unit.id} unit={unit} />
              ))}
              <AddUnitRow placeholder={`${parishTaxonomy.level1Label} mới`} />
            </ul>
          </div>

          {parishTaxonomy.levels === 2 ? (
            <div className="space-y-3 border-t border-hairline pt-6">
              <p className="text-[16px] font-medium">
                Danh sách {parishTaxonomy.level2Label.toLowerCase()}
              </p>

              {parishTaxonomy.nested ? (
                // Nested: each level-2 list lives under its own parent, so
                // renaming or adding one never risks picking the wrong
                // giáo họ by accident.
                <div className="space-y-5">
                  {level1Units.map((parent) => (
                    <div key={parent.id}>
                      <p className="text-[14px] text-meta">
                        Trong {parent.name.toLowerCase()}
                      </p>
                      <ul className="mt-2 space-y-2">
                        {unitOptions(parishUnits, 2, parent.id).map((unit) => (
                          <UnitRow key={unit.id} unit={unit} />
                        ))}
                        <AddUnitRow
                          placeholder={`${parishTaxonomy.level2Label} mới trong ${parent.name}`}
                        />
                      </ul>
                    </div>
                  ))}
                </div>
              ) : (
                <ul className="space-y-2">
                  {unitOptions(parishUnits, 2).map((unit) => (
                    <UnitRow key={unit.id} unit={unit} />
                  ))}
                  <AddUnitRow placeholder={`${parishTaxonomy.level2Label} mới`} />
                </ul>
              )}
            </div>
          ) : null}
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
