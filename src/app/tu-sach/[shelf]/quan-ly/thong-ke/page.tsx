import Link from "next/link";
import { BookTitle } from "@/components/ui/book";
import { Card, StatStrip } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import { ManagerShell } from "@/components/shell/manager-shell";
import {
  getStatistics,
  type StatsPeriod,
  type StatsPoint,
  statsPeriodFrom,
} from "@/domain/shelf/queries/get-statistics";
import { getManagerBadgeCounts } from "@/domain/shelf/queries/get-manager-dashboard";
import { loadPage } from "@/lib/page-data";
import { param, type SearchParams } from "@/lib/search-params";
import { readShelf } from "@/lib/shelf";

/**
 * BR §16.3's *Thống kê* — OPS §3.4's `GetStatistics`.
 *
 * **Every number and every mark on both charts comes from the query.** The
 * fixture version drew a plausible month: a `DAILY` array with Sunday peaks, a
 * `CATEGORIES` list, five top books and five top readers, and four stat cards
 * reading 128 / 54 / 9 / 0 — all invented, on a screen whose entire purpose is
 * to be believed. It also carried comparison notes ("+12% so với tháng trước")
 * that this page no longer shows: OPS §3.4 specifies no previous-period figure,
 * so the honest options were to compute a second window or to drop the note, and
 * a percentage nobody asked for is not worth doubling every aggregate.
 *
 * **The period is `?ky=`, in the four names OPS gives**, narrowed by
 * `statsPeriodFrom` so an unrecognised value is the month rather than a window
 * matching nothing — an empty statistics screen reads as "this shelf lent
 * nothing", which is the shape of bug this project has shipped twice.
 *
 * **The daily chart plots the days the query returned and no others.** The
 * fixture assumed thirty evenly spaced points; a real month has gaps, and a
 * `week` has at most seven. Reading the x-axis off the data means the chart
 * cannot claim a day nobody lent on.
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "Thống kê — Quản lý tủ sách OLibra" };

const NUMBER = new Intl.NumberFormat("vi-VN");

const PERIODS: { key: StatsPeriod; param: string; label: string }[] = [
  { key: "week", param: "tuan", label: "Tuần" },
  { key: "month", param: "thang", label: "Tháng" },
  { key: "year", param: "nam", label: "Năm" },
  { key: "all", param: "tu-dau", label: "Từ đầu" },
];

/** `?ky=thang` → `month`. The URL is Vietnamese; the domain's names are not. */
function periodFromParam(value: string | null): StatsPeriod {
  const match = PERIODS.find((p) => p.param === value);
  return statsPeriodFrom(match?.key ?? null);
}

/** `2026-08-09` → `09/08`, for an axis label. */
function shortDay(day: string): string {
  const [, month, date] = day.split("-");
  return `${date}/${month}`;
}

/**
 * The y-axis gridlines' labels for a chart topping out at `max` — up to
 * three of them (top, middle, zero), always whole numbers, never repeating.
 *
 * QA remediation T27 (P3-7, 2026-08-10 sweep): fixed at three even
 * fractions of `max` — `Math.round(max * (1 - g))` for `g` in
 * `[0, 0.5, 1]` — this used to render `1, 1, 0` for a chart whose busiest
 * day had a single loan (`max = 1`, the smallest value `LineChart` ever
 * calls this with — its own `Math.max(...counts, 1)` floors it there so a
 * quiet period never divides by zero). `Math.round(1 * 0.5)` rounds to
 * `1`, tying the midpoint gridline's label to the top one with nothing
 * distinguishing them.
 *
 * `count` is `max + 1` — the number of distinct whole numbers between `0`
 * and `max` inclusive — whenever that is smaller than three, rather than
 * asking three gridlines to label two (or one) distinct counts: `max = 1`
 * gets two ticks (`1, 0`), not three. Three fixed fractions of a *larger*
 * `max` never collide (`max`, `round(max / 2)` and `0` are only equal to
 * each other when `max` is 0 or 1, both caught by the `count` reduction —
 * `max` itself is never 0 through `LineChart`, but `yTicks` does not
 * assume its one caller stays its only one), so nothing changes for the
 * ordinary case this page has always drawn correctly. The final `Set` is
 * a defensive last step, not the mechanism the fix relies on — evidence
 * the arithmetic above already can't produce a duplicate should not be
 * the same thing as trusting it never will.
 */
function yTicks(max: number): number[] {
  const count = Math.max(1, Math.min(3, max + 1));
  const values =
    count === 1
      ? [max]
      : Array.from({ length: count }, (_, i) =>
          Math.round((max * (count - 1 - i)) / (count - 1)),
        );
  return [...new Set(values)];
}

/**
 * The daily line, drawn from whatever days came back.
 *
 * One point is a special case worth handling rather than dividing by zero: a
 * week with a single day of lending would otherwise produce `NaN` coordinates
 * and an invisible chart with no error anywhere.
 */
function LineChart({ data }: { data: StatsPoint[] }) {
  const width = 700;
  const height = 200;
  const padding = 16;
  const paddingLeft = 32;
  const paddingBottom = 28;
  const max = Math.max(...data.map((d) => d.count), 1);
  const plotWidth = width - padding - paddingLeft;
  const plotHeight = height - paddingBottom - padding;
  const stepX = data.length > 1 ? plotWidth / (data.length - 1) : 0;
  const points = data.map((d, i) => {
    const x =
      data.length > 1 ? paddingLeft + i * stepX : paddingLeft + plotWidth / 2;
    const y = padding + plotHeight - (d.count / max) * plotHeight;
    return [x, y] as const;
  });
  const path = points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
  // At most six labels, evenly spaced through the days that exist.
  const labelEvery = Math.max(1, Math.ceil(data.length / 6));

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full"
      role="img"
      aria-label={`Biểu đồ lượt mượn theo ngày, cao nhất ${NUMBER.format(max)} lượt`}
    >
      {yTicks(max).map((value, i, ticks) => {
        // Evenly spaced top-to-bottom across however many distinct ticks
        // `yTicks` actually returned — two gridlines split the height in
        // half, one sits at the top, exactly as three already did.
        const g = ticks.length > 1 ? i / (ticks.length - 1) : 0;
        const y = padding + g * plotHeight;
        return (
          <g key={value}>
            <line
              x1={paddingLeft}
              x2={width - padding}
              y1={y}
              y2={y}
              stroke="var(--color-hairline)"
              strokeWidth={1}
            />
            <text
              x={paddingLeft - 8}
              y={y}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-meta text-[13px]"
            >
              {value}
            </text>
          </g>
        );
      })}
      {points.length > 1 ? (
        <path
          d={path}
          fill="none"
          stroke="var(--color-terracotta)"
          strokeWidth={2.5}
          strokeLinejoin="round"
        />
      ) : null}
      {points.map(([x, y], i) =>
        points.length === 1 || data[i].count === max ? (
          <circle
            key={data[i].day}
            cx={x}
            cy={y}
            r={4}
            fill="var(--color-terracotta)"
          />
        ) : null,
      )}
      {data.map((d, i) =>
        i % labelEvery === 0 ? (
          <text
            key={d.day}
            x={points[i][0]}
            y={height - 8}
            textAnchor="middle"
            className="fill-meta text-[13px]"
          >
            {shortDay(d.day)}
          </text>
        ) : null,
      )}
    </svg>
  );
}

function BarChart({ data }: { data: { label: string; count: number }[] }) {
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <div className="space-y-3">
      {data.map((d) => (
        <div key={d.label} className="flex items-center gap-3">
          <p className="w-40 shrink-0 text-[14px] text-meta">{d.label}</p>
          <div className="h-6 flex-1 rounded-control bg-paper">
            <div
              className="h-full rounded-control bg-sage"
              style={{ width: `${(d.count / max) * 100}%` }}
            />
          </div>
          <p className="w-8 shrink-0 text-right text-[15px] font-semibold">
            {NUMBER.format(d.count)}
          </p>
        </div>
      ))}
    </div>
  );
}

export default async function StatsPage({
  params,
  searchParams,
}: {
  params: Promise<{ shelf: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { shelf: slug } = await params;
  const period = periodFromParam(param(await searchParams, "ky") ?? null);

  const { shelf, viewer, counts, stats } = await loadPage(
    slug,
    async (tx, ctx, v) => ({
      shelf: await readShelf(tx, ctx),
      viewer: v,
      counts: await getManagerBadgeCounts(tx, ctx),
      stats: await getStatistics(tx, ctx, { period }),
    }),
  );

  const base = `/tu-sach/${slug}/quan-ly/thong-ke`;
  const busiest = stats.daily.reduce<StatsPoint | null>(
    (best, d) => (best === null || d.count > best.count ? d : best),
    null,
  );

  return (
    <ManagerShell
      shelfName={shelf.name}
      shelfSlug={slug}
      active="thong-ke"
      viewer={viewer}
      counts={counts}
    >
      <div className="space-y-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <h1 className="text-[28px] leading-tight font-semibold">Thống kê</h1>
          <Segmented
            options={PERIODS.map((p) => ({
              href: `${base}?ky=${p.param}`,
              label: p.label,
              active: p.key === period,
            }))}
          />
        </div>

        {/* No comparison notes: OPS §3.4 specifies no previous-period figure,
            and the fixture's "+12% so với tháng trước" was invented. `note` is
            omitted rather than filled with something true but useless. */}
        <StatStrip
          items={[
            { label: "Lượt mượn", value: NUMBER.format(stats.loans) },
            { label: "Bạn đọc đã mượn", value: NUMBER.format(stats.borrowers) },
            { label: "Sách thêm mới", value: NUMBER.format(stats.booksAdded) },
            { label: "Sách báo mất", value: NUMBER.format(stats.copiesLost) },
          ]}
        />

        <Card>
          <h2 className="text-[18px] font-semibold">Lượt mượn theo ngày</h2>
          {stats.daily.length === 0 ? (
            <p className="mt-1 text-[15px] text-meta">
              Chưa có lượt mượn nào trong khoảng thời gian này.
            </p>
          ) : (
            <>
              <p className="mt-1 text-[15px] text-meta">
                {NUMBER.format(stats.loans)} lượt mượn
                {busiest
                  ? `, cao nhất ngày ${shortDay(busiest.day)} với ${NUMBER.format(busiest.count)} lượt`
                  : ""}
                .
              </p>
              <div className="mt-5">
                <LineChart data={stats.daily} />
              </div>
            </>
          )}
        </Card>

        <Card>
          <h2 className="text-[18px] font-semibold">Sách mượn theo thể loại</h2>
          {stats.byCategory.length === 0 ? (
            <p className="mt-1 text-[15px] text-meta">Chưa có dữ liệu.</p>
          ) : (
            <div className="mt-5">
              <BarChart data={stats.byCategory} />
            </div>
          )}
        </Card>

        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <h2 className="text-[18px] font-semibold">Sách được mượn nhiều nhất</h2>
            {stats.topBooks.length === 0 ? (
              <p className="mt-3 text-[15px] text-meta">Chưa có dữ liệu.</p>
            ) : (
              <ul className="mt-3 divide-y divide-hairline border-t border-hairline">
                {stats.topBooks.map((row, i) => (
                  <li key={row.bookId} className="flex items-center gap-3 py-3">
                    <span className="w-6 shrink-0 text-[16px] font-semibold text-meta">
                      {i + 1}
                    </span>
                    {/* The slug, not the id. `quan-ly/sach/[id]` is a *slug*
                        route — "every book URL in this app already carries
                        one" — and linking the uuid 404s. The query returns
                        both, which is why this was one character from being
                        right and looked right until the crawler followed it. */}
                    <Link
                      href={`/tu-sach/${slug}/quan-ly/sach/${row.slug}`}
                      className="min-w-0 flex-1"
                    >
                      <BookTitle className="block text-[15px] leading-snug">
                        {row.title}
                      </BookTitle>
                    </Link>
                    <p className="text-[15px] font-semibold">
                      {NUMBER.format(row.count)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h2 className="text-[18px] font-semibold">Bạn đọc chăm nhất</h2>
            {stats.topReaders.length === 0 ? (
              <p className="mt-3 text-[15px] text-meta">Chưa có dữ liệu.</p>
            ) : (
              <ul className="mt-3 divide-y divide-hairline border-t border-hairline">
                {stats.topReaders.map((row, i) => (
                  <li key={row.name} className="flex items-center gap-3 py-3">
                    <span className="w-6 shrink-0 text-[16px] font-semibold text-meta">
                      {i + 1}
                    </span>
                    <span
                      aria-hidden
                      className="flex size-9 shrink-0 items-center justify-center rounded-full bg-paper text-[14px] font-semibold text-leather"
                    >
                      {row.name.split(" ").at(-1)?.charAt(0) ?? ""}
                    </span>
                    <p className="min-w-0 flex-1 truncate text-[15px] font-medium">
                      {row.name}
                    </p>
                    <p className="text-[15px] font-semibold">
                      {NUMBER.format(row.count)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </ManagerShell>
  );
}
