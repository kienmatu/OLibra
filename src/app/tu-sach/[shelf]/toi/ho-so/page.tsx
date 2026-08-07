import { notFound } from "next/navigation";
import { Camera, KeyRound, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeading } from "@/components/ui/card";
import { Field, Input, ReadOnlyValue } from "@/components/ui/field";
import { PhoneLink } from "@/components/ui/phone-link";
import { PublicHeader } from "@/components/shell/public-header";
import { ReaderTabs } from "@/components/shell/reader-tabs";
import { readers, shelfBySlug, shelves } from "@/lib/fixtures";

export function generateStaticParams() {
  return shelves.map((s) => ({ shelf: s.slug }));
}

export default async function ReaderProfilePage({
  params,
}: {
  params: Promise<{ shelf: string }>;
}) {
  const { shelf: slug } = await params;
  const shelf = shelfBySlug(slug);
  if (!shelf) notFound();

  const reader = readers.find((r) => r.id === "minh")!;

  return (
    <>
      <PublicHeader shelf={shelf} />
      <ReaderTabs shelfSlug={shelf.slug} active="ho-so" />

      <main className="mx-auto max-w-xl px-6 py-10">
        <PageHeading title="Hồ sơ của em" />

        <div className="mt-8 flex items-center gap-4">
          <div className="flex size-[72px] shrink-0 items-center justify-center rounded-full bg-paper text-[26px] font-semibold text-leather">
            {reader.name.charAt(0)}
          </div>
          <div>
            <Button variant="quiet" size="sm">
              <Camera aria-hidden className="size-[18px]" strokeWidth={1.75} />
              Đổi ảnh đại diện
            </Button>
            <p className="mt-1.5 text-[13px] text-meta">Ảnh vuông, dưới 2 MB.</p>
          </div>
        </div>

        <form className="mt-10 space-y-10">
          <section className="space-y-6">
            <h2 className="text-xl font-semibold">Thông tin cá nhân</h2>

            <Field label="Tên thánh" htmlFor="ten-thanh">
              <Input id="ten-thanh" defaultValue={reader.saintName} />
            </Field>

            <Field label="Họ và tên" required htmlFor="ho-ten">
              <Input id="ho-ten" defaultValue={reader.name} />
            </Field>

            <Field label="Ngày sinh" required htmlFor="ngay-sinh">
              <Input id="ngay-sinh" defaultValue={reader.born} />
            </Field>

            <Field
              label="Số điện thoại"
              required
              htmlFor="dien-thoai"
              hint="Quản lý dùng số này khi cần nhắc trả sách."
            >
              <Input id="dien-thoai" inputMode="tel" defaultValue={reader.phone} />
            </Field>

            <Field
              label="Email"
              htmlFor="email"
              hint="Không bắt buộc. Hiện tủ sách chưa gửi email."
            >
              <Input
                id="email"
                type="email"
                placeholder="vd: minh.tran@gmail.com"
              />
            </Field>
          </section>

          <section className="space-y-4 border-t border-hairline pt-8">
            <h2 className="text-xl font-semibold">Giáo xứ</h2>

            <Field label="Tổ">
              <ReadOnlyValue>
                <Lock
                  aria-hidden
                  className="mr-2 size-4 text-meta"
                  strokeWidth={1.75}
                />
                {reader.group}
              </ReadOnlyValue>
            </Field>

            <Field label="Giáo họ">
              <ReadOnlyValue>
                <Lock
                  aria-hidden
                  className="mr-2 size-4 text-meta"
                  strokeWidth={1.75}
                />
                {reader.parish}
              </ReadOnlyValue>
            </Field>

            <p className="text-[14px] text-meta">
              Muốn đổi tổ hoặc giáo họ thì nhờ quản lý tủ sách giúp.
            </p>
          </section>

          <section className="space-y-4 border-t border-hairline pt-8">
            <h2 className="text-xl font-semibold">Riêng tư</h2>

            <div className="flex items-center justify-between gap-4 rounded-card border border-hairline bg-surface p-4">
              <div className="min-w-0">
                <p className="text-[16px] font-medium">
                  Hiện tên em trong bảng bạn đọc chăm nhất
                </p>
                <p className="mt-1 text-[14px] text-meta">
                  Nếu tắt, tên em sẽ không xuất hiện công khai.
                </p>
              </div>
              <span
                role="switch"
                aria-checked="true"
                className="relative inline-flex h-7 w-12 shrink-0 items-center rounded-full bg-sage"
              >
                <span className="ml-6 block size-5 rounded-full bg-surface" />
              </span>
            </div>
          </section>

          <section className="space-y-4 border-t border-hairline pt-8">
            <h2 className="text-xl font-semibold">Mật khẩu</h2>

            <Button type="button" variant="quiet" size="md">
              <KeyRound aria-hidden className="size-5" strokeWidth={1.75} />
              Đổi mật khẩu
            </Button>

            <p className="text-[14px] text-meta">
              Nếu quên mật khẩu, nhắn cho quản lý — cô Maria Nguyễn Thị Lan{" "}
              <PhoneLink
                phone="0912 345 678"
                size="sm"
                className="align-baseline"
              />
            </p>
          </section>

          <div className="flex items-center gap-4 border-t border-hairline pt-8">
            <Button type="submit" variant="primary" size="lg">
              Lưu thay đổi
            </Button>
            <Button type="button" variant="ghost" size="md">
              Huỷ
            </Button>
          </div>
        </form>
      </main>
    </>
  );
}
