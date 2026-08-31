import { Head, Link, useForm, usePage } from "@inertiajs/react";
import type { FormEvent } from "react";
import { route } from "ziggy-js";
import InputError from "@/components/input-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import AdminLayout from "@/layouts/admin-layout";
import { copy, t } from "@/lib/copy";
import type { SharedData } from "@/types";

/**
 * BR §16.4's shelf editor. **Task 4 built the profile section; Task 5 adds
 * the lending policy and the up-to-three contacts.** 3b-ii adds the parish
 * taxonomy (spec D8) to this same page.
 *
 * **Each section is its own form, its own submit and its own refusal** (spec
 * D2), and this file's shape is the reason that stays true: there are three
 * `useForm` bags below and three routes, and no state is shared between
 * them. A single save covering every section is the thing the spec forbids —
 * the reference records at length why one `?saved=1` on a page with several
 * independently-submittable forms cannot say which form saved, and D8's
 * whole tolerance for reopening this screen rests on a fourth section being
 * an addition rather than a restructure.
 *
 * **The policy carries exactly eight settings** and the comment key is
 * `comments_enabled`, not BR §5.5's `allow_comments` — the form's field
 * names are the storage keys, so this file is one of the places that
 * spelling has to be right. See App\Support\Community\CommentSettings.
 *
 * **The contacts form posts all three blocks every time**, and a blank name
 * in block 2 or 3 means no contact rather than an empty one (spec D3). The
 * blocks are fixed and positions never shift: a shelf may hold contacts at 1
 * and 3 with nothing between them.
 *
 * **The slug is rendered and not editable** (spec D1). It is shown, because
 * a shelf's address is the thing an administrator most often came here to
 * read; it is `readOnly` and it is not in the form bag, so nothing submits
 * it. The sentence under it is the part that matters: a disabled input says
 * "you cannot" and never "why", and the why is the rule — the address is
 * already printed on notices and glued inside book covers.
 *
 * That is the interface layer of a rule with three. The route's Form Request
 * declines to validate a slug, so a hand-crafted PATCH is dropped before it
 * reaches the command; the command writes five named fields and never that
 * one; and a database trigger raises SQLSTATE 45000 if either ever let one
 * through. The third is a backstop nobody should ever see fire — it would
 * reach a volunteer as a 500.
 *
 * Single column, labels above inputs, one solid button — AGENTS.md rules 6
 * and 3.
 */
interface ShelfProfile {
    id: string;
    slug: string;
    name: string;
    location: string | null;
    address: string | null;
    description: string | null;
    establishedOn: string | null;
    status: "active" | "archived";
}

/**
 * The eight settings, under their storage keys. Snake case here and not
 * camel, deliberately: these names go on the wire and land in
 * `bookshelves.settings` unchanged, so a rename on this side is a rename of
 * the stored key.
 */
interface ShelfPolicy {
    loan_days: number;
    max_concurrent_loans: number;
    max_renewals: number;
    renewal_days: number;
    hold_days: number;
    due_soon_days: number;
    comments_enabled: boolean;
    comments_require_approval: boolean;
}

interface ShelfContact {
    position: number;
    name: string;
    phone: string | null;
    roleLabel: string | null;
}

interface PageProps extends SharedData {
    shelf: ShelfProfile;
    policy: ShelfPolicy;
    /** Always three entries, `null` for a position the shelf has no row at. */
    contacts: (ShelfContact | null)[];
}

interface ProfileForm {
    name: string;
    location: string;
    address: string;
    description: string;
    established_on: string;
}

/**
 * The numbers are held as strings and not numbers. An `<input type="number">`
 * whose value is a number cannot represent "the volunteer cleared the box" —
 * it either coerces the empty string to 0 or refuses to render — and 0 is a
 * legal value for two of these six, so an empty box silently becoming a
 * saved 0 is exactly the defect the reference's bounds table was written to
 * close. Strings keep "empty" distinct, and the server's `integer` rule
 * refuses an empty one with a sentence.
 */
interface PolicyForm {
    loan_days: string;
    max_concurrent_loans: string;
    max_renewals: string;
    renewal_days: string;
    hold_days: string;
    due_soon_days: string;
    comments_enabled: boolean;
    comments_require_approval: boolean;
}

interface ContactsForm {
    contact_1_name: string;
    contact_1_phone: string;
    contact_1_role_label: string;
    contact_2_name: string;
    contact_2_phone: string;
    contact_2_role_label: string;
    contact_3_name: string;
    contact_3_phone: string;
    contact_3_role_label: string;
}

/**
 * The six numbers, with the bounds the server enforces mirrored onto the
 * inputs. The mirror is the convenience and the Form Request is the rule —
 * `min`/`max` on an input is a hint a hand-crafted POST ignores, and the two
 * floors of 0 (`max_renewals`, `due_soon_days`) are real policies rather
 * than unset fields, which is why they are written here one field at a time
 * instead of a shared `min={1}`.
 */
const POLICY_NUMBERS = [
    { key: "loan_days", label: copy.adminShelves.policyFields.loanDays, min: 1, max: 365 },
    {
        key: "max_concurrent_loans",
        label: copy.adminShelves.policyFields.maxConcurrentLoans,
        min: 1,
        max: 50,
    },
    { key: "max_renewals", label: copy.adminShelves.policyFields.maxRenewals, min: 0, max: 10 },
    { key: "renewal_days", label: copy.adminShelves.policyFields.renewalDays, min: 1, max: 365 },
    { key: "hold_days", label: copy.adminShelves.policyFields.holdDays, min: 1, max: 30 },
    { key: "due_soon_days", label: copy.adminShelves.policyFields.dueSoonDays, min: 0, max: 30 },
] as const satisfies readonly {
    key: keyof Omit<PolicyForm, "comments_enabled" | "comments_require_approval">;
    label: string;
    min: number;
    max: number;
}[];

/** Three fixed blocks, in position order. Positions never shift. */
const CONTACT_BLOCKS = [
    {
        position: 1,
        nameKey: "contact_1_name",
        phoneKey: "contact_1_phone",
        roleKey: "contact_1_role_label",
    },
    {
        position: 2,
        nameKey: "contact_2_name",
        phoneKey: "contact_2_phone",
        roleKey: "contact_2_role_label",
    },
    {
        position: 3,
        nameKey: "contact_3_name",
        phoneKey: "contact_3_phone",
        roleKey: "contact_3_role_label",
    },
] as const satisfies readonly {
    position: number;
    nameKey: keyof ContactsForm;
    phoneKey: keyof ContactsForm;
    roleKey: keyof ContactsForm;
}[];

export default function AdminShelfEdit() {
    const { shelf, policy, contacts, errors: pageErrors } = usePage<PageProps>().props;

    // The slug is deliberately absent from this bag. Inertia submits what
    // the bag holds, so leaving it out is what makes the read-only input
    // above a fact about the request rather than a styling choice.
    const form = useForm<ProfileForm>({
        name: shelf.name,
        location: shelf.location ?? "",
        address: shelf.address ?? "",
        description: shelf.description ?? "",
        established_on: shelf.establishedOn ?? "",
    });

    const submit = (event: FormEvent) => {
        event.preventDefault();
        form.patch(route("admin.shelves.update", { bookshelf: shelf.slug }));
    };

    // Its own bag and its own route. Nothing here reads or writes the
    // profile form's state, which is what "three separate refusals" means in
    // practice: a rejected loan period leaves a half-typed address alone.
    const policyForm = useForm<PolicyForm>({
        loan_days: String(policy.loan_days),
        max_concurrent_loans: String(policy.max_concurrent_loans),
        max_renewals: String(policy.max_renewals),
        renewal_days: String(policy.renewal_days),
        hold_days: String(policy.hold_days),
        due_soon_days: String(policy.due_soon_days),
        comments_enabled: policy.comments_enabled,
        comments_require_approval: policy.comments_require_approval,
    });

    const submitPolicy = (event: FormEvent) => {
        event.preventDefault();
        policyForm.patch(route("admin.shelves.policy", { bookshelf: shelf.slug }));
    };

    // `contacts` is indexed by position minus one and its entries may be
    // null — three fixed blocks, not a list that shortens.
    const at = (position: number) => contacts[position - 1] ?? null;

    const contactsForm = useForm<ContactsForm>({
        contact_1_name: at(1)?.name ?? "",
        contact_1_phone: at(1)?.phone ?? "",
        contact_1_role_label: at(1)?.roleLabel ?? "",
        contact_2_name: at(2)?.name ?? "",
        contact_2_phone: at(2)?.phone ?? "",
        contact_2_role_label: at(2)?.roleLabel ?? "",
        contact_3_name: at(3)?.name ?? "",
        contact_3_phone: at(3)?.phone ?? "",
        contact_3_role_label: at(3)?.roleLabel ?? "",
    });

    const submitContacts = (event: FormEvent) => {
        event.preventDefault();
        // PUT, because this submit replaces the whole set: whatever the
        // three blocks say is the complete truth about who to phone.
        contactsForm.put(route("admin.shelves.contacts", { bookshelf: shelf.slug }));
    };

    return (
        <AdminLayout>
            <Head title={copy.adminShelves.editTitle} />
            <h2 className="mb-1 text-xl font-semibold">{shelf.name}</h2>
            <p className="mb-4 text-sm text-muted-foreground">{shelf.slug}</p>

            {/* A business refusal arrives through the shared errors prop
                under `rule`, not as a field error — bootstrap/app.php's one
                RuleViolated hook. */}
            <InputError message={pageErrors.rule} />

            <section className="max-w-xl">
                <h3 className="mb-3 text-lg font-semibold">{copy.adminShelves.profileSection}</h3>

                <form onSubmit={submit} className="space-y-4">
                    <div>
                        <Label htmlFor="slug">{copy.adminShelves.fields.slug}</Label>
                        <Input id="slug" value={shelf.slug} readOnly disabled />
                        <p className="mt-1 text-sm text-muted-foreground">
                            {copy.adminShelves.slugFixed}
                        </p>
                    </div>

                    <div>
                        <Label htmlFor="name">
                            {copy.adminShelves.fields.name}
                            <span className="ml-2 font-normal text-muted-foreground">
                                {copy.adminShelves.required}
                            </span>
                        </Label>
                        <Input
                            id="name"
                            value={form.data.name}
                            onChange={(event) => form.setData("name", event.target.value)}
                        />
                        <InputError message={form.errors.name} />
                    </div>

                    <div>
                        <Label htmlFor="location">{copy.adminShelves.fields.location}</Label>
                        <Input
                            id="location"
                            value={form.data.location}
                            onChange={(event) => form.setData("location", event.target.value)}
                        />
                        <InputError message={form.errors.location} />
                    </div>

                    <div>
                        <Label htmlFor="address">{copy.adminShelves.fields.address}</Label>
                        <Input
                            id="address"
                            value={form.data.address}
                            onChange={(event) => form.setData("address", event.target.value)}
                        />
                        <InputError message={form.errors.address} />
                    </div>

                    <div>
                        <Label htmlFor="description">{copy.adminShelves.fields.description}</Label>
                        <textarea
                            id="description"
                            rows={5}
                            className="min-h-32 w-full rounded-md border bg-background px-3 py-2 text-sm"
                            value={form.data.description}
                            onChange={(event) => form.setData("description", event.target.value)}
                        />
                        <InputError message={form.errors.description} />
                    </div>

                    <div>
                        <Label htmlFor="established_on">
                            {copy.adminShelves.fields.establishedOn}
                        </Label>
                        {/* A DATE column, so `yyyy-mm-dd` goes to the server
                            and comes back unchanged — no instant, and none
                            of the timezone reasoning an announcement's
                            expiry needs. */}
                        <Input
                            id="established_on"
                            type="date"
                            value={form.data.established_on}
                            onChange={(event) => form.setData("established_on", event.target.value)}
                        />
                        <InputError message={form.errors.established_on} />
                    </div>

                    <div className="flex items-center gap-4">
                        {/* One solid action per SECTION, which is what makes
                            three forms on one screen readable — AGENTS.md
                            rule 3 and spec D2. */}
                        <Button type="submit" className="h-14" disabled={form.processing}>
                            {copy.adminShelves.submitProfile}
                        </Button>
                        <Link href={route("admin.shelves")} className="text-sm">
                            {copy.adminShelves.cancel}
                        </Link>
                    </div>
                </form>
            </section>

            <section className="mt-10 max-w-xl">
                <h3 className="mb-1 text-lg font-semibold">{copy.adminShelves.policySection}</h3>
                <p className="mb-3 text-sm text-muted-foreground">{copy.adminShelves.policyLead}</p>

                <form onSubmit={submitPolicy} className="space-y-4">
                    {POLICY_NUMBERS.map(({ key, label, min, max }) => (
                        <div key={key}>
                            <Label htmlFor={key}>{label}</Label>
                            <Input
                                id={key}
                                type="number"
                                inputMode="numeric"
                                min={min}
                                max={max}
                                value={policyForm.data[key]}
                                onChange={(event) => policyForm.setData(key, event.target.value)}
                            />
                            <InputError message={policyForm.errors[key]} />
                        </div>
                    ))}

                    <p className="text-sm text-muted-foreground">
                        {copy.adminShelves.policyZeroAllowed}
                    </p>

                    {/* Both toggles are always posted, true or false. An
                        unticked checkbox sends nothing of its own accord,
                        and "the volunteer unticked it" must not arrive as
                        "leave it as it was" on a settings form. */}
                    <label className="flex items-center gap-2 text-sm">
                        <input
                            type="checkbox"
                            checked={policyForm.data.comments_enabled}
                            onChange={(event) =>
                                policyForm.setData("comments_enabled", event.target.checked)
                            }
                        />
                        {copy.adminShelves.policyFields.commentsEnabled}
                    </label>
                    <InputError message={policyForm.errors.comments_enabled} />

                    <label className="flex items-center gap-2 text-sm">
                        <input
                            type="checkbox"
                            checked={policyForm.data.comments_require_approval}
                            onChange={(event) =>
                                policyForm.setData(
                                    "comments_require_approval",
                                    event.target.checked,
                                )
                            }
                        />
                        {copy.adminShelves.policyFields.commentsRequireApproval}
                    </label>
                    <InputError message={policyForm.errors.comments_require_approval} />

                    <Button type="submit" className="h-14" disabled={policyForm.processing}>
                        {copy.adminShelves.submitPolicy}
                    </Button>
                </form>
            </section>

            <section className="mt-10 max-w-xl">
                <h3 className="mb-1 text-lg font-semibold">{copy.adminShelves.contactsSection}</h3>
                <p className="mb-3 text-sm text-muted-foreground">
                    {copy.adminShelves.contactsLead}
                </p>

                <form onSubmit={submitContacts} className="space-y-6">
                    {CONTACT_BLOCKS.map(({ position, nameKey, phoneKey, roleKey }) => (
                        <fieldset key={position} className="space-y-3 rounded-md border p-4">
                            <legend className="px-1 text-sm font-medium">
                                {t(copy.adminShelves.contactHeading, { position })}
                            </legend>

                            <div>
                                <Label htmlFor={nameKey}>
                                    {copy.adminShelves.contactFields.name}
                                    <span className="ml-2 font-normal text-muted-foreground">
                                        {position === 1
                                            ? copy.adminShelves.required
                                            : copy.adminShelves.contactOptional}
                                    </span>
                                </Label>
                                <Input
                                    id={nameKey}
                                    value={contactsForm.data[nameKey]}
                                    onChange={(event) =>
                                        contactsForm.setData(nameKey, event.target.value)
                                    }
                                />
                                <InputError message={contactsForm.errors[nameKey]} />
                            </div>

                            <div>
                                <Label htmlFor={phoneKey}>
                                    {copy.adminShelves.contactFields.phone}
                                </Label>
                                <Input
                                    id={phoneKey}
                                    value={contactsForm.data[phoneKey]}
                                    onChange={(event) =>
                                        contactsForm.setData(phoneKey, event.target.value)
                                    }
                                />
                                <InputError message={contactsForm.errors[phoneKey]} />
                            </div>

                            <div>
                                <Label htmlFor={roleKey}>
                                    {copy.adminShelves.contactFields.roleLabel}
                                </Label>
                                <Input
                                    id={roleKey}
                                    value={contactsForm.data[roleKey]}
                                    onChange={(event) =>
                                        contactsForm.setData(roleKey, event.target.value)
                                    }
                                />
                                <p className="mt-1 text-sm text-muted-foreground">
                                    {copy.adminShelves.contactRoleHint}
                                </p>
                                <InputError message={contactsForm.errors[roleKey]} />
                            </div>
                        </fieldset>
                    ))}

                    <Button type="submit" className="h-14" disabled={contactsForm.processing}>
                        {copy.adminShelves.submitContacts}
                    </Button>
                </form>
            </section>
        </AdminLayout>
    );
}
