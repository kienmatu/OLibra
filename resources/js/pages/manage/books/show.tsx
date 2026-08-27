import { Head, Link, router, usePage } from "@inertiajs/react";
import { useState } from "react";
import { route } from "ziggy-js";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ManageLayout from "@/layouts/manage-layout";
import { copy, t } from "@/lib/copy";
import type { SharedData } from "@/types";

type ConditionKey = keyof typeof copy.catalogue.condition;

interface CopyRow {
    copyId: string;
    code: string;
    state: keyof typeof copy.catalogue.state;
    condition: ConditionKey;
    conditionNote: string | null;
    acquiredOn: string | null;
    acquiredFrom: string | null;
    acquiredFromMembershipName: string | null;
    holderName: string | null;
    dueOn: string | null;
    isOverdue: boolean;
    retiredReason: string | null;
}

interface PageProps extends SharedData {
    detail: {
        book: {
            bookId: string;
            slug: string;
            title: string;
            author: string | null;
            category: string | null;
            copiesTotal: number;
            copiesAvailable: number;
            availability: keyof typeof copy.catalogue.state;
            isPublished: boolean;
            codes: string;
        };
        onLoan: number;
        copies: CopyRow[];
        conditionHistory: {
            assessedAt: string;
            copyCode: string | null;
            assessorName: string | null;
            condition: ConditionKey;
            note: string | null;
        }[];
        loanHistory: {
            loanId: string;
            copyCode: string | null;
            borrowerName: string | null;
            lentAt: string;
            returnedAt: string | null;
            status: string;
            returnCondition: ConditionKey | null;
        }[];
    };
    errors: Record<string, string>;
}

const DATE = new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeZone: "Asia/Ho_Chi_Minh" });

function CopyActions({ copyRow, shelfSlug }: { copyRow: CopyRow; shelfSlug: string }) {
    const [assessing, setAssessing] = useState(false);
    const [condition, setCondition] = useState<ConditionKey>(copyRow.condition);
    const [note, setNote] = useState("");
    const [retiring, setRetiring] = useState(false);
    const [reason, setReason] = useState("");

    const post = (name: string, data: Record<string, string> = {}) =>
        router.post(route(name, { shelf: shelfSlug, bookCopy: copyRow.copyId }), data, {
            preserveScroll: true,
        });

    if (assessing) {
        return (
            <div className="flex flex-wrap items-center gap-2">
                <div className="flex flex-wrap gap-1">
                    {(Object.keys(copy.catalogue.condition) as ConditionKey[]).map((key) => (
                        <Button
                            key={key}
                            size="sm"
                            variant={condition === key ? "default" : "outline"}
                            onClick={() => setCondition(key)}
                        >
                            {copy.catalogue.condition[key]}
                        </Button>
                    ))}
                </div>
                <Input
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder={copy.manageBooks.assessNote}
                    className="max-w-40"
                />
                <Button
                    size="sm"
                    onClick={() => {
                        post("shelves.manage.copies.assess", { condition, note });
                        setAssessing(false);
                    }}
                >
                    {copy.manageBooks.confirm}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setAssessing(false)}>
                    {copy.manageBooks.cancel}
                </Button>
            </div>
        );
    }

    if (retiring) {
        return (
            <div className="flex flex-wrap items-center gap-2">
                <Input
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder={copy.manageBooks.retireReason}
                    className="max-w-56"
                />
                <Button
                    size="sm"
                    onClick={() => {
                        post("shelves.manage.copies.retire", { reason });
                        setRetiring(false);
                    }}
                    disabled={reason.trim() === ""}
                >
                    {copy.manageBooks.confirm}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setRetiring(false)}>
                    {copy.manageBooks.cancel}
                </Button>
            </div>
        );
    }

    return (
        <div className="flex flex-wrap gap-1">
            <Button size="sm" variant="outline" onClick={() => setAssessing(true)}>
                {copy.manageBooks.assess}
            </Button>
            {copyRow.state === "on_loan" ? (
                <Button
                    size="sm"
                    variant="outline"
                    onClick={() => post("shelves.manage.copies.report-lost")}
                >
                    {copy.manageBooks.reportLost}
                </Button>
            ) : null}
            {copyRow.state === "lost" ? (
                <Button
                    size="sm"
                    variant="outline"
                    onClick={() => post("shelves.manage.copies.mark-found")}
                >
                    {copy.manageBooks.markFound}
                </Button>
            ) : null}
            {copyRow.state === "available" || copyRow.state === "lost" ? (
                <Button size="sm" variant="outline" onClick={() => setRetiring(true)}>
                    {copy.manageBooks.retire}
                </Button>
            ) : null}
        </div>
    );
}

export default function ManageBooksShow() {
    const { shelf, detail, errors } = usePage<PageProps>().props;
    const [addCount, setAddCount] = useState("1");
    if (!shelf) return null;

    const { book } = detail;

    return (
        <ManageLayout>
            <Head title={book.title} />
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-semibold">{book.title}</h1>
                    <p className="text-muted-foreground">
                        {[book.author, book.category, book.codes].filter(Boolean).join(" · ")}
                    </p>
                    <p className="text-sm text-muted-foreground">
                        {t(copy.catalogue.copyCountLine, {
                            available: book.copiesAvailable,
                            onLoan: detail.onLoan,
                            total: book.copiesTotal,
                        })}
                    </p>
                </div>
                <div className="flex gap-2">
                    {!book.isPublished ? (
                        <Badge variant="outline">{copy.manageBooks.draftBadge}</Badge>
                    ) : null}
                    <Button asChild variant="outline">
                        <Link
                            href={route("shelves.manage.books.edit", {
                                shelf: shelf.slug,
                                book: book.slug,
                            })}
                        >
                            {copy.manageBooks.editBook}
                        </Link>
                    </Button>
                </div>
            </div>

            {errors.rule ? <p className="mb-4 text-sm text-destructive">{errors.rule}</p> : null}

            <section className="mb-6">
                <div className="mb-2 flex items-center justify-between">
                    <h2 className="text-lg font-medium">{copy.manageBooks.copiesHeading}</h2>
                    <form
                        className="flex items-center gap-2"
                        onSubmit={(event) => {
                            event.preventDefault();
                            router.post(
                                route("shelves.manage.books.copies.store", {
                                    shelf: shelf.slug,
                                    book: book.slug,
                                }),
                                { count: Number(addCount) },
                                { preserveScroll: true },
                            );
                        }}
                    >
                        <Input
                            type="number"
                            min={1}
                            value={addCount}
                            onChange={(event) => setAddCount(event.target.value)}
                            className="w-20"
                            aria-label={copy.manageBooks.addCopiesCount}
                        />
                        <Button type="submit" size="sm">
                            {copy.manageBooks.addCopies}
                        </Button>
                    </form>
                </div>
                <ul className="divide-y rounded-md border">
                    {detail.copies.map((copyRow) => (
                        <li key={copyRow.copyId} className="space-y-1 p-3">
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="font-mono text-sm">{copyRow.code}</span>
                                <Badge>{copy.catalogue.state[copyRow.state]}</Badge>
                                <Badge variant="outline">
                                    {copy.catalogue.condition[copyRow.condition]}
                                </Badge>
                                {copyRow.isOverdue ? (
                                    <Badge variant="destructive">
                                        {copy.manageBooks.overdueBadge}
                                    </Badge>
                                ) : null}
                                <span className="text-sm text-muted-foreground">
                                    {copyRow.state === "on_loan" &&
                                    copyRow.holderName &&
                                    copyRow.dueOn
                                        ? t(copy.manageBooks.withReader, {
                                              name: copyRow.holderName,
                                              date: DATE.format(new Date(copyRow.dueOn)),
                                          })
                                        : copyRow.state === "retired" && copyRow.retiredReason
                                          ? t(copy.manageBooks.retiredWithReason, {
                                                reason: copyRow.retiredReason,
                                            })
                                          : copyRow.state === "available"
                                            ? copy.manageBooks.onShelf
                                            : ""}
                                </span>
                                {copyRow.acquiredFromMembershipName || copyRow.acquiredFrom ? (
                                    <span className="text-sm text-muted-foreground">
                                        {`${copy.manageBooks.donorColumn}: ${copyRow.acquiredFromMembershipName ?? copyRow.acquiredFrom}`}
                                    </span>
                                ) : null}
                            </div>
                            <CopyActions copyRow={copyRow} shelfSlug={shelf.slug} />
                        </li>
                    ))}
                </ul>
            </section>

            <section className="mb-6">
                <h2 className="mb-2 text-lg font-medium">{copy.manageBooks.conditionHistory}</h2>
                {detail.conditionHistory.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{copy.manageBooks.historyEmpty}</p>
                ) : (
                    <ul className="space-y-1 text-sm">
                        {detail.conditionHistory.map((row) => (
                            <li key={`${row.copyCode}-${row.assessedAt}`}>
                                {[
                                    DATE.format(new Date(row.assessedAt)),
                                    row.copyCode,
                                    copy.catalogue.condition[row.condition],
                                    row.assessorName,
                                    row.note,
                                ]
                                    .filter(Boolean)
                                    .join(" · ")}
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            <section>
                <h2 className="mb-2 text-lg font-medium">{copy.manageBooks.loanHistory}</h2>
                {detail.loanHistory.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{copy.manageBooks.historyEmpty}</p>
                ) : (
                    <ul className="space-y-1 text-sm">
                        {detail.loanHistory.map((row) => (
                            <li key={row.loanId}>
                                {[
                                    DATE.format(new Date(row.lentAt)),
                                    row.copyCode,
                                    row.borrowerName,
                                    row.returnCondition
                                        ? copy.catalogue.condition[row.returnCondition]
                                        : null,
                                ]
                                    .filter(Boolean)
                                    .join(" · ")}
                            </li>
                        ))}
                    </ul>
                )}
            </section>
        </ManageLayout>
    );
}
