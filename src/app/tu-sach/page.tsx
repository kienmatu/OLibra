import Link from "next/link";
import { ChevronRight, MapPin, Search } from "lucide-react";
import { Input } from "@/components/ui/field";
import { FrontDoorFooter, FrontDoorHeader } from "@/components/shell/public-header";
import { shelves } from "@/lib/fixtures";
import { matches } from "@/lib/search";

export const metadata = { title: "Tìm tủ sách — OLibra" };

/**
 * The one public page about bookshelves, and it exists for one job: letting a
 * stranger find their parish's shelf so they can register for it (§1.2).
 *
 * Name and address only. Book counts, reader counts and the keeper's phone
 * number were here before and should not have been — a person with no
 * membership has no business knowing them (§16.1).
 */
export default async function PortalPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = (q ?? "").trim();
  const results = query
    ? shelves.filter((s) => matches(s.name, query) || matches(s.location, query))
    : shelves;

  return (
    <>
      <FrontDoorHeader />

      <main className="mx-auto max-w-2xl px-6 py-14">
        <h1 className="text-[28px] leading-tight font-semibold">Tìm tủ sách</h1>
        <p className="mt-1.5 text-meta">
          Chọn tủ sách của giáo xứ mình để đăng nhập, hoặc để đăng ký nếu bạn chưa
          có tài khoản.
        </p>

        <form action="/tu-sach" className="mt-7">
          <Input
            name="q"
            icon={Search}
            defaultValue={query}
            className="h-14"
            placeholder="Tên giáo xứ hoặc địa phương"
            aria-label="Tìm tủ sách"
          />
          <p className="mt-2 text-[14px] text-meta">Không cần gõ dấu.</p>
        </form>

        {results.length > 0 ? (
          <ul className="mt-8 divide-y divide-hairline border-y border-hairline">
            {results.map((shelf) => (
              <li key={shelf.slug}>
                <Link
                  href={`/dang-nhap?tu-sach=${shelf.slug}`}
                  className="group flex min-h-11 items-center gap-4 py-5"
                >
                  <div className="min-w-0 flex-1">
                    <span className="block text-lg font-semibold group-hover:text-terracotta-ink">
                      {shelf.name}
                    </span>
                    <span className="mt-1 flex items-start gap-2 text-[15px] text-meta">
                      <MapPin
                        aria-hidden
                        className="mt-0.5 size-[18px] shrink-0"
                        strokeWidth={1.75}
                      />
                      {shelf.location}
                    </span>
                  </div>
                  <ChevronRight
                    aria-hidden
                    className="size-5 shrink-0 text-meta"
                    strokeWidth={1.75}
                  />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-8 rounded-card border border-hairline bg-paper p-8">
            <h2 className="text-lg font-semibold">Không tìm thấy tủ sách nào</h2>
            <p className="mt-1.5 text-[15px] text-meta">
              Thử gõ tên giáo xứ ngắn hơn. Nếu giáo xứ của bạn chưa có tủ sách trên
              OLibra,{" "}
              <Link
                href="/lien-he"
                className="font-medium text-sage hover:underline"
              >
                liên hệ với ban quản trị
              </Link>{" "}
              để mở một tủ mới.
            </p>
          </div>
        )}
      </main>

      <FrontDoorFooter />
    </>
  );
}
