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
}

/** The bound shelf's presentation fields only — never a foreign bookshelf_id. */
export interface SharedShelf {
    id: string;
    slug: string;
    name: string;
}

export interface SharedData {
    auth: { user: SharedAuthUser | null };
    shelf: SharedShelf | null;
    role: string | null;
    /** Inertia's own Middleware::share() — validation errors, keyed by field. */
    errors: Record<string, string>;
    [key: string]: unknown;
}
