import { Head, useForm, usePage } from "@inertiajs/react";
import type { FormEvent, ReactNode } from "react";
import { route } from "ziggy-js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import ManageLayout from "@/layouts/manage-layout";
import { copy, t } from "@/lib/copy";
import { formatInstantParts } from "@/lib/dates";
import type { SharedData } from "@/types";

/**
 * One row of BorrowRequestQueueQuery::run()'s `requests` list — the
 * server shape, key for key (app/Queries/BorrowRequestQueueQuery.php).
 */
interface QueuedRequest {
    requestId: string;
    /**
     * THE MANAGER'S NUMBER, and it is not the reader's. This window
     * partitions over pending AND approved rows, while the reader's own
     * book page and dashboard count pending rows only — so for a title
     * with one live hold, the first pending row is "2" here and "vị trí
     * 1" on the child's phone. Documented on all three sides rather than
     * reconciled (the query's own ROW_NUMBER comment carries the long
     * form); whoever unifies them changes the query, not this file.
     */
    position: number;
    membershipId: string | null;
    readerUserId: string;
    readerName: string;
    /** May be empty — a member with no parish unit is a permanent, legitimate state (BR §5.6). */
    parishLine: string;
    requestedAt: string;
    status: "pending" | "approved";
    copyId: string | null;
    copyCode: string | null;
    holdExpiresAt: string | null;
    /**
     * BR §8, derived by the query against the injected clock — never a
     * `new Date()` comparison written here, which would be a second
     * definition of "expired" in a second language, one of them running
     * off the browser's clock.
     */
    holdExpired: boolean;
}

interface BookQueue {
    bookId: string;
    title: string;
    author: string | null;
    slug: string;
    coverUrl: string | null;
    waiting: number;
    holdDays: number;
    freeCopies: { copyId: string; code: string }[];
    requests: QueuedRequest[];
}

interface PageProps extends SharedData {
    queues: BookQueue[];
}

const NUMBER = new Intl.NumberFormat("vi-VN");

/** The Vietnamese initial is the LAST word of a name — the given name. */
function initialOf(name: string): string {
    return (name.split(" ").at(-1) ?? "").charAt(0);
}

/**
 * What a held row says beneath itself: which copy is put aside, until
 * when, and — once the clock has passed it — that the hold has lapsed.
 * The `Bare` variants exist because hold_expires_at is nullable: an
 * approved row whose expiry was cleared still has to say something.
 */
function holdNoteFor(entry: QueuedRequest): string {
    const parts = entry.holdExpiresAt ? formatInstantParts(entry.holdExpiresAt) : null;
    const head = entry.holdExpired
        ? parts
            ? t(copy.manageRequests.holdExpiredNote, parts)
            : copy.manageRequests.holdExpiredBare
        : parts
          ? t(copy.manageRequests.holdNote, parts)
          : copy.manageRequests.holdNoteBare;

    return entry.copyCode
        ? [head, t(copy.manageRequests.copySuffix, { code: entry.copyCode })].join(" · ")
        : head;
}

/**
 * The reject disclosure, one per row, with its optional reason.
 *
 * A <details> rather than an always-open field: on a queue of a dozen
 * rows, a dozen open text boxes bury the decision that matters. The
 * <summary> gets the button shape by hand — it is not a <button>, so the
 * Button component's classes cannot be handed to it.
 */
function RejectDisclosure({ shelfSlug, requestId }: { shelfSlug: string; requestId: string }) {
    const form = useForm<{ reason: string }>({ reason: "" });

    const submit = (event: FormEvent) => {
        event.preventDefault();
        form.post(
            route("shelves.manage.borrow-requests.reject", {
                shelf: shelfSlug,
                borrowRequest: requestId,
            }),
            { preserveScroll: true },
        );
    };

    return (
        <details className="min-w-0">
            <summary className="inline-flex h-11 cursor-pointer list-none items-center justify-center rounded-md border border-input px-4 text-sm font-medium hover:bg-accent [&::-webkit-details-marker]:hidden">
                {copy.manageRequests.rejectSummary}
            </summary>
            <form onSubmit={submit} className="mt-3 w-full max-w-md space-y-2">
                <Label htmlFor={`reason-${requestId}`}>
                    {copy.manageRequests.rejectReasonLabel}
                </Label>
                <Input
                    id={`reason-${requestId}`}
                    value={form.data.reason}
                    onChange={(e) => form.setData("reason", e.target.value)}
                />
                <p className="text-sm text-muted-foreground">
                    {copy.manageRequests.rejectReasonHint}
                </p>
                <Button type="submit" variant="outline" className="h-11" disabled={form.processing}>
                    {copy.manageRequests.rejectConfirm}
                </Button>
            </form>
        </details>
    );
}

/** *Duyệt & giữ chỗ*, with the copy the manager is putting aside. */
function ApproveForm({
    shelfSlug,
    queue,
    requestId,
}: {
    shelfSlug: string;
    queue: BookQueue;
    requestId: string;
}) {
    const free = queue.freeCopies;
    // The first free copy is the default, and "" when there is none —
    // which the disabled button below never posts. The server refuses it
    // anyway: copy_id is required|uuid, so an empty box is a field error
    // rather than an errno 1267 on an ascii_bin column.
    const form = useForm<{ copy_id: string }>({ copy_id: free[0]?.copyId ?? "" });

    const submit = (event: FormEvent) => {
        event.preventDefault();
        form.post(
            route("shelves.manage.borrow-requests.approve", {
                shelf: shelfSlug,
                borrowRequest: requestId,
            }),
            { preserveScroll: true },
        );
    };

    return (
        <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
            {/* One copy: no select at all, because a list of one is a
                decision the volunteer does not have. Several: a select,
                because BR §16.3 gives the manager the choice and a shelf's
                copies are in different conditions. None: nothing to choose
                and a disabled button, so the refusal arrives before the
                confirm step rather than after it. */}
            {free.length > 1 ? (
                <label className="text-sm text-muted-foreground" htmlFor={`copy-${requestId}`}>
                    {copy.manageRequests.copyLabel}
                    <select
                        id={`copy-${requestId}`}
                        name="copy_id"
                        className="mt-1 block h-11 rounded-md border border-input bg-background px-2 text-sm text-foreground"
                        value={form.data.copy_id}
                        onChange={(e) => form.setData("copy_id", e.target.value)}
                    >
                        {free.map((c) => (
                            <option key={c.copyId} value={c.copyId}>
                                {c.code}
                            </option>
                        ))}
                    </select>
                </label>
            ) : null}
            {/* Outline, not solid: the one dominant action on this triage
                page is confirming a handover whose hold is already
                running (design rule 3). */}
            <Button
                type="submit"
                variant="outline"
                className="h-11"
                disabled={free.length === 0 || form.processing}
            >
                {copy.manageRequests.approveButton}
            </Button>
        </form>
    );
}

/** The one solid button on this page. */
function HandoverForm({ shelfSlug, requestId }: { shelfSlug: string; requestId: string }) {
    const form = useForm({});

    const submit = (event: FormEvent) => {
        event.preventDefault();
        form.post(
            route("shelves.manage.borrow-requests.handover", {
                shelf: shelfSlug,
                borrowRequest: requestId,
            }),
            { preserveScroll: true },
        );
    };

    return (
        <form onSubmit={submit}>
            {/* A LAPSED HOLD KEEPS ITS BUTTON. HandoverRequest refuses it
                with "Thời gian giữ chỗ đã hết. Bạn đọc cần đăng ký lại.",
                which tells the volunteer what to do; a missing button
                tells them nothing. h-14 is design rule 4's 56px. */}
            <Button type="submit" className="h-14 px-6 text-base" disabled={form.processing}>
                {copy.manageRequests.handoverButton}
            </Button>
        </form>
    );
}

function QueueRow({
    entry,
    note,
    children,
}: {
    entry: QueuedRequest;
    note: string;
    children: ReactNode;
}) {
    const requested = formatInstantParts(entry.requestedAt);
    const requestedLine = t(copy.manageRequests.requestedLine, requested);

    return (
        <li className="py-4">
            <div className="flex flex-wrap items-center gap-4">
                <span
                    aria-hidden
                    className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-base font-semibold"
                >
                    {NUMBER.format(entry.position)}
                </span>
                <span
                    aria-hidden
                    className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold"
                >
                    {initialOf(entry.readerName)}
                </span>
                <div className="min-w-0 flex-1">
                    <p className="text-base font-medium">{entry.readerName}</p>
                    <p className="text-sm text-muted-foreground">
                        {entry.parishLine
                            ? [requestedLine, entry.parishLine].join(" · ")
                            : requestedLine}
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">{children}</div>
            </div>
            <p className="mt-2 text-sm text-muted-foreground sm:pl-[7rem]">{note}</p>
        </li>
    );
}

export default function ManageBorrowRequests() {
    const { shelf, queues, errors, flash } = usePage<PageProps>().props;
    if (!shelf) return null;

    const waiting = queues.reduce((n, q) => n + q.waiting, 0);

    return (
        <ManageLayout>
            <Head title={copy.manageRequests.title} />
            <h1 className="text-2xl font-semibold">{copy.manageRequests.title}</h1>
            <p className="mb-4 text-sm text-muted-foreground">
                {queues.length === 0
                    ? copy.manageRequests.subtitle
                    : t(copy.manageRequests.subtitleCounted, {
                          count: NUMBER.format(queues.length),
                      })}
            </p>

            {/* The answer to a tap, above the controls that caused it.
                errors.rule renders whatever code the last RuleViolated
                produced, already translated: bootstrap/app.php turns EVERY
                RuleViolated from ANY Action into
                back()->withErrors(['rule' => …]) and back() follows the
                Referer, so a refusal from any form on this page lands
                back here. Which codes those are is deliberately not
                written down, and neither is how many forms feed it: each
                form on this page posts to an Action of its own, every one
                of them free to grow a refusal, and Task 18 adds another
                button to this same page. This phase has already published
                five enumerations that turned out to be wrong. */}
            {flash.success ? (
                <p
                    role="status"
                    className="mb-4 rounded-md border border-green-700/30 bg-green-700/10 px-3 py-2 text-sm"
                >
                    {flash.success}
                </p>
            ) : null}
            {errors.rule ? (
                <p
                    role="alert"
                    className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm"
                >
                    {errors.rule}
                </p>
            ) : null}
            {errors.copy_id ? (
                <p
                    role="alert"
                    className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm"
                >
                    {errors.copy_id}
                </p>
            ) : null}
            {errors.reason ? (
                <p
                    role="alert"
                    className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm"
                >
                    {errors.reason}
                </p>
            ) : null}

            {queues.length === 0 ? (
                <p className="text-sm text-muted-foreground">{copy.manageRequests.empty}</p>
            ) : null}

            <div className="space-y-6">
                {queues.map((queue) => {
                    // The row whose turn it actually is. `index === 0`
                    // would be wrong once a hold exists: BR §7.2's approved
                    // row sits at the top of the card as position 1, and
                    // the pending row behind it is still the next decision
                    // a manager makes. (The reference spells this
                    // `index === 0` while its own comment argues for the
                    // first PENDING row; the comment is what shipped here.)
                    const firstPending = queue.requests.findIndex((r) => r.status === "pending");

                    return (
                        <article key={queue.bookId} className="rounded-lg border p-5">
                            {/* NO COVER, unlike the reference's card, and
                                that is this side's idiom rather than an
                                oversight: every manage page already carries
                                coverUrl in its props type and none of them
                                renders it (lend/index, lend/confirm,
                                lend/reader, lend/new-reader — grepped), and
                                a cover here would also be the fourth
                                lint/performance/noImgElement warning in
                                resources/js, a budget this branch holds at
                                three. The title is the identifier on a
                                triage screen. Whoever wants covers on the
                                manage side should add the BookCover
                                component AGENTS.md's table names — missing
                                on this side — and migrate the two existing
                                <img> sites onto it in the same change. */}
                            <div className="flex flex-wrap items-center gap-4">
                                <div className="min-w-0 flex-1">
                                    <p className="font-serif text-lg leading-snug">{queue.title}</p>
                                    {queue.author ? (
                                        <p className="text-sm text-muted-foreground">
                                            {queue.author}
                                        </p>
                                    ) : null}
                                </div>
                                <p className="text-sm text-muted-foreground">
                                    {t(copy.manageRequests.waitingCount, {
                                        count: NUMBER.format(queue.waiting),
                                    })}
                                </p>
                            </div>

                            <ul className="mt-2 divide-y border-t">
                                {queue.requests.map((entry, index) =>
                                    entry.status === "approved" ? (
                                        <QueueRow
                                            key={entry.requestId}
                                            entry={entry}
                                            note={holdNoteFor(entry)}
                                        >
                                            <HandoverForm
                                                shelfSlug={shelf.slug}
                                                requestId={entry.requestId}
                                            />
                                        </QueueRow>
                                    ) : (
                                        <QueueRow
                                            key={entry.requestId}
                                            entry={entry}
                                            note={
                                                index === firstPending
                                                    ? t(copy.manageRequests.firstPendingNote, {
                                                          days: NUMBER.format(queue.holdDays),
                                                      })
                                                    : copy.manageRequests.notYourTurnNote
                                            }
                                        >
                                            {index === firstPending ? (
                                                // KEYED ON THE COPY LIST, so
                                                // that a reload which changes
                                                // the free copies remounts the
                                                // form instead of leaving
                                                // useForm's initial copy_id
                                                // pointing at a copy somebody
                                                // else has since been given.
                                                // The refusal that would
                                                // otherwise arrive is
                                                // copy_not_available — a
                                                // sentence, not a wrong write —
                                                // but it is a sentence about a
                                                // choice the volunteer never
                                                // made.
                                                <ApproveForm
                                                    key={queue.freeCopies
                                                        .map((c) => c.copyId)
                                                        .join("|")}
                                                    shelfSlug={shelf.slug}
                                                    queue={queue}
                                                    requestId={entry.requestId}
                                                />
                                            ) : null}
                                            <RejectDisclosure
                                                shelfSlug={shelf.slug}
                                                requestId={entry.requestId}
                                            />
                                        </QueueRow>
                                    ),
                                )}
                            </ul>

                            {queue.freeCopies.length === 0 ? (
                                <p className="pt-3 text-sm text-muted-foreground">
                                    {copy.manageRequests.noFreeCopies}
                                </p>
                            ) : null}
                        </article>
                    );
                })}
            </div>

            {waiting > 0 ? (
                <p className="mt-6 text-sm text-muted-foreground">
                    {copy.manageRequests.nothingAutomatic}
                </p>
            ) : null}
        </ManageLayout>
    );
}
