import { notFound } from "next/navigation";
import { Camera, KeyRound, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeading } from "@/components/ui/card";
import { Field, Input, ReadOnlyValue } from "@/components/ui/field";
import { PhoneLink } from "@/components/ui/phone-link";
import { ShelfHeader } from "@/components/shell/public-header";
import { ReaderTabs } from "@/components/shell/reader-tabs";
import { unitOptions } from "@/domain/members/parish-taxonomy";
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
  const pendingPhone = "0912 345 999";

  const showL1 = unitOptions(shelf.parishUnits, 1).length > 0;
  const showL2 =
    shelf.parishTaxonomy.levels === 2 &&
    unitOptions(shelf.parishUnits, 2).length > 0;
  const l1UnitName =
    shelf.parishUnits.find((u) => u.id === reader.parishUnitL1Id)?.name ??
    "Chưa có";
  const l2UnitName =
    shelf.parishUnits.find((u) => u.id === reader.parishUnitL2Id)?.name ??
    "Chưa có";

  return (
    <>
      <ShelfHeader shelf={shelf} />
      <ReaderTabs shelfSlug={shelf.slug} active="ho-so" />

      <main className="mx-auto max-w-xl px-6 py-10">
        <PageHeading
          title="Hồ sơ của em"
          subtitle="Những thay đổi em gửi chỉ có hiệu lực sau khi quản lý duyệt."
        />

        <div className="mt-8 flex items-center gap-4">
          <div className="flex size-[72px] shrink-0 items-center justify-center rounded-full bg-paper text-[26px] font-semibold text-leather">
            {reader.name.charAt(0)}
          </div>
          <div>
            <Button variant="quiet" size="sm">
              <Camera aria-hidden className="size-[18px]" strokeWidth={1.75} />
              Đề nghị đổi ảnh
            </Button>
            <p className="mt-1.5 text-[13px] text-meta">
              Ảnh mới sẽ gửi cho quản lý xem và duyệt trước khi hiển thị.
            </p>
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

            <div className="rounded-card border border-hairline bg-paper p-4">
              <p className="text-[14px]">
                Đang chờ quản lý duyệt:{" "}
                <span className="font-semibold">{pendingPhone}</span>
              </p>
              <p className="mt-1 text-[13px] text-meta">
                Số hiện tại ({reader.phone}) vẫn được dùng cho đến khi đề nghị này
                được duyệt.
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-2 -ml-4"
              >
                Huỷ đề nghị
              </Button>
            </div>

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

          {showL1 || showL2 ? (
            <section className="space-y-4 border-t border-hairline pt-8">
              <h2 className="text-xl font-semibold">Giáo xứ</h2>

              {showL1 ? (
                <Field label={shelf.parishTaxonomy.level1Label}>
                  <ReadOnlyValue>
                    <Lock
                      aria-hidden
                      className="mr-2 size-4 text-meta"
                      strokeWidth={1.75}
                    />
                    {l1UnitName}
                  </ReadOnlyValue>
                </Field>
              ) : null}

              {showL2 ? (
                <Field label={shelf.parishTaxonomy.level2Label}>
                  <ReadOnlyValue>
                    <Lock
                      aria-hidden
                      className="mr-2 size-4 text-meta"
                      strokeWidth={1.75}
                    />
                    {l2UnitName}
                  </ReadOnlyValue>
                </Field>
              ) : null}

              <p className="text-[14px] text-meta">
                Muốn đổi {shelf.parishTaxonomy.level1Label.toLowerCase()}
                {showL2
                  ? ` hoặc ${shelf.parishTaxonomy.level2Label.toLowerCase()}`
                  : ""}{" "}
                thì nhờ quản lý tủ sách giúp.
              </p>
            </section>
          ) : null}

          <section className="space-y-4 border-t border-hairline pt-8">
            <h2 className="text-xl font-semibold">Riêng tư</h2>
            <p className="text-[14px] text-meta">
              Có hiệu lực ngay, không cần quản lý duyệt — đây không phải một thông
              tin quản lý cần xác minh.
            </p>

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
            <p className="text-[14px] text-meta">
              Cũng có hiệu lực ngay — mật khẩu không phải thông tin quản lý xác
              minh, chỉ là chìa khoá để em tự đăng nhập.
            </p>

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

          <div className="border-t border-hairline pt-8">
            <div className="flex items-center gap-4">
              <Button type="submit" variant="primary" size="lg">
                Gửi đề nghị thay đổi
              </Button>
              <Button type="button" variant="ghost" size="md">
                Huỷ
              </Button>
            </div>
            <p className="mt-3 text-[14px] text-meta">
              Quản lý sẽ xem và duyệt trước khi các thông tin cá nhân ở trên đổi
              thành giá trị mới.
            </p>
          </div>
        </form>
      </main>
    </>
  );
}
