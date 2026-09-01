import { Link, usePage } from "@inertiajs/react";
import type { PropsWithChildren } from "react";
import { route } from "ziggy-js";
import AppLayout from "@/layouts/app-layout";
import { copy, t } from "@/lib/copy";
import type { SharedData } from "@/types";

export default function AdminLayout({ children }: PropsWithChildren) {
    // Phase 3c-i Task 5: this shell now reads shared props, where before it
    // took none. BR §16.4's cross-shelf change queue wants a count beside
    // its nav item for the same reason §16.3's three do — a super
    // administrator has no other prompt that somebody's proposal is
    // waiting on them and only on them.
    const { pendingManagerProfileChanges, unreadFeedback } = usePage<SharedData>().props;

    const items = [
        { name: copy.admin.dashboard, href: route("admin.dashboard") },
        { name: copy.admin.shelves, href: route("admin.shelves") },
        { name: copy.admin.managers, href: route("admin.managers") },
        { name: copy.admin.categories, href: route("admin.categories") },
        {
            // The badge, built exactly as manage-layout builds its three:
            // count in the label, bare word at both null and 0. The number
            // is App\Queries\Admin\ManagerProfileChangeQueueQuery
            // ::countPending(), the same object the screen's own list comes
            // from — so the two share one predicate rather than agreeing by
            // coincidence, which is the defect commit 8e81c82 had to fix
            // once already.
            name: pendingManagerProfileChanges
                ? t(copy.admin.profileChangesWithCount, {
                      count: pendingManagerProfileChanges,
                  })
                : copy.admin.profileChanges,
            href: route("admin.profile-changes"),
        },
        {
            // BR §16.1's unread badge, built exactly as the item above is —
            // count in the label, bare word at both null and 0. The number
            // is App\Queries\Admin\FeedbackInboxQuery::countUnread(), the
            // same object the inbox's own list and its "n tin mới" line
            // come out of, so the two share one predicate.
            //
            // Null here means "not a super administrator" and nothing else.
            // It does NOT go null for want of a bound tenant, which is the
            // trap the three shelf badges' `$shelf !== null` clause would
            // have sprung on an area that binds none.
            name: unreadFeedback
                ? t(copy.admin.feedbackWithCount, { count: unreadFeedback })
                : copy.admin.feedback,
            href: route("admin.feedback"),
        },
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
