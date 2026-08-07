import Link from "next/link";
import { notFound } from "next/navigation";
import {
  BookCheck,
  Bookmark,
  Hand,
  RotateCcw,
  Settings2,
  Users,
} from "lucide-react";
import { ButtonLink, Button } from "@/components/ui/button";
import { BookCover, BookTitle } from "@/components/ui/book";
import { StatusPanel } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/field";
import { PhoneLink } from "@/components/ui/phone-link";
import { ShelfHeader } from "@/components/shell/public-header";
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

  /* Author sits under the title and the category is already in the
     breadcrumb, so both are carried in the main column. Everything else is
     reference detail: it moves beside the cover on a wide screen rather than
     pushing the description further down the page. */
  const detail: [string, string][] = [
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
      <ShelfHeader shelf={shelf} />

      <main className="mx-auto max-w-5xl px-6 py-10">
        {/* Mobile reads top to bottom as one ordered flex column: cover,
            title, status, primary action, manager shortcuts, description,
            comments, and the reference metadata last. `md:grid` restores the
            two-column
            arrangement, at which point each wrapper below turns back into a
            plain block (`md:block`) and normal source order takes over, so
            desktop is unaffected by the mobile `order-*` values. */}
        <div className="flex flex-col md:grid md:grid-cols-[300px_1fr] md:gap-10">
          <div className="contents md:block">
            <BookCover title={book.title} className="order-1 w-full text-[3rem]" />

            <dl className="order-8 mt-6 divide-y divide-hairline border-y border-hairline">
              {detail.map(([label, value]) => (
                <div key={label} className="py-2.5">
                  <dt className="text-[14px] text-meta">{label}</dt>
                  <dd className="mt-0.5 text-[15px]">{value}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="contents md:block">
            <div className="order-2 mt-6 md:mt-0">
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
            </div>

            {/* The availability panel changes with state, and so does the
                button's label — "Xin mượn" only when the book is really here. */}
            <div className="order-3 mt-6">
              <StatusPanel status={book.status}>
                {isAvailable ? (
                  <p className="text-[16px]">
                    Có {book.copiesAvailable} trên {book.copiesTotal} bản đang ở
                    trong tủ.
                  </p>
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
                  <p className="text-[16px]">Cuốn này hiện không có trong tủ.</p>
                )}
                {/* Shown in every state, not only when available (M4 of the
                    refinements review): the state where a reader most wants
                    to ring someone — the book is nowhere to be found on this
                    page — is exactly the state that used to say nothing. */}
                <p className="flex flex-wrap items-center gap-x-1.5 text-[14px] text-meta">
                  Liên hệ {shelf.keeper} ·{" "}
                  <PhoneLink phone={shelf.phone} size="sm" /> để nhận sách.
                </p>
              </StatusPanel>
            </div>

            <div className="order-4 mt-6">
              <Button variant="primary" size="lg" className="min-w-80">
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
              </Button>
              <p className="mt-2 text-[14px] text-meta">
                {isAvailable
                  ? "Quản lý sẽ xác nhận khi bạn đến nhận sách."
                  : `Bạn sẽ là người thứ ${(book.loan?.queue ?? 0) + 1} trong hàng chờ. Quản lý sẽ báo khi đến lượt.`}
              </p>
            </div>

            {/* §16.1: a manager viewing this page gets the two flows they'd
                otherwise navigate away for, with the book already chosen —
                shortening the three-step lend to two. Outline buttons only,
                so the reader's "Xin mượn" stays the one solid action here.

                This whole panel is role-gated once sessions exist: a reader
                must never see it. Until then it renders for everyone and is
                labelled "Dành cho quản lý", which is honest about being a
                fixture rather than pretending to be a permission check. */}
            <div className="order-5 mt-6 rounded-card border border-hairline bg-paper p-5">
              <p className="text-[13px] font-semibold tracking-wide text-leather uppercase">
                Dành cho quản lý
              </p>
              <div className="mt-3 flex flex-col gap-3 sm:flex-row">
                <ButtonLink
                  href={`${base}/quan-ly/cho-muon`}
                  variant="outline"
                  size="lg"
                  className="flex-1"
                >
                  <BookCheck aria-hidden className="size-5" strokeWidth={1.75} />
                  Cho mượn
                </ButtonLink>
                <ButtonLink
                  href={`${base}/quan-ly/nhan-tra`}
                  variant="outline"
                  size="lg"
                  className="flex-1"
                >
                  <RotateCcw aria-hidden className="size-5" strokeWidth={1.75} />
                  Nhận trả
                </ButtonLink>
              </div>
              <p className="mt-3 text-[14px] text-meta">
                Mở sẵn với cuốn này đã chọn, rút quy trình cho mượn ba bước xuống
                còn hai bước từ đây.
              </p>

              {/* Everything else a manager might want on this title — sửa
                  thông tin, thêm bản, tình trạng từng bản, lịch sử mượn —
                  lives on one page. A link rather than four more buttons:
                  those are occasional actions, and repeating them here would
                  leave two pages to keep in step. */}
              <Link
                href={`${base}/quan-ly/sach/${book.slug}`}
                className="mt-4 inline-flex min-h-11 items-center gap-1.5 text-[15px] font-medium text-sage hover:underline"
              >
                <Settings2 aria-hidden className="size-4" strokeWidth={1.75} />
                Quản lý sách này — sửa thông tin, thêm bản, xem lịch sử
              </Link>
            </div>

            <section className="order-6 mt-10">
              <h2 className="text-lg font-semibold">Giới thiệu</h2>
              <div className="mt-3 space-y-4 text-[16px]">
                {book.description.map((para) => (
                  <p key={para.slice(0, 24)}>{para}</p>
                ))}
              </div>
            </section>

            {book.comments?.length ? (
              <section className="order-7 mt-10">
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
