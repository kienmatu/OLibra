import { Head, router, usePage } from "@inertiajs/react";
import { useState } from "react";
import { route } from "ziggy-js";
import InputError from "@/components/input-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import AdminLayout from "@/layouts/admin-layout";
import { copy, t } from "@/lib/copy";
import { formatInstantParts } from "@/lib/dates";
import type { SharedData } from "@/types";

/**
 * BR §16.4's "Change queue for managers and shelf admins" — "every pending
 * profile-change proposal whose subject is a manager or shelf admin
 * anywhere in the system, the shelf named on each card. Approve and
 * reject-with-reason, the same pattern the shelf-level queue already uses.
 * This is where a manager's or admin's own proposed change is decided,
 * because nobody at their own shelf may decide it."
 *
 * THE OTHER HALF OF ONE PARTITION. Between this screen and
 * manage/profile-changes every pending proposal has exactly one home; a
 * proposal in neither would be one nobody could ever rule on, which is the
 * failure both predicates exist to prevent.
 *
 * THE SHELF IS NAMED ON EVERY CARD, and on a cross-shelf screen that is not
 * decoration: two parishes may both have a manager called Nguyễn Văn A, and
 * the administrator deciding is standing in neither.
 *
 * NO PLACEMENT PICKER HERE, unlike the shelf-level queue, and the asymmetry
 * is deliberate — App\Http\Controllers\Admin\ProfileChangeController's
 * docblock carries why. Approving from here leaves the subject's đơn vị
 * exactly as their own parish set it.
 *
 * A PROPOSED AVATAR IS ANNOUNCED, NEVER PRINTED: its value is a storage
 * key. Task 8 replaces the sentence with the photographs.
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
    subjectRole: string;
    shelfName: string;
    shelfSlug: string;
    requestedAt: string;
    fields: FieldChange[];
    avatarProposed: boolean;
}

interface PageProps extends SharedData {
    queue: QueueCard[];
}

/** The nine labels App\Support\Members\ProfileFields::FIELDS is keyed by. */
const LABELS = copy.myProfile.fieldLabels as Record<string, string>;

function ChangeCard({ card }: { card: QueueCard }) {
    const c = copy.adminProfileChanges;
    const { errors } = usePage<PageProps>().props;
    const [reason, setReason] = useState("");

    const post = (action: "approve" | "reject") =>
        router.post(
            route(`admin.profile-changes.${action}`, { profileChange: card.requestId }),
            action === "reject" ? { reason } : {},
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

            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                {t(c.shelfLine, { shelf: card.shelfName })}
                {/* The subject's rank is why this card is here rather than at
                    the shelf — a word, never a colour alone (AGENTS.md rule 2). */}
                <Badge variant="secondary">
                    {card.subjectRole === "admin" ? c.roleAdmin : c.roleManager}
                </Badge>
            </p>

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

            <div className="mt-5 space-y-3">
                <Button size="lg" className="h-14 w-full" onClick={() => post("approve")}>
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
                        <Button variant="outline" onClick={() => post("reject")}>
                            {c.reject}
                        </Button>
                    </div>
                    <InputError message={errors.reason} />
                </div>
            </div>
        </article>
    );
}

export default function AdminProfileChanges() {
    const { queue, errors, flash } = usePage<PageProps>().props;
    const c = copy.adminProfileChanges;

    return (
        <AdminLayout>
            <Head title={c.title} />
            <h2 className="mb-1 text-2xl font-semibold">{c.title}</h2>
            <p className="mb-6 text-sm text-muted-foreground">{c.lead}</p>

            {flash.success ? (
                <p
                    role="status"
                    className="mb-4 rounded-md border border-green-700/30 bg-green-700/10 px-3 py-2 text-sm"
                >
                    {flash.success}
                </p>
            ) : null}

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
                        <ChangeCard key={card.requestId} card={card} />
                    ))}
                </div>
            )}
        </AdminLayout>
    );
}
