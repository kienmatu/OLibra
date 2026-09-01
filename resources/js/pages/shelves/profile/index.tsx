import { Head, Link, useForm, usePage } from "@inertiajs/react";
import type { LucideIcon } from "lucide-react";
import { Ban, Check, Clock, Lock, X } from "lucide-react";
import type { FormEvent } from "react";
import { route } from "ziggy-js";
import InputError from "@/components/input-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import AppLayout from "@/layouts/app-layout";
import { copy, t } from "@/lib/copy";
import { formatInstantParts } from "@/lib/dates";
import type { SharedData } from "@/types";

/**
 * BR §16.2's "Hồ sơ của bạn" — the reader's own record, and since Task 2
 * the form BR:83 calls "a request, not an edit".
 *
 * THE VERIFIED LIST AND THE FORM ARE BOTH HERE, and the duplication is the
 * point rather than an oversight: the list is what the parish currently
 * believes about this person and what stays in force, and the form is what
 * they would like it to say. Collapsing the two into prefilled inputs would
 * lose the first meaning — a reader could no longer tell a value they had
 * typed from a value a manager verified.
 *
 * SUBMITTING SENDS ALL EIGHT PROPOSABLE FIELDS, not only the touched ones,
 * and nothing downstream minds: App\Actions\Admin\ProposeProfileChange
 * filters the patch against the person as they stand and refuses
 * `empty_proposal` when nothing differs, so an untouched field is never a
 * proposal. What that DOES buy is the four not-null columns arriving as
 * present-and-blank when a reader clears one, which is how
 * `required_fields_missing` reaches them instead of a silent no-op.
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

/**
 * The eight App\Support\Members\ProfileProposals::proposableFields() names
 * — the same list, and the same exclusion for the same reason: the
 * photograph is a FILE, so it arrives through the avatar task's own path.
 * `avatar_object` is deliberately absent from the form AND from
 * ProposeProfileChangeRequest's rules, because ProfileFields normalises it
 * as a plain trimmed string with no validation — a form that posted it
 * would let a reader point their avatar at any storage key in the bucket.
 */
const PROPOSABLE_FIELDS = TEXT_FIELDS;

/** How each proposable field is typed, so a birthday gets a date control. */
const FIELD_INPUT: Partial<Record<ProfileField, string>> = {
    date_of_birth: "date",
    phone: "tel",
    email: "email",
};

/** The four NOT NULL columns of App\Support\Members\ProfileFields::REQUIRED. */
const REQUIRED_FIELDS: ReadonlySet<string> = new Set([
    "saint_name",
    "full_name",
    "father_name",
    "mother_name",
]);

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

/**
 * BR:83's request. SINGLE COLUMN, labels above inputs, the word *Bắt buộc*
 * rather than an asterisk — AGENTS.md rule 6 — and the trio its component
 * table names for a labelled control: Label + the control + InputError.
 *
 * THE MERGE IS SAID OUT LOUD when something is already pending (spec D1). A
 * second proposal does not start a second request and does not throw the
 * first away; the fields touched now join the one already waiting, and the
 * same card keeps the same id. A screen silent about that would let a
 * reader believe they had replaced their earlier proposal.
 */
function ProposeForm({
    fields,
    shelfSlug,
    hasPending,
}: {
    fields: Partial<Record<ProfileField, string | null>>;
    shelfSlug: string;
    hasPending: boolean;
}) {
    const c = copy.myProfile;
    const form = useForm<Record<string, string>>(
        Object.fromEntries(PROPOSABLE_FIELDS.map((f) => [f, fields[f] ?? ""])),
    );

    const submit = (event: FormEvent) => {
        event.preventDefault();
        form.post(route("shelves.profile.change-request", { shelf: shelfSlug }));
    };

    return (
        <section className="mt-8 max-w-xl">
            <h2 className="mb-1 text-xl font-semibold">{c.proposeTitle}</h2>
            <p className="mb-4 text-sm text-muted-foreground">{c.proposeLead}</p>

            {hasPending ? (
                <p className="mb-4 rounded-md border px-3 py-2 text-sm text-muted-foreground">
                    {c.proposeMergeNote}
                </p>
            ) : null}

            <form className="space-y-5" onSubmit={submit}>
                {PROPOSABLE_FIELDS.map((field) => (
                    <div key={field}>
                        <Label htmlFor={field}>
                            {c.fieldLabels[field]}
                            {REQUIRED_FIELDS.has(field) ? (
                                <span className="ml-2 text-xs font-normal text-muted-foreground">
                                    {c.required}
                                </span>
                            ) : null}
                        </Label>
                        {field === "phone_missing_reason" ? (
                            /* No textarea component exists yet — AGENTS.md's
                               table says to style a plain one like the input. */
                            <textarea
                                id={field}
                                name={field}
                                rows={2}
                                className="min-h-16 w-full rounded-md border bg-background px-3 py-2 text-sm"
                                value={form.data[field]}
                                onChange={(event) => form.setData(field, event.target.value)}
                            />
                        ) : (
                            <Input
                                id={field}
                                name={field}
                                type={FIELD_INPUT[field] ?? "text"}
                                value={form.data[field]}
                                onChange={(event) => form.setData(field, event.target.value)}
                            />
                        )}
                        {field === "phone" ? (
                            <p className="mt-1 text-xs text-muted-foreground">{c.phoneHint}</p>
                        ) : null}
                        <InputError message={form.errors[field]} />
                    </div>
                ))}

                {/* THE one primary action on this screen (rule 3); h-14 is
                    rule 4's 56px. */}
                <Button type="submit" className="h-14 w-full" disabled={form.processing}>
                    {form.processing ? c.proposeSending : c.proposeSubmit}
                </Button>
            </form>
        </section>
    );
}

export default function MyProfilePage() {
    const { isMember, profile, shelf, errors, flash } = usePage<PageProps>().props;
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

            {flash.success ? (
                <p
                    role="status"
                    className="mb-4 max-w-xl rounded-md border border-green-700/30 bg-green-700/10 px-3 py-2 text-sm"
                >
                    {flash.success}
                </p>
            ) : null}

            {/*
             * The rule banner. Every RuleViolated in this application
             * arrives the same way — bootstrap/app.php renders it as
             * back()->withErrors(['rule' => …]) — and ProposeProfileChange
             * has several a reader can genuinely meet: a blank saint name,
             * a phone cleared with no reason, a form submitted unchanged,
             * and a pending request filed at another parish.
             */}
            {errors.rule ? (
                <p
                    role="alert"
                    className="mb-4 max-w-xl rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm"
                >
                    {errors.rule}
                </p>
            ) : null}

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
                <p className="mt-3 text-sm text-muted-foreground">{c.verifiedNote}</p>
            </section>

            <ProposeForm
                fields={fields}
                shelfSlug={shelf.slug}
                hasPending={pendingChange?.status === "pending"}
            />

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
