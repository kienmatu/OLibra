import { Head, Link, usePage } from "@inertiajs/react";
import { route } from "ziggy-js";
import AppLayout from "@/layouts/app-layout";
import { copy } from "@/lib/copy";
import type { SharedData } from "@/types";

export default function ShelfShow() {
    const { auth, shelf, role } = usePage<SharedData>().props;
    if (!shelf) return null;

    return (
        <AppLayout>
            <Head title={shelf.name} />
            <h1 className="text-2xl font-semibold">{shelf.name}</h1>
            <nav className="mt-4 flex flex-wrap gap-3">
                <Link href={route("shelves.catalogue", { shelf: shelf.slug })}>
                    {copy.shelf.catalogue}
                </Link>
                <Link href={route("shelves.search", { shelf: shelf.slug })}>
                    {copy.shelf.search}
                </Link>
                <Link href={route("shelves.announcements", { shelf: shelf.slug })}>
                    {copy.shelf.announcements}
                </Link>
                {auth.user ? (
                    <Link href={route("shelves.profile.show", { shelf: shelf.slug })}>
                        {copy.shelf.profile}
                    </Link>
                ) : null}
                {role === "manager" || role === "admin" ? (
                    <Link href={route("shelves.manage.dashboard", { shelf: shelf.slug })}>
                        {copy.shelf.manage}
                    </Link>
                ) : null}
            </nav>
        </AppLayout>
    );
}
