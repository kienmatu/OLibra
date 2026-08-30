import { Head, Link, useForm, usePage } from "@inertiajs/react";
import { route } from "ziggy-js";
import { Button } from "@/components/ui/button";
import AppLayout from "@/layouts/app-layout";
import { copy, t } from "@/lib/copy";
import { formatDate, formatInstantParts } from "@/lib/dates";
import type { SharedData } from "@/types";

interface MyLoanRow {
    loanId: string;
    title: string;
    slug: string;
    copyCode: string;
    dueOn: string;
    isOverdue: boolean;
    daysRemaining: number;
    renewalsUsed: number;
    renewBlockedBy: keyof typeof copy.circulation.rules | null;
}

/**
 * holdExpiresAt below is rendered with no clock comparison — the same gap
 * book.tsx's `myRequest` doc names (book.tsx:39-60, DIVERGENCE from the
 * manager's `holdExpired` flag, naming this file's copy key
 * (copy.circulation.myLoans.requestHeldLine) explicitly alongside its
 * own (copy.circulation.requests.heldLine) — not restated here a third
 * way).
 */
interface MyRequestRow {
    requestId: string;
    bookId: string;
    slug: string;
    title: string;
    status: "pending" | "approved";
    queuePosition: number | null;
    holdExpiresAt: string | null;
}

interface PageProps extends SharedData {
    dashboard: {
        loans: MyLoanRow[];
        recentlyReturned: {
            loanId: string;
            title: string;
            slug: string;
            returnedOn: string;
            returnCondition: string;
        }[];
        requests: MyRequestRow[];
    };
}

function RenewForm({ loan }: { loan: MyLoanRow }) {
    const { shelf } = usePage<SharedData>().props;
    const form = useForm({});
    if (!shelf) return null;

    if (loan.renewBlockedBy) {
        return (
            <p className="text-sm text-muted-foreground">
                {copy.circulation.rules[loan.renewBlockedBy]}
            </p>
        );
    }

    return (
        <form
            onSubmit={(e) => {
                e.preventDefault();
                form.post(
                    route("shelves.profile.loans.renew", { shelf: shelf.slug, loan: loan.loanId }),
                    {
                        preserveScroll: true,
                    },
                );
            }}
        >
            <Button type="submit" variant="outline" size="sm" disabled={form.processing}>
                {copy.circulation.myLoans.renewButton}
            </Button>
        </form>
    );
}

function CancelRequestButton({ requestId }: { requestId: string }) {
    const { shelf } = usePage<SharedData>().props;
    const form = useForm({});
    if (!shelf) return null;

    return (
        <form
            onSubmit={(e) => {
                e.preventDefault();
                form.post(
                    route("shelves.profile.requests.cancel", {
                        shelf: shelf.slug,
                        borrowRequest: requestId,
                    }),
                    {
                        preserveScroll: true,
                    },
                );
            }}
        >
            <Button type="submit" variant="outline" size="sm" disabled={form.processing}>
                {copy.circulation.requests.cancelButton}
            </Button>
        </form>
    );
}

export default function ProfileOverview() {
    const { dashboard, errors, flash, shelf } = usePage<PageProps>().props;

    return (
        <AppLayout>
            <Head title={copy.circulation.myLoans.overviewTitle} />
            <h1 className="mb-4 text-2xl font-semibold">
                {copy.circulation.myLoans.overviewTitle}
            </h1>

            {flash.success ? (
                <p
                    role="status"
                    className="mb-4 rounded-md border border-green-700/30 bg-green-700/10 px-3 py-2 text-sm"
                >
                    {flash.success}
                </p>
            ) : null}
            {errors.rule ? (
                <p
                    role="alert"
                    className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm"
                >
                    {errors.rule}
                </p>
            ) : null}

            <h2 className="mb-2 text-lg font-medium">{copy.circulation.myLoans.currentSection}</h2>
            {dashboard.loans.length === 0 ? (
                <p className="mb-6 text-sm text-muted-foreground">
                    {copy.circulation.myLoans.emptyLoans}
                </p>
            ) : (
                <ul className="mb-6 divide-y border-y">
                    {dashboard.loans.map((loan) => (
                        <li
                            key={loan.loanId}
                            className="flex items-center justify-between gap-3 py-3"
                        >
                            <div className="min-w-0">
                                <p className="truncate font-serif text-base">{loan.title}</p>
                                <p className="text-sm text-muted-foreground">
                                    {[
                                        loan.copyCode,
                                        t(copy.circulation.myLoans.dueLine, {
                                            date: formatDate(loan.dueOn),
                                        }),
                                    ].join(" · ")}
                                </p>
                                <p
                                    className={`text-sm ${loan.isOverdue ? "font-medium text-destructive" : "text-muted-foreground"}`}
                                >
                                    {loan.isOverdue
                                        ? t(copy.circulation.myLoans.overdueDays, {
                                              days: -loan.daysRemaining,
                                          })
                                        : loan.daysRemaining === 0
                                          ? copy.circulation.myLoans.dueToday
                                          : t(copy.circulation.myLoans.daysRemaining, {
                                                days: loan.daysRemaining,
                                            })}
                                </p>
                            </div>
                            <div className="shrink-0">
                                <RenewForm loan={loan} />
                            </div>
                        </li>
                    ))}
                </ul>
            )}

            <h2 className="mb-2 text-lg font-medium">{copy.circulation.myLoans.requestsSection}</h2>
            {dashboard.requests.length === 0 ? (
                <p className="mb-6 text-sm text-muted-foreground">
                    {copy.circulation.myLoans.requestsEmpty}
                </p>
            ) : (
                <ul className="mb-6 divide-y border-y">
                    {dashboard.requests.map((r) => (
                        <li
                            key={r.requestId}
                            className="flex items-center justify-between gap-3 py-3"
                        >
                            <div className="min-w-0">
                                {shelf ? (
                                    <Link
                                        href={route("shelves.books.show", {
                                            shelf: shelf.slug,
                                            book: r.slug,
                                        })}
                                        className="truncate font-serif text-base"
                                    >
                                        {r.title}
                                    </Link>
                                ) : (
                                    <p className="truncate font-serif text-base">{r.title}</p>
                                )}
                                <p className="text-sm text-muted-foreground">
                                    {r.queuePosition !== null
                                        ? t(copy.circulation.myLoans.requestPositionLine, {
                                              position: r.queuePosition,
                                          })
                                        : r.holdExpiresAt
                                          ? t(copy.circulation.myLoans.requestHeldLine, {
                                                ...formatInstantParts(r.holdExpiresAt),
                                            })
                                          : copy.circulation.myLoans.requestHeldLineNoDate}
                                </p>
                            </div>
                            <div className="shrink-0">
                                <CancelRequestButton requestId={r.requestId} />
                            </div>
                        </li>
                    ))}
                </ul>
            )}

            <h2 className="mb-2 text-lg font-medium">{copy.circulation.myLoans.recentSection}</h2>
            {dashboard.recentlyReturned.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                    {copy.circulation.myLoans.emptyHistory}
                </p>
            ) : (
                <ul className="divide-y border-y">
                    {dashboard.recentlyReturned.map((row) => (
                        <li
                            key={row.loanId}
                            className="flex items-center justify-between gap-3 py-3"
                        >
                            <p className="truncate font-serif text-base">{row.title}</p>
                            <span className="shrink-0 text-sm text-muted-foreground">
                                {t(copy.circulation.myLoans.returnedLine, {
                                    date: formatDate(row.returnedOn),
                                })}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </AppLayout>
    );
}
