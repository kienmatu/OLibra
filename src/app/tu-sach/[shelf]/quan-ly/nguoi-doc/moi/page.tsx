import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Camera, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { ManagerShell } from "@/components/shell/manager-shell";
import { ParishUnitFields } from "@/components/parish-unit-fields";
import { shelfBySlug, shelves } from "@/lib/fixtures";

export function generateStaticParams() {
  return shelves.map((s) => ({ shelf: s.slug }));
}

function GroupHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="border-b border-hairline pb-3 text-xl font-semibold">
      {children}
    </h2>
  );
}

export default async function RegisterReaderOnBehalfPage({
  params,
}: {
  params: Promise<{ shelf: string }>;
}) {
  const { shelf: slug } = await params;
  const shelf = shelfBySlug(slug);
  if (!shelf) notFound();

  const base = `/tu-sach/${shelf.slug}/quan-ly`;

  return (
    <ManagerShell shelfName={shelf.name} shelfSlug={shelf.slug} active="nguoi-doc">
      <Link
        href={`${base}/nguoi-doc`}
        className="inline-flex min-h-11 items-center gap-1.5 text-[15px] text-meta hover:text-ink"
      >
        <ArrowLeft aria-hidden className="size-4" strokeWidth={1.75} />
        Quay lại danh sách bạn đọc
      </Link>

      <h1 className="mt-3 text-[28px] leading-tight font-semibold">
        Đăng ký người đọc mới
      </h1>
      <p className="mt-1.5 max-w-xl text-meta">
        Dùng khi có một em đang đứng trước mặt bạn ở nhà xứ. Bạn điền giúp thay vì
        em tự điền — thông tin và bước duyệt sau đó vẫn như một đăng ký bình thường.
      </p>

      <form className="mt-8 max-w-xl space-y-10">
        <Field
          label="Ảnh của bạn đọc"
          hint="Chụp bằng điện thoại cũng được. Ảnh giúp bạn — và quản lý sau này — nhận ra em giữa nhiều bạn trùng tên."
        >
          <div className="flex aspect-2/3 w-36 flex-col items-center justify-center gap-2 rounded-card border border-dashed border-hairline bg-paper text-center">
            <Camera
              aria-hidden
              className="size-7 text-leather"
              strokeWidth={1.75}
            />
            <span className="px-2 text-[13px] text-meta">Chạm để chọn ảnh</span>
          </div>
        </Field>

        <div className="space-y-6">
          <GroupHeading>Bản thân</GroupHeading>

          <Field label="Tên thánh" htmlFor="ten-thanh">
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

          <Field label="Ngày sinh" required htmlFor="ngay-sinh">
            <Input id="ngay-sinh" type="date" />
          </Field>
        </div>

        <div className="space-y-6">
          <GroupHeading>Gia đình</GroupHeading>

          <Field
            label="Tên cha"
            required
            htmlFor="ten-cha"
            hint="Giúp phân biệt các em trùng tên."
          >
            <Input id="ten-cha" placeholder="vd: Nguyễn Văn Hoà" />
          </Field>

          <Field label="Tên mẹ" required htmlFor="ten-me">
            <Input id="ten-me" placeholder="vd: Trần Thị Mai" />
          </Field>

          <Field
            label="Số điện thoại"
            required
            htmlFor="dien-thoai"
            hint="Số của cha mẹ cũng được. Đây là cách tủ sách liên lạc khi cần nhắc trả sách."
          >
            <Input id="dien-thoai" inputMode="tel" placeholder="vd: 09xx xxx xxx" />
          </Field>
        </div>

        <div className="space-y-6">
          <GroupHeading>Giáo xứ</GroupHeading>

          <p className="text-[14px] text-meta">
            Không bắt buộc. Chưa biết cũng cứ tạo hồ sơ — bổ sung sau cũng được.
          </p>

          <ParishUnitFields
            idPrefix="nguoi-doc-moi"
            taxonomy={shelf.parishTaxonomy}
            units={shelf.parishUnits}
          />
        </div>

        <div className="space-y-6">
          <GroupHeading>Đăng nhập (không bắt buộc)</GroupHeading>

          <p className="text-[14px] text-meta">
            Phần lớn các em không bao giờ tự đăng nhập — quản lý làm mọi việc mượn
            và trả sách thay các em. Để trống cả hai ô này cũng được, và quản lý có
            thể thêm sau. Tên đăng nhập và mật khẩu luôn được đặt cùng lúc, không
            thể chỉ có một trong hai.
          </p>

          <Field
            label="Tên đăng nhập"
            htmlFor="ten-dang-nhap"
            hint="Chỉ cần nếu em muốn tự xem sách ở nhà."
          >
            <Input id="ten-dang-nhap" placeholder="vd: lan.nguyen" />
          </Field>

          <Field label="Mật khẩu" htmlFor="mat-khau" hint="Ít nhất 8 ký tự.">
            <Input id="mat-khau" type="password" />
          </Field>

          <Field label="Nhập lại mật khẩu" htmlFor="nhap-lai-mat-khau">
            <Input id="nhap-lai-mat-khau" type="password" />
          </Field>
        </div>

        <div className="flex gap-3 rounded-card border border-hairline bg-paper p-5">
          <Info
            aria-hidden
            className="mt-0.5 size-5 shrink-0 text-leather"
            strokeWidth={1.75}
          />
          <p className="text-[15px] text-ink/90">
            Hồ sơ này vẫn vào hàng chờ duyệt, kể cả khi bạn là người điền. Bước
            duyệt được ghi vào nhật ký.
          </p>
        </div>

        <Button type="submit" variant="primary" size="lg" className="w-full">
          Tạo hồ sơ chờ duyệt
        </Button>
      </form>
    </ManagerShell>
  );
}
