import { Head, Link, useForm, usePage } from "@inertiajs/react";
import { route } from "ziggy-js";
import { Button } from "@/components/ui/button";
import AppLayout from "@/layouts/app-layout";
import { copy, t } from "@/lib/copy";
import { formatInstantParts } from "@/lib/dates";
import type { SharedData } from "@/types";

/**
 * BR §15's bell, as its own page — the header link's destination.
 *
 * **Every sentence here is the server's.** `sentence` arrives rendered by
 * NotificationSentences from the stored payload; `kind` rides along but is
 * NEVER shown, because a raw `request_approved` on a child's screen is a
 * failure, not a fallback. This page knows no notification kinds at all.
 *
 * **Read, never deleted.** Marking one read leaves the row in the list,
 * because the row is the record that they were told.
 */
interface NotificationRow {
    id: string;
    kind: string;
    sentence: string;
    createdAt: string;
    readAt: string | null;
}

interface PageProps extends SharedData {
    mine: { rows: NotificationRow[]; unread: number };
}

/**
 * One button, one `useForm`. Not one form hoisted to the page with the id
 * in its state: a row's id is read from `row` at submit time, so there is
 * no stored value that can outlive the row it named (Task 15's finding),
 * and `processing` disables only the button that was tapped.
 */
function MarkOneButton({
    shelfSlug,
    notificationId,
}: {
    shelfSlug: string;
    notificationId: string;
}) {
    const form = useForm({});

    return (
        <form
            onSubmit={(e) => {
                e.preventDefault();
                form.post(
                    route("shelves.profile.notifications.read", {
                        shelf: shelfSlug,
                        notification: notificationId,
                    }),
                    { preserveScroll: true },
                );
            }}
        >
            <Button type="submit" variant="ghost" size="sm" disabled={form.processing}>
                {copy.notifications.markOne}
            </Button>
        </form>
    );
}

function MarkAllButton({ shelfSlug }: { shelfSlug: string }) {
    const form = useForm({});

    return (
        <form
            onSubmit={(e) => {
                e.preventDefault();
                form.post(route("shelves.profile.notifications.read-all", { shelf: shelfSlug }), {
                    preserveScroll: true,
                });
            }}
            className="shrink-0"
        >
            <Button type="submit" variant="outline" size="sm" disabled={form.processing}>
                {copy.notifications.markAll}
            </Button>
        </form>
    );
}

export default function ProfileNotifications() {
    const { mine, errors, shelf } = usePage<PageProps>().props;
    if (!shelf) return null;

    return (
        <AppLayout>
            <Head title={copy.notifications.title} />

            <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-semibold">{copy.notifications.title}</h1>
                    <p className="text-sm text-muted-foreground">
                        {mine.unread === 0
                            ? copy.notifications.allRead
                            : t(copy.notifications.unreadCount, { count: mine.unread })}
                    </p>
                </div>
                {mine.unread > 0 ? <MarkAllButton shelfSlug={shelf.slug} /> : null}
            </div>

            {/*
             * bootstrap/app.php turns every RuleViolated into
             * back()->withErrors(['rule' => …]), and back() follows the
             * Referer — so a refusal raised by an action posted FROM this
             * page lands here. Outside the list, so it is not attached to
             * a row that may no longer be the one it concerned.
             */}
            {errors.rule ? (
                <p
                    role="alert"
                    className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm"
                >
                    {errors.rule}
                </p>
            ) : null}

            {mine.rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">{copy.notifications.empty}</p>
            ) : (
                <ul className="divide-y border-y">
                    {mine.rows.map((n) => {
                        const when = formatInstantParts(n.createdAt);
                        return (
                            <li
                                key={n.id}
                                /*
                                 * Unread carries a tint AND the word "Mới" —
                                 * AGENTS.md's second non-negotiable: status is
                                 * never colour alone.
                                 */
                                className={n.readAt ? "px-3 py-3" : "bg-accent/40 px-3 py-3"}
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <p className="min-w-0 flex-1 text-sm leading-snug">
                                        {n.sentence}
                                    </p>
                                    {n.readAt ? null : (
                                        <span className="shrink-0 text-xs font-semibold">
                                            {copy.notifications.newBadge}
                                        </span>
                                    )}
                                </div>
                                <div className="mt-2 flex items-center justify-between gap-3">
                                    <span className="text-sm text-muted-foreground">
                                        {t(copy.notifications.receivedAt, when)}
                                    </span>
                                    {n.readAt ? null : (
                                        <MarkOneButton
                                            shelfSlug={shelf.slug}
                                            notificationId={n.id}
                                        />
                                    )}
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}

            <Link
                href={route("shelves.profile.overview", { shelf: shelf.slug })}
                className="mt-6 inline-block text-sm underline"
            >
                {copy.notifications.backToOverview}
            </Link>
        </AppLayout>
    );
}
