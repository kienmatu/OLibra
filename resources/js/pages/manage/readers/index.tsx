import { Head, Link, router, usePage } from "@inertiajs/react";
import { type FormEvent, useState } from "react";
import { route } from "ziggy-js";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ManageLayout from "@/layouts/manage-layout";
import { copy, t } from "@/lib/copy";
import type { SharedData } from "@/types";

interface ReaderRow {
    membershipId: string;
    fullName: string;
    saintName: string | null;
    status: keyof typeof copy.membershipStatus;
    parishLine: string;
    holdingCount: number;
}

interface PageProps extends SharedData {
    readers: {
        rows: ReaderRow[];
        page: number;
        pageCount: number;
        total: number;
        taxonomy: { level1Label: string; level2Label: string };
    };
    units: { id: string; level: number; name: string }[];
    filters: { q: string; status: string | null; unit: string | null };
}

const STATUSES = ["pending", "active", "suspended", "left", "rejected"] as const;

export default function ManageReadersIndex() {
    const { shelf, readers, units, filters } = usePage<PageProps>().props;
    const [q, setQ] = useState(filters.q);
    if (!shelf) return null;

    const indexRoute = (over: Record<string, string | number | null>) =>
        route("shelves.manage.readers.index", {
            shelf: shelf.slug,
            q: filters.q || undefined,
            status: filters.status ?? undefined,
            unit: filters.unit ?? undefined,
            ...over,
        });

    const submitSearch = (event: FormEvent) => {
        event.preventDefault();
        router.get(indexRoute({ q: q || null, page: null }), {}, { preserveState: true });
    };

    return (
        <ManageLayout>
            <Head title={copy.manageReaders.title} />
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h1 className="text-2xl font-semibold">{copy.manageReaders.title}</h1>
                <Button asChild>
                    <Link href={route("shelves.manage.readers.create", { shelf: shelf.slug })}>
                        {copy.manageReaders.addReader}
                    </Link>
                </Button>
            </div>

            <form onSubmit={submitSearch} className="mb-3 flex flex-wrap gap-2">
                <Input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder={copy.manageReaders.searchPlaceholder}
                    className="max-w-xs"
                />
                <Button type="submit" variant="outline">
                    {copy.manageReaders.search}
                </Button>
                <select
                    className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                    value={filters.unit ?? ""}
                    onChange={(e) =>
                        router.get(indexRoute({ unit: e.target.value || null, page: null }))
                    }
                >
                    <option value="">{copy.manageReaders.unitAll}</option>
                    {units.map((u) => (
                        <option key={u.id} value={u.id}>
                            {u.name}
                        </option>
                    ))}
                </select>
            </form>

            {/* No counts on the chips — the reference's own decision: the
                query measures the one filter in force, and an invented
                number mixed into real data is indistinguishable from data. */}
            <div className="mb-4 flex flex-wrap gap-2">
                <Link
                    href={indexRoute({ status: null, page: null })}
                    aria-current={filters.status === null ? "page" : undefined}
                    className={`rounded-full border px-3 py-1 text-sm ${filters.status === null ? "bg-foreground text-background" : ""}`}
                >
                    {copy.manageReaders.statusAll}
                </Link>
                {STATUSES.map((status) => (
                    <Link
                        key={status}
                        href={indexRoute({ status, page: null })}
                        aria-current={filters.status === status ? "page" : undefined}
                        className={`rounded-full border px-3 py-1 text-sm ${filters.status === status ? "bg-foreground text-background" : ""}`}
                    >
                        {copy.membershipStatus[status]}
                    </Link>
                ))}
            </div>

            <p className="mb-3 text-sm text-muted-foreground">
                {t(copy.manageReaders.totalCount, { count: readers.total })}
            </p>

            {readers.rows.length === 0 ? (
                <p className="text-muted-foreground">{copy.manageReaders.empty}</p>
            ) : (
                <ul className="divide-y rounded-md border">
                    {readers.rows.map((row) => (
                        <li key={row.membershipId}>
                            <Link
                                href={route("shelves.manage.readers.show", {
                                    shelf: shelf.slug,
                                    reader: row.membershipId,
                                })}
                                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-muted/50"
                            >
                                <span>
                                    <span className="font-medium">
                                        {row.saintName
                                            ? `${row.saintName} ${row.fullName}`
                                            : row.fullName}
                                    </span>
                                    {row.parishLine ? (
                                        <span className="ml-2 text-sm text-muted-foreground">
                                            {row.parishLine}
                                        </span>
                                    ) : null}
                                </span>
                                <span className="flex items-center gap-3 text-sm">
                                    <span>
                                        {t(copy.manageReaders.holding, { count: row.holdingCount })}
                                    </span>
                                    <Badge variant="outline">
                                        {copy.membershipStatus[row.status]}
                                    </Badge>
                                </span>
                            </Link>
                        </li>
                    ))}
                </ul>
            )}

            {readers.pageCount > 1 ? (
                <div className="mt-4 flex items-center gap-3">
                    {readers.page > 1 ? (
                        <Link
                            href={indexRoute({ page: readers.page - 1 })}
                            className="underline-offset-4 hover:underline"
                        >
                            {copy.manageReaders.pagePrev}
                        </Link>
                    ) : null}
                    <span className="text-sm text-muted-foreground">
                        {t(copy.manageReaders.pageOf, {
                            page: readers.page,
                            pageCount: readers.pageCount,
                        })}
                    </span>
                    {readers.page < readers.pageCount ? (
                        <Link
                            href={indexRoute({ page: readers.page + 1 })}
                            className="underline-offset-4 hover:underline"
                        >
                            {copy.manageReaders.pageNext}
                        </Link>
                    ) : null}
                </div>
            ) : null}
        </ManageLayout>
    );
}
