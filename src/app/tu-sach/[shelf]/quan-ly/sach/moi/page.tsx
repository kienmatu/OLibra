import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ImagePlus } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { ManagerShell } from "@/components/shell/manager-shell";
import { readers, shelfBySlug, shelves } from "@/lib/fixtures";

export function generateStaticParams() {
  return shelves.map((s) => ({ shelf: s.slug }));
}

export default async function NewBookPage({
  params,
  searchParams,
}: {
  params: Promise<{ shelf: string }>;
  searchParams: Promise<{ nguoi_tang?: string }>;
}) {
  const { shelf: slug } = await params;
  const { nguoi_tang: nguoiTang } = await searchParams;
  const shelf = shelfBySlug(slug);
  if (!shelf) notFound();

  const base = `/tu-sach/${shelf.slug}/quan-ly`;
  const previewCodes = ["DT-0215", "DT-0216", "DT-0217"];
  // A donation approved from the queue arrives here with the donor already
  // known (§16.3) — the field below is just as editable as if a manager had
  // typed it themselves.
  const today = new Date().toISOString().slice(0, 10);

  return (
    <ManagerShell shelfName={shelf.name} shelfSlug={shelf.slug} active="sach">
      <Link
        href={`${base}/sach`}
        className="inline-flex min-h-11 items-center gap-1.5 text-[15px] text-meta hover:text-ink"
      >
        <ArrowLeft aria-hidden className="size-4" strokeWidth={1.75} />
        Quay lại danh sách sách
      </Link>

      <h1 className="mt-3 text-[28px] leading-tight font-semibold">
        Thêm sách mới
      </h1>

      <form className="mt-8 max-w-2xl space-y-10">
        {/* Cover uploader comes first, before any text field. */}
        <div className="flex flex-wrap items-start gap-6">
          <div
            className={
              "flex aspect-2/3 w-[180px] shrink-0 flex-col items-center " +
              "justify-center gap-2 rounded-card border border-dashed border-hairline " +
              "bg-paper p-4 text-center"
            }
          >
            <ImagePlus
              aria-hidden
              className="size-7 text-leather"
              strokeWidth={1.5}
            />
            <span className="text-[15px] font-medium">Tải ảnh bìa</span>
            <span className="text-[13px] text-meta">
              Chụp bìa sách bằng điện thoại cũng được
            </span>
          </div>
          <p className="max-w-64 pt-2 text-[14px] text-meta">
            Nếu chưa có ảnh bìa, hệ thống sẽ tự tạo một bìa màu kraft thay thế cho
            cuốn sách này, giống các bìa khác trong tủ sách.
          </p>
        </div>

        <div className="space-y-6">
          <Field label="Tên sách" required htmlFor="ten-sach">
            <Input id="ten-sach" placeholder="vd: Dế Mèn Phiêu Lưu Ký" />
          </Field>

          <Field label="Tác giả" required htmlFor="tac-gia">
            <Input id="tac-gia" placeholder="vd: Tô Hoài" />
          </Field>

          <Field label="Thể loại" required htmlFor="the-loai">
            <Select id="the-loai" defaultValue="">
              <option value="" disabled>
                Chọn thể loại
              </option>
              <option>Văn học thiếu nhi</option>
              <option>Văn học nước ngoài</option>
              <option>Văn học Việt Nam</option>
              <option>Thơ thiếu nhi</option>
            </Select>
          </Field>

          <Field label="Nhà xuất bản" htmlFor="nxb">
            <Input id="nxb" placeholder="vd: Kim Đồng" />
          </Field>

          <Field label="Năm xuất bản" htmlFor="nam-xb">
            <Input id="nam-xb" inputMode="numeric" placeholder="vd: 2019" />
          </Field>

          <Field label="Số trang" htmlFor="so-trang">
            <Input id="so-trang" inputMode="numeric" placeholder="vd: 176" />
          </Field>

          <Field
            label="Mã ISBN"
            htmlFor="isbn"
            hint="Không bắt buộc. Sách cũ hoặc sách tặng thường không có mã."
          >
            <Input id="isbn" placeholder="vd: 978-604-2-12345-6" />
          </Field>

          <Field label="Mô tả" htmlFor="mo-ta">
            <Textarea
              id="mo-ta"
              rows={4}
              placeholder="Vài dòng giới thiệu nội dung cuốn sách"
            />
          </Field>

          <Field label="Ngôn ngữ" htmlFor="ngon-ngu">
            <Select id="ngon-ngu" defaultValue="vi">
              <option value="vi">Tiếng Việt</option>
            </Select>
          </Field>
        </div>

        {/* Group: số bản sách — the system generates copy codes automatically. */}
        <div className="space-y-3 rounded-card border border-hairline bg-surface p-5">
          <Field
            label="Số bản sách"
            htmlFor="so-ban"
            hint="Hệ thống sẽ tự sinh mã cho từng bản, ví dụ DT-0215, DT-0216, DT-0217"
          >
            <Input
              id="so-ban"
              type="number"
              min={1}
              defaultValue={3}
              className="max-w-32"
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            {previewCodes.map((code) => (
              <span
                key={code}
                className="rounded-control bg-terracotta/10 px-2.5 py-1 text-[13px] font-medium text-terracotta-ink"
              >
                {code}
              </span>
            ))}
          </div>
        </div>

        {/* Provenance on the physical object (§3 of the refinements design):
            optional, because plenty of books are bought, not given. When it
            is filled in, it is written onto every copy this form creates. */}
        <div className="space-y-5 rounded-card border border-hairline bg-surface p-5">
          <div>
            <p className="text-[16px] font-semibold">Người tặng</p>
            <p className="mt-1 text-[14px] text-meta">
              Không bắt buộc — nhiều sách là mua, không phải tặng. Nếu có người
              tặng, thông tin này được lưu vào từng bản sách vừa thêm.
            </p>
          </div>

          <Field
            label="Người tặng"
            htmlFor="nguoi-tang"
            hint="Gõ tên để tìm bạn đọc đã có tài khoản trong tủ sách, hoặc gõ tên khác nếu người tặng chưa có tài khoản."
          >
            <Input
              id="nguoi-tang"
              list="danh-sach-nguoi-tang"
              defaultValue={nguoiTang}
              placeholder="vd: Nguyễn Thị Lan, hoặc bác Hoà"
            />
            <datalist id="danh-sach-nguoi-tang">
              {readers.map((r) => (
                <option key={r.id} value={r.fullName} />
              ))}
            </datalist>
          </Field>

          <Field
            label="Ngày nhận"
            htmlFor="ngay-nhan"
            hint="Mặc định là hôm nay. Có thể đổi vì sách tặng thường được vào sổ trễ vài tuần sau khi nhận."
          >
            <Input
              id="ngay-nhan"
              type="date"
              defaultValue={today}
              className="max-w-52"
            />
          </Field>
        </div>

        <label className="flex min-h-11 items-start gap-3 rounded-card border border-hairline bg-surface p-4">
          <input
            type="checkbox"
            defaultChecked
            className="mt-1 size-5 shrink-0 accent-terracotta"
          />
          <span>
            <span className="block text-[16px] font-medium">
              Hiện sách này cho bạn đọc
            </span>
            <span className="mt-0.5 block text-[14px] text-meta">
              Bỏ chọn nếu bạn muốn ẩn sách này khỏi danh mục công khai trong khi
              đang chuẩn bị.
            </span>
          </span>
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" size="lg">
            Lưu sách
          </Button>
          <ButtonLink href={`${base}/sach`} variant="ghost" size="lg">
            Huỷ
          </ButtonLink>
        </div>
      </form>
    </ManagerShell>
  );
}
