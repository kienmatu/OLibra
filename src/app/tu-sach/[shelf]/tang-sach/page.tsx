import Link from "next/link";
import { notFound } from "next/navigation";
import { Camera, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { ShelfHeader } from "@/components/shell/public-header";
import { fixtureViewerName, shelfBySlug, shelves } from "@/lib/fixtures";

export function generateStaticParams() {
  return shelves.map((s) => ({ shelf: s.slug }));
}

/**
 * Offering a donation (§3 of the refinements design; BR §16.2). Deliberately
 * three fields and nothing more: a child does not know the publisher, the
 * page count or the ISBN, and may not remember a title correctly. Book data
 * is only worth recording once a volunteer has the book in hand — that is
 * the "Thêm sách" form a manager fills in after "Duyệt", not this one.
 */
export default async function TangSachPage({
  params,
}: {
  params: Promise<{ shelf: string }>;
}) {
  const { shelf: slug } = await params;
  const shelf = shelfBySlug(slug);
  if (!shelf) notFound();

  const base = `/tu-sach/${shelf.slug}`;

  return (
    <>
      <ShelfHeader
        shelfName={shelf.name}
        shelfSlug={shelf.slug}
        viewerName={fixtureViewerName}
      />

      <main className="mx-auto max-w-xl px-6 py-16">
        <h1 className="text-[28px] leading-tight font-semibold">Tặng sách</h1>
        <p className="mt-1.5 text-meta">
          Nhà có sách không đọc nữa và muốn tặng lại cho tủ sách? Kể vài dòng cho
          quản lý biết, không cần chính xác tên hay tác giả.
        </p>
        <Link
          href={`${base}/toi/tang-sach`}
          className="mt-2 inline-flex min-h-11 items-center text-[15px] font-medium text-sage hover:underline"
        >
          Xem các lời đề nghị em đã gửi
        </Link>

        <form className="mt-8 space-y-6">
          <Field
            label="Sách muốn tặng"
            required
            htmlFor="mo-ta"
            hint="Kể theo cách của em cũng được, không cần đúng tên sách."
          >
            <Textarea
              id="mo-ta"
              rows={5}
              placeholder="vd: Em có 5 cuốn truyện tranh và 2 cuốn Dế Mèn"
            />
          </Field>

          <Field
            label="Ảnh chụp sách"
            hint="Không bắt buộc. Ảnh giúp quản lý hình dung sách trước khi gặp em."
          >
            <div className="flex aspect-video w-full max-w-sm flex-col items-center justify-center gap-2 rounded-card border border-dashed border-hairline bg-paper text-center">
              <Camera
                aria-hidden
                className="size-7 text-leather"
                strokeWidth={1.75}
              />
              <span className="px-2 text-[13px] text-meta">
                Chụp bằng điện thoại cũng được
              </span>
            </div>
          </Field>

          <Field
            label="Khoảng bao nhiêu cuốn"
            htmlFor="so-luong"
            hint="Không bắt buộc. Áng chừng thôi, không cần đếm chính xác."
          >
            <Input
              id="so-luong"
              type="number"
              inputMode="numeric"
              min={1}
              placeholder="vd: 7"
              className="max-w-32"
            />
          </Field>

          <div className="flex gap-3 rounded-card border border-hairline bg-paper p-5">
            <Info
              aria-hidden
              className="mt-0.5 size-5 shrink-0 text-leather"
              strokeWidth={1.75}
            />
            <div>
              <p className="text-[16px] font-semibold">Sau khi gửi thì sao?</p>
              <p className="mt-1.5 text-[15px] text-meta">
                Sách chưa được nhận ngay. Quản lý tủ sách sẽ xem lời đề nghị này và
                xác nhận, thường trong vài ngày. Sau khi được xác nhận, em mang sách
                đến tủ sách để gửi cho quản lý.
              </p>
            </div>
          </div>

          <Button type="submit" variant="primary" size="lg" className="w-full">
            Gửi lời đề nghị tặng sách
          </Button>
        </form>
      </main>
    </>
  );
}
