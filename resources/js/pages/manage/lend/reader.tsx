import { Head, Link, router, usePage } from "@inertiajs/react";
import { type FormEvent, useState } from "react";
import { route } from "ziggy-js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ManageLayout from "@/layouts/manage-layout";
import { copy, t } from "@/lib/copy";
import type { SharedData } from "@/types";

interface LendableReaderRow {
    membershipId: string;
    fullName: string;
    saintName: string | null;
    parishLine: string;
    activeLoans: number;
    blocked: boolean;
    reason: keyof typeof copy.circulation.rules | null;
}

interface PageProps extends SharedData {
    filters: { q: string };
    book: { slug: string; title: string; author: string | null; coverUrl: string | null } | null;
    results: LendableReaderRow[];
}

export default function QuickLendStepTwo() {
    const { shelf, filters, book, results } = usePage<PageProps>().props;
    const [q, setQ] = useState(filters.q);
    if (!shelf) return null;

    const submit = (event: FormEvent) => {
        event.preventDefault();
        router.get(
            route("shelves.manage.lend.reader", {
                shelf: shelf.slug,
                book: book?.slug,
                q: q || undefined,
            }),
            {},
            { preserveState: true },
        );
    };

    return (
        <ManageLayout>
            <Head title={copy.circulation.lend.title2} />
            <h1 className="mb-1 text-2xl font-semibold">{copy.circulation.lend.title2}</h1>
            {book ? <p className="mb-4 font-serif text-base">{book.title}</p> : null}

            <form onSubmit={submit} className="mb-4 flex gap-2">
                <Input
                    autoFocus
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder={copy.circulation.lend.searchReaderPlaceholder}
                    className="h-12 max-w-md text-base"
                />
                <Button type="submit" className="h-12">
                    {copy.circulation.lend.search}
                </Button>
            </form>

            <ul className="divide-y border-y">
                {results.map((reader) => {
                    const row = (
                        <div className="flex items-center justify-between gap-3 py-3">
                            <div className="min-w-0">
                                <p className="truncate text-base">
                                    {reader.saintName ? `${reader.saintName} ` : ""}
                                    {reader.fullName}
                                </p>
                                <p className="truncate text-sm text-muted-foreground">
                                    {reader.parishLine}
                                </p>
                                {reader.reason ? (
                                    <p className="mt-1 text-sm text-muted-foreground">
                                        {copy.circulation.rules[reader.reason]}
                                    </p>
                                ) : null}
                            </div>
                            <span className="shrink-0 text-sm text-muted-foreground">
                                {t(copy.circulation.lend.holding, { count: reader.activeLoans })}
                            </span>
                        </div>
                    );

                    return (
                        <li key={reader.membershipId}>
                            {reader.blocked ? (
                                <div className="opacity-70">{row}</div>
                            ) : (
                                <Link
                                    href={route("shelves.manage.lend.confirm", {
                                        shelf: shelf.slug,
                                        book: book?.slug,
                                        reader: reader.membershipId,
                                    })}
                                    className="block hover:bg-muted/50"
                                >
                                    {row}
                                </Link>
                            )}
                        </li>
                    );
                })}
            </ul>

            {/* BR §16.3's escape hatch (plan settled decision 3). Links to
                the LEND flow's own form — ManagerRegisterReader, active
                membership, straight back to step 3 — carrying the chosen
                book so the flow is not lost in the middle. The readers
                list's /manage/readers/create form still exists and still
                lands pending; it is the queue path, not this one. */}
            <Button asChild variant="outline" className="mt-6">
                <Link
                    href={route("shelves.manage.lend.reader.create", {
                        shelf: shelf.slug,
                        book: book?.slug,
                    })}
                >
                    {copy.circulation.lend.registerNewReader}
                </Link>
            </Button>
        </ManageLayout>
    );
}
