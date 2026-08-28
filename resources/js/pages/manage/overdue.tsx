import { Head, router, usePage } from "@inertiajs/react";
import { route } from "ziggy-js";
import ManageLayout from "@/layouts/manage-layout";
import { copy, t } from "@/lib/copy";
import { formatDate } from "@/lib/dates";
import type { SharedData } from "@/types";

interface OverdueRow {
    loanId: string;
    copyCode: string;
    title: string;
    borrowerName: string;
    borrowerPhone: string | null;
    dueOn: string;
    daysLate: number;
}

interface PageProps extends SharedData {
    sort: "most-late" | "least-late" | "borrower";
    loans: OverdueRow[];
}

const SORTS = [
    ["most-late", copy.circulation.overdue.sortMostLate],
    ["least-late", copy.circulation.overdue.sortLeastLate],
    ["borrower", copy.circulation.overdue.sortBorrower],
] as const;

export default function ManageOverdue() {
    const { shelf, sort, loans } = usePage<PageProps>().props;
    if (!shelf) return null;

    return (
        <ManageLayout>
            <Head title={copy.circulation.overdue.title} />
            <h1 className="mb-4 text-2xl font-semibold">{copy.circulation.overdue.title}</h1>

            <select
                className="mb-4 h-9 rounded-md border border-input bg-background px-2 text-sm"
                value={sort}
                onChange={(e) =>
                    router.get(
                        route("shelves.manage.overdue", {
                            shelf: shelf.slug,
                            sort: e.target.value,
                        }),
                    )
                }
            >
                {SORTS.map(([value, label]) => (
                    <option key={value} value={value}>
                        {label}
                    </option>
                ))}
            </select>

            {loans.length === 0 ? (
                <p className="text-sm text-muted-foreground">{copy.circulation.overdue.empty}</p>
            ) : (
                <ul className="divide-y border-y">
                    {loans.map((loan) => (
                        <li
                            key={loan.loanId}
                            className="flex items-center justify-between gap-3 py-3"
                        >
                            <div className="min-w-0">
                                <p className="truncate font-serif text-base">{loan.title}</p>
                                <p className="truncate text-sm text-muted-foreground">
                                    {[loan.copyCode, loan.borrowerName].join(" · ")}
                                </p>
                                <p className="text-sm text-muted-foreground">
                                    {t(copy.circulation.overdue.dueLine, {
                                        date: formatDate(loan.dueOn),
                                    })}
                                </p>
                            </div>
                            <div className="shrink-0 text-right">
                                <p className="text-sm font-medium text-destructive">
                                    {t(copy.circulation.overdue.daysLate, { days: loan.daysLate })}
                                </p>
                                {/* BR §16.3: the phone is the mechanism by
                                    which books come back — tappable. */}
                                {loan.borrowerPhone ? (
                                    <a
                                        href={`tel:${loan.borrowerPhone}`}
                                        className="text-sm underline"
                                    >
                                        {loan.borrowerPhone}
                                    </a>
                                ) : (
                                    <span className="text-sm text-muted-foreground">
                                        {copy.circulation.overdue.noPhone}
                                    </span>
                                )}
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </ManageLayout>
    );
}
