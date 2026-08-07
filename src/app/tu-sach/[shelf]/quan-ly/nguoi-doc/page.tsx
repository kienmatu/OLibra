import { notFound } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  LogOut,
  Lock,
  Search,
  UserCheck,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { PageHeading } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { Pill, type PillTone } from "@/components/ui/pill";
import { Chip } from "@/components/ui/segmented";
import { ManagerShell } from "@/components/shell/manager-shell";
import {
  READER_STATUS,
  readers,
  shelfBySlug,
  shelves,
  type Reader,
} from "@/lib/fixtures";

export function generateStaticParams() {
  return shelves.map((s) => ({ shelf: s.slug }));
}

const MEMBERSHIP_ICON: Record<Reader["membership"], LucideIcon> = {
  active: UserCheck,
  pending: Clock,
  suspended: Lock,
  left: LogOut,
};

const MEMBERSHIP_TONE: Record<Reader["membership"], PillTone> = {
  active: "available",
  pending: "held",
  suspended: "onloan",
  left: "retired",
};

export default async function ManagerReadersPage({
  params,
}: {
  params: Promise<{ shelf: string }>;
}) {
  const { shelf: slug } = await params;
  const shelf = shelfBySlug(slug);
  if (!shelf) notFound();

  const base = `/tu-sach/${shelf.slug}/quan-ly`;
  const listHref = `${base}/nguoi-doc`;

  return (
    <ManagerShell shelfName={shelf.name} shelfSlug={shelf.slug} active="nguoi-doc">
      <PageHeading
        title="Người đọc"
        subtitle="96 bạn đọc đang hoạt động · 5 đơn chờ duyệt"
        action={
          <ButtonLink href={`${listHref}/moi`} variant="primary" size="lg">
            <UserPlus aria-hidden className="size-5" strokeWidth={1.75} />
            Đăng ký người đọc mới
          </ButtonLink>
        }
      />

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="min-w-64 flex-1">
          <Input
            icon={Search}
            className="h-11"
            placeholder="Tìm tên bạn đọc"
            aria-label="Tìm tên bạn đọc"
          />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Chip href={listHref} active>
          Tất cả (108)
        </Chip>
        <Chip href={listHref}>Đang hoạt động (96)</Chip>
        <Chip href={listHref}>Chờ duyệt (5)</Chip>
        <Chip href={listHref}>Tạm khoá (4)</Chip>
        <Chip href={listHref}>Đã rời (3)</Chip>
      </div>

      <div className="mt-6 hidden overflow-hidden rounded-card border border-hairline md:block">
        <table className="w-full text-left">
          <thead className="bg-paper">
            <tr>
              <th className="px-4 py-3 text-[14px] font-medium text-meta">
                Bạn đọc
              </th>
              <th className="px-4 py-3 text-[14px] font-medium text-meta">
                Giáo xứ
              </th>
              <th className="px-4 py-3 text-[14px] font-medium text-meta">
                Đang mượn
              </th>
              <th className="px-4 py-3 text-[14px] font-medium text-meta">
                Trạng thái
              </th>
              <th className="px-4 py-3 text-[14px] font-medium text-meta">
                Thao tác
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {readers.map((reader) => (
              <tr key={reader.id}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span
                      aria-hidden
                      className="flex size-10 shrink-0 items-center justify-center rounded-full bg-paper text-[15px] font-semibold text-leather"
                    >
                      {reader.name.charAt(0)}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-[16px] font-medium">
                        {reader.fullName}
                      </p>
                      <p className="mt-0.5 text-[13px] text-meta">{reader.born}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-[15px] text-ink/85">
                  {reader.parish}
                </td>
                <td className="px-4 py-3 text-[15px] text-ink/85">
                  {reader.holding}
                </td>
                <td className="px-4 py-3">
                  <Pill
                    icon={MEMBERSHIP_ICON[reader.membership]}
                    label={READER_STATUS[reader.membership].label}
                    tone={MEMBERSHIP_TONE[reader.membership]}
                  />
                </td>
                <td className="px-4 py-3">
                  <ButtonLink
                    href={`${listHref}/${reader.id}`}
                    variant="quiet"
                    size="sm"
                  >
                    Xem hồ sơ
                  </ButtonLink>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-6 space-y-3 md:hidden">
        {readers.map((reader) => (
          <div
            key={reader.id}
            className="rounded-card border border-hairline bg-surface p-4"
          >
            <div className="flex items-center gap-3">
              <span
                aria-hidden
                className="flex size-10 shrink-0 items-center justify-center rounded-full bg-paper text-[15px] font-semibold text-leather"
              >
                {reader.name.charAt(0)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[16px] font-medium">
                  {reader.fullName}
                </p>
                <p className="mt-0.5 text-[13px] text-meta">
                  {reader.born} · {reader.parish}
                </p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <Pill
                icon={MEMBERSHIP_ICON[reader.membership]}
                label={READER_STATUS[reader.membership].label}
                tone={MEMBERSHIP_TONE[reader.membership]}
              />
              <span className="text-[14px] text-meta">
                Đang mượn {reader.holding}
              </span>
            </div>
            <ButtonLink
              href={`${listHref}/${reader.id}`}
              variant="quiet"
              size="sm"
              className="mt-3 w-full"
            >
              Xem hồ sơ
            </ButtonLink>
          </div>
        ))}
      </div>

      <nav className="mt-8 flex items-center justify-between gap-4">
        <p className="text-[15px] text-meta">Trang 1 / 11</p>
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

      <p className="mt-3 text-[14px] text-meta">
        Trên điện thoại, bảng này hiển thị thành từng thẻ xếp dọc.
      </p>
    </ManagerShell>
  );
}
