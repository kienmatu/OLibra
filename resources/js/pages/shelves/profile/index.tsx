import { Head, Link, usePage } from "@inertiajs/react";
import type { LucideIcon } from "lucide-react";
import { Ban, Check, Clock, Lock, X } from "lucide-react";
import { route } from "ziggy-js";
import { Badge } from "@/components/ui/badge";
import AppLayout from "@/layouts/app-layout";
import { copy, t } from "@/lib/copy";
import { formatInstantParts } from "@/lib/dates";
import type { SharedData } from "@/types";

/**
 * BR §16.2's "Hồ sơ của bạn" — the reader's own record.
 *
 * READ-ONLY IN THIS TASK, and the note at the foot says so in words rather
 * than leaving a reader to guess. BR:83's "changing your own details is a
 * request, not an edit" needs ProposeProfileChange, which is a later task's;
 * what this screen owes a reader today is their verified details, their
 * parish unit, and what happened to a proposal they already sent.
 *
 * THE FIELD KEYS ARE COLUMN NAMES ON BOTH SIDES. App\Queries\MyProfileQuery
 * returns the nine verified fields snake_case, and a proposal's
 * proposedValues/previousValues are the same bag keyed the same way, so the
 * comparison below is a key match and not a translation table that is wrong
 * in exactly one entry. FIELD_ORDER is what fixes the ORDER of that
 * comparison: the values arrive as JSON, whose key order is whatever the
 * writer happened to serialise, and two proposals over the same pair of
 * fields must not list them differently on a screen whose whole job is
 * reading a change quickly.
 *
 * BR:544's rendering contract is the pending block: the current value with
 * the pending one BESIDE it, and the plain sentence that it is waiting. A
 * block showing only the proposed values would satisfy the query and fail
 * the requirement — so `currentIs` renders off previousValues, which for a
 * pending request IS the value still in force, and `stillInForce` says it.
 *
 * THE PARISH LABELS ARE THE SHELF'S OWN — spec D11, BR:247/BR:578. The
 * words "Tổ" and "Giáo họ" appear nowhere in this file; taxonomy.level1Label
 * and level2Label carry whatever this parish calls its levels, which 3b-ii
 * made editable. showLevel1/showLevel2 come from the server for the same
 * reason: whether a level renders at all is ParishUnits::hasVisibleLevel2's
 * decision, and it knows about a soft-deleted parent this page does not.
 */

/** The nine of App\Support\Members\ProfileFields::FIELDS, in its order. */
const FIELD_ORDER = [
    "saint_name",
    "full_name",
    "date_of_birth",
    "father_name",
    "mother_name",
    "phone",
    "phone_missing_reason",
    "email",
    "avatar_object",
] as const;

type ProfileField = (typeof FIELD_ORDER)[number];

/**
 * The eight the page prints as text. `avatar_object` holds a storage key,
 * which is meaningless to a reader — the photograph itself is a later
 * task's, so this screen names neither.
 */
const TEXT_FIELDS = FIELD_ORDER.filter((f) => f !== "avatar_object");

interface ProfileChange {
    id: string;
    status: string;
    proposedValues: Partial<Record<ProfileField, string | null>>;
    previousValues: Partial<Record<ProfileField, string | null>>;
    rejectionReason: string | null;
    requestedAt: string;
    decidedAt: string | null;
}

interface MyProfile {
    membershipId: string;
    fields: Partial<Record<ProfileField, string | null>>;
    parishLine: string;
    parishUnitL1Name: string;
    parishUnitL2Name: string;
    taxonomy: {
        levels: number;
        nested: boolean;
        level1Label: string;
        level2Label: string;
    };
    showLevel1: boolean;
    showLevel2: boolean;
    pendingChange: ProfileChange | null;
}

interface PageProps extends SharedData {
    /** See donations.tsx's own prop doc — the same null-membership state. */
    isMember: boolean;
    profile: MyProfile | null;
}

/**
 * The four states App\Enums\ProfileChangeStatus carries, as an icon, a
 * Vietnamese word and a colour together — AGENTS.md's second
 * non-negotiable, which asks for all three and never colour alone. Composed
 * from ui/badge.tsx plus a lucide icon, the same way donations.tsx does,
 * because the component AGENTS.md's table would send this to does not exist
 * in resources/js/components.
 *
 * The fallback arm matters: `status` arrives as a plain string, so a state
 * added to the enum without a word here renders its raw value rather than
 * an empty pill.
 */
const STATUS: Record<
    string,
    { label: string; icon: LucideIcon; variant: "secondary" | "outline" }
> = {
    pending: { label: copy.myProfile.statusPending, icon: Clock, variant: "outline" },
    approved: { label: copy.myProfile.statusApproved, icon: Check, variant: "secondary" },
    rejected: { label: copy.myProfile.statusRejected, icon: X, variant: "outline" },
    cancelled: { label: copy.myProfile.statusCancelled, icon: Ban, variant: "outline" },
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

/**
 * A read-only value: the label ABOVE plain text, per AGENTS.md rule 6 and
 * its component table's row for exactly this case ("render the label above
 * plain text"). Never an empty cell — an unset value reads "Chưa có".
 */
function ValueRow({ label, value }: { label: string; value: string | null }) {
    return (
        <div className="border-b py-2">
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="mt-0.5 text-[15px]">{value || copy.myProfile.notSet}</dd>
        </div>
    );
}

export default function MyProfilePage() {
    const { isMember, profile, shelf } = usePage<PageProps>().props;
    if (!shelf) return null;

    const c = copy.myProfile;

    if (!isMember || profile === null) {
        return (
            <AppLayout>
                <Head title={c.title} />
                <h1 className="mb-4 text-2xl font-semibold">{c.title}</h1>
                <p className="text-sm text-muted-foreground">{c.onlyReaders}</p>
            </AppLayout>
        );
    }

    const { fields, taxonomy, pendingChange } = profile;
    // The fields the proposal actually names. Key PRESENCE, not a set
    // value: a key holding null means "clear this", which is a change worth
    // showing, while an absent key means the reader proposed nothing about
    // it.
    const proposed = pendingChange
        ? FIELD_ORDER.filter((f) => f in pendingChange.proposedValues)
        : [];

    return (
        <AppLayout>
            <Head title={c.title} />

            <h1 className="mb-1 text-2xl font-semibold">{c.title}</h1>
            <p className="mb-6 text-sm text-muted-foreground">{c.lead}</p>

            <section className="max-w-xl">
                <h2 className="mb-2 text-xl font-semibold">{c.changesTitle}</h2>
                {pendingChange === null ? (
                    <p className="text-sm text-muted-foreground">{c.empty}</p>
                ) : (
                    <div className="rounded-md border p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <StatusPill status={pendingChange.status} />
                            <p className="text-sm text-muted-foreground">
                                {t(c.requestedOn, {
                                    date: formatInstantParts(pendingChange.requestedAt).date,
                                })}
                            </p>
                        </div>

                        <ul className="mt-3 space-y-1 text-[15px]">
                            {proposed.map((f) =>
                                f === "avatar_object" ? (
                                    /*
                                     * THE BARE LABEL, NEVER `{label}: {value}`.
                                     * avatar_object holds a storage key, which
                                     * printed as a value is meaningless to a
                                     * reader — the reference makes the same
                                     * decision on this same list and on the
                                     * manager's decision screen. The two
                                     * photographs side by side are the right
                                     * rendering and they are the avatar task's;
                                     * until then the reader still needs to know
                                     * WHICH field the proposal is about.
                                     */
                                    <li key={f}>{c.fieldLabels[f]}</li>
                                ) : (
                                    <li key={f}>
                                        {t(c.fieldLabelLine, { label: c.fieldLabels[f] })}{" "}
                                        <span className="font-semibold">
                                            {pendingChange.proposedValues[f] || c.proposedBlank}
                                        </span>
                                        {f in pendingChange.previousValues ? (
                                            <span className="text-muted-foreground">
                                                {" · "}
                                                {t(c.currentIs, {
                                                    value:
                                                        pendingChange.previousValues[f] || c.notSet,
                                                })}
                                            </span>
                                        ) : null}
                                    </li>
                                ),
                            )}
                        </ul>

                        {pendingChange.status === "pending" ? (
                            <p className="mt-3 text-sm text-muted-foreground">{c.stillInForce}</p>
                        ) : null}

                        {/*
                         * Guarded on the REASON rather than the status, so a
                         * sentence a manager wrote is never swallowed. The
                         * label says whose sentence it is: the column is
                         * NOT NULL only for a rejected row (the table's own
                         * profile_change_requests_rejected_has_reason check),
                         * so no other status carries one today.
                         */}
                        {pendingChange.rejectionReason ? (
                            <p className="mt-3 text-[15px]">
                                {t(c.rejectionReasonLine, {
                                    reason: pendingChange.rejectionReason,
                                })}
                            </p>
                        ) : null}

                        {pendingChange.decidedAt ? (
                            <p className="mt-3 text-sm text-muted-foreground">
                                {t(c.decidedOn, formatInstantParts(pendingChange.decidedAt))}
                            </p>
                        ) : null}
                    </div>
                )}
            </section>

            <section className="mt-8 max-w-xl">
                <h2 className="mb-2 text-xl font-semibold">{c.sectionPerson}</h2>
                <dl>
                    {TEXT_FIELDS.map((f) => (
                        <ValueRow key={f} label={c.fieldLabels[f]} value={fields[f] ?? null} />
                    ))}
                </dl>
                <p className="mt-3 text-sm text-muted-foreground">{c.readOnlyNote}</p>
            </section>

            {profile.showLevel1 || profile.showLevel2 ? (
                <section className="mt-8 max-w-xl">
                    <h2 className="mb-2 text-xl font-semibold">{c.sectionParish}</h2>
                    <dl>
                        {profile.showLevel1 ? (
                            <ValueRow
                                label={taxonomy.level1Label}
                                value={profile.parishUnitL1Name}
                            />
                        ) : null}
                        {profile.showLevel2 ? (
                            <ValueRow
                                label={taxonomy.level2Label}
                                value={profile.parishUnitL2Name}
                            />
                        ) : null}
                    </dl>
                    <p className="mt-3 flex items-start gap-2 text-sm text-muted-foreground">
                        <Lock aria-hidden className="mt-0.5 size-4 shrink-0" />
                        {profile.showLevel2
                            ? t(c.parishNoteTwo, {
                                  level1: taxonomy.level1Label.toLowerCase(),
                                  level2: taxonomy.level2Label.toLowerCase(),
                              })
                            : t(c.parishNoteOne, {
                                  level1: taxonomy.level1Label.toLowerCase(),
                              })}
                    </p>
                </section>
            ) : null}

            <div className="mt-8">
                <Link
                    href={route("shelves.profile.overview", { shelf: shelf.slug })}
                    className="text-sm underline"
                >
                    {c.backToOverview}
                </Link>
            </div>
        </AppLayout>
    );
}
