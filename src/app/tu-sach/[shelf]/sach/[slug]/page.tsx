import Link from "next/link";
import { notFound } from "next/navigation";
import { Bookmark, Hand, Users } from "lucide-react";
import { ButtonLink, Button } from "@/components/ui/button";
import { BookCover, BookTitle } from "@/components/ui/book";
import { StatusPanel } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/field";
import { PublicHeader } from "@/components/shell/public-header";
import { bookBySlug, books, shelfBySlug, shelves } from "@/lib/fixtures";

export function generateStaticParams() {
  return shelves.flatMap((s) =>
    books.map((b) => ({ shelf: s.slug, slug: b.slug })),
  );
}

export default async function BookDetailPage({
  params,
}: {
  params: Promise<{ shelf: string; slug: string }>;
}) {
  const { shelf: shelfSlug, slug } = await params;
  const shelf = shelfBySlug(shelfSlug);
  const book = bookBySlug(slug);
  if (!shelf || !book) notFound();

  const base = `/tu-sach/${shelf.slug}`;
  const isAvailable = book.status === "available";

  const meta: [string, string][] = [
    ["Tác giả", book.author],
    ...(book.translator
      ? ([["Người dịch", book.translator]] as [string, string][])
      : []),
    ["Nhà xuất bản", book.publisher],
    ["Năm xuất bản", String(book.year)],
    ["Số trang", String(book.pages)],
    ["Thể loại", book.category],
  ];

  return (
    <>
      <PublicHeader shelf={shelf} />

      <main className="mx-auto max-w-5xl px-6 py-10">
        <div className="grid gap-10 md:grid-cols-[300px_1fr]">
          <BookCover title={book.title} className="w-full text-[3rem]" />

          <div>
            <p className="text-[14px] text-meta">
              <Link href={`${base}/danh-muc`} className="hover:text-ink">
                Danh mục
              </Link>{" "}
              › {book.category}
            </p>

            <BookTitle as="h1" className="mt-2 block text-[30px] leading-tight">
              {book.title}
            </BookTitle>
            <p className="mt-1 text-base text-meta">{book.author}</p>

            {/* The availability panel changes with state, and so does the
                button's label — "Xin mượn" only when the book is really here. */}
            <div className="mt-6">
              <StatusPanel status={book.status}>
                {isAvailable ? (
                  <>
                    <p className="text-[16px]">
                      Có {book.copiesAvailable} trên {book.copiesTotal} bản đang ở
                      trên kệ.
                    </p>
                    <p className="text-[14px] text-meta">
                      Đến tủ sách sau lễ Chúa nhật để nhận sách.
                    </p>
                  </>
                ) : book.loan ? (
                  <>
                    <p className="text-[16px]">
                      {book.loan.holder} đang giữ cuốn này · còn{" "}
                      {book.loan.daysLeft} ngày.
                    </p>
                    <p className="text-[14px] text-meta">
                      Hạn trả {book.loan.due}.
                    </p>
                    <p className="flex items-center gap-2 pt-1 text-[15px]">
                      <Users aria-hidden className="size-5" strokeWidth={1.75} />
                      Đang có {book.loan.queue} người chờ mượn
                    </p>
                  </>
                ) : (
                  <p className="text-[16px]">Cuốn này hiện không có trên kệ.</p>
                )}
              </StatusPanel>
            </div>

            <div className="mt-6">
              <ButtonLink
                href={`${base}/sach/${book.slug}/xin-muon`}
                variant="primary"
                size="lg"
                className="min-w-80"
              >
                {isAvailable ? (
                  <>
                    <Hand aria-hidden className="size-5" strokeWidth={1.75} />
                    Xin mượn
                  </>
                ) : (
                  <>
                    <Bookmark aria-hidden className="size-5" strokeWidth={1.75} />
                    Đăng ký chờ mượn
                  </>
                )}
              </ButtonLink>
              <p className="mt-2 text-[14px] text-meta">
                {isAvailable
                  ? "Quản lý sẽ xác nhận khi bạn đến nhận sách."
                  : `Bạn sẽ là người thứ ${(book.loan?.queue ?? 0) + 1} trong hàng chờ. Quản lý sẽ báo khi đến lượt.`}
              </p>
            </div>

            {/* Single-column definition list: one label and value per row. */}
            <dl className="mt-10 divide-y divide-hairline border-y border-hairline">
              {meta.map(([label, value]) => (
                <div
                  key={label}
                  className="flex items-baseline justify-between gap-6 py-3"
                >
                  <dt className="text-[14px] text-meta">{label}</dt>
                  <dd className="text-right text-[16px]">{value}</dd>
                </div>
              ))}
            </dl>

            <section className="mt-10">
              <h2 className="text-lg font-semibold">Giới thiệu</h2>
              <div className="mt-3 space-y-4 text-[16px]">
                {book.description.map((para) => (
                  <p key={para.slice(0, 24)}>{para}</p>
                ))}
              </div>
            </section>

            {book.comments?.length ? (
              <section className="mt-10">
                <h2 className="text-lg font-semibold">Bình luận</h2>
                <ul className="mt-3 divide-y divide-hairline border-t border-hairline">
                  {book.comments.map((c) => (
                    <li key={c.name + c.date} className="flex gap-3 py-4">
                      <span
                        aria-hidden
                        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-paper text-[15px] font-semibold text-leather"
                      >
                        {c.name.split(" ").at(-1)?.charAt(0)}
                      </span>
                      <div>
                        <p className="text-[15px] font-semibold">
                          {c.name}{" "}
                          <span className="font-normal text-meta">· {c.date}</span>
                        </p>
                        <p className="mt-0.5 text-[15px]">{c.text}</p>
                      </div>
                    </li>
                  ))}
                </ul>

                <div className="mt-6 space-y-3">
                  <Textarea
                    rows={3}
                    placeholder="Viết bình luận của bạn"
                    aria-label="Viết bình luận của bạn"
                  />
                  <div className="flex flex-wrap items-center gap-3">
                    <Button size="sm">Gửi bình luận</Button>
                    <p className="text-[14px] text-meta">
                      Bình luận sẽ hiển thị sau khi quản lý duyệt.
                    </p>
                  </div>
                </div>
              </section>
            ) : null}
          </div>
        </div>
      </main>
    </>
  );
}
