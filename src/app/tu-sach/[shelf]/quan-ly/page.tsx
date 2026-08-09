import Link from "next/link";
import { AlertTriangle, BookDown, BookUp, UserPlus } from "lucide-react";
import { ManagerShell } from "@/components/shell/manager-shell";
import { PageHeading, StatStrip } from "@/components/ui/card";
import { BigActionLink } from "@/components/ui/button";
import { getManagerDashboard } from "@/domain/shelf/queries/get-manager-dashboard";
import { formatDate } from "@/lib/dates";
import { loadPage } from "@/lib/page-data";
import { readShelf } from "@/lib/shelf";
import { cn } from "@/lib/utils";

/** U1 §2. See `src/app/tu-sach/[shelf]/quan-ly/cho-muon/page.tsx` for the long version. */
export const dynamic = "force-dynamic";

/** SDD §6.6. Even a count of three goes through the locale. */
const NUMBER = new Intl.NumberFormat("vi-VN");

/**
 * One of BR:537's stat cards: a number, what it counts, and the list it opens.
 *
 * A `Link` rather than a card with a link inside it, because BR:537 says
 * "tappable" and the whole card is the target — on a phone, a 44px "Xem danh
 * sách" inside a 120px card is three quarters of a miss.
 */
function StatCard({
  href,
  label,
  value,
  icon: Icon,
  ink,
  fill,
}: {
  href: string;
  label: string;
  value: number;
  icon: typeof AlertTriangle;
  ink: string;
  fill: string;
}) {
  return (
    <Link
      href={href}
      className="min-w-[190px] flex-1 rounded-card border border-hairline bg-surface p-5 transition-colors hover:border-terracotta/40"
    >
      <span
        className={cn(
          "inline-flex size-10 items-center justify-center rounded-control",
          fill,
        )}
      >
        <Icon aria-hidden className={cn("size-5", ink)} strokeWidth={1.75} />
      </span>
      <p className="mt-3 text-[28px] leading-none font-semibold">
        {NUMBER.format(value)}
      </p>
      <p className="mt-1.5 text-[15px] text-ink">{label}</p>
      <span className="mt-3 block text-[14px] font-medium text-sage">
        Xem danh sách
      </span>
    </Link>
  );
}

/**
 * BR:537's manager dashboard — "four large tappable stat cards across the top…
 * Below them, two very large primary buttons… Then shelf totals and recent
 * activity."
 *
 * **Two cards, not four, and no activity feed** (U3 §3.1, applied to the
 * dashboard rather than only to the sidebar). BR:537 names the four: *Quá hạn*,
 * *Chờ duyệt tài khoản*, *Yêu cầu mượn*, *Bình luận chờ duyệt*. The last two
 * are C2's borrow-request queue and B3's comment moderation — there is no query
 * that could answer them and no page behind them that does anything, and the
 * fixture version of this page shipped `2` and `1` beside them. OPS:81's
 * "recent activity feed" is the audit log rendered as BR §14's readable
 * Vietnamese sentences, which is D2's audit browser and which U3 §6 puts out of
 * scope; the fixture version shipped six invented events with times on them.
 *
 * Showing `0` instead would be a different lie and a worse-shaped one: a
 * volunteer reads "no comments waiting" and stops checking a queue nothing is
 * reading. So the cards are absent, exactly as the badges are.
 *
 * **And nothing is promoted into the empty slots.** BR:571 settles that in as
 * many words, about the donation queue: the dashboard "specifies four large
 * tappable cards, and the fourth was already chosen for a reason; a fifth card
 * would be a change to that decision, not an addition to it." *Đổi thông tin*
 * therefore stays a sidebar badge, which is where BR:571 puts it.
 *
 * **The two big buttons and the shelf totals are unchanged**, because both were
 * always real: the buttons are links to two wired screens, and the totals are
 * now `getManagerDashboard`'s counts instead of four numbers written into
 * `src/lib/fixtures.ts`.
 */
export default async function ManagerHomePage({
  params,
}: {
  params: Promise<{ shelf: string }>;
}) {
  const { shelf: slug } = await params;

  const { shelf, viewer, dashboard, today } = await loadPage(
    slug,
    async (tx, ctx, viewer) => ({
      shelf: await readShelf(tx, ctx),
      viewer,
      dashboard: await getManagerDashboard(tx, ctx),
      // From the injected clock, never `new Date()` on the page — the same
      // rule the confirm step follows for its due date, and the reason
      // `Clock.today()` exists at all. The fixture page printed
      // "Chúa nhật, 06/08/2026", a date that was already three days stale when
      // it shipped.
      today: ctx.clock.today(),
    }),
  );

  const base = `/tu-sach/${slug}/quan-ly`;

  return (
    <ManagerShell
      shelfName={shelf.name}
      shelfSlug={slug}
      active="trang-chinh"
      viewer={viewer}
      counts={dashboard.counts}
    >
      {/* No weekday, unlike the fixture's "Chúa nhật, 06/08/2026".
          `formatDueDate` is the formatter that carries one, and its own
          docstring reserves it for a due date — "the weekday earns its place on
          a due date and nowhere else", because that is a shelf telling a child
          which Sunday to come back on. Today's date on a volunteer's own screen
          is not that. */}
      <PageHeading
        title="Trang chính"
        subtitle={`${formatDate(today)} · ${shelf.name}`}
      />

      <div className="mt-6 flex flex-wrap gap-4">
        <StatCard
          href={`${base}/qua-han`}
          label="Quá hạn"
          value={dashboard.counts.overdue}
          icon={AlertTriangle}
          ink="text-overdue"
          fill="bg-overdue/10"
        />
        <StatCard
          href={`${base}/dang-ky-cho-duyet`}
          label="Chờ duyệt tài khoản"
          value={dashboard.counts.pendingRegistrations}
          icon={UserPlus}
          ink="text-held"
          fill="bg-held/10"
        />
      </div>

      <div className="mt-8 flex flex-col gap-4 sm:flex-row">
        <BigActionLink
          href={`${base}/cho-muon`}
          icon={BookUp}
          label="Cho mượn"
          sublabel="Tìm sách · chọn người đọc · xác nhận"
          variant="primary"
        />
        <BigActionLink
          href={`${base}/nhan-tra`}
          icon={BookDown}
          label="Nhận trả"
          sublabel="Tìm sách đang mượn · kiểm tra tình trạng"
          variant="outline"
        />
      </div>

      <section className="mt-10">
        <h2 className="text-xl font-semibold">Tình hình tủ sách</h2>
        <div className="mt-4">
          <StatStrip
            items={[
              { label: "Đầu sách", value: NUMBER.format(dashboard.totals.titles) },
              { label: "Bản sách", value: NUMBER.format(dashboard.totals.copies) },
              { label: "Đang mượn", value: NUMBER.format(dashboard.totals.onLoan) },
              {
                label: "Người đọc",
                value: NUMBER.format(dashboard.totals.readers),
              },
            ]}
          />
        </div>
      </section>
    </ManagerShell>
  );
}
