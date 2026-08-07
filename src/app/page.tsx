import Link from "next/link";
import { ArrowRight, BookUp, History, Users } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { FrontDoorFooter, FrontDoorHeader } from "@/components/shell/public-header";

const WHAT_IT_DOES = [
  {
    icon: BookUp,
    title: "Cho mượn trong ba bước",
    body: "Tìm sách, chọn bạn đọc, xác nhận. Tình nguyện viên đứng ngay tại kệ cũng làm được, và các em không cần đăng nhập gì cả.",
  },
  {
    icon: Users,
    title: "Quản lý bạn đọc",
    body: "Duyệt đăng ký, xem ai đang giữ sách, gọi nhắc những cuốn quá hạn.",
  },
  {
    icon: History,
    title: "Ghi lại mọi việc",
    body: "Mỗi thao tác đều vào nhật ký, đọc được như một câu tiếng Việt bình thường.",
  },
];

export default function LandingPage() {
  return (
    <>
      <FrontDoorHeader />

      <main className="mx-auto max-w-5xl px-6">
        {/* Logo, a sentence or two, and the two ways in. Nothing else — there
            is no blog and no separate about page (§16.1). */}
        <section className="py-20">
          <h1 className="max-w-3xl text-[40px] leading-[1.15] font-semibold">
            Phần mềm quản lý cho những tủ sách nhỏ trong giáo xứ.
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-meta">
            OLibra giúp các bạn tình nguyện viên cho mượn, nhận trả và giữ tủ sách
            ngăn nắp — chỉ với một chiếc điện thoại.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-4">
            <ButtonLink href="/dang-nhap" variant="primary" size="lg">
              Đăng nhập
              <ArrowRight aria-hidden className="size-5" strokeWidth={1.75} />
            </ButtonLink>
            <ButtonLink href="/tu-sach" variant="outline" size="lg">
              Tìm tủ sách để đăng ký
            </ButtonLink>
          </div>

          <p className="mt-5 text-[15px] text-meta">
            Chưa có tài khoản? Tìm tủ sách của giáo xứ mình rồi đăng ký — quản lý sẽ
            duyệt sau lễ Chúa nhật.
          </p>
        </section>

        <section className="border-t border-hairline py-16">
          <h2 className="text-[20px] font-semibold">OLibra làm được gì</h2>
          <div className="mt-8 grid gap-10 sm:grid-cols-3">
            {WHAT_IT_DOES.map(({ icon: Icon, title, body }) => (
              <div key={title}>
                <Icon
                  aria-hidden
                  className="size-6 text-leather"
                  strokeWidth={1.75}
                />
                <h3 className="mt-3 text-base font-semibold">{title}</h3>
                <p className="mt-1.5 text-[15px] text-meta">{body}</p>
              </div>
            ))}
          </div>

          <p className="mt-10 text-[15px] text-meta">
            Muốn mở một tủ sách cho giáo xứ của bạn?{" "}
            <Link href="/lien-he" className="font-medium text-sage hover:underline">
              Liên hệ với ban quản trị
            </Link>
          </p>
        </section>
      </main>

      <FrontDoorFooter />
    </>
  );
}
