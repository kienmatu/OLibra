import { Head, useForm, usePage } from "@inertiajs/react";
import type { FormEvent } from "react";
import { route } from "ziggy-js";
import BookFields, { type BookFieldsData } from "@/components/book-fields";
import InputError from "@/components/input-error";
import { Button } from "@/components/ui/button";
import ManageLayout from "@/layouts/manage-layout";
import { copy } from "@/lib/copy";
import type { SharedData } from "@/types";

interface PageProps extends SharedData {
    book: {
        bookId: string;
        slug: string;
        title: string;
        author: string | null;
        categorySlug: string | null;
        publisher: string | null;
        publishedYear: number | null;
        pageCount: number | null;
        isbn: string | null;
        description: string | null;
        isPublished: boolean;
    };
    categories: { slug: string; name: string }[];
}

export default function ManageBooksEdit() {
    const { shelf, book, categories, errors: pageErrors } = usePage<PageProps>().props;
    const form = useForm<BookFieldsData>({
        title: book.title,
        author: book.author ?? "",
        category_slug: book.categorySlug ?? "",
        publisher: book.publisher ?? "",
        published_year: book.publishedYear?.toString() ?? "",
        page_count: book.pageCount?.toString() ?? "",
        isbn: book.isbn ?? "",
        description: book.description ?? "",
        is_published: book.isPublished,
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
        }));
        form.patch(route("shelves.manage.books.update", { shelf: shelf.slug, book: book.slug }));
    };

    return (
        <ManageLayout>
            <Head title={copy.manageBooks.editBook} />
            <h1 className="mb-4 text-2xl font-semibold">{copy.manageBooks.editBook}</h1>
            <form onSubmit={submit} className="max-w-xl space-y-4">
                <BookFields
                    data={form.data}
                    errors={form.errors}
                    categories={categories}
                    // Two independent generic signatures over the same
                    // shape — TS can't unify them structurally even though
                    // every field/value pair is sound at runtime.
                    onChange={(field, value) => form.setData(field, value as never)}
                />
                <InputError message={pageErrors.rule} />
                <Button type="submit" disabled={form.processing}>
                    {form.processing ? copy.manageBooks.saving : copy.manageBooks.save}
                </Button>
            </form>
        </ManageLayout>
    );
}
