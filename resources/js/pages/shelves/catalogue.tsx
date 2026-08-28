import { Head, Link, router, usePage } from "@inertiajs/react";
import { route } from "ziggy-js";
import BookCard, { type CatalogueRowProps } from "@/components/book-card";
import { Button } from "@/components/ui/button";
import AppLayout from "@/layouts/app-layout";
import { copy, t } from "@/lib/copy";
import type { SharedData } from "@/types";

interface PageProps extends SharedData {
    books: { rows: CatalogueRowProps[]; page: number; pageCount: number; total: number };
    categories: { slug: string; name: string }[];
    filters: { scope: "available" | "all"; category: string | null; sort: "recent" | "title" };
}

export default function ShelfCatalogue() {
    const { shelf, books, categories, filters } = usePage<PageProps>().props;
    if (!shelf) return null;

    // Resolved values only, page dropped on any filter change — page 4 of
    // a different filter is a page nobody asked for.
    const catalogueRoute = (over: Partial<typeof filters> & { page?: number }) =>
        route("shelves.catalogue", {
            shelf: shelf.slug,
            scope: (over.scope ?? filters.scope) === "all" ? "all" : undefined,
            category:
                over.category === undefined
                    ? (filters.category ?? undefined)
                    : (over.category ?? undefined),
            sort: (over.sort ?? filters.sort) === "title" ? "title" : undefined,
            page: over.page && over.page > 1 ? over.page : undefined,
        });

    return (
        <AppLayout>
            <Head title={copy.catalogue.title} />
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h1 className="text-2xl font-semibold">{copy.catalogue.title}</h1>
                <span className="text-sm text-muted-foreground">
                    {t(copy.catalogue.totalCount, { count: books.total })}
                </span>
            </div>

            <div className="mb-4 flex flex-wrap items-center gap-2">
                <fieldset className="flex rounded-md border p-0.5">
                    <Button
                        size="sm"
                        variant={filters.scope === "available" ? "default" : "ghost"}
                        onClick={() => router.get(catalogueRoute({ scope: "available" }))}
                    >
                        {copy.catalogue.scopeAvailable}
                    </Button>
                    <Button
                        size="sm"
                        variant={filters.scope === "all" ? "default" : "ghost"}
                        onClick={() => router.get(catalogueRoute({ scope: "all" }))}
                    >
                        {copy.catalogue.scopeAll}
                    </Button>
                </fieldset>
                <select
                    className="rounded-md border bg-background px-3 py-2 text-sm"
                    value={filters.category ?? ""}
                    onChange={(event) =>
                        router.get(catalogueRoute({ category: event.target.value || null }))
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
                        router.get(
                            catalogueRoute({ sort: event.target.value as "recent" | "title" }),
                        )
                    }
                >
                    <option value="recent">{copy.catalogue.sortRecent}</option>
                    <option value="title">{copy.catalogue.sortTitle}</option>
                </select>
            </div>

            {books.rows.length === 0 ? (
                <p className="text-muted-foreground">{copy.catalogue.emptyList}</p>
            ) : (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
                    {books.rows.map((book) => (
                        <BookCard key={book.bookId} book={book} />
                    ))}
                </div>
            )}

            {books.pageCount > 1 ? (
                <nav className="mt-6 flex items-center gap-3">
                    {books.page > 1 ? (
                        <Link href={catalogueRoute({ page: books.page - 1 })}>
                            {copy.catalogue.pagePrev}
                        </Link>
                    ) : null}
                    <span className="text-sm text-muted-foreground">
                        {t(copy.catalogue.pageOf, { page: books.page, pageCount: books.pageCount })}
                    </span>
                    {books.page < books.pageCount ? (
                        <Link href={catalogueRoute({ page: books.page + 1 })}>
                            {copy.catalogue.pageNext}
                        </Link>
                    ) : null}
                </nav>
            ) : null}
        </AppLayout>
    );
}
