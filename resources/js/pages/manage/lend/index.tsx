import { Head, Link, router, usePage } from "@inertiajs/react";
import { type FormEvent, useState } from "react";
import { route } from "ziggy-js";
import CopyScanner from "@/components/copy-scanner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ManageLayout from "@/layouts/manage-layout";
import { copy, t } from "@/lib/copy";
import type { SharedData } from "@/types";

interface LendableBookRow {
    bookId: string;
    slug: string;
    title: string;
    author: string | null;
    coverUrl: string | null;
    copiesTotal: number;
    copiesAvailable: number;
    blocked: boolean;
    reason: keyof typeof copy.circulation.rules | null;
}

interface PageProps extends SharedData {
    filters: { q: string };
    results: LendableBookRow[];
}

export default function QuickLendStepOne() {
    const { shelf, filters, results, flash } = usePage<PageProps>().props;
    const [q, setQ] = useState(filters.q);
    if (!shelf) return null;

    const submit = (event: FormEvent) => {
        event.preventDefault();
        router.get(
            route("shelves.manage.lend", { shelf: shelf.slug, q: q || undefined }),
            {},
            { preserveState: true },
        );
    };

    // A scan is the printed code, resolved off the shelf's own camera
    // rather than typed — it re-runs the exact same search a manager
    // would get from typing the same code into the box above, never a
    // separate path. See copy-scanner.tsx's docblock: typing the code
    // must stay a complete path on its own, and this handler is what
    // keeps the two converging on one query instead of drifting apart.
    const onScanned = (result: { code: string }) => {
        setQ(result.code);
        router.get(
            route("shelves.manage.lend", { shelf: shelf.slug, q: result.code }),
            {},
            { preserveState: true },
        );
    };

    return (
        <ManageLayout>
            <Head title={copy.circulation.lend.title1} />
            <h1 className="mb-1 text-2xl font-semibold">{copy.circulation.lend.title1}</h1>
            <p className="mb-4 text-sm text-muted-foreground">
                {copy.circulation.lend.searchBookHint}
            </p>

            {flash.success ? (
                <p
                    role="status"
                    className="mb-4 rounded-md border border-green-700/30 bg-green-700/10 px-3 py-2 text-sm"
                >
                    {flash.success}
                </p>
            ) : null}

            <form onSubmit={submit} className="mb-4 flex gap-2">
                <Input
                    autoFocus
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder={copy.circulation.lend.searchBookPlaceholder}
                    className="h-12 max-w-md text-base"
                />
                <Button type="submit" className="h-12">
                    {copy.circulation.lend.search}
                </Button>
                <CopyScanner shelfSlug={shelf.slug} onResolved={onScanned} />
            </form>

            <ul className="divide-y border-y">
                {results.map((book) => {
                    const row = (
                        <div className="flex items-center justify-between gap-3 py-3">
                            <div className="min-w-0">
                                <p className="truncate font-serif text-base">{book.title}</p>
                                <p className="truncate text-sm text-muted-foreground">
                                    {book.author}
                                </p>
                                {book.reason ? (
                                    <p className="mt-1 text-sm text-muted-foreground">
                                        {copy.circulation.rules[book.reason]}
                                    </p>
                                ) : null}
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                                {book.blocked ? null : (
                                    <Badge>{copy.circulation.lend.available}</Badge>
                                )}
                                <span className="text-sm text-muted-foreground">
                                    {t(copy.circulation.lend.copies, {
                                        available: book.copiesAvailable,
                                        total: book.copiesTotal,
                                    })}
                                </span>
                            </div>
                        </div>
                    );

                    return (
                        <li key={book.bookId}>
                            {book.blocked ? (
                                <div className="opacity-70">{row}</div>
                            ) : (
                                <Link
                                    href={route("shelves.manage.lend.reader", {
                                        shelf: shelf.slug,
                                        book: book.slug,
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
        </ManageLayout>
    );
}
