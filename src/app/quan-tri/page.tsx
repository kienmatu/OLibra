import Link from "next/link";
import { AlertTriangle, Archive } from "lucide-react";
import { AdminShell } from "@/components/shell/manager-shell";
import { PageHeading, StatStrip } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { countUnreadFeedback } from "@/domain/admin/queries/get-feedback-inbox";
import {
  getAdminOverview,
  type ShelfOverviewRow,
} from "@/domain/admin/queries/get-admin-overview";
import { loadAdminPage } from "@/lib/page-data";

/**
 * OPS §3.4's `GetAdminOverview` — one row per shelf, and the attention list.
 *
 * **Every figure is live**, which OPS states for this screen in as many words
 * ("overdue counts, pending-item counts per shelf, all live"). The fixture
 * version had four stat cards reading 4 / 812 / 324 / 108, a `Record` of
 * per-shelf overdue counts, and three hand-written Vietnamese sentences about
 * parishes that do not exist ("Tủ sách Cần Thơ có 7 cuốn quá hạn, nhiều nhất hệ
 * thống"). None of the seven `/quan-tri` pages named `src/lib/fixtures.ts`, so
 * no rule in this repository could see any of it — the blind spot B4a's
 * inventory closed.
 *
 * **The attention list is derived, not written.** Each line restates a figure
 * this page already has, so the sentence and the number cannot disagree, and a
 * system with nothing waiting produces no list at all. That is the difference
 * between an attention list and a list of things somebody once thought were
 * worth saying.
 *
 * **`pending` is one number per shelf, not four.** The row links to the shelf,
 * and the shelf's own sidebar breaks it into registrations, requests, comments
 * and donations. Four columns here would be the manager's screen, shrunk.
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "Tổng quan hệ thống — Quản trị OLibra" };

const NUMBER = new Intl.NumberFormat("vi-VN");

/** The lines worth an administrator's attention, from the figures on this page. */
function attentionLines(
  shelves: ShelfOverviewRow[],
  unreadFeedback: number,
): string[] {
  const lines: string[] = [];

  const worst = shelves
    .filter((s) => s.overdue > 0)
    .sort((a, b) => b.overdue - a.overdue || a.name.localeCompare(b.name))[0];
  if (worst) {
    lines.push(
      `${worst.name} có ${NUMBER.format(worst.overdue)} cuốn quá hạn, nhiều nhất hệ thống.`,
    );
  }

  for (const shelf of shelves.filter(
    (s) => s.status === "active" && s.readers === 0,
  )) {
    lines.push(`${shelf.name} chưa có thành viên nào.`);
  }

  const waiting = shelves.reduce((n, s) => n + s.pending, 0);
  if (waiting > 0) {
    lines.push(
      `Có ${NUMBER.format(waiting)} việc đang chờ xử lý trên toàn hệ thống.`,
    );
  }

  if (unreadFeedback > 0) {
    lines.push(`Có ${NUMBER.format(unreadFeedback)} góp ý chưa đọc.`);
  }

  return lines;
}

function OverdueCell({ count }: { count: number }) {
  if (count === 0) return <span className="text-[15px] text-meta">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-control bg-overdue/10 px-2.5 py-1 text-[14px] font-medium text-overdue">
      <AlertTriangle aria-hidden className="size-[18px]" strokeWidth={1.75} />
      {NUMBER.format(count)} quá hạn
    </span>
  );
}

const COLUMNS = [
  "Tủ sách",
  "Đầu sách",
  "Bạn đọc",
  "Đang mượn",
  "Quá hạn",
  "Chờ xử lý",
];

export default async function AdminOverviewPage() {
  const { viewer, unreadFeedback, shelves } = await loadAdminPage(
    async (tx, ctx, v) => ({
      viewer: v,
      unreadFeedback: await countUnreadFeedback(tx, ctx),
      shelves: await getAdminOverview(tx, ctx),
    }),
  );

  const active = shelves.filter((s) => s.status === "active");
  const totals = shelves.reduce(
    (t, s) => ({
      books: t.books + s.books,
      readers: t.readers + s.readers,
      onLoan: t.onLoan + s.activeLoans,
    }),
    { books: 0, readers: 0, onLoan: 0 },
  );
  const attention = attentionLines(shelves, unreadFeedback);

  return (
    <AdminShell active="tong-quan" viewer={viewer} unreadFeedback={unreadFeedback}>
      <PageHeading
        title="Tổng quan hệ thống"
        subtitle={`${NUMBER.format(active.length)} tủ sách đang hoạt động.`}
      />

      <div className="mt-6">
        <StatStrip
          items={[
            { label: "Tủ sách", value: NUMBER.format(active.length) },
            { label: "Đầu sách", value: NUMBER.format(totals.books) },
            { label: "Bạn đọc", value: NUMBER.format(totals.readers) },
            { label: "Đang mượn", value: NUMBER.format(totals.onLoan) },
          ]}
        />
      </div>

      {shelves.length === 0 ? (
        <p className="mt-8 text-[15px] text-meta">
          Chưa có tủ sách nào.{" "}
          <Link href="/quan-tri/tu-sach" className="underline">
            Mở tủ sách đầu tiên
          </Link>
          .
        </p>
      ) : null}

      {/* Table on md and up — hairline rules, never a horizontal scroll. */}
      <div className="mt-8 hidden overflow-hidden rounded-card border border-hairline md:block">
        <table className="w-full text-left">
          <thead className="bg-paper">
            <tr>
              {COLUMNS.map((h) => (
                <th key={h} className="px-4 py-3 text-[14px] font-medium text-meta">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {shelves.map((shelf) => (
              <tr key={shelf.bookshelfId}>
                <td className="px-4 py-3">
                  <Link
                    href={`/quan-tri/tu-sach?tu-sach=${shelf.bookshelfId}`}
                    className="text-[16px] font-medium hover:underline"
                  >
                    {shelf.name}
                  </Link>
                  {shelf.status !== "active" ? (
                    <span className="ml-2 align-middle">
                      <Pill icon={Archive} label="Đã lưu trữ" tone="retired" />
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-[15px]">
                  {NUMBER.format(shelf.books)}
                </td>
                <td className="px-4 py-3 text-[15px]">
                  {NUMBER.format(shelf.readers)}
                </td>
                <td className="px-4 py-3 text-[15px]">
                  {NUMBER.format(shelf.activeLoans)}
                </td>
                <td className="px-4 py-3">
                  <OverdueCell count={shelf.overdue} />
                </td>
                <td className="px-4 py-3 text-[15px]">
                  {shelf.pending === 0 ? "—" : NUMBER.format(shelf.pending)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Stacked cards below md — the same data, never a scrolling table. */}
      <div className="mt-8 space-y-3 md:hidden">
        {shelves.map((shelf) => (
          <div
            key={shelf.bookshelfId}
            className="rounded-card border border-hairline p-4"
          >
            <Link
              href={`/quan-tri/tu-sach?tu-sach=${shelf.bookshelfId}`}
              className="text-[17px] font-semibold hover:underline"
            >
              {shelf.name}
            </Link>
            <p className="mt-1 text-[14px] text-meta">
              {NUMBER.format(shelf.books)} đầu sách · {NUMBER.format(shelf.readers)}{" "}
              bạn đọc · {NUMBER.format(shelf.activeLoans)} đang mượn
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <OverdueCell count={shelf.overdue} />
              {shelf.pending > 0 ? (
                <span className="text-[14px] text-meta">
                  {NUMBER.format(shelf.pending)} việc chờ xử lý
                </span>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      {attention.length > 0 ? (
        <section className="mt-10 rounded-card bg-paper p-6">
          <h2 className="flex items-center gap-2.5 text-xl font-semibold">
            <AlertTriangle
              aria-hidden
              className="size-5 text-overdue"
              strokeWidth={1.75}
            />
            Cần chú ý
          </h2>
          <ul className="mt-4 space-y-2 text-[15px]">
            {attention.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </AdminShell>
  );
}
