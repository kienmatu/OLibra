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
 * BR §16.4's shelf editor. **Task 4 builds one section of it — the profile.**
 * Task 5 adds the lending policy and the up-to-three contacts, and 3b-ii
 * adds the parish taxonomy (spec D8) to this same page.
 *
 * **Each section is its own form, its own submit and its own refusal** (spec
 * D2), and this file's shape is the reason that stays true: the form below
 * posts to `admin.shelves.update`, which validates and writes the profile
 * fields and nothing else. A single save covering every section is the thing
 * the spec forbids — the reference records at length why one `?saved=1` on a
 * page with several independently-submittable forms cannot say which form
 * saved, and D8's whole tolerance for reopening this screen rests on a
 * fourth section being an addition rather than a restructure.
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

interface PageProps extends SharedData {
    shelf: ShelfProfile;
}

interface ProfileForm {
    name: string;
    location: string;
    address: string;
    description: string;
    established_on: string;
}

export default function AdminShelfEdit() {
    const { shelf, errors: pageErrors } = usePage<PageProps>().props;

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
        </AdminLayout>
    );
}
