import { Head, Link, router, usePage } from "@inertiajs/react";
import type { FormEvent } from "react";
import { useState } from "react";
import { route } from "ziggy-js";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ManageLayout from "@/layouts/manage-layout";
import { copy, t } from "@/lib/copy";
import type { SharedData } from "@/types";

interface BookRow {
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
}

interface PageProps extends SharedData {
    books: { rows: BookRow[]; page: number; pageCount: number; total: number };
    categories: { slug: string; name: string }[];
    lostCount: number;
    filters: { q: string; category: string | null; sort: string };
}

export default function ManageBooksIndex() {
    const { shelf, books, categories, lostCount, filters } = usePage<PageProps>().props;
    const [q, setQ] = useState(filters.q);
    if (!shelf) return null;

    const indexRoute = (over: Record<string, string | number | null>) =>
        route("shelves.manage.books.index", {
            shelf: shelf.slug,
            q: filters.q || undefined,
            category: filters.category ?? undefined,
            sort: filters.sort !== "recent" ? filters.sort : undefined,
            ...over,
        });

    const submitSearch = (event: FormEvent) => {
        event.preventDefault();
        router.get(indexRoute({ q: q || null, page: null }), {}, { preserveState: true });
    };

    return (
        <ManageLayout>
            <Head title={copy.manageBooks.title} />
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h1 className="text-2xl font-semibold">{copy.manageBooks.title}</h1>
                <div className="flex gap-2">
                    <Button asChild variant="outline">
                        <Link href={route("shelves.manage.books.lost", { shelf: shelf.slug })}>
                            {t(copy.manageBooks.lostChip, { count: lostCount })}
                        </Link>
                    </Button>
                    <Button asChild>
                        <Link href={route("shelves.manage.books.create", { shelf: shelf.slug })}>
                            {copy.manageBooks.addBook}
                        </Link>
                    </Button>
                </div>
            </div>

            <form onSubmit={submitSearch} className="mb-4 flex flex-wrap gap-2">
                <Input
                    value={q}
                    onChange={(event) => setQ(event.target.value)}
                    placeholder={copy.catalogue.searchPlaceholder}
                    className="max-w-xs"
                />
                <select
                    className="rounded-md border bg-background px-3 py-2 text-sm"
                    value={filters.category ?? ""}
                    onChange={(event) =>
                        router.get(indexRoute({ category: event.target.value || null, page: null }))
                    }
                >
                    <option value="">{copy.catalogue.allCategories}</option>
                    {categories.map((category) => (
                        <option key={category.slug} value={category.slug}>
                            {category.name}
                        </option>
                    ))}
                </select>
                <select
                    className="rounded-md border bg-background px-3 py-2 text-sm"
                    value={filters.sort}
                    onChange={(event) =>
                        router.get(indexRoute({ sort: event.target.value, page: null }))
                    }
                >
                    <option value="recent">{copy.catalogue.sortRecent}</option>
                    <option value="title">{copy.catalogue.sortTitle}</option>
                </select>
            </form>

            {books.rows.length === 0 ? (
                <p className="text-muted-foreground">{copy.catalogue.emptyList}</p>
            ) : (
                <ul className="divide-y rounded-md border">
                    {books.rows.map((book) => (
                        <li
                            key={book.bookId}
                            className="flex flex-wrap items-center justify-between gap-2 p-3"
                        >
                            <div>
                                <Link
                                    href={route("shelves.manage.books.show", {
                                        shelf: shelf.slug,
                                        book: book.slug,
                                    })}
                                    className="font-medium"
                                >
                                    {book.title}
                                </Link>
                                <p className="text-sm text-muted-foreground">
                                    {[book.author, book.category, book.codes]
                                        .filter(Boolean)
                                        .join(" · ")}
                                </p>
                            </div>
                            <div className="flex items-center gap-2">
                                {!book.isPublished ? (
                                    <Badge variant="outline">{copy.manageBooks.draftBadge}</Badge>
                                ) : null}
                                <Badge>{copy.catalogue.state[book.availability]}</Badge>
                                <span className="text-sm text-muted-foreground">
                                    {t(copy.catalogue.copyCountLine, {
                                        available: book.copiesAvailable,
                                        onLoan: book.copiesTotal - book.copiesAvailable,
                                        total: book.copiesTotal,
                                    })}
                                </span>
                            </div>
                        </li>
                    ))}
                </ul>
            )}

            {books.pageCount > 1 ? (
                <nav className="mt-4 flex items-center gap-3">
                    {books.page > 1 ? (
                        <Link href={indexRoute({ page: books.page - 1 })}>
                            {copy.catalogue.pagePrev}
                        </Link>
                    ) : null}
                    <span className="text-sm text-muted-foreground">
                        {t(copy.catalogue.pageOf, { page: books.page, pageCount: books.pageCount })}
                    </span>
                    {books.page < books.pageCount ? (
                        <Link href={indexRoute({ page: books.page + 1 })}>
                            {copy.catalogue.pageNext}
                        </Link>
                    ) : null}
                </nav>
            ) : null}
        </ManageLayout>
    );
}
