import { Head, useForm, usePage } from "@inertiajs/react";
import { Clock } from "lucide-react";
import type { FormEvent } from "react";
import { route } from "ziggy-js";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import ManageLayout from "@/layouts/manage-layout";
import { copy, t } from "@/lib/copy";
import { formatInstantParts } from "@/lib/dates";
import type { SharedData } from "@/types";

/**
 * BR §16.3's Donation queue. Pending offers, oldest first, and the two
 * decisions a volunteer makes on each — the port of
 * old_next/src/app/tu-sach/[shelf]/quan-ly/tang-sach/page.tsx (opened).
 *
 * *DUYỆT* DOES NOT OPEN THE ADD-BOOK FORM HERE, and that is the one thing
 * about this screen worth knowing before reading it. BR §16.3 describes
 * the button as opening that form with **Người tặng** pre-filled; the
 * pre-fill needs a member picker docs/known-gaps.md defers. So the POST
 * lands back on this queue and the success flash carries the donor's
 * NAME, which is the shape resources/js/pages/manage/books/create.tsx
 * already takes (a `donor_name` field; opened). The full argument, and
 * the note for whoever builds the pre-fill, is in
 * App\Http\Controllers\Manage\DonationController's docblock.
 *
 * NO <table> ANYWHERE, so AGENTS.md rule 5 is satisfied by construction
 * rather than by a breakpoint: the queue is a column of cards that stacks
 * at every width, and the action row inside a card wraps rather than
 * scrolls.
 *
 * WHAT IS UNPINNED HERE, said plainly and re-measured in this worktree at
 * this commit rather than copied from a sibling page: `find resources/js
 * \( -name '*.test.*' -o -name '*.spec.*' \)` printed nothing, `ls
 * vitest.config.*` at the repository root matched nothing, and
 * package.json's `test` script reads `cd old_next && vitest run` — the
 * read-only reference app. assertInertia reads SERVER-SIDE props only.
 * So that the reason field renders inside the row whose form produced it,
 * that *Bắt buộc* sits beside it, and that Duyệt is the solid button are
 * checked by reading this file. ManagerDonationsScreenTest pins the props
 * and the redirects underneath them and reaches none of the three.
 */

/**
 * One row of App\Queries\DonationQueueQuery's list — the server shape,
 * key for key.
 *
 * `donorName` MAY BE THE EMPTY STRING, not absent: the query reads
 * `donor?->user?->full_name` through two SoftDeletes relations, so a
 * trashed donor leaves "" behind rather than dropping the offer. The row
 * stays because it is exactly the offer a manager needs to clear.
 *
 * `photoUrl` rides the row and is NOT rendered. Plan divergence 11 keeps
 * the column read-only until an uploader exists to write it, so it is
 * null on every row this screen can be handed today; the reference draws
 * a placeholder tile and this page says the same thing in a sentence.
 *
 * `status`, `decisionNote` and `decidedAt` ride it too and are not
 * rendered: this list is pending-only, so all three are constants here —
 * the pill below says the state in words rather than reading it off the
 * row, and a decided offer's note is the DONOR's screen's job
 * (resources/js/pages/shelves/profile/donations.tsx renders it).
 */
interface QueuedDonation {
    donationId: string;
    description: string;
    photoUrl: string | null;
    estimatedCount: number | null;
    status: string;
    decisionNote: string | null;
    offeredAt: string;
    decidedAt: string | null;
    donorName: string;
    donorMembershipId: string;
}

interface PageProps extends SharedData {
    queue: QueuedDonation[];
}

const NUMBER = new Intl.NumberFormat("vi-VN");

/** The Vietnamese initial is the LAST word of a name — the given name. */
function initialOf(name: string): string {
    return (name.split(" ").at(-1) ?? "").charAt(0);
}

/**
 * `donorName` arrives as "" when the donor has been soft-deleted — the
 * props docblock above says so, and DonationController does branch on it
 * for the received flash. The CARD did not, so a departed donor drew an
 * empty circle above a blank line and the row read as broken rather than
 * as the offer a manager most needs to clear. manage/comments.tsx's
 * nameOr is the precedent this follows, initial included.
 */
function nameOr(value: string, fallback: string): string {
    return value === "" ? fallback : value;
}

/**
 * *Duyệt* — bodiless, the way its route is.
 *
 * ONE SOLID ACTION PER ROW, AGENTS.md rule 3 read the way a queue can
 * honour it: a queue of a dozen offers puts a dozen solid buttons on the
 * page, and what holds inside a row is that Duyệt is the solid one and Từ
 * chối beside it is an outline <summary>. manage/comments.tsx's
 * ApproveForm is the precedent this follows. h-14 = rule 4's 56px.
 */
function ReceiveForm({ shelfSlug, donationId }: { shelfSlug: string; donationId: string }) {
    const form = useForm({});

    const submit = (event: FormEvent) => {
        event.preventDefault();
        form.post(
            route("shelves.manage.donations.receive", {
                shelf: shelfSlug,
                donation: donationId,
            }),
            { preserveScroll: true },
        );
    };

    return (
        <form onSubmit={submit}>
            <Button type="submit" className="h-14 px-6 text-base" disabled={form.processing}>
                {copy.manageDonations.receiveButton}
            </Button>
        </form>
    );
}

/**
 * The decline disclosure, one per row, with its required reason.
 *
 * A <details> rather than an always-open box: on a queue of a dozen
 * offers, a dozen open text fields bury the decision being read. The
 * <summary> gets the button shape by hand — it is not a <button>, so the
 * Button component's classes cannot be handed to it. Both points are
 * manage/comments.tsx's RejectDisclosure, which this row follows, and the
 * reference's own queue screen draws the same <details>.
 */
function DeclineDisclosure({ shelfSlug, donationId }: { shelfSlug: string; donationId: string }) {
    const form = useForm<{ reason: string }>({ reason: "" });

    const submit = (event: FormEvent) => {
        event.preventDefault();
        form.post(
            route("shelves.manage.donations.decline", {
                shelf: shelfSlug,
                donation: donationId,
            }),
            { preserveScroll: true },
        );
    };

    return (
        <details className="min-w-0">
            <summary className="inline-flex h-11 cursor-pointer list-none items-center justify-center rounded-md border border-input px-4 text-sm font-medium hover:bg-accent [&::-webkit-details-marker]:hidden">
                {copy.manageDonations.declineSummary}
            </summary>
            {/* SINGLE COLUMN, label above the input, and the word *Bắt
                buộc* rather than an asterisk — AGENTS.md rule 6. */}
            <form onSubmit={submit} className="mt-3 w-full max-w-md space-y-2">
                <Label htmlFor={`decline-reason-${donationId}`}>
                    {copy.manageDonations.declineReasonLabel}
                    <span className="ml-2 font-normal text-muted-foreground">
                        {copy.manageDonations.required}
                    </span>
                </Label>
                <Input
                    id={`decline-reason-${donationId}`}
                    value={form.data.reason}
                    onChange={(e) => form.setData("reason", e.target.value)}
                />
                <p className="text-sm text-muted-foreground">
                    {copy.manageDonations.declineReasonHint}
                </p>
                {/* THIS row's field error, in THIS row. `reason` is required
                    and capped at 500, so an empty or overlong box is a field
                    error rather than a page-level refusal; rendered at the
                    top of the page it would land rows away from the
                    <details> the volunteer has open, and every form here
                    posts preserveScroll, so nothing would carry them to it.
                    The 2a whole-branch review moved field errors out of a
                    page head for exactly this reason. useForm scopes these
                    to this row's own visit; the page-level bag still carries
                    `rule`. */}
                {form.errors.reason ? (
                    <p role="alert" className="text-sm text-destructive">
                        {form.errors.reason}
                    </p>
                ) : null}
                <Button type="submit" variant="outline" className="h-11" disabled={form.processing}>
                    {copy.manageDonations.declineConfirm}
                </Button>
            </form>
        </details>
    );
}

export default function ManageDonations() {
    const { shelf, queue, errors, flash } = usePage<PageProps>().props;
    if (!shelf) return null;

    return (
        <ManageLayout>
            <Head title={copy.manageDonations.title} />
            <h1 className="text-2xl font-semibold">{copy.manageDonations.title}</h1>
            <p className="mb-4 text-sm text-muted-foreground">
                {queue.length === 0
                    ? copy.manageDonations.subtitle
                    : t(copy.manageDonations.subtitleCounted, {
                          count: NUMBER.format(queue.length),
                      })}
            </p>

            {/* THE SUCCESS FLASH IS THE HAND-OFF ON THIS SCREEN, not a
                courtesy: after Duyệt it carries the donor's name, and that
                name is what the volunteer types into Người tặng on the
                add-book form. role="status" so a screen reader is told
                without stealing focus, which is what the row buttons still
                have. */}
            {flash.success ? (
                <p
                    role="status"
                    className="mb-4 rounded-md border border-green-700/30 bg-green-700/10 px-3 py-2 text-sm"
                >
                    {flash.success}
                </p>
            ) : null}
            {/* The page-level bag, by construction: bootstrap/app.php turns a
                RuleViolated from either Action into
                back()->withErrors(['rule' => …]), so a second decision on an
                offer another volunteer has already handled lands here
                already translated. `reason` is deliberately NOT rendered up
                here — it belongs in the row that produced it. */}
            {errors.rule ? (
                <p
                    role="alert"
                    className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm"
                >
                    {errors.rule}
                </p>
            ) : null}

            {queue.length === 0 ? (
                <p className="text-sm text-muted-foreground">{copy.manageDonations.empty}</p>
            ) : (
                <div className="space-y-4">
                    {queue.map((donation) => (
                        <article
                            key={donation.donationId}
                            className="space-y-5 rounded-lg border p-5"
                        >
                            <div className="flex flex-wrap items-start justify-between gap-4">
                                <div className="flex items-center gap-3">
                                    <span
                                        aria-hidden
                                        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold"
                                    >
                                        {initialOf(
                                            nameOr(
                                                donation.donorName,
                                                copy.manageDonations.deletedDonor,
                                            ),
                                        )}
                                    </span>
                                    <div className="min-w-0">
                                        <p className="text-base font-medium">
                                            {nameOr(
                                                donation.donorName,
                                                copy.manageDonations.deletedDonor,
                                            )}
                                        </p>
                                        <p className="text-sm text-muted-foreground">
                                            {t(copy.manageDonations.donorLine, {
                                                // A DATE, not a timestamp
                                                // (AGENTS.md's language rule).
                                                // The server sends an ISO
                                                // instant; the NUMBER is
                                                // Intl's and the Vietnamese
                                                // glue is copy.ts's.
                                                date: formatInstantParts(donation.offeredAt).date,
                                            })}
                                        </p>
                                    </div>
                                </div>
                                {/* AGENTS.md's component table sends a state
                                    pill to `Pill`. THAT COMPONENT DOES NOT
                                    EXIST HERE. Measured across resources/js at
                                    2731bea, before this file was written:
                                    `grep -rnE "\b(Pill|StatusBadge|StatusPanel|
                                    StepIndicator|ReadOnlyValue|BookTitle)\b"
                                    resources/js` returned three hits, all of
                                    them prose inside
                                    pages/shelves/profile/donations.tsx's own
                                    note about the same six names — no
                                    declaration and no import. So rather than
                                    invent a component library on one screen,
                                    this uses components/ui/badge.tsx, which
                                    does exist, with a lucide icon beside the
                                    Vietnamese word: an icon, a word and a
                                    colour together, which is AGENTS.md rule 2
                                    satisfied more fully than a bare <Badge>.
                                    The divergence is recorded in this task's
                                    report. This measurement is scoped to that
                                    commit and goes stale the day someone adds
                                    one of the six. */}
                                <Badge variant="outline" className="shrink-0 gap-1">
                                    <Clock aria-hidden className="size-3.5" />
                                    {copy.manageDonations.statusPending}
                                </Badge>
                            </div>

                            <div className="space-y-4">
                                <div>
                                    <p className="text-sm text-muted-foreground">
                                        {copy.manageDonations.descriptionCaption}
                                    </p>
                                    {/* Plain text, escaped by React. The
                                        query returns the description raw on
                                        purpose — stripping it there would
                                        silently rewrite what a child wrote —
                                        and whitespace-pre-line keeps the line
                                        breaks they typed. */}
                                    <p className="mt-1 whitespace-pre-line text-base leading-relaxed">
                                        {donation.description}
                                    </p>
                                </div>
                                {donation.estimatedCount === null ? null : (
                                    <div>
                                        <p className="text-sm text-muted-foreground">
                                            {copy.manageDonations.countCaption}
                                        </p>
                                        <p className="mt-1 text-base">
                                            {t(copy.manageDonations.countValue, {
                                                count: NUMBER.format(donation.estimatedCount),
                                            })}
                                        </p>
                                    </div>
                                )}
                                <p className="text-sm text-muted-foreground">
                                    {copy.manageDonations.noPhoto}
                                </p>
                            </div>

                            <div className="flex flex-wrap items-start gap-3 border-t pt-4">
                                <ReceiveForm
                                    shelfSlug={shelf.slug}
                                    donationId={donation.donationId}
                                />
                                <DeclineDisclosure
                                    shelfSlug={shelf.slug}
                                    donationId={donation.donationId}
                                />
                            </div>
                        </article>
                    ))}
                </div>
            )}
        </ManageLayout>
    );
}
