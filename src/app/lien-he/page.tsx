import { FrontDoorFooter, FrontDoorHeader } from "@/components/shell/public-header";
import { Button } from "@/components/ui/button";
import { Card, PageHeading } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/field";
import { PhoneLink } from "@/components/ui/phone-link";

export const metadata = { title: "Liên hệ — OLibra" };

export default function ContactPage() {
  return (
    <>
      <FrontDoorHeader />

      <main className="mx-auto max-w-2xl px-6 py-12 md:py-16">
        <PageHeading
          title="Liên hệ"
          subtitle="Có câu hỏi, hoặc muốn mở một tủ sách cho giáo xứ của bạn?"
        />

        <Card className="mt-8">
          <dl>
            <div className="flex flex-wrap items-center justify-between gap-4 py-3.5 first:pt-0">
              <dt className="text-[15px] text-meta">Ban quản trị</dt>
              <dd className="text-[16px] font-medium">Giuse Trần Quốc Anh</dd>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-4 border-t border-hairline py-3.5">
              <dt className="text-[15px] text-meta">Điện thoại</dt>
              <dd>
                <PhoneLink phone="0901 111 222" />
              </dd>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-4 border-t border-hairline py-3.5 last:pb-0">
              <dt className="text-[15px] text-meta">Giờ liên hệ</dt>
              <dd className="text-[16px] font-medium">
                Trong tuần, 8:00 đến 17:00
              </dd>
            </div>
          </dl>
        </Card>

        <p className="mt-4 text-[14px] text-meta">
          OLibra không gửi email. Cách nhanh nhất để liên hệ là gọi điện, hoặc gửi
          nội dung qua biểu mẫu bên dưới.
        </p>

        <form className="mt-10 space-y-6">
          <Field
            label="Tên của bạn"
            required
            htmlFor="ten"
            hint="Để chúng tôi biết nên xưng hô thế nào khi gọi lại."
          >
            <Input id="ten" placeholder="Ví dụ: Anna Nguyễn Thị Mai" />
          </Field>

          <Field
            label="Số điện thoại"
            required
            htmlFor="dien-thoai"
            hint="Dùng để gọi lại, không dùng vào việc gì khác."
          >
            <Input id="dien-thoai" type="tel" placeholder="0901 234 567" />
          </Field>

          <Field
            label="Nội dung"
            required
            htmlFor="noi-dung"
            hint="Kể ngắn gọn điều bạn cần, ví dụ muốn mở tủ sách ở giáo xứ nào."
          >
            <Textarea id="noi-dung" rows={5} placeholder="Xin chào, tôi muốn..." />
          </Field>

          <Button type="submit" variant="primary" size="lg" className="w-full">
            Gửi liên hệ
          </Button>
        </form>
      </main>

      <FrontDoorFooter />
    </>
  );
}
