import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { BookCover, BookTitle } from "@/components/ui/book";
import { Card, PageHeading } from "@/components/ui/card";
import { Chip } from "@/components/ui/segmented";
import { ManagerShell } from "@/components/shell/manager-shell";
import { bookBySlug, shelfBySlug, shelves } from "@/lib/fixtures";

export function generateStaticParams() {
  return shelves.map((s) => ({ shelf: s.slug }));
}

const RECENT = [
  {
    initial: "G",
    name: "Giuse Trần Minh",
    book: "Dế Mèn Phiêu Lưu Ký",
    text: "Sách hay, chữ to dễ đọc. Em đọc hết trong ba ngày.",
  },
  {
    initial: "M",
    name: "Maria Nguyễn Thị Lan",
    book: "Hoàng Tử Bé",
    text: "Truyện buồn nhưng rất đẹp. Em đọc lần hai mới hiểu đoạn con cáo.",
  },
  {
    initial: "G",
    name: "Giuse Trần Minh",
    book: "Hoàng Tử Bé",
    text: "Em chờ mãi mới tới lượt mượn, đọc xong thấy đáng chờ.",
  },
];

export default async function CommentsPage({
  params,
}: {
  params: Promise<{ shelf: string }>;
}) {
  const { shelf: slug } = await params;
  const shelf = shelfBySlug(slug);
  if (!shelf) notFound();

  const book = bookBySlug("de-men-phieu-luu-ky")!;

  return (
    <ManagerShell shelfName={shelf.name} shelfSlug={shelf.slug} active="binh-luan">
      <div className="space-y-8">
        <PageHeading
          title="Bình luận chờ duyệt"
          subtitle="1 bình luận đang chờ · Bình luận chỉ hiển thị công khai sau khi được duyệt."
        />

        <div className="flex flex-wrap gap-2.5">
          <Chip href="#" active>
            Chờ duyệt (1)
          </Chip>
          <Chip href="#">Đã duyệt (128)</Chip>
          <Chip href="#">Đã từ chối (6)</Chip>
          <Chip href="#">Đã ẩn (2)</Chip>
        </div>

        <Card className="space-y-6">
          <div className="flex items-center gap-3 rounded-control bg-paper p-3">
            <BookCover title={book.title} className="w-10 shrink-0" />
            <p className="text-[15px]">
              <span className="text-meta">Bình luận về </span>
              <BookTitle className="text-[16px]">{book.title}</BookTitle>
            </p>
          </div>

          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="flex size-11 shrink-0 items-center justify-center rounded-full bg-paper text-[16px] font-semibold text-leather"
            >
              T
            </span>
            <div>
              <p className="text-[16px] font-medium">Têrêsa Lê Ngọc Ánh</p>
              <p className="text-[14px] text-meta">
                Tổ 1 · Giáo họ Mân Côi · gửi lúc 19:42 ngày 05/08
              </p>
            </div>
          </div>

          <p className="text-[19px] leading-relaxed">
            Em rất thích cuốn này. Đoạn Dế Mèn xin lỗi chị Cốc làm em nhớ mãi. Em
            mong tủ sách có thêm phần hai ạ.
          </p>

          <p className="text-[14px] text-meta">
            Bình luận là văn bản thuần, không có định dạng hay đường dẫn.
          </p>

          <div className="flex flex-wrap items-center gap-4 border-t border-hairline pt-6">
            <Button variant="primary" size="lg">
              Duyệt bình luận
            </Button>
            <Button variant="danger" size="md">
              Từ chối
            </Button>
            <p className="text-[14px] text-meta">
              Từ chối cần ghi lý do, bạn đọc sẽ thấy lý do này.
            </p>
          </div>
        </Card>

        <section>
          <h2 className="text-[15px] font-semibold text-meta">Đã duyệt gần đây</h2>
          <ul className="mt-3 divide-y divide-hairline border-t border-hairline">
            {RECENT.map((c) => (
              <li key={c.name + c.book} className="flex items-center gap-3 py-3">
                <span
                  aria-hidden
                  className="flex size-9 shrink-0 items-center justify-center rounded-full bg-paper text-[14px] font-semibold text-leather"
                >
                  {c.initial}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px]">
                    <span className="font-medium">{c.name}</span>{" "}
                    <span className="text-meta">· </span>
                    <BookTitle className="text-[14px]">{c.book}</BookTitle>
                  </p>
                  <p className="line-clamp-1 text-[14px] text-meta">{c.text}</p>
                </div>
                <Button variant="ghost" size="sm">
                  Ẩn
                </Button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </ManagerShell>
  );
}
