import { Head, Link, usePage } from "@inertiajs/react";
import { route } from "ziggy-js";
import { Badge } from "@/components/ui/badge";
import AppLayout from "@/layouts/app-layout";
import { copy, t } from "@/lib/copy";
import { formatInstantParts } from "@/lib/dates";
import type { SharedData } from "@/types";

/**
 * The shelf's Bản tin. The ordering is "pinned first, most recent next",
 * which is the PHASE PLAN's phrasing, not a quote from the requirements —
 * an earlier draft attributed it to BR §16.1 and the words are not there.
 * What §16.1 actually says is "The pinned announcement, or the most
 * recent published one" (its shelf-home card). The ordering itself is
 * AnnouncementsQuery::published()'s and is pinned by its own test.
 *
 * **This page sorts nothing and decides nothing.** `announcements` arrives
 * from AnnouncementsQuery::published() already ordered and already
 * filtered, and it is rendered in the order it arrives. A `.sort()` here
 * would be a second ordering that drifts from the manager's, and a
 * date comparison here would be the third clock Task 12's docblock warns
 * about: a notice lapses on read, with nothing having run, and this page
 * learns that by not being handed the row.
 *
 * `publishedAt` is optional in the row shape because the query's own
 * return type says `?string`. A published notice always has one — that is
 * what published means — so the guard below is a type obligation rather
 * than an expected case.
 */
interface AnnouncementRow {
    id: string;
    slug: string;
    title: string;
    excerpt: string;
    isPinned: boolean;
    publishedAt: string | null;
}

interface PageProps extends SharedData {
    announcements: AnnouncementRow[];
}

export default function ShelfAnnouncements() {
    const { shelf, announcements } = usePage<PageProps>().props;
    if (!shelf) return null;

    return (
        <AppLayout>
            <Head title={copy.announcements.title} />

            <h1 className="text-2xl font-semibold">{copy.announcements.title}</h1>

            {announcements.length === 0 ? (
                <p className="mt-4 text-sm text-muted-foreground">{copy.announcements.empty}</p>
            ) : (
                <ul className="mt-6 space-y-4">
                    {announcements.map((a) => (
                        <li key={a.id} className="rounded-lg border p-4">
                            {/*
                             * The badge carries the WORD "Ghim", not a tint —
                             * AGENTS.md's second non-negotiable, and the same
                             * treatment the detail page gives the same fact.
                             */}
                            {a.isPinned ? (
                                <Badge variant="secondary" className="mb-2">
                                    {copy.announcements.pinned}
                                </Badge>
                            ) : null}
                            <Link
                                href={route("shelves.announcements.show", {
                                    shelf: shelf.slug,
                                    slug: a.slug,
                                })}
                                className="block text-base leading-snug font-semibold hover:underline"
                            >
                                {a.title}
                            </Link>
                            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                                {a.excerpt}
                            </p>
                            {a.publishedAt ? (
                                <p className="mt-3 text-xs text-muted-foreground">
                                    {t(copy.announcements.publishedOn, {
                                        date: formatInstantParts(a.publishedAt).date,
                                    })}
                                </p>
                            ) : null}
                        </li>
                    ))}
                </ul>
            )}

            <Link
                href={route("shelves.show", { shelf: shelf.slug })}
                className="mt-8 inline-block text-sm underline"
            >
                {copy.announcements.backToShelf}
            </Link>
        </AppLayout>
    );
}
