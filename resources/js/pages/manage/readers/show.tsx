import { Head, router, useForm, usePage } from "@inertiajs/react";
import { type FormEvent, useState } from "react";
import { route } from "ziggy-js";
import InputError from "@/components/input-error";
import type { ParishTaxonomyProp, ParishUnitProp } from "@/components/parish-unit-fields";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import ManageLayout from "@/layouts/manage-layout";
import { copy, t } from "@/lib/copy";
import type { SharedData } from "@/types";

interface CurrentLoan {
    loanId: string;
    title: string;
    copyCode: string;
    dueOn: string;
    isOverdue: boolean;
    daysRemaining: number;
}

interface ReaderDetail {
    membershipId: string;
    fullName: string;
    saintName: string | null;
    status: keyof typeof copy.membershipStatus;
    dateOfBirth: string | null;
    fatherName: string;
    motherName: string;
    phone: string | null;
    phoneMissingReason: string | null;
    email: string | null;
    hasCredentials: boolean;
    username: string | null;
    // approvedAt, not joinedOn: the query names it after the column
    // (memberships.approved_at) it reads; the readers CSV's "Ngày tham
    // gia" column reads the same instant folded to a civil day. Fix
    // round on task 8: the export carried this fact behind a bound that
    // claimed the reader-detail page already showed it, and it did not —
    // rendered here so the bound is actually true rather than merely
    // asserted (docs/OPERATIONS.md's GetReaderDetail entry, BR §16.3).
    approvedAt: string | null;
    managerNotes: string | null;
    rejectionReason: string | null;
    suspensionReason: string | null;
    parishLine: string;
    parishUnitL1Id: string | null;
    parishUnitL2Id: string | null;
    holdingCount: number;
    currentLoans: CurrentLoan[];
}

interface PageProps extends SharedData {
    reader: ReaderDetail;
    taxonomy: ParishTaxonomyProp;
    units: ParishUnitProp[];
}

// dateStyle+timeStyle, Asia/Ho_Chi_Minh: approvedAt is a UTC instant
// (memberships.approved_at), and the reader-detail page renders every
// instant in the shelf's own timezone (audit.tsx, books/show.tsx).
const JOINED_ON = new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Ho_Chi_Minh",
});

function ValueRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex justify-between gap-4 border-b py-1.5 text-[15px]">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="text-right">{value}</dd>
        </div>
    );
}

export default function ReaderShow() {
    const { shelf, reader, errors } = usePage<PageProps>().props;
    const [editing, setEditing] = useState(false);
    if (!shelf) return null;
    const ruleError = (errors as Record<string, string>).rule;

    const act = (name: string, body: Record<string, string> = {}) =>
        router.post(
            route(`shelves.manage.readers.${name}`, {
                shelf: shelf.slug,
                reader: reader.membershipId,
            }),
            body,
            { preserveScroll: true },
        );

    const f = copy.readerDetail.fields;

    return (
        <ManageLayout>
            <Head title={copy.readerDetail.title} />
            <div className="mb-1 flex flex-wrap items-center gap-3">
                <h1 className="text-2xl font-semibold">
                    {reader.saintName ? `${reader.saintName} ${reader.fullName}` : reader.fullName}
                </h1>
                <Badge variant="outline">{copy.membershipStatus[reader.status]}</Badge>
            </div>
            {reader.parishLine ? (
                <p className="text-muted-foreground">{reader.parishLine}</p>
            ) : null}
            {ruleError ? (
                <p className="mt-4 max-w-2xl rounded-md border px-4 py-3 text-[15px]">
                    {ruleError}
                </p>
            ) : null}
            {reader.suspensionReason ? (
                <p className="mt-4 max-w-2xl rounded-md border border-amber-400/50 bg-amber-50 px-4 py-3 text-[15px] dark:bg-amber-950/30">
                    {t(copy.readerDetail.suspensionReasonLine, { reason: reader.suspensionReason })}
                </p>
            ) : null}
            {reader.rejectionReason ? (
                <p className="mt-4 max-w-2xl rounded-md border px-4 py-3 text-[15px]">
                    {t(copy.readerDetail.rejectionReasonLine, { reason: reader.rejectionReason })}
                </p>
            ) : null}

            <div className="mt-8 grid max-w-5xl gap-8 lg:grid-cols-2">
                <section>
                    <div className="flex items-center justify-between">
                        <h2 className="text-lg font-semibold">{copy.readerDetail.title}</h2>
                        <Button variant="outline" onClick={() => setEditing((v) => !v)}>
                            {copy.readerDetail.editProfile}
                        </Button>
                    </div>
                    {editing ? (
                        <EditProfileForm />
                    ) : (
                        <dl className="mt-4">
                            <ValueRow label={f.saintName} value={reader.saintName ?? "—"} />
                            <ValueRow label={f.fullName} value={reader.fullName} />
                            <ValueRow label={f.dateOfBirth} value={reader.dateOfBirth ?? "—"} />
                            <ValueRow label={f.fatherName} value={reader.fatherName} />
                            <ValueRow label={f.motherName} value={reader.motherName} />
                            <ValueRow label={f.phone} value={reader.phone ?? "—"} />
                            {reader.phone === null && reader.phoneMissingReason ? (
                                <ValueRow
                                    label={f.phoneMissingReason}
                                    value={reader.phoneMissingReason}
                                />
                            ) : null}
                            <ValueRow label={f.email} value={reader.email ?? "—"} />
                            <ValueRow label={f.parish} value={reader.parishLine || "—"} />
                            <ValueRow
                                label={f.joinedOn}
                                value={
                                    reader.approvedAt
                                        ? JOINED_ON.format(new Date(reader.approvedAt))
                                        : "—"
                                }
                            />
                            {reader.managerNotes ? (
                                <ValueRow
                                    label={copy.readerDetail.managerNotes}
                                    value={reader.managerNotes}
                                />
                            ) : null}
                        </dl>
                    )}
                </section>

                <section className="space-y-8">
                    <div>
                        <h2 className="text-lg font-semibold">{copy.readerDetail.holding}</h2>
                        {reader.currentLoans.length === 0 ? (
                            <p className="mt-2 text-muted-foreground">
                                {copy.readerDetail.noLoans}
                            </p>
                        ) : (
                            <ul className="mt-2 divide-y rounded-md border">
                                {reader.currentLoans.map((loan) => (
                                    <li
                                        key={loan.loanId}
                                        className="flex justify-between gap-3 px-4 py-2.5 text-[15px]"
                                    >
                                        <span>
                                            {loan.title}
                                            <span className="ml-2 text-muted-foreground">
                                                {loan.copyCode}
                                            </span>
                                        </span>
                                        <span
                                            className={
                                                loan.isOverdue
                                                    ? "text-destructive"
                                                    : "text-muted-foreground"
                                            }
                                        >
                                            {loan.isOverdue
                                                ? t(copy.readerDetail.loanOverdue, {
                                                      days: Math.abs(loan.daysRemaining),
                                                  })
                                                : t(copy.readerDetail.loanDays, {
                                                      days: loan.daysRemaining,
                                                  })}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>

                    <CredentialsForm />

                    <div className="space-y-3">
                        {reader.status === "active" ? <SuspendForm /> : null}
                        {reader.status === "suspended" ? (
                            <Button variant="outline" onClick={() => act("reactivate")}>
                                {copy.readerDetail.reactivate}
                            </Button>
                        ) : null}
                        {reader.status !== "left" ? (
                            <Button variant="outline" onClick={() => act("mark-left")}>
                                {copy.readerDetail.markLeft}
                            </Button>
                        ) : null}
                    </div>
                </section>
            </div>
        </ManageLayout>
    );
}

function EditProfileForm() {
    const { shelf, reader } = usePage<PageProps>().props;
    const form = useForm({
        saint_name: reader.saintName ?? "",
        full_name: reader.fullName,
        date_of_birth: reader.dateOfBirth ?? "",
        father_name: reader.fatherName,
        mother_name: reader.motherName,
        phone: reader.phone ?? "",
        // Pre-filled with what is on file, so resubmitting unchanged
        // preserves an existing reason rather than silently clearing it.
        phone_missing_reason: reader.phoneMissingReason ?? "",
        email: reader.email ?? "",
    });
    if (!shelf) return null;

    const submit = (event: FormEvent) => {
        event.preventDefault();
        form.patch(
            route("shelves.manage.readers.profile.update", {
                shelf: shelf.slug,
                reader: reader.membershipId,
            }),
            {
                preserveScroll: true,
            },
        );
    };

    const field = (name: keyof typeof form.data, label: string, type = "text") => (
        <div className="space-y-1.5">
            <Label htmlFor={`edit-${name}`}>{label}</Label>
            <Input
                id={`edit-${name}`}
                type={type}
                value={form.data[name]}
                onChange={(e) => form.setData(name, e.target.value)}
            />
            <InputError message={form.errors[name]} />
        </div>
    );

    const f = copy.readerDetail.fields;

    return (
        <form onSubmit={submit} className="mt-4 space-y-4">
            {field("saint_name", f.saintName)}
            {field("full_name", f.fullName)}
            {field("date_of_birth", f.dateOfBirth, "date")}
            {field("father_name", f.fatherName)}
            {field("mother_name", f.motherName)}
            {field("phone", f.phone)}
            {form.data.phone.trim() === ""
                ? field("phone_missing_reason", f.phoneMissingReason)
                : null}
            {field("email", f.email)}
            <Button type="submit" disabled={form.processing}>
                {copy.readerDetail.editSave}
            </Button>
        </form>
    );
}

function CredentialsForm() {
    const { shelf, reader } = usePage<PageProps>().props;
    const form = useForm({
        // The reset form posts the username too, invisibly: the command
        // always writes the pair (INV-14) — there is no password-only
        // variant — so an account that has a username resubmits it from
        // here rather than offering a rename beside a reset.
        username: reader.username ?? "",
        password: "",
    });
    if (!shelf) return null;

    const submit = (event: FormEvent) => {
        event.preventDefault();
        form.post(
            route("shelves.manage.readers.credentials", {
                shelf: shelf.slug,
                reader: reader.membershipId,
            }),
            {
                preserveScroll: true,
                onSuccess: () => form.reset("password"),
            },
        );
    };

    return (
        <form onSubmit={submit} className="space-y-3 rounded-md border p-4">
            <h2 className="text-lg font-semibold">
                {reader.hasCredentials
                    ? copy.readerDetail.credentialsTitleReset
                    : copy.readerDetail.credentialsTitleNew}
            </h2>
            {reader.hasCredentials ? (
                <input type="hidden" name="username" value={form.data.username} />
            ) : (
                <div className="space-y-1.5">
                    <Label htmlFor="cred-username">{copy.readerDetail.credentialsUsername}</Label>
                    <Input
                        id="cred-username"
                        value={form.data.username}
                        onChange={(e) => form.setData("username", e.target.value)}
                    />
                </div>
            )}
            <div className="space-y-1.5">
                <Label htmlFor="cred-password">{copy.readerDetail.credentialsPassword}</Label>
                <Input
                    id="cred-password"
                    type="password"
                    autoComplete="new-password"
                    value={form.data.password}
                    onChange={(e) => form.setData("password", e.target.value)}
                />
            </div>
            <InputError message={form.errors.username ?? form.errors.password} />
            <Button type="submit" variant="outline" disabled={form.processing}>
                {copy.readerDetail.credentialsSubmit}
            </Button>
        </form>
    );
}

function SuspendForm() {
    const { shelf, reader } = usePage<PageProps>().props;
    const form = useForm({ reason: "" });
    if (!shelf) return null;

    const submit = (event: FormEvent) => {
        event.preventDefault();
        form.post(
            route("shelves.manage.readers.suspend", {
                shelf: shelf.slug,
                reader: reader.membershipId,
            }),
            {
                preserveScroll: true,
            },
        );
    };

    return (
        <form onSubmit={submit} className="space-y-3 rounded-md border p-4">
            <h2 className="text-lg font-semibold">{copy.readerDetail.suspend}</h2>
            <p className="text-[14px] text-muted-foreground">{copy.readerDetail.suspendNote}</p>
            <div className="space-y-1.5">
                <Label htmlFor="suspend-reason">{copy.readerDetail.suspendReason}</Label>
                <Input
                    id="suspend-reason"
                    value={form.data.reason}
                    onChange={(e) => form.setData("reason", e.target.value)}
                />
                <InputError message={form.errors.reason} />
            </div>
            <Button type="submit" variant="destructive" disabled={form.processing}>
                {copy.readerDetail.suspendSubmit}
            </Button>
        </form>
    );
}
