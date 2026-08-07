import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight, Pin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PhoneLink } from "@/components/ui/phone-link";
import { PublicHeader } from "@/components/shell/public-header";
import { announcements, shelfBySlug, shelves } from "@/lib/fixtures";

export function generateStaticParams() {
  return shelves.map((s) => ({ shelf: s.slug }));
}

export default async function AnnouncementsPage({
  params,
}: {
  params: Promise<{ shelf: string }>;
}) {
  const { shelf: slug } = await params;
  const shelf = shelfBySlug(slug);
  if (!shelf) notFound();

  const pinned = announcements.find((a) => a.pinned);
  const rest = announcements.filter((a) => !a.pinned);

  return (
    <>
      <PublicHeader shelf={shelf} active="thong-bao" />

      <main className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-[28px] leading-tight font-semibold">Thông báo</h1>
        <p className="mt-1 text-meta">Tin từ {shelf.name.toLowerCase()}.</p>

        {pinned ? (
          <Card tone="paper" className="mt-8 p-8">
            <p className="flex items-center gap-2 text-[14px] text-meta">
              <Pin aria-hidden className="size-[18px]" strokeWidth={1.75} />
              Đang ghim
            </p>
            <h2 className="mt-2 text-[22px] leading-snug font-semibold">
              {pinned.title}
            </h2>
            <p className="mt-1 text-[14px] text-meta">
              Đăng ngày {pinned.date} · {pinned.author}
            </p>
            <div className="mt-4 space-y-4 text-base">
              <p>{pinned.body[0]}</p>
              <p>
                Các em mang sách trả vào Chúa nhật kế tiếp, ngày 20/08, sau lễ như
                thường lệ. Nếu có việc gấp, các em nhắn cho cô Lan theo số{" "}
                <PhoneLink
                  phone={shelf.phone}
                  size="sm"
                  className="align-baseline"
                />
              </p>
            </div>
          </Card>
        ) : null}

        <ul className="mt-10 divide-y divide-hairline border-t border-hairline">
          {rest.map((a) => (
            <li key={a.slug} className="py-6">
              <p className="text-[14px] text-meta">{a.date}</p>
              <h3 className="mt-1 text-lg leading-snug font-semibold">{a.title}</h3>
              <p className="mt-1.5 line-clamp-2 text-[15px] text-meta">
                {a.excerpt}
              </p>
              <button
                type="button"
                className="mt-2 min-h-11 text-[15px] font-medium text-sage hover:underline"
              >
                Đọc tiếp
              </button>
            </li>
          ))}
        </ul>

        <nav className="mt-8 flex items-center justify-between gap-4">
          <p className="text-[15px] text-meta">Trang 1 / 2</p>
          <div className="flex gap-2">
            <Button size="sm" disabled>
              <ChevronLeft aria-hidden className="size-5" strokeWidth={1.75} />
              Trước
            </Button>
            <Button size="sm">
              Sau
              <ChevronRight aria-hidden className="size-5" strokeWidth={1.75} />
            </Button>
          </div>
        </nav>
      </main>
    </>
  );
}
