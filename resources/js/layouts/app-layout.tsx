import { Link, usePage } from "@inertiajs/react";
import type { PropsWithChildren } from "react";
import { route } from "ziggy-js";
import { copy, t } from "@/lib/copy";
import type { SharedData } from "@/types";

export default function AppLayout({ children }: PropsWithChildren) {
    const { auth, shelf, unreadNotifications } = usePage<SharedData>().props;

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
                        {/*
                         * BR §15's "a bell with an unread count", as a
                         * header LINK rather than a dropdown: this layout
                         * has no dropdown anywhere and the count reads
                         * better as a number a child can read than as a
                         * dot. The count is in the LABEL, not a superscript
                         * badge — the reference's own reasoning
                         * (public-header.tsx) and the reason nothing here
                         * needs a badge component.
                         *
                         * The whole condition is `!== null`, and the null
                         * is the SERVER's: HandleInertiaRequests sends a
                         * number only to somebody the notifications route
                         * would actually admit. Deciding that here from
                         * `shelf && auth.user` — the shape this file shipped
                         * first — put the link in front of a signed-in
                         * non-member on the shelf's ungated feedback page
                         * and 404'd them. This repo has NO frontend
                         * rendering tests, so the rule that can be pinned
                         * belongs on the side that can be pinned.
                         *
                         * Zero renders the bare word, never "(0)": an empty
                         * bell is still a place to go, but it is not news.
                         */}
                        {shelf && unreadNotifications !== null ? (
                            <Link
                                href={route("shelves.profile.notifications", { shelf: shelf.slug })}
                            >
                                {unreadNotifications
                                    ? t(copy.notifications.bellWithCount, {
                                          count: unreadNotifications,
                                      })
                                    : copy.notifications.bell}
                            </Link>
                        ) : null}
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
