import Link from "next/link";
import { Camera, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, ReadOnlyValue, Select } from "@/components/ui/field";
import { ShelfHeader } from "@/components/shell/public-header";
import { shelf } from "@/lib/fixtures";

function GroupHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="border-b border-hairline pb-3 text-xl font-semibold">
      {children}
    </h2>
  );
}

export default function RegisterPage() {
  return (
    <>
      <ShelfHeader shelf={shelf} />

      <main className="mx-auto max-w-xl px-6 py-16">
        <h1 className="text-[28px] leading-tight font-semibold">
          Đăng ký làm bạn đọc
        </h1>
        <p className="mt-1.5 text-meta">
          Điền giúp mình vài thông tin. Quản lý tủ sách sẽ gặp và duyệt tài khoản
          sau lễ Chúa nhật.
        </p>

        <form className="mt-10 space-y-10">
          <section className="space-y-3">
            <Field label="Đăng ký cho tủ sách">
              <ReadOnlyValue>{shelf.name}</ReadOnlyValue>
            </Field>
            <Link
              href="/tu-sach"
              className="inline-flex min-h-11 items-center text-[14px] text-sage hover:underline"
            >
              Chọn tủ sách khác
            </Link>
          </section>

          <section className="space-y-6">
            <GroupHeading>Đăng nhập</GroupHeading>

            <p className="text-[14px] text-meta">
              Để trống cũng được — em chỉ cần tên đăng nhập nếu muốn tự xem sách ở
              nhà. Quản lý có thể tạo sau.
            </p>

            <Field
              label="Tên đăng nhập"
              htmlFor="ten-dang-nhap"
              hint="Dùng để đăng nhập, nên chọn tên dễ nhớ."
            >
              <Input id="ten-dang-nhap" placeholder="vd: lan.nguyen" />
            </Field>

            <Field
              label="Mật khẩu"
              htmlFor="mat-khau"
              hint="Ít nhất 8 ký tự. Nếu quên, quản lý sẽ đặt lại giúp."
            >
              <Input id="mat-khau" type="password" />
            </Field>

            <Field label="Nhập lại mật khẩu" htmlFor="nhap-lai-mat-khau">
              <Input id="nhap-lai-mat-khau" type="password" />
            </Field>
          </section>

          <section className="space-y-6">
            <GroupHeading>Bản thân</GroupHeading>

            <Field
              label="Ảnh của em"
              hint="Chụp bằng điện thoại cũng được. Quản lý dùng ảnh này để nhận ra em ở nhà xứ."
            >
              <div className="flex aspect-[2/3] w-36 flex-col items-center justify-center gap-2 rounded-card border border-dashed border-hairline bg-paper text-center">
                <Camera
                  aria-hidden
                  className="size-7 text-leather"
                  strokeWidth={1.75}
                />
                <span className="px-2 text-[13px] text-meta">Chạm để chọn ảnh</span>
              </div>
            </Field>

            <Field
              label="Tên thánh"
              htmlFor="ten-thanh"
              hint="Ghi nếu có, để quản lý dễ nhận ra em."
            >
              <Input id="ten-thanh" placeholder="vd: Maria" />
            </Field>

            <Field
              label="Họ và tên"
              required
              htmlFor="ho-ten"
              hint="Ghi đầy đủ như trong sổ giáo xứ."
            >
              <Input id="ho-ten" placeholder="vd: Nguyễn Thị Lan" />
            </Field>

            <Field
              label="Ngày sinh"
              required
              htmlFor="ngay-sinh"
              hint="Để tủ sách gợi ý sách hợp tuổi."
            >
              <Input id="ngay-sinh" type="date" />
            </Field>
          </section>

          <section className="space-y-6">
            <GroupHeading>Gia đình</GroupHeading>

            <Field
              label="Tên cha"
              required
              htmlFor="ten-cha"
              hint="Giúp quản lý phân biệt các em trùng tên."
            >
              <Input id="ten-cha" placeholder="vd: Nguyễn Văn Hoà" />
            </Field>

            <Field
              label="Tên mẹ"
              required
              htmlFor="ten-me"
              hint="Giúp quản lý phân biệt các em trùng tên."
            >
              <Input id="ten-me" placeholder="vd: Trần Thị Mai" />
            </Field>

            <Field
              label="Số điện thoại liên hệ"
              required
              htmlFor="dien-thoai"
              hint="Số của cha mẹ cũng được. Dùng khi cần nhắc trả sách."
            >
              <Input
                id="dien-thoai"
                inputMode="tel"
                placeholder="vd: 09xx xxx xxx"
              />
            </Field>
          </section>

          <section className="space-y-6">
            <GroupHeading>Giáo xứ</GroupHeading>

            <Field label="Tổ" required htmlFor="to">
              <Select id="to" defaultValue="">
                <option value="" disabled>
                  Chọn tổ
                </option>
                <option>Tổ 1</option>
                <option>Tổ 2</option>
                <option>Tổ 3</option>
                <option>Tổ 4</option>
              </Select>
            </Field>

            <Field label="Giáo họ" required htmlFor="giao-ho">
              <Select id="giao-ho" defaultValue="">
                <option value="" disabled>
                  Chọn giáo họ
                </option>
                <option>Giáo họ Thánh Tâm</option>
                <option>Giáo họ Mân Côi</option>
              </Select>
            </Field>
          </section>

          <div className="flex gap-3 rounded-card border border-hairline bg-paper p-5">
            <Info
              aria-hidden
              className="mt-0.5 size-5 shrink-0 text-leather"
              strokeWidth={1.75}
            />
            <div>
              <p className="text-[16px] font-semibold">Sau khi gửi thì sao?</p>
              <p className="mt-1.5 text-[15px] text-meta">
                Tài khoản chưa dùng được ngay. Quản lý sẽ gặp em ở nhà xứ để xác
                nhận, thường trong vòng một tuần. Khi được duyệt, em có thể mượn tối
                đa 3 cuốn cùng lúc.
              </p>
            </div>
          </div>

          <Button type="submit" variant="primary" size="lg" className="w-full">
            Gửi đăng ký
          </Button>

          <p className="text-center text-[15px]">
            <Link
              href="/dang-nhap"
              className="font-medium text-sage hover:underline"
            >
              Đã có tài khoản? Đăng nhập
            </Link>
          </p>
        </form>
      </main>
    </>
  );
}
