import { notFound } from "next/navigation";
import { CheckCircle2, Send, ShieldCheck } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { ShelfHeader } from "@/components/shell/public-header";
import { shelfBySlug, shelves } from "@/lib/fixtures";

export function generateStaticParams() {
  return shelves.map((s) => ({ shelf: s.slug }));
}

export default async function FeedbackPage({
  params,
}: {
  params: Promise<{ shelf: string }>;
}) {
  const { shelf: slug } = await params;
  const shelf = shelfBySlug(slug);
  if (!shelf) notFound();

  return (
    <>
      <ShelfHeader shelf={shelf} />

      <main className="mx-auto max-w-xl px-6 py-16">
        <h1 className="text-[28px] leading-tight font-semibold">Gửi góp ý</h1>
        <p className="mt-1 text-meta">
          Có điều gì chưa ổn, hoặc có ý tưởng cho tủ sách? Ban quản trị đọc hết mọi
          góp ý.
        </p>

        {/* Single column, labels above inputs, required marked with a word. */}
        <form className="mt-8 space-y-6">
          <Field
            label="Góp ý về"
            required
            htmlFor="ve"
            hint='Chọn "Toàn hệ thống" nếu góp ý không thuộc riêng tủ sách nào.'
          >
            <Select id="ve" defaultValue={shelf.name}>
              {shelves.map((s) => (
                <option key={s.slug}>{s.name}</option>
              ))}
              <option>Toàn hệ thống</option>
            </Select>
          </Field>

          <Field label="Tên của bạn" required htmlFor="ten">
            <Input id="ten" placeholder="vd: Nguyễn Thu Trang" />
          </Field>

          <Field
            label="Số điện thoại"
            required
            htmlFor="dt"
            hint="Ban quản trị sẽ gọi lại nếu cần hỏi thêm. Hệ thống không gửi email."
          >
            <Input id="dt" inputMode="tel" placeholder="vd: 09xx xxx xxx" />
          </Field>

          <Field label="Tiêu đề" required htmlFor="tieu-de">
            <Input id="tieu-de" placeholder="vd: Sách bị thiếu trang" />
          </Field>

          <Field label="Nội dung" required htmlFor="noi-dung">
            <Textarea
              id="noi-dung"
              rows={6}
              placeholder="Bạn viết thoải mái, càng cụ thể càng dễ xử lý"
            />
            <p className="text-[14px] text-meta">0 / 2000</p>
          </Field>

          <div className="flex gap-3 rounded-card border border-hairline bg-paper p-4">
            <ShieldCheck
              aria-hidden
              className="mt-0.5 size-5 shrink-0 text-leather"
              strokeWidth={1.75}
            />
            <p className="text-[14px] text-meta">
              Mỗi số điện thoại gửi tối đa 3 góp ý mỗi ngày, để tránh tin rác.
            </p>
          </div>

          <Button type="submit" variant="primary" size="lg" className="w-full">
            <Send aria-hidden className="size-5" strokeWidth={1.75} />
            Gửi góp ý
          </Button>
        </form>

        {/* The state after submitting, shown here so the copy can be reviewed. */}
        <div className="mt-12 border-t border-hairline pt-8">
          <p className="text-[14px] text-meta">Sau khi gửi</p>
          <div className="mt-3 rounded-card border border-sage bg-sage/10 p-6">
            <CheckCircle2
              aria-hidden
              className="size-8 text-sage"
              strokeWidth={1.5}
            />
            <h2 className="mt-3 text-lg font-semibold">
              Đã nhận được góp ý của bạn
            </h2>
            <p className="mt-1.5 text-[15px]">
              Cảm ơn bạn. Ban quản trị sẽ đọc trong vài ngày tới và gọi lại nếu cần
              hỏi thêm.
            </p>
            <ButtonLink href={`/tu-sach/${shelf.slug}`} size="sm" className="mt-4">
              Về trang tủ sách
            </ButtonLink>
          </div>
        </div>
      </main>
    </>
  );
}
