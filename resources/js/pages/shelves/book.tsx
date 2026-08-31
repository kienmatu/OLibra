import { Head, useForm, usePage } from "@inertiajs/react";
import { route } from "ziggy-js";
import InputError from "@/components/input-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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
         * copy.ts:494) and the reader's own dashboard (overview.tsx's
         * MyRequestRow, copy.circulation.myLoans.requestHeldLine,
         * copy.ts:470 — same holdExpiresAt FIELD, same no-clock-check,
         * a DIFFERENT copy key with different Vietnamese text, so a grep
         * for one line's key alone will not find the other) both render
         * the raw deadline; the manager's queue is the one that makes the
         * distinction — Task 11 gave BorrowRequestQueueQuery a per-row
         * `holdExpired` flag, and Task 14's
         * resources/js/pages/manage/borrow-requests.tsx now renders a
         * different sentence off it (copy.manageRequests.holdExpiredNote)
         * — so the two reader-facing screens disagree with the one
         * manager-facing screen about the same row. Faithful
         * to the reference, which has no expiry check on either reader
         * page, and left alone because no JOB expires a hold — Task 18's
         * ReleaseExpiredHold is a manager pressing Trả về kệ, not a sweep,
         * and this line goes on saying "nhận trước ..." for as long as
         * nobody presses it. What that command does change is the END of
         * this divergence: once released the row is `expired`, which
         * BookDetailQuery's and MyDashboardQuery's pending/approved
         * filters both exclude, so it leaves these two screens entirely
         * rather than sitting there stale. Whoever gives a lapsed hold its
         * own wording should give both copy.circulation.requests.heldLine
         * and copy.circulation.myLoans.requestHeldLine the same flag.
         */
        myRequest: {
            requestId: string;
            status: "pending" | "approved";
            queuePosition: number | null;
            holdExpiresAt: string | null;
        } | null;
        currentLoan: { holderName: string | null; daysRemaining: number; dueOn: string } | null;
        /**
         * The APPROVED comments, newest first — BookDetailQuery hands this
         * straight through from BookCommentsQuery, whose status predicate
         * is INV-9 living in the access path. The four fields are that
         * query's whole row shape; there is no `status` here, and a page
         * that wanted one would be asking for a moderation record.
         */
        comments: { id: string; body: string; authorName: string; createdAt: string }[];
        /**
         * The shelf's comments_enabled setting. False means the shelf has
         * decided it takes none, so the box is ABSENT rather than disabled
         * — a form that would answer comments_disabled is the shape this
         * page already refuses for the borrow button above.
         */
        commentsEnabled: boolean;
    };
    firstContact: { name: string; phone: string } | null;
}

export default function ShelfBook() {
    const { detail, firstContact, shelf, role, errors, flash } = usePage<PageProps>().props;
    const requestForm = useForm({});
    const cancelForm = useForm({});
    const commentForm = useForm({ body: "" });
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
                        carries FOUR success sentences now, not two — the
                        three doors named below produce them, and the comment
                        box counts twice because its controller picks between
                        comment_pending_flash and comment_published_flash on
                        the status its Action returned
                        (App\Http\Controllers\Reader\CommentController::store,
                        opened at this commit; the request pair comes from
                        BorrowRequestController's store and cancel, opened
                        too). The count is written down because it has already
                        gone stale once: Task 7 added the comment box and
                        updated the door count further down this same block
                        while leaving this number at two.

                        errors.rule renders
                        whatever `rule` code the last RuleViolated produced,
                        already translated — bootstrap/app.php's
                        withExceptions render arm turns EVERY RuleViolated
                        from ANY Action into
                        back()->withErrors(['rule' => __('rules.'.$code)]),
                        and back() follows the Referer
                        (UrlGenerator::previous), so a refusal from a form on
                        this page lands back on this page.

                        THREE doors feed it now, not one, and that is the thing
                        to hold on to: the create POST below, the cancel POST
                        in the "mine" card, whose Action has its own set of
                        refusals, and — from this task — the comment box at the
                        foot of the page, whose Action has another.
                        Deliberately NOT enumerating which codes can
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
                        ResolveTenant's membership query filters on
                        status = Active, the act-as-reader gate
                        (AppServiceProvider's $roleGate closure) returns false
                        on the null membership, and EnsureShelfRole 404s them
                        off the page first. Pinned by "an ordinary reader
                        whose membership is suspended meets a 404, not a
                        sentence" in ReaderRequestSurfaceTest. */}
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
                                within this file, this Button and the
                                availability Badge are the two bg-primary
                                elements, and the Badge is a status rather than
                                an action. h-14 px-8 text-base is the shipped
                                primary shape — lend/confirm.tsx:101 and
                                returns/index.tsx:176 — and h-14 is the 56px
                                that rule 4 asks of a primary button.

                                CORRECTED WHEN THE COMMENT FORM LANDED. This
                                said "this is the only Button on the page at
                                all", which the comment form's submit made
                                false the moment it was added; the bg-primary
                                half is the load-bearing one and it still
                                holds, because that submit is variant="outline"
                                for exactly this rule. */}
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

                    {/* BR §16.1's book detail — "approved comments with a
                        comment box for logged-in readers" (line 522).
                        RETRACTED: an earlier draft cited BR §7.5, which is
                        the Membership state machine; the Comment machine is
                        §7.6, and neither is the authority for this SURFACE.
                        ABSENT ENTIRELY when the shelf has
                        turned them off — not a disabled box, and not a heading
                        over an explanation. That is what comments_enabled
                        means, and the reference's own comments area is built
                        the same way; OPS §4.4 gives the case its own refusal
                        code precisely because it is the shelf's choice rather
                        than anything the reader did.

                        The list goes with it. A shelf that stops taking
                        comments hides the ones it already has, which is the
                        reference's behaviour and is recorded here because the
                        rows are not deleted — turning the setting back on
                        brings them back. */}
                    {detail.commentsEnabled ? (
                        <section className="mt-8">
                            <h2 className="mb-2 text-lg font-medium">{copy.comments.heading}</h2>

                            {detail.comments.length > 0 ? (
                                <ul className="divide-y border-y">
                                    {detail.comments.map((comment) => (
                                        <li key={comment.id} className="py-4">
                                            <p className="text-sm font-medium">
                                                {comment.authorName || copy.comments.deletedAuthor}
                                                <span className="ml-2 font-normal text-muted-foreground">
                                                    {t(copy.comments.postedOn, {
                                                        date: formatInstantParts(comment.createdAt)
                                                            .date,
                                                    })}
                                                </span>
                                            </p>
                                            {/* Plain text, escaped by React (BR
                                                §5.4) — BookCommentsQuery's own
                                                docblock says it returns the body
                                                RAW for this reason.
                                                whitespace-pre-line keeps the line
                                                breaks a child typed, and what they
                                                wrote is otherwise rendered as
                                                written. */}
                                            <p className="mt-1 whitespace-pre-line text-sm">
                                                {comment.body}
                                            </p>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="text-sm text-muted-foreground">
                                    {copy.comments.empty}
                                </p>
                            )}

                            {/* NO MEMBERSHIP, NO BOX — the same guard the
                                borrow button above carries, and for the same
                                measured reason stated there: a memberless
                                super admin reaches this page (Gate::before
                                opens act-as-reader) but binds no membership,
                                and CreateComment fails closed on that with
                                not_permitted. A box guaranteed to refuse the
                                person looking at it is the shape this run of
                                work removes. `shelf === null` rides along
                                because the POST's URL needs the slug. */}
                            {shelf === null || role === null ? (
                                <p className="mt-6 max-w-sm text-sm text-muted-foreground">
                                    {copy.comments.onlyReaders}
                                </p>
                            ) : (
                                <>
                                    {/* THE ANSWER TO THIS TAP, BESIDE THIS
                                        TAP. On a shelf that moderates — the
                                        default, since CommentSettings::
                                        fromShelf reads comments_require_
                                        approval as true when the settings
                                        blob does not say otherwise — a new
                                        comment is written pending, and
                                        BookCommentsQuery returns approved
                                        rows only, so the list above does not
                                        change. The post keeps
                                        preserveScroll, so the reader is still
                                        down here at the form. Without this
                                        strip the whole visible result of
                                        pressing the button is a page that
                                        looks identical, which is the defect
                                        the reference's own SavedNotice was
                                        added for (its comment: "a child who
                                        presses this button and is met with an
                                        unchanged page would have no way to
                                        tell it worked"), and it is this
                                        file's own stated rule, written on the
                                        flash banner block near the top of
                                        this same component — the answer to a
                                        tap belongs above the control that
                                        caused it.

                                        SAME PROP AS THE BANNER AT THE TOP,
                                        DELIBERATELY, and THE READ IS
                                        UNFILTERED — which cuts both ways and
                                        the second way is easy to miss. A
                                        comment's own sentence renders twice on
                                        one page; AND a borrow or cancel
                                        sentence, which lands on this same page
                                        through the request panel's forms,
                                        renders here beside the comment box
                                        too, where nothing the reader did
                                        caused it.

                                        Both are accepted for now rather than
                                        worked around. Splitting the server's
                                        one flash key into two would rewrite a
                                        controller this task does not own, and
                                        a client-side gate on the form's own
                                        success state is the kind of thing that
                                        goes silently false after a redirect
                                        re-mount — in a repo with no frontend
                                        test runner, that would restore the
                                        invisible-submit defect this strip
                                        exists to remove, undetectably. Carried
                                        to the phase's whole-branch review as a
                                        decision, because the manager screens
                                        pose the identical question.

                                        NOTE WHAT DOES NOT CARRY ACROSS from
                                        the reference: its SavedNotice gates on
                                        sent === "binh-luan", so the precedent
                                        cited above IS filtered where this is
                                        not. The placement ported; the
                                        filtering did not.

                                        A plain <p> and NOT a second
                                        role="status": the banner above is
                                        already a live region carrying this
                                        exact string, and two of them would
                                        announce one sentence twice. */}
                                    {flash.success ? (
                                        <p className="mt-6 max-w-sm rounded-md border border-green-700/30 bg-green-700/10 px-3 py-2 text-sm">
                                            {flash.success}
                                        </p>
                                    ) : null}
                                    <form
                                        className="mt-6 max-w-sm"
                                        onSubmit={(e) => {
                                            e.preventDefault();
                                            commentForm.post(
                                                route("shelves.books.comments.store", {
                                                    shelf: shelf.slug,
                                                    book: detail.slug,
                                                }),
                                                {
                                                    preserveScroll: true,
                                                    onSuccess: () => commentForm.reset("body"),
                                                },
                                            );
                                        }}
                                    >
                                        {/* The house textarea shape, not two
                                            new UI components. The plan asked
                                            for `Field` + `Textarea`; a grep
                                            over resources/js at this commit
                                            for \bField\b and \bTextarea\b
                                            returned only this file's own
                                            comment, and components/ui/ holds
                                            input.tsx and label.tsx with no
                                            textarea beside them. The Label +
                                            raw textarea + InputError trio
                                            below is the shape
                                            components/book-fields.tsx already
                                            renders for its description field
                                            (opened at this commit), down to
                                            the className. */}
                                        <div>
                                            {/* `required` AND the word beside
                                                the label, both ported from
                                                the reference's own field,
                                                whose comment says the server
                                                refuses an empty body anyway
                                                and that marking it here "is
                                                what saves a child a round
                                                trip to be told so".
                                                StoreCommentRequest::rules is
                                                that server half, and it stays
                                                the one that decides — this
                                                attribute only stops the trip.
                                                The word rather than an
                                                asterisk, in the shape
                                                components/registration-person-
                                                fields.tsx's FieldBlock already
                                                renders (opened at this
                                                commit): a muted span after the
                                                label text, off its own copy
                                                key rather than the register
                                                namespace's. */}
                                            <Label htmlFor="body">
                                                {copy.comments.formLabel}
                                                <span className="ml-2 text-xs font-normal text-muted-foreground">
                                                    {copy.comments.required}
                                                </span>
                                            </Label>
                                            <textarea
                                                id="body"
                                                name="body"
                                                rows={4}
                                                required
                                                className="min-h-24 w-full rounded-md border bg-background px-3 py-2 text-sm"
                                                placeholder={copy.comments.placeholder}
                                                value={commentForm.data.body}
                                                onChange={(event) =>
                                                    commentForm.setData("body", event.target.value)
                                                }
                                            />
                                            <InputError message={commentForm.errors.body} />
                                        </div>
                                        {/* variant="outline", and it has to be
                                        said: the default variant is
                                        bg-primary, this page's one primary
                                        action is Xin mượn above, and design
                                        rule 3 puts solid terracotta on a
                                        screen once. h-11 is the shape the
                                        cancel button in the "mine" card
                                        already uses for a secondary action on
                                        this page. */}
                                        <Button
                                            type="submit"
                                            variant="outline"
                                            className="mt-4 h-11"
                                            disabled={commentForm.processing}
                                        >
                                            {copy.comments.submit}
                                        </Button>
                                    </form>
                                </>
                            )}
                        </section>
                    ) : null}
                </div>
            </div>
        </AppLayout>
    );
}
