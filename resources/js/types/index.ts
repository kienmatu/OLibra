/**
 * Mirrors app/Http/Middleware/HandleInertiaRequests::share() exactly — this
 * is the one place the shape of every page's shared props is declared, so a
 * page that writes `usePage<SharedData>()` gets the real server shape rather
 * than a hand-rolled subset that quietly drifts from it. (The starter kit's
 * SharedData/User types described a `name`/`quote`/`email` shape that
 * share() never sent even at HEAD of this file's history — every share() key
 * below was checked against the PHP method, not carried over from habit.)
 */

/** Only the fields HandleInertiaRequests::share() selects — never the row. */
export interface SharedAuthUser {
    id: string;
    display_name: string | null;
    full_name: string;
    saint_name: string;
    /**
     * The global flag — outranks every shelf role (see
     * app/Providers/AppServiceProvider.php's Gate::before). A super admin
     * has no membership on shelves they have not joined, so `role` below
     * is null for them there too; this is the only prop that still says
     * "this user can see manage/admin nav" in that case.
     */
    is_super_admin: boolean;
}

/** The bound shelf's presentation fields only — never a foreign bookshelf_id. */
export interface SharedShelf {
    id: string;
    slug: string;
    name: string;
}

/** Mirrors app/Enums/MembershipRole.php's cases — narrowed so a typo'd comparison is a type error. */
export type SharedRole = "reader" | "manager" | "admin" | null;

export interface SharedData {
    auth: { user: SharedAuthUser | null };
    shelf: SharedShelf | null;
    role: SharedRole;
    /**
     * For the plain <form method="post"> CSV downloads (Task 9): an
     * Inertia router.post cannot receive a streamed file response, so
     * those forms submit as ordinary browser POSTs and need the token
     * VerifyCsrfToken demands, carried here rather than only on the one
     * page that currently renders such a form.
     */
    csrfToken: string;
    /** Inertia's own Middleware::share() — validation errors, keyed by field. */
    errors: Record<string, string>;
    /** A one-shot success message set by a redirect — Tasks 11 and 13 use it too. */
    flash: { success: string | null };
    /**
     * BR §15's bell count, for the header link in `app-layout`.
     *
     * `null` means "this viewer gets no bell", and it is the server's
     * decision, not the layout's: a guest, a page with no shelf bound, and
     * a signed-in non-member on one of the shelf's ungated pages all get
     * null, because none of them can open the notifications page.
     * `0` is different and is a real answer — a member with an empty bell,
     * who still gets the link. See HandleInertiaRequests::share().
     */
    unreadNotifications: number | null;
    /**
     * BR §16.3's Donation queue badge, for the *Tặng sách* nav item in
     * `manage-layout`.
     *
     * Same three states as `unreadNotifications` above and for the same
     * reason: `null` means "this viewer gets no badge" and is the server's
     * decision (share() asks act-as-manager), `0` is a real answer — a
     * manager whose queue is empty. The number is
     * App\Queries\DonationQueueQuery::countPending(), which counts through
     * the same builder the queue screen's list is selected from.
     */
    pendingDonations: number | null;
    /**
     * BR §16.3's *Đổi thông tin* badge, for the manage nav — pending
     * profile changes whose subject is a READER of the bound shelf.
     *
     * Same three states as `pendingDonations` above and for the same
     * reasons. The number is App\Queries\ProfileChangeQueueQuery
     * ::countPending(), which shares its WHOLE predicate — pending and
     * reader-subject — with the queue screen the badge links to, so the
     * badge can never exceed the cards.
     */
    pendingProfileChanges: number | null;
    /**
     * BR §16.4's cross-shelf change queue badge, for the admin shell —
     * pending proposals whose subject is a manager or shelf admin
     * anywhere.
     *
     * `null` here means "not a super administrator", and it is the ONLY
     * viewer test: this queue belongs to no shelf, so unlike the three
     * counts above it does not go null merely because no tenant is bound
     * — the `/admin` area never binds one.
     */
    pendingManagerProfileChanges: number | null;
    /**
     * BR §16.1's unread-feedback badge for the admin shell — messages
     * still at `new`, across every parish and the site-wide ones.
     *
     * `null` means "not a super administrator", and like the count above
     * it is the ONLY viewer test: the inbox belongs to no shelf, so this
     * does not go null merely because no tenant is bound — the `/admin`
     * area never binds one, which is exactly the trap copying the
     * donations badge's `$shelf !== null` clause would have sprung.
     */
    unreadFeedback: number | null;
    [key: string]: unknown;
}
