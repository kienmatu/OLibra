import { Link, usePage } from "@inertiajs/react";
import type { PropsWithChildren } from "react";
import { route } from "ziggy-js";
import { copy } from "@/lib/copy";

type SharedProps = {
    auth: { user: { id: string; display_name: string | null; full_name: string } | null };
    shelf: { id: string; slug: string; name: string } | null;
};

export default function AppLayout({ children }: PropsWithChildren) {
    const { auth, shelf } = usePage<SharedProps>().props;

    return (
        <div className="min-h-screen bg-background text-foreground">
            <header className="border-b px-4 py-3">
                <nav className="mx-auto flex max-w-4xl items-center justify-between">
                    <Link href={route("home")} className="font-semibold">
                        {copy.common.appName}
                    </Link>
                    <div className="flex items-center gap-4">
                        {shelf ? (
                            <Link href={route("shelves.show", { shelf: shelf.slug })}>
                                {shelf.name}
                            </Link>
                        ) : (
                            <Link href={route("shelves.index")}>{copy.home.browseShelves}</Link>
                        )}
                        {auth.user ? (
                            <Link href={route("logout")} method="post" as="button">
                                {copy.common.signOut}
                            </Link>
                        ) : (
                            <Link href={route("login")}>{copy.common.signIn}</Link>
                        )}
                    </div>
                </nav>
            </header>
            <main className="mx-auto max-w-4xl px-4 py-6">{children}</main>
        </div>
    );
}
