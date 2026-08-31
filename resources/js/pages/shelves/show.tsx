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
                {/* BR §16.1's shelf home, item 3 (opened): "two secondary
                    cards, **Tặng sách** and **Góp ý**". Task 18 built the
                    offer form and the reader's own list and linked them to
                    each other. Measured at 2731bea: `grep -rn
                    "shelves.donate" resources/js` returned exactly two
                    hits, one in each of those two files. That grep sees
                    Ziggy route-name calls and not a hand-written href, so
                    what it shows is that no OTHER file named the route —
                    which is why this link is added by name here.

                    Guarded on auth.user, matching the profile link below
                    it: shelves.donate sits in the ['auth', 'role:reader']
                    group, so a guest who followed it would meet the login
                    redirect rather than the form.

                    A FLAT NAV, NOT THE "cards" that paragraph asks for —
                    this page renders its five existing destinations as a
                    row of links and a sixth arrives in the same shape.
                    Building the shelf home's card layout is its own screen
                    and its own task. */}
                {auth.user ? (
                    <Link href={route("shelves.donate", { shelf: shelf.slug })}>
                        {copy.shelf.donate}
                    </Link>
                ) : null}
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
