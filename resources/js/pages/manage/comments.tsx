import { Head, Link, useForm, usePage } from "@inertiajs/react";
import type { FormEvent } from "react";
import { route } from "ziggy-js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import ManageLayout from "@/layouts/manage-layout";
import { copy, t } from "@/lib/copy";
import { formatInstantParts } from "@/lib/dates";
import type { SharedData } from "@/types";

/**
 * BR §16.3's moderation screen. The server decides which single list this
 * renders (CommentModerationController::index reads `?status=`), so
 * nothing on this page re-derives a status from the rows it was handed.
 *
 * NO <table> ANYWHERE, so AGENTS.md rule 5 ("tables become stacked cards
 * below 768px; never a horizontally scrolling table") is satisfied by
 * construction rather than by a breakpoint: the queue is a column of
 * cards and the archive is a column of list rows, both of which stack at
 * every width. The action row inside a card wraps rather than scrolls.
 *
 * WHAT IS UNPINNED HERE, said plainly. Nothing in this repo renders a
 * React component under test: checked while writing this line — there is
 * no *.test.* or *.spec.* file anywhere under resources/, no vitest or
 * jest config outside old_next/, the root package.json's only `test`
 * script is `cd old_next && vitest run`, and no testing-library or DOM
 * environment is a dependency. assertInertia checks server-side props
 * only, and Phase 1d measured what that costs: swapping two stat cards'
 * values left every test and every gate green.
 *
 * So four properties of this file are checked by reading it — which chip
 * is highlighted, that Ẩn appears on the approved archive, that the
 * rejected and hidden archives render their rows without a button, and
 * that the reject field error renders inside the row whose form produced
 * it. ManagerModerationScreenTest pins the props and the redirects
 * underneath them, and reaches none of the four.
 */

/** One row of CommentModerationQuery's list — the server shape, key for key. */
interface ModeratedComment {
    id: string;
    body: string;
    /**
     * MAY BE THE EMPTY STRING, not absent: the query reads
     * `author?->full_name` and the reference inner-joins, so a
     * soft-deleted author leaves "" behind rather than dropping the row.
     * Same for `title` and a soft-deleted book.
     */
    authorName: string;
    createdAt: string;
    bookId: string;
    title: string;
}

type Status = keyof typeof copy.manageComments.titles;

interface PageProps extends SharedData {
    status: Status;
    counts: Record<Status, number>;
    comments: ModeratedComment[];
}

const NUMBER = new Intl.NumberFormat("vi-VN");

const STATUSES = ["pending", "approved", "rejected", "hidden"] as const;

/** The Vietnamese initial is the LAST word of a name — the given name. */
function initialOf(name: string): string {
    return (name.split(" ").at(-1) ?? "").charAt(0);
}

/**
 * A trashed author or book leaves an empty string on the row (see
 * ModeratedComment.authorName). A gap there reads as a broken page; a
 * Vietnamese sentence reads as what it is, and the row keeps its buttons
 * because the comment is still the shelf's to decide.
 */
function nameOr(value: string, fallback: string): string {
    return value === "" ? fallback : value;
}

/** *Duyệt bình luận* — bodiless, the way its route is. */
function ApproveForm({ shelfSlug, commentId }: { shelfSlug: string; commentId: string }) {
    const form = useForm({});

    const submit = (event: FormEvent) => {
        event.preventDefault();
        form.post(
            route("shelves.manage.comments.approve", { shelf: shelfSlug, comment: commentId }),
            { preserveScroll: true },
        );
    };

    return (
        <form onSubmit={submit}>
            {/* The screen's one solid button (AGENTS.md rule 3), h-14 =
                design rule 4's 56px. */}
            <Button type="submit" className="h-14 px-6 text-base" disabled={form.processing}>
                {copy.manageComments.approveButton}
            </Button>
        </form>
    );
}

/**
 * The reject disclosure, one per row, with its required reason.
 *
 * A <details> rather than an always-open box: on a queue of a dozen
 * comments, a dozen open text fields bury the decision being read. The
 * <summary> gets the button shape by hand — it is not a <button>, so the
 * Button component's classes cannot be handed to it. Both points are
 * manage/borrow-requests.tsx's RejectDisclosure, which this row follows.
 */
function RejectDisclosure({ shelfSlug, commentId }: { shelfSlug: string; commentId: string }) {
    const form = useForm<{ reason: string }>({ reason: "" });

    const submit = (event: FormEvent) => {
        event.preventDefault();
        form.post(
            route("shelves.manage.comments.reject", { shelf: shelfSlug, comment: commentId }),
            { preserveScroll: true },
        );
    };

    return (
        <details className="min-w-0">
            <summary className="inline-flex h-11 cursor-pointer list-none items-center justify-center rounded-md border border-input px-4 text-sm font-medium hover:bg-accent [&::-webkit-details-marker]:hidden">
                {copy.manageComments.rejectSummary}
            </summary>
            <form onSubmit={submit} className="mt-3 w-full max-w-md space-y-2">
                <Label htmlFor={`reason-${commentId}`}>
                    {copy.manageComments.rejectReasonLabel}
                    <span className="ml-2 font-normal text-muted-foreground">
                        {copy.manageComments.required}
                    </span>
                </Label>
                <Input
                    id={`reason-${commentId}`}
                    value={form.data.reason}
                    onChange={(e) => form.setData("reason", e.target.value)}
                />
                <p className="text-sm text-muted-foreground">
                    {copy.manageComments.rejectReasonHint}
                </p>
                {/* THIS row's field error, in THIS row. `reason` is
                    required and capped at 500, so an empty or overlong box
                    is a field error rather than a page-level refusal;
                    rendered at the top of the page it would land rows away
                    from the <details> the volunteer has open, and every
                    form here posts preserveScroll, so nothing would carry
                    them to it. The 2a whole-branch review moved field
                    errors out of a page head for exactly this reason.
                    useForm scopes these to this row's own visit; the
                    page-level bag still carries `rule`. */}
                {form.errors.reason ? (
                    <p role="alert" className="text-sm text-destructive">
                        {form.errors.reason}
                    </p>
                ) : null}
                <Button type="submit" variant="outline" className="h-11" disabled={form.processing}>
                    {copy.manageComments.rejectConfirm}
                </Button>
            </form>
        </details>
    );
}

/** *Ẩn bình luận* — offered on the approved archive and nowhere else. */
function HideForm({ shelfSlug, commentId }: { shelfSlug: string; commentId: string }) {
    const form = useForm({});

    const submit = (event: FormEvent) => {
        event.preventDefault();
        form.post(route("shelves.manage.comments.hide", { shelf: shelfSlug, comment: commentId }), {
            preserveScroll: true,
        });
    };

    return (
        <form onSubmit={submit} className="shrink-0">
            <Button type="submit" variant="outline" className="h-11" disabled={form.processing}>
                {copy.manageComments.hideButton}
            </Button>
        </form>
    );
}

export default function ManageComments() {
    const { shelf, status, counts, comments, errors, flash } = usePage<PageProps>().props;
    if (!shelf) return null;

    const listHref = (target: Status) =>
        route("shelves.manage.comments", { shelf: shelf.slug, status: target });

    return (
        <ManageLayout>
            {/* The screen's name, not the filter's — a browser tab names a
                screen, and this one has four views. */}
            <Head title={copy.manageComments.tab} />
            <h1 className="text-2xl font-semibold">{copy.manageComments.titles[status]}</h1>
            <p className="mb-4 text-sm text-muted-foreground">
                {counts.pending === 0
                    ? copy.manageComments.subtitle
                    : t(copy.manageComments.subtitleCounted, {
                          count: NUMBER.format(counts.pending),
                      })}
            </p>

            {flash.success ? (
                <p
                    role="status"
                    className="mb-4 rounded-md border border-green-700/30 bg-green-700/10 px-3 py-2 text-sm"
                >
                    {flash.success}
                </p>
            ) : null}
            {/* The page-level bag, by construction: bootstrap/app.php turns
                a RuleViolated from any Action into
                back()->withErrors(['rule' => …]) and back() follows the
                Referer, so a refusal from a form on this page lands here
                already translated. `reason` is deliberately NOT rendered
                up here — it belongs in the row that produced it. */}
            {errors.rule ? (
                <p
                    role="alert"
                    className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm"
                >
                    {errors.rule}
                </p>
            ) : null}

            {/* FOUR CHIPS AND NO "TẤT CẢ", the reference's own decision:
                the four statuses partition the table, and there is no
                query here that reads them combined. Every number comes
                from the server's counts() — one grouped statement — never
                from `comments.length`, which is capped on the three
                archives and would understate all of them. */}
            <div className="mb-6 flex flex-wrap gap-2">
                {STATUSES.map((chip) => (
                    <Link
                        key={chip}
                        href={listHref(chip)}
                        aria-current={status === chip ? "page" : undefined}
                        className={`rounded-full border px-3 py-1 text-sm ${status === chip ? "bg-foreground text-background" : ""}`}
                    >
                        {t(copy.manageComments.chipCount, {
                            label: copy.manageComments.chips[chip],
                            count: NUMBER.format(counts[chip]),
                        })}
                    </Link>
                ))}
            </div>

            {comments.length === 0 ? (
                <p className="text-sm text-muted-foreground">{copy.manageComments.empty}</p>
            ) : null}

            {status === "pending" ? (
                <div className="space-y-4">
                    {comments.map((comment) => (
                        <article key={comment.id} className="space-y-5 rounded-lg border p-5">
                            <p className="text-sm text-muted-foreground">
                                {copy.manageComments.aboutBook}{" "}
                                {/* Serif is for a book's title and nothing
                                    else (AGENTS.md rule 1). */}
                                <span className="font-serif text-base text-foreground">
                                    {nameOr(comment.title, copy.manageComments.deletedBook)}
                                </span>
                            </p>

                            <div className="flex items-center gap-3">
                                <span
                                    aria-hidden
                                    className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold"
                                >
                                    {initialOf(
                                        nameOr(
                                            comment.authorName,
                                            copy.manageComments.deletedAuthor,
                                        ),
                                    )}
                                </span>
                                <div className="min-w-0">
                                    <p className="text-base font-medium">
                                        {nameOr(
                                            comment.authorName,
                                            copy.manageComments.deletedAuthor,
                                        )}
                                    </p>
                                    <p className="text-sm text-muted-foreground">
                                        {t(
                                            copy.manageComments.postedAt,
                                            formatInstantParts(comment.createdAt),
                                        )}
                                    </p>
                                </div>
                            </div>

                            {/* Plain text, escaped by React (BR §5.4).
                                CommentModerationQuery returns the body raw
                                on purpose — stripping tags there would
                                silently rewrite what a child wrote — and
                                whitespace-pre-line keeps the line breaks
                                they typed. */}
                            <p className="whitespace-pre-line text-base leading-relaxed">
                                {comment.body}
                            </p>

                            <div className="flex flex-wrap items-start gap-3 border-t pt-4">
                                <ApproveForm shelfSlug={shelf.slug} commentId={comment.id} />
                                <RejectDisclosure shelfSlug={shelf.slug} commentId={comment.id} />
                            </div>
                        </article>
                    ))}
                </div>
            ) : (
                <ul className="divide-y rounded-md border">
                    {comments.map((comment) => (
                        <li
                            key={comment.id}
                            className="flex flex-wrap items-center gap-3 px-4 py-3"
                        >
                            <div className="min-w-0 flex-1">
                                <p className="text-sm">
                                    <span className="font-medium">
                                        {nameOr(
                                            comment.authorName,
                                            copy.manageComments.deletedAuthor,
                                        )}
                                    </span>{" "}
                                    <span className="font-serif text-muted-foreground">
                                        {nameOr(comment.title, copy.manageComments.deletedBook)}
                                    </span>
                                </p>
                                <p className="line-clamp-2 text-sm text-muted-foreground">
                                    {comment.body}
                                </p>
                            </div>
                            {/* ONLY the approved archive offers this.
                                HideComment refuses a row that is not
                                approved, and neither RejectComment nor
                                HideComment accepts a rejected or hidden
                                one — so those two lists carry no button,
                                because there is no command for one to post
                                to. */}
                            {status === "approved" ? (
                                <HideForm shelfSlug={shelf.slug} commentId={comment.id} />
                            ) : null}
                        </li>
                    ))}
                </ul>
            )}

            {status === "rejected" || status === "hidden" ? (
                <p className="mt-4 text-sm text-muted-foreground">
                    {copy.manageComments.readOnlyNote}
                </p>
            ) : null}
        </ManageLayout>
    );
}
