import { Link, usePage } from "@inertiajs/react";
import { route } from "ziggy-js";
import { Badge } from "@/components/ui/badge";
import { copy } from "@/lib/copy";
import type { SharedData } from "@/types";

export interface CatalogueRowProps {
    bookId: string;
    slug: string;
    title: string;
    author: string | null;
    coverUrl: string | null;
    category: string | null;
    copiesTotal: number;
    copiesAvailable: number;
    availability: keyof typeof copy.catalogue.state;
}

/** BR §16.1's cover-forward card: cover, title, author, availability badge. */
export default function BookCard({ book }: { book: CatalogueRowProps }) {
    const { shelf } = usePage<SharedData>().props;
    if (!shelf) return null;

    return (
        <Link
            href={route("shelves.books.show", { shelf: shelf.slug, book: book.slug })}
            className="flex flex-col gap-2 rounded-md border p-3 hover:bg-accent"
        >
            <div className="aspect-[3/4] w-full overflow-hidden rounded bg-muted">
                {book.coverUrl ? (
                    <img
                        src={book.coverUrl}
                        alt={book.title}
                        className="h-full w-full object-cover"
                    />
                ) : null}
            </div>
            <div>
                <p className="line-clamp-2 font-medium">{book.title}</p>
                {book.author ? (
                    <p className="text-sm text-muted-foreground">{book.author}</p>
                ) : null}
            </div>
            <Badge
                variant={book.availability === "available" ? "default" : "outline"}
                className="self-start"
            >
                {copy.catalogue.state[book.availability]}
            </Badge>
        </Link>
    );
}
