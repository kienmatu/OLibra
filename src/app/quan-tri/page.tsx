import Link from "next/link";
import {
  AlertTriangle,
  Bookmark,
  ChevronRight,
  MessageSquare,
  UserPlus,
} from "lucide-react";
import { AdminShell } from "@/components/shell/manager-shell";
import { ButtonLink } from "@/components/ui/button";
import { PageHeading, StatStrip } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { shelves, type Shelf } from "@/lib/fixtures";
import { cn } from "@/lib/utils";

export const metadata = { title: "Tổng quan hệ thống — Quản trị OLibra" };

/** Sample-only figures for the network view; not part of the shared fixtures. */
const OVERDUE: Record<string, number> = {
  "dong-thap": 3,
  "can-tho": 7,
  "ben-tre": 0,
  "vinh-long": 1,
};

const PENDING: Record<
  string,
  { signups: number; requests: number; comments: number }
> = {
  "dong-thap": { signups: 5, requests: 2, comments: 1 },
  "can-tho": { signups: 2, requests: 1, comments: 0 },
  "ben-tre": { signups: 0, requests: 0, comments: 0 },
  "vinh-long": { signups: 1, requests: 0, comments: 0 },
};

function OverdueCell({ count }: { count: number }) {
  if (count === 0) {
    return <span className="text-[15px] text-meta">—</span>;
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-control bg-overdue/10 px-2.5 py-1 text-[14px] font-medium text-overdue">
      <AlertTriangle aria-hidden className="size-[18px]" strokeWidth={1.75} />
      {count} quá hạn
    </span>
  );
}

function PendingCell({ pending }: { pending: (typeof PENDING)[string] }) {
  const chips: { key: string; icon: typeof UserPlus; label: string }[] = [];
  if (pending.signups)
    chips.push({
      key: "signups",
      icon: UserPlus,
      label: `${pending.signups} đăng ký`,
    });
  if (pending.requests)
    chips.push({
      key: "requests",
      icon: Bookmark,
      label: `${pending.requests} yêu cầu`,
    });
  if (pending.comments)
    chips.push({
      key: "comments",
      icon: MessageSquare,
      label: `${pending.comments} bình luận`,
    });

  if (chips.length === 0) {
    return <span className="text-[15px] text-meta">—</span>;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((chip) => (
        <Pill key={chip.key} icon={chip.icon} label={chip.label} tone="neutral" />
      ))}
    </div>
  );
}

function ShelfRow({ shelf }: { shelf: Shelf }) {
  const overdue = OVERDUE[shelf.slug] ?? 0;
  const pending = PENDING[shelf.slug] ?? { signups: 0, requests: 0, comments: 0 };

  return (
    <tr>
      <td className="px-4 py-3">
        <p className="text-[16px] font-medium">{shelf.name}</p>
        <p className="mt-0.5 text-[13px] text-meta">{shelf.location}</p>
      </td>
      <td className="px-4 py-3 text-[15px] text-ink/85">{shelf.titles}</td>
      <td className="px-4 py-3 text-[15px] text-ink/85">{shelf.readers}</td>
      <td className="px-4 py-3 text-[15px] text-ink/85">{shelf.onLoan}</td>
      <td className="px-4 py-3">
        <OverdueCell count={overdue} />
      </td>
      <td className="px-4 py-3">
        <PendingCell pending={pending} />
      </td>
      <td className="px-4 py-3">
        <ButtonLink href="/quan-tri/tu-sach" variant="quiet" size="sm">
          Mở tủ sách
        </ButtonLink>
      </td>
    </tr>
  );
}

function ShelfCard({ shelf }: { shelf: Shelf }) {
  const overdue = OVERDUE[shelf.slug] ?? 0;
  const pending = PENDING[shelf.slug] ?? { signups: 0, requests: 0, comments: 0 };

  return (
    <div className="rounded-card border border-hairline bg-surface p-4">
      <p className="text-[16px] font-medium">{shelf.name}</p>
      <p className="mt-0.5 text-[13px] text-meta">{shelf.location}</p>

      <dl className="mt-3 flex divide-x divide-hairline border-y border-hairline">
        {[
          { label: "Đầu sách", value: shelf.titles },
          { label: "Bạn đọc", value: shelf.readers },
          { label: "Đang mượn", value: shelf.onLoan },
        ].map((stat) => (
          <div key={stat.label} className="flex-1 py-2.5 pl-3 first:pl-0">
            <dt className="text-[13px] text-meta">{stat.label}</dt>
            <dd className="text-[16px] leading-tight font-semibold">
              {stat.value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <OverdueCell count={overdue} />
        <PendingCell pending={pending} />
      </div>

      <ButtonLink
        href="/quan-tri/tu-sach"
        variant="quiet"
        size="sm"
        className="mt-3 w-full"
      >
        Mở tủ sách
      </ButtonLink>
    </div>
  );
}

const ATTENTION = [
  {
    key: "can-tho-qua-han",
    text: "Tủ sách Cần Thơ có 7 cuốn quá hạn, nhiều nhất hệ thống.",
  },
  {
    key: "vinh-long-quan-ly",
    text: "Tủ sách Vĩnh Long chưa có quản lý viên nào trong 30 ngày qua.",
  },
  {
    key: "dang-ky-cho-duyet",
    text: "Có 8 đơn đăng ký chờ duyệt trên toàn hệ thống.",
  },
] as const;

export default function AdminOverviewPage() {
  return (
    <AdminShell active="tong-quan" viewer={null} unreadFeedback={null}>
      <PageHeading
        title="Tổng quan hệ thống"
        subtitle="4 tủ sách đang hoạt động · cập nhật lúc 09:12 hôm nay."
      />

      <div className="mt-6">
        <StatStrip
          items={[
            { label: "Tủ sách", value: "4" },
            { label: "Đầu sách", value: "812" },
            { label: "Bạn đọc", value: "324" },
            { label: "Đang mượn", value: "108" },
          ]}
        />
      </div>

      {/* Table on md and up — hairline rules, never a horizontal scroll. */}
      <div className="mt-8 hidden overflow-hidden rounded-card border border-hairline md:block">
        <table className="w-full text-left">
          <thead className="bg-paper">
            <tr>
              <th className="px-4 py-3 text-[14px] font-medium text-meta">
                Tủ sách
              </th>
              <th className="px-4 py-3 text-[14px] font-medium text-meta">
                Đầu sách
              </th>
              <th className="px-4 py-3 text-[14px] font-medium text-meta">
                Bạn đọc
              </th>
              <th className="px-4 py-3 text-[14px] font-medium text-meta">
                Đang mượn
              </th>
              <th className="px-4 py-3 text-[14px] font-medium text-meta">
                Quá hạn
              </th>
              <th className="px-4 py-3 text-[14px] font-medium text-meta">
                Chờ xử lý
              </th>
              <th className="px-4 py-3 text-[14px] font-medium text-meta">
                Thao tác
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {shelves.map((shelf) => (
              <ShelfRow key={shelf.slug} shelf={shelf} />
            ))}
          </tbody>
        </table>
      </div>

      {/* Stacked cards below md — the same data, never a scrolling table. */}
      <div className="mt-8 space-y-3 md:hidden">
        {shelves.map((shelf) => (
          <ShelfCard key={shelf.slug} shelf={shelf} />
        ))}
      </div>

      <section className={cn("mt-10 rounded-card bg-paper p-6")}>
        <h2 className="flex items-center gap-2.5 text-xl font-semibold">
          <AlertTriangle
            aria-hidden
            className="size-5 text-overdue"
            strokeWidth={1.75}
          />
          Cần chú ý
        </h2>
        <ul className="mt-4 divide-y divide-hairline border-t border-hairline">
          {ATTENTION.map((item) => (
            // The whole row is the link. Right-aligning a lone "Xem" across a
            // wide card stranded the action ~500px from the sentence it
            // belonged to, and shrank the target to a single word.
            <li key={item.key}>
              <Link
                href="/quan-tri/tu-sach"
                className="group flex min-h-11 items-center gap-2 py-3.5"
              >
                <span className="text-[16px] group-hover:text-terracotta-ink">
                  {item.text}
                </span>
                <ChevronRight
                  aria-hidden
                  className="size-[18px] shrink-0 text-sage"
                  strokeWidth={1.75}
                />
                <span className="sr-only">Xem chi tiết</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <p className="mt-8 text-[14px] text-meta">
        Mỗi tủ sách do quản lý viên địa phương tự vận hành. Quản trị viên chỉ theo
        dõi và hỗ trợ.
      </p>
    </AdminShell>
  );
}
