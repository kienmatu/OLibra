import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MarketingFooter, MarketingHeader } from "@/components/shell/public-header";
import { posts } from "@/lib/fixtures";

export const metadata = { title: "Bài viết — OLibra" };

export default function BlogIndexPage() {
  const [featured, ...rest] = posts;

  return (
    <>
      <MarketingHeader active="bai-viet" />

      <main className="mx-auto max-w-5xl px-6 py-12">
        <h1 className="text-[28px] leading-tight font-semibold">Bài viết</h1>
        <p className="mt-1 text-meta">
          Kinh nghiệm mở và giữ một tủ sách nhỏ trong giáo xứ.
        </p>

        {/* Featured post — a kraft-paper band, no photograph. */}
        <div className="mt-8">
          <div
            aria-hidden
            className="h-[200px] w-full rounded-card border border-hairline bg-paper"
          />
          <p className="mt-5 text-[14px] text-meta">{featured.date}</p>
          <h2 className="mt-1.5 max-w-2xl text-[28px] leading-tight font-semibold">
            {featured.title}
          </h2>
          <p className="mt-2 line-clamp-2 max-w-2xl text-[16px] text-meta">
            {featured.excerpt}
          </p>
          <Link
            href={`/bai-viet/${featured.slug}`}
            className="mt-3 inline-flex min-h-11 items-center text-[15px] font-medium text-sage hover:underline"
          >
            Đọc tiếp
          </Link>
        </div>

        <hr className="mt-12 border-hairline" />

        <div className="mt-10 grid gap-8 sm:grid-cols-2">
          {rest.map((post) => (
            <Card key={post.slug} className="flex flex-col">
              <div
                aria-hidden
                className="h-24 w-full rounded-control border border-hairline bg-paper"
              />
              <p className="mt-4 text-[14px] text-meta">{post.date}</p>
              <h3 className="mt-1.5 text-[18px] leading-snug font-semibold">
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

        <nav className="mt-10 flex items-center justify-between gap-4">
          <p className="text-[15px] text-meta">Trang 1 / 3</p>
          <div className="flex gap-2">
            <Button size="sm" disabled>
              Trước
            </Button>
            <Button size="sm">Sau</Button>
          </div>
        </nav>
      </main>

      <MarketingFooter />
    </>
  );
}
