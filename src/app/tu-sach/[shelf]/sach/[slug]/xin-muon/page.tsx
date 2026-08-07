import Link from "next/link";
import { notFound } from "next/navigation";
import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BookCover, BookTitle } from "@/components/ui/book";
import { Field, Input, Textarea } from "@/components/ui/field";
import { PublicHeader } from "@/components/shell/public-header";
import { bookBySlug, books, shelfBySlug, shelves } from "@/lib/fixtures";

export function generateStaticParams() {
  return shelves.flatMap((s) =>
    books.map((b) => ({ shelf: s.slug, slug: b.slug })),
  );
}

/**
 * A guest request creates a lead, not an account — a manager reviews it and
 * calls back. The copy has to make that unmistakable.
 */
export default async function GuestRequestPage({
  params,
}: {
  params: Promise<{ shelf: string; slug: string }>;
}) {
  const { shelf: shelfSlug, slug } = await params;
  const shelf = shelfBySlug(shelfSlug);
  const book = bookBySlug(slug);
  if (!shelf || !book) notFound();

  const base = `/tu-sach/${shelf.slug}`;

  return (
    <>
      <PublicHeader shelf={shelf} />

      <main className="mx-auto max-w-lg px-6 py-12">
        <div className="rounded-card border border-hairline bg-surface p-8">
          <div className="flex items-center gap-3 rounded-control bg-paper p-3">
            <BookCover title={book.title} className="w-10 text-[0.9rem]" />
            <div className="min-w-0">
              <p className="text-[14px] text-meta">Em muốn mượn</p>
              <BookTitle className="block truncate text-base leading-snug">
                {book.title}
              </BookTitle>
              <p className="truncate text-[13px] text-meta">{book.author}</p>
            </div>
          </div>

          <h1 className="mt-6 text-xl font-semibold">Xin mượn sách</h1>
          <p className="mt-1.5 text-[15px] text-meta">
            Em chưa có tài khoản cũng không sao. Điền giúp tủ sách hai thông tin,
            quản lý sẽ liên hệ lại.
          </p>

          <form className="mt-6 space-y-6">
            <Field
              label="Tên của em"
              required
              htmlFor="ten"
              hint="Ghi tên đầy đủ để quản lý dễ tìm em ở nhà xứ."
            >
              <Input id="ten" placeholder="vd: Nguyễn Văn An" />
            </Field>

            <Field
              label="Số điện thoại"
              required
              htmlFor="dt"
              hint="Số của cha mẹ cũng được. Quản lý sẽ gọi để hẹn em đến lấy sách."
            >
              <Input id="dt" inputMode="tel" placeholder="vd: 09xx xxx xxx" />
            </Field>

            <Field label="Lời nhắn" htmlFor="nhan">
              <Textarea
                id="nhan"
                rows={3}
                placeholder="Em muốn mượn khi nào, hoặc điều gì cần nhắn thêm"
              />
            </Field>

            <div className="flex gap-3 rounded-card border border-hairline bg-paper p-4">
              <Info
                aria-hidden
                className="mt-0.5 size-5 shrink-0 text-leather"
                strokeWidth={1.75}
              />
              <div>
                <p className="text-[15px]">
                  Đây chưa phải là mượn sách. Quản lý sẽ xem yêu cầu và gọi cho em,
                  thường trong vòng một tuần.
                </p>
                <p className="mt-1.5 text-[14px] text-meta">
                  Nếu em muốn mượn thường xuyên, hãy{" "}
                  <Link
                    href="/dang-ky"
                    className="font-medium text-sage hover:underline"
                  >
                    đăng ký tài khoản
                  </Link>
                  .
                </p>
              </div>
            </div>

            <Button type="submit" variant="primary" size="lg" className="w-full">
              Gửi yêu cầu mượn
            </Button>
            <div className="text-center">
              <Link
                href={`${base}/sach/${book.slug}`}
                className="inline-flex min-h-11 items-center text-[15px] text-meta hover:text-ink"
              >
                Huỷ
              </Link>
            </div>
          </form>
        </div>
      </main>
    </>
  );
}
