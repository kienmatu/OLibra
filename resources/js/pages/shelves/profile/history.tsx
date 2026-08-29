import { Head, Link, usePage } from "@inertiajs/react";
import { route } from "ziggy-js";
import AppLayout from "@/layouts/app-layout";
import { copy, t } from "@/lib/copy";
import { formatDate } from "@/lib/dates";
import type { SharedData } from "@/types";

interface HistoryRow {
    loanId: string;
    title: string;
    slug: string;
    copyCode: string;
    lentOn: string;
    dueOn: string;
    status: "active" | "returned" | "lost" | "voided";
    returnedOn: string | null;
    returnCondition: string | null;
}

interface PageProps extends SharedData {
    history: { rows: HistoryRow[]; page: number; pageCount: number; total: number };
}

const STATUS_LABEL = {
    active: copy.circulation.myLoans.statusActive,
    returned: copy.circulation.myLoans.statusReturned,
    lost: copy.circulation.myLoans.statusLost,
    voided: copy.circulation.myLoans.statusVoided,
} as const;

export default function ProfileHistory() {
    const { shelf, history } = usePage<PageProps>().props;
    if (!shelf) return null;

    return (
        <AppLayout>
            <Head title={copy.circulation.myLoans.historyTitle} />
            <h1 className="mb-4 text-2xl font-semibold">{copy.circulation.myLoans.historyTitle}</h1>

            {history.rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                    {copy.circulation.myLoans.emptyHistory}
                </p>
            ) : (
                <ul className="divide-y border-y">
                    {history.rows.map((row) => (
                        <li key={row.loanId} className="py-3">
                            <div className="flex items-center justify-between gap-3">
                                <p className="truncate font-serif text-base">{row.title}</p>
                                <span className="shrink-0 text-sm">{STATUS_LABEL[row.status]}</span>
                            </div>
                            <p className="text-sm text-muted-foreground">
                                {[
                                    row.copyCode,
                                    t(copy.circulation.myLoans.lentLine, {
                                        date: formatDate(row.lentOn),
                                    }),
                                    row.returnedOn
                                        ? t(copy.circulation.myLoans.returnedLine, {
                                              date: formatDate(row.returnedOn),
                                          })
                                        : null,
                                ]
                                    .filter(Boolean)
                                    .join(" · ")}
                            </p>
                            {row.returnCondition ? (
                                <p className="text-sm text-muted-foreground">
                                    {
                                        copy.catalogue.condition[
                                            row.returnCondition as keyof typeof copy.catalogue.condition
                                        ]
                                    }
                                </p>
                            ) : null}
                        </li>
                    ))}
                </ul>
            )}

            {history.pageCount > 1 ? (
                <div className="mt-4 flex gap-2">
                    {history.page > 1 ? (
                        <Link
                            href={route("shelves.profile.history", {
                                shelf: shelf.slug,
                                page: history.page - 1,
                            })}
                            className="text-sm underline"
                        >
                            {copy.circulation.myLoans.prev}
                        </Link>
                    ) : null}
                    {history.page < history.pageCount ? (
                        <Link
                            href={route("shelves.profile.history", {
                                shelf: shelf.slug,
                                page: history.page + 1,
                            })}
                            className="text-sm underline"
                        >
                            {copy.circulation.myLoans.next}
                        </Link>
                    ) : null}
                </div>
            ) : null}
        </AppLayout>
    );
}
