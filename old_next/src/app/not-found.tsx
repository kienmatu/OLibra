import Link from "next/link";
import { BookOpen, HelpCircle } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-24 text-center">
      <div className="relative mb-6">
        <BookOpen aria-hidden className="size-12 text-leather" strokeWidth={1.5} />
        <span
          aria-hidden
          className="absolute -right-2 -bottom-1.5 flex size-6 items-center justify-center rounded-full bg-page"
        >
          <HelpCircle
            aria-hidden
            className="size-6 text-leather"
            strokeWidth={1.5}
          />
        </span>
      </div>

      <h1 className="text-[28px] leading-tight font-semibold">
        Không tìm thấy trang này
      </h1>
      <p className="mt-3 max-w-sm text-[16px] text-meta">
        Có thể đường dẫn đã cũ, hoặc cuốn sách này đã được gỡ khỏi kệ. Không sao cả.
      </p>

      <ButtonLink href="/tu-sach" variant="primary" size="lg" className="mt-8">
        Về trang tủ sách
      </ButtonLink>

      <div className="mt-5 flex items-center gap-6">
        <Link
          href="/tu-sach/dong-thap/danh-muc"
          className="inline-flex min-h-11 items-center text-[15px] font-medium text-sage hover:underline"
        >
          Xem danh mục sách
        </Link>
        <Link
          href="/tu-sach/dong-thap/tim-kiem"
          className="inline-flex min-h-11 items-center text-[15px] font-medium text-sage hover:underline"
        >
          Tìm kiếm
        </Link>
      </div>
    </main>
  );
}
