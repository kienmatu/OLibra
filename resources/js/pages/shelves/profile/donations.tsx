import { Head, Link, usePage } from "@inertiajs/react";
import type { LucideIcon } from "lucide-react";
import { Check, Clock, X } from "lucide-react";
import { route } from "ziggy-js";
import { Badge } from "@/components/ui/badge";
import AppLayout from "@/layouts/app-layout";
import { copy, t } from "@/lib/copy";
import { formatInstantParts } from "@/lib/dates";
import type { SharedData } from "@/types";

/**
 * BR §16.2's other half: what happened to each offer.
 *
 * A DECLINED OFFER SHOWS ITS REASON, because that is the whole point of
 * requiring one — the reader reads it. BR §5.4's BookDonation entity line
 * is where the requirement lives ("decision note (reason required on
 * decline, matching every other rejection flow in this document)"), and
 * App\Queries\MyDonationsQuery carries the same citation beside the row key
 * it fills.
 *
 * A RECEIVED ONE SAYS SO AND STOPS THERE — no link to a catalogue entry,
 * because there is nothing to link to. App\Actions\Community\
 * ReceiveDonation (opened) states it as its own headline, "IT WRITES NO
 * `books` ROW AND NO `book_copies` ROW", and names the block that counts
 * zero of each after it returns
 * (tests/Feature/Community/DonationDecisionsTest.php's "receiving writes no
 * books row and no book_copies row"). A link here would be the screen
 * promising something the command did not do.
 */
/**
 * `photoUrl` rides the row and is NOT rendered. MyDonationsQuery returns it
 * for every row, and plan divergence 11 keeps the column read-only until an
 * uploader exists to write it; the reference's own Tặng sách screen
 * (old_next/src/app/tu-sach/[shelf]/(doc-gia)/ho-so/tang-sach/page.tsx,
 * opened) shows the description, the status pill, the date, the count and
 * the decline reason, and no image — so this page shows the same.
 */
interface DonationRow {
    donationId: string;
    description: string;
    photoUrl: string | null;
    estimatedCount: number | null;
    status: string;
    decisionNote: string | null;
    offeredAt: string;
    decidedAt: string | null;
}

interface PageProps extends SharedData {
    /** See donate.tsx's own prop doc — the same null-membership state. */
    isMember: boolean;
    mine: DonationRow[];
}

/**
 * The three states App\Enums\DonationStatus carries, as an icon, a
 * Vietnamese word and a colour together — AGENTS.md's second
 * non-negotiable, which asks for all three and never colour alone.
 *
 * AGENTS.md's component table sends state pills to `Pill` ("icon and label
 * are both required"). THAT COMPONENT DOES NOT EXIST HERE. Measured at this
 * commit, AFTER this file was written: `grep -rlE "\bPill\b" resources/js`
 * returns this file alone and its one match is this sentence, and the same
 * is true of StatusBadge, StatusPanel and StepIndicator — four names the
 * table prescribes that nothing in resources/js declared or imported WHEN
 * THIS WAS MEASURED. (ReadOnlyValue and BookTitle are two more, the second
 * cited by AGENTS.md's numbered rule 1 rather than only its table.) The
 * scoping matters: this goes stale the day someone adds one of them.
 * Rather than invent a
 * component library on one screen, this uses `components/ui/badge.tsx`,
 * which does exist and which pages/manage/books/index.tsx and
 * pages/shelves/announcements/index.tsx already render state words through
 * — the `<Badge …>` line in each was read at this commit. Badge renders
 * whatever children it is given inside the pill (read off
 * components/ui/badge.tsx), so the icon rides in as a child beside the
 * word. The divergence is recorded in this task's report.
 *
 * The fallback arm matters: `status` arrives as a plain string from the
 * server, so a state added to the enum without a word here renders its raw
 * value rather than an empty pill or a crash.
 */
const STATUS: Record<
    string,
    { label: string; icon: LucideIcon; variant: "secondary" | "outline" }
> = {
    pending: { label: copy.donations.statusPending, icon: Clock, variant: "outline" },
    received: { label: copy.donations.statusReceived, icon: Check, variant: "secondary" },
    declined: { label: copy.donations.statusDeclined, icon: X, variant: "outline" },
};

function StatusPill({ status }: { status: string }) {
    const known = STATUS[status];
    const Icon = known?.icon ?? Clock;

    return (
        <Badge variant={known?.variant ?? "outline"} className="shrink-0 gap-1">
            <Icon aria-hidden className="size-3.5" />
            {known?.label ?? status}
        </Badge>
    );
}

export default function ProfileDonations() {
    const { isMember, mine, shelf } = usePage<PageProps>().props;
    if (!shelf) return null;

    return (
        <AppLayout>
            <Head title={copy.donations.listTitle} />

            <h1 className="mb-4 text-2xl font-semibold">{copy.donations.listTitle}</h1>

            {!isMember ? (
                <p className="text-sm text-muted-foreground">{copy.donations.onlyReaders}</p>
            ) : mine.length === 0 ? (
                <p className="text-sm text-muted-foreground">{copy.donations.empty}</p>
            ) : (
                <ul className="divide-y border-y">
                    {mine.map((d) => (
                        <li key={d.donationId} className="px-1 py-4">
                            <div className="flex items-start justify-between gap-3">
                                <p className="min-w-0 flex-1 text-sm leading-snug">
                                    {d.description}
                                </p>
                                <StatusPill status={d.status} />
                            </div>
                            <p className="mt-2 text-sm text-muted-foreground">
                                {[
                                    t(copy.donations.offeredOn, {
                                        // A DATE, not a timestamp (AGENTS.md's
                                        // language rule). The server sends an ISO
                                        // instant; the NUMBER is Intl's and the
                                        // Vietnamese glue is copy.ts's — the split
                                        // comments.postedOn already uses.
                                        date: formatInstantParts(d.offeredAt).date,
                                    }),
                                    ...(d.estimatedCount === null
                                        ? []
                                        : [
                                              t(copy.donations.countLine, {
                                                  count: d.estimatedCount,
                                              }),
                                          ]),
                                ].join(" · ")}
                            </p>
                            {/*
                             * The reason a decline required one. Guarded on
                             * the NOTE, and an earlier draft of this comment
                             * had the consequence exactly backwards: it said
                             * guarding on the note means a received offer
                             * carrying one "never shows it as a refusal".
                             * The opposite is true — the label reads
                             * "Lý do từ chối", so such a row WOULD be shown
                             * as a refusal. Guarding on the STATUS is what
                             * would produce the stated outcome.
                             *
                             * The state is unreachable today, which is why
                             * the guard is left as it is: ReceiveDonation::
                             * execute writes status, decided_by and
                             * decided_at and never touches decision_note;
                             * DeclineDonation::execute is what writes
                             * book_donations.decision_note. (Grepped: a
                             * second command, RejectBorrowRequest, writes a
                             * decision_note too — on borrow_requests, a
                             * different table. Narrowed after a first draft
                             * said "the only writer of that column", which
                             * reads as tree-wide and is not.) If a third writer
                             * ever appears, gate on the status as the
                             * reference does — and labelled,
                             * which is this page's one divergence from the
                             * reference's bare paragraph: three lines of
                             * prose already sit above it and an unlabelled
                             * fourth does not say whose sentence it is.
                             */}
                            {d.decisionNote ? (
                                <p className="mt-2 text-sm">
                                    {t(copy.donations.declineReasonLine, {
                                        reason: d.decisionNote,
                                    })}
                                </p>
                            ) : null}
                        </li>
                    ))}
                </ul>
            )}

            <div className="mt-8 flex flex-wrap gap-6">
                <Link
                    href={route("shelves.donate", { shelf: shelf.slug })}
                    className="text-sm underline"
                >
                    {copy.donations.toForm}
                </Link>
                <Link
                    href={route("shelves.profile.overview", { shelf: shelf.slug })}
                    className="text-sm underline"
                >
                    {copy.donations.backToOverview}
                </Link>
            </div>
        </AppLayout>
    );
}
