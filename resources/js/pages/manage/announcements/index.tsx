import { Head, Link, useForm, usePage } from "@inertiajs/react";
import type { FormEvent } from "react";
import { route } from "ziggy-js";
import InputError from "@/components/input-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import ManageLayout from "@/layouts/manage-layout";
import { copy, t } from "@/lib/copy";
import { formatInstantParts } from "@/lib/dates";
import type { SharedData } from "@/types";

/**
 * BR §16.1's bulletin, for the person who writes it.
 *
 * **The chip's word comes from the server.** `state` arrives on every row
 * from AnnouncementsQuery::managed(), which labels it through the one helper
 * Task 12 built so that the manager's chip and the reader's filter are the
 * same comparison. Working it out here from `publishedAt` and `expiresAt`
 * against a `new Date()` would be the third clock that query's docblock
 * names: a lapsed notice would drop off the reader's page while this screen
 * still read *Đang hiện*, with nothing able to move either.
 *
 * **This page sorts nothing.** The rows arrive pinned-first and recent-next
 * from `managed()`, and are rendered in the order they arrive.
 *
 * **Đăng lại always posts the expiry box, even when it is empty**, and that
 * is App\Actions\Community\PublishAnnouncement's rule surfacing rather than
 * a markup choice: that command refuses a second publication only when NO
 * expiry was supplied, and a lapsed notice is still a published one. A
 * button posting an empty body would therefore be dead for every manager who
 * did not type a date. An empty box arrives as a present null (Laravel's
 * ConvertEmptyStringsToNull), which the controller renames to a present
 * `expiresAt`, which the command reads as a supply and writes as a cleared
 * column.
 *
 * **Đăng ngay carries the same box.** The reference offers it bare on a
 * draft, but a draft that was scheduled forward still has a published_at,
 * and this way the one form covers every row the button appears on.
 *
 * **KNOWN BLIND SPOT**, measured in this worktree rather than assumed:
 * `find resources/js \( -name '*.test.*' -o -name '*.spec.*' \)` printed
 * nothing, `ls vitest.config.*` at the repo root matched nothing, and
 * package.json's `test` script reads `cd old_next && vitest run`. So which
 * buttons a row carries and which chip it shows go unread by any runner and
 * are checked by reading. What the suite does pin is the props
 * this page is handed — see
 * tests/Feature/Community/ManagerAnnouncementsScreenTest.php.
 */
type AnnouncementState = "showing" | "draft" | "expired";

interface AnnouncementRow {
    id: string;
    slug: string;
    title: string;
    excerpt: string;
    isPinned: boolean;
    publishedAt: string | null;
    expiresAt: string | null;
    state: AnnouncementState;
}

interface PageProps extends SharedData {
    announcements: AnnouncementRow[];
}

/**
 * One bodiless POST as a one-button form — the shape manage/comments.tsx's
 * ApproveForm uses, and for the same reason: Ẩn, Ghim and Bỏ ghim post no
 * fields, only the announcement named in the URL.
 */
function ActionButton({ href, label }: { href: string; label: string }) {
    const form = useForm({});

    const submit = (event: FormEvent) => {
        event.preventDefault();
        form.post(href, { preserveScroll: true });
    };

    return (
        <form onSubmit={submit}>
            <Button type="submit" variant="outline" className="h-11" disabled={form.processing}>
                {label}
            </Button>
        </form>
    );
}

/**
 * *Đăng ngay* / *Đăng lại*, with the expiry box the command's refusal rests
 * on. A <details> rather than an always-open box: a bulletin of a dozen
 * notices would otherwise carry a dozen open date fields, and the date is
 * the exception rather than the usual answer.
 */
function PublishDisclosure({
    announcement,
    shelfSlug,
}: {
    announcement: AnnouncementRow;
    shelfSlug: string;
}) {
    const form = useForm<{ expires_at: string }>({ expires_at: "" });
    const label =
        announcement.state === "draft"
            ? copy.manageAnnouncements.publishNow
            : copy.manageAnnouncements.publishAgain;

    const submit = (event: FormEvent) => {
        event.preventDefault();
        form.post(
            route("shelves.manage.announcements.publish", {
                shelf: shelfSlug,
                announcement: announcement.id,
            }),
            { preserveScroll: true },
        );
    };

    return (
        <details className="min-w-0">
            {/* The <summary> gets the button shape by hand — it is not a
                <button>, so the Button component's classes cannot be handed
                to it. manage/comments.tsx's RejectDisclosure is the same
                shape. h-11 = 44px, design rule 4's floor. */}
            <summary className="inline-flex h-11 cursor-pointer list-none items-center justify-center rounded-md border border-input px-4 text-sm font-medium hover:bg-accent [&::-webkit-details-marker]:hidden">
                {label}
            </summary>
            <form onSubmit={submit} className="mt-3 w-full max-w-md space-y-2">
                <Label htmlFor={`publish-expires-${announcement.id}`}>
                    {copy.manageAnnouncements.fields.expiresAt}
                </Label>
                <Input
                    id={`publish-expires-${announcement.id}`}
                    type="date"
                    value={form.data.expires_at}
                    onChange={(event) => form.setData("expires_at", event.target.value)}
                />
                <p className="text-sm text-muted-foreground">
                    {copy.manageAnnouncements.expiresHint}
                </p>
                {/* THIS row's field error, in THIS row: every form on this
                    page posts preserveScroll, so an error rendered at the top
                    would land rows away from the box that caused it. */}
                <InputError message={form.errors.expires_at} />
                {/* The solid one in this row — AGENTS.md rule 3 read the way
                    a per-row list can honour it: the publish decision is the
                    primary one, and Ẩn / Ghim / Sửa beside it are outlines.
                    h-14 = 56px, design rule 4's primary size. */}
                <Button type="submit" className="h-14 px-6 text-base" disabled={form.processing}>
                    {label}
                </Button>
            </form>
        </details>
    );
}

export default function ManageAnnouncements() {
    const { shelf, announcements, errors: pageErrors } = usePage<PageProps>().props;
    if (!shelf) return null;

    return (
        <ManageLayout>
            <Head title={copy.manageAnnouncements.title} />

            <div className="flex flex-wrap items-center justify-between gap-4">
                <h1 className="text-2xl font-semibold">{copy.manageAnnouncements.title}</h1>
                <Link
                    href={route("shelves.manage.announcements.create", { shelf: shelf.slug })}
                    className="inline-flex h-14 items-center justify-center rounded-md bg-primary px-6 text-base font-medium text-primary-foreground"
                >
                    {copy.manageAnnouncements.compose}
                </Link>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
                {copy.manageAnnouncements.subtitle}
            </p>

            {/* A business refusal (already_published) arrives through the
                shared errors prop under `rule`, not as a field error. */}
            <InputError message={pageErrors.rule} />

            {announcements.length === 0 ? (
                <p className="mt-6 text-sm text-muted-foreground">
                    {copy.manageAnnouncements.empty}
                </p>
            ) : (
                <ul className="mt-6 space-y-4">
                    {announcements.map((a) => (
                        <li key={a.id} className="rounded-lg border p-4">
                            <div className="flex flex-wrap items-center gap-2">
                                {/* The WORD, never a tint alone (AGENTS.md
                                    rule 2), and the word is the server's. */}
                                <Badge variant="outline">
                                    {copy.manageAnnouncements.state[a.state]}
                                </Badge>
                                {a.isPinned ? (
                                    <Badge variant="secondary">
                                        {copy.manageAnnouncements.pinnedBadge}
                                    </Badge>
                                ) : null}
                            </div>

                            <h2 className="mt-3 text-base leading-snug font-semibold">{a.title}</h2>
                            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                                {a.excerpt}
                            </p>
                            <p className="mt-3 text-xs text-muted-foreground">
                                {a.publishedAt
                                    ? t(copy.manageAnnouncements.publishedOn, {
                                          date: formatInstantParts(a.publishedAt).date,
                                      })
                                    : copy.manageAnnouncements.notPublished}
                                {a.expiresAt
                                    ? ` · ${t(copy.manageAnnouncements.expiresOn, {
                                          date: formatInstantParts(a.expiresAt).date,
                                      })}`
                                    : ""}
                            </p>

                            <div className="mt-4 flex flex-wrap items-start gap-3 border-t pt-4">
                                <PublishDisclosure announcement={a} shelfSlug={shelf.slug} />

                                {/* Ẩn only where there is something showing to
                                    pull: HideAnnouncement nulls published_at,
                                    and a draft's is already null. */}
                                {a.state === "showing" ? (
                                    <ActionButton
                                        href={route("shelves.manage.announcements.hide", {
                                            shelf: shelf.slug,
                                            announcement: a.id,
                                        })}
                                        label={copy.manageAnnouncements.hide}
                                    />
                                ) : null}

                                {/* Ghim / Bỏ ghim on any row, whatever its
                                    state: is_pinned is a separate column from
                                    published_at, and a draft pinned today is a
                                    draft that opens the bulletin the day it is
                                    posted. */}
                                <ActionButton
                                    href={
                                        a.isPinned
                                            ? route("shelves.manage.announcements.unpin", {
                                                  shelf: shelf.slug,
                                                  announcement: a.id,
                                              })
                                            : route("shelves.manage.announcements.pin", {
                                                  shelf: shelf.slug,
                                                  announcement: a.id,
                                              })
                                    }
                                    label={
                                        a.isPinned
                                            ? copy.manageAnnouncements.unpin
                                            : copy.manageAnnouncements.pin
                                    }
                                />

                                <Link
                                    href={route("shelves.manage.announcements.edit", {
                                        shelf: shelf.slug,
                                        announcement: a.id,
                                    })}
                                    className="inline-flex h-11 items-center justify-center rounded-md border border-input px-4 text-sm font-medium hover:bg-accent"
                                >
                                    {copy.manageAnnouncements.edit}
                                </Link>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </ManageLayout>
    );
}
