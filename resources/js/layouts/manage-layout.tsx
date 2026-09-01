import { Link, usePage } from "@inertiajs/react";
import type { PropsWithChildren } from "react";
import { route } from "ziggy-js";
import AppLayout from "@/layouts/app-layout";
import { copy, t } from "@/lib/copy";
import type { SharedData } from "@/types";

export default function ManageLayout({ children }: PropsWithChildren) {
    const { shelf, pendingDonations, pendingProfileChanges } = usePage<SharedData>().props;
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
        // BR §16.3's Donation queue, with the count badge that paragraph's
        // first sentence asks for: "Reachable from the sidebar nav with a
        // count badge, beside *Đổi thông tin* (pending profile changes) and
        // *Yêu cầu mượn* (request queue)".
        //
        // PLACED BESIDE *Yêu cầu mượn*, WHICH WAS HALF OF WHAT §16.3 ASKS.
        // Task 19 recorded the missing half here rather than dropping it:
        // this list had no *Đổi thông tin* item to sit beside, because the
        // route pointed at ShellController::underConstruction, and adding a
        // nav item for a placeholder was a different task's decision.
        //
        // PHASE 3c-i TASK 5 DISCHARGES THAT NOTE. The screen is real, so
        // the third item lands immediately below, completing the trio
        // §16.3's first sentence names — *Đổi thông tin* (pending profile
        // changes), *Yêu cầu mượn* (request queue) and this one — and the
        // hand-off is by NAME, which is why that note said which name.
        //
        // A RETRACTION, kept rather than quietly deleted. Task 19 shipped
        // this item with no badge and said here that a number beside one
        // of these links "would need a counts channel shared across every
        // manage screen — a change to what this layout receives". That was
        // false, and this file is where it was false: ManageLayout's first
        // statement DESTRUCTURES `shelf` out of usePage<SharedData>()
        // .props, so the whole shared bag was already in hand, and the
        // bell's count was one layout file away.
        //
        // THE COUNT IS THE SERVER'S, not a length this file could compute:
        // HandleInertiaRequests::share() (opened) sends `pendingDonations`
        // as a lazily-resolved, act-as-manager-gated number, exactly the
        // shape it already sends the bell's `unreadNotifications` in — and
        // app-layout.tsx (opened) renders that one the same way, count in
        // the label, bare word at zero. Null and 0 both fall to the bare
        // word here: a badge is news, and neither is news.
        {
            name: pendingDonations
                ? t(copy.manage.donationsWithCount, { count: pendingDonations })
                : copy.manage.donations,
            href: route("shelves.manage.donations", { shelf: shelf.slug }),
        },
        {
            // BR §16.3's *Đổi thông tin*, badge and all, built exactly like
            // the donation item above — the count in the label, in
            // parentheses, and the bare word at both null and 0, because a
            // badge is news and neither of those is news.
            //
            // THE COUNT IS THE SERVER'S and shares the queue screen's own
            // predicate: App\Queries\ProfileChangeQueueQuery::countPending()
            // counts pending proposals whose subject is a READER of this
            // shelf, which is precisely the set of cards this link opens.
            // A count of "all pending" would be larger than the list for a
            // reason no volunteer could see, since a manager's own proposal
            // is deliberately decided elsewhere (BR:580).
            name: pendingProfileChanges
                ? t(copy.manage.profileChangesWithCount, { count: pendingProfileChanges })
                : copy.manage.profileChanges,
            href: route("shelves.manage.profile-changes", { shelf: shelf.slug }),
        },
        {
            name: copy.manage.comments,
            href: route("shelves.manage.comments", { shelf: shelf.slug }),
        },
        {
            name: copy.manage.announcements,
            href: route("shelves.manage.announcements.index", { shelf: shelf.slug }),
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
            name: copy.manageStatistics.title,
            href: route("shelves.manage.statistics", { shelf: shelf.slug }),
        },
        {
            // route()'s exact name, per Task 11's brief: NOT
            // `shelves.manage.labels` — an earlier draft used that name,
            // Ziggy throws on an unknown one, and the route itself keeps
            // the placeholder's settled `qr-labels` (routes/web.php).
            name: copy.manageLabels.navItem,
            href: route("shelves.manage.qr-labels", { shelf: shelf.slug }),
        },
        {
            // Phase 3b-ii Task 5 — the parish units, now a real screen
            // rather than ShellController::underConstruction. Placed
            // immediately before *Cài đặt*, which is where the reference's
            // own sidebar puts it (manager-shell.tsx:210-211).
            //
            // A NAV ITEM FOR A SCREEN MOST OF ITS READERS CANNOT EDIT, and
            // that is deliberate: every write on it is super-admin-only,
            // but the tree itself is a manager's own parish and the
            // registration form they send readers to is built out of it.
            // Hiding the link from a manager would mean a manager could
            // not see which đơn vị their readers are being offered.
            name: copy.manage.units,
            href: route("shelves.manage.units", { shelf: shelf.slug }),
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
