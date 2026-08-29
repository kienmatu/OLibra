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
    /** Inertia's own Middleware::share() — validation errors, keyed by field. */
    errors: Record<string, string>;
    /** A one-shot success message set by a redirect — Tasks 11 and 13 use it too. */
    flash: { success: string | null };
    [key: string]: unknown;
}
