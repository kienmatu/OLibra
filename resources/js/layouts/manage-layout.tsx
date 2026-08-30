import { Link, usePage } from "@inertiajs/react";
import type { PropsWithChildren } from "react";
import { route } from "ziggy-js";
import AppLayout from "@/layouts/app-layout";
import { copy } from "@/lib/copy";
import type { SharedData } from "@/types";

export default function ManageLayout({ children }: PropsWithChildren) {
    const { shelf } = usePage<SharedData>().props;
    if (!shelf) return null;

    const items = [
        {
            name: copy.manage.dashboard,
            href: route("shelves.manage.dashboard", { shelf: shelf.slug }),
        },
        { name: copy.manage.lend, href: route("shelves.manage.lend", { shelf: shelf.slug }) },
        { name: copy.manage.returns, href: route("shelves.manage.returns", { shelf: shelf.slug }) },
        {
            name: copy.manage.requests,
            href: route("shelves.manage.borrow-requests", { shelf: shelf.slug }),
        },
        {
            name: copy.manage.comments,
            href: route("shelves.manage.comments", { shelf: shelf.slug }),
        },
        {
            name: copy.manage.announcements,
            href: route("shelves.manage.announcements.index", { shelf: shelf.slug }),
        },
        // BR §16.3's Donation queue opens "Reachable from the sidebar nav
        // with a count badge". THE NAV ITEM SHIPS; THE BADGE DOES NOT, and
        // the reason is this file: every item in the list is a name and an
        // href, and this layout is handed nothing but `shelf`, so a number
        // beside one of them would need a counts channel shared across every
        // manage screen — a change to what this layout receives, not an
        // addition to the list. App\Queries\DonationQueueQuery's docblock
        // asks whoever builds this nav to add a countPending() beside the
        // read; that stays unbuilt here rather than shipped as a method
        // with no caller, and this task's report carries the judgement.
        {
            name: copy.manage.donations,
            href: route("shelves.manage.donations", { shelf: shelf.slug }),
        },
        {
            name: copy.manage.readers,
            href: route("shelves.manage.readers.index", { shelf: shelf.slug }),
        },
        {
            name: copy.registrationQueue.title,
            href: route("shelves.manage.registrations", { shelf: shelf.slug }),
        },
        {
            name: copy.manage.books,
            href: route("shelves.manage.books.index", { shelf: shelf.slug }),
        },
        {
            name: copy.manage.overdue,
            href: route("shelves.manage.overdue", { shelf: shelf.slug }),
        },
        {
            name: copy.manage.audit,
            href: route("shelves.manage.audit", { shelf: shelf.slug }),
        },
        {
            name: copy.manage.settings,
            href: route("shelves.manage.settings", { shelf: shelf.slug }),
        },
    ];

    return (
        <AppLayout>
            <nav className="mb-6 flex flex-wrap gap-3 border-b pb-3">
                {items.map((item) => (
                    <Link key={item.href} href={item.href} className="text-sm">
                        {item.name}
                    </Link>
                ))}
            </nav>
            {children}
        </AppLayout>
    );
}
