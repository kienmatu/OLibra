import Link from "next/link";
import { AlertTriangle, Archive, PhoneOff } from "lucide-react";
import { AdminShell } from "@/components/shell/manager-shell";
import { PageHeading, StatStrip } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { countUnreadFeedback } from "@/domain/admin/queries/get-feedback-inbox";
import {
  getAdminOverview,
  getSiteContact,
  type ShelfOverviewRow,
} from "@/domain/admin/queries/get-admin-overview";
import { countPendingManagerChanges } from "@/domain/admin/queries/get-pending-manager-changes";
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
  const { viewer, unreadFeedback, pendingManagerChanges, shelves, hasSiteContact } =
    await loadAdminPage(async (tx, ctx, v) => {
      const contact = await getSiteContact(tx);
      return {
        viewer: v,
        unreadFeedback: await countUnreadFeedback(tx, ctx),
        pendingManagerChanges: await countPendingManagerChanges(tx, ctx),
        shelves: await getAdminOverview(tx, ctx),
        // Task 17 (2026-08-10 QA remediation). `getSiteContact` takes no
        // `TenantContext` and calls no policy — it is written for
        // `runPublicQuery` (see its own docstring) — but it reads nothing
        // `system_settings` doesn't already grant `olibra_admin` in full, so
        // calling it on the transaction `loadAdminPage` already has open costs
        // no second round trip and needs no second query written for the
        // same three columns `/lien-he` already reads.
        hasSiteContact: Boolean(contact.name || contact.phone),
      };
    });

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
    <AdminShell
      active="tong-quan"
      viewer={viewer}
      counts={{ unreadFeedback, pendingManagerChanges }}
    >
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

      {/* Task 17 (2026-08-10 QA remediation): the other half of the loop
          `/lien-he` closes. That page now offers a form when there is no
          contact block, so a parish can still reach someone — but nothing
          told *this* screen the block was empty, and an administrator who
          never visits `/quan-tri/cai-dat` on their own has no way to learn
          that. Placed above the shelves list rather than folded into "Cần chú
          ý" below: that section is derived from per-shelf figures
          (`attentionLines`), and this is a fact about the installation
          itself, true before a single shelf exists — the exact state the QA
          walk that found this defect started from. */}
      {!hasSiteContact ? (
        <div className="mt-8 flex items-start gap-3 rounded-card border border-hairline bg-paper p-5">
          <PhoneOff
            aria-hidden
            className="mt-0.5 size-5 shrink-0 text-overdue"
            strokeWidth={1.75}
          />
          <div>
            <p className="text-[15px]">
              Chưa có thông tin liên hệ — giáo xứ muốn mở tủ sách sẽ không biết hỏi
              ai.
            </p>
            <Link
              href="/quan-tri/cai-dat"
              className="mt-1.5 inline-block text-[14px] font-medium text-sage hover:underline"
            >
              Điền thông tin liên hệ
            </Link>
          </div>
        </div>
      ) : null}

      {shelves.length === 0 ? (
        <p className="mt-8 text-[15px] text-meta">
          Chưa có tủ sách nào.{" "}
          <Link href="/quan-tri/tu-sach" className="underline">
            Mở tủ sách đầu tiên
          </Link>
          .
        </p>
      ) : (
        <>
          {/* Table on md and up — hairline rules, never a horizontal scroll.
              QA T27: only reached with `shelves.length > 0` now — it used to
              render unconditionally, so a fresh install with zero shelves
              showed this header row sitting under the "Chưa có tủ sách nào."
              paragraph above with an empty `<tbody>` beneath it, the same bug
              this page's own two sibling listings (`/quan-ly/nguoi-doc`,
              `/quan-ly/sach`) never had, because both already guard their
              table behind a `rows.length === 0` check. */}
          <div className="mt-8 hidden overflow-hidden rounded-card border border-hairline md:block">
            <table className="w-full text-left">
              <thead className="bg-paper">
                <tr>
                  {COLUMNS.map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-[14px] font-medium text-meta"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {shelves.map((shelf) => (
                  <tr key={shelf.bookshelfId}>
                    <td className="px-4 py-3">
                      {/* QA remediation T27: links by slug, matching
                          `/quan-tri/tu-sach`'s own list — that page's `?tu-sach=`
                          resolves against `slug` now, not `bookshelfId` (see its
                          docstring), so a link still built from the id would
                          simply find no shelf. Same change on the mobile card
                          below. */}
                      <Link
                        href={`/quan-tri/tu-sach?tu-sach=${encodeURIComponent(shelf.slug)}`}
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
                  href={`/quan-tri/tu-sach?tu-sach=${encodeURIComponent(shelf.slug)}`}
                  className="text-[17px] font-semibold hover:underline"
                >
                  {shelf.name}
                </Link>
                <p className="mt-1 text-[14px] text-meta">
                  {NUMBER.format(shelf.books)} đầu sách ·{" "}
                  {NUMBER.format(shelf.readers)} bạn đọc ·{" "}
                  {NUMBER.format(shelf.activeLoans)} đang mượn
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
        </>
      )}

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
