import { Head, Link, useForm, usePage } from "@inertiajs/react";
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
 * BR §16.4's create-a-shelf form, beside the list at
 * `admin/shelves/index.tsx`.
 *
 * **Its own component, not the edit form handed a null row** — which is the
 * shape `manage/announcements/form.tsx` uses, and the right one there. The
 * two screens differ here by more than a heading: this one asks for a slug
 * and `edit.tsx` renders the same field read-only with a sentence saying
 * why, because spec D1 fixes the slug at creation. One component doing both
 * would be one component whose most important field is conditional, and the
 * condition would be the thing a reader has to reconstruct.
 *
 * **The slug is typed, never derived.** The reference folds the name into a
 * slug when the caller supplies none; this form makes it required, so the
 * address a parish will be printing is always something a person chose and
 * read back rather than a transliteration they never saw. The hint carries
 * the shape the server enforces.
 *
 * **No lending policy and no contacts on this screen.** A new shelf starts
 * with an empty settings bag and every consumer's own fallback, and Task 5's
 * forms on the edit screen are where a real policy and the parish's contacts
 * are filled in — which is where this form's submit lands and what its flash
 * says. Spec D2's per-section forms are the reason that is an addition
 * rather than a longer form here.
 *
 * Single column, labels above inputs, the word *Bắt buộc* rather than an
 * asterisk, one solid button — AGENTS.md rules 6 and 3.
 */
interface CreateShelfForm {
    name: string;
    slug: string;
    location: string;
    address: string;
    description: string;
    established_on: string;
}

export default function AdminShelfCreate() {
    const { errors: pageErrors } = usePage<SharedData>().props;
    const form = useForm<CreateShelfForm>({
        name: "",
        slug: "",
        location: "",
        address: "",
        description: "",
        established_on: "",
    });

    const submit = (event: FormEvent) => {
        event.preventDefault();
        form.post(route("admin.shelves.store"));
    };

    return (
        <AdminLayout>
            <Head title={copy.adminShelves.createTitle} />
            <h2 className="mb-4 text-xl font-semibold">{copy.adminShelves.createTitle}</h2>

            {/* A business refusal arrives through the shared errors prop
                under `rule`, not as a field error — bootstrap/app.php's one
                RuleViolated hook. */}
            <InputError message={pageErrors.rule} />

            <form onSubmit={submit} className="max-w-xl space-y-4">
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
                    <Label htmlFor="slug">
                        {copy.adminShelves.fields.slug}
                        <span className="ml-2 font-normal text-muted-foreground">
                            {copy.adminShelves.required}
                        </span>
                    </Label>
                    <Input
                        id="slug"
                        value={form.data.slug}
                        onChange={(event) => form.setData("slug", event.target.value)}
                    />
                    <p className="mt-1 text-sm text-muted-foreground">
                        {copy.adminShelves.slugHint}
                    </p>
                    <InputError message={form.errors.slug} />
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
                    <Label htmlFor="established_on">{copy.adminShelves.fields.establishedOn}</Label>
                    {/* A DATE column, so there is no instant and no
                        timezone question of the kind an announcement's
                        expiry has to answer: `yyyy-mm-dd` goes to the
                        server and comes back unchanged. */}
                    <Input
                        id="established_on"
                        type="date"
                        value={form.data.established_on}
                        onChange={(event) => form.setData("established_on", event.target.value)}
                    />
                    <InputError message={form.errors.established_on} />
                </div>

                <div className="flex items-center gap-4">
                    {/* The one solid action on this screen — AGENTS.md rule
                        3. h-14 = 56px, design rule 4's primary size. */}
                    <Button type="submit" className="h-14" disabled={form.processing}>
                        {copy.adminShelves.submitCreate}
                    </Button>
                    <Link href={route("admin.shelves")} className="text-sm">
                        {copy.adminShelves.cancel}
                    </Link>
                </div>
            </form>
        </AdminLayout>
    );
}
