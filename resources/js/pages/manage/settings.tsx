import { Head, usePage } from "@inertiajs/react";
import ManageLayout from "@/layouts/manage-layout";
import { copy, t } from "@/lib/copy";
import type { SharedData } from "@/types";

/**
 * `shelves/{shelf}/manage/settings` (spec D4) — OPS §3.4's
 * `GetShelfSettings`, "view this shelf's profile and lending policy",
 * read-only, `manager`. Port of the reference's `quan-ly/cai-dat`; the
 * Vietnamese path does not carry across, only the screen does.
 *
 * **EVERY VALUE ON THIS PAGE IS TEXT, AND THAT IS THE WHOLE FILE.** The
 * reference's own row component says it in its docstring — "plain text,
 * never a control, because a manager cannot edit it" — and the reason is
 * not deference. `UpdateBookshelfPolicy` authorizes internally as a super
 * administrator and denies as a 404, so a manager pressing a save here
 * would get neither the change nor an explanation. BR §16.3's fourteen
 * manager screens do not list Settings; §16.4 puts the lending policy on
 * the admin Bookshelves screen. This repo has now rendered a control its
 * server would refuse three separate times, which is why the absence is
 * asserted rather than merely intended: `ManagerSettingsScreenTest` reads
 * this file with its comments stripped and fails on the first sign of a
 * form, and reads the route table for a write verb under this path.
 *
 * **THE COMMENTS HERE MAY SAY "form" FREELY, AND THAT IS THE POINT OF THE
 * STRIPPING.** A raw grep over this file for `<form` is satisfied by this
 * very paragraph — measured on the admin screens, where the block was
 * deleted and its comment alone kept the test green. `screenSource` in
 * `tests/Pest.php` strips comments before looking, so prose costs nothing
 * and a real control costs a red build.
 *
 * **NO REFUSAL BAG AND NO FLASH.** Both exist on every other manager
 * screen because both are answers to a submit, and there is no submit
 * here — rendering an empty error slot would be scaffolding for a write
 * this screen must never grow.
 *
 * **THE VALUES ARE THE SHELF'S REAL ONES, DEFAULTS INCLUDED.** A shelf
 * that has never been configured genuinely lends for fourteen days, so the
 * server answers 14 rather than "chưa đặt" — the reference printed six
 * literals that happened to equal the defaults, and a shelf lending for
 * twenty-one days read "14 ngày" here with nothing disagreeing out loud.
 * A settings screen is believed; that is its whole failure mode.
 *
 * **NO PRIMARY ACTION** (AGENTS.md rule 3): a page with nothing to press
 * has nothing terracotta on it. No table either (rule 5) — every value is
 * a label over its own line, which stacks at any width.
 */
interface ContactRow {
    position: number;
    name: string;
    phone: string | null;
    /** Free text a parish writes for itself; blank falls back to a generic heading. */
    roleLabel: string | null;
}

interface PageProps extends SharedData {
    profile: { name: string; location: string | null; address: string | null };
    /** The eight settings of spec D2, read through LendingSettings and CommentSettings. */
    policy: {
        loanDays: number;
        maxConcurrentLoans: number;
        maxRenewals: number;
        renewalDays: number;
        holdDays: number;
        dueSoonDays: number;
        commentsEnabled: boolean;
        commentsRequireApproval: boolean;
    };
    /** Dense — an empty slot is not a line, because nothing here is a fixed block. */
    contacts: ContactRow[];
    taxonomy: {
        levels: 1 | 2;
        nested: boolean;
        level1Label: string;
        level2Label: string;
    };
}

/** A read-only label/value row with a hairline rule above it. */
function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="border-t py-4 first:border-t-0">
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="mt-1 font-medium">{children}</dd>
        </div>
    );
}

/**
 * One lending-policy row: label, the sentence saying what the number means,
 * and the value. Plain text, never a control — see the file header.
 */
function PolicyRow({ label, hint, value }: { label: string; hint: string; value: string }) {
    return (
        <div className="flex flex-wrap items-center justify-between gap-4 border-t py-4 first:border-t-0">
            <div className="min-w-0 max-w-md">
                <p className="font-medium">{label}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p>
            </div>
            <p className="shrink-0 font-semibold">{value}</p>
        </div>
    );
}

/** The sentence drawn under every section a manager can read and not change. */
function SuperAdminOnly() {
    return (
        <p className="mt-3 text-sm text-muted-foreground">{copy.manageSettings.superAdminOnly}</p>
    );
}

export default function ManageSettings() {
    const { shelf, profile, policy, contacts, taxonomy } = usePage<PageProps>().props;

    if (!shelf) return null;

    const days = (count: number) => t(copy.manageSettings.days, { count });

    // The six numbers in the order the admin editor lists them, each paired
    // with its hint. An array rather than six hand-written rows, so a value
    // cannot be shown without a sentence explaining it.
    const policyRows: { key: string; label: string; hint: string; value: string }[] = [
        {
            key: "loanDays",
            label: copy.manageSettings.policyFields.loanDays,
            hint: copy.manageSettings.policyHints.loanDays,
            value: days(policy.loanDays),
        },
        {
            key: "maxConcurrentLoans",
            label: copy.manageSettings.policyFields.maxConcurrentLoans,
            hint: copy.manageSettings.policyHints.maxConcurrentLoans,
            value: t(copy.manageSettings.books, { count: policy.maxConcurrentLoans }),
        },
        {
            key: "maxRenewals",
            label: copy.manageSettings.policyFields.maxRenewals,
            hint: copy.manageSettings.policyHints.maxRenewals,
            value: t(copy.manageSettings.times, { count: policy.maxRenewals }),
        },
        {
            key: "renewalDays",
            label: copy.manageSettings.policyFields.renewalDays,
            hint: copy.manageSettings.policyHints.renewalDays,
            value: days(policy.renewalDays),
        },
        {
            key: "holdDays",
            label: copy.manageSettings.policyFields.holdDays,
            hint: copy.manageSettings.policyHints.holdDays,
            value: days(policy.holdDays),
        },
        {
            key: "dueSoonDays",
            label: copy.manageSettings.policyFields.dueSoonDays,
            hint: copy.manageSettings.policyHints.dueSoonDays,
            value: days(policy.dueSoonDays),
        },
    ];

    const yesNo = (value: boolean) => (value ? copy.manageSettings.yes : copy.manageSettings.no);

    return (
        <ManageLayout>
            <Head title={copy.manageSettings.title} />
            <div className="mb-4">
                <h2 className="text-xl font-semibold">{copy.manageSettings.title}</h2>
                <p className="text-sm text-muted-foreground">
                    {t(copy.manageSettings.lead, { shelf: profile.name })}
                </p>
            </div>

            <div className="max-w-2xl space-y-10">
                <section>
                    <h3 className="mb-2 border-b pb-2 text-lg font-semibold">
                        {copy.manageSettings.profileSection}
                    </h3>
                    <dl>
                        <InfoRow label={copy.manageSettings.nameLabel}>{profile.name}</InfoRow>
                        {/* "Chưa có" rather than an empty row: both columns are
                            nullable and a blank line reads as a rendering bug. */}
                        <InfoRow label={copy.manageSettings.locationLabel}>
                            {profile.location ?? copy.manageSettings.blank}
                        </InfoRow>
                        <InfoRow label={copy.manageSettings.addressLabel}>
                            {profile.address ?? copy.manageSettings.blank}
                        </InfoRow>
                    </dl>
                    <SuperAdminOnly />
                </section>

                <section>
                    <h3 className="mb-2 border-b pb-2 text-lg font-semibold">
                        {copy.manageSettings.contactsSection}
                    </h3>
                    {contacts.length === 0 ? (
                        <p className="py-4 text-sm text-muted-foreground">
                            {copy.manageSettings.contactsEmpty}
                        </p>
                    ) : (
                        <dl>
                            {contacts.map((contact) => (
                                <InfoRow
                                    key={contact.position}
                                    label={
                                        contact.roleLabel ?? copy.manageSettings.contactFallbackRole
                                    }
                                >
                                    <span className="flex flex-wrap items-center gap-x-2">
                                        {contact.name}
                                        {/* tel:, the treatment shelves/book.tsx and
                                            manage/overdue.tsx already use — a
                                            volunteer reading this on a phone beside
                                            the shelf should be able to press it. */}
                                        {contact.phone ? (
                                            <a
                                                href={`tel:${contact.phone}`}
                                                className="font-normal underline"
                                            >
                                                {contact.phone}
                                            </a>
                                        ) : null}
                                    </span>
                                </InfoRow>
                            ))}
                        </dl>
                    )}
                    <SuperAdminOnly />
                </section>

                <section>
                    <h3 className="mb-2 border-b pb-2 text-lg font-semibold">
                        {copy.manageSettings.policySection}
                    </h3>
                    <div>
                        {policyRows.map((row) => (
                            <PolicyRow
                                key={row.key}
                                label={row.label}
                                hint={row.hint}
                                value={row.value}
                            />
                        ))}
                    </div>
                    <SuperAdminOnly />
                </section>

                <section>
                    <h3 className="mb-2 border-b pb-2 text-lg font-semibold">
                        {copy.manageSettings.commentsSection}
                    </h3>
                    <dl>
                        <InfoRow label={copy.manageSettings.commentsEnabledLabel}>
                            {yesNo(policy.commentsEnabled)}
                        </InfoRow>
                        <InfoRow label={copy.manageSettings.commentsRequireApprovalLabel}>
                            {yesNo(policy.commentsRequireApproval)}
                        </InfoRow>
                    </dl>
                    <SuperAdminOnly />
                </section>

                <section>
                    <h3 className="mb-2 border-b pb-2 text-lg font-semibold">
                        {copy.manageSettings.taxonomySection}
                    </h3>
                    <dl>
                        <InfoRow label={copy.manageSettings.levelsLabel}>
                            {taxonomy.levels === 2
                                ? copy.manageSettings.levelsTwo
                                : copy.manageSettings.levelsOne}
                        </InfoRow>
                        {/* Nesting only means anything on a two-level shelf, and
                            manage/units hides the row for the same reason. */}
                        {taxonomy.levels === 2 ? (
                            <InfoRow label={copy.manageSettings.nestedLabel}>
                                {yesNo(taxonomy.nested)}
                            </InfoRow>
                        ) : null}
                        <InfoRow label={copy.manageSettings.level1LabelLabel}>
                            {taxonomy.level1Label}
                        </InfoRow>
                        <InfoRow label={copy.manageSettings.level2LabelLabel}>
                            {taxonomy.level2Label}
                        </InfoRow>
                    </dl>
                    <p className="mt-3 text-sm text-muted-foreground">
                        {copy.manageSettings.unitsNote}
                    </p>
                    <SuperAdminOnly />
                </section>
            </div>
        </ManageLayout>
    );
}
