import { Head, Link, router, usePage } from "@inertiajs/react";
import { useState } from "react";
import { route } from "ziggy-js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ManageLayout from "@/layouts/manage-layout";
import { copy, t } from "@/lib/copy";
import type { SharedData } from "@/types";

interface LostRow {
    copyId: string;
    code: string;
    bookSlug: string;
    title: string;
    author: string | null;
    condition: keyof typeof copy.catalogue.condition;
    reportedAt: string | null;
    lastBorrowerName: string | null;
}

interface PageProps extends SharedData {
    copies: LostRow[];
    errors: Record<string, string>;
}

const DATE = new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Ho_Chi_Minh",
});

/**
 * BR §16.3's Sách đã mất: the shelf-wide lost view, with the same two
 * exits §7.1 draws out of `lost` — Đánh dấu tìm thấy and Ngừng dùng.
 */
function LostRowActions({ copyId, shelfSlug }: { copyId: string; shelfSlug: string }) {
    const [retiring, setRetiring] = useState(false);
    const [reason, setReason] = useState("");

    if (retiring) {
        return (
            <div className="flex items-center gap-2">
                <Input
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder={copy.manageBooks.retireReason}
                    className="max-w-56"
                />
                <Button
                    size="sm"
                    disabled={reason.trim() === ""}
                    onClick={() =>
                        router.post(
                            route("shelves.manage.copies.retire", {
                                shelf: shelfSlug,
                                bookCopy: copyId,
                            }),
                            { reason },
                            { preserveScroll: true },
                        )
                    }
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
        <div className="flex gap-2">
            <Button
                size="sm"
                onClick={() =>
                    router.post(
                        route("shelves.manage.copies.mark-found", {
                            shelf: shelfSlug,
                            bookCopy: copyId,
                        }),
                        {},
                        { preserveScroll: true },
                    )
                }
            >
                {copy.manageBooks.markFound}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setRetiring(true)}>
                {copy.manageBooks.retire}
            </Button>
        </div>
    );
}

export default function ManageBooksLost() {
    const { shelf, copies, errors } = usePage<PageProps>().props;
    if (!shelf) return null;

    return (
        <ManageLayout>
            <Head title={copy.manageBooks.lostTitle} />
            <div className="mb-4 flex items-center justify-between">
                <h1 className="text-2xl font-semibold">{copy.manageBooks.lostTitle}</h1>
                <Link
                    href={route("shelves.manage.books.index", { shelf: shelf.slug })}
                    className="text-sm"
                >
                    {copy.manageBooks.backToList}
                </Link>
            </div>

            {errors.rule ? <p className="mb-4 text-sm text-destructive">{errors.rule}</p> : null}

            {copies.length === 0 ? (
                <p className="text-muted-foreground">{copy.manageBooks.lostEmpty}</p>
            ) : (
                <ul className="divide-y rounded-md border">
                    {copies.map((row) => (
                        <li
                            key={row.copyId}
                            className="flex flex-wrap items-center justify-between gap-3 p-3"
                        >
                            <div>
                                <Link
                                    href={route("shelves.manage.books.show", {
                                        shelf: shelf.slug,
                                        book: row.bookSlug,
                                    })}
                                    className="font-medium"
                                >
                                    {row.title}
                                </Link>
                                <p className="text-sm text-muted-foreground">
                                    {[
                                        row.code,
                                        row.author,
                                        row.reportedAt
                                            ? t(copy.manageBooks.lostReportedAt, {
                                                  date: DATE.format(new Date(row.reportedAt)),
                                              })
                                            : null,
                                        row.lastBorrowerName
                                            ? t(copy.manageBooks.lostLastBorrower, {
                                                  name: row.lastBorrowerName,
                                              })
                                            : null,
                                    ]
                                        .filter(Boolean)
                                        .join(" · ")}
                                </p>
                            </div>
                            <LostRowActions copyId={row.copyId} shelfSlug={shelf.slug} />
                        </li>
                    ))}
                </ul>
            )}
        </ManageLayout>
    );
}
