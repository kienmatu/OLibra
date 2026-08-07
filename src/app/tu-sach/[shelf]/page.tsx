import Link from "next/link";
import { notFound } from "next/navigation";
import { BookOpen, Clock, KeyRound, Library, MapPin, Pin } from "lucide-react";
import { BigActionLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { BookCard } from "@/components/ui/book";
import { PhoneLink } from "@/components/ui/phone-link";
import { PublicHeader } from "@/components/shell/public-header";
import { announcements, books, shelfBySlug, shelves } from "@/lib/fixtures";

export function generateStaticParams() {
  return shelves.map((s) => ({ shelf: s.slug }));
}

export default async function ShelfHomePage({
  params,
}: {
  params: Promise<{ shelf: string }>;
}) {
  const { shelf: slug } = await params;
  const shelf = shelfBySlug(slug);
  if (!shelf) notFound();

  const base = `/tu-sach/${shelf.slug}`;
  const pinned = announcements.find((a) => a.pinned);
  const popular = books.slice(0, 6);

  return (
    <>
      <PublicHeader shelf={shelf} />

      <main className="mx-auto max-w-5xl px-6 py-10">
        {/* Shelf identity first: where it is, when it opens, who holds the key. */}
        <Card className="p-8">
          <h1 className="text-[30px] leading-tight font-semibold">{shelf.name}</h1>

          <dl className="mt-6 space-y-4">
            <div className="flex gap-3">
              <MapPin
                aria-hidden
                className="mt-1 size-5 shrink-0 text-leather"
                strokeWidth={1.75}
              />
              <div>
                <dt className="text-[14px] text-meta">Địa điểm</dt>
                <dd className="text-[16px]">{shelf.location}</dd>
              </div>
            </div>
            <div className="flex gap-3">
              <Clock
                aria-hidden
                className="mt-1 size-5 shrink-0 text-leather"
                strokeWidth={1.75}
              />
              <div>
                <dt className="text-[14px] text-meta">Giờ mở cửa</dt>
                <dd className="text-[16px]">{shelf.hours}</dd>
              </div>
            </div>
            <div className="flex gap-3">
              <KeyRound
                aria-hidden
                className="mt-1 size-5 shrink-0 text-leather"
                strokeWidth={1.75}
              />
              <div>
                <dt className="text-[14px] text-meta">Người giữ chìa khoá</dt>
                <dd className="text-[16px]">{shelf.keeper}</dd>
                <dd className="mt-0.5">
                  <PhoneLink phone={shelf.phone} size="md" />
                </dd>
              </div>
            </div>
          </dl>
        </Card>

        {pinned ? (
          <Card tone="paper" className="mt-6">
            <p className="flex items-center gap-2 text-[14px] text-meta">
              <Pin aria-hidden className="size-[18px]" strokeWidth={1.75} />
              Thông báo ghim
            </p>
            <h2 className="mt-2 text-lg font-semibold">{pinned.title}</h2>
            <p className="mt-2 text-[15px]">{pinned.excerpt}</p>
            <p className="mt-3 text-[14px] text-meta">
              Đăng ngày {pinned.date} · {pinned.author}
            </p>
          </Card>
        ) : null}

        {/* The two primary actions. Impossible to miss. */}
        <div className="mt-8 flex flex-col gap-4 sm:flex-row">
          <BigActionLink
            href={`${base}/danh-muc`}
            icon={BookOpen}
            label="Sách đang có"
            sublabel="183 cuốn có thể mượn hôm nay"
            variant="primary"
          />
          <BigActionLink
            href={`${base}/danh-muc?loc=tat-ca`}
            icon={Library}
            label="Toàn bộ tủ sách"
            sublabel={`${shelf.titles} đầu sách · ${shelf.copies} bản`}
            variant="outline"
          />
        </div>

        <section className="mt-12">
          <h2 className="text-[20px] font-semibold">Sách được mượn nhiều nhất</h2>
          <div className="mt-5 grid grid-cols-2 gap-5 sm:grid-cols-4 lg:grid-cols-6">
            {popular.map((book) => (
              <BookCard
                key={book.slug}
                href={`${base}/sach/${book.slug}`}
                title={book.title}
                author={book.author}
                status={book.status}
              />
            ))}
          </div>
        </section>

        <p className="mt-12 text-[14px]">
          <Link href={`${base}/gop-y`} className="text-sage hover:underline">
            Gửi góp ý cho ban quản trị
          </Link>
        </p>
      </main>
    </>
  );
}
