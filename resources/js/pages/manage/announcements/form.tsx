import { Head, Link, useForm, usePage } from "@inertiajs/react";
import type { FormEvent } from "react";
import { route } from "ziggy-js";
import InputError from "@/components/input-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import ManageLayout from "@/layouts/manage-layout";
import { copy } from "@/lib/copy";
import type { SharedData } from "@/types";

/**
 * One form, two routes: the compose screen (`announcement` is null) and the
 * edit screen (it is the row being edited). A second component for the edit
 * case would be a second place "what a notice is made of" is written down,
 * and the two would drift a field at a time.
 *
 * **Single column, labels above inputs, the word Bắt buộc rather than an
 * asterisk, one solid button** — AGENTS.md rules 6 and 3.
 *
 * **No publish control here, deliberately.** The compose form sends no
 * published_at, so a new notice is a draft and showing it to the parish is
 * always the list's own *Đăng ngay* — a visible second decision rather than
 * a side effect of typing. The reference makes the same choice; its create
 * button reads "Lưu nháp". Pinning is likewise the list's own button on the
 * edit path, because the edit command takes no is_pinned; on the compose
 * path there is no row yet to press a button on, so this form's own checkbox
 * is where pinning is chosen, and StoreAnnouncementRequest validates the
 * field for it.
 *
 * **An empty expiry box is an ANSWER, not a blank.** On the edit path it
 * arrives at the server as a present null, which the controller renames into
 * a present `expiresAt` and the command writes as a cleared column — "this
 * notice no longer expires". That is why the hint says so in words.
 *
 * **KNOWN BLIND SPOT**, measured in this worktree rather than assumed:
 * `find resources/js \( -name '*.test.*' -o -name '*.spec.*' \)` printed
 * nothing, `ls vitest.config.*` at the repo root matched nothing, and
 * package.json's `test` script reads `cd old_next && vitest run`. So that
 * *Bắt buộc* renders beside the two required fields, and that one button on
 * this screen is solid, go unread by any runner and are checked by reading. What the suite pins is the props this page is handed and what
 * its two submissions do — see
 * tests/Feature/Community/ManagerAnnouncementsScreenTest.php.
 */
interface AnnouncementRow {
    id: string;
    title: string;
    body: string;
    isPinned: boolean;
    expiresAt: string | null;
    state: "showing" | "draft" | "expired";
}

interface PageProps extends SharedData {
    announcement: AnnouncementRow | null;
}

interface AnnouncementForm {
    title: string;
    body: string;
    expires_at: string;
    is_pinned: boolean;
}

/**
 * An ISO instant to what `<input type="date">` takes, which is `yyyy-mm-dd`
 * by the HTML spec — a wire value the browser renders in the reader's own
 * locale, not a formatted date, which is why this is a string slice and not
 * a call into lib/dates.ts (whose two exports both produce Vietnamese
 * display text).
 *
 * A slice rather than a Date, so nothing here can shift a day across a
 * timezone. What it returns is the UTC calendar day of the stored instant,
 * and every expiry this screen writes is midnight UTC — the controller
 * parses the box's own `yyyy-mm-dd` — so for anything typed here the box
 * comes back holding exactly what was typed.
 */
function dateInputValue(iso: string | null): string {
    return iso === null ? "" : iso.slice(0, 10);
}

export default function ManageAnnouncementForm() {
    const { shelf, announcement, errors: pageErrors } = usePage<PageProps>().props;
    const form = useForm<AnnouncementForm>({
        title: announcement?.title ?? "",
        body: announcement?.body ?? "",
        expires_at: dateInputValue(announcement?.expiresAt ?? null),
        is_pinned: announcement?.isPinned ?? false,
    });
    if (!shelf) return null;

    const heading = announcement
        ? copy.manageAnnouncements.editTitle
        : copy.manageAnnouncements.composeTitle;

    const submit = (event: FormEvent) => {
        event.preventDefault();
        if (announcement) {
            // is_pinned is dropped on the edit path: UpdateAnnouncement takes
            // no such key, and pinning an existing notice is the list's own
            // button. expires_at stays in, empty or not — its PRESENCE is
            // what the command reads as "the manager decided the expiry".
            form.transform(({ title, body, expires_at }) => ({ title, body, expires_at }));
            form.patch(
                route("shelves.manage.announcements.update", {
                    shelf: shelf.slug,
                    announcement: announcement.id,
                }),
            );

            return;
        }

        form.transform((data) => data);
        form.post(route("shelves.manage.announcements.store", { shelf: shelf.slug }));
    };

    return (
        <ManageLayout>
            <Head title={heading} />
            <h1 className="mb-4 text-2xl font-semibold">{heading}</h1>

            {/* A business refusal (announcement_fields_required,
                announcement_slug_taken) arrives through the shared errors
                prop under `rule`, not as a field error. */}
            <InputError message={pageErrors.rule} />

            <form onSubmit={submit} className="max-w-xl space-y-4">
                <div>
                    <Label htmlFor="title">
                        {copy.manageAnnouncements.fields.title}
                        <span className="ml-2 font-normal text-muted-foreground">
                            {copy.manageAnnouncements.required}
                        </span>
                    </Label>
                    <Input
                        id="title"
                        value={form.data.title}
                        onChange={(event) => form.setData("title", event.target.value)}
                    />
                    <InputError message={form.errors.title} />
                </div>

                <div>
                    <Label htmlFor="body">
                        {copy.manageAnnouncements.fields.body}
                        <span className="ml-2 font-normal text-muted-foreground">
                            {copy.manageAnnouncements.required}
                        </span>
                    </Label>
                    <textarea
                        id="body"
                        rows={8}
                        className="min-h-40 w-full rounded-md border bg-background px-3 py-2 text-sm"
                        value={form.data.body}
                        onChange={(event) => form.setData("body", event.target.value)}
                    />
                    <InputError message={form.errors.body} />
                </div>

                <div>
                    <Label htmlFor="expires_at">{copy.manageAnnouncements.fields.expiresAt}</Label>
                    <Input
                        id="expires_at"
                        type="date"
                        value={form.data.expires_at}
                        onChange={(event) => form.setData("expires_at", event.target.value)}
                    />
                    <p className="mt-1 text-sm text-muted-foreground">
                        {copy.manageAnnouncements.expiresHint}
                    </p>
                    <InputError message={form.errors.expires_at} />
                </div>

                {announcement ? null : (
                    <label className="flex items-center gap-2 text-sm">
                        <input
                            type="checkbox"
                            checked={form.data.is_pinned}
                            onChange={(event) => form.setData("is_pinned", event.target.checked)}
                        />
                        {copy.manageAnnouncements.fields.pinned}
                    </label>
                )}

                {/* The one solid action on this screen — AGENTS.md rule 3.
                    h-14 = 56px, design rule 4's primary size. */}
                <Button type="submit" className="h-14 px-6 text-base" disabled={form.processing}>
                    {form.processing
                        ? copy.manageAnnouncements.saving
                        : copy.manageAnnouncements.save}
                </Button>
            </form>

            <Link
                href={route("shelves.manage.announcements.index", { shelf: shelf.slug })}
                className="mt-8 inline-block text-sm underline"
            >
                {copy.manageAnnouncements.backToList}
            </Link>
        </ManageLayout>
    );
}
