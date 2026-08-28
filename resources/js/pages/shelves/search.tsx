import { Head, router, usePage } from "@inertiajs/react";
import { useEffect, useRef, useState } from "react";
import { route } from "ziggy-js";
import BookCard, { type CatalogueRowProps } from "@/components/book-card";
import { Input } from "@/components/ui/input";
import AppLayout from "@/layouts/app-layout";
import { copy } from "@/lib/copy";
import type { SharedData } from "@/types";

interface PageProps extends SharedData {
    q: string;
    results: CatalogueRowProps[];
    suggestions: CatalogueRowProps[];
}

export default function ShelfSearch() {
    const { shelf, q, results, suggestions } = usePage<PageProps>().props;
    const [term, setTerm] = useState(q);
    const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

    useEffect(() => () => clearTimeout(timer.current), []);

    // After every hook — an early return above a hook is a hook-order
    // violation React flags at runtime.
    if (!shelf) return null;

    const search = (value: string) => {
        setTerm(value);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => {
            router.get(
                route("shelves.search", { shelf: shelf.slug, q: value || undefined }),
                {},
                { preserveState: true, replace: true },
            );
        }, 300);
    };

    return (
        <AppLayout>
            <Head title={copy.catalogue.searchTitle} />
            <h1 className="mb-4 text-2xl font-semibold">{copy.catalogue.searchTitle}</h1>
            <Input
                value={term}
                onChange={(event) => search(event.target.value)}
                placeholder={copy.catalogue.searchPlaceholder}
                className="mb-2 max-w-md"
                autoFocus
            />
            <p className="mb-4 text-sm text-muted-foreground">{copy.readerCatalogue.searchLead}</p>

            {q === "" ? (
                <div>
                    <p className="mb-4 text-muted-foreground">
                        {copy.readerCatalogue.searchEmptyPrompt}
                    </p>
                    {suggestions.length > 0 ? (
                        <section>
                            <h2 className="mb-2 text-lg font-medium">
                                {copy.readerCatalogue.suggestionsHeading}
                            </h2>
                            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
                                {suggestions.map((book) => (
                                    <BookCard key={book.bookId} book={book} />
                                ))}
                            </div>
                        </section>
                    ) : null}
                </div>
            ) : results.length === 0 ? (
                <p className="text-muted-foreground">{copy.catalogue.emptySearch}</p>
            ) : (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
                    {results.map((book) => (
                        <BookCard key={book.bookId} book={book} />
                    ))}
                </div>
            )}
        </AppLayout>
    );
}
