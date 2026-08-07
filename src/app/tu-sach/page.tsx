import Link from "next/link";
import { Clock, KeyRound, MapPin, Search } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { PhoneLink } from "@/components/ui/phone-link";
import { MarketingFooter, MarketingHeader } from "@/components/shell/public-header";
import { shelves } from "@/lib/fixtures";

export const metadata = { title: "Các tủ sách — OLibra" };

export default function PortalPage() {
  return (
    <>
      <MarketingHeader />

      <main className="mx-auto max-w-5xl px-6 py-12">
        <h1 className="text-[28px] leading-tight font-semibold">Các tủ sách</h1>
        <p className="mt-1 text-meta">
          Chọn tủ sách gần bạn để xem sách đang có và xin mượn.
        </p>

        <div className="mt-6 max-w-md">
          <Input
            icon={Search}
            placeholder="Tìm theo tên hoặc địa phương"
            aria-label="Tìm tủ sách"
          />
        </div>

        <div className="mt-8 grid gap-6 md:grid-cols-2">
          {shelves.map((s) => (
            <Card key={s.slug} className="flex flex-col">
              <h2 className="text-[20px] leading-snug font-semibold">{s.name}</h2>

              <p className="mt-3 flex items-start gap-2 text-[15px] text-meta">
                <MapPin
                  aria-hidden
                  className="mt-1 size-5 shrink-0"
                  strokeWidth={1.75}
                />
                {s.location}
              </p>
              <p className="mt-1.5 flex items-start gap-2 text-[15px] text-meta">
                <Clock
                  aria-hidden
                  className="mt-1 size-5 shrink-0"
                  strokeWidth={1.75}
                />
                {s.hours}
              </p>

              <dl className="mt-5 flex divide-x divide-hairline border-y border-hairline">
                {[
                  { label: "Đầu sách", value: s.titles },
                  { label: "Bạn đọc", value: s.readers },
                  { label: "Đang mượn", value: s.onLoan },
                ].map((stat) => (
                  <div key={stat.label} className="flex-1 py-3 pl-4 first:pl-0">
                    <dt className="text-[14px] text-meta">{stat.label}</dt>
                    <dd className="text-lg leading-tight font-semibold">
                      {stat.value}
                    </dd>
                  </div>
                ))}
              </dl>

              <div className="mt-5 flex flex-wrap items-center gap-x-3">
                <span className="flex items-center gap-2 text-[15px]">
                  <KeyRound aria-hidden className="size-5" strokeWidth={1.75} />
                  {s.keeper}
                </span>
                <PhoneLink phone={s.phone} size="sm" />
              </div>

              <ButtonLink
                href={`/tu-sach/${s.slug}`}
                variant="outline"
                className="mt-5 w-full"
              >
                Vào tủ sách
              </ButtonLink>
            </Card>
          ))}
        </div>

        <p className="mt-10 text-[14px] text-meta">
          Muốn mở một tủ sách cho giáo xứ của bạn?{" "}
          <Link
            href="/lien-he"
            className="inline-flex min-h-11 items-center font-medium text-sage hover:underline"
          >
            Liên hệ với ban quản trị
          </Link>
        </p>
      </main>

      <MarketingFooter />
    </>
  );
}
