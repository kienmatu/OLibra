import { Head, router, usePage } from "@inertiajs/react";
import { route } from "ziggy-js";
import AdminLayout from "@/layouts/admin-layout";
import { copy, t } from "@/lib/copy";
import { formatInstantParts } from "@/lib/dates";
import type { SharedData } from "@/types";

/**
 * BR:606's cross-shelf audit browser — the last `underConstruction` route in
 * the application, and the screen six administration actions have been
 * writing rows for with nobody able to read them.
 *
 * THE SAME LOG THE MANAGER READS, FROM FURTHER BACK. Every row on this page
 * comes out of App\Queries\Concerns\ReadsAuditLog, the same joins, the same
 * sentences and the same ordering as `manage/audit`, so the two screens
 * cannot come to disagree about what an entry says. What this one adds is
 * the rows a shelf-scoped read cannot express: the installation's own,
 * written by acts that belong to no parish.
 *
 * FOUR FILTERS AND NO WRITE. There is no control on this page that changes
 * anything — a log a screen can edit is not a log. Every control is a GET
 * carrying its parameter, which is also what makes the shelf and the actor
 * linkable: `/admin/managers` links straight in here with an actor already
 * chosen (Task 6).
 *
 * THE SHELF FILTER HAS THREE ANSWERS, NOT TWO. "Mọi tủ sách" is the default
 * and includes the installation's own rows; "Toàn hệ thống" is those rows
 * ALONE, which is the option that makes this screen worth building. The
 * server sends the site-wide option with a null name and the key it expects
 * back, so the Vietnamese for it lives here in copy.ts rather than in a
 * query.
 *
 * NO SHELF COLUMN ON THE ROWS THEMSELVES, which the reference names as a
 * gap in its own page and this port has not closed either: the row builder
 * is shared with the manager's screen, where a shelf name beside every entry
 * would be the same word repeated down the page. The shelf filter is how the
 * question "which parish was this" gets answered here.
 *
 * AN ACTION WITH NO SENTENCE IS NEUTRAL, NOT BLANK, and that is the
 * server's doing rather than this file's: AuditSentences::phrase falls
 * through to `audit.unknown` — "thực hiện một thao tác hệ thống chưa được
 * mô tả" — so a row written by a build newer than the sentence map still
 * arrives as a readable sentence with its actor and its instant. There is
 * deliberately no client-side fallback beside it: a second one would only
 * fire if the server's ever answered blank, which would be a defect worth
 * seeing rather than papering over. The raw action is in the expansion
 * below either way.
 *
 * THE VOCABULARY IS manageAudit's, BORROWED WHOLESALE — the group chips, the
 * date labels, the expansion table's three headers and the paging words. The
 * same record read from further back is the same vocabulary, and a second
 * copy of "Trước" and "Sau" is a second place for them to drift.
 */

interface ExpansionRow {
    field: string;
    before: string;
    after: string;
}

interface AuditRow {
    id: string;
    action: string;
    entityType: string;
    entityId: string | null;
    occurredAt: string;
    group: "loans" | "books" | "readers" | "community" | "administration" | null;
    /** Never empty: an unmapped action falls through to `audit.unknown`. */
    sentence: string;
    expansion: ExpansionRow[];
}

interface PageProps extends SharedData {
    /** The NARROWED filters, never the raw query parameters. */
    filters: {
        shelf: string | null;
        actor: string | null;
        group: string | null;
        from: string | null;
        to: string | null;
    };
    actors: { userId: string; name: string; entries: number }[];
    /** A null `name` is the installation itself, labelled from copy.ts. */
    shelves: { shelfId: string; name: string | null; entries: number }[];
    /** AuditBrowserQuery::SITE_WIDE, so the key is stated once, server-side. */
    siteWideKey: string;
    log: { rows: AuditRow[]; page: number; pageCount: number; total: number };
}

// Mirrors AuditSentences::GROUPS, which is the ?group= whitelist the
// controller enforces; a group missing here is a filter nobody can reach.
const GROUP_KEYS = ["loans", "books", "readers", "community", "administration"] as const;

export default function AdminAudit() {
    const { filters, actors, shelves, siteWideKey, log } = usePage<PageProps>().props;

    const go = (next: Partial<PageProps["filters"] & { page: number }>) =>
        router.get(
            route("admin.audit"),
            Object.fromEntries(
                Object.entries({ ...filters, page: undefined, ...next }).filter(
                    ([, v]) => v !== null && v !== undefined && v !== "",
                ),
            ),
        );

    return (
        <AdminLayout>
            <Head title={copy.adminAudit.title} />
            <h2 className="text-2xl font-semibold">{copy.adminAudit.title}</h2>
            <p className="mb-4 text-sm text-muted-foreground">{copy.adminAudit.lead}</p>

            <div className="mb-2 flex flex-wrap gap-2">
                <button
                    type="button"
                    onClick={() => go({ group: null })}
                    className={`rounded-full border px-3 py-1 text-sm ${filters.group === null ? "border-foreground font-medium" : ""}`}
                >
                    {copy.manageAudit.groupAll}
                </button>
                {GROUP_KEYS.map((key) => (
                    <button
                        key={key}
                        type="button"
                        onClick={() => go({ group: key })}
                        className={`rounded-full border px-3 py-1 text-sm ${filters.group === key ? "border-foreground font-medium" : ""}`}
                    >
                        {copy.manageAudit.groups[key]}
                    </button>
                ))}
            </div>

            <div className="mb-4 flex flex-wrap items-end gap-3">
                <label className="flex flex-col text-sm">
                    {copy.adminAudit.shelfLabel}
                    <select
                        className="mt-1 h-9 rounded-md border border-input bg-background px-2 text-sm"
                        value={filters.shelf ?? ""}
                        onChange={(e) => go({ shelf: e.target.value || null })}
                    >
                        <option value="">{copy.adminAudit.shelfAll}</option>
                        {shelves.map((s) => (
                            <option key={s.shelfId} value={s.shelfId}>
                                {/* A null name is the installation itself, and
                                    the label is this file's — the server sends
                                    the absence, not the word. */}
                                {s.shelfId === siteWideKey
                                    ? copy.adminAudit.shelfSiteWide
                                    : (s.name ?? s.shelfId)}{" "}
                                {t(copy.adminAudit.shelfEntries, { count: s.entries })}
                            </option>
                        ))}
                    </select>
                </label>
                <label className="flex flex-col text-sm">
                    {copy.manageAudit.actorLabel}
                    <select
                        className="mt-1 h-9 rounded-md border border-input bg-background px-2 text-sm"
                        value={filters.actor ?? ""}
                        onChange={(e) => go({ actor: e.target.value || null })}
                    >
                        <option value="">{copy.manageAudit.actorAll}</option>
                        {actors.map((a) => (
                            <option key={a.userId} value={a.userId}>
                                {a.name} {t(copy.manageAudit.actorEntries, { count: a.entries })}
                            </option>
                        ))}
                    </select>
                </label>
                <label className="flex flex-col text-sm">
                    {copy.manageAudit.fromLabel}
                    <input
                        type="date"
                        className="mt-1 h-9 rounded-md border border-input bg-background px-2 text-sm"
                        value={filters.from ?? ""}
                        onChange={(e) => go({ from: e.target.value || null })}
                    />
                </label>
                <label className="flex flex-col text-sm">
                    {copy.manageAudit.toLabel}
                    <input
                        type="date"
                        className="mt-1 h-9 rounded-md border border-input bg-background px-2 text-sm"
                        value={filters.to ?? ""}
                        onChange={(e) => go({ to: e.target.value || null })}
                    />
                </label>
                <span className="pb-2 text-sm text-muted-foreground">
                    {t(copy.manageAudit.totalEntries, { count: log.total })}
                </span>
            </div>

            {log.rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">{copy.manageAudit.empty}</p>
            ) : (
                <ul className="divide-y border-y">
                    {log.rows.map((row) => {
                        const when = formatInstantParts(row.occurredAt);
                        return (
                            <li key={row.id} className="py-3">
                                <p className="text-sm">
                                    {row.sentence}{" "}
                                    <span className="text-muted-foreground">
                                        {t(copy.manageAudit.when, {
                                            time: when.time,
                                            date: when.date,
                                        })}
                                    </span>
                                </p>
                                {/* BR §14: raw values behind an expansion, no client JS —
                                    a <details>, like every disclosure in the reference. */}
                                <details className="mt-1">
                                    <summary className="cursor-pointer text-xs text-muted-foreground">
                                        {copy.manageAudit.detail}
                                    </summary>
                                    <div className="mt-2 text-xs">
                                        <p className="mb-1 font-mono text-muted-foreground">
                                            {t(copy.manageAudit.rawAction, { action: row.action })}
                                        </p>
                                        {row.expansion.length > 0 && (
                                            <div className="overflow-x-auto">
                                                <table className="min-w-[320px] text-left">
                                                    <thead>
                                                        <tr className="text-muted-foreground">
                                                            <th className="pr-4 font-normal">
                                                                {copy.manageAudit.fieldHeader}
                                                            </th>
                                                            <th className="pr-4 font-normal">
                                                                {copy.manageAudit.beforeHeader}
                                                            </th>
                                                            <th className="font-normal">
                                                                {copy.manageAudit.afterHeader}
                                                            </th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {row.expansion.map((cell) => (
                                                            <tr key={cell.field}>
                                                                <td className="pr-4 font-mono">
                                                                    {cell.field}
                                                                </td>
                                                                <td className="pr-4 font-mono">
                                                                    {cell.before}
                                                                </td>
                                                                <td className="font-mono">
                                                                    {cell.after}
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        )}
                                    </div>
                                </details>
                            </li>
                        );
                    })}
                </ul>
            )}

            {log.pageCount > 1 && (
                <div className="mt-4 flex gap-2">
                    {log.page > 1 && (
                        <button
                            type="button"
                            className="text-sm underline"
                            onClick={() => go({ page: log.page - 1 })}
                        >
                            {copy.manageAudit.prevPage}
                        </button>
                    )}
                    {log.page < log.pageCount && (
                        <button
                            type="button"
                            className="text-sm underline"
                            onClick={() => go({ page: log.page + 1 })}
                        >
                            {copy.manageAudit.nextPage}
                        </button>
                    )}
                </div>
            )}
        </AdminLayout>
    );
}
