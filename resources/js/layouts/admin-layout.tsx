import { Link } from "@inertiajs/react";
import type { PropsWithChildren } from "react";
import { route } from "ziggy-js";
import AppLayout from "@/layouts/app-layout";
import { copy } from "@/lib/copy";

export default function AdminLayout({ children }: PropsWithChildren) {
    const items = [
        { name: copy.admin.shelves, href: route("admin.shelves") },
        { name: copy.admin.managers, href: route("admin.managers") },
        { name: copy.admin.categories, href: route("admin.categories") },
        { name: copy.admin.settings, href: route("admin.settings") },
    ];

    return (
        <AppLayout>
            <h1 className="mb-4 text-lg font-semibold">{copy.admin.title}</h1>
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
