import { Head, Link, usePage } from "@inertiajs/react";
import { route } from "ziggy-js";
import ManageLayout from "@/layouts/manage-layout";
import { copy, t } from "@/lib/copy";
import type { SharedData } from "@/types";

type Period = "week" | "month" | "year" | "all";

interface PageProps extends SharedData {
    stats: {
        period: Period;
        loans: number;
        borrowers: number;
        booksAdded: number;
        copiesLost: number;
        daily: { day: string; count: number }[];
        byCategory: { label: string; count: number }[];
        topBooks: { bookId: string; slug: string; title: string; count: number }[];
        topReaders: { name: string; count: number }[];
    };
}

const NUMBER = new Intl.NumberFormat("vi-VN");

const PERIODS: readonly Period[] = ["week", "month", "year", "all"];

const PERIOD_LABEL: Record<Period, string> = {
    week: copy.manageStatistics.periodWeek,
    month: copy.manageStatistics.periodMonth,
    year: copy.manageStatistics.periodYear,
    all: copy.manageStatistics.periodAll,
};

/** Four total cards. The dt sits directly above the dd it names — read
 * this before touching either, nothing else catches a swap. */
function TotalCard({ label, value }: { label: string; value: number }) {
    return (
        <div className="min-w-[160px] flex-1 rounded-lg border p-4">
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="mt-1 text-[28px] leading-none font-semibold">{NUMBER.format(value)}</dd>
        </div>
    );
}

/** A bar-only line chart over the daily counts — no chart library, per
 * AGENTS.md rule 8. The text summary above it is the tested half. */
function DailyChart({ daily }: { daily: { day: string; count: number }[] }) {
    const width = 600;
    const height = 160;
    const padding = 24;
    const max = Math.max(1, ...daily.map((row) => row.count));
    const step = daily.length > 1 ? (width - padding * 2) / (daily.length - 1) : 0;
    const points = daily.map((row, index) => {
        const x = padding + index * step;
        const y = height - padding - (row.count / max) * (height - padding * 2);
        return `${x},${y}`;
    });

    return (
        <svg
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label={copy.manageStatistics.dailyChartHeading}
            className="h-40 w-full"
        >
            <line
                x1={padding}
                y1={height - padding}
                x2={width - padding}
                y2={height - padding}
                className="stroke-border"
                strokeWidth={1}
            />
            {daily.length > 1 ? (
                <polyline
                    points={points.join(" ")}
                    fill="none"
                    className="stroke-primary"
                    strokeWidth={2}
                />
            ) : null}
            {daily.map((row, index) => {
                const x = padding + index * step;
                const y = height - padding - (row.count / max) * (height - padding * 2);
                return <circle key={row.day} cx={x} cy={y} r={3} className="fill-primary" />;
            })}
        </svg>
    );
}

/** A horizontal bar chart, one bar per category — bar-only, per AGENTS.md
 * rule 8; no pie chart. */
function CategoryChart({ byCategory }: { byCategory: { label: string; count: number }[] }) {
    const max = Math.max(1, ...byCategory.map((row) => row.count));

    return (
        <div className="flex flex-col gap-2">
            {byCategory.map((row) => (
                <div key={row.label} className="flex items-center gap-3">
                    <span className="w-32 shrink-0 truncate text-sm">{row.label}</span>
                    <div className="h-4 flex-1 rounded bg-muted">
                        <div
                            className="h-4 rounded bg-primary"
                            style={{ width: `${(row.count / max) * 100}%` }}
                        />
                    </div>
                    <span className="w-14 shrink-0 text-right text-sm text-muted-foreground">
                        {t(copy.manageStatistics.countSuffix, { count: NUMBER.format(row.count) })}
                    </span>
                </div>
            ))}
        </div>
    );
}

export default function ManageStatistics() {
    const { shelf, stats } = usePage<PageProps>().props;
    if (!shelf) return null;

    const periodHref = (period: Period) =>
        route("shelves.manage.statistics", { shelf: shelf.slug, period });

    const topCategory = stats.byCategory[0] ?? null;

    return (
        <ManageLayout>
            <Head title={copy.manageStatistics.title} />
            <h1 className="text-2xl font-semibold">{copy.manageStatistics.title}</h1>

            <div className="mt-4 mb-6 flex flex-wrap gap-2">
                {PERIODS.map((period) => (
                    <Link
                        key={period}
                        href={periodHref(period)}
                        aria-current={stats.period === period ? "page" : undefined}
                        className={`rounded-full border px-3 py-1 text-sm ${
                            stats.period === period ? "bg-foreground text-background" : ""
                        }`}
                    >
                        {PERIOD_LABEL[period]}
                    </Link>
                ))}
            </div>

            <dl className="flex flex-wrap gap-4">
                <TotalCard label={copy.manageStatistics.totalLoans} value={stats.loans} />
                <TotalCard label={copy.manageStatistics.totalBorrowers} value={stats.borrowers} />
                <TotalCard label={copy.manageStatistics.totalBooksAdded} value={stats.booksAdded} />
                <TotalCard label={copy.manageStatistics.totalCopiesLost} value={stats.copiesLost} />
            </dl>

            <section className="mt-10">
                <h2 className="text-xl font-semibold">{copy.manageStatistics.dailyChartHeading}</h2>
                {stats.daily.length === 0 ? (
                    <p className="mt-3 text-sm text-muted-foreground">
                        {copy.manageStatistics.dailyChartEmpty}
                    </p>
                ) : (
                    <>
                        {/* The text summary above the chart, AGENTS.md rule 8 —
                            the only part of this chart assertInertia can see. */}
                        <p className="mt-2 text-sm text-muted-foreground">
                            {t(copy.manageStatistics.dailyChartSummary, {
                                loans: NUMBER.format(stats.loans),
                                days: NUMBER.format(stats.daily.length),
                            })}
                        </p>
                        <div className="mt-4 rounded-lg border p-4">
                            <DailyChart daily={stats.daily} />
                        </div>
                    </>
                )}
            </section>

            <section className="mt-10">
                <h2 className="text-xl font-semibold">
                    {copy.manageStatistics.byCategoryChartHeading}
                </h2>
                {stats.byCategory.length === 0 || topCategory === null ? (
                    <p className="mt-3 text-sm text-muted-foreground">
                        {copy.manageStatistics.byCategoryChartEmpty}
                    </p>
                ) : (
                    <>
                        <p className="mt-2 text-sm text-muted-foreground">
                            {t(copy.manageStatistics.byCategoryChartSummary, {
                                label: topCategory.label,
                                count: NUMBER.format(topCategory.count),
                            })}
                        </p>
                        <div className="mt-4 rounded-lg border p-4">
                            <CategoryChart byCategory={stats.byCategory} />
                        </div>
                    </>
                )}
            </section>

            <div className="mt-10 grid gap-8 sm:grid-cols-2">
                <section>
                    <h2 className="text-xl font-semibold">
                        {copy.manageStatistics.topBooksHeading}
                    </h2>
                    {stats.topBooks.length === 0 ? (
                        <p className="mt-3 text-sm text-muted-foreground">
                            {copy.manageStatistics.topBooksEmpty}
                        </p>
                    ) : (
                        <ol className="mt-3 divide-y rounded-lg border">
                            {stats.topBooks.map((book) => (
                                <li
                                    key={book.bookId}
                                    className="flex items-center justify-between gap-3 p-3"
                                >
                                    <span className="truncate text-sm">{book.title}</span>
                                    <span className="shrink-0 text-sm text-muted-foreground">
                                        {t(copy.manageStatistics.countSuffix, {
                                            count: NUMBER.format(book.count),
                                        })}
                                    </span>
                                </li>
                            ))}
                        </ol>
                    )}
                </section>

                <section>
                    <h2 className="text-xl font-semibold">
                        {copy.manageStatistics.topReadersHeading}
                    </h2>
                    {stats.topReaders.length === 0 ? (
                        <p className="mt-3 text-sm text-muted-foreground">
                            {copy.manageStatistics.topReadersEmpty}
                        </p>
                    ) : (
                        <ol className="mt-3 divide-y rounded-lg border">
                            {stats.topReaders.map((reader) => (
                                <li
                                    key={reader.name}
                                    className="flex items-center justify-between gap-3 p-3"
                                >
                                    <span className="truncate text-sm">{reader.name}</span>
                                    <span className="shrink-0 text-sm text-muted-foreground">
                                        {t(copy.manageStatistics.countSuffix, {
                                            count: NUMBER.format(reader.count),
                                        })}
                                    </span>
                                </li>
                            ))}
                        </ol>
                    )}
                </section>
            </div>
        </ManageLayout>
    );
}
