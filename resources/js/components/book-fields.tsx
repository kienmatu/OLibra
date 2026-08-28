import type { ChangeEvent } from "react";
import InputError from "@/components/input-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { copy } from "@/lib/copy";

export interface BookFieldsData {
    title: string;
    author: string;
    category_slug: string;
    publisher: string;
    published_year: string;
    page_count: string;
    isbn: string;
    description: string;
    is_published: boolean;
}

/**
 * The create and edit forms' shared fields — single-column, per BR §16.3.
 * No cover uploader, matching the reference (plan divergence 6); the donor
 * fields are the CREATE form's own (a title's later copies have their own
 * donors), so they live in create.tsx, not here.
 */
export default function BookFields({
    data,
    errors,
    categories,
    onChange,
}: {
    data: BookFieldsData;
    errors: Partial<Record<string, string>>;
    categories: { slug: string; name: string }[];
    onChange: <K extends keyof BookFieldsData>(field: K, value: BookFieldsData[K]) => void;
}) {
    const text =
        (field: keyof BookFieldsData) =>
        (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
            onChange(field, event.target.value as BookFieldsData[typeof field]);

    return (
        <div className="space-y-4">
            <div>
                <Label htmlFor="title">{copy.manageBooks.fields.title}</Label>
                <Input id="title" value={data.title} onChange={text("title")} required />
                <InputError message={errors.title} />
            </div>
            <div>
                <Label htmlFor="author">{copy.manageBooks.fields.author}</Label>
                <Input id="author" value={data.author} onChange={text("author")} required />
                <InputError message={errors.author} />
            </div>
            <div>
                <Label htmlFor="category_slug">{copy.manageBooks.fields.category}</Label>
                <select
                    id="category_slug"
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    value={data.category_slug}
                    onChange={(event) => onChange("category_slug", event.target.value)}
                    required
                >
                    <option value="">{copy.manageBooks.fields.categoryEmpty}</option>
                    {categories.map((category) => (
                        <option key={category.slug} value={category.slug}>
                            {category.name}
                        </option>
                    ))}
                </select>
                <InputError message={errors.category_slug} />
            </div>
            <div className="grid grid-cols-2 gap-4">
                <div>
                    <Label htmlFor="publisher">{copy.manageBooks.fields.publisher}</Label>
                    <Input id="publisher" value={data.publisher} onChange={text("publisher")} />
                    <InputError message={errors.publisher} />
                </div>
                <div>
                    <Label htmlFor="published_year">{copy.manageBooks.fields.publishedYear}</Label>
                    <Input
                        id="published_year"
                        type="number"
                        value={data.published_year}
                        onChange={text("published_year")}
                    />
                    <InputError message={errors.published_year} />
                </div>
                <div>
                    <Label htmlFor="page_count">{copy.manageBooks.fields.pageCount}</Label>
                    <Input
                        id="page_count"
                        type="number"
                        value={data.page_count}
                        onChange={text("page_count")}
                    />
                    <InputError message={errors.page_count} />
                </div>
                <div>
                    <Label htmlFor="isbn">{copy.manageBooks.fields.isbn}</Label>
                    <Input id="isbn" value={data.isbn} onChange={text("isbn")} />
                    <InputError message={errors.isbn} />
                </div>
            </div>
            <div>
                <Label htmlFor="description">{copy.manageBooks.fields.description}</Label>
                <textarea
                    id="description"
                    className="min-h-24 w-full rounded-md border bg-background px-3 py-2 text-sm"
                    value={data.description}
                    onChange={text("description")}
                />
                <InputError message={errors.description} />
            </div>
            <label className="flex items-center gap-2 text-sm">
                <input
                    type="checkbox"
                    checked={data.is_published}
                    onChange={(event) => onChange("is_published", event.target.checked)}
                />
                {copy.manageBooks.fields.isPublished}
            </label>
        </div>
    );
}
