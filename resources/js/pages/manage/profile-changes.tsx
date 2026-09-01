import { Head, router, usePage } from "@inertiajs/react";
import { useState } from "react";
import { route } from "ziggy-js";
import InputError from "@/components/input-error";
import ParishUnitFields, {
    type ParishTaxonomyProp,
    type ParishUnitProp,
} from "@/components/parish-unit-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import ManageLayout from "@/layouts/manage-layout";
import { copy, t } from "@/lib/copy";
import { formatInstantParts } from "@/lib/dates";
import type { SharedData } from "@/types";

/**
 * BR §16.3's *Đổi thông tin* — "One card per proposed change whose subject
 * is a reader of this shelf … showing the current value and the proposed
 * one side by side so the manager can see exactly what would change.
 * Approve and Reject, with a required reason on rejection."
 *
 * WHAT IS DELIBERATELY ABSENT is as much a part of this screen as what is
 * here: a manager's or shelf admin's own proposed change never appears,
 * because nobody at this shelf may decide it. It is decided at
 * /admin/profile-changes instead. The predicate lives on the server
 * (App\Queries\ProfileChangeQueueQuery) and the nav badge shares it, so the
 * number beside the link can never exceed the cards below.
 *
 * ONE FORM PER CARD, NOT ONE PER SCREEN. Each card holds its own reason box
 * and its own placement pair in local state — a shared form would carry one
 * manager's typed reason onto whichever card they pressed next.
 * `preserveScroll` for the same reason the registration queue uses it: a
 * decision on the fifth card should not throw the page back to the top.
 *
 * THE PLACEMENT PAIR IS SENT ONLY WHEN IT WAS TOUCHED. Absent and null are
 * different answers to App\Actions\Admin\ApproveProfileChange — absent
 * leaves the reader where they are, null clears the placement — so an
 * untouched card must send neither key rather than sending the values it
 * happened to render. `touched` is what draws that line, and it is drawn
 * here rather than by comparing values, because re-selecting the unit a
 * reader is already in is a legitimate no-op a manager may perform on
 * purpose.
 *
 * THE UNIT LABELS ARE THE SHELF'S OWN (BR:247, BR:578) — ParishUnitFields
 * renders `taxonomy.level1Label`/`level2Label`, never the words Tổ or Giáo
 * họ, which is the same component the registration form and the reader
 * creation form use.
 *
 * A PROPOSED AVATAR IS ANNOUNCED, NEVER PRINTED. Its value is a storage
 * key; the server sends a boolean and this screen renders a sentence. Task
 * 8 replaces that sentence with the two photographs.
 */

interface FieldChange {
    field: string;
    current: string | null;
    proposed: string | null;
}

interface QueueCard {
    requestId: string;
    subjectUserId: string;
    subjectName: string;
    saintName: string | null;
    parishUnitL1Id: string | null;
    parishUnitL2Id: string | null;
    requestedAt: string;
    fields: FieldChange[];
    avatarProposed: boolean;
}

interface PageProps extends SharedData {
    queue: QueueCard[];
    taxonomy: ParishTaxonomyProp;
    units: ParishUnitProp[];
}

/** The nine labels App\Support\Members\ProfileFields::FIELDS is keyed by. */
const LABELS = copy.myProfile.fieldLabels as Record<string, string>;

function ChangeCard({ card, shelfSlug }: { card: QueueCard; shelfSlug: string }) {
    const c = copy.manageProfileChanges;
    const { errors, taxonomy, units } = usePage<PageProps>().props;

    const [reason, setReason] = useState("");
    const [l1, setL1] = useState(card.parishUnitL1Id ?? "");
    const [l2, setL2] = useState(card.parishUnitL2Id ?? "");
    const [touched, setTouched] = useState(false);

    const approve = () =>
        router.post(
            route("shelves.manage.profile-changes.approve", {
                shelf: shelfSlug,
                profileChange: card.requestId,
            }),
            touched ? { parish_unit_l1_id: l1, parish_unit_l2_id: l2 } : {},
            { preserveScroll: true },
        );

    const reject = () =>
        router.post(
            route("shelves.manage.profile-changes.reject", {
                shelf: shelfSlug,
                profileChange: card.requestId,
            }),
            { reason },
            { preserveScroll: true },
        );

    return (
        <article className="rounded-md border p-5">
            <header className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-lg font-semibold">
                    {card.saintName ? `${card.saintName} ${card.subjectName}` : card.subjectName}
                </h2>
                <span className="text-[13px] text-muted-foreground">
                    {t(c.requestedAt, { date: formatInstantParts(card.requestedAt).date })}
                </span>
            </header>

            <table className="mt-4 w-full text-[15px]">
                <thead>
                    <tr className="border-b text-left text-sm text-muted-foreground">
                        <th className="py-1.5 font-normal" />
                        <th className="py-1.5 font-normal">{c.currentHeading}</th>
                        <th className="py-1.5 font-normal">{c.proposedHeading}</th>
                    </tr>
                </thead>
                <tbody>
                    {card.fields.map((change) => (
                        <tr key={change.field} className="border-b align-top">
                            <th
                                scope="row"
                                className="py-2 pr-3 text-left font-normal text-muted-foreground"
                            >
                                {LABELS[change.field] ?? change.field}
                            </th>
                            <td className="py-2 pr-3">{change.current || c.notSet}</td>
                            <td className="py-2 font-semibold">{change.proposed || c.blank}</td>
                        </tr>
                    ))}
                </tbody>
            </table>

            {card.avatarProposed ? (
                <p className="mt-3 text-[15px] text-muted-foreground">{c.avatarProposed}</p>
            ) : null}

            <section className="mt-5">
                <h3 className="text-[15px] font-semibold">{c.placementTitle}</h3>
                <p className="mt-1 mb-3 text-sm text-muted-foreground">{c.placementNote}</p>
                <ParishUnitFields
                    taxonomy={taxonomy}
                    units={units}
                    l1={l1}
                    l2={l2}
                    idSuffix={`-${card.requestId}`}
                    onChange={(nextL1, nextL2) => {
                        setTouched(true);
                        setL1(nextL1);
                        setL2(nextL2);
                    }}
                />
            </section>

            <div className="mt-5 space-y-3">
                {/* THE one primary action on this card; h-14 is rule 4's 56px. */}
                <Button size="lg" className="h-14 w-full" onClick={approve}>
                    {c.approve}
                </Button>
                <div className="space-y-2">
                    <Label htmlFor={`reason-${card.requestId}`}>{c.rejectReason}</Label>
                    <div className="flex gap-2">
                        <Input
                            id={`reason-${card.requestId}`}
                            value={reason}
                            onChange={(event) => setReason(event.target.value)}
                        />
                        <Button variant="outline" onClick={reject}>
                            {c.reject}
                        </Button>
                    </div>
                    <InputError message={errors.reason} />
                </div>
            </div>
        </article>
    );
}

export default function ManageProfileChanges() {
    const { shelf, queue, errors, flash } = usePage<PageProps>().props;
    if (!shelf) return null;

    const c = copy.manageProfileChanges;

    return (
        <ManageLayout>
            <Head title={c.title} />
            <h1 className="mb-1 text-2xl font-semibold">{c.title}</h1>
            <p className="mb-6 text-sm text-muted-foreground">{c.lead}</p>

            {flash.success ? (
                <p
                    role="status"
                    className="mb-4 rounded-md border border-green-700/30 bg-green-700/10 px-3 py-2 text-sm"
                >
                    {flash.success}
                </p>
            ) : null}

            {/* The Actions' Vietnamese refusals — a second decision on a card
                a colleague has already decided lands here as
                `profile_change_not_pending`, over a 302. */}
            {errors.rule ? (
                <p role="alert" className="mb-4 rounded-md border px-4 py-3 text-[15px]">
                    {errors.rule}
                </p>
            ) : null}

            {queue.length === 0 ? (
                <p className="text-muted-foreground">{c.empty}</p>
            ) : (
                <div className="space-y-4">
                    {queue.map((card) => (
                        <ChangeCard key={card.requestId} card={card} shelfSlug={shelf.slug} />
                    ))}
                </div>
            )}
        </ManageLayout>
    );
}
