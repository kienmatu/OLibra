import Link from "next/link";
import { ArrowRight, BookUp, History, Users } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MarketingFooter, MarketingHeader } from "@/components/shell/public-header";
import { posts } from "@/lib/fixtures";

const FEATURES = [
  {
    icon: BookUp,
    title: "Cho mượn trong ba bước",
    body: "Tìm sách, chọn bạn đọc, xác nhận. Tình nguyện viên đứng ngay tại kệ cũng làm được.",
  },
  {
    icon: Users,
    title: "Quản lý bạn đọc",
    body: "Duyệt đăng ký, xem ai đang giữ sách, nhắc những cuốn quá hạn.",
  },
  {
    icon: History,
    title: "Ghi lại mọi việc",
    body: "Mỗi thao tác đều được ghi vào nhật ký, đọc được như một câu tiếng Việt bình thường.",
  },
];

export default function LandingPage() {
  return (
    <>
      <MarketingHeader />

      <main className="mx-auto max-w-5xl px-6">
        {/* Hero — calm and typographic. No image, no laptop, no marketing voice. */}
        <section className="py-16">
          <h1 className="max-w-3xl text-[34px] leading-[1.2] font-semibold">
            Phần mềm quản lý cho những tủ sách nhỏ trong giáo xứ.
          </h1>
          <p className="mt-4 max-w-2xl text-base text-meta">
            OLibra giúp các bạn tình nguyện viên cho mượn, nhận trả và giữ tủ sách
            ngăn nắp — chỉ với một chiếc điện thoại.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-6">
            <ButtonLink href="/tu-sach" variant="primary" size="lg">
              Xem các tủ sách
              <ArrowRight aria-hidden className="size-5" strokeWidth={1.75} />
            </ButtonLink>
            <Link
              href="/gioi-thieu"
              className="text-[15px] font-medium text-sage hover:underline"
            >
              OLibra hoạt động thế nào?
            </Link>
          </div>
        </section>

        <dl className="flex flex-wrap divide-x divide-hairline border-y border-hairline">
          {[
            { label: "Tủ sách", value: "4" },
            { label: "Đầu sách", value: "812" },
            { label: "Bạn đọc", value: "260" },
          ].map((item) => (
            <div key={item.label} className="flex-1 py-6 pr-6 pl-6 first:pl-0">
              <dt className="text-[14px] text-meta">{item.label}</dt>
              <dd className="mt-1 text-[24px] leading-none font-semibold">
                {item.value}
              </dd>
            </div>
          ))}
        </dl>

        <section className="py-16">
          <h2 className="text-[20px] font-semibold">OLibra làm được gì</h2>
          <div className="mt-8 grid gap-10 sm:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, body }) => (
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
        </section>

        <section className="pb-8">
          <h2 className="text-[20px] font-semibold">Bài viết gần đây</h2>
          <div className="mt-6 grid gap-6 sm:grid-cols-3">
            {posts.slice(0, 3).map((post) => (
              <Card key={post.slug} className="flex flex-col">
                <p className="text-[14px] text-meta">{post.date}</p>
                <h3 className="mt-2 text-base leading-snug font-semibold">
                  {post.title}
                </h3>
                <p className="mt-2 line-clamp-2 flex-1 text-[15px] text-meta">
                  {post.excerpt}
                </p>
                <Link
                  href={`/bai-viet/${post.slug}`}
                  className="mt-4 inline-flex min-h-11 items-center text-[15px] font-medium text-sage hover:underline"
                >
                  Đọc tiếp
                </Link>
              </Card>
            ))}
          </div>
        </section>
      </main>

      <MarketingFooter />
    </>
  );
}
