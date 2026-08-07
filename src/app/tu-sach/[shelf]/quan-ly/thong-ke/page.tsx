import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { BookTitle } from "@/components/ui/book";
import { Card, StatStrip } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import { ManagerShell } from "@/components/shell/manager-shell";
import { books, readers, shelfBySlug, shelves } from "@/lib/fixtures";

export function generateStaticParams() {
  return shelves.map((s) => ({ shelf: s.slug }));
}

/* Lượt mượn theo ngày trong tháng — Chúa nhật luôn cao nhất, các ngày
   thường gần như bằng không. Dữ liệu minh hoạ, vẽ tay bằng SVG. */
const DAILY = [
  2, 1, 0, 1, 2, 1, 18, 1, 0, 2, 1, 0, 21, 1, 1, 0, 2, 1, 17, 2, 0, 1, 1, 2, 19, 1,
  0, 2, 1, 1,
];

/** Days shown along the x-axis — the first and last of the month plus every
 * Sunday peak, so the date named in the summary above the chart can be found. */
const DAILY_AXIS_DAYS = [1, 7, 13, 19, 25, 30];

function LineChart({ data }: { data: number[] }) {
  const width = 700;
  const height = 200;
  const padding = 16;
  const paddingLeft = 32;
  const paddingBottom = 28;
  const max = Math.max(...data);
  const plotWidth = width - padding - paddingLeft;
  const plotHeight = height - paddingBottom - padding;
  const stepX = plotWidth / (data.length - 1);
  const points = data.map((v, i) => {
    const x = paddingLeft + i * stepX;
    const y = padding + plotHeight - (v / max) * plotHeight;
    return [x, y] as const;
  });
  const path = points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
  const gridLines = [0, 0.5, 1];

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full"
      role="img"
      aria-label="Biểu đồ lượt mượn theo ngày trong tháng, cao nhất vào các ngày Chúa nhật"
    >
      {gridLines.map((g) => {
        const y = padding + g * plotHeight;
        const value = Math.round(max * (1 - g));
        return (
          <g key={g}>
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
      <path
        d={path}
        fill="none"
        stroke="var(--color-terracotta)"
        strokeWidth={2.5}
      />
      {points.map(([x, y], i) =>
        data[i] >= 15 ? (
          <circle key={i} cx={x} cy={y} r={4} fill="var(--color-terracotta)" />
        ) : null,
      )}
      {DAILY_AXIS_DAYS.map((day, i) => {
        const x = paddingLeft + (day - 1) * stepX;
        const anchor =
          i === 0 ? "start" : i === DAILY_AXIS_DAYS.length - 1 ? "end" : "middle";
        return (
          <text
            key={day}
            x={x}
            y={height - paddingBottom + 18}
            textAnchor={anchor}
            className="fill-meta text-[13px]"
          >
            {day.toString().padStart(2, "0")}/08
          </text>
        );
      })}
    </svg>
  );
}

const CATEGORIES = [
  { label: "Văn học thiếu nhi", value: 71 },
  { label: "Văn học nước ngoài", value: 38 },
  { label: "Văn học Việt Nam", value: 12 },
  { label: "Truyện tranh", value: 5 },
  { label: "Sách đạo", value: 2 },
];

function BarChart({ data }: { data: typeof CATEGORIES }) {
  const max = Math.max(...data.map((d) => d.value));
  return (
    <div className="space-y-3">
      {data.map((d) => (
        <div key={d.label} className="flex items-center gap-3">
          <p className="w-40 shrink-0 text-[14px] text-meta">{d.label}</p>
          <div className="h-6 flex-1 rounded-control bg-paper">
            <div
              className="h-full rounded-control bg-sage"
              style={{ width: `${(d.value / max) * 100}%` }}
            />
          </div>
          <p className="w-8 shrink-0 text-right text-[15px] font-semibold">
            {d.value}
          </p>
        </div>
      ))}
    </div>
  );
}

const TOP_BOOKS = [
  { book: books[1], count: 24 },
  { book: books[0], count: 19 },
  { book: books[7], count: 14 },
  { book: books[3], count: 11 },
  { book: books[2], count: 9 },
];

const TOP_READERS = [
  { reader: readers[1], count: 8 },
  { reader: readers[3], count: 6 },
  { reader: readers[2], count: 5 },
  { reader: readers[5], count: 4 },
  { reader: readers[0], count: 4 },
];

export default async function StatsPage({
  params,
}: {
  params: Promise<{ shelf: string }>;
}) {
  const { shelf: slug } = await params;
  const shelf = shelfBySlug(slug);
  if (!shelf) notFound();

  const base = `/tu-sach/${shelf.slug}/quan-ly/thong-ke`;

  return (
    <ManagerShell shelfName={shelf.name} shelfSlug={shelf.slug} active="thong-ke">
      <div className="space-y-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <h1 className="text-[28px] leading-tight font-semibold">Thống kê</h1>
          <Segmented
            options={[
              { href: `${base}?ky=tuan`, label: "Tuần" },
              { href: `${base}?ky=thang`, label: "Tháng", active: true },
              { href: `${base}?ky=nam`, label: "Năm" },
              { href: `${base}?ky=tu-dau`, label: "Từ đầu" },
            ]}
          />
        </div>

        <StatStrip
          items={[
            { label: "Lượt mượn", value: "128", note: "+12% so với tháng trước" },
            {
              label: "Bạn đọc đã mượn",
              value: "54",
              note: "+5 người so với tháng trước",
            },
            { label: "Sách thêm mới", value: "9", note: "3 đầu sách mới" },
            {
              label: "Sách báo mất",
              value: "0",
              note: "-1 so với tháng trước",
            },
          ]}
        />

        <Card>
          <h2 className="text-[18px] font-semibold">Lượt mượn theo ngày</h2>
          <p className="mt-1 text-[15px] text-meta">
            Tháng này có 128 lượt mượn, cao nhất vào Chúa nhật 09/08 với 21 lượt.
            Các ngày trong tuần hầu như không có ai mượn.
          </p>
          <div className="mt-5">
            <LineChart data={DAILY} />
          </div>
        </Card>

        <Card>
          <h2 className="text-[18px] font-semibold">Sách mượn theo thể loại</h2>
          <p className="mt-1 text-[15px] text-meta">
            Văn học thiếu nhi chiếm phần lớn với 71 lượt, tiếp theo là văn học nước
            ngoài với 38 lượt.
          </p>
          <div className="mt-5">
            <BarChart data={CATEGORIES} />
          </div>
        </Card>

        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <h2 className="text-[18px] font-semibold">Sách được mượn nhiều nhất</h2>
            <ul className="mt-3 divide-y divide-hairline border-t border-hairline">
              {TOP_BOOKS.map((row, i) => (
                <li key={row.book.slug} className="flex items-center gap-3 py-3">
                  <span className="w-6 shrink-0 text-[16px] font-semibold text-meta">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <BookTitle className="block text-[15px] leading-snug">
                      {row.book.title}
                    </BookTitle>
                    <p className="text-[14px] text-meta">{row.book.author}</p>
                  </div>
                  <p className="text-[15px] font-semibold">{row.count}</p>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h2 className="text-[18px] font-semibold">Bạn đọc chăm nhất</h2>
            <ul className="mt-3 divide-y divide-hairline border-t border-hairline">
              {TOP_READERS.map((row, i) => (
                <li key={row.reader.id} className="flex items-center gap-3 py-3">
                  <span className="w-6 shrink-0 text-[16px] font-semibold text-meta">
                    {i + 1}
                  </span>
                  <span
                    aria-hidden
                    className="flex size-9 shrink-0 items-center justify-center rounded-full bg-paper text-[14px] font-semibold text-leather"
                  >
                    {row.reader.name.charAt(0)}
                  </span>
                  <p className="min-w-0 flex-1 truncate text-[15px] font-medium">
                    {row.reader.fullName}
                  </p>
                  <p className="text-[15px] font-semibold">{row.count}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <Button variant="quiet" size="sm">
          Tải dữ liệu CSV
        </Button>
      </div>
    </ManagerShell>
  );
}
