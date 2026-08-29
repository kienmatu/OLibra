import { Head, useForm, usePage } from "@inertiajs/react";
import { route } from "ziggy-js";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import AppLayout from "@/layouts/app-layout";
import { copy, t } from "@/lib/copy";
import { formatInstantParts } from "@/lib/dates";
import type { SharedData } from "@/types";

interface PageProps extends SharedData {
    detail: {
        bookId: string;
        slug: string;
        title: string;
        author: string | null;
        coverUrl: string | null;
        category: string | null;
        copiesTotal: number;
        copiesAvailable: number;
        availability: keyof typeof copy.catalogue.state;
        publisher: string | null;
        publishedYear: number | null;
        pageCount: number | null;
        isbn: string | null;
        description: string | null;
        onLoan: number;
        queueLength: number;
        /**
         * The VIEWER's own live request for this title, or null — mirrors
         * BookDetailQuery's myRequest key exactly. The two nullable fields
         * are complementary by construction: the query derives
         * queuePosition only for a pending row (null for an approved one),
         * and hold_expires_at is only ever written in the same ->update()
         * that sets status to approved — ApproveBorrowRequest:156-162 and
         * ReceiveReturn:246-252, the column's only two writers under app/
         * (grepped). An approved row whose hold has been cleared is what
         * heldLineNoDate covers.
         *
         * DIVERGENCE, recorded rather than fixed (review round 1, item 5;
         * widened to a third screen, Task 13 fix round 1, item 2; the two
         * keys named explicitly, Task 13 fix round 2, the one clause):
         * holdExpiresAt is rendered as a deadline with NO comparison
         * against the clock, so an approved request whose hold lapsed
         * yesterday still reads "nhận trước ...". THREE screens carry this
         * same row: this page (copy.circulation.requests.heldLine,
         * copy.ts:460) and the reader's own dashboard (overview.tsx's
         * MyRequestRow, copy.circulation.myLoans.requestHeldLine,
         * copy.ts:436 — same holdExpiresAt FIELD, same no-clock-check,
         * a DIFFERENT copy key with different Vietnamese text, so a grep
         * for one line's key alone will not find the other) both render
         * the raw deadline; the manager's queue is the one that makes the
         * distinction — Task 11 gave BorrowRequestQueueQuery a per-row
         * `holdExpired` flag — so the two reader-facing screens disagree
         * with the one manager-facing screen about the same row. Faithful
         * to the reference, which has no expiry check on either reader
         * page, and left alone because expiring a hold is a sweep nothing
         * in 2a runs; whoever adds that sweep should give both
         * copy.circulation.requests.heldLine and
         * copy.circulation.myLoans.requestHeldLine the same flag.
         */
        myRequest: {
            requestId: string;
            status: "pending" | "approved";
            queuePosition: number | null;
            holdExpiresAt: string | null;
        } | null;
        currentLoan: { holderName: string | null; daysRemaining: number; dueOn: string } | null;
    };
    firstContact: { name: string; phone: string } | null;
}

export default function ShelfBook() {
    const { detail, firstContact, shelf, role, errors, flash } = usePage<PageProps>().props;
    const requestForm = useForm({});
    const cancelForm = useForm({});
    // Narrowed once, so the JSX below and the cancel POST read the same
    // non-null row rather than re-checking it inside a callback.
    const mine = detail.myRequest;

    const holderLine = detail.currentLoan
        ? detail.currentLoan.holderName === null
            ? t(copy.catalogue.holderLineAnonymous, {
                  days: Math.abs(detail.currentLoan.daysRemaining),
              })
            : detail.currentLoan.daysRemaining >= 0
              ? t(copy.catalogue.holderLine, {
                    name: detail.currentLoan.holderName,
                    days: detail.currentLoan.daysRemaining,
                })
              : t(copy.catalogue.holderLineOverdue, {
                    name: detail.currentLoan.holderName,
                    days: Math.abs(detail.currentLoan.daysRemaining),
                })
        : null;

    const metadata: [string, string | null][] = [
        [copy.catalogue.author, detail.author],
        [copy.catalogue.category, detail.category],
        [copy.catalogue.publisher, detail.publisher],
        [copy.catalogue.publishedYear, detail.publishedYear?.toString() ?? null],
        [copy.catalogue.pageCount, detail.pageCount?.toString() ?? null],
        [copy.catalogue.isbn, detail.isbn],
    ];

    return (
        <AppLayout>
            <Head title={detail.title} />
            <div className="flex flex-col gap-6 md:flex-row">
                <div className="w-40 shrink-0">
                    <div className="aspect-[3/4] overflow-hidden rounded bg-muted">
                        {detail.coverUrl ? (
                            <img
                                src={detail.coverUrl}
                                alt={detail.title}
                                className="h-full w-full object-cover"
                            />
                        ) : null}
                    </div>
                </div>
                <div className="flex-1">
                    <h1 className="text-2xl font-semibold">{detail.title}</h1>
                    {detail.author ? (
                        <p className="text-muted-foreground">{detail.author}</p>
                    ) : null}

                    <div className="mt-4 space-y-2 rounded-md border p-4">
                        <Badge
                            variant={detail.availability === "available" ? "default" : "outline"}
                        >
                            {copy.catalogue.state[detail.availability]}
                        </Badge>
                        <p className="text-sm text-muted-foreground">
                            {t(copy.catalogue.copyCountLine, {
                                available: detail.copiesAvailable,
                                onLoan: detail.onLoan,
                                total: detail.copiesTotal,
                            })}
                        </p>
                        {holderLine ? (
                            <p className="text-sm text-muted-foreground">{holderLine}</p>
                        ) : null}
                        {detail.queueLength > 0 ? (
                            <p className="text-sm text-muted-foreground">
                                {t(copy.catalogue.queueLine, { count: detail.queueLength })}
                            </p>
                        ) : null}
                        <p className="text-sm text-muted-foreground">
                            {copy.readerCatalogue.borrowSoon}
                        </p>
                        {firstContact ? (
                            <p className="text-sm">
                                {t(copy.catalogue.contactBefore, { name: firstContact.name })}
                                <a
                                    href={`tel:${firstContact.phone}`}
                                    className="font-medium underline"
                                >
                                    {firstContact.phone}
                                </a>
                                {copy.catalogue.contactAfter}
                            </p>
                        ) : null}
                    </div>

                    {/* The answer to a tap belongs ABOVE the control that
                        caused it (the reference's placement). flash.success
                        carries the two success flashes; errors.rule renders
                        whatever `rule` code the last RuleViolated produced,
                        already translated — bootstrap/app.php:93 turns EVERY
                        RuleViolated from ANY Action into
                        back()->withErrors(['rule' => __('rules.'.$code)]),
                        and back() follows the Referer
                        (UrlGenerator::previous), so a refusal from a form on
                        this page lands back on this page.

                        TWO doors feed it, not one, and that is the thing to
                        hold on to: the create POST below AND the cancel POST
                        in the "mine" card, whose Action has its own set of
                        refusals. Deliberately NOT enumerating which codes can
                        arrive — three drafts of this comment tried, and all
                        three were wrong, first by naming a code that cannot
                        reach here and then by missing two that can. The
                        renderer is generic and every future Action that
                        throws through it invalidates such a list silently, so
                        the banner is written to display whatever it is given.

                        The one code-level fact kept is the NEGATIVE one that
                        has a test behind it:
                        membership_not_active_cannot_request cannot land here,
                        though the reference's twin comment says it can,
                        because that caller never reaches an Action —
                        ResolveTenant:67 filters memberships on status =
                        Active, the act-as-reader gate
                        (AppServiceProvider:147-179) returns false on the null
                        membership, and EnsureShelfRole 404s them off the page
                        first. Pinned by "an ordinary reader whose membership
                        is suspended meets a 404, not a sentence" in
                        ReaderRequestSurfaceTest. */}
                    {flash.success ? (
                        <p
                            role="status"
                            className="mt-6 max-w-sm rounded-md border border-green-700/30 bg-green-700/10 px-3 py-2 text-sm"
                        >
                            {flash.success}
                        </p>
                    ) : null}
                    {errors.rule ? (
                        <p
                            role="alert"
                            className="mt-6 max-w-sm rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm"
                        >
                            {errors.rule}
                        </p>
                    ) : null}

                    {/* A request in flight REPLACES the button rather than
                        sitting beside it: pressing twice is duplicate_request,
                        a refusal the reader can do nothing with. And two
                        labels, one command — CreateBorrowRequest reads no
                        book_copies at all, so joining a queue and collecting a
                        free copy are the same write; only the wording moves.

                        `role === null` hides the control entirely, the
                        reference's `membershipId === null` guard (sach/[slug]
                        :549). That viewer is a memberless super admin —
                        Gate::before opens act-as-reader for them, so they
                        reach this page, but ResolveTenant binds no membership
                        and CreateBorrowRequest would refuse them
                        not_permitted. A button that is going to say no is the
                        shape this run of work removes, and hiding it does not
                        strand the refusal: the banner above still renders
                        not_permitted for a super admin who posts the URL
                        directly or whose membership went away between render
                        and tap, and renders duplicate_request — the code an
                        ordinary reader actually causes — either way. */}
                    {shelf === null || role === null ? null : mine ? (
                        <div className="mt-6 max-w-sm rounded-md border p-4">
                            <p className="text-sm font-medium">
                                {mine.queuePosition !== null
                                    ? t(copy.circulation.requests.waitingLine, {
                                          position: mine.queuePosition,
                                      })
                                    : mine.holdExpiresAt
                                      ? t(copy.circulation.requests.heldLine, {
                                            ...formatInstantParts(mine.holdExpiresAt),
                                        })
                                      : copy.circulation.requests.heldLineNoDate}
                            </p>
                            <form
                                className="mt-3"
                                onSubmit={(e) => {
                                    e.preventDefault();
                                    cancelForm.post(
                                        route("shelves.profile.requests.cancel", {
                                            shelf: shelf.slug,
                                            borrowRequest: mine.requestId,
                                        }),
                                        { preserveScroll: true },
                                    );
                                }}
                            >
                                <Button
                                    type="submit"
                                    variant="outline"
                                    className="h-11"
                                    disabled={cancelForm.processing}
                                >
                                    {copy.circulation.requests.cancelButton}
                                </Button>
                            </form>
                        </div>
                    ) : (
                        <form
                            className="mt-6"
                            onSubmit={(e) => {
                                e.preventDefault();
                                requestForm.post(
                                    route("shelves.books.request", {
                                        shelf: shelf.slug,
                                        book: detail.slug,
                                    }),
                                    { preserveScroll: true },
                                );
                            }}
                        >
                            {/* The page's one primary action (design rule 3):
                                this is the only Button on the page at all, and
                                the only other bg-primary element is the
                                availability Badge, which is a status, not an
                                action. h-14 px-8 text-base is the shipped
                                primary shape — lend/confirm.tsx:101 and
                                returns/index.tsx:176 — and h-14 is the 56px
                                that rule 4 asks of a primary button. */}
                            <Button
                                type="submit"
                                className="h-14 px-8 text-base"
                                disabled={requestForm.processing}
                            >
                                {detail.copiesAvailable > 0
                                    ? copy.circulation.requests.requestButton
                                    : copy.circulation.requests.queueButton}
                            </Button>
                        </form>
                    )}

                    <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                        {metadata
                            .filter(([, value]) => value !== null && value !== "")
                            .map(([label, value]) => (
                                <div key={label}>
                                    <dt className="text-muted-foreground">{label}</dt>
                                    <dd>{value}</dd>
                                </div>
                            ))}
                    </dl>

                    {detail.description ? (
                        <section className="mt-6">
                            <h2 className="mb-2 text-lg font-medium">
                                {copy.catalogue.description}
                            </h2>
                            <p className="whitespace-pre-line text-sm">{detail.description}</p>
                        </section>
                    ) : null}
                </div>
            </div>
        </AppLayout>
    );
}
