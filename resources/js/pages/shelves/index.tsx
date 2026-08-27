import { Link } from "@inertiajs/react";
import { route } from "ziggy-js";
import AppLayout from "@/layouts/app-layout";
import { copy } from "@/lib/copy";

type Props = { shelves: { slug: string; name: string; location: string | null }[] };

export default function ShelvesIndex({ shelves }: Props) {
    return (
        <AppLayout>
            <h1 className="text-2xl font-semibold">{copy.shelves.title}</h1>
            {shelves.length === 0 ? (
                <p className="mt-4 text-muted-foreground">{copy.shelves.empty}</p>
            ) : (
                <ul className="mt-4 space-y-2">
                    {shelves.map((shelf) => (
                        <li key={shelf.slug}>
                            <Link
                                href={route("shelves.show", { shelf: shelf.slug })}
                                className="underline"
                            >
                                {shelf.name}
                            </Link>
                            {shelf.location ? (
                                <span className="ml-2 text-sm">{shelf.location}</span>
                            ) : null}
                        </li>
                    ))}
                </ul>
            )}
        </AppLayout>
    );
}
