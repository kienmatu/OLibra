import { Head, Link, router, usePage } from "@inertiajs/react";
import { route } from "ziggy-js";
import InputError from "@/components/input-error";
import { Button } from "@/components/ui/button";
import AdminLayout from "@/layouts/admin-layout";
import { copy, t } from "@/lib/copy";
import { formatInstantParts } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { SharedData } from "@/types";

/**
 * BR §16.1's Góp ý inbox — the screen a table that has been writable since
 * Phase 2b has been waiting for. Port of
 * old_next/src/app/quan-tri/gop-y/page.tsx.
 *
 * A LIST AND A DETAIL ON ONE PAGE, NOT TWO ROUTES, and the two arrive in one
 * server read (App\Queries\Admin\FeedbackInboxQuery::run inside a single
 * transaction) so the panes cannot disagree about what is unread.
 *
 * OPENING A MESSAGE DOES NOT MARK IT READ. Selecting a row is a GET carrying
 * `?message=`; marking is the *Đánh dấu đã đọc* button below, which POSTs and
 * writes its own audit row. Anything else would have made the button
 * meaningless and filled the log with a row per glance.
 *
 * THE CONTACT NUMBER IS IN THE DETAIL PANE AND NOWHERE ELSE — the server does
 * not even send it with the list rows. A list is scanned, often over
 * somebody's shoulder on a shared parish device, and the number is needed at
 * the moment the administrator decides to reply and not before.
 *
 * THE TYPED NAME AND THE ACCOUNT ARE TWO LINES, NEVER ONE. `senderName` is
 * always what was typed into "Tên của bạn", even when the sender was signed
 * in; the account, when there was one, is its own sentence underneath. The
 * reference's QA round records what folding them cost: a reader who typed
 * "Chị Hạnh" displayed as "Quản trị viên", their account's own label, and the
 * administrator rang the wrong person.
 *
 * THE LIST IS PAGED, 25 A PAGE, and the detail pane is NOT bound to the page:
 * `?message=` is fetched by id, so a link kept from an older page still opens
 * its message with the first page of the list beside it. Paging forward drops
 * the selection deliberately — the message it named is not on the new page,
 * and the server opens the top of that page instead.
 *
 * A NULL SHELF READS AS "Toàn hệ thống". A message from the public contact
 * page belongs to no parish, and a blank where every other row names one
 * reads as a record with something missing.
 *
 * NO *Lưu trữ* BUTTON. The product owner removed the fourth control in the
 * reference on 2026-08-09 and spec D8 keeps it out here: `feedback_status` has
 * exactly three values and the table has no `deleted_at`, so a fourth status
 * and a soft delete are different products nothing chose between. *Đã xử lý*
 * is the end of the line.
 */

interface MessageRow {
    feedbackId: string;
    /** What was typed into "Tên của bạn" — never the account's own name. */
    senderName: string;
    /** The signed-in account, as its own fact. Null for a genuine guest. */
    accountName: string | null;
    subject: string;
    status: string;
    isUnread: boolean;
    submittedAt: string;
    /** Null is site-wide, rendered as "Toàn hệ thống" and never as blank. */
    shelfName: string | null;
}

interface MessageDetail extends MessageRow {
    body: string;
    /**
     * THE DETAIL PANE'S ALONE — the server omits it from every list row, so
     * a component that tried to show it there would have nothing to show.
     */
    senderContact: string | null;
    handledAt: string | null;
    handledByName: string | null;
}

interface PageProps extends SharedData {
    messages: MessageRow[];
    open: MessageDetail | null;
    unread: number;
    /**
     * The NARROWED filter, not the raw query parameter — the server sends
     * back null for anything outside the three statuses, so an unrecognised
     * `?status=` lights the *Tất cả* chip over the list it actually shows.
     */
    filter: string | null;
    /**
     * The list is PAGED, 25 a page. Feedback is the one table whose row
     * volume an unauthenticated outsider chooses — neither feedback route
     * carries a request throttle — so an unbounded list here is an
     * unbounded read on every load of this screen.
     */
    page: number;
    pageCount: number;
    total: number;
}

const FILTERS = [
    { key: "new", label: copy.adminFeedback.filterNew },
    { key: "read", label: copy.adminFeedback.filterRead },
    { key: "resolved", label: copy.adminFeedback.filterResolved },
] as const;

/**
 * The meta line's parts, joined. A helper rather than JSX text nodes because
 * Biome's noJsxLiterals bans a bare separator between two expressions — and
 * because a null part (a guest with no contact number on file) has to
 * disappear WITH its separator rather than leave a stray dot behind.
 */
function meta(parts: (string | null)[]): string {
    return parts.filter((part): part is string => Boolean(part)).join(" · ");
}

function when(iso: string): string {
    const parts = formatInstantParts(iso);

    return `${parts.date} ${parts.time}`;
}

export default function AdminFeedback() {
    const {
        messages,
        open,
        unread,
        filter,
        page,
        pageCount,
        total,
        errors: pageErrors,
        flash,
    } = usePage<PageProps>().props;
    const c = copy.adminFeedback;

    // All three parameters travel together: choosing a message must not drop
    // the filter or the page it was chosen on, and changing the filter must
    // not carry a selection the new list may not contain.
    //
    // THE PAGE IS INHERITED, NEVER THE SELECTION. A row on page 3 links to
    // itself with `page=3`, so the list under the open message is still the
    // one the reader was looking at; the filter chips pass `page: 1`
    // explicitly, because page 3 of *Mới* is a different list from page 3 of
    // *Tất cả* and landing on it empty reads as "no messages".
    const href = (next: { status?: string | null; message?: string; page?: number }) => {
        const params: Record<string, string | number> = {};
        const status = next.status === undefined ? filter : next.status;
        const wanted = next.page === undefined ? page : next.page;

        if (status) params.status = status;
        if (next.message) params.message = next.message;
        if (wanted > 1) params.page = wanted;

        return route("admin.feedback", params);
    };

    const handle = (action: "read" | "resolve", feedbackId: string) => {
        router.post(
            route(`admin.feedback.${action}`, { feedback: feedbackId }),
            {},
            { preserveScroll: true },
        );
    };

    return (
        <AdminLayout>
            <Head title={c.title} />
            <div className="flex flex-col gap-6 md:flex-row md:items-start">
                <aside className="md:w-[340px] md:shrink-0">
                    <h2 className="text-xl font-semibold">{c.title}</h2>
                    <p className="text-sm text-muted-foreground">
                        {unread === 0 ? c.unreadNone : t(c.unreadSome, { count: unread })}
                    </p>

                    {/* No counts on the chips: a count per status is three more
                        queries for a number nobody acts on, and the one count
                        that matters — unread — is on the line above and in the
                        shell's badge, both from the same predicate. */}
                    <nav className="mt-4 flex flex-wrap gap-2">
                        <Link
                            href={href({ status: null, page: 1 })}
                            className={cn(
                                "rounded-md border px-3 py-1 text-sm",
                                filter === null && "bg-accent font-medium",
                            )}
                        >
                            {c.filterAll}
                        </Link>
                        {FILTERS.map((f) => (
                            <Link
                                key={f.key}
                                href={href({ status: f.key, page: 1 })}
                                className={cn(
                                    "rounded-md border px-3 py-1 text-sm",
                                    filter === f.key && "bg-accent font-medium",
                                )}
                            >
                                {f.label}
                            </Link>
                        ))}
                    </nav>

                    {messages.length === 0 ? (
                        <p className="mt-4 text-sm text-muted-foreground">{c.empty}</p>
                    ) : (
                        <ul className="mt-4 divide-y rounded-md border">
                            {messages.map((m) => (
                                <li key={m.feedbackId}>
                                    <Link
                                        href={href({ message: m.feedbackId })}
                                        className={cn(
                                            "block px-4 py-3",
                                            m.feedbackId === open?.feedbackId && "bg-accent",
                                        )}
                                    >
                                        <p className="truncate text-sm font-medium">
                                            {/* A guest gives a name and nothing
                                                else identifies them; empty would
                                                render a blank clickable line. */}
                                            {m.senderName || c.guestSender}
                                            {m.isUnread ? ` · ${c.unreadBadge}` : ""}
                                        </p>
                                        <p className="truncate text-sm">
                                            {m.subject || c.noSubject}
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                            {meta([m.shelfName ?? c.siteWide, when(m.submittedAt)])}
                                        </p>
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    )}

                    {/* Only when there is more than one page: on the
                        inbox a parish actually has, this whole block is
                        absent rather than showing "Trang 1 / 1". */}
                    {pageCount > 1 && (
                        <div className="mt-4 flex flex-wrap items-center gap-3">
                            {page > 1 && (
                                <Link href={href({ page: page - 1 })} className="text-sm underline">
                                    {c.prevPage}
                                </Link>
                            )}
                            {page < pageCount && (
                                <Link href={href({ page: page + 1 })} className="text-sm underline">
                                    {c.nextPage}
                                </Link>
                            )}
                            <p className="text-sm text-muted-foreground">
                                {t(c.pageOf, { page, pageCount, total })}
                            </p>
                        </div>
                    )}
                </aside>

                <main className="flex-1">
                    {/* Both writes redirect back to this same message with
                        their own sentence, and the list reorders underneath
                        them (unread first), so the flash is the only thing
                        saying which button took effect. role="status" tells a
                        screen reader without stealing focus from the control
                        just pressed. */}
                    {flash.success ? (
                        <p
                            role="status"
                            className="mb-4 rounded-md border border-green-700/30 bg-green-700/10 px-3 py-2 text-sm"
                        >
                            {flash.success}
                        </p>
                    ) : null}

                    {/* The page-level bag. bootstrap/app.php turns a
                        RuleViolated from any Action into
                        back()->withErrors(['rule' => …]); neither of this
                        screen's two commands raises one today, and the bag is
                        read anyway because the alternative is a screen that
                        goes mute the first time one does. Read under a local
                        name — the shape /admin/settings and /admin/categories
                        both use. */}
                    <InputError message={pageErrors.rule} />

                    {open === null ? (
                        <p className="text-sm text-muted-foreground">{c.choose}</p>
                    ) : (
                        <article>
                            <h3 className="text-lg font-semibold">
                                {open.subject || c.noSubject}
                                {open.isUnread ? ` · ${c.unreadBadge}` : ""}
                            </h3>

                            <p className="mt-1 text-sm text-muted-foreground">
                                {meta([
                                    open.senderName || c.guestSender,
                                    // THE NUMBER, and the one place on the
                                    // whole screen it appears — the server
                                    // does not send it with the list rows at
                                    // all.
                                    open.senderContact,
                                    when(open.submittedAt),
                                    open.shelfName ?? c.siteWide,
                                ])}
                            </p>

                            {/* The account, kept visible rather than hidden by
                                the fix that made the typed name win — whenever
                                the message was sent while signed in, whether
                                or not the two happen to match. */}
                            {open.accountName ? (
                                <p className="mt-1 text-sm text-muted-foreground">
                                    {t(c.sentWhileSignedIn, { name: open.accountName })}
                                </p>
                            ) : null}

                            {/* Plain text, never markup: the author may be a
                                stranger with no account at all. */}
                            <p className="mt-6 max-w-2xl text-sm whitespace-pre-line">
                                {open.body}
                            </p>

                            <p className="mt-6 text-sm text-muted-foreground">{c.replyNote}</p>

                            {open.handledAt ? (
                                <p className="mt-2 text-sm text-muted-foreground">
                                    {t(c.handledBy, {
                                        name: open.handledByName ?? c.handledByUnknown,
                                        at: when(open.handledAt),
                                    })}
                                </p>
                            ) : null}

                            <div className="mt-6 flex flex-wrap items-center gap-3 border-t pt-6">
                                {/* ONE PRIMARY ACTION (AGENTS.md rule 3): the
                                    solid button is resolving, which is the end
                                    of the line; marking read is the quiet one
                                    beside it. Each control is hidden once its
                                    status is reached — a button whose only
                                    outcome is to rewrite the row with what it
                                    already says is not a control. */}
                                {open.status === "resolved" ? null : (
                                    <Button
                                        type="button"
                                        onClick={() => handle("resolve", open.feedbackId)}
                                    >
                                        {c.markResolved}
                                    </Button>
                                )}
                                {open.isUnread ? (
                                    <Button
                                        type="button"
                                        variant="outline"
                                        onClick={() => handle("read", open.feedbackId)}
                                    >
                                        {c.markRead}
                                    </Button>
                                ) : null}
                            </div>
                        </article>
                    )}
                </main>
            </div>
        </AdminLayout>
    );
}
