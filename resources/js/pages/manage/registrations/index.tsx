import { Head, router, usePage } from "@inertiajs/react";
import { useState } from "react";
import { route } from "ziggy-js";
import InputError from "@/components/input-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import ManageLayout from "@/layouts/manage-layout";
import { copy, t } from "@/lib/copy";
import type { SharedData } from "@/types";

interface ApplicationRow {
    membershipId: string;
    fullName: string;
    saintName: string | null;
    dateOfBirth: string | null;
    fatherName: string;
    motherName: string;
    phone: string | null;
    phoneMissingReason: string | null;
    parishLine: string;
    requestedAt: string;
    similarTo: { membershipId: string; fullName: string; similarity: number } | null;
}

interface PageProps extends SharedData {
    applications: ApplicationRow[];
}

function ReviewCard({
    application,
    shelfSlug,
}: {
    application: ApplicationRow;
    shelfSlug: string;
}) {
    const [reason, setReason] = useState("");
    const { errors } = usePage<PageProps>().props;

    const act = (action: "approve" | "reject") =>
        router.post(
            route(`shelves.manage.registrations.${action}`, {
                shelf: shelfSlug,
                reader: application.membershipId,
            }),
            action === "reject" ? { reason } : {},
            { preserveScroll: true },
        );

    const rows: [string, string][] = [
        [copy.registrationQueue.dateOfBirth, application.dateOfBirth ?? "—"],
        [copy.registrationQueue.father, application.fatherName],
        [copy.registrationQueue.mother, application.motherName],
        [
            copy.registrationQueue.phone,
            application.phone ??
                t(copy.registrationQueue.phoneMissing, {
                    reason: application.phoneMissingReason ?? "—",
                }),
        ],
        [copy.registrationQueue.parish, application.parishLine || "—"],
    ];

    return (
        <article className="rounded-md border p-5">
            <header className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-lg font-semibold">
                    {application.saintName
                        ? `${application.saintName} ${application.fullName}`
                        : application.fullName}
                </h2>
                <span className="text-[13px] text-muted-foreground">
                    {t(copy.registrationQueue.requestedAt, {
                        time: new Date(application.requestedAt).toLocaleDateString("vi-VN"),
                    })}
                </span>
            </header>

            {application.similarTo ? (
                <p className="mt-3 rounded-md border border-amber-400/50 bg-amber-50 px-3 py-2 text-[14px] dark:bg-amber-950/30">
                    {t(copy.registrationQueue.similar, {
                        name: application.similarTo.fullName,
                        percent: Math.round(application.similarTo.similarity * 100),
                    })}
                </p>
            ) : null}

            <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                {rows.map(([label, value]) => (
                    <div
                        key={label}
                        className="flex justify-between gap-4 border-b py-1.5 text-[15px]"
                    >
                        <dt className="text-muted-foreground">{label}</dt>
                        <dd className="text-right">{value}</dd>
                    </div>
                ))}
            </dl>

            <div className="mt-5 space-y-3">
                <Button size="lg" className="w-full" onClick={() => act("approve")}>
                    {copy.registrationQueue.approve}
                </Button>
                <div className="space-y-2">
                    <Label htmlFor={`reason-${application.membershipId}`}>
                        {copy.registrationQueue.rejectReason}
                    </Label>
                    <div className="flex gap-2">
                        <Input
                            id={`reason-${application.membershipId}`}
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                        />
                        <Button variant="outline" onClick={() => act("reject")}>
                            {copy.registrationQueue.reject}
                        </Button>
                    </div>
                    <InputError message={errors.reason} />
                </div>
            </div>
        </article>
    );
}

export default function RegistrationQueue() {
    const { shelf, applications, errors } = usePage<PageProps>().props;
    if (!shelf) return null;
    const ruleError = (errors as Record<string, string>).rule;

    return (
        <ManageLayout>
            <Head title={copy.registrationQueue.title} />
            <h1 className="mb-4 text-2xl font-semibold">{copy.registrationQueue.title}</h1>
            {ruleError ? (
                <p className="mb-4 rounded-md border px-4 py-3 text-[15px]">{ruleError}</p>
            ) : null}
            {applications.length === 0 ? (
                <p className="text-muted-foreground">{copy.registrationQueue.empty}</p>
            ) : (
                <div className="space-y-4">
                    {applications.map((application) => (
                        <ReviewCard
                            key={application.membershipId}
                            application={application}
                            shelfSlug={shelf.slug}
                        />
                    ))}
                </div>
            )}
        </ManageLayout>
    );
}
