import { Head, useForm, usePage } from "@inertiajs/react";
import type { FormEvent } from "react";
import { route } from "ziggy-js";
import BookFields, { type BookFieldsData } from "@/components/book-fields";
import InputError from "@/components/input-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import ManageLayout from "@/layouts/manage-layout";
import { copy } from "@/lib/copy";
import type { SharedData } from "@/types";

interface PageProps extends SharedData {
    categories: { slug: string; name: string }[];
}

type CreateForm = BookFieldsData & {
    copy_count: string;
    donor_name: string;
    acquired_on: string;
};

export default function ManageBooksCreate() {
    // `rule` (a business refusal, e.g. donor_ambiguous) arrives through the
    // shared errors prop, not useForm's field errors — its key is no form
    // field, so read it from the page.
    const { shelf, categories, errors: pageErrors } = usePage<PageProps>().props;
    const form = useForm<CreateForm>({
        title: "",
        author: "",
        category_slug: "",
        publisher: "",
        published_year: "",
        page_count: "",
        isbn: "",
        description: "",
        is_published: true,
        copy_count: "1",
        donor_name: "",
        acquired_on: "",
    });
    if (!shelf) return null;

    const submit = (event: FormEvent) => {
        event.preventDefault();
        form.transform((data) => ({
            ...data,
            publisher: data.publisher || null,
            published_year: data.published_year === "" ? null : Number(data.published_year),
            page_count: data.page_count === "" ? null : Number(data.page_count),
            isbn: data.isbn || null,
            description: data.description || null,
            copy_count: Number(data.copy_count),
            donor_name: data.donor_name || null,
            acquired_on: data.acquired_on || null,
        }));
        form.post(route("shelves.manage.books.store", { shelf: shelf.slug }));
    };

    return (
        <ManageLayout>
            <Head title={copy.manageBooks.addBook} />
            <h1 className="mb-4 text-2xl font-semibold">{copy.manageBooks.addBook}</h1>
            <form onSubmit={submit} className="max-w-xl space-y-4">
                <BookFields
                    data={form.data}
                    errors={form.errors}
                    categories={categories}
                    // BookFieldsData is a subset of CreateForm with matching
                    // value types per key, but TS can't prove that equality
                    // through two independent generic signatures — the cast
                    // is the escape hatch, not a real type hole (every field
                    // BookFields can name is a string/boolean field on the
                    // form the same way in both interfaces).
                    onChange={(field, value) => form.setData(field, value as never)}
                />
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <Label htmlFor="copy_count">{copy.manageBooks.fields.copyCount}</Label>
                        <Input
                            id="copy_count"
                            type="number"
                            min={1}
                            value={form.data.copy_count}
                            onChange={(event) => form.setData("copy_count", event.target.value)}
                            required
                        />
                        <InputError message={form.errors.copy_count} />
                    </div>
                    <div>
                        <Label htmlFor="acquired_on">{copy.manageBooks.fields.acquiredOn}</Label>
                        <Input
                            id="acquired_on"
                            type="date"
                            value={form.data.acquired_on}
                            onChange={(event) => form.setData("acquired_on", event.target.value)}
                        />
                        <InputError message={form.errors.acquired_on} />
                    </div>
                </div>
                <div>
                    <Label htmlFor="donor_name">{copy.manageBooks.fields.donorName}</Label>
                    <Input
                        id="donor_name"
                        value={form.data.donor_name}
                        onChange={(event) => form.setData("donor_name", event.target.value)}
                    />
                    <InputError message={form.errors.donor_name} />
                </div>
                <InputError message={pageErrors.rule} />
                <Button type="submit" disabled={form.processing}>
                    {form.processing ? copy.manageBooks.saving : copy.manageBooks.save}
                </Button>
            </form>
        </ManageLayout>
    );
}
