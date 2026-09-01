import { Head, useForm, usePage } from "@inertiajs/react";
import type { FormEvent } from "react";
import { route } from "ziggy-js";
import InputError from "@/components/input-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import AdminLayout from "@/layouts/admin-layout";
import { copy } from "@/lib/copy";
import type { SharedData } from "@/types";

/**
 * BR §16.4's system settings (spec D1) — the installation's own row, and the
 * first screen ever to read it.
 *
 * **THE CONTACT BLOCK IS FIRST BECAUSE IT IS THE PUBLIC ONE.** §16.4 puts it
 * there: everything below decides what a tủ sách opened next month starts
 * with, while these three fields are what a stranger with no membership
 * anywhere reads on `/contact`. That page is the only route to a human a
 * parish with no bookshelf has.
 *
 * **TWO FORMS, TWO BAGS, TWO SUBMITS, TWO REFUSALS.** No state is shared
 * between them, which is what makes "independent" true rather than claimed:
 * a rejected loan default leaves a half-typed phone number alone, and each
 * save flashes its own sentence so a volunteer who pressed one of two
 * buttons can tell which one landed.
 *
 * **THE THIRD SECTION IS NOT A FORM AND MUST NOT BECOME ONE.** Language and
 * timezone are read-only, they have no column, and the reference's own
 * fixture shipped a `<select>` with a single option in it — a control that
 * cannot be operated dressed as one that can. The timezone string comes from
 * the server (`App\Support\Clock::ZONE`) rather than being typed here, so
 * the page cannot disagree with the clock the application actually runs on.
 *
 * **THE NUMBERS ARE HELD AS STRINGS**, the shelf editor's reasoning applied
 * to the same six values: an `<input type="number">` bound to a number
 * cannot represent "the volunteer cleared the box", and 0 is a legal value
 * for two of these — so an empty box silently becoming a saved 0 is exactly
 * the defect the bounds table exists to close.
 *
 * Single column, labels above inputs, one solid button per section —
 * AGENTS.md rules 6 and 3.
 */
interface ContactBlock {
    contact_name: string | null;
    contact_phone: string | null;
    contact_hours: string | null;
}

/**
 * The six defaults under the SHELF-side keys, not the column names. These
 * are the values a new shelf's own `settings` bag receives, so the screen,
 * the wire and the shelf editor all say the same words.
 */
interface DefaultsBlock {
    loan_days: number;
    max_concurrent_loans: number;
    max_renewals: number;
    renewal_days: number;
    hold_days: number;
    due_soon_days: number;
}

interface PageProps extends SharedData {
    contact: ContactBlock;
    defaults: DefaultsBlock;
    timezone: string;
    /** `null` until somebody saves — the row is seeded, not written. */
    changedAt: string | null;
}

interface ContactForm {
    contact_name: string;
    contact_phone: string;
    contact_hours: string;
}

interface DefaultsForm {
    loan_days: string;
    max_concurrent_loans: string;
    max_renewals: string;
    renewal_days: string;
    hold_days: string;
    due_soon_days: string;
}

/**
 * The bounds the server enforces, mirrored onto the inputs. The mirror is
 * the convenience and the Form Request is the rule — `min`/`max` on an input
 * is a hint a hand-crafted POST ignores — and the two floors of 0
 * (`max_renewals`, `due_soon_days`) are real policies rather than unset
 * fields, which is why each field carries its own number instead of a shared
 * `min={1}`.
 */
const DEFAULT_NUMBERS = [
    { key: "loan_days", label: copy.adminSettings.defaultsFields.loanDays, min: 1, max: 365 },
    {
        key: "max_concurrent_loans",
        label: copy.adminSettings.defaultsFields.maxConcurrentLoans,
        min: 1,
        max: 50,
    },
    { key: "max_renewals", label: copy.adminSettings.defaultsFields.maxRenewals, min: 0, max: 10 },
    {
        key: "renewal_days",
        label: copy.adminSettings.defaultsFields.renewalDays,
        min: 1,
        max: 365,
    },
    { key: "hold_days", label: copy.adminSettings.defaultsFields.holdDays, min: 1, max: 30 },
    { key: "due_soon_days", label: copy.adminSettings.defaultsFields.dueSoonDays, min: 0, max: 30 },
] as const satisfies readonly {
    key: keyof DefaultsForm;
    label: string;
    min: number;
    max: number;
}[];

export default function AdminSettings() {
    const {
        contact,
        defaults,
        timezone,
        changedAt,
        errors: pageErrors,
        flash,
    } = usePage<PageProps>().props;

    const contactForm = useForm<ContactForm>({
        contact_name: contact.contact_name ?? "",
        contact_phone: contact.contact_phone ?? "",
        contact_hours: contact.contact_hours ?? "",
    });

    const submitContact = (event: FormEvent) => {
        event.preventDefault();
        contactForm.post(route("admin.settings.contact"));
    };

    // Its own bag and its own route. Nothing here reads or writes the
    // contact form's state — that is what two refusals means in practice.
    const defaultsForm = useForm<DefaultsForm>({
        loan_days: String(defaults.loan_days),
        max_concurrent_loans: String(defaults.max_concurrent_loans),
        max_renewals: String(defaults.max_renewals),
        renewal_days: String(defaults.renewal_days),
        hold_days: String(defaults.hold_days),
        due_soon_days: String(defaults.due_soon_days),
    });

    const submitDefaults = (event: FormEvent) => {
        event.preventDefault();
        defaultsForm.post(route("admin.settings.defaults"));
    };

    return (
        <AdminLayout>
            <Head title={copy.adminSettings.title} />
            <h2 className="mb-1 text-xl font-semibold">{copy.adminSettings.title}</h2>
            <p className="mb-4 text-sm text-muted-foreground">{copy.adminSettings.lead}</p>

            {/* THE TWO FORMS CONFIRM SEPARATELY, and the sentence is what
                separates them: SettingsController flashes
                site_contact_saved_flash or system_defaults_saved_flash, each
                naming its own block. One banner in one place is still two
                confirmations because the two do not read alike.

                At the top rather than inside each section because neither
                submit preserves scroll: Inertia resets it, and this is where
                the volunteer lands. Without it a save is indistinguishable
                from a press that did nothing — useForm preserves the inputs,
                so not even the boxes flicker. */}
            {flash.success ? (
                <p
                    role="status"
                    className="mb-4 rounded-md border border-green-700/30 bg-green-700/10 px-3 py-2 text-sm"
                >
                    {flash.success}
                </p>
            ) : null}

            {/* A business refusal — a phone Phone::assert() rejects is the
                one this screen can produce — arrives through the shared
                errors prop under `rule`, not as a field error.
                bootstrap/app.php's one RuleViolated hook. */}
            <InputError message={pageErrors.rule} />

            <section className="max-w-xl">
                <h3 className="mb-1 text-lg font-semibold">{copy.adminSettings.contactSection}</h3>
                <p className="mb-3 text-sm text-muted-foreground">
                    {copy.adminSettings.contactLead}
                </p>

                <form onSubmit={submitContact} className="space-y-4">
                    <div>
                        <Label htmlFor="contact_name">
                            {copy.adminSettings.contactFields.name}
                            <span className="ml-2 font-normal text-muted-foreground">
                                {copy.adminSettings.contactOptional}
                            </span>
                        </Label>
                        <Input
                            id="contact_name"
                            value={contactForm.data.contact_name}
                            onChange={(event) =>
                                contactForm.setData("contact_name", event.target.value)
                            }
                        />
                        <InputError message={contactForm.errors.contact_name} />
                    </div>

                    <div>
                        <Label htmlFor="contact_phone">
                            {copy.adminSettings.contactFields.phone}
                        </Label>
                        <Input
                            id="contact_phone"
                            type="tel"
                            inputMode="tel"
                            value={contactForm.data.contact_phone}
                            onChange={(event) =>
                                contactForm.setData("contact_phone", event.target.value)
                            }
                        />
                        <p className="mt-1 text-sm text-muted-foreground">
                            {copy.adminSettings.contactPhoneHint}
                        </p>
                        <InputError message={contactForm.errors.contact_phone} />
                    </div>

                    <div>
                        <Label htmlFor="contact_hours">
                            {copy.adminSettings.contactFields.hours}
                        </Label>
                        <Input
                            id="contact_hours"
                            value={contactForm.data.contact_hours}
                            onChange={(event) =>
                                contactForm.setData("contact_hours", event.target.value)
                            }
                        />
                        <InputError message={contactForm.errors.contact_hours} />
                    </div>

                    <p className="text-sm text-muted-foreground">
                        {copy.adminSettings.contactBlankNote}
                    </p>

                    <Button type="submit" className="h-14" disabled={contactForm.processing}>
                        {copy.adminSettings.submitContact}
                    </Button>
                </form>
            </section>

            <section className="mt-10 max-w-xl border-t pt-8">
                <h3 className="mb-1 text-lg font-semibold">{copy.adminSettings.defaultsSection}</h3>
                {/* The sentence this section turns on — see the file header. */}
                <p className="mb-3 text-sm text-muted-foreground">
                    {copy.adminSettings.defaultsLead}
                </p>

                <form onSubmit={submitDefaults} className="space-y-4">
                    {DEFAULT_NUMBERS.map(({ key, label, min, max }) => (
                        <div key={key}>
                            <Label htmlFor={key}>
                                {label}
                                <span className="ml-2 font-normal text-muted-foreground">
                                    {copy.adminShelves.required}
                                </span>
                            </Label>
                            <Input
                                id={key}
                                type="number"
                                inputMode="numeric"
                                min={min}
                                max={max}
                                value={defaultsForm.data[key]}
                                onChange={(event) => defaultsForm.setData(key, event.target.value)}
                            />
                            <InputError message={defaultsForm.errors[key]} />
                        </div>
                    ))}

                    <p className="text-sm text-muted-foreground">
                        {copy.adminSettings.defaultsZeroAllowed}
                    </p>

                    <Button type="submit" className="h-14" disabled={defaultsForm.processing}>
                        {copy.adminSettings.submitDefaults}
                    </Button>
                </form>
            </section>

            {/* NOT A FORM, and deliberately so — see the file header. Two
                labelled values and a sentence, with no control anywhere. */}
            <section className="mt-10 max-w-xl border-t pt-8">
                <h3 className="mb-3 text-lg font-semibold">
                    {copy.adminSettings.environmentSection}
                </h3>

                <dl className="space-y-3 text-sm">
                    <div>
                        <dt className="text-muted-foreground">
                            {copy.adminSettings.environmentLanguageLabel}
                        </dt>
                        <dd>{copy.adminSettings.environmentLanguageValue}</dd>
                    </div>
                    <div>
                        <dt className="text-muted-foreground">
                            {copy.adminSettings.environmentTimezoneLabel}
                        </dt>
                        {/* From the server's own Clock, never a literal typed
                            on this page. */}
                        <dd>{timezone}</dd>
                    </div>
                    <div>
                        <dt className="text-muted-foreground">
                            {copy.adminSettings.changedAtLabel}
                        </dt>
                        <dd>{changedAt ?? copy.adminSettings.changedAtNever}</dd>
                    </div>
                </dl>

                <p className="mt-3 text-sm text-muted-foreground">
                    {copy.adminSettings.environmentNote}
                </p>
            </section>
        </AdminLayout>
    );
}
