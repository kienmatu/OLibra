import { Head, Link, router, useForm } from "@inertiajs/react";
import type { FormEvent } from "react";
import { route } from "ziggy-js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import AppLayout from "@/layouts/app-layout";
import { copy } from "@/lib/copy";

type Props = {
    shelves: { slug: string; name: string; location: string | null; address: string | null }[];
};

export default function ShelvesIndex({ shelves }: Props) {
    // Read once at mount, from the URL Inertia already navigated to — the
    // house pattern is a form the address bar drives, not client state that
    // could drift from it.
    const initialQ = new URLSearchParams(window.location.search).get("q") ?? "";
    const form = useForm({ q: initialQ });

    const submit = (event: FormEvent) => {
        event.preventDefault();
        router.get(route("shelves.index"), { q: form.data.q }, { preserveState: true });
    };

    return (
        <AppLayout>
            <Head title={copy.shelves.title} />
            <h1 className="text-2xl font-semibold">{copy.shelves.title}</h1>

            {/* BR §16.1: finding your own parish is this page's only job. */}
            <form onSubmit={submit} className="mt-4 flex max-w-sm items-end gap-2">
                <div className="flex-1">
                    <Label htmlFor="shelves-search">{copy.shelves.searchLabel}</Label>
                    <Input
                        id="shelves-search"
                        type="search"
                        name="q"
                        value={form.data.q}
                        onChange={(event) => form.setData("q", event.target.value)}
                        placeholder={copy.shelves.searchPlaceholder}
                    />
                </div>
                <Button type="submit">{copy.shelves.searchButton}</Button>
            </form>

            {shelves.length === 0 ? (
                <p className="mt-4 text-muted-foreground">
                    {form.data.q ? copy.shelves.noResults : copy.shelves.empty}
                </p>
            ) : (
                <ul className="mt-4 space-y-2">
                    {shelves.map((shelf) => (
                        <li key={shelf.slug}>
                            <Link
                                href={route("shelves.show", { shelf: shelf.slug })}
                                className="underline"
                            >
                                {shelf.name}
                            </Link>
                            {shelf.location ? (
                                <span className="ml-2 text-sm">{shelf.location}</span>
                            ) : null}
                            {shelf.address ? (
                                <span className="ml-2 text-sm">{shelf.address}</span>
                            ) : null}
                        </li>
                    ))}
                </ul>
            )}
        </AppLayout>
    );
}
