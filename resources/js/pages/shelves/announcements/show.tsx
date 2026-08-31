import { Head, Link, usePage } from "@inertiajs/react";
import { route } from "ziggy-js";
import { Badge } from "@/components/ui/badge";
import AppLayout from "@/layouts/app-layout";
import { copy, t } from "@/lib/copy";
import { formatInstantParts } from "@/lib/dates";
import type { SharedData } from "@/types";

/**
 * One notice, in full — OPS §3.2's GetAnnouncementDetail.
 *
 * **The body is rendered as TEXT, in a `whitespace-pre-line` block, never
 * as markup.** The column is described as rich in the schema, and a
 * manager's typing turned into HTML would be an injection surface on a
 * page every family in the parish opens. Line breaks survive because of
 * that class; when a rich editor lands it brings its own sanitiser and its
 * own argument.
 *
 * **This page never asks whether the notice may be shown.** A draft, a
 * lapsed notice, a slug naming nothing and a neighbouring shelf's slug all
 * end at AnnouncementController::show's 404, so anything that reaches this
 * component is a notice this reader may read.
 */
interface AnnouncementDetail {
    id: string;
    slug: string;
    title: string;
    body: string;
    isPinned: boolean;
    publishedAt: string | null;
}

interface PageProps extends SharedData {
    announcement: AnnouncementDetail;
}

export default function ShelfAnnouncementShow() {
    const { shelf, announcement } = usePage<PageProps>().props;
    if (!shelf) return null;

    return (
        <AppLayout>
            <Head title={announcement.title} />

            {announcement.isPinned ? (
                <Badge variant="secondary" className="mb-3">
                    {copy.announcements.pinned}
                </Badge>
            ) : null}

            <h1 className="text-2xl leading-snug font-semibold">{announcement.title}</h1>

            {announcement.publishedAt ? (
                <p className="mt-2 text-sm text-muted-foreground">
                    {t(copy.announcements.publishedOn, {
                        date: formatInstantParts(announcement.publishedAt).date,
                    })}
                </p>
            ) : null}

            <div className="mt-6 text-base leading-relaxed whitespace-pre-line">
                {announcement.body}
            </div>

            <Link
                href={route("shelves.announcements", { shelf: shelf.slug })}
                className="mt-10 inline-block text-sm underline"
            >
                {copy.announcements.backToList}
            </Link>
        </AppLayout>
    );
}
