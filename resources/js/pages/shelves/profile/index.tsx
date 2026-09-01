import { Head, Link, useForm, usePage } from "@inertiajs/react";
import type { LucideIcon } from "lucide-react";
import { Ban, Check, Clock, Lock, X } from "lucide-react";
import type { FormEvent } from "react";
import { route } from "ziggy-js";
import AvatarFigure from "@/components/avatar-figure";
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
 * THE PHOTOGRAPH IS A PROPOSAL TOO (spec D6, Task 8), and it is the one
 * proposable field that is a FILE — so it has its own form, its own route
 * and its own multipart encoding, while reaching the SAME pending row as
 * the eight text fields. Nothing about it takes effect on submit: the
 * picture in force stays beside the control, and the pending block shows
 * the two photographs side by side, which is BR:544's contract applied to
 * a field whose value is an image. Task 1 rendered a bare label here and
 * said in its own comment that this was the right rendering and was this
 * task's.
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
 * The eight the page prints as text. The ninth is the photograph, and it
 * is not text: since Task 8 the server never sends its storage key at all
 * (App\Queries\MyProfileQuery drops it and sends `avatarUrl` instead), and
 * this screen renders the picture — in force, waiting, and in the upload
 * control — rather than any value belonging to that column.
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
    /**
     * Whether the proposal names the photograph — a FLAG, and never
     * inferred from `proposedAvatarUrl` being non-null. A discarded object
     * or a disk misconfigured after a docroot change would otherwise turn
     * "they proposed a new photograph" silently into "they proposed
     * nothing". App\Queries\MyProfileChangeRequestQuery argues it there.
     */
    avatarProposed: boolean;
    /**
     * ADDRESSES, never storage keys. `avatar_object` is one of the nine and
     * its value is a bucket path; Task 1 rendered a bare label for it and
     * flagged the two photographs as this task's, so the key is now dropped
     * from both bags server-side and these two arrive instead.
     */
    proposedAvatarUrl: string | null;
    previousAvatarUrl: string | null;
    rejectionReason: string | null;
    requestedAt: string;
    decidedAt: string | null;
}

interface MyProfile {
    membershipId: string;
    /** The EIGHT text fields — `avatar_object` never crosses the seam. */
    fields: Partial<Record<ProfileField, string | null>>;
    /** The photograph in force, as an address. Null is the ordinary case. */
    avatarUrl: string | null;
    /**
     * The file input's `accept`, from the server's own allow-list
     * (App\Support\Members\AvatarLimits) rather than hand-copied here —
     * a screen offering a format the server refuses is exactly what two
     * copies of a limit produce. HEIC's ABSENCE from it is what makes iOS
     * Safari transcode a photograph to JPEG on the way out.
     */
    avatarAccept: string;
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

/**
 * Spec D4's self-exemption, given a control — Task 7. The Action behind it
 * has existed since Task 4 and nothing reached it: neither decision queue
 * wires cancelling (BR:580/602 list only *Duyệt* and *Từ chối* on those
 * cards), so a reader withdrawing their own proposal — the one case D4
 * exempts from the subject-role rule — had no button anywhere.
 *
 * PENDING ONLY. A decided request is history; there is nothing to take
 * back, and the server would answer `profile_change_not_pending`.
 *
 * NOT terracotta (AGENTS.md rule 3): the primary action on this screen is
 * *Gửi đề nghị* below, and withdrawing is the quieter of the two.
 */
function CancelButton({ requestId, shelfSlug }: { requestId: string; shelfSlug: string }) {
    const c = copy.myProfile;
    const form = useForm({});

    const submit = (event: FormEvent) => {
        event.preventDefault();
        form.post(
            route("shelves.profile.change-request.cancel", {
                shelf: shelfSlug,
                profileChange: requestId,
            }),
        );
    };

    return (
        <form className="mt-4" onSubmit={submit}>
            <Button type="submit" variant="outline" className="h-11" disabled={form.processing}>
                {form.processing ? c.cancelSending : c.cancelSubmit}
            </Button>
            <p className="mt-2 text-sm text-muted-foreground">{c.cancelNote}</p>
        </form>
    );
}

/**
 * Spec D6's photograph — Task 8, and the first upload control this
 * application has ever had.
 *
 * IT IS A PROPOSAL LIKE EVERY OTHER FIELD. The product owner confirmed that
 * every field requires approval and named the picture explicitly, so
 * nothing here takes effect on submit: the lead says so, and the picture in
 * force stays beside the control while a new one waits.
 *
 * ITS OWN FORM AND ITS OWN ROUTE, not a field on the proposal form above.
 * The two carry different encodings — this one is multipart — and different
 * refusals; they still reach the same pending row, because the avatar is
 * this lifecycle's file-carrying case and not a second lifecycle.
 *
 * `accept` COMES FROM THE SERVER. App\Support\Members\AvatarLimits is the
 * one list, read by the gate and sent here by MyProfileQuery, so the
 * control cannot offer a format the server refuses. HEIC is deliberately
 * absent from it, which is what makes iOS Safari transcode an iPhone
 * photograph to JPEG on the way out — the note below says so in the
 * reader's own words, because the setting that fixes the remaining case
 * lives on their phone rather than on this screen.
 *
 * SECONDARY, NOT TERRACOTTA (rule 3): the one primary action on this screen
 * is *Gửi đề nghị* on the form above.
 */
function AvatarForm({
    currentUrl,
    accept,
    shelfSlug,
}: {
    currentUrl: string | null;
    accept: string;
    shelfSlug: string;
}) {
    const c = copy.myProfile;
    const form = useForm<{ avatar: File | null }>({ avatar: null });

    const submit = (event: FormEvent) => {
        event.preventDefault();
        form.post(route("shelves.profile.avatar", { shelf: shelfSlug }), {
            forceFormData: true,
            onSuccess: () => form.reset(),
        });
    };

    return (
        <section className="mt-8 max-w-xl">
            <h2 className="mb-1 text-xl font-semibold">{c.avatarTitle}</h2>
            <p className="mb-4 text-sm text-muted-foreground">{c.avatarLead}</p>

            <div className="mb-4">
                <AvatarFigure label={c.avatarCurrent} url={currentUrl} />
            </div>

            <form className="space-y-5" onSubmit={submit}>
                <div>
                    <Label htmlFor="avatar">{c.avatarChoose}</Label>
                    <Input
                        id="avatar"
                        name="avatar"
                        type="file"
                        accept={accept}
                        className="h-11 py-2"
                        onChange={(event) =>
                            form.setData("avatar", event.target.files?.[0] ?? null)
                        }
                    />
                    <p className="mt-1 text-xs text-muted-foreground">{c.avatarHint}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{c.avatarCropNote}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{c.avatarHeicNote}</p>
                    <InputError message={form.errors.avatar} />
                </div>

                <Button
                    type="submit"
                    variant="secondary"
                    className="h-14 w-full"
                    disabled={form.processing || form.data.avatar === null}
                >
                    {form.processing ? c.avatarSending : c.avatarSubmit}
                </Button>
            </form>
        </section>
    );
}

/**
 * BR §16.2's other reader-side control, and the one that does NOT wait for
 * a manager (spec D12): "changing the password takes effect immediately —
 * it is not a fact about the person that a manager verified". Which is why
 * it sits in its own section rather than among the eight proposable fields.
 *
 * THE CURRENT PASSWORD IS ASKED FOR, and that is the whole difference
 * between this form and a volunteer's *Đặt lại mật khẩu* on the reader
 * detail screen. A volunteer supplies none — BR:79 makes that inherent to
 * the trust model and mitigates it with visibility, which is why the two
 * paths keep separate audit actions.
 *
 * autoComplete is spelled for a password manager: `current-password` and
 * `new-password` are what stop one overwriting the other.
 */
function PasswordForm({ shelfSlug }: { shelfSlug: string }) {
    const c = copy.myProfile;
    const form = useForm({ current_password: "", new_password: "" });

    const submit = (event: FormEvent) => {
        event.preventDefault();
        form.post(route("shelves.profile.password", { shelf: shelfSlug }), {
            onSuccess: () => form.reset(),
        });
    };

    return (
        <section className="mt-8 max-w-xl">
            <h2 className="mb-1 text-xl font-semibold">{c.passwordTitle}</h2>
            <p className="mb-4 text-sm text-muted-foreground">{c.passwordLead}</p>

            <form className="space-y-5" onSubmit={submit}>
                <div>
                    <Label htmlFor="current_password">{c.passwordCurrent}</Label>
                    <Input
                        id="current_password"
                        name="current_password"
                        type="password"
                        autoComplete="current-password"
                        value={form.data.current_password}
                        onChange={(event) => form.setData("current_password", event.target.value)}
                    />
                    <InputError message={form.errors.current_password} />
                </div>

                <div>
                    <Label htmlFor="new_password">{c.passwordNew}</Label>
                    <Input
                        id="new_password"
                        name="new_password"
                        type="password"
                        autoComplete="new-password"
                        value={form.data.new_password}
                        onChange={(event) => form.setData("new_password", event.target.value)}
                    />
                    <p className="mt-1 text-xs text-muted-foreground">{c.passwordNewHint}</p>
                    <InputError message={form.errors.new_password} />
                </div>

                <p className="flex items-start gap-2 text-sm text-muted-foreground">
                    <Lock aria-hidden className="mt-0.5 size-4 shrink-0" />
                    {c.passwordNote}
                </p>

                {/* Secondary, not terracotta — rule 3's one primary is the
                    proposal form's *Gửi đề nghị*. */}
                <Button
                    type="submit"
                    variant="secondary"
                    className="h-14 w-full"
                    disabled={form.processing}
                >
                    {form.processing ? c.passwordSending : c.passwordSubmit}
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
    // TEXT_FIELDS, not FIELD_ORDER: `avatar_object` no longer crosses the
    // seam at all (App\Queries\MyProfileChangeRequestQuery strips the
    // storage key and sends two addresses instead), and the photograph is
    // rendered as a photograph below rather than as a row in this list.
    const proposed = pendingChange
        ? TEXT_FIELDS.filter((f) => f in pendingChange.proposedValues)
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
                            {proposed.map((f) => (
                                <li key={f}>
                                    {t(c.fieldLabelLine, { label: c.fieldLabels[f] })}{" "}
                                    <span className="font-semibold">
                                        {pendingChange.proposedValues[f] || c.proposedBlank}
                                    </span>
                                    {f in pendingChange.previousValues ? (
                                        <span className="text-muted-foreground">
                                            {" · "}
                                            {t(c.currentIs, {
                                                value: pendingChange.previousValues[f] || c.notSet,
                                            })}
                                        </span>
                                    ) : null}
                                </li>
                            ))}
                        </ul>

                        {/*
                         * BR:544's contract for the one proposable field
                         * that is a picture: the photograph in force with
                         * the one waiting BESIDE it — spec D6, and what
                         * Task 1's bare label was a placeholder for.
                         *
                         * GUARDED ON THE STATUS AS WELL AS THE FLAG, like
                         * its two neighbours below. "Beside it" is only a
                         * true sentence while the request is PENDING: spec
                         * D6 has approve delete the superseded object and
                         * reject/cancel delete the proposed one, and the
                         * JSON bag keeps the KEY either way, so a decided
                         * request still names two photographs of which one
                         * no longer exists. An earlier comment here reasoned
                         * that AvatarFigure's "Chưa có ảnh" fallback covered
                         * that; it does not — the fallback asks whether the
                         * URL is null, and a URL derived from a surviving
                         * key is a perfectly good string pointing at
                         * nothing. The server now sends null for both after
                         * a decision (MyProfileChangeRequestQuery), and this
                         * guard means the block is not drawn to be empty.
                         *
                         * `avatarProposed` stays the flag rather than the
                         * URL being non-null: within a pending request the
                         * two URLs may still be null independently — a
                         * reader who had no photograph at all — and
                         * AvatarFigure says so in words rather than drawing
                         * an unexplained empty square.
                         */}
                        {pendingChange.status === "pending" && pendingChange.avatarProposed ? (
                            <div className="mt-3 flex gap-4">
                                <AvatarFigure
                                    label={c.avatarCurrent}
                                    url={pendingChange.previousAvatarUrl}
                                    size="size-20"
                                />
                                <AvatarFigure
                                    label={c.avatarProposedLabel}
                                    url={pendingChange.proposedAvatarUrl}
                                    size="size-20"
                                />
                            </div>
                        ) : null}

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

                        {pendingChange.status === "pending" ? (
                            <CancelButton requestId={pendingChange.id} shelfSlug={shelf.slug} />
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

            <AvatarForm
                currentUrl={profile.avatarUrl}
                accept={profile.avatarAccept}
                shelfSlug={shelf.slug}
            />

            <PasswordForm shelfSlug={shelf.slug} />

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
