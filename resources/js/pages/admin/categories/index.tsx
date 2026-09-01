import { Head, useForm, usePage } from "@inertiajs/react";
import { Plus, Tags } from "lucide-react";
import { type FormEvent, useState } from "react";
import { route } from "ziggy-js";
import InputError from "@/components/input-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import AdminLayout from "@/layouts/admin-layout";
import { copy } from "@/lib/copy";
import type { SharedData } from "@/types";

/**
 * `/admin/categories` (spec D3) — the book genres, one taxonomy shared by
 * every tủ sách in the installation. Port of the reference's
 * `/quan-tri/the-loai`; the Vietnamese path does not carry across, only the
 * screen does.
 *
 * **THE COUNT BESIDE EACH ROW IS LOAD-BEARING.** The server refuses to
 * archive a genre while live books still carry it, so a row that showed only
 * a name could teach that rule only by producing the refusal. With the
 * number there, the screen replaces the archive control with the reason it
 * would be refused — a control whose one outcome is a refusal is not a
 * control.
 *
 * **THE RULE IS STILL THE SERVER'S.** Hiding the button is a courtesy; a
 * hand-posted request meets `category_in_use` and lands on the banner below,
 * which is why the page reads the shared bag as well as the two form bags.
 *
 * **THE RENAME WARNS BEFORE IT IS PRESSED, not after.** Renaming moves the
 * display name and nothing else: the slug stays, because moving it would
 * silently repoint every book already catalogued under the old one. That is
 * the fact somebody is most likely to have assumed the other way, so it sits
 * beside the field rather than in a flash after the fact.
 *
 * **ONE PRIMARY ACTION.** The solid button is "Thêm thể loại"; rename saves
 * quietly and archive is destructive (AGENTS.md rule 3). Single-column
 * forms, labels above inputs, required fields marked with the word (rule 6).
 */
interface CategoryRow {
    id: string;
    name: string;
    /**
     * The internal handle a book form's picker posts. Shown, never edited —
     * there is no command anywhere that moves one.
     */
    slug: string;
    /** Live books across every shelf — the number the archive guard reads. */
    bookCount: number;
}

interface PageProps extends SharedData {
    categories: CategoryRow[];
}

/** The rename form, one row's own. Closed until asked for, like the archive. */
function RenameControl({ category }: { category: CategoryRow }) {
    const [open, setOpen] = useState(false);
    const renameForm = useForm({ name: category.name });

    const submit = (event: FormEvent) => {
        event.preventDefault();
        renameForm.patch(route("admin.categories.rename", { category: category.id }), {
            // preserveScroll is conditional, the shape /admin/managers uses:
            // both banners sit at the top and this list runs one row per
            // genre, so holding position on a refusal would leave a
            // volunteer staring at an unchanged row with the explanation far
            // above the fold. Hold on success, go to the banner otherwise.
            preserveScroll: (page) => !page.props.errors?.rule,
            onSuccess: () => setOpen(false),
        });
    };

    if (!open) {
        return (
            <Button type="button" variant="outline" className="h-11" onClick={() => setOpen(true)}>
                {copy.adminCategories.renameSection}
            </Button>
        );
    }

    return (
        <form onSubmit={submit} className="flex w-full flex-col gap-3">
            <div>
                <Label htmlFor={`category-name-${category.id}`}>
                    {copy.adminCategories.renameName}
                    <span className="ml-2 font-normal text-muted-foreground">
                        {copy.adminShelves.required}
                    </span>
                </Label>
                <Input
                    id={`category-name-${category.id}`}
                    value={renameForm.data.name}
                    onChange={(event) => renameForm.setData("name", event.target.value)}
                />
                <InputError message={renameForm.errors.name} />
            </div>
            {/* Before the press, not after it — see the file header. */}
            <p className="max-w-md text-sm text-muted-foreground">
                {copy.adminCategories.renameNote}
            </p>
            <div className="flex gap-2">
                <Button
                    type="submit"
                    variant="outline"
                    className="h-11"
                    disabled={renameForm.processing}
                >
                    {copy.adminCategories.submitRename}
                </Button>
                <Button
                    type="button"
                    variant="outline"
                    className="h-11"
                    onClick={() => setOpen(false)}
                >
                    {copy.adminCategories.cancel}
                </Button>
            </div>
        </form>
    );
}

/**
 * The archive control, or the sentence explaining why there is none. The
 * server refuses either way; this decides whether a volunteer is offered a
 * button that cannot work.
 */
function ArchiveControl({ category }: { category: CategoryRow }) {
    const [open, setOpen] = useState(false);
    const form = useForm({});

    if (category.bookCount > 0) {
        return (
            <p className="max-w-md text-sm text-muted-foreground">
                {copy.adminCategories.archiveBlocked}
            </p>
        );
    }

    const submit = (event: FormEvent) => {
        event.preventDefault();
        form.post(route("admin.categories.archive", { category: category.id }), {
            preserveScroll: (page) => !page.props.errors?.rule,
        });
    };

    if (!open) {
        return (
            <Button type="button" variant="outline" className="h-11" onClick={() => setOpen(true)}>
                {copy.adminCategories.archive}
            </Button>
        );
    }

    return (
        <form onSubmit={submit} className="flex flex-col gap-2">
            <p className="max-w-md text-sm text-muted-foreground">
                {copy.adminCategories.archiveWarning}
            </p>
            <div className="flex gap-2">
                <Button
                    type="submit"
                    variant="destructive"
                    className="h-11"
                    disabled={form.processing}
                >
                    {copy.adminCategories.archiveConfirm}
                </Button>
                <Button
                    type="button"
                    variant="outline"
                    className="h-11"
                    onClick={() => setOpen(false)}
                >
                    {copy.adminCategories.cancel}
                </Button>
            </div>
        </form>
    );
}

function CategoryCard({ category }: { category: CategoryRow }) {
    return (
        <Card>
            <CardContent className="flex flex-wrap items-start justify-between gap-4 p-5">
                <div className="min-w-0">
                    <p className="text-lg font-semibold">{category.name}</p>
                    <p className="text-sm text-muted-foreground">
                        {`${copy.adminCategories.slugPrefix} /${category.slug}`}
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary" className="gap-1">
                        <Icon iconNode={Tags} className="size-3.5" />
                        {`${category.bookCount} ${copy.adminCategories.booksSuffix}`}
                    </Badge>
                    <RenameControl category={category} />
                    <ArchiveControl category={category} />
                </div>
            </CardContent>
        </Card>
    );
}

/** The one solid button on the page (AGENTS.md rule 3). */
function AddForm() {
    const addForm = useForm({ name: "" });

    const submit = (event: FormEvent) => {
        event.preventDefault();
        addForm.post(route("admin.categories.store"), {
            preserveScroll: (page) => !page.props.errors?.rule,
            onSuccess: () => addForm.reset(),
        });
    };

    return (
        <Card className="mt-6">
            <CardContent className="p-5">
                <h3 className="mb-3 text-lg font-semibold">{copy.adminCategories.addSection}</h3>
                <form onSubmit={submit} className="max-w-xl space-y-4">
                    <div>
                        <Label htmlFor="category-name">
                            {copy.adminCategories.addName}
                            <span className="ml-2 font-normal text-muted-foreground">
                                {copy.adminShelves.required}
                            </span>
                        </Label>
                        <Input
                            id="category-name"
                            placeholder={copy.adminCategories.addPlaceholder}
                            value={addForm.data.name}
                            onChange={(event) => addForm.setData("name", event.target.value)}
                        />
                        <InputError message={addForm.errors.name} />
                    </div>
                    <Button
                        type="submit"
                        className="h-14"
                        disabled={addForm.processing || addForm.data.name.trim() === ""}
                    >
                        <Icon iconNode={Plus} className="size-4" />
                        {copy.adminCategories.submitAdd}
                    </Button>
                </form>
            </CardContent>
        </Card>
    );
}

export default function AdminCategories() {
    const { categories, errors: pageErrors, flash } = usePage<PageProps>().props;

    return (
        <AdminLayout>
            <Head title={copy.adminCategories.title} />
            <div className="mb-4">
                <h2 className="text-xl font-semibold">{copy.adminCategories.title}</h2>
                <p className="text-sm text-muted-foreground">{copy.adminCategories.lead}</p>
            </div>

            {/* All three writes redirect back here with their own sentence,
                and each changes a row a volunteer would otherwise have to
                hunt for. role="status" so a screen reader is told without
                focus being stolen from the control just pressed. */}
            {flash.success ? (
                <p
                    role="status"
                    className="mb-4 rounded-md border border-green-700/30 bg-green-700/10 px-3 py-2 text-sm"
                >
                    {flash.success}
                </p>
            ) : null}

            {/* The page-level bag: bootstrap/app.php turns a RuleViolated
                from any Action into back()->withErrors(['rule' => …]), so
                category_in_use and duplicate_category both land here already
                translated. Read under a local name, the shelf editor's own
                shape, so the two forms' bags stay separate from it. */}
            <InputError message={pageErrors.rule} />

            {categories.length === 0 ? (
                <p className="text-sm text-muted-foreground">{copy.adminCategories.empty}</p>
            ) : (
                <div className="flex flex-col gap-4">
                    {categories.map((category) => (
                        <CategoryCard key={category.id} category={category} />
                    ))}
                </div>
            )}

            <AddForm />
        </AdminLayout>
    );
}
