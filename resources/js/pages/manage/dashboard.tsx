import { Head, Link, usePage } from "@inertiajs/react";
import { route } from "ziggy-js";
import ManageLayout from "@/layouts/manage-layout";
import { copy } from "@/lib/copy";
import { formatDate } from "@/lib/dates";
import type { SharedData } from "@/types";

interface PageProps extends SharedData {
    dashboard: {
        counts: {
            overdue: number;
            pendingRegistrations: number;
            pendingRequests: number;
            pendingComments: number;
        };
        totals: { titles: number; copies: number; onLoan: number; readers: number };
    };
    today: string;
}

const NUMBER = new Intl.NumberFormat("vi-VN");

function StatCard({ href, label, value }: { href: string; label: string; value: number }) {
    // The WHOLE card is the link — BR §16.3 says "tappable", and on a
    // phone a small link inside a large card is three quarters of a miss.
    return (
        <Link
            href={href}
            className="min-w-[190px] flex-1 rounded-lg border p-5 hover:border-foreground/40"
        >
            <p className="text-[28px] leading-none font-semibold">{NUMBER.format(value)}</p>
            <p className="mt-1.5 text-[15px]">{label}</p>
            <span className="mt-3 block text-sm font-medium text-muted-foreground">
                {copy.manageDashboard.viewList}
            </span>
        </Link>
    );
}

export default function ManageDashboard() {
    const { shelf, dashboard, today } = usePage<PageProps>().props;
    if (!shelf) return null;

    const totals = [
        [copy.manageDashboard.totalTitles, dashboard.totals.titles],
        [copy.manageDashboard.totalCopies, dashboard.totals.copies],
        [copy.manageDashboard.totalOnLoan, dashboard.totals.onLoan],
        [copy.manageDashboard.totalReaders, dashboard.totals.readers],
    ] as const;

    return (
        <ManageLayout>
            <Head title={copy.manageDashboard.title} />
            <h1 className="text-2xl font-semibold">{copy.manageDashboard.title}</h1>
            {/* No weekday: the weekday earns its place on a due date and
                nowhere else (the reference's formatDueDate rule). */}
            <p className="mb-6 text-sm text-muted-foreground">
                {[formatDate(today), shelf.name].join(" · ")}
            </p>

            {/* BR §16.3's four cards, all four of them since Task 8.
                CORRECTED IN THAT COMMIT: this note used to read "Three of
                BR §16.3's four cards. Bình luận chờ duyệt is the one still
                missing — Phase 2b's queue — and no substitute is promoted
                into its slot (plan divergence 6)", and every clause of it
                went false the moment the fourth card below was added.
                Divergence 6 is discharged here, not deferred. */}
            <div className="flex flex-wrap gap-4">
                <StatCard
                    href={route("shelves.manage.overdue", { shelf: shelf.slug })}
                    label={copy.manageDashboard.overdueCard}
                    value={dashboard.counts.overdue}
                />
                <StatCard
                    href={route("shelves.manage.registrations", { shelf: shelf.slug })}
                    label={copy.manageDashboard.registrationsCard}
                    value={dashboard.counts.pendingRegistrations}
                />
                <StatCard
                    href={route("shelves.manage.borrow-requests", { shelf: shelf.slug })}
                    label={copy.manageDashboard.requestsCard}
                    value={dashboard.counts.pendingRequests}
                />
                <StatCard
                    href={route("shelves.manage.comments", { shelf: shelf.slug })}
                    label={copy.manageDashboard.commentsCard}
                    value={dashboard.counts.pendingComments}
                />
            </div>

            <div className="mt-8 flex flex-col gap-4 sm:flex-row">
                <Link
                    href={route("shelves.manage.lend", { shelf: shelf.slug })}
                    className="flex-1 rounded-lg bg-primary px-6 py-5 text-primary-foreground"
                >
                    <span className="block text-lg font-semibold">
                        {copy.manageDashboard.lendAction}
                    </span>
                    <span className="block text-sm opacity-80">{copy.manageDashboard.lendSub}</span>
                </Link>
                <Link
                    href={route("shelves.manage.returns", { shelf: shelf.slug })}
                    className="flex-1 rounded-lg border px-6 py-5"
                >
                    <span className="block text-lg font-semibold">
                        {copy.manageDashboard.returnAction}
                    </span>
                    <span className="block text-sm text-muted-foreground">
                        {copy.manageDashboard.returnSub}
                    </span>
                </Link>
            </div>

            <section className="mt-10">
                <h2 className="text-xl font-semibold">{copy.manageDashboard.totalsHeading}</h2>
                <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                    {totals.map(([label, value]) => (
                        <div key={label} className="rounded-lg border p-4">
                            <dt className="text-sm text-muted-foreground">{label}</dt>
                            <dd className="text-xl font-semibold">{NUMBER.format(value)}</dd>
                        </div>
                    ))}
                </dl>
            </section>
        </ManageLayout>
    );
}
